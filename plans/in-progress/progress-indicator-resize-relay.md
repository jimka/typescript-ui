---
touches-shared: [packages/lib/src/typescript/lib/core/Component.ts]
---

# Progress-indicator resize relay — Implementation Plan

## Overview

`ProgressSpinner.showOverlay(target)` mounts the spinner as an absolute overlay by appending its element straight into the target's element ([ProgressSpinner.ts:237](packages/lib/src/typescript/lib/component/display/ProgressSpinner.ts#L237)). The overlay is therefore in no parent's laid-out set, and nothing lays it out. Today the spinner keeps itself in step with its target by looping: `doLayout` calls `this.setSize(...)` ([ProgressSpinner.ts:288](packages/lib/src/typescript/lib/component/display/ProgressSpinner.ts#L288)), `Component.setSize` calls `scheduleLayout()` unconditionally ([Component.ts:3968](packages/lib/src/typescript/lib/core/Component.ts#L3968)), the next frame lays the spinner out again, and the cycle repeats for as long as the overlay is shown — one layout pass and one animation frame per frame, forever, whether or not the target moved.

This plan replaces that loop with a real relay. `Component` gains a `"sizechange"` notification — `onSizeChange` / `offSizeChange`, modelled on the existing `onDirtyChange` / `offDirtyChange` pair ([Component.ts:2496-2512](packages/lib/src/typescript/lib/core/Component.ts#L2496)) — fired whenever a component commits a new width or height. `showOverlay` subscribes to its target, `hideOverlay` unsubscribes, and the spinner re-lays-out only when the target actually resizes.[^relay-not-poll]

The same change set stops three components writing child geometry through the unguarded `Component.setSize`: `ProgressSpinner`'s arc ([:306-308](packages/lib/src/typescript/lib/component/display/ProgressSpinner.ts#L306)), `ProgressBar`'s track and fill ([ProgressBar.ts:190-204](packages/lib/src/typescript/lib/component/display/ProgressBar.ts#L190)), and `Slider`'s track, active track and thumb ([Slider.ts:506](packages/lib/src/typescript/lib/component/input/Slider.ts#L506), [:511](packages/lib/src/typescript/lib/component/input/Slider.ts#L511), [:515](packages/lib/src/typescript/lib/component/input/Slider.ts#L515), [:522](packages/lib/src/typescript/lib/component/input/Slider.ts#L522), [:528](packages/lib/src/typescript/lib/component/input/Slider.ts#L528), [:532](packages/lib/src/typescript/lib/component/input/Slider.ts#L532)). Each becomes the guarded per-axis pair `setWidth` / `setHeight`, which is what `LayoutManager.commitBounds` already writes. `Slider`'s inert `showTicks` option is removed while the file is open — **in its own commit**, separate from the performance work.[^showticks]

---

## Architecture Decisions

### The overlay learns its target's size from a `"sizechange"` relay on `Component`

`showOverlay` registers a listener on the target; the target fires it from the geometry setters that commit a new size; the spinner's listener re-runs its own `doLayout()`. The shape mirrors `Component.onDirtyChange` / `offDirtyChange` ([Component.ts:2496-2512](packages/lib/src/typescript/lib/core/Component.ts#L2496)) exactly: a private `ListenerBag`, a dedicated `onX` / `offX` forwarder pair rather than `on("sizechange", …)`, and dispatch by firing the bag directly rather than through `emit`.[^mirror-dirtychange]

ARCHITECTURE.md's *Event handling* section currently calls `"dirtychange"` "the one base-`Component`-level custom event, so it is the one place this shape applies", and [docs/concepts/events.md:184-192](packages/lib/docs/concepts/events.md#L184) says the same in user-facing terms. This plan makes it two, for the same stated reason (a base-class `on`/`emit` overload is unreachable on any subclass that declares its own). Both sentences must be widened rather than silently contradicted — see *Documentation Impact*.

### The relay fires on a real size change, and a listener must be idempotent

`"sizechange"` fires from `setWidth`, `setHeight` and `setSize` only when the committed `_width` / `_height` actually differ from what was already there. `setX` / `setY` do not fire it — the event is about extent, not position. Because `LayoutManager.commitBounds` writes the two axes separately ([LayoutManager.ts:588-589](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L588)), a single laid-out resize fires the event once per changed axis:

| Call on the target | size before | size after | `"sizechange"` fires |
|---|---|---|---|
| `setSize({ width: 300, height: 200 })` | 300 × 200 | 300 × 200 | not at all |
| `setSize({ width: 320, height: 200 })` | 300 × 200 | 320 × 200 | once, with `(320, 200)` |
| `setWidth(320)` then `setHeight(210)` | 300 × 200 | 320 × 210 | twice — `(320, 200)`, then `(320, 210)` |
| `setX(4)` | 300 × 200 | 300 × 200 | not at all |

A listener therefore sees an intermediate box mid-commit and must be safe to run twice. The spinner's is: it re-reads the target and writes through guarded setters, so the second call writes only what the first could not yet know.[^double-fire]

### `setSize` gains the relay's change test, not a same-value guard

The `component-setter-guards` plan owns adding a same-value early return to `Component.setSize` and to fourteen other typed setters, and it must land *after* this plan. The boundary is exact:

- **This plan** adds a local `const changed = …` comparison to `setSize` and a `notifySizeChange()` call. Every existing statement stays: both field writes, both geometry writes, and the unconditional `scheduleLayout()`.
- **`component-setter-guards`** later turns that same comparison into `if (!changed) { return this; }` placed after the two `clamp` calls. It adds the early return; it does not move or re-derive the comparison.

Landing the guard first, without the relay, would stop the spinner's loop and with it stop the overlay resizing at all — silently, because no test covers overlay geometry.[^ordering]

### Child geometry is written with the guarded per-axis setters

`setX`, `setY`, `setWidth` and `setHeight` each return early when the value is unchanged ([Component.ts:4306](packages/lib/src/typescript/lib/core/Component.ts#L4306), [:4342](packages/lib/src/typescript/lib/core/Component.ts#L4342), [:4090](packages/lib/src/typescript/lib/core/Component.ts#L4090), [:4239](packages/lib/src/typescript/lib/core/Component.ts#L4239)); `setSize` does neither and additionally schedules a layout pass on the child. Every `setSize({ width, height })` call on a child in these three components becomes `setWidth(width)` followed by `setHeight(height)`, in the order `LayoutManager.commitBounds` uses — position first, then extent ([LayoutManager.ts:582-589](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L582)). That call site is the precedent: the framework's own child-placement path has never used `setSize`.[^per-axis]

---

## Public API

```typescript
class Component {
    /** Registers a listener fired when this component commits a new width or height. */
    onSizeChange(listener: (width: number, height: number) => void): this;

    /** Removes a listener registered with onSizeChange. */
    offSizeChange(listener: (width: number, height: number) => void): this;
}
```

Backing field: `private _sizeListeners: ListenerBag<"sizechange"> | null = null`, created on the first `onSizeChange` call and registered with `registerListenerBag` ([Component.ts:1016](packages/lib/src/typescript/lib/core/Component.ts#L1016)) so it is cleared when the component is destroyed.[^lazy-bag] There is no options-bag counterpart: `Component` carries no `listeners` bag, and `onDirtyChange` has none either.

Removed from `Slider`:

```typescript
interface SliderOptions {
    showTicks?: boolean;   // deleted
}

class Slider {
    isShowTicks(): boolean;          // deleted
    setShowTicks(value: boolean): this;   // deleted
}
```

---

## Internal Structure

`Component`'s dispatch helper, placed beside `_fireDirtyChangeIfFlipped` ([Component.ts:2543](packages/lib/src/typescript/lib/core/Component.ts#L2543)):

```typescript
private notifySizeChange(): void {
    this._sizeListeners?.fire("sizechange", this._width, this._height);
}
```

`setSize`, with only the two added lines marked:

```typescript
setSize(size: Size): this {
    const width  = this.clampWidth(size.width);
    const height = this.clampHeight(size.height);

    const changed = this._width !== width || this._height !== height;   // added

    this._width = width;
    this._height = height;

    if (changed) {                                                      // added
        this.notifySizeChange();
    }

    let element = this.getElement();
    // … unchanged from here to the end of the method
```

`setWidth` and `setHeight` each call `notifySizeChange()` immediately after their own field write (`this._width = width;` at [:4097](packages/lib/src/typescript/lib/core/Component.ts#L4097), `this._height = height;` at [:4246](packages/lib/src/typescript/lib/core/Component.ts#L4246)) — after the existing unchanged-value guard, and *before* the `if (!element)` early return, so the event reports the committed value whether or not the component has rendered yet.

`ProgressSpinner`'s listener is a bound instance field, so `showOverlay` and `hideOverlay` add and remove the same reference:

```typescript
// Bound once per instance so showOverlay / hideOverlay add and remove the
// exact same reference on the target's listener bag.
private readonly _handleTargetSizeChange = (): void => {
    this.doLayout();
};
```

`showOverlay`'s tail, replacing [ProgressSpinner.ts:239-242](packages/lib/src/typescript/lib/component/display/ProgressSpinner.ts#L239):

```typescript
this.setX(0);
this.setY(0);

target.onSizeChange(this._handleTargetSizeChange);

// Sizes the overlay to the target — doLayout reads the target's box itself.
this.doLayout();
```

`doLayout`'s overlay block, replacing [:287-289](packages/lib/src/typescript/lib/component/display/ProgressSpinner.ts#L287):

```typescript
if (this._overlayTarget) {
    this.setWidth(this._overlayTarget.getWidth());
    this.setHeight(this._overlayTarget.getHeight());
}
```

---

## Ordered Implementation Steps

Each step is a self-contained edit with a cheap check. All paths are from the repository root.

1. **Add the relay to `Component`** (`packages/lib/src/typescript/lib/core/Component.ts`). Declare `private _sizeListeners: ListenerBag<"sizechange"> | null = null;` beside `_dirtyListeners` ([:565](packages/lib/src/typescript/lib/core/Component.ts#L565)) — a plain initializer, no `declare`, because no setter `applyOptions` dispatches ever writes it and `Component`'s own field initializers run before its constructor body reaches `applyOptions`. Add `onSizeChange` / `offSizeChange` immediately after `offDirtyChange` ([:2512](packages/lib/src/typescript/lib/core/Component.ts#L2512)), and `notifySizeChange` after `_fireDirtyChangeIfFlipped` ([:2548](packages/lib/src/typescript/lib/core/Component.ts#L2548)). `onSizeChange` creates the bag on first use: `this._sizeListeners ??= this.registerListenerBag(new ListenerBag<"sizechange">());`.

   Checkpoint: `npm run typecheck` — clean. Nothing fires the event yet, so the suite must be unaffected: `npm test` green.

2. **Fire it from the three size setters** (same file), per *Internal Structure*: `setSize` ([:3953](packages/lib/src/typescript/lib/core/Component.ts#L3953)) gains the `changed` comparison and the guarded `notifySizeChange()`; `setWidth` ([:4090](packages/lib/src/typescript/lib/core/Component.ts#L4090)) and `setHeight` ([:4239](packages/lib/src/typescript/lib/core/Component.ts#L4239)) each gain one unguarded call after their field write. Do **not** add an early return to `setSize`, and do not touch `setX` / `setY`.

   Checkpoint: `grep -n 'notifySizeChange' packages/lib/src/typescript/lib/core/Component.ts` — exactly four hits (one definition, three call sites). `npm test` green: with no listener registered anywhere, `_sizeListeners` is `null` and every fire is a null check.

3. **Subscribe the spinner to its target** (`packages/lib/src/typescript/lib/component/display/ProgressSpinner.ts`). Add the `_handleTargetSizeChange` field beside `_overlayTarget` ([:88](packages/lib/src/typescript/lib/component/display/ProgressSpinner.ts#L88)). In `showOverlay`, drop the `setSize` line ([:241](packages/lib/src/typescript/lib/component/display/ProgressSpinner.ts#L241)) and register the listener before the existing `this.doLayout()`. In `hideOverlay`, call `this._overlayTarget.offSizeChange(this._handleTargetSizeChange);` *before* nulling `_overlayTarget` ([:254](packages/lib/src/typescript/lib/component/display/ProgressSpinner.ts#L254)).

4. **Stop the spinner re-sizing itself through `setSize`** (same file). Replace the overlay block at [:287-289](packages/lib/src/typescript/lib/component/display/ProgressSpinner.ts#L287) with the guarded pair from *Internal Structure*, and the arc's `setSize` at [:308](packages/lib/src/typescript/lib/component/display/ProgressSpinner.ts#L308) with `this._arc.setWidth(diameter);` / `this._arc.setHeight(diameter);`. Update `doLayout`'s JSDoc to say it also re-syncs the overlay to its target's box, and `showOverlay`'s to say the overlay tracks the target's size for as long as it is shown.

5. **Release the subscription on teardown** (same file). Add a `destructor()` override that calls `this.hideOverlay()` then `super.destructor()`, so a spinner destroyed while still overlaid does not leave a listener holding it alive on the target. Model the shape on [TablePanel.ts:132-141](packages/lib/src/typescript/lib/component/table/TablePanel.ts#L132).

   Checkpoint: `grep -n 'setSize' packages/lib/src/typescript/lib/component/display/ProgressSpinner.ts` — zero hits.

6. **Correct `DiagramView`'s stale comment** (`packages/lib/src/typescript/lib/component/diagram/DiagramView.ts`). The comment at [:809-811](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L809) says nothing else ever lays the spinner out; the relay now does. Keep the explicit `doLayout()` call — it is what sizes the overlay on the pass where a previously unsized view first gets a size, which is the case [DiagramView.test.ts:3181-3200](packages/lib/tests/component/diagram/DiagramView.test.ts#L3181) pins. Rewrite the comment to say the explicit call covers the first pass and the relay covers later resizes. **No other change to this file.**

7. **Convert `ProgressBar.doLayout`** (`packages/lib/src/typescript/lib/component/display/ProgressBar.ts`). Replace `this._track.setSize({ width: box.width, height: box.height })` ([:192](packages/lib/src/typescript/lib/component/display/ProgressBar.ts#L192)) and both `this._fill.setSize(...)` calls ([:198](packages/lib/src/typescript/lib/component/display/ProgressBar.ts#L198), [:203](packages/lib/src/typescript/lib/component/display/ProgressBar.ts#L203)) with the `setWidth` / `setHeight` pair. Leave `_fill.setX(0)` / `_fill.setY(0)` where they are — they are already guarded, and `doLayout` stays the one place that positions the children.[^fill-origin]

8. **Convert `Slider.doLayout`** (`packages/lib/src/typescript/lib/component/input/Slider.ts`). Six `setSize` calls, three per branch ([:506](packages/lib/src/typescript/lib/component/input/Slider.ts#L506), [:511](packages/lib/src/typescript/lib/component/input/Slider.ts#L511), [:515](packages/lib/src/typescript/lib/component/input/Slider.ts#L515), [:522](packages/lib/src/typescript/lib/component/input/Slider.ts#L522), [:528](packages/lib/src/typescript/lib/component/input/Slider.ts#L528), [:532](packages/lib/src/typescript/lib/component/input/Slider.ts#L532)). For `_track` and `_activeTrack` the pair replaces the `setSize` call at the same position. For `_thumb`, also move the two extent writes *below* its `setX` / `setY` calls so each child reads position-then-extent, matching `commitBounds`; the thumb's size stays in `doLayout` rather than moving to the constructor.[^thumb-stays]

   Checkpoint: `grep -n 'setSize' packages/lib/src/typescript/lib/component/input/Slider.ts packages/lib/src/typescript/lib/component/display/ProgressBar.ts` — zero hits.

9. **Delete `Slider`'s inert `showTicks` surface** (same file): the `showTicks?: boolean` field on `SliderOptions` ([:26](packages/lib/src/typescript/lib/component/input/Slider.ts#L26)), the `applyOptions` line ([:224](packages/lib/src/typescript/lib/component/input/Slider.ts#L224)), and `isShowTicks` / `setShowTicks` with their JSDoc ([:386-408](packages/lib/src/typescript/lib/component/input/Slider.ts#L386)).

   Checkpoint: `grep -rn 'showTicks' packages/lib/src packages/lib/tests packages/lib/docs packages/docs/src` — zero hits.

10. **Update the `quiesce` helper's comment** in `packages/lib/tests/component/input/Slider.test.ts` ([:31-49](packages/lib/tests/component/input/Slider.test.ts#L31)). It states that the slider's `doLayout` re-schedules its private children; after step 8 it does not. Keep the `pauseLayout()` calls — they are harmless and still guard the host flush — and correct the sentence that explains why they are there.

11. **Add the tests** from *Expected Behaviour* to the three existing suites (see *Verification* for the exact shape). `ProgressSpinner.test.ts`'s header comment declares the file "smoke-level scope only" ([:16-18](packages/lib/tests/component/display/ProgressSpinner.test.ts#L16)) — widen it to cover the overlay relay.

12. **Update the docs** per *Documentation Impact*.

13. **Run the checkpoints** in *Verification*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/ProgressSpinner.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/ProgressBar.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Slider.ts` |
| Modify | `packages/lib/src/typescript/lib/component/diagram/DiagramView.ts` (comment only) |
| Modify | `packages/lib/tests/component/display/ProgressSpinner.test.ts` |
| Modify | `packages/lib/tests/component/display/ProgressBar.test.ts` |
| Modify | `packages/lib/tests/component/input/Slider.test.ts` |
| Modify | `ARCHITECTURE.md` |
| Modify | `packages/lib/docs/concepts/events.md` |
| Modify | `packages/lib/docs/components/ProgressSpinner.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/docs/reference/migration/next.md` |

---

## Expected Behaviour

### Unit-testable

**The relay**

1. A component with no registered listener fires nothing: `setWidth`, `setHeight` and `setSize` behave exactly as today, including `setSize`'s unconditional `scheduleLayout()`.
2. `onSizeChange` then `setWidth(320)` on a 300 × 200 component calls the listener once with `(320, 200)`.
3. `setWidth(300)` on a 300-wide component calls no listener (the existing unchanged-value guard returns first).
4. `setSize({ width: 300, height: 200 })` on a component already 300 × 200 calls no listener, and still writes both geometry axes and still schedules a layout — the same-value guard is not part of this plan.
5. `setSize({ width: 320, height: 210 })` on a 300 × 200 component calls the listener exactly once, with `(320, 210)`.
6. `setX(4)` calls no listener.
7. `offSizeChange` with the same reference stops delivery; a second `offSizeChange` is a no-op.
8. Destroying the observed component releases the bag, so no listener survives it.

**The overlay**

9. After `showOverlay(target)` on a 300 × 200 target, the spinner's committed size is 300 × 200 and its origin is (0, 0).
10. With the target's size unchanged, draining the animation-frame queue six times after `showOverlay` runs **zero** spinner layout passes after the first: the per-generation callback counts are `[n, 0, 0, 0, 0, 0]`, where the first entry is whatever was already armed before the spinner's own writes. Today every entry is 1.
11. `target.setWidth(420)` while the overlay is shown resizes the spinner to 420 wide **synchronously**, with no animation frame in between. Same for `setHeight`, and for a `setSize` that changes both.
12. `hideOverlay()` then `target.setWidth(500)` leaves the spinner's committed size untouched.
13. A second `showOverlay` on the same target after a `hideOverlay` resumes tracking.
14. `isOverlay()` returns exactly what it does today at every step above — the `DiagramView` suite's fourteen assertions must pass unchanged.[^stale-anchors]

**Settled-pass write economy**

15. A `ProgressBar` that is laid out twice at the same size writes no `left`, `top`, `width` or `height` declaration on the second pass, and that pass arms no animation frame. The value relation is unchanged: `fill.getWidth() === round(inner.width * value / 100)`, so the existing 0 / 50 / 100 cases still hold.
16. A `Slider` laid out twice at the same size writes no `left`, `top`, `width` or `height` declaration on the second pass, and calls `scheduleLayout` on none of `_track`, `_activeTrack`, `_thumb` (today: three calls, twelve declarations). Thumb and active-track positions for a given value are unchanged.
17. A `ProgressSpinner` laid out twice inline at the same size writes no arc geometry on the second pass; the arc's diameter is still `min(spinnerSize, box.width, box.height)`, centred in the content box.

**Slider surface**

18. `new Slider({ showTicks: true })` is a compile error, and `slider.setShowTicks` / `slider.isShowTicks` no longer exist.

### Manual verification

19. **Demo, overlay tracking**: in the docs demo shell, press *Overlay spinner on this panel for 2 s* ([MiscPanel.ts:1745-1752](packages/lib/src/typescript/MiscPanel.ts#L1745)) and resize the browser window while the overlay is up. The backdrop must stay flush with the panel on every frame, with no lag and no uncovered edge.
20. **Demo, inline spinner**: the `ProgressSpinner` and `ProgressBar` demo pages still render and animate — geometry writes moved, the keyframe animation did not.
21. **Slider drag**: dragging a demo slider still moves the thumb and fills the active track smoothly. (`Slider`'s drag still writes `left`/`top`; moving it onto a promoted layer is a separate group's work — see *Non-Goals*.)

---

## Verification

1. `npm run typecheck` and `npm test` — both clean. `npm test` runs `typecheck:test` first, which is what catches a stale `showTicks` reference in a test file.
2. **Spinner relay probe**, added to `packages/lib/tests/component/display/ProgressSpinner.test.ts`. Capture frames instead of running them, exactly as [ResizeLayoutEconomy.test.ts:35-52](packages/lib/tests/component/tree/ResizeLayoutEconomy.test.ts#L35) does (`(DOM.sink as any).requestAnimationFrame = cb => { … }`). Build a bare `Component` target (the import the file already has), materialise it with `getElement(true)`, give it `setWidth(300)` / `setHeight(200)`, lay it out and drain. Then `showOverlay(target)` and drain six generations, recording `frames.length` before each drain. Assert `counts.slice(1)` is `[0, 0, 0, 0, 0]` (behaviour 10), then `target.setWidth(420)` and assert `spinner.getWidth() === 420` with no frame drained in between (behaviour 11), then `hideOverlay()`, `target.setWidth(500)`, and assert the spinner's width is still 420 (behaviour 12).
3. **Settled-pass probes**, added to the `ProgressBar` and `Slider` suites. Take `const sink = installTestDOM(CONFIG)`, lay the component out twice, then slice `sink.writes` from the mark and assert no recorded `apply` patch carries a `left`, `top`, `width` or `height` key (behaviours 15-16). Assert the count of geometry-bearing patches is `0` rather than asserting a total `apply` count — one empty-`InlineStyle` flush per component survives, and that floor belongs to a different group.
4. **Child-schedule probe**, in the `Slider` suite: `vi.spyOn(track, 'scheduleLayout')` on each of the three private children, one `slider.doLayout()`, assert all three spies have zero calls.
5. `grep -rn 'setSize' packages/lib/src/typescript/lib/component/display/ProgressSpinner.ts packages/lib/src/typescript/lib/component/display/ProgressBar.ts packages/lib/src/typescript/lib/component/input/Slider.ts` — zero hits.
6. `grep -rn 'showTicks' packages/lib/src packages/lib/tests packages/lib/docs packages/docs/src` — zero hits.
7. `npm run docs:api` — zero warnings. `onSizeChange` / `offSizeChange` are public, so their JSDoc may only `{@link}` other public symbols; describe `notifySizeChange` and the `ListenerBag` in prose.
8. `npm run lint` and `npm run docs:llms:check`.
9. Manual checks 19-21 above, in `npm run dev`.

---

## Documentation Impact

- **`ARCHITECTURE.md`**, *Event handling* → *Accepted exception* paragraph. It names `"dirtychange"` as the only base-`Component` custom event and says "This is the one base-`Component`-level custom event, so it is the one place this shape applies." Widen it to name both `"dirtychange"` and `"sizechange"`, keeping the rationale (a base-class `on`/`emit` overload is unreachable on a subclass that declares its own) and the closing rule that a subclass's own events still use the full `on`/`off`/`emit` shape.
- **`packages/lib/docs/concepts/events.md:184-192`** — the same statement in user-facing form ("One exception lives directly on the base `Component` class"). Widen identically and list both pairs.
- **`packages/lib/docs/components/ProgressSpinner.md`** — the *Overlay* bullet ([:6-9](packages/lib/docs/components/ProgressSpinner.md#L6)) and the `showOverlay(target)` row of the *Common methods* table ([:48](packages/lib/docs/components/ProgressSpinner.md#L48)) gain one clause: the overlay follows the target's size until `hideOverlay()`.
- **`packages/lib/docs/reference/changelog/next.md`** — an *Added → Core* entry for `Component.onSizeChange` / `offSizeChange`, and a *Removed* entry for `Slider`'s `showTicks` option and its two accessors. Match the existing entries' bold-lead-sentence style.
- **`packages/lib/docs/reference/migration/next.md`** — one breaking-change note for the `showTicks` removal: the option and both accessors were inert (nothing ever rendered ticks), so a consumer passing it should simply drop it.
- `packages/lib/llms.txt` needs no change: it indexes classes, not members, and no class is added or removed.

---

## Potential Challenges

- **A listener that re-enters the setter it fired from** would recurse. The spinner's does not — it writes only to itself and its arc — but the `notifySizeChange` JSDoc must say listeners are called mid-commit, so a listener that resizes its own host is the caller's bug.
- **`registerListenerBag` is `protected`**, so the lazy creation must happen inside `Component`, not at the call site. It is, in `onSizeChange`.
- **The spinner's teardown order**: `hideOverlay` must read `_overlayTarget` before nulling it. Getting that backwards leaves a listener registered forever and shows up only as a leak, not a failure.
- **`DiagramView`'s spinner targets the view itself**, so the view fires its own relay into a spinner appended inside its own element. That is fine — the spinner is not in the view's laid-out set, so no layout recursion results — but do not "simplify" it by making the spinner a child of the view.
- **The `Slider` test helper pauses the private children** to stop them re-queuing layouts. After this change they never queue one, so a future reader may think the helper is dead. Step 10 corrects its comment rather than deleting the calls.

---

## Critical Files

| File | Why |
|---|---|
| [packages/lib/src/typescript/lib/core/Component.ts:2496-2548](packages/lib/src/typescript/lib/core/Component.ts#L2496) | `onDirtyChange` / `offDirtyChange` / `_fireDirtyChangeIfFlipped` — the precedent this relay mirrors, including why it is not routed through `emit`. |
| [packages/lib/src/typescript/lib/core/Component.ts:3953-4360](packages/lib/src/typescript/lib/core/Component.ts#L3953) | `setSize`, `writeBounds`, `setWidth`, `setHeight`, `setX`, `setY` — which setters guard, which schedule, and what `writeHorizontalGeometry` derives. |
| [packages/lib/src/typescript/lib/layout/LayoutManager.ts:570-593](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L570) | `commitBounds` — the framework's own child-placement writer, and the order the three components are being brought in line with. |
| [packages/lib/src/typescript/lib/layout/Absolute.ts](packages/lib/src/typescript/lib/layout/Absolute.ts) | The default layout manager. Its `doLayout` re-commits each laid-out child at `preferredSize ?? size`, which is why `ProgressBar`'s `super.doLayout()` already recurses into the track and the dropped `scheduleLayout` is redundant. |
| [packages/lib/src/typescript/lib/component/diagram/DiagramView.ts:786-816](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L786) | `syncBusyIndicator` — the only consumer that lays the overlay out by hand, and the comment step 6 corrects. |
| [packages/lib/tests/component/diagram/DiagramView.test.ts:3109-3235](packages/lib/tests/component/diagram/DiagramView.test.ts#L3109) | Fourteen `isOverlay()` assertions across show / hide / dispose / unsized-view paths — the contract the spinner must not disturb. |
| [packages/lib/tests/component/tree/ResizeLayoutEconomy.test.ts:28-70](packages/lib/tests/component/tree/ResizeLayoutEconomy.test.ts#L28) | The frame-capture harness the spinner probe copies. |
| [ARCHITECTURE.md](ARCHITECTURE.md) *Event handling* | The rule this plan widens, and the reason the relay is an `onX`/`offX` pair rather than `on("sizechange", …)`. |

---

## Non-Goals

- **The same-value guard on `Component.setSize`** and the fourteen other typed setters — owned by `component-setter-guards`, which depends on this plan.
- **Moving `Slider`'s drag onto a promoted layer** (`setWillChange` + `setTranslate` instead of `left`/`top`) — a separate continuous-motion group; this plan does not touch `Slider`'s drag path at all.
- **The empty-`InlineStyle`-flush floor.** One content-free `apply` per component survives a settled pass. It is a `Component`/`InlineStyle` issue, not a progress-indicator one, which is why the probes assert on patch content rather than on an `apply` count.
- **Making the overlay a real child of its target.** It would put the spinner in the target's laid-out set and hand its geometry to whatever layout manager the target happens to use.
- **A `ResizeObserver` seam on `DOMSource`.** No such seam exists, and adding one would put a relay the framework can compute itself behind an engine callback the offline test DOM cannot drive.

---

## Notes

[^relay-not-poll]: Guarding the overlay's `setSize` on a changed box — the minimal edit the review floated — stops the loop *and* stops the tracking, in one move. The loop is the only thing that currently resizes the overlay with its target: the spinner is mounted by a raw `DOM.sink.appendChild` and is in no parent's laid-out set, so once its own `doLayout` stops re-arming a frame, nothing ever calls it again. A guard with no relay would leave the overlay frozen at the size it had when the load started, and no existing test would notice — `ProgressSpinner.test.ts` covers construction and the visibility pause only, and the `DiagramView` suite asserts `isOverlay()`, never geometry. The relay has to land in the same change.

[^mirror-dirtychange]: Four alternatives were considered and rejected. **(a) Sizing the overlay in CSS** (`width: 100%` / `height: 100%` on an absolutely positioned child, with the arc centred by `inset: 0; margin: auto`) needs no JavaScript at all and would be the cheapest at runtime — but it makes `spinner.getWidth()` lie, fights `replayGeometryStyles`, which writes `width` back from the cached `_width` on every re-render, and cannot be tested: the offline DOM models no CSS layout, so "the overlay still resizes when the target changes width" would become unverifiable. **(b) A `ResizeObserver` behind a new `DOMSource` seam** has the same testability problem plus a new engine dependency for a quantity the framework already knows. **(c) Re-arming `Component.afterNextLayout` per pass** is the loop it replaces, one indirection further out. **(d) `addComponent`-ing the spinner into the target** hands the overlay's bounds to the target's layout manager, which for `TablePanel` means the table's — the overlay would be laid out as ordinary content. What is left is a notification on the target, and `Component` already has exactly one of those: `onDirtyChange`. Following it costs a second base-class event, which ARCHITECTURE.md's own stated rationale covers word for word.

[^double-fire]: Firing once per changed axis rather than once per commit is a deliberate simplification. A single "size settled" event would need a coalescing point that `Component` does not have — `writeBounds` is one such point, but `setSize` bypasses it, so a listener would have to handle both shapes anyway. The cost of the double fire is one extra arc-centring calculation per two-axis resize; every DOM write it could duplicate is already behind a guarded setter, so the second fire writes nothing the first did not need to.

[^ordering]: This is ordering constraint 1 in `plans/research/render-review-2026-09-15/99-synthesis.md`. `component-setter-guards` lists this plan as a dependency for exactly this reason.

[^lazy-bag]: `_dirtyListeners` is allocated eagerly for every component. The size relay deviates: it is a `null` field until someone registers, because the observers are rare — one per shown overlay — while the components are not, and a render-work review is a poor place to add an unconditional allocation per instance. The fire path pays one null check. Everything else about the shape follows the precedent, including `registerListenerBag` so a destroyed component releases its listeners.

[^per-axis]: `Slider` does not depend on the child layout pass `setSize` schedules: its `doLayout` never calls `super.doLayout()`, so the pass the removed `scheduleLayout()` used to arm only re-committed identical bounds through `Absolute`, and the slice-15 probe measured the geometry stable across ten passes with `selfSchedule = 0`. `ProgressBar` does not depend on it either, for the opposite reason: its `doLayout` ends with `super.doLayout()`, whose `Absolute` manager calls `commitBounds` on the track, which calls the track's own `doLayout()` unconditionally — the scheduled pass was a second, redundant root for work the same frame had already done.

[^thumb-stays]: The review proposed moving the thumb's constant size to the constructor, since `THUMB_SIZE` never varies. Left in `doLayout` instead: `setWidth` / `setHeight` are guarded, so the repeat cost is already zero, and splitting one of three children's sizing away from the other two makes `doLayout` no longer the single answer to "where is this child placed". The two lines move below the thumb's `setX` / `setY` only so each child reads position-then-extent, matching `commitBounds` — which also avoids the first pass deriving a rounded width from a not-yet-assigned `left`.

[^fill-origin]: The review also proposed hoisting `_fill.setX(0)` / `setY(0)` to the constructor as permanent constants. Same reasoning as the thumb: both are already guarded no-ops after the first pass, and the fill's origin belongs beside the fill's extent.

[^showticks]: `Slider.showTicks` is dead surface: nothing reads `_options.showTicks` outside its own getter, `doLayout` renders no ticks, the JSDoc admits the field is reserved for a follow-up, and a grep across the library, the docs app, `create-app`, the test suite and the Loom consumer finds only the definitions themselves. The synthesis assigns it to this group rather than to the general dead-surface sweep, on the rule that a deletion rides with whichever group is already editing that file. It is the one item here that is not a performance change, and **it must land as its own commit** rather than riding inside the relay commit — user policy, 2026-09-17: pre-1.0.0, public API with no callers anywhere is deleted rather than deprecated, but always in a separate commit so the break stays visible in history and revertible on its own. That makes this branch's code bucket two commits: the resize relay and guarded child writes, then the `showTicks` deletion with its changelog and migration notes.

[^stale-anchors]: Two claims in the 2026-09-15 review no longer hold and were corrected while drafting. `ProgressBar.doLayout` is at `:178-209`, not `:499-530` — the file is 233 lines now. And `tests/component/display/ProgressSpinner.test.ts` does **not** pin `isOverlay()` or any overlay geometry: it is 76 lines covering construction, `setSpinnerSize`, and the effective-visibility animation pause. Every `isOverlay()` assertion lives in the `DiagramView` suite, and no test anywhere asserts the overlay's width or height — which is precisely why breaking overlay resizing would be silent.

---

## Implementation Notes

Deviations from the plan as written, and the reasons for each.

- **One file outside the plan's table had to change:
  `packages/lib/tests/component/dispose-full-teardown.test.ts`.** Step 5's new
  `ProgressSpinner.destructor()` trips that suite's coverage assertion, which
  scans the library for `protected destructor()` declarations and fails any
  class no registry row `covers` and no baseline entry names. A row was added
  (`{ name: 'ProgressSpinner', covers: ['ProgressSpinner'], make: () => new
  ProgressSpinner(20) }`) rather than an entry in
  `UNCLAIMED_DESTRUCTOR_CLASSES`, per that file's own rule that the baseline is
  shrink-only and takes deliberate deferrals only. The row passes: the spinner
  and its arc are both destroyed, and it leaks no rule-cache key.

- **The changelog removal entry went under `## Breaking changes`, not a
  `## Removed` heading.** *Documentation Impact* asked for a "Removed" entry,
  but this repo's changelog has no such section: every prior removal (see
  `changelog/0.9.0.md`) lives under `## Breaking changes` with a per-area `###`
  subheading and a "See [Migration]" pointer. The entry follows that precedent,
  and `next.md` gained its first `## Breaking changes` section, placed above
  `## Changed` in the same order `0.9.0.md` uses.

- **Behaviour 18's compile-error half is pinned by the typecheck, not by a
  unit test.** `new Slider({ showTicks: true })` can only be asserted at
  compile time, and the test suite has no `@ts-expect-error` precedent to
  follow, so introducing one was out of scope. It is covered by
  `npm run typecheck` / `typecheck:test` plus *Verification*'s zero-hit grep;
  a runtime test in the `Slider` suite covers the other half, that
  `isShowTicks` / `setShowTicks` no longer exist on an instance.

- **The `showTicks` changelog and migration notes landed in their own
  documentation commit, immediately after the deletion's code commit**, rather
  than inside it. The `[^showticks]` footnote's requirement — that the deletion
  be its own commit, separate from the performance work, so the break stays
  visible and revertible — is met; folding docs into a code commit would break
  the `commit` skill's bucket rule, which the repo's `CLAUDE.md` makes binding.

- **The spinner suite's frame capture is installed file-wide and drained after
  every test.** A capture scoped to the relay's own `describe` left
  behaviour 10's probe vacuous — it passed against the *unfixed* code, because
  `Component`'s layout-flush rAF handle is module-level and an earlier test in
  the file had left it armed against the harness's inert recorder, so nothing
  in the probe ever scheduled a frame at all. With the file-wide capture and an
  `afterEach` drain, the probe reports `[1, 1, 1, 1, 1]` before the change and
  `[0, 0, 0, 0, 0]` after, which is the relation the plan describes.

- **`npm run docs:api` finishes with the repo's 14 pre-existing warnings, not
  zero** (`SpatialNavigation`, `MarkdownViewer`, `MarkdownEditor`,
  `FieldDecorator`). *Verification* step 7 asks for zero; this branch
  introduces none, and chasing the pre-existing ones is another plan's work.
  The constraint that step exists for — a public symbol's JSDoc may only
  `{@link}` public symbols — is met: `onSizeChange` / `offSizeChange` link only
  to each other, and `notifySizeChange` and the `ListenerBag` are described in
  prose.

- **`Verification` step 6's grep cannot reach zero as literally written, and
  the substantive half of it does.** That step (and step 9's checkpoint) asks
  for zero `showTicks` hits across `packages/lib/src`, `packages/lib/tests`,
  `packages/lib/docs` and `packages/docs/src`, while the same plan's
  *Documentation Impact* requires a migration note naming `showTicks` and the
  changelog entry that points at it. The two cannot both hold. `packages/lib/src`
  and `packages/docs/src` are at zero, which is the half that matters — the
  surface is gone. The remaining hits are the ones the plan itself asked for:
  the migration note, the changelog entry, and the `Slider` test that pins the
  accessors' absence.

- **No new demo was added** (Work Instructions step 7). The relay changes how
  an existing surface behaves rather than adding one, and the demo the plan's
  manual checks use — *Overlay spinner on this panel for 2 s* in `MiscPanel` —
  already exercises it.

Manual checks 19-21 were run against `npm run dev` in a real browser.
19: with the overlay held up across two window resizes (2545x1891 → 1100x789 →
1640x569), the backdrop stayed exactly flush with its panel on both axes and
the arc stayed centred. 20: the animated bar's fill tracked
`round(300 x value / 100)` at every sampled value, the indeterminate fill sat
at 75px with its keyframe running, and the inline spinner rendered at 19x19
with its rotation running. 21: a pointer drag moved the thumb and filled the
active track monotonically and settled on pointerup. No console errors or
warnings in any of the three.

One flake was seen and could not be attributed. Across nine full `npm test`
runs, one produced an unhandled rejection in
`packages/lib/tests/component/table/ColumnFilterRow.test.ts` — a file this
branch does not touch — from a real-`requestAnimationFrame` flush landing after
`DOM.reset()`, the class of flake `ProgressBar.test.ts:15-21` already documents.
No mechanism connects it to this change: nothing on the table path registers a
size listener, so `notifySizeChange` is a null check there. Recorded rather than
dismissed, in case it recurs.
