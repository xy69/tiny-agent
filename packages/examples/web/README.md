# Web Example

SSE-based chat server with an inline HTML UI. No build step, no frontend framework.

## Setup

```bash
cp agent.config.example.json agent.config.json
```

Edit `agent.config.json` with your API key and model:

```json
{
  "provider": "openai",
  "model": "gpt-4o",
  "apiKey": "sk-...",
  "baseUrl": "https://api.openai.com/v1",
  "maxTokens": 8192,
  "systemPrompt": "You are a coding assistant."
}
```

## Run

```bash
bun run dev
```

Opens at `http://localhost:3000`.

Or from the repo root:

```bash
bun run dev:web
```

## How It Works

The server exposes two endpoints:

- `GET /` — serves the inline HTML chat UI
- `POST /chat` — accepts `{ message, sessionId? }`, returns an SSE stream

SSE events:

| Event | Payload | Description |
|-------|---------|-------------|
| `session` | `{ sessionId }` | Session ID (first event) |
| `text` | `{ text }` | Text delta from the LLM |
| `tool_start` | `{ name, args }` | Tool call started |
| `tool_done` | `{ name, output, isError }` | Tool call finished |
| `usage` | `{ inputTokens, outputTokens }` | Token usage |
| `error` | `{ error }` | Error message |
| `done` | `{}` | Turn complete |

Sessions are in-memory (no persistence). Each session gets its own `Agent` instance with filesystem tools and loop detection.

## Integrating in Your Own App

The SSE protocol is simple enough to consume from any frontend:

```javascript
const res = await fetch('/chat', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ message: 'Hello', sessionId }),
})

const reader = res.body.getReader()
// Parse SSE events from the stream
```
