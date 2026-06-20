# Production Build — Preserve Runtime Class Names — Implementation Plan

## Overview

The production build (`npm run build` → `vite build`) ships a blank page. The bootstrap throws
`Uncaught SyntaxError: Failed to execute 'add' on 'DOMTokenList': The token provided must not be empty.`
because the framework derives every component's CSS class from its runtime class name —
[`BaseObject.ts:45`](../src/typescript/lib/core/BaseObject.ts#L45) returns `this.constructor.name` from `getClassName`, and
[`Component.ts:4566`](../src/typescript/lib/core/Component.ts#L4566) feeds `this.constructor.name` into
`DOM.sink.apply(element, { addClass: [...] })`, which lands at
[`DOM.ts:305`](../src/typescript/lib/core/DOM.ts#L305) (`element.classList.add(name)`). The default `oxc` minifier mangles class
identifiers (`class HBoxPanel{}` → `class e{}`, anonymous emitted classes → `.name === ""`), so `constructor.name` returns a
mangled string or `""`; an empty class token aborts `classList.add` and kills bootstrap.

Dev (`npm run dev`, unminified) keeps the names, which is why only the production build breaks.

The fix is a build-config change: tell oxc's minifier to preserve class (and function) names. The granular minify options are
not reachable through Vite's coarse `build.minify` (`boolean | "oxc" | "terser" | "esbuild"` — confirmed in
`node_modules/vite/dist/node/index.d.ts:2079`); they flow through rolldown's output-level `minify` object, exposed by Vite as
`build.rollupOptions.output.minify`. The app config is [`vite.config.ts`](../vite.config.ts) (sets no `minify`, inherits the
default oxc minifier); the library config [`vite.lib.config.ts:46`](../vite.lib.config.ts#L46) sets `minify: 'oxc'` and ships
the same `constructor.name` dependency to downstream consumers, so it needs the identical treatment.

Installed versions (verified in `node_modules`): `vite@8.0.16` (mainline Vite 8 with native rolldown — *not* the `rolldown-vite`
alias), `rolldown@1.0.3`. oxc minify is bundled inside rolldown.

---

## Architecture Decisions

### Preserve names via `rollupOptions.output.minify`, not `build.minify`

Vite's `build.minify` only selects the minifier; it carries no sub-options. The fine-grained oxc minify settings live in
rolldown's `OutputOptions.minify`, typed `false | MinifyOptions | "dce-only"`
(`node_modules/rolldown/dist/shared/define-config-3BX_X2Am.d.mts:1839`). Vite forwards an `output` object through
`build.rollupOptions.output` (`node_modules/vite/dist/node/index.d.ts:864`). Setting `output.minify` to a `MinifyOptions`
object is itself a truthy minify config, so it both enables minification *and* configures it — no separate `build.minify: 'oxc'`
line is required in the app config (and supplying both risks redundancy/conflict). Keep it to the one `output.minify` object.

### Set `keepNames` on BOTH `mangle` and `compress`

`MinifyOptions` (`node_modules/rolldown/dist/shared/binding-BaCZTfMx.d.mts:139`) has two name-affecting passes:

- `mangle.keepNames?: boolean | { function: boolean; class: boolean }` — stops the renamer from rewriting class/function
  identifiers.
- `compress.keepNames?: { function: boolean; class: boolean }` — preserves names through the compress/DCE pass.

Empirical test against the installed `rolldown/utils` `minify` (a named class inside an IIFE, the exact bug shape):

```
default minify:           const Mod=(()=>{class e{...}    →  constructor.name === "e"
mangle+compress keepNames: const e=(()=>{class TabPanel{...} → constructor.name === "TabPanel"
```

Only setting both flags preserves the runtime class identifier while still mangling everything that doesn't feed `.name`
(the outer `Mod` binding still shrank to `e`). Use the explicit object form `{ function: true, class: true }` on each.

### Keep function names too, not just class names

The framework's hard dependency is on *class* names (`constructor.name` → CSS class + `getClassName` used in
[`LayoutSerialization.ts:162`](../src/typescript/lib/layout/LayoutSerialization.ts#L162) and the serialization/registry paths).
A repo grep finds no reliance on plain-`function.name`. But `keepNames` accepts `{ function, class }` as a pair, the function
delta is negligible (see size note), and it future-proofs any named-function `.name` use. Set `function: true` as well.

### Set `module: true` for the app/library minify object

`MinifyOptions.module?: boolean` ("Use when minifying an ES module") — both builds emit ESM (the lib config declares
`formats: ['es']`; the app is a standard ESM SPA). Setting `module: true` matches the output format and keeps minifier
assumptions correct. (Note: in the `build.rollupOptions.output.minify` position Vite re-exports `MinifyOptions` *omitting*
`module` and `sourcemap` — `define-config-3BX_X2Am.d.mts:338` — because the bundler supplies them; so in the **config files**
the object is `{ compress: {...}, mangle: {...} }` only. The `module` flag is relevant to the standalone-API reasoning above,
not a field to add in `output.minify`.)

### Library build keeps `minify: 'oxc'` AND gains the same output.minify object

`vite.lib.config.ts` explicitly sets `build.minify: 'oxc'`. Mirror the app fix by adding
`build.rollupOptions.output.minify` with the same keepNames object. Leaving the existing `minify: 'oxc'` line is harmless (the
output object governs the actual passes); removing it is optional and out of scope. The lib build is the one consumed by
downstream apps that hit the identical `constructor.name` path, so it must not ship mangled class names.

### Defensive guard at `DOM.ts:305` — include it as a SECONDARY net, not the fix

Wrapping the `classList.add` in an empty-token check (`if (name) element.classList.add(name)`) prevents the *hard crash* but
does **not** fix the underlying problem: a component whose `constructor.name` is `""` would silently get no CSS class, leaving
it unstyled/misidentified. The guard converts a loud crash into a quiet styling bug. Recommendation: **include the one-line
guard** as cheap defense-in-depth against any future stray empty token (it costs nothing and hardens a low-level sink), but the
plan must treat the config change as the real fix and verify class names actually reappear in the bundle — the guard alone is
not acceptance.

---

## Internal Structure

App config — add to the existing `build` block in `vite.config.ts`:

```ts
build: {
  outDir: 'dist',
  emptyOutDir: true,
  sourcemap: true,
  rollupOptions: {
    output: {
      minify: {
        compress: { keepNames: { function: true, class: true } },
        mangle:   { keepNames: { function: true, class: true } },
      },
    },
  },
},
```

Library config — add the same `rollupOptions.output.minify` to the `build` block in `vite.lib.config.ts` (keep the existing
`minify: 'oxc'`, `lib`, `outDir`, `emptyOutDir`, `sourcemap` fields untouched).

Guard — `DOM.ts:303-307`:

```ts
if (patch.addClass) {
    for (const name of patch.addClass) {
        if (name) element.classList.add(name);
    }
}
```

---

## Ordered Implementation Steps

1. **Reproduce the crash.** `npm run build` then `npm run preview` (port 4173) and load it — confirm the empty-token
   SyntaxError and blank page. Record current bundle size for the delta comparison:
   `ls -l dist/assets/index-*.js` and `gzip -c dist/assets/index-*.js | wc -c` (baseline ~691 KB raw / ~163 KB gzip).
2. **Patch `vite.config.ts`.** Add `build.rollupOptions.output.minify` with the `compress.keepNames` + `mangle.keepNames`
   object shown above. Do not add a `build.minify` line.
3. **Patch `vite.lib.config.ts`.** Add the same `build.rollupOptions.output.minify` object; leave `minify: 'oxc'` in place.
4. **(Recommended) Add the guard** at [`DOM.ts:305`](../src/typescript/lib/core/DOM.ts#L305): `if (name) element.classList.add(name);`.
5. **Rebuild the app.** `npm run build` (this runs `npm run typecheck` first — must pass).
6. **Grep the minified bundle for real class identifiers.** `grep -c 'class HBoxPanel' dist/assets/index-*.js` and
   `grep -c 'class VBoxPanel'` and `grep -c 'class TabPanel'` — each `> 0`. (Plain `grep -c HBoxPanel` is *insufficient*: even
   the buggy bundle contains `HBoxPanel` as an export-alias/property key — `grep -c 'class HBoxPanel'` is the check that proves
   the class *identifier* survived.)
7. **Record the size delta.** Compare new raw/gzip against the step-1 baseline; expect a small increase (single-digit percent
   gzip — a proxy re-minify of the existing bundle showed ~+1.9 KB gzip / ~1.2 %; a from-source build may differ but stays
   small). Note it in the PR/commit body.
8. **Build the library** to confirm the lib config compiles and preserves names: `npm run build:lib`, then
   `grep -c 'class ' dist/lib/core/*.js` sanity-check and spot-check a known class name survives unmangled.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | [`vite.config.ts`](../vite.config.ts) — add `build.rollupOptions.output.minify` keepNames object |
| Modify | [`vite.lib.config.ts`](../vite.lib.config.ts) — add the same `build.rollupOptions.output.minify` object |
| Modify (recommended) | [`src/typescript/lib/core/DOM.ts`](../src/typescript/lib/core/DOM.ts) — empty-token guard at line 305 |

---

## Verification

1. **Build succeeds:** `npm run build` exits 0 (typecheck + vite build).
2. **No empty-token crash:** `npm run preview` (port 4173), load `http://localhost:4173`, open DevTools console — **no**
   `Failed to execute 'add' on 'DOMTokenList'` SyntaxError.
3. **App renders:** in the console, `document.body.children.length > 0` (the page is no longer blank).
4. **Class identifiers survive minification:** `grep -c 'class HBoxPanel' dist/assets/index-*.js` `> 0`, likewise
   `'class VBoxPanel'` and `'class TabPanel'`. (Use `class <Name>`, not bare `<Name>`, to avoid the export-alias false positive.)
5. **Spot-check at runtime:** in the loaded app, evaluate that a known component's `constructor.name` is a real class name
   (e.g. a tab panel element's component reports `"TabPanel"`, not `"e"` or `""`).
6. **Library build:** `npm run build:lib` exits 0; spot-check a known class name appears unmangled in `dist/lib/`.
7. **Bundle size noted:** new raw/gzip recorded against the ~691 KB / ~163 KB baseline; increase is small and documented.

---

## Potential Challenges

- **`grep` false positive on bare names** — mitigated by grepping `class <Name>` (the class *declaration*), since the minifier
  keeps `<Name>` as an export alias/property key even when the class identifier is mangled.
- **Vite forwarding semantics** — `build.rollupOptions.output` is the documented Vite 8 forwarding point
  (`index.d.ts:864`); if a future Vite version moves it, `build.rolldownOptions.output.minify` (`index.d.ts:875`) is the
  equivalent and the verification greps will catch any regression.
- **Anonymous class expressions** — `keepNames` cannot invent a name for a truly anonymous `class {}` (oxc docs: "does not
  guarantee the `undefined` name is preserved"). Any component that is genuinely an unnamed class expression would still get
  `.name === ""`; the bug's anonymous class is almost certainly a *named* class stripped by mangling (which keepNames fixes),
  but the `DOM.ts` guard is the backstop if any truly-anonymous case exists.

---

## Critical Files

- [`vite.config.ts`](../vite.config.ts) — app build config (no `minify` set today; inherits default oxc).
- [`vite.lib.config.ts`](../vite.lib.config.ts) — library build config (`minify: 'oxc'` at line 46).
- [`src/typescript/lib/core/BaseObject.ts:45`](../src/typescript/lib/core/BaseObject.ts#L45) — `getClassName` returns
  `this.constructor.name`; the root of the name dependency.
- [`src/typescript/lib/core/Component.ts:4566`](../src/typescript/lib/core/Component.ts#L4566) — feeds `constructor.name` into
  the addClass sink.
- [`src/typescript/lib/core/DOM.ts:303-307`](../src/typescript/lib/core/DOM.ts#L303) — the `classList.add` sink; guard site.
- `node_modules/rolldown/dist/shared/binding-BaCZTfMx.d.mts:139` — authoritative `MinifyOptions` / `MangleOptions` /
  `CompressOptions` `keepNames` shapes for the installed rolldown@1.0.3.

---

## Non-Goals

- Removing the `minify: 'oxc'` line from `vite.lib.config.ts` — leaving it is harmless; touching it is out of scope.
- Changing the framework's reliance on `constructor.name` for CSS classes / serialization — keeping names is the intended fix,
  not re-architecting `getClassName`.
- Tuning other minify options (`dropConsole`, `target`, treeshake) — only name preservation is in scope.
