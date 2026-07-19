import { defineConfig, type Plugin } from 'vite'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

const MODEL = fileURLToPath(new URL('../lib/docs/api/typedoc-model.json', import.meta.url))
const VIRTUAL = 'virtual:typedoc-summary'

// Reads the TypeDoc JSON model at build time and emits ONLY a small summary
// (module + documented-symbol counts). The full ~105 MB model never enters
// the client bundle. Proves the docs app can load the model — the seam the
// follow-up per-symbol IA builds on.
function typedocSummary(): Plugin {
  return {
    name: 'typedoc-summary',
    resolveId: (id) => (id === VIRTUAL ? '\0' + VIRTUAL : null),
    load(id) {
      if (id !== '\0' + VIRTUAL) return null
      let model
      try {
        model = JSON.parse(readFileSync(MODEL, 'utf8'))
      } catch {
        throw new Error(`TypeDoc model not found at ${MODEL} — run \`npm run docs:api\` first.`)
      }
      const modules = model.children ?? []
      const symbols = modules.reduce((n: number, m: any) => n + (m.children?.length ?? 0), 0)
      return `export const moduleCount = ${modules.length};\nexport const symbolCount = ${symbols};\n`
    },
  }
}

export default defineConfig({
  base: '/typescript-ui/',
  plugins: [typedocSummary()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // The framework derives every component's CSS class (and option routing) from
    // `this.constructor.name`, so the minifier must not mangle class identifiers —
    // otherwise `constructor.name` yields a mangled string, option handling breaks,
    // and the page renders "[object Object]" with unclassed elements. Mirror the
    // keepNames guard in vite.config.ts and vite.lib.config.ts.
    rollupOptions: {
      output: {
        minify: {
          compress: { keepNames: { function: true, class: true } },
          mangle:   { keepNames: { function: true, class: true } },
        },
      },
    },
  },
})
