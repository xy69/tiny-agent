import type { Extension, Message, ToolCall } from '../core/types'

/** Extension that detects repeated identical tool calls and breaks the loop */
export function loopDetectionExtension(threshold = 3): Extension {
  const history: string[] = []

  return {
    name: 'loop-detection',

    beforeToolCall(toolCall: ToolCall) {
      const signature = `${toolCall.name}:${JSON.stringify(toolCall.arguments)}`
      history.push(signature)

      if (history.length < threshold) return true

      const recent = history.slice(-threshold)
      const isLoop = recent.every((s) => s === recent[0])

      if (isLoop) {
        history.length = 0
        const inject: Message = {
          role: 'user',
          content:
            'Loop detected: you are repeating the same tool calls. Stop and explain what you are trying to do differently.',
        }
        return { inject }
      }

      return true
    },
  }
}
