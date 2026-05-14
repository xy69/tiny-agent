import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    core: './src/core/index.ts',
    session: './src/session.ts',
    'providers/openai': './src/providers/openai.ts',
    'providers/anthropic': './src/providers/anthropic.ts',
    extensions: './src/extensions/index.ts',
  },
  format: 'esm',
  dts: true,
  deps: {
    neverBundle: ['@anthropic-ai/sdk', 'openai'],
  },
})
