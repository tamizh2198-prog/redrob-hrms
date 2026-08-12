import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { RefreshTokenService } from './refresh-token.service';
import { PrismaService } from '../database/prisma.service';

function createMockPrisma() {
  return {
    refreshToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };
}

function hashOf(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

describe('RefreshTokenService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: RefreshTokenService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new RefreshTokenService(prisma as unknown as PrismaService);
  });

  it('never persists the raw token, only its hash', async () => {
    const raw = await service.issue('emp-1');

    expect(prisma.refreshToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          employeeId: 'emp-1',
          tokenHash: hashOf(raw),
        }),
      }),
    );
    const persisted = prisma.refreshToken.create.mock.calls[0][0].data;
    expect(persisted.tokenHash).not.toBe(raw);
  });

  it('rotates a valid token: revokes the old one and issues a new one', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt-1',
      employeeId: 'emp-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 1000 * 60),
    });

    const { employeeId, token } = await service.rotate('some-raw-token');

    expect(employeeId).toBe('emp-1');
    expect(prisma.refreshToken.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'rt-1' },
        data: expect.objectContaining({ revokedAt: expect.any(Date) }),
      }),
    );
    expect(token).toBeTruthy();
    expect(prisma.refreshToken.create).toHaveBeenCalled();
  });

  it('rejects rotating an unknown token', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue(null);
    await expect(service.rotate('bogus')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects rotating an already-revoked token (reuse detection)', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt-1',
      employeeId: 'emp-1',
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 1000 * 60),
    });
    await expect(service.rotate('stolen-token')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects rotating an expired token', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt-1',
      employeeId: 'emp-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(service.rotate('expired-token')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('revokes a single token by its hash', async () => {
    await service.revoke('some-raw-token');
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { tokenHash: hashOf('some-raw-token'), revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('revokes every active token for an employee', async () => {
    await service.revokeAllForEmployee('emp-1');
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { employeeId: 'emp-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
