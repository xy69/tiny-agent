import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
} from 'fs'
import { join } from 'path'
import type { Message, MessageStore } from './core/types'

export interface SessionEntry {
  id: string
  timestamp: number
  type: 'message' | 'compaction' | 'metadata'
  data: unknown
}

export class Session implements MessageStore {
  private filePath: string
  private entries: SessionEntry[] = []
  readonly id: string

  constructor(sessionId: string, baseDir: string) {
    this.id = sessionId
    mkdirSync(baseDir, { recursive: true })
    this.filePath = join(baseDir, `${sessionId}.jsonl`)

    if (existsSync(this.filePath)) {
      const raw = readFileSync(this.filePath, 'utf-8')
      this.entries = raw
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    }
  }

  private appendEntry(entry: Omit<SessionEntry, 'id' | 'timestamp'>): void {
    const full: SessionEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      ...entry,
    }
    this.entries.push(full)
    appendFileSync(this.filePath, JSON.stringify(full) + '\n')
  }

  append(message: Message): void {
    this.appendEntry({ type: 'message', data: message })
  }

  getMessages(): Message[] {
    const messages: Message[] = []
    let startFrom = 0

    // Find last compaction entry — everything before it is replaced by summary
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i].type === 'compaction') {
        const compaction = this.entries[i].data as {
          summary: string
          firstKeptIndex: number
        }
        messages.push({
          role: 'user',
          content: `[Previous context summary]: ${compaction.summary}`,
        })
        messages.push({
          role: 'assistant',
          content:
            'Understood. I have the context from our previous conversation.',
        })
        startFrom = compaction.firstKeptIndex
        break
      }
    }

    // Replay message entries from startFrom
    for (let i = startFrom; i < this.entries.length; i++) {
      const entry = this.entries[i]
      if (entry.type === 'message') {
        messages.push(entry.data as Message)
      }
    }

    return messages
  }

  compact(summary: string): void {
    const keepRecent = 6 // Keep last 3 turns (user+assistant pairs)
    const firstKeptIndex = Math.max(0, this.entries.length - keepRecent)

    this.appendEntry({
      type: 'compaction',
      data: { summary, firstKeptIndex },
    })
  }

  getEntryCount(): number {
    return this.entries.filter((e) => e.type === 'message').length
  }

  setTitle(title: string): void {
    this.appendEntry({
      type: 'metadata',
      data: { title },
    })
  }

  getTitle(): string {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i].type === 'metadata') {
        const meta = this.entries[i].data as { title?: string }
        if (meta.title) return meta.title
      }
    }
    return this.id.slice(0, 8)
  }

  static list(
    baseDir: string
  ): Array<{ id: string; title: string; updatedAt: number }> {
    if (!existsSync(baseDir)) return []

    const files = readdirSync(baseDir).filter((f) => f.endsWith('.jsonl'))
    const sessions: Array<{ id: string; title: string; updatedAt: number }> = []

    for (const file of files) {
      const id = file.replace('.jsonl', '')
      const path = join(baseDir, file)
      const raw = readFileSync(path, 'utf-8')
      const lines = raw.split('\n').filter(Boolean)

      if (lines.length === 0) continue

      const lastEntry = JSON.parse(lines[lines.length - 1]) as SessionEntry
      let title = id.slice(0, 8)

      for (let i = lines.length - 1; i >= 0; i--) {
        const entry = JSON.parse(lines[i]) as SessionEntry
        if (entry.type === 'metadata') {
          const meta = entry.data as { title?: string }
          if (meta.title) {
            title = meta.title
            break
          }
        }
      }

      sessions.push({ id, title, updatedAt: lastEntry.timestamp })
    }

    return sessions.sort((a, b) => b.updatedAt - a.updatedAt)
  }
}
