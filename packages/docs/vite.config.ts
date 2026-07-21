import { defineConfig, type Plugin } from 'vite'
import { readFileSync, readdirSync, cpSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import path from 'node:path'

const API_DIR = fileURLToPath(new URL('../lib/docs/api', import.meta.url))
const VIRTUAL = 'virtual:typedoc-api'
const SIDEBAR_JSON = path.join(API_DIR, 'typedoc-sidebar.json')

// A dev request may or may not carry the app's base — Vite strips it for some
// middleware stages but not this custom one — so both forms of the same file
// path must resolve to the same file on disk.
const API_URL = /^(?:\/typescript-ui\/next)?\/api\/(.+\.md)$/

/** One entry of the raw `typedoc-sidebar.json`, as `typedoc-vitepress-theme` emits it. */
interface SidebarItem {
  text:  string
  link?: string
  items?: SidebarItem[]
}

/** The navigation node shape the docs app consumes — see `env.d.ts`'s `ApiNavNode`. */
interface ApiNavNode {
  label: string
  path: string | null
  children: ApiNavNode[]
}

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

/**
 * Converts a VitePress sidebar `link` (e.g. `/api/core/classes/Component.md`
 * or `/api/core/`) to the app's route form (`/api/core/classes/Component` or
 * `/api/core`). `undefined` (a grouping-only entry) maps to `null`.
 */
function routeFromLink(link: string | undefined): string | null {
  if (link === undefined) return null
  if (link.endsWith('.md')) return link.slice(0, -'.md'.length)
  return link.slice(0, -1) // drop the trailing "/"
}

/**
 * Splices away every category node — one with no `link` but with `items` —
 * by replacing it with its own (recursively flattened) children in place.
 * TypeDoc emits a category under every module (`Components` / `Core` /
 * `Other`, …) and, one level deeper, under every namespace (`Interfaces` /
 * `Functions`, …); both carry almost no information over the heading
 * structure the page already has, so both are flattened by the same rule.
 * A node that itself has a `link` is never flattened — only its children
 * pass through this function again, so a real page's own subtree is
 * flattened without the page itself disappearing.
 */
function flattenItems(items: SidebarItem[]): ApiNavNode[] {
  const result: ApiNavNode[] = []
  for (const item of items) {
    if (item.link === undefined && item.items) {
      result.push(...flattenItems(item.items))
    } else {
      result.push({
        label: item.text,
        path: routeFromLink(item.link),
        children: item.items ? flattenItems(item.items) : [],
      })
    }
  }
  return result
}

/**
 * Builds the app's nav tree from the raw sidebar array. Every top-level entry
 * is kept as its own node even when it has no `link` — `component` is the one
 * top-level entry with no page of its own, and its parent is the tree root,
 * not a module, so it stays as a grouping node rather than being flattened.
 */
function buildApiNav(sidebar: SidebarItem[]): ApiNavNode[] {
  return sidebar.map((item) => ({
    label: item.text,
    path: routeFromLink(item.link),
    children: item.items ? flattenItems(item.items) : [],
  }))
}

/**
 * Recursively counts every sidebar entry matching `predicate`, over the raw
 * (unflattened) tree — flattening only changes nesting, never which entries
 * exist, so counting before or after gives the same totals.
 */
function countMatching(items: SidebarItem[], predicate: (item: SidebarItem) => boolean): number {
  let count = 0
  for (const item of items) {
    if (predicate(item)) count += 1
    if (item.items) count += countMatching(item.items, predicate)
  }
  return count
}

function isModuleLink(item: SidebarItem): boolean {
  return item.link !== undefined && item.link.endsWith('/') && !item.link.includes('/namespaces/')
}

function isSymbolLink(item: SidebarItem): boolean {
  return item.link !== undefined && item.link.endsWith('.md')
}

/**
 * Reads and parses `typedoc-sidebar.json`, throwing the same named error the
 * plugin has always thrown when the generated tree is missing or stale.
 */
function readSidebar(): SidebarItem[] {
  try {
    return JSON.parse(readFileSync(SIDEBAR_JSON, 'utf8'))
  } catch {
    throw new Error(`TypeDoc API tree not found at ${API_DIR} — run \`npm run docs:api\` first.`)
  }
}

// Emits the generated API tree's file list, nav tree, and the two counts the
// status bar shows; serves the tree's Markdown in dev; copies it into the
// build output. The full 696-file, 29 MB tree never enters the module graph —
// see "API Markdown is served as static files and fetched per page, never
// bundled" in plans/implemented/docs-typedoc-reference.md.
function typedocApi(): Plugin {
  let root = ''
  let outDir = ''
  let command: 'build' | 'serve' = 'serve'

  return {
    name: 'typedoc-api',
    resolveId: (id) => (id === VIRTUAL ? '\0' + VIRTUAL : null),
    load(id) {
      if (id !== '\0' + VIRTUAL) return null

      const sidebar = readSidebar()
      const apiFiles = walkMarkdownFiles(API_DIR)
      const apiNav = buildApiNav(sidebar)
      const moduleCount = countMatching(sidebar, isModuleLink)
      const symbolCount = countMatching(sidebar, isSymbolLink)

      return `export const apiFiles = ${JSON.stringify(apiFiles)};\n`
        + `export const apiNav = ${JSON.stringify(apiNav)};\n`
        + `export const moduleCount = ${moduleCount};\n`
        + `export const symbolCount = ${symbolCount};\n`
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

export default defineConfig({
  base: '/typescript-ui/next/',
  plugins: [typedocApi()],
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
