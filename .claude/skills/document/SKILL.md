---
name: document
description: Update project documentation when the public API changes — new exported symbols, renames, removals, JSDoc additions, or changes that touch docs/, typedoc.json, or the typedoc-callable-plugin. Use whenever a code change is consumer-visible.
model: sonnet
---

## Required reading

- [`_shared/docs-conventions.md`](../_shared/docs-conventions.md) — full conventions: new component/layout/recipe pages, sidebar updates, the typedoc-callable-plugin contract, JSDoc cross-bucket link forms.

## Export surface

The library has subpath-only exports — every public symbol lives in exactly one of `core`, `primitive`, `layout`, `data`, `validation`, `component/<sub>`. There is no root barrel. A new public symbol must be re-exported from the matching per-subpath barrel; never add a project-root export.

## JSDoc references across files

- **Same-bucket reference** (target lives in the same subpath as the JSDoc you're writing): use `{@link Foo}`. TypeDoc resolves it.
- **Cross-bucket reference** (e.g. mentioning `Window` from `component/display`): use a markdown link to the API page — `[\`Foo\`](/api/<subpath>/<kind>/Foo)`. `{@link}` only sees symbols inside the same entry-point bundle, so cross-bucket references render as plain text and surface as docs:api warnings.
- **Self-reference** (a class's own JSDoc mentioning its own name): leave as bare backticks. Don't link to the page the reader is already on.
- **Name-collision symbols** (`Border`, `Body`, `Column`, `Header`, `Row`): always spell out the full subpath in the link so it goes to the right class.

## TypeDoc setup

TypeDoc entry points live in [typedoc.json](../../../packages/lib/typedoc.json) — one per subpath barrel. The custom [typedoc-callable-plugin.mjs](../../../packages/lib/typedoc-callable-plugin.mjs) promotes `callable()`-wrapped exports (`export { ButtonCallable as Button }`) from `/api/<bucket>/variables/X.md` back to `/api/<bucket>/classes/X.md` so the rendered API page carries the full class documentation. The plugin is automatic — new callable classes are picked up without configuration as long as the export form is `callable(_Inner)` with a real class on the inside.

## The `llms.txt` capability catalog

A brand-new public **class** (not a sub-part of an existing catalogued component, not a framework primitive) needs a row in [`packages/lib/scripts/llms/manifest.data.mjs`](../../../packages/lib/scripts/llms/manifest.data.mjs)'s `groups` — that's the only hand-edited seam for `llms.txt`; a method/behaviour added to an already-catalogued component does not (its one-line summary stays stable, detail lives in the doc page). Run `npm run docs:llms:check` after `docs:api` to find out which: it fails if the new class is in neither `groups` nor `excludedSymbols`, naming exactly what's uncatalogued. Add it to `groups` (with a `task` phrase) if a consumer would reach for it directly, or to `excludedSymbols` with a reason if it's a sub-part/internal. Then run `npm run docs:llms` to regenerate `llms.txt` — this may require raising `generate.mjs`'s `TOKEN_BUDGET` by the reported overage (see the constant's comment history for the pattern).

## Verification

After any change that affects the public API surface or symbol locations, run `npm run docs:api` and confirm **0 errors and 0 link warnings** (the lone acceptable warning is typedoc's pre-existing "unsupported TypeScript version" notice). Then run `npm run docs:llms:check` (see above).
