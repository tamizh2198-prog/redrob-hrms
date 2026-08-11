import { WorkflowEscalationService } from './workflow-escalation.service';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotificationService } from '../../shared/notifications/notification.service';

function createMockPrisma() {
  return {
    approvalRequest: { findMany: jest.fn(), update: jest.fn() },
    employee: { findMany: jest.fn() },
  };
}
function createMockNotifications() {
  return { send: jest.fn().mockResolvedValue(undefined) };
}

describe('WorkflowEscalationService (Section 7.15)', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let notifications: ReturnType<typeof createMockNotifications>;
  let service: WorkflowEscalationService;

  beforeEach(() => {
    prisma = createMockPrisma();
    notifications = createMockNotifications();
    service = new WorkflowEscalationService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationService,
    );
  });

  it('escalates a step whose SLA has already elapsed, and marks it so it is not re-escalated', async () => {
    prisma.approvalRequest.findMany.mockResolvedValue([
      {
        id: 'req-1',
        currentStep: 0,
        currentStepStartedAt: new Date(Date.now() - 5 * 60 * 60 * 1000), // 5h ago
        workflowDefinition: {
          companyId: 'co-1',
          stepsJson: [
            {
              sequence: 0,
              approverRules: [{ type: 'MANAGER' }],
              requireAll: false,
              slaHours: 2,
            },
          ],
        },
      },
    ]);
    prisma.employee.findMany.mockResolvedValue([{ id: 'hr-1' }]);

    await service.escalateBreachedSteps();

    expect(notifications.send).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 'hr-1',
        template: 'workflow.sla-breach',
      }),
    );
    expect(prisma.approvalRequest.update).toHaveBeenCalledWith({
      where: { id: 'req-1' },
      data: { currentStepEscalatedAt: expect.any(Date) },
    });
  });

  it('does not escalate a step still within its SLA window', async () => {
    prisma.approvalRequest.findMany.mockResolvedValue([
      {
        id: 'req-2',
        currentStep: 0,
        currentStepStartedAt: new Date(),
        workflowDefinition: {
          companyId: 'co-1',
          stepsJson: [
            {
              sequence: 0,
              approverRules: [{ type: 'MANAGER' }],
              requireAll: false,
              slaHours: 24,
            },
          ],
        },
      },
    ]);

    await service.escalateBreachedSteps();

    expect(notifications.send).not.toHaveBeenCalled();
  });

  it('skips steps with no configured SLA', async () => {
    prisma.approvalRequest.findMany.mockResolvedValue([
      {
        id: 'req-3',
        currentStep: 0,
        currentStepStartedAt: new Date(Date.now() - 100 * 60 * 60 * 1000),
        workflowDefinition: {
          companyId: 'co-1',
          stepsJson: [
            {
              sequence: 0,
              approverRules: [{ type: 'MANAGER' }],
              requireAll: false,
            },
          ],
        },
      },
    ]);

    await service.escalateBreachedSteps();

    expect(notifications.send).not.toHaveBeenCalled();
  });
});
