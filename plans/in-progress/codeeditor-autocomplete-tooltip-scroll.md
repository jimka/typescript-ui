---
depends-on: codeeditor-format-defaults-tabsize
touches-shared: [packages/lib/src/typescript/lib/core/Component.ts]
---

# CodeEditor Autocomplete Tooltip Wheel Scrolling — Implementation Plan

## Overview

Open the completion tooltip in a `CodeEditor` (Ctrl-Space), put the pointer over the suggestion list, and turn the wheel: the list stays put and the editor's document scrolls instead. The list is natively scrollable — CodeMirror styles it `overflow: hidden auto` with a `10em` cap ([node_modules/@codemirror/autocomplete/dist/index.js:1310-1318](node_modules/@codemirror/autocomplete/dist/index.js#L1310)) — but the browser never gets the chance to scroll it, because the framework claims the wheel first and calls `preventDefault()`.

The claim comes from [`Component.onWheelScroll`](packages/lib/src/typescript/lib/core/Component.ts#L4679), the handler behind the framework's eased wheel scroller. `CodeEditor` opts into that scroller through its `overflow: "auto"` default ([CodeEditor.ts:127-139](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L127)), and the handler is registered as a **subtree** listener ([Component.ts:4627](packages/lib/src/typescript/lib/core/Component.ts#L4627)) — it fires for any event whose target is a DOM descendant of the component's element ([Event.ts:301-347](packages/lib/src/typescript/lib/core/Event.ts#L301)). CodeMirror's tooltip DOM *is* such a descendant: with no `parent` configured, the tooltip manager parents every tooltip on `view.dom`, i.e. `.cm-editor` ([node_modules/@codemirror/view/dist/index.js:10331-10340](node_modules/@codemirror/view/dist/index.js#L10331)). Nothing in the framework's wheel path distinguishes DOM a component owns from foreign DOM nested inside it, so `CodeEditor` claims the gesture and redirects it to `.cm-scroller`. The claim is conditional on the editor's own document having somewhere to scroll, which is why the bug only shows with a document longer than the visible box — a short document leaves the wheel unclaimed and the list scrolls fine today.

The fix adds one opt-in question to the framework's wheel path — *is this wheel over foreign DOM that scrolls itself?* — and answers it in `CodeEditor` for CodeMirror's tooltips. Two files change: [`core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) gains a `protected` hook that defaults to "no", and [`component/editor/CodeEditor.ts`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts) overrides it. Nothing exported changes.

---

## Architecture Decisions

### Carve the tooltip out of the wheel claim, rather than moving the tooltip out of the editor

`CodeEditor` keeps CodeMirror's default tooltip placement (inside `.cm-editor`) and instead declines to claim wheels that land on a `.cm-tooltip`. The alternative — giving CodeMirror's `tooltips()` facet a `parent` outside the component tree — was investigated and rejected.[^why-carve-out]

This mirrors [`isScrollbarTarget`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L485) (`component/container/Scrollbar.ts:485`), the codebase's existing answer to this exact problem shape: a blanket subtree handler over-claims events that land on nested DOM it does not own, so the handler consults a predicate that climbs from the event's real target in handle space and matches a class. `isScrollbarTarget` exists because a dropdown's blanket `pointerdown` guard broke scrollbar dragging; this predicate exists because a component's blanket `wheel` guard breaks tooltip scrolling. Same shape, same fix.[^scrollbar-precedent]

### The seam is a narrow `protected` question on `Component`, not an overridable `onWheelScroll`

`Component.onWheelScroll` stays `private`. It gains one call at the top to a new `protected isForeignWheelTarget(e)`, which returns `false` in the base class and is overridden only by `CodeEditor`.[^narrow-hook]

`Component` must own the call because a subclass cannot get ahead of the base's handler on its own: `refreshWheelScrolling` registers `onWheelScroll` during `applyOptions`, inside `super()`, before any subclass constructor body runs — so a subclass-registered `wheel` listener is always second in the same component's listener list, and by then the base has already claimed and prevented the event.

### A carved-out wheel is claimed, not released

When `isForeignWheelTarget` returns `true`, `onWheelScroll` calls `consumeWheel(e)` and returns with no disposition — no scroll, no `preventDefault()`. Claiming (rather than simply returning) stops an ancestor scroll container from taking the gesture instead; not preventing leaves the browser to scroll the foreign element natively.[^claim-without-prevent]

The routing this produces, per pointer position inside a `CodeEditor`:

| Pointer is over | `isForeignWheelTarget` | Result |
|---|---|---|
| a document line (`.cm-line`) | `false` | Editor claims and prevents; eased scroll of `.cm-scroller`. Unchanged. |
| the gutter (`.cm-gutters`) | `false` | Eased scroll of `.cm-scroller`. Unchanged. |
| a completion list row (`.cm-tooltip-autocomplete li`) | `true` | Claimed, not prevented; the browser scrolls the list's own `ul`. **This is the fix.** |
| a hover/lint tooltip (`.cm-tooltip-lint`) | `true` | Claimed, not prevented; the tooltip is not scrollable, so the browser chains to `.cm-scroller` and the document scrolls natively rather than eased. |
| a completion list row, with an `autoScroll` `Panel` hosting the editor | `true` | The panel's own handler runs next, finds the wheel already claimed, and does nothing. |

---

## Internal Structure

### `Component` — the hook and its one call site

Added immediately above `onWheelScroll` (after `writeNativeScroll`, which currently ends at [Component.ts:4661](packages/lib/src/typescript/lib/core/Component.ts#L4661)):

```typescript
/**
 * Whether `e` landed on foreign DOM — DOM nested inside this component's
 * element that the component did not create and does not scroll, such as a
 * third-party widget's own floating panel. Such DOM scrolls itself through
 * the browser's native handling, so the eased wheel scroller must stay out
 * of its way.
 *
 * @param _e - The wheel event being routed. The default implementation
 *   ignores it.
 * @returns `true` to leave the gesture to the browser. `false` in the base
 *   class: an ordinary component's subtree is entirely its own.
 */
protected isForeignWheelTarget(_e: WheelEvent): boolean {
    return false;
}
```

`onWheelScroll` gains one guard as its first statement, before the axis tests:

```typescript
private onWheelScroll(e: WheelEvent): Event.ListenerResult {
    if (this.isForeignWheelTarget(e)) {
        // Claim so no ancestor scroller takes the gesture, but do not
        // prevent: the browser scrolls the foreign element itself.
        consumeWheel(e);

        return;
    }

    const canX = ...
```

`consumeWheel` is already imported at [Component.ts:18](packages/lib/src/typescript/lib/core/Component.ts#L18); no new imports.

### `CodeEditor` — the override

A new module constant beside the existing CodeMirror selectors ([CodeEditor.ts:141-151](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L141)):

```typescript
/** Every CodeMirror tooltip root — the completion list, hover and lint tooltips. */
const CM_TOOLTIP_SELECTOR = ".cm-tooltip";
```

And the override, placed next to `getScrollElement` ([CodeEditor.ts:1152](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1152)) since both are seams into the same scroll plumbing:

```typescript
protected isForeignWheelTarget(e: WheelEvent): boolean {
    if (!DOM.source.isNode(e.target)) {
        return false;
    }

    const root = this.getElement();

    for (let handle: Handle | null = DOM.source.intern(e.target); handle; handle = DOM.source.getParentElement(handle)) {
        if (DOM.source.matches(handle, CM_TOOLTIP_SELECTOR)) {
            return true;
        }

        if (handle === root) {
            return false;
        }
    }

    return false;
}
```

The climb stops once it has tested this component's own element, so a wheel over ordinary editor content costs a handful of `matches` calls rather than a walk to `<html>`.[^bounded-climb] `DOM` and `Handle` are already imported at [CodeEditor.ts:5-6](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L5); no new imports.

---

## Ordered Implementation Steps

1. **Write the failing tests first**, in `packages/lib/tests/component/code-editor.test.ts`, inside the existing `describe('CodeEditor smooth scrolling')` block (currently starting at line 2224). Add `makeEvent` to the existing `../dom/TestDOM` import. Model the cases in `## Expected Behaviour` below; the offline harness has no selector engine, so each test stubs `DOM.source.matches` with `vi.spyOn` exactly as [`Scrollbar.test.ts:692-724`](packages/lib/tests/component/container/Scrollbar.test.ts#L692) does.[^offline-matches] Run `npx vitest run tests/component/code-editor.test.ts` from `packages/lib` — expect the new tests to fail.
2. **Add the hook to `Component`.** In `packages/lib/src/typescript/lib/core/Component.ts`, insert `isForeignWheelTarget` after `writeNativeScroll` (ends line 4661) and add the guard as the first statement of `onWheelScroll` (line 4679), both exactly as given in `## Internal Structure`.
3. **Override it in `CodeEditor`.** In `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts`, add `CM_TOOLTIP_SELECTOR` beside the other `CM_*` selector constants (after line 151) and `isForeignWheelTarget` beside `getScrollElement` (line 1152).
4. **Re-run the editor tests** — `npx vitest run tests/component/code-editor.test.ts` from `packages/lib`. All new tests pass.
5. **Check the base default did not move.** Run `npx vitest run tests/core/PanelScrollChaining.test.ts` from `packages/lib`; every existing case must still pass, which is what pins `isForeignWheelTarget`'s `false` default for an ordinary scrolling component.
6. **Run the full suite and typecheck**: `npm test` and `npm run typecheck` from the repo root.
7. **Run lint**: `npm run lint` from the repo root. The `no-raw-dom` rule sees `e.target` guarded by `DOM.source.isNode` / `DOM.source.intern`, the same shape it already accepts in `isScrollbarTarget`.
8. **Update the docs**, per `## Documentation Impact`: one sentence in `packages/lib/docs/components/CodeEditor.md`'s wheel-scrolling paragraph (line 7), one in its `## Autocompletion` section (line 220), and one bullet in `packages/lib/docs/reference/changelog/next.md` under `## Fixed` → `### Components` (line 242).
9. **Verify live in the browser**, following the manual steps in `## Verification`. Offline tests cannot deliver a real wheel or scroll a real element, so this step is the only proof the user-visible bug is gone.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` |
| Modify | `packages/lib/tests/component/code-editor.test.ts` |
| Modify | `packages/lib/docs/components/CodeEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Offline-testable — `onWheelScroll` and `isForeignWheelTarget` are both reachable through a cast, as [`PanelScrollChaining.test.ts:60-66`](packages/lib/tests/core/PanelScrollChaining.test.ts#L60) already does for the former:

1. **A wheel whose target sits under a `.cm-tooltip` ancestor is a foreign target.** Build a modelled chain `editor element → tooltip → ul → li` with `DOM.sink.createElement` / `DOM.sink.appendChild`, stub `DOM.source.matches` to answer `true` only for the tooltip handle against `.cm-tooltip`, then `(editor as any).isForeignWheelTarget(makeEvent(li, 'wheel', { deltaY: 120 }))` is `true`.
2. **A wheel whose target is ordinary editor content is not.** With `DOM.source.matches` stubbed to `false`, the same call against a child of the editor element is `false`.
3. **A wheel with a non-node target is not.** `(editor as any).isForeignWheelTarget({ target: null })` is `false` and does not throw.
4. **The climb stops at the component's own element.** Build `outer → editor element → child` (`DOM.sink.appendChild(outer, editorElement)`), stub `matches` to answer `true` only for `outer`, and the result for a wheel on `child` is `false` — the walk stops before reaching `outer`.
5. **A foreign-target wheel is claimed but not prevented.** With case 1's chain staged, `(editor as any).onWheelScroll(e)` returns `undefined` — not `{ prevent: true }` — and `(e as any)._tsScrollConsumed` is `true`.
6. **An ordinary wheel still claims and prevents.** With `matches` stubbed `false` and `DOM.source.getScrollMetrics` stubbed to give the editor vertical extent (`scrollHeight` 900, `clientHeight` 300, `scrollWidth === clientWidth`), `onWheelScroll` returns `{ prevent: true }` and marks the event consumed — today's behaviour, unchanged.
7. **The base class answers `false`.** Every existing case in `tests/core/PanelScrollChaining.test.ts` still passes, unchanged: an ordinary `Panel` with scrollable extent claims and prevents.

Manual verification only — the offline sink delivers no real wheel events, models no native overflow, and never mounts a CodeMirror view, so none of these can be automated:

8. With the completion tooltip open and the pointer over the suggestion list, wheeling scrolls **the list**; the document behind it does not move.
9. With the completion tooltip open and the pointer over the document (not the list), wheeling scrolls the document with the usual eased glide, and the tooltip follows the cursor position as it always did.
10. With no tooltip open, wheeling anywhere in the editor is unchanged.
11. A `CodeEditor` inside a scrolling host (a rendered `Markdown` document's fenced block) still scrolls its list rather than the host document.

---

## Verification

Automated, from the repo root:

- `npm run typecheck` — clean.
- `npm test` — the full suite, including the new cases above and the untouched `tests/core/PanelScrollChaining.test.ts`.
- `npm run lint` — clean; in particular `no-raw-dom` accepts the guarded `e.target` use.
- `grep -rn "isForeignWheelTarget" packages/lib/src/` — exactly three hits: the declaration and its call site in `Component.ts`, and the override in `CodeEditor.ts`.

Manual, in a real browser (this is a live-only component; the checks below are the only ones that exercise the actual bug):

1. `npm run dev` from the repo root, then open `http://localhost:8015/#/codeeditor`.
2. Click into the main JavaScript editor and press **Ctrl-Space** to open the completion list. If the list is too short to scroll, type `c` first so more entries match.
3. Move the pointer over the suggestion list and wheel down, then up. **Expect:** the list scrolls; the code behind it does not move (behaviour 8). The sample document must be long enough to scroll for this to be a real test — if the editor's own scrollbar is absent, add lines until it appears.
4. Move the pointer off the list, onto the code, and wheel. **Expect:** the document scrolls with the usual glide and the tooltip stays anchored to the cursor (behaviour 9).
5. Press Escape to close the list, then wheel over the document and the gutter. **Expect:** unchanged eased scrolling (behaviour 10).
6. Switch to the **Markdown** demo section, scroll to a fenced code block that has upgraded to a live editor, click into it, press Ctrl-Space, and wheel over the list. **Expect:** the list scrolls; neither the fenced editor nor the surrounding document moves (behaviour 11).

Screenshots or a short capture of steps 3 and 6 are worth attaching to the change, since neither is covered by a test.

---

## Documentation Impact

No exported symbol changes: `isForeignWheelTarget` is `protected` on both classes, and TypeDoc excludes `protected` members, so `npm run docs:api` has nothing new to render and no `{@link}` constraints apply. The changes are prose only.

- **`packages/lib/docs/components/CodeEditor.md`, line 7** (the wheel-scrolling paragraph). Add a closing sentence: wheels that land on one of CodeMirror's own floating tooltips are left to the browser, so a tooltip that scrolls itself — the completion list — does.
- **`packages/lib/docs/components/CodeEditor.md`, `## Autocompletion`** (line 220). Add a sentence stating that a completion list longer than its `10em` cap scrolls with the wheel as well as with the arrow keys.
- **`packages/lib/docs/reference/changelog/next.md`, `## Fixed` → `### Components`** (line 242). Add a bullet: the mouse wheel now scrolls `CodeEditor`'s completion list when the pointer is over it, instead of scrolling the document behind it; the framework's eased wheel scroller no longer claims wheels that land on CodeMirror's own tooltips. No consumer action is needed.

`packages/lib/llms.txt` is generated (`npm run docs:llms`) and needs no hand edit.

---

## Potential Challenges

- **The offline harness cannot prove the fix works, only that the routing decision is right.** `TestDOM.matches` is an unconditional `false` stub and no native scrolling exists offline, so the browser steps in `## Verification` are mandatory, not optional.
- **`DOM.source.matches` runs per wheel tick.** The climb is bounded at the component's own element, so it is a small constant number of calls — far cheaper than the `getScrollMetrics` reflow `onWheelScroll` already performs on the same tick. Do not remove the `handle === root` stop.
- **Wheeling over a non-scrollable tooltip (lint, hover) now scrolls the document natively rather than with the eased glide**, because the framework deliberately stops driving that gesture. This is a visible but minor difference confined to the moments a tooltip is under the pointer; if it is ever judged wrong, narrow the selector to `.cm-tooltip-autocomplete` rather than reintroducing the claim.
- **The scroll-offset cache can go stale when a native chain moves `.cm-scroller`.** `getScrollLeft` / `getScrollTop` are already documented as authoritative only while the scroll is driven through their setters, and `SmoothScroller.scrollBy` re-seeds from a live read at the start of every fresh gesture, so no new correction is needed here.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/container/Scrollbar.ts:454-498`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L454) — `isScrollbarTarget`, the precedent this fix mirrors. Read its JSDoc: it states the general rule for a blanket subtree guard meeting DOM it does not own.
- [`packages/lib/tests/component/container/Scrollbar.test.ts:681-724`](packages/lib/tests/component/container/Scrollbar.test.ts#L681) — how that predicate is tested offline against `TestDOM`'s missing selector engine. The new tests copy this.
- [`packages/lib/src/typescript/lib/core/Component.ts:4590-4702`](packages/lib/src/typescript/lib/core/Component.ts#L4590) — `refreshWheelScrolling`, `attachWheelScrolling`, `writeNativeScroll`, `onWheelScroll`: the whole wheel pipeline being changed.
- [`packages/lib/src/typescript/lib/core/SmoothScroller.ts:14-41`](packages/lib/src/typescript/lib/core/SmoothScroller.ts#L14) — `consumeWheel` and its descendant-first claim contract.
- [`packages/lib/src/typescript/lib/core/Event.ts:296-347`](packages/lib/src/typescript/lib/core/Event.ts#L296) — the subtree ancestor walk that delivers the tooltip's wheel to `CodeEditor` in the first place.
- [`packages/lib/src/typescript/lib/component/editor/CodeEditor.ts:127-151`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L127) and [`:1136-1335`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1136) — the `overflow: "auto"` default that installs the scroller, the `CM_*` selector constants, `getScrollElement`, and `mount`.
- [`packages/lib/tests/core/PanelScrollChaining.test.ts`](packages/lib/tests/core/PanelScrollChaining.test.ts) — the existing offline coverage of `onWheelScroll`'s claim rules, and the source of the private-handler test idiom.

---

## Non-Goals

- **Re-parenting CodeMirror's tooltips.** The `tooltips()` facet's `parent` option stays unset; see the decision above and its footnote for why.
- **Registering CodeMirror's tooltip with `LayerManager`.** The tooltip stays inside `.cm-editor`, so it inherits the editor's stacking context and needs no band, no z-index stamp, and no dismissal wiring.
- **`trapWheel` / `untrapWheel` on the tooltip.** `WheelTrap` exists to stop *unclaimed* wheels falling through to content behind a portaled overlay; the tooltip is not portaled and its wheels are claimed, so there is nothing to trap.
- **Wheel handling over CodeMirror's search panel (`.cm-panels`).** The search panel is not scrollable and is not a `.cm-tooltip`, so it is untouched by this change.
- **A general "claim only wheels landing inside `getScrollElement()`" rule in `Component`.** It reads as the principled generalisation but breaks `Panel`'s overlay-scrollbar mode, whose `Scrollbar` widgets are appended as *siblings* of the inner scroll element ([`Panel.installOverlayScrollbars`](packages/lib/src/typescript/lib/core/Panel.ts#L1042)) — a wheel over an overlay scrollbar would stop scrolling its panel.

---

## Notes

[^why-carve-out]: The rejected alternative was to hand CodeMirror's `tooltips()` facet a `parent` element outside the component tree, so the tooltip DOM stops being a descendant of `CodeEditor`'s element and the subtree walk excludes it with no new logic. It does not stay that cheap. Three things break, all confirmed in the third-party source. **Stacking:** CodeMirror's base theme gives `.cm-tooltip` `z-index: 500` ([node_modules/@codemirror/view/dist/index.js:10558-10559](node_modules/@codemirror/view/dist/index.js#L10558)). Today it sits inside `.cm-editor` and therefore inside whatever stacking context hosts the editor, so an editor in a `Window` (z-index band 9000) paints its tooltip above that window. Portaled to `document.documentElement` — the project's only portal idiom, [`LayerManager.mount`](packages/lib/src/typescript/lib/core/LayerManager.ts#L253) — the tooltip lands in the root stacking context at z 500 and paints *behind* every framework overlay band. Fixing that means creating a host element, stamping it from `LayerManager.Band`, and tearing it down on `destructor`. **Dismissal:** `LayerManager.handleOutside` decides "inside" by `DOM.source.contains(layerElement, target)` ([LayerManager.ts:585-643](packages/lib/src/typescript/lib/core/LayerManager.ts#L585)). A portaled tooltip is outside every layer, so clicking a completion item inside an editor hosted in a `click-outside` or `blur` layer would dismiss that layer. **Seam cost:** `tooltips({ parent })` needs a real `HTMLElement`, which only `DOM.sink.mountView` produces ([DOM.ts:860](packages/lib/src/typescript/lib/core/DOM.ts#L860)), forcing a nested `mountView` around the existing one in `mount()`. Set against that, the carve-out is two small methods and changes no third-party behaviour at all. One thing the investigation *cleared* rather than counted against portaling: CodeMirror would still reposition correctly, because the tooltip plugin repositions from an `eventObservers: { scroll }` observer ([view/dist/index.js:10547-10551](node_modules/@codemirror/view/dist/index.js#L10547)) fed by native `scroll` listeners the DOM observer installs on every scrollable ancestor of the content ([view/dist/index.js:7292-7318](node_modules/@codemirror/view/dist/index.js#L7292)), and `SmoothScrollTarget.write` assigns `.cm-scroller`'s `scrollTop` through `DOM.sink.apply` ([DOM.ts:396-397](packages/lib/src/typescript/lib/core/DOM.ts#L396)), which fires that native event. Repositioning was never the problem; stacking and dismissal were.

[^scrollbar-precedent]: `isScrollbarTarget` was introduced because `Panel.installOverlayScrollbars` appends `Scrollbar` widgets as raw children outside the `Component` tree, so a dropdown's blanket `pointerdown` guard could not recognise one by walking `getParentComponent()` and `preventDefault()`ed the press — which suppressed the synthesized `mousedown` the scrollbar's drag is wired to. Its two callers, `TimePickerDropdown` and `AbstractCalendarDropdown`, consult it before preventing. The structural match to this bug is exact: a handler registered over a whole subtree, foreign DOM nested inside that subtree, and a target-climbing predicate that carves the foreign DOM out. It is exported from its own module but deliberately absent from the `component/container` barrel, so it never reaches the public API docs; `isForeignWheelTarget` stays off that surface too, by being `protected`.

[^narrow-hook]: The smaller diff would be widening `Component.onWheelScroll` from `private` to `protected` and letting `CodeEditor` override it wholesale — TypeScript forbids overriding a `private` member, which is the only reason that is a change at all. It was rejected because a wholesale override duplicates the base's axis tests, its `consumeWheel` call, and its disposition contract in every subclass that ever needs the carve-out, and any one of them can get the claim ordering wrong. A single question with a `false` default keeps the claim logic in one place and makes the subclass's job unmistakable. `Component` already carries a sibling seam of exactly this shape for the same subsystem — `protected getScrollElement()` at [Component.ts:1279](packages/lib/src/typescript/lib/core/Component.ts#L1279), documented as the override point for a subclass whose scroll happens on an inner element, and which `CodeEditor` already overrides.

[^claim-without-prevent]: Merely returning without claiming looks equivalent and is not. The dispatch walks ancestors after the editor ([Event.ts:301-347](packages/lib/src/typescript/lib/core/Event.ts#L301)), so an unclaimed wheel reaches the next scroll container up — and `Markdown` upgrades fenced code blocks into live `CodeEditor`s inside a scrolling document, which is exactly that arrangement. That ancestor's `onWheelScroll` would claim the event and return `{ prevent: true }`, killing the tooltip's native scroll again while scrolling the wrong thing. Claiming without preventing blocks the ancestor (its own `consumeWheel` returns `false`) while leaving the browser's default untouched. The one consequence worth knowing: once the completion list bottoms out, the browser's native scroll chaining carries the gesture to `.cm-scroller`, so the document scrolls un-eased — which is what a native overlay does anyway.

[^bounded-climb]: `isScrollbarTarget` climbs to the document root because its callers cannot bound the walk. Here the bound is free — the predicate is only ever called from the component's own subtree listener, so the target is always a descendant of `this.getElement()`, and anything above it is irrelevant. Handle identity is stable (the registry interns weakly, and `Scrollbar.test.ts` already compares handles with `===`), so the `handle === root` stop is reliable. Without it, every wheel tick over ordinary editor content would run `Element.matches` on each ancestor up to `<html>` instead of the four or five inside the editor.

[^offline-matches]: `TestDOM`'s modelled source has no selector engine — `matches` is an unconditional `false` stub ([tests/dom/TestDOM.ts:1203-1206](packages/lib/tests/dom/TestDOM.ts#L1203)) — so offline the predicate would always answer `false` and the new branch would never be exercised. `Scrollbar.test.ts` solves this by mocking just the class match with `vi.spyOn(DOM.source, 'matches')` while letting the ancestor walk run against the harness's real modelled parent/child structure, which `DOM.sink.appendChild` populates. The new tests copy that split exactly: mock the one selector answer, keep the tree real.
