# Rectify Inline Event-Listener Violations — Implementation Plan

> **Status:** Refreshed 2026-05-29 — Tooltip step shipped (in a different shape than originally proposed); Glyph, Event/Body, and Animation steps remain.

## Overview

[ARCHITECTURE.md](../ARCHITECTURE.md) was extended with a new sub-rule under "Event handling": *Listeners must reference a named function.* Inline arrow functions and anonymous function expressions are now banned, including at the raw `addEventListener` escape hatches.

`grep -rn '\.addEventListener(' src/typescript --include="*.ts"` currently returns **10** call sites (Event.ts × 3 — two internals plus the `addViewportResizeListener` site; Tooltip.ts × 3 — already migrated; Glyph.ts × 1; Animation.ts × 2; Popover.ts × 1). The inline-handler audit (`grep -rnE 'addEventListener\([^,]*,\s*(\(|function\b)' src/typescript --include="*.ts"`) shows **2 outstanding violations**:

1. **[Glyph.ts:104](../src/typescript/lib/component/display/Glyph.ts#L104)** — `window.matchMedia(...).addEventListener("change", (): void => { ... })`. Inline arrow capturing the module-level `_animatedRefs` `WeakRef` set. **Not migrated.**
2. **[Event.ts:457](../src/typescript/lib/core/Event.ts#L457)** — `window.addEventListener('resize', function () { ... }, true)` inside `Event.addViewportResizeListener`. Anonymous function expression with no removal counterpart (the listener leaks for the app's lifetime). Sole consumer: [core/Body.ts:66](../src/typescript/lib/core/Body.ts#L66), which itself passes an inline `function (size: Size) { ... }`. **Not migrated.**

Two related items are out of scope or already done:

- **[Tooltip.ts:330](../src/typescript/lib/core/Tooltip.ts#L330) `attachToElement`** and **[Tooltip.ts:403](../src/typescript/lib/core/Tooltip.ts#L403) `detachElement`** are **already migrated** (in a different shape than the original plan proposed — see Architecture Decisions). No further work here.
- **[Animation.ts:137](../src/typescript/lib/core/Animation.ts#L137), [Animation.ts:230](../src/typescript/lib/core/Animation.ts#L230)** — `el.addEventListener("transitionend", finish, ...)` / `("transitionend", onEnd)`. The handlers are `const`-bound arrows declared inside the surrounding `play()` / `afterTransition()` function. Borderline; step 4 was always optional. Default: leave as-is.

[Popover.ts:886](../src/typescript/lib/core/Popover.ts#L886) (`ancestor.addEventListener("scroll", this._onScroll, …)`) is explicitly **not** migrated — it already references a method, and the ancestor isn't a Component (raw-DOM-helper exception).

---

## Architecture Decisions

### One commit per file

The user requested commit-sized units they can land piecemeal. Each remaining migration is self-contained:

| Commit | File | Risk |
|---|---|---|
| 1 | `Glyph.ts` | Trivial — extract one module-level function. |
| 2 | `Event.ts` + `core/Body.ts` | Moderate — deprecates `addViewportResizeListener`, migrates its sole caller. |
| 3 (optional) | `Animation.ts` | Trivial-but-disputed (see "Animation.ts is borderline" below). |

The Event.ts + Body.ts pair must land together (one consumer; deleting the API without updating the caller breaks the build), so they share a single commit.

### Glyph stays a raw `addEventListener` — no new `Event.addMediaQueryListener`

The brief asked whether the matchMedia case is common enough to warrant a small `Event.addMediaQueryListener` extension. Evaluation:

- **One call site** in the entire codebase ([Glyph.ts:104](../src/typescript/lib/component/display/Glyph.ts#L104)).
- **No removal lifecycle** — the listener is installed once at module load and lives forever.
- **No shared architecture with Event.ts** — `MediaQueryList` doesn't fit the window-level capture handler pattern the Event class is built around. A hypothetical `addMediaQueryListener` would just be a one-line wrapper around `window.matchMedia(query).addEventListener("change", fn)`.

Adding the API would expand the framework's surface for no concrete benefit. **Decision:** leave the raw `addEventListener` in place; pull the inline arrow into a named module-level function. Revisit if a second matchMedia consumer ever appears.

### Tooltip already migrated — actual shape differs from the original proposal

This subsection is retrospective: the Tooltip migration **shipped** in a previous commit and is already on master. It is not part of this plan's remaining work. The shipped shape, however, is **not** the one the original draft of this plan proposed (three module-level handlers reading from a single module-level `WeakMap<HTMLElement, TooltipAttachState>`). What's actually in [Tooltip.ts:330](../src/typescript/lib/core/Tooltip.ts#L330) today:

- An `ElementTooltipAttachment` interface declared near the top of the file ([Tooltip.ts:39](../src/typescript/lib/core/Tooltip.ts#L39)) whose `mouseoverFn` / `mousemoveFn` / `mouseoutFn` fields hold **per-attachment named function expressions** (`function onTooltipMouseOver(e) { ... }`, `function onTooltipMouseMove(e) { ... }`, `function onTooltipMouseOut() { ... }`) that close over the attachment record `att`.
- The inner `setTimeout` inside `onTooltipMouseOver` is also a named function expression (`function onTooltipShowTimer()`), not an inline arrow.
- Storage is `Tooltip.elementAttachments` (a per-class map keyed by element), not a module-level `WeakMap`.
- A real `static detachElement(element)` method ([Tooltip.ts:403](../src/typescript/lib/core/Tooltip.ts#L403)) was added — originally listed as out-of-scope by the prior plan revision.
- A mid-hover behaviour was added: `attachToElement` carries the previous binding's `lastX` / `lastY` and, if the tooltip is currently visible for the element, **repaints immediately** with the new text at the carried coords so a text swap is seen without a re-hover.

The named function expression form (`function onTooltipMouseOver(...)`) satisfies the rule's intent — no anonymous arrow / function expression at the `addEventListener` call site, V8 debug names preserved in stack traces — even though it isn't the module-level-function shape the rule's wording strictly implies. **No action needed** on Tooltip.ts; the shipped shape is treated as conformant for the purposes of this plan.

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

Both `play()` (line 80+) and `afterTransition()` (line 206) declare their handler in a `const`-bound arrow:

```typescript
const finish = (): void => { ... };
el.addEventListener("transitionend", finish, { once: true });
```

The handler **is** stored in a named local. V8 names arrow functions by their containing `const`, so stack traces show `finish` / `onEnd`. The `afterTransition` path even uses the reference at [Animation.ts:220](../src/typescript/lib/core/Animation.ts#L220) to call `removeEventListener("transitionend", onEnd)`.

The new rule's wording: *"The handler must be a reference to a named function — a method on the component (`this.handleClick`) or a module-level function. Never pass an inline arrow function or function expression."*

A `const`-bound arrow is a reference to a named (in the V8-debug-name sense) function. Strictly, it's neither a method on the component nor a module-level function — but it's not "an inline arrow" either. **Default proposal: leave Animation.ts as-is.** Both handlers genuinely close over per-call state (`done`, `config.onComplete`, `buf`, `el`) and lifting them to module level would require an explicit context-object parameter that adds machinery for marginal benefit.

If the user wants to interpret the rule maximally — module-level functions only — the alternative is to keep the per-call state in a small context object passed via the listener's `currentTarget`-keyed `WeakMap` lookup (same shape as the Tooltip fix). Flag for confirmation during `/implement`; the plan ships with the migration **omitted by default** and step 3 marked optional.

---

## Public API (TypeScript Signatures)

### `Event.ts` — `addViewportResizeListener` removed

```typescript
// Before:
export function addViewportResizeListener(this: any, listener: Function): void;

// After: removed. Callers use Event.addViewportListener(component, "resize", handler)
// and Util.getViewportSize() inside the handler to read the new size.
```

No other public-API change in this plan's remaining work. The new helper function in `Glyph.ts` is module-private.

**Already-shipped surface change (not part of this plan's remaining work):** `Tooltip.detachElement(element: HTMLElement): void` ([Tooltip.ts:403](../src/typescript/lib/core/Tooltip.ts#L403)) — added alongside the Tooltip migration that already landed.

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

### Event.ts — delete `addViewportResizeListener` + core/Body.ts — `_onViewportResize` method

```typescript
// Event.ts — delete the entire addViewportResizeListener function (around lines 448-465).
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

The local `me` alias drops because `_onViewportResize` is a method on `this` and `Event.addViewportListener` preserves the bound receiver semantics expected of class methods (the listener references are stored as-is; the central `baseViewportListener` invokes them without re-binding, so `this` inside `_onViewportResize` is the receiver the caller would expect — verify by reading [Event.ts:383-400](../src/typescript/lib/core/Event.ts#L383)). If the receiver doesn't survive, fall back to a `bind(this)` at registration time stored in a `_boundOnViewportResize` field, mirroring the pattern in [Dialog.ts](../src/typescript/lib/core/Dialog.ts) and [Popover.ts](../src/typescript/lib/core/Popover.ts).

---

## Ordered Implementation Steps

Each step ends with a grep checkpoint. Each step is a commit-sized unit.

### Step 1 — Glyph.ts: extract `_onReducedMotionChange`

1. Add a module-level `function _onReducedMotionChange(): void { ... }` with the body of the current inline arrow (the for-loop over `_animatedRefs`).
2. Replace the inline arrow at [Glyph.ts:104](../src/typescript/lib/component/display/Glyph.ts#L104) with a reference to `_onReducedMotionChange`.
3. **Verify:** `grep -n 'addEventListener.*=>' src/typescript/lib/component/display/Glyph.ts` → 0; `grep -n '_onReducedMotionChange' src/typescript/lib/component/display/Glyph.ts` → 2 (declaration + registration).

### Step 2 — Event.ts + core/Body.ts: delete `addViewportResizeListener`, migrate the sole caller

1. **Add** `_onViewportResize` method to `core/Body.ts`.
2. **Replace** the `Event.addViewportResizeListener(function (size) { ... })` call with `Event.addViewportListener(this, "resize", this._onViewportResize)`.
3. Drop the now-unused `let me = this;` local in `Body.init`.
4. **Delete** `addViewportResizeListener` from Event.ts (entire function, around lines 448-465 including JSDoc).
5. **Verify:** `grep -rn 'addViewportResizeListener' src/typescript --include="*.ts"` → 0; `grep -nE 'addEventListener\([^,]*,\s*(\(|function\b)' src/typescript/lib/core/Event.ts` → 0. The matchMedia and Tooltip raw `addEventListener` sites remain, both with named handlers.

### Step 3 (optional, deferred to user confirmation) — Animation.ts

Default: **skip.** Both `finish` and `onEnd` are `const`-bound named locals; V8 names them in stack traces; the existing `removeEventListener` already references `onEnd` by name. If the user reads the rule maximally, lift each handler to module-level and thread per-call state through a `WeakMap` keyed by `currentTarget` (same shape as the shipped Tooltip fix). Recommend asking before doing this — the per-call state plumbing adds noise without an obvious payoff.

### Step 4 — Final grep gate

```
grep -rn '\.addEventListener(' src/typescript --include="*.ts"
```

Expected hits — **unchanged** total of **10**:

- 3 Event.ts internals (lines 54, 394 — `baseListener` / `baseViewportListener` installers — plus one fewer site once `addViewportResizeListener` is deleted; **after this plan ships the total drops to 9**).
- 3 Tooltip.ts — already register per-attachment named function expressions (`att.mouseoverFn` / `att.mousemoveFn` / `att.mouseoutFn`).
- 1 Glyph.ts — now registers `_onReducedMotionChange`, not an inline arrow.
- 2 Animation.ts — `finish` / `onEnd` named locals (unchanged unless step 3 ran).
- 1 Popover.ts ancestor scroll — `this._onScroll` method reference (already compliant).

Then:

```
grep -rnE 'addEventListener\([^,]*,\s*(\(|function\b)' src/typescript --include="*.ts"
```

Should return **0** matches — no `addEventListener` call whose handler argument starts with `(` (inline arrow) or `function` (anonymous function expression). This is the structural gate for the new rule.

### Step 5 — Typecheck + smoke

- `npx tsc --noEmit` → 0 errors.
- `npm run dev` on http://localhost:8015:
  - **Glyph step 1:** Toggle `prefers-reduced-motion` via DevTools' Rendering panel; animated glyphs (any `<Glyph icon="spinner" animation="spin" />` on the demo) freeze/resume.
  - **Event/Body step 2:** Resize the browser window; the app's root container resizes to match (visible by watching any percentage-width child).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/component/display/Glyph.ts` — extract `_onReducedMotionChange` module function. |
| Modify | `src/typescript/lib/core/Event.ts` — **delete** `addViewportResizeListener` (function + JSDoc). |
| Modify | `src/typescript/lib/core/Body.ts` — add `_onViewportResize` method; replace `addViewportResizeListener` call with `addViewportListener`. |
| Modify (optional) | `src/typescript/lib/core/Animation.ts` — only if step 3 is confirmed. |

No files created or deleted.

---

## Verification

- `grep -rn '\.addEventListener(' src/typescript --include="*.ts"` → **9 matches** after step 2 lands (one fewer than today's 10, because `addViewportResizeListener`'s internal `window.addEventListener('resize', ...)` goes away with the function).
- `grep -rnE 'addEventListener\([^,]*,\s*(\(|function\b)' src/typescript --include="*.ts"` → **0**.
- `grep -rn 'addViewportResizeListener' src/typescript --include="*.ts"` → **0** (API removed).
- `npx tsc --noEmit` → 0 errors.
- `npm run docs:build` → 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the only acceptable warning). Confirm `Event.addViewportResizeListener` no longer appears in the regenerated API page.
- Manual smoke per step 5.

---

## Documentation Impact

`Event.addViewportResizeListener` was a public symbol (re-exported from the core barrel via `Event` namespace re-export). Removing it is a breaking change for any external consumer, though there are no external consumers in this repo.

- **Re-run `npm run docs:build`** and confirm the symbol is gone from the regenerated `docs/api/core/...` page.
- **Search `docs/`** for `addViewportResizeListener`: `grep -rn 'addViewportResizeListener' docs/` → if any hits, remove them.
- **No new public symbols** are added by this plan's remaining work — `_onReducedMotionChange` and `_onViewportResize` are module-private or class-private.

The named-handler rule itself is already documented in `ARCHITECTURE.md` "Event handling → Listeners must reference a named function" (set up earlier this session). No further architecture-doc edits are needed.

---

## Potential Challenges

- **`Event.addViewportListener`'s receiver semantics.** The Body migration assumes `_onViewportResize` invoked through the Event class still sees `this === Body instance`. Read [Event.ts:383-400](../src/typescript/lib/core/Event.ts#L383) before implementing to confirm; if the central `baseViewportListener` calls the listener function bareword (`listener(evt)`), `this` will be `undefined` and the method needs `_boundOnViewportResize = this._onViewportResize.bind(this)` stored in a field (the pattern Dialog and Popover use).

- **`addViewportResizeListener` removal is breaking-by-the-letter.** No external consumer is known. If the user wants the soft path, mark it `@deprecated` for one release before removal — but given the framework is pre-1.0 internal, hard removal is simpler and cleaner.

- **Animation.ts borderline.** Default leaves it untouched. If the user wants a stricter read, the lift-to-module-level fix is mechanical but adds a per-call state plumb. Decide at `/implement`; do not block this plan on it.

---

## Critical Files

- [src/typescript/lib/core/Event.ts](../src/typescript/lib/core/Event.ts) — `addViewportListener` at line 383 (the API Body.ts will move to); `addViewportResizeListener` at line 454 (being deleted); `baseViewportListener` dispatch around lines 383-400 (read to confirm `this`-binding).
- [src/typescript/lib/core/Body.ts](../src/typescript/lib/core/Body.ts) — `init()` at line 57, the sole `addViewportResizeListener` consumer.
- [src/typescript/lib/component/display/Glyph.ts](../src/typescript/lib/component/display/Glyph.ts) — module-level matchMedia install at line 103; `_animatedRefs` set near top of file.
- [src/typescript/lib/core/Animation.ts](../src/typescript/lib/core/Animation.ts) — `play` at line 80+ (`finish` const at 120); `afterTransition` at line 206 (`onEnd` at 223). Only touched if step 3 is confirmed.
- [ARCHITECTURE.md](../ARCHITECTURE.md), "Event handling → Listeners must reference a named function" — the rule this plan rectifies.

---

## Non-Goals

- **Adding `Event.addMediaQueryListener`.** Evaluated above; single call site, no shared architecture with Event.ts's window-capture model. Out of scope.
- **Migrating Popover.ts's ancestor scroll listeners.** Already compliant — `this._onScroll` is a named method reference; the ancestor isn't a Component (raw-DOM exemption). No change needed.
- **Re-shaping Tooltip.ts to the originally-proposed module-level-handler form.** The shipped per-attachment named function expression form satisfies the rule's intent (no anonymous arrow/function at the `addEventListener` call site; V8 debug names preserved). Re-shaping for purity is churn for no behavioural payoff.
- **Tightening the rule to cover `setTimeout` / `requestAnimationFrame` callbacks.** The new rule is scoped to event-listener registration. Broadening it is a separate decision.
- **Refactoring Animation.ts to use class-level handler methods.** Both `play()` and `afterTransition()` are namespace-level functions, not class methods; there is no obvious owner. Per-call state would have to be threaded via a `WeakMap` — possible but not paying for itself.
- **Auditing `Event.ts`'s own internals** (lines 54, 394). Those two `addEventListener` calls register named module-level functions (`baseListener`, `baseViewportListener`); already compliant.
- **Renaming any event registration / deregistration functions to `on` / `off`.** The new rule governs handler form (named vs anonymous) at the call site, not API naming. The existing `addListener` / `removeListener`, `addSubtreeListener` / `removeSubtreeListener`, and `addViewportListener` / `removeViewportListener` pairs stay as-is.
