import * as bcrypt from "bcryptjs";
import { createHash, randomBytes } from "crypto";
import jwt, { type SignOptions } from "jsonwebtoken";
import { authenticator } from "otplib";
import * as QRCode from "qrcode";
import type { PrismaClient, Role } from "@prisma/client";
import { UnauthorizedError } from "./errors";

// --- password.util.ts (ported verbatim) ---------------------------------

const SALT_ROUNDS = 10;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// --- jwt.strategy.ts / access tokens -------------------------------------

export interface JwtPayload {
  sub: string;
  role: string;
  type: "access";
}

// Fail loudly if unset, rather than silently signing/verifying against an
// empty-string secret — a forgeable signature is worse than a crash.
function getAccessSecret(): string {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error("JWT_ACCESS_SECRET must be set");
  return secret;
}

export function signAccessToken(payload: { sub: string; role: string }): string {
  return jwt.sign({ ...payload, type: "access" }, getAccessSecret(), { expiresIn: "15m" });
}

// Returns null (rather than throwing) so callers can distinguish "no/invalid
// token" from other failure modes, matching withRoute()'s public-vs-auth flow.
//
// Security: magic links (below) are signed with this same secret, so without
// the `type: "access"` check a leaked/forwarded magic link (e.g. the 30-day
// preboarding-portal link emailed to new joiners) would verify successfully
// here and be accepted as a full access token on any route with no `roles:`
// restriction — the two token kinds were otherwise indistinguishable.
export function verifyAccessToken(token: string): { userId: string; role: string } | null {
  try {
    const decoded = jwt.verify(token, getAccessSecret()) as JwtPayload;
    if (decoded.type !== "access") return null;
    return { userId: decoded.sub, role: decoded.role };
  } catch {
    return null;
  }
}

// --- magic-link.service.ts (ported) --------------------------------------
// Reuses the same JWT_ACCESS_SECRET as access tokens, matching the Nest
// AuthModule's single shared JwtService instance.

export interface MagicLinkPayload {
  sub: string;
  purpose: string;
  [key: string]: unknown;
}

export function signMagicLink(
  payload: MagicLinkPayload,
  expiresIn: NonNullable<SignOptions["expiresIn"]> = "7d",
): string {
  return jwt.sign(payload, getAccessSecret(), { expiresIn });
}

export function verifyMagicLink<T extends MagicLinkPayload>(token: string, purpose: string): T {
  let decoded: T;
  try {
    decoded = jwt.verify(token, getAccessSecret()) as T;
  } catch {
    throw new UnauthorizedError("This link is invalid or has expired");
  }
  if (decoded.purpose !== purpose) {
    throw new UnauthorizedError("This link is invalid");
  }
  return decoded;
}

// --- mfa.service.ts (ported verbatim) ------------------------------------

const MFA_ISSUER = "Redrob HRMS";

export function generateMfaSecret(): string {
  return authenticator.generateSecret();
}

export async function buildMfaEnrollment(
  accountLabel: string,
  secret: string,
): Promise<{ secret: string; qrCodeDataUrl: string }> {
  const uri = authenticator.keyuri(accountLabel, MFA_ISSUER, secret);
  const qrCodeDataUrl = await QRCode.toDataURL(uri);
  return { secret, qrCodeDataUrl };
}

export function verifyMfaCode(code: string, secret: string): boolean {
  try {
    return authenticator.check(code, secret);
  } catch {
    return false;
  }
}

// --- refresh-token.service.ts (ported verbatim, function-shaped) --------

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export async function issueRefreshToken(prisma: PrismaClient, employeeId: string): Promise<string> {
  const raw = randomBytes(48).toString("base64url");
  await prisma.refreshToken.create({
    data: {
      employeeId,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });
  return raw;
}

export async function rotateRefreshToken(
  prisma: PrismaClient,
  rawToken: string,
): Promise<{ employeeId: string; token: string }> {
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
  });
  if (!existing || existing.revokedAt || existing.expiresAt.getTime() < Date.now()) {
    throw new UnauthorizedError("Refresh token is invalid or expired");
  }

  await prisma.refreshToken.update({
    where: { id: existing.id },
    data: { revokedAt: new Date() },
  });
  const token = await issueRefreshToken(prisma, existing.employeeId);
  return { employeeId: existing.employeeId, token };
}

export async function revokeRefreshToken(prisma: PrismaClient, rawToken: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllRefreshTokensForEmployee(
  prisma: PrismaClient,
  employeeId: string,
): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { employeeId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// --- trusted-device.service.ts (ported verbatim, function-shaped) -------

const TRUSTED_DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function issueTrustedDevice(prisma: PrismaClient, employeeId: string): Promise<string> {
  const raw = randomBytes(48).toString("base64url");
  await prisma.trustedDevice.create({
    data: {
      employeeId,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + TRUSTED_DEVICE_TTL_MS),
    },
  });
  return raw;
}

export async function isTrustedDevice(
  prisma: PrismaClient,
  employeeId: string,
  rawToken: string,
): Promise<boolean> {
  const existing = await prisma.trustedDevice.findUnique({
    where: { tokenHash: hashToken(rawToken) },
  });
  if (!existing || existing.employeeId !== employeeId || existing.expiresAt.getTime() < Date.now()) {
    return false;
  }
  await prisma.trustedDevice.update({
    where: { id: existing.id },
    data: { lastUsedAt: new Date() },
  });
  return true;
}

// --- shared session-issuing helper (auth.controller.ts's issueSession) --

export async function issueSession(prisma: PrismaClient, employee: { id: string; role: Role }) {
  const accessToken = signAccessToken({ sub: employee.id, role: employee.role });
  const refreshToken = await issueRefreshToken(prisma, employee.id);
  return { accessToken, refreshToken };
}

export function toUserView(employee: {
  id: string;
  firstName: string;
  lastName: string;
  role: Role;
}) {
  return {
    id: employee.id,
    name: `${employee.firstName} ${employee.lastName}`,
    role: employee.role,
  };
}
