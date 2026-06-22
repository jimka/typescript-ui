import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import { resolve } from 'node:path'
import { globSync } from 'node:fs'

const libRoot = fileURLToPath(new URL('./src/typescript/lib', import.meta.url))
const r = (p: string): string => resolve(libRoot, p)

const glyphEntries: Record<string, string> = Object.fromEntries(
  globSync('glyphs/**/*.ts', { cwd: libRoot }).map((rel) => {
    const key = rel.replace(/\\/g, '/').replace(/\.ts$/, '')
    return [key, resolve(libRoot, rel)]
  })
)

export default defineConfig({
  resolve: {
    alias: {
      '~': libRoot,
    },
  },
  build: {
    lib: {
      entry: {
        'core':                r('core/index.ts'),
        'overlay':             r('overlay/index.ts'),
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
        ...glyphEntries,
      },
      formats: ['es'],
      fileName: (_format, name) => `${name}.es.js`,
    },
    outDir: 'dist/lib',
    emptyOutDir: false,
    sourcemap: true,
    minify: 'oxc',
    rollupOptions: {
      output: {
        // Downstream consumers hit the same `constructor.name` dependency as
        // the app (CSS classes + layout serialization), so the library bundle
        // must preserve class identifiers through minification too.
        minify: {
          compress: { keepNames: { function: true, class: true } },
          mangle:   { keepNames: { function: true, class: true } },
        },
      },
    },
  },
})
