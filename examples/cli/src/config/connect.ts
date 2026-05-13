import { createInterface } from 'readline'
import { listProviders, removeProvider, setProviderKey } from './auth'

const PROVIDERS = [
  { id: 'openai', name: 'OpenAI (or compatible)', envHint: 'OPENAI_API_KEY' },
  { id: 'anthropic', name: 'Anthropic', envHint: 'ANTHROPIC_API_KEY' },
] as const

function prompt(
  rl: ReturnType<typeof createInterface>,
  q: string
): Promise<string> {
  return new Promise((res) => rl.question(q, res))
}

export async function connectCommand(
  rl: ReturnType<typeof createInterface>
): Promise<void> {
  const existing = listProviders()

  console.log('\n  Available providers:\n')
  for (let i = 0; i < PROVIDERS.length; i++) {
    const p = PROVIDERS[i]
    const connected = existing.includes(p.id) ? ' (connected)' : ''
    console.log(`  ${i + 1}. ${p.name}${connected}`)
  }
  console.log('')

  const choice = await prompt(rl, '  Select provider (number): ')
  const idx = parseInt(choice, 10) - 1

  if (idx < 0 || idx >= PROVIDERS.length) {
    console.log('  Invalid selection.\n')
    return
  }

  const provider = PROVIDERS[idx]

  if (existing.includes(provider.id)) {
    const action = await prompt(
      rl,
      `  ${provider.name} is already connected. (u)pdate key or (r)emove? [u/r]: `
    )
    if (action.toLowerCase() === 'r') {
      removeProvider(provider.id)
      console.log(`  Removed ${provider.name}.\n`)
      return
    }
  }

  const apiKey = await prompt(rl, `  API key: `)
  if (!apiKey.trim()) {
    console.log('  No key entered.\n')
    return
  }

  setProviderKey(provider.id, apiKey.trim())
  console.log(
    `  Saved ${provider.name} key to ~/.local/share/tiny-agent/auth.json\n`
  )
}
