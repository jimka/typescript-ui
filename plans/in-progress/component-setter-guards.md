---
depends-on: [progress-indicator-resize-relay]
touches-shared: [packages/lib/src/typescript/lib/core/Component.ts]
---

# Component setter guards — Implementation Plan

## Overview

About half of `Component`'s typed setters compare the incoming value against the one they already hold and return early; the other half do not. An unguarded setter re-runs everything on a call that changes nothing — the style write, plus whatever else the setter does: a cache invalidation, an attribute write, a `scheduleLayout()`, a child rebuild. In the target engine (WebKitGTK, software-rendered) a stylesheet-rule mutation forces a full-document restyle **even when the written value is identical**, measured at ~195 ms/frame on a 21k-node document.[^restyle-cost]

This plan gives nineteen setters a same-value early return, chosen so the setter's **side effects** are skipped too and not merely the assignment. Twelve are in [core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts), four in [component/button/Button.ts](packages/lib/src/typescript/lib/component/button/Button.ts), and one each in [component/input/Text.ts](packages/lib/src/typescript/lib/component/input/Text.ts), [core/Aria.ts](packages/lib/src/typescript/lib/core/Aria.ts) and [core/RovingTabIndex.ts](packages/lib/src/typescript/lib/core/RovingTabIndex.ts). `Button.clearDescription` also gains a missing `dispose()` on the subtitle label it strands today.

Each guard copies one the codebase already has — in the same file, where that file has one. No new mechanism is introduced, and nothing else in `Component.ts` is touched: that file is shared with three later groups.[^shared-file]

**This plan must not start until `progress-indicator-resize-relay` has landed.** That plan converts `ProgressSpinner`, `ProgressBar` and `Slider` off `Component.setSize`, and it deliberately stops one line short of the guard this plan adds.

---

## Architecture Decisions

### Every guard mirrors an existing guard in the same file

The codebase already carries a guard for every kind of backing store in scope. Each setter takes the shape its neighbours use, so no new pattern is introduced.[^precedent]

| Backing store | Shape | Precedent | Setters taking it |
|---|---|---|---|
| Private cached field | `if (this._x === value) return this;` then assign, then write | [`setContain`](packages/lib/src/typescript/lib/core/Component.ts#L5035) (`_contain`) | `setTransform`, `setClipPath`, `setOpacity` |
| Options bag | `if (this._options.x === value) return this;` | [`clearWritingMode`](packages/lib/src/typescript/lib/core/Component.ts#L5317) (`_options.writingMode`) | `setWritingMode` |
| Options bag, multi-field value | compare each field of the stored object | [`setPadding`](packages/lib/src/typescript/lib/core/Component.ts#L2606) (four `Insets` sides) | `setInsets`, `clearInsets` |
| Layered style bag | `if (this._instanceStyle.x === value) return this;` | [`setBackgroundColor`](packages/lib/src/typescript/lib/core/Component.ts#L2691) | `setBackgroundImage`, `setOutline` |
| Layered style bag, cleared | return early when the stored key is `undefined` or `null` | [`clearBorderRadius`](packages/lib/src/typescript/lib/core/Component.ts#L3104) | `clearOutline` |
| Clamped geometry | clamp, then compare, then return | [`setWidth`](packages/lib/src/typescript/lib/core/Component.ts#L4090) | `setSize` |
| ARIA attribute map | `if (this._attributes.get(k) === v) return;` | [`Aria.setAttribute`](packages/lib/src/typescript/lib/core/Aria.ts#L791) | `Aria.clearLabel` |

`setBorder` extends the layered-style-bag row with a second comparison — see the next decision. `Button` and `Text` have no guard of their own to copy, so their four setters take the private-cached-field shape against whatever each already stores.

### `setClipPath` gets the cache it is missing

[`setClipPath`](packages/lib/src/typescript/lib/core/Component.ts#L2833) writes straight to the component's CSS rule and stores nothing, so there is no value to compare against. It gains a private `_clipPath` field and a public `getClipPath()`, matching [`setTransform`](packages/lib/src/typescript/lib/core/Component.ts#L3311) exactly.[^clippath-cache]

### `setBorder` compares the four resolved sides against **two** caches

`BorderOptions` is a bag whose four sides each fall back to the all-sides `border` string, so `{ border: "none" }` and `{ borderTop: "none", borderRight: "none", … }` paint identically. The guard therefore compares the four *resolved* side strings, never object identity.

It must also compare against two stored values, not one. `_border` is the spec the layout border-width math reads; `_instanceStyle.border` is the spec last written to CSS. [`cacheBorderSpec`](packages/lib/src/typescript/lib/core/Component.ts#L2988) updates the first without the second, and it has three live callers, so the two genuinely diverge.[^border-two-caches]

| Call | `_border` before | `_instanceStyle.border` before | Guard fires? | Why |
|---|---|---|---|---|
| `setBorder("1px solid red")` on a fresh component | `null` | `undefined` | no | nothing written yet |
| `setBorder({ border: "1px solid red" })` again | `1px solid red` ×4 | `1px solid red` ×4 | **yes** | both caches already agree |
| `setBorder({ borderTop: "1px solid red", border: "1px solid red" })` after the above | `1px solid red` ×4 | `1px solid red` ×4 | **yes** | different object, same four sides |
| `setBorder(d.border)` from a `Button` restoring its chrome | a shared class rule's spec (via `cacheBorderSpec`) | `d.border` | no | `_border` disagrees — the layout cache must be repaired |
| `setBorder(X)` right after `cacheBorderSpec(X)` | `X` | older value | no | the CSS write has not happened yet |

### `Button.setTextAlign` compares the align **and** the anchor it resolves to

`setTextAlign` does two things: it forwards the value to the inner label's CSS, and it re-anchors the content row through `_anchorForTextAlign(align)`, whose result depends on the button's current writing mode. `TabBar` relies on that: [`applyTabButtonStyles`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L2558) sets the writing mode and *then* calls `setTextAlign` with an unchanged value, precisely so the anchor is re-derived for the new reading direction. A guard on the align string alone would silently break vertical tab justification.[^textalign-anchor]

| Sequence | align changed? | anchor changed? | Guard fires? |
|---|---|---|---|
| `setTextAlign("left")` on a fresh, horizontal button | yes | `CENTER` → `WEST` | no |
| `setTextAlign("left")` again, still horizontal | no | no (`WEST`) | **yes** |
| `setWritingMode("sideways-rl")`, then `setTextAlign("left")` | no | `WEST` → `NORTH` | no |
| `setWritingMode("sideways-rl")`, then `setTextAlign("center")` | no | no (`CENTER` either way) | **yes** |

### `RovingTabIndex.moveTo` compares the index **and** the active item's `tabindex`

`moveTo` is reached both from a tab press (where the target is often already active) and from [`remove`](packages/lib/src/typescript/lib/core/RovingTabIndex.ts#L98), which calls `moveTo(max(0, idx - 1))` after splicing the list. Closing the active first tab therefore calls `moveTo(0)` while `_activeIndex` is already `0`, but the component now sitting at index 0 is a different one carrying `tabindex="-1"`. An index-only guard would leave that group with no tabbable member.[^roving-remove]

| Call | index vs `_activeIndex` | item at that index carries | Guard fires? |
|---|---|---|---|
| `moveTo(2)` while active is 0 | differs | `-1` | no |
| `moveTo(0)` while active is 0, unchanged list | same | `0` | **yes** |
| `remove(items[0])` while active is 0 → `moveTo(0)` | same | `-1` (the item that was at index 1) | no |

### `setOutline` / `clearOutline` join the scope

The review's own proof target for this group — `setRuleStyles` across ten error-free `clearError()` calls falling from 10 to 0 — runs through [`FieldDecorator.clearError`](packages/lib/src/typescript/lib/validation/FieldDecorator.ts#L84), which calls `clearOutline()`, not `setBorder`. Both outline setters are on the review's own list of fifteen unguarded setters, and both are two lines in a file this plan already edits.[^outline-scope]

### `setSize` takes over the comparison `progress-indicator-resize-relay` leaves behind

That plan adds `const changed = …` plus a guarded `notifySizeChange()` to `setSize` and changes nothing else. This plan turns that comparison into the early return and unwraps the notify call, which is then only reachable on a real change. The boundary is exact and is spelled out in *Internal Structure*.

---

## Public API

One addition. Everything else in this plan is behaviour-preserving on a changed value and has no signature change.

```typescript
class Component {
    /** Returns the CSS clip-path last passed to setClipPath, or null if none is set. */
    getClipPath(): string | null;
}
```

Backing field: `private _clipPath: string | null = null;` declared beside `_transform` ([Component.ts:599](packages/lib/src/typescript/lib/core/Component.ts#L599)). A plain initializer, not `declare` — `clipPath` is not on `ComponentOptions`, so no setter `applyOptions` dispatches ever writes it during the `super()` cascade.

---

## Internal Structure

### The border comparison helper

A module-level function in `Component.ts`, placed beside the existing private helpers `formatSizeAttr` / `roundedExtent` ([Component.ts:338-354](packages/lib/src/typescript/lib/core/Component.ts#L338)). It needs `borderToStyle`, which must be added to the existing `~/primitive/Border.js` import at [Component.ts:8](packages/lib/src/typescript/lib/core/Component.ts#L8).

```typescript
/**
 * Joins a border spec's four resolved side strings into one comparison key.
 * Each side resolves as `side ?? border ?? "none"`, so two specs with equal
 * keys paint the same border however they were authored.
 *
 * @param spec - A border spec, a bare CSS shorthand, or null/undefined.
 *
 * @returns The joined key, or null when no spec is stored.
 */
function borderSidesKey(spec: BorderOptions | string | null | undefined): string | null {
    if (spec === null || spec === undefined) {
        return null;
    }

    const sides = borderToStyle(typeof spec === "string" ? { border: spec } : spec);

    return sides.borderTop + "|" + sides.borderRight + "|" + sides.borderBottom + "|" + sides.borderLeft;
}
```

### `Component.setBorder`

```typescript
setBorder(options: BorderOptions | string): this {
    const key = borderSidesKey(options);

    // Both caches must already agree: `cacheBorderSpec` updates `_border`
    // without writing CSS, so comparing either one alone would skip a write
    // that is genuinely needed.
    if (key === borderSidesKey(this._border) && key === borderSidesKey(this._instanceStyle.border)) {
        return this;
    }

    // … existing body unchanged from `this._border = …` onward
```

### `Component.setSize`, after this plan

`progress-indicator-resize-relay` leaves the method with a `const changed = …` line and an `if (changed) { this.notifySizeChange(); }` block. Delete both and put the early return in their place; everything below stays as it is.

```typescript
setSize(size: Size): this {
    const width  = this.clampWidth(size.width);
    const height = this.clampHeight(size.height);

    if (this._width === width && this._height === height) {
        return this;
    }

    this._width  = width;
    this._height = height;

    this.notifySizeChange();

    let element = this.getElement();
    if (!element) {
        return this;
    }

    this.writeHorizontalGeometry();
    this.writeVerticalGeometry();

    this.scheduleLayout();

    return this;
}
```

`Body`'s first `setSize` runs while `_width` / `_height` are `NaN` ([Component.ts:530-531](packages/lib/src/typescript/lib/core/Component.ts#L530)), and `NaN === NaN` is false, so the initial size is never short-circuited.

### `Component.setInsets` / `clearInsets`

Both compare the four sides of `_options.insets`, exactly as `setPadding` compares the four sides of `_instanceStyle.padding`. `clearInsets` also skips allocating the zero `Insets` it would have thrown away.

```typescript
setInsets(insets: Insets): this {
    const current = this._options.insets;
    if (current &&
        current.getTop()    === insets.getTop()    &&
        current.getRight()  === insets.getRight()  &&
        current.getBottom() === insets.getBottom() &&
        current.getLeft()   === insets.getLeft()) {
        return this;
    }

    // … existing body
```

### `Button.setText`

The guard compares the stored title **and** what the inner label currently shows. The second half is required: the constructor writes `_options.text` before the content row exists and then dispatches `setText(effectiveText)` once it does ([Button.ts:814-816](packages/lib/src/typescript/lib/component/button/Button.ts#L814)), so a guard on `_options.text` alone would leave every option-configured button blank.[^button-settext-face]

```typescript
setText(text: string): this {
    const face = this._isShowText() ? text : "";

    if (this._options.text === text && this._text.getText() === face) {
        return this;
    }

    // … existing body
```

### `Button.setTextAlign`

```typescript
setTextAlign(align: string): this {
    if (this._text) {
        const constraints = this.getLayoutConstraints(this._content);
        const anchor      = this._anchorForTextAlign(align);

        // The anchor half is load-bearing: `TabBar` re-calls this with an
        // unchanged align after flipping the writing mode, to re-derive the
        // anchor for the new reading direction.
        if (this._text.getTextAlign() === align && (!constraints || constraints.anchor === anchor)) {
            return this;
        }

        this._text.setTextAlign(align);

        if (constraints) {
            constraints.anchor = anchor;
            this.scheduleLayout();
        }
    }

    return this;
}
```

### `Button.clearDescription`

Guard plus the missing dispose, mirroring [`clearGlyph`](packages/lib/src/typescript/lib/component/button/Button.ts#L1828) — capture, null the field, rebuild (which only detaches), then dispose.

```typescript
clearDescription(): this {
    const outgoing = this._description;

    if (!outgoing) {
        return this;
    }

    this._description = null;

    this._rebuildContentRow();

    // The rebuild only detaches, so dispose explicitly or the label keeps its
    // element, its `#id` rule, its theme subscription and its entry in the
    // measurement registry.
    outgoing.dispose();

    this._rebuildTooltip();
    this.recomputePreferredSize();

    return this;
}
```

### `Text.setText`

`setText` takes a `String`, so the comparison normalises both sides the same way the assignment does.

```typescript
setText(text: String): this {
    const next = (text || "").toString();

    if (this._options.text !== undefined && this._options.text.toString() === next) {
        return this;
    }

    // … existing body
```

### `RovingTabIndex.moveTo`

```typescript
const clampedIndex = Util.clamp(index, 0, this._items.length - 1);

// A repeat activation of the already-active item is a no-op. The tabindex
// half matters for `remove`, which calls `moveTo` after splicing: the item now
// at the active index may be a different one that still carries -1.
if (clampedIndex === this._activeIndex &&
    this._items[clampedIndex]?.getAria().getTabIndex() === 0) {
    return;
}

// … existing body from `const prev = …`
```

---

## Ordered Implementation Steps

All paths are from the repository root. Steps 2-13 are independent edits; run `npm run typecheck` after each and `npm test` at the checkpoints.

1. **Confirm the dependency landed.** `grep -n 'notifySizeChange' packages/lib/src/typescript/lib/core/Component.ts` — expect four hits. Zero hits means `progress-indicator-resize-relay` has not been merged; **stop and say so** rather than proceeding, because step 7 would then silently break `ProgressSpinner`'s overlay resizing.

2. **Cached-field guards** (`packages/lib/src/typescript/lib/core/Component.ts`). Add `if (this._transform === value) { return this; }` to `setTransform` ([:3311](packages/lib/src/typescript/lib/core/Component.ts#L3311)) and `if (this._opacity === value) { return this; }` to `setOpacity` ([:5345](packages/lib/src/typescript/lib/core/Component.ts#L5345)), each as the method's first statement. Do not touch `clearTransform` or `clearOpacity`.

3. **`setClipPath` cache and guard** (same file). Declare `private _clipPath: string | null = null;` beside `_transform` ([:599](packages/lib/src/typescript/lib/core/Component.ts#L599)). Add a `getClipPath()` immediately above `setClipPath` ([:2833](packages/lib/src/typescript/lib/core/Component.ts#L2833)), modelled on `getTransform` ([:3300](packages/lib/src/typescript/lib/core/Component.ts#L3300)). Give `setClipPath` the guard, then the assignment, then the existing `setElementCSSRule` call.

4. **`setWritingMode` guard** (same file, [:5303](packages/lib/src/typescript/lib/core/Component.ts#L5303)). `if (this._options.writingMode === value) { return this; }` as the first statement.

5. **Layered-style guards** (same file). `setBackgroundImage` ([:2793](packages/lib/src/typescript/lib/core/Component.ts#L2793)) gets `if (this._instanceStyle.backgroundImage === backgroundImage) { return this; }`; `setOutline` ([:3191](packages/lib/src/typescript/lib/core/Component.ts#L3191)) gets the same against `_instanceStyle.outline`; `clearOutline` ([:3202](packages/lib/src/typescript/lib/core/Component.ts#L3202)) gets `clearBorderRadius`'s shape ([:3104](packages/lib/src/typescript/lib/core/Component.ts#L3104)) — return early when `_instanceStyle.outline` is `undefined` or `null`.

6. **`setBorder` guard** (same file). Add `borderToStyle` to the `~/primitive/Border.js` import at [:8](packages/lib/src/typescript/lib/core/Component.ts#L8), add the `borderSidesKey` helper from *Internal Structure* beside `roundedExtent` ([:354](packages/lib/src/typescript/lib/core/Component.ts#L354)), and put the two-cache guard at the top of `setBorder` ([:2961](packages/lib/src/typescript/lib/core/Component.ts#L2961)). Leave `clearBorder` and `cacheBorderSpec` alone.

   Checkpoint: `npm test` green.

7. **`setSize` guard** (same file, [:3953](packages/lib/src/typescript/lib/core/Component.ts#L3953)). Replace the `const changed = …` line and the `if (changed) { this.notifySizeChange(); }` block with the early return and a bare `this.notifySizeChange();`, exactly as *Internal Structure* shows. Nothing else in the method moves.

8. **`setInsets` / `clearInsets` guards** (same file, [:2566](packages/lib/src/typescript/lib/core/Component.ts#L2566) and [:2582](packages/lib/src/typescript/lib/core/Component.ts#L2582)), per *Internal Structure*.

9. **`setValueStyleState` guard** (same file, [:6328](packages/lib/src/typescript/lib/core/Component.ts#L6328)). Compute `token` as today, then `if (this._valueStyleTokens.get(prefix)?.token === token) { return; }` before `resolvePartialDeclarations`. Everything below is unchanged.

   Checkpoint: `npm test` green. `npm run typecheck`.

10. **`Button` guards** (`packages/lib/src/typescript/lib/component/button/Button.ts`), in this order: `setGlyph` ([:1789](packages/lib/src/typescript/lib/component/button/Button.ts#L1789)) gets `if (this._glyph?.getGlyphName() === name) { return this; }`; `setText` ([:1167](packages/lib/src/typescript/lib/component/button/Button.ts#L1167)), `setTextAlign` ([:1244](packages/lib/src/typescript/lib/component/button/Button.ts#L1244)) and `clearDescription` ([:1407](packages/lib/src/typescript/lib/component/button/Button.ts#L1407)) take the bodies in *Internal Structure*. Update `clearDescription`'s JSDoc to say the removed label is destroyed, matching `clearGlyph`'s wording.

11. **`Text.setText` guard** (`packages/lib/src/typescript/lib/component/input/Text.ts`, [:828](packages/lib/src/typescript/lib/component/input/Text.ts#L828)), per *Internal Structure*. Add one sentence to its `@remarks`: an identical string writes nothing and schedules nothing.

12. **`Aria.clearLabel` guard** (`packages/lib/src/typescript/lib/core/Aria.ts`, [:754](packages/lib/src/typescript/lib/core/Aria.ts#L754)). `if (!this._attributes.has("label")) { return this; }` as the first statement — the clear-side twin of the guard `setAttribute` ([:791](packages/lib/src/typescript/lib/core/Aria.ts#L791)) already carries.

13. **`RovingTabIndex.moveTo` guard** (`packages/lib/src/typescript/lib/core/RovingTabIndex.ts`, [:128](packages/lib/src/typescript/lib/core/RovingTabIndex.ts#L128)), per *Internal Structure*. Update the method's JSDoc to say a repeat activation of the already-active item does nothing, including moving focus.

    Checkpoint: `npm test` green. `npm run lint`.

14. **Add the tests** from *Expected Behaviour*, per *Verification*.

15. **Update the docs** per *Documentation Impact*.

16. **Run every check** in *Verification*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/Button.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Text.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Aria.ts` |
| Modify | `packages/lib/src/typescript/lib/core/RovingTabIndex.ts` |
| Create | `packages/lib/tests/core/ComponentSetterGuards.test.ts` |
| Modify | `packages/lib/tests/component/button/Button.test.ts` |
| Modify | `packages/lib/tests/component/input/TextAutoMeasureLayoutSchedule.test.ts` |
| Modify | `packages/lib/tests/core/RovingTabIndex.test.ts` |
| Modify | `packages/lib/tests/layout/Tab.stripRelayoutEconomy.test.ts` |
| Modify | `packages/lib/tests/component/display/ProgressSpinner.test.ts` |
| Modify | `ARCHITECTURE.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

### Unit-testable — `Component`

1. A second `setTransform("translateY(-1px)")` with the same string issues no `setRuleStyles`; a different string still does.
2. A second `setClipPath("inset(0 100% 0 0)")` issues no `setRuleStyles`. `getClipPath()` returns the last value set, and `null` before any call and after `setClipPath(null)`.
3. `setClipPath(null)` on a component that never had a clip path writes nothing.
4. A second `setOpacity(0.5)` issues no inline `apply`; `setOpacity(0)` after `setOpacity(1)` still writes. A component that has rendered still replays its opacity on a re-render.
5. A second `setWritingMode("sideways-rl")` writes nothing; `clearWritingMode()` after it still removes the property.
6. A second `setBackgroundImage("url(a.png)")` writes nothing.
7. Ten `clearOutline()` calls on a component with no outline produce **zero** `setRuleStyles`; a `showError`/`clearError` round trip on a `FieldDecorator` still paints and removes the outline.
8. `setBorder({ border: "1px solid red" })` twice writes the four longhands once. A second call passing a *different object* with the same four resolved sides also writes nothing.
9. `setBorder` after `cacheBorderSpec` with the same spec still writes the CSS — the cached-spec-only match does not satisfy the guard.
10. An unchanged `setBorder` leaves `getBorderSize()` returning the same widths as a changed one would; the guard does not strand `_borderWidths`.
11. `setSize` with the component's current size writes no geometry and calls no `scheduleLayout`; `setSize` with a changed size does both and fires `"sizechange"` once.
12. `Body`'s first `setSize` during `init()` is never skipped (the stored size is `NaN`).
13. A second `setInsets` with an equal-valued `Insets` writes no `data-insets` attribute; an inset change still writes it. `getInsets()` returns the same four numbers either way.
14. `clearInsets()` on a component whose insets are already zero writes nothing.
15. A second `setValueStyleState("bg", "red", { backgroundColor: "red" })` issues no `apply`; a different `cssValue` still swaps the class token. A token recorded before the element existed is still replayed at first render.

### Unit-testable — `Button`, `Text`, `Aria`, `RovingTabIndex`

16. `setGlyph(currentName)` produces **zero** `ensureStyleRule` and zero `deleteStyleRule` ops, and `getGlyph()` returns the same instance it did before the call. `setGlyph(differentName)` still swaps and disposes.
17. `new Button({ text: "Save", glyph: "check" })` renders the title and the glyph — the constructor's late dispatch is not swallowed by either guard.
18. `setText(currentTitle)` produces no sink ops. `setShowText(false)` then `setText(sameTitle)` still leaves the face blank and the accessible name set.
19. `setTextAlign(currentValue)` on a horizontal button does not call `scheduleLayout`. After `setWritingMode("sideways-rl")`, `setTextAlign("left")` with the same value **does** re-anchor the content row to `NORTH`.
20. `clearDescription()` on a button with no description produces no rebuild and no sink ops. `setDescription("x")` then `clearDescription()` leaves the live `Component` count and the stylesheet-rule count where they started.
21. `Text.setText` with a byte-identical string produces no sink ops, no `measureText`, and no parent `scheduleLayout`. A changed string still writes, still marks the measurement stale, and still schedules.
22. `Aria.clearLabel()` on a component that never had an `aria-label` produces no `removeAttr`; after `setLabel("x")` it still removes the attribute, and a second `clearLabel()` is then a no-op.
23. Three consecutive `moveTo(activeIndex)` calls produce zero sink ops and zero `focus` calls.
24. Removing the active item at index 0 from a three-member group leaves the new first item at `tabindex="0"` and exactly one member at `0`.

### Unit-testable — integration counters

25. A `Tab` layout pass whose tab insets do not change writes **zero** `data-insets` attributes (today: one per `setInsets` call `applyTabButtonStyles` makes — one per tab button, one per tool button, and one for a lead widget if the strip has one).
26. With an overlay shown, `target.setSize({ width: 420, height: 260 })` resizes the spinner to 420 × 260 synchronously.

### Manual verification

27. **Vertical tabs**: in the docs demo shell, switch a `TabBar` to a vertical orientation and set the tab text alignment to left and right. The labels must justify to the top and bottom edges of each tab, not stay centred.
28. **Tab keyboard nav**: clicking the already-selected tab keeps focus on it and does not scroll the strip; arrow keys still move between tabs.
29. **Validation outline**: a form field that fails validation still gets the red outline, and it still disappears when the field becomes valid.
30. **Flat buttons**: a toolbar button toggled out of flat chrome still paints its border at the right width, and the button's height does not shift.

---

## Verification

1. `npm run typecheck` and `npm test` — both clean. `npm test` runs `typecheck:test` first.
2. **New suite** `packages/lib/tests/core/ComponentSetterGuards.test.ts`, covering behaviours 1-15. Take `const sink = installTestDOM(CONFIG)` (the config shape used by [Tab.stripRelayoutEconomy.test.ts:21-27](packages/lib/tests/layout/Tab.stripRelayoutEconomy.test.ts#L21)), materialise the component with `getElement(true)`, call the setter once, clear `sink.writes.length = 0`, call it again with the same value, and assert the slice is empty. For the rule-writing setters use `ruleStyleWrites(sink)` ([TestDOM.ts:914](packages/lib/tests/dom/TestDOM.ts#L914)) and assert `.length === 0`. For behaviour 7 assert `ruleStyleWrites(sink).length === 0` across ten `clearOutline()` calls.
3. **`setSize` probes**, same suite: `vi.spyOn(component, 'scheduleLayout')` with zero calls for an unchanged size, and a `"sizechange"` listener firing exactly once for a changed one.
4. **`Button` probes**, added to `packages/lib/tests/component/button/Button.test.ts` (behaviours 16-20). Count `sink.writes` by `op` for `ensureStyleRule` and `deleteStyleRule` across a same-name `setGlyph`; expect `0` for each. For behaviour 19, build a button, `setTextAlign("left")`, then `setWritingMode("sideways-rl")`, then `setTextAlign("left")` again, and read the content row's anchor through `getLayoutConstraints`.
5. **`Text` probe**, added to `packages/lib/tests/component/input/TextAutoMeasureLayoutSchedule.test.ts` (behaviour 21): spy the host's `scheduleLayout`, call `setText` twice with the same string, assert one call not two, and assert the second call recorded no `apply`.
6. **`RovingTabIndex` probes**, added to `packages/lib/tests/core/RovingTabIndex.test.ts` (behaviours 23-24), following that file's existing `group(n)` / `zeroCount(g)` helpers.
7. **`Tab` attribute probe**, added to `packages/lib/tests/layout/Tab.stripRelayoutEconomy.test.ts` beside *a repeated pass writes no ARIA and toggles no class* ([:123](packages/lib/tests/layout/Tab.stripRelayoutEconomy.test.ts#L123)). Reuse that test's harness verbatim and filter `sink.writes` for `apply` ops whose `setAttr` carries a `data-insets` key; expect zero (behaviour 25).
8. **Overlay-geometry insurance**, added to `packages/lib/tests/component/display/ProgressSpinner.test.ts` (behaviour 26). `progress-indicator-resize-relay`'s own probe drives the relay through `setWidth` / `setHeight`; this one drives it through the two-axis `setSize` that this plan guards, which is the path that would fail silently if the two plans ever land out of order.[^spinner-insurance]
9. `grep -rn 'setClipPath(' packages/lib/src/typescript/lib | grep -v 'Component.ts'` — expect ten hits, one in `layout/Split.ts` and nine in `layout/Border.ts`. Each passes a value derived from the current pane or region state and re-asserts it every pass, so each becomes a no-op once settled; none writes a constant expecting the write itself to have an effect.
10. `npm run lint`, `npm run docs:api` (zero warnings — `getClipPath` is public, so its JSDoc may only `{@link}` other public symbols) and `npm run docs:llms:check`.
11. Manual checks 27-30, in `npm run dev`.
12. **Engine measurement.** Re-run the three headline scenarios in [plans/research/render-review-2026-09-15/00-baseline.md](plans/research/render-review-2026-09-15/00-baseline.md) (S1 2×2 dock-h drag, S3 file tree, S4 resize), interleaved and repeated as that file specifies. The counter to watch is `attr.data-insets.same`, which was 12 / 6 / 3 per frame and should reach 0.[^baseline-expectation]

---

## Documentation Impact

- **`ARCHITECTURE.md`**, *Three non-negotiable rules for every DOM write*, rule 2. It says a layering property is "written **unconditionally** through `this.writeStyle({ foo: value })` … the per-key dedup against the class tier happens later, at flush time, not in the setter." That sentence is about the *class-tier* comparison, but it reads as a ban on any setter-level comparison, which `setBackgroundColor`, `setCursor`, `setPadding` and `setUserSelect` already contradict. Add one clause: a setter may return early when the incoming value equals the instance's own last authored value; what it must not do is compare against a lower tier.
- **`packages/lib/docs/reference/changelog/next.md`** — an *Added → Core* entry for `Component.getClipPath()`, and a *Changed → Core* entry stating that nineteen setters now return early on an unchanged value, naming the one user-visible consequence: a caller that used `setSize` at an unchanged size to force a relayout must use `flushLayout()` / `invalidateLayout()` instead. Match the existing entries' bold-lead-sentence style.
- **No migration note.** Every guard preserves the observable end state, so nothing a consumer wrote stops compiling or stops working. `packages/lib/docs/reference/migration/next.md` is untouched.
- **`packages/lib/llms.txt`** needs no change: it indexes classes, not members, and no class is added or removed.

---

## Potential Challenges

- **Landing this plan before `progress-indicator-resize-relay`** stops `ProgressSpinner`'s overlay resizing with a green test suite, because no test in the repository asserts the overlay's width or height today. Step 1 is the gate; treat a missing `notifySizeChange` as a hard stop, not a merge conflict to resolve.
- **`setBorder`'s two-cache guard looks redundant** and a future reader may simplify it to one comparison. The comment in the body names `cacheBorderSpec` as the reason; keep it.
- **`Button.setText` and `Button.setGlyph` both sit on the constructor's late-dispatch path.** `setGlyph` is safe because `_glyph` is `null` there; `setText` is safe only because its guard also checks the rendered label. Removing the second half of that condition reintroduces blank buttons for every option-configured instance.
- **`Text.setText` is the most-called API in the library.** Its guard changes counts in any test that asserts sink-op totals around a rebind. Expect to re-read a few table/list/tree expectations rather than relax them — the guard removes writes that were genuinely redundant.
- **`Body._onViewportResize` now skips a same-size resize event.** That is the intended win, and it does not affect zoom or theme changes: a zoom moves the CSS-pixel viewport size, and theme reflow arrives through `Body`'s own theme subscription, not the resize listener.
- **`setClipPath`'s guard assumes the component's `#id` rule is never silently discarded and re-created empty.** `setTransform` and `setContain` have carried the same assumption since they were guarded, so the exposure is not new — but if a disposal path is ever found that drops the rule while keeping the component alive, all three guards break together.
- **`_clipPath` is a plain initialized field, not `declare`.** That is correct only because `clipPath` is absent from `ComponentOptions`. If a later plan adds it to the options bag, the field must switch to `declare` per `CODE_CONVENTIONS.md`.

---

## Critical Files

| File | Why |
|---|---|
| [packages/lib/src/typescript/lib/core/Component.ts:2606-2630](packages/lib/src/typescript/lib/core/Component.ts#L2606) | `setPadding` / `clearPadding` — the multi-field comparison `setInsets` / `clearInsets` copy. |
| [packages/lib/src/typescript/lib/core/Component.ts:5035-5060](packages/lib/src/typescript/lib/core/Component.ts#L5035) | `setContain` / `clearContain` — the cached-field shape `setTransform`, `setClipPath` and `setOpacity` copy. |
| [packages/lib/src/typescript/lib/core/Component.ts:2691-2720](packages/lib/src/typescript/lib/core/Component.ts#L2691) | `setBackgroundColor` / `clearBackgroundColor` — the layered-style-bag shape, and why a `clearX` asserts a value instead of removing one. |
| [packages/lib/src/typescript/lib/core/Component.ts:4090-4110](packages/lib/src/typescript/lib/core/Component.ts#L4090) | `setWidth` — clamp-then-compare, the shape `setSize` adopts. |
| [packages/lib/src/typescript/lib/core/Component.ts:2961-2995](packages/lib/src/typescript/lib/core/Component.ts#L2961) | `setBorder` and `cacheBorderSpec` — the divergence the two-cache guard exists for. |
| [packages/lib/src/typescript/lib/core/Component.ts:6328-6370](packages/lib/src/typescript/lib/core/Component.ts#L6328) | `setValueStyleState` and `valueClassGuardSuffix` — what the token guard skips and why that is safe. |
| [packages/lib/src/typescript/lib/core/Component.ts:7631-7633](packages/lib/src/typescript/lib/core/Component.ts#L7631) | `init`'s value-class replay — the reason a recorded token is always on the element. |
| [packages/lib/src/typescript/lib/core/Component.ts:6569-6615](packages/lib/src/typescript/lib/core/Component.ts#L6569) | `applyMiscInlineStyles` — replays writing-mode, opacity and `data-insets` after the inline-style wipe, which is what makes those three guards safe across a re-render. |
| [packages/lib/src/typescript/lib/component/container/TabBar.ts:2558-2580](packages/lib/src/typescript/lib/component/container/TabBar.ts#L2558) | `applyTabButtonStyles` — writing mode set before text-align on purpose; the anchor half of `setTextAlign`'s guard exists for this caller. |
| [packages/lib/src/typescript/lib/component/button/Button.ts:806-825](packages/lib/src/typescript/lib/component/button/Button.ts#L806) | The constructor's late `setText` / `setGlyph` / `setDescription` dispatch — the path both `Button` guards must not swallow. |
| [packages/lib/src/typescript/lib/component/button/Button.ts:1828-1846](packages/lib/src/typescript/lib/component/button/Button.ts#L1828) | `clearGlyph` — the capture-null-rebuild-dispose order `clearDescription` copies. |
| [packages/lib/src/typescript/lib/core/Aria.ts:791-798](packages/lib/src/typescript/lib/core/Aria.ts#L791) | `Aria.setAttribute` — the guard already in that file, and the one `clearLabel` mirrors. |
| [packages/lib/src/typescript/lib/core/RovingTabIndex.ts:98-120](packages/lib/src/typescript/lib/core/RovingTabIndex.ts#L98) | `remove` — the caller that makes an index-only guard wrong. |
| [packages/lib/tests/dom/TestDOM.ts:905-932](packages/lib/tests/dom/TestDOM.ts#L905) | `ruleStyleWrites` — the per-declaration flattener every rule-count assertion uses. |
| [plans/research/render-review-2026-09-15/00-baseline.md](plans/research/render-review-2026-09-15/00-baseline.md) | The measured cost model, and the `attr.data-insets.same` counter this plan should drive to zero. |
| [ARCHITECTURE.md](ARCHITECTURE.md) *Three non-negotiable rules for every DOM write* | Rule 2's caching requirement, which is why `setClipPath` gets a field and a getter rather than just a comparison. |

---

## Non-Goals

- **`Button.setShowText` / `setShowDescription` / `setDescriptionUnderGlyph` / `setDescription`.** `applyOptions` re-dispatches `setShowText` deliberately, to resync a subclass whose tail options bag carries `showText` without `text` ([Button.ts:984-986](packages/lib/src/typescript/lib/component/button/Button.ts#L984)). That path needs the call to have an effect, so guarding it needs a force parameter or a different resync hook — a design decision, not a guard.
- **`Image.setSrc` / `setSrcset` / `setSizes`**, and the remaining unguarded `Component` setters (`setColorScheme`, `setAppearance`, `setBorderImage`, `setTransformOrigin`, `setPointerEvents`, `setWhiteSpace`, `setAnimationPlayState`, `clearTransform`, `clearOpacity`). None is on a per-frame path today; they belong with whichever group next edits those files.
- **`StyleTarget`'s last-written memo** (review item X1). It would suppress the *write* at the seam for every property at once. It does not suppress a setter's other side effects, which is what this plan is about, and it is a separate group.
- **The empty-`InlineStyle`-flush floor.** One content-free `apply` per component survives a settled pass; that is a `StyleTarget` issue, which is why the probes here assert on patch content, not on `apply` totals.
- **`FilterCell.setOperators`' identity guard, and the second `applyOperatorFace` sweep.** Those are `component/table/cell/Filter.ts` changes and are not in this plan's files.[^filtercell]
- **A layout-free single-line measurement seam on `DOMSource`.** It is the other half of the `Text.setText` finding and a much larger change; the same-string guard stands on its own.
- **Anything else in `core/Component.ts`.** Three later groups edit this file; this plan changes only the nineteen guards, one helper function, one field and one getter.

---

## Notes

[^restyle-cost]: From `plans/research/render-review-2026-09-15/00-baseline.md`. A stylesheet-rule mutation forces a full-document restyle in WebKitGTK even when the written value is unchanged — ~195 ms/frame on a 21k-node document. The baseline also shows why a guard is worth adding even where the count is small: Loom's own explorer-gutter drag writes exactly one same-valued rule per frame, affordable at 992 elements and not at 21k. Inline-style writes and attribute writes are far cheaper, which is why the `data-insets` count (12 per frame in the 2×2 grid scenario) is described there as "pure waste, but small".

[^shared-file]: `core/Component.ts` is also edited by groups G09, G10 and G16 in the same review's plan set, sequenced after this one. Keeping this plan's edits to the guard bodies, one module-level helper, one private field and one getter is what lets those three apply cleanly on top.

[^precedent]: The search ran over every `set*` / `clear*` on `Component`, plus the four setters in scope on `Button`, `Text`, `Aria` and `RovingTabIndex`. On `Component`, fifteen setters already guard and fifteen do not (slice 02, F02.6). The guarded fifteen use only the shapes in the table, and three of them — `setContain`, `setAnimation`, `setTransition` — pair a private cached field with a public getter and a first-statement comparison, which is the closest thing the codebase has to a canonical guard. `Aria` carries its own guard one method away from `clearLabel`. `Button`, `Text` and `RovingTabIndex` have none, so their setters borrow `Component`'s cached-field shape. No new shape was needed, and none is introduced.

[^clippath-cache]: `ARCHITECTURE.md`'s second non-negotiable rule for DOM writes is "always cache in memory — reads return cached state, never re-query the DOM". `setClipPath` caches nothing and has no getter, which is both a standing rule violation and the reason its missing guard survived: there was no value to compare against. Adding the field without the getter would leave the rule half-satisfied and the next reader with no way to ask what the clip path is, so both land together. The alternative — comparing against the `StyleRule`'s own queued state — would reach past the setter into the write buffer and would not survive the buffer being re-materialised.

[^border-two-caches]: `cacheBorderSpec` exists so a subclass whose border is painted by a shared class-tier rule can keep an accurate width for layout math without writing the same value onto its own `#id` rule (`Button._applyFlatChrome`, `SplitGutter.setOpaque`, `Menu`'s persistent chrome). It writes `_border` and nothing else. So `_border` alone is not a record of what was written, and `_instanceStyle.border` alone is not a record of what the layout math will read. A flat `Button` restoring its chrome hits exactly the gap: `_restoreChrome` calls `setBorder(d.border)` while `_instanceStyle.border` still holds `d.border` from construction and `_border` holds flat's spec. Comparing only the written value would skip that call and leave `getBorderSize()` reporting flat's widths forever.

[^textalign-anchor]: The review recorded `setTextAlign` as calling `scheduleLayout()` unconditionally. That is no longer true — the call is already inside an `if (constraints)` block — but the finding stands for `TabBar`, where the constraints always exist, so every tab button is re-added to the pending set on every pass. What the review did not record is the anchor dependency. `Button.setWritingMode` does not re-derive the content anchor, so today the only thing that repairs it after an orientation flip is the next `setTextAlign` call, and `TabBar` makes that call with an unchanged value on purpose — its own comment says so. A same-value guard on the align string alone would therefore leave vertical tabs justified along the wrong axis, with no test failing: the `TabBar` suites pin the strip's geometry, not the button's content anchor.

[^roving-remove]: The review's risk note listed three consumers of `RovingTabIndex` — `TabBar`, `ToolBar` and `ButtonGroup` — and said only `TabBar`'s call can hit the no-op case. Two halves of that are now stale. `ButtonGroup` no longer uses `RovingTabIndex` at all, and `ToolBar` only calls `moveNext` / `movePrev`, which never target the current index. But `TabBar` calls `remove` as well as `moveTo` ([TabBar.ts:1836](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1836)), so closing the active first tab reaches `moveTo(0)` with `_activeIndex` already 0 and a *different* component now at index 0. No existing test covers that path, which is why behaviour 24 adds one.

[^button-settext-face]: `applyOptions` writes `options.text` straight into `_options.text` while the content row does not yet exist, and the constructor dispatches `setText(this._options.text ?? …)` once it does. At that moment the stored title and the incoming argument are the same string, so a guard on the stored title alone returns early and the inner label never receives the text — every button configured through its options bag would render blank. Comparing the label's own current text as well makes the constructor path fall through (the label holds `""`, the face should hold the title) while still catching every runtime repeat.

[^outline-scope]: `setOutline` and `clearOutline` are not in the brief's list of setters, but the same brief asks for `setRuleStyles` across ten error-free `clearError()` calls to fall from 10 to 0, and `FieldDecorator.clearError` reaches the stylesheet only through `clearOutline`. Both setters are on slice 02's list of fifteen unguarded ones, both live in a file this plan already opens, and the guard is two lines each. Leaving them out would mean shipping a plan whose stated proof target it cannot meet. `Binding` wires `clearError` to the validation path, so in Loom the saving is one full-document restyle per keystroke in a validated form.

[^spinner-insurance]: `packages/lib/tests/component/display/ProgressSpinner.test.ts` is ~76 lines of construction and visibility smoke tests. It does not pin `isOverlay()` and no test anywhere asserts the overlay's width or height — every `isOverlay()` assertion lives in the `DiagramView` suite. `progress-indicator-resize-relay` adds the first geometry coverage, driven through `setWidth` / `setHeight`. This plan adds one more case driven through the two-axis `setSize`, because that is the method it guards: if the two plans are ever applied out of order, or the relay is later refactored, a `setSize`-driven case is what fails loudly instead of the overlay quietly freezing at its opening size.

[^filtercell]: The review's risk list for this group warned that `packages/lib/tests/component/table/HeaderColumnWindow.test.ts:1030-1038` spies `FilterCell.prototype.setOperators` with `toHaveBeenLastCalledWith` and would need re-pointing at the rendered face. That risk belongs to the plan that adds an identity guard to `FilterCell.setOperators`, not to this one — this plan does not touch `component/table/cell/Filter.ts`, and the spy asserts the arguments a call received, which no guard elsewhere changes. The test is left alone.

[^baseline-expectation]: The baseline's own analysis says the 2×2 dock-gutter scenario's 104 ms/frame is engine-side restyle, layout and paint of an existing tree, not JS write churn — its only per-frame writes are the twelve same-valued `data-insets` attributes this plan removes. So expect the counter to reach 0 and the millisecond figure to move by less than the ~1.5 ms noise floor. That is the correct outcome, not a failed change: the guards' value is in the paths the four baseline scenarios do not exercise — a filter keystroke, a `timeupdate` on a playing video, a validated form, an overflowing tab strip — where the same setters mutate the stylesheet several times per event.

---

## Implementation Notes

Deviations from the plan as written, and the reasons for them.

### `Button.setText`'s guard needed a third comparison

The plan's two-part guard (`_options.text` **and** the rendered face) satisfies
behaviour 18's first sentence but breaks its second. With `showText: false` the
face is blank *either way*, so on `new Button({ text: "Save", showText: false })`
the constructor's late `setText("Save")` finds `_options.text === "Save"` and
`_text.getText() === ""` — both halves match, the guard fires, and
`_reflectAccessibleName()` never runs. Every option-configured glyph-only button
would ship with no accessible name, and no existing test covers it;
[`setShowText`](packages/lib/src/typescript/lib/component/button/Button.ts) does
not reflect on its own, so the `setText` call is the only thing that ever did.

The guard therefore compares a third observable — the reflected `aria-label`.
To avoid stating `_reflectAccessibleName`'s rule twice, that rule is extracted
into a private `_accessibleNameFor(title)` which both the reflector and the
guard read. Two tests in `Button.test.ts` pin it: the construction path
(`{ text, showText: false }` still gets its `aria-label`) and the runtime path
(`setShowText(false)` then `setText(sameTitle)`, which behaviour 18 names
outright).

This is the same hazard class as the `setTextAlign`/`TabBar` case the plan
already documents: a caller that depends on a call which *looks* redundant.

### Behaviour 22's test went into the existing `Aria.test.ts`

*Files to Create / Modify / Delete* assigns no file to the `Aria.clearLabel`
behaviour. `packages/lib/tests/core/Aria.test.ts` already carries an
*unchanged writes are skipped* block covering `setAttribute`'s own guard, so
the clear-side twin was added there rather than in a new file.

### Two `progress-indicator-resize-relay` tests were rewritten

`ProgressSpinner.test.ts`'s *leaves the geometry setters untouched when nothing
is listening* and *does not fire when setSize commits the box it already had*
both asserted `scheduleLayout` was called once for an unchanged `setSize`, with
a comment naming this plan as the owner of the change. Both now assert the
early return instead; the first also exercises a changed size, so the
`geometryWritesSince` probe is still shown to be able to see a real write.

Behaviour 26's own probe asserts the overlay's box with the frame queue
deliberately undrained, rather than asserting no frame was armed: unlike
`setWidth`, a changed `setSize` does arm a layout pass for the target itself,
so "synchronously" can only mean "before any frame runs".

### `npm run docs:api` still reports its 14 pre-existing warnings

*Verification* item 10 asks for zero. The run reports `Found 0 errors and 14
warnings`, the same 14 the branch started with (`SpatialNavigation`,
`rankInDirection`, `FieldDecorator`, `MarkdownViewer`, `MarkdownEditor`). None
names `getClipPath`, `getDescription` or any symbol this plan touched, so the
plan's real requirement — introduce no new warning — is met.

### Manual checks 27-30 were not run in a browser

This environment has no `npm run dev` surface. Each of the four has an
automated proxy that was run and passes, and which would fail on the regression
the manual check is looking for:

| Manual check | Automated proxy |
|---|---|
| 27 Vertical tab justification | `Button.test.ts` — *re-anchors the content row when the writing mode changed under an unchanged alignment* |
| 28 Tab keyboard nav | `RovingTabIndex.test.ts` — *re-activating the already-active item writes nothing and moves no focus* plus *still focuses ... for a genuinely different index* |
| 29 Validation outline | `ComponentSetterGuards.test.ts` — *still paints and removes the outline across a FieldDecorator error round trip* |
| 30 Flat button border width | `ComponentSetterGuards.test.ts` — *still writes the CSS when only the cached spec already matches* and *leaves the cached border widths intact across a guarded repeat* |

The visual confirmations themselves remain outstanding.

### Engine measurement (Verification item 12) was not run

It needs a real WebKitGTK Timeline recording against the Loom scenarios, which
this environment cannot produce. It is also no longer the decision it was
framed as: the premise that same-valued stylesheet-rule writes dominate drag
frames was measured false on 2026-09-17 — ablating every rule write on the one
Loom scenario that has them saved 1.3 ms, inside the control's own noise. The
guards are kept for correctness and write hygiene, as *Notes*
[^baseline-expectation] already anticipated; no design was bent toward the
millisecond win.

### A pre-existing suite flake, root-caused and left alone

Some full-suite runs report one unhandled rejection — `DOM handle N is not
registered`, thrown from `TableHeader.onStoreFilterChange` →
`positionColumnCells` → `applyBounds` against the *production* sink, attributed
to `tests/component/table/ColumnFilterRow.test.ts`. It is not these guards: it
reproduces on this branch's own start point (`feature/progress-indicator-resize-relay`)
at a comparable rate — one run in five there, against roughly two in thirteen
here. `AbstractStore.applyFilterChange` returns `applyView().then(...)`, and a
table test that mutates filters without awaiting that promise can land its
`.then` after its own `afterEach(DOM.reset())`, by which point every handle it
holds has been released. Pre-existing test hygiene in the table suites, out of
this plan's files, recorded here so it is not lost.
