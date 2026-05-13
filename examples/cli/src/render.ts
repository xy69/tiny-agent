// ANSI color helpers
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
  bgGray: '\x1b[48;5;236m',
  white: '\x1b[37m',
}

// Spinner for tool execution
export class Spinner {
  private frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  private interval: ReturnType<typeof setInterval> | null = null
  private frameIdx = 0
  private message = ''

  start(message: string) {
    this.message = message
    this.frameIdx = 0
    process.stdout.write('\x1b[?25l') // hide cursor
    this.render()
    this.interval = setInterval(() => this.render(), 80)
  }

  stop(result?: string) {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
    process.stdout.write('\r\x1b[K') // clear line
    process.stdout.write('\x1b[?25h') // show cursor
    if (result) {
      process.stdout.write(result + '\n')
    }
  }

  private render() {
    const frame = this.frames[this.frameIdx % this.frames.length]
    process.stdout.write(
      `\r\x1b[K${c.cyan}${frame}${c.reset} ${c.dim}${this.message}${c.reset}`
    )
    this.frameIdx++
  }
}

// Render tool call header
export function renderToolStart(name: string, args: Record<string, unknown>) {
  const argsPreview = formatArgs(args)
  return `${c.cyan}${c.bold}┌ ${name}${c.reset}${argsPreview ? `${c.dim} ${argsPreview}${c.reset}` : ''}`
}

// Render tool result
export function renderToolResult(
  name: string,
  output: string,
  isError?: boolean
) {
  const color = isError ? c.red : c.green
  const icon = isError ? '✗' : '✓'
  const preview = output.split('\n').slice(0, 3).join('\n  ')
  const truncated = output.length > 200 ? '...' : ''
  return `${color}└ ${icon} ${name}${c.reset}${c.dim}\n  ${preview.slice(0, 200)}${truncated}${c.reset}`
}

// Render usage stats
export function renderUsage(inputTokens: number, outputTokens: number) {
  return `${c.gray}[${inputTokens.toLocaleString()} in / ${outputTokens.toLocaleString()} out]${c.reset}`
}

// Render error
export function renderError(error: string) {
  return `${c.red}${c.bold}error:${c.reset} ${error}`
}

// Render the prompt
export function renderPrompt() {
  return `${c.green}${c.bold}> ${c.reset}`
}

// Render session header
export function renderSessionHeader(sessionId: string) {
  return `${c.dim}Session: ${sessionId.slice(0, 8)}${c.reset} ${c.dim}| Type /help for commands.${c.reset}`
}

// Basic inline markdown rendering for streamed text
export function renderMarkdownLine(line: string): string {
  // Code blocks are handled at a higher level
  // Inline code
  line = line.replace(/`([^`]+)`/g, `${c.bgGray}${c.white} $1 ${c.reset}`)
  // Bold
  line = line.replace(/\*\*([^*]+)\*\*/g, `${c.bold}$1${c.reset}`)
  // Italic
  line = line.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, `${c.italic}$1${c.reset}`)
  // Headers
  if (line.match(/^#{1,3} /)) {
    line = `${c.bold}${c.cyan}${line}${c.reset}`
  }
  // Bullet points
  if (line.match(/^\s*[-*] /)) {
    line = line.replace(/^(\s*)([-*])/, `$1${c.cyan}$2${c.reset}`)
  }
  return line
}

/**
 * Streaming markdown renderer that handles code blocks
 * across multiple text_delta events.
 *
 * Strategy: stream text directly for responsiveness.
 * Code blocks get dimmed. That's it — no line rewriting tricks.
 */
export class MarkdownRenderer {
  private inCodeBlock = false

  /**
   * Feed text into the renderer. Returns the string to write to stdout.
   */
  write(text: string): string {
    // Track code block state
    if (text.includes('```')) {
      const parts = text.split('```')
      let output = ''
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) {
          this.inCodeBlock = !this.inCodeBlock
          output += `${c.dim}\`\`\``
          if (!this.inCodeBlock) output += c.reset
        }
        output += this.inCodeBlock ? `${c.dim}${parts[i]}` : parts[i]
      }
      return output
    }

    if (this.inCodeBlock) {
      return `${c.dim}${text}${c.reset}`
    }
    return text
  }

  /**
   * Flush at end of response (no-op now since we stream directly)
   */
  flush(): string {
    if (this.inCodeBlock) {
      this.inCodeBlock = false
      return c.reset
    }
    return ''
  }

  reset() {
    this.inCodeBlock = false
  }
}

function formatArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args)
  if (entries.length === 0) return ''
  // Show first meaningful arg
  for (const [key, val] of entries) {
    if (key === 'path' || key === 'command' || key === 'pattern') {
      const s = String(val)
      return s.length > 60 ? s.slice(0, 60) + '...' : s
    }
  }
  const json = JSON.stringify(args)
  return json.length > 80 ? json.slice(0, 80) + '...' : json
}
