# Documentation Conventions

Shared reference: how to update `docs/` and JSDoc when public API surfaces change.

## Documentation updates

When implementation changes consumer-visible behaviour, update `docs/`:

- **New public symbol** (class/type/enum/function): re-export from the per-subpath barrel (`core`, `primitive`, `layout`, `data`, `validation`, `component/<sub>` — no root barrel). Add `@category` (Core / Components / Layouts / Data / Theme / Validation / Util). Verify it lands in `docs/api/<group>/index.md` after build.
- **New component / layout / data class:** add a curated page under `docs/<group>/`, link it in `docs/.vitepress/config.mts`, add it to that group's `index.md` catalog.
- **New recipe-worthy pattern:** page under `docs/recipes/`, linked in sidebar and `docs/recipes/index.md`.
- **Consumer-visible behaviour change:** update matching `docs/concepts/` page; touch `docs/reference/faq.md` / `troubleshooting.md` if relevant.

Run `npm run docs:build` and confirm **0 errors and 0 link warnings** (typedoc's "unsupported TypeScript version" notice is the only acceptable warning).

## JSDoc cross-bucket references

TypeDoc emits one entry-point bundle per subpath, so `{@link Foo}` only resolves within the same bucket.

| Target | Form |
|---|---|
| Same file or bucket | `{@link Foo}` |
| Different bucket | `[\`Foo\`](/api/<subpath>/<kind>/Foo)` |
| Class referencing itself | plain backticks `` `Foo` `` |

Subpath kinds: `classes`, `interfaces`, `enumerations`, `type-aliases`, `variables`, `functions`. For colliding names (`Border`, `Body`, `Column`, `Header`, `Row`), spell out the subpath in the link.

## typedoc-callable-plugin

Classes exported as `export { XCallable as X }` (where `const X = callable(_X)`) are auto-promoted from `variables/` to `classes/` by `typedoc-callable-plugin.mjs`. No setup needed. If a new class lands under `variables/` after build, verify: export form is `XCallable as X`, inner `_X` is a real `class` declaration, wrapping call is literally `callable(...)`.
