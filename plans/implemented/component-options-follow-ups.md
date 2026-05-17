# Component Options Follow-Ups — Implementation Plan

## Overview

Two loose ends left after `feature/component-options-refactor` landed:

1. State-specific CSS rules — Button's `:active` and `:hover:not(:active)`, ToggleButton's `.selected` — materialise on **first write** rather than **first render**. The lazy `StyleRule.set()` auto-ensures the rule the moment any setter writes to it; that "first write" lands during the constructor body (or even during the super cascade, for setters fired off the merged-defaults bag). The stylesheet picks up a rule for every Button instance even if the user never presses or hovers one.
2. [src/typescript/lib/component/input/Text.ts](src/typescript/lib/component/input/Text.ts) is the one class that still uses the *old* per-instance `_defaultOptions` writes for class-level defaults ([Text.ts:64-73](src/typescript/lib/component/input/Text.ts#L64-L73)) instead of the module-level `_defaultXOptions` const + merge-defaults shape that every other class adopted. The exception was intentional — Text's font/text defaults are getter-fallback semantics that don't write to the DOM, where the merge-defaults pattern would push explicit `text-align`/`font-family`/`font-weight`/etc. into every Text instance's CSS rule. The migration is fine for most properties (their values match CSS defaults) but changes `font-family` from "inherit from parent" to "explicitly set to `var(--ts-ui-font-family, …)`", which would block parent-supplied fonts from cascading.

Both are quality-of-life follow-ups, not regressions. The first reduces stylesheet pollution; the second restores tree-wide pattern consistency.

---

## Architecture Decisions

### Part 1 — `Component.registerStyleRule` API for render-deferred materialisation

Add a list of "deferred rules" on Component and an `applyStyle` pass that flushes them. Subclasses that own a state-specific rule register it once during construction; the rule then sits with its dirty queue until `applyStyle` runs at first render.

Rejected alternative — having each subclass override `applyStyle` and call `this.someStyleRule.ensure()` per rule. Works, but every state-rule class repeats the same boilerplate, and the override is easy to forget.

Rejected alternative — passing `this` into `StyleRule`'s constructor so the rule self-registers (`new StyleRule(this, factory)`). Hits the field-initializer-clobber problem we've been dodging — Button's `_pressedStyleRule?: StyleRule` field initializer runs *after* super returns, so any registration that happened during super's cascade gets overwritten when the field is reset to `undefined`. The lazy-getter shape already in place ([Button.ts:95-98](src/typescript/lib/component/button/Button.ts#L95-L98)) is fine; we just need the *first time the getter constructs the wrapper* to also register it. The same applies to Button's `_hoverStyleRule` lazy getter at [Button.ts:106-109](src/typescript/lib/component/button/Button.ts#L106-L109), added after this plan was written.

### Part 1 — `StyleRule.set` reverts to queue-only

Once `Component.applyStyle` ensures registered rules at render time, the auto-materialise-on-first-write override in [StyleTarget.ts:121-160](src/typescript/lib/core/StyleTarget.ts) is no longer needed. Drop the `StyleRule.set` / `StyleRule.setMany` overrides; the inherited `StyleTarget.set` (queue when target null, write-through otherwise) becomes the canonical behaviour. The render-time ensure flushes the dirty queue.

### Part 2 — Text migrates with explicit `font-family` opt-out

`Text` adopts the same `_defaultTextOptions: Partial<TextOptions>` + merge-defaults shape as every other class. The cascade dispatches `setTextAlign`, `setFontSize`, `setFontWeight`, etc. once per instance with the final value.

The catch: `setFontFamily(value)` writes `font-family: <value>` to the component's CSS rule, blocking inheritance. If the consumer doesn't supply `fontFamily`, the cascade fires `setFontFamily("var(--ts-ui-font-family, system-ui, sans-serif)")` — every Text gets that var explicitly, breaking the "Text inherits font from its parent" semantic.

Resolution: omit `fontFamily` from `_defaultTextOptions` and keep it as a getter-fallback only. The existing `getFontFamily()` already does `_options.fontFamily ?? _defaultOptions.fontFamily ?? null` ([Text.ts:423](src/typescript/lib/component/input/Text.ts#L423)) — the per-instance `_defaultOptions.fontFamily` write at [Text.ts:65](src/typescript/lib/component/input/Text.ts#L65) stays, just narrowed to that one field. Every other default migrates.

### Part 2 — `lineHeight` and theme reactivity stay in the body

Text's `lineHeight` default is computed from the theme via `readThemeLineHeightPx()` ([Text.ts:73](src/typescript/lib/component/input/Text.ts#L73)) and re-derived in the theme-change listener ([Text.ts:78-95](src/typescript/lib/component/input/Text.ts#L78-L95)). A module-level `_defaultTextOptions` const can't call instance methods at module load. Two clean options:

- **A.** Keep `lineHeight` out of `_defaultTextOptions`, leave the per-instance `_defaultOptions.lineHeight` write in the constructor body. Consistent with the `fontFamily` carve-out.
- **B.** Move the theme-reactive defaults into a helper that returns a fresh `Partial<TextOptions>` per construction. Cleaner if more theme-reactive defaults appear later.

Recommend **A** — symmetry with `fontFamily`, no new helper, theme listener already handles re-derivation.

---

## Public API (TypeScript Signatures)

### `Component` — new protected registration

```typescript
class Component<TOptions extends ComponentOptions = ComponentOptions> {
    /**
     * Subclass-owned style rules that should materialise at first render
     * rather than at first write. Iterated by `applyStyle`; each `ensure()`
     * call flushes its dirty queue into the live `CSSStyleRule`.
     */
    private deferredStyleRules: StyleRule[];

    /**
     * Registers a state-specific `StyleRule` (e.g. Button's `:active`,
     * ToggleButton's `.selected`) for render-time materialisation. Safe to
     * call from a lazy getter — the registration list is initialised in
     * Component's constructor body before the applyOptions cascade fires,
     * so virtually-dispatched setters can register their rules at any point
     * along the super chain.
     *
     * @param rule - A `StyleRule` whose underlying CSSStyleRule should be
     *               created and flushed when this component first renders.
     */
    protected registerStyleRule(rule: StyleRule): void;

    applyStyle(element: HTMLElement): this {
        // ...existing body...
        for (const rule of this.deferredStyleRules) {
            rule.ensure();
        }
        return this;
    }
}
```

### `StyleRule` — drop the auto-materialise overrides

```typescript
// Before (in src/typescript/lib/core/StyleTarget.ts)
class StyleRule extends StyleTarget<CSSStyleRule> {
    set(key: string, value: string | null): void { this.ensure(); super.set(key, value); }
    setMany(values: Record<string, string | null>): void { this.ensure(); super.setMany(values); }
}

// After — both overrides removed. Inherited StyleTarget.set queues when
// target is null, writes through when materialised.
class StyleRule extends StyleTarget<CSSStyleRule> {
    constructor(factory: () => CSSStyleRule);
    ensure(): CSSStyleRule;
}
```

### `Text` — module-level defaults const, with two carve-outs

```typescript
// New module-level const, after imports.
const _defaultTextOptions: Partial<TextOptions> = {
    textAlign:      "left",
    fontKerning:    "auto",
    fontSize:       14,
    fontSizeAdjust: "none",
    fontStretch:    "normal",
    fontStyle:      "normal",
    fontVariant:    "normal",
    fontWeight:     "normal",
    // fontFamily intentionally omitted — caller-supplied or inherits from parent
    // lineHeight intentionally omitted — theme-derived per-instance
};

class Text<TOptions extends TextOptions = TextOptions> extends Component<TOptions> {
    constructor(text?: String, options?: TOptions) {
        super({
            ..._defaultTextOptions,
            ...(options ?? {}),
            tag: options?.tag ?? "span",
        } as TOptions);

        // Carve-outs — getter-fallback only, never reach the DOM via setters.
        this._defaultOptions.fontFamily = "var(--ts-ui-font-family, system-ui, sans-serif)";
        this._defaultOptions.lineHeight = this.readThemeLineHeightPx();
        // ...rest of constructor body unchanged...
    }
}
```

---

## Internal Structure

### Registration timing for Button-shaped classes

Button uses a lazy getter to dodge the field-initializer clobber:

```typescript
private _pressedStyleRule?: StyleRule;
private get pressedStyleRule(): StyleRule {
    if (!this._pressedStyleRule) {
        this._pressedStyleRule = new StyleRule(() => CSS.createComponentRule(this.getId() + ":active") as CSSStyleRule);
        this.registerStyleRule(this._pressedStyleRule);
    }
    return this._pressedStyleRule;
}

private _hoverStyleRule?: StyleRule;
private get hoverStyleRule(): StyleRule {
    if (!this._hoverStyleRule) {
        this._hoverStyleRule = new StyleRule(() => CSS.createComponentRule(this.getId() + ":hover:not(:active)") as CSSStyleRule);
        this.registerStyleRule(this._hoverStyleRule);
    }
    return this._hoverStyleRule;
}
```

The `if`/`return` shape replaces the existing `??=` so the registration call happens exactly once. `registerStyleRule` lives on Component; the `deferredStyleRules` list is initialised in Component's constructor body **before** the `applyOptions` cascade fires ([Component.ts:217-271](src/typescript/lib/core/Component.ts#L217-L271) — alongside the `this.components`, `this.attributes` block). That ordering is what makes it safe for the cascade-time setPressedX / setHoverX call to register through the getter.

For ToggleButton, the same shape replaces the field-initializer at [ToggleButton.ts:31](src/typescript/lib/component/button/ToggleButton.ts#L31).

---

## Ordered Implementation Steps

### Part 1 — Render-deferred StyleRule

1. `src/typescript/lib/core/Component.ts` — declare `private deferredStyleRules!: StyleRule[]` near the existing bag declarations ([Component.ts:185-197](src/typescript/lib/core/Component.ts#L185-L197)); assign `this.deferredStyleRules = []` in the constructor body **before** `this.applyOptions(options ?? ({} as TOptions))` runs.
2. Add `protected registerStyleRule(rule: StyleRule): void { this.deferredStyleRules.push(rule); }`.
3. In `applyStyle` ([Component.ts:2161](src/typescript/lib/core/Component.ts#L2161)), after the existing rule writes complete, iterate `this.deferredStyleRules` and call `rule.ensure()` on each. (No `inlineStyle.flush()` neighbour at the tail of `applyStyle` — the inline-style queue is flushed elsewhere in the render path; the deferred-rule ensure pass sits at the very end of `applyStyle`.)
4. `src/typescript/lib/core/StyleTarget.ts` — remove `StyleRule.set` and `StyleRule.setMany` overrides; the class is left with the constructor and `ensure()` only. Confirm by reading the file: the only methods on `StyleRule` should now be `constructor` and `ensure()`.
5. `src/typescript/lib/component/button/Button.ts` — rewrite **both** lazy state-rule getters from `??=` to the explicit `if`/`registerStyleRule`/`return` shape:
   - `pressedStyleRule` at [L95-98](src/typescript/lib/component/button/Button.ts#L95-L98)
   - `hoverStyleRule` at [L106-109](src/typescript/lib/component/button/Button.ts#L106-L109)
6. `src/typescript/lib/component/button/ToggleButton.ts` — replace the field initializer at [L31](src/typescript/lib/component/button/ToggleButton.ts#L31) with the same lazy-getter-with-registration shape (Button's pattern, applied to `_selectedStyleRule` backing slot + `selectedStyleRule` getter). Same logic applies — `selectedStyleRule.set(...)` calls at [L41-43](src/typescript/lib/component/button/ToggleButton.ts#L41-L43) now go through the getter, which registers on first access.
7. Regression checkpoint — `grep -rn 'StyleRule.set' src/typescript/lib | grep -v StyleTarget.ts` should show only call sites (no method overrides remain inside StyleRule).

### Part 2 — Text migrates to merge-defaults

8. `src/typescript/lib/component/input/Text.ts` — add `const _defaultTextOptions: Partial<TextOptions>` after imports, with the seven fields listed in the API block above (omitting `fontFamily` and `lineHeight`).
9. Rewrite the super call at [Text.ts:58](src/typescript/lib/component/input/Text.ts#L58) to merge `_defaultTextOptions` into the bag.
10. Delete the eight `this._defaultOptions.X = "..."` writes at [Text.ts:64-72](src/typescript/lib/component/input/Text.ts#L64-L72) for the migrated fields; keep lines 65 (`fontFamily`) and 73 (`lineHeight`).
11. Verify the theme-listener at [Text.ts:78-95](src/typescript/lib/component/input/Text.ts#L78-L95) still updates only `fontSize` and `lineHeight` on `_defaultOptions` — `fontSize` is now in the module const, so the listener's `_defaultOptions.fontSize = parsed` write at [L86](src/typescript/lib/component/input/Text.ts#L86) becomes a no-op for the merged value (the cascade-applied `_options.fontSize = 14` already populated the live bag). Decide whether to drop the listener's `fontSize` write entirely (since the cascade applied 14 once) or change it to `this._options.fontSize = parsed` so the runtime theme change actually re-flows.
12. Regression checkpoint — `grep -nE 'this\._defaultOptions\.' src/typescript/lib/component/input/Text.ts` should show exactly two lines (the `fontFamily` and `lineHeight` writes) plus the theme listener's two re-derivation writes.

### Final verification

13. `npm run typecheck` — pre-existing Vite/`@types/node`/ComplexUIPanel errors acceptable; nothing new.
14. `npm run build`, `npm run build:lib`, `npm run docs:build` — clean, 0 link warnings (TS-version notice acceptable).
15. `npm run dev` — load every demo tab. Click a Button to confirm the `:active` styling fires. Toggle a ToggleButton to confirm the `.selected` styling fires. Open the Theme panel and toggle the theme — Text font size should update, then changes (line height) should re-flow.
16. DevTools Elements panel sanity — for a freshly-rendered Button that's never been pressed, search for a `:active` rule in the inserted-rules list before clicking. Pre-render: rule absent. After first render: rule present (because `applyStyle` ensure'd it). This confirms render-deferral, not first-write.
17. `graphify update . --directed`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | [src/typescript/lib/core/Component.ts](src/typescript/lib/core/Component.ts) |
| Modify | [src/typescript/lib/core/StyleTarget.ts](src/typescript/lib/core/StyleTarget.ts) |
| Modify | [src/typescript/lib/component/button/Button.ts](src/typescript/lib/component/button/Button.ts) |
| Modify | [src/typescript/lib/component/button/ToggleButton.ts](src/typescript/lib/component/button/ToggleButton.ts) |
| Modify | [src/typescript/lib/component/input/Text.ts](src/typescript/lib/component/input/Text.ts) |

---

## Verification

- Browser DevTools Elements panel — confirm the `:active`, `:hover:not(:active)`, and `.selected` CSS rules are *absent* from the document stylesheet for buttons that haven't yet rendered. After scrolling into view (or otherwise rendering), the rules appear.
- `grep -nE 'pressedStyleRule|hoverStyleRule|selectedStyleRule' src/typescript/lib/component/button/*.ts` — every read should be through the getter, every wrapper-allocation should `registerStyleRule` exactly once.
- Demo smoke test — Misc tab (buttons), Binding tab (text-bound components), Accordion tab (headers with Text children) all render with no visual regression. `font-family` on a `Text` inside a panel with a custom `fontFamily` should still inherit (the fontFamily carve-out preserves this).
- Theme toggle — `font-size` and `line-height` updates re-flow through Text instances after the theme change. Without the `fontSize` listener write being routed to `_options`, this regresses; verify both behaviours.

---

## Potential Challenges

- **Field-initializer ordering on `deferredStyleRules`.** Initialising it via `private deferredStyleRules: StyleRule[] = []` would run *after* super() returns in subclasses but *during* the field-initializer pass of Component's own constructor — meaning the cascade-time `registerStyleRule` call would push onto an array that the field initializer then overwrites with a fresh `[]`. Mitigation: declare with the `!` definite-assignment assertion (`private deferredStyleRules!: StyleRule[]`) and assign in Component's constructor *body* before `this.applyOptions(...)` fires, same pattern `_options` and `_defaultOptions` already use ([Component.ts:206-211](src/typescript/lib/core/Component.ts#L206-L211)).
- **Theme-listener `fontSize` re-flow.** Step 11's decision matters — getting it wrong silently breaks theme-toggle font sizing for every Text instance after the first theme change. Read [src/typescript/lib/core/Theme.ts](src/typescript/lib/core/Theme.ts) for how the `--ts-ui-font-size` var is wired before deciding whether to drop or route the listener write.
- **Pre-existing `lineHeight` written via `setElementCSSRule` at construction.** [Text.ts:76](src/typescript/lib/component/input/Text.ts#L76) writes the lineHeight CSS rule eagerly. The migration doesn't change this — it's a real DOM write for layout correctness — but worth not breaking when rearranging.
- **ToggleButton's defaults could move into a module const too.** The three `selectedStyleRule.set(...)` calls at [ToggleButton.ts:41-43](src/typescript/lib/component/button/ToggleButton.ts#L41-L43) are pure class-level defaults. They could ride a `_defaultToggleButtonStateStyles` const, but the inputs are CSS strings rather than `XOptions` fields, so they don't fit the merge-defaults pattern. Leave them as constructor body writes; the deferral makes those writes queue rather than insert.

---

## Critical Files

- [src/typescript/lib/core/Component.ts](src/typescript/lib/core/Component.ts) — bag/init pattern at L185-258, `applyStyle` at L2161-2290.
- [src/typescript/lib/core/StyleTarget.ts](src/typescript/lib/core/StyleTarget.ts) — `StyleRule` and `InlineStyle` definitions.
- [src/typescript/lib/component/button/Button.ts](src/typescript/lib/component/button/Button.ts) — the canonical state-rule pattern (`pressedStyleRule` getter at L86-89).
- [src/typescript/lib/component/button/ToggleButton.ts](src/typescript/lib/component/button/ToggleButton.ts) — Button-extending state-rule case.
- [src/typescript/lib/component/input/Text.ts](src/typescript/lib/component/input/Text.ts) — the Text migration target.
- [src/typescript/lib/core/Theme.ts](src/typescript/lib/core/Theme.ts) — context for the theme-listener `fontSize` re-flow decision.
- [plans/implemented/options-bag-state-refactor.md](plans/implemented/options-bag-state-refactor.md) — background on why Text was left out of the original sweep.

---

## Non-Goals

- Refactoring `ToggleButton.selectedStyleRule` defaults into a module-level options const. They're CSS-rule values, not consumer-facing options.
- Auditing other classes for similar render-deferral opportunities. Only Button and ToggleButton have state-specific CSS rules today; any future state-rule class (hover/focus/etc.) should follow the same `registerStyleRule` shape.
- Migrating `Label.ts` / `PaginationBar.ts` / `MultiSelectList.ts` / `Table.ts` / `Tree.ts` / `TextInput.ts` to merge-defaults — they were skipped in the original sweep because they have no defaults to lift, not because they had carve-outs to preserve. No follow-up needed.
- Removing the per-instance `_defaultOptions` fallback layer on Component. It still serves as the getter-fallback for `Text.fontFamily` and `Text.lineHeight`, and as the safety net for any future class-level fallback that can't live in a module const.
