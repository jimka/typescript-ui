import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./src/typescript/lib', import.meta.url)),
    },
  },
  build: {
    lib: {
      entry: 'src/typescript/lib/index.ts',
      name: 'TypescriptUI',
      formats: ['es', 'umd'],
      fileName: (format) => `typescript-ui.${format}.js`,
    },
    outDir: 'dist/lib',
    sourcemap: true,
    minify: 'oxc',
  },
})
