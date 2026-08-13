import { Role } from '@prisma/client';
import { ProfileCompletionReminderService } from './profile-completion-reminder.service';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotificationService } from '../../shared/notifications/notification.service';

function createMockPrisma() {
  return {
    employee: { findMany: jest.fn() },
  };
}

function createMockNotifications() {
  return { send: jest.fn().mockResolvedValue(undefined) };
}

const ALL_REQUIRED_FILLED = {
  dob: new Date('1990-01-01'),
  gender: 'MALE',
  phone: '9999999999',
  addressLine: '123 Main St',
  city: 'Bengaluru',
  state: 'Karnataka',
  postalCode: '560001',
  pan: 'ABCDE1234F',
  bankAccountNumber: '000111222333',
  emergencyContactName: 'John Doe',
  emergencyContactPhone: '8888888888',
};

function makeEmployee(overrides: Record<string, unknown> = {}) {
  return {
    id: 'emp-1',
    companyId: 'company-1',
    dob: null,
    gender: null,
    phone: null,
    addressLine: null,
    city: null,
    state: null,
    country: null,
    postalCode: null,
    pan: null,
    aadhaar: null,
    bankAccountNumber: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    personalEmail: null,
    ...overrides,
  };
}

describe('ProfileCompletionReminderService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let notifications: ReturnType<typeof createMockNotifications>;
  let service: ProfileCompletionReminderService;

  beforeEach(() => {
    prisma = createMockPrisma();
    notifications = createMockNotifications();
    service = new ProfileCompletionReminderService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationService,
    );
  });

  it('notifies both the employee and every HR Admin when a profile is still incomplete 24h after joining', async () => {
    prisma.employee.findMany
      .mockResolvedValueOnce([makeEmployee()])
      .mockResolvedValueOnce([{ id: 'hr-1' }, { id: 'hr-2' }]);

    await service.remindIncompleteProfiles();

    expect(notifications.send).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 'emp-1',
        template: 'profile-completion.reminder',
      }),
    );
    expect(notifications.send).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 'hr-1',
        template: 'profile-completion.reminder',
        data: { employeeId: 'emp-1' },
      }),
    );
    expect(notifications.send).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: 'hr-2' }),
    );
    expect(notifications.send).toHaveBeenCalledTimes(3);
    expect(prisma.employee.findMany).toHaveBeenNthCalledWith(2, {
      where: { companyId: 'company-1', role: Role.HR_ADMIN },
      select: { id: true },
    });
  });

  it('sends nothing for an employee whose profile is already complete', async () => {
    prisma.employee.findMany.mockResolvedValueOnce([
      makeEmployee(ALL_REQUIRED_FILLED),
    ]);

    await service.remindIncompleteProfiles();

    expect(notifications.send).not.toHaveBeenCalled();
    expect(prisma.employee.findMany).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when no employee falls in the 24h reminder window', async () => {
    prisma.employee.findMany.mockResolvedValueOnce([]);

    await service.remindIncompleteProfiles();

    expect(notifications.send).not.toHaveBeenCalled();
  });
});
