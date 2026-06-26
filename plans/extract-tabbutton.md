---
touches-shared: ["src/typescript/lib/component/container/TabBar.ts"]
---

# TabButton — Collapse the Per-Tab Button Assembly — Implementation Plan

## Overview

Extract a `TabButton` component — a `ToggleButton` subclass — that owns the per-tab button assembly currently re-built and re-styled imperatively for every cell inside [`TabBar.createBarEntry`](../src/typescript/lib/component/container/TabBar.ts#L1422). Today each tab replays ~90 lines of identical structural/styling calls per entry: the unselected/hover/selected fill + image + shadow + border token wiring ([TabBar.ts:1431–1462](../src/typescript/lib/component/container/TabBar.ts#L1431)), the Fit wrapper Component, and the optional close-affordance construction/styling ([TabBar.ts:1485–1513](../src/typescript/lib/component/container/TabBar.ts#L1485)). `TabButton` moves that boilerplate into one constructor that owns the `--ts-ui-tab-button-*` and `--ts-ui-tab-close-*` token contract, accepts the per-tab varying data (label, glyph, closeable) as options, and exposes the close-affordance for positioning.

The new file lives at `src/typescript/lib/component/button/TabButton.ts`, exported from the button barrel [`src/typescript/lib/component/button/index.ts`](../src/typescript/lib/component/button/index.ts) (beside `ToggleButton` and the existing `TabCloseButton`, which `TabButton` composes). `TabBar` keeps every strip-geometry and coordinator concern: where the tab sits, the per-layout close-button re-pin ([`positionCloseButtons`, TabBar.ts:2421](../src/typescript/lib/component/container/TabBar.ts#L2421)), inset/writing-mode/text-align recompute ([`applyTabButtonStyles`, TabBar.ts:2255](../src/typescript/lib/component/container/TabBar.ts#L2255)), `ButtonGroup`/`RovingTabIndex` enrolment, and the context-menu subtree listener.

The justification is **purely local complexity reduction** — collapsing replayed assembly into one class with a single home for the tab token contract. `TabButton` is *not* pitched as broadly reusable; its only consumer is `TabBar`. See Architecture Decisions.

A sibling plan (`extract-scrollstrip`, [plans/extract-scrollstrip.md](./extract-scrollstrip.md)) also modifies `TabBar.ts`; hence the `touches-shared` frontmatter. The two are independent extractions from the same file — see _Coordination with extract-scrollstrip_.

---

## Investigation Findings — what `createBarEntry` builds per tab

`createBarEntry` ([TabBar.ts:1422–1567](../src/typescript/lib/component/container/TabBar.ts#L1422)) assembles three things per entry. Classifying each line by **(a) replayed boilerplate**, **(b) per-tab varying data**, **(c) must-stay strip/coordinator concern**:

**(a) Replayed boilerplate — moves into `TabButton`'s constructor:**
- `new ToggleButton(name)` then the full state styling ([1431–1462](../src/typescript/lib/component/container/TabBar.ts#L1431)): `setBackgroundColor`/`setBackgroundImage` to `--ts-ui-tab-button-bg`; `setBorder` with the four per-side `--ts-ui-tab-button-border-*` fallbacks; `clearBorderRadius`; `clearShadow`; the hover block (`setHoverBackgroundColor`/`Image`/`Shadow`/`Border` → `--ts-ui-tab-button-hover-*`); the selected block (`setSelectedBackgroundColor`/`Image`/`Shadow`/`Border` → `--ts-ui-tab-button-selected-*`). **Identical for every tab.**
- The Fit `wrapper` Component ([1476–1483](../src/typescript/lib/component/container/TabBar.ts#L1476)): `setLayoutManager(new Fit())`, transparent background, `clearBorder`/`clearShadow`, zero insets, `addComponent(tabButton)`. **Identical for every tab.**
- The close-affordance construction/styling ([1488–1512](../src/typescript/lib/component/container/TabBar.ts#L1488)): `new TabCloseButton()`, transparent bg, `--ts-ui-tab-close-hover-bg` hover, `setBorderRadius("3px")`, `clearBorder`/`clearShadow`, `setZIndex(1)`, the seed `pinGlyphSize(...tabCloseGlyph)`, and the `DOM.sink.appendChild(wrapper.getElement(true)!, closeButton.getElement(true)!)` overlay. **Identical styling for every closeable tab.**

**(b) Per-tab varying data — becomes `TabButton` options/setters:**
- `name` (label) → positional/`text` option (forwarded to `ToggleButton`).
- `constraints?.glyph` → `glyph` option ([1466–1468](../src/typescript/lib/component/container/TabBar.ts#L1466)).
- `constraints?.closeable` → `closeable` option ([1487](../src/typescript/lib/component/container/TabBar.ts#L1487)) — gates whether the close button is built.
- The initial insets `computeTabButtonInsets(constraints)` ([1464](../src/typescript/lib/component/container/TabBar.ts#L1464)) — **stays a TabBar call** (see (c)); TabBar sets insets on the new TabButton exactly as today.

**(c) Must stay in TabBar — strip-geometry / coordinator concerns:**
- `tabButton.on("action", () => this.onTabPressed(tabButton))` ([1470](../src/typescript/lib/component/container/TabBar.ts#L1470)) — selection coordination.
- `closeButton.on("action", () => this.emit("tabclose", id))` ([1537](../src/typescript/lib/component/container/TabBar.ts#L1537)) — the `id` and `emit` are TabBar's; TabButton exposes the close button so TabBar wires this.
- The `BarEntry` record, `contextMenuListener` + `Event.addSubtreeListener(wrapper, ...)` ([1520–1540](../src/typescript/lib/component/container/TabBar.ts#L1520)), first-cell active default ([1546–1551](../src/typescript/lib/component/container/TabBar.ts#L1546)), `_buttonGroup.addButton` / `_rovingTabIndex.add` / `_tabClip.addComponent` ([1553–1555](../src/typescript/lib/component/container/TabBar.ts#L1553)), ARIA role/selected ([1557–1558](../src/typescript/lib/component/container/TabBar.ts#L1557)), DnD source ([1562–1564](../src/typescript/lib/component/container/TabBar.ts#L1562)).
- `computeTabButtonInsets` ([1761](../src/typescript/lib/component/container/TabBar.ts#L1761)) and its re-application in `applyTabButtonStyles` ([2255–2291](../src/typescript/lib/component/container/TabBar.ts#L2255)) — depend on `_compact`, `_side`, `_orientation`, `_textAlign`: pure strip state. **Stay.**
- `positionCloseButtons` ([2421–2457](../src/typescript/lib/component/container/TabBar.ts#L2421)) — re-sizes and re-pins each close button per layout, reading `entry.wrapper.getWidth()`/`getHeight()` and the strip's rotation. **This is strip geometry and STAYS in TabBar.** Only the close button's *construction/styling* moves into TabButton; its *positioning* stays.

**The close button is already its own Component, not a raw `DOM.sink` overlay.** [`TabCloseButton`](../src/typescript/lib/component/button/TabCloseButton.ts) ([TabCloseButton.ts:36](../src/typescript/lib/component/button/TabCloseButton.ts#L36)) is a `Button` subclass seeded with the `xmark` glyph. `createBarEntry` only *raw-appends* its element into the wrapper ([1512](../src/typescript/lib/component/container/TabBar.ts#L1512)) so it overlays rather than enrolling in the Fit layout. The one-element-per-class rule is **not** violated today — the overlay is an element-of-a-child appended into the wrapper's element, the standard overlay pattern used elsewhere in TabBar (indicator/reorder/drop-tint). TabButton preserves this exactly.

**Base class confirmation.** `createBarEntry` constructs a `ToggleButton` ([1423](../src/typescript/lib/component/container/TabBar.ts#L1423)) and relies on its selection state: [`ToggleButton`](../src/typescript/lib/component/button/ToggleButton.ts) ([ToggleButton.ts:27](../src/typescript/lib/component/button/ToggleButton.ts#L27)) is a `Button` subclass with `setSelected`/`isSelected` ([137](../src/typescript/lib/component/button/ToggleButton.ts#L137)), the `setSelected{BackgroundColor,BackgroundImage,Shadow,Border}` setters the styling replay uses ([158–204](../src/typescript/lib/component/button/ToggleButton.ts#L158)), and an `"action"` event mapped to DOM `"change"`. `ButtonGroup.buttons` is typed `Array<RadioButton | ToggleButton>` ([ButtonGroup.ts:45](../src/typescript/lib/overlay/ButtonGroup.ts#L45)), and `RovingTabIndex` accepts the toggle. **`TabButton extends ToggleButton` slots into the existing `ButtonGroup`/`RovingTabIndex` with no selection-logic duplication** — TabButton adds no selection state of its own.

---

## Architecture Decisions

### `TabButton extends ToggleButton` — selection slots into the existing group

`createBarEntry` already builds a `ToggleButton` and feeds it to `_buttonGroup.addButton` / `_rovingTabIndex.add`. `TabButton` subclasses `ToggleButton` so it inherits `setSelected`/`isSelected`/the `.selected` style rule and the `"action"`→`"change"` mapping unchanged. **TabButton reimplements no selection or roving logic** — TabBar still calls `_buttonGroup.addButton(tabButton)` / `_rovingTabIndex.add(tabButton)` with the `TabButton` instance, exactly as today (a `TabButton` *is a* `ToggleButton`, so the `ButtonGroup.buttons` union type already admits it). `Button` and `RadioButton` were rejected: `Button` lacks selection state (the active tab needs it); `RadioButton` is the wrong affordance and not what the strip constructs today.

### `TabButton` owns the close affordance; `TabBar` owns its placement

The close button's **construction and styling** (transparent fill, `--ts-ui-tab-close-hover-bg` hover, 3px radius, z-index, seed glyph pin) is replayed boilerplate → moves into `TabButton`'s constructor, built only when `closeable` is set. TabButton composes the existing `TabCloseButton`, raw-appends its element into TabButton's own element (the same overlay pattern, now self-contained), and exposes `getCloseButton(): TabCloseButton | null` so TabBar can (1) wire `closeButton.on("action", ...)` with the entry `id`, and (2) **position/size/re-pin it every layout via the unchanged `positionCloseButtons`**, which now reads the `TabButton`'s own width/height instead of the wrapper's. The seam: *construction/styling in TabButton, geometry in TabBar.* `positionCloseButtons` is not moved or altered beyond swapping `entry.wrapper` → `entry.button` as the measured box (see _Wrapper elimination_).

### Eliminate the Fit wrapper — `TabButton` is the box child

Today each cell is a transparent Fit `wrapper` Component that stretches a `ToggleButton` to fill it and hosts the overlaid close button ([1476–1512](../src/typescript/lib/component/container/TabBar.ts#L1476)). The wrapper's only jobs are: carry the box-child min/max clamp, stretch the button to full cell width so its per-state background spans the cell, and host the close overlay. **A `TabButton` that is itself the box child does all three** — it carries its own background (so "stretch a child to paint the background" is moot — the button *is* the painted surface), it accepts the same `setMinSize`/`setMaxSize` clamp (`clampWrapperMain` already operates on a bare `Component` ([TabBar.ts:1815](../src/typescript/lib/component/container/TabBar.ts#L1815)), and a `TabButton` *is* a `Component`), and it hosts the close overlay on its own element. So the `BarEntry.wrapper` field collapses into `BarEntry.button`: TabBar adds the `TabButton` directly to `_tabClip` and clamps it directly.

This is the load-bearing simplification (it deletes the Fit import usage per-entry, the wrapper Component, and the indirection in ~20 call sites that read `entry.wrapper`). **It carries the most regression risk** and is the one decision to verify visually: the close overlay now sits on the *styled, opaque* TabButton element rather than a transparent wrapper, and the contextmenu subtree listener attaches to the TabButton. Both are behaviour-preserving in principle (the wrapper was transparent and full-bleed; pointer/contextmenu bubbling is identical from a child element), but focus/geometry/visual parity is offline-untestable. See Potential Challenges and Expected Behaviour. **If visual verification surfaces any regression** (e.g. the button's border-radius clip eating the close overlay corner, or the Fit stretch having masked a sizing quirk), the fallback is to keep the wrapper: `TabButton` then owns only the styling/close-construction boilerplate and TabBar keeps building the Fit wrapper around it. Both variants delete the styling replay; the wrapper-elimination additionally deletes the wrapper. The plan proceeds with elimination and documents the fallback.

### Token contract gets one home; no new tokens

`TabButton`'s constructor references exactly the tokens `createBarEntry` references today — no inventions. Verified in [`Theme.ts`](../src/typescript/lib/core/Theme.ts): `--ts-ui-tab-button-bg`, `--ts-ui-tab-button-border` (+ the four `-top/-right/-bottom/-left` side vars synthesised by `tabButtonSideVars`), `--ts-ui-tab-button-hover-bg`, `--ts-ui-tab-button-hover-border` (+ sides), `--ts-ui-tab-button-selected-bg`, `--ts-ui-tab-button-selected-border` (+ sides) ([Theme.ts:958–966](../src/typescript/lib/core/Theme.ts#L958)). For the close affordance: `--ts-ui-tab-close-hover-bg` (referenced at [TabBar.ts:1494](../src/typescript/lib/component/container/TabBar.ts#L1494), with its inline `rgba(0,0,0,0.12)` fallback — note it is *not* a declared `themeToVars` entry, so the fallback is load-bearing; preserve it verbatim) and `--ts-ui-close-button-fg` (TabCloseButton's own default ([TabCloseButton.ts:28](../src/typescript/lib/component/button/TabCloseButton.ts#L28))). **No `Theme.ts` change** — TabButton relocates the *references*, not the token definitions. The same `var(..., fallback)` strings move verbatim so light/dark output is byte-identical.

### `callable()` export + button-barrel; "Compose before specializing"

`TabButton` follows the `_Name`/`Name` alias pattern ([ARCHITECTURE.md, `callable()` export]): `const TabButtonCallable = callable(TabButton); export { TabButton as _TabButton, TabButtonCallable as TabButton }`, exported from the **button** barrel `src/typescript/lib/component/button/index.ts` (beside `ToggleButton`/`TabCloseButton`). No root barrel.

This extraction is justified under ARCHITECTURE.md's **"Compose before specializing"** principle — specifically its local-complexity-reduction clause: a specialized component is warranted when it *actively reduces* total complexity (collapsing replayed assembly into one class with a single token home), not merely relocates it. **Note: that section is currently UNCOMMITTED in the main working tree and does NOT appear in this worktree's `ARCHITECTURE.md`** (the worktree branches from committed HEAD). The implementer may reference the principle by name but must not assume the section is present on disk; do not cite a line number for it.

### Named listeners; typed setters with cached backing fields

TabButton wires no inline closures of its own except the close-button construction; the `"action"` handlers stay TabBar's (named arrow assignments at the call site, as today). The only new option-backed field is `closeable` (cached `_closeable`, `XOptions.closeable`); `glyph`/`text`/`selected` are inherited Button/ToggleButton options and forward through `super`. No new DOM *property* setters are introduced (the styling setters all pre-exist on Button/ToggleButton), so there are no new call-site routing obligations beyond the `closeable` option.

---

## Public API (TypeScript Signatures)

```typescript
import { ToggleButton, ToggleButtonOptions } from "~/component/button/ToggleButton.js";
import { TabCloseButton } from "~/component/button/TabCloseButton.js";

export interface TabButtonOptions extends ToggleButtonOptions {
    /** When true, builds and overlays the close (✕) affordance. Default false. */
    closeable?: boolean;
    // `text` (label), `glyph`, `selected` are inherited from ToggleButtonOptions.
}

class TabButton extends ToggleButton<TabButtonOptions> {
    constructor(text: string, options?: TabButtonOptions);

    /** The overlaid close button, or null when not closeable. TabBar wires its
     *  "action" and positions/re-pins it each layout. */
    getCloseButton(): TabCloseButton | null;

    /** Whether this tab carries a close affordance (cached `_closeable`). */
    isCloseable(): boolean;
}

const TabButtonCallable = callable(TabButton);
type TabButtonCallable = TabButton;
export { TabButton as _TabButton, TabButtonCallable as TabButton };
```

Note: `ToggleButton`'s constructor is `(text: string, options?)` ([ToggleButton.ts:38](../src/typescript/lib/component/button/ToggleButton.ts#L38)); `TabButton` mirrors that positional `text` signature so `new TabButton(name, { closeable, glyph })` reads naturally. The state-styling setters (`setSelectedBackgroundColor`, `setHoverBorder`, …) are all inherited — TabButton calls them in its constructor, exposing no new ones.

New option-backed field (cached setter + backing field + option):

| Setter / accessor | Backing field | Option |
|---|---|---|
| `isCloseable` (read-only; set once at construction) | `_closeable` | `closeable` |

`closeable` is construction-time only (the close button is built or not when the tab is created — matching today's `constraints?.closeable` gate), so there is no public `setCloseable`. If a runtime toggle is ever needed it is a separate change; do not add it speculatively.

---

## Internal Structure

`TabButton`'s constructor:

1. `super(text)` — builds the `ToggleButton` (and its `Button` content row) with the label.
2. Apply the **fill/border/hover/selected** styling block verbatim from `createBarEntry` ([1431–1462](../src/typescript/lib/component/container/TabBar.ts#L1431)) — same `var(--ts-ui-tab-button-*, fallback)` strings. (This was previously *after* construction in TabBar; here it runs in the leaf constructor body, after `super(text)`, so the styling setters fire on a fully-built button — mirroring how TabBar called them post-construction.)
3. Dispatch `options` (glyph, selected, closeable) — forward `glyph`/`selected` via `applyOptions`/`super`, read `closeable` into `_closeable`.
4. If `_closeable`: build the `TabCloseButton`, apply its styling block verbatim ([1492–1507](../src/typescript/lib/component/container/TabBar.ts#L1492)) including the seed `pinGlyphSize(ThemeManager.getResolvedScale().tabCloseGlyph)`, and `DOM.sink.appendChild(this.getElement(true)!, closeButton.getElement(true)!)` to overlay it on TabButton's own element. Store on `_closeButton`.

One DOM element per class: TabButton's element is the `ToggleButton`'s element; the close button is a *child component's* element appended in (the established overlay pattern), not a second element owned by TabButton. `_closeButton` is internal; `getCloseButton()` exposes it for TabBar's geometry pass.

`TabButton` does **not** set insets, writing-mode, text-align, min/max, or position — all strip-state-dependent and applied by TabBar (`applyTabButtonStyles`, `clampWrapperMain`, `positionCloseButtons`). It is a *styled, self-overlaying toggle button*; the strip drives its geometry.

---

## What moves, what stays — local-complexity ledger

**Deleted from `createBarEntry`** (~90 lines): the entire fill/border/hover/selected styling replay ([1425–1462](../src/typescript/lib/component/container/TabBar.ts#L1425)), the Fit `wrapper` construction ([1476–1483](../src/typescript/lib/component/container/TabBar.ts#L1476)), and the close-button construction/styling/overlay ([1485–1513](../src/typescript/lib/component/container/TabBar.ts#L1485)). `createBarEntry` shrinks to: `new TabButton(name, { glyph, closeable })`, `setInsets(computeTabButtonInsets(...))`, the two `"action"` wirings, the `BarEntry` record, group/roving/clip enrolment, ARIA, DnD. The `Fit` import becomes unused in TabBar **iff** no other site uses it (verify — Tab.ts or other strip code may).

**Stays in TabBar:** `computeTabButtonInsets`, `applyTabButtonStyles`, `positionCloseButtons`, `clampWrapperMain` (renamed conceptually to clamp the button; the method body is unchanged, it just receives `entry.button`), all `BarEntry` plumbing, selection/roving/group coordination, DnD, the indicator/reorder/drop-tint overlays, and every `_side`/`_orientation`/`_compact`/`_textAlign`-dependent recompute.

**`BarEntry` shape change:** the `wrapper: Component` field is removed; `button` becomes the box child and the measured geometry source. ~20 `entry.wrapper.*` sites ([1219, 1512, 1590, 1595, 1630, 2006…2079, 2397, 2436…2454, 2714, 2893, 3061, 3092, 3098, 3115, 3154](../src/typescript/lib/component/container/TabBar.ts)) re-point to `entry.button`. The `closeButton` field stays (now sourced from `entry.button.getCloseButton()` at build time, or kept as a parallel field for direct access — keep the field, assigned from `getCloseButton()`, to minimise churn in `positionCloseButtons`/DnD/`removeBarEntry`).

**Net:** TabBar sheds ~90 lines of per-entry replay + the wrapper indirection; `TabButton` is ~120–140 lines (the same styling logic in a constructor + `callable` boilerplate + `getCloseButton`/`isCloseable`). The honest claim is **local complexity reduction and a single home for the `--ts-ui-tab-button-*` token contract — NOT framework-wide reuse.** TabButton's only consumer is TabBar; it is a TabBar-internal collaborator that happens to live in the button barrel beside its peers.

---

## Coordination with extract-scrollstrip

Both plans modify `TabBar.ts`. They are **independent extractions from the same file and can be implemented in either order.** Overlap analysis:

- **No method-region collision.** `extract-scrollstrip` operates on the scroll/clip/arrow machinery (`computeArrowReserve`, `ensureScrollArrows`, `layoutOverflowArrows`, `clipScroll`, `revealSelectedIfRequested`, `layoutChrome`, ~2199–2851 + the `_tabClip` field). `extract-tabbutton` operates on `createBarEntry` (~1422–1567), the `BarEntry` shape, `positionCloseButtons` (~2421), and the `entry.wrapper`→`entry.button` re-point. The two line regions are disjoint.
- **One shared touch-point: `_tabClip.addComponent(wrapper)`.** `createBarEntry` adds the box child via `_tabClip.addComponent(wrapper)` ([1555](../src/typescript/lib/component/container/TabBar.ts#L1555)); `extract-scrollstrip` renames this call to `_tabClip.addItem(...)` (its `ScrollStrip` content API). After **this** plan, the argument changes from `wrapper` to the `TabButton` (`entry.button`). If both land, the final call is `_tabClip.addItem(entry.button)`. Likewise `removeComponent`/`moveComponent`→`removeItem`/`moveItem` take `entry.button` instead of `entry.wrapper`. Whichever plan lands second updates the *argument* (this plan) or the *method name* (scrollstrip) on the surviving lines — a trivial merge, no semantic conflict.
- **`positionCloseButtons` and the indicator/reorder overlays are untouched by scrollstrip** (they stay TabBar's; scrollstrip only hosts them in the clip element). This plan's close-button construction move does not touch the clip-frame/overlay boundary scrollstrip draws. No contradiction.

`extract-scrollstrip` correctly notes the "Compose before specializing" section is absent from its worktree; this plan makes the same note. Neither plan should cite a line number for it.

---

## Ordered Implementation Steps

1. **Create `src/typescript/lib/component/button/TabButton.ts`.** `class TabButton extends ToggleButton<TabButtonOptions>`. Constructor `(text, options?)`: `super(text)`; apply the fill/border/hover/selected styling block verbatim from `createBarEntry`; read `closeable` into `_closeable`; forward `glyph`/`selected` via `applyOptions`; if closeable, build + style + overlay the `TabCloseButton` and store `_closeButton`. Add `getCloseButton()`/`isCloseable()`. `callable()` export. → verify: `npx tsc --noEmit` compiles the new file (no TabBar edits yet).
2. **Barrel export.** Add `export { TabButton } from '~/component/button/TabButton.js';` + `export type { TabButtonOptions }` to `src/typescript/lib/component/button/index.ts`. → verify: import resolves; `npx tsc --noEmit`.
3. **Rewire `createBarEntry`.** Replace the `new ToggleButton(name)` + styling replay + wrapper + close-button block with `const tabButton = new TabButton(name, { glyph: constraints?.glyph, closeable: constraints?.closeable });`. Keep `setInsets(computeTabButtonInsets(constraints))`. Source `closeButton` from `tabButton.getCloseButton()`. Drop the `wrapper`; add `tabButton` to `_tabClip` directly. Wire the two `"action"` listeners and the contextmenu subtree listener on `tabButton`. → verify: `npx tsc --noEmit`.
4. **Collapse `BarEntry.wrapper` into `BarEntry.button`.** Remove the `wrapper` field from the `BarEntry` type; re-point every `entry.wrapper.*` read to `entry.button.*` (enumerate via grep below). `clampWrapperMain(entry.button, …)`, `positionCloseButtons` reads `entry.button.getWidth()/getHeight()`, DnD source uses `entry.button`, `moveComponent`/`removeComponent` take `entry.button`. → verify: `grep -n '\.wrapper' src/.../TabBar.ts` returns zero; `npx tsc --noEmit`.
5. **Remove orphaned imports.** If `Fit` and `ToggleButton` are now unused in TabBar (grep), remove their imports; keep `TabCloseButton` import only if still referenced (it is, via the `closeButton` field type). → verify: `npx tsc --noEmit`; `grep -n 'Fit\|new ToggleButton' src/.../TabBar.ts`.
6. **Typecheck + test suite.** → verify: `npx tsc --noEmit` clean, `npm test` green.
7. **Manual smoke** (offline-untestable visual/geometry): tabs on all four sides render identical fill/hover/selected; closeable tabs show the ✕ overlay in the correct corner per orientation; close click closes; context menu opens from label/glyph/✕; reorder/indicator unaffected; theme toggle (light/dark) reproduces prior colours. → verify: Tab demo screen (see Verification).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/component/button/TabButton.ts` |
| Modify | `src/typescript/lib/component/button/index.ts` (barrel export) |
| Modify | `src/typescript/lib/component/container/TabBar.ts` (consume TabButton; collapse `BarEntry.wrapper`; delete styling replay) |
| Modify | `docs/.vitepress/config.mts`, `docs/components/index.md` (new component page — see Documentation Impact) |
| Create | `docs/components/tab-button.md` (curated page) |

---

## Expected Behaviour

**Unit-testable offline** (construction/options, no DOM events/geometry):
- `new TabButton("X")` is a `ToggleButton` instance, unselected, no close button (`getCloseButton()` === null, `isCloseable()` === false).
- `new TabButton("X", { closeable: true })` builds a `TabCloseButton` (`getCloseButton()` non-null, `isCloseable()` === true).
- `new TabButton("X", { selected: true })` reports `isSelected() === true` (inherited).
- `new TabButton("X", { glyph: "house" })` carries the glyph (assert the button has a glyph child / `getGlyph()`-equivalent as ToggleButton exposes).
- `setSelected(true/false)` toggles the `.selected` class (inherited ToggleButton behaviour — assert via the class, as `ToggleButton.test.ts` does).
- The styling setters were invoked: assert the selected/hover background rules carry the `--ts-ui-tab-button-selected-bg` / `--ts-ui-tab-button-hover-bg` tokens (mirror how `ToggleButton.test.ts` inspects the `.selected` rule, if it does; otherwise this is a manual-verify).
- `TabButton` is in the button barrel (`import { TabButton } from "~/component/button/index.js"` resolves).

**Manual-verify (DOM geometry / focus / visual — offline harness can't exercise):**
- Tabs on north/south/west/east render the same fill, hover, and selected colours as before the change (theme light **and** dark).
- The close ✕ overlays in the correct corner per orientation (right-centre upright, bottom for cw, top for ccw) and tracks scale via `positionCloseButtons`; `--ts-ui-tab-close-hover-bg` tint appears on hover.
- Clicking ✕ fires `tabclose` with the right id; clicking the tab selects it (`tabpressed`); right-click anywhere on the tab (label/glyph/✕) opens the context menu.
- Reorder bar, selection indicator, and drop tint behave as before (they live on the clip element, unaffected by the wrapper→button collapse).
- **Regression watch (wrapper elimination):** the close overlay sits correctly on the now-opaque, border-radius-clipped TabButton element (no corner clipping of the ✕ hit box); the contextmenu listener still catches ✕ right-clicks from the button element. If either regresses, apply the keep-the-wrapper fallback (Architecture Decisions).

Derive tests from the contract above (constructor options → `getCloseButton`/`isCloseable`/`isSelected`), **not** from current rendered output.

---

## Verification

- `npx tsc --noEmit` — clean.
- `npm test` — green (new `tests/component/button/TabButton.test.ts` for the offline-testable construction/options behaviours; existing TabBar/Tab/ToggleButton/TabCloseButton tests unchanged and passing).
- `grep -n '\.wrapper' src/typescript/lib/component/container/TabBar.ts` — expect zero matches (the `BarEntry.wrapper` field and all reads are gone).
- `grep -n 'new ToggleButton\|--ts-ui-tab-button-bg' src/typescript/lib/component/container/TabBar.ts` — expect zero (styling replay moved out; the token references now live only in `TabButton.ts`).
- Manual smoke on the **Tab demo** screen (the screen exercising north/south/west/east strips, closeable tabs, reorder, glyphs): fill/hover/selected parity, ✕ placement/close, context menu, reorder/indicator intact. Toggle theme (light/dark) — colours track the same `--ts-ui-tab-button-*` tokens.
- `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice excepted).

---

## Documentation Impact

- **New public symbol** `TabButton` (+ `TabButtonOptions`): re-export from the `component/button` barrel (Step 2), `@category Components`. Verify it lands in the button group's generated API index after `npm run docs:build`.
- **New component page** `docs/components/tab-button.md`: short usage (a tab-styled toggle button with an optional close affordance, used internally by `TabBar`); state plainly it is a TabBar collaborator, not a general-purpose button. Link it in `docs/.vitepress/config.mts` sidebar and `docs/components/index.md` catalog.
- **JSDoc cross-bucket:** TabButton JSDoc may `{@link ToggleButton}`/`{@link TabCloseButton}` (same `button` bucket). Reference `TabBar` only via the markdown-link form (`[\`TabBar\`](/api/.../TabBar)`), not `{@link}` (cross-bucket).
- `TabBar`'s public API is unchanged (its tab-creation surface is internal), so no `TabBar` doc edits beyond an optional one-line mention that tabs are `TabButton`-backed.

---

## Potential Challenges

- **Wrapper elimination (the main risk):** the close overlay and contextmenu listener move from a transparent full-bleed wrapper to the styled, opaque, border-radius-clipped TabButton element — mitigation: the regression-watch smoke checks above; documented keep-the-wrapper fallback that still deletes the styling replay.
- **`BarEntry.wrapper`→`button` re-point breadth (~20 sites):** a missed site leaves a type error or stale geometry — mitigation: the `grep '\.wrapper'` invariant must hit zero; `npx tsc --noEmit` catches the rest.
- **Constructor styling order:** the styling setters must run *after* `super(text)` so the button's content row exists (TabBar called them post-construction today) — mitigation: place them in the TabButton constructor body after `super`, before the `options` dispatch, exactly as the leaf-constructor pattern in `ToggleButton` itself ([ToggleButton.ts:44–58](../src/typescript/lib/component/button/ToggleButton.ts#L44)).
- **`closeable` is construction-only:** no `setCloseable` — adding/removing a close affordance after creation isn't supported (it wasn't before either) — mitigation: documented as construction-time; out of scope.
- **Merge with `extract-scrollstrip`:** the `_tabClip.addComponent`/`addItem` argument is the one shared line — mitigation: whichever lands second updates the surviving call's argument/name (see Coordination); trivial.
- **`--ts-ui-tab-close-hover-bg` has no `themeToVars` entry:** its inline `rgba(0,0,0,0.12)` fallback is the only source of the value — mitigation: copy the `var(..., rgba(0,0,0,0.12))` string verbatim; do not "tidy" it to a bare token.

---

## Critical Files

- [`src/typescript/lib/component/container/TabBar.ts`](../src/typescript/lib/component/container/TabBar.ts) — `createBarEntry` (1422–1567), `BarEntry` shape + all `entry.wrapper`/`entry.button`/`entry.closeButton` reads, `computeTabButtonInsets` (1761), `applyTabButtonStyles` (2255), `positionCloseButtons` (2421), `clampWrapperMain` (1815), DnD source (~2893), `removeBarEntry` (1578).
- [`src/typescript/lib/component/button/ToggleButton.ts`](../src/typescript/lib/component/button/ToggleButton.ts) — the base class: constructor signature, `setSelected`, the `setSelected*` setters, the `"action"`→`"change"` mapping, the leaf-constructor styling pattern.
- [`src/typescript/lib/component/button/TabCloseButton.ts`](../src/typescript/lib/component/button/TabCloseButton.ts) — the composed close affordance and its `--ts-ui-close-button-fg` default.
- [`src/typescript/lib/component/button/Button.ts`](../src/typescript/lib/component/button/Button.ts) — `setHover*`/`setBackground*`/`setBorder`/`clearShadow`/`pinGlyphSize` the styling replay uses.
- [`src/typescript/lib/component/button/index.ts`](../src/typescript/lib/component/button/index.ts) — the barrel to export from.
- [`src/typescript/lib/core/Theme.ts:958–966`](../src/typescript/lib/core/Theme.ts#L958) — the `--ts-ui-tab-button-*` token definitions TabButton references (do not modify).
- [`src/typescript/lib/overlay/ButtonGroup.ts`](../src/typescript/lib/overlay/ButtonGroup.ts) — confirms `Array<RadioButton | ToggleButton>` admits a `TabButton` without change.
- `ARCHITECTURE.md` — `callable()` export pattern, one-element-per-class, and the (uncommitted, not-in-worktree) "Compose before specializing" principle.

---

## Non-Goals

- **`TabButton` is not pitched as reusable.** Its only consumer is `TabBar`; it lives in the button barrel beside its peers for discoverability, not because other code is expected to build tabs. The justification is local complexity reduction + a single token home — stated plainly per the brief.
- **No `Theme.ts` change / no new tokens.** TabButton relocates token *references*, not definitions.
- **No runtime `setCloseable`.** Close affordance is construction-time, matching today.
- **`positionCloseButtons` / strip geometry stay in TabBar.** Only close-button construction/styling moves; per-layout placement/re-pin is unchanged.
- **No scroll/clip/arrow changes.** That machinery is `extract-scrollstrip`'s scope; this plan does not touch it.
- **No "Compose before specializing" doc edit.** Codifying or relocating that (uncommitted) section is out of scope.
