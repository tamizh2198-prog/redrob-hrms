import { createHash } from 'crypto';
import { TrustedDeviceService } from './trusted-device.service';
import { PrismaService } from '../database/prisma.service';

function createMockPrisma() {
  return {
    trustedDevice: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
}

function hashOf(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

describe('TrustedDeviceService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: TrustedDeviceService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new TrustedDeviceService(prisma as unknown as PrismaService);
  });

  it('never persists the raw token, only its hash', async () => {
    const raw = await service.issue('emp-1');

    expect(prisma.trustedDevice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          employeeId: 'emp-1',
          tokenHash: hashOf(raw),
        }),
      }),
    );
    const persisted = prisma.trustedDevice.create.mock.calls[0][0].data;
    expect(persisted.tokenHash).not.toBe(raw);
  });

  it('trusts a token that matches the employee it was issued to and has not expired', async () => {
    prisma.trustedDevice.findUnique.mockResolvedValue({
      id: 'td-1',
      employeeId: 'emp-1',
      expiresAt: new Date(Date.now() + 1000 * 60),
    });

    const trusted = await service.isTrusted('emp-1', 'some-raw-token');

    expect(trusted).toBe(true);
    expect(prisma.trustedDevice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'td-1' },
        data: { lastUsedAt: expect.any(Date) },
      }),
    );
  });

  it('rejects an unknown token', async () => {
    prisma.trustedDevice.findUnique.mockResolvedValue(null);
    expect(await service.isTrusted('emp-1', 'bogus')).toBe(false);
    expect(prisma.trustedDevice.update).not.toHaveBeenCalled();
  });

  it("rejects a token issued to a different employee (can't vouch for another account)", async () => {
    prisma.trustedDevice.findUnique.mockResolvedValue({
      id: 'td-1',
      employeeId: 'someone-else',
      expiresAt: new Date(Date.now() + 1000 * 60),
    });

    expect(await service.isTrusted('emp-1', 'stolen-token')).toBe(false);
    expect(prisma.trustedDevice.update).not.toHaveBeenCalled();
  });

  it('rejects an expired token', async () => {
    prisma.trustedDevice.findUnique.mockResolvedValue({
      id: 'td-1',
      employeeId: 'emp-1',
      expiresAt: new Date(Date.now() - 1000),
    });

    expect(await service.isTrusted('emp-1', 'expired-token')).toBe(false);
    expect(prisma.trustedDevice.update).not.toHaveBeenCalled();
  });
});
