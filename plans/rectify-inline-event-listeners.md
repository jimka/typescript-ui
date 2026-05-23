# Rectify Inline Event-Listener Violations — Implementation Plan

## Overview

[ARCHITECTURE.md](../ARCHITECTURE.md) was extended with a new sub-rule under "Event handling": *Listeners must reference a named function.* Inline arrow functions and anonymous function expressions are now banned, including at the raw `addEventListener` escape hatches. This plan rectifies the four pre-existing violations the rule introduces.

`grep -rn '\.addEventListener(' src/typescript --include="*.ts"` returns 11 documented call sites (Event.ts × 4 internals; Tooltip.ts × 3; Glyph.ts × 1; Animation.ts × 2; Popover.ts × 1). The inline-handler audit narrows this to four files:

1. **[Glyph.ts:102](../src/typescript/lib/component/display/Glyph.ts#L102)** — `window.matchMedia(...).addEventListener("change", (): void => { ... })`. Inline arrow capturing the module-level `_animatedRefs` `WeakRef` set.
2. **[Tooltip.ts:315, 329, 334](../src/typescript/lib/core/Tooltip.ts#L315)** — three inline arrows on the tooltip's attached element. Closure shares `cursorX`, `cursorY`, `showTimer` per attachment.
3. **[Event.ts:457](../src/typescript/lib/core/Event.ts#L457)** — `window.addEventListener('resize', function () { ... }, true)` inside `Event.addViewportResizeListener`. Anonymous function expression with no removal counterpart (the listener leaks for the app's lifetime). Sole consumer: [core/Body.ts:66](../src/typescript/lib/core/Body.ts#L66), which itself passes an inline `function (size: Size) { ... }`.
4. **[Animation.ts:137](../src/typescript/lib/core/Animation.ts#L137), [Animation.ts:230](../src/typescript/lib/core/Animation.ts#L230)** — `el.addEventListener("transitionend", finish, ...)` / `("transitionend", onEnd)`. The handlers are stored in `const`-bound arrow functions (`finish`, `onEnd`) declared inside the surrounding `play()` / `afterTransition()` function. **Borderline:** these are named references, not literal anonymous arrows at the call site — stack traces show `finish` / `onEnd`, removability works (line 220 uses `removeEventListener("transitionend", onEnd)`). Whether to migrate them depends on how strictly to read the new rule. Flagged in Architecture Decisions; default proposal: **leave as-is**.

[Popover.ts:876](../src/typescript/lib/core/Popover.ts#L876) (`ancestor.addEventListener("scroll", this._onScroll, …)`) is explicitly **not** migrated — it already references a method (`this._onScroll`), and the ancestor isn't a Component (raw-DOM-helper exception).

---

## Architecture Decisions

### One commit per file

The user requested commit-sized units they can land piecemeal. Each migration is self-contained:

| Commit | File | Risk |
|---|---|---|
| 1 | `Glyph.ts` | Trivial — extract one module-level function. |
| 2 | `Tooltip.ts` | Moderate — lift closure state into a per-element `WeakMap`. |
| 3 | `Event.ts` + `core/Body.ts` | Moderate — deprecates `addViewportResizeListener`, migrates its sole caller. |
| 4 (optional) | `Animation.ts` | Trivial-but-disputed (see "Animation.ts is borderline" below). |

The Event.ts + Body.ts pair must land together (one consumer; deleting the API without updating the caller breaks the build), so they share a single commit.

### Glyph stays a raw `addEventListener` — no new `Event.addMediaQueryListener`

The brief asked whether the matchMedia case is common enough to warrant a small `Event.addMediaQueryListener` extension. Evaluation:

- **One call site** in the entire codebase ([Glyph.ts:102](../src/typescript/lib/component/display/Glyph.ts#L102)).
- **No removal lifecycle** — the listener is installed once at module load and lives forever.
- **No shared architecture with Event.ts** — `MediaQueryList` doesn't fit the window-level capture handler pattern the Event class is built around. A hypothetical `addMediaQueryListener` would just be a one-line wrapper around `window.matchMedia(query).addEventListener("change", fn)`.

Adding the API would expand the framework's surface for no concrete benefit. **Decision:** leave the raw `addEventListener` in place; pull the inline arrow into a named module-level function. Revisit if a second matchMedia consumer ever appears.

### Tooltip closure state lifts into a per-element `WeakMap`

The three Tooltip listeners share `cursorX`, `cursorY`, `showTimer` through closure. To extract them as module-level named functions, the state must live somewhere addressable. Options considered:

| Option | Verdict |
|---|---|
| **A. Per-element `WeakMap<HTMLElement, TooltipAttachState>`** — three module-level handlers look up state by element. | **Chosen.** Doesn't pollute the element; auto-GCs when the element is collected; idiomatic for "raw DOM helper" code. |
| B. Stash `_tooltipState` on the element via custom property. | Pollutes the DOM node; harder to inspect from DevTools. |
| C. Wrap each attachment in a `TooltipAttachment` class. | Heavier than the problem warrants. |
| D. Factory function returning a fresh-per-call closure. | Doesn't satisfy the spirit of the rule — each closure is still a unique anonymous function from V8's perspective. |

```typescript
interface TooltipAttachState {
    cursorX: number;
    cursorY: number;
    showTimer: ReturnType<typeof setTimeout> | null;
    text: string;
}

const _tooltipAttachState = new WeakMap<HTMLElement, TooltipAttachState>();
```

The three handlers (`_onTooltipMouseover`, `_onTooltipMousemove`, `_onTooltipMouseout`) receive the event, look up state via `_tooltipAttachState.get(e.currentTarget as HTMLElement)`, and operate on it.

### `addViewportResizeListener` is replaced by `addViewportListener`, not patched

The inline `function () { ... }` at [Event.ts:457](../src/typescript/lib/core/Event.ts#L457) could be pulled out into a named factory, but the API has two prior strikes already worth resolving in the same commit:

1. **No removal counterpart.** `addViewportResizeListener` has no `removeViewportResizeListener`. The listener leaks for the app's lifetime. The sole consumer ([core/Body.ts:66](../src/typescript/lib/core/Body.ts#L66)) is the application's root container and never tears down, so it doesn't matter in practice — but it's a stale design.
2. **One caller.** Removing the API costs nothing.

The migrate-listeners-to-event plan flagged this as an open API-pruning decision and deferred it. The new named-function rule forces a touch on both files anyway, so the cleanup ride-along is free.

**Migration shape:**

```typescript
// Before — core/Body.ts:66:
Event.addViewportResizeListener(function (size: Size) {
    me.setSize(size);
});

// After:
Event.addViewportListener(this, "resize", this._onViewportResize);

// New private method on core Body:
private _onViewportResize(): void {
    this.setSize(Util.getViewportSize());
}
```

`Event.addViewportResizeListener` is then **deleted** from `Event.ts`. The `{ width, height }` size object the old API constructed is one `Util.getViewportSize()` call away inside the handler, so the data shape stays available without the listener-side construction.

### Animation.ts is borderline — default proposal: don't migrate

Both `play()` (line 120) and `afterTransition()` (line 215) declare their handler in a `const`-bound arrow:

```typescript
const finish = (): void => { ... };
el.addEventListener("transitionend", finish, { once: true });
```

The handler **is** stored in a named local. V8 names arrow functions by their containing `const`, so stack traces show `finish` / `onEnd`. The `afterTransition` path even uses the reference at [Animation.ts:220](../src/typescript/lib/core/Animation.ts#L220) to call `removeEventListener("transitionend", onEnd)`.

The new rule's wording: *"The handler must be a reference to a named function — a method on the component (`this.handleClick`) or a module-level function. Never pass an inline arrow function or function expression."*

A `const`-bound arrow is a reference to a named (in the V8-debug-name sense) function. Strictly, it's neither a method on the component nor a module-level function — but it's not "an inline arrow" either. **Default proposal: leave Animation.ts as-is.** Both handlers genuinely close over per-call state (`done`, `config.onComplete`, `buf`, `el`) and lifting them to module level would require an explicit context-object parameter that adds machinery for marginal benefit.

If the user wants to interpret the rule maximally — module-level functions only — the alternative is to keep the per-call state in a small context object passed via the listener's `currentTarget`-keyed `WeakMap` lookup (same shape as the Tooltip fix). Flag for confirmation during `/implement`; the plan ships with the migration **omitted by default** and step 4 marked optional.

---

## Public API (TypeScript Signatures)

### `Event.ts` — `addViewportResizeListener` removed

```typescript
// Before:
export function addViewportResizeListener(this: any, listener: Function): void;

// After: removed. Callers use Event.addViewportListener(component, "resize", handler)
// and Util.getViewportSize() inside the handler to read the new size.
```

No other public-API change. The two new helper functions in `Glyph.ts` and the three new handlers in `Tooltip.ts` are module-private; the `_tooltipAttachState` `WeakMap` is module-private.

---

## Internal Structure

### Glyph.ts — extract `_onReducedMotionChange`

```typescript
// Module-level, near _animatedRefs:

/**
 * Module-level listener that re-evaluates every animated glyph when the OS
 * `prefers-reduced-motion` preference flips. Dead `WeakRef`s are pruned.
 */
function _onReducedMotionChange(): void {
    for (const ref of Array.from(_animatedRefs)) {
        const glyph = ref.deref();
        if (!glyph) {
            _animatedRefs.delete(ref);
            continue;
        }

        glyph._syncReducedMotion();
    }
}

if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    window.matchMedia("(prefers-reduced-motion: reduce)")
        .addEventListener("change", _onReducedMotionChange);
}
```

### Tooltip.ts — `WeakMap` state + three module-level handlers

```typescript
// Module-level (near the top of Tooltip.ts, before the class):

interface TooltipAttachState {
    cursorX: number;
    cursorY: number;
    showTimer: ReturnType<typeof setTimeout> | null;
    text: string;
}

const _tooltipAttachState = new WeakMap<HTMLElement, TooltipAttachState>();

function _onTooltipMouseover(e: MouseEvent): void {
    const state = _tooltipAttachState.get(e.currentTarget as HTMLElement);
    if (!state || state.showTimer !== null) {
        return;
    }

    state.cursorX = e.clientX;
    state.cursorY = e.clientY;

    state.showTimer = setTimeout(() => {
        Tooltip.show(state.text, state.cursorX, state.cursorY);
        state.showTimer = null;
    }, 500);
}

function _onTooltipMousemove(e: MouseEvent): void {
    const state = _tooltipAttachState.get(e.currentTarget as HTMLElement);
    if (!state) {
        return;
    }

    state.cursorX = e.clientX;
    state.cursorY = e.clientY;
}

function _onTooltipMouseout(e: MouseEvent): void {
    const state = _tooltipAttachState.get(e.currentTarget as HTMLElement);
    if (!state) {
        return;
    }

    if (state.showTimer !== null) {
        clearTimeout(state.showTimer);
        state.showTimer = null;
    }

    Tooltip.hide();
}

// attachToElement body becomes:
static attachToElement(element: HTMLElement, text: string): void {
    _tooltipAttachState.set(element, {
        cursorX: 0,
        cursorY: 0,
        showTimer: null,
        text,
    });

    element.addEventListener('mouseover', _onTooltipMouseover);
    element.addEventListener('mousemove', _onTooltipMousemove);
    element.addEventListener('mouseout', _onTooltipMouseout);
}
```

**Note on the inner `setTimeout` arrow** at `state.showTimer = setTimeout(() => { ... }, 500)`: the new rule governs **event listeners**, not arbitrary callbacks. `setTimeout` continues to accept arrow functions. (Confirm with user during `/implement` if a stricter reading is intended.)

**Subtle behaviour preservation:** the original closure captured `text` per attachment, so calling `attachToElement(el, "A")` then later `attachToElement(el, "B")` on the same element would today wire **two sets of listeners** with two different `text` closures — the first attachment's listeners would still fire and show "A". After the migration, the listener pair is keyed by handler reference (single registration per `addEventListener` per type), so re-attaching with the same `_onTooltipMouseover` is a no-op; only the `_tooltipAttachState` `text` field updates. Net effect: re-attaching with new text now does what callers probably expected. Flag in Potential Challenges.

### Event.ts — delete `addViewportResizeListener` + core/Body.ts — `_onViewportResize` method

```typescript
// Event.ts — delete the entire addViewportResizeListener function (lines 448-465).
// No replacement; existing addViewportListener already covers it.

// core/Body.ts — replace init() listener install:

protected init(): this {
    super.init();

    let viewportSize = Util.getViewportSize();

    this.setSize(viewportSize);
    this.clearInsets();

    Event.addViewportListener(this, "resize", this._onViewportResize);

    return this;
}

private _onViewportResize(): void {
    this.setSize(Util.getViewportSize());
}
```

The local `me` alias drops because `_onViewportResize` is a method on `this` and `Event.addViewportListener` preserves the bound receiver semantics expected of class methods (the listener references are stored as-is; the central `baseViewportListener` invokes them without re-binding, so `this` inside `_onViewportResize` is the receiver the caller would expect — verify by reading [Event.ts:388-400](../src/typescript/lib/core/Event.ts#L388)). If the receiver doesn't survive, fall back to a `bind(this)` at registration time stored in a `_boundOnViewportResize` field, mirroring the pattern in [Dialog.ts](../src/typescript/lib/core/Dialog.ts) and [Popover.ts](../src/typescript/lib/core/Popover.ts).

---

## Ordered Implementation Steps

Each step ends with a grep checkpoint. Each step is a commit-sized unit.

### Step 1 — Glyph.ts: extract `_onReducedMotionChange`

1. Add a module-level `function _onReducedMotionChange(): void { ... }` with the body of the current inline arrow (the for-loop over `_animatedRefs`).
2. Replace the inline arrow at [Glyph.ts:102](../src/typescript/lib/component/display/Glyph.ts#L102) with a reference to `_onReducedMotionChange`.
3. **Verify:** `grep -n 'addEventListener.*=>' src/typescript/lib/component/display/Glyph.ts` → 0; `grep -n '_onReducedMotionChange' src/typescript/lib/component/display/Glyph.ts` → 2 (declaration + registration).

### Step 2 — Tooltip.ts: lift closure state into `WeakMap` + three module-level handlers

1. Add the `TooltipAttachState` interface and `_tooltipAttachState` `WeakMap` at module scope.
2. Add three module-level functions: `_onTooltipMouseover`, `_onTooltipMousemove`, `_onTooltipMouseout`.
3. Rewrite `Tooltip.attachToElement` to (a) store fresh state in `_tooltipAttachState`, (b) register the three named handlers.
4. **Verify:** `grep -nE 'addEventListener.*=>' src/typescript/lib/core/Tooltip.ts` → 0; `grep -nE 'addEventListener.*function\b' src/typescript/lib/core/Tooltip.ts` → 0; manual smoke (open Header column with a tooltipText; hover 500ms → tooltip appears; move cursor → tooltip follows; mouseout → tooltip disappears).

### Step 3 — Event.ts + core/Body.ts: delete `addViewportResizeListener`, migrate the sole caller

1. **Add** `_onViewportResize` method to `core/Body.ts`.
2. **Replace** the `Event.addViewportResizeListener(function (size) { ... })` call with `Event.addViewportListener(this, "resize", this._onViewportResize)`.
3. Drop the now-unused `let me = this;` local in Body.init.
4. **Delete** `addViewportResizeListener` from Event.ts (entire function, lines 448-465 including JSDoc).
5. **Verify:** `grep -rn 'addViewportResizeListener' src/typescript --include="*.ts"` → 0; `grep -n 'function\b' src/typescript/lib/core/Event.ts | grep -v 'export function\|interface\|//'` should have no anonymous function expressions left. The matchMedia and Tooltip raw `addEventListener` sites remain, both now with named handlers.

### Step 4 (optional, deferred to user confirmation) — Animation.ts

Default: **skip.** Both `finish` and `onEnd` are `const`-bound named locals; V8 names them in stack traces; the existing `removeEventListener` already references `onEnd` by name. If the user reads the rule maximally, lift each handler to module-level and thread per-call state through a `WeakMap` keyed by `currentTarget` (same shape as Tooltip step 2). Recommend asking before doing this — the per-call state plumbing adds noise without an obvious payoff.

### Step 5 — Final grep gate

```
grep -rn '\.addEventListener(' src/typescript --include="*.ts"
```

Expected hits — **unchanged** total of 11:

- 4 Event.ts internals (lines 54, 394 + the two `baseListener` / `baseViewportListener` installers).
- 3 Tooltip.ts — now register named module-level functions, not inline arrows.
- 1 Glyph.ts — now registers `_onReducedMotionChange`, not an inline arrow.
- 2 Animation.ts — `finish` / `onEnd` named locals (unchanged unless step 4 ran).
- 1 Popover.ts ancestor scroll — `this._onScroll` method reference (already compliant).

Then:

```
grep -rnE 'addEventListener\([^,]*,\s*(\(|function\b)' src/typescript --include="*.ts"
```

Should return **0** matches — no `addEventListener` call whose handler argument starts with `(` (inline arrow) or `function` (anonymous function expression). This is the structural gate for the new rule.

### Step 6 — Typecheck + smoke

- `npx tsc --noEmit` → 0 errors.
- `npm run dev` on http://localhost:8015:
  - **Glyph step 1:** Toggle `prefers-reduced-motion` via DevTools' Rendering panel; animated glyphs (any `<Glyph icon="spinner" animation="spin" />` on the demo) freeze/resume.
  - **Tooltip step 2:** Hover a column header with a `tooltipText` — tooltip appears after 500ms, follows cursor, disappears on mouseout.
  - **Event/Body step 3:** Resize the browser window; the app's root container resizes to match (visible by watching any percentage-width child).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/component/display/Glyph.ts` — extract `_onReducedMotionChange` module function. |
| Modify | `src/typescript/lib/core/Tooltip.ts` — add `TooltipAttachState` + `_tooltipAttachState` `WeakMap` + three module-level handlers; rewrite `attachToElement`. |
| Modify | `src/typescript/lib/core/Event.ts` — **delete** `addViewportResizeListener` (function + JSDoc). |
| Modify | `src/typescript/lib/core/Body.ts` — add `_onViewportResize` method; replace `addViewportResizeListener` call with `addViewportListener`. |
| Modify (optional) | `src/typescript/lib/core/Animation.ts` — only if step 4 is confirmed. |

No files created or deleted.

---

## Verification

- `grep -rn '\.addEventListener(' src/typescript --include="*.ts"` → **11 matches**, same locations as before (handler references named instead of inline).
- `grep -rnE 'addEventListener\([^,]*,\s*(\(|function\b)' src/typescript --include="*.ts"` → **0**.
- `grep -rn 'addViewportResizeListener' src/typescript --include="*.ts"` → **0** (API removed).
- `npx tsc --noEmit` → 0 errors.
- `npm run docs:build` → 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the only acceptable warning). Confirm `Event.addViewportResizeListener` no longer appears in the regenerated API page.
- Manual smoke per step 6.
- `graphify update .` succeeds; the `addViewportResizeListener` node disappears from the graph; new in-edges to `addViewportListener` appear from `Body.init`.

---

## Documentation Impact

`Event.addViewportResizeListener` was a public symbol (re-exported from the core barrel via `Event` namespace re-export). Removing it is a breaking change for any external consumer, though there are no external consumers in this repo.

- **Re-run `npm run docs:build`** and confirm the symbol is gone from the regenerated `docs/api/core/...` page.
- **Search `docs/`** for `addViewportResizeListener`: `grep -rn 'addViewportResizeListener' docs/` → if any hits, remove them.
- **No new public symbols** are added — `_onReducedMotionChange`, `_tooltipAttachState`, the three tooltip handlers, and `_onViewportResize` are module-private or class-private.

The named-handler rule itself is already documented in `ARCHITECTURE.md` "Event handling → Listeners must reference a named function" (set up earlier this session). No further architecture-doc edits are needed.

---

## Potential Challenges

- **Tooltip re-attachment semantics change.** Calling `attachToElement(el, "A")` then `attachToElement(el, "B")` on the same element today double-installs listeners with two different `text` closures; the first listener still fires "A". After the migration, the listener references are equal (single registration), and `_tooltipAttachState.set(el, { ..., text: "B" })` overwrites the state, so only "B" shows. This is almost certainly what callers expected — flag in case any test asserts the prior misbehaviour.

- **Tooltip listener removal is still not exposed.** `attachToElement` has no `detachFromElement`. The named handlers don't change that. If a later plan adds detachment, it can now `removeEventListener` by handler reference plus `_tooltipAttachState.delete(element)`. Out of scope here.

- **`Event.addViewportListener`'s receiver semantics.** The Body migration assumes `_onViewportResize` invoked through the Event class still sees `this === Body instance`. Read [Event.ts:388-400](../src/typescript/lib/core/Event.ts#L388) before implementing to confirm; if the central `baseViewportListener` calls the listener function bareword (`listener(evt)`), `this` will be `undefined` and the method needs `_boundOnViewportResize = this._onViewportResize.bind(this)` stored in a field (the pattern Dialog and Popover use).

- **`addViewportResizeListener` removal is breaking-by-the-letter.** No external consumer is known. If the user wants the soft path, mark it `@deprecated` for one release before removal — but given the framework is pre-1.0 internal, hard removal is simpler and cleaner.

- **Animation.ts borderline.** Default leaves it untouched. If the user wants a stricter read, the lift-to-module-level fix is mechanical but adds a per-call state plumb (similar to Tooltip's `WeakMap`). Decide at `/implement`; do not block this plan on it.

- **The inner `setTimeout` arrow in Tooltip's mouseover handler.** `setTimeout` is not an event-listener registration; the new rule is silent on it. The plan keeps the inner `setTimeout(() => { ... }, 500)` as an inline arrow. If the user wants the strictest read ("no inline anonymous callback anywhere in framework code"), that's a separate plan.

---

## Critical Files

- [src/typescript/lib/core/Event.ts](../src/typescript/lib/core/Event.ts) — `addViewportListener` at line 386 (the API Body.ts will move to); `addViewportResizeListener` at line 448 (being deleted); `baseViewportListener` dispatch at lines 388-400 (read to confirm `this`-binding).
- [src/typescript/lib/core/Body.ts](../src/typescript/lib/core/Body.ts) — `init()` at line 57, the sole `addViewportResizeListener` consumer.
- [src/typescript/lib/core/Tooltip.ts](../src/typescript/lib/core/Tooltip.ts) — `attachToElement` at line 310; existing JSDoc at 299-309 explaining the raw-DOM-helper rationale (unchanged by this plan).
- [src/typescript/lib/component/display/Glyph.ts](../src/typescript/lib/component/display/Glyph.ts) — module-level matchMedia install at line 101; `_animatedRefs` set near top of file.
- [src/typescript/lib/core/Animation.ts](../src/typescript/lib/core/Animation.ts) — `play` at line 80+ (`finish` const at 120); `afterTransition` at line 206 (`onEnd` at 223). Only touched if step 4 is confirmed.
- [ARCHITECTURE.md](../ARCHITECTURE.md), "Event handling → Listeners must reference a named function" — the rule this plan rectifies.

---

## Non-Goals

- **Adding `Event.addMediaQueryListener`.** Evaluated above; single call site, no shared architecture with Event.ts's window-capture model. Out of scope.
- **Migrating Popover.ts's ancestor scroll listeners.** Already compliant — `this._onScroll` is a named method reference; the ancestor isn't a Component (raw-DOM exemption). No change needed.
- **Adding a Tooltip `detachFromElement`.** Out of scope; pure removal-API addition that the named-handler rule doesn't force.
- **Tightening the rule to cover `setTimeout` / `requestAnimationFrame` callbacks.** The new rule is scoped to event-listener registration. Broadening it is a separate decision.
- **Refactoring Animation.ts to use class-level handler methods.** Both `play()` and `afterTransition()` are namespace-level functions, not class methods; there is no obvious owner. Per-call state would have to be threaded via a `WeakMap` — possible but not paying for itself.
- **Auditing `Event.ts`'s own internals (lines 54, 151, 236, 313, 376, 394).** Those four `addEventListener` calls register named module-level functions (`baseListener`, `baseViewportListener`); already compliant.
