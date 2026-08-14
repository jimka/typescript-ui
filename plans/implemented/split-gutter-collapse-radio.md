---
depends-on: [menu-checkbox-rows]
touches-shared:
  - packages/lib/src/typescript/lib/layout/Split.ts
  - packages/lib/src/typescript/lib/component/container/index.ts
  - packages/lib/docs/reference/changelog/next.md
---

# Split Gutter Collapse Radio Rows — Implementation Plan

## Overview

The split gutter's context menu ([Split.ts:1089](packages/lib/src/typescript/lib/layout/Split.ts#L1089)) currently builds all five of its rows as `CheckboxMenuRow`. Two of them — **Collapse `<lead>` pane** and **Collapse `<next>` pane** — are not independent toggles: they are one choice between two panes. The gutter's collapse target is a single pane index, resolved by [`gutterTargetPane`](packages/lib/src/typescript/lib/layout/Split.ts#L344), and clicking either row rewrites that target rather than flipping a boolean.

This plan adds `RadioMenuRow` — a menu row hosting a real [`RadioButton`](packages/lib/src/typescript/lib/component/input/RadioButton.ts), built as a sibling of [`CheckboxMenuRow`](packages/lib/src/typescript/lib/component/container/CheckboxMenuRow.ts) — and switches those two rows to it. The new row's `activate()` only ever selects: clicking the already-selected row leaves it selected, matching how `RadioButton.activate()` itself behaves ([RadioButton.ts:186](packages/lib/src/typescript/lib/component/input/RadioButton.ts#L186)).

The other three rows (**Lock gutter**, **Fix `<lead>` pane `<extent>`**, **Fix `<next>` pane `<extent>`**) stay `CheckboxMenuRow` and are not touched. Mutual exclusion between the two collapse rows stays where it already lives: the `syncCollapseRows` closure in `openGutterMenu` ([Split.ts:1120](packages/lib/src/typescript/lib/layout/Split.ts#L1120)), whose body needs no change at all.

---

## Architecture Decisions

### `RadioMenuRow` is a standalone sibling of `CheckboxMenuRow`, not a shared base

The new class is a copy of `CheckboxMenuRow` with the inner control and `activate()` swapped. No abstract base is extracted between the two, and `CheckboxMenuRow` is not modified.[^no-shared-base]

### `activate()` selects, never deselects

`RadioMenuRow.activate()` calls `setChecked(true)` — unlike `CheckboxMenuRow.activate()`, which flips. A click on an already-selected row is a no-op on its own state. This mirrors `RadioButton.activate()`, whose doc comment states the same rule: a radio can only be selected by the user, never deselected.[^select-only]

### Mutual exclusion stays call-site logic in `Split.ts`; `ButtonGroup` cannot drive these rows

[`ButtonGroup`](packages/lib/src/typescript/lib/overlay/ButtonGroup.ts) is not used. Its wiring listens for the inner `RadioButton`'s own `"action"` event, and that event only fires when the button itself is clicked or keyed. In this row the button is pointer-inert and the row's own element owns the click — copied from `CheckboxMenuRow` — so the button never is.[^no-button-group] `Split.openGutterMenu` keeps owning the pairing through its existing `syncCollapseRows` closure.

### `syncCollapseRows` keeps both writes, unchanged

The closure body stays exactly as it is: recompute the live target, then write both rows from it. Only the comment above it changes, and the two `CheckboxMenuRow` type annotations become `RadioMenuRow`.[^sync-survives]

### The `enabled` option is copied from `CheckboxMenuRow` verbatim

Same construction-time-only `enabled` option, same three effects: `isEnabled()` reads the inner control's enabled state, a disabled row gets `setOpacity(0.5)` + `setPointerEvents("none")`, and `activate()` early-returns. No `setEnabled`. The two collapse rows keep their existing `enabled:` expressions unchanged.

### The two collapse rows tolerate "neither selected"

`RadioMenuRow` enforces nothing across instances, and the gutter's own model can legitimately target neither neighbour: `gutterTargetPane` returns `-1` when the leading pane collapses toward the end and the trailing pane collapses toward the start. Both rows then start unselected. One click settles it permanently, because a select-only row can never return the pair to that state.[^neither-selected]

The rule the pair follows, and the cases it decides:

| Click | Live target before | `activate()` does | State after the row's `action` handler |
|---|---|---|---|
| Collapse left, target is right | right | selects left (both selected for an instant) | left selected, right cleared; target = left |
| Collapse left, target is left | left | nothing — already selected | unchanged: left selected, right cleared |
| Collapse right, target is neither | none | selects right | right selected, left cleared; target = right |

---

## Public API

New component, exported from the existing `component/container` barrel.

```typescript
// packages/lib/src/typescript/lib/component/container/RadioMenuRow.ts

export type RadioMenuRowEvent = "action";

export interface RadioMenuRowOptions extends ComponentOptions {
    /** Row label, rendered beside the radio graphic. */
    text?: string;
    /** Initial selected state. Defaults to `false`. */
    checked?: boolean;
    /** Defaults to `true`. Disabled rows are dimmed and non-interactive. */
    enabled?: boolean;
    /** Construction-time listener bag; `action` fires after each click. */
    listeners?: { action?: () => void };
}

class RadioMenuRow extends MenuRow<RadioMenuRowOptions> {
    constructor(options?: RadioMenuRowOptions, subclassDefaults?: Partial<RadioMenuRowOptions>);

    isChecked(): boolean;                 // delegates to RadioButton.isSelected()
    setChecked(value: boolean): this;     // delegates to RadioButton.setSelected(value)
    isEnabled(): boolean;                 // delegates to RadioButton.isEnabled()
    isNavigable(): boolean;               // always true
    activate(): void;                     // select-only; no-op when disabled
    getContentWidth(): number;
    setColumns(_checkZone: number, iconStart: number, _titleColumn: number): void;
    doLayout(): this;

    on(event: "action", listener: () => void): this;
    off(event: "action", listener: () => void): this;
}

const RadioMenuRowCallable = callable(RadioMenuRow);
type RadioMenuRowCallable = RadioMenuRow;
export {
    RadioMenuRow         as _RadioMenuRow,
    RadioMenuRowCallable as RadioMenuRow
};
```

State-bearing fields: `checked` is cached by the inner `RadioButton` (`isSelected()` / `setSelected()`), `enabled` likewise (`isEnabled()`); neither has a backing field on the row and neither is written into `this._options`. This is the same arrangement `CheckboxMenuRow` documents in its constructor comment, and it holds for the same reason — the control cannot exist during the `super()` cascade, so `applyOptions` has no setter to dispatch to.

---

## Implementation

### `RadioMenuRow.ts` — copy, then substitute

Start from a verbatim copy of [CheckboxMenuRow.ts](packages/lib/src/typescript/lib/component/container/CheckboxMenuRow.ts) and apply exactly these substitutions. Everything not listed — the `DISABLED_OPACITY` constant and its comment, the pointer-inert child, the disabled branch, the three `Event.addListener` wirings, `applyListeners`, `isNavigable`, `getContentWidth`, `setColumns`, `doLayout`, `on` / `off`, the callable export block — is copied unchanged.

| In the copy | Replace with |
|---|---|
| `import { Checkbox } from "~/component/input/Checkbox.js";` | `import { RadioButton } from "~/component/input/RadioButton.js";` |
| `CheckboxMenuRow`, `CheckboxMenuRowOptions`, `CheckboxMenuRowEvent` | `RadioMenuRow`, `RadioMenuRowOptions`, `RadioMenuRowEvent` |
| `private _checkbox: Checkbox;` | `private _radio: RadioButton;` (and every `this._checkbox` read) |
| the `new Checkbox({ … })` call | the `new RadioButton(…)` call below |
| the `activate()` body | the select-only body below |
| doc wording: "checkbox", "Toggles", "toggle", "multi-select" | "radio button", "Selects", "click", "single-choice" |

Control construction — `RadioButton` takes its label as the **first positional argument**, not an options field:[^positional-label]

```typescript
this._radio = new RadioButton(options?.text ?? "", {
    selected: options?.checked ?? false,
    enabled:  options?.enabled ?? true,
});
```

Select-only activation:

```typescript
/**
 * Selects this row. Called by a click on the row or by
 * `Menu.activateFocused()` on Enter. Selecting is one-way — a click on an
 * already-selected row leaves it selected, matching `RadioButton`'s own
 * activation rule — so a group of rows is deselected by whoever owns the
 * group, not by the row itself. A no-op when the row is disabled.
 */
activate(): void {
    if (!this.isEnabled()) {
        return;
    }

    this.setChecked(true);
}
```

The class's **first JSDoc paragraph** is scraped into `llms.txt` by the manifest generator, so keep it to one sentence:

```
A [`Menu`](/api/overlay/classes/Menu) row hosting a real [`RadioButton`](/api/component/input/classes/RadioButton), for a single-choice menu.
```

### `Split.openGutterMenu` — the collapse pair only

Four edits inside [Split.ts](packages/lib/src/typescript/lib/layout/Split.ts):

1. Add `import { RadioMenuRow } from "~/component/container/RadioMenuRow.js";` after the existing `CheckboxMenuRow` import at [Split.ts:18](packages/lib/src/typescript/lib/layout/Split.ts#L18). The `CheckboxMenuRow` import **stays** — three rows still use it.
2. Retype the two closure fields at [Split.ts:1110-1111](packages/lib/src/typescript/lib/layout/Split.ts#L1110) to `RadioMenuRow | null`.
3. In the last two `configs` entries only ([Split.ts:1163-1198](packages/lib/src/typescript/lib/layout/Split.ts#L1163)), change `new CheckboxMenuRow({…})` to `new RadioMenuRow({…})`. The option bags, the `row.on("action", …)` bodies, the `collapseLeadRow = row` / `collapseNextRow = row` assignments and the `return row` all stay byte-for-byte identical.
4. Replace the comment above `syncCollapseRows` with the text below. The closure's body ([Split.ts:1120-1125](packages/lib/src/typescript/lib/layout/Split.ts#L1120)) does **not** change.

```typescript
// The two collapse rows are one choice, and a RadioMenuRow click only ever
// selects, so right after a click BOTH rows read as selected until this
// runs: it recomputes the live target and writes both rows from it, which
// clears the sibling — and puts the clicked row back if the retarget did
// not take (a container or pane lookup that bailed). The optional calls
// cover a test that builds one factory without the other; `Menu` always
// calls every factory before the panel is interactive.
```

**Ordering rule the change relies on:** the row's own click listener is registered in its constructor, and the factory's `row.on("action", …)` after that, so `activate()` always runs before the handler that calls `syncCollapseRows`. Registering the handler earlier would sync a stale state and leave both rows selected.

---

## Ordered Implementation Steps

Written test-first per the `implement` skill: each phase's tests come from `## Expected Behaviour`.

### Phase 1 — the component

1. Create `packages/lib/src/typescript/lib/component/container/RadioMenuRow.ts` per `## Implementation`.
2. Export it from [component/container/index.ts](packages/lib/src/typescript/lib/component/container/index.ts) — two lines beside the existing `CheckboxMenuRow` pair at lines 16-17:
   ```typescript
   export { RadioMenuRow } from '~/component/container/RadioMenuRow.js';
   export type { RadioMenuRowOptions, RadioMenuRowEvent } from '~/component/container/RadioMenuRow.js';
   ```
3. Add a `describe('RadioMenuRow')` block to [tests/component/container/MenuRow.test.ts](packages/lib/tests/component/container/MenuRow.test.ts) covering **R1-R14**. Copy the existing `CheckboxMenuRow` block's structure, including its `afterEach(() => DOM.reset())` and its dispose-every-row discipline, and reuse the file's existing `click(row)` helper.
4. Check: `cd packages/lib && npx vitest run tests/component/container/MenuRow.test.ts` — green, and `npm run typecheck`.

### Phase 2 — the gutter menu

5. Apply the four `Split.ts` edits in `## Implementation`.
6. Rework [tests/component/layout/Split.gutterMenu.test.ts](packages/lib/tests/component/layout/Split.gutterMenu.test.ts) per `## Expected Behaviour` **S1-S8**:
   - Import `RadioMenuRow`; widen the helper type to `type GutterMenuRow = InstanceType<typeof CheckboxMenuRow> | InstanceType<typeof RadioMenuRow>` and use it for `builtRows`, `builtByConfig`, `buildRow` and `row`.
   - `rowLabel` reads the row's only child's `getLabel()`. Add `import { _RadioButton as RadioButton } from '~/component/input/RadioButton'` beside the existing `_Checkbox as Checkbox` import, and widen that cast to `row.getComponents()[0] as InstanceType<typeof Checkbox> | InstanceType<typeof RadioButton>`; both classes inherit the same `getLabel()`, so the union call resolves.
   - Leave the `toggle` helper's name and body alone — it still dispatches a click at a row's element, which is all any of these rows needs.
   - Rewrite the two collapse-pair cases (`B18`, `B18b` at lines 333-372) for select-only semantics, and add the new `-1` target case **S7**.
7. Check: `npx vitest run tests/component/layout/Split.gutterMenu.test.ts` — green.
8. Grep invariants, from the repo root:
   - `grep -n 'CheckboxMenuRow' packages/lib/src/typescript/lib/layout/Split.ts` — expect exactly 4 lines (the import plus the three surviving rows).
   - `grep -c 'new RadioMenuRow' packages/lib/src/typescript/lib/layout/Split.ts` — expect `2`.

### Phase 3 — docs, index, manifest

9. Create `packages/lib/docs/components/RadioMenuRow.md`, mirroring [CheckboxMenuRow.md](packages/lib/docs/components/CheckboxMenuRow.md)'s section shape (intro, Usage, prose, Options table, Methods table, See also) minus its `<!-- demo: -->` block.[^no-demo] The Usage sample must show the call site owning mutual exclusion, since the row does not.
10. Add the catalogue row to [docs/components/index.md:131](packages/lib/docs/components/index.md#L131), directly after the `CheckboxMenuRow` row:
    ```
    | [`RadioMenuRow`](/components/RadioMenuRow) | Menu row holding a real radio button, for a single-choice group of rows |
    ```
11. Add the nav entry to `componentsMenus` in [packages/docs/src/content/pages.ts:255](packages/docs/src/content/pages.ts#L255), after the `CheckboxMenuRow` line.
12. Add `{ task: "Radio row in a menu", symbol: "RadioMenuRow" },` to the `Overlays` group in [packages/lib/scripts/llms/manifest.data.mjs:109](packages/lib/scripts/llms/manifest.data.mjs#L109), immediately after the `CheckboxMenuRow` entry. Do **not** hand-edit `packages/lib/llms.txt` — it is generated.
13. Update [docs/components/Menu.md:94](packages/lib/docs/components/Menu.md#L94), [docs/layouts/Split.md:117-147](packages/lib/docs/layouts/Split.md#L117) and [docs/reference/changelog/next.md](packages/lib/docs/reference/changelog/next.md) per `## Documentation Impact`.
14. Regenerate and check the docs pipeline: `npm run docs:api` (zero warnings), then `npm run docs:llms`. If the generator fails the token budget, raise `TOKEN_BUDGET` at [scripts/llms/generate.mjs:60](packages/lib/scripts/llms/generate.mjs#L60) by the smallest amount that fits and extend that constant's existing comment with this row's cost — the same way the `CheckboxMenuRow` row was accommodated. Confirm `packages/lib/llms.txt` gained one `RadioMenuRow` line.

### Phase 4 — full check

15. From the repo root: `npm run typecheck`, `npm test`, `npm run lint`.
16. Manual smoke test **M1**.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/component/container/RadioMenuRow.ts` |
| Create | `packages/lib/docs/components/RadioMenuRow.md` |
| Modify | `packages/lib/src/typescript/lib/component/container/index.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Split.ts` |
| Modify | `packages/lib/tests/component/container/MenuRow.test.ts` |
| Modify | `packages/lib/tests/component/layout/Split.gutterMenu.test.ts` |
| Modify | `packages/lib/scripts/llms/manifest.data.mjs` |
| Modify | `packages/lib/scripts/llms/generate.mjs` (only if the token budget fails) |
| Modify | `packages/lib/llms.txt` (generated output — committed, never hand-edited) |
| Modify | `packages/lib/docs/components/index.md` |
| Modify | `packages/lib/docs/components/Menu.md` |
| Modify | `packages/lib/docs/layouts/Split.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/docs/src/content/pages.ts` |

---

## Expected Behaviour

Unit-testable unless marked **manual**.

**`RadioMenuRow`** — new `describe` block in `tests/component/container/MenuRow.test.ts`

- **R1.** `new RadioMenuRow({ text: 'Lead' }).isChecked()` is `false`; with `checked: true` it is `true`.
- **R2.** `activate()` on an unselected row makes `isChecked()` `true`.
- **R3.** `activate()` on an already-selected row leaves `isChecked()` `true` — select-only, the one behavioural divergence from `CheckboxMenuRow`.
- **R4.** A click dispatched at the row's element selects it; a second click leaves it selected.
- **R5.** A `listeners.action` handler fires once per click — including the click of an already-selected row — and reads `isChecked() === true`.
- **R6.** `isEnabled()` is `true` whether `enabled` is omitted or passed as `true`.
- **R7.** An enabled row makes neither disabled write: `getOpacity()` is `null`, `getPointerEvents()` is `null`.
- **R8.** `{ enabled: false }` reports `isEnabled() === false`, `getOpacity() === 0.5`, `getPointerEvents() === 'none'`.
- **R9.** `activate()` on a disabled row leaves `isChecked()` unchanged — from both `checked: false` and `checked: true`.
- **R10.** A click dispatched at a disabled row's element leaves `isChecked()` unchanged. This pins the `activate()` guard only — do **not** assert that an `on("action")` handler goes uncalled, because the offline harness dispatches straight at the target and does not honour `pointer-events`.
- **R11.** A disabled row still reports `isNavigable() === true`.
- **R12.** `getContentWidth()` on a labelled row exceeds `MenuItem.TEXT_INSET + MenuItem.RIGHT_PAD`, and is unchanged by a later `setColumns(0, 40, 100)`.
- **R13.** After `setColumns(0, 40, 100)` and `doLayout()`, the inner radio's `getX()` is `contentBounds.x + 40`; without `setColumns` it is `contentBounds.x + MenuItem.TEXT_INSET`.
- **R14.** `setChecked(false)` on a selected row deselects it — the programmatic path `syncCollapseRows` uses; only user activation is one-way.

**Split gutter menu** — `tests/component/layout/Split.gutterMenu.test.ts`

- **S1.** Row labels and order are unchanged on both orientations (existing two cases pass with no assertion edits).
- **S2.** On a fresh two-pane split, `Collapse left pane` is selected and `Collapse right pane` is not.
- **S3.** Clicking `Collapse right pane` writes `collapseDirection: 'east'` on the trailing pane, moves `gutterTargetPane(0, …)` to `1` and the chevron to `'east'`; re-opening shows the right row selected and the left cleared; clicking `Collapse left pane` reverses all of it (existing case, assertions unchanged).
- **S4.** Within one open, clicking the non-target row selects it **and** clears the sibling.
- **S5.** Within one open, clicking the row that is already the target leaves both rows exactly as they were (target row selected, sibling cleared).
- **S6.** A `collapsible: false` neighbour's row reports `isEnabled() === false`; an opaque gutter disables both collapse rows while leaving `Lock gutter` and `Fix left pane width` enabled (existing cases, unchanged).
- **S7.** With the leading pane constrained to `collapseDirection: 'east'` and the trailing pane to `'west'`, the gutter targets neither pane: both collapse rows start unselected and both are enabled. Clicking `Collapse right pane` selects it and leaves the left row unselected.
- **S8.** `Lock gutter` and the two `Fix … pane …` rows keep their existing toggle behaviour, including the independent-pins case (existing cases, unchanged).
- **M1. manual.** In a browser (`npm run dev`, `localhost:8015`, `#/split`), right-click a gutter chevron: the first three rows draw as checkboxes, the two collapse rows as radio rings with the dot on the current target. Clicking the other collapse row moves the dot and leaves the menu open; clicking the row that already has the dot changes nothing. A disabled collapse row is visibly dimmed and ignores clicks.

---

## Verification

From the repo root unless stated:

- `npm run typecheck` — the lib build typecheck.
- `npm test` — runs `typecheck:test` then the full vitest suite. The two directly affected files: `cd packages/lib && npx vitest run tests/component/container/MenuRow.test.ts tests/component/layout/Split.gutterMenu.test.ts`.
- `npm run lint` — ESLint over `src`, including the local `require-subclass-defaults`, `require-content-bounds` and `no-raw-dom` rules that the new component must satisfy with no new baseline entries.
- `grep -n 'CheckboxMenuRow' packages/lib/src/typescript/lib/layout/Split.ts` — exactly 4 lines; `grep -c 'new RadioMenuRow' …` — exactly 2.
- `npm run docs:api` — must finish with **zero** warnings (the new JSDoc must not `{@link}` any private/protected/unexported symbol).
- `npm run docs:llms` — must succeed after `docs:api`; then `grep -n 'RadioMenuRow' packages/lib/llms.txt` returns one row.
- Manual **M1** above, on this worktree's own dev server.

---

## Documentation Impact

- **New** [docs/components/RadioMenuRow.md](packages/lib/docs/components/RadioMenuRow.md) — mirrors `CheckboxMenuRow.md`. State plainly: selecting is one-way (a click on the selected row changes nothing), the row does **not** deselect its siblings, so the code that builds the group deselects them via `setChecked(false)`; and `enabled` is construction-time only because a menu rebuilds its rows on every open. Options table: `text`, `checked`, `enabled`, `listeners.action`. Methods table: `isChecked()` / `setChecked(boolean)`, `isEnabled()`, `on("action", fn)` / `off("action", fn)`. See also: the API page, [`Menu`](/components/Menu)'s Custom rows section, [`CheckboxMenuRow`](/components/CheckboxMenuRow), [`RadioButton`](/components/RadioButton).
- [docs/components/index.md:131](packages/lib/docs/components/index.md#L131) — new catalogue row under the menus table, directly after `CheckboxMenuRow`.
- [docs/components/Menu.md:94](packages/lib/docs/components/Menu.md#L94) — after the existing `CheckboxMenuRow` sentence, add one sentence pointing at `RadioMenuRow` for a single-choice group of rows, noting the caller deselects the siblings.
- [docs/layouts/Split.md:117-147](packages/lib/docs/layouts/Split.md#L117) — the "Gutter context menu" section. The lead-in currently says every row is a `CheckboxMenuRow`; it becomes: a `CheckboxMenuRow` for the first three rows, a `RadioMenuRow` for the collapse pair. The collapse bullet's closing sentences are replaced: the two rows are radio rows rather than independent toggles, picking one clears the other, clicking the already-selected one changes nothing, and a gutter whose neighbours' `collapseDirection` constraints leave it collapsing neither pane starts with both rows unselected until one is picked.
- [docs/reference/changelog/next.md](packages/lib/docs/reference/changelog/next.md) — two edits, no new section:
  - `## Changed` → `### Split`: amend the existing "the gutter context menu's five toggles are now `CheckboxMenuRow` rows" bullet to name the split — `CheckboxMenuRow` for Lock gutter and the two Fix-pane pins, `RadioMenuRow` for the collapse pair, which reads as the single choice it is.
  - `## Added` → `### Menu`: add a `RadioMenuRow` bullet beside the `CheckboxMenuRow` one — a menu row hosting a real `RadioButton`, select-only, with the caller owning sibling deselection, sharing `CheckboxMenuRow`'s `enabled` option.
- Export surface: `RadioMenuRow` + `RadioMenuRowOptions` + `RadioMenuRowEvent` join [component/container/index.ts](packages/lib/src/typescript/lib/component/container/index.ts), which is already a TypeDoc entry point — no `typedoc.json` change.
- Capability index: the entry goes in `scripts/llms/manifest.data.mjs`; `packages/lib/llms.txt` is regenerated, never edited by hand.

---

## Potential Challenges

- **The `llms.txt` token budget is nearly full.** The ceiling at [generate.mjs:60](packages/lib/scripts/llms/generate.mjs#L60) was already raised once to fit the `CheckboxMenuRow` row. If `docs:llms` fails, raise `TOKEN_BUDGET` by the minimum needed and extend the comment; do not trim existing catalogue wording.
- **Undisposed rows in tests break later tests in the same file.** A `RadioMenuRow` wires window-level `click` / `mouseover` / `mouseout` listeners whose installed-type bookkeeping outlives `DOM.reset()`. Every test that builds one must dispose it, and the new `describe` block must keep the existing dispose-first `afterEach` ordering.
- **`pointer-events` is not observable offline.** Assert a disabled row through `getPointerEvents()` plus the manual check, never through "the handler was not called" (R10).
- **`RadioButton`'s first constructor argument is the label, not an options bag.** Passing `new RadioButton({ label: … })` mis-binds the label to the positional `text` parameter; TypeScript rejects it, but the shape differs from `Checkbox` and is easy to copy wrongly.
- **The gutter menu's test helpers are typed to one row class.** They must accept both after the change, or the file will not typecheck under `typecheck:test` even though the suite passes.

---

## Critical Files

| File | Why |
|---|---|
| [component/container/CheckboxMenuRow.ts](packages/lib/src/typescript/lib/component/container/CheckboxMenuRow.ts) | The precedent being copied — every behaviour of the new row except the control and `activate()`. Its constructor comment explains why `text` / `checked` / `enabled` bypass `_options`. |
| [component/input/RadioButton.ts:186-231](packages/lib/src/typescript/lib/component/input/RadioButton.ts#L186) | `activate()` (protected, select-only) and `setSelected()` (public, idempotent, fires no DOM event) — the two facts the new row's `activate()` and `setChecked()` rest on. |
| [component/input/AbstractBooleanInput.ts:100-176](packages/lib/src/typescript/lib/component/input/AbstractBooleanInput.ts#L100) | The label mount, `applyEnabled`, `isEnabled`, and the pointer/keyboard activation paths `Checkbox` and `RadioButton` share — proof the new row delegates rather than reimplements. |
| [component/container/MenuRow.ts:75-117](packages/lib/src/typescript/lib/component/container/MenuRow.ts#L75) | The `isEnabled()` / `isNavigable()` / `activate()` contract `Menu` drives every row through. |
| [layout/Split.ts:1089-1203](packages/lib/src/typescript/lib/layout/Split.ts#L1089) | `openGutterMenu` — the only call site changed, and the three rows that must be left alone. |
| [layout/Split.ts:329-356](packages/lib/src/typescript/lib/layout/Split.ts#L329) | `paneCollapsible` and `gutterTargetPane` — the model the rows display, including the `-1` "collapses neither" result. |
| [overlay/ButtonGroup.ts:95-233](packages/lib/src/typescript/lib/overlay/ButtonGroup.ts#L95) | `addButton` / `updateButtonStates` — read to confirm why the group cannot coordinate these rows. |
| [tests/component/container/MenuRow.test.ts](packages/lib/tests/component/container/MenuRow.test.ts) | The `click()` helper, the dispose rule, and the `CheckboxMenuRow` block the new block mirrors case for case. |
| [tests/component/layout/Split.gutterMenu.test.ts](packages/lib/tests/component/layout/Split.gutterMenu.test.ts) | The probe pattern, the per-config `buildRow` memoization, and the collapse-pair cases being rewritten. |
| [scripts/llms/generate.mjs](packages/lib/scripts/llms/generate.mjs) | Proves `llms.txt` is generated (summary scraped from the class JSDoc, doc link resolved by filename) and carries the token budget. |

---

## Non-Goals

- **The other three gutter rows are untouched.** Lock gutter and the two Fix-pane rows stay `CheckboxMenuRow`; their option bags, handlers, and surrounding code are not reformatted or renamed. They are independent toggles and remain correct as checkboxes.
- **No shared base class between `CheckboxMenuRow` and `RadioMenuRow`,** and no edit to `CheckboxMenuRow` at all.[^no-shared-base]
- **`ButtonGroup` is not modified,** and `RadioMenuRow` does not expose its inner `RadioButton` to let a group reach it — exposing it would invite exactly the cross-component `Event` listening ARCHITECTURE.md forbids.
- **No `setEnabled` on `RadioMenuRow`,** and no live re-sync of `enabled` while a menu is open: a menu rebuilds its rows from the factories on every open.
- **`Table`'s Filter row and show/hide-columns submenu are unaffected** — both are genuine multi-select checkbox menus.
- **`MenuItem.checked` / `closeOnActivate` are untouched.**
- **No live demo page for `RadioMenuRow`.**[^no-demo]

---

## Notes

[^no-shared-base]: `RadioMenuRow` duplicates roughly 200 of `CheckboxMenuRow`'s 265 lines — the column geometry, the listener wiring, the disabled writes, the `on` / `off` shorthand. Extracting a shared base was considered and rejected on two grounds. First, the seam is bad: the whole difference between the two classes is *which control is constructed*, so a base cannot build it, and the control would have to be handed back to the base after `super()` returns — leaving the base's `addComponent`, `doLayout` and `getContentWidth` reading a field the subclass fills in later, with a `declare` field to stop the initializer clobbering it. That is the `super()`-cascade ordering trap CODE_CONVENTIONS.md warns about, traded for code that has no branches in it. Second, the blast radius is wrong: `CheckboxMenuRow` is already consumed by three menus (the gutter menu, `Table`'s filter row, `Table`'s column submenu) plus two demos, and refactoring it — plus adding a third exported class to the public API and its docs — is a large change to make while adding one row type. The extraction is the right move at the third boolean menu row; `AbstractBooleanInput` is that same extraction one layer down, owning what `Checkbox`, `RadioButton` and `Toggle` share verbatim, and is the shape to copy when the time comes.

[^select-only]: `RadioButton.activate()` ([RadioButton.ts:186](packages/lib/src/typescript/lib/component/input/RadioButton.ts#L186)) selects and never deselects, and its doc comment gives the reason: a user can only ever select a radio; deselection is a sibling's job. `RadioMenuRow` would break that rule if it copied `CheckboxMenuRow`'s unconditional flip, since the row owns the click and the inner control never sees one. The body is a bare `setChecked(true)` with no "already selected" guard: `RadioButton.setSelected` already returns early when the value is unchanged ([RadioButton.ts:220-231](packages/lib/src/typescript/lib/component/input/RadioButton.ts#L220)), so a guard on the row would be a second copy of the same test. Note this makes only *user* activation one-way — `setChecked(false)` still deselects, which is what a call site needs to clear a sibling.

[^no-button-group]: `ButtonGroup.addButton` wires mutual exclusion through `button.on("action", …)` ([ButtonGroup.ts:220](packages/lib/src/typescript/lib/overlay/ButtonGroup.ts#L220)). For a `RadioButton`, `on("action", …)` registers a DOM `change` listener ([RadioButton.ts:303-314](packages/lib/src/typescript/lib/component/input/RadioButton.ts#L303)), and the only place that event is ever fired is inside `RadioButton.activate()` — reachable only from a click on the button's own ring or a keydown on the button's own root. `CheckboxMenuRow`'s architecture, which `RadioMenuRow` mirrors, makes the inner control `pointer-events: none` and gives the row the click, so the ring is never clicked and `activate()` never runs; `setSelected` fires no DOM event of its own (unlike `Checkbox.setSelected`, which synthesizes a `click`). A group would therefore sit there receiving nothing. Two further blocks: `ButtonGroup` accepts `RadioButton | ToggleButton`, not a `MenuRow`, so it could only be given the row's inner control — which means handing out a privately-owned child for an outsider to listen on, the pattern ARCHITECTURE.md's "a component must not listen to another component's events through `Event`" rule exists to prevent. Keeping the pairing in `Split.openGutterMenu` also keeps it where the truth lives: the target is derived from pane constraints, not from which row was clicked last.

[^sync-survives]: `syncCollapseRows` recomputes the live target and writes *both* rows from it, so it is indifferent to how the rows behave on click. Under checkboxes its job was to undo a self-click's flip-to-unchecked and to clear the sibling; under radios the first half becomes a no-op (`RadioButton.setSelected` returns early when unchanged) and the second half is what stops both rows reading as selected after a click. Deleting the write to the clicked row would still be wrong: when `retargetGutterCollapse` bails — no container, or a pane index that no longer resolves — the live target is unchanged and that write is what snaps the clicked row back to match the model. Keeping the body identical also keeps the change to `openGutterMenu` down to two type annotations, two constructor names and a comment.

[^neither-selected]: `gutterTargetPane` returns `-1` when the trailing pane does not collapse toward the end *and* the leading pane does not collapse toward the start — for example a leading pane constrained `collapseDirection: 'east'` beside a trailing pane constrained `'west'`. Both rows are then built with `checked: false` while staying enabled, since `enabled` reads `paneCollapsible`, not the target. This is a real state of the model, not a bug to paper over, so `RadioMenuRow` is not given any "one must always be selected" enforcement — that would need a group owner, and the pair has none by the decision above. It is also self-correcting: `retargetGutterCollapse` always writes a definite target, and a select-only row can never clear itself, so one click leaves the pair in the exactly-one-selected state for the rest of the split's life.

[^positional-label]: `RadioButton`'s constructor is `(text?, options?, subclassDefaults?)` ([RadioButton.ts:68](packages/lib/src/typescript/lib/component/input/RadioButton.ts#L68)) — the label is positional, kept that way for consumers written as `new RadioButton("Hello")`, and it is what the existing call sites use ([MiscPanel.ts:1447](packages/lib/src/typescript/MiscPanel.ts#L1447)). `Checkbox` instead takes the bag first and reads `label` from it, which is why the copied line cannot stay as-is. Passing `""` for a row built without `text` matches what `CheckboxMenuRow` does with `label: options?.text ?? ""` — both mount an empty `Text` child rather than none, keeping the row's preferred-size arithmetic identical whether or not a label was given.

[^no-demo]: `CheckboxMenuRow.md` embeds a live demo, but `Menu.md`, `MenuItem.md` and `MenuSeparator.md` do not — a demo-less component page is established here. A demo would mean a new entry-point module under `packages/docs/src/demos/` whose only content is a second copy of the doc page's code sample, and the interesting behaviour (a click on the selected row doing nothing) is invisible in a screenshot-shaped demo anyway. The gutter menu itself remains exercisable in the dev app at `#/split`, which is where the manual check runs.
