import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  publicDir: 'src/resources',
  resolve: {
    alias: {
      '@jimka/typescript-ui': fileURLToPath(new URL('./src/typescript/lib/index.ts', import.meta.url)),
      '~': fileURLToPath(new URL('./src/typescript/lib', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 8015,
  },
})
