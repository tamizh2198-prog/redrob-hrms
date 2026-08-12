import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ChecklistOwnerRole,
  ChecklistStatus,
  ChecklistTaskStatus,
  Role,
} from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { DefaultCompanyService } from '../../shared/database/default-company.service';
import { NotificationService } from '../../shared/notifications/notification.service';
import { MagicLinkService } from '../../shared/auth/magic-link.service';
import {
  assertCanAccessEmployeeData,
  type EmployeeDataRequester,
} from '../../shared/employee/reporting-hierarchy.util';
import { CreateTemplateDto } from './dto/create-template.dto';

// Section 7.7 Business Rules: "cannot move from 'Preboarding' to 'Active'
// until all mandatory checklist items (documents + statutory forms) are
// marked complete." These field types come from the Key Features list
// ("ID proof, education certificates ... bank details, statutory forms
// (PF nomination, etc.), and background-check consent").
const MANDATORY_PREBOARDING_FIELDS = [
  'ID_PROOF',
  'EDUCATION_CERTIFICATE',
  'BANK_DETAILS',
  'BACKGROUND_CHECK_CONSENT',
];

const PREBOARDING_PORTAL_PURPOSE = 'preboarding-portal';

function isPrivileged(role?: Role): boolean {
  return role === Role.HR_ADMIN || role === Role.SUPER_ADMIN;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly defaultCompany: DefaultCompanyService,
    private readonly notifications: NotificationService,
    private readonly magicLink: MagicLinkService,
  ) {}

  async createTemplate(dto: CreateTemplateDto) {
    const companyId =
      dto.companyId ?? (await this.defaultCompany.getOrCreate());

    // Versioned: superseding a template deactivates the old row but never
    // mutates it, so checklists already pointing at it are unaffected.
    const previous = await this.prisma.onboardingChecklistTemplate.findFirst({
      where: {
        companyId,
        name: dto.name,
        departmentId: dto.departmentId ?? null,
        isActive: true,
      },
    });
    if (previous) {
      await this.prisma.onboardingChecklistTemplate.update({
        where: { id: previous.id },
        data: { isActive: false },
      });
    }

    return this.prisma.onboardingChecklistTemplate.create({
      data: {
        companyId,
        name: dto.name,
        departmentId: dto.departmentId,
        version: (previous?.version ?? 0) + 1,
        taskTemplates: {
          create: dto.tasks.map((t) => ({
            ownerRole: t.ownerRole,
            description: t.description,
            dueOffsetDays: t.dueOffsetDays ?? 0,
          })),
        },
      },
      include: { taskTemplates: true },
    });
  }

  listTemplates() {
    return this.prisma.onboardingChecklistTemplate.findMany({
      where: { isActive: true },
      include: { taskTemplates: true },
    });
  }

  private async findApplicableTemplate(
    companyId: string,
    departmentId: string | null,
  ) {
    if (departmentId) {
      const byDepartment =
        await this.prisma.onboardingChecklistTemplate.findFirst({
          where: { companyId, departmentId, isActive: true },
          include: { taskTemplates: true },
        });
      if (byDepartment) return byDepartment;
    }
    return this.prisma.onboardingChecklistTemplate.findFirst({
      where: { companyId, departmentId: null, isActive: true },
      include: { taskTemplates: true },
    });
  }

  // Section 7.7 Key Features: "auto-assigned on hire, with tasks split
  // across HR, IT, Manager and the new hire." Idempotent — calling this
  // twice for the same employee returns the existing checklist rather than
  // failing on the employeeId unique constraint.
  async initChecklist(employeeId: string) {
    const existing = await this.prisma.onboardingChecklist.findUnique({
      where: { employeeId },
      include: { tasks: true },
    });
    if (existing) return existing;

    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const template = await this.findApplicableTemplate(
      employee.companyId,
      employee.departmentId,
    );
    if (!template) {
      throw new NotFoundException(
        'No onboarding checklist template configured for this department',
      );
    }

    const checklist = await this.prisma.onboardingChecklist.create({
      data: {
        employeeId,
        templateId: template.id,
        status: ChecklistStatus.IN_PROGRESS,
        tasks: {
          create: template.taskTemplates.map((t) => ({
            ownerRole: t.ownerRole,
            description: t.description,
            dueDate: employee.dateOfJoining
              ? addDays(employee.dateOfJoining, t.dueOffsetDays)
              : null,
          })),
        },
      },
      include: { tasks: true },
    });

    await this.notifications.send({
      recipientId: employeeId,
      template: 'onboarding.checklist-created',
      data: { checklistId: checklist.id },
    });

    const ownerNotifyTargets = new Set<string>();
    for (const task of checklist.tasks) {
      if (
        task.ownerRole === ChecklistOwnerRole.MANAGER &&
        employee.reportingManagerId
      ) {
        ownerNotifyTargets.add(employee.reportingManagerId);
      }
      if (
        task.ownerRole === ChecklistOwnerRole.HR ||
        task.ownerRole === ChecklistOwnerRole.IT
      ) {
        // No dedicated IT-admin recipient exists yet — broadcast to the
        // same HR sentinel used elsewhere in the codebase (see
        // EmployeeService/LeaveService) until Section 7.16 adds real
        // per-role distribution lists.
        ownerNotifyTargets.add('hr-admin');
      }
    }
    await Promise.all(
      [...ownerNotifyTargets].map((recipientId) =>
        this.notifications.send({
          recipientId,
          template: 'onboarding.tasks-assigned',
          data: { employeeId, checklistId: checklist.id },
        }),
      ),
    );

    return checklist;
  }

  issuePreboardingLink(employeeId: string): string {
    return this.magicLink.sign(
      { sub: employeeId, purpose: PREBOARDING_PORTAL_PURPOSE },
      '30d',
    );
  }

  async getProgressViaPortal(token: string) {
    const { sub: employeeId } = this.magicLink.verify(
      token,
      PREBOARDING_PORTAL_PURPOSE,
    );
    // The magic link is already scoped to this one employeeId — that's the
    // authorization check for the portal, so this is inherently self-access.
    return this.getProgress(employeeId, { userId: employeeId });
  }

  async getProgress(employeeId: string, requester: EmployeeDataRequester) {
    await assertCanAccessEmployeeData(this.prisma, employeeId, requester);
    const checklist = await this.prisma.onboardingChecklist.findUnique({
      where: { employeeId },
      include: { tasks: true },
    });
    if (!checklist)
      throw new NotFoundException('No onboarding checklist for this employee');

    const total = checklist.tasks.length;
    const completed = checklist.tasks.filter(
      (t) => t.status === ChecklistTaskStatus.COMPLETED,
    ).length;

    return {
      checklist,
      completionPercent:
        total === 0 ? 0 : Math.round((completed / total) * 100),
    };
  }

  private async markChecklistCompleteIfDone(checklistId: string) {
    const remaining = await this.prisma.checklistTask.count({
      where: { checklistId, status: ChecklistTaskStatus.PENDING },
    });
    if (remaining === 0) {
      await this.prisma.onboardingChecklist.update({
        where: { id: checklistId },
        data: { status: ChecklistStatus.COMPLETED },
      });
    }
  }

  async completeTask(taskId: string, actorId: string, actorRole?: Role) {
    const task = await this.prisma.checklistTask.findUnique({
      where: { id: taskId },
      include: { checklist: { include: { employee: true } } },
    });
    if (!task) throw new NotFoundException('Checklist task not found');
    if (task.status === ChecklistTaskStatus.COMPLETED) return task;

    if (task.ownerRole === ChecklistOwnerRole.NEW_HIRE) {
      throw new BadRequestException(
        'New-hire tasks are completed through the preboarding portal, not this endpoint',
      );
    }
    if (
      task.ownerRole === ChecklistOwnerRole.MANAGER &&
      !isPrivileged(actorRole) &&
      (actorRole !== Role.MANAGER ||
        task.checklist.employee.reportingManagerId !== actorId)
    ) {
      throw new BadRequestException(
        'Only the assigned manager can complete this task',
      );
    }
    if (
      (task.ownerRole === ChecklistOwnerRole.HR ||
        task.ownerRole === ChecklistOwnerRole.IT) &&
      !isPrivileged(actorRole)
    ) {
      throw new BadRequestException('Only HR Admin can complete this task');
    }

    const updated = await this.prisma.checklistTask.update({
      where: { id: taskId },
      data: {
        status: ChecklistTaskStatus.COMPLETED,
        completedBy: actorId,
        completedAt: new Date(),
      },
    });

    await this.markChecklistCompleteIfDone(task.checklistId);
    return updated;
  }

  async completeTaskViaPortal(taskId: string, token: string) {
    const { sub: employeeId } = this.magicLink.verify(
      token,
      PREBOARDING_PORTAL_PURPOSE,
    );

    const task = await this.prisma.checklistTask.findUnique({
      where: { id: taskId },
      include: { checklist: true },
    });
    if (!task) throw new NotFoundException('Checklist task not found');
    if (task.checklist.employeeId !== employeeId) {
      throw new BadRequestException(
        'This task does not belong to this preboarding portal',
      );
    }
    if (task.ownerRole !== ChecklistOwnerRole.NEW_HIRE) {
      throw new BadRequestException(
        'This task is not assigned to the new hire',
      );
    }
    if (task.status === ChecklistTaskStatus.COMPLETED) return task;

    const updated = await this.prisma.checklistTask.update({
      where: { id: taskId },
      data: {
        status: ChecklistTaskStatus.COMPLETED,
        completedBy: employeeId,
        completedAt: new Date(),
      },
    });

    await this.markChecklistCompleteIfDone(task.checklistId);
    return updated;
  }

  async submitPreboarding(token: string, fieldType: string, valueRef: string) {
    const { sub: employeeId } = this.magicLink.verify(
      token,
      PREBOARDING_PORTAL_PURPOSE,
    );

    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    if (employee.status !== 'PREBOARDING') {
      throw new BadRequestException(
        'The preboarding portal is closed for this employee',
      );
    }

    // No compound unique key on (employeeId, fieldType) — resubmitting the
    // same field type updates the existing row instead of piling up rows.
    const existing = await this.prisma.preboardingSubmission.findFirst({
      where: { employeeId, fieldType },
    });

    const submission = existing
      ? await this.prisma.preboardingSubmission.update({
          where: { id: existing.id },
          data: {
            valueRef,
            submittedAt: new Date(),
            verifiedBy: null,
            verifiedAt: null,
          },
        })
      : await this.prisma.preboardingSubmission.create({
          data: { employeeId, fieldType, valueRef },
        });

    await this.notifications.send({
      recipientId: 'hr-admin',
      template: 'onboarding.preboarding-submitted',
      data: { employeeId, fieldType },
    });

    return submission;
  }

  private async getMissingMandatoryFields(
    employeeId: string,
  ): Promise<string[]> {
    const submissions = await this.prisma.preboardingSubmission.findMany({
      where: { employeeId, fieldType: { in: MANDATORY_PREBOARDING_FIELDS } },
      select: { fieldType: true },
    });
    const present = new Set(submissions.map((s) => s.fieldType));
    return MANDATORY_PREBOARDING_FIELDS.filter((f) => !present.has(f));
  }

  async activateEmployee(employeeId: string, actorId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    if (employee.status !== 'PREBOARDING') {
      throw new BadRequestException(
        'This employee is not in Preboarding status',
      );
    }

    const missing = await this.getMissingMandatoryFields(employeeId);
    if (missing.length > 0) {
      throw new BadRequestException(
        `Cannot activate: missing mandatory preboarding items: ${missing.join(', ')}`,
      );
    }

    await this.prisma.$transaction([
      this.prisma.employee.update({
        where: { id: employeeId },
        data: { status: 'ACTIVE_PROBATION' },
      }),
      this.prisma.employeeHistory.create({
        data: {
          employeeId,
          fieldChanged: 'status',
          oldValue: 'PREBOARDING',
          newValue: 'ACTIVE_PROBATION',
          changedBy: actorId,
        },
      }),
    ]);

    await this.notifications.send({
      recipientId: employeeId,
      template: 'onboarding.employee-activated',
    });

    return { status: 'ACTIVE_PROBATION' };
  }

  listActiveChecklists() {
    return this.prisma.onboardingChecklist.findMany({
      where: {
        status: {
          in: [ChecklistStatus.NOT_STARTED, ChecklistStatus.IN_PROGRESS],
        },
      },
      include: { employee: true, tasks: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
