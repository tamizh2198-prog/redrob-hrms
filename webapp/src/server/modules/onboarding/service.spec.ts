import type { PrismaClient } from "@prisma/client";
import * as onboardingService from "./service";
import { verifyMagicLink } from "../../lib/auth";

function createMockPrisma() {
  return {
    onboardingChecklistTemplate: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
    onboardingChecklist: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
    checklistTask: {
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    employee: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    employeeHistory: {
      create: jest.fn(),
    },
    preboardingSubmission: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    probationFeedback: {
      createMany: jest.fn().mockResolvedValue({ count: 3 }),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
}

jest.mock("../../lib/notify");
jest.mock("../../lib/email");
jest.mock("../../lib/default-company", () => ({ getOrCreateDefaultCompanyId: jest.fn() }));
jest.mock("../../lib/auth", () => ({
  signMagicLink: jest.fn().mockReturnValue("signed-token"),
  verifyMagicLink: jest.fn(),
}));

describe("onboarding service", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let db: PrismaClient;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = createMockPrisma();
    db = prisma as unknown as PrismaClient;
    jest.requireMock("../../lib/email").sendEmail.mockResolvedValue({ sent: true });
  });

  describe("Key Feature: checklists are auto-assigned on hire from a role/department template", () => {
    it("returns the existing checklist instead of failing when already initialized", async () => {
      prisma.onboardingChecklist.findUnique.mockResolvedValue({ id: "checklist-1", tasks: [] });

      const result = await onboardingService.initChecklist(db, "emp-1");
      expect(result.id).toBe("checklist-1");
      expect(prisma.employee.findUnique).not.toHaveBeenCalled();
    });

    it("throws when no template is configured for the department", async () => {
      prisma.onboardingChecklist.findUnique.mockResolvedValue(null);
      prisma.employee.findUnique.mockResolvedValue({
        id: "emp-1",
        companyId: "co-1",
        departmentId: "dept-1",
        dateOfJoining: null,
        reportingManagerId: null,
        status: "PREBOARDING",
      });
      prisma.onboardingChecklistTemplate.findFirst.mockResolvedValue(null);

      await expect(onboardingService.initChecklist(db, "emp-1")).rejects.toThrow("No onboarding checklist template");
    });

    it("refuses to start a checklist for an employee who is not in Preboarding status", async () => {
      prisma.onboardingChecklist.findUnique.mockResolvedValue(null);
      prisma.employee.findUnique.mockResolvedValue({
        id: "emp-1",
        companyId: "co-1",
        departmentId: "dept-1",
        status: "INVITED",
      });

      await expect(onboardingService.initChecklist(db, "emp-1")).rejects.toThrow(
        "Onboarding checklists can only be started",
      );
      expect(prisma.onboardingChecklistTemplate.findFirst).not.toHaveBeenCalled();
    });

    it("snapshots the template's tasks onto a new checklist and notifies owners", async () => {
      prisma.onboardingChecklist.findUnique.mockResolvedValue(null);
      prisma.employee.findUnique.mockResolvedValue({
        id: "emp-1",
        companyId: "co-1",
        departmentId: "dept-1",
        dateOfJoining: new Date("2026-09-01"),
        reportingManagerId: "mgr-1",
        status: "PREBOARDING",
      });
      prisma.onboardingChecklistTemplate.findFirst.mockResolvedValueOnce({
        id: "tmpl-1",
        taskTemplates: [
          { ownerRole: "NEW_HIRE", description: "Submit ID proof", dueOffsetDays: 0 },
          { ownerRole: "MANAGER", description: "Welcome new hire", dueOffsetDays: 1 },
        ],
      });
      prisma.onboardingChecklist.create.mockResolvedValue({
        id: "checklist-1",
        tasks: [{ ownerRole: "NEW_HIRE" }, { ownerRole: "MANAGER" }],
      });

      const { notify } = jest.requireMock("../../lib/notify");
      const result = await onboardingService.initChecklist(db, "emp-1");

      expect(result.id).toBe("checklist-1");
      expect(notify).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ recipientId: "emp-1", template: "onboarding.checklist-created" }),
      );
      expect(notify).toHaveBeenCalledWith(db, expect.objectContaining({ recipientId: "mgr-1" }));
    });
  });

  describe("Template library: default flag and explicit template selection", () => {
    it("lets a manually-started checklist use a specific template instead of the auto-resolved default", async () => {
      prisma.onboardingChecklist.findUnique.mockResolvedValue(null);
      prisma.employee.findUnique.mockResolvedValue({
        id: "emp-1",
        companyId: "co-1",
        departmentId: "dept-1",
        dateOfJoining: new Date("2026-09-01"),
        reportingManagerId: "mgr-1",
        status: "PREBOARDING",
      });
      prisma.onboardingChecklistTemplate.findFirst.mockResolvedValueOnce({
        id: "tmpl-sales",
        taskTemplates: [{ ownerRole: "HR", phase: "PRE_BOARDING", description: "x", dueOffsetDays: 0 }],
      });
      prisma.onboardingChecklist.create.mockResolvedValue({ id: "checklist-1", tasks: [{ ownerRole: "HR" }] });

      await onboardingService.initChecklist(db, "emp-1", "tmpl-sales");

      expect(prisma.onboardingChecklistTemplate.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "tmpl-sales", companyId: "co-1", isActive: true } }),
      );
    });

    it("unseats the previous default when creating a new default company-wide template", async () => {
      prisma.onboardingChecklistTemplate.findFirst.mockResolvedValueOnce(null); // no same-name previous version
      prisma.onboardingChecklistTemplate.create.mockResolvedValue({ id: "tmpl-new", taskTemplates: [] });

      await onboardingService.createTemplate(db, {
        companyId: "co-1",
        name: "New Default",
        isDefault: true,
        tasks: [{ ownerRole: "HR", phase: "PRE_BOARDING", description: "x" }],
      } as never);

      expect(prisma.onboardingChecklistTemplate.updateMany).toHaveBeenCalledWith({
        where: { companyId: "co-1", departmentId: null, isDefault: true },
        data: { isDefault: false },
      });
      expect(prisma.onboardingChecklistTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isDefault: true }) }),
      );
    });
  });

  describe("30/60/90-day probation feedback", () => {
    it("creates a pending row for every checkpoint when an employee is activated", async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: "emp-1", status: "PREBOARDING" });
      prisma.preboardingSubmission.findMany.mockResolvedValue([
        { fieldType: "ID_PROOF" },
        { fieldType: "EDUCATION_CERTIFICATE" },
        { fieldType: "BANK_DETAILS" },
        { fieldType: "BACKGROUND_CHECK_CONSENT" },
      ]);

      await onboardingService.activateEmployee(db, "emp-1", "hr-1");

      expect(prisma.probationFeedback.createMany).toHaveBeenCalledWith({
        data: [
          { employeeId: "emp-1", checkpoint: "DAY_30" },
          { employeeId: "emp-1", checkpoint: "DAY_60" },
          { employeeId: "emp-1", checkpoint: "DAY_90" },
        ],
      });
    });

    it("rejects submitting someone else's feedback checkpoint", async () => {
      prisma.probationFeedback.findUnique.mockResolvedValue({
        id: "fb-1",
        employeeId: "emp-1",
        reminderSentAt: new Date(),
        submittedAt: null,
      });

      await expect(
        onboardingService.submitProbationFeedback(db, "fb-1", "emp-2", {
          companyRating: 5,
          workCultureRating: 5,
        } as never),
      ).rejects.toThrow("This feedback checkpoint is not yours");
    });

    it("rejects submitting before the checkpoint's reminder has actually fired", async () => {
      prisma.probationFeedback.findUnique.mockResolvedValue({
        id: "fb-1",
        employeeId: "emp-1",
        reminderSentAt: null,
        submittedAt: null,
      });

      await expect(
        onboardingService.submitProbationFeedback(db, "fb-1", "emp-1", {
          companyRating: 5,
          workCultureRating: 5,
        } as never),
      ).rejects.toThrow("This checkpoint is not due yet");
    });

    it("rejects submitting a checkpoint twice", async () => {
      prisma.probationFeedback.findUnique.mockResolvedValue({
        id: "fb-1",
        employeeId: "emp-1",
        reminderSentAt: new Date(),
        submittedAt: new Date(),
      });

      await expect(
        onboardingService.submitProbationFeedback(db, "fb-1", "emp-1", {
          companyRating: 5,
          workCultureRating: 5,
        } as never),
      ).rejects.toThrow("This checkpoint was already submitted");
    });

    it("records the submission when everything checks out", async () => {
      prisma.probationFeedback.findUnique.mockResolvedValue({
        id: "fb-1",
        employeeId: "emp-1",
        reminderSentAt: new Date(),
        submittedAt: null,
      });
      prisma.probationFeedback.update.mockResolvedValue({ id: "fb-1", companyRating: 4, workCultureRating: 5 });

      const result = await onboardingService.submitProbationFeedback(db, "fb-1", "emp-1", {
        companyRating: 4,
        workCultureRating: 5,
        comments: "Great so far",
      } as never);

      expect(result.companyRating).toBe(4);
      expect(prisma.probationFeedback.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "fb-1" },
          data: expect.objectContaining({ companyRating: 4, workCultureRating: 5, comments: "Great so far" }),
        }),
      );
    });
  });

  describe("Access control: only the right role can complete a checklist task", () => {
    it("rejects completing a new-hire task through the staff endpoint", async () => {
      prisma.checklistTask.findUnique.mockResolvedValue({
        id: "task-1",
        ownerRole: "NEW_HIRE",
        status: "PENDING",
        checklistId: "checklist-1",
      });

      await expect(onboardingService.completeTask(db, "task-1", "actor-1", "HR_ADMIN" as never)).rejects.toThrow(
        "completed through the preboarding portal",
      );
    });

    it("rejects a non-manager completing a manager-owned task", async () => {
      prisma.checklistTask.findUnique.mockResolvedValue({
        id: "task-1",
        ownerRole: "MANAGER",
        status: "PENDING",
        checklistId: "checklist-1",
      });

      await expect(onboardingService.completeTask(db, "task-1", "actor-1", "EMPLOYEE" as never)).rejects.toThrow(
        "Only the assigned manager can complete this task",
      );
    });

    it("rejects a manager who isn't this new hire's assigned manager", async () => {
      prisma.checklistTask.findUnique.mockResolvedValue({
        id: "task-1",
        ownerRole: "MANAGER",
        status: "PENDING",
        checklistId: "checklist-1",
        checklist: { employee: { reportingManagerId: "mgr-assigned" } },
      });

      await expect(onboardingService.completeTask(db, "task-1", "mgr-other", "MANAGER" as never)).rejects.toThrow(
        "Only the assigned manager can complete this task",
      );
    });

    it("allows the actually-assigned manager to complete a manager-owned task", async () => {
      prisma.checklistTask.findUnique.mockResolvedValue({
        id: "task-1",
        ownerRole: "MANAGER",
        status: "PENDING",
        checklistId: "checklist-1",
        checklist: { employee: { reportingManagerId: "mgr-assigned" } },
      });
      prisma.checklistTask.update.mockResolvedValue({ id: "task-1", status: "COMPLETED" });
      prisma.checklistTask.count.mockResolvedValue(1);

      await expect(
        onboardingService.completeTask(db, "task-1", "mgr-assigned", "MANAGER" as never),
      ).resolves.toEqual({ id: "task-1", status: "COMPLETED" });
    });

    it("lets HR Associate complete a manager-owned task on behalf of the manager, like HR Admin", async () => {
      prisma.checklistTask.findUnique.mockResolvedValue({
        id: "task-1",
        ownerRole: "MANAGER",
        status: "PENDING",
        checklistId: "checklist-1",
        checklist: { employee: { reportingManagerId: "mgr-assigned" } },
      });
      prisma.checklistTask.update.mockResolvedValue({ id: "task-1", status: "COMPLETED" });
      prisma.checklistTask.count.mockResolvedValue(1);

      await expect(
        onboardingService.completeTask(db, "task-1", "ha-1", "HR_ASSOCIATE" as never),
      ).resolves.toEqual({ id: "task-1", status: "COMPLETED" });
    });

    it("marks the checklist complete once its last task is done", async () => {
      prisma.checklistTask.findUnique.mockResolvedValue({
        id: "task-1",
        ownerRole: "HR",
        status: "PENDING",
        checklistId: "checklist-1",
      });
      prisma.checklistTask.update.mockResolvedValue({ id: "task-1", status: "COMPLETED" });
      prisma.checklistTask.count.mockResolvedValue(0);

      await onboardingService.completeTask(db, "task-1", "hr-1", "HR_ADMIN" as never);
      expect(prisma.onboardingChecklist.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: "COMPLETED" } }),
      );
    });
  });

  describe("Preboarding portal (magic-link access)", () => {
    it("rejects completing a task that belongs to a different employee's checklist", async () => {
      (verifyMagicLink as jest.Mock).mockReturnValue({ sub: "emp-1" });
      prisma.checklistTask.findUnique.mockResolvedValue({
        id: "task-1",
        ownerRole: "NEW_HIRE",
        status: "PENDING",
        checklist: { employeeId: "emp-2" },
      });

      await expect(onboardingService.completeTaskViaPortal(db, "task-1", "token")).rejects.toThrow(
        "does not belong to this preboarding portal",
      );
    });

    it("rejects submitting preboarding documents once the employee has left Preboarding status", async () => {
      (verifyMagicLink as jest.Mock).mockReturnValue({ sub: "emp-1" });
      prisma.employee.findUnique.mockResolvedValue({ id: "emp-1", status: "ACTIVE_PROBATION" });

      await expect(onboardingService.submitPreboarding(db, "token", "ID_PROOF", "doc-ref-1")).rejects.toThrow(
        "The preboarding portal is closed",
      );
    });

    it("updates an existing submission instead of creating a duplicate row", async () => {
      (verifyMagicLink as jest.Mock).mockReturnValue({ sub: "emp-1" });
      prisma.employee.findUnique.mockResolvedValue({ id: "emp-1", status: "PREBOARDING" });
      prisma.preboardingSubmission.findFirst.mockResolvedValue({ id: "sub-1" });
      prisma.preboardingSubmission.update.mockResolvedValue({ id: "sub-1", valueRef: "new-ref" });

      await onboardingService.submitPreboarding(db, "token", "ID_PROOF", "new-ref");
      expect(prisma.preboardingSubmission.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "sub-1" } }),
      );
      expect(prisma.preboardingSubmission.create).not.toHaveBeenCalled();
    });
  });

  describe("Business Rule: status cannot move from 'Preboarding' to 'Active' until all mandatory items are complete", () => {
    it("rejects activation when mandatory preboarding fields are missing", async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: "emp-1", status: "PREBOARDING" });
      prisma.preboardingSubmission.findMany.mockResolvedValue([{ fieldType: "ID_PROOF" }]);

      await expect(onboardingService.activateEmployee(db, "emp-1", "hr-1")).rejects.toThrow(
        "Cannot activate: missing mandatory",
      );
    });

    it("activates the employee once every mandatory field has been submitted", async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: "emp-1", status: "PREBOARDING" });
      prisma.preboardingSubmission.findMany.mockResolvedValue([
        { fieldType: "ID_PROOF" },
        { fieldType: "EDUCATION_CERTIFICATE" },
        { fieldType: "BANK_DETAILS" },
        { fieldType: "BACKGROUND_CHECK_CONSENT" },
      ]);

      const result = await onboardingService.activateEmployee(db, "emp-1", "hr-1");
      expect(result.status).toBe("ACTIVE_PROBATION");
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it("this task: also closes out the employee's checklist, so it stops appearing in listActiveChecklists() and a second click can't hit 'not in Preboarding status'", async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: "emp-1", status: "PREBOARDING" });
      prisma.preboardingSubmission.findMany.mockResolvedValue([
        { fieldType: "ID_PROOF" },
        { fieldType: "EDUCATION_CERTIFICATE" },
        { fieldType: "BANK_DETAILS" },
        { fieldType: "BACKGROUND_CHECK_CONSENT" },
      ]);

      await onboardingService.activateEmployee(db, "emp-1", "hr-1");

      expect(prisma.onboardingChecklist.updateMany).toHaveBeenCalledWith({
        where: { employeeId: "emp-1", status: { not: "COMPLETED" } },
        data: { status: "COMPLETED" },
      });
    });

    it("rejects re-activating an employee who is already past Preboarding", async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: "emp-1", status: "ACTIVE_PROBATION" });

      await expect(onboardingService.activateEmployee(db, "emp-1", "hr-1")).rejects.toThrow(
        "This employee is not in Preboarding status",
      );
    });
  });

  describe("Active checklists list: no passwordHash leak, missing-document status attached", () => {
    it("scopes the employee include instead of pulling the full row (passwordHash included)", async () => {
      prisma.onboardingChecklist.findMany.mockResolvedValue([]);

      await onboardingService.listActiveChecklists(db);

      expect(prisma.onboardingChecklist.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
          }),
        }),
      );
    });

    it("attaches missingMandatoryFields per checklist", async () => {
      prisma.onboardingChecklist.findMany.mockResolvedValue([
        { id: "checklist-1", employeeId: "emp-1", employee: {}, tasks: [] },
      ]);
      prisma.preboardingSubmission.findMany.mockResolvedValue([{ fieldType: "ID_PROOF" }]);

      const result = await onboardingService.listActiveChecklists(db);

      expect(result[0].missingMandatoryFields).toEqual([
        "EDUCATION_CERTIFICATE",
        "BANK_DETAILS",
        "BACKGROUND_CHECK_CONSENT",
      ]);
    });
  });

  describe("Progress views surface missing-document status", () => {
    it("includes missingMandatoryFields in getProgressViaPortal's response", async () => {
      (verifyMagicLink as jest.Mock).mockReturnValue({ sub: "emp-1" });
      prisma.onboardingChecklist.findUnique.mockResolvedValue({ id: "checklist-1", tasks: [] });
      prisma.preboardingSubmission.findMany.mockResolvedValue([
        { fieldType: "ID_PROOF" },
        { fieldType: "EDUCATION_CERTIFICATE" },
        { fieldType: "BANK_DETAILS" },
        { fieldType: "BACKGROUND_CHECK_CONSENT" },
      ]);

      const result = await onboardingService.getProgressViaPortal(db, "token");
      expect(result.missingMandatoryFields).toEqual([]);
    });
  });

  describe("Resending the preboarding portal link", () => {
    it("rejects an employee who is not in Preboarding status", async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: "emp-1", status: "ACTIVE_PROBATION" });

      await expect(onboardingService.resendPreboardingLink(db, "emp-1")).rejects.toThrow(
        "This employee is not in Preboarding status",
      );
    });

    it("rejects an employee with no email on file", async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: "emp-1",
        status: "PREBOARDING",
        personalEmail: null,
        workEmail: null,
      });

      await expect(onboardingService.resendPreboardingLink(db, "emp-1")).rejects.toThrow(
        "no email on file",
      );
    });

    it("emails the link and reports emailSent when delivery succeeds", async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: "emp-1",
        firstName: "Gaurav",
        status: "PREBOARDING",
        personalEmail: "gaurav@example.com",
        workEmail: null,
      });

      const result = await onboardingService.resendPreboardingLink(db, "emp-1");

      expect(result).toEqual({ emailSent: true, preboardingUrl: undefined });
      expect(jest.requireMock("../../lib/email").sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: "gaurav@example.com" }),
      );
    });

    it("hands back the raw URL when email delivery isn't configured", async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: "emp-1",
        firstName: "Gaurav",
        status: "PREBOARDING",
        personalEmail: "gaurav@example.com",
        workEmail: null,
      });
      jest.requireMock("../../lib/email").sendEmail.mockResolvedValue({ sent: false });

      const result = await onboardingService.resendPreboardingLink(db, "emp-1");

      expect(result.emailSent).toBe(false);
      expect(result.preboardingUrl).toContain("/preboard?token=");
    });
  });
});
