import { defineConfig, type Plugin } from 'vite'
import { readFileSync, readdirSync, cpSync, copyFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import path from 'node:path'
import { keepNamesMinify } from '../../build/keepNames.js'

const API_DIR = fileURLToPath(new URL('../lib/docs/api', import.meta.url))
const VIRTUAL = 'virtual:typedoc-api'

// A dev request may or may not carry the app's base — Vite strips it for some
// middleware stages but not this custom one — so both forms of the same file
// path must resolve to the same file on disk.
const API_URL = /^(?:\/typescript-ui)?\/api\/(.+\.md)$/

/**
 * Recursively walks `dir` and returns every `.md` file beneath it, as a path
 * relative to `dir` with POSIX separators, sorted.
 */
function walkMarkdownFiles(dir: string, base: string = dir): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkMarkdownFiles(full, base))
    } else if (entry.name.endsWith('.md')) {
      files.push(path.relative(base, full).split(path.sep).join('/'))
    }
  }
  return files.sort()
}

// Emits the generated API tree's file list, the only input the app's nav,
// synthesized pages, and status-bar counts are all derived from; serves the
// tree's Markdown in dev; copies it into the build output. The full 708-file,
// 29 MB tree never enters the module graph — see "API Markdown is served as
// static files and fetched per page, never bundled" in
// plans/implemented/docs-typedoc-reference.md.
function typedocApi(): Plugin {
  let root = ''
  let outDir = ''
  let command: 'build' | 'serve' = 'serve'

  return {
    name: 'typedoc-api',
    resolveId: (id) => (id === VIRTUAL ? '\0' + VIRTUAL : null),
    load(id) {
      if (id !== '\0' + VIRTUAL) return null

      let apiFiles: string[]
      try {
        apiFiles = walkMarkdownFiles(API_DIR)
      } catch {
        throw new Error(`TypeDoc API tree not found at ${API_DIR} — run \`npm run docs:api\` first.`)
      }

      return `export const apiFiles = ${JSON.stringify(apiFiles)};\n`
    },
    configResolved(config) {
      root = config.root
      outDir = config.build.outDir
      command = config.command
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const match = req.url ? API_URL.exec(req.url) : null
        if (!match) {
          next()
          return
        }

        const resolved = path.resolve(API_DIR, match[1])
        if (!resolved.startsWith(API_DIR + path.sep)) {
          next()
          return
        }

        try {
          res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
          res.end(readFileSync(resolved, 'utf8'))
        } catch {
          next()
        }
      })
    },
    closeBundle() {
      // Vitest resolves this same vite.config.ts to drive its own transform
      // pipeline and stubs build.outDir to a sentinel value while doing so —
      // closeBundle must only copy during a real `vite build`, or the test
      // run would write the 30 MB API tree into that sentinel path.
      if (command !== 'build') return

      cpSync(API_DIR, path.resolve(root, outDir, 'api'), {
        recursive: true,
        filter: (src) => !src.endsWith('typedoc-model.json') && !src.endsWith('typedoc-sidebar.json'),
      })
    },
  }
}

// GitHub Pages serves the site's own 404.html for any path with no file
// behind it. A byte copy of index.html under that name boots the app for
// every unknown path, which then reads the real path itself — the SPA
// fallback History-mode routing needs. Runs as a plugin (not a workflow-level
// `cp`) so `vite preview` gets the fallback too, which is what the review
// gate exercises.
function spaFallback(): Plugin {
  let root = ''
  let outDir = ''
  let command: 'build' | 'serve' = 'serve'

  return {
    name: 'spa-fallback',
    configResolved(config) {
      root = config.root
      outDir = config.build.outDir
      command = config.command
    },
    closeBundle() {
      // Same vitest-stubbed-outDir concern as typedocApi() above.
      if (command !== 'build') return

      copyFileSync(path.resolve(root, outDir, 'index.html'), path.resolve(root, outDir, '404.html'))
    },
  }
}

export default defineConfig({
  base: '/typescript-ui/',
  plugins: [typedocApi(), spaFallback()],
  // packages/lib/docs/ sits outside this package root; without this the dev
  // server 404s the raw `?raw` glob reads in pages.ts even though the
  // production build (which bundles them at build time) is unaffected.
  server: {
    fs: { allow: ['../..'] },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // The framework derives every component's CSS class (and option routing) from
    // `this.constructor.name`, so the minifier must not mangle class identifiers —
    // otherwise `constructor.name` yields a mangled string, option handling breaks,
    // and the page renders "[object Object]" with unclassed elements.
    rollupOptions: {
      output: {
        minify: keepNamesMinify,
      },
    },
  },
})
