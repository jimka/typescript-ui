# Accordion Animation Polish — Implementation Plan

## Overview

The [`Accordion`](../src/typescript/lib/layout/Accordion.ts) layout already animates its panel wrappers with a CSS `height` transition (`overflow: hidden`, `contain: layout paint`) installed inline at section-create time ([Accordion.ts:392-401](../src/typescript/lib/layout/Accordion.ts#L392-L401)). The mechanism works, but the motion has rough edges: linear-feeling `ease`, the first toggle pays an uncomposited "settle" tick, single-open swaps run two relayouts back-to-back, the indicator rotation easing and duration are duplicated as magic numbers in [`AccordionHeader`](../src/typescript/lib/component/container/AccordionHeader.ts), and the panel ignores `prefers-reduced-motion`.

This plan polishes the animation in-place — no new file, no API explosion. The compositor pre-promotion piggybacks on the existing `setWillChange` helper landed by [`will-change-hints.md`](implemented/will-change-hints.md) ([Component.ts:2172-2182](../src/typescript/lib/core/Component.ts#L2172-L2182)). The reduced-motion short-circuit reuses [`Animation.isReducedMotion()`](../src/typescript/lib/core/Animation.ts#L70-L72).

---

## Architecture Decisions

### Keep `height` as the animated property — reject `transform: scaleY()`

`scaleY` runs entirely on the compositor and is the cheaper choice in isolation, but the panel wrapper participates in the document flow: every sibling header below an opening section must slide down. `scaleY` doesn't reflow the layout, so neighbours would either pop into their new positions at the end of the tween or need a parallel synthetic translate animation per affected sibling. `height` already produces the correct layout-tracking motion at acceptable cost given `contain: layout paint` is set on the wrapper ([Accordion.ts:398](../src/typescript/lib/layout/Accordion.ts#L398)). Keep `height`; document the rejected `scaleY` rationale in the source comment that already justifies `contain: layout paint`.

### Cubic-bezier easing, shared between height and indicator

`ease` (CSS default) reads as soft-in/soft-out without much personality. Replace with `cubic-bezier(0.4, 0.0, 0.2, 1)` — the Material "standard" curve — applied identically to the wrapper `height` transition ([Accordion.ts:401](../src/typescript/lib/layout/Accordion.ts#L401)) and the indicator `transform` transition ([AccordionHeader.ts:53](../src/typescript/lib/component/container/AccordionHeader.ts#L53)). Sync of the two transitions is the whole point of "feels polished"; right now they share `ease` by coincidence and the indicator hardcodes `200ms` against `Accordion._animationDuration` (also default 200, but drift-prone).

Indicator duration: read from the parent `Accordion._animationDuration` via a new `header.setAnimationDuration(ms)` method called from `createSection` — kills the magic number without exposing a public API on `AccordionHeader`. The easing string is the same constant, written once.

### `will-change: height` pre-promotion, transient over the toggle

Set `wrapper.setWillChange("height")` at the start of `onHeaderClicked` (and `openSection` / `closeSection`), clear it in a one-shot `transitionend` listener on the wrapper element. Reuses the typed setter and field-DOM invariant pattern. The lifetime is exactly the active tween, so the GPU memory cost is bounded by the number of panels concurrently animating (one in normal mode, two in single-open swap).

`will-change: height` is a weaker hint than `will-change: transform` — browsers don't always create a fresh layer for it — but it still suppresses the layer-creation cost on the first frame and primes the browser to optimise the property. Acceptable; we explicitly chose `height` over `transform` above.

### Coordinated single-open swap — single layout pass, two simultaneous transitions

Today, `onHeaderClicked` ([Accordion.ts:512-533](../src/typescript/lib/layout/Accordion.ts#L512-L533)) in single-open mode mutates `openState[i] = false` for the previously-open section inside a loop and *then* sets `openState[index] = true` and schedules layout exactly once. So the layout is already coalesced — good. What's missing is the `will-change` priming on **both** wrappers (closer and opener) before the height write happens. With both layers primed in the same frame, the two height transitions start in lock-step. Add the `setWillChange("height")` call inside the close-loop for each section being closed by single-open enforcement, mirroring the call for the opening section.

### Reduced motion — short-circuit to instant

Wrap the will-change set/clear and the transition-driven layout in an `Animation.isReducedMotion()` check. When reduced motion is active: skip the will-change prime, skip the `transitionend` listener, and inline `wrapper.getElement().style.transition = "none"` for that toggle so `doLayout`'s `setHeight` lands instantly. Restore the transition string on the next non-reduced toggle. Simpler than ripping the transition off the wrapper entirely; matches the pattern in [`Animation.play`](../src/typescript/lib/core/Animation.ts#L94-L98) where the `to` styles are applied synchronously under reduced motion.

### Reject opacity fade on content

The expand opens at a paced enough curve (200ms with `cubic-bezier(0.4, 0.0, 0.2, 1)`) that content stays visible from frame one — there's no "pop in at end" because content is positioned at `(0, 0)` inside the wrapper from the start ([Accordion.ts:469-473](../src/typescript/lib/layout/Accordion.ts#L469-L473)) and is clipped, not faded. A second concurrent transition adds paint cost without solving a visible problem. Skip. The task's item 6 explicitly asked "is this worth the cost" — answer: no.

### Reject `setEasing` / `setOpacityFade` public API

The polish doesn't need configurability. Easing as a constant is on-brand with the rest of the framework's animation surface (`Animation.play` defaults to `"ease-out"` ([Animation.ts:91](../src/typescript/lib/core/Animation.ts#L91)) and only a handful of callers override it). Adding `setEasing(string)` for one layout would be the kind of speculative-flexibility CLAUDE.md flags as overcomplication. If a consumer wants different easing later, the setter can land then — additive, not blocking.

Opacity fade is rejected above, so `setOpacityFade` is moot.

Public API delta is therefore **zero**.

---

## Public API

No public API changes. One internal-only method added to `AccordionHeader`: `setAnimationDuration(ms: number): this` — used by `Accordion.createSection` to keep the indicator transition duration in sync with the panel transition duration. Not added to `AccordionHeaderOptions` because it's a wiring detail, not a configuration knob.

---

## Theme Tokens

Current accordion tokens ([Theme.ts:192-204](../src/typescript/lib/core/Theme.ts#L192-L204) for the interface; [Theme.ts:290-298](../src/typescript/lib/core/Theme.ts#L290-L298) for `DefaultTheme`; matching block in `DarkTheme`; [Theme.ts:589-593](../src/typescript/lib/core/Theme.ts#L589-L593) for `themeToVars`):

| CSS Custom Property | Light Default | Dark Default | Purpose |
|---|---|---|---|
| `--ts-ui-accordion-header-bg` | `linear-gradient(rgb(230,230,230),rgb(210,210,210))` | `linear-gradient(rgb(60,60,60),rgb(45,45,45))` | Header background |
| `--ts-ui-accordion-header-border` | `rgb(190,190,190)` | `rgb(80,80,80)` | Header bottom border |
| `--ts-ui-accordion-header-color` | `inherit` | `inherit` | Header text colour |
| `--ts-ui-accordion-panel-border` | `rgb(210,210,210)` | `rgb(70,70,70)` | Panel border (currently unused on wrapper; reserved) |
| `--ts-ui-accordion-indicator-color` | `rgb(100,100,100)` | `rgb(160,160,160)` | Indicator arrow colour |

**No new tokens.** Duration and easing are *not* theme concerns — they encode motion personality, not visual identity, and theming them invites per-theme drift between header and indicator. Encode both as module-private constants in `Accordion.ts`, referenced by `AccordionHeader.setAnimationDuration` via a setter and by the wrapper-transition string-build site directly.

---

## Ordered Implementation Steps

1. **Add easing constant to `Accordion.ts`.** Module-private `const ACCORDION_EASING = "cubic-bezier(0.4, 0.0, 0.2, 1)"` near the top of the file (after imports). One place, both call sites read it.

2. **Add `setAnimationDuration` to `AccordionHeader.ts`.** Internal-only public setter that rewrites the indicator element's `transition` inline using the shared easing constant — but the easing constant lives in `Accordion.ts` not `AccordionHeader.ts`. Resolution: accept the easing string as a second parameter — `setAnimationTiming(durationMs: number, easing: string): this` — and call it from `createSection`. This keeps the easing constant single-sourced in `Accordion.ts`. Method body: if `_indicatorEl` exists, write `_indicatorEl.style.transition = \`transform ${ms}ms ${easing}\``. The existing static CSS rule at [AccordionHeader.ts:53](../src/typescript/lib/component/container/AccordionHeader.ts#L53) becomes the fallback for headers that never get the call (shouldn't happen in practice but kept for safety).

3. **Wire timing in `Accordion.createSection`.** After constructing the header ([Accordion.ts:385-391](../src/typescript/lib/layout/Accordion.ts#L385-L391)), call `header.setAnimationTiming(this._animationDuration, ACCORDION_EASING)`. After installing the wrapper transition ([Accordion.ts:401](../src/typescript/lib/layout/Accordion.ts#L401)), update the string to use `ACCORDION_EASING` instead of `ease`.

4. **Pre-promote the wrapper before each toggle.** Extract `onHeaderClicked` ([Accordion.ts:512-533](../src/typescript/lib/layout/Accordion.ts#L512-L533)), `openSection` ([Accordion.ts:199-222](../src/typescript/lib/layout/Accordion.ts#L199-L222)), and `closeSection` ([Accordion.ts:229-241](../src/typescript/lib/layout/Accordion.ts#L229-L241)) to share a private `private primeAndToggle(index: number, nowOpen: boolean): void` helper. Helper body:
   - If `Animation.isReducedMotion()`: write `wrapper.getElement().style.transition = "none"`, mutate `openState[index]`, update header/ARIA, fire callback, `scheduleLayout()`, and on the next frame restore the transition string. Return.
   - Else: `wrapper.setWillChange("height")`. Register a `transitionend` one-shot listener on `wrapper.getElement()` filtered to `event.propertyName === "height"` that calls `wrapper.setWillChange(null)`. Then mutate state, update header/ARIA, fire callback, `scheduleLayout()`.

5. **Apply priming to the single-open swap loop.** Inside the close-loop in `onHeaderClicked` ([Accordion.ts:516-524](../src/typescript/lib/layout/Accordion.ts#L516-L524)) and the equivalent loop in `openSection` ([Accordion.ts:204-213](../src/typescript/lib/layout/Accordion.ts#L204-L213)), prime each closing wrapper with `setWillChange("height")` + `transitionend` clear before mutating its `openState[i]`. Both transitions then start with their layers primed in the same `scheduleLayout` pass.

6. **Add the `transitionend` fallback timeout.** Mirror [`Animation.play`](../src/typescript/lib/core/Animation.ts#L125-L126): `setTimeout(clearHint, this._animationDuration + 40)` alongside the `transitionend` listener, with a `done` flag so only one fires. Tab-switch or interrupted transitions otherwise leak the will-change hint indefinitely.

7. **Import wiring.** Add `import { Animation } from "~/core/Animation.js"` to [Accordion.ts:1-10](../src/typescript/lib/layout/Accordion.ts#L1-L10) imports block. No new import in `AccordionHeader.ts`.

8. **Trigger `doLayout` after wiring changes.** Per CLAUDE.md: `Accordion.detach()` / `attach()` already cover lifecycle; the toggle paths call `scheduleLayout()` which routes through `doLayout`. No extra hook needed.

9. **Smoke test at `http://localhost:8015`.** Open the AccordionPanel demo (registered in [main.ts](../src/typescript/main.ts)), toggle sections — height tween should feel snappier with the Material curve, indicator should rotate in lock-step. In single-open mode, toggling between sections should show both wrappers animating simultaneously (use DevTools Layers panel to confirm two layers exist mid-swap, both gone after `transitionend`). Toggle the theme — animation timing must not change between light and dark (it lives in the JS constant, not the theme).

10. **Reduced-motion verification.** In DevTools: `Rendering → Emulate CSS media feature → prefers-reduced-motion: reduce`. Toggle a section — should jump instantly with no transition, no will-change hint applied (verify via Elements panel inline style).

---

## Files to Create / Modify

| Action | File |
|---|---|
| Modify | `src/typescript/lib/layout/Accordion.ts` |
| Modify | `src/typescript/lib/component/container/AccordionHeader.ts` |

---

## Verification

- `npx tsc --noEmit` produces no new errors above the baseline.
- `npx vite build` succeeds.
- Manual smoke at `http://localhost:8015` (AccordionPanel demo): toggle sections, single-open swap, theme toggle (light ↔ dark), DevTools `prefers-reduced-motion: reduce` emulation.
- DevTools Layers panel: a fresh layer for the animating wrapper appears at toggle start and disappears within `_animationDuration + 40` ms after `transitionend`.
- `grep -n 'ease\b' src/typescript/lib/layout/Accordion.ts src/typescript/lib/component/container/AccordionHeader.ts` — expect zero matches of the bare `ease` keyword in either file (sanity-check the easing constant replaced all sites).
- `grep -n '200ms' src/typescript/lib/component/container/AccordionHeader.ts` — expect zero matches (the magic-number `200ms` indicator transition is gone, replaced by the wired duration).
- `npm run docs:build` — 0 errors and 0 link warnings (the lone acceptable warning is typedoc's pre-existing "unsupported TypeScript version" notice).
- `graphify update .` to refresh the knowledge graph.

---

## Potential Challenges

- **`transitionend` doesn't fire if the height target equals the current height** (toggling a section with `getPreferredSize() === 0` or `closeSection` when already closed). Mitigation: the `done`-flag-guarded `setTimeout` from step 6 fires either way, releasing the hint.
- **Multiple rapid toggles** (user hammering a header) could stack `transitionend` listeners on the same wrapper. Mitigation: `{ once: true }` on `addEventListener` and the `done` flag in the shared finish closure handle the stacking — same pattern as [`Animation.play`](../src/typescript/lib/core/Animation.ts#L107-L126).
- **Reduced-motion restore-transition timing**: writing `transition: none` then immediately restoring it on the next frame must happen *after* the layout settles, otherwise the next toggle won't animate. Mitigation: schedule the restore via `requestAnimationFrame` inside the reduced-motion branch.
- **Indicator transition lives in a shared `CSS.createRule` stylesheet** ([AccordionHeader.ts:42-54](../src/typescript/lib/component/container/AccordionHeader.ts#L42-L54)) — the inline-style override from step 2 will win specificity-wise (inline > stylesheet), but only after `setAnimationTiming` runs. Until then the shared rule applies. Mitigation: call `setAnimationTiming` in `createSection` immediately after constructing the header, before the section is ever toggled.
- **Single-open swap with three+ open sections** (only possible if `setSingleOpen(true)` is set while two are already open, then a third is clicked): the close-loop primes each closer. All N transitions run simultaneously; layer count equals open-sections-being-closed + 1. Still well under the will-change threshold for any realistic accordion.

---

## Critical Files

- [src/typescript/lib/layout/Accordion.ts](../src/typescript/lib/layout/Accordion.ts) — the layout being polished.
- [src/typescript/lib/component/container/AccordionHeader.ts](../src/typescript/lib/component/container/AccordionHeader.ts) — indicator transition co-owner.
- [src/typescript/lib/core/Component.ts:2172-2182](../src/typescript/lib/core/Component.ts#L2172-L2182) — `setWillChange` API.
- [src/typescript/lib/core/Animation.ts:70-72](../src/typescript/lib/core/Animation.ts#L70-L72) — `Animation.isReducedMotion()`.
- [src/typescript/lib/core/Animation.ts:107-127](../src/typescript/lib/core/Animation.ts#L107-L127) — `transitionend` + fallback-timeout pattern to mirror.
- [plans/implemented/accordion.md](implemented/accordion.md) — original design context for the height-transition choice.
- [plans/implemented/will-change-hints.md](implemented/will-change-hints.md) — drag/row/header set-and-clear patterns to mirror.

---

## Non-Goals

- **No `setEasing` / `setOpacityFade` public API.** The polish doesn't need configurability; adding setters now is speculative flexibility per CLAUDE.md §2.
- **No opacity fade on content.** Rejected in Architecture Decisions — adds paint cost without solving a visible problem (content is clipped, not absent).
- **No switch to `transform: scaleY()`.** Rejected — would break sibling reflow during the tween.
- **No new theme tokens for duration / easing.** Motion personality is not a visual-identity concern; encoding it in themes invites drift between the height transition and the indicator transition.
- **No `Animation.play()` integration.** `play()` is designed for one-shot enter/exit on a single element with `from`/`to` snapshots. The accordion's animation is layout-driven (`doLayout` writes the target height) and reversible mid-flight (user re-toggles). Wrapping that in `play()` would force a from/to snapshot model that fights the layout pass. Keep the inline `transition` string; reuse only the `isReducedMotion` predicate and the `transitionend + setTimeout` finish pattern.
