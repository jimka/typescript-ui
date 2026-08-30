import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import { resolve } from 'node:path'
import { globSync } from 'node:fs'
import { keepNamesMinify } from '../../build/keepNames.js'

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
    // Mirror vite.config.ts's `@jimka/typescript-ui/*` -> source aliases. The lib
    // source imports its own sibling subpaths (e.g. `@jimka/typescript-ui/core`);
    // once npm workspaces adds a `node_modules/@jimka/typescript-ui` -> packages/lib
    // self-symlink, bare-specifier resolution could otherwise prefer that symlink's
    // exports map (-> the build's own stale dist/lib) over source. An explicit alias
    // wins over node resolution, so the lib build provably bundles source.
    alias: [
      { find: '@jimka/typescript-ui/component/input',     replacement: r('component/input/index.ts') },
      { find: '@jimka/typescript-ui/component/button',    replacement: r('component/button/index.ts') },
      { find: '@jimka/typescript-ui/component/display',   replacement: r('component/display/index.ts') },
      { find: '@jimka/typescript-ui/component/editor',    replacement: r('component/editor/index.ts') },
      { find: '@jimka/typescript-ui/component/chart',     replacement: r('component/chart/index.ts') },
      { find: '@jimka/typescript-ui/component/list',      replacement: r('component/list/index.ts') },
      { find: '@jimka/typescript-ui/component/container', replacement: r('component/container/index.ts') },
      { find: '@jimka/typescript-ui/component/menubar',   replacement: r('component/menubar/index.ts') },
      { find: '@jimka/typescript-ui/component/table',     replacement: r('component/table/index.ts') },
      { find: '@jimka/typescript-ui/component/tree',      replacement: r('component/tree/index.ts') },
      { find: '@jimka/typescript-ui/component/diagram',   replacement: r('component/diagram/index.ts') },
      { find: '@jimka/typescript-ui/core',                replacement: r('core/index.ts') },
      { find: '@jimka/typescript-ui/overlay',             replacement: r('overlay/index.ts') },
      { find: '@jimka/typescript-ui/primitive',           replacement: r('primitive/index.ts') },
      { find: '@jimka/typescript-ui/layout',              replacement: r('layout/index.ts') },
      { find: '@jimka/typescript-ui/data',                replacement: r('data/index.ts') },
      { find: '@jimka/typescript-ui/validation',          replacement: r('validation/index.ts') },
      { find: '@jimka/typescript-ui/router',              replacement: r('router/index.ts') },
      { find: '@jimka/typescript-ui/diagnostics',         replacement: r('diagnostics/index.ts') },
      { find: /^@jimka\/typescript-ui\/glyphs\/(solid|regular|brands)$/, replacement: r('glyphs/$1/index.ts') },
      { find: /^@jimka\/typescript-ui\/glyphs\/(.+)$/,    replacement: r('glyphs/$1.ts') },
      { find: '@jimka/typescript-ui/glyphs',              replacement: r('glyphs/index.ts') },
      { find: '~',                                        replacement: libRoot },
    ],
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
        'router':              r('router/index.ts'),
        'diagnostics':         r('diagnostics/index.ts'),
        'component/input':     r('component/input/index.ts'),
        'component/button':    r('component/button/index.ts'),
        'component/display':   r('component/display/index.ts'),
        'component/editor':    r('component/editor/index.ts'),
        'component/chart':     r('component/chart/index.ts'),
        'component/list':      r('component/list/index.ts'),
        'component/container': r('component/container/index.ts'),
        'component/menubar':   r('component/menubar/index.ts'),
        'component/table':     r('component/table/index.ts'),
        'component/tree':      r('component/tree/index.ts'),
        'component/diagram':   r('component/diagram/index.ts'),
        ...glyphEntries,
      },
      formats: ['es'],
      fileName: (_format, name) => `${name}.es.js`,
    },
    outDir: 'dist/lib',
    // MUST stay false: `build:lib` emits declarations to dist/lib/types (via
    // tsc) *before* this build runs, and every "types" entry in package.json's
    // exports map points into that directory. Emptying dist/lib here would
    // delete them, publishing a package whose types all 404. The build stays
    // free of stale chunks via the `rimraf dist/lib` that starts `build:lib`,
    // not via this flag.
    emptyOutDir: false,
    sourcemap: true,
    minify: 'oxc',
    rollupOptions: {
      // `marked`, the editor stacks (CodeMirror + Prettier + sql-formatter for
      // CodeEditor, the Lexical family for MarkdownEditor), and the diagram
      // family's optional `elkjs` peer dependency are all real runtime
      // dependencies resolved from the consumer's node_modules rather than
      // inlined into the chunks. A predicate matches the CodeMirror family (a
      // dozen-plus `@codemirror/*` / `@lezer/*` packages plus their own
      // dynamic-import subpaths, e.g. `prettier/plugins/babel`) and the Lexical
      // family (core `lexical` plus its `@lexical/*` feature packages); `elkjs`
      // is kept external so its lazy `import("elkjs/...")` survives verbatim and
      // its GWT bundle never lands in the core chunks.
      external: [/^(codemirror|@codemirror\/|@lezer\/|prettier|sql-formatter|marked|lexical$|@lexical\/)/, /^elkjs(\/|$)/],
      output: {
        // Downstream consumers hit the same `constructor.name` dependency as
        // the app (CSS classes + layout serialization), so the library bundle
        // must preserve class identifiers through minification too.
        minify: keepNamesMinify,
      },
    },
  },
})
