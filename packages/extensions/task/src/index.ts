import type { Extension, Provider, Tool } from '@xy69/tiny-agent'
import { Agent } from '@xy69/tiny-agent'

/** Extension that provides a task delegation tool using isolated sub-agents */
export function taskExtension(opts: {
  provider: Provider
  maxTokens: number
  tools?: Tool[]
}): Extension {
  const taskTool: Tool = {
    definition: {
      name: 'task',
      description:
        'Delegate a subtask to an isolated sub-agent. The sub-agent has access to read-only file tools and bash. Use this for research, exploration, or tasks that can be done independently.',
      parameters: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description:
              'A clear, detailed description of the task for the sub-agent to perform',
          },
        },
        required: ['description'],
      },
    },

    async execute(input) {
      const description = input.description as string

      const subAgent = new Agent({
        provider: opts.provider,
        systemPrompt:
          'You are a research sub-agent. Complete the given task thoroughly and return a concise summary of your findings. You have access to file reading tools and bash. Do NOT write or modify files.',
        maxTokens: opts.maxTokens,
        extensions: opts.tools
          ? [{ name: 'sub-agent-tools', tools: opts.tools }]
          : [],
      })

      let result = ''
      let lastError: string | undefined

      try {
        for await (const event of subAgent.run(description)) {
          if (event.type === 'text_delta') result += event.text!
          if (event.type === 'error') lastError = event.error
        }
      } catch (err: any) {
        return { output: `Sub-agent error: ${err.message}`, isError: true }
      }

      if (!result && lastError) {
        return { output: `Sub-agent failed: ${lastError}`, isError: true }
      }

      if (result.length > 50_000) {
        result = result.slice(0, 50_000) + '\n[truncated]'
      }

      return { output: result }
    },
  }

  return {
    name: 'task',
    tools: [taskTool],
  }
}
