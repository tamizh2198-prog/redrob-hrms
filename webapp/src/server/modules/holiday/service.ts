import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { notify } from "../../lib/notify";
import { BadRequestError, NotFoundError } from "../../lib/errors";
import type { CreateHolidayCalendarDto } from "./dto";

// Selections lock this many days before the holiday itself (Section 7.5
// Business Rules: "locked after a configurable cut-off date").
const SELECTION_CUTOFF_DAYS = 7;

export async function createCalendar(prisma: PrismaClient, dto: CreateHolidayCalendarDto) {
  const rows: Prisma.HolidayCreateManyInput[] = dto.holidays.map((h) => ({
    locationId: dto.locationId,
    year: dto.year,
    date: new Date(h.date),
    name: h.name,
    isOptional: h.isOptional ?? false,
  }));

  try {
    await prisma.holiday.createMany({ data: rows });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Business Rule: a date cannot be both a working day and a holiday
      // for the same location/calendar — enforced as a uniqueness clash.
      throw new BadRequestError("One or more dates already exist on this location's calendar");
    }
    throw err;
  }

  const created = await prisma.holiday.findMany({
    where: { locationId: dto.locationId, year: dto.year },
    orderBy: { date: "asc" },
  });

  const employees = await prisma.employee.findMany({ where: { locationId: dto.locationId }, select: { id: true } });
  await Promise.all(
    employees.map((e) =>
      notify(prisma, {
        recipientId: e.id,
        template: "holiday-calendar.published",
        body: `The ${dto.year} holiday calendar for your location has been published.`,
        data: { locationId: dto.locationId, year: dto.year },
      }),
    ),
  );

  return created;
}

export function listCalendar(prisma: PrismaClient, locationId: string, year: number) {
  return prisma.holiday.findMany({ where: { locationId, year }, orderBy: { date: "asc" } });
}

export async function selectOptionalHoliday(prisma: PrismaClient, employeeId: string, holidayId: string) {
  const [employee, holiday] = await Promise.all([
    prisma.employee.findUnique({ where: { id: employeeId } }),
    prisma.holiday.findUnique({ where: { id: holidayId } }),
  ]);
  if (!employee) throw new NotFoundError("Employee not found");
  if (!holiday) throw new NotFoundError("Holiday not found");

  if (!holiday.isOptional) {
    throw new BadRequestError("This holiday is not an optional holiday");
  }
  if (holiday.locationId !== employee.locationId) {
    throw new BadRequestError("This holiday is not on the employee's location calendar");
  }

  const cutoff = new Date(holiday.date);
  cutoff.setUTCDate(cutoff.getUTCDate() - SELECTION_CUTOFF_DAYS);
  if (new Date() > cutoff) {
    throw new BadRequestError("The selection window for this optional holiday has closed");
  }

  return prisma.optionalHolidaySelection.upsert({
    where: { employeeId_holidayId: { employeeId, holidayId } },
    update: {},
    create: { employeeId, holidayId },
  });
}

export function listSelections(prisma: PrismaClient, employeeId: string) {
  return prisma.optionalHolidaySelection.findMany({ where: { employeeId }, include: { holiday: true } });
}
