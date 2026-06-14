# Window Chrome Alignment (Header ↔ TabWindow) — Implementation Plan

## Overview

Make an ordinary header [`Window`](../src/typescript/lib/core/Window.ts) and a headerless [`TabWindow`](../src/typescript/lib/core/TabWindow.ts) read as one window family by aligning the [`WindowHeader`](../src/typescript/lib/component/container/WindowHeader.ts) chrome to the TabWindow's bar. Three coordinated changes: (1) give the header its own `--ts-ui-window-header-bg` theme token, valued equal to `tab.toolbar.background` so today's look is unchanged; (2) restyle and resize the header's min/max/close controls to use the themed `window.control` fill and the TabWindow controls' box, including the flatten-to-transparent-on-blur behaviour; (3) bring the leading title glyph to the same corner inset and box as the TabWindow's leading widget.

The TabWindow controls are built in [`TabWindow.ts:91-99`](../src/typescript/lib/core/TabWindow.ts#L91) with a local `controlButtonStyleRules` array painting from `--ts-ui-window-control-*` plus a transparent-on-blur flatten in [`setControlsActive`](../src/typescript/lib/core/TabWindow.ts#L262). The header controls in [`WindowHeader.ts:88-102`](../src/typescript/lib/component/container/WindowHeader.ts#L88) use a different translucent-overlay look (`--ts-ui-titlebar-btn-*`, which has **no** `Theme.ts` backing — they are bare fallback literals) and never flatten on blur. The header background and leading glyph are seeded in the [`WindowHeader` constructor](../src/typescript/lib/component/container/WindowHeader.ts#L56) (`_activeBackground` at line 63; `_titleRow`/`setGlyph` at lines 72-76 / 161-174).

Because both window kinds build three near-identical control buttons plus a decorative leading glyph from the same `window.control` tokens, this plan **extracts a shared construction helper** (see Architecture Decisions) so the two kinds cannot visually drift again.

---

## Architecture Decisions

### Extract a shared control-button helper — `core/windowControls.ts`

The duplication is non-trivial: three control buttons (each `new Button({ glyph, chromeless: true, styleRules: controlButtonStyleRules, insets })`), the `controlButtonStyleRules` array itself, the decorative leading-glyph variant (`leadGlyphStyleRules` + `pointerEvents:none`), and the transparent-on-blur flatten loop all appear in TabWindow today and must appear identically in WindowHeader after this change. That is exactly the case CODE_CONVENTIONS allows an extraction for — "separating reusable mechanics from call-site-specific writes" — not speculative configurability. Keeping them separate would re-duplicate ~30 lines of fiddly style-rule literals across two files and reintroduce the drift this plan exists to remove.

Create `src/typescript/lib/core/windowControls.ts` exporting:

- `WINDOW_CONTROL_STYLE_RULES: ComponentStyleRuleSpec[]` — the promoted `controlButtonStyleRules` (base `window.control` fill/border/shadow + hover + active). Replaces TabWindow's local const.
- `WINDOW_LEAD_GLYPH_STYLE_RULES: ComponentStyleRuleSpec[]` — the promoted `leadGlyphStyleRules` (transparent bg, `1px solid transparent` border, no shadow).
- `createWindowControlButton(glyph: string): Button` — `new Button({ glyph, chromeless: true, styleRules: WINDOW_CONTROL_STYLE_RULES, insets: new Insets(2,2,2,2) })`.
- `createWindowLeadGlyphButton(glyph: string): Button` — same with the lead-glyph rules and `setPointerEvents("none")` applied.
- `setWindowControlsActive(buttons: Button[], active: boolean): void` — the flatten loop: `button.setBackground(active ? "var(--ts-ui-window-control-bg)" : "transparent")` for each.

This lives under `core/` (not `component/button/`) because it is window-chrome glue specific to the two window kinds, not a general Button capability; it depends on `Button`, `Insets`, and `ComponentStyleRuleSpec` only. `TabWindow` and `WindowHeader` both import from it. `Insets(2,2,2,2)` stays the constructed default in the factory — see the size decision below for why the two kinds still end up the same effective box.

### Control box size: the header is not stretched, so it needs symmetric `Insets(4,4,4,4)` to reproduce the TabWindow's stretched 24×24 box

The TabWindow controls reach their rendered **24×24** box two ways at once: `TabBar.applyTabButtonStyles` ([`TabBar.ts:2192-2204`](../src/typescript/lib/component/container/TabBar.ts#L2192)) re-sets every tool's insets to `computeToolButtonInsets()` = `Insets(0,4,0,4)` (cross-axis zeroed, main-axis `pad*2`, `pad = TAB_BUTTON_INSET_COMPACT = 2`), **and** the stretching tool group stretches each control to the strip thickness — so the `0` cross-axis inset is fine because the *stretch* supplies the height (width = `glyph(14) + 4 + 4 + border` = 24; height from the stretch = 24).

The header controls live in a **plain, non-stretching** HBox, so there is no stretch to supply the height — applying the literal `Insets(0,4,0,4)` there yields a 24×**16** wide-flat box (confirmed by runtime measurement). The header reproduces the TabWindow's square 24×24 box with symmetric **`Insets(4,4,4,4)`** instead: `glyph(14) + 4 + 4 + border` = 24 on *both* axes, glyph centred. The 24px box overflows the header's ~16px text content area into its padding but stays centred in the ~26px header (≈1px margin, mirroring the TabWindow's 24-in-28 strip) without forcing the header taller. The factory keeps `(2,2,2,2)` as a standalone default; WindowHeader overrides its controls and leading glyph to `(4,4,4,4)`. This is the single most important correctness point — settled by measurement, not by eye.

### Header background token — dedicated, valued equal to tab toolbar

Add `--ts-ui-window-header-bg` driven by a new `window.header.background` theme field, valued `'#eee'` in Modern/Classic and `'#2a2a2a'` in Dark — byte-for-byte equal to each theme's `tab.toolbar.background` today. `WindowHeader` swaps its hardcoded `var(--ts-ui-tab-toolbar-bg, #eee)` (constructor line 63) for `var(--ts-ui-window-header-bg, #eee)`. The blurred fill stays `var(--ts-ui-gutter-bg, …)` (already shared, unchanged). This gives independent themeability with zero visual change today.

### No `--ts-ui-window-header-border` — out of scope

The header currently paints no border of its own (the surface is a flat fill; the window's edge/shadow come from the window frame). Adding a border token would be a speculative new surface with no current consumer and no parity requirement against the TabWindow bar (which also has no header border). Out of scope per CODE_CONVENTIONS "no flexibility that wasn't requested." Noted as a Non-Goal.

### Reuse `--ts-ui-window-control-*` for the header controls; retire the `titlebar-btn` literals

The header controls switch to the exact `window.control` token set the TabWindow uses. The old `--ts-ui-titlebar-btn-hover-bg` / `-active-bg` strings were never defined in `Theme.ts` (only inline fallback literals in WindowHeader), so removing them deletes dead pseudo-tokens — not a real theme surface. No `themeToVars` change for the old names (there is none).

### Header focus toggle drives both the background and the control flatten

`WindowHeader.setActive` ([line 204](../src/typescript/lib/component/container/WindowHeader.ts#L204)) is the header's focus hook (called by `Window.paintActive` → [`Window.ts:200-201`](../src/typescript/lib/core/Window.ts#L200)). Today it only swaps the background. It must also call `setWindowControlsActive([_minimizeButton, _maximizeButton, _exitButton], active)` so the header controls flatten to transparent on blur exactly like `TabWindow.setControlsActive`. This mirrors TabWindow's `paintActive` doing both the bar fill and the control flatten in one hook.

---

## Public API (TypeScript Signatures)

New module `src/typescript/lib/core/windowControls.ts` (internal helper; not a new exported component class):

```ts
import { Button } from "~/component/button/Button.js";
import { ComponentStyleRuleSpec } from "~/core/Component.js";

export const WINDOW_CONTROL_STYLE_RULES: ComponentStyleRuleSpec[];
export const WINDOW_LEAD_GLYPH_STYLE_RULES: ComponentStyleRuleSpec[];

export function createWindowControlButton(glyph: string): Button;
export function createWindowLeadGlyphButton(glyph: string): Button;
export function setWindowControlsActive(buttons: Button[], active: boolean): void;
```

No new DOM property/setter on any component. No change to `WindowHeaderOptions` / `WindowOptions` surface. `Theme` interface gains one field: `window.header.background: string` (see Theme Tokens).

---

## Theme Tokens

| CSS Custom Property | Modern (light) | Classic (light) | Dark | Purpose |
|---|---|---|---|---|
| `--ts-ui-window-header-bg` | `#eee` | `#eee` | `#2a2a2a` | Focused fill of the ordinary `Window`'s `WindowHeader`, independently themeable from the tab strip. Valued equal to `tab.toolbar.background` so today's look is unchanged. |

Theme wiring:

- **`Theme.ts`** — add `background: string;` to the `window` block's interface (alongside `shadow`/`snapGlow`/`minDockWidth`/`control`), nested under a new `header: { background: string }` sub-object inside `window` (i.e. `window.header.background`, distinct from the top-level `header` block which holds `font`/`padding`). Add `'--ts-ui-window-header-bg': theme.window.header.background` to `themeToVars` next to the `--ts-ui-window-control-*` lines (~[Theme.ts:768-772](../src/typescript/lib/core/Theme.ts#L768)).
- **`ModernTheme.ts`** — add `header: { background: '#eee' }` inside the `window:` block ([~line 119](../src/typescript/lib/core/themes/ModernTheme.ts#L119)).
- **`ClassicTheme.ts`** — add `header: { background: '#eee' }` inside its `window:` block (~line 106).
- **`DarkTheme.ts`** — add `header: { background: '#2a2a2a' }` inside its `window:` block (~line 105).
- **`BaseTheme.ts`** — no entry needed (the value is a palette token, scheme-specific, so it lives in each concrete theme like `window.control.*` does; BaseTheme holds only structural invariants). Confirm `window.header.background` is a required string in `Theme` so every concrete theme must supply it — TS will flag any theme missing it.

No reuse of `tab.toolbar` value-by-reference: each theme repeats the literal so the two surfaces are independently themeable, which is the entire point of the dedicated token.

---

## Ordered Implementation Steps

1. **Add the `windowControls.ts` helper.** Create `src/typescript/lib/core/windowControls.ts` with the five exports from Public API. Move `controlButtonStyleRules` and `leadGlyphStyleRules` verbatim from `TabWindow`'s constructor into `WINDOW_CONTROL_STYLE_RULES` / `WINDOW_LEAD_GLYPH_STYLE_RULES`. → verify: `tsc -p tsconfig.lib.json --noEmit` clean.

2. **Refactor `TabWindow` onto the helper.** Replace the local const + three `new Button(...)` control constructions ([TabWindow.ts:91-99](../src/typescript/lib/core/TabWindow.ts#L91)) with `createWindowControlButton(...)`; replace the leading-glyph const + `new Button(...)` + `setPointerEvents` ([lines 124-129](../src/typescript/lib/core/TabWindow.ts#L124)) with `createWindowLeadGlyphButton(this._options.glyph ?? "window-maximize")`; replace the `setControlsActive` body ([lines 262-268](../src/typescript/lib/core/TabWindow.ts#L262)) with a call to `setWindowControlsActive([this._minTool, this._maxTool, this._closeTool], active)` (keep the private method as a thin wrapper, or inline the call at the `paintActive` site — prefer keeping `setControlsActive` as a one-line delegator to minimise the diff). Remove the now-unused `Insets`/`ComponentStyleRuleSpec` imports only if they become orphaned. → verify: typecheck clean; TabWindow visual unchanged (it uses the same tokens and the bar still overrides insets to `(0,4,0,4)`).

3. **Add the theme token.** Edit `Theme.ts` (interface `window.header.background` + `themeToVars` line), then `ModernTheme.ts`, `ClassicTheme.ts`, `DarkTheme.ts` per Theme Tokens. → verify: `tsc -p tsconfig.lib.json --noEmit` clean (the required field forces all three themes to compile).

4. **Restyle the header background.** In `WindowHeader` constructor ([line 63](../src/typescript/lib/component/container/WindowHeader.ts#L63)) change `_activeBackground` to `"var(--ts-ui-window-header-bg, #eee)"`. `setActive`'s active branch already reads `_activeBackground`; blurred branch unchanged. → verify: header fill identical in all three themes (token value == old literal).

5. **Restyle + resize the header controls.** In `WindowHeader` constructor, replace the three `new Button({... trailingButtonStyleRules ...})` ([lines 93-95](../src/typescript/lib/component/container/WindowHeader.ts#L93)) with `createWindowControlButton("window-minimize")` etc., then set each control's insets to `new Insets(4, 4, 4, 4)` to reproduce the TabWindow's square 24×24 box in the non-stretching header row (see Architecture Decisions / size). Delete the now-dead `trailingButtonStyleRules` const ([lines 88-91](../src/typescript/lib/component/container/WindowHeader.ts#L88)). → verify: in Modern the three controls are white (`window.control.background`), in Classic they are raised (gradient/border/shadow), and they match the TabWindow controls' 24×24 size.

6. **Flatten header controls on blur.** In `WindowHeader.setActive` ([line 204](../src/typescript/lib/component/container/WindowHeader.ts#L204)) add, after the `setBackgroundColor` call, `setWindowControlsActive([this._minimizeButton, this._maximizeButton, this._exitButton], active)`. → verify: blurring a header Window flattens its controls to transparent exactly like a blurred TabWindow; refocusing restores the `window.control` fill.

7. **Align the leading title glyph.** In `WindowHeader.setGlyph` ([line 161](../src/typescript/lib/component/container/WindowHeader.ts#L161)), build the leading glyph via `createWindowLeadGlyphButton(name)` instead of a bare `new Glyph(name)`, and set its insets to `new Insets(4, 4, 4, 4)` (the same square box as the controls) so it lands the same box/offset as the TabWindow's leading widget; keep `setPointerEvents("none")` (the factory already applies it). This changes `_titleGlyph`'s type from `Glyph` to `Button` — update the field declaration ([line 50](../src/typescript/lib/component/container/WindowHeader.ts#L50)), `getGlyph()`'s return type ([line 195](../src/typescript/lib/component/container/WindowHeader.ts#L195)), `clearGlyph`, and `getMinContentWidth`'s `_titleGlyph?.getPreferredSize()` (a `Button` has the same accessor, so the call is unchanged). → verify: the title glyph sits at the same corner inset as a TabWindow's leading glyph; `getGlyph()` return type compiles at all call sites (run `tsc`).

8. **Reconcile title-row edge-hug.** Confirm the leading glyph now reads inset from the corner. Measured at runtime: with the glyph in a `(4,4,4,4)` 24×24 box, its ink sits 10px from the left and 10px from the top — matching the TabWindow's leading glyph exactly (left/top gap 10), so no title-row inset compensation is needed. → verify: side-by-side measurement in the Window/TabWindow demo.

9. **Regression sweep.** `grep -rn 'titlebar-btn' src/` → expect zero matches (old pseudo-tokens fully retired). `grep -rn 'controlButtonStyleRules\|leadGlyphStyleRules' src/typescript/lib/core/TabWindow.ts` → expect zero (promoted to helper). → verify both greps; then full typecheck + docs build.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/core/windowControls.ts` |
| Modify | `src/typescript/lib/component/container/WindowHeader.ts` |
| Modify | `src/typescript/lib/core/TabWindow.ts` |
| Modify | `src/typescript/lib/core/Theme.ts` |
| Modify | `src/typescript/lib/core/themes/ModernTheme.ts` |
| Modify | `src/typescript/lib/core/themes/ClassicTheme.ts` |
| Modify | `src/typescript/lib/core/themes/DarkTheme.ts` |

`Window.ts` needs **no** change — it already routes focus through `WindowHeader.setActive` and glyph through `WindowHeader.setGlyph`; both hooks are modified in place. `BaseTheme.ts` needs no change (the new token is scheme-specific).

---

## Verification

- **Typecheck:** `tsc -p tsconfig.lib.json --noEmit` — clean. The new required `Theme.window.header.background` field forces all three concrete themes to compile.
- **Grep invariants:** `grep -rn 'titlebar-btn' src/` → 0; `grep -rn 'controlButtonStyleRules' src/typescript/lib/core/TabWindow.ts` → 0; `grep -rn 'window-header-bg' src/` → present in `Theme.ts` + `WindowHeader.ts`.
- **Docs build:** `npm run docs:build` — 0 errors, 0 new link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable one).
- **Manual smoke (the Window/TabWindow demo screen):** open a header `Window` and a `TabWindow` side by side in each theme. Confirm, scoped to the right component class to avoid measuring a hidden instance:
  - **Modern:** header controls are white (`window.control` fill), same height as the TabWindow controls; leading glyph at the same corner inset.
  - **Classic:** header controls raised (gradient + border + shadow), matching TabWindow.
  - **Dark:** header controls dark-opaque, matching TabWindow; header fill `#2a2a2a`.
  - **Blur:** click away → header controls flatten to transparent (header fill → gutter), identical to a blurred TabWindow; refocus restores.
  - **Behaviour preserved:** drag-move via title, double-click-to-maximize (and not when double-clicking a control), minimize/maximize/close actions fire, and `closeable`/`minimizable`/`maximizable` still toggle the right controls (close greys out; min/max hide).
- **Theme toggle at runtime:** switch themes live with a header Window open — the CSS-var-driven fills update without a rebuild.

---

## Documentation Impact

Internal restyle/refactor — no public component class added or renamed; `windowControls.ts` is internal glue (not exported through any per-subpath barrel). `getGlyph()`'s return type changes from `Glyph | null` to `Button | null` — a consumer-visible JSDoc/type change on `WindowHeader`. Update the `getGlyph` JSDoc in `WindowHeader.ts` (it links `Glyph`; relink to `Button`) and check whether any curated page under `docs/component/container/` documents `WindowHeader.getGlyph`'s return type (`grep -rln 'getGlyph' docs/`); update that page and the constructor's title-icon prose if it names `Glyph`. The new theme token should be listed wherever the theming docs enumerate `--ts-ui-window-control-*` (`grep -rln 'window-control-bg' docs/`) — add `--ts-ui-window-header-bg` to that table. No sidebar/catalog change (no new page).

---

## Potential Challenges

- **Size mismatch from the bar's inset override.** TabWindow's rendered control box is `Insets(0,4,0,4)` (set by `TabBar`, compact), not the factory's `(2,2,2,2)`; the header must explicitly apply `(0,4,0,4)` or its controls render a different size. Mitigation: step 5/7 set the header insets explicitly; verify with a measured screenshot, not by eye.
- **`_titleGlyph` type change ripples.** Switching the leading glyph from `Glyph` to `Button` touches the field, `getGlyph`, `clearGlyph`, and `getMinContentWidth`. Mitigation: `tsc` enumerates every call site; `Button` exposes the same `getPreferredSize`/`setPointerEvents`, so the only real edits are the type annotations.
- **`applyStyle` replay trap.** The TabWindow leading glyph bakes its style into `styleRules` precisely because a post-construct `setBackground` is replayed away by the pre-init `applyStyle` cascade (per the existing TabWindow comment and project memory). The shared factory must keep the styling in the style rules, not in a post-construct setter. Mitigation: factory builds via `styleRules`; `setWindowControlsActive` runs only at focus time (post-init), where `setBackground` is safe.
- **Leading-offset double-counting.** Header padding plus the glyph's own tool inset could over-inset the glyph relative to the TabWindow. Mitigation: step 8 measures and, if needed, trims the title-row leading inset (never `header.padding`).
- **Classic gradient on blur.** The `background` shorthand (not `backgroundColor`) must be used for the flatten so the Classic gradient layer clears to transparent on blur. Mitigation: `setWindowControlsActive` uses `setBackground` (shorthand), mirroring TabWindow.

---

## Critical Files

- [`src/typescript/lib/component/container/WindowHeader.ts`](../src/typescript/lib/component/container/WindowHeader.ts) — controls, `_titleRow`/`setGlyph`, `setActive`, Border WEST/EAST placement, `_activeBackground`.
- [`src/typescript/lib/core/TabWindow.ts`](../src/typescript/lib/core/TabWindow.ts) — `controlButtonStyleRules`, `leadGlyphStyleRules`, `setControlsActive`, `paintActive`, leading-glyph construction (the template the header copies).
- [`src/typescript/lib/component/container/TabBar.ts`](../src/typescript/lib/component/container/TabBar.ts) — `applyTabButtonStyles` / `computeToolButtonInsets` (lines 1743, 2192-2204): why the rendered tool box is `(0,4,0,4)`.
- [`src/typescript/lib/core/Theme.ts`](../src/typescript/lib/core/Theme.ts) — `window` block (~255-272), `header` block (~274), `themeToVars` (~768-773).
- [`src/typescript/lib/core/themes/BaseTheme.ts`](../src/typescript/lib/core/themes/BaseTheme.ts) — `window`/`header` structural defaults (44-50); confirms why the new palette token is scheme-specific.
- `ModernTheme.ts` / `ClassicTheme.ts` / `DarkTheme.ts` — `window` and `tab.toolbar` blocks (the values the new token must equal).
- [`src/typescript/lib/core/Window.ts`](../src/typescript/lib/core/Window.ts) — header ownership and `paintActive` → `setActive` wiring (lines 76-91, 200-201); confirms no Window edit is needed.
- [`src/typescript/lib/component/button/Button.ts`](../src/typescript/lib/component/button/Button.ts) — `setBackground` (1483), `chromeless` option, `styleRules`.

---

## Non-Goals

- **No `--ts-ui-window-header-border` token.** The header paints no border today and the TabWindow bar has none either; adding one is a speculative surface with no consumer. (Architecture Decisions.)
- **No change to TabWindow's appearance.** The TabWindow refactor onto the shared helper is byte-for-byte behaviour-preserving — same tokens, same bar-driven insets.
- **No reuse of the token *value* by reference** between header and tab toolbar; each theme repeats the literal so the two surfaces stay independently themeable.
- **No new `WindowHeaderOptions` / `WindowOptions` fields** and no general Button API additions — `windowControls.ts` is window-chrome glue, not a Button feature.
- **No retheme of the other `window.control` consumers** beyond what the shared helper naturally unifies.
