import type { Extension, Message, Provider } from '@xy69/tiny-agent'

export interface CompactableStore {
  compact(summary: string): void
}

/** Extension that compacts context when approaching token limits */
export function compactionExtension(opts: {
  provider: Provider
  store?: CompactableStore
  contextLimit?: number
  keepRecent?: number
}): Extension {
  const contextLimit = opts.contextLimit ?? 100_000
  const keepRecent = opts.keepRecent ?? 6

  function estimateTokens(messages: Message[]): number {
    return messages.reduce((sum, m) => sum + (m.content?.length ?? 0) / 4, 0)
  }

  async function summarize(messages: Message[]): Promise<string> {
    const summaryPrompt = `Summarize the following conversation context concisely. Focus on: what the user asked for, what was accomplished, what files were modified, and any important decisions made.\n\n${messages.map((m) => `[${m.role}]: ${m.content?.slice(0, 500)}`).join('\n')}`

    let summary = ''
    const stream = opts.provider.stream(
      [{ role: 'user', content: summaryPrompt }],
      [],
      'You are a summarization assistant. Be concise.',
      2048
    )

    for await (const chunk of stream) {
      if (chunk.type === 'text') summary += chunk.text
    }

    return summary
  }

  return {
    name: 'compaction',

    async beforeSend(messages: Message[]) {
      const tokens = estimateTokens(messages)
      if (tokens < contextLimit * 0.8) return messages
      if (messages.length <= keepRecent) return messages

      const recentMessages = messages.slice(-keepRecent)
      const oldMessages = messages.slice(0, -keepRecent)

      const summary = await summarize(oldMessages)

      opts.store?.compact(summary)

      return [
        {
          role: 'user' as const,
          content: `[Previous context summary]: ${summary}`,
        },
        {
          role: 'assistant' as const,
          content:
            'Understood. I have the context from our previous conversation.',
        },
        ...recentMessages,
      ]
    },
  }
}
