# CLI Example

Interactive REPL with session persistence, slash commands, and streaming output.

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

Works with any OpenAI-compatible API (OpenRouter, local models, custom gateways).

## Run

```bash
bun run dev
```

Or from the repo root:

```bash
bun run dev
```

## Features

- Streaming markdown output with syntax highlighting
- Session persistence (JSONL in `.sessions/`)
- Context compaction when approaching token limits
- Sub-agent task delegation
- Project context file support (`AGENT.md`, `.agent.md`, `CLAUDE.md`)

## Commands

| Command | Description |
|---------|-------------|
| `/connect` | Add an API key interactively |
| `/sessions` | List saved sessions |
| `/new` | Start a fresh session |
| `/quit` | Exit |

## CLI Flags

```
--resume <id>   Resume a session (prefix match)
--list          List all sessions
--help          Show help
```

## Auth Resolution

The CLI resolves API keys in this order:

1. `apiKey` field in `agent.config.json`
2. Auth store (from `/connect`)
3. `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` env vars
4. `AGENT_API_KEY` env var
