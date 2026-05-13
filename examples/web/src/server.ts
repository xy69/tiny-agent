import { Agent } from '@xy69/tiny-agent'
import {
  loopDetectionExtension,
  toolsExtension,
} from '@xy69/tiny-agent/extensions'
import { OpenAIProvider } from '@xy69/tiny-agent/providers'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const PORT = 3000

function loadConfig(): Record<string, unknown> {
  const path = join(process.cwd(), 'agent.config.json')
  if (!existsSync(path)) {
    console.error(
      'Missing agent.config.json — copy from agent.config.example.json'
    )
    process.exit(1)
  }
  return JSON.parse(readFileSync(path, 'utf-8'))
}

const config = loadConfig()

const provider = new OpenAIProvider(
  config.apiKey as string,
  (config.model as string) ?? 'gpt-4o',
  (config.baseUrl as string) ?? 'https://api.openai.com/v1'
)

// Per-session agents (in-memory, no persistence for this example)
const sessions = new Map<string, Agent>()

function getOrCreateAgent(sessionId: string): Agent {
  let agent = sessions.get(sessionId)
  if (!agent) {
    agent = new Agent({
      provider,
      systemPrompt:
        (config.systemPrompt as string) ?? 'You are a helpful assistant.',
      maxTokens: (config.maxTokens as number) ?? 16384,
      extensions: [toolsExtension(), loopDetectionExtension()],
    })
    sessions.set(sessionId, agent)
  }
  return agent
}

const server = Bun.serve({
  port: PORT,

  async fetch(req) {
    const url = new URL(req.url)

    // Serve the HTML UI
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(HTML, {
        headers: { 'content-type': 'text/html' },
      })
    }

    // SSE endpoint for chat
    if (url.pathname === '/chat' && req.method === 'POST') {
      const body = (await req.json()) as {
        message: string
        sessionId?: string
      }
      const sessionId = body.sessionId ?? crypto.randomUUID()
      const agent = getOrCreateAgent(sessionId)

      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder()
          const send = (event: string, data: unknown) => {
            controller.enqueue(
              encoder.encode(
                `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
              )
            )
          }

          send('session', { sessionId })

          try {
            for await (const event of agent.run(body.message)) {
              switch (event.type) {
                case 'text_delta':
                  send('text', { text: event.text })
                  break
                case 'tool_call_start':
                  send('tool_start', {
                    name: event.toolCall!.name,
                    args: event.toolCall!.arguments,
                  })
                  break
                case 'tool_call_done':
                  send('tool_done', {
                    name: event.toolCall!.name,
                    output: event.toolResult!.output.slice(0, 2000),
                    isError: event.toolResult!.isError,
                  })
                  break
                case 'usage':
                  send('usage', event.usage)
                  break
                case 'turn_done':
                  send('done', {})
                  break
                case 'error':
                  send('error', { error: event.error })
                  break
              }
            }
          } catch (err: any) {
            send('error', { error: err.message })
          }

          controller.close()
        },
      })

      return new Response(stream, {
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        },
      })
    }

    return new Response('Not found', { status: 404 })
  },
})

console.log(`Web example running at http://localhost:${server.port}`)

// ─── Inline HTML ─────────────────────────────────────────────────────────────

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>tiny-agent</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0a0a0a;
      color: #e0e0e0;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .msg {
      max-width: 80%;
      padding: 0.75rem 1rem;
      border-radius: 0.5rem;
      white-space: pre-wrap;
      word-wrap: break-word;
      font-size: 0.9rem;
      line-height: 1.5;
    }
    .msg.user {
      align-self: flex-end;
      background: #1a3a5c;
      color: #c8e0ff;
    }
    .msg.assistant {
      align-self: flex-start;
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
    }
    .msg.tool {
      align-self: flex-start;
      background: #1a1a0a;
      border: 1px solid #3a3a1a;
      font-family: monospace;
      font-size: 0.8rem;
      color: #a0a060;
    }
    .msg.error {
      align-self: flex-start;
      background: #2a0a0a;
      border: 1px solid #5a1a1a;
      color: #ff8080;
    }
    .usage {
      font-size: 0.75rem;
      color: #606060;
      text-align: center;
      padding: 0.25rem;
    }
    #input-area {
      padding: 1rem;
      border-top: 1px solid #2a2a2a;
      display: flex;
      gap: 0.5rem;
    }
    #input {
      flex: 1;
      padding: 0.75rem 1rem;
      border-radius: 0.5rem;
      border: 1px solid #3a3a3a;
      background: #1a1a1a;
      color: #e0e0e0;
      font-size: 0.9rem;
      outline: none;
    }
    #input:focus { border-color: #4a6a8a; }
    #send {
      padding: 0.75rem 1.5rem;
      border-radius: 0.5rem;
      border: none;
      background: #2a4a6a;
      color: #c8e0ff;
      cursor: pointer;
      font-size: 0.9rem;
    }
    #send:hover { background: #3a5a7a; }
    #send:disabled { opacity: 0.5; cursor: not-allowed; }
  </style>
</head>
<body>
  <div id="messages"></div>
  <div id="input-area">
    <input id="input" type="text" placeholder="Type a message..." autofocus />
    <button id="send">Send</button>
  </div>
  <script>
    const messages = document.getElementById('messages')
    const input = document.getElementById('input')
    const sendBtn = document.getElementById('send')
    let sessionId = null
    let busy = false

    function addMsg(cls, text) {
      const el = document.createElement('div')
      el.className = 'msg ' + cls
      el.textContent = text
      messages.appendChild(el)
      messages.scrollTop = messages.scrollHeight
      return el
    }

    async function send() {
      const text = input.value.trim()
      if (!text || busy) return
      input.value = ''
      busy = true
      sendBtn.disabled = true

      addMsg('user', text)
      const assistantEl = addMsg('assistant', '')

      try {
        const res = await fetch('/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message: text, sessionId }),
        })

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          const lines = buffer.split('\\n')
          buffer = lines.pop()

          let eventType = ''
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7)
            } else if (line.startsWith('data: ')) {
              const data = JSON.parse(line.slice(6))
              switch (eventType) {
                case 'session':
                  sessionId = data.sessionId
                  break
                case 'text':
                  assistantEl.textContent += data.text
                  messages.scrollTop = messages.scrollHeight
                  break
                case 'tool_start':
                  addMsg('tool', '⚙ ' + data.name + '(' + JSON.stringify(data.args).slice(0, 100) + ')')
                  break
                case 'tool_done':
                  addMsg('tool', (data.isError ? '✗ ' : '✓ ') + data.output.slice(0, 500))
                  break
                case 'usage':
                  const u = document.createElement('div')
                  u.className = 'usage'
                  u.textContent = data.inputTokens + ' in / ' + data.outputTokens + ' out'
                  messages.appendChild(u)
                  break
                case 'error':
                  addMsg('error', data.error)
                  break
              }
            }
          }
        }
      } catch (err) {
        addMsg('error', err.message)
      }

      if (!assistantEl.textContent) assistantEl.remove()
      busy = false
      sendBtn.disabled = false
      input.focus()
    }

    sendBtn.addEventListener('click', send)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
    })
  </script>
</body>
</html>`
