import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../database/prisma.service';

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

// Section 11 Application Security Controls: "refresh-token rotation on
// use." Only the SHA-256 hash of the token is ever persisted — same
// principle as EmployeeInvitation's tokenHash — so a database leak alone
// can't be replayed as a live session. Each successful refresh revokes the
// token used and issues a new one; presenting an already-revoked token is
// a signal of token theft/reuse, not just an expired session.
@Injectable()
export class RefreshTokenService {
  constructor(private readonly prisma: PrismaService) {}

  async issue(employeeId: string): Promise<string> {
    const raw = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        employeeId,
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });
    return raw;
  }

  async rotate(
    rawToken: string,
  ): Promise<{ employeeId: string; token: string }> {
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });
    if (
      !existing ||
      existing.revokedAt ||
      existing.expiresAt.getTime() < Date.now()
    ) {
      throw new UnauthorizedException('Refresh token is invalid or expired');
    }

    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });
    const token = await this.issue(existing.employeeId);
    return { employeeId: existing.employeeId, token };
  }

  async revoke(rawToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // Used on password reset / MFA reset — invalidates every other session
  // for this employee so a stolen credential can't keep a session alive
  // past the point the legitimate owner takes it back.
  async revokeAllForEmployee(employeeId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { employeeId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
