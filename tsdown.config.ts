import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    'core': './packages/core/src/index.ts',
    'session': './packages/session/src/index.ts',
    'providers': './packages/providers/index.ts',
    'extensions': './packages/extensions/index.ts',
  },
  format: 'esm',
  dts: true,
  deps: {
    neverBundle: ['@anthropic-ai/sdk', 'openai'],
  },
})
