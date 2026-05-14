import { describe, expect, test } from 'bun:test'

import { Agent } from '../src/core/agent'
import type {
  Extension,
  Message,
  Provider,
  ProviderChunk,
  StreamEvent,
  Tool,
} from '../src/core/types'

/** Creates a mock provider that yields predetermined chunks */
function mockProvider(responses: ProviderChunk[][]): Provider {
  let callIdx = 0
  return {
    name: 'mock',
    async *stream(): AsyncIterable<ProviderChunk> {
      const chunks = responses[callIdx] ?? []
      callIdx++
      for (const chunk of chunks) {
        yield chunk
      }
    },
  }
}

/** Collects all stream events from an agent run */
async function collectEvents(
  agent: Agent,
  message: string
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = []
  for await (const event of agent.run(message)) {
    events.push(event)
  }
  return events
}

describe('Agent', () => {
  test('streams text response', async () => {
    const provider = mockProvider([
      [
        { type: 'text', text: 'Hello' },
        { type: 'text', text: ' world' },
        { type: 'done' },
      ],
    ])

    const agent = new Agent({
      provider,
      systemPrompt: 'You are helpful.',
      maxTokens: 1024,
    })

    const events = await collectEvents(agent, 'Hi')

    const textEvents = events.filter((e) => e.type === 'text_delta')
    expect(textEvents).toHaveLength(2)
    expect(textEvents[0].text).toBe('Hello')
    expect(textEvents[1].text).toBe(' world')
    expect(events[events.length - 1].type).toBe('turn_done')
  })

  test('executes tool calls', async () => {
    const provider = mockProvider([
      // First response: tool call
      [
        { type: 'tool_call_start', id: 'tc_1', name: 'greet' },
        { type: 'tool_call_delta', id: 'tc_1', arguments: '{"name":"Alice"}' },
        { type: 'tool_call_end', id: 'tc_1' },
        { type: 'done' },
      ],
      // Second response: text after tool result
      [{ type: 'text', text: 'Done!' }, { type: 'done' }],
    ])

    const greetTool: Tool = {
      definition: {
        name: 'greet',
        description: 'Greet someone',
        parameters: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
        },
      },
      async execute(input) {
        return { output: `Hello, ${input.name}!` }
      },
    }

    const ext: Extension = { name: 'test-tools', tools: [greetTool] }

    const agent = new Agent({
      provider,
      systemPrompt: 'You are helpful.',
      maxTokens: 1024,
      extensions: [ext],
    })

    const events = await collectEvents(agent, 'Greet Alice')

    const toolStart = events.find((e) => e.type === 'tool_call_start')
    expect(toolStart).toBeDefined()
    expect(toolStart!.toolCall!.name).toBe('greet')

    const toolDone = events.find((e) => e.type === 'tool_call_done')
    expect(toolDone).toBeDefined()
    expect(toolDone!.toolResult!.output).toBe('Hello, Alice!')

    const textEvents = events.filter((e) => e.type === 'text_delta')
    expect(textEvents[0].text).toBe('Done!')
  })

  test('handles unknown tool gracefully', async () => {
    const provider = mockProvider([
      [
        { type: 'tool_call_start', id: 'tc_1', name: 'nonexistent' },
        { type: 'tool_call_delta', id: 'tc_1', arguments: '{}' },
        { type: 'tool_call_end', id: 'tc_1' },
        { type: 'done' },
      ],
      [{ type: 'text', text: 'OK' }, { type: 'done' }],
    ])

    const agent = new Agent({
      provider,
      systemPrompt: 'test',
      maxTokens: 1024,
    })

    const events = await collectEvents(agent, 'test')
    const toolDone = events.find((e) => e.type === 'tool_call_done')
    expect(toolDone!.toolResult!.isError).toBe(true)
    expect(toolDone!.toolResult!.output).toContain('Unknown tool')
  })

  test('handles tool execution error', async () => {
    const provider = mockProvider([
      [
        { type: 'tool_call_start', id: 'tc_1', name: 'fail' },
        { type: 'tool_call_delta', id: 'tc_1', arguments: '{}' },
        { type: 'tool_call_end', id: 'tc_1' },
        { type: 'done' },
      ],
      [{ type: 'text', text: 'recovered' }, { type: 'done' }],
    ])

    const failTool: Tool = {
      definition: {
        name: 'fail',
        description: 'Always fails',
        parameters: { type: 'object', properties: {} },
      },
      async execute() {
        throw new Error('boom')
      },
    }

    const agent = new Agent({
      provider,
      systemPrompt: 'test',
      maxTokens: 1024,
      extensions: [{ name: 'test', tools: [failTool] }],
    })

    const events = await collectEvents(agent, 'test')
    const toolDone = events.find((e) => e.type === 'tool_call_done')
    expect(toolDone!.toolResult!.isError).toBe(true)
    expect(toolDone!.toolResult!.output).toContain('boom')
  })

  test('beforeSend hook can modify messages', async () => {
    let capturedMessages: Message[] = []

    const provider: Provider = {
      name: 'mock',
      async *stream(messages) {
        capturedMessages = messages
        yield { type: 'text', text: 'ok' }
        yield { type: 'done' }
      },
    }

    const ext: Extension = {
      name: 'inject',
      beforeSend(messages) {
        return [{ role: 'user', content: '[injected context]' }, ...messages]
      },
    }

    const agent = new Agent({
      provider,
      systemPrompt: 'test',
      maxTokens: 1024,
      extensions: [ext],
    })

    await collectEvents(agent, 'hello')
    expect(capturedMessages[0].content).toBe('[injected context]')
    expect(capturedMessages[1].content).toBe('hello')
  })

  test('beforeToolCall can block execution', async () => {
    const provider = mockProvider([
      [
        { type: 'tool_call_start', id: 'tc_1', name: 'dangerous' },
        { type: 'tool_call_delta', id: 'tc_1', arguments: '{}' },
        { type: 'tool_call_end', id: 'tc_1' },
        { type: 'done' },
      ],
      [{ type: 'text', text: 'blocked' }, { type: 'done' }],
    ])

    let toolExecuted = false
    const tool: Tool = {
      definition: {
        name: 'dangerous',
        description: 'Dangerous tool',
        parameters: { type: 'object', properties: {} },
      },
      async execute() {
        toolExecuted = true
        return { output: 'ran' }
      },
    }

    const blocker: Extension = {
      name: 'blocker',
      tools: [tool],
      beforeToolCall(tc) {
        if (tc.name === 'dangerous') {
          return {
            inject: {
              role: 'tool',
              content: 'Blocked by policy',
              toolCallId: tc.id,
            },
          }
        }
        return true
      },
    }

    const agent = new Agent({
      provider,
      systemPrompt: 'test',
      maxTokens: 1024,
      extensions: [blocker],
    })

    await collectEvents(agent, 'test')
    expect(toolExecuted).toBe(false)
  })

  test('afterToolCall can modify result', async () => {
    const provider = mockProvider([
      [
        { type: 'tool_call_start', id: 'tc_1', name: 'echo' },
        { type: 'tool_call_delta', id: 'tc_1', arguments: '{"msg":"hi"}' },
        { type: 'tool_call_end', id: 'tc_1' },
        { type: 'done' },
      ],
      [{ type: 'text', text: 'done' }, { type: 'done' }],
    ])

    const echoTool: Tool = {
      definition: {
        name: 'echo',
        description: 'Echo',
        parameters: {
          type: 'object',
          properties: { msg: { type: 'string' } },
        },
      },
      async execute(input) {
        return { output: input.msg as string }
      },
    }

    const modifier: Extension = {
      name: 'modifier',
      tools: [echoTool],
      afterToolCall(_tc, result) {
        return { output: result.output + ' [modified]' }
      },
    }

    const agent = new Agent({
      provider,
      systemPrompt: 'test',
      maxTokens: 1024,
      extensions: [modifier],
    })

    const events = await collectEvents(agent, 'test')
    const toolDone = events.find((e) => e.type === 'tool_call_done')
    expect(toolDone!.toolResult!.output).toBe('hi [modified]')
  })

  test('onTurnDone fires with full message history', async () => {
    const provider = mockProvider([
      [{ type: 'text', text: 'response' }, { type: 'done' }],
    ])

    let turnMessages: Message[] = []
    const ext: Extension = {
      name: 'observer',
      onTurnDone(messages) {
        turnMessages = [...messages]
      },
    }

    const agent = new Agent({
      provider,
      systemPrompt: 'test',
      maxTokens: 1024,
      extensions: [ext],
    })

    await collectEvents(agent, 'hello')
    expect(turnMessages).toHaveLength(2) // user + assistant
    expect(turnMessages[0].role).toBe('user')
    expect(turnMessages[1].role).toBe('assistant')
    expect(turnMessages[1].content).toBe('response')
  })

  test('store receives all messages', async () => {
    const provider = mockProvider([
      [
        { type: 'tool_call_start', id: 'tc_1', name: 'ping' },
        { type: 'tool_call_delta', id: 'tc_1', arguments: '{}' },
        { type: 'tool_call_end', id: 'tc_1' },
        { type: 'done' },
      ],
      [{ type: 'text', text: 'pong' }, { type: 'done' }],
    ])

    const pingTool: Tool = {
      definition: {
        name: 'ping',
        description: 'Ping',
        parameters: { type: 'object', properties: {} },
      },
      async execute() {
        return { output: 'pong' }
      },
    }

    const stored: Message[] = []
    const store = {
      getMessages: () => [],
      append: (msg: Message) => stored.push(msg),
    }

    const agent = new Agent({
      provider,
      systemPrompt: 'test',
      maxTokens: 1024,
      store,
      extensions: [{ name: 'test', tools: [pingTool] }],
    })

    await collectEvents(agent, 'test')

    // user, assistant (with tool call), tool result, assistant (final)
    expect(stored).toHaveLength(4)
    expect(stored[0].role).toBe('user')
    expect(stored[1].role).toBe('assistant')
    expect(stored[1].toolCalls).toBeDefined()
    expect(stored[2].role).toBe('tool')
    expect(stored[3].role).toBe('assistant')
    expect(stored[3].content).toBe('pong')
  })

  test('usage events are yielded', async () => {
    const provider = mockProvider([
      [
        { type: 'usage', inputTokens: 100, outputTokens: 50 },
        { type: 'text', text: 'hi' },
        { type: 'done' },
      ],
    ])

    const agent = new Agent({
      provider,
      systemPrompt: 'test',
      maxTokens: 1024,
    })

    const events = await collectEvents(agent, 'test')
    const usage = events.find((e) => e.type === 'usage')
    expect(usage).toBeDefined()
    expect(usage!.usage!.inputTokens).toBe(100)
    expect(usage!.usage!.outputTokens).toBe(50)
  })

  test('multiple tool calls in one response', async () => {
    const provider = mockProvider([
      [
        { type: 'tool_call_start', id: 'tc_1', name: 'ping' },
        { type: 'tool_call_delta', id: 'tc_1', arguments: '{}' },
        { type: 'tool_call_end', id: 'tc_1' },
        { type: 'tool_call_start', id: 'tc_2', name: 'ping' },
        { type: 'tool_call_delta', id: 'tc_2', arguments: '{}' },
        { type: 'tool_call_end', id: 'tc_2' },
        { type: 'done' },
      ],
      [{ type: 'text', text: 'both done' }, { type: 'done' }],
    ])

    const pingTool: Tool = {
      definition: {
        name: 'ping',
        description: 'Ping',
        parameters: { type: 'object', properties: {} },
      },
      async execute() {
        return { output: 'pong' }
      },
    }

    const agent = new Agent({
      provider,
      systemPrompt: 'test',
      maxTokens: 1024,
      extensions: [{ name: 'test', tools: [pingTool] }],
    })

    const events = await collectEvents(agent, 'test')
    const toolDones = events.filter((e) => e.type === 'tool_call_done')
    expect(toolDones).toHaveLength(2)
  })
})
