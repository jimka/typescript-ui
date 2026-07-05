# Dead Code & Orphaned Export Cleanup — Implementation Plan

## Overview

Two mechanical, behaviour-neutral cleanups, each removal proven unused by `grep` across `src/` + `tests/` and cross-checked against the barrel export surface.

1. **`core/Type.ts` — remove a family of proven-dead runtime type guards.** The `Type` namespace ([core/Type.ts](src/typescript/lib/core/Type.ts#L9)) is *not* re-exported by any barrel — it is imported directly by exactly two files ([core/Component.ts:12](src/typescript/lib/core/Component.ts#L12), which uses only `Type.isBoolean`, and [component/list/AbstractCustomList.ts:12](src/typescript/lib/component/list/AbstractCustomList.ts#L12), which uses only `Type.isArray`) plus its own test ([tests/unit/core/Type.test.ts](tests/unit/core/Type.test.ts)). So it carries no public-API obligation, and any guard with zero callers is dead.

2. **Orphaned `export` keywords + two missing barrel re-exports.** A cluster of module-internal symbols carry an `export` that leaks nowhere (drop the keyword); two option/mode types belong to *publicly-exported* components/options but are missing from their barrel (add the re-export).

Neither change alters runtime behaviour: no removed symbol has a caller, and the two added barrel lines only widen the type surface.

---

## Architecture Decisions

### `core/Type.ts` removal set — the 14 enumerated zero-ref guards plus one consequential orphan

`grep -rn "Type\.<name>\b" src tests` (excluding `core/Type.ts` itself) returns **zero** matches for these 14 guards, so they are dead everywhere — production and tests alike:

```
ifArguments  ifArray  ifBoolean  ifElement  ifFloat  ifFunction
ifInteger    ifNumber ifObject   ifString
isArguments
requireArguments  requireElement  requireFloat
```

Removing them leaves **`isElement`** with no caller: its only two callers were `ifElement` and `requireElement` (both in the removal set), and `Type.test.ts` never calls it (line 73's `describe('Type.isElement / isFunction', …)` names it in a string but only exercises `isFunction`). Per this repo's "remove orphans your change creates" rule (CLAUDE.md §3), `isElement` is removed as well. Its removal orphans the file's `import { DOM } from "~/core/DOM.js"` — `DOM.source.isElement` at line 36 is the import's *only* use — so that import line is removed too.

**Total Type.ts removal: 15 functions + 1 import.**

### `core/Type.ts` — what stays, and why the one-ref siblings are *not* removed

The surviving `is*`/`require*` guards are **kept**. Two have real production callers (`isArray` → AbstractCustomList, `isBoolean` → Component). The rest (`requireNonNull`, `requireArray`, `requireBoolean`, `requireFunction`, `requireInteger`, `requireNumber`, `requireObject`, `requireString`, `isString`, `isNumber`, `isInteger`, `isFloat`, `isObject`, `isFunction`) have **no production caller** — their sole references are in `Type.test.ts`. They are *test-pinned*, not proven-dead: removing them means deleting the accompanying test cases, which is a scope expansion beyond "remove code with zero references" and a judgement call the task reserves ("advise, but only remove zero-ref ones"). Recommendation recorded here, no action taken: a future pass could retire the untested-in-production `require*`/`is*` guards together with their test cases, but that is out of scope for this cleanup.

### Orphaned exports — drop the keyword when the owning symbol is module-internal

For a symbol used only inside its own file whose owning component/manager is **not** exported by any barrel, the `export` keyword is inert — drop it. Verified: `ResizeHandle`, `AutoCompleteDropdown`, `DialogBackdrop`, `SortPriorityBadge` (classes) and the `layout/Table` manager are absent from every `index.ts`, so their option/event types are internal. The two `overlay/windowControls` constants, the two `layout/CollapseSupport` constants, and `overlay/AbstractWindow._defaultWindowOptions` are module-private helpers.

### Orphaned exports — add the barrel re-export when the type is part of a *public* surface

Two types are transitively public and must instead be **re-exported by their barrel** (matching the pervasive convention where every public manager/component ships its `XOptions`/`XEvent`):

- **`TableOptions`** ([component/table/Table.ts:36](src/typescript/lib/component/table/Table.ts#L36)) is the options bag of the publicly-exported `Table` (`class Table extends Component<TableOptions>`). The barrel already exports `Table` and `TableEvent` ([component/table/index.ts:3-4](src/typescript/lib/component/table/index.ts#L3)) but omits `TableOptions` — an accidental gap. Add it.
- **`JsonReaderMode`** ([data/proxy/Reader.ts:59](src/typescript/lib/data/proxy/Reader.ts#L59)) is the type of the `mode` field on the barrel-exported `JsonReaderOptions` ([data/proxy/Reader.ts:75](src/typescript/lib/data/proxy/Reader.ts#L75), re-exported at [data/index.ts:35](src/typescript/lib/data/index.ts#L35)). A consumer setting `mode` needs the type, and `JsonReaderOptions`' JSDoc contains `{@link JsonReaderMode}` — which, while the type is unexported, is a latent TypeDoc *"resolved but not included"* warning per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) ("Don't `{@link}` internal symbols from public JSDoc"). Adding the re-export both completes the public surface and forecloses that warning. Keep the `export type` on the source declaration (required for re-export).

---

## Ordered Implementation Steps

1. **`src/typescript/lib/core/Type.ts`** — delete these 15 exported functions (each is the whole `export function …` block plus its leading JSDoc): `ifArguments`, `ifArray`, `ifBoolean`, `ifElement`, `ifFloat`, `ifFunction`, `ifInteger`, `ifNumber`, `ifObject`, `ifString`, `isArguments`, `isElement`, `requireArguments`, `requireElement`, `requireFloat`. Then delete the now-unused `import { DOM } from "~/core/DOM.js";` at line 3.
   - Verify: `grep -rn "Type\.\(ifArguments\|ifArray\|ifBoolean\|ifElement\|ifFloat\|ifFunction\|ifInteger\|ifNumber\|ifObject\|ifString\|isArguments\|isElement\|requireArguments\|requireElement\|requireFloat\)\b" src tests` — expect zero matches.
   - Verify: `grep -n "DOM" src/typescript/lib/core/Type.ts` — expect zero matches.

2. **`src/typescript/lib/overlay/AbstractWindow.ts:139`** — drop `export` from `export const _defaultWindowOptions`.

3. **`src/typescript/lib/overlay/windowControls.ts:19,35`** — drop `export` from `WINDOW_CONTROL_STYLE_RULES` and `WINDOW_LEAD_GLYPH_STYLE_RULES` (both used internally in-file — remain live).

4. **`src/typescript/lib/layout/CollapseSupport.ts:19,25`** — drop `export` from `COLLAPSE_DURATION` and `COLLAPSE_EASING` (both used internally at lines 62/74/176/261 — remain live).

5. **`src/typescript/lib/layout/Table.ts:17`** — drop `export` from `interface TableLayoutOptions`.

6. **`src/typescript/lib/component/table/cell/ResizeHandle.ts:15,22`** — drop `export` from `type ResizeHandleEvent` and `interface ResizeHandleOptions`.

7. **`src/typescript/lib/component/input/AutoCompleteDropdown.ts:19`** — drop `export` from `interface AutoCompleteDropdownOptions`.

8. **`src/typescript/lib/component/container/DialogBackdrop.ts:14`** — drop `export` from `interface DialogBackdropOptions`.

9. **`src/typescript/lib/component/table/cell/SortPriorityBadge.ts:14`** — drop `export` from `interface SortPriorityBadgeOptions`.

10. **`src/typescript/lib/component/table/index.ts`** — extend line 4's `export type { TableEvent } from '~/component/table/Table.js';` to `export type { TableOptions, TableEvent } from '~/component/table/Table.js';`. Leave the `export interface TableOptions` on the source file intact.

11. **`src/typescript/lib/data/index.ts`** — extend line 35's `export type { Reader, ReadResult, JsonReaderOptions } from '~/data/proxy/Reader.js';` to include `JsonReaderMode`. Leave the `export type JsonReaderMode` on the source file intact.

12. Run the full verification suite (below).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/Type.ts` (remove 15 functions + `DOM` import) |
| Modify | `src/typescript/lib/overlay/AbstractWindow.ts` (drop `export`) |
| Modify | `src/typescript/lib/overlay/windowControls.ts` (drop 2 `export`) |
| Modify | `src/typescript/lib/layout/CollapseSupport.ts` (drop 2 `export`) |
| Modify | `src/typescript/lib/layout/Table.ts` (drop `export`) |
| Modify | `src/typescript/lib/component/table/cell/ResizeHandle.ts` (drop 2 `export`) |
| Modify | `src/typescript/lib/component/input/AutoCompleteDropdown.ts` (drop `export`) |
| Modify | `src/typescript/lib/component/container/DialogBackdrop.ts` (drop `export`) |
| Modify | `src/typescript/lib/component/table/cell/SortPriorityBadge.ts` (drop `export`) |
| Modify | `src/typescript/lib/component/table/index.ts` (add `TableOptions` re-export) |
| Modify | `src/typescript/lib/data/index.ts` (add `JsonReaderMode` re-export) |

---

## Expected Behaviour

Pure deletion / export-tightening — **no runtime behaviour change**. The contract is verification-shaped, not test-shaped:

- `npm run typecheck` and `npm run build:lib` still pass (no dangling reference to any removed symbol; the `DOM` import removal leaves no orphaned import).
- `npm run lint` still passes (no newly-unused variable introduced by dropping `export` — every de-exported const/type retains an in-file use; no lingering unused `import`).
- `grep`/codegraph confirms zero references to each removed `Type.*` guard across `src/` + `tests/`.
- The two added barrel re-exports (`TableOptions`, `JsonReaderMode`) resolve and appear on the public type surface; `npm run docs:build` finishes with zero warnings (closing the latent `{@link JsonReaderMode}` warning).
- `tests/unit/core/Type.test.ts` is untouched and still passes — it exercises only surviving guards.

All behaviours here are covered by the toolchain (typecheck / build / lint / docs / existing unit test); none needs manual UI verification.

---

## Verification

```bash
# 1. No reference to any removed Type guard remains.
grep -rn "Type\.\(ifArguments\|ifArray\|ifBoolean\|ifElement\|ifFloat\|ifFunction\|ifInteger\|ifNumber\|ifObject\|ifString\|isArguments\|isElement\|requireArguments\|requireElement\|requireFloat\)\b" src tests   # expect: zero

# 2. Dropped-export symbols still resolve in-file (no orphaned import / unused var).
npm run typecheck        # tsc -p tsconfig.lib.json --noEmit
npm run lint             # eslint src

# 3. Library still builds; added barrel types are emitted.
npm run build:lib

# 4. Existing Type unit test still green; docs build clean (JsonReaderMode link now resolves).
npm run test
npm run docs:build       # expect: zero warnings
```

---

## Documentation Impact

- Adding `TableOptions` to `component/table/index.ts` and `JsonReaderMode` to `data/index.ts` widens the public type surface; both now render in TypeDoc under their existing `@category` (Table / Data). No prose doc page references either type by name today, so no doc-page edits are needed beyond the regenerated API reference (`npm run docs:build`).
- The removed `Type.*` guards are internal (namespace never barrel-exported), so they do not appear in the docs — no doc removal required.

---

## Potential Challenges

- **A guard I believe dead is reached via a computed member access** (`Type["ifArray"]`) — mitigation: `grep -rn "Type\[" src tests` before deleting; the namespace is only ever called with static dot access today.
- **Dropping `export` on a const that a co-located `{@link}` in a *public* JSDoc references** would surface a docs warning — mitigation: the `docs:build` step in Verification catches it; the `CollapseSupport` `{@link COLLAPSE_DURATION}` references sit in that module's own internal (non-barrel-exported) symbols, so no public page links them.
- **Index lag**: after editing, do not re-query CodeGraph in the same turn (watcher debounces ~500ms); rely on `grep`/`tsc` for the post-edit confirmation.

---

## Critical Files

- [src/typescript/lib/core/Type.ts](src/typescript/lib/core/Type.ts) — the guard namespace being trimmed.
- [tests/unit/core/Type.test.ts](tests/unit/core/Type.test.ts) — confirms which guards are pinned; must stay green.
- [src/typescript/lib/component/table/index.ts](src/typescript/lib/component/table/index.ts) & [src/typescript/lib/data/index.ts](src/typescript/lib/data/index.ts) — barrels receiving the two added re-exports; read them to match the existing `export type { … }` line style.
- [ARCHITECTURE.md](ARCHITECTURE.md) / [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) — the `{@link}`-internal-symbol rule motivating the `JsonReaderMode` re-export.

---

## Non-Goals

- **Retiring the test-pinned `require*`/`is*` guards** (e.g. `requireArray`, `requireObject`, `requireFunction`, `isFloat`, `isString`) — they have no production caller but are covered by `Type.test.ts`; removing them means deleting tests, a judgement call reserved for a separate pass.
- **An exhaustive repo-wide unused-`export` sweep** — beyond the enumerated symbols, a systematic dead-export audit risks colliding with the sibling cleanup plans (Component lifecycle, store mutation, overlay positioning, input-field, data-view, API-naming) that own their own dead-code removals. Scope is held to the two items above.
- **Any rename** — owned by `api-naming-harmonization`.
