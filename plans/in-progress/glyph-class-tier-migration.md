---
touches-shared:
  - packages/lib/src/typescript/lib/component/display/Glyph.ts
  - packages/lib/src/typescript/lib/component/container/Scrollbar.ts
  - packages/lib/src/typescript/lib/core/ClassStyleRules.ts
  - packages/lib/docs/reference/changelog/next.md
---

# Glyph Class-Tier Font Migration — Implementation Plan

## Overview

[`Glyph.setFontSize`](packages/lib/src/typescript/lib/component/display/Glyph.ts#L356), [`setLineHeight`](packages/lib/src/typescript/lib/component/display/Glyph.ts#L401), and [`setTextAlign`](packages/lib/src/typescript/lib/component/display/Glyph.ts#L432) each write straight to the component's own `#id` CSS rule through the raw `this.setElementCSSRule(...)` call, bypassing the layered style-bag entirely — the same bypass shape [`text-input-class-tier-migration.md`](plans/text-input-class-tier-migration.md) fixed for `TextInput`'s font triple. [`Glyph`'s constructor](packages/lib/src/typescript/lib/component/display/Glyph.ts#L277) calls `setLineHeight("1")` and `setTextAlign("center")` unconditionally for every `kind: "char"` glyph, so every char-mode `Glyph` instance pays this cost.

A full registry and call-site sweep (below) finds exactly **one** real consumer of this bug today: [`ScrollArrowGlyph`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L150), the triangle inside every `Scrollbar` arrow button, whose owner [`ScrollArrowButton`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L228) also calls `setFontSize(ARROW_GLYPH_FONT_SIZE)` imperatively — a construction-time-fixed value (`ARROW_GLYPH_FONT_SIZE = 10`, [Scrollbar.ts:50](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L50)). The comment directly above `ScrollArrowGlyph` already documents this precisely: its `minSize`/`maxSize` are a class default and dedupe correctly, but "`fontSize`/`lineHeight`/`textAlign` are NOT defaulted here... they stay real per-instance declarations regardless." This plan fixes exactly that gap: it moves the three setters onto the layered `writeStyle` path and gives `ScrollArrowGlyph` a matching class default, so every arrow across every `Scrollbar` shares one CSS declaration instead of each repeating it.

**`AccordionIndicator`, cited in this plan's originating brief as a second char-mode consumer, is not.** [`AccordionIndicator`](packages/lib/src/typescript/lib/component/container/AccordionIndicator.ts#L81) is a plain `Component`, not a `Glyph` subclass — it renders its chevron as raw text content and already publishes its own shared `.AccordionIndicator` class rule (`fontSize`, `textAlign`, `pointerEvents`, `color`, `transition`) via `ensureAccordionIndicatorClassRule` ([AccordionIndicator.ts:48](packages/lib/src/typescript/lib/component/container/AccordionIndicator.ts#L48)), the same "module-level shared class rule" pattern `text-input-class-tier-migration.md` used for `TextArea`'s `resize: none`. It never calls `Glyph.setFontSize`/`setLineHeight`/`setTextAlign` and needs no change here.

The registry ([`Glyphs.ts:43-46`](packages/lib/src/typescript/lib/component/display/Glyphs.ts#L43)) declares exactly four `kind: "char"` entries — `unicode-arrow-up`/`down`/`left`/`right` — and nothing else in the tree registers another one. Every other glyph name in the app (`xmark`, `check`, `circle`, `caret-down`, `chevron-down`, …) is `kind: "svg"`, sourced from the ~1500 icon files under `packages/lib/src/typescript/lib/glyphs/`. `ScrollArrowGlyph` is the only class that ever constructs a `unicode-arrow-*` glyph — a grep for `new Glyph(` across `packages/lib/src` finds no other literal or dynamic construction of one — so it is the only class that ever runs `Glyph`'s char-mode constructor guard for a purpose other than a one-off caller passing an arbitrary registry name it doesn't control. `Checkbox`'s `CheckboxCheckGlyph` and `RadioButton`'s `RadioButtonDot` — the only two other `Glyph` subclasses in the codebase — construct `"check"`/`"circle"`, both `kind: "svg"`; the char-mode guard never fires for them and neither ever calls these three setters.

---

## Architecture Decisions

### The three setters move onto `writeStyle`, mirroring `Text`'s already-fixed shape

`setFontSize`/`setLineHeight`/`setTextAlign` change from `this.setElementCSSRule(key, value)` to `this.writeStyle({ font: { key: value } })`, keeping each setter's existing `this._options.key = value` cache write unchanged. This is the exact pattern [`Text.setTextAlign`](packages/lib/src/typescript/lib/component/input/Text.ts#L864) already uses (`this.writeStyle({ font: { textAlign: align } })`), and it is what lets these three properties participate in the render-time comparison against a class default at all — a bypass write has no comparison step, so no amount of registering a class default could ever make it dedupe.[^font-bag-fits]

### `ScrollArrowGlyph` registers the font default through a `getClassStyleDefaults()` override, not `ownClassStyleDefaults`

`ScrollArrowGlyph` gains:

```typescript
protected getClassStyleDefaults(): StyleBag {
    return {
        ...super.getClassStyleDefaults(),
        font: { fontSize: ARROW_GLYPH_FONT_SIZE + "px", lineHeight: "1", textAlign: "center" },
    };
}
```

This grafts the font triple onto `Component`'s own default body (`return this._defaultOptions;`, which already carries `ScrollArrowGlyph`'s existing `minSize`/`maxSize`), and is read by [`Component.applyStyle`](packages/lib/src/typescript/lib/core/Component.ts#L5705) (`this._classLayer = ensureClassStyleRule(this.constructor, this.getClassStyleDefaults())`). `ScrollArrowGlyph` declares **no** `ownClassStyleDefaults` static field, so it stays outside the hierarchy-aware class-tier walk entirely — [`ensureClassStyleRule`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L887) takes its pre-hierarchy flat branch (`chainParticipates` returns `false`), diffing the overridden `getClassStyleDefaults()` bag directly against the framework baseline. `Glyph` itself is untouched — no field, no override — so this change is invisible to `CheckboxCheckGlyph`, `RadioButtonDot`, and every bare `new Glyph(name)` call in the app.

This is a deliberate departure from `PickerInput`'s `ownClassStyleDefaults` shape ([PickerInput.ts:38](packages/lib/src/typescript/lib/component/input/PickerInput.ts#L38)), the pattern this plan's originating brief pointed at as one candidate.[^why-not-hierarchy]

### The getters stay untouched — the font triple is always-dispatched, not a pure fallback

`getFontSize`/`getLineHeight`/`getTextAlign` keep reading `this._options.X ?? null`, unchanged. For every `ScrollArrowGlyph` instance, `Glyph`'s own char-mode constructor guard (`setLineHeight("1")`/`setTextAlign("center")`) and `ScrollArrowButton`'s own imperative `setFontSize(ARROW_GLYPH_FONT_SIZE)` call ([Scrollbar.ts:230](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L230), left unchanged by this plan) together dispatch all three properties into the instance layer unconditionally at construction — ARCHITECTURE.md's "Always-dispatch" resolution for a class-level default, not the "fold it in the getter" one `TextInput`'s font triple needed (`TextInput` never wrote its font group imperatively at all; it was a pure fallback). Because the value is always present in `_options`, no getter path can ever observe the new class default going missing, so none needs to fall back to it.

### No `default-options-fallback.test.ts` registry row

That registry's own header states its purpose precisely: "asserting that a bare construction (no caller options) still resolves the default **through its getter**." Per the previous decision, no getter here ever reads `ScrollArrowGlyph`'s new `getClassStyleDefaults().font` — a row exercising `getFontSize()`/`getTextAlign()` would pass identically whether or not the override exists, since it observes only the always-dispatched instance write. Adding one would assert a guarantee the row cannot actually provide.

### Two existing tests rely on this exact bug as a disposal-tracking canary, and must switch to an explicit deviation

[`VirtualScroller.styleRuleDisposal.test.ts`](packages/lib/tests/component/container/VirtualScroller.styleRuleDisposal.test.ts) (case B1-3) and [`Panel.styleRuleDisposal.test.ts`](packages/lib/tests/core/Panel.styleRuleDisposal.test.ts) (case B1-2) each verify that destroying a `Tree`/`Panel` disposes its overlay scrollbars' per-instance stylesheet rules — by reading a `ScrollArrowGlyph`'s `#id` rule as a "reliable per-instance proxy," because every *other* component in that subtree (the `Scrollbar` root, `ScrollArrowButton`, `ScrollbarThumb`) has already been hoisted onto a shared class rule by earlier plans and materialises none of its own. Both files' comments narrate this history explicitly (each earlier hoisting plan defeating the previous proxy). This plan defeats the last one: once the font triple dedupes too, an unmodified `ScrollArrowGlyph` never materialises an `#id` rule at all, and both tests' "before" assertion (a rule must exist to later prove it was removed) goes from `true` to `undefined`.

Both tests are fixed the same way: force one explicit, non-matching `setFontSize` call on the glyph before reading its id, so a real per-instance rule exists regardless of what the class tier hoists. This is more robust than the pattern it replaces — it no longer depends on some other property staying accidentally un-hoisted, which is exactly the trap each earlier increment of this exact test hit in turn.[^probe]

---

## Internal Structure

### `component/display/Glyph.ts` — the three setters

```typescript
setFontSize(value: number): this {
    this._options.fontSize = value;
    this.writeStyle({ font: { fontSize: value + "px" } });

    return this;
}
```

```typescript
setLineHeight(value: number | string): this {
    this._options.lineHeight = value;
    this.writeStyle({ font: { lineHeight: typeof value === "number" ? value + "px" : value } });

    return this;
}
```

```typescript
setTextAlign(value: string): this {
    this._options.textAlign = value;
    this.writeStyle({ font: { textAlign: value } });

    return this;
}
```

No other line in these three methods, or in `getFontSize`/`getLineHeight`/`getTextAlign`/`applyOptions`/the constructor's char-mode guard, changes. `writeStyle` is inherited from `Component` — no new import needed.

### `component/container/Scrollbar.ts` — `ScrollArrowGlyph`

Add the override directly after the existing constructor ([Scrollbar.ts:157-159](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L157)):

```typescript
class ScrollArrowGlyph extends Glyph {
    constructor(direction: ArrowDirection, subclassDefaults?: Partial<GlyphOptions>) {
        super("unicode-arrow-" + direction, undefined, { ..._defaultScrollArrowGlyphOptions, ...(subclassDefaults ?? {}) });
    }

    protected getClassStyleDefaults(): StyleBag {
        return {
            ...super.getClassStyleDefaults(),
            font: { fontSize: ARROW_GLYPH_FONT_SIZE + "px", lineHeight: "1", textAlign: "center" },
        };
    }
}
```

`StyleBag` is already imported at the top of the file (`import type { StyleBag, StyleStateSpec } from "~/core/ClassStyleRules.js";`) — no import change needed.

Rewrite the doc comment above the class ([Scrollbar.ts:134-149](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L134)), which currently ends by explaining why `fontSize`/`lineHeight`/`textAlign` do *not* dedupe:

```typescript
/**
 * The Unicode-triangle glyph inside a {@link ScrollArrowButton}. `minSize`/
 * `maxSize` are a class default (TRACK_WIDTH square) via the constructor's
 * `subclassDefaults` bag, and `fontSize`/`lineHeight`/`textAlign` are a class
 * default too via `getClassStyleDefaults()` — so every arrow across every
 * Scrollbar shares one `.ScrollArrowGlyph` CSS rule instead of each repeating
 * all seven declarations. `ScrollArrowButton`'s own constructor still calls
 * `setPreferredSize`/`setFontSize` imperatively (a `Glyph`'s
 * construction-time size/font pins cannot themselves be deferred to a
 * defaults bag — see `Glyph.applyOptions` and its char-mode constructor
 * guard), but each call now resolves to the same value this class already
 * defaults, so `Component.applyStyle`'s render-time reconciliation turns it
 * into a removal instead of a redundant per-instance declaration.
 */
```

Leave `_defaultScrollArrowGlyphOptions` itself unchanged — it still carries only `minSize`/`maxSize` and is still forwarded as `subclassDefaults`, unrelated to the new override.

### `core/ClassStyleRules.ts` — one doc-comment word

[`TextStyleBag`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L80)'s comment ends "Only `Text.getClassStyleDefaults()` ever sets `font`." Replace that sentence with: "`Text.getClassStyleDefaults()` and `ScrollArrowGlyph.getClassStyleDefaults()` (component/container/Scrollbar.ts) are the two methods that set `font`." Leave the rest of the comment as-is — its warning about `Glyph`'s own flat, differently-typed `fontSize`/`lineHeight`/`textAlign` *options* is exactly why this plan namespaces the new default under `font` rather than adding flat keys, and remains accurate.

### Test updates

`packages/lib/tests/component/container/ScrollbarArrow.test.ts` — replace the existing "row 2" case ([lines 227-251](packages/lib/tests/component/container/ScrollbarArrow.test.ts#L227)) in full:

```typescript
it('row 2: a rendered arrow glyph writes no font/size declaration to its own #id rule at all', () => {
    const sink = installTestDOM(CONFIG);

    const bar = new Scrollbar('vertical', { arrowsEnabled: true });
    const [, arrowStart] = bar.getComponents();
    const glyph = arrowStart.getComponents()[0];

    const declarations = declarationsDuring(sink, idSelector(glyph), () => bar.getElement(true));

    // All seven hoistable keys (four size + font-size/line-height/text-align)
    // now match the shared .ScrollArrowGlyph class rule, so nothing forces
    // this instance's own #id rule to materialise at all.
    expect(declarations).toEqual({});
    expect(_ruleCacheHas('.ScrollArrowGlyph')).toBe(true);
});
```

`packages/lib/tests/component/container/VirtualScroller.styleRuleDisposal.test.ts` — add a helper right after `arrowIdOf` ([line 74](packages/lib/tests/component/container/VirtualScroller.styleRuleDisposal.test.ts#L74)) and call it for both bars before the existing assertions ([line 81](packages/lib/tests/component/container/VirtualScroller.styleRuleDisposal.test.ts#L81)):

```typescript
/**
 * Forces a genuine per-instance deviation on a scrollbar's start-arrow glyph
 * — a font-size distinct from `ScrollArrowGlyph`'s own class default — so a
 * real `#id` rule exists to canary on regardless of what the class tier
 * hoists elsewhere. See `arrowIdOf`'s doc comment.
 */
function forceArrowGlyphDeviation(bar: Scrollbar): void {
    (bar as unknown as { _arrowStart: { _glyph: { setFontSize(px: number): void } } })._arrowStart._glyph.setFontSize(11);
}
```

```typescript
const tree = renderedTree();
const { v, h } = scrollbarsOf(tree);

forceArrowGlyphDeviation(v);
forceArrowGlyphDeviation(h);

const vId = v.getId();
const hId = h.getId();
```

`11` has no significance beyond "not `ARROW_GLYPH_FONT_SIZE` (10)" — any distinct value works. Also update `arrowIdOf`'s doc comment ([lines 57-71](packages/lib/tests/component/container/VirtualScroller.styleRuleDisposal.test.ts#L57)) to add a fourth paragraph after "...so a never-disabled arrow now also materialises no `#id` rule of its own.": "The glyph child is no longer reliable on its own default either — plans/implemented/glyph-class-tier-migration.md hoisted its char-mode font-size/line-height/text-align triple onto the shared `.ScrollArrowGlyph` class rule too, so an unmodified glyph now also materialises no `#id` rule. `forceArrowGlyphDeviation` below gives it one explicitly, so the proxy no longer depends on some other property staying un-hoisted."

`packages/lib/tests/core/Panel.styleRuleDisposal.test.ts` — widen the `bars` cast type ([lines 71-74](packages/lib/tests/core/Panel.styleRuleDisposal.test.ts#L71)) to add `setFontSize(px: number): void` to both `_glyph` shapes, then insert two calls right after the existing `not.toBeNull()` assertions ([line 114](packages/lib/tests/core/Panel.styleRuleDisposal.test.ts#L114)) and before `freshVArrowId`/`freshHArrowId` are captured:

```typescript
bars._scrollbarV!._arrowStart._glyph.setFontSize(11);
bars._scrollbarH!._arrowStart._glyph.setFontSize(11);
```

Update the comment block above ([lines 92-112](packages/lib/tests/core/Panel.styleRuleDisposal.test.ts#L92)) the same way as `VirtualScroller.styleRuleDisposal.test.ts`'s, replacing "Its glyph child is the reliable per-instance proxy instead: `Glyph.setFontSize` always writes its own `#id` rule directly (no class-default dedup for that property)..." with the equivalent "no longer reliable on its own default either... forcing an explicit font-size deviation gives it one" wording.

---

## Ordered Implementation Steps

1. **`packages/lib/tests/component/container/ScrollbarArrow.test.ts`** — replace "row 2" per `## Internal Structure`.
   *Check:* `npx vitest run tests/component/container/ScrollbarArrow.test.ts` from `packages/lib` — this case fails (source not yet changed): `declarations` still carries the three real font values.

2. **`packages/lib/src/typescript/lib/component/display/Glyph.ts`** — rewrite `setFontSize`/`setLineHeight`/`setTextAlign` per `## Internal Structure`.
   *Check:* `npm run typecheck`. `grep -n 'setElementCSSRule("fontSize"\|setElementCSSRule("lineHeight"\|setElementCSSRule("textAlign"' packages/lib/src/typescript/lib/component/display/Glyph.ts` — zero matches. (`setElementCSSRule("animationDuration", ...)` in `_syncReducedMotion` is untouched and still present — expected.)

3. **`packages/lib/src/typescript/lib/component/container/Scrollbar.ts`** — add `ScrollArrowGlyph.getClassStyleDefaults()` and rewrite the class's doc comment, per `## Internal Structure`.
   *Check:* `npm run typecheck`. Re-run step 1's test — green.

4. **`packages/lib/src/typescript/lib/core/ClassStyleRules.ts`** — update the `TextStyleBag` doc-comment sentence per `## Internal Structure`.
   *Check:* none beyond a read-through — comment-only.

5. **`packages/lib/tests/component/container/VirtualScroller.styleRuleDisposal.test.ts`** — add `forceArrowGlyphDeviation` and call it for both bars, per `## Internal Structure`.
   *Check:* `npx vitest run tests/component/container/VirtualScroller.styleRuleDisposal.test.ts` — green. (Fails first, before this step, once steps 2-3 land — confirm that too if implementing steps out of this order.)

6. **`packages/lib/tests/core/Panel.styleRuleDisposal.test.ts`** — widen the `bars` cast and add the two `setFontSize(11)` calls, per `## Internal Structure`.
   *Check:* `npx vitest run tests/core/Panel.styleRuleDisposal.test.ts` — green.

7. **Run the full suite.** `npx vitest run --no-file-parallelism` from `packages/lib` — expect 5218/5218 passing, no test file other than the three touched above needing any change.[^suite-green]

8. **Add the changelog entry.** See `## Documentation Impact`.

9. **Verify live in a browser.** Non-negotiable — see `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/display/Glyph.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/Scrollbar.ts` |
| Modify | `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` |
| Modify | `packages/lib/tests/component/container/ScrollbarArrow.test.ts` |
| Modify | `packages/lib/tests/component/container/VirtualScroller.styleRuleDisposal.test.ts` |
| Modify | `packages/lib/tests/core/Panel.styleRuleDisposal.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Rows 1-5 are unit-testable against the recording DOM sink; row 6 needs a live browser. Rows 1-2 are verified numbers, not predictions — captured directly from a recording-sink probe run against this exact fix in this worktree.[^probe]

| # | Case | Expected |
|---|---|---|
| 1 | A `Scrollbar('vertical', { arrowsEnabled: true })` renders; inspect its start arrow's glyph's own `#id` rule | Carries no declaration at all (`{}`) — all seven hoistable keys (four size + `fontSize`/`lineHeight`/`textAlign`) now match `.ScrollArrowGlyph` |
| 2 | The shared `.ScrollArrowGlyph` class rule, after any arrow has rendered | `{ minWidth: "12px", minHeight: "12px", maxWidth: "12px", maxHeight: "12px", fontSize: "10px", lineHeight: "1", textAlign: "center" }` |
| 3 | `new ScrollArrowGlyph("up").getFontSize()` / `getLineHeight()` / `getTextAlign()`, unrendered | `10`, `"1"`, `"center"` — unchanged from before this plan (always-dispatched, not defaulted-only) |
| 4 | A **bare** `new Glyph("unicode-arrow-up")` (not via `ScrollArrowGlyph`) renders | Its `#id` rule still carries real `lineHeight: "1"` and `textAlign: "center"` declarations — `Glyph` itself registers no class default, so this plan's fix is scoped to `ScrollArrowGlyph` only, not every char-mode glyph |
| 5 | A `Checkbox`'s `_check` (`CheckboxCheckGlyph`, `kind: "svg"`) or `RadioButton`'s `_dot` (`RadioButtonDot`) renders | Unaffected — neither ever calls `setFontSize`/`setLineHeight`/`setTextAlign`, and the char-mode constructor guard never fires for an `svg` glyph |
| 6 | Manual — live app, `#/style-audit`, after visiting a screen with a scrollable panel/tree/table (any view showing scrollbar arrows) | No duplicate-rule group naming `ScrollArrowGlyph` with a `font-size`/`line-height`/`text-align` body remains; arrows render visually identically (10px triangle, centred) to before this plan |

---

## Verification

```
npm run typecheck
npm test
npm run lint
npm run docs:api        # must finish with zero warnings
```

Grep invariants, expecting zero matches:

```
grep -n 'setElementCSSRule("fontSize"\|setElementCSSRule("lineHeight"\|setElementCSSRule("textAlign"' packages/lib/src/typescript/lib/component/display/Glyph.ts
```

**Manual browser verification (row 6) is required.** The offline harness records writes; it does not run a CSS cascade or reflect the Style Audit panel's own dedup grouping.

- Start a dev server on a spare port from *this worktree* — confirm with `readlink /proc/<pid>/cwd` that it resolves here.
- Navigate to any screen with a visible custom scrollbar (e.g. a table or tree with more rows than fit), then to the Style Audit tab, then Refresh.
- Confirm no `ScrollArrowGlyph` duplicate-rule row carries a `font-size`/`line-height`/`text-align` body; confirm the up/down (or left/right) triangle glyphs still render at their existing 10px size, centred in their 12×12 boxes, unchanged from before this plan.

---

## Documentation Impact

No exported symbol or signature changes: `getClassStyleDefaults` is `protected`; `setFontSize`/`setLineHeight`/`setTextAlign`/`getFontSize`/`getLineHeight`/`getTextAlign` keep their existing signatures on `Glyph`. `ScrollArrowGlyph` is module-private (already was). No API page, barrel, or sidebar entry changes; `npm run docs:api` must still finish with zero warnings.

One entry in `packages/lib/docs/reference/changelog/next.md`, appended to the end of the **last** `## Changed` → `### Components` list in the file (after the existing `TableHeader` sort-indicator entry):

> **The triangle glyph inside a `Scrollbar`'s arrow buttons no longer repeats its font-size/line-height/text-align on every instance's own CSS rule.** These three properties now flow through the same shared class-tier mechanism `Glyph`'s size already used, instead of a raw, per-instance-only write. Nothing changes visually — every scrollbar's arrows render identically — the shared `.ScrollArrowGlyph` rule grows by three declarations and every instance's own rule shrinks by the same three. No consumer action is needed.

---

## Potential Challenges

- **A future second char-mode `Glyph` consumer constructed directly (not through a dedicated subclass) would still pay this cost.** Out of scope by design — see `## Non-Goals` and the "always-dispatch" decision above; `Glyph` itself deliberately registers no class default, since it is shared by every unrelated glyph in the app regardless of kind.
- **The two style-rule-disposal tests' canary has been defeated by three consecutive hoisting plans now.** Mitigated by switching from "rely on some property staying un-hoisted" to "force an explicit, always-real deviation" — a shape immune to any future hoisting plan, not just this one. See `## Architecture Decisions`.

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/component/display/Glyph.ts` | The three setters being fixed (356, 401, 432), the char-mode constructor guard (277-285) — untouched but the reason `ScrollArrowGlyph` pays this cost at all |
| `packages/lib/src/typescript/lib/component/container/Scrollbar.ts` | `ARROW_GLYPH_FONT_SIZE` (50), `_defaultScrollArrowGlyphOptions` (129), `ScrollArrowGlyph` and its stale comment (134-160), `ScrollArrowButton`'s imperative `setFontSize` call (230) — the only real consumer |
| `packages/lib/src/typescript/lib/component/display/Glyphs.ts` | The four `kind: "char"` registry entries (43-46) — confirms the enumeration in `## Overview` is exhaustive |
| `packages/lib/src/typescript/lib/component/container/AccordionIndicator.ts` | Confirms it is *not* a `Glyph` subclass and already has its own shared class rule (48-64) — the scope correction in `## Overview` |
| `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` | `TextStyleBag` (80), `ensureClassStyleRule`'s flat-vs-hierarchy branch (887-934), `chainParticipates` (489) — why the flat path is the correct, minimal registration mechanism here |
| `packages/lib/src/typescript/lib/core/Component.ts` | `writeStyle` (4983), `getClassStyleDefaults` (5678), the `_classLayer` assignment (5705) — the mechanism these setters move onto |
| `plans/implemented/glyph-preferredsize-reconciled-write-path.md` | The direct precedent: the same file, the same kind of "Glyph subclass registration gap," and its footnote `^why-not-hierarchy` explicitly rejecting the hierarchy mechanism for a `Glyph` subclass registration |
| `plans/text-input-class-tier-migration.md` | The precedent for moving a raw `setElementCSSRule` font setter onto `writeStyle`'s `font` sub-bag |
| `packages/lib/tests/component/container/ScrollbarArrow.test.ts` | "row 2" (227-251) — the pre-existing test that documents (and must be updated past) today's bug |
| `packages/lib/tests/component/container/VirtualScroller.styleRuleDisposal.test.ts`, `packages/lib/tests/core/Panel.styleRuleDisposal.test.ts` | Both rely on this exact bug as a disposal-tracking canary and need the explicit-deviation fix |

---

## Non-Goals

- **`CheckboxCheckGlyph` / `RadioButtonDot`.** Both `kind: "svg"`; never call these three setters; unaffected and untouched.
- **`AccordionIndicator`.** Not a `Glyph` subclass; already has its own shared class rule via a different, already-shipped mechanism. See `## Overview`'s correction.
- **A hypothetical future char-mode `Glyph` consumer constructed directly (not through a dedicated subclass).** No such consumer exists today (confirmed by the exhaustive `new Glyph(` / `.setFontSize(` / `.setLineHeight(` / `.setTextAlign(` sweep in `## Overview`). One arriving later needs its own dedicated subclass + `getClassStyleDefaults()` override, mirroring `ScrollArrowGlyph`'s shape here — not a change to base `Glyph`, which must stay free of any class default for these three properties since it is shared by every SVG-mode glyph in the app too.
- **The Button-family meta-class work, the `AbstractInput`/`TextInput` family, SVG-mode glyphs' sprite mechanism, and broader cross-component utility-class sharing.** All out of scope per this plan's originating brief; unrelated to this bug.
- **Bumping the package version.** Release-time bookkeeping.

---

## Notes

[^font-bag-fits]: `resolveDeclarations`'s `font` block ([`ClassStyleRules.ts:241-253`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L241)) already turns `font.fontSize`/`font.lineHeight`/`font.textAlign` into CSS in a class-agnostic way — nothing about it is `Text`-specific, and `TextStyleBag`'s own doc comment already names `Glyph` as one of the classes whose flat, differently-typed options make the `font` *namespace* necessary (not a reason a non-`Text` class can't use it). `GlyphOptions`'s only overlapping flat key is `textAlign`; `StyleBag` has no flat `textAlign` key, so nothing leaks either way.

[^why-not-hierarchy]: `glyph-preferredsize-reconciled-write-path.md`'s own footnote (`^why-not-hierarchy`) rejected adding `ownClassStyleDefaults` to **`Glyph` itself** for the size fix, because `chainParticipates` (`ClassStyleRules.ts:489`) switches a whole chain onto the hierarchy walk the moment *any* ancestor declares the field — and `Glyph` has two other subclasses (`CheckboxCheckGlyph`, `RadioButtonDot`) that would have silently lost their own `_defaultOptions`-derived colour/size values to a pass-through of `Glyph`'s own level. That specific hazard is about widening the *base* class; it does not apply to giving a **leaf** class (`ScrollArrowGlyph`, no subclasses of its own) `ownClassStyleDefaults` in isolation — `chainParticipates` is evaluated per concrete class's own ancestor chain, so `CheckboxCheckGlyph`/`RadioButtonDot` (a different branch under `Glyph`) would be untouched either way. The `getClassStyleDefaults()` override is still preferred over `ownClassStyleDefaults` on `ScrollArrowGlyph` for a narrower, positive reason: `ownClassStyleDefaults` also widens the rendered DOM class list (`getStyleClassChain`) to include every ancestor's own name, so a `ScrollArrowGlyph` element would additionally carry a bare `Glyph` class it never had before — a real, if narrow, breaking change to consumer CSS selector matching, for zero benefit over the override (both produce byte-identical CSS and dedup behaviour otherwise). The override achieves the same registration with strictly less surface area.

[^probe]: Verified directly in this worktree: the exact code in `## Internal Structure` was applied to `Glyph.ts` and `Scrollbar.ts`, and `ScrollbarArrow.test.ts`'s existing "row 2" was run with `console.log`-instrumented probing before being rewritten. Result, captured verbatim from the recording sink's `setRuleStyles` calls during a fresh `Scrollbar('vertical', { arrowsEnabled: true }).getElement(true)`: `.ScrollArrowGlyph` receives exactly `{"minWidth":"12px","minHeight":"12px","maxWidth":"12px","maxHeight":"12px","fontSize":"10px","textAlign":"center","lineHeight":"1"}` in one `setRuleStyles` call, and the glyph's own `#id` selector receives **no** `setRuleStyles` call at all (not even with `null` values) — confirming `## Expected Behaviour` rows 1-2 exactly. Applying only this fix (without also touching the two disposal tests) left `npx vitest run --no-file-parallelism` at 5216/5218 passing, both failures being `VirtualScroller.styleRuleDisposal.test.ts` (B1-3) and `Panel.styleRuleDisposal.test.ts` (B1-2) for the canary reason `## Architecture Decisions` describes. `npx tsc --noEmit -p .` reported no new error in any touched file (all pre-existing errors are in unrelated files). `npx eslint` on both touched source files reported no problems. After applying the two test fixes from `## Internal Structure` as well, the full suite passed at 5218/5218. All source and test changes were reverted after this probe; this worktree carries no diff as drafted.

[^suite-green]: See `[^probe]` — this was measured directly, not predicted: with every change in `## Internal Structure` applied, `npx vitest run --no-file-parallelism` from `packages/lib` reports 337 files / 5218 tests, all passing, with no file other than the three listed in this plan's `## Files to Create / Modify / Delete` test rows needing any edit.

---

## Implementation Notes

**Live browser verification (`## Ordered Implementation Steps` step 9 / `## Expected Behaviour` row 6 / `## Verification`'s manual rows) was performed and passed.** This worktree had no root `node_modules` (worktrees don't carry their own install); it was symlinked from the main tree's `node_modules` to get `vite` on the path — `packages/lib/vite.config.ts`'s own `@jimka/typescript-ui/*` aliases already remap every import back to this worktree's own `src` via `sub()`, so the demo app served this worktree's code regardless of what the `@jimka/typescript-ui` package symlink itself resolved to. A dev server was started from `packages/lib` in this worktree on a spare port (8020), confirmed via `readlink /proc/<pid>/cwd` to resolve to this worktree. Navigated to `#/misc` → "Show window with table (slow)!", which renders a `Scrollbar` with `arrowsEnabled` (the class default). A zoomed screenshot of the vertical scrollbar's up-arrow confirmed the triangle renders at its existing size, centred in its 12×12 box, unclipped — visually unchanged. Navigated to the "Style Audit" tab and clicked "Refresh": no `ScrollArrowGlyph` component appears anywhere in the duplicate-rule audit table (per-instance rules: 327 across 68 unique bodies), and the two remaining `Glyph`-labelled rows in the table carry only `min-width`/`min-height`/`max-width`/`max-height` bodies — no `font-size`/`line-height`/`text-align` body appears for any glyph, confirming the shared `.ScrollArrowGlyph` class rule absorbed the triple with no per-instance residue. The dev server was stopped and the `node_modules` symlink removed after verification.
