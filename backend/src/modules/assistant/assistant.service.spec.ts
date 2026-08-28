import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { AssistantService } from './assistant.service';
import {
  AssistantLlmGateway,
  AssistantUnavailableError,
} from './assistant-llm.gateway';
import { PrismaService } from '../../shared/database/prisma.service';
import { HolidayService } from '../holiday/holiday.service';
import { HelpdeskService } from '../helpdesk/helpdesk.service';

function createMockPrisma() {
  return {
    employee: { findUnique: jest.fn(), findMany: jest.fn() },
    policyDocument: { findMany: jest.fn().mockResolvedValue([]) },
    assistantConversation: { findUnique: jest.fn(), create: jest.fn() },
    assistantMessage: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    review: { findMany: jest.fn() },
  };
}

function createMockLlm() {
  return { complete: jest.fn() };
}

function createMockHolidayService() {
  return { listCalendar: jest.fn() };
}

function createMockHelpdeskService() {
  return { createTicket: jest.fn() };
}

describe('AssistantService (Section 7.14)', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let llm: ReturnType<typeof createMockLlm>;
  let holidayService: ReturnType<typeof createMockHolidayService>;
  let helpdeskService: ReturnType<typeof createMockHelpdeskService>;
  let service: AssistantService;

  beforeEach(() => {
    prisma = createMockPrisma();
    llm = createMockLlm();
    holidayService = createMockHolidayService();
    helpdeskService = createMockHelpdeskService();
    service = new AssistantService(
      prisma as unknown as PrismaService,
      llm as unknown as AssistantLlmGateway,
      holidayService as unknown as HolidayService,
      helpdeskService as unknown as HelpdeskService,
    );

    prisma.assistantConversation.create.mockResolvedValue({
      id: 'conv-1',
      employeeId: 'emp-1',
    });
    prisma.assistantMessage.create.mockImplementation((args) =>
      Promise.resolve({ id: 'msg-1', ...args.data }),
    );
    prisma.employee.findUnique.mockResolvedValue({
      id: 'emp-1',
      companyId: 'co-1',
    });
  });

  describe('AC: assistant never returns data outside RBAC scope', () => {
    it('creates a fresh conversation owned by the actor when none is supplied', async () => {
      llm.complete.mockResolvedValue({ text: 'hi', toolCall: undefined });
      await service.sendMessage('emp-1', Role.EMPLOYEE, { message: 'hello' });
      expect(prisma.assistantConversation.create).toHaveBeenCalledWith({
        data: { employeeId: 'emp-1' },
      });
    });

    it('rejects sending into a conversation owned by a different employee', async () => {
      prisma.assistantConversation.findUnique.mockResolvedValue({
        id: 'conv-2',
        employeeId: 'someone-else',
      });
      await expect(
        service.sendMessage('emp-1', Role.EMPLOYEE, {
          conversationId: 'conv-2',
          message: 'hi',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("rejects confirming an action on a conversation that is not the caller's own", async () => {
      prisma.assistantMessage.findUnique.mockResolvedValue({
        id: 'msg-1',
        proposedAction: { type: 'raise_ticket', input: {} },
        actionTaken: null,
        conversation: { employeeId: 'someone-else' },
      });
      await expect(
        service.confirmAction('emp-1', { messageId: 'msg-1' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('only offers manager-only tools (pending_reviews) when role is MANAGER', async () => {
      llm.complete.mockResolvedValue({ text: 'hi', toolCall: undefined });
      await service.sendMessage('emp-1', Role.EMPLOYEE, {
        message: 'anything pending for my team?',
      });
      const employeeTools = llm.complete.mock.calls[0][2].map(
        (t: any) => t.name,
      );
      expect(employeeTools).not.toContain('pending_reviews');

      llm.complete.mockClear();
      await service.sendMessage('mgr-1', Role.MANAGER, {
        message: 'anything pending for my team?',
      });
      const managerTools = llm.complete.mock.calls[0][2].map(
        (t: any) => t.name,
      );
      expect(managerTools).toContain('pending_reviews');
    });

    it('rejects a non-manager attempting to invoke the manager-only pending_reviews tool', async () => {
      llm.complete.mockResolvedValue({
        text: '',
        toolCall: { name: 'pending_reviews', input: {} },
      });
      await expect(
        service.sendMessage('emp-1', Role.EMPLOYEE, {
          message: 'anything pending for my team?',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('AC: never executes a write action without explicit confirmation', () => {
    it('drafts raise_ticket as a proposedAction instead of calling HelpdeskService.createTicket', async () => {
      llm.complete.mockResolvedValue({
        text: '',
        toolCall: {
          name: 'raise_ticket',
          input: {
            category: 'IT_SUPPORT',
            subject: 'Laptop issue',
            description: 'My laptop will not boot.',
          },
        },
      });

      await service.sendMessage('emp-1', Role.EMPLOYEE, {
        message: 'raise a ticket for my laptop',
      });

      expect(helpdeskService.createTicket).not.toHaveBeenCalled();
      const createCall = prisma.assistantMessage.create.mock.calls.find(
        (c) => c[0].data.role === 'ASSISTANT',
      );
      expect(createCall[0].data.proposedAction).toEqual({
        type: 'raise_ticket',
        input: {
          category: 'IT_SUPPORT',
          subject: 'Laptop issue',
          description: 'My laptop will not boot.',
        },
      });
    });

    it('confirmAction executes the drafted raise_ticket through HelpdeskService.createTicket, tagged with the real actor', async () => {
      prisma.assistantMessage.findUnique.mockResolvedValue({
        id: 'msg-1',
        proposedAction: {
          type: 'raise_ticket',
          input: {
            category: 'IT_SUPPORT',
            subject: 'Laptop issue',
            description: 'My laptop will not boot.',
          },
        },
        actionTaken: null,
        conversation: { employeeId: 'emp-1' },
      });
      helpdeskService.createTicket.mockResolvedValue({
        id: 'ticket-1',
        status: 'OPEN',
      });
      prisma.assistantMessage.update.mockResolvedValue({ id: 'msg-1' });

      await service.confirmAction('emp-1', { messageId: 'msg-1' });

      expect(helpdeskService.createTicket).toHaveBeenCalledWith(
        {
          category: 'IT_SUPPORT',
          subject: 'Laptop issue',
          description: 'My laptop will not boot.',
        },
        'emp-1',
      );
      const updateData = prisma.assistantMessage.update.mock.calls[0][0].data;
      expect(updateData.actionTaken.initiatedVia).toBe('AI_ASSISTANT');
      expect(updateData.actionTaken.actorId).toBe('emp-1');
    });

    it('rejects confirming a message with no pending action', async () => {
      prisma.assistantMessage.findUnique.mockResolvedValue({
        id: 'msg-1',
        proposedAction: null,
        conversation: { employeeId: 'emp-1' },
      });
      await expect(
        service.confirmAction('emp-1', { messageId: 'msg-1' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects double-confirming an action that was already executed', async () => {
      prisma.assistantMessage.findUnique.mockResolvedValue({
        id: 'msg-1',
        proposedAction: { type: 'raise_ticket', input: {} },
        actionTaken: { type: 'raise_ticket' },
        conversation: { employeeId: 'emp-1' },
      });
      await expect(
        service.confirmAction('emp-1', { messageId: 'msg-1' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('AC: ungrounded policy questions get an honest refusal, never a fabrication', () => {
    it('passes "no matching policy documents" into the system prompt when nothing is indexed', async () => {
      llm.complete.mockResolvedValue({
        text: "I don't have this information.",
        toolCall: undefined,
      });
      await service.sendMessage('emp-1', Role.EMPLOYEE, {
        message: 'what is the WFH policy?',
      });

      const systemPrompt = llm.complete.mock.calls[0][0];
      expect(systemPrompt).toContain('No matching policy documents were found');
    });

    it('grounds the system prompt in an indexed document that matches the query', async () => {
      prisma.policyDocument.findMany.mockResolvedValue([
        {
          id: 'doc-1',
          title: 'Work From Home Policy',
          content: 'Employees may WFH up to 2 days a week.',
        },
      ]);
      llm.complete.mockResolvedValue({
        text: 'You may WFH 2 days/week.',
        toolCall: undefined,
      });

      await service.sendMessage('emp-1', Role.EMPLOYEE, {
        message: 'what is the wfh policy?',
      });

      const systemPrompt = llm.complete.mock.calls[0][0];
      expect(systemPrompt).toContain('Work From Home Policy');
    });

    it('reports itself as unavailable rather than crashing when the LLM gateway has no API key', async () => {
      llm.complete.mockRejectedValue(new AssistantUnavailableError());
      const result = await service.sendMessage('emp-1', Role.EMPLOYEE, {
        message: 'hi',
      });
      expect(result.message).toContain('not configured');
    });
  });
});
