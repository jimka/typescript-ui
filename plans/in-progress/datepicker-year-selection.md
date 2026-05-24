# DatePicker Year Selection — Implementation Plan

## Overview

`DateField` and `DateTimeField` open dropdown panels that currently render a **single fixed month** with no navigation at all — the comment at [DatePickerDropdown.ts:160](../src/typescript/lib/component/input/DatePickerDropdown.ts#L160) reads "single month, no navigation — per the `dropdown-fade-animation` plan's non-goals". A user staring at "May 2026" today has no way to reach July 2027, never mind 1985-06-12. This plan adds **year and month navigation** to both dropdowns ([DatePickerDropdown.ts](../src/typescript/lib/component/input/DatePickerDropdown.ts), [DateTimePickerDropdown.ts](../src/typescript/lib/component/input/DateTimePickerDropdown.ts)) with year selection as the load-bearing piece, and threads optional `minDate` / `maxDate` constraints down from `DateField` / `DateTimeField` so the picker respects allowed bounds.

The core UX choice is **"click the month/year header to expand an in-place year scroller"** (Tier-1 macOS / Material pattern). The label `May 2026` becomes the affordance: clicking it swaps the day grid for a scrollable column of years anchored on the current value; clicking a year collapses back to the day grid for that year, same month. Month-step `<` / `>` arrows on either side of the label cover the small-delta case without needing the scroller. This reuses the existing [`TimePickerCellList`](../src/typescript/lib/component/input/TimePickerDropdown.ts#L65) + [`TimePickerColumn`](../src/typescript/lib/component/input/TimePickerDropdown.ts#L146) scroll-column pattern verbatim, so there is one column-of-cells idiom shared by both pickers.

The cell-edit table editors ([Date.ts:23](../src/typescript/lib/component/table/cell/editor/Date.ts#L23), [DateTime.ts:22](../src/typescript/lib/component/table/cell/editor/DateTime.ts#L22)) pick up the navigation automatically — they instantiate the same dropdowns.

---

## Architecture Decisions

### Header-as-toggle for year selection, arrows for month

The header label (currently a passive `DatePickerMonthLabel` / `DateTimePickerMonthLabel`, [DatePickerDropdown.ts:41](../src/typescript/lib/component/input/DatePickerDropdown.ts#L41), [DateTimePickerDropdown.ts:55](../src/typescript/lib/component/input/DateTimePickerDropdown.ts#L55)) becomes a click target: pointerdown toggles a **year scroller view** that replaces the day grid in-place (same outer dropdown size, no panel reflow). Month-step `<` / `>` chevrons sit on either side of the header for the common "next month / previous month" case.

**Rejected — `<select>`-like row above the grid:** would push the day grid down 24 px on every panel and consume vertical real estate even when the user doesn't touch it. The header-as-toggle pattern is invisible until invoked.

**Rejected — paired `<` / `>` year arrows next to the label:** a "scroll 80 years one at a time" UX is precisely what we're fixing. Month arrows are kept because moving ±1 month is high-frequency; moving ±1 year via arrows is rarely what the user wants.

### Reuse `TimePickerCellList` / `TimePickerColumn` for the year scroller

The hour/minute columns in [TimePickerDropdown.ts:65-182](../src/typescript/lib/component/input/TimePickerDropdown.ts#L65-L182) already solve "scrollable vertical list of clickable equal-height cells with highlight + hover, sized by the parent stretching VBox". The year scroller is the same shape with `step = 1` and the cell label being the four-digit year. Extracting **`PickerCellList`** and **`PickerColumn`** to a shared module makes both pickers depend on one implementation instead of two parallel copies. The existing `TimePickerCell` styling rule moves to a shared name (`PickerCell` / `.PickerCell:hover`) so the year scroller's cell hover and selection highlight match the time scroller's exactly.

### `_monthAnchor` is the single source of truth for "currently displayed month"

`DatePickerDropdown` already has `_monthAnchor: Date` ([DatePickerDropdown.ts:172](../src/typescript/lib/component/input/DatePickerDropdown.ts#L172)) but it is only ever assigned from `showAt`. Year and month arrows both mutate `_monthAnchor` and call `buildGrid` — there is no parallel "displayed year" or "displayed month" field. `DateTimePickerDropdown` currently reads month/year off `this._value ?? new Date()` ([DateTimePickerDropdown.ts:409-411](../src/typescript/lib/component/input/DateTimePickerDropdown.ts#L409-L411)), which conflates "what's displayed" with "what's selected"; this plan adds a `_monthAnchor` field to it too so the user can navigate without first having picked a date.

### `minDate` / `maxDate` on the field options, not the dropdown options

Constraint bounds belong at the consumer-facing layer ([DateField.ts:20](../src/typescript/lib/component/input/DateField.ts#L20), [DateTimeField.ts:20](../src/typescript/lib/component/input/DateTimeField.ts#L20)), forwarded through `createDropdown` so the dropdown's year list and disabled-day rendering know the bounds. Today neither field exposes either property — `grep -rn 'minDate\|maxDate' src/typescript/lib` returns zero hits — so this is greenfield.

The dropdown clamps the year scroller to `[minDate.getFullYear(), maxDate.getFullYear()]`. Day cells outside the bounds render with `pointer-events: none`, dim colour, and skipped click handlers (no `setEnabled` plumbing on `Text` — a CSS rule on a `.PickerCell.disabled` class). Month arrows refuse to advance into a fully out-of-range month.

### ARIA — combobox/listbox pattern, not a parallel grid

The dropdown root is already `role="group"` ([DatePickerDropdown.ts:199](../src/typescript/lib/component/input/DatePickerDropdown.ts#L199), [DateTimePickerDropdown.ts:296](../src/typescript/lib/component/input/DateTimePickerDropdown.ts#L296)). The clickable header becomes `role="button"` with `aria-expanded` reflecting the year-scroller state. The year scroller is `role="listbox"` with each year cell `role="option"` and `aria-selected` mirroring the selection highlight. The selected year cell carries `aria-current="true"` and the listbox sets `aria-activedescendant` to its id so screen readers announce the year change without a `polite` region. This is the same surface the framework's `ComboBox` uses (verified via `getAria().setRole(...)` calls in the codebase) so we are not inventing a pattern.

### Year scroller centres the current year on open

Computed from `_monthAnchor.getFullYear()`, the `TimePickerCellList.Panel`'s `setScrollTop` lands the active cell mid-viewport. The scrollable Panel already supports this (`autoScroll: 'y'` and `Panel.setScrollTop(px)`), so this is a one-liner inside `buildYearScroller`.

### Keep `computePanelHeight` stable

The year scroller and the day grid share the same outer panel rectangle. The scroller fits exactly into the day-grid region (`6 * CELL_HEIGHT + 5 * 2 = 154 px`); the header row hides when the scroller is open. Net panel height is unchanged — `computePanelHeight` at [DatePickerDropdown.ts:268](../src/typescript/lib/component/input/DatePickerDropdown.ts#L268) and [DateTimePickerDropdown.ts:380](../src/typescript/lib/component/input/DateTimePickerDropdown.ts#L380) do not need to change.

---

## Public API (TypeScript Signatures)

### `DateFieldOptions`

```typescript
export interface DateFieldOptions extends AbstractPickerFieldOptions {
    value?:    Date | null;
    /** Earliest date the picker will allow selection of. Optional. */
    minDate?:  Date | null;
    /** Latest date the picker will allow selection of. Optional. */
    maxDate?:  Date | null;
}
```

Cached on `_options` in `applyOptions` exactly like `value` already is ([DateField.ts:88-98](../src/typescript/lib/component/input/DateField.ts#L88-L98)). Read in `createDropdown` and forwarded into `DatePickerDropdownOptions`.

### `DateTimeFieldOptions`

```typescript
export interface DateTimeFieldOptions extends AbstractPickerFieldOptions {
    value?:        Date | null;
    showSeconds?:  boolean;
    minDate?:      Date | null;
    maxDate?:      Date | null;
}
```

### `DatePickerDropdownOptions`

```typescript
export interface DatePickerDropdownOptions extends AnimatedDropdownOptions {
    minDate?: Date | null;
    maxDate?: Date | null;
}
```

### `DateTimePickerDropdownOptions`

```typescript
export interface DateTimePickerDropdownOptions extends AnimatedDropdownOptions {
    showSeconds?: boolean;
    minDate?:     Date | null;
    maxDate?:     Date | null;
}
```

### New shared module — `PickerColumn.ts`

```typescript
// src/typescript/lib/component/input/PickerColumn.ts
export class PickerCellList extends Panel { /* moved from TimePickerDropdown.ts */ }
export class PickerCell extends Text {
    constructor(label: string, onClick: () => void);
    setSelected(selected: boolean): this;
    setDisabled(disabled: boolean): this;  // new — gates click handler + applies .disabled class
}
export class PickerColumn extends Component {
    constructor(headerText: string | null);  // null hides the header row
    addCell(cell: PickerCell): this;
    clearCells(): this;
    scrollSelectedIntoView(): this;          // centres the selected cell in the panel
}
```

`TimePickerDropdown` is refactored to use these instead of its own private versions. No external API change for `TimePickerDropdown`.

### `_DatePickerDropdown` / `_DateTimePickerDropdown` — new private methods

```typescript
// In both dropdowns
private _monthAnchor:    Date;
private _yearScrollOpen: boolean = false;
private _yearColumn:     PickerColumn | null = null;

private buildHeader(): void;          // builds the new "[<] May 2026 [>]" row
private toggleYearScroller(): void;   // swaps _dayGrid <-> _yearColumn
private buildYearScroller(): void;    // populates _yearColumn for the legal year range
private prevMonth(): void;            // _monthAnchor -= 1 month, rebuild
private nextMonth(): void;            // _monthAnchor += 1 month, rebuild
private onYearSelected(year: number): void;  // mutate _monthAnchor, close scroller
private isDateInRange(date: Date): boolean;
```

`buildGrid` (already present) gains a disabled-cell branch keyed off `isDateInRange`.

---

## Internal Structure

### Header row layout

The current single-child header (a `Text` spanning the panel) becomes a 3-cell `HBox`:

```
┌─────┬───────────────────────┬─────┐
│  <  │   May 2026  (button)  │  >  │
└─────┴───────────────────────┴─────┘
   24            192             24    (DatePicker; widths scale for DateTimePicker)
```

The middle cell carries `cursor: pointer`, a `Text` child, and an `aria-expanded` attribute that flips when the year scroller toggles. The chevrons are `Glyph("chevron-left")` / `Glyph("chevron-right")` wrapped in clickable `Component`s with `cursor: pointer` and a focus-suppression `pointerdown` handler matching the existing day-cell guard ([DatePickerDropdown.ts:104](../src/typescript/lib/component/input/DatePickerDropdown.ts#L104)).

### Year scroller swap

When `toggleYearScroller` opens the scroller:

```ts
this._root.removeComponent(this._headerRow);
this._root.removeComponent(this._dayGrid);
this._root.addComponent(this._yearColumn!);
```

Closing reverses. Because the outer `VBox` is `stretching: true` and the swapped child has matching preferred height (`HEADER_HEIGHT + rootGap + dayGridH = 178 px`), the panel does not resize. The month-label row remains visible above the scroller so the user can still see what "current month" they're picking a year for.

### Year range

```ts
private buildYearScroller(): void {
    const minYear = this._options.minDate?.getFullYear() ?? new Date().getFullYear() - 120;
    const maxYear = this._options.maxDate?.getFullYear() ?? new Date().getFullYear() + 50;
    const active  = this._monthAnchor.getFullYear();
    // populate _yearColumn cells; mark `active` as selected
    // call _yearColumn.scrollSelectedIntoView() after addComponent flushes
}
```

The 120-down/50-up defaults keep the list bounded when no `minDate`/`maxDate` is set; 170 cells × 22 px is well below the comfortable scroll-region size.

---

## Keyboard Handling

The dropdown root listens for `keydown` while it's open (currently it doesn't — keyboard reaches it only via the host input's `onKeyDown` at [AbstractPickerField.ts:97](../src/typescript/lib/component/input/AbstractPickerField.ts#L97)). Approach: the existing host-input keydown handler forwards to a new `_dropdown.handleKey(e)` when the dropdown is open.

| Key | Day-grid view | Year-scroller view |
|---|---|---|
| `ArrowLeft` / `ArrowRight` | Move highlighted day ±1 | Move highlighted year ±1 |
| `ArrowUp` / `ArrowDown` | Move highlighted day ±7 | Move highlighted year ±1 (vertical list) |
| `PageUp` / `PageDown` | Move highlighted month ±1 | Move highlighted year ±10 |
| `Home` / `End` | Jump to first / last day of month | Jump to min / max year |
| `Enter` / `Space` | Commit highlighted day | Commit highlighted year |
| `Escape` | Close dropdown | Close year scroller (return to grid) |
| `0`–`9` (year scroller only) | n/a | Buffer the digit. After 4 digits or 800 ms idle, jump to the typed year if in range; reset on `Escape` or commit. |

The four-digit jump-to is the year scroller's equivalent of ComboBox type-ahead. The buffer is `private _yearTypeBuffer: string` with a `_yearTypeTimer` reset on each keystroke.

---

## Theme Tokens

The header chevrons, header-as-button hover, and disabled-day rendering need three new tokens. The year-scroller cell hover and selection reuse the existing `--ts-ui-autocomplete-item-hover-bg` and `--ts-ui-autocomplete-item-highlight-bg` (which the day grid and time cells already use, [DatePickerDropdown.ts:35-36](../src/typescript/lib/component/input/DatePickerDropdown.ts#L35-L36)).

### New entries on `Theme.autoComplete`

```typescript
autoComplete: {
    // … existing …
    item: {
        hoverBackground:     string;  // existing
        highlightBackground: string;  // existing
        highlightColor:      string;  // existing
        disabledColor:       string;  // existing
        disabledBackground:  string;  // NEW — out-of-range day cells
    };
    navButton: {                       // NEW — header chevron + header-as-button hover
        hoverBackground: string;
        foreground:      string;
    };
}
```

### CSS variables (added to `themeToVars` at [Theme.ts:970](../src/typescript/lib/core/Theme.ts#L970))

| CSS Custom Property | Light Default | Dark Default | Purpose |
|---|---|---|---|
| `--ts-ui-autocomplete-item-disabled-bg` | `transparent` | `transparent` | Out-of-range day cell background |
| `--ts-ui-picker-nav-hover-bg` | `rgba(30, 100, 200, 0.08)` | `rgba(120, 170, 255, 0.12)` | Header / chevron hover background |
| `--ts-ui-picker-nav-fg` | `var(--ts-ui-text-color)` | `var(--ts-ui-text-color)` | Chevron glyph colour |

All three need entries in `Theme`, `DefaultTheme` ([Theme.ts:377](../src/typescript/lib/core/Theme.ts#L377)), `DarkTheme` ([Theme.ts:570](../src/typescript/lib/core/Theme.ts#L570) area), and `themeToVars` ([Theme.ts:970](../src/typescript/lib/core/Theme.ts#L970)).

---

## Ordered Implementation Steps

### Step 1 — Extract `PickerCellList` / `PickerColumn` / `PickerCell`

Create `src/typescript/lib/component/input/PickerColumn.ts` carrying the three classes currently private in [TimePickerDropdown.ts:54-182](../src/typescript/lib/component/input/TimePickerDropdown.ts#L54-L182). Rename the StyleRule class names from `TimePickerCell` → `PickerCell` (and the `:hover` selector accordingly). Add `setDisabled(boolean)` plus a `.PickerCell.disabled` rule. Add `scrollSelectedIntoView()` (computes the cell's offsetTop, calls `this._cellList.setScrollTop(...)`).

Update `TimePickerDropdown.ts` to import from the new module and delete the now-duplicate classes. Verify: `npm run build` clean; the time picker visually unchanged (cell-hover + highlight + sizing).

### Step 2 — Add new theme tokens

Edit [`src/typescript/lib/core/Theme.ts`](../src/typescript/lib/core/Theme.ts):

- Extend `Theme.autoComplete.item` with `disabledBackground`.
- Add `Theme.autoComplete.navButton` block.
- Fill `DefaultTheme` and `DarkTheme` accordingly.
- Add the three new entries to `themeToVars` ([Theme.ts:970](../src/typescript/lib/core/Theme.ts#L970)).

Checkpoint: `grep -rn '--ts-ui-picker-nav' src/typescript/lib` should match the three sites (Theme.ts + the two dropdowns once Step 4 lands).

### Step 3 — `DateField` / `DateTimeField` accept `minDate` / `maxDate`

Edit [`DateField.ts`](../src/typescript/lib/component/input/DateField.ts) and [`DateTimeField.ts`](../src/typescript/lib/component/input/DateTimeField.ts):

- Add the two optional fields to the options interfaces.
- In `applyOptions`, cache `opts.minDate` / `opts.maxDate` on `_options` (mirror the existing `value` plumbing at [DateField.ts:93-95](../src/typescript/lib/component/input/DateField.ts#L93-L95)).
- In `createDropdown`, forward both values into the dropdown's options bag.

### Step 4 — `DatePickerDropdown` navigation surface

Edit [`DatePickerDropdown.ts`](../src/typescript/lib/component/input/DatePickerDropdown.ts):

- Replace the single-`Text` header with the 3-cell `HBox` described in **Internal Structure**.
- Wire chevron click → `prevMonth` / `nextMonth`.
- Wire month-label click → `toggleYearScroller`.
- Add `_yearColumn: PickerColumn | null`, `_yearScrollOpen: boolean`, `_monthAnchor: Date` already exists.
- Implement `toggleYearScroller`, `buildYearScroller`, `prevMonth`, `nextMonth`, `onYearSelected`.
- Teach `buildGrid` to skip clicks on out-of-range days (apply `.disabled` class via `setDisabled(true)` on the `PickerCell`-equivalent day cell — keep `DatePickerDay` as a thin subclass that reuses the new `PickerCell` disabled rule).
- Implement `handleKey(e: KeyboardEvent): boolean` per the keyboard table; called from the host input's `onKeyDown` (forward when dropdown is open and the event hasn't been handled by the host's own ArrowDown/Escape contract at [AbstractPickerField.ts](../src/typescript/lib/component/input/AbstractPickerField.ts)).
- ARIA: header `getAria().setRole("button")`, header `getAria().setAriaExpanded(false)`; the new `PickerColumn` exposes `getAria().setRole("listbox")` and each cell `setRole("option")` + `setAriaSelected(true/false)`.

### Step 5 — Mirror Step 4 in `DateTimePickerDropdown`

Edit [`DateTimePickerDropdown.ts`](../src/typescript/lib/component/input/DateTimePickerDropdown.ts):

- Same header replacement and year-scroller swap (the swap re-adds the `_timeRow` after the scroller closes — the swap is contained in the day-grid region only).
- Add a `_monthAnchor: Date` field; initialise it in `showAt` from `selected ?? new Date()` (currently the dropdown reads from `this._value` inline in `buildDateGrid` at [DateTimePickerDropdown.ts:409](../src/typescript/lib/component/input/DateTimePickerDropdown.ts#L409); replace with the single source of truth).
- Forward min/max bounds into the year scroller and day-grid disable logic.

### Step 6 — Plumb `handleKey` through `AbstractPickerField`

Edit [`AbstractPickerField.ts`](../src/typescript/lib/component/input/AbstractPickerField.ts): in `onKeyDown` ([AbstractPickerField.ts:97](../src/typescript/lib/component/input/AbstractPickerField.ts#L97) registration), when `this._dropdown?.isOpen()` returns true, call `this._dropdown.handleKey(e)`; if it returns `true` (handled), `preventDefault`. Add `handleKey(e: KeyboardEvent): boolean` to the relevant dropdown classes; `TimePickerDropdown` gets a no-op `return false`.

### Step 7 — Update the docs

- `docs/components/DateField.md` — replace the "single month, no navigation" note with a paragraph describing month chevrons, header-toggle year scroller, type-ahead, and the new `minDate` / `maxDate` options. Add a row to the Common-methods table for each.
- `docs/components/DateTimeField.md` — same edits.
- `docs/concepts/` — no change (the navigation is component-local, not a cross-cutting concept).
- The `index.md` catalog under `docs/components/` already lists DateField/DateTimeField — no entry to add.
- Sidebar in `docs/.vitepress/config.mts` ([line 80-82](../docs/.vitepress/config.mts#L80)) already references both pages — no add.

### Step 8 — Build gates

- `npm run build` — typecheck clean.
- `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice excepted).
- `grep -rn 'no navigation' src/typescript/lib` — expect zero matches (the comment at [DatePickerDropdown.ts:160](../src/typescript/lib/component/input/DatePickerDropdown.ts#L160) and [DateTimePickerDropdown.ts:257](../src/typescript/lib/component/input/DateTimePickerDropdown.ts#L257) is now stale and must be removed/updated).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/component/input/PickerColumn.ts` |
| Modify | `src/typescript/lib/component/input/TimePickerDropdown.ts` |
| Modify | `src/typescript/lib/component/input/DatePickerDropdown.ts` |
| Modify | `src/typescript/lib/component/input/DateTimePickerDropdown.ts` |
| Modify | `src/typescript/lib/component/input/DateField.ts` |
| Modify | `src/typescript/lib/component/input/DateTimeField.ts` |
| Modify | `src/typescript/lib/component/input/AbstractPickerField.ts` |
| Modify | `src/typescript/lib/component/input/index.ts` (export the new shared classes / types) |
| Modify | `src/typescript/lib/core/Theme.ts` |
| Modify | `docs/components/DateField.md` |
| Modify | `docs/components/DateTimeField.md` |

No deletes — the year-scroller swap is in-place, not a replacement of the existing components.

---

## Verification

1. **Build & typecheck.** `npm run build` clean; `npm run docs:build` clean (0 errors, 0 link warnings beyond the typedoc TS-version notice).
2. **TimePicker regression.** Open the time picker in `MiscPanel` ([MiscPanel.ts:38](../src/typescript/MiscPanel.ts#L38)); confirm hour/minute scrolling, hover, highlight and seconds column work exactly as before — the `PickerCellList`/`PickerColumn` extraction must be invisible.
3. **DateField year jump.** In `MiscPanel`'s animated-dropdown section ([MiscPanel.ts:774](../src/typescript/MiscPanel.ts#L774) area), open the DateField, click the "May 2026" header → year scroller appears in the grid region; scrolling lands current year mid-viewport; clicking 1985 returns to "May 1985" grid; clicking day 12 commits `1985-05-12`.
4. **DateTimeField year jump.** Same in the DateTimeField with `showSeconds: true` ([MiscPanel.ts:780](../src/typescript/MiscPanel.ts#L780)) — time row stays visible the whole time; year-scroller swap only replaces the day grid, not the time row.
5. **Month chevrons.** `<` and `>` move the month label / day grid by ±1 month without opening the year scroller; `_monthAnchor` is the only piece of state that mutates.
6. **`minDate` / `maxDate`.** Construct `DateField({ minDate: new Date(2000, 0, 1), maxDate: new Date(2030, 11, 31) })`; year scroller shows only 2000-2030; days outside range in edge months render dim and don't accept clicks; month chevron refuses to advance into 1999 / 2031.
7. **Keyboard.** Open dropdown with `ArrowDown`; in grid view, arrow keys move highlight, `PageDown` advances month, `Home` jumps to day 1; open year scroller via `Enter` on header (header has `tabIndex=0` and `role=button`); type `1` `9` `9` `5` → highlight lands on 1995; `Enter` commits.
8. **ARIA.** Inspect via DevTools: dropdown is `role="group"`; header is `role="button"`, `aria-expanded` toggles correctly; year scroller is `role="listbox"`, cells `role="option"`, `aria-selected="true"` on the current year; screen-reader smoke test (VoiceOver/NVDA) announces year change.
9. **Theme toggle.** Switch to dark theme: chevron hover bg, year-cell hover, disabled-day rendering all respect the dark palette.

---

## Documentation Impact

- **Curated pages updated:** [`docs/components/DateField.md`](../docs/components/DateField.md) and [`docs/components/DateTimeField.md`](../docs/components/DateTimeField.md). The "intentionally minimal (single month, no navigation)" note in both is removed and replaced with a short navigation section. Add `setMinDate(date)` / `setMaxDate(date)` rows to the Common-methods table if setters are exposed; otherwise document the constructor-options-only form.
- **API barrel:** [`src/typescript/lib/component/input/index.ts`](../src/typescript/lib/component/input/index.ts) gets exports for the new shared `PickerCell` / `PickerCellList` / `PickerColumn` classes (with `@category Components`) and the updated `DatePickerDropdownOptions` / `DateTimePickerDropdownOptions` / `DateFieldOptions` / `DateTimeFieldOptions` interfaces (already exported; the new fields land in the existing entries automatically via the type definition).
- **Catalog:** [`docs/components/index.md`](../docs/components/index.md) already lists both pages — no add. New shared `PickerColumn` doesn't get its own page (internal-shared building block, not consumer-facing); it's documented via JSDoc only, and TypeDoc emits it under `docs/api/component/input/classes/`.
- **Sidebar:** [`docs/.vitepress/config.mts`](../docs/.vitepress/config.mts) lines 80-82 unchanged.
- **JSDoc cross-bucket refs:** `_DateField.createDropdown` already references `[DatePickerDropdown](/api/component/input/classes/DatePickerDropdown)` — same form; the new options use plain `{@link MinDateMaxDateNote}`-free prose to avoid cross-bucket churn.

---

## Potential Challenges

- **Month chevron focus stealing.** Clicking the chevron must `preventDefault` on `pointerdown` exactly like the existing day cells ([DatePickerDropdown.ts:104-106](../src/typescript/lib/component/input/DatePickerDropdown.ts#L104-L106)) — otherwise the host input blurs mid-click and the dropdown auto-closes from `onViewportPointerDown`.
- **`scrollSelectedIntoView` after layout flush.** `Panel.setScrollTop` only works after the cells have a measured `offsetTop`; call it after `this.doLayout()` returns inside `showAt` (mirrors how `TimePickerDropdown.showAt` calls `this.doLayout()` before painting at [TimePickerDropdown.ts:287](../src/typescript/lib/component/input/TimePickerDropdown.ts#L287)).
- **`DateTimePickerDropdown._monthAnchor` migration.** The existing code reads month/year off `_value ?? new Date()` inline ([DateTimePickerDropdown.ts:409-411](../src/typescript/lib/component/input/DateTimePickerDropdown.ts#L409-L411)). The new `_monthAnchor` field must be initialised in `showAt` before the first `rebuild` — otherwise the first paint renders an empty/wrong month.
- **Type-ahead buffer leaking across openings.** `_yearTypeBuffer` and `_yearTypeTimer` must reset when the dropdown closes (in `closeDropdown` or `hideAnimated` complete), not just on `Escape` — otherwise reopening 30 s later finds a stale `19` buffer ready to merge with the next digit.
- **AnimatedDropdown lifecycle.** The year-scroller swap calls `removeComponent`/`addComponent` on `_root` while the dropdown is visible; verify it does not interfere with the fade animation (the panel itself is not re-faded — the swap is an instantaneous in-frame DOM change inside an already-visible panel).

---

## Critical Files

- [src/typescript/lib/component/input/DatePickerDropdown.ts](../src/typescript/lib/component/input/DatePickerDropdown.ts)
- [src/typescript/lib/component/input/DateTimePickerDropdown.ts](../src/typescript/lib/component/input/DateTimePickerDropdown.ts)
- [src/typescript/lib/component/input/TimePickerDropdown.ts](../src/typescript/lib/component/input/TimePickerDropdown.ts) — pattern source for `PickerCellList`/`PickerColumn`
- [src/typescript/lib/component/input/DateField.ts](../src/typescript/lib/component/input/DateField.ts)
- [src/typescript/lib/component/input/DateTimeField.ts](../src/typescript/lib/component/input/DateTimeField.ts)
- [src/typescript/lib/component/input/AbstractPickerField.ts](../src/typescript/lib/component/input/AbstractPickerField.ts) — keyboard plumbing site
- [src/typescript/lib/core/Theme.ts](../src/typescript/lib/core/Theme.ts) — token + var entries
- [src/typescript/lib/core/Panel.ts](../src/typescript/lib/core/Panel.ts) — `setScrollTop` consumed by `scrollSelectedIntoView`
- [docs/components/DateField.md](../docs/components/DateField.md), [docs/components/DateTimeField.md](../docs/components/DateTimeField.md)
- [src/typescript/MiscPanel.ts](../src/typescript/MiscPanel.ts) — the demo screen used for verification

---

## Non-Goals

- **Decade-grid third tier.** Some pickers offer year-grid → decade-grid for very deep navigation. The 4-digit type-ahead covers that user need without a second view.
- **Locale-aware year/month names.** The header continues to use `toLocaleDateString(undefined, { month: "long", year: "numeric" })` — already locale-aware. Internal text (e.g. "Today" button) is out of scope; no such button is being added.
- **Week-number column.** Out of scope; the `dropdown-fade-animation` non-goal note can keep this one.
- **`onMonthChange` event surface.** No consumer asked for one; not adding speculative API.
- **Range / multi-date selection.** Single-date semantics unchanged.
- **Native browser date-picker fallback.** Already replaced by the framework dropdown ([DateField.ts:43](../src/typescript/lib/component/input/DateField.ts#L43)); not reopening that decision.
