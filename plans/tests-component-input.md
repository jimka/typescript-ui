# Test Coverage for the Input Component Subsystem — Implementation Plan

## Overview

Add Vitest coverage for the value-bearing form controls under
[`src/typescript/lib/component/input/`](../src/typescript/lib/component/input/).
The subsystem is ~30 DOM-coupled files; this plan does **not** chase blanket
coverage. It targets the **pure value logic** — number clamp/snap, date/time
parse & format, autocomplete match modes, checked-state & group semantics,
slider value↔snap — that can be asserted by constructing a component under the
`jsdom` environment and reading its state back, with **no real layout pass and
no `installTestDOM`** in the common case.

New test files live under a new directory `tests/component/input/`, one file per
target, matching the established layout-test layout ([`tests/component/layout/`](../tests/component/layout/)).
They follow the patterns in [`tests/component/Component.test.ts`](../tests/component/Component.test.ts)
(plain construct-and-assert) and [`tests/component/layout/Tab.test.ts`](../tests/component/layout/Tab.test.ts#L16)
(the `installTestDOM` + `DOM.reset()` ritual, needed only for the handful of
mount-requiring cases).

Empirically grounded by probe runs against the real source: every targeted
control constructs cleanly under bare `jsdom` (no TestDOM) and exposes its value
math without a layout pass — **except** the two divergences pinned in
_Architecture Decisions_ below, which this plan surfaces with `it.fails`.

---

## Architecture Decisions

### Construct-and-read, not render-and-measure

Every targeted assertion reads a value off the component
(`getValue`/`isSelected`/`parseRaw`/`matches`/`getStep`/…) immediately after
construction or a setter call. No geometry is snapshotted. Probe runs confirm
`new NumberSpinner({step:2,value:7}).getValue() === 8`,
`new Checkbox({selected:true}).isSelected() === true`, and the parse helpers all
answer correctly with the component never mounted. This keeps the tests fast,
deterministic, and free of the baked-font/oracle machinery.

### `installTestDOM` only where a method fires a DOM event or reads layout

Two paths require a mounted element and therefore the
`installTestDOM(...)` + container-mount + `afterEach(() => DOM.reset())` ritual
(copy `CONFIG` and the `font-metrics.test-font.json` import verbatim from
[`Tab.test.ts`](../tests/component/layout/Tab.test.ts#L16-L25)):

- **`Slider.setValue`** calls `Event.fireEvent(this, "input")`
  ([Slider.ts:208](../src/typescript/lib/component/input/Slider.ts#L208)), which
  **throws** `Cannot fire event 'input'. Component … is not in the DOM` when the
  slider is unmounted (probe-confirmed). Slider's value-snap contract must
  therefore be exercised either (a) through the private `snap()` via a typed
  cast, or (b) with the slider mounted. This plan uses (a) for the snap math
  (no DOM) and notes (b) as the alternative; `setValue` round-trips that need
  the event are mounted.
- **`Checkbox.setSelected`** fires a synthetic `click` but **guards** it with
  `if (this.getElement())` and only `console.warn`s when unmounted
  ([Checkbox.ts:245-249](../src/typescript/lib/component/input/Checkbox.ts#L245)).
  So unmounted `setSelected` works and is testable without TestDOM; the test
  asserting the synthetic-click fan-out (`on("action")`) is the one mount-requiring
  Checkbox case.

### Assert the contract, surface divergences with `it.fails`

Per the project methodology, each assertion encodes the **documented/intended**
behaviour (JSDoc + signature), not whatever the code currently prints. Two
divergences were found during investigation; both get a real test marked
`it.fails` with a comment, so the suite is green today and flips loudly red the
moment the code is fixed:

1. **Slider ignores `step` on the initial `value` option.** The constructor calls
   `applyValue(this._options.value)` directly
   ([Slider.ts:134](../src/typescript/lib/component/input/Slider.ts#L134)),
   bypassing `snap()`. So `new Slider({min:0,max:100,step:10,value:23}).getValue()`
   is **23**, not the snapped **20** — even though `setValue(23)` *does* snap to
   20. NumberSpinner, by contrast, normalises its initial value
   ([NumberSpinner.ts:161](../src/typescript/lib/component/input/NumberSpinner.ts#L161)
   routes through `setValue`→`normalize`). The Slider contract should match;
   pin the intended `=== 20` as `it.fails`.

2. **`DateTimeField.parseRaw` is far more lenient than its siblings.** It is a
   bare `new Date(raw)`
   ([DateTimeField.ts:150-153](../src/typescript/lib/component/input/DateTimeField.ts#L150)),
   so it accepts natural-language input (`"June 15 2025"` → valid Date,
   probe-confirmed) and a date with **no time portion** (`"2025-06-15"` → valid),
   whereas `TimeField.parseRaw` strictly rejects missing minutes / out-of-range
   units and `DateField.parseRaw` appends `T00:00:00` to force ISO-shape
   validation. The intended contract for a *date-time* field is "reject input
   lacking a time", so pin `dt.parseRaw("2025-06-15") === null` as `it.fails`
   with a comment explaining the leniency, and assert the *current, documented*
   `"YYYY-MM-DD HH:MM"` happy path normally.

   Note the related **lenient month/day rollover** in `DateField`:
   `parseRaw("2025-02-30")` does **not** reject — `new Date("2025-02-30T00:00:00")`
   rolls to March 1 (probe-confirmed). This is native-`Date` behaviour, not
   obviously a bug, so assert it as a **documented-rollover** test (plain `it`,
   commented), not `it.fails`. `parseRaw("2025-13-45")` *does* return `null`
   (month 13 invalidates the whole string), so the "unparseable → null" contract
   still holds for the gross-garbage case.

### Honest scope: pure logic in, choreography out

In scope (high value-per-test): number clamp/snap/precision, date/time/datetime
parse & format round-trips, autocomplete `matches()` across all four modes +
`maxSuggestions` slicing, checkbox/radio/toggle checked-state transitions and
no-op guards, the `value`↔`selected` option aliasing, `TimeColumns` value math
(`onUnitSelected` defaulting, `cellLabel` padding), `PickerColumn.setSelectedValue`
exact-label highlight.

Out of scope (low value, high fragility — listed in _Non-Goals_): dropdown
open/close + focus choreography, `AnimatedDropdown` lifecycle, debounce timer
wall-clock behaviour, file drag-drop DOM events, pixel geometry / `doLayout`
output, hold-repeat `setTimeout` cadence.

### Import the callable export, cast for private probes

Every concrete control is `callable()`-wrapped and re-exported under its bare
name (`export { SliderCallable as Slider }`). Tests import the bare name
(`import { Slider } from '~/component/input/Slider'`) exactly like demos do.
For the parse/match/snap helpers that are `protected`/`private`, cast to a local
`any`-typed alias at the call site (`(field as any).parseRaw(raw)`) — these are
the unit under test and have no public surface; the cast is confined to the test
file and documented with a comment. `AbstractInput` / `AbstractPickerField` are
abstract and un-`callable`d, so they are exercised **through** a concrete leaf,
never instantiated directly.

---

## Targets and Per-File Behaviour Lists

Each bullet is one or more `it(...)`. Numeric/date facts below are probe-verified
against the real source.

### `NumberSpinner.test.ts` (no TestDOM)
- `getValue()` default is `0`; `getStep()` default `1`; `getMin()`/`getMax()`
  default `-Infinity`/`Infinity`.
- Initial `value` option is normalised: `{step:2,value:7}` → `8` (snap),
  `{min:0,max:10,value:100}` → `10` (clamp high), `{value:-5,min:0}` → `0`
  (clamp low). (Contrast pinned against Slider's bug in #1.)
- `setValue` clamps then snaps then re-quantises to precision
  ([normalize](../src/typescript/lib/component/input/NumberSpinner.ts#L410)).
- `derivePrecision`: explicit `precision` wins; else inferred from `step`'s
  decimal places (`step:0.25` → 2 dp; `step:1` → 0 dp). Assert via the formatted
  text round-trip on a fresh instance (`setPrecision` writes the input text).
- `getPrecision()` returns `null` when unset (derived), the number when set.
- `setMin`/`setMax` update the cached bound (read back via `getMin`/`getMax`);
  `-Infinity`/`Infinity` clears the bound.

### `SpinButton.test.ts` (no TestDOM)
- `cancelRepeat()` resets the internal delay and is idempotent (no throw when
  nothing scheduled).
- `on("tick", fn)` + the protected `emit("tick")` fan-out fires the listener;
  `off("tick", fn)` removes it. (`emit` is `protected`; cast.)
- Constructing with `"▲"` vs `"▼"` selects the up/down glyph — assert the
  preferred size is the half-height computed in `updateSize` (a pure read; no
  mount). Keep this light; hold-repeat cadence is a Non-Goal.

### `Slider.test.ts` (snap math: no TestDOM; setValue round-trip: TestDOM)
- `snap(value)` (cast): clamps to `[min,max]` then rounds to nearest `step`
  boundary anchored at `min`; `step<=0` → clamp only.
- `getLargeStep()` defaults to `10 * step`.
- `getOrientation()` default `"horizontal"`; deprecated `minValue`/`maxValue`
  options map to `min`/`max` only when the canonical key is absent
  ([Slider.ts:113-119](../src/typescript/lib/component/input/Slider.ts#L113)).
- Deprecated `setMinValue`/`getMaxValue` etc. alias the canonical setters.
- **`it.fails`**: `new Slider({min:0,max:100,step:10,value:23}).getValue() === 20`
  — pins divergence #1 (constructor skips `snap`).
- **Mounted (TestDOM)**: `setValue(23)` with `step:10` → `getValue() === 20`,
  and confirm the `change` listener fires once on a real transition, not on a
  no-op `setValue(currentValue)`.

### `Checkbox.test.ts` (state: no TestDOM; action fan-out: TestDOM)
- `value` option aliases `selected` when `selected` absent
  ([Checkbox.ts:126](../src/typescript/lib/component/input/Checkbox.ts#L126)).
- `setSelected(true)` then `setSelected(true)` — the second is a no-op (guard at
  [Checkbox.ts:230](../src/typescript/lib/component/input/Checkbox.ts#L230));
  assert the `change` listener fires exactly once.
- `setIndeterminate(true)` makes `isIndeterminate()` true; a subsequent
  `setSelected(true)` clears indeterminate and lands selected (WAI-ARIA
  force-out, [Checkbox.ts:230](../src/typescript/lib/component/input/Checkbox.ts#L230)).
- `getValue()`/`setValue` alias `isSelected`/`setSelected`.
- `getLabel()`/`setLabel(null)` round-trip.
- **Unmounted** `setSelected` emits the documented `console.warn` and skips the
  synthetic click (probe-confirmed) — assert via a spied `console.warn` that the
  state still flips. **Mounted (TestDOM)**: `on("action")` fires on a
  programmatic `setSelected`.

### `RadioButton.test.ts` (no TestDOM)
- Positional `text` arg becomes the label only when neither `label` nor `text`
  option is present ([RadioButton.ts:115-119](../src/typescript/lib/component/input/RadioButton.ts#L115)).
- `setSelected(true)` selects; `setSelected(false)` then `setSelected(false)`
  is a no-op. A user cannot *deselect* via the interaction path, but the
  programmatic `setSelected(false)` does deselect — assert both.
- `getRadioName()`/`setRadioName`/`clearRadioName` round-trip (back-compat
  shim; no `name` attribute is emitted — assert the getter only).
- `value` aliases `selected`.

### `Toggle.test.ts` (no TestDOM)
- `getValue()` default `false`; `setValue(true)` flips, repeat is a no-op
  (guard at [Toggle.ts:185](../src/typescript/lib/component/input/Toggle.ts#L185)),
  `change` fires once.
- `clearValue()` returns to `false`.
- `getLabel`/`setLabel(null)` round-trip.

### `AutoCompleteField.test.ts` (no TestDOM)
- `matches(candidate, query)` (cast) across all four `matchMode`s — the core
  target ([AutoCompleteField.ts:498](../src/typescript/lib/component/input/AutoCompleteField.ts#L498)):
  - `contains` (default): case-insensitive substring (`'apple'` matches `'PL'`).
  - `startsWith`: case-insensitive prefix — probe-confirmed `'app'` matches
    `'Apple'` but **not** `'apricot'`.
  - `containsCaseSensitive`: probe-confirmed `'App'` matches `'Apple'` not `'apple'`.
  - `startsWithCaseSensitive`: prefix + case-sensitive.
- **Prior-fix pin (case-insensitivity)**: the default mode lowercases both sides
  ([AutoCompleteField.ts:506-507](../src/typescript/lib/component/input/AutoCompleteField.ts#L506));
  assert `matches('Banana','BANANA') === true` under the default to lock the
  intended case-insensitive contract.
- `getValue`/`setValue` delegate to the inner `TextField` (construct, `setValue`,
  read back — no mount needed; probe-confirmed construction).
- `maxSuggestions` default is 10; `minChars` default 1; `debounceMs` default 200
  — assert the cached option defaults via the setters' read-back is not exposed,
  so assert through behaviour only where cheap; otherwise omit (debounce timing
  is a Non-Goal). Keep this file focused on `matches`.

### `DateField.test.ts` (no TestDOM)
- `formatValue(date)` → `"YYYY-MM-DD"` zero-padded
  ([DateField.ts:115](../src/typescript/lib/component/input/DateField.ts#L115)).
- `parseRaw` round-trips a valid `"YYYY-MM-DD"` (assert Y/M/D components; M is
  0-based so June → `getMonth() === 5`).
- `parseRaw("garbage")` and `parseRaw("2025-13-45")` → `null`.
- **Documented rollover** (plain `it`, commented): `parseRaw("2025-02-30")`
  returns a *non-null* Date rolled to March 1 — native-`Date` behaviour
  (probe-confirmed). Assert it is non-null and document why; do **not** mark
  `it.fails` (not a clear bug).
- `getValue()` is `null` on a fresh field; `setValue(date)` then `getValue()`
  round-trips the same Date.

### `TimeField.test.ts` (no TestDOM)
- `formatValue` → `"HH:MM"`, or `"HH:MM:SS"` when `showSeconds` (set via the
  option, read into the private field before initial `setValue`,
  [TimeField.ts:71](../src/typescript/lib/component/input/TimeField.ts#L71)).
- `parseRaw` strictness ([TimeField.ts:138](../src/typescript/lib/component/input/TimeField.ts#L138)):
  `"09"` → `null` (no minutes), `"09:99"` → `null` (min ≥ 60), `"25:00"` → `null`
  (hour ≥ 24), `"9:5"` → valid (non-padded accepted, `getMinutes() === 5`),
  `"09:30:61"` → `null` (sec ≥ 60). All probe-confirmed.
- Round-trip: `setValue(new Date with 09:30)` then `getValue()` returns the same
  H/M (date portion is "today" by contract).

### `DateTimeField.test.ts` (no TestDOM)
- `formatValue` → `"YYYY-MM-DD HH:MM"` / `:SS` variant.
- `parseRaw("2025-06-15 14:30")` round-trips (assert Y/M/D/H/M).
- **`it.fails`** (divergence #2): `parseRaw("2025-06-15") === null` — a
  date-time field should reject input with no time, but the bare `new Date(raw)`
  accepts it (probe-confirmed valid). Comment the leniency and the contrast with
  `TimeField`'s strict validator.
- `parseRaw("total garbage")` → `null` (the one case the lenient parser still
  rejects).

### `TimeColumns.test.ts` (internal, no TestDOM)
- `TimeColumns` is **not** barrel-exported; import from the module path
  (`~/component/input/TimeColumns`) like its own siblings do.
- `onUnitSelected` (driven via the constructor's `onChange` callback captured in
  the test): picking only an hour defaults minutes (and seconds) to `0` so the
  callback always receives a complete time
  ([TimeColumns.ts:140](../src/typescript/lib/component/input/TimeColumns.ts#L140));
  with `showSeconds:false` the seconds arg is always `0`.
- `setTime(date)` seeds `_hours/_minutes/_seconds`; `setTime(null)` clears to
  `-1`. Assert via `cellLabel`-driven highlight indirectly, or expose state via
  a cast — prefer driving `onChange` to observe the emitted tuple, the public
  contract.
- `cellLabel(value)` (cast): `-1` → `null`, `5` → `"05"`, `12` → `"12"`.

### `PickerColumn.test.ts` (no TestDOM)
- `PickerCell`: `setSelected(true)`/`isSelected()` round-trip; `setSelected`
  is a no-op when unchanged ([PickerColumn.ts:165](../src/typescript/lib/component/input/PickerColumn.ts#L165)).
- `setDisabled(true)`/`isDisabled()` round-trip; a disabled cell's click
  callback is suppressed — assert by wiring the `onClick` and calling the private
  `handleClick` (cast) or firing the cell's click handler; the callback must not
  run while disabled ([PickerColumn.ts:151](../src/typescript/lib/component/input/PickerColumn.ts#L151)).
- `PickerColumn.setSelectedValue("05")` selects exactly the cell whose label
  equals `"05"` and clears the rest; `setSelectedValue(null)` clears all
  ([PickerColumn.ts:375](../src/typescript/lib/component/input/PickerColumn.ts#L375)).
  Build a column with a couple of `PickerCell`s via `addCell`, then assert
  `isSelected()` on each.

### `AbstractInput` coverage (via a concrete leaf, no new file)
The `enabled`/`readOnly`/`change`/`binding` surface
([AbstractInput.ts](../src/typescript/lib/component/input/AbstractInput.ts)) is
exercised incidentally by the leaf tests above:
- `isEnabled()` default `true`, `isReadOnly()` default `false`.
- `setEnabled(false)` dispatches `applyEnabled` (observable via the leaf's ARIA
  or cursor state where cheap, else just the getter round-trip).
- `notifyChange` fires both `change` (with value) and `binding` (no args) — assert
  in `Toggle.test.ts` / `Checkbox.test.ts` with two registered listeners.
No standalone `AbstractInput.test.ts` (abstract, un-`callable`d).

---

## Internal Structure

A tiny per-file header, identical to the layout tests for the mount-requiring
cases only:

```ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = { rootMountOffset: { x: 0, y: 0 }, viewport: { width: 1280, height: 800 },
                 scrollBarWidth: 15, fontMetrics, themeVars: {} };
// ...
afterEach(() => DOM.reset());
```

The **no-TestDOM** files (the majority) need only:

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { NumberSpinner } from '~/component/input/NumberSpinner';
```

Private-helper probe pattern (confined to the test, commented):

```ts
// parseRaw is the protected unit under test; cast to reach it.
const field = new TimeField();
expect((field as any).parseRaw('09:99')).toBe(null);
```

`it.fails` pattern for the two divergences:

```ts
// CONTRACT DIVERGENCE: the Slider constructor calls applyValue() directly,
// bypassing snap(), so the initial value is NOT step-snapped (unlike setValue
// and unlike NumberSpinner). Intended contract: snapped to 20. Flip to `it`
// once Slider.ts:134 routes the initial value through snap().
it.fails('snaps the initial value option to step', () => {
    expect(new Slider({ min: 0, max: 100, step: 10, value: 23 }).getValue()).toBe(20);
});
```

---

## Ordered Implementation Steps

1. Create `tests/component/input/` (mirrors `tests/component/layout/`).
2. `NumberSpinner.test.ts` — clamp/snap/precision + bound defaults. No TestDOM.
   → verify: `npx vitest run tests/component/input/NumberSpinner.test.ts`.
3. `Slider.test.ts` — `snap`/`getLargeStep`/deprecated aliases + the **`it.fails`**
   initial-value pin; one mounted block for `setValue` round-trip + `change`.
4. `Checkbox.test.ts` — value/selected aliasing, indeterminate force-out, no-op
   guard, unmounted-warn assertion; one mounted block for `on("action")`.
5. `RadioButton.test.ts`, `Toggle.test.ts` — checked-state transitions, label,
   `value`/`selected` aliasing, group-name shim. No TestDOM.
6. `AutoCompleteField.test.ts` — all four `matches` modes + case-insensitivity
   pin + `getValue`/`setValue` delegation. No TestDOM.
7. `DateField.test.ts`, `TimeField.test.ts`, `DateTimeField.test.ts` — format &
   parse round-trips, the strict/lenient edge cases, the **`it.fails`**
   datetime-no-time pin, the documented date rollover. No TestDOM.
8. `TimeColumns.test.ts`, `PickerColumn.test.ts` — internal value math via the
   module path. No TestDOM.
9. `SpinButton.test.ts` — `tick` emit/cancelRepeat, glyph-by-symbol. No TestDOM.
10. Full run: `npx vitest run tests/component/input/` — all green, the two
    `it.fails` reported as *expected* failures (vitest counts a passing
    `it.fails` as a pass). → verify: zero unexpected failures.
11. `npx vitest run` (whole suite) to confirm no cross-file `DOM` state leak from
    the mounted blocks (each must `afterEach(() => DOM.reset())`).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `tests/component/input/NumberSpinner.test.ts` |
| Create | `tests/component/input/SpinButton.test.ts` |
| Create | `tests/component/input/Slider.test.ts` |
| Create | `tests/component/input/Checkbox.test.ts` |
| Create | `tests/component/input/RadioButton.test.ts` |
| Create | `tests/component/input/Toggle.test.ts` |
| Create | `tests/component/input/AutoCompleteField.test.ts` |
| Create | `tests/component/input/DateField.test.ts` |
| Create | `tests/component/input/TimeField.test.ts` |
| Create | `tests/component/input/DateTimeField.test.ts` |
| Create | `tests/component/input/TimeColumns.test.ts` |
| Create | `tests/component/input/PickerColumn.test.ts` |

No source files are modified. If the two `it.fails` pins are later promoted to
real fixes, that is separate follow-up work, not part of this test plan.

---

## Verification

- `npx vitest run tests/component/input/` — green; the two `it.fails`
  (Slider initial-snap, DateTimeField no-time reject) show as expected failures.
- `npx vitest run` — whole suite green; confirms the mounted Slider/Checkbox
  blocks `DOM.reset()` cleanly and don't poison later files.
- Spot-check the divergence pins are *real* by temporarily removing `.fails`
  from each and confirming the bare `it` fails with the probed actual value
  (Slider → 23, DateTimeField → non-null Date), then restore `.fails`.
- No `npm run docs:build` impact — tests touch no public API or docs.

---

## Potential Challenges

- **`Slider.setValue` throws unmounted** — the snap math must be reached via the
  private `snap()` cast or a mounted instance; do not call `setValue` on a bare
  Slider. Mitigation: documented in _Architecture Decisions_; the snap tests use
  the cast, the round-trip test mounts.
- **`Checkbox.setSelected` warns unmounted** — the `console.warn` is expected, not
  a failure. Mitigation: assert it with a `vi.spyOn(console, 'warn')` so the
  noise is captured and the state flip is still verified.
- **Date tests and the host timezone** — `DateField`/`TimeField` build local-time
  Dates; assert on `getFullYear`/`getMonth`/`getDate`/`getHours`/`getMinutes`
  (local accessors), never on `toISOString()`/UTC, so the suite is TZ-stable.
- **`it.fails` semantics** — a `.fails` test that starts *passing* (i.e. the bug
  is fixed) turns red, which is the intended signal. The comment must say so, so
  a future implementer flips it to `it` rather than deleting it.
- **Internal imports** — `TimeColumns`/`PickerColumn` are not in the barrel; import
  by full module path. Verify the path resolves under the `~` alias before
  writing the bodies.

---

## Critical Files

- [`tests/component/Component.test.ts`](../tests/component/Component.test.ts) —
  the plain construct-and-assert idiom.
- [`tests/component/layout/Tab.test.ts`](../tests/component/layout/Tab.test.ts#L16-L39) —
  the `installTestDOM` + `CONFIG` + `afterEach(DOM.reset())` ritual to copy for
  the mounted blocks.
- [`tests/dom/TestDOM.ts`](../tests/dom/TestDOM.ts) — `installTestDOM` /
  `ModelledDOMConfig` shape.
- [`src/typescript/lib/component/input/AbstractInput.ts`](../src/typescript/lib/component/input/AbstractInput.ts),
  [`AbstractPickerField.ts`](../src/typescript/lib/component/input/AbstractPickerField.ts) —
  the shared value/enabled/readOnly/notifyChange contract under test.
- [`Slider.ts:134`](../src/typescript/lib/component/input/Slider.ts#L134) and
  [`DateTimeField.ts:150`](../src/typescript/lib/component/input/DateTimeField.ts#L150) —
  the two divergence sites the `it.fails` tests pin.

---

## Non-Goals

- **Dropdown open/close + focus choreography** (`AbstractPickerField.openDropdown`,
  `AutoCompleteDropdown`, calendar/time dropdowns) — DOM-event and animation
  heavy, low value-per-test, fragile.
- **Debounce / hold-repeat timing** (`AutoCompleteField` `setTimeout`,
  `SpinButton.scheduleNext`) — wall-clock-dependent; would need fake timers for
  little structural payoff.
- **File controls** (`FileField`, `FileDropZone`) — drag-drop `DataTransfer`
  events have no meaningful pure-logic seam worth the harness cost here.
- **Geometry / `doLayout` output** (track/thumb pixel positions, baseline pixel
  values) — covered in spirit by the existing baseline + layout suites; this
  plan asserts value contracts, not pixels.
- **Store-backed autocomplete filtering** (`querySuggestions` store branch) —
  exercises `AbstractStore.filterBy`, which belongs to the data-layer test suite,
  not the input suite; the static-array `matches` path is the in-scope unit.
