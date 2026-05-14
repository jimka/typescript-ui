import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import { resolve } from 'node:path'

const r = (p: string): string => resolve(fileURLToPath(new URL('./src/typescript/lib', import.meta.url)), p)

export default defineConfig({
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./src/typescript/lib', import.meta.url)),
    },
  },
  build: {
    lib: {
      entry: {
        'core':                r('core/index.ts'),
        'primitive':           r('primitive/index.ts'),
        'layout':              r('layout/index.ts'),
        'data':                r('data/index.ts'),
        'validation':          r('validation/index.ts'),
        'component/input':     r('component/input/index.ts'),
        'component/button':    r('component/button/index.ts'),
        'component/display':   r('component/display/index.ts'),
        'component/list':      r('component/list/index.ts'),
        'component/container': r('component/container/index.ts'),
        'component/menubar':   r('component/menubar/index.ts'),
        'component/table':     r('component/table/index.ts'),
        'component/tree':      r('component/tree/index.ts'),
      },
      formats: ['es'],
      fileName: (_format, name) => `${name}.es.js`,
    },
    outDir: 'dist/lib',
    emptyOutDir: false,
    sourcemap: true,
    minify: 'oxc',
  },
})
