import type {
  Provider,
  Message,
  MessageStore,
  Tool,
  ToolCall,
  ToolDefinition,
  StreamEvent,
  Extension,
} from './types'

export interface AgentOptions {
  provider: Provider
  systemPrompt: string
  maxTokens: number
  extensions?: Extension[]
  store?: MessageStore
}

export class Agent {
  private provider: Provider
  private tools: Map<string, Tool> = new Map()
  private extensions: Extension[]
  private systemPrompt: string
  private maxTokens: number
  private messages: Message[] = []
  private store?: MessageStore

  constructor(opts: AgentOptions) {
    this.provider = opts.provider
    this.systemPrompt = opts.systemPrompt
    this.maxTokens = opts.maxTokens
    this.extensions = opts.extensions ?? []
    this.store = opts.store

    // Collect tools from extensions
    for (const ext of this.extensions) {
      if (ext.tools) {
        for (const tool of ext.tools) {
          this.tools.set(tool.definition.name, tool)
        }
      }
    }

    // Restore messages from store
    if (this.store) {
      this.messages = this.store.getMessages()
    }
  }

  async *run(userMessage: string): AsyncGenerator<StreamEvent> {
    this.messages.push({ role: 'user', content: userMessage })
    this.store?.append({ role: 'user', content: userMessage })

    while (true) {
      // Hook: beforeSend
      let messagesToSend = [...this.messages]
      for (const ext of this.extensions) {
        if (ext.beforeSend) {
          messagesToSend = await ext.beforeSend(messagesToSend)
        }
      }

      const toolCalls: Map<string, { name: string; arguments: string }> =
        new Map()
      let textContent = ''

      // Stream LLM response
      const chunks = this.provider.stream(
        messagesToSend,
        this.getToolDefinitions(),
        this.systemPrompt,
        this.maxTokens
      )

      for await (const chunk of chunks) {
        switch (chunk.type) {
          case 'text':
            textContent += chunk.text
            yield { type: 'text_delta', text: chunk.text }
            break

          case 'tool_call_start':
            toolCalls.set(chunk.id, { name: chunk.name, arguments: '' })
            break

          case 'tool_call_delta': {
            const existing = toolCalls.get(chunk.id)
            if (existing) {
              existing.arguments += chunk.arguments
            } else {
              // Fallback: append to last tool call
              const last = [...toolCalls.values()].pop()
              if (last) last.arguments += chunk.arguments
            }
            break
          }

          case 'tool_call_end':
            break

          case 'usage':
            yield {
              type: 'usage',
              usage: {
                inputTokens: chunk.inputTokens,
                outputTokens: chunk.outputTokens,
              },
            }
            break

          case 'done':
            break
        }
      }

      // Build parsed tool calls
      const parsedToolCalls: ToolCall[] = []
      for (const [id, tc] of toolCalls) {
        let args: Record<string, unknown> = {}
        try {
          args = tc.arguments ? JSON.parse(tc.arguments) : {}
        } catch {
          args = { _raw: tc.arguments }
        }
        parsedToolCalls.push({ id, name: tc.name, arguments: args })
      }

      // Append assistant message
      const assistantMsg: Message = {
        role: 'assistant',
        content: textContent,
        toolCalls: parsedToolCalls.length > 0 ? parsedToolCalls : undefined,
      }
      this.messages.push(assistantMsg)
      this.store?.append(assistantMsg)

      // If no tool calls, we're done
      if (parsedToolCalls.length === 0) {
        // Hook: onTurnDone
        for (const ext of this.extensions) {
          if (ext.onTurnDone) await ext.onTurnDone(this.messages)
        }
        yield { type: 'turn_done' }
        return
      }

      // Execute tool calls
      for (const tc of parsedToolCalls) {
        // Hook: beforeToolCall
        let shouldExecute = true
        let blockReason = 'Tool call was blocked by an extension.'
        for (const ext of this.extensions) {
          if (ext.beforeToolCall) {
            const result = await ext.beforeToolCall(tc)
            if (result === false) {
              shouldExecute = false
              break
            }
            if (typeof result === 'object' && 'inject' in result) {
              shouldExecute = false
              blockReason = result.inject.content
              break
            }
          }
        }

        if (!shouldExecute) {
          // Must emit a tool result to satisfy the API contract
          const blockedMsg: Message = {
            role: 'tool',
            content: blockReason,
            toolCallId: tc.id,
          }
          this.messages.push(blockedMsg)
          this.store?.append(blockedMsg)
          yield {
            type: 'tool_call_done',
            toolCall: tc,
            toolResult: { output: blockReason, isError: true },
          }
          continue
        }

        yield { type: 'tool_call_start', toolCall: tc }

        const tool = this.tools.get(tc.name)
        let result
        if (!tool) {
          result = { output: `Unknown tool: ${tc.name}`, isError: true }
        } else {
          try {
            result = await tool.execute(tc.arguments)
          } catch (err) {
            result = { output: `Tool error: ${err}`, isError: true }
          }
        }

        // Hook: afterToolCall
        for (const ext of this.extensions) {
          if (ext.afterToolCall) {
            result = await ext.afterToolCall(tc, result)
          }
        }

        yield { type: 'tool_call_done', toolCall: tc, toolResult: result }

        const toolMsg: Message = {
          role: 'tool',
          content: result.output,
          toolCallId: tc.id,
        }
        this.messages.push(toolMsg)
        this.store?.append(toolMsg)
      }
    }
  }

  private getToolDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].map((t) => t.definition)
  }

  getMessages(): Message[] {
    return this.messages
  }
}
