import OpenAI from 'openai'
import type {
  Message,
  Provider,
  ProviderChunk,
  ToolDefinition,
} from '../core/types'

export class OpenAIProvider implements Provider {
  name = 'openai'
  private client: OpenAI
  private model: string

  constructor(apiKey: string, model: string, baseUrl?: string) {
    this.client = new OpenAI({ apiKey, baseURL: baseUrl })
    this.model = model
  }

  async *stream(
    messages: Message[],
    tools: ToolDefinition[],
    systemPrompt: string,
    maxTokens: number
  ): AsyncIterable<ProviderChunk> {
    const openaiMessages = this.formatMessages(messages, systemPrompt)
    const openaiTools = this.formatTools(tools)

    const stream = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: maxTokens,
      messages: openaiMessages,
      tools: openaiTools.length > 0 ? openaiTools : undefined,
      stream: true,
      stream_options: { include_usage: true },
    })

    // OpenAI streams tool calls by index — first chunk has id+name,
    // subsequent chunks only have index. Track index→id mapping.
    const indexToId: Map<number, string> = new Map()

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta

      if (delta) {
        if (delta.content) {
          yield { type: 'text', text: delta.content }
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.id && tc.function?.name) {
              // First chunk for this tool call — register index→id
              indexToId.set(tc.index, tc.id)
              yield {
                type: 'tool_call_start',
                id: tc.id,
                name: tc.function.name,
              }
            }

            if (tc.function?.arguments) {
              const id = indexToId.get(tc.index) ?? `tool_${tc.index}`
              yield {
                type: 'tool_call_delta',
                id,
                arguments: tc.function.arguments,
              }
            }
          }
        }
      }

      // Usage can arrive on any chunk (final chunk, or alongside delta)
      if (chunk.usage) {
        yield {
          type: 'usage',
          inputTokens: chunk.usage.prompt_tokens,
          outputTokens: chunk.usage.completion_tokens,
        }
      }
    }

    // Emit tool_call_end for each tracked tool call
    for (const id of indexToId.values()) {
      yield { type: 'tool_call_end', id }
    }

    yield { type: 'done' }
  }

  private formatMessages(
    messages: Message[],
    systemPrompt: string
  ): OpenAI.ChatCompletionMessageParam[] {
    const result: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
    ]

    for (const msg of messages) {
      if (msg.role === 'system') continue

      if (msg.role === 'assistant') {
        const toolCalls = msg.toolCalls?.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        }))
        result.push({
          role: 'assistant',
          content: msg.content || null,
          tool_calls: toolCalls,
        })
      } else if (msg.role === 'tool') {
        result.push({
          role: 'tool',
          tool_call_id: msg.toolCallId!,
          content: msg.content,
        })
      } else {
        result.push({ role: 'user', content: msg.content })
      }
    }

    return result
  }

  private formatTools(tools: ToolDefinition[]): OpenAI.ChatCompletionTool[] {
    return tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }))
  }
}
