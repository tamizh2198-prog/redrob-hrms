import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

export class AssistantUnavailableError extends Error {
  constructor() {
    super('The AI assistant is not configured. Please contact HR.');
  }
}

export interface LlmToolDef {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface LlmToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface LlmResponse {
  text: string;
  toolCall?: LlmToolCall;
}

// Thin wrapper around the Anthropic SDK so AssistantService stays testable
// without a real API key — inject a mock of this gateway in tests instead
// of mocking the SDK client directly.
@Injectable()
export class AssistantLlmGateway {
  private readonly logger = new Logger(AssistantLlmGateway.name);
  private readonly client: Anthropic | null;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
    if (!this.client) {
      this.logger.warn(
        'ANTHROPIC_API_KEY is not set — the AI Assistant will report itself as unavailable',
      );
    }
  }

  async complete(
    systemPrompt: string,
    userMessage: string,
    tools: LlmToolDef[],
  ): Promise<LlmResponse> {
    if (!this.client) {
      throw new AssistantUnavailableError();
    }

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      tools: tools.length ? tools : undefined,
    });

    const toolUseBlock = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );
    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === 'text',
    );

    return {
      text: textBlock?.text ?? '',
      toolCall: toolUseBlock
        ? {
            name: toolUseBlock.name,
            input: toolUseBlock.input as Record<string, unknown>,
          }
        : undefined,
    };
  }
}
