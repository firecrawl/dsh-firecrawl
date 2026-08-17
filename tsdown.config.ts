import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/fetch.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: true,
  sourcemap: false,
  clean: true,
  fixedExtension: false,
  deps: {
    neverBundle: [
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-launch-environment',
      '@deepseek-ai/dsh-web',
      '@deepseek-ai/schemastery',
    ],
  },
})
