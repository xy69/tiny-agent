// Core types for the agent

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: ToolCall[]
  toolCallId?: string
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown> // JSON Schema
}

export interface Tool {
  definition: ToolDefinition
  execute(input: Record<string, unknown>): Promise<ToolResult>
}

export interface ToolResult {
  output: string
  isError?: boolean
}

export interface StreamEvent {
  type:
    | 'text_delta'
    | 'tool_call_start'
    | 'tool_call_done'
    | 'turn_done'
    | 'error'
    | 'usage'
  text?: string
  toolCall?: ToolCall
  toolResult?: ToolResult
  error?: string
  usage?: { inputTokens: number; outputTokens: number }
}

export interface Provider {
  name: string
  stream(
    messages: Message[],
    tools: ToolDefinition[],
    systemPrompt: string,
    maxTokens: number
  ): AsyncIterable<ProviderChunk>
}

export type ProviderChunk =
  | { type: 'text'; text: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_delta'; id: string; arguments: string }
  | { type: 'tool_call_end'; id: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'done' }

// Message persistence (optional, injected by consumer)

export interface MessageStore {
  getMessages(): Message[]
  append(message: Message): void
}

// Extension API

export interface Extension {
  name: string

  /** Register tools with the agent */
  tools?: Tool[]

  /** Called before messages are sent to the LLM. Can modify messages. */
  beforeSend?(messages: Message[]): Message[] | Promise<Message[]>

  /** Called after tool calls are parsed, before execution. Return false to skip execution. */
  beforeToolCall?(
    toolCall: ToolCall
  ): boolean | { inject: Message } | Promise<boolean | { inject: Message }>

  /** Called after a tool executes. Can modify the result. */
  afterToolCall?(
    toolCall: ToolCall,
    result: ToolResult
  ): ToolResult | Promise<ToolResult>

  /** Called when the agent turn is complete */
  onTurnDone?(messages: Message[]): void | Promise<void>
}
