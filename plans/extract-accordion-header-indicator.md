---
depends-on: [migrate-rule-style-to-stylerule]
touches-shared:
  - src/typescript/lib/component/container/AccordionHeader.ts
  - src/typescript/lib/component/container/index.ts
---

# AccordionHeader — Extract Indicator Into A Component Subclass — Implementation Plan

## Overview

[`AccordionHeader`](../src/typescript/lib/component/container/AccordionHeader.ts) builds a raw `<span>` indicator in `init()` at [AccordionHeader.ts:115](../src/typescript/lib/component/container/AccordionHeader.ts#L115), registers two CSS rules for it in a static `createStyles()` helper at [AccordionHeader.ts:37-63](../src/typescript/lib/component/container/AccordionHeader.ts#L37-L63), and manually toggles a `.expanded` class on the raw node in `setExpanded` at [AccordionHeader.ts:133-145](../src/typescript/lib/component/container/AccordionHeader.ts#L133-L145). The indicator has:

1. Its own static `.ts-accordion-indicator` class rule (9 declarations).
2. A state class rule `.ts-accordion-indicator.expanded` (transform override) that rotates the chevron 90° on expand.
3. Independent visual behaviour (the rotation transition is animated, with optional timing override from `Accordion`).

That matches the three criteria for "warrants a `Component` subclass" in [ARCHITECTURE.md](../ARCHITECTURE.md) §_One DOM element per class_. The recent [`SortPriorityBadge`](../src/typescript/lib/component/table/cell/SortPriorityBadge.ts) and [`ResizeHandle`](../src/typescript/lib/component/table/cell/ResizeHandle.ts) extractions on the `header-cell-decompose-helpers` branch (commits `60d9966`, `d941136`) used the same reasoning and produced the canonical pattern this plan mirrors.

This plan introduces a new `AccordionIndicator` Component subclass that owns the chevron span and its two rules, retires `AccordionHeader._indicatorEl` and `createStyles()`, and rewires `setExpanded` / `setAnimationTiming` / `applyOptions` to delegate through the child Component. The new file replaces an architectural escape hatch (a Component re-implementing `Component` semantics in raw DOM) with the framework's queue-then-flush primitives.

---

## Architecture Decisions

### Extract `AccordionIndicator` as a `Component` subclass

Same shape, same justification as `SortPriorityBadge` / `ResizeHandle`: an overlay-positioned helper that owns its own CSS rule, its own state, and a typed setter. The current raw-`<span>` shape forces `AccordionHeader.setExpanded` to guard on `_indicatorEl !== null` (a no-op when the cascade dispatches before `init()` runs — see comment block at [AccordionHeader.ts:69-79](../src/typescript/lib/component/container/AccordionHeader.ts#L69-L79)). Promoting the indicator to a `Component` eliminates the guard: the child's own `_styleRule` / `_inlineStyle` queue-then-flush handles ordering correctly regardless of when `setExpanded` fires.

### Module-level `ensureAccordionIndicatorClassRule()` for the static rule

Match the [`SortPriorityBadge.ts:17-50`](../src/typescript/lib/component/table/cell/SortPriorityBadge.ts#L17-L50) / [`ResizeHandle.ts:20-49`](../src/typescript/lib/component/table/cell/ResizeHandle.ts#L20-L49) shape verbatim: a module-local `_classRule: StyleRule | null` plus an idempotent factory that builds the rule via `new StyleRule(() => CSS.getClassRule(name) ?? CSS.createClassRule(name)!)` and `setMany({...}) → ensure()`. This is the only architecturally-sanctioned seam for shared class rules per ARCHITECTURE.md §_CSS writes go through `StyleRule` / `InlineStyle`_. **Depends-on** the [`migrate-rule-style-to-stylerule`](migrate-rule-style-to-stylerule.md) plan landing first so that `AccordionHeader.ts`'s existing `createStyles()` has already been migrated to `StyleRule` shape — this extraction then mechanically moves the already-migrated rule into the new file, not the legacy `rule.style.setProperty` shape.

### The `.expanded` state rule uses `Component.createStyleRule(".expanded")`

ARCHITECTURE.md §_Defer DOM work to render time_ requires per-component state rules to allocate via `this.createStyleRule(suffix)` ([Component.ts:419-427](../src/typescript/lib/core/Component.ts#L419-L427)). That builder dedupes by suffix and registers the rule for render-time materialisation. The current `.ts-accordion-indicator.expanded` is a *shared* class rule (one selector across every instance), not a per-instance state rule — but the framework's per-component-state pattern fits the use case better: each indicator carries its own `#id.expanded` rule with `transform: translateY(-50%) rotate(90deg)`. The class-name toggle stays the same (`.expanded`), so the visual is identical; the rule scope tightens from "every indicator on the page" to "this instance, in expanded state." The base `.AccordionIndicator` class rule still holds the 9 static declarations (position/right/top/transform/pointer-events/font-size/line-height/color/transition); only the `transform` override moves to a per-instance state rule. This matches Button's pressed/hover state rules in [Button.ts:433](../src/typescript/lib/component/button/Button.ts#L433), [Button.ts:631](../src/typescript/lib/component/button/Button.ts#L631), which also use per-instance state rules over a shared base class.

### Rename `.ts-accordion-indicator` → `.AccordionIndicator`

`grep -rn 'ts-accordion-indicator' src/typescript` returns three hits — all inside [AccordionHeader.ts](../src/typescript/lib/component/container/AccordionHeader.ts#L44) (lines 44, 58, 116). Zero hits in [Theme.ts](../src/typescript/lib/core/Theme.ts), zero in any consumer. The theme token `--ts-ui-accordion-indicator-color` is referenced *inside* the class-rule body as `var(--ts-ui-accordion-indicator-color, rgb(100,100,100))`; the token lives in the cascade, not in the selector name. Renaming the class to `.AccordionIndicator` (matching the [`Component.constructor.name` auto-add convention](../src/typescript/lib/core/Component.ts) used by every other Component) is therefore safe and removes one piece of ad-hoc `ts-` prefixing. The theme token name stays unchanged.

### Indicator stays side-loaded, not Card-laid-out

[`Button`](../src/typescript/lib/component/button/Button.ts) wraps its label in a `_content` child with a `Fit` outer layout and an `HBox` inner layout ([Button.ts:159-177](../src/typescript/lib/component/button/Button.ts#L159-L177)). Adding `AccordionIndicator` as a second `Fit` child of the button would compete with `_content` for layout slots. The current overlay model (`position: absolute; right: 10px; top: 50%`) places the indicator outside the layout flow — that intent must survive the refactor. The pattern matches [HeaderCell's overlays](implemented/header-cell-decompose-helpers.md): construct the Component, render it side-loaded onto the host element via `host.getElement().appendChild(indicator.getElement(true))` in `init()`, never via `addComponent`. The indicator's `position: absolute` (held in its `.AccordionIndicator` class rule) keeps it out of the Button's Fit layout, exactly as today's raw `<span>` does.

### Three non-negotiables for `setExpanded` on the new class

Per ARCHITECTURE.md §_Three non-negotiable rules for every DOM write_: typed setter (`setExpanded`), cached backing field (`declare private _expanded: boolean`), and exposed on the options bag (`AccordionIndicatorOptions.expanded?: boolean`). The class-toggle happens via the framework's existing class-add path — Component already auto-adds `this.constructor.name` as a class on the element ([Component.ts:render](../src/typescript/lib/core/Component.ts)); the `.expanded` toggle is the secondary marker, applied through `element.classList.add/remove` *during render* (mirroring the cached-field-then-render-time-apply pattern in the [`feedback_setter_defer_dom_work`](../../../home/jika/.claude/projects/-home-jika-typescript-typescript/memory/feedback_setter_defer_dom_work.md) memory). `setExpanded(true)` writes `_expanded = true`, then either toggles the live class (if the element exists) or queues the toggle by relying on `render()` to read `_expanded` on first paint.

### `setAnimationTiming` moves to `AccordionIndicator`

Today the timing override at [AccordionHeader.ts:166-175](../src/typescript/lib/component/container/AccordionHeader.ts#L166-L175) writes `transform ${ms}ms ${easing}` directly to `_indicatorEl.style.transition`. That's an inline-style write on a raw DOM node; ARCHITECTURE.md §_All attributes and styles go through typed setters_ would have us use `Component.setTransition` on the indicator instead. The new `AccordionIndicator` exposes `setAnimationTiming(durationMs: number, easing: string): this` which calls its own `setTransition` (Component setter, queues through `_inlineStyle`). `AccordionHeader.setAnimationTiming` becomes a one-line delegate: `this._indicator.setAnimationTiming(durationMs, easing); return this;`. The public signature on `AccordionHeader` stays identical so [`Accordion.createSection`](../src/typescript/lib/layout/Accordion.ts) doesn't need a change.

---

## Public API (TypeScript Signatures)

### `AccordionIndicator` (new)

```typescript
// src/typescript/lib/component/container/AccordionIndicator.ts

import { Component, ComponentOptions } from "~/core/Component.js";

export interface AccordionIndicatorOptions extends ComponentOptions {
    expanded?: boolean;
}

class _AccordionIndicator extends Component<AccordionIndicatorOptions> {

    declare private _expanded: boolean;

    constructor(options?: AccordionIndicatorOptions);

    protected applyOptions(options: AccordionIndicatorOptions): this;
    protected init(element?: HTMLElement): this;
    protected render(): HTMLElement;

    setExpanded(value: boolean): this;
    getExpanded(): boolean;
    clearExpanded(): this;

    setAnimationTiming(durationMs: number, easing: string): this;
}

const AccordionIndicatorCallable = callable(_AccordionIndicator);
type AccordionIndicatorCallable = _AccordionIndicator;
export {
    _AccordionIndicator         as _AccordionIndicator,
    AccordionIndicatorCallable  as AccordionIndicator
};
```

`_expanded` is a `declare`-style backing field (not `=` initializer) to dodge the class-field super-cascade trap noted in the [`feedback_class_field_super_trap`](../../../home/jika/.claude/projects/-home-jika-typescript-typescript/memory/feedback_class_field_super_trap.md) memory — `applyOptions` may write the field via `setExpanded` during the super-cascade.

Constructor:
- Calls `ensureAccordionIndicatorClassRule()`.
- `super({ tag: "span", ...(options ?? {}) })`.
- `this._expanded ??= false`.
- `this.setTextContent("▶")` (or, if no `setTextContent` setter exists yet on `Component`, write to a private `_textContent` field flushed in `render()` — see *Potential Challenges*).
- Allocates the state rule: `const expandedRule = this.createStyleRule(".expanded"); expandedRule.set("transform", "translateY(-50%) rotate(90deg)");`. The builder dedupes and registers for render-time materialisation; the value lands when the framework flushes.

`setExpanded(value)` writes `_expanded`, then on a live element calls `element.classList.toggle("expanded", value)`. `render()` calls `super.render()` and applies the cached class if `_expanded` is true.

`setAnimationTiming(durationMs, easing)` calls `this.setTransition(\`transform ${durationMs}ms ${easing}\`)` — `setTransition` is an existing Component setter that queues into `_inlineStyle` or the per-component rule (verify exact route during implementation; the existing inline-style write in `AccordionHeader.setAnimationTiming` proves the value-shape is correct).

### `AccordionHeader` changes (signatures preserved)

```typescript
class AccordionHeader extends Button<AccordionHeaderOptions> {

    // Was:  private _indicatorEl: HTMLSpanElement | null = null;
    // Now:
    declare private _indicator: AccordionIndicator;

    // Removed: private _animationDurationMs / _animationEasing
    // (timing now lives on the indicator, applied as it arrives)

    // Removed: private static _stylesCreated / static createStyles()
}
```

Public method signatures (`setExpanded`, `isExpanded`, `setAnimationTiming`, `applyOptions`, `init`, constructor) stay byte-identical. Bodies collapse to one-line delegates.

---

## Theme Tokens

No new theme tokens. The existing `--ts-ui-accordion-indicator-color` token wired at [Theme.ts:225-227](../src/typescript/lib/core/Theme.ts#L225-L227) / [Theme.ts:334](../src/typescript/lib/core/Theme.ts#L334) / [Theme.ts:519](../src/typescript/lib/core/Theme.ts#L519) / [Theme.ts:692](../src/typescript/lib/core/Theme.ts#L692) (`theme.accordion.indicator.color`) is referenced verbatim by the migrated `.AccordionIndicator` class rule body: `color: "var(--ts-ui-accordion-indicator-color, rgb(100,100,100))"`. No `Theme.ts` edit is required.

---

## Internal Structure

### `.AccordionIndicator` class rule (registered once at module load)

```typescript
// AccordionIndicator.ts

let _classRule: StyleRule | null = null;

function ensureAccordionIndicatorClassRule(): void {
    if (_classRule) {
        return;
    }

    const rule = new StyleRule(() =>
        (CSS.getClassRule("AccordionIndicator")
            ?? CSS.createClassRule("AccordionIndicator")) as CSSStyleRule);

    rule.setMany({
        position:      "absolute",
        right:         "10px",
        top:           "50%",
        transform:     "translateY(-50%)",
        pointerEvents: "none",
        fontSize:      "10px",
        lineHeight:    "1",
        color:         "var(--ts-ui-accordion-indicator-color, rgb(100,100,100))",
        transition:    "transform 200ms ease",
    });
    rule.ensure();

    _classRule = rule;
}
```

### The `.expanded` state rule (per-instance, allocated in constructor)

```typescript
const expandedRule = this.createStyleRule(".expanded");
expandedRule.set("transform", "translateY(-50%) rotate(90deg)");
```

`createStyleRule` is dedupe-by-suffix and registered for render-time materialisation — exactly the same shape Button uses for `.pressed` / `.hover`.

### Class-toggle path on `.expanded`

```typescript
setExpanded(value: boolean): this {
    this._expanded = value;

    const element = this.getElement();
    if (element) {
        element.classList.toggle("expanded", value);
    }

    return this;
}

protected render(): HTMLElement {
    const element = super.render();

    if (this._expanded) {
        element.classList.add("expanded");
    }

    return element;
}
```

`render()` honouring `_expanded` is the queue-then-flush seam: cascade-time `setExpanded(true)` writes the field; render-time pickup applies the class. No guard needed, no fragile init-order dependency.

### AccordionHeader's side-loaded mount

```typescript
// AccordionHeader.ts (post-refactor)

constructor(label: string, options?: AccordionHeaderOptions) {
    super(label, options);

    this._indicator = new AccordionIndicator();

    this.getText().setTextAlign("left");
    this.getText().setInsets(new Insets(0, 0, 0, 8));
}

protected applyOptions(options: AccordionHeaderOptions): this {
    super.applyOptions(options);

    if (options.expanded !== undefined) {
        this.setExpanded(options.expanded);
    }

    return this;
}

protected init(element?: HTMLElement): this {
    super.init(element);

    const el = element || this.getElement();

    if (!el) {
        return this;
    }

    el.appendChild(this._indicator.getElement(true));

    return this;
}

setExpanded(expanded: boolean): this {
    this._options.expanded = expanded;
    this._indicator?.setExpanded(expanded);
    return this;
}

isExpanded(): boolean {
    return this._options.expanded ?? false;
}

setAnimationTiming(durationMs: number, easing: string): this {
    this._indicator?.setAnimationTiming(durationMs, easing);
    return this;
}
```

The `?.` on `this._indicator` covers the super-cascade case where `applyOptions` fires before the constructor body has constructed the child — the value lands on `_options.expanded` and the constructor's eventual `new AccordionIndicator()` either takes it from the options bag (if passed through) or via an immediate `_indicator.setExpanded(this._options.expanded ?? false)` line at the end of the constructor body. Either path is sufficient; preferring the latter keeps the indicator's own `applyOptions` clean.

---

## Ordered Implementation Steps

1. **Pre-flight: confirm dependency landed.** `git log master --oneline | head -5 | grep migrate-rule-style-to-stylerule` shows the [`migrate-rule-style-to-stylerule`](migrate-rule-style-to-stylerule.md) plan is implemented. If not, stop — the extraction below assumes `AccordionHeader.createStyles()` has already been migrated to the `StyleRule` pattern. **Verify:** `grep -n 'rule\.style\.' src/typescript/lib/component/container/AccordionHeader.ts` → 0.

2. **Write `AccordionIndicator.ts`.** Create [src/typescript/lib/component/container/AccordionIndicator.ts](../src/typescript/lib/component/container/AccordionIndicator.ts). Module-level `ensureAccordionIndicatorClassRule()`. Constructor calls it once, then `super({ tag: "span", ... })`. `declare private _expanded: boolean`. Constructor wires `this.setTextContent("▶")` (or the per-instance `_textContent` field, depending on Component's existing setter surface — see *Potential Challenges* item 1). Allocates `this.createStyleRule(".expanded")` and writes `set("transform", "translateY(-50%) rotate(90deg)")`. Implements `setExpanded` / `getExpanded` / `clearExpanded` / `setAnimationTiming` per the *Internal Structure* sketch. `applyOptions(options)` dispatches `setExpanded` when `options.expanded !== undefined`. Closes with the `callable(...)` wrap and the `_X` / `X` re-export pair. **Verify:** `npx tsc --noEmit` → 0 errors.

3. **Rewire `AccordionHeader.ts`.** Remove `_stylesCreated`, `createStyles()`, `_indicatorEl`, `_animationDurationMs`, `_animationEasing`. Add `declare private _indicator: AccordionIndicator`. Constructor: instantiate `this._indicator = new AccordionIndicator()` after `super(label, options)`. `init()` becomes `super.init(element); const el = element || this.getElement(); if (!el) return this; el.appendChild(this._indicator.getElement(true)); return this;`. `setExpanded` collapses to two lines: write `_options.expanded`, delegate to `_indicator?.setExpanded`. `setAnimationTiming` collapses to one delegate line. Drop the JSDoc commentary at lines 69-79 / 83-87 about the cascade-time no-op (the new pattern eliminates the fragility — replace with a one-sentence note that the indicator child handles its own queue-then-flush ordering). **Verify:** `grep -n '_indicatorEl\|document\.createElement\|_stylesCreated\|createStyles' src/typescript/lib/component/container/AccordionHeader.ts` → 0.

4. **Add barrel export.** [src/typescript/lib/component/container/index.ts](../src/typescript/lib/component/container/index.ts) currently exports `AccordionHeader` at lines 23-24. Append two lines:
   ```typescript
   export { AccordionIndicator } from '~/component/container/AccordionIndicator.js';
   export type { AccordionIndicatorOptions } from '~/component/container/AccordionIndicator.js';
   ```
   **Verify:** `grep -rn 'AccordionIndicator' src/typescript --include="*.ts"` → at least 3 hits (AccordionIndicator.ts definition, AccordionHeader.ts use, index.ts barrel).

5. **Typecheck + docs build.** `npx tsc --noEmit` → 0 errors; `npm run docs:build` → 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning). The new `AccordionIndicator` symbol lands under `docs/api/component/container/classes/AccordionIndicator.md` automatically (the typedoc-callable-plugin promotes the `AccordionIndicatorCallable as AccordionIndicator` export from `variables/` to `classes/`).

6. **Manual smoke at `http://localhost:8015`.** Find the `AccordionPanel` demo (Community 37 in [graphify-out/GRAPH_REPORT.md:229-231](../graphify-out/GRAPH_REPORT.md#L229) anchors `Accordion`; the demo is `AccordionPanel` per Community 2 at line 91). Confirm:
   - Indicator chevron renders at the right edge of every header, vertically centred.
   - Clicking a header toggles the section open / closed.
   - The chevron rotates 90° on expand and back to 0° on collapse, animated.
   - With `Accordion`'s `setAnimationDuration` override, the indicator's transition matches the panel transition.
   - Theme-toggle to dark mode — indicator color flips (resolves through `--ts-ui-accordion-indicator-color`).

7. **`graphify update .`.** Refresh the graph. The new `AccordionIndicator` node should appear; ideally it clusters with Community 37 (Accordion) or Community 9 (the extraction-parallels community housing `ResizeHandle` / `SortPriorityBadge`). Commit `graphify-out/**` as its own commit per the implement skill's three-commit structure.

---

## Files to Create / Modify / Delete

| Action | File                                                                                                            |
|--------|-----------------------------------------------------------------------------------------------------------------|
| Create | `src/typescript/lib/component/container/AccordionIndicator.ts`                                                  |
| Modify | `src/typescript/lib/component/container/AccordionHeader.ts` — remove `_indicatorEl` / `createStyles` / timing fields; delegate to `AccordionIndicator`. |
| Modify | `src/typescript/lib/component/container/index.ts` — append `AccordionIndicator` and `AccordionIndicatorOptions` exports. |

No deletions. No `Theme.ts` edit (the existing `--ts-ui-accordion-indicator-color` token is referenced verbatim by the new class rule).

---

## Verification

- `grep -n '_indicatorEl\|document\.createElement\|_stylesCreated\|createStyles' src/typescript/lib/component/container/AccordionHeader.ts` → **0 matches**.
- `grep -rn 'AccordionIndicator' src/typescript --include="*.ts"` → at least **3 hits** (definition + AccordionHeader use + barrel export).
- `grep -rn 'ts-accordion-indicator' src/typescript --include="*.ts"` → **0 matches** (the old class name is fully retired).
- `grep -n 'rule\.style\.' src/typescript/lib/component/container/AccordionIndicator.ts` → **0 matches** (StyleRule pattern only).
- `npx tsc --noEmit` → 0 errors.
- `npm run docs:build` → 0 errors, 0 link warnings.
- Manual smoke per step 6 above, in both light and dark themes.
- `graphify update .` succeeds; the new `AccordionIndicator` node appears in [graphify-out/GRAPH_REPORT.md](../graphify-out/GRAPH_REPORT.md).

---

## Documentation Impact

`AccordionIndicator` is a new public Component class in the `component/container` subpath bucket.

- **Barrel export:** [src/typescript/lib/component/container/index.ts](../src/typescript/lib/component/container/index.ts) adds the `AccordionIndicator` value export and the `AccordionIndicatorOptions` type export. No root barrel (none exists for this project).
- **`@category` tag:** the class JSDoc carries `@category Components`, matching `AccordionHeader`, `WindowHeader`, etc.
- **Curated page:** the existing `docs/component/` catalog covers `Accordion`-adjacent components; `AccordionIndicator` is internal scaffolding (consumers don't instantiate it directly — `AccordionHeader` does), so default posture is **no new curated page**. The typedoc-generated `docs/api/component/container/classes/AccordionIndicator.md` is sufficient. If a future consumer needs to compose `AccordionIndicator` standalone, add a curated page at that point.
- **Cross-bucket JSDoc references:** none required; `AccordionIndicator` is referenced only from `AccordionHeader.ts` (same subpath), so `{@link AccordionIndicator}` resolves within the same typedoc entry-point bundle.
- **`AccordionHeader` JSDoc:** the class-level description at [AccordionHeader.ts:18-25](../src/typescript/lib/component/container/AccordionHeader.ts#L18-L25) mentions "appended as a raw `<span>` inside the button element (analogous to the resize handle in HeaderCell)" — that wording becomes stale. Update to "the indicator is an [`AccordionIndicator`](./AccordionIndicator) Component child, side-loaded onto the button element so it sits outside Button's `Fit` layout."

Run `npm run docs:build` and verify the regenerated `AccordionHeader` page links the new `AccordionIndicator` class entry.

---

## Potential Challenges

- **`Component.setTextContent` may not exist.** The constructor needs to write `"▶"` as the indicator's text content. Confirm via `grep -n 'setTextContent\|setText(' src/typescript/lib/core/Component.ts`. If absent, follow the pattern in [`SortPriorityBadge.ts:115-121`](../src/typescript/lib/component/table/cell/SortPriorityBadge.ts#L115-L121) — cache the string in a private field and write it in `render()` (`element.textContent = "▶"`). The badge does exactly this for its priority text. Adding a first-class `setTextContent` setter on `Component` is out of scope for this plan; defer if needed.
- **`Component.setTransition` route.** `setAnimationTiming` calls `this.setTransition(...)` — verify that setter exists on Component and writes to either the per-component rule or `_inlineStyle`. The current implementation writes inline (`_indicatorEl.style.transition`), so an `_inlineStyle` route preserves the per-instance override semantics. If `setTransition` writes to the class rule, the override would apply to every instance — that's wrong (each Accordion can set its own timing). Mitigation: read `Component.setTransition` and confirm; if it writes to the shared rule, override `setAnimationTiming` to use `setElementStyle("transition", ...)` directly (which routes through `_inlineStyle` per ARCHITECTURE.md).
- **Cascade-time `setExpanded` before `_indicator` exists.** During `super(label, options)` in the AccordionHeader constructor, `applyOptions` may fire and call `this.setExpanded(true)` while `this._indicator` is still `undefined`. The proposed `setExpanded` body uses `this._indicator?.setExpanded(expanded)` — the optional chain short-circuits cleanly, and the constructor's late `new AccordionIndicator()` line will need an immediate `this._indicator.setExpanded(this._options.expanded ?? false)` to flush the buffered state. Mitigation: add that final flush line at the end of the constructor (after `getText().setInsets(...)`). The pattern mirrors Button's late-built text/glyph dispatch at [Button.ts:182-188](../src/typescript/lib/component/button/Button.ts#L182-L188).
- **Side-loaded child not in `_components`.** `el.appendChild(this._indicator.getElement(true))` mounts the indicator outside `addComponent`, so `_components` doesn't track it. Layout-wise that's correct (the indicator is absolute-positioned overlay, must not enter Fit). But: framework lifecycle hooks that iterate `_components` (e.g. `dispose`, `setTheme`) won't reach the indicator. Verify this is fine for `AccordionIndicator` (its theming flows through the static class rule's `var(--token)` so theme-switch already works without per-instance theme dispatch). If lifecycle reach matters, document it in the class-level JSDoc; otherwise the side-load mirrors HeaderCell's `_headerGlyphInstance` pattern (also side-loaded, also stays out of `_components`).
- **`createStyleRule` materialisation timing.** Allocating `this.createStyleRule(".expanded")` in the constructor queues into `_deferredStyleRules`; the rule materialises at render time when the framework iterates the map. Confirmed by reading [Component.ts:419-427](../src/typescript/lib/core/Component.ts#L419-L427) — the JSDoc explicitly notes "Safe to call from a lazy getter on the super-cascade path." No risk.
- **Test/demo coverage of the rotation animation.** The 90° rotate-on-expand is the user-visible behaviour. The manual smoke at step 6 covers it; no automated test exists for the indicator today, and adding one is out of scope (matching the precedent set by SortPriorityBadge / ResizeHandle, both shipped without dedicated tests).

---

## Critical Files

- [src/typescript/lib/component/container/AccordionHeader.ts](../src/typescript/lib/component/container/AccordionHeader.ts) — the file under refactor.
- [src/typescript/lib/component/table/cell/SortPriorityBadge.ts](../src/typescript/lib/component/table/cell/SortPriorityBadge.ts) — canonical extraction template (module-level `ensure*ClassRule`, `declare`-style fields, `callable` wrap).
- [src/typescript/lib/component/table/cell/ResizeHandle.ts](../src/typescript/lib/component/table/cell/ResizeHandle.ts) — canonical extraction template (state-rule pattern; closer to AccordionIndicator's expanded-state shape).
- [src/typescript/lib/core/Component.ts](../src/typescript/lib/core/Component.ts) — `createStyleRule(suffix)` at line 419, `addComponent` at line 2819, `setElementCSSRule(s)`, `setElementStyle(s)`, the auto-`constructor.name` class-add.
- [src/typescript/lib/component/button/Button.ts](../src/typescript/lib/component/button/Button.ts) — parent class; `Fit` outer layout with `HBox` inner content; the late-built text/glyph dispatch pattern at lines 182-188 (mirror for the late `setExpanded` flush).
- [src/typescript/lib/core/StyleTarget.ts](../src/typescript/lib/core/StyleTarget.ts) — `StyleRule` / `InlineStyle`; the `set` / `setMany` / `ensure` surface used by `ensureAccordionIndicatorClassRule`.
- [src/typescript/lib/core/Theme.ts](../src/typescript/lib/core/Theme.ts) — `theme.accordion.indicator.color` token wiring at lines 225-227 / 334 / 519 / 692. **Read-only for this plan; no edit.**
- [plans/implemented/header-cell-decompose-helpers.md](implemented/header-cell-decompose-helpers.md) — the prior extraction plan; this plan adopts its prose style verbatim and reuses the same module-level / state-rule pattern.
- [plans/migrate-rule-style-to-stylerule.md](migrate-rule-style-to-stylerule.md) — **hard dependency**; the existing `AccordionHeader.createStyles()` migrates to `StyleRule` shape under that plan before this extraction runs.
- [feedback_class_field_super_trap](../../../home/jika/.claude/projects/-home-jika-typescript-typescript/memory/feedback_class_field_super_trap.md) — memory note: `declare`-style backing fields, not `=` initializers, on Components whose setters dispatch through `applyOptions`.
- [feedback_setter_defer_dom_work](../../../home/jika/.claude/projects/-home-jika-typescript-typescript/memory/feedback_setter_defer_dom_work.md) — memory note: cache state in field, apply to element in `render()`; the `.expanded` class-toggle path follows this.

---

## Non-Goals

- **Promoting `AccordionIndicator` to a curated `docs/component/` page.** It is internal scaffolding for `AccordionHeader`; consumers don't instantiate it directly. Typedoc-generated API page is sufficient.
- **Adding a `setTextContent` setter on `Component`.** If absent, this plan uses the cached-field-flush-in-`render()` pattern from `SortPriorityBadge`. Promoting `setTextContent` to a first-class Component setter is a separate framework decision.
- **Theme-token rename.** `--ts-ui-accordion-indicator-color` stays. The class-name rename (`ts-accordion-indicator` → `AccordionIndicator`) doesn't touch the token.
- **Lifecycle wiring through `_components`.** The indicator stays side-loaded (mounted via `appendChild`, not `addComponent`) to preserve the absolute-positioned overlay model. If a future need arises for framework lifecycle hooks to reach the indicator, that's a separate refactor.
- **Migrating other raw-DOM helpers in `container/`.** [WindowHeader](../src/typescript/lib/component/container/WindowHeader.ts), [WindowBorder](../src/typescript/lib/component/container/WindowBorder.ts), and friends are out of scope. This plan addresses one ARCHITECTURE.md violation (`AccordionHeader._indicatorEl`); a sibling plan can scan the container subpath for further candidates.
- **Animating the chevron with a Glyph instead of `"▶"` text.** The text glyph is the existing visual; swapping to `Glyph` (the project's font-driven icon component) is a UX call, separate plan.
