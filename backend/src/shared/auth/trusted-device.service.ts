import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../database/prisma.service';

const TRUSTED_DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

// Section 11: lets a machine that already completed MFA once skip it on
// later logins, without weakening MFA for any machine that hasn't. Same
// hash-only-storage principle as RefreshTokenService — a database leak
// alone can't be replayed as a trusted device.
@Injectable()
export class TrustedDeviceService {
  constructor(private readonly prisma: PrismaService) {}

  async issue(employeeId: string): Promise<string> {
    const raw = randomBytes(48).toString('base64url');
    await this.prisma.trustedDevice.create({
      data: {
        employeeId,
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + TRUSTED_DEVICE_TTL_MS),
      },
    });
    return raw;
  }

  // True only for a token that belongs to this exact employee and hasn't
  // expired — a token issued to one account can never vouch for another.
  async isTrusted(employeeId: string, rawToken: string): Promise<boolean> {
    const existing = await this.prisma.trustedDevice.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });
    if (
      !existing ||
      existing.employeeId !== employeeId ||
      existing.expiresAt.getTime() < Date.now()
    ) {
      return false;
    }
    await this.prisma.trustedDevice.update({
      where: { id: existing.id },
      data: { lastUsedAt: new Date() },
    });
    return true;
  }
}
