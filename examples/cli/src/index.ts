import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { Agent } from '@xy69/tiny-agent'
import type { Provider } from '@xy69/tiny-agent'
import { Session } from '@xy69/tiny-agent/session'
import { OpenAIProvider, AnthropicProvider } from '@xy69/tiny-agent/providers'
import {
  toolsExtension,
  loopDetectionExtension,
  compactionExtension,
  taskExtension,
} from '@xy69/tiny-agent/extensions'
import {
  Spinner,
  MarkdownRenderer,
  renderToolStart,
  renderToolResult,
  renderUsage,
  renderError,
  renderPrompt,
  renderSessionHeader,
} from './render'
import { loadConfig, resolveApiKey, validateConfig } from './config'
import { connectCommand } from './config/connect'

const SESSIONS_DIR = join(process.cwd(), '.sessions')

function loadProjectContext(): string {
  const candidates = ['AGENT.md', '.agent.md', 'CLAUDE.md']
  for (const name of candidates) {
    const path = join(process.cwd(), name)
    if (existsSync(path)) {
      return readFileSync(path, 'utf-8')
    }
  }
  return ''
}

function createProvider(
  providerId: 'anthropic' | 'openai',
  model: string,
  baseUrl?: string
): Provider {
  const apiKey = resolveApiKey(providerId)

  if (!apiKey) {
    console.error(
      `No API key found for "${providerId}". Run /connect or set the appropriate env var.`
    )
    process.exit(1)
  }

  switch (providerId) {
    case 'anthropic':
      return new AnthropicProvider(apiKey, model)
    case 'openai':
      return new OpenAIProvider(apiKey, model, baseUrl)
    default:
      console.error(
        `Unknown provider: ${providerId}. Use "anthropic" or "openai".`
      )
      process.exit(1)
  }
}

function listSessions() {
  const sessions = Session.list(SESSIONS_DIR)
  if (sessions.length === 0) {
    console.log('No sessions found.')
    return
  }
  console.log('\nSessions:\n')
  for (const s of sessions) {
    const date = new Date(s.updatedAt).toLocaleString()
    console.log(`  ${s.id.slice(0, 8)}  ${s.title.padEnd(40)}  ${date}`)
  }
  console.log('')
}

async function main() {
  const args = process.argv.slice(2)

  if (args.includes('--help')) {
    console.log(`
Usage: bun run dev [options]

Options:
  --new              Start a new session (default)
  --resume <id>      Resume an existing session
  --list             List all sessions
  --help             Show this help

In-session commands:
  /connect           Connect a provider (add API key)
  /sessions          List all sessions
  /new               Start a new session
  /quit              Exit
`)
    process.exit(0)
  }

  if (args.includes('--list')) {
    listSessions()
    process.exit(0)
  }

  const config = loadConfig()
  const errors = validateConfig(config)
  if (errors.length > 0) {
    console.error('Invalid config:')
    for (const e of errors) console.error(`  - ${e}`)
    console.error(
      '\nCreate ~/.config/tiny-agent/config.json or agent.config.json in your project.'
    )
    process.exit(1)
  }

  const provider = createProvider(
    config.provider.id,
    config.provider.model,
    config.provider.baseUrl
  )
  const projectContext = loadProjectContext()

  const systemPrompt = projectContext
    ? `${config.systemPrompt}\n\n## Project Context\n${projectContext}`
    : config.systemPrompt

  // Determine session
  let sessionId: string
  const resumeIdx = args.indexOf('--resume')
  if (resumeIdx !== -1 && args[resumeIdx + 1]) {
    const prefix = args[resumeIdx + 1]
    const sessions = Session.list(SESSIONS_DIR)
    const match = sessions.find((s) => s.id.startsWith(prefix))
    if (!match) {
      console.error(`No session found matching: ${prefix}`)
      process.exit(1)
    }
    sessionId = match.id
    console.log(`Resuming session: ${match.title} (${sessionId.slice(0, 8)})`)
  } else {
    sessionId = crypto.randomUUID()
  }

  const session = new Session(sessionId, SESSIONS_DIR)

  // Compose extensions
  const tools = toolsExtension()
  const agent = new Agent({
    provider,
    systemPrompt,
    maxTokens: config.maxTokens,
    store: session,
    extensions: [
      tools,
      loopDetectionExtension(),
      compactionExtension({ provider, store: session }),
      taskExtension({
        provider,
        maxTokens: config.maxTokens,
        tools: tools.tools,
      }),
    ],
  })

  const rl = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  let processing = false
  let shouldExit = false

  rl.on('close', () => {
    if (processing) {
      shouldExit = true
    } else {
      console.log('\nBye.')
      process.exit(0)
    }
  })

  const promptFn = (q: string): Promise<string> =>
    new Promise((res, rej) => {
      rl.question(q, (answer: string) => res(answer))
      rl.once('close', () => rej(new Error('closed')))
    })

  console.log(renderSessionHeader(sessionId) + '\n')

  let isFirstMessage = true

  while (true) {
    let userInput: string
    try {
      userInput = await promptFn(renderPrompt())
    } catch {
      break
    }
    if (!userInput.trim()) continue

    // Slash commands
    if (userInput.startsWith('/')) {
      const cmd = userInput.trim().toLowerCase()
      switch (cmd) {
        case '/connect':
          await connectCommand(rl)
          continue
        case '/sessions':
        case '/list':
          listSessions()
          continue
        case '/new':
          console.log('Starting new session...\n')
          process.exit(0)
        case '/quit':
        case '/exit':
          console.log('Bye.')
          process.exit(0)
        case '/help':
          console.log(
            '  /connect   Connect a provider\n  /sessions  List sessions\n  /new       New session\n  /quit      Exit\n'
          )
          continue
        default:
          console.log(`Unknown command: ${cmd}. Type /help for commands.`)
          continue
      }
    }

    if (isFirstMessage) {
      session.setTitle(userInput.slice(0, 60))
      isFirstMessage = false
    }

    processing = true
    process.stdout.write('\n')

    const md = new MarkdownRenderer()
    const spinner = new Spinner()
    let currentToolName = ''
    let totalInput = 0
    let totalOutput = 0

    for await (const event of agent.run(userInput)) {
      switch (event.type) {
        case 'text_delta': {
          const rendered = md.write(event.text!)
          process.stdout.write(rendered)
          break
        }
        case 'tool_call_start': {
          const flushed = md.flush()
          if (flushed) process.stdout.write(flushed)

          currentToolName = event.toolCall!.name
          process.stdout.write(
            '\n' +
              renderToolStart(currentToolName, event.toolCall!.arguments) +
              '\n'
          )
          spinner.start(`Running ${currentToolName}...`)
          break
        }
        case 'tool_call_done': {
          spinner.stop()
          process.stdout.write(
            renderToolResult(
              currentToolName,
              event.toolResult!.output,
              event.toolResult!.isError
            ) + '\n\n'
          )
          break
        }
        case 'usage':
          totalInput += event.usage!.inputTokens
          totalOutput += event.usage!.outputTokens
          break
        case 'turn_done': {
          const flushed = md.flush()
          if (flushed) process.stdout.write(flushed)
          if (totalInput > 0 || totalOutput > 0) {
            process.stdout.write(
              '\n\n' + renderUsage(totalInput, totalOutput) + '\n'
            )
          } else {
            process.stdout.write('\n')
          }
          md.reset()
          break
        }
        case 'error':
          spinner.stop()
          process.stderr.write('\n' + renderError(event.error!) + '\n')
          break
      }
    }

    processing = false
    if (shouldExit) {
      console.log('\nBye.')
      process.exit(0)
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
