# Manrope Default Font — Implementation Plan

## Overview

The default UI font is defined as `'system-ui, sans-serif'` by the single shared `font.family` token in [`BaseTheme.ts:18`](../src/typescript/lib/core/themes/BaseTheme.ts#L18) (the structural scaffold every built-in theme inherits via `defineTheme(BaseTheme, …)`); the three concrete themes no longer declare `font` at all. It flows into the live document through [`Theme.ts`](../src/typescript/lib/core/Theme.ts): `themeToVars` emits it as `--ts-ui-font-family` ([`Theme.ts:638`](../src/typescript/lib/core/Theme.ts#L638)) and `ThemeManager.setTheme` writes it to `document.documentElement.style.fontFamily` ([`Theme.ts:896`](../src/typescript/lib/core/Theme.ts#L896)). There is currently **no** `@font-face` / web-font infrastructure anywhere — no fonts directory, no font-face CSS, and glyphs render as inline SVG (not an icon font), so this plan introduces font loading from scratch.

This change does two things: (1) flip the `font.family` token in each theme to `'Manrope Variable', sans-serif`, and (2) make the **library itself** self-host and inject the Manrope `@font-face` so that any consumer who renders a framework theme gets the font with zero extra setup. The injection is triggered from the same library-owned code path that already activates the default theme — `ThemeManager.setTheme`, which is called unconditionally from the `Body` singleton constructor ([`Body.ts:39`](../src/typescript/lib/core/Body.ts#L39)). The mechanism mirrors the existing precedent in [`Glyph.ts`](../src/typescript/lib/component/display/Glyph.ts) (line 176), where the library mounts a shared DOM asset once, guarded by a module-level flag.

---

## Architecture Decisions

### Self-host via `@fontsource-variable/manrope`, bundled by Vite

Add `@fontsource-variable/manrope` as a runtime `dependency`. It ships the OFL Manrope variable font as `.woff2` plus a ready-made `@font-face` CSS file with the fonts referenced by relative URL. We import the CSS for its side effect; Vite resolves the `.woff2` references and emits them as build assets, so the font is bundled and served from the consumer's own origin — **no Google Fonts `<link>`, no runtime external request.** Rejected the manual-vendoring alternative (hand-copied `.woff2` + hand-written `@font-face`) because it duplicates exactly what the package maintains (correct `unicode-range`, `font-display`, weight axis) and creates a license/asset file to babysit; the package is the idiomatic, lower-maintenance choice for a Vite build.

### Variable font, single file, weights 200–800

Use the **variable** font (`@fontsource-variable/manrope`), not static weights. Manrope's variable file covers its entire weight axis (200–800) in one `.woff2`, which is smaller than shipping the 2–3 static weights the UI actually uses (normal ~400, button/header ~500–600) and future-proofs any theme that wants a different weight without adding assets. One asset, full range — minimal and complete. **Family name:** the package registers its `@font-face` as `font-family: 'Manrope Variable'` (the variable-font convention), so the token value must be `'Manrope Variable'`, not `'Manrope'` — a plain `'Manrope'` would not match the bundled face and would fall straight through to `sans-serif`.

### Library owns the load — injected once from `setTheme`, not from the demo `index.html`

The requirement is that **merely using a framework theme pulls in the font**, for any consumer, not just the demo `index.html` → [`main.ts`](../src/typescript/main.ts). Two facts make `ThemeManager.setTheme` the correct hook: it is the single funnel every theme activation passes through, and it is already invoked by the library itself from the `Body` constructor ([`Body.ts:39`](../src/typescript/lib/core/Body.ts#L39)) — so any consumer who instantiates `Body` (the documented entry point) triggers it. We add a module-level, idempotent `ensureFontLoaded()` in `Theme.ts` that runs the side-effecting `@fontsource-variable/manrope` import's CSS injection on first `setTheme` call, guarded by a module flag exactly like `Glyph.ts`'s `_keyframesInjected` precedent (line 45). Because the `@fontsource` import is a static `import '...'` side-effect at the top of `Theme.ts`, Vite injects the `@font-face` stylesheet when the `core` bundle loads; `ensureFontLoaded` exists only to make the dependency explicit and to keep a single documented trigger point. This means a consumer importing `{ Body }` or any theme from `@jimka/typescript-ui/core` gets Manrope automatically — **call this out in the consumer docs.**

### Fallback stack preserved

The shared `font.family` token in `BaseTheme` becomes `'Manrope Variable', sans-serif` (all three themes inherit it). The generic `sans-serif` tail is retained so first paint (before the `.woff2` finishes loading) and any environment where the asset 404s still render with a sane fallback. `system-ui` is intentionally dropped: since the library bundles Manrope it effectively always loads, so the only fallback window is the brief load flash — not worth a third entry. `font-display: swap` (the `@fontsource` default) ensures no invisible-text flash.

### No new theme token

Font loading is not a per-theme value — all three themes load the same single font asset. So there is **no** new `Theme` interface field and **no** new `--ts-ui-*` custom property; the only token change is the existing `font.family` string value in each theme file. This respects "theme tokens live in `Theme.ts`/themes" while keeping the surface minimal (CLAUDE.md §2 Simplicity).

---

## Theme Tokens

No new CSS custom properties. The existing `--ts-ui-font-family` (emitted at [`Theme.ts:638`](../src/typescript/lib/core/Theme.ts#L638)) simply carries the new value:

| CSS Custom Property | Old Value | New Value | Purpose |
|---|---|---|---|
| `--ts-ui-font-family` | `system-ui, sans-serif` | `'Manrope Variable', sans-serif` | UI font with generic fallback |

Same string is also written to `document.documentElement.style.fontFamily` at [`Theme.ts:896`](../src/typescript/lib/core/Theme.ts#L896) (unchanged code — it reads `theme.font.family`).

---

## Internal Structure

Top of [`Theme.ts`](../src/typescript/lib/core/Theme.ts), beside the existing imports:

```ts
// Side-effecting import: @fontsource-variable/manrope ships the OFL Manrope
// variable font (.woff2, weight axis 200–800) plus an @font-face stylesheet.
// Vite bundles the .woff2 as a build asset and injects the @font-face CSS,
// so the font is self-hosted from the consumer's origin — no external request.
import '@fontsource-variable/manrope';

// Module-level guard so the font is wired exactly once, regardless of how many
// times setTheme runs. Mirrors Glyph.ts's _keyframesInjected pattern (line 45).
let _fontEnsured = false;
```

```ts
/**
 * Ensures the bundled Manrope @font-face is active. Idempotent — the actual
 * stylesheet injection is performed by the side-effecting import above; this
 * flag keeps a single documented trigger and avoids redundant work per theme
 * switch.
 */
function ensureFontLoaded(): void {
    if (_fontEnsured) {
        return;
    }

    _fontEnsured = true;
}
```

`ensureFontLoaded()` is called as the first line of `ThemeManager.setTheme` ([`Theme.ts:887`](../src/typescript/lib/core/Theme.ts#L887)).

> Note for implementer: if the static side-effect import alone is judged sufficient (it injects the CSS at module load), `ensureFontLoaded` may be dropped and the import kept as the sole mechanism. Keep the function only if a single explicit trigger inside `setTheme` reads more clearly; do not add DOM-mutating code to it — the `@fontsource` CSS import already owns injection. Decide during implementation and state which in the commit.

---

## Ordered Implementation Steps

1. **Add the dependency.** `npm install @fontsource-variable/manrope` (this adds it to `dependencies` in [`package.json`](../package.json)). Verify it appears under `dependencies`, not `devDependencies` — it is a runtime asset shipped to consumers. Confirm `node_modules/@fontsource-variable/manrope/index.css` and a `.woff2` exist.

2. **Flip the shared token in `BaseTheme`.** Change `family: 'system-ui, sans-serif'` to `family: "'Manrope Variable', sans-serif"` in [`BaseTheme.ts:18`](../src/typescript/lib/core/themes/BaseTheme.ts#L18) — the single source of truth all three themes inherit. Surgical: only the `family` value changes; leave `size`/`linePadding` untouched. (Post-refactor the concrete themes no longer declare `font`, so this one edit covers Classic, Modern, and Dark.)

3. **Add the side-effecting import + guard to `Theme.ts`.** Insert the `import '@fontsource-variable/manrope';` and the `_fontEnsured` flag near the existing imports; add `ensureFontLoaded()` per _Internal Structure_; call it as the first statement of `ThemeManager.setTheme` ([`Theme.ts:887`](../src/typescript/lib/core/Theme.ts#L887)). Follow the JSDoc + blank-line conventions in [CODE_CONVENTIONS.md](../CODE_CONVENTIONS.md).

4. **Checkpoint — no external font refs:** `grep -rn "fonts.googleapis\|fonts.gstatic\|<link[^>]*font" src/ index.html` — expect zero matches.

5. **Checkpoint — token applied:** `grep -rn "family" src/typescript/lib/core/themes/` — expect the lone `font.family` in `BaseTheme.ts` to read `'Manrope Variable', sans-serif` and zero remaining `system-ui` in any family value.

6. **Docs site (secondary).** VitePress docs (`docs/`) render their own pages, not the framework `Body`, so they do not auto-inherit the library font. This is acceptable — the primary requirement is the library. If parity is wanted, add `import '@fontsource-variable/manrope';` to a VitePress theme entry and set `--vp-font-family-base`; note this is **out of scope unless requested** (see Non-Goals).

7. **Build the library** (`npm run build` / the `vite.lib.config.ts` build) and confirm a `.woff2` asset is emitted under `dist/` and referenced by the bundled `core` CSS/JS.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | [`package.json`](../package.json) — add `@fontsource-variable/manrope` to `dependencies` (npm does this) |
| Modify | [`package-lock.json`](../package-lock.json) — lockfile update (npm does this) |
| Modify | [`src/typescript/lib/core/Theme.ts`](../src/typescript/lib/core/Theme.ts) — side-effect import, `_fontEnsured` guard, `ensureFontLoaded()`, call in `setTheme` |
| Modify | [`src/typescript/lib/core/themes/BaseTheme.ts`](../src/typescript/lib/core/themes/BaseTheme.ts) — `font.family` (single shared token inherited by all three themes) |

No files created or deleted.

---

## Verification

- **Typecheck:** `npm run build` (or `tsc`) passes — the side-effect import has no type surface, so this only confirms the module still compiles.
- **Grep invariants:**
  - `grep -rn "fonts.googleapis\|fonts.gstatic" .` (excluding `node_modules`/`dist`) — zero matches (no CDN).
  - `grep -rn "Manrope" src/typescript/lib/core/themes/` — one match, in `BaseTheme.ts` (the shared `'Manrope Variable'` token all three themes inherit).
- **Lib build asset:** after the library build, a Manrope `.woff2` exists under `dist/` and is referenced by the emitted bundle (confirms self-hosting/bundling).
- **Manual smoke (dev app, `npm run dev`, http://localhost:8015):** open the **Misc.** demo screen; computed `font-family` on body text resolves to Manrope (DevTools → Computed → `font-family` shows `Manrope`; Rendered Fonts panel lists Manrope, not the system fallback). Toggle through Classic → Modern → Dark via the MiscPanel theme cycler ([`MiscPanel.ts:471`](../src/typescript/MiscPanel.ts#L471)) — all three render Manrope.
- **Network panel:** no request to `fonts.googleapis.com` / `fonts.gstatic.com`; the `.woff2` loads from the local/dev origin.
- **Docs build (if step 6 taken):** `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning).

---

## Critical Files

- [`src/typescript/lib/core/Theme.ts`](../src/typescript/lib/core/Theme.ts) — `themeToVars` (line 636), `ThemeManager.setTheme` (line 887), the `--ts-ui-font-family` emit (638) and `documentElement.style.fontFamily` write (896).
- [`src/typescript/lib/core/Body.ts`](../src/typescript/lib/core/Body.ts) — line 39: the library-owned `setTheme(ModernTheme)` call that guarantees the font loads for every consumer.
- [`src/typescript/lib/component/display/Glyph.ts`](../src/typescript/lib/component/display/Glyph.ts) — line 45 (`_keyframesInjected` flag) and the `injectKeyframes` guard at line 52: the precedent for a library module injecting a shared asset once via a module-level guard flag.
- [`src/typescript/lib/core/themes/BaseTheme.ts`](../src/typescript/lib/core/themes/BaseTheme.ts) — the shared `font.family` token (the single edit site for the token flip).
- [`vite.lib.config.ts`](../vite.lib.config.ts) — the library build that must bundle the `.woff2`.

---

## Potential Challenges

- **Static import may inject CSS on its own, making `ensureFontLoaded` redundant.** Mitigation: keep the import as the real mechanism; treat `ensureFontLoaded` as an explicit, no-DOM trigger only — decide during implementation per the note in _Internal Structure_ and don't duplicate injection.
- **`@fontsource` asset not bundled by the lib build.** Mitigation: the side-effect import lives in `core/index.ts`'s dependency graph (via `Theme.ts`), so Vite's lib build pulls it in; verify the emitted `.woff2` in step 7 — if missing, the import was tree-shaken (ensure it's a bare side-effect import with no unused binding).
- **First-paint fallback flash.** Mitigation: `font-display: swap` (the `@fontsource` default) plus the retained `sans-serif` fallback means text is always visible, swapping to Manrope when ready.
- **Text-metrics cache.** `setTheme` already calls `Util.invalidateTextMetricsCache()` ([`Theme.ts:832`](../src/typescript/lib/core/Theme.ts#L832)); no extra invalidation is needed, but be aware metrics measured before the `.woff2` loads reflect the fallback font.

---

## Non-Goals

- **Theming the VitePress docs site** beyond the optional note in step 6 — the requirement is the library; docs parity is opt-in and only if explicitly requested.
- **A configurable / swappable font API** (per-theme font assets, a `Theme.font.assetUrl` field, runtime font switching) — not asked for; all themes share one bundled font (CLAUDE.md §2).
- **Static-weight subsetting / custom `unicode-range` tuning** — the upstream variable file's defaults are accepted as-is.
- **Changing `font.size` / `font.linePadding`** or any non-`family` typography token.
