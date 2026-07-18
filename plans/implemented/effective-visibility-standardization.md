# Effective-Visibility Standardization — Implementation Plan

## Overview

Two just-merged fixes left the framework with an ad-hoc "is this component on
screen" primitive and a per-frame poll:
`Component.isEffectivelyVisible()` ([Component.ts:1599](src/typescript/lib/core/Component.ts#L1599))
is `protected` and was added only for the canvas fix, and `Canvas` /
`WebGLCanvas` detect their own hiding by **polling** `isEffectivelyVisible()`
inside their rAF tick and reconciling in `doLayout`
([Canvas.ts:307](src/typescript/lib/component/display/Canvas.ts#L307),
[Canvas.ts:342](src/typescript/lib/component/display/Canvas.ts#L342)) because
no change signal exists.

This plan standardizes "not on screen" detection and reaction around **one
central mechanism in `Component`**: promote `isEffectivelyVisible()` to a stable
public query; add a coalesced *effective-visibility reconcile* that
`setVisible` / `setDisplayed` schedule (mirroring the rAF-coalesced layout queue
at [Component.ts:152](src/typescript/lib/core/Component.ts#L152)); fan the change
down the subtree through a recursive walk (mirroring the recursive
`destructor()` at [Component.ts:649](src/typescript/lib/core/Component.ts#L649))
that fires a protected `onEffectiveVisibilityChange` hook and, per node, pauses
that node's CSS animation via `animation-play-state`. `Canvas` / `WebGLCanvas`
then react to the hook instead of polling. Because `Tab`
([Tab.ts:1581](src/typescript/lib/layout/Tab.ts#L1581),
[Tab.ts:1700](src/typescript/lib/layout/Tab.ts#L1700)) and `Card`
([Card.ts:213](src/typescript/lib/layout/Card.ts#L213)) already hide/show panels
through `setVisible`, the central trigger reaches them **with no changes to
`Tab.ts` or `Card.ts`**. A companion fix makes `Component.setVisible` **idempotent**
(mirroring the guard `setDisplayed` already has), so `Tab.doLayout`'s unconditional
per-pass `setVisible(false)`/`setVisible(true)` on every panel — even on resizes
where the active tab is unchanged — no longer generates redundant CSS writes or
reconcile enqueues at the source.

There is currently **no** `animation-play-state` anywhere in the library
(verified: `grep -rn 'animation-play-state\|animationPlayState' src/` → empty),
so an animating `ProgressSpinner` ([ProgressSpinner.ts:86](src/typescript/lib/component/display/ProgressSpinner.ts#L86))
on an inactive tab keeps spinning — this plan stops it.

---

## Architecture Decisions

### A lifecycle-hook subtree walk, not a custom `on`/`off` event

Effective-visibility change is **inherited** (hiding an ancestor hides the whole
subtree) and must reach every descendant. The framework's custom-event surface
(`on`/`off`/`emit` + `ListenerBag`, per [ARCHITECTURE.md](ARCHITECTURE.md) §Event
handling) fires only to listeners registered on the emitting component — it has
**no subtree fan-out** — and `Event.addSubtreeListener` is reserved for *real DOM
events* routed through the window capture handler, which this is not. The exact
precedent for "deliver a framework-internal lifecycle signal to a whole subtree"
is the recursive `destructor()` ([Component.ts:649](src/typescript/lib/core/Component.ts#L649)),
which walks `getComponents()` invoking a protected method on each node. This plan
mirrors that: a recursive `propagateEffectiveVisibility` walk invoking a
protected `onEffectiveVisibilityChange` override hook (like `doLayout` /
`destructor`, not a consumer pub-sub event).

### `setVisible` / `setDisplayed` are the central trigger; coalesce on rAF

Effective visibility of any node changes only when some node's own
`isVisible()` / `isDisplayed()` changes — i.e. through `setVisible` /
`setDisplayed`. Making those the single trigger covers `Tab`, `Card`, and direct
application use uniformly, so **`Tab.ts` and `Card.ts` need no changes**. The one
hazard is `Tab.doLayout`, which **unconditionally** sets *every* panel
`setVisible(false)` then the active one `setVisible(true)` on **every** layout pass
([Tab.ts:1580](src/typescript/lib/layout/Tab.ts#L1580)–1583, 1700), even on resizes
where the selected tab is unchanged — a synchronous reconcile there would walk the
active subtree twice per pass, and even a bare enqueue would add every panel to the
pending set each pass.

Two **complementary** mitigations, in order:

1. **Idempotency guard at the source (see next decision).** The new `setVisible`
   early-return means each *inactive* panel's redundant `setVisible(false)`
   short-circuits at O(1) **before** the reconcile enqueue is reached, so the N−1
   inactive panels never enter the pending set at all.
2. **rAF coalescing (still required).** The guard does **not** cover the *active*
   panel, whose `setVisible(false)`@1581 then `setVisible(true)`@1700 are both real
   state changes within one pass and both write + enqueue. `setVisible` /
   `setDisplayed` add the node to a module-level pending set and schedule one rAF
   flush, exactly like `scheduleLayout` → `flushPendingLayouts`
   ([Component.ts:152](src/typescript/lib/core/Component.ts#L152)–199); the flush
   recomputes each queued root's *net* effective visibility once, collapsing the
   active panel's two enqueues into a single reconcile.

Coalescing is therefore **no longer the only mitigation** for the every-pass
toggling: the guard removes the inactive panels entirely, and coalescing absorbs
only the active panel's single intra-pass churn.

### Make `setVisible` idempotent, mirroring `setDisplayed`

`setDisplayed` ([Component.ts:1557](src/typescript/lib/core/Component.ts#L1557))
already guards `if (this._options.displayed === v && this.getElement()) return this;`.
`setVisible` ([Component.ts:1479](src/typescript/lib/core/Component.ts#L1479)) has
**no** such guard — it always writes `setElementCSSRule("visibility", …)`. Add the
mirror guard.

`setVisible` is **tri-state**: it normalizes `value` to a boolean, to `undefined`
for a falsy non-boolean (inherit), or **throws** for a truthy non-boolean. The
guard must therefore compute the *normalized* target **first**, then early-return
only when `this._options.visible === normalized` **and** `this.getElement()` exists
— exactly `setDisplayed`'s shape, but on the normalized tri-state value rather than
a plain `!!value`. A **detached** component (no element) deliberately does *not*
early-return: it falls through, records the intended value in `_options.visible`,
and returns at the existing `if (!element) return this;` guard — so the intended
state is never lost.

**Why skipping the live write is safe.** The value persists in `_options.visible`,
and `applyStyle` → `applyBoxAndVisibilityStyles`
([Component.ts:4119](src/typescript/lib/core/Component.ts#L4119)) replays visibility
from `isVisible()` on every re-materialisation — so skipping a redundant write
never loses state. This is the same reasoning behind `setDisplayed`'s existing
guard and the same idempotency idiom as the `Text.setLineHeight` relayout-loop fix
(project memory): an unchanged-value early return.

**Why the source, not `Tab.doLayout`.** Fixing it in `setVisible` neutralises the
redundant writes for **all** callers (every inactive Tab panel short-circuits O(1)
each pass), not just `Tab`. It is chosen over restructuring `Tab.doLayout` to move
visibility into `setActiveTabIndex`: the guard is more surgical, general,
precedented (`setDisplayed`), and far lower regression risk. It does **not** change
`Tab`'s authority — `Tab`'s `setVisible(false)` still fires whenever a panel is
*actually* visible; only the redundant repeats are dropped.

**Interaction with the effective-visibility trigger.** The
`scheduleEffectiveVisibilityReconcile()` enqueue this plan adds to `setVisible` /
`setDisplayed` sits at the method **tail, after** the new idempotency guard — so a
no-op `setVisible` schedules **no** subtree walk and enqueues **nothing**. This is
*complementary* to the rAF coalescing above, not a replacement: the guard removes
the N−1 inactive panels before they enqueue, while coalescing still collapses the
active panel's single intra-pass false→true churn (both writes at 1581 and 1700 are
real state changes and both fire).

### Edge-triggered walk with per-node short-circuit

Each node caches `_lastEffectiveVisible`; the walk fires the hook and recurses
**only when a node's effective value actually changed**. This is load-bearing for
two reasons: (1) it eliminates the residual churn — a queued-but-unchanged root
(the active panel re-hidden-then-shown) short-circuits at O(1) with no subtree
traversal; (2) it correctly handles the **nested-hidden edge case**: because any
*independent* descendant change is separately enqueued through its own
`setVisible`, an unchanged root can safely skip recursion, and a locally-hidden
descendant reached during an ancestor's show computes `childEffective = false`,
matches its cached `false`, and short-circuits — so it is **never reported
"shown"** when an ancestor shows. The unchanged-value early return mirrors the
`setDisplayed` dedupe ([Component.ts:1557](src/typescript/lib/core/Component.ts#L1557))
and the relayout-loop fix recorded in project memory.

### Pause CSS animations per node via `animation-play-state`, not a subtree class or `content-visibility`

`visibility: hidden` (how `Tab`/`Card` hide) does **not** stop CSS keyframe
animations per spec, so the pause needs an explicit mechanism.

- **Rejected — one shared class `.paused, .paused * { animation-play-state: paused }`
  on the subtree root.** `animation-play-state` does not inherit, so this needs a
  descendant (`*`) selector, and component animations live on per-instance `#uuid`
  rules (specificity `1,0,0`, e.g. `ProgressSpinner`'s arc via `setAnimation` →
  `setElementCSSRule("animation", …)` → the `#uuid` rule). A shared class/descendant
  selector (specificity ≤ `0,1,0`) loses to `#uuid`, so it would require
  `!important` — and the DOM seam cannot express `!important`:
  `writeDeclaration` ([DOM.ts:295](src/typescript/lib/core/DOM.ts#L295)) uses a
  plain indexed assignment / two-arg `setProperty` with no priority. Extending the
  seam for one rule is disproportionate.
- **Rejected — `content-visibility: hidden`.** Skips layout+paint+animation but
  collapses the subtree's layout slot (needs `contain-intrinsic-size`), which
  conflicts with `Tab` keeping the slot for instant switching and with the
  framework's absolute-positioning/measurement assumptions.
- **Chosen — per-node `animation-play-state` on each node's own `#uuid` rule.**
  The subtree walk already visits every descendant `Component` (including internal
  children like `ProgressSpinner._arc`), so each node pauses *itself* by writing
  `animation-play-state: paused` on the **same `#uuid` rule** that carries its
  `animation` shorthand. Same specificity → the longhand set after the shorthand
  wins, with **no `!important` and no descendant selector**. It leaves layout,
  `display`, and CSS **transitions** untouched (a tab-switch fade is a transition,
  unaffected by `animation-play-state`), so the wanted transitions and the
  instant-switch slot both survive. `applyStyle`
  ([Component.ts:4083](src/typescript/lib/core/Component.ts#L4083)) does **not**
  clear the `#uuid` rule (it only wipes the inline `style` attribute) and does not
  re-write `animation` — exactly as it already leaves the `animation` shorthand
  alone — so a paused state survives a theme toggle. The base hook gates the write
  on `getAnimation() !== null` so the thousands of non-animated components that get
  hidden pay nothing.

### `isEffectivelyVisible()` promoted to public

It becomes the canonical "is this component actually on screen right now" query.
Name and body are unchanged (ancestor walk over `isVisible() !== false &&
isDisplayed()`); only visibility widens from `protected` to `public`. The new
`onEffectiveVisibilityChange` hook stays `protected` (a subclass override point
like `doLayout`), so it must be referenced in prose, never `{@link}`-ed, from any
public JSDoc (per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)).

### A synchronous flush escape hatch (for tests and immediate reconcile)

The offline `RecordingDOMSink.requestAnimationFrame`
([TestDOM.ts:493](tests/dom/TestDOM.ts#L493)) records the op but **drops the
callback**, so a coalesced rAF flush never runs under test. Mirroring
`flushLayout()` ([Component.ts:4930](src/typescript/lib/core/Component.ts#L4930)),
add a static `Component.flushEffectiveVisibility()` that drains the pending set
synchronously. Tests (and any caller needing an immediate reconcile) call it.

---

## Public API

```typescript
// Component.ts — visibility widened protected → public; body unchanged.
public isEffectivelyVisible(): boolean;

// Protected override hook — fired once per node whose effective visibility
// changed, edge-triggered. Base pauses/resumes this node's own CSS animation.
// Overridden by Canvas / WebGLCanvas (and the documented future extension
// points Video / VideoPlayer / Notification).
protected onEffectiveVisibilityChange(effective: boolean): void;

// Recursive subtree walk. PUBLIC + @internal (like doLayout, it is called by a
// module-level flush function; consumers use the override hook, not this).
public propagateEffectiveVisibility(effective: boolean): void;

// Typed setter for the per-node CSS pause (framework-managed; NOT on the options
// bag). Backing field `_animationPlayState`.
protected setAnimationPlayState(value: string | null): this;
public    getAnimationPlayState(): string | null;

// Static synchronous drain of the coalesced queue (parallels flushLayout()).
public static flushEffectiveVisibility(): void;
```

`setVisible` — **signature unchanged** (`setVisible(value: boolean | null): this`).
New semantics only: it now early-returns without writing when the normalized target
equals the current `_options.visible` and the element exists (idempotent, mirroring
`setDisplayed`). A no-op call therefore performs no `setElementCSSRule("visibility", …)`
and schedules no effective-visibility reconcile.

New private state on `Component`:

```typescript
// Edge-trigger cache; null = not yet evaluated. Plain initializer: only
// propagateEffectiveVisibility (post-render) writes it, never a cascade setter.
private _lastEffectiveVisible: boolean | null = null;

// Cache for setAnimationPlayState. Plain initializer for the same reason.
private _animationPlayState: string | null = null;
```

New module-level state in `Component.ts` (sibling to `pendingLayouts`):

```typescript
let pendingVisibility: Set<Component> = new Set();
let visibilityRafHandle: number | null = null;

function ensureVisibilityFlushScheduled(): void {
    if (visibilityRafHandle === null) {
        visibilityRafHandle = DOM.sink.requestAnimationFrame(flushPendingVisibility);
    }
}

function flushPendingVisibility(): void {
    visibilityRafHandle = null;
    const dirty = Array.from(pendingVisibility);
    pendingVisibility.clear();
    for (const c of dirty) {
        if (!c.getElement()) continue;                 // skip disposed / never-rendered
        c.propagateEffectiveVisibility(c.isEffectivelyVisible());
    }
}
```

---

## Internal Structure

**The walk (edge-triggered + short-circuit):**

```typescript
public propagateEffectiveVisibility(effective: boolean): void {
    if (effective === this._lastEffectiveVisible) {
        return; // unchanged: descendants inherit no change; any independent
                // descendant change is separately queued via its own setVisible.
    }
    this._lastEffectiveVisible = effective;
    this.onEffectiveVisibilityChange(effective);

    for (const child of this.getComponents()) {
        const childEffective =
            effective && child.isVisible() !== false && child.isDisplayed();
        child.propagateEffectiveVisibility(childEffective);
    }
}
```

**Base hook (per-node CSS pause), overridden by the canvases:**

```typescript
protected onEffectiveVisibilityChange(effective: boolean): void {
    if (this.getAnimation() !== null) {
        this.setAnimationPlayState(effective ? null : "paused");
    }
}
```

**The setter (obeys the three DOM-write rules — typed, cached, off the options
bag because it is framework-managed):**

```typescript
protected setAnimationPlayState(value: string | null): this {
    this._animationPlayState = value;
    this.setElementCSSRule("animationPlayState", value);
    return this;
}
public getAnimationPlayState(): string | null {
    return this._animationPlayState;
}
```

**Idempotent `setVisible` guard (normalize first, then compare — mirrors
`setDisplayed`; the reconcile enqueue lands at the tail, *after* this guard):**

```typescript
setVisible(value: boolean | null): this {
    // Normalize to the tri-state target first (same branch logic as before) so
    // the guard can compare against it.
    let normalized: boolean | undefined;
    if (Type.isBoolean(value as unknown as object)) {
        normalized = value as boolean;
    } else if (!value) {
        normalized = undefined;
    } else {
        throw new Error("Argument is not a boolean.");
    }

    // Idempotent short-circuit, mirroring setDisplayed: skip the redundant CSS
    // write + reconcile enqueue when the normalized value is unchanged and the
    // element exists. A detached component (no element) falls through to record
    // the value at the existing `if (!element) return this;` guard below.
    if (this._options.visible === normalized && this.getElement()) {
        return this;
    }

    this._options.visible = normalized;

    let element = this.getElement();
    if (!element) {
        return this;
    }
    // … existing visibility rule write (unchanged) …
    this.scheduleEffectiveVisibilityReconcile();   // tail — after the guard
    return this;
}
```

**The private schedule call and the static drain:**

```typescript
private scheduleEffectiveVisibilityReconcile(): void {
    pendingVisibility.add(this);
    ensureVisibilityFlushScheduled();
}

public static flushEffectiveVisibility(): void {
    if (visibilityRafHandle !== null) {
        DOM.sink.cancelAnimationFrame(visibilityRafHandle);
        visibilityRafHandle = null;
    }
    flushPendingVisibility();
}
```

`setVisible` / `setDisplayed` call `this.scheduleEffectiveVisibilityReconcile()`
at their tail — **after** both the new idempotency guard (so a no-op call enqueues
nothing) and the existing `if (!element) return this` guard (so nothing is
scheduled during the construction cascade).

**Canvas retrofit** — remove the poll, react to the hook:

```typescript
// doLayout: drop `this.reconcileAnimation();` (keep super().doLayout() + syncBackingStore()).

// animationStep: guard on intent only — no per-frame isEffectivelyVisible().
private readonly animationStep = (): void => {
    if (!this._animationRequested) { this._rafId = null; return; }
    this.redraw();               // renderFrame() in WebGLCanvas
    this._rafId = DOM.sink.requestAnimationFrame(this.animationStep);
};

// New override: pause/resume the loop on the event.
protected onEffectiveVisibilityChange(effective: boolean): void {
    super.onEffectiveVisibilityChange(effective);
    this.reconcileAnimation();
}
```

`shouldAnimate()` (which gates on `isEffectivelyVisible()`) is **unchanged** and
remains the authoritative gate inside `reconcileAnimation`; it is now consulted on
events + setter calls, not once per frame. `startAnimation` / `stopAnimation` /
`setAnimateWhenHidden` are unchanged.

---

## Ordered Implementation Steps

1. **Component.ts — module state.** Below the `pendingLayouts` block
   ([Component.ts:152](src/typescript/lib/core/Component.ts#L152)–163), add
   `pendingVisibility`, `visibilityRafHandle`, `ensureVisibilityFlushScheduled`,
   and `flushPendingVisibility` (see *Public API*). → verify: `npx tsc --noEmit`.
2. **Component.ts — private fields.** Add `_lastEffectiveVisible` and
   `_animationPlayState` near the other runtime fields (~line 336, beside
   `_animation`). Plain initializers (documented: never cascade-written).
3. **Component.ts — promote `isEffectivelyVisible`.** Change `protected` → `public`
   at [Component.ts:1599](src/typescript/lib/core/Component.ts#L1599); update its
   JSDoc to describe the public "on-screen" contract in **prose** (do not
   `{@link}` the protected hook). → verify: `grep -n 'isEffectivelyVisible' src/typescript/lib/core/Component.ts`.
4. **Component.ts — the setter/getter.** Add `setAnimationPlayState` (protected) and
   `getAnimationPlayState` (public) beside `setAnimation`/`getAnimation`
   ([Component.ts:3637](src/typescript/lib/core/Component.ts#L3637)–3673).
5. **Component.ts — the hook + walk.** Add `onEffectiveVisibilityChange`
   (protected), `propagateEffectiveVisibility` (public, `@internal`), and
   `scheduleEffectiveVisibilityReconcile` (private). Place them near
   `isEffectivelyVisible`.
6. **Component.ts — static drain.** Add `static flushEffectiveVisibility()` beside
   `flushLayout` ([Component.ts:4930](src/typescript/lib/core/Component.ts#L4930)).
7. **Component.ts — idempotent `setVisible` guard.** In `setVisible`
   ([Component.ts:1479](src/typescript/lib/core/Component.ts#L1479)), normalize
   `value` to the tri-state target **first** (boolean → itself; falsy non-boolean →
   `undefined`; truthy non-boolean → throw), then add
   `if (this._options.visible === normalized && this.getElement()) return this;`
   **before** assigning `_options.visible` — mirroring `setDisplayed`'s guard
   ([Component.ts:1557](src/typescript/lib/core/Component.ts#L1557)). A detached
   component (no element) still falls through and records the value at the existing
   `if (!element) return this;`. → verify: `npx tsc --noEmit`.
8. **Component.ts — wire the trigger.** In `setVisible`
   ([Component.ts:1479](src/typescript/lib/core/Component.ts#L1479)) and
   `setDisplayed` ([Component.ts:1555](src/typescript/lib/core/Component.ts#L1555)),
   add `this.scheduleEffectiveVisibilityReconcile();` immediately before the final
   `return this;` — i.e. **after** both the new idempotency guard (step 7) and the
   `if (!element) return this;` guard, so a no-op call enqueues nothing and the
   construction cascade schedules nothing. → verify: `npx tsc --noEmit`.
9. **Canvas.ts — retrofit.** Remove `this.reconcileAnimation();` from `doLayout`
   ([Canvas.ts:310](src/typescript/lib/component/display/Canvas.ts#L310)); change
   `animationStep` ([Canvas.ts:374](src/typescript/lib/component/display/Canvas.ts#L374))
   to guard on `this._animationRequested` only; add the `onEffectiveVisibilityChange`
   override. Leave `shouldAnimate`, `reconcileAnimation`, `startAnimation`,
   `stopAnimation`, `setAnimateWhenHidden`, `destructor` unchanged.
10. **WebGLCanvas.ts — retrofit.** Same three edits: remove the `doLayout`
   reconcile ([WebGLCanvas.ts:355](src/typescript/lib/component/display/WebGLCanvas.ts#L355)),
   simplify `animationStep` ([WebGLCanvas.ts:432](src/typescript/lib/component/display/WebGLCanvas.ts#L432))
   to `renderFrame()`, add the override. The `onFirstLayout(() => this.startAnimation())`
   at [WebGLCanvas.ts:381](src/typescript/lib/component/display/WebGLCanvas.ts#L381)
   stays. → verify: `npx tsc --noEmit`.
11. **Regression grep.** `grep -rn 'reconcileAnimation' src/` → expect only inside
    `Canvas.ts` / `WebGLCanvas.ts` (`startAnimation`, `stopAnimation`,
    `setAnimateWhenHidden`, `onEffectiveVisibilityChange`); **not** in any
    `doLayout`.
12. **Tests** (test-first where practical): update the two canvas suites and add
    the new Component / ProgressSpinner / Tab / Card coverage below, including the
    idempotent-`setVisible` cases (13–15 in *Expected Behaviour*).
13. `npm test`, then `npm run docs:build` (zero warnings).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/Component.ts` |
| Modify | `src/typescript/lib/component/display/Canvas.ts` |
| Modify | `src/typescript/lib/component/display/WebGLCanvas.ts` |
| Modify | `tests/component/display/Canvas.test.ts` |
| Modify | `tests/component/display/WebGLCanvas.test.ts` |
| Create | `tests/component/EffectiveVisibility.test.ts` |
| Modify | `tests/component/display/ProgressSpinner.test.ts` |
| Modify | `tests/component/layout/Card.test.ts` |
| Modify | `tests/component/layout/Tab.lifecycle.test.ts` |

`Tab.ts` and `Card.ts` are **intentionally not modified** — they already hide/show
panels through `Component.setVisible`, which now schedules the reconcile.

---

## Expected Behaviour

Unit-testable via the offline harness (drive `setVisible`/`setDisplayed`, then
`Component.flushEffectiveVisibility()`, then assert):

1. **Public query.** `isEffectivelyVisible()` is callable on a plain `Component`
   and returns `false` when the component or any ancestor has `isVisible() ===
   false` or `!isDisplayed()`; `true` otherwise. *(unit)*
2. **Per-node CSS pause on hide.** A component with an `animation` (via
   `setAnimation`) whose subtree root is `setVisible(false)` has, after the flush,
   `getAnimationPlayState() === "paused"` and a recorded `setRuleStyle`
   `animationPlayState=paused`; `setVisible(true)` + flush clears it to `null`. A
   descendant animation (e.g. `ProgressSpinner._arc`) is paused too. *(unit)*
3. **Non-animated components pay nothing.** A hidden component with no `animation`
   never receives an `animationPlayState` write. *(unit)*
4. **Edge-triggered / no churn.** For a visible component, `setVisible(false)`
   then `setVisible(true)` before a single flush nets one hook call for the final
   state and produces **no** extra `requestAnimationFrame`/`cancelAnimationFrame`
   on a contained `Canvas` (the loop is not cancelled and restarted). *(unit)*
5. **Nested-hidden is not resumed.** Given `outer ⊃ inner(setVisible(false)) ⊃
   canvas`: hide `outer`, then show `outer`; after each flush the `canvas` under
   the still-locally-hidden `inner` remains paused (`isAnimating() === false`, no
   `onEffectiveVisibilityChange(true)` reaches it). *(unit)*
6. **Canvas reacts to the event.** With a started `Canvas`: `setVisible(false)` +
   flush → `isAnimating() === false` and a `cancelAnimationFrame` recorded (pause
   while running is now offline-observable); `setVisible(true)` + flush →
   `isAnimating() === true` and a new `requestAnimationFrame`. *(unit)*
7. **Ancestor hide pauses a descendant Canvas.** `container.setVisible(false)` +
   flush pauses a started `Canvas` child. *(unit)*
8. **`doLayout` no longer reconciles.** After `setVisible(true)`, calling
   `canvas.doLayout()` alone does **not** resume the loop; only the flush does.
   *(unit — replaces current Canvas P5)*
9. **`animateWhenHidden` opt-out.** A `Canvas({ animateWhenHidden: true })` keeps
   `isAnimating() === true` after `setVisible(false)` + flush. *(unit — current P6,
   still passes)*
10. **`setDisplayed(false)` also pauses.** A started `Canvas` under `setDisplayed(false)`
    + flush is paused (`isEffectivelyVisible()` already treats `display:none` as
    hidden). *(unit)*
11. **Card switch.** `Card.setVisibleComponentId(b)` + flush pauses `a`'s subtree
    animation and resumes `b`'s. *(unit)*
12. **Tab switch.** Switching the active tab + flush pauses the outgoing panel's
    subtree animation and resumes the incoming one; an initially inactive eager
    panel's animation is paused after the first layout + flush. *(unit)*
13. **Idempotent `setVisible` — single write.** On a rendered component,
    `setVisible(false)` then `setVisible(false)` again writes the `visibility` rule
    **at most once** (assert via the `RecordingDOMSink` `setRuleStyle`/`visibility`
    write count), and enqueues **at most one** effective-visibility walk (exactly one
    net `onEffectiveVisibilityChange` after `Component.flushEffectiveVisibility()`).
    *(unit)*
14. **No-op `setVisible` fires nothing.** Calling `setVisible(v)` with the value the
    component already holds produces **no** `onEffectiveVisibilityChange` on it or
    its subtree after `flushEffectiveVisibility()` (the idempotency guard
    early-returns before the enqueue). *(unit)*
15. **Active-panel intra-pass churn nets one hook.** On a previously-hidden (incoming)
    panel, `setVisible(false)` then `setVisible(true)` before a single flush both
    write and enqueue, but the coalesced flush recomputes net effective visibility
    once, firing **exactly one** net `onEffectiveVisibilityChange(true)` for the final
    state — not one per `setVisible` call. *(unit)*

All of cases 1–15 are offline-unit-testable via `installTestDOM` + explicit
`Component.flushEffectiveVisibility()` (the harness's `requestAnimationFrame` drops
its callback, so the coalesced flush must be drained manually).

Manual / live-only (offline harness cannot tick rAF or paint):

- **Real rAF pause.** On an inactive tab, a `Canvas`/`WebGLCanvas` stops
  consuming frames — verify with the per-tab rAF-hook probe already used for the
  canvas-pause fix, and a DevTools performance capture showing no canvas frames
  while the tab is inactive.
- **ProgressSpinner CPU.** A `ProgressSpinner` on an inactive tab freezes (arc
  stops rotating; no compositor animation) — DevTools Performance shows the
  keyframe animation paused.
- **Wanted transitions survive.** The `Tab` cross-tab fade
  ([Tab.ts:1728](src/typescript/lib/layout/Tab.ts#L1728)) still plays on switch
  (transitions are unaffected by `animation-play-state`).
- **Theme toggle.** Toggling the theme while a subtree is hidden does not resume
  its paused animations (the `#uuid` rule's `animation-play-state` survives
  `applyStyle`).

---

## Verification

- `npx tsc --noEmit` — clean.
- `npm test` — all suites, including the updated canvas suites and the new
  effective-visibility / ProgressSpinner / Card / Tab coverage above.
- `grep -rn 'reconcileAnimation' src/` — present only in the canvas classes'
  animation-control methods, never in a `doLayout`.
- `grep -rn 'animationPlayState\|animation-play-state' src/` — appears only in the
  new `Component.setAnimationPlayState` and its callers.
- **Idempotency unit test** — `setVisible(false)` twice on a rendered component
  records the `visibility` CSS rule at most once (assert the `RecordingDOMSink`
  `visibility` write count), and a no-op `setVisible` (same value) fires **no**
  `onEffectiveVisibilityChange` after `Component.flushEffectiveVisibility()` (cases
  13–14).
- `npm run docs:build` — zero warnings (new public members `isEffectivelyVisible`,
  `getAnimationPlayState`, `flushEffectiveVisibility`, `propagateEffectiveVisibility`
  documented; no public JSDoc `{@link}`s the protected `onEffectiveVisibilityChange`).
- Manual: run the app (`npm run dev`, http://localhost:8015), open the Misc panel's
  tab demo, put a `ProgressSpinner` / animated `Canvas` on a non-active tab, and
  confirm via DevTools Performance that its animation/rAF is paused while inactive
  and resumes on switch, and that the tab-switch fade still plays.

---

## Documentation Impact

- New/changed public API on `Component`: `isEffectivelyVisible()` (now public),
  `getAnimationPlayState()`, `static flushEffectiveVisibility()`, and
  `propagateEffectiveVisibility()` (mark `@internal` so TypeDoc excludes it).
  `Component` is exported from the core barrel; no new export wiring is needed.
- `onEffectiveVisibilityChange` and `setAnimationPlayState` are `protected` →
  excluded from docs; describe them in prose within any public JSDoc that must
  mention the mechanism (per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md), do not
  `{@link}` them).
- If a concepts/sizing or component-lifecycle doc page enumerates the visibility
  model (`setVisible`/`setDisplayed`), add a sentence on effective visibility and
  the auto-pause; otherwise no page moves.
- Run `npm run docs:build` after the JSDoc edits — must finish with zero warnings.

---

## Potential Challenges

- **Construction-cascade safety.** `setVisible`/`setDisplayed` are dispatched from
  `applyOptions` during `super()`; the schedule call sits past the
  `if (!element) return this` guard, so it never runs before render — mirror the
  existing guard, don't move it.
- **`propagateEffectiveVisibility` must be public.** The module-level
  `flushPendingVisibility` calls it on arbitrary instances (like
  `flushPendingLayouts` calls the public `doLayout`); a `protected` walk won't
  type-check from a module function. Keep it public + `@internal`.
- **Declaration order within the `#uuid` rule.** The pause works because
  `animation-play-state` (longhand) is written *after* the `animation` shorthand on
  the same rule. If a component calls `setAnimation` again *after* being paused, the
  shorthand resets play-state to running; this self-heals on the next visibility
  toggle. Do not add an `applyStyle` replay phase for it — `applyStyle` does not
  clear the `#uuid` rule, so the paused state already persists (matching how the
  `animation` shorthand itself persists).
- **Disposed/detached roots in the queue.** The flush skips any queued root with no
  live element, so a component removed between schedule and flush is inert.
- **`setVisible` guard vs. key-presence fold.** `isVisible()` uses `"visible" in
  this._options` key-presence to fold class defaults (e.g. `AnimatedDropdown`'s
  `visible: false`), whereas the guard compares the raw `this._options.visible`
  (mirroring `setDisplayed`). The only divergent case — `setVisible(<falsy/inherit>)`
  on a component whose *class default* sets `visible` while the instance key is still
  absent — would skip recording the explicit inherit. No framework caller hits this
  (`Tab`/`Card` pass explicit `true`/`false`), so the literal `setDisplayed`-style
  comparison is kept; do **not** silently "fix" it by switching to an `isVisible()`
  comparison without a caller that needs it.

---

## Critical Files

- [src/typescript/lib/core/Component.ts](src/typescript/lib/core/Component.ts) —
  `isEffectivelyVisible` (1599), `setVisible` (1479), `setDisplayed` (1555) with its
  idempotency guard (1557) — the precedent the new `setVisible` guard mirrors —
  `isVisible` (1463), `isDisplayed` (1582), the `pendingLayouts` coalescer + flush
  (152–199) and `flushLayout` (4930) to mirror, the recursive `destructor` (649)
  precedent, `setAnimation`/`getAnimation`/`_animation` (336, 3637–3673),
  `applyStyle` (4083) and its `applyBoxAndVisibilityStyles` visibility replay (4119),
  `getComponents` (4599), `getParentComponent` (4347).
- [src/typescript/lib/component/display/Canvas.ts](src/typescript/lib/component/display/Canvas.ts)
  and [WebGLCanvas.ts](src/typescript/lib/component/display/WebGLCanvas.ts) — the
  `doLayout`/`shouldAnimate`/`reconcileAnimation`/`animationStep` machinery to
  retrofit.
- [src/typescript/lib/component/display/ProgressSpinner.ts](src/typescript/lib/component/display/ProgressSpinner.ts) —
  the motivating CSS-animation case (arc `setAnimation`, line 86).
- [src/typescript/lib/layout/Tab.ts](src/typescript/lib/layout/Tab.ts) (1580–1583,
  1700) and [Card.ts](src/typescript/lib/layout/Card.ts) (206–225) — the drivers
  that reach the trigger through `setVisible` (read to confirm no change needed).
- [src/typescript/lib/core/DOM.ts](src/typescript/lib/core/DOM.ts) `writeDeclaration`
  (295) — confirms the seam has no `!important`, justifying the per-node approach.
- [tests/dom/TestDOM.ts](tests/dom/TestDOM.ts) (493) — `requestAnimationFrame` drops
  the callback, so tests must call `Component.flushEffectiveVisibility()`.
- [tests/component/display/Canvas.test.ts](tests/component/display/Canvas.test.ts)
  — existing P3–P8 pause suite to update.

---

## Non-Goals

- **`Video` / `VideoPlayer` pause-on-hidden and `Notification` auto-dismiss
  timers.** Deliberately deferred; `onEffectiveVisibilityChange` is the clean
  extension point they will override later. Wiring them now would balloon scope.
- **A consumer-subscribable `on("effectivevisibilitychange")` event.** The hook is
  a `protected` override (lifecycle style), not a public pub-sub surface; adding an
  `on`/`off` event is unrequested.
- **Reparenting a live component into an already-hidden subtree without a
  `setVisible`/`setDisplayed` toggle.** `addComponent`/`moveComponent` do not
  schedule a reconcile, so such a canvas keeps animating until the next visibility
  toggle heals it. Out of scope.
- **Auto-pausing animations declared on shared class rules** (not via
  per-instance `setAnimation`). The base hook gates on `getAnimation() !== null`;
  class-rule animations are not covered.
- **Restructuring `Tab.doLayout`** to move panel visibility into `setActiveTabIndex`
  so it only toggles on real switches. Rejected in favour of the source-level
  `setVisible` idempotency guard (see *Architecture Decisions*), which is more
  general and far lower-risk; `Tab.ts` stays unchanged.

---

## Implementation Notes

No deviations from the plan were required — every `## Ordered Implementation
Steps` entry and `## Files to Create / Modify / Delete` row was implemented
exactly as specified, and `## Expected Behaviour` cases 1–15 are each pinned by
an offline test using `installTestDOM` + `Component.flushEffectiveVisibility()`.

The four **Manual / live-only** cases from `## Expected Behaviour` were
performed against the running app (`npm run dev`, Misc panel, via the
chrome-devtools MCP tools) after the initial implementation, and the results
are recorded here per the *Test-first* escape-hatch discipline ("describe
expected behaviour first, then implement, then verify — and say so
explicitly"):

1. **Real rAF pause.** Instrumented `window.requestAnimationFrame` with a
   counting wrapper and measured deltas over 1-second windows via
   `performance.now()`, isolating each step in a single script execution to
   avoid tool-round-trip noise. On page load (only `WebGLCanvas`, which
   auto-starts via `onFirstLayout`): 60 calls/sec — one 60Hz loop, as expected.
   After clicking "Toggle canvas animation" to start the 2D `Canvas` demo too:
   120 calls/sec — two 60Hz loops. Switching to the "Binding" tab: 12 calls/sec
   (both loops paused; the residual 12/sec is unidentified but an order of
   magnitude below the two-loop rate, not investigated further as it is outside
   this plan's scope). Switching back to "Misc.": 118 calls/sec, matching the
   pre-hide rate. Confirms the rAF loop pauses/resumes with effective
   visibility, not per-frame polling. (An earlier, less rigorous pass at this
   same check — instrumenting across separate tool calls with unaccounted
   latency and without an isolated baseline — produced implausible ~900+/sec
   figures; this measurement replaces it.)
2. **ProgressSpinner CPU / animation freeze.** Located the spinner arc element
   by its `ts-ui-progress-spinner-rotate` keyframe name and read
   `getComputedStyle(el).animationPlayState`: `"running"` while the Misc tab is
   active, flips to `"paused"` immediately after switching away, and back to
   `"running"` after switching back.
3. **Wanted transitions survive.** Triggered a Binding→Misc tab switch and
   sampled the Misc panel root element's inline style + computed opacity across
   consecutive animation frames within one script (to avoid tool-round-trip
   latency exceeding the 120ms fade). Observed the `transition: opacity 120ms
   ease-out` rule appear and opacity progress smoothly 0 → 0.22 → 0.42 → 0.59 →
   0.74 → 0.87 → 0.96 → 0.999 → 1, then the transition rule clear — the
   `Tab` cross-tab fade (`Tab.ts` ~1728, `Animation.play`) is unaffected by the
   new `animation-play-state` pausing, as the Architecture Decisions predicted
   (transitions and the `animation` shorthand are independent CSS mechanisms).
4. **Theme toggle.** With the Misc tab hidden (spinner `animationPlayState:
   "paused"`), programmatically clicked the "Switch to classic theme" button
   (`ThemeManager.setTheme`) while still on the "Binding" tab. The spinner's
   `animationPlayState` remained `"paused"` after the live theme change —
   `applyStyle` clears only the inline `style` attribute, not the `#uuid` rule
   the pause is written to, so a theme-driven re-flush does not resurrect a
   paused animation.

This section was added in response to the first audit cycle's BLOCKING
finding — the four manual-verify cases above were performed during initial
implementation but not recorded anywhere on the branch. The second audit
cycle then found the recorded rAF numbers for case 1 implausible against the
actual code (at most two 60Hz demo loops exist, nowhere near the originally
claimed ~900–1300/sec); case 1 above has been replaced with a rigorous
re-measurement, corrected accordingly. No source or test code changed as a
result of either audit cycle — only this record.
