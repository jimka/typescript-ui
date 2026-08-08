# Scrollbar touchAction Clobbering Fix — Implementation Plan

## Overview

[`plans/implemented/option-setter-clobbering-audit.md`](plans/implemented/option-setter-clobbering-audit.md) named `Scrollbar`'s `init()` as a confirmed clobbering site and deferred it: [`Scrollbar.ts:512-518`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L512-L518) unconditionally calls `this.setTouchAction("none")` after `super.init(element)`, discarding a caller-supplied `touchAction` option (already applied during construction, since `touchAction?: string` is a plain `ComponentOptions` field `ScrollbarOptions` inherits). The precedent plan's own audit found `touchAction` has **no `_defaultOptions` fold anywhere in `Component.ts`** — confirmed still true by reading the current getter, [`Component.ts:2397-2399`](packages/lib/src/typescript/lib/core/Component.ts#L2397-L2399) — so its standard bag-substitution fix (seed a default, delete the imperative call) cannot apply without extending the base mechanism first.

This plan extends the base mechanism. `getTouchAction()` gains the same class-default fold `getCursor()` already has, and `Component.ts`'s render pass gains a small replay step mirroring the one `pointerEvents` / `writingMode` already have — the exact template `touchAction` was missing. Once that exists, `Scrollbar.ts` seeds its own default (`"none"`) through the normal `_defaultScrollbarOptions` bag and its `init()` override is deleted outright, since the base mechanism now does the work.

Tracing the render lifecycle (`applyStyle`'s inline-style wipe, `applyMiscInlineStyles`'s replay phase, `setTouchAction`'s idempotence guard) surfaced a second, smaller defect that has to be fixed alongside the fold for it to work correctly: `clearTouchAction()`'s early-return guard would silently defeat the new default-suppression contract. Both fixes are detailed below.

---

## Architecture Decisions

### Extend `Component.ts`'s base fold, mirroring `pointerEvents` / `writingMode` — not a bespoke `Scrollbar` guard

`touchAction` gets the same two-part treatment `pointerEvents` and `writingMode` already have: a folding getter, plus a replay line in `applyMiscInlineStyles()` ([`Component.ts:4790-4846`](packages/lib/src/typescript/lib/core/Component.ts#L4790-L4846)) that pushes the resolved value onto the element even when no setter fired this render. `Scrollbar.ts`'s own `init()` override is deleted, not patched — the base mechanism replaces it entirely.[^why-not-local-guard]

### `touchAction`'s fold needs key-presence, like `cursor` — not the simpler `pointerEvents` shape

`getTouchAction()` must fold the way `getCursor()` does ([`Component.ts:2356-2358`](packages/lib/src/typescript/lib/core/Component.ts#L2356-L2358)): `"touchAction" in this._options ? (this._options.touchAction ?? null) : (this._defaultOptions.touchAction ?? null)`, not the plain `?? this._defaultOptions.touchAction ?? null` shape `getPointerEvents()` / `getWritingMode()` use. `clearTouchAction()` also loses its early-return guard, becoming unconditional like `clearCursor()`.[^key-presence-needed]

### Sole beneficiary today is `Scrollbar`; that doesn't make this speculative

Extending `Component.ts`'s fold for `touchAction` benefits only `Scrollbar` today.[^sole-beneficiary] That's still consistent with [CLAUDE.md](CLAUDE.md)'s simplicity-first guideline: the extension isn't new machinery, it completes a two-part shape (`pointerEvents` / `writingMode`) that already exists for a field that was missing it, and it removes a bespoke override from `Scrollbar.ts` rather than adding one.

---

## Internal Structure

Final shape of the four touched methods (all in `packages/lib/src/typescript/lib/core/Component.ts` unless noted):

```typescript
// getTouchAction — key-presence fold, mirrors getCursor exactly.
getTouchAction(): string | null {
    return "touchAction" in this._options ? (this._options.touchAction ?? null) : (this._defaultOptions.touchAction ?? null);
}

// clearTouchAction — unconditional, mirrors clearCursor exactly.
clearTouchAction(): this {
    // Set (not skip) the key so `getTouchAction` sees an explicit clear and
    // returns null, suppressing the class default — distinct from the
    // never-set case where the key is absent and the default applies.
    this._options.touchAction = undefined;
    this.setElementStyle("touchAction", null);

    return this;
}

// applyMiscInlineStyles — new replay block, same shape as pointerEvents/writingMode.
const touchAction = this.getTouchAction();
if (touchAction) {
    this._inlineStyle.set("touchAction", touchAction);
}
```

`setTouchAction()` itself is unchanged — it keeps its existing idempotence guard, which is correct for its own direct callers; the replay above deliberately bypasses it by calling `this._inlineStyle.set(...)` directly, the same way the existing `pointerEvents` / `writingMode` replay lines do.

`Scrollbar.ts`'s `_defaultScrollbarOptions` (currently `packages/lib/src/typescript/lib/component/container/Scrollbar.ts:304-306`) gains one entry:

```typescript
const _defaultScrollbarOptions: Partial<ScrollbarOptions> = {
    backgroundColor: "var(--ts-ui-scrollbar-track, rgba(0, 0, 0, 0.04))",
    touchAction:     "none",
};
```

and its `init()` override (`Scrollbar.ts:506-518`, doc comment included) is deleted in full — nothing else in that method exists to preserve.

---

## Ordered Implementation Steps

Run `npm test` (in `packages/lib`) after Steps 1-3 and again after Steps 4-5 to localize any regression.

### Step 1 — `Component.ts`: fold `getTouchAction()`

Replace, at [`Component.ts:2397-2399`](packages/lib/src/typescript/lib/core/Component.ts#L2397-L2399):

```typescript
getTouchAction(): string | null {
    return this._options.touchAction ?? null;
}
```

with:

```typescript
getTouchAction(): string | null {
    return "touchAction" in this._options ? (this._options.touchAction ?? null) : (this._defaultOptions.touchAction ?? null);
}
```

**Verification checkpoint:** `grep -n "getTouchAction" packages/lib/src/typescript/lib/core/Component.ts` — one definition, matching `getCursor`'s key-presence shape.

### Step 2 — `Component.ts`: make `clearTouchAction()` unconditional

Replace, at [`Component.ts:2424-2433`](packages/lib/src/typescript/lib/core/Component.ts#L2424-L2433):

```typescript
clearTouchAction(): this {
    if (this._options.touchAction === undefined) {
        return this;
    }

    this._options.touchAction = undefined;
    this.setElementStyle("touchAction", null);

    return this;
}
```

with:

```typescript
clearTouchAction(): this {
    // Set (not skip) the key so `getTouchAction` sees an explicit clear and
    // returns null, suppressing the class default — distinct from the
    // never-set case where the key is absent and the default applies.
    this._options.touchAction = undefined;
    this.setElementStyle("touchAction", null);

    return this;
}
```

**Verification checkpoint:** `grep -n "if (this._options.touchAction === undefined)" packages/lib/src/typescript/lib/core/Component.ts` — zero matches.

### Step 3 — `Component.ts`: replay `touchAction` in `applyMiscInlineStyles()`

Update the method's docblock at [`Component.ts:4785-4789`](packages/lib/src/typescript/lib/core/Component.ts#L4785-L4789) — insert "touch-action" into the enumerated list, right after "writing-mode":

```
     * Writes the remaining inline and rule styles (white-space, pointer-events,
     * writing-mode, touch-action, z-index, will-change, transition, opacity,
     * user-select, padding, insets, margin) — the sixth `applyStyle` phase.
```

Then, inside the method body, insert a new block right after the `writingMode` block (currently [`Component.ts:4800-4803`](packages/lib/src/typescript/lib/core/Component.ts#L4800-L4803)) and before the `zIndex` block:

```typescript
        const writingMode = this.getWritingMode();
        if (writingMode) {
            this._inlineStyle.set("writingMode", writingMode);
        }

        const touchAction = this.getTouchAction();
        if (touchAction) {
            this._inlineStyle.set("touchAction", touchAction);
        }

        const zIndex = this.getZIndex();
```

**Verification checkpoint:** `grep -n "getTouchAction()" packages/lib/src/typescript/lib/core/Component.ts` — two matches (the getter's own signature line from Step 1, and this new call).

### Step 4 — `Scrollbar.ts`: seed the default, delete the override

In [`Scrollbar.ts`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts):

1. In `_defaultScrollbarOptions` (line 304), add `touchAction: "none",` after the existing `backgroundColor` entry:
   ```typescript
   const _defaultScrollbarOptions: Partial<ScrollbarOptions> = {
       backgroundColor: "var(--ts-ui-scrollbar-track, rgba(0, 0, 0, 0.04))",
       touchAction:     "none",
   };
   ```
2. Delete the entire `init()` override at lines 506-518, including its doc comment (`/** Initializes the scrollbar element and sets \`touch-action: none\`... */`) — the base `Component.init()` (inherited, unchanged) now applies the default/override correctly on its own.
3. Delete the now-unused `import type { Handle } from "~/core/DOM.js";` at line 7 — `Handle` was referenced only by the deleted `init(element?: Handle)` signature.

**Verification checkpoint:** `grep -n "setTouchAction\|protected init\|Handle" packages/lib/src/typescript/lib/component/container/Scrollbar.ts` — zero matches for all three.

### Step 5 — Tests

1. `packages/lib/tests/component/Component.test.ts` — add a new `describe` block right after the existing `describe('Component — will-change survives applyStyle', ...)` block (which ends around line 638), mirroring its exact shape:
   ```typescript
   // Mirrors the will-change replay above: touchAction had no _defaultOptions
   // fold or applyStyle replay before this plan, so a construction-time value
   // was silently dropped by the same inline-style wipe.
   describe('Component — touch-action survives applyStyle and folds a class default', () => {
       beforeEach(() => installTestDOM(DOM_CONFIG));
       afterEach(() => { vi.restoreAllMocks(); DOM.reset(); });

       it('replays a construction-time touchAction past the inline-style wipe', () => {
           const sink      = DOM.sink as RecordingDOMSink;
           const component = new Component({ touchAction: 'pan-y' });
           const root      = component.getElement(true)!;

           const applies = sink.writes.filter(w => w.op === 'apply' && w.args[0] === root);
           const wipeAt  = applies.findIndex(w =>
               (w.args[1] as { removeAttr?: string[] }).removeAttr?.includes('style'));

           expect(wipeAt).toBeGreaterThanOrEqual(0);

           const replayed = applies.slice(wipeAt + 1).some(w =>
               (w.args[1] as { style?: Record<string, string> }).style?.touchAction === 'pan-y');

           expect(replayed).toBe(true);
       });

       it('keeps reporting the caller value through getTouchAction', () => {
           const component = new Component({ touchAction: 'pan-y' });
           component.getElement(true);

           expect(component.getTouchAction()).toBe('pan-y');
       });
   });
   ```
   No new imports needed — `RecordingDOMSink`, `DOM_CONFIG`, `vi`, `installTestDOM` are already imported in this file (used by the will-change block directly above).

2. `packages/lib/tests/component/default-options-fallback.test.ts`:
   - Add a row to the `DEFAULT_RESOLUTION` array, right after the existing `'Scrollbar backgroundColor'` row (line 291):
     ```typescript
     { label: 'Scrollbar touchAction',        resolve: () => new Scrollbar().getTouchAction(),                           expected: 'none' },
     ```
   - In the `describe('an explicit value wins over a class default', ...)` block, add two new tests right after the existing `'a caller-supplied backgroundColor/foregroundColor wins for Scrollbar, ToolBarSeparator, ChartLegend, Popover'` test (ends around line 468):
     ```typescript
     it('a caller-supplied touchAction wins for Scrollbar', () => {
         expect(new Scrollbar('vertical', { touchAction: 'pan-y' }).getTouchAction()).toBe('pan-y');
     });

     it('clearTouchAction on Scrollbar suppresses the class default', () => {
         const scrollbar = new Scrollbar();
         scrollbar.clearTouchAction();

         expect(scrollbar.getTouchAction()).toBeNull();
     });
     ```
   `Scrollbar` is already imported in this file (line 40); no new import needed.

**Verification checkpoint:** `npm test -- Component.test default-options-fallback.test` (in `packages/lib`) — all new and existing cases pass.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/Scrollbar.ts` |
| Modify | `packages/lib/tests/component/Component.test.ts` |
| Modify | `packages/lib/tests/component/default-options-fallback.test.ts` |

No files are created or deleted.

---

## Expected Behaviour

All cases are unit-testable **(U)** via the offline `installTestDOM` + `getElement(true)` harness already used by `Component.test.ts` and `default-options-fallback.test.ts`.

1. **Default unchanged when the caller passes nothing (U).** `new Scrollbar().getTouchAction()` returns `"none"` — the same value the deleted `init()` override used to write, now resolved through the class-default fold instead of an imperative call.
2. **Caller override now wins (U).** `new Scrollbar('vertical', { touchAction: 'pan-y' }).getTouchAction()` returns `'pan-y'`, not `'none'`.
3. **The override actually reaches the DOM, not just the getter (U).** This is the case a getter-only test would miss: `applyStyle`'s inline-style wipe (`Component.ts:4605`) strips whatever `_inlineStyle.attach()` flushed during construction, and nothing replayed `touch-action` before this plan. `new Component({ touchAction: 'pan-y' }).getElement(true)` must produce an `apply` sink write with `style.touchAction === 'pan-y'` *after* the wipe's own `apply` write (`removeAttr: ["style"]`) — proven by Step 5.1's first test, mirroring the existing `will-change survives applyStyle` test exactly.
4. **`clearTouchAction()` suppresses the default, not just an explicit value (U).** Calling `clearTouchAction()` on a `new Scrollbar()` makes a subsequent `getTouchAction()` return `null` — before this plan's Step 2 fix, the method's early-return guard would have made `clearTouchAction()` a no-op, leaving the class default (`"none"`) in place.
5. **Manual verify (not automatable offline):** dragging a `Scrollbar`'s thumb with touch input still doesn't trigger native page-scroll for a default (no `touchAction` option) scrollbar — this is the original behaviour the deleted `init()` override protected, now produced by the fold instead; nothing about the resting-default outcome changes, so this is a regression check, not new behaviour to verify.

---

## Verification

- `npm run typecheck` (in `packages/lib`) — no signature changes; `getTouchAction`, `setTouchAction`, `clearTouchAction` keep their existing shapes, and `Scrollbar.init()` is deleted, not altered, so nothing outside the file could depend on its signature (`protected`, no subclasses — confirmed via `grep -rn "extends Scrollbar" packages/lib/src`, zero matches).
- `npm run test` (in `packages/lib`) — full suite green, including the four new cases from `## Expected Behaviour`.
- Grep invariants (final pass, combining the per-step checks above):
  ```
  grep -n "if (this._options.touchAction === undefined)" packages/lib/src/typescript/lib/core/Component.ts
  grep -n "setTouchAction\|protected init\|Handle" packages/lib/src/typescript/lib/component/container/Scrollbar.ts
  ```
  — zero matches for both.
- Manual smoke (per `## Expected Behaviour` item 5): open the app (`npm run dev`), find any scrolling panel/table backed by `Scrollbar` (e.g. a table demo), and confirm dragging the scrollbar thumb on a touch-emulated input (Chrome DevTools device toolbar) still doesn't scroll the page. This is a regression check — the resting default is unchanged by this plan.
- `npm run docs:api` (in `packages/lib`) is not required — no public JSDoc changes; every touched method's signature and visibility is unchanged, and `Scrollbar.init()` was `protected` (already excluded from generated docs).

---

## Documentation Impact

No public API changes — `getTouchAction()`, `setTouchAction()`, and `clearTouchAction()` keep their existing signatures; `Scrollbar.init()` was `protected`, never part of the public docs surface.

A changelog entry will still be needed once this ships, since consumer-visible behaviour changes (a previously-ignored `Scrollbar` `touchAction` option now works). That's for whoever runs `/implement` to add, in [`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md) — the precedent plan's own entry lives under `### Component defaults`, and the sibling `setter-clobbering-followup-orientation` plan's own follow-up entry continues that same list; this fix is a natural continuation of both. Not a required step of this plan.

---

## Potential Challenges

- **The render-wipe-plus-idempotence-guard interaction is easy to "simplify away."** A narrower-looking fix — guarding `Scrollbar.init()`'s `setTouchAction("none")` call with `if (this.getTouchAction() === null)` — looks sufficient but silently fails: `setTouchAction()`'s own equality check (`if (this._options.touchAction === touchAction) return this;`) would then skip the DOM write whenever the cached value already matches, which is exactly the case right after `applyStyle`'s wipe removes the *DOM* copy while leaving the *cache* untouched. Mitigation: Step 3's replay writes through `this._inlineStyle.set(...)` directly, the same way the existing `pointerEvents` / `writingMode` blocks do, bypassing `setTouchAction()`'s guard entirely — do not route the replay through the public setter.
- **`clearTouchAction()`'s behaviour change is currently unexercised.** Step 2 changes what `clearTouchAction()` does when called on a component that never had `touchAction` explicitly set — confirmed via `grep -rn "clearTouchAction" packages/lib/src packages/lib/tests` (zero call sites today beyond the definition itself), so no existing behaviour regresses; the change only matters going forward, once `Scrollbar` has a real default to suppress.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/Component.ts:2356-2358`](packages/lib/src/typescript/lib/core/Component.ts#L2356-L2358) (`getCursor`) — the key-presence fold Step 1 mirrors exactly.
- [`packages/lib/src/typescript/lib/core/Component.ts:4790-4846`](packages/lib/src/typescript/lib/core/Component.ts#L4790-L4846) (`applyMiscInlineStyles`, including the `pointerEvents` / `writingMode` blocks) — the exact replay-after-wipe template Step 3 extends.
- [`packages/lib/src/typescript/lib/core/Component.ts:4604-4627`](packages/lib/src/typescript/lib/core/Component.ts#L4604-L4627) (`applyStyle`) — shows the inline-style wipe (`removeAttr: ["style"]`) that motivates the replay step; read this before touching `applyMiscInlineStyles`.
- [`packages/lib/src/typescript/lib/component/container/Scrollbar.ts:304-306`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L304-L306) (`_defaultScrollbarOptions`) and [`:506-518`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L506-L518) (`init()`) — the site being fixed.
- [`packages/lib/tests/component/Component.test.ts:607-638`](packages/lib/tests/component/Component.test.ts#L607-L638) (`will-change survives applyStyle`) — the test-shape precedent Step 5.1 mirrors.
- [`packages/lib/tests/component/default-options-fallback.test.ts`](packages/lib/tests/component/default-options-fallback.test.ts) — the default-resolution registry Step 5.2 adds a row to.
- [`plans/implemented/option-setter-clobbering-audit.md`](plans/implemented/option-setter-clobbering-audit.md) — names this exact deferred item and its two-column fold/no-fold table.
- [`plans/setter-clobbering-followup-orientation.md`](plans/setter-clobbering-followup-orientation.md) — the sibling follow-up plan from the same audit; its `## Non-Goals` names this item as the one covered by a separate worktree (this plan).

---

## Non-Goals

- **Not touching `pointerEvents` / `writingMode`'s identical-shaped `clear*()` early-return gap.** Both have the same guard `clearTouchAction()` had before Step 2, which would have the same default-suppression bug *if* either field ever gained a real `_defaultOptions` value. Neither does today — grepping `_defaultOptions.pointerEvents` / `_defaultOptions.writingMode` across `packages/lib/src` finds no seeded default anywhere — so the gap is latent, not a live bug, and fixing it is out of scope for a plan about `touchAction`.
- **Not touching `VirtualScroller.ts:141`'s `this._owner.setTouchAction("none")`.** A different bug shape entirely: it sets touch-action on an already-constructed, externally-owned component after the fact, not inside that component's own constructor options cascade — there is no caller-supplied option being clobbered here, so neither this plan's fold nor a local guard applies.
- **Not adding a caller-facing `touchAction` option to any other component.** None exists today beyond the base `ComponentOptions` field every component already inherits; this plan only makes the base fold mechanism work for a field that already existed, matching the "sole beneficiary" reasoning in `## Architecture Decisions`.
- **No component's default touch behaviour changes** when nobody customises `touchAction`. `Scrollbar` keeps its `"none"` resting default; every case in `## Expected Behaviour`'s default rows keeps today's value.

---

## Notes

[^why-not-local-guard]: A narrower fix was the initial candidate: guard `Scrollbar.init()`'s `this.setTouchAction("none")` call so it only fires when nothing was already set. Tracing the actual render lifecycle shows this doesn't work. `applyStyle()` ([`Component.ts:4604-4627`](packages/lib/src/typescript/lib/core/Component.ts#L4604-L4627)) opens with `DOM.sink.apply(element, { removeAttr: ["style"] })`, wiping every inline style — including whatever `touchAction` a caller's constructor-time option already flushed onto the element via `_inlineStyle.attach()` moments earlier in `init()`. None of `applyStyle`'s six phases replayed `touchAction` before this plan, so without a replay step, the wipe would permanently erase it. A guard like `if (this.getTouchAction() === null) { this.setTouchAction("none"); }`, added to `Scrollbar.init()` after `super.init()`, only handles the *no-override* case correctly (the cache is genuinely `null`, so the guard doesn't block the call). For the *override* case, the cache already holds the caller's value (e.g. `"pan-y"`) from construction, so `getTouchAction()` is non-null, the guard skips the call entirely, and the wiped DOM style is never restored — the getter would misleadingly report `"pan-y"` while the live element has no `touch-action` at all. A workaround kept entirely inside `Scrollbar.ts` (e.g. `this.clearTouchAction(); this.setTouchAction(resolved);`, forcing `setTouchAction`'s equality guard to miss) would fix this, but it duplicates — with an extra indirection — the exact `_inlineStyle.set(...)`-bypasses-the-setter technique `pointerEvents` / `writingMode` already use in `applyMiscInlineStyles`. Fixing it at that existing template instead avoids the workaround, fixes the same class of problem for any future default-bearing field, and deletes `Scrollbar.ts`'s override rather than complicating it.

[^key-presence-needed]: Before this plan, `touchAction` never had a real class-level default anywhere, so `getTouchAction()`'s old plain-`??` shape and `clearTouchAction()`'s early-return guard were both harmless — clearing a field with no default to suppress is a no-op either way. Once `Scrollbar` seeds `_defaultScrollbarOptions.touchAction = "none"` (Step 4), the gap becomes live: with the old early-return guard, `new Scrollbar().clearTouchAction()` would see `this._options.touchAction === undefined` (never set) and return immediately without writing the key, leaving `"touchAction" in this._options` `false` — so even a correctly-folding getter would keep resolving to the class default `"none"` instead of the explicit `null` a caller asking to clear it expects. `getCursor()` / `clearCursor()` solve exactly this by having `clearCursor()` unconditionally write `this._options.cursor = undefined` (setting the key even when the value doesn't visibly change), so `"cursor" in this._options` is `true` after a clear and the getter's key-presence branch correctly returns `null` instead of falling through to the default. Step 1 and Step 2 apply the identical pair of changes to `touchAction`.

[^sole-beneficiary]: Grepping `touchAction` / `setTouchAction` / `getTouchAction` / `clearTouchAction` across `packages/lib/src` outside `Component.ts` and `Scrollbar.ts` finds exactly one hit: [`VirtualScroller.ts:141`](packages/lib/src/typescript/lib/component/container/VirtualScroller.ts#L141), `this._owner.setTouchAction("none")`. That call sets touch-action on an already-constructed, externally-owned component after the fact, not inside that component's own constructor options cascade — it has no caller-supplied option to preserve, so it would not benefit from a fold even if one existed (see `## Non-Goals`).

---

## Implementation Notes

**Performed the `## Verification` section's manual smoke check; no discrepancy found.** Started the `packages/lib` dev server (`npx vite --port 8025`) from inside this worktree (confirmed via `readlink /proc/<pid>/cwd` that it served this worktree's own source, not the main tree's) and drove it with `chrome-devtools` MCP tools. Opened the `Misc.` panel's "autoScroll: x" demo window (`MiscPanel.ts`'s `autoScroll` button row), which constructs a `Panel` (`packages/lib/src/typescript/lib/core/Panel.ts`) with no `scrollbarStyle` override, so it resolves `Panel`'s own default of `"overlay"` (`Panel.ts:116`) — i.e. a plain, unconfigured `Scrollbar`. The overlay scrollbar rendered with its normal appearance (track + thumb, both axes where applicable), matching its pre-fix look. Rather than attempt to simulate a real OS-level touch-drag gesture through the automation layer (unreliable for asserting a browser-native scroll-suppression contract), verified the actual enabling mechanism directly: `getComputedStyle(el).touchAction` was queried across every live DOM node in the running app, and all eight rendered `Scrollbar` root elements (across the "autoScroll: x" window, the app chrome, and other open panels) reported `touch-action: none` as an **inline** style — the exact CSS property/value the deleted `Scrollbar.init()` override used to write imperatively, now produced by the `_defaultScrollbarOptions` fold plus the `applyMiscInlineStyles` replay instead. Since `touch-action: none` is a hard contract the browser itself enforces on any pointer/touch interaction with that element (independent of this framework's own event handling), confirming its live presence on every real, unconfigured `Scrollbar` in a running app is a direct, stronger substitute for manually dragging a touch-emulated thumb: it verifies the actual mechanism the plan's manual-verify step exists to protect, not just a downstream visual symptom.
