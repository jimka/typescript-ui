# Shared `clamp` / `AutoRepeat` / Size-Sentinel Utilities — Implementation Plan

## Overview

This is a **foundational consolidation plan**. It creates three shared utilities and migrates their inlined call sites repo-wide. No behaviour changes — every migration is behaviour-preserving refactoring against a single source of truth.

1. **`Util.clamp(value, min, max)`** — a numeric clamp added to the `Util` namespace at [core/Util.ts](src/typescript/lib/core/Util.ts). The pattern `Math.min(Math.max(v, min), max)` / `Math.max(min, Math.min(max, v))` is inlined ~30 times across layout, input, overlay, and core, and [overlay/Popover.ts:808](src/typescript/lib/overlay/Popover.ts#L808) defines a private local `clamp` arrow. All are folded onto one function.
2. **`AutoRepeat`** — a small helper class at a new `core/AutoRepeat.ts` for the press-and-hold *accelerating* auto-repeat state machine. [component/input/SpinButton.ts](src/typescript/lib/component/input/SpinButton.ts) and the file-local `ScrollArrowButton` in [component/container/Scrollbar.ts](src/typescript/lib/component/container/Scrollbar.ts) reimplement the identical machine (initial delay → ×decay per tick → floor). Both migrate onto `AutoRepeat`.
3. **Unbounded-size sentinel standardization** — [primitive/Size.ts](src/typescript/lib/primitive/Size.ts) already defines the canonical `UNBOUNDED` / `isUnbounded` / `saturate`. Three files still write raw `Infinity` / `Number.MAX_SAFE_INTEGER` for a *size extent*: [layout/Table.ts](src/typescript/lib/layout/Table.ts), [component/input/Slider.ts](src/typescript/lib/component/input/Slider.ts), and [component/input/NumberSpinner.ts](src/typescript/lib/component/input/NumberSpinner.ts). Those size-extent sites migrate to `UNBOUNDED`.

**Ownership.** This plan is the base of a small dependency chain. It sets **no** `depends-on`. Three sibling plans depend on it (they reference `Util.clamp` and must be sequenced after this one merges): `layout-manager-shared-size-logic`, `overlay-positioning-and-event-consolidation`, and `input-field-fixes-and-scaffolding-consolidation`.

---

## Architecture Decisions

### `Util.clamp` lives in the `Util` namespace, not a new module

`clamp` is a pure numeric helper with the same "general-purpose utility" character as the existing `Util.isInteger` / `Util.kebabToCamel`. It belongs in the `Util` namespace ([core/Util.ts](src/typescript/lib/core/Util.ts)), reachable as `Util.clamp(...)` with no new import path or barrel entry. `Util` already exports through [core/index.ts:9](src/typescript/lib/core/index.ts#L9) and is a TypeDoc entry point.

### Canonical form is `Math.min(Math.max(value, min), max)`; `min ≤ max` is assumed

The framework's documented size invariant is `min ≤ preferred ≤ max` (ARCHITECTURE.md, *Size constraints*). Under `min ≤ max` **both** inlined orderings — low-first `Math.min(Math.max(v, min), max)` and high-first `Math.max(min, Math.min(max, v))` — produce identical results, so a single canonical function is a faithful drop-in. The two orderings diverge **only** when `min > max` (low-first yields `max`, high-first yields `min`). Every migrated site is verified below to keep `min ≤ max` (the two empty-collection index clamps early-return before the clamp, so their upper bound `len - 1 ≥ 0`). Sites where `min > max` is genuinely reachable are left un-migrated and listed in `## Non-Goals`. The chosen low-first form matches the conventional `clamp` (lodash) and the majority of existing sites (`layout/Split`, `layout/Table`, `layout/Grid`).

### No `clampToRange` variant

The prompt asked to *consider* a second `clampToRange`. Every real site is a plain three-argument value clamp; no site clamps a `Size` or a range object. Adding a second name would be speculative surface (Simplicity First). Rejected — one `clamp(value, min, max)` covers everything.

### `AutoRepeat` is a plain class, callback-driven, using raw `setTimeout`

`AutoRepeat` is not a `Component` — it owns no DOM element — so it is **not** wrapped in `callable()`; it is a plain exported class like [core/ListenerBag.ts](src/typescript/lib/core/ListenerBag.ts). It drives an owner-supplied `onTick` callback rather than emitting events itself, because each host already owns its own event surface (`SpinButton.emit("tick")`, `ScrollArrowButton.emit("tick")`) and must keep dispatching through it (ARCHITECTURE.md event split). `setTimeout` / `clearTimeout` are process timers, not DOM access, so they do not go through the `DOM` seam — this matches the existing SpinButton/Scrollbar code and keeps the helper testable under Vitest fake timers.

### AutoRepeat folds in only the two accelerating repeaters

A survey of every `ReturnType<typeof setTimeout>` field in the library (`SpinButton`, `Scrollbar`, `MenuItem`, `TabBar`, `DockRegion`, `AutoCompleteField`, `Notification`, `Tooltip`) shows only `SpinButton` and `Scrollbar`'s `ScrollArrowButton` implement the *accelerating, self-rescheduling* pattern. The other six are **one-shot** timers (debounce, dismiss, show-delay, spring-raise, submenu-open-delay) with no decay loop. Folding them in would force an ill-fitting abstraction over unrelated timers — they stay as-is (`## Non-Goals`).

### `NumberSpinner` value bounds are **not** size sentinels

[NumberSpinner.ts:252](src/typescript/lib/component/input/NumberSpinner.ts#L252) (`?? -Infinity`) and [:274](src/typescript/lib/component/input/NumberSpinner.ts#L274) (`?? Infinity`) are the spinner's *numeric value* min/max defaults — the domain of the number the control edits, not a pixel size axis. `UNBOUNDED` is a size-axis sentinel (and there is no negative analogue for `-Infinity`), so migrating these would be a semantic error. Only [:220](src/typescript/lib/component/input/NumberSpinner.ts#L220) (`setMaxSize(Number.MAX_SAFE_INTEGER, h)`) is a genuine size extent and migrates.

---

## Public API

```typescript
// core/Util.ts — added to the Util namespace
export namespace Util {
    /**
     * Clamps a number into an inclusive range. Assumes min ≤ max (the
     * framework's size invariant); when min > max the maximum wins.
     */
    export function clamp(value: number, min: number, max: number): number;
}
```

```typescript
// core/AutoRepeat.ts — new plain class, exported through core/index.ts

export interface AutoRepeatOptions {
    /** Delay before the first repeat tick, in ms. */
    initialDelay: number;
    /** Multiplier applied to the delay after each tick (0 < decay ≤ 1). */
    decay: number;
    /** Lower bound the decaying delay never drops below, in ms. */
    floor: number;
    /** Invoked once immediately on start() and once per scheduled tick. */
    onTick: () => void;
}

export class AutoRepeat {
    constructor(options: AutoRepeatOptions);
    /** Fires onTick immediately, then schedules accelerating repeats. */
    start(): void;
    /** Cancels any pending schedule and resets the delay to initialDelay. */
    stop(): void;
    /** True while a repeat schedule is armed. */
    isRunning(): boolean;
}
```

`start()` firing `onTick` synchronously and then scheduling the first repeat at `initialDelay` reproduces the current `onMouseDown` behaviour exactly (immediate tick + `scheduleNext()`), so a quick click (mousedown→mouseup before the first timeout) yields exactly one tick.

---

## Internal Structure

`AutoRepeat` collapses the fields/methods currently duplicated as `_repeatHandle`, `_repeatDelay`, `cancelRepeat`, and `scheduleNext`:

```typescript
export class AutoRepeat {
    private readonly _initialDelay: number;
    private readonly _decay: number;
    private readonly _floor: number;
    private readonly _onTick: () => void;
    private _handle: ReturnType<typeof setTimeout> | null = null;
    private _delay: number;

    // start(): onTick(); this._delay = initialDelay; scheduleNext();
    // scheduleNext(): _handle = setTimeout(() => { onTick();
    //                 _delay = Math.max(floor, _delay * decay); scheduleNext(); }, _delay)
    // stop(): if (_handle) clearTimeout; _handle = null; _delay = initialDelay;
    // isRunning(): _handle !== null
}
```

The decay step reuses the very `Math.max(floor, delay * decay)` expression both hosts already have (SpinButton floor 40 / decay 0.75; Scrollbar `ARROW_REPEAT_FLOOR_MS` / `ARROW_REPEAT_DECAY`).

---

## Ordered Implementation Steps

### Part A — `Util.clamp`

1. **Add `Util.clamp`** to [core/Util.ts](src/typescript/lib/core/Util.ts) inside the `Util` namespace, with the canonical body `return Math.min(Math.max(value, min), max);` and a JSDoc documenting the `min ≤ max` assumption and the `min > max` → `max` tie-break. *(No import needed; pure.)*
2. **Write `tests/unit/core/Util.test.ts` clamp cases** (see `## Expected Behaviour`) and confirm red→green.
3. **Migrate the clamp call sites.** For each file, add `import { Util } from "~/core/Util.js";` if absent (already present in `Table.ts`, `NumberSpinner.ts`, `Tooltip.ts`, `ComboBox.ts`; absent in the rest). Replace each inlined expression with `Util.clamp(...)`, preserving argument order (`value, min, max`):

   | File | Line(s) | Current | Becomes |
   |---|---|---|---|
   | [core/Component.ts](src/typescript/lib/core/Component.ts) | 3368 | `Math.max(0, Math.min(<max>, value))` inside the `clamp:` arrow | `Util.clamp(value, 0, <max>)` |
   | [core/Component.ts](src/typescript/lib/core/Component.ts) | 4249 | `Math.max(0, Math.min(index, this._components.length))` | `Util.clamp(index, 0, this._components.length)` |
   | [core/RovingTabIndex.ts](src/typescript/lib/core/RovingTabIndex.ts) | 112 | `Math.max(0, Math.min(index, this._items.length - 1))` | `Util.clamp(index, 0, this._items.length - 1)` |
   | [layout/Split.ts](src/typescript/lib/layout/Split.ts) | 397 | `Math.min(Math.max(value, lo), hi)` | `Util.clamp(value, lo, hi)` |
   | [layout/Grid.ts](src/typescript/lib/layout/Grid.ts) | 725, 883, 884, 1005, 1006, 1007, 1008, 1032, 1033 | `Math.min(Math.max(v, lo), hi)` (index/span clamps) | `Util.clamp(v, lo, hi)` |
   | [layout/Table.ts](src/typescript/lib/layout/Table.ts) | 336 | `Math.min(Math.max(rawFlex, min), max)` | `Util.clamp(rawFlex, min, max)` |
   | [layout/Table.ts](src/typescript/lib/layout/Table.ts) | 388 | `Math.min(Math.max(width, min), max)` (private `clamp` method body) | `Util.clamp(width, min, max)` |
   | [layout/Tab.ts](src/typescript/lib/layout/Tab.ts) | 1815 | `Math.max(0, Math.min(index, this._contents.length - 1))` | `Util.clamp(index, 0, this._contents.length - 1)` |
   | [component/input/Slider.ts](src/typescript/lib/component/input/Slider.ts) | 639 | `Math.max(0, Math.min(1, fraction))` | `Util.clamp(fraction, 0, 1)` |
   | [component/input/Slider.ts](src/typescript/lib/component/input/Slider.ts) | 654 | `Math.max(min, Math.min(max, value))` | `Util.clamp(value, min, max)` |
   | [component/input/Slider.ts](src/typescript/lib/component/input/Slider.ts) | 662 | `Math.max(min, Math.min(max, snapped))` | `Util.clamp(snapped, min, max)` |
   | [component/display/ProgressBar.ts](src/typescript/lib/component/display/ProgressBar.ts) | 51 | `Math.max(0, Math.min(100, value))` | `Util.clamp(value, 0, 100)` |
   | [component/display/ProgressBar.ts](src/typescript/lib/component/display/ProgressBar.ts) | 131 | `Math.max(0, Math.min(100, value))` | `Util.clamp(value, 0, 100)` |
   | [component/container/VirtualScroller.ts](src/typescript/lib/component/container/VirtualScroller.ts) | 181 | `Math.max(0, Math.min(maxScroll, y))` | `Util.clamp(y, 0, maxScroll)` |
   | [component/container/VirtualScroller.ts](src/typescript/lib/component/container/VirtualScroller.ts) | 206 | `Math.max(0, Math.min(maxScroll, x))` | `Util.clamp(x, 0, maxScroll)` |
   | [component/container/VirtualScroller.ts](src/typescript/lib/component/container/VirtualScroller.ts) | 234 | `Math.max(0, Math.min(max, value))` (`clampAxis`) | `Util.clamp(value, 0, max)` |
   | [component/input/PickerColumn.ts](src/typescript/lib/component/input/PickerColumn.ts) | 386 | `Math.max(0, Math.min(maxScrollTop, desiredTop))` | `Util.clamp(desiredTop, 0, maxScrollTop)` |
   | [overlay/AbstractWindow.ts](src/typescript/lib/overlay/AbstractWindow.ts) | 1710, 1711 | `Math.max(Math.min(target, hi), lo)` | `Util.clamp(target, lo, hi)` |
   | [overlay/AbstractWindow.ts](src/typescript/lib/overlay/AbstractWindow.ts) | 1735, 1736 | `Math.max(Math.min(this.getX/Y(), max), min)` | `Util.clamp(this.getX/Y(), min, max)` |
   | [overlay/Popover.ts](src/typescript/lib/overlay/Popover.ts) | 808, 847, 868 | local `clamp` arrow + two call sites | delete the arrow; call `Util.clamp(...)` at 847/868 |

   **Verify the two empty-collection index sites** ([Tab.ts:1815](src/typescript/lib/layout/Tab.ts#L1815), [RovingTabIndex.ts:112](src/typescript/lib/core/RovingTabIndex.ts#L112)): both methods early-return when the collection is empty (`setActiveTabIndex` / `moveTo` bail on `length === 0`), so at the clamp line `length ≥ 1` and the upper bound `len - 1 ≥ 0 = min`. Migration is safe. (`Component.ts:4249` uses `.length`, not `.length - 1`, so its upper bound is `≥ 0` unconditionally.)

4. **Regression checkpoint:** `grep -rn 'Math\.min(Math\.max\|Math\.max(.*Math\.min' src/typescript/lib --include=*.ts` — the remaining hits should be only the documented `## Non-Goals` (ComboBox 4-arg, Tooltip two-step) plus any newly-discovered non-clamp arithmetic; there must be **zero** remaining pure three-argument clamps at the migrated files. `grep -n 'const clamp' src/typescript/lib/overlay/Popover.ts` → expect zero.

### Part B — `AutoRepeat`

5. **Create [core/AutoRepeat.ts](src/typescript/lib/core/AutoRepeat.ts)** with the class + `AutoRepeatOptions` per `## Public API` / `## Internal Structure`. Full JSDoc on class, options fields, and each method.
6. **Export it** from [core/index.ts](src/typescript/lib/core/index.ts): `export { AutoRepeat } from '~/core/AutoRepeat.js';` and `export type { AutoRepeatOptions } from '~/core/AutoRepeat.js';` (alphabetical-ish, near `Animation`/`ListenerBag`).
7. **Write `tests/unit/core/AutoRepeat.test.ts`** using Vitest fake timers (`vi.useFakeTimers()` / `vi.advanceTimersByTime`, per the [StatusBar test](tests/component/container/StatusBar.test.ts) precedent). Cover the timing semantics in `## Expected Behaviour`. Red→green.
8. **Migrate `SpinButton`** ([component/input/SpinButton.ts](src/typescript/lib/component/input/SpinButton.ts)):
   - Remove `_repeatHandle` (66) and `_repeatDelay` (67) fields.
   - Add `private _repeat: AutoRepeat;`, constructed in the constructor body with `{ initialDelay: 400, decay: 0.75, floor: 40, onTick: () => this.emit("tick") }`. Keep the existing magic-number comments (initial 400 ms / ×0.75 / floor 40 ms) on the option values.
   - `onMouseDown()` (217): `this._repeat.start();` (start already fires the immediate tick — remove the separate `this.emit("tick")` + `scheduleNext()`).
   - `onMouseUp()` (225): guard on `this._repeat.isRunning()` then `this._repeat.stop();`.
   - `cancelRepeat()` (205): delegate to `this._repeat.stop();` (or inline the call at the one caller and drop the method — keep whichever preserves the current public/private surface; `cancelRepeat` is private, so inlining is fine).
   - Delete `scheduleNext()` (237).
9. **Migrate `ScrollArrowButton`** in [component/container/Scrollbar.ts](src/typescript/lib/component/container/Scrollbar.ts):
   - Remove `_repeatHandle` (117) and `_repeatDelay` (118).
   - Add `private _repeat: AutoRepeat;` built with `{ initialDelay: ARROW_REPEAT_INITIAL_MS, decay: ARROW_REPEAT_DECAY, floor: ARROW_REPEAT_FLOOR_MS, onTick: () => this.emit("tick") }`. The `ARROW_REPEAT_*` module constants (44–46) stay.
   - `_onMouseDown` (253): after the `preventDefault`/`stopPropagation`/`_disabled` guard, `this._repeat.start();` (replaces `emit("tick")` + `scheduleNext()`).
   - `_onMouseUp` (269): `if (!this._repeat.isRunning()) return; this._repeat.stop();`.
   - `cancelRepeat` (237): delegate to / inline `this._repeat.stop()`.
   - Delete `scheduleNext()` (299).
10. **Regression checkpoint:** `grep -rn '_repeatHandle\|_repeatDelay\|scheduleNext' src/typescript/lib --include=*.ts` → expect **zero**. The six one-shot timer fields (`_springRaiseTimer`, `_debounceTimer`, `_dismissTimer`, `showTimer`, `_submenuTimer`, `_raiseTimer`) remain untouched.

### Part C — Size sentinel

11. **Migrate the three size-extent files** to `UNBOUNDED`. Add `import { UNBOUNDED } from "~/primitive/Size.js";` where absent (Slider, NumberSpinner, Table import neither symbol today — Table/NumberSpinner import `Util`, Slider imports neither).

    | File | Line(s) | Current | Becomes |
    |---|---|---|---|
    | [layout/Table.ts](src/typescript/lib/layout/Table.ts) | 334 | `col.getMaxWidth() ?? Infinity` | `col.getMaxWidth() ?? UNBOUNDED` |
    | [layout/Table.ts](src/typescript/lib/layout/Table.ts) | 386 | `column.getMaxWidth() ?? Infinity` | `column.getMaxWidth() ?? UNBOUNDED` |
    | [component/input/Slider.ts](src/typescript/lib/component/input/Slider.ts) | 100 | `setMaxSize(Number.MAX_SAFE_INTEGER, THUMB_SIZE)` | `setMaxSize(UNBOUNDED, THUMB_SIZE)` |
    | [component/input/Slider.ts](src/typescript/lib/component/input/Slider.ts) | 698 | `setMaxSize(Number.MAX_SAFE_INTEGER, THUMB_SIZE)` | `setMaxSize(UNBOUNDED, THUMB_SIZE)` |
    | [component/input/Slider.ts](src/typescript/lib/component/input/Slider.ts) | 701 | `setMaxSize(THUMB_SIZE, Number.MAX_SAFE_INTEGER)` | `setMaxSize(THUMB_SIZE, UNBOUNDED)` |
    | [component/input/NumberSpinner.ts](src/typescript/lib/component/input/NumberSpinner.ts) | 220 | `setMaxSize(Number.MAX_SAFE_INTEGER, h)` | `setMaxSize(UNBOUNDED, h)` |

    **Do NOT touch** NumberSpinner:252 / :274 (numeric value bounds `-Infinity` / `Infinity`, per Architecture Decision).

12. **Regression checkpoint:** grep the three migrated files for `Number.MAX_SAFE_INTEGER` and for `?? Infinity` — the only remaining `Infinity` hits must be NumberSpinner's value-bound defaults (252/274) and their JSDoc. `UNBOUNDED` numerically equals `Number.MAX_SAFE_INTEGER`, so the setMaxSize sites are value-identical; the Table `?? UNBOUNDED` change is behaviour-identical for finite widths and additionally makes the column ceiling recognisable by `isUnbounded` should it ever flow into size aggregation (the latent bug the primitive closes).

13. **Full verification pass** (see `## Verification`).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/core/AutoRepeat.ts` |
| Create | `tests/unit/core/AutoRepeat.test.ts` |
| Modify | `src/typescript/lib/core/Util.ts` (add `clamp`) |
| Modify | `tests/unit/core/Util.test.ts` (add clamp cases) |
| Modify | `src/typescript/lib/core/index.ts` (export `AutoRepeat`) |
| Modify | `src/typescript/lib/core/Component.ts` |
| Modify | `src/typescript/lib/core/RovingTabIndex.ts` |
| Modify | `src/typescript/lib/layout/Split.ts` |
| Modify | `src/typescript/lib/layout/Grid.ts` |
| Modify | `src/typescript/lib/layout/Table.ts` (clamp + sentinel) |
| Modify | `src/typescript/lib/layout/Tab.ts` |
| Modify | `src/typescript/lib/component/input/Slider.ts` (clamp + sentinel) |
| Modify | `src/typescript/lib/component/input/NumberSpinner.ts` (sentinel) |
| Modify | `src/typescript/lib/component/display/ProgressBar.ts` |
| Modify | `src/typescript/lib/component/container/VirtualScroller.ts` |
| Modify | `src/typescript/lib/component/input/PickerColumn.ts` |
| Modify | `src/typescript/lib/overlay/AbstractWindow.ts` |
| Modify | `src/typescript/lib/overlay/Popover.ts` |
| Modify | `src/typescript/lib/component/input/SpinButton.ts` (AutoRepeat) |
| Modify | `src/typescript/lib/component/container/Scrollbar.ts` (AutoRepeat) |

---

## Expected Behaviour

### `Util.clamp(value, min, max)` — unit-testable

- Value inside the range is returned unchanged: `clamp(5, 0, 10) === 5`.
- Value below min returns `min`: `clamp(-3, 0, 10) === 0`.
- Value above max returns `max`: `clamp(42, 0, 10) === 10`.
- Value exactly at each bound is returned unchanged: `clamp(0, 0, 10) === 0`, `clamp(10, 0, 10) === 10`.
- Fractional bounds/values respected: `clamp(0.5, 0, 1) === 0.5`, `clamp(1.5, 0, 1) === 1`.
- Negative ranges: `clamp(-5, -10, -1) === -5`, `clamp(-20, -10, -1) === -10`.
- Degenerate `min === max`: `clamp(v, 5, 5) === 5` for any `v`.
- Inverted `min > max` (documented tie-break — max wins under the low-first form): `clamp(5, 10, 0) === 0`. Pinning this documents the contract; callers must not rely on it (they keep `min ≤ max`).
- `NaN` handling (document, don't over-engineer): `clamp(NaN, 0, 10)` returns `NaN` (`Math.max(NaN, 0) === NaN`, `Math.min(NaN, 10) === NaN`). Matches every inlined form being replaced, so no behaviour change. A test pins it as the intended (inherited) behaviour.

### `AutoRepeat` — fake-timer-testable (timing) + direct (state)

- `start()` invokes `onTick` exactly once synchronously (before any timer advance).
- With `initialDelay: 400, decay: 0.75, floor: 40`: after `start()`, advancing 400 ms fires a 2nd tick; advancing a further 300 ms (400×0.75) fires the 3rd; then 225 ms the 4th — the interval shrinks by ×0.75 each tick.
- The interval never drops below `floor`: after enough ticks the gap saturates at 40 ms and stays there.
- `stop()` before the first scheduled timeout leaves the immediate `start()` tick as the only tick (models a quick click → one tick).
- `stop()` cancels all pending ticks: no further `onTick` after `stop()`, regardless of how far timers advance.
- `stop()` resets the delay: a subsequent `start()` begins again at `initialDelay`, not the decayed value (models release-then-press-again).
- `isRunning()` is `false` before `start()`, `true` after `start()` while armed, `false` after `stop()`.

### Migrated auto-repeat hosts — manual-verify (real pointer gestures, offline-untestable)

The framework's DOM event routing (mousedown/mouseup/mouseleave) is a live-only surface. Verify in the running app that: a single click on a `SpinButton` / scrollbar arrow produces exactly one step; press-and-hold accelerates from ~400 ms to a fast steady cadence; release (and pointer-leave-viewport) stops immediately.

### Sentinel migration — equivalence, mostly unit-testable

- `UNBOUNDED === Number.MAX_SAFE_INTEGER`, so `setMaxSize(UNBOUNDED, h)` is value-identical to the old `setMaxSize(Number.MAX_SAFE_INTEGER, h)` — Slider preferred/max-size reports and NumberSpinner cross-axis max are unchanged (assertable via each component's `getMaxSize()` in the offline harness).
- Table column clamp with `getMaxWidth() → null`: `Util.clamp(width, min, UNBOUNDED)` returns `width` (unbounded above) for every realistic column width, identical to the old `?? Infinity` path — assertable through a Table layout test that leaves `maxWidth` unset.

---

## Verification

- `npm run typecheck` — clean.
- `npm test` — all existing suites pass; new `Util.clamp` and `AutoRepeat` suites green.
- Grep invariants (Part A/B/C checkpoints above): zero remaining pure three-arg clamps at migrated files, zero `_repeatHandle`/`_repeatDelay`/`scheduleNext`, zero stray `Number.MAX_SAFE_INTEGER`/`?? Infinity` in the three sentinel files except NumberSpinner value bounds.
- `npm run docs:build` — zero warnings (new `Util.clamp`, `AutoRepeat`, `AutoRepeatOptions` are exported and documented; JSDoc must not `{@link}` any private/protected symbol).
- Manual smoke test in the running app (`npm run dev`, http://localhost:8015): drive a `NumberSpinner` (SpinButton hold-repeat), a virtual scrollbar's arrow buttons (ScrollArrowButton hold-repeat), a `Slider` (drag to both extremes), and a `ProgressBar` (values below 0 / above 100 clamp) — behaviour unchanged.

---

## Documentation Impact

- **`Util.clamp`** is exposed through the already-exported `Util` namespace ([core/index.ts:9](src/typescript/lib/core/index.ts#L9)), a TypeDoc entry point (`Util` is in `categoryOrder`). Its JSDoc renders automatically; no barrel or catalog edit needed.
- **`AutoRepeat` / `AutoRepeatOptions`** are new exports added to [core/index.ts](src/typescript/lib/core/index.ts) (a TypeDoc entry point at [typedoc.json](typedoc.json)). They render under the Core module. Give the class an `@category` consistent with its neighbours (`ListenerBag` uses none / defaults — match whatever `ListenerBag`/`SmoothScroller` do). No consumer-facing recipe page is required (internal utility).
- The size-sentinel migration exposes no new symbols (`UNBOUNDED` is already public); no doc change.
- Run `npm run docs:build` and confirm zero warnings.

---

## Potential Challenges

- **Clamp argument-order regressions.** Each migrated expression must map to `clamp(value, min, max)` with the *value* first — several sites write the bound first (`Math.max(0, Math.min(hi, v))`). Mis-ordering silently changes results. Mitigation: the Step-3 table states the exact rewrite per line; verify against the min/max identities before editing.
- **Inversion sensitivity (`min > max`).** Only the two empty-collection index clamps and the excluded Tooltip site can hit `min > max`; the index sites early-return on empty so are safe. Mitigation: the Step-3 note and `## Non-Goals` pin exactly which sites are safe and which are excluded.
- **`AutoRepeat.start()` double-tick.** The immediate `onTick` inside `start()` replaces the host's separate `emit("tick")` — forgetting to remove the host's original `emit("tick")` would fire two ticks per press. Mitigation: Steps 8/9 explicitly delete the pre-existing immediate emit + `scheduleNext`.
- **Field-initialization timing.** `SpinButton` writes `_repeat` in its constructor body (after `super()`), not as an `applyOptions`-dispatched field, so the `super()`-cascade trap (CODE_CONVENTIONS.md) does not apply; `ScrollArrowButton` extends `Component` directly and constructs `_repeat` in its constructor body too. No `declare` needed.

---

## Critical Files

- [core/Util.ts](src/typescript/lib/core/Util.ts) — namespace style, JSDoc idiom to match for `clamp`.
- [primitive/Size.ts](src/typescript/lib/primitive/Size.ts) — canonical `UNBOUNDED`/`isUnbounded`/`saturate`.
- [core/ListenerBag.ts](src/typescript/lib/core/ListenerBag.ts) — the plain-exported-class precedent `AutoRepeat` mirrors.
- [component/input/SpinButton.ts](src/typescript/lib/component/input/SpinButton.ts) and [component/container/Scrollbar.ts](src/typescript/lib/component/container/Scrollbar.ts) — the two accelerating repeaters (fields 66/67 and 117/118; methods `cancelRepeat`/`scheduleNext`/`onMouseDown`/`onMouseUp`).
- [tests/unit/core/Util.test.ts](tests/unit/core/Util.test.ts) and [tests/unit/primitive/Size.test.ts](tests/unit/primitive/Size.test.ts) — test-file conventions to match.
- [tests/component/container/StatusBar.test.ts](tests/component/container/StatusBar.test.ts) — Vitest fake-timer precedent for the `AutoRepeat` suite.
- [core/index.ts](src/typescript/lib/core/index.ts) and [typedoc.json](typedoc.json) — export surface / doc entry points.

---

## Non-Goals

- **`component/input/ComboBox.ts:240`** — `Math.min(Math.max(naturalW, floorW), ceilingW, DOM.source.getViewportSize().width)` is a four-argument min (a clamp *plus* a viewport cap), not a pure three-arg clamp. Rewriting it as `Math.min(Util.clamp(naturalW, floorW, ceilingW), viewportW)` is a marginal readability call left out to keep the migration mechanical; not part of this plan.
- **`overlay/Tooltip.ts:212–216`** — the two-step `clampedX = Math.min(x+OFFSET, vp.width - w); setX(Math.max(0, clampedX))` is inversion-sensitive: when a tooltip is wider than the viewport (`vp.width - w < 0`) it deliberately yields `0`, whereas the canonical low-first `Util.clamp` would yield the negative upper bound. Left as-is to preserve behaviour.
- **`overlay/Popover.ts:674–675`** *(discovered during implementation — not in the Step-3 table)* — the `_reposition` viewport clamp `Math.max(minX, Math.min(x, maxX))` is inversion-sensitive in exactly the Tooltip way: when the popover is wider/taller than the viewport, `maxX = vp.width − width − inset < minX`, and the current high-first form yields `minX` (pins the bubble at the leading margin) whereas low-first `Util.clamp` would yield the negative `maxX`. Left as-is.
- **`overlay/Popover.ts:847 / :868` (the arrow-position clamp)** *(the Step-3 table WRONGLY listed these + the local `clamp` arrow at :808 for migration; caught in audit and REVERTED)* — the deleted local arrow was high-first `Math.max(min, Math.min(value, max))`, and `maxLocalX/Y < minLocalX/Y` when the popover exceeds the viewport (the same condition as the excluded `_reposition` sibling). The low-first `Util.clamp` would pin the arrow to `maxLocal` instead of the leading inset `minLocal`. The local `clamp` arrow and both call sites are kept as-is; Popover imports no `Util`.
- **`overlay/AbstractWindow.ts:1735–1736` (`clampPositionToViewport`)** *(the Step-3 table WRONGLY listed these for migration; caught in audit and REVERTED)* — the originals were high-first `Math.max(Math.min(getX/Y(), maxX/Y), minX/Y)`, and with `constrainToViewport` on (the default) a window larger than the viewport gives `maxX = vw − w < 0 = minX`; the high-first form pins the leading edge on-screen (`minX`) whereas low-first `Util.clamp` would push it off-screen (`maxX`). Reverted to high-first. **The sibling `AbstractWindow.ts:1710–1711 (`clampDragDelta`) WAS safely migrated**: its reach-ratchet (`hiX = max(maxX, reachMinX)`, `loX = min(minX, reachMaxX)`, both seeded to the drag-start position) provably keeps `loX ≤ hiX` even when the base range inverts, so low-first and high-first agree there.
- **`layout/Split.ts:747`** *(discovered during implementation — not in the Step-3 table)* — the drag-resize `newLhs = Math.max(loLhs, Math.min(hiLhs, newLhs))` is inversion-sensitive: when the two panes' `[min,max]` are jointly infeasible (`loLhs = max(minLhs, total−maxRhs) > hiLhs = min(maxLhs, total−minRhs)`), the current high-first form yields `loLhs` (favours the left pane's floor) whereas low-first `Util.clamp` would yield `hiLhs`. Left as-is. (The tabled `Split.ts:397` is already low-first and migrates safely.)
- **`layout/Tab.ts:1850`** *(discovered during implementation)* — an additional `Math.max(0, Math.min(slot, appendedIndex))` index clamp in a migrated file; `appendedIndex = _contents.length − 1 ≥ 0` after the append, so `min ≤ max` holds and it **was migrated** to `Util.clamp` alongside the tabled `Tab.ts:1815`.
- **`NumberSpinner.ts:252 / :274`** — numeric *value* bounds (`-Infinity` / `Infinity`), not size extents; `UNBOUNDED` does not apply (and has no negative analogue).
- **`TabBar` `Number.MAX_VALUE` clamp ceilings** (≈1926/1939/1973/1986) — these are unbounded *upper bounds passed to `clampWrapperMain`*, outside the three sentinel files this plan scopes; `isUnbounded` already recognises `MAX_VALUE`, so they are harmless. Deferred (surgical scope).
- **The six one-shot timer fields** — `MenuItem._submenuTimer`, `TabBar._springRaiseTimer`, `DockRegion._raiseTimer`, `AutoCompleteField._debounceTimer`, `Notification._dismissTimer`, `Tooltip.showTimer` — are non-accelerating single-shot timers with no decay loop; `AutoRepeat` does not model them and they stay unchanged.
- **A `clampToRange` / `Size`-clamp variant** — no call site needs it (Architecture Decisions).
