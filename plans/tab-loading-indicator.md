---
depends-on: [tab-lazy-layout-constraint]
touches-shared:
  - packages/lib/src/typescript/lib/layout/Tab.ts
  - packages/lib/src/typescript/lib/component/container/TabBar.ts
  - packages/lib/src/typescript/lib/component/button/TabButton.ts
  - packages/lib/src/typescript/lib/overlay/Dock.ts
---

# Per-Tab Busy Indication in the Tab Strip — Implementation Plan

## Overview

A tab whose content is still being built shows a spinner in the panel body, so the only person who can see it is someone already looking at that tab. Open three lazy tabs, switch away, and the strip gives no clue which are still loading. This plan surfaces that state where it is always visible: on the tab button itself.

The state already exists. `Tab` runs a per-entry machine `"lazy"` → `"building"` → `"ready"` ([packages/lib/src/typescript/lib/layout/Tab.ts:213](packages/lib/src/typescript/lib/layout/Tab.ts#L213)), and `"building"` is exactly the window this feature paints. The entry enters it synchronously in `materializeAsync` ([Tab.ts:1568](packages/lib/src/typescript/lib/layout/Tab.ts#L1568)) and leaves it in `onReady` ([Tab.ts:1597](packages/lib/src/typescript/lib/layout/Tab.ts#L1597)). No second source of truth is introduced.

Three pieces carry it. `TabButton` gains a `setBusy` / `isBusy` pair that shows a translucent pulsing overlay on its own element, never touching the identity glyph or the ✕. `TabBar` gains `setEntryBusy(id, busy)` / `isEntryBusy(id)`, the id-keyed push `Tab` already uses for other per-entry state. `Tab` drives the pair from the state machine, exposes a public component-keyed `setTabBusy` / `isTabBusy` for a consumer's own long operation, and emits a new `"busychange"` event. `Dock` subscribes to that event on a lazy panel's hidden inner strip and re-points it at the panel's tab in the **outer** region, mirroring how it already re-points that strip's `"exception"` ([Dock.ts:576–610](packages/lib/src/typescript/lib/overlay/Dock.ts#L576)).

---

## Architecture Decisions

### The indicator is a translucent pulsing overlay on the tab button, not a glyph and not an inline child

`TabButton` builds a `TabBusyIndicator` — a private `Component` subclass raw-appended onto the button's own element — that covers the button with a low-alpha accent wash and pulses its opacity. It participates in no layout, so a tab never changes size when it starts or stops loading.[^why-overlay]

This mirrors two things already in the codebase. The overlay mechanic is `TabButton.buildCloseButton` ([TabButton.ts:152](packages/lib/src/typescript/lib/component/button/TabButton.ts#L152)): a component raw-appended onto the button element rather than enrolled in a layout. The class shape is `TabIndicator` ([TabBar.ts:226](packages/lib/src/typescript/lib/component/container/TabBar.ts#L226)) — a private, non-exported, purely visual `Component` subclass living beside its owner, styled entirely from theme tokens.

The identity glyph is untouched: the wash sits *over* the whole button, displaces nothing, and is removed when the load ends. The ✕ carries `zIndex: 1` ([TabButton.ts:167](packages/lib/src/typescript/lib/component/button/TabButton.ts#L167)) and the wash leaves its z-index at the default, so the close affordance stays on top and stays clickable.

### The wash's geometry lives in a shared class rule; its colour and motion in per-instance setters

A module-level `.TabBusyIndicator` `StyleRule` carries the four inset offsets, `position: absolute`, and `pointer-events: none`. Colour, opacity, and animation are written through the typed `Component` setters. This is the split `SortPriorityBadge` uses ([SortPriorityBadge.ts:29](packages/lib/src/typescript/lib/component/table/cell/SortPriorityBadge.ts#L29)): static overlay geometry in one shared rule, per-instance state through setters.

The colour is `var(--ts-ui-tab-busy-color, var(--ts-ui-tab-indicator-color, #1a73e8))`. No new theme token is added to `Theme.ts`.[^colour-token]

### Motion respects `prefers-reduced-motion`, decided when the wash is shown

The pulse is a `ts-ui-tab-busy-pulse` keyframe registered once at module load via `StyleRule.ensureKeyframes`, the same registration `ProgressSpinner` uses ([ProgressSpinner.ts:17](packages/lib/src/typescript/lib/component/display/ProgressSpinner.ts#L17)). When `Animation.isReducedMotion()` ([Animation.ts:74](packages/lib/src/typescript/lib/core/Animation.ts#L74)) reports `true`, `setBusy(true)` paints a static wash and arms no animation.

| `Animation.isReducedMotion()` | Animation | Opacity |
| --- | --- | --- |
| `false` | `ts-ui-tab-busy-pulse 1.2s ease-in-out infinite` | driven by the keyframe (`0.10` → `0.30` → `0.10`) |
| `true` | none | fixed `0.22` |

The predicate is read each time `setBusy(true)` runs, so a setting changed between two loads is picked up on the next one.[^reduced-motion-timing]

### `TabBar` carries the state to the button; `Tab` pushes it by entry id

`TabBar` gains `setEntryBusy(id, busy)` and `isEntryBusy(id)`. `setEntryBusy` forwards to the cell's `TabButton.setBusy`; `isEntryBusy` reads it back. Both no-op / return `false` for an unknown id.

This is the channel `Tab` already uses for per-entry state that arrives *after* the cell was created: `TabBar.setEntryContentId` ([TabBar.ts:1424](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1424)), which `Tab` calls when a lazy entry's content materializes. The busy flag has the same shape — owner-known, bar-rendered, keyed by the stable cell id — so it takes the same channel rather than a new one.[^no-new-channel]

The state lives on the `TabButton`, not on the `BarEntry` record. `BarEntry` is bookkeeping the bar needs to *render and route* a cell; the button is the thing that displays busy, and it can answer `isBusy()` itself.

### `Tab` drives the flag from the existing state machine, at exactly two points

`materializeAsync` sets it immediately after `entry.state = "building"`; the `onReady` callback clears it immediately before `entry.state = "ready"`. No other call site in `Tab` touches it.[^two-points]

### Busy state is public API, keyed by content component

`Tab` gains `setTabBusy(content: Component, busy: boolean): boolean` and `isTabBusy(content: Component): boolean`. Both resolve the entry by identity against `entry.component`, the lookup `closeTab` ([Tab.ts:1100](packages/lib/src/typescript/lib/layout/Tab.ts#L1100)) and `indexOfContent` ([Tab.ts:1884](packages/lib/src/typescript/lib/layout/Tab.ts#L1884)) already use. `setTabBusy` returns `false` when no entry matches.[^public-api]

A tab still in `"lazy"` or `"building"` has `entry.component === null`, so a consumer cannot reach it through this API — which is correct, because those states are the deferred machine's to own.

`TabPanel` gets no forwarder; a consumer reaches this through `panel.getTab()`, the same route the dependency branch documents for `"exception"`.

The flag is **not** a `LayoutConstraints` field and **not** an `XOptions` field on any class.[^no-options-field]

### `Tab` emits `"busychange"`, positional, mirroring `"exception"`

`TabEvent` gains `"busychange"`, with listener `(busy: boolean, label: string) => void`. It fires from one private helper that both the state machine and `setTabBusy` route through, and only when the flag actually changes.

The payload mirrors `"exception"`'s `(error, label)` pair ([Tab.ts:2273](packages/lib/src/typescript/lib/layout/Tab.ts#L2273)): positional, because every `Tab` event is positional, and identified by *label* rather than by component, because a busy entry — like a failed one — may not have a component yet.

| Trigger | Emit |
| --- | --- |
| lazy entry enters `"building"` | `("busychange", true, "Orders")` |
| the same entry reaches `"ready"` | `("busychange", false, "Orders")` |
| `setTabBusy(content, true)` on a tab that was not busy | `("busychange", true, "Orders")` |
| `setTabBusy(content, true)` on a tab already busy | nothing |
| `setTabBusy(unknownComponent, true)` | nothing; returns `false` |

### `Dock` re-points a lazy panel's busy state onto the outer region's tab

A docked lazy panel's content sits in an identity frame carrying its own `Tab` with `setBarVisible(false)`, so its strip is invisible. `Dock.resolvePanel`'s lazy branch subscribes a named `onBusyChanged` handler to that inner `Tab`'s `"busychange"` and calls a new private `Dock.setFrameBusy(id, busy)`, which locates the frame's host region with `regionForFrame` ([Dock.ts:1762](packages/lib/src/typescript/lib/overlay/Dock.ts#L1762)) and calls `setTabBusy(frame, busy)` on that region's `Tab`.

This is the shape `Dock` already uses for the same problem: `resolvePanel` subscribes `onFailed` to the inner `Tab`'s `"exception"` and hands it to `failPanel` ([Dock.ts:1519](packages/lib/src/typescript/lib/overlay/Dock.ts#L1519)). Busy stops one step earlier than failure did — it lands on the outer tab instead of becoming a Dock-level event — because the outer strip is a place to *show* it, which a failure never had.[^no-dock-event]

`setFrameBusy` is a no-op when `regionForFrame` returns `null`. That covers a registered-but-undocked panel and a **torn-off float**: `adoptFloat` returns a lazy identity frame unchanged and `runSweep` wires it as a region, a known follow-up recorded in the dependency branch's `## Implementation Notes`. A floated lazy panel therefore shows its spinner in the float's body and no strip indication anywhere — its own strip is hidden and it has no outer tab. That is a degraded affordance, not a fault, and it resolves for free when the `adoptFloat` follow-up wraps a lazy frame in its own region.[^float-case]

There is no feedback loop: `Dock` subscribes `"busychange"` only on the frame `Tab`s it builds in `resolvePanel`, never on region `Tab`s, so the `setTabBusy` call that lands on the outer region emits an event nothing is listening for.

### Clearing

Success clears through `onReady`. Failure does not need clearing: a rejection runs `failEntry` → `closeEntry`, which calls `TabBar.removeBarEntry` ([TabBar.ts:1565](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1565)) and destroys the whole cell, button and overlay together. The same holds for a tab closed while its factory is in flight.

A consumer-set busy flag has no automatic clear — the consumer owns the matching `setTabBusy(content, false)`, exactly as `ProgressSpinner.showOverlay` is owned by its `hideOverlay`. An uncleared flag leaves the tab pulsing until the tab is closed; it leaks nothing, because the overlay dies with its button.

---

## Public API

```typescript
// packages/lib/src/typescript/lib/component/button/TabButton.ts

class TabButton extends ToggleButton {
    /**
     * Shows or hides the busy overlay — a translucent pulsing wash over the
     * whole button that marks this tab's content as still loading. Displaces
     * nothing: the label, the glyph and the close affordance are unchanged and
     * the button does not resize. Honours `prefers-reduced-motion` by painting
     * a static wash instead of a pulse.
     *
     * @param busy - True to show the overlay, false to hide it.
     *
     * @returns This button, for method chaining.
     */
    setBusy(busy: boolean): this;

    /**
     * Reports whether the busy overlay is currently shown.
     *
     * @returns True when this tab is marked busy.
     */
    isBusy(): boolean;
}
```

```typescript
// packages/lib/src/typescript/lib/component/container/TabBar.ts

class TabBar extends Component<TabBarOptions> {
    /**
     * Marks the cell with `id` as busy (or not), showing the tab button's
     * loading overlay. No-op for an unknown id.
     *
     * @param id - The cell id whose busy state changed.
     * @param busy - True while the cell's content is loading.
     *
     * @returns This tab strip, for method chaining.
     */
    setEntryBusy(id: string, busy: boolean): this;

    /**
     * Reports whether the cell with `id` is marked busy.
     *
     * @param id - The cell id to query.
     *
     * @returns True when the cell is busy; false for an unknown id.
     */
    isEntryBusy(id: string): boolean;
}
```

```typescript
// packages/lib/src/typescript/lib/layout/Tab.ts

export type TabEvent = "tabclose" | "empty" | "detach" | "activate" | "dock" | "exception" | "busychange";

export interface TabOptions extends LayoutManagerOptions {
    listeners?: {
        /** Fires when a tab's busy state changed, carrying the new state and the tab's label. */
        busychange?: (busy: boolean, label: string) => void;
    };
}

class Tab extends LayoutManager {
    /**
     * Marks the tab hosting `content` as busy (or not). Its tab button shows a
     * loading overlay until the flag is cleared or the tab is closed. Deferred
     * tabs are driven automatically while their content builds; this is the
     * entry point for a consumer's own long operation on a tab that is already
     * built.
     *
     * @param content - The content component whose tab to mark.
     * @param busy - True while the consumer's operation is running.
     *
     * @returns True when a matching tab was found, false when none matched.
     */
    setTabBusy(content: Component, busy: boolean): boolean;

    /**
     * Reports whether the tab hosting `content` is marked busy.
     *
     * @param content - The content component whose tab to query.
     *
     * @returns True when that tab is busy; false when no tab matches.
     */
    isTabBusy(content: Component): boolean;

    on(event:  "busychange", listener: (busy: boolean, label: string) => void): this;
    off(event: "busychange", listener: (busy: boolean, label: string) => void): this;
    protected emit(event: "busychange", busy: boolean, label: string): void;
}
```

`Dock` gains no public API. `TabPanel` gains none.

---

## Internal Structure

`TabBusyIndicator` — private, non-exported, at the top of `TabButton.ts` beside the existing imports:

```typescript
const BUSY_PULSE_KEYFRAME   = "ts-ui-tab-busy-pulse";
// Peak alpha of the pulse. Low enough that the label and the identity glyph
// stay legible through the wash on both the light and dark themes.
const BUSY_STATIC_OPACITY   = 0.22;

StyleRule.ensureKeyframes(
    BUSY_PULSE_KEYFRAME,
    "0% { opacity: 0.10; } 50% { opacity: 0.30; } 100% { opacity: 0.10; }"
);

let _busyClassRule: StyleRule | null = null;

/**
 * Registers the shared `.TabBusyIndicator` class rule once on first use. It
 * holds only the overlay geometry (absolute fill of the host button, no hit
 * testing); the colour, opacity and animation are per-instance setter writes.
 *
 * Idempotent and module-local; safe across hot reloads.
 */
function ensureBusyIndicatorClassRule(): void {
    if (_busyClassRule) {
        return;
    }

    _busyClassRule = new StyleRule({
        scope:  "class",
        name:   "TabBusyIndicator",
        styles: {
            position:      "absolute",
            top:           "0",
            right:         "0",
            bottom:        "0",
            left:          "0",
            pointerEvents: "none",
        },
    });
}

/**
 * The per-tab loading wash: a translucent accent-coloured overlay filling its
 * host {@link TabButton}, pulsing while the tab's content builds. Raw-appended
 * onto the button's element rather than laid out, so it never changes the tab's
 * size, and left at the default z-index so the overlaid close ✕ stays above it.
 */
class TabBusyIndicator extends Component {
    constructor() {
        ensureBusyIndicatorClassRule();

        super();

        this.setBackgroundColor("var(--ts-ui-tab-busy-color, var(--ts-ui-tab-indicator-color, #1a73e8))");
    }
}
```

`TabButton` — the new state and its setter:

```typescript
// Whether this tab is marked busy. Runtime state (a load starts and ends), not
// configuration, so it carries no options-bag field.
private _busy: boolean = false;

// The busy wash, built on the first setBusy(true) and reused thereafter.
private _busyIndicator: TabBusyIndicator | null = null;

setBusy(busy: boolean): this {
    if (this._busy === busy) {
        return this;
    }

    this._busy = busy;

    if (!busy) {
        // Drop the animation as well as the visibility: a hidden element with a
        // live infinite keyframe keeps the compositor working for nothing.
        this._busyIndicator?.clearAnimation();
        this._busyIndicator?.setVisible(false);

        return this;
    }

    if (!this._busyIndicator) {
        this._busyIndicator = new TabBusyIndicator();

        // Overlay it on this button's own element, the same way the close
        // affordance is mounted; a laid-out child would resize the tab.
        DOM.sink.appendChild(this.getElement(true)!, this._busyIndicator.getElement(true)!);
    }

    this._busyIndicator.setVisible(true);

    if (Animation.isReducedMotion()) {
        this._busyIndicator.clearAnimation();
        this._busyIndicator.setOpacity(BUSY_STATIC_OPACITY);
    } else {
        this._busyIndicator.setAnimation(`${BUSY_PULSE_KEYFRAME} 1.2s ease-in-out infinite`);
    }

    return this;
}

isBusy(): boolean {
    return this._busy;
}
```

`TabBar` — the two forwarders, placed beside `setEntryContentId`:

```typescript
setEntryBusy(id: string, busy: boolean): this {
    this.entryById(id)?.button.setBusy(busy);

    return this;
}

isEntryBusy(id: string): boolean {
    return this.entryById(id)?.button.isBusy() ?? false;
}
```

`Tab` — one private helper every busy write goes through, so the emit rule lives in one place:

```typescript
/**
 * Writes the busy flag onto a content entry's strip cell and reports the change.
 * Every busy write — the deferred machine's and the public setter's — routes
 * here, so `"busychange"` fires exactly once per real transition.
 *
 * @param entry - The content entry whose tab to mark.
 * @param busy - The new busy state.
 */
private setEntryBusy(entry: ContentEntry, busy: boolean): void {
    if (this._bar.isEntryBusy(entry.id) === busy) {
        return;
    }

    this._bar.setEntryBusy(entry.id, busy);
    this.emit("busychange", busy, this._bar.getEntryName(entry.id));
}
```

`Tab.materializeAsync` — one added line, straight after the state flip at [Tab.ts:1568](packages/lib/src/typescript/lib/layout/Tab.ts#L1568):

```typescript
entry.spinner = spinner;
entry.state   = "building";

// The strip's half of the spinner: the panel body's spinner is only visible
// while this tab is selected, so mark the tab itself for as long as the build
// runs.
this.setEntryBusy(entry, true);
```

`Tab.materializeAsync` — one added line inside the `onReady` callback, before the state flip:

```typescript
onReady: (component) => {
    this.setEntryBusy(entry, false);

    entry.component = component;
    // ... unchanged
}
```

`Tab` — the public pair:

```typescript
setTabBusy(content: Component, busy: boolean): boolean {
    const entry = this._contents.find(e => e.component === content);

    if (!entry) {
        return false;
    }

    this.setEntryBusy(entry, busy);

    return true;
}

isTabBusy(content: Component): boolean {
    const entry = this._contents.find(e => e.component === content);

    return entry ? this._bar.isEntryBusy(entry.id) : false;
}
```

`Dock.resolvePanel` — one more subscription in the lazy branch, beside the existing `onFailed`:

```typescript
// The frame's Tab is a local and its strip is hidden, so this subscription is
// the only thing that can put a docked panel's load on screen. Named reference,
// not an inline arrow, per the listener rule in ARCHITECTURE.md.
const onBusyChanged: (busy: boolean) => void = (busy: boolean): void => {
    this.setFrameBusy(spec.id, busy);
};

tab.on("exception",  onFailed);
tab.on("busychange", onBusyChanged);
```

`Dock.setFrameBusy` — placed beside `failPanel`:

```typescript
/**
 * Re-points a lazy panel's busy state from its hidden inner strip onto the tab
 * that actually shows it: the panel's tab in whichever region hosts its frame.
 * A no-op while the frame sits in no `Tab` region — registered but never
 * docked, torn off into a float, or mid-teardown.
 *
 * @param id - The id of the panel whose content started or finished loading.
 * @param busy - True while the panel's content factory is still in flight.
 */
private setFrameBusy(id: string, busy: boolean): void {
    const frame = this._frames.get(id);

    if (!frame) {
        return;
    }

    const region = this.regionForFrame(frame);

    if (!region) {
        return;
    }

    (region.getLayoutManager() as Tab).setTabBusy(frame, busy);
}
```

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/component/button/TabButton.ts`** — add the module-level `BUSY_PULSE_KEYFRAME` / `BUSY_STATIC_OPACITY` constants, the `StyleRule.ensureKeyframes` call, `ensureBusyIndicatorClassRule`, and the private `TabBusyIndicator` class, exactly as in `## Internal Structure`. Add the `StyleRule` import from `~/core/StyleTarget.js`, the `Component` import from `~/core/Component.js`, and the `Animation` import from `~/core/Animation.js` (`DOM` and `callable` are already imported). Do **not** export `TabBusyIndicator`.
   - Check: `grep -n "TabBusyIndicator" packages/lib/src/typescript/lib/component/button/TabButton.ts` — no match on an `export` line.

2. **`packages/lib/src/typescript/lib/component/button/TabButton.ts`** — add the `_busy` and `_busyIndicator` fields and the `setBusy` / `isBusy` methods from `## Internal Structure`, placed after `isCloseable`. Both fields are plain (not `declare`d): no options-dispatched setter writes them.

3. **`packages/lib/src/typescript/lib/component/container/TabBar.ts`** — add `setEntryBusy` and `isEntryBusy` from `## Internal Structure`, placed directly after `setEntryContentId` ([TabBar.ts:1424](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1424)), with the JSDoc from `## Public API`. `BarEntry` is unchanged — the flag lives on the button.
   - Check: `grep -n "busy" packages/lib/src/typescript/lib/component/container/TabBar.ts` — matches only in the two new methods and their JSDoc.

4. **`packages/lib/src/typescript/lib/layout/Tab.ts`** — add `"busychange"` to the `TabEvent` union ([Tab.ts:46](packages/lib/src/typescript/lib/layout/Tab.ts#L46)), the `busychange` key to `TabOptions.listeners` ([Tab.ts:129](packages/lib/src/typescript/lib/layout/Tab.ts#L129)), the `on` overload beside the `"exception"` one ([Tab.ts:2273](packages/lib/src/typescript/lib/layout/Tab.ts#L2273)), and the `emit` overload beside its `"exception"` counterpart ([Tab.ts:2307](packages/lib/src/typescript/lib/layout/Tab.ts#L2307)). No `applyOptions` change is needed — the bag is dispatched by a key loop.

5. **`packages/lib/src/typescript/lib/layout/Tab.ts`** — add the private `setEntryBusy(entry, busy)` helper from `## Internal Structure`, placed directly above `materializeAsync`.

6. **`packages/lib/src/typescript/lib/layout/Tab.ts`** — call `this.setEntryBusy(entry, true)` in `materializeAsync` immediately after `entry.state = "building"`, and `this.setEntryBusy(entry, false)` as the first line of the `onReady` callback. Extend `materializeAsync`'s JSDoc to say the tab is marked busy for the whole build. Change nothing in `failEntry` or `closeEntry`.
   - Check: `grep -n "this.setEntryBusy" packages/lib/src/typescript/lib/layout/Tab.ts` — exactly three call sites after step 7: one in `materializeAsync`, one in `onReady`, one in `setTabBusy`. No other caller.

7. **`packages/lib/src/typescript/lib/layout/Tab.ts`** — add the public `setTabBusy` and `isTabBusy` from `## Internal Structure`, placed directly after `closeTab` ([Tab.ts:1100](packages/lib/src/typescript/lib/layout/Tab.ts#L1100)), with the JSDoc from `## Public API`.

8. **`packages/lib/src/typescript/lib/overlay/Dock.ts`** — add the `onBusyChanged` named handler and the `tab.on("busychange", onBusyChanged)` subscription in `resolvePanel`'s lazy branch, beside the existing `onFailed` wiring ([Dock.ts:600–610](packages/lib/src/typescript/lib/overlay/Dock.ts#L600)).

9. **`packages/lib/src/typescript/lib/overlay/Dock.ts`** — add the private `setFrameBusy(id, busy)` from `## Internal Structure`, placed directly beside `failPanel` ([Dock.ts:1519](packages/lib/src/typescript/lib/overlay/Dock.ts#L1519)).

10. **`packages/lib/tests/component/button/TabButton.test.ts`** — add cases 1–4 from `## Expected Behaviour` to the existing file, reusing its `installTestDOM` harness.

11. **`packages/lib/tests/component/container/TabBar.test.ts`** — add cases 5–7 to the existing file, reusing its `installTestDOM` harness.

12. **`packages/lib/tests/component/layout/Tab.lazy.test.ts`** — add cases 8–13 to the existing file the dependency branch created, reusing its `hostTab` harness.

13. **`packages/lib/src/typescript/TabDemoPanel.ts`** — add the **"Toggle Busy"** button described in `## Verification`.

14. **Docs** — apply `## Documentation Impact`, then run `npm run docs:build` from the repo root and confirm zero TypeDoc warnings.

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | `packages/lib/src/typescript/lib/component/button/TabButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/TabBar.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Tab.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Dock.ts` |
| Modify | `packages/lib/src/typescript/TabDemoPanel.ts` |
| Modify | `packages/lib/tests/component/button/TabButton.test.ts` |
| Modify | `packages/lib/tests/component/container/TabBar.test.ts` |
| Modify | `packages/lib/tests/component/layout/Tab.lazy.test.ts` |
| Modify | `packages/lib/docs/components/TabButton.md` |
| Modify | `packages/lib/docs/components/TabBar.md` |
| Modify | `packages/lib/docs/layouts/Tab.md` |
| Modify | `packages/lib/docs/components/Dock.md` |
| Modify | `packages/lib/llms.txt` (regenerated, not hand-edited) |

---

## Expected Behaviour

Cases 1–13 are unit-testable offline. Cases 14–19 need manual verification in a browser.[^offline-line]

**`TabButton`**

1. A freshly built `TabButton` reports `isBusy() === false`, and its element has no `TabBusyIndicator` child.
2. `button.setBusy(true)` makes `isBusy()` return `true` and is chainable (returns the button).
3. `setBusy(true)` twice in a row builds exactly one indicator: the button's element gains one child on the first call and none on the second.
4. `setBusy(true)` then `setBusy(false)` returns `isBusy()` to `false` and leaves the indicator in place but not visible; a following `setBusy(true)` reuses it rather than appending a second one.

**`TabBar`**

5. `bar.createBarEntry("a", "A"); bar.setEntryBusy("a", true)` makes `bar.isEntryBusy("a")` return `true`; `setEntryBusy("a", false)` returns it to `false`.
6. `bar.setEntryBusy("nope", true)` is a no-op and chainable; `bar.isEntryBusy("nope")` is `false`.
7. `bar.removeBarEntry("a")` then `bar.isEntryBusy("a")` is `false`.

**`Tab` — the deferred machine**

8. Registering a lazy tab and activating it emits `"busychange"` once with `(true, "Heavy")`, synchronously within the `setActiveTabIndex` call — the entry enters `"building"` before the two-frame yield.
9. That activation marks only the activated tab: an eagerly added sibling `panel` in the same strip still reports `tab.isTabBusy(panel) === false`, and only one `"busychange"` was emitted.
10. Re-activating the same lazy tab while it is still building emits no second `"busychange"` — `materializeAsync` declines re-entry, and the helper suppresses an unchanged write.

**`Tab` — the public API**

11. On a `Tab` holding an eagerly added child `panel`, `tab.setTabBusy(panel, true)` returns `true`, `tab.isTabBusy(panel)` is `true`, and `"busychange"` fired once with `(true, <panel's tab label>)`.
12. Calling `tab.setTabBusy(panel, true)` a second time returns `true` but emits nothing; `tab.setTabBusy(panel, false)` emits `(false, label)` once.
13. `tab.setTabBusy(new Component(), true)` returns `false`, emits nothing, and leaves every existing tab's busy state unchanged. `tab.isTabBusy(new Component())` is `false`.

**Manual (needs a real browser)**

14. Activate the demo's **Async** tab, then immediately switch to another tab. The Async tab's button pulses in the strip for the whole wait; when its content resolves the pulse stops, without the tab changing size or the strip re-flowing.
15. Two lazy tabs loading at once both pulse, independently, and each stops on its own resolve.
16. A busy tab that is **closeable** keeps its ✕ fully visible and clickable through the wash, and a tab with an identity **glyph** keeps that glyph visible and unchanged — no hourglass, no substitution.
17. Press **"Add Failing Tab"** and activate it: the tab pulses until the factory rejects, then the tab disappears entirely — no orphaned pulsing tab is left in the strip.
18. With the OS set to *reduce motion*, a loading tab shows a steady tint instead of a pulse; the tint appears and clears at the same moments.
19. **Dock.** In the Misc section's *Dockable layout* demo, press **"Add async panel"** and click another tab in the same region: the async panel's tab in the **outer** dock strip pulses for the whole wait and stops when the content resolves. Both light and dark themes show a visible, legible wash.[^dock-manual]

---

## Verification

- `npm run typecheck` and `npm run typecheck:test -w packages/lib` — both clean.
- `npm run test -w packages/lib` — the new and extended test files pass, and `Tab.test.ts`, `Tab.lifecycle.test.ts`, `Tab.lazy.test.ts`, `TabPanel.test.ts`, `Dock.lifecycle.test.ts` still pass unchanged.
- `npm run lint -w packages/lib` — clean. The `local/no-raw-dom` rule is the guard that the new overlay goes through `DOM.sink`.
- `grep -rn "setEntryBusy\|setTabBusy\|setBusy" packages/lib/src/typescript/lib/` — only `Tab.ts`, `TabBar.ts`, `TabButton.ts`, and `Dock.ts`'s `setFrameBusy`.
- `npm run docs:build` — zero TypeDoc warnings; `git diff packages/lib/llms.txt` shows only regenerated lines.
- **Demo, manual.** `npm run dev`, open `http://localhost:8015`. The `TabDemoPanel` change to add: a **"Toggle Busy"** button beside the existing "Add Lazy Tab" / "Add Failing Tab" pair, whose handler reads the currently visible content with `this.tabPanel.getTab().getActiveContent()` and, when it is non-null, flips its state via `setTabBusy(content, !getTab().isTabBusy(content))` and writes the new state into `this.logText`. Also wire `this.tabPanel.getTab().on("busychange", (busy, label) => this.logText.setText(\`${busy ? "Loading" : "Loaded"}: ${label}\`))`. Then walk cases 14–18 in order, and case 18 again after toggling the OS reduce-motion setting.
- **Demo, manual — the dock.** Same dev server, Misc section, **Dockable layout (Dock)**. The demo already carries the **"Add async panel"** button the dependency branch added; no new demo code is needed. Walk case 19, in both `ModernTheme` and `DarkTheme`.

---

## Documentation Impact

No new symbol is exported from a package entry point: `TabButton`, `TabBar`, `Tab` and `Dock` are already exported, `TabBusyIndicator` is deliberately private, and the new members render into the existing TypeDoc pages from their JSDoc. No barrel file changes.

Per the repo's JSDoc rule, none of the new public JSDoc may `{@link}` a private symbol — describe the overlay and the state machine in prose rather than naming `TabBusyIndicator`, `materializeAsync`, or `setFrameBusy`.

Pages to edit:

- **`packages/lib/docs/components/TabButton.md`** — add a short *Busy state* section: `setBusy` / `isBusy`, what the overlay is (a translucent pulsing wash over the whole button that displaces nothing), that the identity glyph and the close ✕ are unaffected, and that `prefers-reduced-motion` swaps the pulse for a static tint. Name the `--ts-ui-tab-busy-color` override and its fallback to `--ts-ui-tab-indicator-color`.
- **`packages/lib/docs/components/TabBar.md`** — add `setEntryBusy` / `isEntryBusy` to the per-cell state methods listed beside `setEntryContentId`, noting the owner pushes the flag by cell id.
- **`packages/lib/docs/layouts/Tab.md`** — in the *Lazy panel construction* section, add a paragraph stating that a deferred tab is marked busy in the strip for the whole build, so a loading tab is visible while another tab is selected, and that the marking clears on resolve (a rejection removes the tab outright). Add a short *Busy tabs* subsection for the public API: `setTabBusy(content, busy)` for a consumer's own long operation on an already-built panel, the `"busychange"` event with a `tab.on('busychange', (busy, label) => …)` snippet, and the rule that the consumer owns clearing a flag it set. Link to `/components/TabButton` for the affordance.
- **`packages/lib/docs/components/Dock.md`** — add two sentences to the *Async panel content* subsection: while a lazy panel's content loads, its tab in the dock strip is marked busy, so the load is visible from any other panel in that region; a panel torn off into a float shows only its in-body spinner.
- **`packages/lib/llms.txt`** — generated, never hand-edited. Regenerate with `npm run docs:llms` (also run by `docs:build`) and commit the result.

No page is added or removed, so the VitePress sidebar and the component catalog need no entries.

---

## Potential Challenges

- **The wash must not eat the ✕ click.** The shared class rule sets `pointer-events: none` and the wash keeps the default z-index while `TabCloseButton` carries `zIndex: 1`; verify by clicking the ✕ of a pulsing tab (case 16), because a synthetic click would pass even if hit-testing were broken.
- **`setBusy` forces the button's element early.** `getElement(true)` inside `setBusy` materializes the button element if the strip has not rendered yet — `materializeAsync` can run from `doLayout` before `prepareStrip`. That is the same forced creation `buildCloseButton` already performs for every closeable tab at cell-creation time, so it is an established path; do not "fix" it by deferring the append into `render()`.
- **Do not put the flag on `BarEntry`.** Two records holding the same boolean drift. `TabBar` reads it back off the button.
- **Do not clear busy in `failEntry` or `closeEntry`.** Both destroy the cell; an added clear would emit a `"busychange"` for a tab that no longer exists.
- **Keep the emit inside the private `Tab.setEntryBusy` helper.** Emitting from `materializeAsync` and `setTabBusy` separately re-introduces the double-emit the unchanged-value guard exists to prevent.
- **`Dock` must not subscribe `"busychange"` on region `Tab`s.** Only the frame `Tab`s built in `resolvePanel` are subscribed; wiring it in `wireRegion` too would make the outer `setTabBusy` re-enter `setFrameBusy`.
- **The `adoptFloat` follow-up.** A torn-off lazy panel's frame is wired as a region rather than wrapped in one, so `regionForFrame` finds no host and `setFrameBusy` no-ops. Intentional (see `## Architecture Decisions`); do not widen `setFrameBusy` to chase it.
- **`Animation.isReducedMotion` reads `matchMedia` through `DOM.source`.** The offline test harness models it as not matching, so the offline cases exercise the animated branch only; the reduced-motion branch is manual case 18.

---

## Critical Files

- [packages/lib/src/typescript/lib/component/button/TabButton.ts:145–203](packages/lib/src/typescript/lib/component/button/TabButton.ts#L145) — `buildCloseButton`, `getCloseButton`, `isCloseable`: the overlay-on-the-button mechanic this feature copies, the `zIndex: 1` the wash must stay under, and the field/accessor shape `_busy` / `isBusy` follows.
- [packages/lib/src/typescript/lib/component/container/TabBar.ts:188–213](packages/lib/src/typescript/lib/component/container/TabBar.ts#L188) — the `BarEntry` record, and why the flag does not join it.
- [packages/lib/src/typescript/lib/component/container/TabBar.ts:1412–1456](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1412) — `setEntryContentId` and `entryById`: the precedent for owner-pushed per-entry state, and the lookup the two new methods use.
- [packages/lib/src/typescript/lib/component/container/TabBar.ts:215–280](packages/lib/src/typescript/lib/component/container/TabBar.ts#L215) — `TabIndicator`: the private, theme-token-styled, non-laid-out overlay `Component` subclass `TabBusyIndicator` is shaped after.
- [packages/lib/src/typescript/lib/component/table/cell/SortPriorityBadge.ts:18–88](packages/lib/src/typescript/lib/component/table/cell/SortPriorityBadge.ts#L18) — the shared-class-rule-plus-per-instance-setters split for an absolutely positioned overlay.
- [packages/lib/src/typescript/lib/component/display/ProgressSpinner.ts:17–20, 80–90](packages/lib/src/typescript/lib/component/display/ProgressSpinner.ts#L17) — `StyleRule.ensureKeyframes` at module load and `setAnimation` on a component: the animation registration pattern.
- [packages/lib/src/typescript/lib/core/Animation.ts:74–110](packages/lib/src/typescript/lib/core/Animation.ts#L74) — `isReducedMotion` and how `play` short-circuits on it.
- [packages/lib/src/typescript/lib/layout/Tab.ts:201–240](packages/lib/src/typescript/lib/layout/Tab.ts#L201) — `TabEntryState` and `ContentEntry`: the machine `"building"` belongs to.
- [packages/lib/src/typescript/lib/layout/Tab.ts:1550–1626](packages/lib/src/typescript/lib/layout/Tab.ts#L1550) — `materializeAsync`, `onReady`, and `failEntry`: the two write points and the path that needs no clear.
- [packages/lib/src/typescript/lib/layout/Tab.ts:1090–1110, 1880–1890](packages/lib/src/typescript/lib/layout/Tab.ts#L1090) — `closeTab` and `indexOfContent`: the component-identity lookup the public API mirrors.
- [packages/lib/src/typescript/lib/layout/Tab.ts:2200–2320](packages/lib/src/typescript/lib/layout/Tab.ts#L2200) — the `on` / `off` / `emit` overload block and the `"exception"` overloads `"busychange"` is modelled on.
- [packages/lib/src/typescript/lib/overlay/Dock.ts:576–615](packages/lib/src/typescript/lib/overlay/Dock.ts#L576) — `resolvePanel`'s lazy branch and its `onFailed` subscription: the precedent for reaching a hidden inner strip's event.
- [packages/lib/src/typescript/lib/overlay/Dock.ts:1519–1536, 1755–1770](packages/lib/src/typescript/lib/overlay/Dock.ts#L1519) — `failPanel` and `regionForFrame`: where `setFrameBusy` sits and how it finds the outer region.
- [packages/lib/src/typescript/lib/core/Theme.ts:1008–1020](packages/lib/src/typescript/lib/core/Theme.ts#L1008) — the `--ts-ui-tab-*` token emissions, including `--ts-ui-tab-indicator-color`, which every theme defines.
- [packages/lib/tests/component/layout/Tab.lazy.test.ts](packages/lib/tests/component/layout/Tab.lazy.test.ts) — the offline lazy-tab harness the `Tab` cases extend.

---

## Non-Goals

- **A determinate progress bar in the tab.** The deferred machine knows only "in flight", not how far along; a percentage API would have no producer.
- **Busy indication on `TabPanel`.** Reached through `panel.getTab()`, matching how `"exception"` is reached.
- **A Dock-level `"busychange"` event.** `Dock` shows the state on the outer tab; an application that wants to observe its own factory's progress already owns that factory.
- **Fixing `adoptFloat`'s region wiring for lazy frames.** A follow-up already recorded on the dependency branch; a floated lazy panel keeps its in-body spinner.
- **A busy state on a tab that has never materialized, set by a consumer.** `"lazy"` and `"building"` belong to the deferred machine; `setTabBusy` is component-keyed and cannot reach them.
- **A new theme token in `Theme.ts`.** The wash reads an override variable that falls back to the existing tab-indicator accent.
- **Automatic timeout or auto-clear of a consumer-set flag.** The consumer owns clearing, like `ProgressSpinner.showOverlay` / `hideOverlay`.

---

## Notes

[^why-overlay]: Three affordances were weighed. **An inline `ProgressSpinner` in the button's content row** was rejected on layout stability: it joins the row's preferred width, so every tab would grow when its load starts and shrink when it ends, re-flowing the whole strip twice per load — and under a `scrollable` or `compact` strip that also shifts the scroll position. It also lands inside `Button`'s content row, where the glyph line-height sync and the `glyphOnly` heuristics live, which is the fragile part of the button. **A pulse on the label text** was rejected because reaching the private inner `Text` from `TabButton` couples the busy state to the button's internal composition, and because a rotated (`vertical-cw` / `vertical-ccw`) strip makes a text-local effect hard to read. **A full-button overlay** was chosen: it needs no geometry from the layout pass (the shared class rule pins it to all four edges), it cannot change any size, it is orientation-agnostic, and it composes with both the identity glyph and the close ✕ instead of competing for their slots. The one cost is that the wash tints the label; the peak alpha is chosen low enough that the label stays legible, and case 19 checks it on both the light and the dark theme.

    Reusing the glyph slot was never on the table: the glyph is panel identity, written once at cell creation from `constraints.glyph`, and an earlier iteration of this work conflated the two and shipped an hourglass that never cleared.

[^colour-token]: Adding a real token means editing the `Theme` interface, every shipped preset, and `themeToVars` — three edits for a colour that has a correct existing answer. `--ts-ui-tab-indicator-color` is the strip's accent, emitted by `themeToVars` for every theme ([Theme.ts:1017](packages/lib/src/typescript/lib/core/Theme.ts#L1017)), so it is defined and theme-correct in light and dark by construction. The leading `--ts-ui-tab-busy-color` in the chain gives an application a single-variable override without a theme change. A variable with no `themeToVars` entry, backed by an in-place fallback, is an established shape here — `--ts-ui-tab-close-hover-bg` is exactly that, documented as such at [TabButton.ts:157–161](packages/lib/src/typescript/lib/component/button/TabButton.ts#L157).

[^reduced-motion-timing]: The alternative was to subscribe to the media query and re-decide live, the way `ProgressSpinner` subscribes to theme changes for its size. It was rejected as disproportionate: the wash exists for the length of one load, a user changing the OS motion setting mid-load is vanishingly rare, and the subscription would need its own teardown on every tab close — a leak class this codebase has already been burned by (the theme-listener teardown work). Reading the predicate at show time costs one `matchMedia` call per load and picks the new setting up on the next one.

[^no-new-channel]: The alternative was for `Tab` to reach the `TabButton` directly — `TabBar` could expose the button and `Tab` could call `setBusy` on it. It was rejected because it is the cross-component reach ARCHITECTURE.md forbids: `TabBar` owns the strip's composition and is free to change what a cell is made of, which is precisely why `Tab` drives sort order, selection, closeability, labels and content ids through `TabBar` methods rather than through the buttons. `TabBar` already exposes `getEntryButtonId(id)`, but it returns an *id* for ARIA wiring, not a live component to mutate.

[^two-points]: The tempting third point is `failEntry`, and it is wrong: `failEntry` calls `closeEntry`, which calls `TabBar.removeBarEntry` and destroys the cell, so clearing the flag first would emit `"busychange"` for a tab that is about to stop existing — and any listener that maps the event onto a user-visible status line would show "loaded" a frame before the tab vanished. The close-during-flight path is the same shape: the entry leaves `_contents`, `isStale` reports true, and neither `onReady` nor `onError` runs. In both cases the flag dies with the button.

[^public-api]: Keeping it internal was the tighter option and was rejected on the strength of the motivating workflow. The database browser that prompted this feature opens a table lazily *and* reloads an already-open one; the second case has the identical feedback gap and no library answer, so every application would hand-roll one — and the only hand-roll available is reaching into the strip, which is worse than an API. The cost is small: the deferred machine and the public setter share one private helper, so there is one write path and one emit rule, not two. The risk — a consumer who never clears the flag — is bounded, because the flag dies with the tab and is visibly stuck rather than silently wrong. `setTabBusy` is keyed by the content component rather than by strip index or label because index and label both drift (reorder, rename), and because it is the key `closeTab` already uses for the one other operation an owner performs on a tab from outside.

[^no-options-field]: ARCHITECTURE.md reserves the `XOptions` bag for consumer *configuration*, and requires runtime-only state to live in a private backing field. Busy is transient state with a beginning and an end, like selection — no `TabButtonOptions.busy`, no `TabBarOptions` field, no `LayoutConstraints.lazy`-style constraint field. `LayoutConstraints` would be a particularly bad home: it is serialized and round-tripped by `LayoutSerialization`, so a transient flag there would be saved into a persisted layout and restored as a tab that pulses forever with nothing loading.

[^no-dock-event]: A Dock-level `"busychange"` event, mirroring the `"exception"` re-emit exactly, was considered and dropped. `"exception"` had to become a Dock event because a failure has no visual home — the library ships no error UI, so the only thing it can do is tell the application. Busy has a visual home, and it is the outer tab, which `Dock` can reach itself. Adding the event as well would mean a union member, an overload trio, a payload interface and a `listeners` key for information the application already has: it wrote the async factory whose promise defines the busy window. If a consumer later needs it, the frame `Tab`'s event is where it comes from and the re-emit can be added then.

[^float-case]: The dependency branch's `## Implementation Notes` record that `adoptFloat` returns a lazy identity frame unchanged and `runSweep` then wires that frame as a region, and that moving the identity-frame guard to the top of `wireRegion` would strip a floated lazy panel of its drop target and lifecycle subscriptions. That interaction is why `setFrameBusy` checks `regionForFrame` rather than assuming a host: for a floated lazy panel the frame is *itself* the region, so `indexOfContent(frame)` matches nothing and the lookup returns `null`. The result is a clean no-op rather than a wrong tab being marked. When the recorded follow-up lands and a floated lazy frame is wrapped in its own region, the busy state will surface on the float's own strip with no change to this code.

[^offline-line]: The recording DOM sink records `requestAnimationFrame` calls and drops the callbacks (`tests/dom/TestDOM.ts:539`), so nothing past the two-frame yield runs offline: a factory is never invoked, `onReady` never fires, and the busy flag is never *cleared* by the deferred machine in a test. Everything on the near side of that gate is fully synchronous and fully assertable — `materializeAsync` sets `entry.state = "building"` and marks the strip before it calls `Animation.materialize` at all, so case 8 asserts inside the `setActiveTabIndex` call itself. The public `setTabBusy` path involves no animation frame anywhere, so cases 11–13 cover set, clear, no-op-on-unchanged and the unknown-component miss end to end. What is left for a browser is the clear-on-resolve, the visual wash, the reduced-motion branch (the modelled `matchMedia` never reports a match), and the Dock forwarding.

[^dock-manual]: The `Dock` end-to-end path is manual because the dependency branch established that a panel added to the dock at runtime is registered and tabbed but its identity frame is never laid out in the automated browser — it measures 0×0, so its content never materializes and the busy window never opens. That is a pre-existing condition of the automated browser, unrelated to this change, and it was worked around there the same way: the offline tests cover the pieces (`setTabBusy` on a region `Tab` is case 11) and the end-to-end check is run in a real browser by hand.
