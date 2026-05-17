# Button Hover Theming — Implementation Plan

## Overview

[`Button`](../src/typescript/lib/component/button/Button.ts) currently themes only its normal and `:active` states (see the `pressedX` family of setters and the lazy `pressedStyleRule` at [Button.ts:86-89](../src/typescript/lib/component/button/Button.ts#L86-L89)). There is no visual feedback when the pointer is merely *over* the button — the default chrome stays static until the user actually clicks. This plan adds a mirror `hoverX` family driven by a second lazy CSS rule scoped to `:hover:not(:active)`, plus matching theme tokens.

The change is additive and lives entirely inside [Button.ts](../src/typescript/lib/component/button/Button.ts): all four subclasses ([`ToggleButton`](../src/typescript/lib/component/button/ToggleButton.ts), [`TabCloseButton`](../src/typescript/lib/component/button/TabCloseButton.ts), [`SpinButton`](../src/typescript/lib/component/input/SpinButton.ts), [`AccordionHeader`](../src/typescript/lib/component/container/AccordionHeader.ts)) inherit the hover treatment automatically because they all extend `Button<…Options>` and forward through the option cascade.

---

## Architecture Decisions

### Mirror the `pressedX` family verbatim

The pressed-state API is the exact prior art for this problem: lazy `StyleRule` over a pseudo-class selector, `setX/getX/clearX` triplet per CSS property, defaults seeded into `_defaultButtonOptions` so the merged options bag drives the super cascade. Re-using the same pattern keeps the surface symmetric (every `setPressedX` gets a `setHoverX` sibling) and means no new infrastructure — `StyleRule`, `CSS.createComponentRule`, and the `applyOptions` dispatch already handle everything.

### Selector is `:hover:not(:active)`, not bare `:hover`

A naive `:hover` rule has the same specificity as `:active`, so source order in the stylesheet decides which one wins on click. Because both `hoverStyleRule` and `pressedStyleRule` are lazy and materialise on first write, the source order is not deterministic — whichever setter the user calls first inserts its rule first. Anchoring hover at `:hover:not(:active)` makes the cascade unambiguous: the moment the pointer goes down, `:active` matches and `:hover:not(:active)` stops matching, so the pressed treatment always wins regardless of insertion order.

This also incidentally side-steps the disabled-state question — `<button disabled>` rejects `:active` and the browser also suppresses `:hover` on disabled buttons in every major engine. The 0.5 opacity from `setEnabled(false)` already signals disabled state; no extra `:not(:disabled)` guard is needed.

### Four properties, matching `pressedX`

Hover exposes `backgroundColor`, `backgroundImage`, `foregroundColor`, and `shadow`. Border and border-radius are intentionally omitted from the *defaults* because hover-driven border swaps cause perceptible layout shifts (border width changes the box) and rounded-corner animation is gratuitous — but the setter surface includes them for parity (`setHoverBorder`, `setHoverBorderRadius`) so consumers who want them can opt in. This matches the pressed-state surface exactly.

### Defaults: brighten the gradient, slightly lift the shadow

The default hover treatment must be visible enough to read at a glance but quiet enough that it doesn't compete with the pressed treatment. Light theme: lighten the top stop of the existing button gradient and bump the shadow's spread/alpha modestly. Dark theme: lighten both stops one notch. Foreground stays inherited (`null` default — the rule omits the property). No border swap.

### Subclass coverage is automatic

[`ToggleButton`](../src/typescript/lib/component/button/ToggleButton.ts), [`TabCloseButton`](../src/typescript/lib/component/button/TabCloseButton.ts), [`SpinButton`](../src/typescript/lib/component/input/SpinButton.ts), and [`AccordionHeader`](../src/typescript/lib/component/container/AccordionHeader.ts) all extend `Button<…Options>` and pipe through `Button`'s `_defaultButtonOptions` cascade. The merged-options-bag pattern means each subclass can override hover defaults the same way `TabCloseButton` already overrides `foregroundColor` and `insets`, but does not need to in order to inherit the new behaviour. `ToggleButton`'s `.selected` rule has higher specificity than `:hover:not(:active)`, so hovering a selected toggle leaves the selected chrome intact (intentional — the toggle is already visually distinct).

---

## Public API (TypeScript Signatures)

Added to [`ButtonOptions`](../src/typescript/lib/component/button/Button.ts#L23-L33):

```typescript
export interface ButtonOptions extends ComponentOptions {
    // ...existing fields...
    hoverBackgroundColor?: string;
    hoverBackgroundImage?: string;
    hoverForegroundColor?: string;
    hoverBorder?:          BorderOptions;
    hoverBorderRadius?:    string;
    hoverShadow?:          string;
}
```

Added to `Button` (mirroring [Button.ts:287-478](../src/typescript/lib/component/button/Button.ts#L287-L478) for `pressedX`):

```typescript
getHoverBackgroundColor():   string | null;
setHoverBackgroundColor(c:   string): this;
clearHoverBackgroundColor(): this;

getHoverBackgroundImage():   string | null;
setHoverBackgroundImage(i:   string): this;
clearHoverBackgroundImage(): this;

getHoverForegroundColor():   string | null;
setHoverForegroundColor(c:   string): this;
clearHoverForegroundColor(): this;

getHoverBorder():            Border | null;
setHoverBorder(o?:           BorderOptions): this;

getHoverBorderRadius():      string | null;
setHoverBorderRadius(r:      string): this;
clearHoverBorderRadius():    this;

getHoverShadow():            string | null;
setHoverShadow(s:            string): this;
clearHoverShadow():          this;
```

Cached backing fields: `_hoverStyleRule?: StyleRule` (lazy, identical pattern to [`_pressedStyleRule`](../src/typescript/lib/component/button/Button.ts#L86-L89)) and `hoverBorder: Border | null = null`. The `XOptions` fields are written through `_options.hoverX` exactly the way pressed* writes through `_options.pressedX`.

---

## Theme Tokens

| CSS Custom Property | Light Default | Dark Default | Purpose |
|---|---|---|---|
| `--ts-ui-button-hover-bg` | `linear-gradient(rgb(252, 252, 252), rgb(220, 220, 220))` | `linear-gradient(rgb(90, 90, 90), rgb(65, 65, 65))` | Hover background (gradient or solid colour — same dual-routing as `--ts-ui-button-bg`). |
| `--ts-ui-button-hover-fg` | (token defined but unused — defaults to inherited text colour) | (token defined but unused) | Foreground override for hover; null in default options. |
| `--ts-ui-button-hover-shadow` | `1px 3px 6px 0 rgba(0, 0, 0, 0.25)` | `1px 3px 6px 0 rgba(0, 0, 0, 0.55)` | Slightly elevated shadow on hover. |

The `--ts-ui-button-hover-fg` token is defined for completeness/customisation but the default fallback in [Button.ts](../src/typescript/lib/component/button/Button.ts) does *not* seed a `hoverForegroundColor` in `_defaultButtonOptions`, so the rule simply omits `color` and inheritance handles it. Consumers who want a hover-time text colour shift set `--ts-ui-button-hover-fg` and pass `hoverForegroundColor: "var(--ts-ui-button-hover-fg, ...)"` themselves, or override per-instance.

[`Theme.ts`](../src/typescript/lib/core/Theme.ts) edits:
- Extend the `button.hover` sub-tree of the `Theme` interface ([Theme.ts:45-58](../src/typescript/lib/core/Theme.ts#L45-L58)) with `{ background, foreground, shadow }`.
- Add `hover` values to `DefaultTheme.button` ([Theme.ts:260-271](../src/typescript/lib/core/Theme.ts#L260-L271)) and `DarkTheme.button` ([Theme.ts:409-420](../src/typescript/lib/core/Theme.ts#L409-L420)).
- Add three `--ts-ui-button-hover-*` entries to `themeToVars` ([Theme.ts:550-649](../src/typescript/lib/core/Theme.ts#L550-L649)), grouped next to the existing pressed tokens.

---

## Internal Structure

The new lazy rule, sibling to `_pressedStyleRule` at [Button.ts:86-89](../src/typescript/lib/component/button/Button.ts#L86-L89):

```typescript
private _hoverStyleRule?: StyleRule;
private get hoverStyleRule(): StyleRule {
    return this._hoverStyleRule ??= new StyleRule(
        () => CSS.createComponentRule(this.getId() + ":hover:not(:active)") as CSSStyleRule
    );
}
private hoverBorder: Border | null = null;
```

The setters delegate to `hoverStyleRule.set(...)`, mirroring [`setPressedBackgroundColor`](../src/typescript/lib/component/button/Button.ts#L298-L303):

```typescript
setHoverBackgroundColor(backgroundColor: string): this {
    this._options.hoverBackgroundColor = backgroundColor;
    this.hoverStyleRule.set("backgroundColor", backgroundColor);
    return this;
}
```

`_defaultButtonOptions` gains three new entries next to the pressed defaults at [Button.ts:43-55](../src/typescript/lib/component/button/Button.ts#L43-L55):

```typescript
hoverBackgroundColor: "var(--ts-ui-button-hover-bg, rgb(252, 252, 252))",
hoverBackgroundImage: "var(--ts-ui-button-hover-bg, none)",
hoverShadow:          "var(--ts-ui-button-hover-shadow, 1px 3px 6px 0 rgba(0, 0, 0, 0.25))",
```

`applyOptions` ([Button.ts:181-196](../src/typescript/lib/component/button/Button.ts#L181-L196)) gains a parallel block dispatching each `hoverX` setter when the option is defined. The lazy-getter contract is the same as for pressed*: setters are safe to fire during the super cascade because the rule object isn't materialised until first `.ensure()` (only `setHoverBorder` calls `ensure`; the others enqueue into `StyleTarget.dirty` via `.set`).

---

## Ordered Implementation Steps

1. **Theme tokens** — extend the `button.hover` interface, defaults, and `themeToVars` mapping in [Theme.ts](../src/typescript/lib/core/Theme.ts). Verify: `npx tsc --noEmit` clean.
2. **Button options + state** — add `hoverX` fields to `ButtonOptions`, the lazy `_hoverStyleRule` getter, and `hoverBorder` backing field in [Button.ts](../src/typescript/lib/component/button/Button.ts).
3. **Button setters/getters/clearers** — append the seven setter/getter/clear triplets after the existing pressed-state block at [Button.ts:478](../src/typescript/lib/component/button/Button.ts#L478). Match formatting (column-aligned colons, JSDoc voice) exactly.
4. **Default options seed** — add the three `hover*` entries to `_defaultButtonOptions`. Verify: open `npm run dev`, hover any `Button` in `MiscPanel`, observe the gradient lighten.
5. **applyOptions dispatch** — append the parallel `if (options.hoverX !== undefined) this.setHoverX(...)` block to `Button.applyOptions`.
6. **Subclass smoke** — open `MiscPanel` (Button), `LayoutTestPanel` (ToggleButton), `TabPanel` (TabCloseButton, hover the × on a tab), `AccordionPanel` (AccordionHeader), and a `NumberSpinner` demo (SpinButton up/down arrows). Each should show the hover treatment without the pressed treatment leaking through on click. Verify cursor stays `pointer` and pressed chrome still wins on `mousedown`.
7. **Theme toggle** — switch to dark mode, confirm hover colours track. Switch back, confirm no stale rule remains (CSS variables flip, not stylesheet rebuild — same behaviour as pressed).
8. **Docs** — run `npm run docs:build` and confirm 0 errors and 0 link warnings (the typedoc "unsupported TypeScript version" notice is the lone acceptable warning).
9. **Graph refresh** — `graphify update .` per [CLAUDE.md](../CLAUDE.md).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | [src/typescript/lib/component/button/Button.ts](../src/typescript/lib/component/button/Button.ts) — add hover options, lazy rule, setter family, default seeds, applyOptions dispatch |
| Modify | [src/typescript/lib/core/Theme.ts](../src/typescript/lib/core/Theme.ts) — `Theme.button.hover` sub-tree, light/dark defaults, `themeToVars` entries |

No new files. No deletions. Subclass files are untouched — they inherit through the `Button<…Options>` cascade.

---

## Verification

1. `npx tsc --noEmit` — no new errors above baseline.
2. `npm run dev` smoke pass on `MiscPanel`, `LayoutTestPanel`, `TabPanel`, `AccordionPanel`, and a panel that exercises `NumberSpinner`/`SpinButton`. Hover each kind of button; confirm:
   - Visible change on mouseover (background lightens, shadow lifts).
   - On click, pressed chrome takes over (no hover bleeding through under the inset shadow).
   - Disabled buttons (`button.setEnabled(false)`) show no hover treatment.
   - `ToggleButton` in its `.selected` state keeps the selected chrome on hover (selected has higher specificity than `:hover:not(:active)`).
3. Theme toggle — flip `ThemeManager.setTheme(DarkTheme)`, hover the same buttons, confirm the dark-theme hover colours apply and that switching back restores the light defaults.
4. `npm run docs:build` — 0 errors and 0 link warnings (sole acceptable warning: typedoc's pre-existing "unsupported TypeScript version" notice).
5. `graphify update .` after the implementation lands.
6. Grep invariant: `grep -rn 'hoverStyleRule\b' src/typescript/lib/` should return only the lazy getter and the setter bodies inside `Button.ts` (no subclass should touch it directly).

---

## Documentation Impact

- Public API surface gains seven setters/getters/clearers on `Button`, plus six new fields on `ButtonOptions`. They are exported through the existing per-subpath barrel [src/typescript/lib/component/button/index.ts](../src/typescript/lib/component/button/index.ts) — `Button` and `ButtonOptions` are already re-exported, so no barrel edit is required.
- The curated docs page [docs/components/Button.md](../docs/components/Button.md) (covered by the sidebar entry at [docs/.vitepress/config.mts:63](../docs/.vitepress/config.mts#L63)) should gain a short "Hover state" sub-section paralleling its existing "Pressed state" coverage, with one snippet showing `setHoverBackgroundColor` or `hoverBackgroundColor` in the options bag.
- The same page's catalogue line in [docs/components/index.md](../docs/components/index.md) does not need to change — only the per-component page expands.
- No cross-bucket JSDoc references are introduced; all `{@link}` targets in the new JSDoc point at symbols inside `component/button` (`Button`, `Border`) and are same-bucket. `BorderOptions` is also same-bucket (`primitive` is referenced via the `import { Border, BorderOptions }` already present at [Button.ts:14](../src/typescript/lib/component/button/Button.ts#L14)), but where the JSDoc text mentions `Border` from another bucket use the markdown form `[\`Border\`](/api/primitive/classes/Border)` per [CLAUDE.md](../CLAUDE.md).
- No renames or removals — `grep -rln '\bsetHoverBackgroundColor\b' docs/` should currently be empty; that's expected.

---

## Potential Challenges

- **Rule-insertion order between `:hover:not(:active)` and `:active`** — anchored at the selector level (the `:not(:active)` guard), not at the source-order level. Confirmed in the Architecture Decisions section.
- **AccordionHeader's custom background** — `AccordionHeader` sets its own gradient via `--ts-ui-accordion-header-bg`. The inherited `hoverBackgroundColor`/`hoverBackgroundImage` will overlay that on hover. If the result looks visually wrong, [AccordionHeader.ts](../src/typescript/lib/component/container/AccordionHeader.ts) can pass `hoverBackgroundColor`/`hoverBackgroundImage` in its own defaults bag to retune; this is an opt-in adjustment, not a blocker.
- **`TabCloseButton`'s 16×16 footprint** — its preferred size is tiny ([TabCloseButton.ts:22-25](../src/typescript/lib/component/button/TabCloseButton.ts#L22-L25)); a heavy hover shadow could clip against the tab toolbar. The chosen default shadow (`1px 3px 6px`) sits inside the existing 1px-2px-5px pressed shadow envelope so the visual envelope does not grow.
- **CSS-variable fallback duplication** — the default-seed strings duplicate the dark-theme fallback colour inside `var(--ts-ui-button-hover-bg, …)`. This is the same pattern already used by pressed/button defaults; consistency wins over DRY.

---

## Critical Files

- [src/typescript/lib/component/button/Button.ts](../src/typescript/lib/component/button/Button.ts) — the only source file that materially changes; the `pressedX` family at lines 287-478 is the literal template for the new code.
- [src/typescript/lib/core/Theme.ts](../src/typescript/lib/core/Theme.ts) — `Theme.button` sub-tree (lines 45-58), `DefaultTheme.button` / `DarkTheme.button` (lines 260-271, 409-420), `themeToVars` (lines 559-566).
- [src/typescript/lib/core/StyleTarget.ts](../src/typescript/lib/core/StyleTarget.ts) — read to confirm `StyleRule.set` semantics and the lazy-rule-deferred-write contract.
- [src/typescript/lib/component/button/ToggleButton.ts](../src/typescript/lib/component/button/ToggleButton.ts), [src/typescript/lib/component/button/TabCloseButton.ts](../src/typescript/lib/component/button/TabCloseButton.ts), [src/typescript/lib/component/input/SpinButton.ts](../src/typescript/lib/component/input/SpinButton.ts), [src/typescript/lib/component/container/AccordionHeader.ts](../src/typescript/lib/component/container/AccordionHeader.ts) — read to confirm no subclass currently writes a `:hover` rule that would collide.

---

## Non-Goals

- **Hover transitions** — no `transition: background-color 150ms` etc. The pressed state is instant; matching the snap keeps the feel consistent. A separate plan can add motion if desired.
- **Focus-visible chrome** — keyboard focus styling is out of scope; the existing focus ring (browser default) keeps working.
- **Per-subclass hover defaults** — subclass-specific tuning (e.g. `TabCloseButton` wanting a redder hover) is left to follow-up. The infrastructure supports it via the standard options-bag override; no work needed now.
- **`MenuBarButton`** — that component lives in [Menu.ts](../src/typescript/lib/core/Menu.ts) and does not extend `Button`. It already has its own `--ts-ui-menu-bar-btn-hover-bg` token and is therefore explicitly out of scope here.
