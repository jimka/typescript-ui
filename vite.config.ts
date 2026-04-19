import { defineConfig } from 'vite'

export default defineConfig({
  publicDir: 'src/resources',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 8015,
  },
})
