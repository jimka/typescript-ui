/**
 * The minifier guard every in-repo Vite build shares. The framework derives
 * every component's CSS class (and layout-serialization keys) from
 * `this.constructor.name`, so a mangled class identifier yields a short or
 * empty string, `classList.add("")` throws, and the built page blanks.
 *
 * packages/create-app/template/vite.config.ts deliberately keeps its own
 * literal copy — it ships to a consumer's machine where this file does not
 * exist.
 */
export const keepNamesMinify = {
  compress: { keepNames: { function: true, class: true } },
  mangle:   { keepNames: { function: true, class: true } },
}
