import { AuditService } from './audit.service';
import { PrismaService } from '../../shared/database/prisma.service';
import { DefaultCompanyService } from '../../shared/database/default-company.service';

function createMockPrisma() {
  return {
    auditLog: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };
}

function createMockDefaultCompany() {
  return { getOrCreate: jest.fn().mockResolvedValue('company-1') };
}

describe('AuditService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let defaultCompany: ReturnType<typeof createMockDefaultCompany>;
  let service: AuditService;

  beforeEach(() => {
    prisma = createMockPrisma();
    defaultCompany = createMockDefaultCompany();
    service = new AuditService(
      prisma as unknown as PrismaService,
      defaultCompany as unknown as DefaultCompanyService,
    );
  });

  describe('Section 7.18 Acceptance Criteria: append-only writer', () => {
    it('persists every field the interceptor supplies', async () => {
      await service.record({
        actorId: 'emp-1',
        actorRole: 'HR_ADMIN',
        method: 'POST',
        path: '/api/v1/helpdesk/tickets',
        module: 'helpdesk',
        statusCode: 201,
        requestBody: { subject: 'test' },
        responseBody: { id: 'ticket-1' },
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            companyId: 'company-1',
            actorId: 'emp-1',
            module: 'helpdesk',
            statusCode: 201,
          }),
        }),
      );
    });
  });

  describe('listAuditLogs filters', () => {
    it('filters by module, actor, and date range together', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(0);

      await service.listAuditLogs({
        module: 'settings',
        actorId: 'emp-1',
        dateFrom: '2026-01-01',
        dateTo: '2026-01-31',
      });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            module: 'settings',
            actorId: 'emp-1',
            createdAt: { gte: new Date('2026-01-01'), lte: new Date('2026-01-31') },
          },
        }),
      );
    });

    it('returns an unfiltered where clause when no filters are supplied', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(0);

      await service.listAuditLogs({});

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });
  });

  describe('exportAuditLogs', () => {
    it('applies the same filters as listAuditLogs but caps rows instead of paginating', async () => {
      prisma.auditLog.findMany.mockResolvedValue([{ id: 'log-1' }]);

      const result = await service.exportAuditLogs({ module: 'audit' });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { module: 'audit' }, take: 5000 }),
      );
      expect(result.total).toBe(1);
    });
  });
});
