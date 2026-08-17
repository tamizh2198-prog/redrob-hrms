import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotificationService } from '../../shared/notifications/notification.service';
import { CreateHolidayCalendarDto } from './dto/create-holiday-calendar.dto';

// Selections lock this many days before the holiday itself (Section 7.5
// Business Rules: "locked after a configurable cut-off date").
const SELECTION_CUTOFF_DAYS = 7;

@Injectable()
export class HolidayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  async createCalendar(dto: CreateHolidayCalendarDto) {
    const rows: Prisma.HolidayCreateManyInput[] = dto.holidays.map((h) => ({
      locationId: dto.locationId,
      year: dto.year,
      date: new Date(h.date),
      name: h.name,
      isOptional: h.isOptional ?? false,
    }));

    try {
      await this.prisma.holiday.createMany({ data: rows });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Business Rule: a date cannot be both a working day and a holiday
        // for the same location/calendar — enforced as a uniqueness clash.
        throw new BadRequestException(
          "One or more dates already exist on this location's calendar",
        );
      }
      throw err;
    }

    const created = await this.prisma.holiday.findMany({
      where: { locationId: dto.locationId, year: dto.year },
      orderBy: { date: 'asc' },
    });

    const employees = await this.prisma.employee.findMany({
      where: { locationId: dto.locationId },
      select: { id: true },
    });
    await Promise.all(
      employees.map((e) =>
        this.notifications.send({
          recipientId: e.id,
          template: 'holiday-calendar.published',
          body: `The ${dto.year} holiday calendar for your location has been published.`,
          data: { locationId: dto.locationId, year: dto.year },
        }),
      ),
    );

    return created;
  }

  async listCalendar(locationId: string, year: number) {
    return this.prisma.holiday.findMany({
      where: { locationId, year },
      orderBy: { date: 'asc' },
    });
  }

  async selectOptionalHoliday(employeeId: string, holidayId: string) {
    const [employee, holiday] = await Promise.all([
      this.prisma.employee.findUnique({ where: { id: employeeId } }),
      this.prisma.holiday.findUnique({ where: { id: holidayId } }),
    ]);
    if (!employee) throw new NotFoundException('Employee not found');
    if (!holiday) throw new NotFoundException('Holiday not found');

    if (!holiday.isOptional) {
      throw new BadRequestException('This holiday is not an optional holiday');
    }
    if (holiday.locationId !== employee.locationId) {
      throw new BadRequestException(
        "This holiday is not on the employee's location calendar",
      );
    }

    const cutoff = new Date(holiday.date);
    cutoff.setUTCDate(cutoff.getUTCDate() - SELECTION_CUTOFF_DAYS);
    if (new Date() > cutoff) {
      throw new BadRequestException(
        'The selection window for this optional holiday has closed',
      );
    }

    return this.prisma.optionalHolidaySelection.upsert({
      where: { employeeId_holidayId: { employeeId, holidayId } },
      update: {},
      create: { employeeId, holidayId },
    });
  }

  async listSelections(employeeId: string) {
    return this.prisma.optionalHolidaySelection.findMany({
      where: { employeeId },
      include: { holiday: true },
    });
  }
}
