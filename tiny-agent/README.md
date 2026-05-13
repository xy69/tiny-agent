# @tiny-agent/core

The agent engine. Just the loop and types. Everything else is an extension.

## Core (what's NOT an extension)

- **Agent loop** — stream LLM → parse tool calls → execute → repeat
- **Provider interface** — any LLM that implements `stream()`
- **MessageStore interface** — optional persistence (you bring your own)
- **Types** — Message, Tool, Provider, Extension interfaces

## Extension API

```typescript
interface Extension {
  name: string

  /** Register tools */
  tools?: Tool[]

  /** Modify messages before sending to LLM */
  beforeSend?(messages: Message[]): Message[] | Promise<Message[]>

  /** Intercept tool calls. Return false to skip, or { inject } to provide a custom response */
  beforeToolCall?(toolCall: ToolCall): boolean | { inject: Message } | Promise<...>

  /** Modify tool results after execution */
  afterToolCall?(toolCall: ToolCall, result: ToolResult): ToolResult | Promise<ToolResult>

  /** Called when the agent turn completes */
  onTurnDone?(messages: Message[]): void | Promise<void>
}
```

## Built-in Extensions

### `toolsExtension()`

Provides the standard file/shell tools: read_file, write_file, edit_file, bash, glob, grep, list_files.

```typescript
import { Agent } from '@xy69/tiny-agent'
import { toolsExtension } from '@xy69/tiny-agent/extensions'

const agent = new Agent({
  provider,
  systemPrompt: '...',
  maxTokens: 8192,
  extensions: [toolsExtension()],
})
```

### `loopDetectionExtension(threshold?)`

Detects repeated identical tool calls and injects a correction message.

```typescript
import { loopDetectionExtension } from '@xy69/tiny-agent/extensions'

// Breaks after 3 identical consecutive calls (default)
loopDetectionExtension()

// Custom threshold
loopDetectionExtension(5)
```

### `compactionExtension(opts)`

Auto-summarizes old messages when approaching the context token limit.

```typescript
import { compactionExtension } from '@xy69/tiny-agent/extensions'

compactionExtension({
  provider,           // Used to generate summaries
  store: session,     // Optional: persists compaction (must implement compact())
  contextLimit: 100_000,  // Estimated token limit (default: 100k)
  keepRecent: 6,      // Messages to keep verbatim (default: 6)
})
```

### `taskExtension(opts)`

Provides a `task` tool that delegates subtasks to isolated sub-agents.

```typescript
import { taskExtension } from '@xy69/tiny-agent/extensions'

taskExtension({
  provider,
  maxTokens: 8192,
  tools: [readFileTool, grepTool],  // Optional: restrict sub-agent tools
})
```

## Writing Your Own Extension

```typescript
import type { Extension } from '@xy69/tiny-agent'

function myExtension(): Extension {
  return {
    name: 'my-extension',

    // Add custom tools
    tools: [myCustomTool],

    // Inject context before every LLM call
    beforeSend(messages) {
      return [
        ...messages,
        { role: 'system', content: 'Remember: always be concise.' },
      ]
    },

    // Block dangerous commands
    beforeToolCall(toolCall) {
      if (toolCall.name === 'bash' && /rm -rf/.test(JSON.stringify(toolCall.arguments))) {
        return { inject: { role: 'tool', content: 'That command was blocked for safety.' } }
      }
      return true
    },

    // Log all tool results
    afterToolCall(toolCall, result) {
      console.log(`[${toolCall.name}]: ${result.output.slice(0, 100)}`)
      return result
    },
  }
}
```

## Usage

```typescript
import { Agent } from '@xy69/tiny-agent'
import { OpenAIProvider } from '@xy69/tiny-agent/providers'
import { Session } from '@xy69/tiny-agent/session'
import {
  toolsExtension,
  loopDetectionExtension,
  compactionExtension,
  taskExtension,
} from '@xy69/tiny-agent/extensions'

const provider = new OpenAIProvider(apiKey, model, baseUrl)
const session = new Session(sessionId, '.sessions')

const agent = new Agent({
  provider,
  systemPrompt: 'You are a helpful assistant.',
  maxTokens: 8192,
  store: session,
  extensions: [
    toolsExtension(),
    loopDetectionExtension(),
    compactionExtension({ provider, store: session }),
    taskExtension({ provider, maxTokens: 8192 }),
  ],
})

for await (const event of agent.run('What files are here?')) {
  if (event.type === 'text_delta') process.stdout.write(event.text!)
}
```

## Extension Execution Order

Extensions are called in array order:

1. `beforeSend` — each extension transforms messages sequentially
2. `beforeToolCall` — first extension to return `false` or `{ inject }` wins
3. `afterToolCall` — each extension transforms the result sequentially
4. `onTurnDone` — all extensions notified

This means extension order matters. Put safety/blocking extensions before tools.
