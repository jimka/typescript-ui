# Rectify Inline Event Listener (Glyph reduced-motion) — Implementation Plan

## Overview

ARCHITECTURE.md mandates that an event listener's `handler` argument always be a **stable, named reference** — a method on the component or a module-level function — never an inline arrow/function literal ([ARCHITECTURE.md:19-21](../ARCHITECTURE.md#L19)). The rule explicitly extends to the raw `addEventListener` escape hatches, of which `MediaQueryList` is a named-valid case ([ARCHITECTURE.md:9](../ARCHITECTURE.md#L9)).

A repo-wide audit finds exactly **one** remaining violation: the inline arrow passed to `matchMedia(...).addEventListener("change", ...)` in [src/typescript/lib/component/display/Glyph.ts:104](../src/typescript/lib/component/display/Glyph.ts#L104). (Note: the path is `lib/component/display/Glyph.ts`, not `lib/component/Glyph.ts`.) The previously-planned `Event.ts`/`Body.ts` migration has already shipped — `Event.addViewportResizeListener` no longer exists and `Body.ts` already uses `Event.addViewportListener` with a named handler — so that work is out of scope here.

This plan extracts the inline arrow into a named module-level function so the listener argument becomes a stable reference. It is a single-file, single-step internal refactor with no public-API or behaviour change.

---

## Architecture Decisions

### Extract a module-level function, not an `Event` helper

The fix is a local module-level function (suggested name `_onReducedMotionChange`), **not** a new `addMediaQueryListener` helper on the `Event` class. There is exactly **one** `matchMedia` listener call site in the entire codebase; ARCHITECTURE.md's "extend the `Event` API rather than introducing new raw sites" guidance targets *recurring* DOM-event patterns that benefit from the window-level capture multiplexer. A `MediaQueryList` is one of the explicitly-named targets "the Event API cannot model today" ([ARCHITECTURE.md:9](../ARCHITECTURE.md#L9)), and a single-use abstraction would violate CLAUDE.md *Simplicity First* ("No abstractions for single-use code"). A module-level function is the correct scope: it satisfies the named-reference rule with zero new surface area.

### Re-anchor the existing orphaned JSDoc — do not author a new block

[Glyph.ts:99-102](../src/typescript/lib/component/display/Glyph.ts#L99) already carries a JSDoc block that documents this exact function but currently floats above the inline `if (typeof window …)` guard, documenting a function that does not yet exist:

```typescript
/**
 * Module-level listener that re-evaluates every animated glyph when the OS
 * `prefers-reduced-motion` preference flips. Dead `WeakRef`s are pruned.
 */
if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", (): void => {
```

This block must be **moved onto the extracted function verbatim** — it is already accurate. Do not write a replacement.

---

## Internal Structure

Current shape ([Glyph.ts:99-115](../src/typescript/lib/component/display/Glyph.ts#L99)):

```typescript
/**
 * Module-level listener that re-evaluates every animated glyph when the OS
 * `prefers-reduced-motion` preference flips. Dead `WeakRef`s are pruned.
 */
if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", (): void => {
        for (const ref of Array.from(_animatedRefs)) {
            const glyph = ref.deref();
            if (!glyph) {
                _animatedRefs.delete(ref);
                continue;
            }

            glyph._syncReducedMotion();
        }
    });
}
```

Target shape — the arrow body becomes a named function, the JSDoc moves onto it, and the guard passes the reference:

```typescript
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
    window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", _onReducedMotionChange);
}
```

Notes for the implementer:
- The handler takes no parameters today (the body iterates `_animatedRefs` and calls `glyph._syncReducedMotion()` — which is where `Animation.isReducedMotion()` is read — rather than the `MediaQueryListEvent`); keep the `(): void` signature — do not add an unused `event` parameter.
- Define the function **above** the `if` guard, in the same module-scope region (after `ensureGlyphKeyframes`, before the `GlyphOptions` interface), so it is in scope where the guard references it. A function declaration is hoisted, but placing it above the guard keeps reading order natural and matches the moved JSDoc's position.
- Leave the `if (typeof window …)` feature-detection guard intact — only the inner arrow becomes a reference.
- Matched state and consumption are unchanged: the function still iterates `_animatedRefs` (the module-level `Set<WeakRef<Glyph>>` at [Glyph.ts:43](../src/typescript/lib/component/display/Glyph.ts#L43)), prunes dead `WeakRef`s, and calls `glyph._syncReducedMotion()` ([Glyph.ts:551](../src/typescript/lib/component/display/Glyph.ts#L551)) on each live glyph.

---

## Ordered Implementation Steps

1. **Extract the inline arrow into a named module-level function** in [src/typescript/lib/component/display/Glyph.ts](../src/typescript/lib/component/display/Glyph.ts):
   - Define `function _onReducedMotionChange(): void { … }` containing the exact loop body currently inside the arrow (lines 105-113), placed immediately above the `if (typeof window …)` guard (current lines 99-115 region).
   - **Move the existing JSDoc block (current lines 99-102) onto the new function** — do not author a new comment.
   - Replace the inline arrow argument at line 104 with the bare reference: `…addEventListener("change", _onReducedMotionChange);`.
   - → verify: `grep -nE 'addEventListener\([^,]*,\s*(\(|function\b)' src/typescript/lib/component/display/Glyph.ts` returns nothing.

---

## Files to Create / Modify / Delete

| Action | File |
|--------|------|
| Modify | `src/typescript/lib/component/display/Glyph.ts` |

---

## Verification

- **Inline-handler grep invariant (the core success check):**
  ```
  grep -rnE 'addEventListener\([^,]*,\s*(\(|function\b)' src/typescript
  ```
  Must return **zero** matches after the fix. (Before the fix it returns exactly one: `Glyph.ts:104`.)
- **Typecheck:** `npm run typecheck` (`tsc -p tsconfig.lib.json --noEmit`) — must pass with no new errors.
- **No behaviour change:** the function body, the `_animatedRefs` iteration, the dead-`WeakRef` pruning, and the `_syncReducedMotion()` calls are byte-for-byte the prior arrow body, so reduced-motion re-evaluation behaviour is unchanged. No demo screen needs re-checking.

---

## Critical Files

- [src/typescript/lib/component/display/Glyph.ts](../src/typescript/lib/component/display/Glyph.ts) — the sole file changed; read lines 37-115 (the `_animatedRefs` Set, `ensureGlyphKeyframes`, the orphaned JSDoc + inline listener) and `_syncReducedMotion` at 551.
- [ARCHITECTURE.md:9,19-21](../ARCHITECTURE.md#L19) — the named-reference rule and the `MediaQueryList` raw-`addEventListener` carve-out.

---

## Non-Goals

- **No `Event.addMediaQueryListener` helper.** Single call site; a module-level function is the right scope (see Architecture Decisions).
- **`core/Animation.ts` is left alone.** Its `transitionend` listeners pass `const finish` / `const onEnd` named function expressions ([Animation.ts:137,230](../src/typescript/lib/core/Animation.ts#L137)) — stable references, already compliant.
- **`core/Popover.ts` is left alone.** Its scroll listener passes the named field `this._onScroll` ([Popover.ts:883,895](../src/typescript/lib/core/Popover.ts#L883)) — a stable reference, already compliant, and removable in the matching `removeEventListener`.
- **No `Event.ts` / `Body.ts` work.** The viewport-resize migration has already shipped (`Event.addViewportResizeListener` no longer exists; `Body.ts` uses `Event.addViewportListener` with a named handler).
- **No documentation changes.** `_onReducedMotionChange` is module-private and not exported; the public API surface is unchanged.
