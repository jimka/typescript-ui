import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, searchForWorkspaceRoot } from 'vite'
import { outsideAppSource, qaLibraryPlugin, qaReportPlugin } from './vite/plugins.js'

// The QA app's own config; Vitest reads it too, so tests resolve the library
// exactly as the page does. See README.md.
const ROOT = path.dirname(fileURLToPath(import.meta.url))

// The library build under test (the run's arm). `QA_LIB` names it; without it,
// this checkout's own packages/lib — never the node_modules symlink, which in
// a worktree points at the main tree's build.
const LIB_DIR = path.resolve(process.env.QA_LIB ?? path.join(ROOT, '../lib'))

// Fixed so runqa.sh can kill a stale QA server by port without touching
// anything else, and a Tauri shell can be given the same address. None of the
// ports already in use: 8015 (the lib's demo app), 5173 and up (Vite's default
// and its fallbacks, the docs dev server), 4173 (vite preview), 1420 (Loom).
// runqa.sh's PORT must match.
const QA_PORT = 5190

export default defineConfig({
  plugins: [qaLibraryPlugin({ libDir: LIB_DIR }), qaReportPlugin({ resultsDir: path.join(ROOT, 'results') })],
  define: { __QA_LIB__: JSON.stringify(LIB_DIR) },
  // Scan dependencies from the page only, never a stray .html under the root.
  optimizeDeps: { entries: ['index.html'] },
  server: {
    port: QA_PORT,
    strictPort: true,
    // Setting `allow` replaces Vite's default (the workspace root), so put it
    // back, and add an arm that lives in another clone.
    fs: { allow: [searchForWorkspaceRoot(ROOT), LIB_DIR] },
    // Watch only the page's own source: results/ and logs/ are written during
    // every run, and a watcher on them would wake the server mid-measurement.
    watch: { ignored: outsideAppSource(ROOT) },
  },
})
