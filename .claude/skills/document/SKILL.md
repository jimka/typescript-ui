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

## Verification

After any change that affects the public API surface or symbol locations, run `npm run docs:api` and confirm **0 errors and 0 link warnings** (the lone acceptable warning is typedoc's pre-existing "unsupported TypeScript version" notice).
