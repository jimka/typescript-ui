# Table Body Class-Name Collision Fix — Implementation Plan

## Overview

The Style Audit panel ([`packages/lib/src/typescript/lib/diagnostics/StyleAudit.ts:108`](packages/lib/src/typescript/lib/diagnostics/StyleAudit.ts#L108)) scans the shared stylesheet for `#id`-scoped rules whose declaration body byte-for-byte duplicates another instance's, and flags the worst offenders as missed class-tier hoist opportunities. A live capture found every `Table`'s row-viewport body flagged this way: its `#id` rule repeats the same ~15 declarations on every table in the app, forever.

The root cause is a class-name collision in [`core/ClassStyleRules.ts`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts)'s class-tier registry. Two unrelated classes are both declared `class Body`: the app-root singleton ([`core/Body.ts:45`](packages/lib/src/typescript/lib/core/Body.ts#L45)) and the table's internal virtualized row viewport ([`component/table/Body.ts:276`](packages/lib/src/typescript/lib/component/table/Body.ts#L276), `class Body extends VirtualRowView<Row>`). `ClassStyleRules.ts` keys its shared-rule registry (`_owners`, `ensureClassStyleRule`) by the bare `ctor.name` string, and the registry is a module-level singleton that outlives any one component. `core/Body.ts`'s singleton is constructed the instant its module loads (`private static readonly INSTANCE: Body = new Body();`) and that constructor calls `this.init()` unconditionally, which runs `Component.applyStyle` and claims `_owners.set("Body", ctor)` before any application code executes a line — so the app-root `Body` always wins the name in real apps, deterministically, not by race.[^collision-confirmed] Every table's own `Body` then loses the name and falls back to `ClassStyleRules.ts`'s documented "name-collision opt-out": it writes its **entire** resolved style bag — 15 framework-baseline declarations plus its one real per-class deviation, `backgroundColor` (set at [`component/table/Body.ts:336`](packages/lib/src/typescript/lib/component/table/Body.ts#L336)) — to its own `#id` rule on every render, which is exactly what the audit tool is designed to catch.

The fix renames the table-internal class's own declaration so its `ctor.name` no longer collides, without changing anything the framework's public API exposes. This is an internal rename only: the package's public surface — the `Body` name exported from `component/table/index.ts`, `Table.getBody()`'s return type, `instanceof Body` checks — is unchanged.[^public-api-verified]

---

## Architecture Decisions

### Rename only the internal class declaration; keep the public export name `Body`

[`component/table/Body.ts:276`](packages/lib/src/typescript/lib/component/table/Body.ts#L276)'s `class Body extends VirtualRowView<Row>` becomes `class TableBody extends VirtualRowView<Row>`. The file's export block still publishes it under the names `Body` (callable) and `_Body` (raw escape hatch) — only the right-hand side of those aliases changes from `Body` to `TableBody`.

`TableBody` is not a new name invented for this fix — the framework's own docs already establish it as the class's recommended identity: [`packages/lib/docs/components/TableInternals.md:10`](packages/lib/docs/components/TableInternals.md#L10) tells consumers mixing table and other components to `import { Body as TableBody }`, and [`packages/lib/docs/components/index.md:148`](packages/lib/docs/components/index.md#L148) lists the export as "`Body` … (import as `TableBody`)". The renamed declaration now matches what consumers are already told to call it.[^tableheader-precedent]

### Hoist `backgroundColor` onto a shared `.TableBody` class rule

Once the collision is gone, `TableBody` gets its own class-tier registry slot — but it still has no `ownClassStyleDefaults`, so `ensureClassStyleRule` falls back to the older flat path and `backgroundColor` (set imperatively via `this.setBackgroundColor(...)` in the constructor, never in `_defaultOptions`) keeps writing to every instance's own `#id` rule. This is the one real per-class deviation the audit flagged, so this plan also declares it as a class default, mirroring [`Cell.ts:55`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L55)'s `ownClassStyleDefaults` shape exactly: a module-level `_defaultTableBodyOptions` constant, a `protected static readonly ownClassStyleDefaults` field pointing at it, and the same constant forwarded into `super()` as `subclassDefaults` so `getClassStyleDefaults()` (`this._defaultOptions`) sees it too. The existing imperative `this.setBackgroundColor(...)` call in the constructor stays — `Cell.ts:135` keeps its own equivalent call for the same reason (the folding getter needs the instance layer seeded) — it just now dedupes against the shared rule instead of always losing the comparison.[^step3-verified]

### No general safeguard against future name collisions

A full-tree grep for duplicate top-level `class X` declarations across `packages/lib/src/typescript/lib` found exactly one other duplicate name besides `Body`/`Body`: `Table` (`layout/Table.ts:76`, a `LayoutManager`, and `component/table/Table.ts:197`, a `Component`). It is not a real `ClassStyleRules` collision — `ensureClassStyleRule` is only ever called from `Component.applyStyle` ([`core/Component.ts:5726`](packages/lib/src/typescript/lib/core/Component.ts#L5726)), the only call site in the codebase, and `LayoutManager` does not extend `Component`, so `layout/Table.ts`'s `Table` never touches the `_owners` registry.[^table-table-not-a-collision] With that one false positive ruled out, `Body`/`Body` was the only actual collision in the tree at investigation time, and this plan fixes it. Adding a mechanical safeguard (a lint rule, a runtime dev-mode warning) for a *future* same-name pair is a separate, broader change with its own design questions — it is a natural follow-up, not part of this fix (see `## Non-Goals`).

---

## Internal Structure

`component/table/Body.ts`'s class-tier addition, mirroring `Cell.ts`'s shape:

```typescript
// Own contribution to the hierarchy-aware class tier — see
// plans/implemented/class-hierarchy-cascade.md. Every Table's body resolves
// the same resting background from theme tokens, so it is a class default
// rather than a per-instance write.
const _defaultTableBodyOptions: Partial<ComponentOptions> = {
    backgroundColor: 'var(--ts-ui-input-bg, rgb(255, 255, 255))',
};

class TableBody extends VirtualRowView<Row> {

    protected static readonly ownClassStyleDefaults: StyleBag = _defaultTableBodyOptions;

    // ... existing fields unchanged ...

    constructor(store: AbstractStore, subclassDefaults?: Partial<ComponentOptions>) {
        super({ tag: "tbody" }, { ..._defaultTableBodyOptions, ...(subclassDefaults ?? {}) });

        this.setOverflow("hidden");
        this.setBackgroundColor("var(--ts-ui-input-bg, rgb(255, 255, 255))");
        // ... rest of constructor unchanged ...
    }
```

`TreeBody` ([`component/table/TreeBody.ts:112`](packages/lib/src/typescript/lib/component/table/TreeBody.ts#L112), `class TreeBody extends _Body`) needs no change: it calls `super(store)` with one argument, which still matches the new optional second parameter, and it declares no `ownClassStyleDefaults` of its own, so it shares `.TableBody`'s rule unchanged.

The file's closing export block (today at lines 2595–2599) keeps its column alignment, just with the longer class name on the left:

```typescript
const BodyCallable = callable(TableBody);
type BodyCallable = TableBody;
export {
    TableBody    as _Body,
    BodyCallable as Body
};
```

---

## Ordered Implementation Steps

1. In [`component/table/Body.ts`](packages/lib/src/typescript/lib/component/table/Body.ts), add imports: `ComponentOptions` alongside the existing `Component` import (line 3), and a new `import type { StyleBag } from "~/core/ClassStyleRules.js";`.
2. Rename the class declaration at line 276 from `class Body extends VirtualRowView<Row> {` to `class TableBody extends VirtualRowView<Row> {`.
3. Fix the file's stale self-reference at line 2212: `Body.isEmptyValue(...)` → `TableBody.isEmptyValue(...)`.
   Check: `grep -n 'Body\.isEmptyValue' packages/lib/src/typescript/lib/component/table/Body.ts` — expect zero matches after this step. (The file's other `Body.` occurrence, `{@link Body.bindViewState}` at line 63, is a JSDoc cross-reference to the exported name and is correct unchanged — leave it alone.)
4. Update the export block at lines 2595–2599 to the exact form shown in `## Internal Structure` above (`callable(Body)` → `callable(TableBody)`, `type BodyCallable = Body;` → `type BodyCallable = TableBody;`, `Body as _Body` → `TableBody as _Body`, alignment spacing adjusted for the longer name). `BodyCallable as Body` stays unchanged — this is the line that keeps the public export name stable.
5. Fix the stale class-header comment at line 272. It currently reads "Re-exported as `TableBody` from the package barrel." — untrue today (the barrel exports it as `Body`, per `component/table/index.ts:27`) and would only become more confusing once the class really is declared `TableBody`. Replace the line with: "Exported as `Body`; commonly imported as `TableBody` to avoid colliding with other same-named exports — see docs/components/TableInternals.md."
6. Immediately above the class declaration, add the `_defaultTableBodyOptions` constant and, inside the class, the `ownClassStyleDefaults` field — exact shape in `## Internal Structure` above.
7. Widen the constructor signature to `constructor(store: AbstractStore, subclassDefaults?: Partial<ComponentOptions>)` and change its `super(...)` call to `super({ tag: "tbody" }, { ..._defaultTableBodyOptions, ...(subclassDefaults ?? {}) });`. Leave every other line in the constructor body unchanged, including the existing `this.setBackgroundColor(...)` call.
8. Add the regression test described in `## Expected Behaviour` to [`packages/lib/tests/component/table/Body.test.ts`](packages/lib/tests/component/table/Body.test.ts).
9. Run `npx tsc --noEmit -p .` from `packages/lib` — expect no new errors (compare against a baseline run before this change; several pre-existing unrelated errors are expected and must not change in count).
10. Run the full test list in `## Verification` and `npm run docs:api` (from `packages/lib`) — expect the same 0 errors / 1 warning baseline as before this change.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/table/Body.ts` |
| Modify | `packages/lib/tests/component/table/Body.test.ts` |

---

## Expected Behaviour

All rows are unit-testable offline via `RecordingDOMSink`, following the precedent in [`ClassHierarchyCascade.test.ts:252`](packages/lib/tests/core/ClassHierarchyCascade.test.ts#L252) ("case 7: a name collision opts a hierarchy participant out of both tiers") and the local `declarationsDuring` helper already defined in `Body.test.ts:240`. Add the new cases to `Body.test.ts` in a new `describe('Body — class-name collision fix', ...)` block, importing `Body as CoreBody` from `~/core/Body` (mirroring the existing combined import in [`HeaderThemeReflow.test.ts:23-25`](packages/lib/tests/component/table/HeaderThemeReflow.test.ts#L23)). Importing `~/core/Body` is sufficient on its own to construct and render the app-root singleton — its `INSTANCE` field runs `new Body()` at module load, and that constructor calls `init()` unconditionally — so no explicit `CoreBody.init()` call is needed to reproduce the collision precondition; the import alone claims `_owners.set("Body", coreBodyCtor)` before any test body runs.

| # | Behaviour | How to verify |
|---|---|---|
| 1 | A table `Body` instance rendered in a process that has also imported `core/Body` gets its own `.TableBody` class-tier rule instead of the name-collision opt-out. | `ensureStyleRuleOpsFor(sink, '.TableBody')` (add this helper, mirroring [`ClassHierarchyCascade.test.ts:85`](packages/lib/tests/core/ClassHierarchyCascade.test.ts#L85)) has length 1 after constructing and rendering one table `Body`. |
| 2 | A table `Body` instance's own `#id` rule no longer receives the full 15-key framework baseline. | `declarationsDuring(sink, idSelector, () => b.getElement(true))` — none of `position`, `visibility`, `display`, `boxSizing`, `whiteSpace`, `userSelect`, `cursor`, `border`, `margin`, `minWidth`, `minHeight`, `maxWidth`, `maxHeight`, `overflowX`, `overflowY` appear as keys. |
| 3 | `backgroundColor` is hoisted onto the shared `.TableBody` rule. | `declarationsDuring(sink, '.TableBody', () => new Body(store).getElement(true)).backgroundColor` equals the literal string `var(--ts-ui-input-bg, rgb(255, 255, 255))` (declaration values pass through `resolveDeclarations` unchanged — see `ClassStyleRules.ts:230`). |
| 4 | A table `Body` instance's own `#id` rule carries no `backgroundColor` declaration once the class rule exists. | Same `declarationsDuring` capture as row 2 — `backgroundColor` key is absent. |
| 5 | Two `Table`s in the same app share one `.TableBody` rule — the audit's flagged duplicate is gone. | Construct two `Body(store)` instances, render both; `ensureStyleRuleOpsFor(sink, '.TableBody').length` is still 1 after the second. |
| 6 | `TreeBody` is unaffected: it shares `.TableBody`'s rule (no `.TreeBody` rule of its own, since it declares no `ownClassStyleDefaults`). | Existing `TreeBody.test.ts` suite passes unchanged (already re-run during investigation — 1309 tests across `tests/core`, `tests/component/table`, `tests/diagnostics`, `tests/component/shared` pass with this exact change applied). |
| 7 | No consumer-visible behaviour changes. | `tsc --noEmit` shows no new errors; `Table.test.ts` (uses `getBody()`, `instanceof Body` internally via `addComponent`) passes unchanged. |

---

## Verification

- Typecheck: `npx tsc --noEmit -p .` from `packages/lib`.
- Grep invariants:
  - `grep -n 'class Body extends VirtualRowView' packages/lib/src/typescript/lib/component/table/Body.ts` — expect zero matches.
  - `grep -n 'Body\.isEmptyValue' packages/lib/src/typescript/lib/component/table/Body.ts` — expect zero matches (the call site now reads `TableBody.isEmptyValue`). The file's other `Body.` occurrence, the JSDoc `{@link Body.bindViewState}` at line 63, stays as-is — it resolves through the unchanged export name.
- Tests (all confirmed green with this exact change during investigation):
  ```
  npx vitest run \
    tests/component/table/Body.test.ts \
    tests/component/table/TreeBody.test.ts \
    tests/core/Body.test.ts \
    tests/core/BodyContextMenu.test.ts \
    tests/diagnostics/StyleAudit.test.ts \
    tests/core/ClassHierarchyCascade.test.ts \
    tests/core/ClassStyleRules.test.ts \
    tests/component/table/Table.test.ts
  ```
  Then the broader sweep: `npx vitest run tests/core tests/component/table tests/diagnostics tests/component/shared` (1309 tests, all passing at investigation time).
- Docs: `npm run docs:api` from `packages/lib` — expect the same baseline (0 errors, 1 pre-existing unrelated warning about `DiagramEdgeLayer.setEdges`). One accepted, harmless cosmetic artifact appears in the generated output and is not a regression to chase: `docs/api/component/table/classes/Body.md`'s constructor signature renders its return type as the bare, unlinked string `TableBody` (`new Body(store: AbstractStore): TableBody;`) instead of `Body`, because TypeScript's inferred constructor return type is the class's own declared name, not its export alias. Every other reference on that page — the page title, the `{@link Body}` cross-references from `BodyEvent`/`BodyViewState` elsewhere in the file — correctly resolves to `Body`, confirmed by direct inspection of the generated markdown during investigation.[^doc-artifact-confirmed]
- No manual/browser verification needed — the whole fix is exercised by the offline `RecordingDOMSink` harness, matching how the underlying collision mechanism is already tested.

---

## Documentation Impact

No doc-source changes needed. Confirmed by grepping `packages/lib/docs` for every reference to the table `Body` class: all of them (`docs/components/TableInternals.md:5,10,19,23,31,65`, `docs/components/index.md:148`, `docs/recipes/custom-cell.md:130,145`) either link to `/api/component/table/classes/Body` (a URL derived from the unchanged export name) or already recommend the `import { Body as TableBody }` alias this rename now matches. `TableInternals.md:31` names the source file as `component/table/Body.ts`, which also stays unchanged — only the class declared inside it is renamed.

---

## Potential Challenges

- Widening `TableBody`'s constructor to accept `subclassDefaults` and declaring `ownClassStyleDefaults` makes the whole `TableBody`/`TreeBody` chain a "participating chain" per `ClassStyleRules.ts`'s hierarchy mechanism, which widens `TreeBody`'s rendered DOM class list from `["TreeBody"]` to `["TableBody", "TreeBody"]` (see *The class tier is hierarchy-aware*, ARCHITECTURE.md). This is the same effect every other participating chain already has (e.g. `Cell`/`DefaultCell`/`HeaderCell`); it is additive and does not remove `.TreeBody`, so no existing selector keyed on `.TreeBody` breaks. Mitigation: covered by Expected Behaviour row 6 and the existing `TreeBody.test.ts` suite, which already passed unchanged with this exact change during investigation.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/ClassStyleRules.ts`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts) — the registry this plan works around; read `ensureClassStyleRule` (line 889) and its doc comment (lines 872–887) for the exact collision/opt-out mechanism, and `chainParticipates` (line 491) for how `ownClassStyleDefaults` widens the DOM class chain.
- [`packages/lib/src/typescript/lib/component/table/cell/Cell.ts:30-135`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L30) — the precedent this plan's `ownClassStyleDefaults` addition mirrors exactly.
- [`packages/lib/src/typescript/lib/core/Body.ts`](packages/lib/src/typescript/lib/core/Body.ts) — the app-root singleton whose eager construction (line 47) is what wins the `"Body"` name today.
- [`packages/lib/tests/core/ClassHierarchyCascade.test.ts`](packages/lib/tests/core/ClassHierarchyCascade.test.ts) — the test-authoring precedent for the new regression cases (`declarationsDuring`, `idSelector`, `ensureStyleRuleOpsFor` helpers; case 7 in particular).
- [`plans/implemented/class-hierarchy-cascade.md`](plans/implemented/class-hierarchy-cascade.md) — background on the class-tier hierarchy mechanism this fix plugs into.

---

## Non-Goals

- **A general mechanical safeguard against future `ctor.name` collisions** (lint rule, dev-mode runtime warning) is out of scope. The full-tree sweep this plan performed found exactly one real collision (`Body`/`Body`, fixed here) and one false positive (`Table`/`Table`, not a `Component`-vs-`Component` collision). A generic safeguard is a separate, broader change with its own design surface (would it need to special-case non-`Component` classes the way `Table`/`Table` requires? warn at class-definition time or first-collision time?) and isn't warranted by a single, now-fixed instance.
- **Renaming the public export** (`Body` → `TableBody` in `component/table/index.ts`, matching how `Header.ts` was renamed to `TableHeader`) is out of scope — see the footnote on `## Architecture Decisions`'s first subsection. This plan fixes an internal styling-registry bug, not the export-name ergonomics the docs already document as a known, accepted cost.

---

## Notes

[^collision-confirmed]: Verified directly, not assumed: `core/Body.ts:47`'s `private static readonly INSTANCE: Body = new Body();` runs at module evaluation. Its private constructor (`core/Body.ts:183-191`) calls `this.init()` unconditionally, and `Body.getElement()` (`core/Body.ts:198-200`) always returns a valid handle (`DOM.source.getBody()`), so `Component.init()` (`core/Component.ts:6781`) never hits its "not rendered" guard and always reaches `this.applyStyle(element)` at `core/Component.ts:6804`, which calls `ensureClassStyleRule(this.constructor, ...)` at `core/Component.ts:5726` — claiming `_owners.set("Body", ctor)`. This all happens purely from importing `core/Body.ts`, before any application code runs, in every environment (browser or test) that imports it — which every app does, since mounting any UI tree requires `Body.init()`.

[^public-api-verified]: Verified by: (1) `grep -rn '\.Body\b'` across `packages/lib/src` and `packages/lib/docs` for a literal `.Body` CSS-class selector — one match, an unrelated JSDoc mention in `AbstractSelectableList.ts:2012` ("`Table.Body`" as prose, not a selector); (2) `grep -rn 'constructor\.name\s*===\s*"Body"'` across `packages/lib/src` — zero matches; (3) a full `tsc --noEmit -p .` (run from `packages/lib`) with the rename applied — zero new errors, confirming `Table.ts`'s `private _body: Body`, `bodyFactory?: (store: AbstractStore) => Body`, `addComponent(row: TableHeader | Body | FooterRow, ...)`, and `row instanceof Body` (`Table.ts:209,282,1113,1116`) all still typecheck and behave identically, since `Body` (the imported callable) is structurally the same wrapper function at runtime — only the class it wraps has a different `.name`.

[^tableheader-precedent]: `component/table/Header.ts` solved an analogous collision (`Header` colliding with `component/display`'s `Header`) by renaming *both* the internal declaration and the public export to `TableHeader` (`Header.ts:117,1747-1751`; `component/table/index.ts:25`: `export { TableHeader } from '~/component/table/Header.js';`) — a breaking public rename. `Body` and `Row` were left un-renamed at the export level; `docs/components/index.md:148,151` documents both as still colliding, with consumers routed to an import alias instead. This plan follows the `Body`/`Row` precedent (internal-only fix, no breaking change) rather than the `Header` precedent, because the bug being fixed here is a styling-registry dedup defect, not an export-naming ergonomics problem — a public rename would be a materially bigger, breaking change for no additional benefit to this fix.

[^table-table-not-a-collision]: Verified by reading `layout/LayoutManager.ts:43`: `export abstract class LayoutManager extends BaseObject` — not a `Component` subclass. `ensureClassStyleRule` is called from exactly one place in the codebase (`core/Component.ts:5726`, inside `Component.applyStyle`, keyed on `this.constructor`), confirmed by `grep -rn 'ensureClassStyleRule(' packages/lib/src/typescript` returning only its own definition and that one call site. `layout/Table.ts`'s `Table` therefore never reaches `_owners` at all.

[^step3-verified]: Applied and tested directly during investigation (not just reasoned about): with the rename plus this `ownClassStyleDefaults`/`subclassDefaults` addition applied to a working copy of `Body.ts`, `npx tsc --noEmit -p .` (run from `packages/lib`) showed no new errors, and `npx vitest run tests/core tests/component/table tests/diagnostics tests/component/shared` passed all 1309 tests. The change was reverted after confirming this (per the plan skill's "don't modify source code" rule) — this plan directs `/implement` to make the same change from a clean tree.

[^doc-artifact-confirmed]: Confirmed by running `npx typedoc` against a working copy with the rename applied: total warning count was unchanged (0 errors, 1 warning — the same pre-existing `DiagramEdgeLayer.setEdges` warning present before this change), and `docs/api/component/table/classes/Body.md` was generated at the same path with `# Class: Body` as its header. Its constructor's rendered "Returns" section shows the bare string `TableBody` (confirmed in the generated markdown), while `docs/api/component/table/type-aliases/BodyEvent.md` and `docs/api/component/table/interfaces/BodyViewState.md`'s `{@link Body}` / `{@link Body.bindViewState}` references both correctly resolved to links pointing at `../classes/Body.md`. Reverted after confirming.
