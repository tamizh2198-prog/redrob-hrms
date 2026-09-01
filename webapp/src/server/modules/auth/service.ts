import { EmployeeStatus, type Role } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import {
  buildMfaEnrollment,
  generateMfaSecret,
  isTrustedDevice,
  issueSession,
  issueTrustedDevice,
  signMagicLink,
  toUserView,
  verifyMagicLink,
  verifyMfaCode,
  verifyPassword,
} from "../../lib/auth";
import { NotFoundError, UnauthorizedError } from "../../lib/errors";
import type { LoginDto, MfaCodeDto } from "./dto";

const MFA_VERIFY_PURPOSE = "mfa-verify";
const MFA_ENROLL_PURPOSE = "mfa-enroll";

// Section 6 Access Control Rule / Section 11: MFA is mandatory for these two
// roles, not optional. A recognized device is the only way to skip this.
const MFA_REQUIRED_ROLES: Role[] = ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"];

function assertNotTerminated(employee: { status: EmployeeStatus }): void {
  if (employee.status === EmployeeStatus.TERMINATED) {
    throw new UnauthorizedError("This account has been deactivated. Contact HR for assistance.");
  }
}

export async function login(prisma: PrismaClient, dto: LoginDto) {
  // Case-insensitive: workEmail is normalized to lowercase on every write,
  // but this also has to tolerate rows saved before that normalization
  // existed — matching case-insensitively here means neither side has to
  // be perfectly consistent for login to work.
  const employee = await prisma.employee.findFirst({
    where: { workEmail: { equals: dto.email.trim(), mode: "insensitive" } },
  });
  if (!employee?.passwordHash) {
    throw new UnauthorizedError("Invalid email or password");
  }

  const passwordMatches = await verifyPassword(dto.password, employee.passwordHash);
  if (!passwordMatches) {
    throw new UnauthorizedError("Invalid email or password");
  }

  assertNotTerminated(employee);

  const isDeviceTrusted =
    !!dto.deviceToken && (await isTrustedDevice(prisma, employee.id, dto.deviceToken));

  if (MFA_REQUIRED_ROLES.includes(employee.role) && !isDeviceTrusted) {
    // mfaEnabled alone isn't proof of a usable enrollment — if the secret is
    // missing (e.g. never completed, or lost), route back through
    // enrollment instead of sending the account to a verify screen it can
    // never pass.
    if (!employee.mfaEnabled || !employee.mfaSecret) {
      const secret = generateMfaSecret();
      await prisma.employee.update({ where: { id: employee.id }, data: { mfaSecret: secret } });
      const enrollment = await buildMfaEnrollment(employee.workEmail ?? employee.employeeCode, secret);
      const mfaToken = signMagicLink({ sub: employee.id, purpose: MFA_ENROLL_PURPOSE }, "10m");
      return { status: "MFA_ENROLL_REQUIRED" as const, mfaToken, ...enrollment };
    }

    const mfaToken = signMagicLink({ sub: employee.id, purpose: MFA_VERIFY_PURPOSE }, "5m");
    return { status: "MFA_REQUIRED" as const, mfaToken };
  }

  const { accessToken, refreshToken } = await issueSession(prisma, employee);
  return { status: "OK" as const, accessToken, refreshToken, user: toUserView(employee) };
}

export async function verifyMfa(prisma: PrismaClient, dto: MfaCodeDto) {
  const { sub: employeeId } = verifyMagicLink(dto.mfaToken, MFA_VERIFY_PURPOSE);
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee || !employee.mfaEnabled || !employee.mfaSecret) {
    throw new UnauthorizedError("MFA is not set up for this account");
  }
  if (!verifyMfaCode(dto.code, employee.mfaSecret)) {
    throw new UnauthorizedError("Invalid MFA code");
  }

  const { accessToken, refreshToken } = await issueSession(prisma, employee);
  const deviceToken = await issueTrustedDevice(prisma, employee.id);
  return { status: "OK" as const, accessToken, refreshToken, deviceToken, user: toUserView(employee) };
}

export async function confirmMfaEnrollment(prisma: PrismaClient, dto: MfaCodeDto) {
  const { sub: employeeId } = verifyMagicLink(dto.mfaToken, MFA_ENROLL_PURPOSE);
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee || !employee.mfaSecret) {
    throw new UnauthorizedError("No MFA enrollment in progress");
  }
  if (!verifyMfaCode(dto.code, employee.mfaSecret)) {
    throw new UnauthorizedError("Invalid MFA code");
  }

  await prisma.employee.update({ where: { id: employee.id }, data: { mfaEnabled: true } });

  const { accessToken, refreshToken } = await issueSession(prisma, employee);
  const deviceToken = await issueTrustedDevice(prisma, employee.id);
  return { status: "OK" as const, accessToken, refreshToken, deviceToken, user: toUserView(employee) };
}

export async function devLogin(prisma: PrismaClient, employeeCode: string) {
  if (process.env.NODE_ENV === "production") {
    throw new NotFoundError();
  }

  const employee = await prisma.employee.findUnique({ where: { employeeCode } });
  if (!employee) {
    throw new NotFoundError("No employee with that employee code");
  }
  assertNotTerminated(employee);

  const { accessToken, refreshToken } = await issueSession(prisma, employee);
  return { accessToken, refreshToken, user: toUserView(employee) };
}
