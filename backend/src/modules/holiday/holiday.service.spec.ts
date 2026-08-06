import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { HolidayService } from './holiday.service';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotificationService } from '../../shared/notifications/notification.service';

function createMockPrisma() {
  return {
    holiday: {
      createMany: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    employee: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    optionalHolidaySelection: {
      upsert: jest.fn(),
      findMany: jest.fn(),
    },
  };
}

function createMockNotifications() {
  return { send: jest.fn().mockResolvedValue(undefined) };
}

describe('HolidayService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let notifications: ReturnType<typeof createMockNotifications>;
  let service: HolidayService;

  beforeEach(() => {
    prisma = createMockPrisma();
    notifications = createMockNotifications();
    service = new HolidayService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationService,
    );
  });

  describe('Business Rule: a date cannot be both a working day and a holiday for the same location/calendar', () => {
    it('rejects a duplicate date on the same location calendar', async () => {
      prisma.holiday.createMany.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '6.0.0',
        }),
      );

      await expect(
        service.createCalendar({
          locationId: 'loc-1',
          year: 2026,
          holidays: [{ date: '2026-01-26', name: 'Republic Day' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('publishes a calendar and notifies employees at that location', async () => {
      prisma.holiday.createMany.mockResolvedValue({ count: 1 });
      prisma.holiday.findMany.mockResolvedValue([
        { id: 'h1', date: new Date('2026-01-26'), name: 'Republic Day' },
      ]);
      prisma.employee.findMany.mockResolvedValue([
        { id: 'emp-1' },
        { id: 'emp-2' },
      ]);

      await service.createCalendar({
        locationId: 'loc-1',
        year: 2026,
        holidays: [{ date: '2026-01-26', name: 'Republic Day' }],
      });

      expect(notifications.send).toHaveBeenCalledTimes(2);
      expect(notifications.send).toHaveBeenCalledWith(
        expect.objectContaining({ template: 'holiday-calendar.published' }),
      );
    });
  });

  describe('Business Rule: optional holidays are locked after a cut-off date', () => {
    it('rejects selection after the cut-off', async () => {
      const nearHoliday = new Date();
      nearHoliday.setDate(nearHoliday.getDate() + 1); // only 1 day away, well inside the 7-day cutoff
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        locationId: 'loc-1',
      });
      prisma.holiday.findUnique.mockResolvedValue({
        id: 'hol-1',
        locationId: 'loc-1',
        isOptional: true,
        date: nearHoliday,
      });

      await expect(
        service.selectOptionalHoliday('emp-1', 'hol-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts selection before the cut-off', async () => {
      const farHoliday = new Date();
      farHoliday.setDate(farHoliday.getDate() + 30);
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        locationId: 'loc-1',
      });
      prisma.holiday.findUnique.mockResolvedValue({
        id: 'hol-1',
        locationId: 'loc-1',
        isOptional: true,
        date: farHoliday,
      });
      prisma.optionalHolidaySelection.upsert.mockResolvedValue({ id: 'sel-1' });

      await expect(
        service.selectOptionalHoliday('emp-1', 'hol-1'),
      ).resolves.toBeDefined();
    });

    it('rejects selecting a non-optional holiday', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        locationId: 'loc-1',
      });
      prisma.holiday.findUnique.mockResolvedValue({
        id: 'hol-1',
        locationId: 'loc-1',
        isOptional: false,
        date: new Date(),
      });

      await expect(
        service.selectOptionalHoliday('emp-1', 'hol-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects selecting a holiday outside the employee's location", async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        locationId: 'loc-1',
      });
      prisma.holiday.findUnique.mockResolvedValue({
        id: 'hol-1',
        locationId: 'loc-2',
        isOptional: true,
        date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      await expect(
        service.selectOptionalHoliday('emp-1', 'hol-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
