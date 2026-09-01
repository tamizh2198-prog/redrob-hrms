import type { PrismaClient } from "@prisma/client";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";
import { AssistantUnavailableError } from "../../lib/assistant-llm";
import * as assistantService from "./service";

jest.mock("../../lib/assistant-llm", () => {
  const actual = jest.requireActual("../../lib/assistant-llm");
  return { ...actual, complete: jest.fn() };
});
jest.mock("../holiday/service", () => ({ listCalendar: jest.fn() }));
jest.mock("../helpdesk/service", () => ({ createTicket: jest.fn() }));

const llm = jest.requireMock("../../lib/assistant-llm") as { complete: jest.Mock };
const helpdeskService = jest.requireMock("../helpdesk/service") as { createTicket: jest.Mock };

function createMockPrisma() {
  return {
    employee: { findUnique: jest.fn(), findMany: jest.fn() },
    policyDocument: { findMany: jest.fn().mockResolvedValue([]) },
    assistantConversation: { findUnique: jest.fn(), create: jest.fn() },
    assistantMessage: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
    review: { findMany: jest.fn() },
  };
}

describe("assistant service", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let db: PrismaClient;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = createMockPrisma();
    db = prisma as unknown as PrismaClient;

    prisma.assistantConversation.create.mockResolvedValue({ id: "conv-1", employeeId: "emp-1" });
    prisma.assistantMessage.create.mockImplementation((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: "msg-1", ...args.data }),
    );
    prisma.employee.findUnique.mockResolvedValue({ id: "emp-1", companyId: "co-1" });
  });

  describe("AC: assistant never returns data outside RBAC scope", () => {
    it("creates a fresh conversation owned by the actor when none is supplied", async () => {
      llm.complete.mockResolvedValue({ text: "hi", toolCall: undefined });
      await assistantService.sendMessage(db, "emp-1", "EMPLOYEE" as never, { message: "hello" } as never);
      expect(prisma.assistantConversation.create).toHaveBeenCalledWith({ data: { employeeId: "emp-1" } });
    });

    it("rejects sending into a conversation owned by a different employee", async () => {
      prisma.assistantConversation.findUnique.mockResolvedValue({ id: "conv-2", employeeId: "someone-else" });
      await expect(
        assistantService.sendMessage(db, "emp-1", "EMPLOYEE" as never, { conversationId: "conv-2", message: "hi" } as never),
      ).rejects.toThrow(ForbiddenError);
    });

    it("rejects confirming an action on a conversation that is not the caller's own", async () => {
      prisma.assistantMessage.findUnique.mockResolvedValue({
        id: "msg-1",
        proposedAction: { type: "raise_ticket", input: {} },
        actionTaken: null,
        conversation: { employeeId: "someone-else" },
      });
      await expect(assistantService.confirmAction(db, "emp-1", { messageId: "msg-1" })).rejects.toThrow(ForbiddenError);
    });

    it("only offers manager-only tools (pending_reviews) when role is MANAGER", async () => {
      llm.complete.mockResolvedValue({ text: "hi", toolCall: undefined });
      await assistantService.sendMessage(db, "emp-1", "EMPLOYEE" as never, { message: "anything pending for my team?" } as never);
      const employeeTools = llm.complete.mock.calls[0][2].map((t: { name: string }) => t.name);
      expect(employeeTools).not.toContain("pending_reviews");

      llm.complete.mockClear();
      await assistantService.sendMessage(db, "mgr-1", "MANAGER" as never, { message: "anything pending for my team?" } as never);
      const managerTools = llm.complete.mock.calls[0][2].map((t: { name: string }) => t.name);
      expect(managerTools).toContain("pending_reviews");
    });

    it("rejects a non-manager attempting to invoke the manager-only pending_reviews tool", async () => {
      llm.complete.mockResolvedValue({ text: "", toolCall: { name: "pending_reviews", input: {} } });
      await expect(
        assistantService.sendMessage(db, "emp-1", "EMPLOYEE" as never, { message: "anything pending for my team?" } as never),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe("AC: never executes a write action without explicit confirmation", () => {
    it("drafts raise_ticket as a proposedAction instead of calling helpdesk createTicket", async () => {
      llm.complete.mockResolvedValue({
        text: "",
        toolCall: { name: "raise_ticket", input: { category: "IT_SUPPORT", subject: "Laptop issue", description: "My laptop will not boot." } },
      });

      await assistantService.sendMessage(db, "emp-1", "EMPLOYEE" as never, { message: "raise a ticket for my laptop" } as never);

      expect(helpdeskService.createTicket).not.toHaveBeenCalled();
      const createCall = prisma.assistantMessage.create.mock.calls.find((c) => c[0].data.role === "ASSISTANT");
      expect(createCall[0].data.proposedAction).toEqual({
        type: "raise_ticket",
        input: { category: "IT_SUPPORT", subject: "Laptop issue", description: "My laptop will not boot." },
      });
    });

    it("confirmAction executes the drafted raise_ticket through helpdesk createTicket, tagged with the real actor", async () => {
      prisma.assistantMessage.findUnique.mockResolvedValue({
        id: "msg-1",
        proposedAction: { type: "raise_ticket", input: { category: "IT_SUPPORT", subject: "Laptop issue", description: "My laptop will not boot." } },
        actionTaken: null,
        conversation: { employeeId: "emp-1" },
      });
      helpdeskService.createTicket.mockResolvedValue({ id: "ticket-1", status: "OPEN" });
      prisma.assistantMessage.update.mockResolvedValue({ id: "msg-1" });

      await assistantService.confirmAction(db, "emp-1", { messageId: "msg-1" });

      expect(helpdeskService.createTicket).toHaveBeenCalledWith(
        db,
        { category: "IT_SUPPORT", subject: "Laptop issue", description: "My laptop will not boot." },
        "emp-1",
      );
      const updateData = prisma.assistantMessage.update.mock.calls[0][0].data;
      expect(updateData.actionTaken.initiatedVia).toBe("AI_ASSISTANT");
      expect(updateData.actionTaken.actorId).toBe("emp-1");
    });

    it("rejects confirming a message with no pending action", async () => {
      prisma.assistantMessage.findUnique.mockResolvedValue({ id: "msg-1", proposedAction: null, conversation: { employeeId: "emp-1" } });
      await expect(assistantService.confirmAction(db, "emp-1", { messageId: "msg-1" })).rejects.toThrow(NotFoundError);
    });

    it("rejects double-confirming an action that was already executed", async () => {
      prisma.assistantMessage.findUnique.mockResolvedValue({
        id: "msg-1",
        proposedAction: { type: "raise_ticket", input: {} },
        actionTaken: { type: "raise_ticket" },
        conversation: { employeeId: "emp-1" },
      });
      await expect(assistantService.confirmAction(db, "emp-1", { messageId: "msg-1" })).rejects.toThrow(BadRequestError);
    });
  });

  describe("AC: ungrounded policy questions get an honest refusal, never a fabrication", () => {
    it('passes "no matching policy documents" into the system prompt when nothing is indexed', async () => {
      llm.complete.mockResolvedValue({ text: "I don't have this information.", toolCall: undefined });
      await assistantService.sendMessage(db, "emp-1", "EMPLOYEE" as never, { message: "what is the WFH policy?" } as never);

      const systemPrompt = llm.complete.mock.calls[0][0];
      expect(systemPrompt).toContain("No matching policy documents were found");
    });

    it("grounds the system prompt in an indexed document that matches the query", async () => {
      prisma.policyDocument.findMany.mockResolvedValue([
        { id: "doc-1", title: "Work From Home Policy", content: "Employees may WFH up to 2 days a week." },
      ]);
      llm.complete.mockResolvedValue({ text: "You may WFH 2 days/week.", toolCall: undefined });

      await assistantService.sendMessage(db, "emp-1", "EMPLOYEE" as never, { message: "what is the wfh policy?" } as never);

      const systemPrompt = llm.complete.mock.calls[0][0];
      expect(systemPrompt).toContain("Work From Home Policy");
    });

    it("reports itself as unavailable rather than crashing when the LLM gateway has no API key", async () => {
      llm.complete.mockRejectedValue(new AssistantUnavailableError());
      const result = (await assistantService.sendMessage(db, "emp-1", "EMPLOYEE" as never, { message: "hi" } as never)) as { message: string };
      expect(result.message).toContain("not configured");
    });
  });
});
