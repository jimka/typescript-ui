# Accordion Extensions — Implementation Plan

> **Implementation divergences (added at completion).** The sections below record
> the design *as planned*; the shipped code differs in these respects, decided
> during implementation and review:
>
> 1. **No `flat` option.** Border-collapse is folded into the themed look instead
>    of a separate toggle: a themed header draws a single **bottom** divider
>    (`--ts-ui-accordion-header-border`), so stacked headers never double their
>    borders. The `.AccordionHeader-flat-collapsed` class and the `flat`
>    option/setter were not built.
> 2. **`themed` defaults to `true`** (the plan said `false`). A bare accordion is
>    themed out of the box; opt out with `themed: false`.
> 3. **New `--ts-ui-accordion-border` token** draws an all-around border on the
>    container when themed. The planned `--ts-ui-accordion-panel-border` is **not**
>    consumed (the per-wrapper border was dropped for the header bottom-divider +
>    container-border model); that token is now dead in the theme files.
> 4. **Header row uses a weight-1 title button**, not `Spacer.flex()`, to push the
>    tools/chevron to the trailing edge while the label stays left.
> 5. **Hover reveal is `setDisplayed`-driven**, not a CSS `:hover` class — the
>    manager toggles the tool group via `mouseover`/`mouseout` subtree listeners
>    (which also re-parent the single global tool onto the hovered header).
> 6. **`AccordionPanel` gained no `expandAll`/`collapseAll` forwarders and no
>    appearance pass-through options.** `AccordionPanelOptions` carries only
>    `sections`/`singleOpen`/`onSectionToggle`; everything else is reached through
>    `getAccordion()`.
> 7. **App-wide `Button` fixes were required** and shipped on this branch: flat
>    buttons now clear (not merely mask) their resting background-image, shadow,
>    and border-radius and their hover shadow; chromeful buttons render
>    flat-colour `--ts-ui-button-bg` tokens (not only gradients). These make the
>    chromeless title button and the flat header tools render correctly.
> 8. **`HBox`/`VBox` preferred-size hardening:** `getPreferredSize` now reserves
>    `max(preferred, min)` per child, so a child whose `minSize` exceeds its
>    `preferredSize` no longer under-reports the row/column.

## Overview

This plan extends the `Accordion` layout manager and its supporting components with nine interrelated features. The **central architectural change** (v2, superseding v1) is that the header stops being a `Button` and becomes a plain styled [`Component`](../src/typescript/lib/core/Component.ts) that hosts its own [`HBox`](../src/typescript/lib/layout/HBox.ts) row. The header background and border are painted on the header Component itself (via the previously-dead accordion theme tokens), and the clickable toggle target becomes a `flat`/`chromeless` title `Button` that *sits inside* the header row — with the tools as **siblings** of that button rather than descendants of it.

This restructure dissolves the v1 collision problem at the root. In v1 the whole header was a `Button` and tools placed on it inherited the button's click→toggle behaviour, forcing an exact-target-id `addListener` argument and a fallback `consumeClick` marker. With tools now siblings of the title button (not descendants), **a tool click is simply not a click on the title button**, so there is nothing to `stopPropagation` and no marker to maintain. The header DOM, left-to-right, becomes:

```
[chevron (when chevronSide=left)] [ flat title Button: leading glyph + label ] [ flex Spacer ] [ tools container ] [chevron (when chevronSide=right)]
```

The files touched are the same small cluster as v1: the manager [`Accordion.ts`](../src/typescript/lib/layout/Accordion.ts), the header [`AccordionHeader.ts`](../src/typescript/lib/component/container/AccordionHeader.ts), the chevron [`AccordionIndicator.ts`](../src/typescript/lib/component/container/AccordionIndicator.ts), the constraints [`AccordionConstraints.ts`](../src/typescript/lib/layout/AccordionConstraints.ts), the convenience wrapper [`AccordionPanel.ts`](../src/typescript/lib/component/container/AccordionPanel.ts), plus the demo [`AccordionDemoPanel.ts`](../src/typescript/AccordionDemoPanel.ts) and curated docs.

**Verified against the source at write time:**
- The header is today a single `Button` ([`AccordionHeader.ts:30`](../src/typescript/lib/component/container/AccordionHeader.ts#L30) `extends Button<AccordionHeaderOptions>`); the indicator is side-loaded onto the button element in `init` ([:83-95](../src/typescript/lib/component/container/AccordionHeader.ts#L83)), and a fixed `+8` left inset is added in the constructor ([:50-52](../src/typescript/lib/component/container/AccordionHeader.ts#L50)). The whole header is clickable: the manager wires `Event.addListener(header, 'click', …)` and `Event.addListener(header, 'keydown', …)` ([`Accordion.ts:520-521`](../src/typescript/lib/layout/Accordion.ts#L520)). Keyboard focus moves between headers via `this._headers[target].focus()` ([`Accordion.ts:770`](../src/typescript/lib/layout/Accordion.ts#L770)) — Button supplies native `<button>` focusability and semantics today.
- **Confirmed dead-token grep.** `grep -rn "ts-ui-accordion" src/typescript/ | grep -v core/Theme.ts | grep -v core/themes/` returns exactly **one** hit — `--ts-ui-accordion-indicator-color` in [`AccordionIndicator.ts:44`](../src/typescript/lib/component/container/AccordionIndicator.ts#L44). The tokens `--ts-ui-accordion-header-bg`, `--ts-ui-accordion-header-border`, `--ts-ui-accordion-header-color`, and `--ts-ui-accordion-panel-border` are *defined* in `Theme.ts` ([:509-521](../src/typescript/lib/core/Theme.ts#L509)), mapped in `themeToVars` ([:947-951](../src/typescript/lib/core/Theme.ts#L947)), and given values in all three theme files ([`ModernTheme.ts:98`](../src/typescript/lib/core/themes/ModernTheme.ts#L98), [`ClassicTheme.ts:98`](../src/typescript/lib/core/themes/ClassicTheme.ts#L98), [`DarkTheme.ts:96`](../src/typescript/lib/core/themes/DarkTheme.ts#L96)) but are **never consumed**.
- The confirmed cause of the visible ~1px inter-section gap is `Button`'s default chrome: `border: "2px ridge var(--ts-ui-button-border, …)"` and `borderRadius: "var(--ts-ui-border-radius, 4px)"` ([`Button.ts:187-188`](../src/typescript/lib/component/button/Button.ts#L187)). Button's `flat` ([:106-112](../src/typescript/lib/component/button/Button.ts#L106)) and `chromeless` ([:88-104](../src/typescript/lib/component/button/Button.ts#L88)) options both suppress that chrome (`chromeless` removes border/shadow/gradient/radius entirely; `flat` keeps a `:hover` frame only).
- `Button` glyph support is complete: `glyph?: string` option ([:73](../src/typescript/lib/component/button/Button.ts#L73)), `setGlyph(name)` ([:1106](../src/typescript/lib/component/button/Button.ts#L1106)) — "the glyph leads the content row" — `getGlyph()` ([:1147](../src/typescript/lib/component/button/Button.ts#L1147)), `pinGlyphSize(px)` ([:1165](../src/typescript/lib/component/button/Button.ts#L1165)). Button also has `compact` ([:114-122](../src/typescript/lib/component/button/Button.ts#L114)), `anchor` ([:124-129](../src/typescript/lib/component/button/Button.ts#L124)), and `fill` ([:131-136](../src/typescript/lib/component/button/Button.ts#L131)) options.
- The Tab/TabBar tool pattern is the reference: `Tab.addTool`/`removeTool` ([`Tab.ts:761,776`](../src/typescript/lib/layout/Tab.ts#L761)) forward to `TabBar.addTool`/`removeTool` ([`TabBar.ts:1125,1141`](../src/typescript/lib/component/container/TabBar.ts#L1125)), which push into `_tools: Component[]` ([:503](../src/typescript/lib/component/container/TabBar.ts#L503)) and an `HBox`-laid-out `_toolGroup: Panel` ([:506,587](../src/typescript/lib/component/container/TabBar.ts#L506)), then `scheduleLayout`.
- `Component` itself carries `setLayoutManager`/`addComponent`/`getAria` ([`Component.ts:428,4057,1380`](../src/typescript/lib/core/Component.ts#L4057)), so a plain styled Component can host an HBox and children — it need not be a `Container`. `setBorder`/`setBackgroundColor`/`setForegroundColor`/`setInsets` are all `Component` setters ([:1793,1563,1700,1442](../src/typescript/lib/core/Component.ts#L1793)). `AriaRole` includes both `'button'` and `'region'` ([`Aria.ts:12`](../src/typescript/lib/core/Aria.ts#L12)).
- [`Spacer.flex()`](../src/typescript/lib/component/container/Spacer.ts#L106) returns a weight-1 flex spacer that absorbs the HBox row's leftover space.
- The demo screen is `AccordionDemoPanel` ([`src/typescript/AccordionDemoPanel.ts`](../src/typescript/AccordionDemoPanel.ts)), a lazy tab labelled "Accordion". Its "Open All"/"Close All" buttons loop `openSection`/`closeSection` 0..3 ([:66-76](../src/typescript/AccordionDemoPanel.ts#L66)) — feature 8 replaces those loops.

---

## Architecture Decisions

### Reviewer acceptance — two items to re-evaluate post-build

The reviewer has **accepted proceeding with this approach** and will judge the visual result after implementation. Two choices are explicitly flagged for post-build re-evaluation:

1. **Title-Button appearance — `chromeless` vs `flat`.** This plan picks **`chromeless`** for the title button: the header Component already paints background + border via the accordion tokens, so the title button must contribute *zero* chrome — no border, no radius, no shadow, no gradient — or it double-paints inside the header box. `flat` keeps a `:hover:not(:active)` frame and an `:active` sunken inset, which would draw a second framed rectangle around the label on hover, fighting the header's own background. The light hover affordance `flat` offers should instead live on the **whole header** (a `--ts-ui-accordion-header-bg` hover variant on the header Component, if desired post-build), not on the title button alone. **Re-evaluate after the visual review**: if the header-level hover proves insufficient and a per-title hover reads better, switch the title button to `flat`.

2. **Global-tool hover/active asymmetry.** A globally-registered tool is a *single* `Component` instance and a Component is a single DOM node — it cannot appear in all N headers at once (see "Tools" below). The resolution re-parents the one global-tool instance into the currently hovered/active header, so global tools inherently follow hover/active visibility and can never be "always visible in every header." Per-section tools are independent instances and can be always-visible. **Re-evaluate after the visual review**: confirm the hover-follows-cursor behaviour reads naturally; if always-visible global tools turn out to be needed, the only correct implementation is per-section tool *clones*, which is out of scope here.

### Header is a styled Component hosting an HBox — not a Button (central change)

`AccordionHeader` stops extending `Button`. It becomes `AccordionHeader extends Component<AccordionHeaderOptions>` that owns one DOM element and lays its children out with an `HBox` (the documented "add a constraint/option to an existing manager, or override `doLayout`" path from ARCHITECTURE.md *Positioning is always absolute* — here we use the existing `HBox` manager, no new primitive). The header's children, in HBox order, are:

1. `_indicator: AccordionIndicator` — **only when `chevronSide === "left"`**, inserted as the first HBox cell (no longer a `position:absolute` overlay; see Chevron decision).
2. `_title: Button` — a `chromeless` Button carrying the leading glyph + the section label, left-anchored (`anchor: AnchorType.WEST`). This is the clickable toggle target.
3. `Spacer.flex()` — pushes the tools and the right chevron to the trailing edge while the title stays left.
4. `_toolGroup: Component` — the tools container, an HBox row holding `_tools: Component[]`.
5. `_indicator` — **only when `chevronSide === "right"`** (the default), inserted as the last HBox cell.

The header element itself carries the background/border (painted from the accordion tokens when `themed`), its own `role`/`labelledby` wrapper semantics, and the click/keydown listeners are routed so the **title button** is the toggle and focus target (see ARIA decision). The chevron animation timing (`setAnimationTiming`) stays a per-instance wiring call forwarded to the indicator, exactly as today ([`AccordionHeader.ts:128`](../src/typescript/lib/component/container/AccordionHeader.ts#L128)).

The header owns **one** element (the HBox host). The indicator, title button, spacer, and tool group are *child Components* in that HBox — each its own Component, satisfying ARCHITECTURE.md *One DOM element per class* (the v1 side-load exception is no longer needed because nothing is `position:absolute`-overlaid anymore).

### Title button is `chromeless` (the gap fix)

The visible ~1px gap was `Button`'s default `2px ridge` border + `4px` radius rounding the header's corners and insetting its edge. Two changes remove it:

1. The header is no longer a Button, so the header element has no button chrome.
2. The title button inside it is **`chromeless`** (`new Button(label, { chromeless: true, glyph, anchor: WEST })`), so it contributes no border/radius/shadow/gradient — only the label, glyph, cursor, and color. The header's own background/border (tokens, when `themed`) is the only chrome in the box.

`chromeless` is justified over `flat` per the reviewer-acceptance note above.

### Wire the dead accordion tokens + `spacing` option (feature 1)

The header's boxed look becomes controllable by consuming the four currently-dead tokens — `--ts-ui-accordion-header-bg`, `--ts-ui-accordion-header-border`, `--ts-ui-accordion-header-color` on the header Component and `--ts-ui-accordion-panel-border` on the panel wrapper. Gated behind a new boolean **`themed?: boolean`** (default `false`) so no existing screen changes silently: when `themed`, `createSection` applies the tokens via existing typed setters — `header.setBackgroundColor("var(--ts-ui-accordion-header-bg, …)")`, `header.setBorder("1px solid var(--ts-ui-accordion-header-border, …)")`, `header.setForegroundColor("var(--ts-ui-accordion-header-color, inherit)")`, and `wrapper.setBorder("1px solid var(--ts-ui-accordion-panel-border, …)")`. No raw DOM, no new token.

A new **`spacing?: number`** option inserts a vertical gap *between* sections in `doLayout` (after each section's content, before the next header). Default `0` preserves the current contiguous stack; setting it adds `y += spacing` between displayed sections, never leading/trailing — `(displayedCount − 1) * spacing`. The gap must also be added to `getPreferredSize`, `getMinSize`, and `computeShrinkRatio`'s budget math in lockstep, or the size report under-reports the stack height (an ARCHITECTURE.md size-report bug).

The dead-token grep is re-confirmed in the verification section after wiring.

### Chevron is its own HBox cell, `chevronSide` left/right (features 3 + 9)

The chevron stops being a `position:absolute; right:10px` overlay ([`AccordionIndicator.ts:33-47`](../src/typescript/lib/component/container/AccordionIndicator.ts#L33)) and becomes a normal in-flow HBox cell placed at the **left or right end** of the header row per **`chevronSide?: "left" | "right"`** (default `"right"`). The `.AccordionIndicator` class rule drops `position/right/top/transform: translateY(-50%)` and keeps only the typographic + colour + rotation-transition properties; the `.expanded` rotation rule becomes a plain `rotate(90deg)` (no `translateY` to preserve). The indicator's `render` keeps writing the chevron character.

The **label always stays left-aligned** regardless of chevron side, because the title button is anchored `WEST` and the flex `Spacer` separates it from the trailing cells — moving the chevron between the first and last HBox cell never disturbs the title's left edge.

**Custom chevron glyph (feature 9):** the hardcoded `"▶"` in `render` ([:117](../src/typescript/lib/component/container/AccordionIndicator.ts#L117)) becomes a cached `_char` field defaulting to `"▶"`, written in `render` and updatable via `setChar(c)`, exposed up the chain as **`chevronGlyph?: string`**. **Decision: a simple character override, NOT the framework `Glyph` system.** The indicator's whole job is to rotate one character 90° on expand; the `Glyph` component is a registry-backed icon with its own preferred-size/measurement lifecycle, and swapping it in would mean re-doing the rotation rule and HBox-cell sizing for no functional gain over a character. (Feature 5's *header* glyph deliberately uses Button's real `Glyph` — the two are different systems and the docs must say so.)

### Glyph leads the title text (feature 5)

**Decision: the section glyph LEADS THE TEXT inside the title button, reusing Button's existing `glyph` option/sizing.** It is *not* an independently-placeable HBox slot. Threaded `AccordionConstraints.glyph` → `AccordionHeader`'s `glyph` option → the title `Button`'s `glyph` option (already a `ButtonOptions` field), which `setGlyph` renders as a leading glyph auto-sized to the title line height. Trivial plumbing, no new glyph machinery.

### Tools — global API + per-section constraints, with the single-instance constraint (feature 4)

Two entry points:

**(a) Global tools** via `Accordion.addTool(button: Component)` / `removeTool(button: Component)`, mirroring `Tab.addTool`/`removeTool`'s API surface ([`Tab.ts:761,776`](../src/typescript/lib/layout/Tab.ts#L761)) — push into a manager-level `_tools: Component[]` and `scheduleLayout`.

**(b) Per-section tools** via a new **`tools?: Component[]`** field on `AccordionConstraints`, so a subset of headers carry their own tools. Read in `createSection` and added to that header's `_toolGroup`.

**Critical single-instance constraint (must be documented):** a `Component` instance is a single DOM node and **cannot appear in all N headers simultaneously**. So a *global* tool cannot be rendered into every header at once. **Resolution for global tools:** the single global-tool instance is **re-parented** (via `DOM.sink.appendChild`) into the currently **hovered (or active)** header's tool slot on `mouseover`/`mouseout` of the headers. Only one header is hovered at a time, so there is no contention. This means global tools **inherently follow hover/active visibility** — there is no always-visible global mode (see the reviewer-acceptance asymmetry note). Per-section tools are their own instances and *can* be always-visible.

A new **`toolsVisibility?: "always" | "hover"`** option (default `"hover"`) governs **per-section** tools: `"hover"` reveals them via a CSS `:hover` rule on the header (a shared `.AccordionHeader-tools-hover` class hiding the tool group until the header is hovered); `"always"` leaves them visible. Global tools follow hover/active by nature and ignore this option.

Re-parenting uses `DOM.sink.appendChild` (the seam). The memory caveat that re-parenting cancels in-flight CSS transitions does not bite here: tools carry no transition, so moving a global tool between headers is visually instantaneous and correct — noted but harmless.

**Right-end ordering (chevron-right + tools collision):** when `chevronSide === "right"`, the **chevron sits outermost** (the last HBox cell) and the **tool group sits inboard of it** (immediately before the chevron). Rationale: the chevron is the toggle affordance and belongs at the predictable far edge in both modes; keeping it outermost means its screen position is stable whether or not a header has tools. When `chevronSide === "left"`, the chevron is the first cell and the tool group occupies the trailing edge (after the flex spacer).

### Tool clicks never toggle — by structure, not by a marker

Because the tools are **siblings of the title button** inside the header HBox (not children of it), a click on a tool is a click on the tool's own element, never on the title button. The toggle listener lives on the **title button** (`title.on("action", …)` or `Event.addListener(title, "click", …)` routed by the header), so a tool click simply does not reach it. This is the clean replacement for v1's exact-target-id reliance and `consumeClick` fallback — there is nothing to `stopPropagation` and no marker to maintain.

### ARIA + keyboard on the title button (re-confirm under the new structure)

The header is no longer a `<button>`, so the semantics relocate:

- The **header element** (HBox host) keeps `role="region"` + `aria-labelledby` referencing the title's id — wait, the wrapper already carries `role="region"` today. Re-confirm: the **panel wrapper** keeps `role="region"` + `aria-labelledby` (header id) exactly as today ([`Accordion.ts:548-549`](../src/typescript/lib/layout/Accordion.ts#L548)).
- The **title `Button`** is the clickable toggle. A real `Button` already renders as `<button>` with native focusability and button semantics, so it needs no explicit `role="button"`. It carries `aria-expanded` (set on each toggle, replacing today's `header.getAria().setExpanded(…)`) and `aria-controls` (the wrapper id, replacing today's `header.getAria().setControls(…)`).
- **Keyboard navigation** (`ArrowUp`/`ArrowDown`/`Home`/`End` in `Accordion.onHeaderKeyDown`) and `focus()` move to the **title button**, since it is the focusable element. The manager's `keydown` listener and `focus()` call ([`Accordion.ts:521,770`](../src/typescript/lib/layout/Accordion.ts#L521)) re-point from `header` to the header's title button. `AccordionHeader` exposes a `getTitleButton()` accessor (or `focus()` override delegating to the title) so the manager keeps addressing headers by index but reaches the focusable element. **Decision:** add `getTitleButton(): Button` on `AccordionHeader` and have the manager wire `title`'s click/keydown and call `title.focus()`; this keeps the focus/handler ownership explicit and avoids the header element needing `tabindex`.

The per-instance animation timing wiring (`setAnimationTiming`) is preserved — forwarded to the indicator unchanged.

### Compact density toggle under the new structure (feature 6)

New boolean **`compact?: boolean`** (default `false`). Under the HBox header it adjusts the **header height + insets + chevron/glyph sizing**, not Button insets:
- A documented `COMPACT_HEADER_HEIGHT` constant (e.g. `22`, vs the `28` default at [`Accordion.ts:107`](../src/typescript/lib/layout/Accordion.ts#L107)) becomes the effective header height *only when the consumer has not explicitly set `headerHeight`* — tracked by a `_headerHeightExplicit` guard set inside the public `setHeaderHeight`, so compact never silently overrides an explicit height.
- A shared `.AccordionHeader-compact` `StyleRule` tightens the header's padding (HBox insets / cell gap). The title button gets `pinGlyphSize(compactGlyphPx)` and the indicator gets `setCompact(true)` (a smaller font-size class). Because the header is a structured HBox row, the compact class tightens the row insets and the tool-group gap together.

### Flat mode — border-collapse between stacked sections (feature 2)

New boolean **`flat?: boolean`** (default `false`). When `flat` *and* `themed` are on, every displayed header except the **first** drops its top border so adjacent section borders collapse to a single line. Implemented as a per-index shared CSS class `.AccordionHeader-flat-collapsed` (`borderTop: "none"`), toggled in `doLayout`/`createSection` on every displayed header except the first. A no-op when `themed` is off (no borders to collapse) — documented as such.

### Fill mode — open section flexes to fill remaining height (feature 7)

New boolean **`fill?: boolean`** (default `false`). When on, the open section flexes to consume the container's remaining height (IDE dock-panel style), pairing naturally with `singleOpen`. **Multi-open decision:** when `fill` is on and more than one section is open, the **last (bottommost) open section** absorbs all remaining space; the others take preferred height (shrunk normally if they overflow). Equal distribution is rejected — it makes panels jump as sections toggle.

Interaction with `computeShrinkRatio`: fill is the *underflow* counterpart to shrink's *overflow*. In `doLayout`, after computing each open section's `openHeight`, compute `leftover = budget − usedHeight` (headers + gaps + non-fill open heights); if `fill` and `leftover > 0`, add `leftover` to the fill target's height. When `computeShrinkRatio` returned non-zero (overflow), `leftover ≤ 0`, so fill is a no-op — the two policies are mutually exclusive by construction. `getPreferredSize` is unchanged (fill only affects *placement* when the host stretches the accordion beyond its preferred height, e.g. the demo's `VBox({ stretching: true })`).

### `expandAll()` / `collapseAll()` (feature 8)

`collapseAll()` closes every section. `expandAll()` **respects `singleOpen`**: under single-open it opens only the **first displayed** section (matching what `setSingleOpen(true)` already does when it collapses all-but-first, [`Accordion.ts:178-194`](../src/typescript/lib/layout/Accordion.ts#L178)); otherwise it opens every displayed section. Both fire `sectiontoggle` per actual state change and schedule one layout. `AccordionPanel` gains thin `expandAll()`/`collapseAll()` forwarders to `getAccordion()` (the demo's hand-rolled loops are exactly this); per-index open/close stays reached through `getAccordion()` per the existing accessor decision ([`AccordionPanel.ts:42-46`](../src/typescript/lib/component/container/AccordionPanel.ts#L42)).

### CODE_CONVENTIONS compliance note

No unavoidable violation. `Accordion`/`Tab` are `LayoutManager` subclasses, **not** Components, so they carry no `XOptions` bag — they store config in private fields and forward from their own `applyOptions` ([`Accordion.ts:128`](../src/typescript/lib/layout/Accordion.ts#L128)); new `Accordion` config follows that private-field + setter + `applyOptions`-forward shape. The component-side fields (`AccordionHeader`, `AccordionIndicator`) follow the options-bag-as-cache rule with `declare`-d backing fields for any cascade-dispatched setter (per CODE_CONVENTIONS *Fields written during the `super()` cascade* — `AccordionIndicator._expanded`/`_char` are `declare`d). Listeners reference named functions; setters are typed; shared class rules use `StyleRule`; DOM access stays behind `DOM.sink`. **One borderline item to flag:** `AccordionHeader` now hosts child Components in an HBox while extending `Component` (not `Container`) — this is permitted (`addComponent`/`setLayoutManager` live on `Component`, [`Component.ts:428,4057`](../src/typescript/lib/core/Component.ts#L4057)) and mirrors how the demo builds rows from plain `Component` + `HBox`, so it is conventional, not a violation.

---

## Public API (TypeScript Signatures)

```typescript
// layout/Accordion.ts
export interface AccordionOptions extends LayoutManagerOptions {
    singleOpen?:        boolean;
    headerHeight?:      number;
    animationDuration?: number;
    spacing?:           number;                       // feature 1; default 0 — gap between sections
    themed?:            boolean;                      // feature 1; default false — consumes accordion.* tokens
    flat?:              boolean;                       // feature 2; default false (no-op unless themed)
    chevronSide?:       "left" | "right";             // feature 3; default "right"
    compact?:           boolean;                       // feature 6; default false
    fill?:              boolean;                        // feature 7; default false
    chevronGlyph?:      string;                         // feature 9; default "▶"
    toolsVisibility?:   "always" | "hover";            // feature 4; default "hover" — governs per-section tools
    listeners?: { sectiontoggle?: SectionToggleCallback };
}

class Accordion extends LayoutManager {
    // feature 1
    setSpacing(px: number): this;
    getSpacing(): number;                              // backing field _spacing: number = 0
    setThemed(value: boolean): this;
    isThemed(): boolean;                              // backing field _themed: boolean = false
    // feature 2
    setFlat(value: boolean): this;
    isFlat(): boolean;                                // backing field _flat: boolean = false
    // feature 3
    setChevronSide(side: "left" | "right"): this;
    getChevronSide(): "left" | "right";              // backing field _chevronSide = "right"
    // feature 4 — GLOBAL tools (mirrors Tab.addTool)
    addTool(button: Component): this;
    removeTool(button: Component): this;
    setToolsVisibility(mode: "always" | "hover"): this;
    getToolsVisibility(): "always" | "hover";        // backing field _toolsVisibility = "hover"
    // feature 6
    setCompact(value: boolean): this;
    isCompact(): boolean;                            // backing field _compact: boolean = false
    // (setHeaderHeight gains a _headerHeightExplicit guard: boolean = false)
    // feature 7
    setFill(value: boolean): this;
    isFill(): boolean;                              // backing field _fill: boolean = false
    // feature 9
    setChevronGlyph(char: string): this;
    getChevronGlyph(): string;                      // backing field _chevronGlyph = "▶"
    // feature 8
    expandAll(): this;
    collapseAll(): this;
}
```

```typescript
// component/container/AccordionHeader.ts — now extends Component, not Button
export interface AccordionHeaderOptions extends ComponentOptions {
    label:         string;
    expanded?:     boolean;
    glyph?:        string;                  // feature 5 — leading glyph on the title button
    chevronSide?:  "left" | "right";        // feature 3
    compact?:      boolean;                 // feature 6
    chevronGlyph?: string;                  // feature 9
}

class AccordionHeader extends Component<AccordionHeaderOptions> {
    // toggle target + focusable element
    getTitleButton(): Button;                       // manager wires its click/keydown and calls focus() on it
    setExpanded(expanded: boolean): this;            // forwards to indicator + title aria-expanded
    isExpanded(): boolean;
    setAnimationTiming(durationMs: number, easing: string): this;  // preserved — forwards to indicator
    // feature 4 — per-header tool slot
    addTool(tool: Component): this;
    removeTool(tool: Component): this;
    // feature 3
    setChevronSide(side: "left" | "right"): this;    // moves the indicator HBox cell to head/tail
    // feature 6
    setCompact(value: boolean): this;
    // feature 9
    setChevronGlyph(char: string): this;             // forwards to indicator.setChar
    // private state:
    //   declare private _indicator: AccordionIndicator;
    //   declare private _title: Button;
    //   private _tools: Component[] = [];
    //   declare private _toolGroup: Component;        // HBox host
    //   private _chevronSide: "left" | "right" = "right";  (declare if cascade-written)
}
```

```typescript
// component/container/AccordionIndicator.ts
export interface AccordionIndicatorOptions extends ComponentOptions {
    expanded?: boolean;
    compact?:  boolean;             // feature 6
    char?:     string;              // feature 9; default "▶"
}

class AccordionIndicator extends Component<AccordionIndicatorOptions> {
    setCompact(value: boolean): this;        // toggles smaller-font class
    setChar(char: string): this;             // writes text content; declare private _char: string
    setExpanded(value: boolean): this;       // unchanged
    setAnimationTiming(durationMs: number, easing: string): this;   // unchanged
    // NOTE: side is handled by the header re-ordering the HBox cell, so the
    // indicator gains no setSide — it is an ordinary in-flow cell now.
}
```

```typescript
// layout/AccordionConstraints.ts
export class AccordionConstraints extends LayoutConstraints {
    label: string;
    initiallyOpen?: boolean;
    glyph?: string;            // feature 5 — forwarded to the header's title-button glyph
    tools?: Component[];        // feature 4 — per-section tools
    constructor(label: string, initiallyOpen?: boolean, glyph?: string, tools?: Component[]);
}
```

```typescript
// component/container/AccordionPanel.ts
export interface AccordionSectionConfig {
    label:          string;
    component:      Component;
    initiallyOpen?: boolean;
    glyph?:         string;        // feature 5
    tools?:         Component[];   // feature 4 — per-section tools
}

export interface AccordionPanelOptions extends ContainerOptions {
    sections?:        AccordionSectionConfig[];
    singleOpen?:      boolean;
    onSectionToggle?: SectionToggleCallback;
    // pass-throughs to the wrapped Accordion (applied in the constructor):
    spacing?:         number;
    themed?:          boolean;
    flat?:            boolean;
    chevronSide?:     "left" | "right";
    compact?:         boolean;
    fill?:            boolean;
    chevronGlyph?:    string;
    toolsVisibility?: "always" | "hover";
}

class AccordionPanel<TOptions extends AccordionPanelOptions = AccordionPanelOptions> extends Container<TOptions> {
    addSection(component: Component, label: string, initiallyOpen?: boolean, glyph?: string, tools?: Component[]): this;
    expandAll(): this;     // feature 8 — forwards to getAccordion()
    collapseAll(): this;   // feature 8
}
```

---

## Theme Tokens

The four header/panel tokens are *newly consumed*, not newly defined — no `Theme.ts` interface change, no `themeToVars` change, no theme-file value change is required; they already carry values in all three theme files. **No new tokens are introduced.** The table documents the now-live tokens (light = Modern/Classic, dark = Dark):

| CSS Custom Property | Light Default | Dark Default | Purpose |
|---|---|---|---|
| `--ts-ui-accordion-header-bg` | `linear-gradient(rgb(230,230,230),rgb(210,210,210))` | `linear-gradient(rgb(60,60,60),rgb(45,45,45))` | Header background when `themed` (feature 1) |
| `--ts-ui-accordion-header-border` | `rgb(190,190,190)` | `rgb(80,80,80)` | Header border when `themed`; collapsed in `flat` (features 1/2) |
| `--ts-ui-accordion-header-color` | `inherit` | `inherit` | Header text colour when `themed` (feature 1) |
| `--ts-ui-accordion-panel-border` | `rgb(210,210,210)` | `rgb(70,70,70)` | Panel-wrapper border when `themed` (feature 1) |
| `--ts-ui-accordion-indicator-color` | `rgb(100,100,100)` | `rgb(160,160,160)` | Chevron colour (already consumed; unchanged) |

No `Theme` / `DefaultTheme`(=Modern) / `ClassicTheme` / `DarkTheme` / `themeToVars` block needs a *new* entry. (If the post-build visual review proves a header *hover* token is wanted, it would be added to the `accordion.header` block of all four — `Theme.ts` interface + the three theme files — and to `themeToVars`; out of current scope.)

---

## Internal Structure

Header tree after the restructure — one owned element (the HBox host), all else child Components:

```
<div.AccordionHeader>                       ← HBox host; bg + border (tokens when themed); region/labelledby wrapper sem on the panel
  [ <span.AccordionIndicator> ]             ← HBox cell #0 ONLY when chevronSide="left"
  <button.Button chromeless>                ← title: leading glyph + label, anchor WEST; the clickable toggle + focus target
  <Spacer flex>                             ← pushes trailing cells to the right; keeps title left-aligned
  <div toolGroup HBox>                      ← per-section tools (and the re-parented global tool when this header is hovered)
  [ <span.AccordionIndicator> ]             ← LAST cell ONLY when chevronSide="right" (default) — chevron outermost
</div>
```

`doLayout` vertical cursor with spacing + fill (sketch):

```
y = insets.top
displayed = sections where component.isDisplayed()
usedHeight = sum(headerHeight) + sum(open openHeights, non-fill) + (displayed-1)*spacing
fillTarget = last open displayed section   (only when fill && open count >= 1)
leftover = budget - usedHeight             (only meaningful when fill && leftover > 0)

for each displayed section i (with running index d):
    place header at y, height = effectiveHeaderHeight        // compact-aware
    y += effectiveHeaderHeight
    openHeight = preferred - shrinkRatio*(preferred-min)
    if fill && i == fillTarget && leftover > 0: openHeight += leftover
    place wrapper/content (panelHeight = isOpen ? openHeight : 0)
    y += panelHeight
    if not last displayed: y += spacing                       // feature 1
```

Global-tool re-parent: on header `mouseover`, `DOM.sink.appendChild(thisHeaderToolGroupEl, globalTool.getElement())`; the tool follows the cursor across headers. Per-section tools live in their own header's tool group permanently.

---

## Ordered Implementation Steps

Sequencing per the design brief: the **header HBox restructure is the foundation and lands first**; chevron-as-cell, glyph, tools-wiring, compact build on it; then flat mode, gap/token wiring, fill mode, expand/collapseAll, custom chevron.

1. **Header HBox restructure (foundation).** Rewrite `AccordionHeader` to `extends Component`: build the HBox host, the `chromeless` title `Button` (glyph + label, `anchor: WEST`), the flex `Spacer`, the `_toolGroup` HBox Component, and the `_indicator` cell. Add `getTitleButton`, re-implement `setExpanded`/`isExpanded`/`setAnimationTiming` to forward to the indicator + title aria. In `Accordion.createSection`, construct the new header and re-point `Event.addListener(title, 'click'/'keydown')` and `onHeaderKeyDown`'s `focus()` to `header.getTitleButton()`; move `aria-expanded`/`aria-controls` onto the title button; keep `role="region"`+`aria-labelledby` on the wrapper. *Regression checkpoint (critical):* `npm run typecheck` clean; run the app, open the Accordion demo, confirm sections still toggle on header/title click, ARIA expanded/controls present, `ArrowUp/Down/Home/End` move focus, open/close animation timing unchanged.

2. **Chevron as HBox cell (feature 3, structural half).** Strip the `position:absolute`/`right`/`top`/`transform: translateY` geometry from the `.AccordionIndicator` rule; make `.expanded` a plain `rotate(90deg)`. Add `AccordionHeader.setChevronSide` re-ordering the indicator cell head/tail; `Accordion` `chevronSide` option + `setChevronSide` calling `header.setChevronSide` in `createSection`. *Checkpoint:* toggle `chevronSide` in the demo — label stays left-aligned both ways; chevron never overlaps a tool.

3. **Glyph in title (feature 5).** `AccordionConstraints.glyph` ctor param/field; `AccordionSectionConfig.glyph` + `addSection` 4th arg; in `createSection` pass `constraints.glyph` as the header's `glyph` option → title button's `glyph`. *Checkpoint:* a section with `glyph: "user"` shows a leading glyph beside its title.

4. **Tools wiring (feature 4).** `AccordionHeader.addTool/removeTool` (push into `_tools`, add to `_toolGroup`). `Accordion.addTool/removeTool` (global `_tools` + `scheduleLayout`) and the hover re-parent (`mouseover`/`mouseout` named handlers moving the global tool into the hovered header's tool group). `AccordionConstraints.tools` read in `createSection` into per-section tool groups. `toolsVisibility` option + `.AccordionHeader-tools-hover` rule for per-section hover reveal. *Regression checkpoint:* add a per-section tool and a global tool in the demo; click a tool → section does **NOT** toggle; click header chrome/title → it does; global tool follows hover; `toolsVisibility:"hover"` hides per-section tools until hover.

5. **Compact (feature 6).** `COMPACT_HEADER_HEIGHT` + glyph-size constants (documented). `Accordion` `compact` option, `_headerHeightExplicit` guard in `setHeaderHeight`, effective-height resolution. `AccordionHeader.setCompact` (`.AccordionHeader-compact` rule tightening HBox insets/gap + `title.pinGlyphSize`); `AccordionIndicator.setCompact` (smaller-font class). *Checkpoint:* compact section visibly denser; glyph/chevron scaled; non-compact unchanged; explicit `headerHeight` not overridden.

6. **Flat mode (feature 2).** `.AccordionHeader-flat-collapsed` rule (`borderTop: none`); in `doLayout`/`createSection` toggle it on every displayed header except the first when `_flat && _themed`. *Checkpoint:* flat (with `themed`) shows single collapsed borders; `flat` without `themed` is a visual no-op.

7. **Gap + token wiring (feature 1).** `Accordion` `_spacing`/`_themed` fields, setters, `applyOptions` forwards, options. Add the inter-section gap to `doLayout`, `getPreferredSize`, `getMinSize`, `computeShrinkRatio` in lockstep. In `createSection`, when `_themed`, apply the four tokens via `header.setBackgroundColor/setBorder/setForegroundColor` + `wrapper.setBorder`. *Checkpoint:* `grep -rn 'ts-ui-accordion-header-bg\|ts-ui-accordion-panel-border' src/typescript/lib/component/container/ src/typescript/lib/layout/` now returns hits; default (`themed` false, `spacing` 0) demo is visually unchanged from step 1; the inter-section gap is gone (was the Button-chrome gap, removed in step 1).

8. **Fill mode (feature 7).** `Accordion` `fill` option + `setFill`. In `doLayout` compute `leftover` and add to the last open section when `fill && leftover > 0`. *Checkpoint:* with the demo's stretching VBox host, `fill`+`singleOpen` fills the open section; multiple open → only bottommost fills; overflow (shrink) path unchanged.

9. **expand/collapseAll (feature 8).** `Accordion.expandAll` (single-open-aware) / `collapseAll`; `AccordionPanel.expandAll/collapseAll` forwarders. Rewrite the demo's Open All/Close All loops to call them. *Checkpoint:* demo buttons work; with single-open ON, Open All opens only the first section.

10. **Custom chevron (feature 9).** `AccordionIndicator._char` (`declare`), `char` option, `setChar`, `render` writes `_char`. `AccordionHeader.setChevronGlyph` → indicator; `Accordion` `chevronGlyph` option → `header.setChevronGlyph` in `createSection`. *Checkpoint:* `grep -n '"▶"' src/typescript/lib/component/container/AccordionIndicator.ts` — the literal is now only the default field initializer, not in `render`'s apply call; custom `chevronGlyph` (e.g. `"+"`) renders and rotates.

11. **Options pass-through + docs + verification.** Wire all new `Accordion` options through `AccordionPanelOptions` in the `AccordionPanel` constructor; update curated docs; run the verification suite below.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/component/container/AccordionHeader.ts` (rewrite: Component+HBox host, title button, tools, chevron cell, compact, glyph, chevronGlyph) |
| Modify | `src/typescript/lib/layout/Accordion.ts` (features 1,2,3,4,6,7,8,9 manager wiring; re-point click/keydown/focus to title button) |
| Modify | `src/typescript/lib/component/container/AccordionIndicator.ts` (in-flow cell, compact, char/chevronGlyph) |
| Modify | `src/typescript/lib/layout/AccordionConstraints.ts` (glyph, tools) |
| Modify | `src/typescript/lib/component/container/AccordionPanel.ts` (glyph/tools in addSection + config, expand/collapseAll forwarders, option pass-through) |
| Modify | `src/typescript/AccordionDemoPanel.ts` (expand/collapseAll; showcase themed, spacing, chevronSide, glyph, tools, compact, fill, chevronGlyph) |
| Modify | `docs/layouts/Accordion.md`, `docs/components/AccordionPanel.md` (new options/methods) |
| None | `Theme.ts` / theme files (tokens already defined; only newly *consumed*) |
| None | barrels (no new exported symbols — only new options/methods on existing exported classes/interfaces) |

---

## Verification

- **Typecheck:** `npm run typecheck` — 0 errors. (Critical after step 1: `AccordionHeader` no longer being a `Button` ripples through any caller assuming Button methods — typecheck surfaces them.)
- **Grep invariants:**
  - `grep -rn "ts-ui-accordion-header-bg" src/typescript/lib/component/container/ src/typescript/lib/layout/` — ≥1 hit after step 7 (was 0).
  - `grep -n '"▶"' src/typescript/lib/component/container/AccordionIndicator.ts` — only the default field initializer remains after step 10.
  - `grep -rn "ts-ui-accordion" src/typescript/ | grep -v core/Theme.ts | grep -v core/themes/` — confirm all four header/panel tokens now appear (was only indicator-color).
- **Manual smoke test — the "Accordion" demo screen** (`AccordionDemoPanel`, lazy tab labelled "Accordion"; `npm run dev`, open the Accordion tab). Scope DevTools queries to `.AccordionDemoPanel .AccordionHeader` (multiple accordions can coexist):
  1. Header/title click toggles; **tool click does NOT toggle**.
  2. Chevron left vs right; label stays left-aligned; chevron never overlaps a tool; chevron is outermost on the right.
  3. Global tool follows the hovered header; per-section tool stays put; `toolsVisibility:"hover"` reveals per-section tools only on hover.
  4. Compact density visibly tighter; glyph/chevron scaled; explicit `headerHeight` not overridden.
  5. Flat (with `themed`) shows single collapsed borders; the old ~1px inter-section gap is gone.
  6. Fill + single-open: open section fills the stretching VBox host's remaining height; multiple open → only bottommost fills.
  7. Section glyph renders beside the title (a real Glyph); custom `chevronGlyph` renders and rotates.
  8. Open All / Close All via `expandAll`/`collapseAll`; with single-open ON, Open All opens only the first section.
  9. ARIA `aria-expanded`/`aria-controls` on the title button, `role="region"`/`aria-labelledby` on the wrapper; `ArrowUp/Down/Home/End` move focus; open/close animation timing unchanged.
- **Theme toggle:** switch Modern/Classic/Dark with `themed` on — header bg/border + panel border + chevron colour track the theme.
- **Docs build:** `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning).

---

## Documentation Impact

- **No new exported symbols** — all changes are new optional fields/methods on already-exported `Accordion`, `AccordionHeader`, `AccordionIndicator`, `AccordionConstraints`, `AccordionPanel` and their already-exported `*Options` interfaces (layout barrel `src/typescript/lib/layout/index.ts`, container barrel `src/typescript/lib/component/container/index.ts`). No barrel edits required.
- Update the curated pages `docs/layouts/Accordion.md` and `docs/components/AccordionPanel.md` with the new options (`spacing`, `themed`, `flat`, `chevronSide`, `compact`, `fill`, `chevronGlyph`, `toolsVisibility`), the per-section `glyph`/`tools`, the global `addTool`/`removeTool`, and `expandAll`/`collapseAll`. **Document the two glyph systems distinctly:** a section `glyph` is a *registry name* (real `Glyph`, leads the title); `chevronGlyph` is a *raw character* (the rotating chevron). Document the **single-instance global-tool constraint** (a global tool follows the hovered header; it is not shown in every header at once) and the **header-is-no-longer-a-button** behavioural change.
- Sidebar entries already exist (`docs/.vitepress/config.mts:138,169`); no sidebar change.
- JSDoc: full blocks on every new method/option per CODE_CONVENTIONS. Cross-bucket references (e.g. `AccordionHeader` in `component/container` referencing `Accordion` in `layout`) use markdown links, not `{@link}`, per docs-conventions.

---

## Potential Challenges

- **`AccordionHeader` is no longer a `Button` — caller ripple.** Any external reference relying on Button methods on the header breaks. Mitigation: the header is manager-internal (not in `container.getComponents()`); `npm run typecheck` surfaces any stray reference, and the manager addresses headers only via the new `getTitleButton`/`setExpanded`/`setAnimationTiming` surface.
- **Focus/keyboard relocation.** The focusable element moves from the header `<button>` to the inner title button; `focus()` and the `keydown` listener must target it. Mitigation: route both through `getTitleButton()` in step 1 and verify `Arrow*`/`Home`/`End` + focus-ring in the smoke test.
- **Reduced-motion path.** `primeWrapper`'s reduced-motion branch rebuilds transitions for every header/wrapper ([`Accordion.ts:828-845`](../src/typescript/lib/layout/Accordion.ts#L828)) by calling `setTransition` on the header. Mitigation: keep `AccordionHeader.setTransition` working on the (now Component) header element — `setTransition` is a `Component` method, so the loop is unaffected; keep header element identity stable across toggles.
- **Global-tool re-parenting cancels CSS transitions.** Per memory, re-parenting a DOM node cancels in-flight descendant transitions. Mitigation: tools carry no transition, so the move is visually instantaneous — noted, harmless. Use `DOM.sink.appendChild` (the seam) for the move.
- **Size-report accuracy (features 1/7).** A spacing gap (or fill slack) the layout adds but the size paths omit is an ARCHITECTURE.md size-report bug. Mitigation: add `spacing` to `doLayout`/`getPreferredSize`/`getMinSize`/`computeShrinkRatio` in lockstep (step 7); fill only affects *placement*, so `getPreferredSize` is intentionally unchanged.
- **Compact overriding explicit headerHeight.** Mitigation: the `_headerHeightExplicit` guard — compact's smaller default applies only when the consumer never called `setHeaderHeight`.

---

## Critical Files

- [`src/typescript/lib/component/container/AccordionHeader.ts`](../src/typescript/lib/component/container/AccordionHeader.ts) — the header (rewritten: Component + HBox host, title button, tools, chevron cell).
- [`src/typescript/lib/layout/Accordion.ts`](../src/typescript/lib/layout/Accordion.ts) — the manager; `createSection`, `doLayout`, `computeShrinkRatio`, `onHeaderKeyDown`, `onHeaderClicked`, `primeWrapper`, size reports.
- [`src/typescript/lib/component/container/AccordionIndicator.ts`](../src/typescript/lib/component/container/AccordionIndicator.ts) — the chevron; now an in-flow HBox cell with a char override.
- [`src/typescript/lib/component/button/Button.ts`](../src/typescript/lib/component/button/Button.ts) — `chromeless`/`flat`/`compact` appearance ([:88-122](../src/typescript/lib/component/button/Button.ts#L88)), `glyph`/`setGlyph`/`pinGlyphSize` ([:73,1106,1165](../src/typescript/lib/component/button/Button.ts#L1106)), default chrome ([:187-188](../src/typescript/lib/component/button/Button.ts#L187)).
- [`src/typescript/lib/layout/HBox.ts`](../src/typescript/lib/layout/HBox.ts) + [`src/typescript/lib/component/container/Spacer.ts`](../src/typescript/lib/component/container/Spacer.ts) — the header row layout (`Spacer.flex()` at [:106](../src/typescript/lib/component/container/Spacer.ts#L106)).
- [`src/typescript/lib/component/container/TabBar.ts`](../src/typescript/lib/component/container/TabBar.ts) (`_tools`/`_toolGroup`/`addTool`/`removeTool` at [:503,506,1125,1141](../src/typescript/lib/component/container/TabBar.ts#L1125)) and [`src/typescript/lib/layout/Tab.ts`](../src/typescript/lib/layout/Tab.ts) (`addTool`/`removeTool` forwarding at [:761,776](../src/typescript/lib/layout/Tab.ts#L761)) — the tool API reference.
- [`src/typescript/lib/core/Theme.ts`](../src/typescript/lib/core/Theme.ts) (accordion block [:509-521](../src/typescript/lib/core/Theme.ts#L509), `themeToVars` [:947-951](../src/typescript/lib/core/Theme.ts#L947)) and the three theme files — token values (features 1/2).
- [`ARCHITECTURE.md`](../ARCHITECTURE.md), [`CODE_CONVENTIONS.md`](../CODE_CONVENTIONS.md) — binding conventions.

---

## Non-Goals

- **Always-visible global tools.** A global tool is a single instance and follows the hovered/active header; rendering it in every header at once would require per-header clones, which is out of scope (flagged for post-build re-evaluation).
- **Glyph-based chevron.** `chevronGlyph` is a raw character, not a `Glyph` registry name — deliberately separate from the section `glyph`.
- **Horizontal accordions / chevron on top/bottom.** `chevronSide` is left/right only.
- **Per-section `themed`/`flat`/`compact`/`fill`/`spacing`/`chevronSide` overrides.** These are manager-wide; only `label`/`initiallyOpen`/`glyph`/`tools` are per-section.
- **New theme tokens.** The four already-defined-but-dead tokens are wired; no new token is introduced (a header *hover* token would be added only if the post-build review proves it necessary).
- **Multi-section equal-fill distribution.** Only the last open section fills; equal distribution is rejected.
- **Animated tool-region transitions / tool width strategies.** Tools render at preferred size in an HBox; no width modes (unlike `TabBar`).
- **`flat` title-button appearance.** The title button is `chromeless`; switching it to `flat` is a documented post-build re-evaluation, not part of this scope.
