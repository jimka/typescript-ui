import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import { keepNamesMinify } from '../../build/keepNames.js'

const sub = (p: string): string => fileURLToPath(new URL(`./src/typescript/lib/${p}`, import.meta.url))

export default defineConfig({
  publicDir: 'src/resources',
  resolve: {
    alias: [
      { find: '@jimka/typescript-ui/component/input',     replacement: sub('component/input/index.ts') },
      { find: '@jimka/typescript-ui/component/button',    replacement: sub('component/button/index.ts') },
      { find: '@jimka/typescript-ui/component/display',   replacement: sub('component/display/index.ts') },
      { find: '@jimka/typescript-ui/component/editor',    replacement: sub('component/editor/index.ts') },
      { find: '@jimka/typescript-ui/component/chart',      replacement: sub('component/chart/index.ts') },
      { find: '@jimka/typescript-ui/component/list',      replacement: sub('component/list/index.ts') },
      { find: '@jimka/typescript-ui/component/container', replacement: sub('component/container/index.ts') },
      { find: '@jimka/typescript-ui/component/menubar',   replacement: sub('component/menubar/index.ts') },
      { find: '@jimka/typescript-ui/component/table',     replacement: sub('component/table/index.ts') },
      { find: '@jimka/typescript-ui/component/tree',      replacement: sub('component/tree/index.ts') },
      { find: '@jimka/typescript-ui/component/diagram',   replacement: sub('component/diagram/index.ts') },
      { find: '@jimka/typescript-ui/core',                replacement: sub('core/index.ts') },
      { find: '@jimka/typescript-ui/overlay',             replacement: sub('overlay/index.ts') },
      { find: '@jimka/typescript-ui/primitive',           replacement: sub('primitive/index.ts') },
      { find: '@jimka/typescript-ui/layout',              replacement: sub('layout/index.ts') },
      { find: '@jimka/typescript-ui/data',                replacement: sub('data/index.ts') },
      { find: '@jimka/typescript-ui/validation',          replacement: sub('validation/index.ts') },
      { find: '@jimka/typescript-ui/router',              replacement: sub('router/index.ts') },
      { find: '@jimka/typescript-ui/diagnostics',         replacement: sub('diagnostics/index.ts') },
      { find: /^@jimka\/typescript-ui\/glyphs\/(solid|regular|brands)$/, replacement: sub('glyphs/$1/index.ts') },
      { find: /^@jimka\/typescript-ui\/glyphs\/(.+)$/,    replacement: sub('glyphs/$1.ts') },
      { find: '@jimka/typescript-ui/glyphs',              replacement: sub('glyphs/index.ts') },
      { find: '~',                                        replacement: fileURLToPath(new URL('./src/typescript/lib', import.meta.url)) },
    ],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    // One self-contained app/library bundle is an intentional choice here, so
    // raise the advisory size threshold to silence the >500 kB chunk warning.
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        // The framework derives every component's CSS class (and layout
        // serialization keys) from `this.constructor.name`, so the minifier
        // must not mangle class identifiers — otherwise `constructor.name`
        // returns a short/empty string and `classList.add("")` throws,
        // blanking the production page.
        minify: keepNamesMinify,
      },
    },
  },
  server: {
    port: 8015,
  },
})
