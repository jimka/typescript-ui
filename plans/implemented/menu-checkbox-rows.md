---
touches-shared: [packages/lib/src/typescript/lib/component/table/Table.ts, packages/lib/src/typescript/lib/layout/Split.ts]
---

# Menu Checkbox Rows — Implementation Plan

## Overview

Three menus in the library still express a multi-select toggle as a `MenuItem`: the table's **Filter** row ([table/Table.ts:1486-1489](packages/lib/src/typescript/lib/component/table/Table.ts#L1486)) hand-prefixes a `✓` character onto its label, and the table's show/hide-columns submenu ([table/Table.ts:1550-1555](packages/lib/src/typescript/lib/component/table/Table.ts#L1550)) plus the split's gutter menu ([layout/Split.ts:1109-1139](packages/lib/src/typescript/lib/layout/Split.ts#L1109)) use the `checked:` field but close the panel on every toggle. All three become [`CheckboxMenuRow`](packages/lib/src/typescript/lib/component/container/CheckboxMenuRow.ts) rows: real `Checkbox` widgets inside the menu, and the panel stays open so a user can flip several rows in one open.

Two of those three sites disable some of their rows today (an `unhideable` column, a non-collapsible pane), and `CheckboxMenuRow` has no disabled state at all. So the first phase adds a construction-time `enabled` option to `CheckboxMenuRow` — an `isEnabled()` override, a dimmed and pointer-inert row, and a guard in `activate()`. Converting the call sites before that would silently make locked columns and locked panes togglable.

Because the panel now survives a toggle, every converted handler must read the row's live state (`row.isChecked()`) instead of a boolean captured when the menu was built. That is the convention the demo already follows ([MenuBarPanel.ts:142-155](packages/lib/src/typescript/MenuBarPanel.ts#L142)).

`MenuItem`'s own `checked` + `closeOnActivate` mechanism is unchanged and stays the right tool for single-choice menus — see `## Non-Goals`.

---

## Architecture Decisions

### `CheckboxMenuRow.enabled` is construction-time only — no `setEnabled`

`CheckboxMenuRowOptions` gains `enabled?: boolean`, defaulting to `true`. There is no live setter.[^no-setter]

### The inner `Checkbox` is the cache for `enabled`, as it already is for `checked`

`isEnabled()` returns `this._checkbox.isEnabled()`, and the constructor passes `enabled: options?.enabled ?? true` into the `Checkbox` options bag beside the existing `label` / `selected`. No new field, no `applyOptions` override.[^checkbox-is-cache]

### A disabled row is dimmed with opacity and made pointer-inert

When `enabled` is `false` the constructor adds two writes on the row itself:

| Write | Why |
|---|---|
| `this.setOpacity(DISABLED_OPACITY)` | `Checkbox`'s own enabled handling sets ARIA, tabindex and cursor but paints no dim, and the row's greyable content is a box graphic rather than text. `0.5` on the row dims box and label together. |
| `this.setPointerEvents("none")` | The only mechanism that stops a consumer's `on("action", …)` handler from running on a click. |

The `pointer-events` write is load-bearing, not cosmetic. `CheckboxMenuRow.on("action", fn)` registers `fn` as a *second* click listener on the row, next to the row's own `_onClick`. `Event`'s exact-target dispatch runs every listener registered for the target element regardless of what an earlier one returns ([core/Event.ts:148-155](packages/lib/src/typescript/lib/core/Event.ts#L148)), so a guard inside `_onClick` or `activate()` cannot suppress the consumer's handler — only keeping the click off the row does.[^pointer-inert]

### The guard lives in `activate()`, not in the click handler

`activate()` returns early when `!this.isEnabled()`, mirroring [`MenuItem.activate`](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L511). `_onClick` is left alone: it delegates to `activate()`, so one guard covers both the pointer path and the keyboard path `Menu.activateFocused()` drives.[^one-guard]

### Every converted handler reads `row.isChecked()`

A handler must never re-use a boolean captured when the menu was built. Concretely: `action: () => this.setColumnVisible(fieldName, !visible)` becomes `row.on("action", () => this.setColumnVisible(fieldName, row.isChecked()))`. With the panel closing on every activation the captured value could not go stale; now it can — a second toggle in the same open would re-apply the first toggle's outcome. `CheckboxMenuRow` fires `"action"` after its own state has flipped, so `isChecked()` inside the handler reads the new value.

### The split's two collapse rows re-sync each other after every toggle

"Collapse `<lead>` pane" and "Collapse `<next>` pane" are one choice rendered as two rows: [`retargetGutterCollapse`](packages/lib/src/typescript/lib/layout/Split.ts#L1170) points the gutter at one neighbour and there is no "collapses neither" state to un-check into. Each of the two handlers therefore recomputes the live target with `gutterTargetPane` and writes **both** rows' checked state:

| Rows when clicked | User clicks | Target after | Rows after re-sync |
|---|---|---|---|
| lead ☑, next ☐ | Collapse next | next | lead ☐, next ☑ |
| lead ☐, next ☑ | Collapse next (already the target) | next (unchanged) | lead ☐, next ☑ (its own box restored) |
| lead ☑, next ☐ | Collapse lead (already the target) | lead (unchanged) | lead ☑ (restored), next ☐ |

The other three rows need no re-sync: "Lock gutter" and the two "Fix … pane" rows each own an independent piece of state and their existing handlers already flip it from live state.

### The remaining rows in these menus are untouched

Separators, the group-header rows (`{ text: group, enabled: false }`), "Reset columns", "Show/hide columns", and the export rows stay plain `MenuItemConfig`s. The only entries that change are the table's Filter row, its one-per-column submenu rows, and the split's five gutter toggles.

---

## Public API

```typescript
// packages/lib/src/typescript/lib/component/container/CheckboxMenuRow.ts

export interface CheckboxMenuRowOptions extends ComponentOptions {
    text?:    string;
    checked?: boolean;
    /** Whether the row is interactive. Defaults to `true`. */
    enabled?: boolean;
    listeners?: { action?: () => void };
}

class CheckboxMenuRow extends MenuRow<CheckboxMenuRowOptions> {
    /** Overrides `MenuRow.isEnabled()`; reads the inner Checkbox's state. */
    isEnabled(): boolean;
}
```

No backing field and no setter: `enabled` is stored by the inner `Checkbox`'s own options bag, written once at construction.

---

## Implementation

### `CheckboxMenuRow` — the disabled path

```typescript
// Module scope, beside the imports.
// Dim applied to a disabled row, matching the framework's other composite
// disabled controls (Button.setEnabled, NumberSpinner.applyEnabled).
const DISABLED_OPACITY = 0.5;
```

```typescript
// In the constructor, replacing the existing `new Checkbox({ … })` call.
this._checkbox = new Checkbox({
    label:    options?.text ?? "",
    selected: options?.checked ?? false,
    enabled:  options?.enabled ?? true,
});
this._checkbox.setPointerEvents("none");
this.addComponent(this._checkbox);

if (options?.enabled === false) {
    // Pointer-inert, not merely guarded: a consumer's `on("action", …)`
    // handler is a second click listener on this row, which no guard inside
    // `activate()` can suppress. Keeping the click off the row is what makes
    // a disabled row truly non-interactive.
    this.setPointerEvents("none");
    this.setOpacity(DISABLED_OPACITY);
}
```

```typescript
isEnabled(): boolean {
    return this._checkbox.isEnabled();
}

activate(): void {
    if (!this.isEnabled()) {
        return;
    }

    this.setChecked(!this.isChecked());
}
```

### `Split.openGutterMenu` — the collapse pair

```typescript
// Declared above `const configs`, after `const target = …`.
let collapseLeadRow: CheckboxMenuRow | null = null;
let collapseNextRow: CheckboxMenuRow | null = null;

const syncCollapseRows = (): void => {
    const live = this.gutterTargetPane(gutterIndex, components);

    collapseLeadRow?.setChecked(live === gutterIndex);
    collapseNextRow?.setChecked(live === gutterIndex + 1);
};
```

```typescript
// The lead collapse entry; the next entry is the mirror image
// (`gutterIndex + 1`, `nextWord`, `next`, `collapseNextRow`).
{
    row: () => {
        const row = new CheckboxMenuRow({
            text:    `Collapse ${leadWord} pane`,
            checked: target === gutterIndex,
            enabled: !gutter.isOpaque() && this.paneCollapsible(lead),
        });

        row.on("action", () => {
            this.retargetGutterCollapse(gutterIndex, gutterIndex);
            syncCollapseRows();
        });

        collapseLeadRow = row;

        return row;
    },
},
```

The optional calls in `syncCollapseRows` cover a test that builds one factory without the other; `Menu` always calls every factory before the panel is interactive.

---

## Ordered Implementation Steps

Phases 2 and 3 are independent of each other; both depend on phase 1.

### Phase 1 — `CheckboxMenuRow` gains `enabled`

1. **Tests first** — [tests/component/container/MenuRow.test.ts](packages/lib/tests/component/container/MenuRow.test.ts), inside the existing `describe('CheckboxMenuRow')`. Add cases for behaviours B1-B5 and B6a in `## Expected Behaviour`. Reuse the file's existing `click(row)` helper and keep disposing every row built by a test, for the reason the `afterEach` comment at the top of that describe block gives. Then add B6b to [tests/overlay/Menu.test.ts](packages/lib/tests/overlay/Menu.test.ts), beside its existing `'activateFocused no-ops on a disabled item'` case (line 534), which already builds a persistent-mode menu and drives `focusItem` / `activateFocused`. Expect red.
2. **Options + JSDoc** — [component/container/CheckboxMenuRow.ts](packages/lib/src/typescript/lib/component/container/CheckboxMenuRow.ts): add `enabled?: boolean` to `CheckboxMenuRowOptions` with a doc comment matching the phrasing of [`MenuItemConfig.enabled`](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L59) ("Defaults to `true`. Disabled rows are dimmed and non-interactive."). Add the `DISABLED_OPACITY` module constant.
3. **Constructor** — pass `enabled` into the `Checkbox` options bag and add the `options?.enabled === false` block, exactly as in `## Implementation`. Do not add a `_defaultCheckboxMenuRowOptions` bag: the class has none today and `?? true` in the constructor matches how `checked` is already defaulted two lines above. Nothing goes in the default-resolution registry in [tests/component/default-options-fallback.test.ts](packages/lib/tests/component/default-options-fallback.test.ts).
4. **`isEnabled()` + `activate()` guard** — add the override and the early return, with JSDoc. Leave `isNavigable()` returning `true` for a disabled row: `MenuItem` is navigable-when-disabled too, and `Menu.activateFocused` is what refuses ([overlay/Menu.ts:789](packages/lib/src/typescript/lib/overlay/Menu.ts#L789)). Phase-1 tests green.

### Phase 2 — the two `Table` menus

5. **Import** — [component/table/Table.ts](packages/lib/src/typescript/lib/component/table/Table.ts): add `import { CheckboxMenuRow } from "~/component/container/CheckboxMenuRow.js";` beside the existing `MenuItemConfig` import.
6. **Tests first** — [tests/component/table/ColumnVisibilityMenu.test.ts](packages/lib/tests/component/table/ColumnVisibilityMenu.test.ts). The file's helpers read `config.text` / `.checked` / `.enabled` / `.action`, none of which survive the conversion. Rework them:
   - Add `buildRow(config)`: calls `config.row!()`, records the row in a module-level array that an `afterEach` disposes, and returns it.
   - Add `rowLabel(row)`: `(row.getComponents()[0] as InstanceType<typeof Checkbox>).getLabel() ?? ''` — the row's only child is its `Checkbox`. Public API only; no `as any` probe needed.
   - Add `toggle(row)`: mounts with `row.getElement(true)` and dispatches a click through `DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(handle, 'click'))`, copying [MenuRow.test.ts:26-29](packages/lib/tests/component/container/MenuRow.test.ts#L26). Import `makeEvent` from `'../../dom/TestDOM'`.
   - `labels()` maps a `row` config through `buildRow` + `rowLabel`, a separator to `'---'`, and anything else to `c.text!`.
   - Field rows are now identified by `c.row !== undefined` (was `c.action !== undefined`); group headers by `!c.separator && c.row === undefined`.
   Then update the file's numbered cases 5, 7, 8, 10, 11 and 12 to the assertions in `## Expected Behaviour` (B8-B12). Its cases 9 and 13-19 assert on group headers, separators, and the dialog, and must keep passing untouched. Expect red.
7. **Filter row** — [table/Table.ts:1483-1491](packages/lib/src/typescript/lib/component/table/Table.ts#L1483): replace the `{ text, action }` entry with a `row:` factory that builds `new CheckboxMenuRow({ text: 'Filter', checked: this._filterRowVisible })`, wires `row.on('action', () => { this.setFilterRowVisible(row.isChecked()); })`, and returns it. The preceding `{ separator: true }` stays.
8. **Column submenu** — [`buildColumnMenuItems`](packages/lib/src/typescript/lib/component/table/Table.ts#L1525): replace the `items.push({ text, checked, action, enabled })` call with a `row:` factory. Keep the `GROUP_INDENT` prefix in the row's `text`, and map `enabled: !col.isUnhideable()` onto the row's `enabled` option. Handler: `this.setColumnVisible(fieldName, row.isChecked())`. Hoist the label and enabled expressions to `const`s above the `push` so the factory closes over them. The group-boundary separator and the `{ text: group, enabled: false }` header push above are untouched.
9. **Checkpoint** — `grep -c "row: () =>" packages/lib/src/typescript/lib/component/table/Table.ts` → expect `2`, and `grep -n "'✓ '" packages/lib/src/typescript/lib/component/table/Table.ts` → expect zero matches. Phase-2 tests green.

### Phase 3 — the split's gutter menu

10. **Import** — [layout/Split.ts](packages/lib/src/typescript/lib/layout/Split.ts): add the same `CheckboxMenuRow` import.
11. **Tests first** — [tests/component/layout/Split.gutterMenu.test.ts](packages/lib/tests/component/layout/Split.gutterMenu.test.ts). Give it the same `buildRow` / `rowLabel` / `toggle` helpers as step 6, with the same dispose-in-`afterEach` discipline; the file imports neither `_Checkbox` nor `makeEvent` yet, so add both. `labels()` and `row(configs, text)` look rows up by built label instead of `config.text`. Rewrite every `.action!()` call as `toggle(builtRow)` and every `.checked` / `.enabled` read as `builtRow.isChecked()` / `builtRow.isEnabled()`. Add the collapse-pair re-sync case (B18). Expect red.
12. **Convert the five rows** — [`openGutterMenu`](packages/lib/src/typescript/lib/layout/Split.ts#L1088): turn each of the five `{ text, checked, action, enabled? }` entries into a `row:` factory per `## Implementation`, keeping the two separators, the label wording, the ordering, and the two `enabled` conditions exactly as they are. Add `collapseLeadRow` / `collapseNextRow` and `syncCollapseRows`. `togglePaneResizePin` and `retargetGutterCollapse` keep their current bodies and stay the handlers' entry points.
13. **Checkpoint** — `grep -c "row: () =>" packages/lib/src/typescript/lib/layout/Split.ts` → expect `5`. Phase-3 tests green.

### Phase 4 — docs

14. Update the four doc files listed in `## Documentation Impact`.
15. Run every command in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/container/CheckboxMenuRow.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Table.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Split.ts` |
| Modify | `packages/lib/tests/component/container/MenuRow.test.ts` |
| Modify | `packages/lib/tests/overlay/Menu.test.ts` |
| Modify | `packages/lib/tests/component/table/ColumnVisibilityMenu.test.ts` |
| Modify | `packages/lib/tests/component/layout/Split.gutterMenu.test.ts` |
| Modify | `packages/lib/docs/components/CheckboxMenuRow.md` |
| Modify | `packages/lib/docs/components/Table.md` |
| Modify | `packages/lib/docs/layouts/Split.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Unit-testable unless marked **manual**.

**`CheckboxMenuRow`**

- **B1.** `new CheckboxMenuRow({ text: 'Bold' }).isEnabled()` is `true`; so is `{ …, enabled: true }`.
- **B2.** An enabled row makes neither disabled write: `getOpacity()` is `null` and `getPointerEvents()` is `null`.
- **B3.** `{ enabled: false }` reports `isEnabled() === false`, `getOpacity() === 0.5`, `getPointerEvents() === 'none'`.
- **B4.** `activate()` on a disabled row leaves `isChecked()` unchanged — from both `checked: false` and `checked: true`.
- **B5.** A click dispatched at a disabled row's element leaves `isChecked()` unchanged. This pins the `activate()` guard only: the offline harness dispatches straight at the target and does not honour `pointer-events`, so do **not** assert that an `on("action")` handler goes uncalled here — it will fire in tests and not in a browser.
- **B6a.** A disabled row still reports `isNavigable() === true` — the highlight lands on it, exactly as it does on a disabled `MenuItem`.
- **B6b.** In a persistent-mode `Menu`, focusing a disabled `CheckboxMenuRow` and calling `activateFocused()` leaves `isChecked()` unchanged.
- **B7. manual.** In a browser, a disabled row is visibly dimmed, does not highlight on hover, and a click on it changes nothing.

**Table — Filter row**

- **B8.** The Filter entry is a `row` config carrying no `text`; the built row is labelled `'Filter'` (no `✓`/space prefix anywhere in the menu) and its `isChecked()` matches `isFilterRowVisible()` at build time.
- **B9.** Toggling the built Filter row once makes `table.isFilterRowVisible()` `true`; toggling the *same* row instance again makes it `false`.

**Table — column submenu**

- **B10.** Every per-column entry is a `row` config, in field order, one per resolved column. Built labels are `GROUP_INDENT + fieldName` for a grouped column and the bare `fieldName` otherwise. Group headers (`{ text: group, enabled: false }`) and the group-boundary separators are unchanged.
- **B11.** A built row's `isChecked()` matches the column's visibility; an `unhideable` column's row reports `isEnabled() === false` and `isChecked() === true`.
- **B12.** Toggling a visible column's row hides exactly that column; toggling the *same* row instance again shows it (the stale-capture case).
- **B13. manual.** Right-clicking a column header and toggling Filter and several columns leaves the menu and the submenu open throughout.

**Split — gutter menu**

- **B14.** The menu is five `row` configs and two separators, in today's order, with today's labels on both orientations (`left`/`right`/`width` vs `top`/`bottom`/`height`).
- **B15.** "Lock gutter": built checked when `!gutter.isMovable()`; toggling it flips `gutter.isMovable()`; toggling the same row again flips it back.
- **B16.** "Fix `<lead>` pane `<extent>`": built checked when the pane's resize weight is `0`; toggling pins it to `0`, toggling again clears it to `undefined`; the sibling pin row is unaffected.
- **B17.** Collapse rows: built checked from `gutterTargetPane`. Toggling the non-target row moves the target to that neighbour.
- **B18.** After any collapse toggle both collapse rows match the live target — including toggling the row that is *already* the target, which leaves the target unchanged and restores that row's own checkbox (the already-the-target cases in the table under `## Architecture Decisions`).
- **B19.** Both collapse rows report `isEnabled() === false` while the gutter is opaque, and the `<next>` collapse row alone reports `false` for a `collapsible: false` neighbour; the lock row and both pin rows stay enabled in both cases.
- **B20.** The menu is still rebuilt per open: setter calls made between opens (`setMovable`, `setPaneResizeWeight`) show up in the next open's built rows.
- **B21. manual.** Right-clicking a gutter and toggling the lock plus both pins leaves the menu open throughout.

---

## Verification

```bash
npm run typecheck          # tsc over the library sources
npm test                   # typecheck:test + vitest run
npm run lint               # eslint over src
npm run docs:api           # TypeDoc — must finish with zero warnings
```

Grep invariants after phases 2 and 3:

```bash
grep -n "'✓ '"      packages/lib/src/typescript/lib/component/table/Table.ts   # expect none
grep -c "row: () =>" packages/lib/src/typescript/lib/component/table/Table.ts  # expect 2
grep -c "row: () =>" packages/lib/src/typescript/lib/layout/Split.ts           # expect 5
```

Manual smoke test (`npm run dev`, app on `localhost:8015`):

1. A table screen — right-click a column header. Toggle **Filter**: the filter row appears and the menu stays open. Open **Show/hide columns** and toggle two columns in one open. Confirm the `unhideable` column's row is dimmed and does nothing when clicked. (B7, B13.)
2. A split screen — right-click a gutter. Toggle **Lock gutter** and both **Fix … pane** rows in one open. Click each **Collapse … pane** row and confirm exactly one of the pair is ever checked, including after clicking the already-checked one. Collapse a pane so the gutter becomes a strip, reopen, and confirm both collapse rows are dimmed. (B18, B19, B21.)

---

## Documentation Impact

- [docs/components/CheckboxMenuRow.md](packages/lib/docs/components/CheckboxMenuRow.md) — add an `enabled` row to the Options table ("Whether the row is interactive. Defaults to `true`. A disabled row is dimmed and ignores clicks and Enter.") and `isEnabled()` to the Methods table. State in prose that `enabled` is construction-time only, and that a menu rebuilds its rows on every open, so a row's enabled state is set by the factory each time.
- [docs/components/Table.md](packages/lib/docs/components/Table.md) — the "Showing and hiding columns" section currently ends with "Toggling a row hides or shows that column immediately and closes the menu." Rewrite: each column is a real checkbox row, toggling applies immediately and the submenu stays open, and an `unhideable` column's row is a disabled checkbox. The **Filter** mention in the column-filters section stays accurate.
- [docs/layouts/Split.md](packages/lib/docs/layouts/Split.md) — the "Gutter context menu" section: the five toggles are now checkbox rows and the menu stays open across toggles, so several can be flipped in one open; the two collapse rows remain one choice, so checking one unchecks the other.
- [docs/reference/changelog/next.md](packages/lib/docs/reference/changelog/next.md) — extend the existing `CheckboxMenuRow` bullet under `## Added` → `### Menu` with the `enabled` option rather than opening a `## Changed` entry: the component itself is unreleased. Add consumer-visible `## Changed` bullets under `### Table` and `### Split` for the menus that no longer close on a toggle.

The public export surface does not change: `CheckboxMenuRow` and `CheckboxMenuRowOptions` are already exported from [component/container/index.ts:16-17](packages/lib/src/typescript/lib/component/container/index.ts#L16), and [packages/lib/llms.txt](packages/lib/llms.txt) already carries the component's one-line entry.

---

## Potential Challenges

- **The column submenu loses its check column.** No entry in that submenu declares `checked` any more, so `Menu.layOutColumns` reserves no leading check zone and every row's content starts at `MenuItem.TEXT_INSET`. Group headers then sit level with the checkbox graphics rather than with the labels, and `GROUP_INDENT` renders between a row's checkbox and its label instead of before it. Confirm it reads acceptably during the manual smoke test; nothing in the code needs to change for it.
- **Undisposed rows built by tests break later tests in the same file.** A `CheckboxMenuRow` wires window-level click/mouseover listeners whose installed-type bookkeeping outlives `DOM.reset()`, so a leaked row leaves the type marked installed against a discarded sink and the next test's dispatch silently finds no handler. Every test that builds a row must dispose it.
- **`pointer-events` is not observable offline.** The disabled row's click suppression is asserted through `getPointerEvents()` plus a browser check, never through "the handler was not called" (see B5).
- **A `row` config ignores its sibling fields.** `MenuItemConfig.row` wins over `text` / `checked` / `enabled` / `action` (only `separator` beats it), so the converted entries must carry `row` alone — leaving a stale `checked:` behind would look meaningful and do nothing.

---

## Critical Files

| File | Why |
|---|---|
| [component/container/CheckboxMenuRow.ts](packages/lib/src/typescript/lib/component/container/CheckboxMenuRow.ts) | The class being extended; its constructor comment explains why `text`/`checked` bypass `_options`. |
| [component/container/MenuItem.ts:483-521](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L483) | The `enabled` precedent this mirrors: `isEnabled()` reading a construction-time value, `activate()` guarding on it, and the `MenuItemConfig.row` contract at lines 105-113. |
| [component/container/MenuRow.ts:69-91](packages/lib/src/typescript/lib/component/container/MenuRow.ts#L69) | The base `isEnabled()` / `isNavigable()` contract `Menu` drives every row through. |
| [component/input/AbstractInput.ts:98-120](packages/lib/src/typescript/lib/component/input/AbstractInput.ts#L98) | `Checkbox`'s inherited `isEnabled` / `setEnabled` / `applyEnabled` — the API the row delegates to, and proof that it paints no dim of its own. |
| [overlay/Menu.ts:206-238, 789](packages/lib/src/typescript/lib/overlay/Menu.ts#L206) | `layOutColumns` (why the check column disappears) and `activateFocused` (the keyboard guard already in place). |
| [MenuBarPanel.ts:142-155](packages/lib/src/typescript/MenuBarPanel.ts#L142) | The `row: () => new CheckboxMenuRow(…)` + `row.on('action', …)` + `row.isChecked()` convention the three conversions follow. |
| [tests/component/container/MenuRow.test.ts](packages/lib/tests/component/container/MenuRow.test.ts) | The `click()` helper and the dispose-every-row rule both rewritten test files copy. |

---

## Non-Goals

- **`MenuItem.checked` / `closeOnActivate` are unchanged.** They remain correct for single-choice and mutually-exclusive menus — the filter operator pickers in [table/cell/Filter.ts](packages/lib/src/typescript/lib/component/table/cell/Filter.ts) and the demo items at [MenuBarPanel.ts:120-140](packages/lib/src/typescript/MenuBarPanel.ts#L120). Neither file is touched.
- **No other menu is converted.** The three sites here are the complete set that investigation found.
- **No `setEnabled` on `CheckboxMenuRow`,** and no live enabled-state re-sync while a menu is open. Nothing any of the three sites does can change a row's enabled condition mid-open.[^no-live-enabled]
- **The `"action"` event is not re-plumbed.** Keyboard activation (`Menu.activateFocused` → `activate()`) flips the checkbox without firing `"action"`, because `"action"` is a DOM-click shorthand. That gap is pre-existing, none of the three converted menus has a keyboard driver, and closing it means changing `CheckboxMenuRow`'s event surface for every consumer.[^enter-no-action]

---

## Implementation Notes

- **`tests/component/table/ColumnFilterRow.test.ts` also needed converting, but wasn't in the plan's file table.** Its own "header context-menu toggle" section (cases 35-37) asserted on the Filter entry's pre-conversion `text`/`action` shape independently of `ColumnVisibilityMenu.test.ts`. Cases 35-36 converted the same way as `ColumnVisibilityMenu.test.ts`'s case 5. Case 37 ("invoking the Filter action toggles the row...") could not be converted to a real click dispatch the way `ColumnVisibilityMenu.test.ts`'s new case 5b was: this file's other ~74 tests build dozens of `Table`s via a shared `makeTable()` helper and never dispose them, so by the time case 37 runs, the offline harness's window-level `"click"` listener (installed once per process against whichever sink was live when the *first* such `Table` was built) is permanently stuck against a long-discarded sink, and `DOM.sink.dispatchEvent` silently finds no handler — the same class of gotcha `Form.test.ts`'s `disposeForm` documents, but with no single, easily-touched construction site to fix (at least three separate `new Table(...)` call sites across the file, not just `makeTable`). Rather than adding disposal across a ~900-line file outside this plan's scope, case 37 was rewritten to pin the build-time binding instead (the built Filter row's `isChecked()` tracks `table.isFilterRowVisible()` across menu rebuilds) — the click-driven round trip (a real click flips the row, and its `on("action", ...)` handler applies the new state) is still covered end to end by `ColumnVisibilityMenu.test.ts`'s case 5b, which hits the exact same `Table.ts` factory code and *is* disposal-safe (its `makeTable()` is the file's only `Table`-construction path, so disposing there is enough).
- **`ColumnVisibilityMenu.test.ts` needed a `menuRowLabel` helper, not the plan-suggested name `rowLabel`.** The file already has an unrelated `rowLabel(r: Component)` for the dialog's `Text`/`Checkbox` rows (prefixing `'H:'`/`'C:'`); reusing that name for the submenu's built-row label would collide. `menuRowLabel` carries the exact behaviour the plan specified (`row.getComponents()[0].getLabel()`); `Split.gutterMenu.test.ts` had no such collision, so its helper is named `rowLabel` as the plan wrote it.
- **`Split.gutterMenu.test.ts`'s `buildRow` memoizes per config object.** A first draft rebuilt a `row:` config's `CheckboxMenuRow` on every lookup, which is harmless for the four independent rows but broke the two collapse rows: they close over a shared `let collapseLeadRow`/`collapseNextRow` pair scoped to one `openGutterMenu()` call, so a second, discarded rebuild of the same config silently rebound those fields to a row the test could no longer see, and the collapse-pair re-sync test (B18) appeared to fail. Caching the built row per config object (keyed by object identity, so a fresh `openMenuFor()` call — a fresh `configs` array — still builds fresh rows) fixed it and matches what `Menu` itself does: build each factory once per open.
- **Manual verification (`## Verification`'s browser smoke test, B7/B13/B21).** Run against this worktree's own dev server (`npm run dev`, `localhost:8015`), `#/misc` → "Show window with table (column spec)!" and `#/split`:
  - **B7 — confirmed.** Right-clicked the "Name" column header, opened "Show/hide columns": the `Name` row (its `ColumnConfig.unhideable: true`) renders visibly dimmed against its enabled siblings, its accessibility node reports `checkbox "Name" checked disableable disabled`, and clicking it left both the checked state and the disabled state unchanged, with the submenu still open. Screenshotted and re-snapshotted before/after the click to confirm no state change.
  - **B13 — confirmed.** Toggling Filter and several columns in one open, and opening the submenu, all left the context menu and submenu open throughout, matching the plan's step 1.
  - **B21 — partially confirmed.** Right-clicking a Split gutter, toggling "Lock gutter," and toggling "Collapse right pane" (which correctly un-checked "Collapse left pane" in the same open) all left the menu open. Collapsing a pane into an opaque strip and reopening to confirm both collapse rows dim (the plan's step 2, second half) was not exercised in a live browser this pass — the app's own Split demo's collapse chevron did not yield an accessible target in this pass, and time did not allow chasing it further. That specific path is covered by an automated test instead (`Split.gutterMenu.test.ts`'s `'disables both Collapse rows while the gutter is an opaque collapse strip'`, which drives `gutter.setOpaque(true)` directly and asserts `isEnabled() === false` on both rows), exercising the same `enabled: !gutter.isOpaque() && …` expression a live opaque gutter would.

---

## Notes

[^no-setter]: A `row: () => MenuRow` factory is called once per menu build, and `Menu` disposes and rebuilds its whole item list on every open ([MenuItem.ts:105-113](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L105)). Both converted call sites already recompute their enabled conditions inside the factory, so each open gets a fresh row with a fresh value — exactly how `MenuItemConfig.enabled` behaves today. The class's own `text` option is construction-time only for the same reason; `checked` has a setter only because the row flips it itself. A setter would be unreachable API on a component no consumer holds a reference to across opens.

[^checkbox-is-cache]: The class already documents this arrangement: its constructor comment states that `text` / `checked` are read from the raw constructor argument and that "`_checkbox` itself is the state cache for `checked` from this point on", because neither field has a setter for `applyOptions` to dispatch through. `enabled` is the same shape, and `Checkbox` inherits a cached `isEnabled()` from `AbstractInput` reading its own `_options.enabled ?? true`. Adding a private `_enabled` field or an `applyOptions` override would duplicate a cache that already exists one level down. ARCHITECTURE.md's "always cache in memory" rule is satisfied — the read never touches the DOM.

[^pointer-inert]: Three alternatives were checked and rejected. (1) Guarding `_onClick` alone: the consumer's `on("action", …)` listener is registered separately on the same element, so it still runs — for the split's collapse rows that would mutate the gutter's collapse target from a disabled row. (2) Returning a stop disposition from `_onClick`: `Event`'s exact-target loop applies the disposition to DOM propagation but keeps iterating the element's own listener list, so later listeners still run. (3) Greying the row with `--ts-ui-<prefix>-item-disabled-color` the way `MenuItem` does: that only recolours inherited text, leaving the checkbox graphic at full contrast, and the CSS-variable family is injected by `Menu` *after* the factory returns, so a constructor-time write would bake in the wrong prefix. `setPointerEvents("none")` plus `setOpacity(0.5)` mirrors [`NumberSpinner.applyEnabled`](packages/lib/src/typescript/lib/component/input/NumberSpinner.ts#L339), which disables a composite control exactly this way. One divergence from `MenuItem` is accepted: a disabled `MenuItem` still highlights on hover, a disabled `CheckboxMenuRow` does not, because the row receives no `mouseover` either.

[^one-guard]: `MenuItem` guards in both `_onClick` and `activate()` because its click handler calls the private `activateLeaf()` directly rather than going through `activate()`. `CheckboxMenuRow._onClick` is `() => { this.activate(); }`, so the single guard covers both entry points, and leaving `_onClick` untouched keeps the diff to the three members that carry the new state.

[^no-live-enabled]: Checked per site. In the split menu, "Lock gutter" writes `SplitGutter.setMovable`, which feeds neither `isOpaque()` nor `paneCollapsible()`; the two pin rows write resize weights, which feed neither. In the table submenu, `setColumnVisible` does not change any column's `unhideable` flag. So no toggle can invalidate a sibling row's enabled state within one open.

[^enter-no-action]: `activate()` calls `setChecked`, which calls `Checkbox.setSelected`, which fires its synthetic `"click"` on the *Checkbox's* element. The row's listeners are exact-target on the *row's* element, so they do not see it — this is the same isolation that stops the checkbox's synthetic click re-entering the row's toggle. Firing a click on the row instead would re-enter `_onClick` and recurse. The fix is to move `"action"` onto a `ListenerBag` emitted from `activate()`, which changes the event's contract for every existing consumer and belongs in its own plan. All three converted menus are pointer-driven: the table's column submenu and the split's gutter menu have no keyboard driver, and `Menu.activateFocused` is persistent-mode only, reached today only through `MenuBar`.
