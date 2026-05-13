import Anthropic from '@anthropic-ai/sdk'
import type {
  Message,
  Provider,
  ProviderChunk,
  ToolDefinition,
} from '../core/types'

export class AnthropicProvider implements Provider {
  name = 'anthropic'
  private client: Anthropic
  private model: string

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey })
    this.model = model
  }

  async *stream(
    messages: Message[],
    tools: ToolDefinition[],
    systemPrompt: string,
    maxTokens: number
  ): AsyncIterable<ProviderChunk> {
    const anthropicMessages = this.formatMessages(messages)
    const anthropicTools = this.formatTools(tools)

    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: anthropicMessages,
      tools: anthropicTools.length > 0 ? anthropicTools : undefined,
    })

    // Track content_block index → tool_use ID mapping
    const indexToId = new Map<number, string>()

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          yield { type: 'text', text: event.delta.text }
        } else if (event.delta.type === 'input_json_delta') {
          const id = indexToId.get(event.index) ?? `tool_${event.index}`
          yield {
            type: 'tool_call_delta',
            id,
            arguments: event.delta.partial_json,
          }
        }
      } else if (event.type === 'content_block_start') {
        if (event.content_block.type === 'tool_use') {
          indexToId.set(event.index, event.content_block.id)
          yield {
            type: 'tool_call_start',
            id: event.content_block.id,
            name: event.content_block.name,
          }
        }
      } else if (event.type === 'content_block_stop') {
        const id = indexToId.get(event.index)
        if (id) {
          yield { type: 'tool_call_end', id }
        }
      } else if (event.type === 'message_delta') {
        if (event.usage) {
          yield {
            type: 'usage',
            inputTokens: 0,
            outputTokens: event.usage.output_tokens,
          }
        }
      } else if (event.type === 'message_start') {
        if (event.message.usage) {
          yield {
            type: 'usage',
            inputTokens: event.message.usage.input_tokens,
            outputTokens: 0,
          }
        }
      }
    }

    yield { type: 'done' }
  }

  private formatMessages(messages: Message[]): Anthropic.MessageParam[] {
    const result: Anthropic.MessageParam[] = []

    for (const msg of messages) {
      if (msg.role === 'system') continue

      if (msg.role === 'assistant') {
        const content: Anthropic.ContentBlockParam[] = []
        if (msg.content) {
          content.push({ type: 'text', text: msg.content })
        }
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            })
          }
        }
        result.push({ role: 'assistant', content })
      } else if (msg.role === 'tool') {
        const lastMsg = result[result.length - 1]
        const toolResult: Anthropic.ToolResultBlockParam = {
          type: 'tool_result',
          tool_use_id: msg.toolCallId!,
          content: msg.content,
        }

        if (lastMsg?.role === 'user' && Array.isArray(lastMsg.content)) {
          ;(lastMsg.content as Anthropic.ContentBlockParam[]).push(toolResult)
        } else {
          result.push({ role: 'user', content: [toolResult] })
        }
      } else {
        result.push({ role: 'user', content: msg.content })
      }
    }

    return result
  }

  private formatTools(tools: ToolDefinition[]): Anthropic.Tool[] {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool['input_schema'],
    }))
  }
}
