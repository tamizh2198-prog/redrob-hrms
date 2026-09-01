import type { PrismaClient } from "@prisma/client";
import * as helpdeskService from "./service";

function createMockPrisma() {
  return {
    ticket: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    ticketMessage: { create: jest.fn() },
    ticketSlaPolicy: { findUnique: jest.fn(), upsert: jest.fn(), findMany: jest.fn() },
    faqEntry: { findMany: jest.fn(), create: jest.fn() },
    employee: { findUnique: jest.fn() },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
}

jest.mock("../../lib/notify");
jest.mock("../../lib/default-company", () => ({ getOrCreateDefaultCompanyId: jest.fn().mockResolvedValue("company-1") }));

describe("helpdesk service", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let db: PrismaClient;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = createMockPrisma();
    db = prisma as unknown as PrismaClient;
  });

  describe("Workflow: raising a ticket auto-routes it to the category queue", () => {
    it("assigns the category/priority SLA policy agent and due date when one is configured", async () => {
      prisma.ticketSlaPolicy.findUnique.mockResolvedValue({ id: "policy-1", slaHours: 4, agentId: "agent-1" });
      prisma.ticket.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: "ticket-1", ...data }));

      const result = await helpdeskService.createTicket(
        db,
        { category: "IT_SUPPORT", priority: "URGENT", subject: "Laptop broken", description: "..." } as never,
        "emp-1",
      );

      expect(result.assignedAgentId).toBe("agent-1");
      const { notify } = jest.requireMock("../../lib/notify");
      expect(notify).toHaveBeenCalledWith(db, expect.objectContaining({ recipientId: "agent-1", template: "helpdesk.ticket-created" }));
    });

    it("falls back to the built-in default SLA and an unassigned queue when no policy is configured", async () => {
      prisma.ticketSlaPolicy.findUnique.mockResolvedValue(null);
      prisma.ticket.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: "ticket-1", ...data }));

      const result = await helpdeskService.createTicket(
        db,
        { category: "GENERAL_HR", subject: "Question", description: "..." } as never,
        "emp-1",
      );

      expect(result.assignedAgentId).toBeUndefined();
      const { notify } = jest.requireMock("../../lib/notify");
      expect(notify).toHaveBeenCalledWith(db, expect.objectContaining({ recipientId: "hr-admin" }));
    });
  });

  describe("Access Control: an Employee/Manager may only see their own tickets", () => {
    it("forces the employeeId filter for a non-privileged actor even if other filters are requested", async () => {
      prisma.ticket.findMany.mockResolvedValue([]);
      prisma.ticket.count.mockResolvedValue(0);

      await helpdeskService.listTickets(db, { assignedAgentId: "someone-else" } as never, "emp-1", "EMPLOYEE" as never);

      expect(prisma.ticket.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { employeeId: "emp-1" } }));
    });

    it("lets HR Admin apply arbitrary filters across all tickets", async () => {
      prisma.ticket.findMany.mockResolvedValue([]);
      prisma.ticket.count.mockResolvedValue(0);

      await helpdeskService.listTickets(db, { status: "OPEN" } as never, "hr-1", "HR_ADMIN" as never);

      expect(prisma.ticket.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "OPEN" } }));
    });

    it("lets HR Associate apply arbitrary filters too, like HR Admin", async () => {
      prisma.ticket.findMany.mockResolvedValue([]);
      prisma.ticket.count.mockResolvedValue(0);

      await helpdeskService.listTickets(db, { status: "OPEN" } as never, "ha-1", "HR_ASSOCIATE" as never);

      expect(prisma.ticket.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "OPEN" } }));
    });

    it("rejects a stranger viewing a ticket that is not theirs and not assigned to them", async () => {
      prisma.ticket.findUnique.mockResolvedValue({ id: "ticket-1", employeeId: "emp-1", assignedAgentId: null, messages: [] });

      await expect(helpdeskService.getTicket(db, "ticket-1", "someone-else", "EMPLOYEE" as never)).rejects.toThrow(
        "Not authorized to view this ticket",
      );
    });

    it("allows the assigned agent to view the ticket even though they did not raise it", async () => {
      prisma.ticket.findUnique.mockResolvedValue({ id: "ticket-1", employeeId: "emp-1", assignedAgentId: "agent-1", messages: [] });

      await expect(helpdeskService.getTicket(db, "ticket-1", "agent-1", "HR_ADMIN" as never)).resolves.toBeDefined();
    });
  });

  describe("Key Feature: internal-only agent notes are never surfaced to the employee", () => {
    it("filters internal notes out for the ticket owner", async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: "ticket-1",
        employeeId: "emp-1",
        assignedAgentId: "agent-1",
        messages: [
          { id: "m1", isInternalNote: false, body: "visible" },
          { id: "m2", isInternalNote: true, body: "internal" },
        ],
      });

      const result = await helpdeskService.getTicket(db, "ticket-1", "emp-1", "EMPLOYEE" as never);
      expect(result.messages).toEqual([{ id: "m1", isInternalNote: false, body: "visible" }]);
    });

    it("shows internal notes to the assigned agent", async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: "ticket-1",
        employeeId: "emp-1",
        assignedAgentId: "agent-1",
        messages: [
          { id: "m1", isInternalNote: false, body: "visible" },
          { id: "m2", isInternalNote: true, body: "internal" },
        ],
      });

      const result = await helpdeskService.getTicket(db, "ticket-1", "agent-1", "HR_ADMIN" as never);
      expect(result.messages).toHaveLength(2);
    });

    it("never honors an employee-supplied isInternalNote flag on their own message", async () => {
      prisma.ticket.findUnique.mockResolvedValue({ id: "ticket-1", employeeId: "emp-1", assignedAgentId: null });
      prisma.ticketMessage.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: "m1", ...data }));

      const result = await helpdeskService.addMessage(
        db,
        "ticket-1",
        { body: "trying to sneak an internal note", isInternalNote: true } as never,
        "emp-1",
        "EMPLOYEE" as never,
      );

      expect(result.isInternalNote).toBe(false);
    });

    it("allows the assigned agent to mark their own message as an internal note", async () => {
      prisma.ticket.findUnique.mockResolvedValue({ id: "ticket-1", employeeId: "emp-1", assignedAgentId: "agent-1" });
      prisma.ticketMessage.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: "m1", ...data }));

      const result = await helpdeskService.addMessage(
        db,
        "ticket-1",
        { body: "internal only", isInternalNote: true } as never,
        "agent-1",
        "HR_ADMIN" as never,
      );

      expect(result.isInternalNote).toBe(true);
    });
  });

  describe('Workflow: assignment ("Agent picks up")', () => {
    it("rejects assigning to an employee who is not part of the agent pool", async () => {
      prisma.ticket.findUnique.mockResolvedValue({ id: "ticket-1", status: "OPEN" });
      prisma.employee.findUnique.mockResolvedValue({ id: "emp-2", role: "EMPLOYEE" });

      await expect(helpdeskService.assignTicket(db, "ticket-1", { agentId: "emp-2" } as never, "hr-1")).rejects.toThrow(
        "can only be assigned to an HR Admin/Super Admin",
      );
    });

    it("rejects assigning an already-resolved ticket", async () => {
      prisma.ticket.findUnique.mockResolvedValue({ id: "ticket-1", status: "RESOLVED" });

      await expect(helpdeskService.assignTicket(db, "ticket-1", { agentId: "agent-1" } as never, "hr-1")).rejects.toThrow(
        "cannot be assigned",
      );
    });

    it("auto-transitions an OPEN ticket to IN_PROGRESS on assignment", async () => {
      prisma.ticket.findUnique.mockResolvedValue({ id: "ticket-1", status: "OPEN" });
      prisma.employee.findUnique.mockResolvedValue({ id: "agent-1", role: "HR_ADMIN" });
      prisma.ticket.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: "ticket-1", ...data }));

      const result = await helpdeskService.assignTicket(db, "ticket-1", { agentId: "agent-1" } as never, "hr-1");
      expect(result.status).toBe("IN_PROGRESS");
    });
  });

  describe("Workflow: status transitions are validated against the fixed pipeline", () => {
    it("rejects skipping straight from OPEN to RESOLVED", async () => {
      prisma.ticket.findUnique.mockResolvedValue({ id: "ticket-1", status: "OPEN", employeeId: "emp-1" });

      await expect(
        helpdeskService.updateStatus(db, "ticket-1", { status: "RESOLVED" } as never, "agent-1", "HR_ADMIN" as never),
      ).rejects.toThrow("Invalid status transition");
    });

    it("rejects an unrelated employee picking up a ticket", async () => {
      prisma.ticket.findUnique.mockResolvedValue({ id: "ticket-1", status: "OPEN", employeeId: "emp-1", assignedAgentId: null });

      await expect(
        helpdeskService.updateStatus(db, "ticket-1", { status: "IN_PROGRESS" } as never, "random-emp", "EMPLOYEE" as never),
      ).rejects.toThrow("Only an assigned agent or HR Admin can pick up");
    });
  });

  describe("Business Rule: a ticket cannot be closed without a resolution note", () => {
    it("rejects closing without a resolution note and none on file", async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: "ticket-1",
        status: "RESOLVED",
        employeeId: "emp-1",
        assignedAgentId: "agent-1",
        resolutionNote: null,
      });

      await expect(
        helpdeskService.updateStatus(db, "ticket-1", { status: "CLOSED" } as never, "emp-1", "EMPLOYEE" as never),
      ).rejects.toThrow("cannot be closed without a resolution note");
    });

    it("allows closing when a resolution note is supplied in the same request", async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: "ticket-1",
        status: "RESOLVED",
        employeeId: "emp-1",
        assignedAgentId: "agent-1",
        resolutionNote: null,
      });
      prisma.ticket.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: "ticket-1", ...data }));

      const result = await helpdeskService.updateStatus(
        db,
        "ticket-1",
        { status: "CLOSED", resolutionNote: "Fixed it", csatRating: 5 } as never,
        "emp-1",
        "EMPLOYEE" as never,
      );
      expect(result.resolutionNote).toBe("Fixed it");
      expect(result.csatRating).toBe(5);
    });

    it("allows closing when a resolution note is already on file from an earlier RESOLVED step", async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: "ticket-1",
        status: "RESOLVED",
        employeeId: "emp-1",
        assignedAgentId: "agent-1",
        resolutionNote: "Already resolved earlier",
      });
      prisma.ticket.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: "ticket-1", ...data }));

      await expect(
        helpdeskService.updateStatus(db, "ticket-1", { status: "CLOSED" } as never, "emp-1", "EMPLOYEE" as never),
      ).resolves.toBeDefined();
    });
  });

  describe("Business Rule: employees can reopen a closed ticket only within the configured window", () => {
    it("allows HR Admin to reopen on the employee's behalf as a privileged override", async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: "ticket-1",
        status: "CLOSED",
        employeeId: "emp-1",
        assignedAgentId: null,
        closedAt: new Date(),
      });
      prisma.ticket.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: "ticket-1", ...data }));

      const result = await helpdeskService.updateStatus(db, "ticket-1", { status: "REOPENED" } as never, "agent-1", "HR_ADMIN" as never);
      expect(result.status).toBe("REOPENED");
    });

    it("rejects a non-owner, non-privileged actor reopening the ticket", async () => {
      prisma.ticket.findUnique.mockResolvedValue({ id: "ticket-1", status: "CLOSED", employeeId: "emp-1", closedAt: new Date() });

      await expect(
        helpdeskService.updateStatus(db, "ticket-1", { status: "REOPENED" } as never, "random-emp", "EMPLOYEE" as never),
      ).rejects.toThrow("Only the employee who raised this ticket can reopen it");
    });

    it("rejects reopening after the window has elapsed", async () => {
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      prisma.ticket.findUnique.mockResolvedValue({ id: "ticket-1", status: "CLOSED", employeeId: "emp-1", closedAt: eightDaysAgo });

      await expect(
        helpdeskService.updateStatus(db, "ticket-1", { status: "REOPENED" } as never, "emp-1", "EMPLOYEE" as never),
      ).rejects.toThrow("can only be reopened within");
    });

    it("allows reopening within the window", async () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      prisma.ticket.findUnique.mockResolvedValue({
        id: "ticket-1",
        status: "CLOSED",
        employeeId: "emp-1",
        assignedAgentId: "agent-1",
        closedAt: twoDaysAgo,
      });
      prisma.ticket.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: "ticket-1", ...data }));

      const result = await helpdeskService.updateStatus(db, "ticket-1", { status: "REOPENED" } as never, "emp-1", "EMPLOYEE" as never);
      expect(result.status).toBe("REOPENED");
      const { notify } = jest.requireMock("../../lib/notify");
      expect(notify).toHaveBeenCalledWith(db, expect.objectContaining({ recipientId: "agent-1", template: "helpdesk.ticket-reopened" }));
    });
  });

  describe("Business Rule: SLA breach automatically escalates", () => {
    it("marks a ticket breached once its due date has passed", async () => {
      const pastDue = new Date(Date.now() - 60 * 60 * 1000);
      const createdAt = new Date(Date.now() - 10 * 60 * 60 * 1000);
      prisma.ticket.findMany.mockResolvedValue([
        {
          id: "ticket-1",
          category: "IT_SUPPORT",
          priority: "HIGH",
          createdAt,
          slaDueAt: pastDue,
          slaWarningNotifiedAt: null,
          slaBreachedAt: null,
          assignedAgentId: "agent-1",
        },
      ]);
      prisma.ticketSlaPolicy.findUnique.mockResolvedValue(null);
      prisma.ticket.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: "ticket-1", ...data }));

      const { breaches, warnings } = await helpdeskService.runSlaSweep(db);
      expect(breaches).toHaveLength(1);
      expect(warnings).toHaveLength(0);
      expect(prisma.ticket.update).toHaveBeenCalledWith(expect.objectContaining({ data: { slaBreachedAt: expect.any(Date) } }));
    });

    it("does not re-flag a ticket that was already marked breached", async () => {
      const pastDue = new Date(Date.now() - 60 * 60 * 1000);
      const createdAt = new Date(Date.now() - 10 * 60 * 60 * 1000);
      prisma.ticket.findMany.mockResolvedValue([
        {
          id: "ticket-1",
          category: "IT_SUPPORT",
          priority: "HIGH",
          createdAt,
          slaDueAt: pastDue,
          slaWarningNotifiedAt: createdAt,
          slaBreachedAt: new Date(),
          assignedAgentId: "agent-1",
        },
      ]);
      prisma.ticketSlaPolicy.findUnique.mockResolvedValue(null);

      const { breaches, warnings } = await helpdeskService.runSlaSweep(db);
      expect(breaches).toHaveLength(0);
      expect(warnings).toHaveLength(0);
      expect(prisma.ticket.update).not.toHaveBeenCalled();
    });

    it("warns once 80% of the SLA window has elapsed but not yet breached", async () => {
      const createdAt = new Date(Date.now() - 9 * 60 * 60 * 1000); // 9h ago
      const slaDueAt = new Date(createdAt.getTime() + 10 * 60 * 60 * 1000); // 10h window -> 90% elapsed
      prisma.ticket.findMany.mockResolvedValue([
        {
          id: "ticket-1",
          category: "IT_SUPPORT",
          priority: "HIGH",
          createdAt,
          slaDueAt,
          slaWarningNotifiedAt: null,
          slaBreachedAt: null,
          assignedAgentId: "agent-1",
        },
      ]);
      prisma.ticketSlaPolicy.findUnique.mockResolvedValue(null);
      prisma.ticket.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: "ticket-1", ...data }));

      const { breaches, warnings } = await helpdeskService.runSlaSweep(db);
      expect(breaches).toHaveLength(0);
      expect(warnings).toHaveLength(1);
    });
  });
});
