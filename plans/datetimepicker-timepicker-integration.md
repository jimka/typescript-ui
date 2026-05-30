# DateTimePicker / TimePicker Integration & Selection-Spasm Fix — Implementation Plan

## Overview

Two related changes to the time-selection picker surface:

1. **Reuse the TimePicker's column UI inside the DateTimePicker.** Today
   [`DateTimePickerDropdown`](../src/typescript/lib/component/input/DateTimePickerDropdown.ts)
   builds its time portion from three fixed-width `ComboBox`es
   (`DateTimePickerSelect`, [DateTimePickerDropdown.ts:69](../src/typescript/lib/component/input/DateTimePickerDropdown.ts#L69)),
   while [`TimePickerDropdown`](../src/typescript/lib/component/input/TimePickerDropdown.ts)
   builds a scrollable `PickerColumn`/`PickerCell` grid
   ([TimePickerDropdown.ts:139](../src/typescript/lib/component/input/TimePickerDropdown.ts#L139)).
   They look like two different controls. This plan extracts the column-grid
   time UI into a reusable, self-contained unit and has both dropdowns render it,
   so the DateTimePicker's time portion becomes the same scrollable Hour/Min/Sec
   columns the TimePicker shows.

2. **Fix the "spasm" when picking an hour/minute/second.** Root-caused below:
   every cell click tears the entire grid down (`removeAllComponents` + rebuild
   every column, [TimePickerDropdown.ts:139](../src/typescript/lib/component/input/TimePickerDropdown.ts#L139)),
   which resets each scrollable column to `scrollTop = 0` for a frame before the
   user's eye re-finds the value — a one-frame visual jump. The fix replaces the
   full rebuild with an in-place selection update.

Both concerns converge on the same code: the extracted time-selection unit owns
the build-once / update-in-place logic, so fixing the spasm once fixes it for
both dropdowns.

The two exported dropdown classes
([`src/typescript/lib/component/input/index.ts:60-61`](../src/typescript/lib/component/input/index.ts#L60))
keep their public constructor signatures, `showAt` contract, and
`onSelect`/`onDropdownSelected` callbacks unchanged.
[`DateTimeField`](../src/typescript/lib/component/input/DateTimeField.ts) and
[`TimeField`](../src/typescript/lib/component/input/TimeField.ts) are untouched —
their value get/set and event contract are preserved by construction.

---

## Architecture Decisions

### Extract a `TimeColumns` component shared by both dropdowns

The TimePicker's grid (`_grid` HBox of `PickerColumn`s + the per-unit
hour/minute/second state and selection callbacks) is the unit worth reusing —
it already contains the exact behaviour the DateTimePicker's combobox row
approximates (24 hours, 5-min/5-sec snaps, highlight-the-active-value). Extract
it into a new internal component, `TimeColumns`, that:

- owns `_hours` / `_minutes` / `_seconds` and the `showSeconds` flag,
- builds the Hour/Min/Sec `PickerColumn`s **once**,
- exposes `setTime(date | null)` to seed/refresh the highlighted cells in place,
- fires a single `onChange(hours, minutes, seconds)` callback on a cell click.

This is the one new abstraction. It clearly pays for itself: it removes the
entire `DateTimePickerSelect` ComboBox machinery (and its `updateHeight`
size-pinning workaround, [DateTimePickerDropdown.ts:119](../src/typescript/lib/component/input/DateTimePickerDropdown.ts#L119)),
unifies the two pickers' look, and is the natural home for the spasm fix. Both
`TimePickerDropdown` and `DateTimePickerDropdown` become thin owners of one
`TimeColumns` instance.

Rejected alternative — *make `DateTimePickerDropdown` instantiate a
`TimePickerDropdown` and embed its element*: a `TimePickerDropdown` is an
`AnimatedDropdown` (a floating, self-anchoring, z-indexed panel with its own
pointerdown focus guard and fade lifecycle). Embedding one panel inside another
panel's layout fights every one of those responsibilities. The reusable unit is
the **grid**, not the dropdown — so extract the grid.

### Spasm fix: build columns once, update selection in place

Root cause (verified by code read, see below): `onHourSelected` etc. call
`this.buildGrid()`, which calls `this._grid.removeAllComponents()` and recreates
every `PickerColumn`/`PickerCell`. Re-created `PickerCellList` panels start at
`scrollTop = 0`, so the previously-centred column snaps to the top for one frame
— the visible spasm. `buildGrid` also never re-centres the new selection, so even
without the teardown the view would be wrong.

The fix lives in `TimeColumns`: build the three columns once in the constructor,
and on a selection change call a new `PickerColumn.setSelectedValue(value)` that
clears the old highlight and sets the new one **on the existing cells** (no
DOM teardown), without touching `scrollTop`. The clicked cell stays where the
user clicked it; no scroll jump occurs.

### `PickerColumn.setSelectedValue` for in-place re-highlight

`PickerColumn` already owns its cells and a `scrollSelectedIntoView`
([PickerColumn.ts:319](../src/typescript/lib/component/input/PickerColumn.ts#L319)).
Add a sibling that walks the existing `PickerCell`s, toggling
`setSelected` to match a target label — the cheap in-place update the spasm fix
needs. Cells carry their value as their text (`String(v).padStart(2,"0")`), so
matching on the formatted label is exact. This mirrors the existing
`refreshYearSelection` pattern in
[AbstractCalendarDropdown.ts:989](../src/typescript/lib/component/input/AbstractCalendarDropdown.ts#L989),
which already re-highlights year cells in place rather than rebuilding.

### DateTimePicker keeps its existing time-row slot and sizing hooks

`DateTimePickerDropdown` already appends a `_timeRow` child in
`buildExtraRootChildren` and reports its height through `getExtraInnerHeight`
([DateTimePickerDropdown.ts:264](../src/typescript/lib/component/input/DateTimePickerDropdown.ts#L264)).
The `TimeColumns` unit slots into that same `_timeRow`. Because the columns are
scrollable and need real height (unlike the 28-px combobox row), the DateTimePicker
gains vertical space for the columns: `getExtraInnerHeight` returns a column block
height instead of `TIME_ROW_HEIGHT`, and the panel width constants
(`PANEL_WIDTH` / `PANEL_WIDTH_SECONDS`) are revisited so the columns fit. The
day grid above is unchanged.

### No public API or signature changes

`TimeColumns` is internal (not added to the barrel). The two dropdown classes
keep their exported signatures. `DateTimeField`/`TimeField` value get/set,
`formatValue`/`parseRaw`, and the `onDropdownSelected` → `setValue` + `input`
event path are not edited. This keeps the change a pure internal refactor + bug
fix from the consumer's perspective.

---

## Public API (TypeScript Signatures)

No exported signatures change. New **internal** symbols only:

```ts
// New file: src/typescript/lib/component/input/TimeColumns.ts
// Internal — NOT exported from the input barrel.

interface TimeColumnsOptions {
    showSeconds?: boolean;
}

class TimeColumns extends Component {
    constructor(
        onChange: (hours: number, minutes: number, seconds: number) => void,
        options?: TimeColumnsOptions,
    );

    /** Seed/refresh the highlighted cells from a Date (or clear when null). In place — no rebuild. */
    setTime(value: Date | null): this;
}
```

```ts
// PickerColumn.ts — new in-place re-highlight method alongside scrollSelectedIntoView.
class PickerColumn {
    /** Toggle selection so the cell whose label === value is highlighted; clears the rest. No DOM rebuild, no scroll change. */
    setSelectedValue(value: string | null): this;
}
```

No new DOM properties / typed setters are introduced (the change is composition +
selection state, not a new styled attribute), so the `XOptions` + cached-field +
typed-setter rule does not apply here.

---

## Internal Structure

`TimeColumns` (extends `Component`, `HBox` layout, stretching, weighted columns —
mirrors the current `TimePickerDropdown._grid` at
[TimePickerDropdown.ts:78](../src/typescript/lib/component/input/TimePickerDropdown.ts#L78)):

```
TimeColumns (Component, HBox spacing 4 stretching)
├── PickerColumn "Hour"  (24 cells, step 1)
├── PickerColumn "Min"   (12 cells, step 5)
└── PickerColumn "Sec"   (12 cells, step 5)   // only when showSeconds
```

- Constructor builds all columns once and wires each `PickerCell`'s click to a
  private `onUnitSelected(unit, value)` that updates the unit's backing field,
  defaults the other units to `0` on first interaction (preserving the current
  [TimePickerDropdown.ts:192-202](../src/typescript/lib/component/input/TimePickerDropdown.ts#L192)
  "complete time" semantics), calls the relevant column's `setSelectedValue` in
  place, and fires `onChange`.
- `setTime(date)` writes the three backing fields and calls each column's
  `setSelectedValue` — used by the owners on open and on external value change.

`TimePickerDropdown` after refactor: constructs one `TimeColumns`, adds it to the
panel, and in `showAt` calls `timeColumns.setTime(selected)` instead of
`buildGrid()`. The `_hours/_minutes/_seconds/_showSeconds/_grid` fields and the
`buildGrid/buildColumn/onHourSelected/onMinuteSelected/onSecondSelected` methods
are deleted.

`DateTimePickerDropdown` after refactor: `buildExtraRootChildren` creates the
`TimeColumns` (forwarding `showSeconds`) with an `onChange` that folds H/M/S into
`_value` (seeding via `todayMidnight()` when null, as today at
[DateTimePickerDropdown.ts:277-303](../src/typescript/lib/component/input/DateTimePickerDropdown.ts#L277))
and calls `notifyValueChanged()`. `rebuildExtraRowsAfterValueChange` calls
`timeColumns.setTime(this._value)` **in place** instead of
`removeAllComponents()` + `buildTimeRow()`. The `DateTimePickerSelect`,
`DateTimePickerTimeLabel`, `DateTimePickerTimeSeparator` classes and the
`SELECT_WIDTH`/`SEPARATOR_WIDTH`/`TIME_LABEL_WIDTH` constants are deleted.

---

## Selection → Re-layout Root Cause (the spasm)

Confirmed from a read of the click→update→render chain; no runtime trace needed,
though `mcp__chrome-devtools__*` against the app on http://localhost:8015 can
confirm post-fix.

**TimePicker path** (the primary spasm):
`PickerCell.handleClick` → cell's `onClick`
([PickerColumn.ts:149](../src/typescript/lib/component/input/PickerColumn.ts#L149))
→ `TimePickerDropdown.onHourSelected`
([TimePickerDropdown.ts:192](../src/typescript/lib/component/input/TimePickerDropdown.ts#L192))
→ fires `_onSelect` **then** `this.buildGrid()`
([TimePickerDropdown.ts:201](../src/typescript/lib/component/input/TimePickerDropdown.ts#L201))
→ `this._grid.removeAllComponents()` and rebuild of **every** column/cell
([TimePickerDropdown.ts:139](../src/typescript/lib/component/input/TimePickerDropdown.ts#L139)).
Each rebuilt `PickerCellList` is a fresh `Panel` whose native `scrollTop` starts
at 0, so a column the user had scrolled (e.g. minute `45`) snaps to the top for a
frame. `buildGrid` never re-centres, so the snap is the entire visible behaviour.
That teardown-and-recreate of ~36–48 DOM cells on every click is the spasm.

**DateTimePicker path** (combobox today, will inherit the fix): the combobox
`onChange` callbacks
([DateTimePickerDropdown.ts:277](../src/typescript/lib/component/input/DateTimePickerDropdown.ts#L277))
mutate `_value` and call `notifyValueChanged()` but do **not** rebuild the time
row, so the comboboxes don't visibly spasm today. They will be replaced by
`TimeColumns`; routing their `onChange` through the in-place `setSelectedValue`
keeps them spasm-free after the swap.

Fix: never rebuild on selection. Build once; `setSelectedValue` flips the
highlight on the existing cells without touching `scrollTop` or the DOM child
list.

---

## Ordered Implementation Steps

1. **`PickerColumn.ts` — add `setSelectedValue(value: string | null)`.** Iterate
   `_cellList.getComponents()`, `setSelected(cell.getText().valueOf() === value)`
   on each `PickerCell`. Do **not** call `scrollSelectedIntoView`. → verify: typecheck.

2. **Create `src/typescript/lib/component/input/TimeColumns.ts`.** New internal
   `Component` per _Internal Structure_. Build columns once; `onUnitSelected`
   updates one backing field, defaults the others to 0 on first pick, calls that
   column's `setSelectedValue`, fires `onChange`; `setTime` re-highlights all
   columns in place. Move the `Hour/Min/Sec` labels, counts (24/60), and steps
   (1/5/5) from `TimePickerDropdown.buildGrid`. Do **not** add to the barrel.
   → verify: typecheck; `grep -n 'export' src/typescript/lib/component/input/index.ts` shows no `TimeColumns`.

3. **`TimePickerDropdown.ts` — adopt `TimeColumns`.** Replace `_grid` +
   `buildGrid/buildColumn/onHourSelected/onMinuteSelected/onSecondSelected` and
   the `_hours/_minutes/_seconds` fields with a single `TimeColumns` member.
   `showAt` calls `setTime(selected)` (drop `pauseLayout/buildGrid/resumeLayout`
   around the build — the columns already exist; keep the `setWidth/setHeight/
   doLayout/placeAnchored/showAnimated` tail). Keep the constructor's panel
   chrome, the subtree pointerdown guard, and the `_onSelect`/`showSeconds`
   forwarding unchanged. → verify: typecheck; `grep -n 'buildGrid' src/typescript/lib/component/input/TimePickerDropdown.ts` — expect zero.

4. **`DateTimePickerDropdown.ts` — replace the combobox row with `TimeColumns`.**
   Delete `DateTimePickerSelect`, `DateTimePickerTimeLabel`,
   `DateTimePickerTimeSeparator` and the `SELECT_WIDTH`/`SEPARATOR_WIDTH`/
   `TIME_LABEL_WIDTH`/`TIME_ROW_HEIGHT` constants no longer referenced.
   `buildExtraRootChildren` builds the `TimeColumns` into `_timeRow` (or replaces
   `_timeRow` with the `TimeColumns` directly). `rebuildExtraRowsAfterValueChange`
   → `timeColumns.setTime(this._value)`. `getExtraInnerHeight` returns the column
   block height (`ROOT_GAP + columnsHeight`). Revisit `PANEL_WIDTH` /
   `PANEL_WIDTH_SECONDS` so the columns fit. Remove the now-unused `ComboBox`/
   `Text`/`HBox` imports if they become orphans. → verify: typecheck;
   `grep -n 'ComboBox\|DateTimePickerSelect' src/typescript/lib/component/input/DateTimePickerDropdown.ts` — expect zero.

5. **Spasm regression check.** `grep -rn 'removeAllComponents' src/typescript/lib/component/input/TimePickerDropdown.ts src/typescript/lib/component/input/TimeColumns.ts` — expect zero matches inside any selection handler (only construction-time builds, if any, are acceptable). Manual: open both pickers on http://localhost:8015, click several hour/minute values, confirm no scroll jump.

6. **Full typecheck + build.** `npm run build` (or the project typecheck) clean.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/component/input/TimeColumns.ts` |
| Modify | `src/typescript/lib/component/input/PickerColumn.ts` (add `setSelectedValue`) |
| Modify | `src/typescript/lib/component/input/TimePickerDropdown.ts` (adopt `TimeColumns`, drop `buildGrid`) |
| Modify | `src/typescript/lib/component/input/DateTimePickerDropdown.ts` (replace combobox row with `TimeColumns`, resize panel) |

`DateTimeField.ts` and `TimeField.ts` are intentionally **not** modified.

---

## Verification

- **Typecheck / build:** project typecheck and `npm run build` clean.
- **Grep invariants:**
  - `grep -n 'buildGrid' src/typescript/lib/component/input/TimePickerDropdown.ts` → 0.
  - `grep -n 'ComboBox' src/typescript/lib/component/input/DateTimePickerDropdown.ts` → 0.
  - `grep -n 'TimeColumns' src/typescript/lib/component/input/index.ts` → 0 (stays internal).
- **Manual smoke (app on http://localhost:8015):** open the DateTimeField picker —
  time portion now shows scrollable Hour/Min(/Sec) columns matching the
  TimeField picker. Pick hour, minute, second: input updates, **no spasm/scroll
  jump**. Pick a day, then a time, then change the day again: time portion is
  preserved (DateTimePicker contract at
  [DateTimePickerDropdown.ts:224](../src/typescript/lib/component/input/DateTimePickerDropdown.ts#L224)).
  Toggle a `DateTimeField`/`TimeField` with `showSeconds: true` — the Sec column
  appears and the panel widens correctly.
- **Theme toggle:** light/dark — picker cell hover/highlight tokens
  (`--ts-ui-autocomplete-item-*`) render in both, since `TimeColumns` reuses the
  existing `PickerColumn`/`PickerCell` rules.
- **Value contract:** type/blur a date-time string and confirm `formatValue`/
  `parseRaw` round-trip is unchanged (no edits to those methods).

---

## Documentation Impact

Both `TimePickerDropdown` and `DateTimePickerDropdown` are exported from the input
barrel ([index.ts:60-61](../src/typescript/lib/component/input/index.ts#L60)), so
they are public surface — but this change adds **no** new exported symbol, renames
nothing, and changes no exported signature (`TimeColumns` and
`PickerColumn.setSelectedValue` are internal; `PickerColumn` itself is not in the
barrel). Per `_shared/docs-conventions.md`, doc changes are only required when the
public surface moves; it does not here.

The only consumer-visible difference is that the DateTimePicker's time portion now
renders as scrollable columns instead of comboboxes. The curated pages
(`docs/components/DateTimeField.md`, `docs/components/TimeField.md`) describe it
generically as an "hour/minute selector", which remains accurate. Optionally
refresh any screenshot/wording on `docs/components/DateTimeField.md` if it depicts
the old combobox row; no auto-generated API page, catalog, or sidebar
(`docs/.vitepress/config.mts`) entries change.

---

## Potential Challenges

- **DateTimePicker panel height/width growth.** Scrollable columns need real
  height where the combobox row was 28 px; recompute `getExtraInnerHeight` and the
  `PANEL_WIDTH*` constants so the columns fit without clipping under the
  dropdown's `overflow: hidden` (the existing 2-px-clip note at
  [DateTimePickerDropdown.ts:264](../src/typescript/lib/component/input/DateTimePickerDropdown.ts#L264)
  is the cautionary precedent). Mitigation: reuse the TimePicker's known-good
  `PANEL_HEIGHT`/column metrics as the column block size.
- **First-paint scroll centring.** `scrollSelectedIntoView` needs committed layout
  (offsetTop) — call it after `doLayout`, exactly as the year scroller does
  ([AbstractCalendarDropdown.ts:932](../src/typescript/lib/component/input/AbstractCalendarDropdown.ts#L932)).
  On open, centring is fine; on a *selection* click, deliberately skip re-centring
  so the clicked cell stays put (this is the spasm fix).
- **"Complete time" defaulting.** Preserve the current behaviour where the first
  unit pick defaults the others to 0
  ([TimePickerDropdown.ts:192-202](../src/typescript/lib/component/input/TimePickerDropdown.ts#L192))
  so consumers always receive a full H:M:S.
- **Focus guard.** `PickerCell` already preventDefaults pointerdown
  ([PickerColumn.ts:141](../src/typescript/lib/component/input/PickerColumn.ts#L141));
  the existing combobox-specific dismiss handling that kept the picker open for
  ComboBox dropdowns ([DateTimePickerDropdown.ts:58-68](../src/typescript/lib/component/input/DateTimePickerDropdown.ts#L58))
  is no longer needed once the comboboxes are gone — confirm removing it doesn't
  drop a still-needed guard.

---

## Critical Files

- [`src/typescript/lib/component/input/PickerColumn.ts`](../src/typescript/lib/component/input/PickerColumn.ts) — `PickerCell`/`PickerColumn`, `scrollSelectedIntoView`; home of the new `setSelectedValue`.
- [`src/typescript/lib/component/input/TimePickerDropdown.ts`](../src/typescript/lib/component/input/TimePickerDropdown.ts) — current grid build + the spasm-causing `buildGrid` rebuild.
- [`src/typescript/lib/component/input/DateTimePickerDropdown.ts`](../src/typescript/lib/component/input/DateTimePickerDropdown.ts) — current combobox time row + sizing hooks.
- [`src/typescript/lib/component/input/AbstractCalendarDropdown.ts`](../src/typescript/lib/component/input/AbstractCalendarDropdown.ts) — `_timeRow` slot hooks (`buildExtraRootChildren`, `rebuildExtraRowsAfterValueChange`, `getExtraInnerHeight`) and the in-place `refreshYearSelection` precedent.
- [`src/typescript/lib/component/input/DateTimeField.ts`](../src/typescript/lib/component/input/DateTimeField.ts) / [`TimeField.ts`](../src/typescript/lib/component/input/TimeField.ts) — value/event contracts to preserve (read, do not edit).

---

## Non-Goals

- 12-hour formatting or locale-aware time grouping — explicitly out of scope (per the existing `TimePickerDropdown` doc comment at [TimePickerDropdown.ts:32](../src/typescript/lib/component/input/TimePickerDropdown.ts#L32)).
- Per-minute (step 1) granularity — keep the existing 5-minute/5-second snaps.
- Any change to `DateTimeField`/`TimeField` parsing, formatting, or value/event API.
- Embedding a whole `TimePickerDropdown` inside the DateTimePicker — rejected above; only the grid is reused.
