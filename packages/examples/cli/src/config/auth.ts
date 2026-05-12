import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

export interface AuthEntry {
  apiKey: string
  addedAt: string
}

export type AuthStore = Record<string, AuthEntry>

const AUTH_DIR = join(homedir(), '.local', 'share', 'tiny-agent')
const AUTH_FILE = join(AUTH_DIR, 'auth.json')

export function loadAuth(): AuthStore {
  if (!existsSync(AUTH_FILE)) return {}
  try {
    return JSON.parse(readFileSync(AUTH_FILE, 'utf-8'))
  } catch {
    return {}
  }
}

export function saveAuth(store: AuthStore): void {
  mkdirSync(AUTH_DIR, { recursive: true })
  writeFileSync(AUTH_FILE, JSON.stringify(store, null, 2), { mode: 0o600 })
}

export function getProviderKey(provider: string): string | undefined {
  const store = loadAuth()
  return store[provider]?.apiKey
}

export function setProviderKey(provider: string, apiKey: string): void {
  const store = loadAuth()
  store[provider] = { apiKey, addedAt: new Date().toISOString() }
  saveAuth(store)
}

export function removeProvider(provider: string): void {
  const store = loadAuth()
  delete store[provider]
  saveAuth(store)
}

export function listProviders(): string[] {
  return Object.keys(loadAuth())
}
