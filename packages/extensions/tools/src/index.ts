import type { Extension, Tool } from '@xy69/tiny-agent'
import { readFile } from 'fs/promises'
import { resolve } from 'path'
import { spawn } from 'child_process'

const MAX_OUTPUT = 50_000

const readFileTool: Tool = {
  definition: {
    name: 'read_file',
    description:
      'Read the contents of a file. Returns the file content with line numbers.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        offset: {
          type: 'number',
          description: 'Line to start from (1-indexed, default: 1)',
        },
        limit: {
          type: 'number',
          description: 'Max lines to read (default: 200)',
        },
      },
      required: ['path'],
    },
  },
  async execute(input) {
    const path = resolve(input.path as string)
    const offset = ((input.offset as number) || 1) - 1
    const limit = (input.limit as number) || 200
    try {
      const content = await readFile(path, 'utf-8')
      const lines = content.split('\n')
      const slice = lines.slice(offset, offset + limit)
      const numbered = slice
        .map((line, i) => `${offset + i + 1}: ${line}`)
        .join('\n')
      let output = numbered
      if (output.length > MAX_OUTPUT)
        output = output.slice(0, MAX_OUTPUT) + '\n[truncated]'
      const meta =
        lines.length > offset + limit
          ? `\n\n(Showing lines ${offset + 1}-${offset + slice.length} of ${lines.length} total)`
          : ''
      return { output: output + meta }
    } catch (err: any) {
      return { output: `Error reading file: ${err.message}`, isError: true }
    }
  },
}

const writeFileTool: Tool = {
  definition: {
    name: 'write_file',
    description:
      "Write content to a file. Creates the file and parent directories if they don't exist.",
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['path', 'content'],
    },
  },
  async execute(input) {
    const path = resolve(input.path as string)
    const content = input.content as string
    try {
      const { mkdir, writeFile } = await import('fs/promises')
      const { dirname } = await import('path')
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, content, 'utf-8')
      return { output: `Wrote ${content.length} bytes to ${path}` }
    } catch (err: any) {
      return { output: `Error writing file: ${err.message}`, isError: true }
    }
  },
}

const editTool: Tool = {
  definition: {
    name: 'edit_file',
    description:
      'Edit a file. Supports two modes:\n' +
      '1. String replacement: provide edits[].oldText and edits[].newText\n' +
      '2. Line-range replacement: provide edits[].startLine, edits[].endLine, and edits[].newText\n' +
      'Edits are applied sequentially. Line numbers refer to the state after previous edits.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to edit' },
        edits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              oldText: {
                type: 'string',
                description: 'Exact text to find (string replacement mode)',
              },
              newText: {
                type: 'string',
                description: 'Text to replace with',
              },
              startLine: {
                type: 'number',
                description:
                  'First line to replace, 1-indexed (line-range mode)',
              },
              endLine: {
                type: 'number',
                description:
                  'Last line to replace, inclusive, 1-indexed (line-range mode)',
              },
            },
            required: ['newText'],
          },
        },
      },
      required: ['path', 'edits'],
    },
  },
  async execute(input) {
    const path = resolve(input.path as string)
    const edits = input.edits as Array<{
      oldText?: string
      newText: string
      startLine?: number
      endLine?: number
    }>
    try {
      const { readFile, writeFile } = await import('fs/promises')
      let content = await readFile(path, 'utf-8')
      const applied: string[] = []
      const failed: string[] = []

      for (const edit of edits) {
        if (edit.startLine != null && edit.endLine != null) {
          // Line-range mode
          const lines = content.split('\n')
          const start = edit.startLine - 1
          const end = edit.endLine

          if (start < 0 || end > lines.length || start >= end) {
            failed.push(
              `Invalid range: lines ${edit.startLine}-${edit.endLine} (file has ${lines.length} lines)`
            )
            continue
          }

          const removed = lines.slice(start, end)
          const newLines = edit.newText.split('\n')
          lines.splice(start, end - start, ...newLines)
          content = lines.join('\n')
          applied.push(
            `Replaced lines ${edit.startLine}-${edit.endLine} (${removed.length} lines → ${newLines.length} lines)`
          )
        } else if (edit.oldText != null) {
          // String replacement mode
          if (!content.includes(edit.oldText)) {
            // Try to help: find similar lines
            const hint = findSimilar(content, edit.oldText)
            failed.push(
              `Not found: "${truncate(edit.oldText, 60)}"${hint ? `\n  Did you mean: "${truncate(hint, 60)}"` : ''}`
            )
            continue
          }
          const count = content.split(edit.oldText).length - 1
          if (count > 1) {
            failed.push(
              `Ambiguous (${count} matches): "${truncate(edit.oldText, 60)}"\n  Provide more surrounding context to make the match unique.`
            )
            continue
          }
          content = content.replace(edit.oldText, edit.newText)
          applied.push(
            `Replaced: "${truncate(edit.oldText, 40)}" → "${truncate(edit.newText, 40)}"`
          )
        } else {
          failed.push(
            'Invalid edit: provide either oldText or startLine+endLine'
          )
        }
      }

      if (applied.length > 0) await writeFile(path, content, 'utf-8')
      let output = ''
      if (applied.length > 0)
        output += `Applied ${applied.length} edit(s):\n${applied.join('\n')}`
      if (failed.length > 0)
        output +=
          (output ? '\n\n' : '') +
          `Failed ${failed.length} edit(s):\n${failed.join('\n')}`
      return { output, isError: failed.length > 0 && applied.length === 0 }
    } catch (err: any) {
      return { output: `Error: ${err.message}`, isError: true }
    }
  },
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s
}

function findSimilar(content: string, target: string): string | null {
  // Try to find a line that's close to the first line of the target
  const targetFirst = target.split('\n')[0].trim()
  if (targetFirst.length < 5) return null

  const lines = content.split('\n')
  let best: string | null = null
  let bestScore = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    // Simple: check if most of the target's first line appears in this line
    const score = longestCommonSubstring(targetFirst, trimmed)
    if (score > targetFirst.length * 0.6 && score > bestScore) {
      bestScore = score
      best = line
    }
  }

  return best
}

function longestCommonSubstring(a: string, b: string): number {
  if (a.length > 100 || b.length > 100) {
    // Fast path: just check inclusion of substrings
    const shorter = a.length < b.length ? a : b
    const longer = a.length < b.length ? b : a
    for (let len = shorter.length; len >= 5; len--) {
      for (let i = 0; i <= shorter.length - len; i++) {
        if (longer.includes(shorter.slice(i, i + len))) return len
      }
    }
    return 0
  }
  let max = 0
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      let k = 0
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++
      if (k > max) max = k
    }
  }
  return max
}

function execCommand(
  args: string[],
  timeout: number
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(args[0], args.slice(1), {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
    })
    const chunks: Buffer[] = []
    const errChunks: Buffer[] = []
    proc.stdout!.on('data', (d) => chunks.push(d))
    proc.stderr!.on('data', (d) => errChunks.push(d))
    proc.on('error', reject)
    proc.on('close', (code) => {
      resolve({
        stdout: Buffer.concat(chunks).toString(),
        stderr: Buffer.concat(errChunks).toString(),
        exitCode: code ?? 1,
      })
    })
  })
}

const bashTool: Tool = {
  definition: {
    name: 'bash',
    description: 'Execute a shell command and return stdout/stderr.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
        timeout: {
          type: 'number',
          description: 'Timeout in ms (default: 30000)',
        },
      },
      required: ['command'],
    },
  },
  async execute(input) {
    const command = input.command as string
    const timeout = (input.timeout as number) || 30_000
    try {
      const { stdout, stderr, exitCode } = await execCommand(
        ['sh', '-c', command],
        timeout
      )
      let output = ''
      if (stdout) output += stdout
      if (stderr) output += (output ? '\n' : '') + `[stderr]: ${stderr}`
      output += `\n[exit code: ${exitCode}]`
      if (output.length > MAX_OUTPUT)
        output = output.slice(0, MAX_OUTPUT) + '\n[truncated]'
      return { output, isError: exitCode !== 0 }
    } catch (err: any) {
      return { output: `Error: ${err.message}`, isError: true }
    }
  },
}

const globTool: Tool = {
  definition: {
    name: 'glob',
    description: 'Find files matching a glob pattern.',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern (e.g. "**/*.ts")',
        },
        path: {
          type: 'string',
          description: 'Directory to search in (default: cwd)',
        },
      },
      required: ['pattern'],
    },
  },
  async execute(input) {
    const pattern = input.pattern as string
    const cwd = (input.path as string) || process.cwd()
    try {
      const { readdir, stat } = await import('fs/promises')
      const { join, relative } = await import('path')

      const matches: string[] = []

      function matchGlob(filepath: string, pat: string): boolean {
        // Convert glob to regex
        const regexStr = pat
          .replace(/\*\*/g, '{{GLOBSTAR}}')
          .replace(/\*/g, '[^/]*')
          .replace(/\?/g, '[^/]')
          .replace(/\{\{GLOBSTAR\}\}/g, '.*')
        return new RegExp(`^${regexStr}$`).test(filepath)
      }

      async function walk(dir: string) {
        if (matches.length >= 500) return
        const items = await readdir(dir)
        for (const item of items) {
          if (matches.length >= 500) return
          if (item.startsWith('.') || item === 'node_modules') continue
          const full = join(dir, item)
          const rel = relative(cwd, full)
          const s = await stat(full)
          if (s.isDirectory()) {
            await walk(full)
          } else if (matchGlob(rel, pattern)) {
            matches.push(rel)
          }
        }
      }

      await walk(cwd)
      if (matches.length === 0)
        return { output: 'No files found matching pattern.' }
      let output = matches.join('\n')
      if (matches.length >= 500) output += '\n\n[truncated at 500 results]'
      return { output }
    } catch (err: any) {
      return { output: `Error: ${err.message}`, isError: true }
    }
  },
}

const grepTool: Tool = {
  definition: {
    name: 'grep',
    description: 'Search file contents using a regex pattern.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex pattern' },
        path: {
          type: 'string',
          description: 'Directory to search in (default: cwd)',
        },
        include: {
          type: 'string',
          description: 'File glob to include (e.g. "*.ts")',
        },
      },
      required: ['pattern'],
    },
  },
  async execute(input) {
    const pattern = input.pattern as string
    const cwd = (input.path as string) || process.cwd()
    const include = input.include as string | undefined
    try {
      const args = ['rg', '--line-number', '--no-heading', '--color=never']
      if (include) args.push(`--glob=${include}`)
      args.push(pattern, cwd)
      const { stdout, stderr, exitCode } = await execCommand(args, 15_000)
      if (exitCode === 1) return { output: 'No matches found.' }
      if (exitCode !== 0 && exitCode !== 1)
        return { output: `grep error: ${stderr}`, isError: true }
      const lines = stdout.split('\n').filter(Boolean)
      let output = lines.slice(0, 100).join('\n')
      if (lines.length > 100)
        output += `\n\n[${lines.length - 100} more matches truncated]`
      if (output.length > MAX_OUTPUT)
        output = output.slice(0, MAX_OUTPUT) + '\n[truncated]'
      return { output }
    } catch (err: any) {
      return { output: `Error: ${err.message}`, isError: true }
    }
  },
}

const listFilesTool: Tool = {
  definition: {
    name: 'list_files',
    description: 'List files and directories at a given path.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path (default: cwd)' },
        recursive: {
          type: 'boolean',
          description: 'List recursively (default: false)',
        },
      },
    },
  },
  async execute(input) {
    const { readdir, stat } = await import('fs/promises')
    const { join, relative } = await import('path')
    const dir = resolve((input.path as string) || process.cwd())
    const recursive = (input.recursive as boolean) || false
    try {
      const entries: string[] = []
      async function walk(current: string) {
        const items = await readdir(current)
        for (const item of items) {
          if (entries.length >= 200) return
          if (item.startsWith('.') || item === 'node_modules') continue
          const full = join(current, item)
          const rel = relative(dir, full)
          const s = await stat(full)
          if (s.isDirectory()) {
            entries.push(rel + '/')
            if (recursive) await walk(full)
          } else {
            entries.push(rel)
          }
        }
      }
      await walk(dir)
      if (entries.length === 0) return { output: 'Empty directory.' }
      let output = entries.join('\n')
      if (entries.length >= 200) output += '\n\n[truncated at 200 entries]'
      return { output }
    } catch (err: any) {
      return { output: `Error: ${err.message}`, isError: true }
    }
  },
}

/** Extension that provides the standard file/shell tools */
export function toolsExtension(): Extension {
  return {
    name: 'tools',
    tools: [
      readFileTool,
      writeFileTool,
      editTool,
      bashTool,
      globTool,
      grepTool,
      listFilesTool,
    ],
  }
}
