import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

const sub = (p: string): string => fileURLToPath(new URL(`./src/typescript/lib/${p}`, import.meta.url))

export default defineConfig({
  publicDir: 'src/resources',
  resolve: {
    alias: [
      { find: '@jimka/typescript-ui/component/input',     replacement: sub('component/input/index.ts') },
      { find: '@jimka/typescript-ui/component/button',    replacement: sub('component/button/index.ts') },
      { find: '@jimka/typescript-ui/component/display',   replacement: sub('component/display/index.ts') },
      { find: '@jimka/typescript-ui/component/list',      replacement: sub('component/list/index.ts') },
      { find: '@jimka/typescript-ui/component/container', replacement: sub('component/container/index.ts') },
      { find: '@jimka/typescript-ui/component/menubar',   replacement: sub('component/menubar/index.ts') },
      { find: '@jimka/typescript-ui/component/table',     replacement: sub('component/table/index.ts') },
      { find: '@jimka/typescript-ui/component/tree',      replacement: sub('component/tree/index.ts') },
      { find: '@jimka/typescript-ui/core',                replacement: sub('core/index.ts') },
      { find: '@jimka/typescript-ui/primitive',           replacement: sub('primitive/index.ts') },
      { find: '@jimka/typescript-ui/layout',              replacement: sub('layout/index.ts') },
      { find: '@jimka/typescript-ui/data',                replacement: sub('data/index.ts') },
      { find: '@jimka/typescript-ui/validation',          replacement: sub('validation/index.ts') },
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
  },
  server: {
    port: 8015,
  },
})
