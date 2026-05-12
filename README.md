# tiny-agent

Tiny, extensible AI agent. The core is just the loop and types. Everything else is an extension.

> Requires a TypeScript-capable runtime (Bun, tsx, ts-node with ESM).

## Usage

```bash
bun add @xy69/tiny-agent
```

```typescript
import { Agent } from '@xy69/tiny-agent'
import type { Tool } from '@xy69/tiny-agent'
import { OpenAIProvider } from '@xy69/tiny-agent/providers'
import { toolsExtension, loopDetectionExtension } from '@xy69/tiny-agent/extensions'

// Define a custom tool
const weatherTool: Tool = {
  definition: {
    name: 'get_weather',
    description: 'Get current weather for a city',
    parameters: {
      type: 'object',
      properties: { city: { type: 'string', description: 'City name' } },
      required: ['city'],
    },
  },
  async execute(input) {
    const res = await fetch(`https://wttr.in/${input.city}?format=j1`)
    const data = await res.json()
    return { output: JSON.stringify(data.current_condition[0]) }
  },
}

const provider = new OpenAIProvider(process.env.OPENAI_API_KEY!, 'gpt-4o')

const agent = new Agent({
  provider,
  systemPrompt: 'You are a helpful assistant with access to weather data.',
  extensions: [
    { name: 'weather', tools: [weatherTool] },
    toolsExtension(),
    loopDetectionExtension(),
  ],
})

for await (const event of agent.run('What is the weather in Berlin?')) {
  if (event.type === 'text_delta') process.stdout.write(event.text)
}
```

The `Agent` class takes a provider, a system prompt, and an array of extensions. No config files, no env var conventions, no DI — you wire it however you want.

## Architecture

The core (`packages/core/`) has three files:

- **`types.ts`** — `Message`, `Tool`, `Provider`, `Extension`, `MessageStore` interfaces
- **`agent.ts`** — The loop: stream LLM → parse tool calls → run hooks → execute tools → repeat
- **`index.ts`** — Barrel exports

The loop:

1. Push user message, call `beforeSend` hooks, stream from provider
2. Collect text deltas and tool call chunks into a complete assistant message
3. If no tool calls → `onTurnDone`, yield `turn_done`, return
4. For each tool call → `beforeToolCall` (can block/inject) → execute → `afterToolCall` (can transform result)
5. Append tool results, go to step 1

## Extension API

```typescript
interface Extension {
  name: string
  tools?: Tool[]
  beforeSend?(messages: Message[]): Message[] | Promise<Message[]>
  beforeToolCall?(toolCall: ToolCall): boolean | { inject: Message } | Promise<...>
  afterToolCall?(toolCall: ToolCall, result: ToolResult): ToolResult | Promise<ToolResult>
  onTurnDone?(messages: Message[]): void | Promise<void>
}
```

Extensions run in array order. Put safety extensions before tool extensions.

Built-in:
- **toolsExtension** — read, write, edit, glob, grep, bash
- **loopDetectionExtension** — breaks infinite tool-call loops
- **compactionExtension** — summarizes old messages when context fills up
- **taskExtension** — delegates subtasks to isolated sub-agents

See [`packages/core/README.md`](packages/core/README.md) for detailed extension docs.

## Providers

The core defines a `Provider` interface — anything that implements `stream()` works:

```typescript
interface Provider {
  name: string
  stream(messages, tools, systemPrompt, maxTokens): AsyncIterable<ProviderChunk>
}
```

Included: `OpenAIProvider` (works with any OpenAI-compatible API) and `AnthropicProvider`. Write your own for Gemini, Ollama, or anything else.

## Message Persistence

The `Agent` accepts an optional `store: MessageStore` for persistence. The interface is minimal:

```typescript
interface MessageStore {
  getMessages(): Message[]
  append(message: Message): void
}
```

The included `Session` class (`packages/session/`) is a JSONL-based implementation. You can swap it for Redis, SQLite, a database — whatever fits your use case.

## Running the Examples

```bash
bun install
cd packages/examples/cli   # or web
cp agent.config.example.json agent.config.json
# Add your API key and model

bun run dev
```

See each example's README for details.

## Development

```bash
bun run typecheck    # Type-check all packages
bun run format       # Prettier
```

## License

MIT
