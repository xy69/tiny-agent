import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { getProviderKey } from './auth'

export interface ProviderConfig {
  id: 'anthropic' | 'openai'
  model: string
  baseUrl?: string
}

export interface AgentConfig {
  provider: ProviderConfig
  maxTokens: number
  systemPrompt: string
}

const GLOBAL_CONFIG_DIR = join(homedir(), '.config', 'tiny-agent')
const GLOBAL_CONFIG_FILE = join(GLOBAL_CONFIG_DIR, 'config.json')
const PROJECT_CONFIG_FILE = 'agent.config.json'

function resolveEnvVars(value: string): string {
  return value.replace(/\{env:([^}]+)\}/g, (_, name) => process.env[name] ?? '')
}

function resolveValues(obj: unknown): unknown {
  if (typeof obj === 'string') return resolveEnvVars(obj)
  if (Array.isArray(obj)) return obj.map(resolveValues)
  if (typeof obj === 'object' && obj !== null) {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(obj)) {
      result[key] = resolveValues(val)
    }
    return result
  }
  return obj
}

function readJsonFile(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null
  try {
    const raw = readFileSync(path, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...base }
  for (const [key, val] of Object.entries(override)) {
    if (
      typeof val === 'object' &&
      val !== null &&
      !Array.isArray(val) &&
      typeof result[key] === 'object' &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        val as Record<string, unknown>
      )
    } else {
      result[key] = val
    }
  }
  return result
}

export function loadConfig(): AgentConfig {
  // Load global config
  const global = readJsonFile(GLOBAL_CONFIG_FILE) ?? {}

  // Load project config (walk up to git root)
  const projectPath = findProjectConfig()
  const project = projectPath ? (readJsonFile(projectPath) ?? {}) : {}

  // Merge: project overrides global
  const merged = deepMerge(global, project) as Record<string, unknown>

  // Resolve env vars
  const resolved = resolveValues(merged) as Record<string, unknown>

  // Resolve API key from auth store
  const providerConfig = resolveProvider(resolved)

  return {
    provider: providerConfig,
    maxTokens: (resolved.maxTokens as number) || 16384,
    systemPrompt:
      (resolved.systemPrompt as string) ||
      'You are a helpful coding assistant.',
  }
}

function resolveProvider(config: Record<string, unknown>): ProviderConfig {
  const provider = config.provider as
    | Record<string, unknown>
    | string
    | undefined

  // Simple format: { provider: "openai", model: "...", ... }
  if (typeof provider === 'string') {
    return {
      id: provider as 'anthropic' | 'openai',
      model: (config.model as string) || 'claude-sonnet-4-20250514',
      baseUrl: config.baseUrl as string | undefined,
    }
  }

  // Object format: { provider: { id: "openai", model: "...", baseUrl: "..." } }
  if (typeof provider === 'object' && provider !== null) {
    return {
      id: (provider.id as 'anthropic' | 'openai') || 'openai',
      model:
        (provider.model as string) ||
        (config.model as string) ||
        'claude-sonnet-4-20250514',
      baseUrl: provider.baseUrl as string | undefined,
    }
  }

  // Fallback
  return {
    id: 'openai',
    model: (config.model as string) || 'claude-sonnet-4-20250514',
    baseUrl: config.baseUrl as string | undefined,
  }
}

export function resolveApiKey(providerId: string): string {
  // 1. Config file apiKey
  const projectPath = findProjectConfig()
  const project = projectPath ? (readJsonFile(projectPath) ?? {}) : {}
  const global = readJsonFile(GLOBAL_CONFIG_FILE) ?? {}
  const merged = deepMerge(global, project)
  if (merged.apiKey && typeof merged.apiKey === 'string') {
    const resolved = resolveEnvVars(merged.apiKey)
    if (resolved) return resolved
  }

  // 2. Auth store (from /connect)
  const stored = getProviderKey(providerId)
  if (stored) return stored

  // 3. Environment variables
  const envMap: Record<string, string[]> = {
    anthropic: ['ANTHROPIC_API_KEY'],
    openai: ['OPENAI_API_KEY', 'AGENT_API_KEY'],
  }
  for (const envVar of envMap[providerId] ?? []) {
    if (process.env[envVar]) return process.env[envVar]!
  }

  // 4. Generic fallback
  if (process.env.AGENT_API_KEY) return process.env.AGENT_API_KEY
  if (process.env.API_KEY) return process.env.API_KEY

  return ''
}

function findProjectConfig(): string | null {
  let dir = process.cwd()
  while (true) {
    const candidate = join(dir, PROJECT_CONFIG_FILE)
    if (existsSync(candidate)) return candidate

    // Also check for .git to stop traversal
    if (existsSync(join(dir, '.git'))) {
      // Check one more time in git root
      return existsSync(candidate) ? candidate : null
    }

    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  return null
}

export function validateConfig(config: AgentConfig): string[] {
  const errors: string[] = []

  if (
    !config.provider.id ||
    !['anthropic', 'openai'].includes(config.provider.id)
  ) {
    errors.push('provider.id must be "anthropic" or "openai"')
  }
  if (!config.provider.model || typeof config.provider.model !== 'string') {
    errors.push('provider.model must be a non-empty string')
  }
  if (config.maxTokens < 1) {
    errors.push('maxTokens must be a positive number')
  }
  if (!config.systemPrompt) {
    errors.push('systemPrompt must be a non-empty string')
  }

  return errors
}

export function getGlobalConfigPath(): string {
  return GLOBAL_CONFIG_FILE
}

export function getGlobalConfigDir(): string {
  return GLOBAL_CONFIG_DIR
}
