# Non-Displayed Components Drop Out of Layout — Implementation Plan

## Overview

[`Component.setDisplayed(false)`](../src/typescript/lib/core/Component.ts#L1268) writes `_options.displayed = false` and sets the CSS `display` rule to `"none"`, so the element leaves the *browser's* layout flow. But nothing in the *framework's* own layout path consults the flag: `grep -rn 'isDisplayed' src/typescript/lib` returns nothing today, and there is no `isDisplayed()` accessor at all. A `display:none` child therefore still reports its full [`getPreferredSize()`](../src/typescript/lib/core/Component.ts)/[`getMinSize()`](../src/typescript/lib/core/Component.ts), and its parent's layout manager reserves the full box for it — the DOM says "no box", the framework layout says "reserve 200px". That disagreement is the bug.

This plan makes a non-displayed component **not participate** in its parent's layout — neither contributing to size aggregation nor being positioned — while leaving its intrinsic-size getters semantically unchanged (a hidden child still *has* an intrinsic size; it simply must not be *placed*). The fix lives in [`Component.ts`](../src/typescript/lib/core/Component.ts) (one new accessor + one new layout-only child accessor + a skip in [`doChildrenComponentLayouts`](../src/typescript/lib/core/Component.ts#L4069)) and across the layout managers: the simple list-based ones (`HBox`/`VBox`/`Grid`/`HFlow`/`Absolute`/`Fit`) via the new accessor, [`Border`](../src/typescript/lib/layout/Border.ts) via a per-slot guard, and the four heavier managers ([`Split`](../src/typescript/lib/layout/Split.ts), [`Tab`](../src/typescript/lib/layout/Tab.ts), [`Accordion`](../src/typescript/lib/layout/Accordion.ts), and the [`Table`](../src/typescript/lib/component/table/Table.ts) component) via **bespoke per-manager handling** — each carries chrome (gutters, tab buttons, section headers, header/footer parts) that a blanket accessor swap does not address. Only [`Card`](../src/typescript/lib/layout/Card.ts) and [`DockRegion`](../src/typescript/lib/layout/DockRegion.ts) are out of scope, for the precise structural reasons given in *Non-Goals*.

This is a **standalone framework change, orthogonal to [`window-tab-header.md`](window-tab-header.md)**: that plan reaches a true 0 px Border NORTH region by *detaching* the `WindowHeader` from the region by hand (`removeComponent(this._header)`), having explicitly verified that `setDisplayed(false)` did **not** drop NORTH to 0 because Border never consulted the displayed flag. This plan generalises that "non-displayed → absent from layout" idea so the displayed flag works everywhere. The two ship independently — see *Relationship to `window-tab-header.md`*.

---

## Architecture Decisions

### Governing contract — every layout manager honours `displayed`

`displayed` is a **core `Component` property**, not a layout-manager-local convenience. **Every layout manager that sizes or places children MUST honour `isDisplayed()`: a `displayed:false` child does not take part in that manager's layout.** This is the non-negotiable contract the whole plan exists to satisfy — the flag may not be ignored, and it may not be *substituted* by a parallel or reimplemented visibility concept (a manager's own pre-existing visibility flags are not a stand-in for honouring `displayed`).

What is **mandatory** is the outcome: a non-displayed child neither contributes to size aggregation nor is positioned. What is **free** is the *strategy* — how a given manager makes a hidden child not participate is the manager's own business. `getLaidOutComponents()` (below) is the **convenient default mechanism** for the simple list-based managers that enumerate `getComponents()`; it is *not* the mandate. Managers with their own internal structure honour the same flag by whatever strategy fits them: `Border` via a per-slot guard, `Split`/`Tab`/`Accordion` via per-section/per-entry skips, and the `Table` component by routing the flag through its own internal visibility plumbing. All of these are valid — the test is identical in every case: a `displayed:false` child genuinely drops out of that manager's layout/positioning.

This contract binds **managers that size or place children**. It does not reach managers that do neither: `Card` honours it *vacuously* (it only ever lays out the single selected child, so a hidden non-selected child never reserves space), and `DockRegion` is not a sizing/placement manager at all (it restructures Split/Tab trees and computes insertion indices, never positioning children). Both are out of scope for the precise reasons in *Non-Goals* — and that exclusion is consistent with this contract, not an exception to it.

### Add an `isDisplayed(): boolean` accessor to `Component`

None exists today. It reads `this._options.displayed ?? this._defaultOptions.displayed`, matching how every other boolean default resolves against the `_defaultOptions` bag built in the constructor ([`displayed: true`](../src/typescript/lib/core/Component.ts#L346)). Because `_defaultOptions.displayed` is always `true`, the accessor returns `true` unless `setDisplayed(false)` was called. It is a plain boolean accessor, never null (unlike [`isVisible()`](../src/typescript/lib/core/Component.ts#L1194), which is tri-state for inherited `visibility`). This is an **accessor, not a DOM-property setter**, so per `CODE_CONVENTIONS.md` it requires **no `ComponentOptions` field and no typed setter** — the backing option (`displayed`) and its setter (`setDisplayed`) already exist; this only adds the missing reader. Flagged here per the conventions' rule that any "new property without an XOptions field" decision be stated explicitly.

### Fix at the layout-participation level, NOT in the size getters

The obvious shortcut — have `getPreferredSize`/`getMinSize`/`getMaxSize` return `undefined`/`0`/`null` when not displayed — is rejected for two independent reasons:

1. **`undefined`/`null` is overloaded and does NOT uniformly mean "zero space" in this layout system.** [`LayoutManager.resolveBounds`](../src/typescript/lib/layout/LayoutManager.ts#L278) falls back to `component.getSize()` (the *current rendered size*) when `getPreferredSize()` is null (lines 302–306, 328–332), so a null-preferred hidden child would be placed at its last rendered size, not collapsed. [`Border.getMaxSize`](../src/typescript/lib/layout/Border.ts#L626) turns a null child max into the `Number.MAX_SAFE_INTEGER` sentinel (line 639), i.e. *unbounded*, the opposite of "no space". And [`Border.doLayout`](../src/typescript/lib/layout/Border.ts#L789) **throws** `"Unable to determine preferred size for north component."` on a null north preferred (lines 789–791, and the matching south/west/east throws). So returning undefined would crash the very layout pass it is meant to collapse.

2. **A base-`Component` getter short-circuit is silently bypassed by subclass overrides that don't call `super`.** [`Image.getPreferredSize`](../src/typescript/lib/component/display/Image.ts#L65) returns `{ width: element.naturalWidth, height: element.naturalHeight }` directly with no `super` call, and its [`getMinSize`](../src/typescript/lib/component/display/Image.ts#L84) only conditionally chains `super`. So "guard it once in the base getter" is not actually one place — every such override would have to re-implement the guard. Guarding at the *consumption* site (the layout managers) is the single, override-proof choke point.

Intrinsic-size getters therefore stay semantically unchanged: a hidden component still answers "how big would I be"; the layout simply stops asking when it shouldn't place the child.

### List-based managers — a new layout-only filtered child accessor

The list-based managers enumerate `container.getComponents()` to size and place children. Add a **new layout-only accessor** on `Component`:

```typescript
getLaidOutComponents(): Component[] {
    return this._components.filter(component => component.isDisplayed());
}
```

`getComponents()` is the framework's **general** child accessor and stays untouched (see *The `getComponents()` audit* below — it has many non-layout consumers that need *all* children). Every **simple** list-based manager's **size-aggregation and placement** loops migrate to `getLaidOutComponents()`, as does [`Component.doChildrenComponentLayouts`](../src/typescript/lib/core/Component.ts#L4069). The simple list-based managers (confirmed by reading every file in `src/typescript/lib/layout/`):

| Manager | File | Iterates children for sizing/placement? | Handling |
|---|---|---|---|
| `BoxLayout` (abstract base) | [`BoxLayout.ts`](../src/typescript/lib/layout/BoxLayout.ts) | No own loops — subclasses carry them | n/a |
| `HBox` | [`HBox.ts`](../src/typescript/lib/layout/HBox.ts) | **Yes** — `getContentBaseline`, `getPreferredSize`, `getMinSize`, `computeTotalMinSize`, `doLayout` | accessor swap |
| `VBox` | [`VBox.ts`](../src/typescript/lib/layout/VBox.ts) | **Yes** — symmetric to HBox (5 sites) | accessor swap |
| `Grid` | [`Grid.ts`](../src/typescript/lib/layout/Grid.ts) | **Yes** — 6 sites (track sizing + placement) | accessor swap |
| `HFlow` | [`HFlow.ts`](../src/typescript/lib/layout/HFlow.ts) | **Yes** — 4 sites (wrap rows + placement) | accessor swap |
| `Fit` | [`Fit.ts`](../src/typescript/lib/layout/Fit.ts) | **Yes** — sizes/places `components[0]` (3 sites) — see *Fit* note | accessor swap |
| `Absolute` | [`Absolute.ts`](../src/typescript/lib/layout/Absolute.ts#L45) | **Yes** — places each child at its own X/Y (1 site) | accessor swap |
| `LayoutManager` (base) | [`LayoutManager.ts`](../src/typescript/lib/layout/LayoutManager.ts#L196) | **Yes** — `reserveContentFrame` reads each placed child's extent (1 site) — see note | accessor swap |
| `Border` | [`Border.ts`](../src/typescript/lib/layout/Border.ts) | No `getComponents()` — slot-based | per-slot guard |
| `Split` | [`Split.ts`](../src/typescript/lib/layout/Split.ts) | **Yes** — list-based sizing **plus** gutter/`_sizes`/`_collapsed` chrome | **bespoke — see *Split*** |
| `Tab` | [`Tab.ts`](../src/typescript/lib/layout/Tab.ts) | Parallel `_tabs` entry/button list + active-tab selection | **bespoke — see *Tab*** |
| `Accordion` | [`Accordion.ts`](../src/typescript/lib/layout/Accordion.ts) | **Yes** — parallel `_headers`/`_panelWrappers` per section | **bespoke — see *Accordion*** |
| `Table` (component) | [`Table.ts`](../src/typescript/lib/component/table/Table.ts) | No child layout via `getComponents()`; positions its own structural parts | **must honour `displayed` — strategy Table's choice; see *Table*** |
| `Card` | [`Card.ts`](../src/typescript/lib/layout/Card.ts#L66) | Sizes only the single visible card; `getComponents()` only in `syncVisible` | **out — see *Non-Goals*** |
| `DockRegion` | [`DockRegion.ts`](../src/typescript/lib/layout/DockRegion.ts) | No child sizing — docking-gesture controller | **out — see *Non-Goals*** |

The simple managers take a near-mechanical accessor swap. The four heavier managers each carry chrome a swap does not reach and get a dedicated subsection below. This is **not** a blanket sed: several `getComponents()` calls inside the heavier files are structural index/identity lookups that must see *all* children to keep indices and stored state stable.

### `reserveContentFrame` and `Fit` — per-file judgement (simple managers)

- **`reserveContentFrame`** ([`LayoutManager.ts:196`](../src/typescript/lib/layout/LayoutManager.ts#L196)) reads each child's *committed* `getX/getY/getWidth/getHeight` to size the scroll content frame. A hidden child wasn't placed this pass, so its stale coordinates must not stretch the frame → **migrate to `getLaidOutComponents()`**.
- **`Fit`** ([`Fit.ts:187,216,241`](../src/typescript/lib/layout/Fit.ts)) fits a single child to the container. It picks `getComponents()[0]`/iterates for size. **Migrate the size/placement reads to `getLaidOutComponents()`** so a hidden sole child contributes nothing and a hidden first-of-several is skipped — confirm the exact semantics against the file (whether Fit lays out only `[0]` or all).

The simple-manager migration's load-bearing targets are the general box/grid/flow/absolute managers (`HBox`, `VBox`, `Grid`, `HFlow`, `Absolute`, `Fit`), `reserveContentFrame`, and `doChildrenComponentLayouts` — the places where a non-displayed child genuinely steals reserved space today.

---

## Per-Manager Handling — the heavy managers

### `Split` — dual-use: structural membership vs. layout participation

`Split` ([`Split.ts`](../src/typescript/lib/layout/Split.ts)) is list-based — it iterates `container.getComponents()` in `computeMainAxisSizes` ([:942](../src/typescript/lib/layout/Split.ts#L942)), `recalculateSizes` ([:999](../src/typescript/lib/layout/Split.ts#L999)), and `doLayout` ([:669](../src/typescript/lib/layout/Split.ts#L669)) — but a plain accessor swap is **wrong** here, because Split carries per-pane chrome and per-pane state that a filtered list would corrupt:

- **Inter-pane gutters are derived from pane count.** `doLayout` computes `gutterCount = componentCount - 1` ([:699](../src/typescript/lib/layout/Split.ts#L699)) and `recalculateSizes` subtracts `gutterTotal(components.length)` ([:1030](../src/typescript/lib/layout/Split.ts#L1030)). A hidden pane must yield **both its slot and its gutter** — they truly disappear. This is **not** the existing collapse strip: a *collapsed* pane (`_collapsed` map, `COLLAPSE_STRIP_SIZE`, [:932-990](../src/typescript/lib/layout/Split.ts#L942)) leaves a clickable strip in place of its gutter; `displayed:false` ≠ collapsed and must leave nothing.
- **Per-pane state maps `_sizes` / `_collapsed` are keyed by structural membership.** The removal-cleanup in `recalculateSizes` ([:1016-1021](../src/typescript/lib/layout/Split.ts#L1016)) deletes a pane's stored size and collapsed flag the moment the pane leaves `container.getComponents()` (Split gets no removal hook, so this membership diff is its only cleanup path). **Critical trap:** if a *hidden* pane were filtered out of that membership check, its stored split size would be deleted — so on re-show it would reappear at a recomputed default, silently losing the size the user dragged.

**Decision — split the two reads.** Split must read **structural membership** (the `_sizes`/`_collapsed` cleanup diff, the map-key set, the stored-size refill in `recalculateSizes`) from the full `container.getComponents()`, while reading **layout participation** (main-axis size distribution in `computeMainAxisSizes`, pane placement and gutter count in `doLayout`) from the displayed-filtered set. Concretely: keep `getComponents()` for the cleanup loop and the `_sizes`-map bookkeeping; derive a `laidOut = components.filter(c => c.isDisplayed())` (or `getLaidOutComponents()`) for the distribution/placement/gutter-count math so a hidden pane contributes neither a slot nor a gutter. Gutter creation and the gutter↔pane index mapping (`gutterTargetPane`, the `_gutters` array) must align with the **displayed** sequence so a hidden pane in the middle does not leave a dangling gutter. This dual-use split is the central decision of the Split section; do **not** redesign the collapse machinery.

### `Tab` — gate the entry button + active-tab reselection

`Tab` ([`Tab.ts`](../src/typescript/lib/layout/Tab.ts)) gives each child a `TabEntry` whose `button` (a `ToggleButton`) is built in `buildTabEntry` ([:1735](../src/typescript/lib/layout/Tab.ts#L1735)) and held in the parallel `_tabs` array ([:515](../src/typescript/lib/layout/Tab.ts#L515)), maintained 1:1 with the children. The active tab is funnelled through `onTabPressed` ([:1468](../src/typescript/lib/layout/Tab.ts#L1468)) / `setActiveTabIndex` ([:1512](../src/typescript/lib/layout/Tab.ts#L1512)); the active content is `getComponents()[this._selectedTabIndex]` ([:1658](../src/typescript/lib/layout/Tab.ts#L1658)).

**Decision — gate at entry rendering and active selection, not via a `getComponents()` swap.** Honouring `displayed` on a tab child means:
1. **Hide that tab's button** in the strip/toolbar — the entry's `button` is suppressed (not rendered / `setDisplayed(false)` on the button) when its content child is not displayed, and the strip's layout/extent math (`tabModeExtent`, the per-entry loops at [:978-1134](../src/typescript/lib/layout/Tab.ts#L978)) skips the hidden entry so the strip reclaims its width.
2. **Skip it as content** — a hidden tab is never the rendered content.
3. **Reselect a displayed sibling when the hidden tab was active.** If the child being hidden is the current `_selectedTabIndex`, route a reselection through the existing funnel (`onTabPressed`/`setActiveTabIndex`) to the nearest displayed sibling, so the panel never shows a `display:none` content. Index stability for `_tabs`↔children is preserved (the entry stays in `_tabs`; only its button visibility and active eligibility change).

Keep this scoped: **do not redesign Tab DnD or the reorder/indicator math** — only add the displayed gate to entry/button rendering and the active-tab reselection.

### `Accordion` — per-section skip of header + wrapper + animation

`Accordion` ([`Accordion.ts`](../src/typescript/lib/layout/Accordion.ts)) holds per-section parallel arrays `_headers` ([:102](../src/typescript/lib/layout/Accordion.ts#L102)) and `_panelWrappers` ([:103](../src/typescript/lib/layout/Accordion.ts#L103)), built 1:1 with `container.getComponents()`. Section sizing sums each section's header height plus its open wrapper height in `getPreferredSize` ([:382](../src/typescript/lib/layout/Accordion.ts#L382)), `getMinSize` ([:433](../src/typescript/lib/layout/Accordion.ts#L433)), and `doLayout` ([:561](../src/typescript/lib/layout/Accordion.ts#L561)); the open/close height transition is primed in `primeWrapper` ([:776](../src/typescript/lib/layout/Accordion.ts#L776)).

**Decision — bespoke per-section skip.** A hidden section (its content child not displayed) contributes **neither its header nor its wrapper height** to the vertical stack: the size-summing loops and the `doLayout` placement pass skip index `i` when `components[i].isDisplayed()` is false, and the hidden section's header/wrapper elements are themselves hidden (`display:none`). The open/close animation in `primeWrapper` must **not run for, and must not reserve space for, a hidden section** — a hidden section is excluded from the prime/transition set so toggling never animates a section the user cannot see. The arrays stay index-aligned with the children (entries are not removed); only the per-index displayed gate is added to the summing, placement, and prime passes.

### `Table` — semantics decision first (highest uncertainty)

Two different files are named "Table": the **`Table` component** ([`src/typescript/lib/component/table/Table.ts`](../src/typescript/lib/component/table/Table.ts)) — the data grid — and the **`Table` layout manager** ([`src/typescript/lib/layout/Table.ts`](../src/typescript/lib/layout/Table.ts)) — a column-width distribution manager doing row/cell structural lookups (`parentRow.getComponents()` [:170], `header.getComponents()[1]` [:201]). **This section addresses the `Table` *component*.** The layout manager's `getComponents()` calls are pure row/cell structure and stay on `getComponents()`; touch it only if the component decision forces it.

**Requirement first — the Table component must honour `isDisplayed()`.** Like every other manager, the Table component must honour `isDisplayed()` on the children it lays out (its structural parts / whatever it positions internally): a `displayed:false` child of Table genuinely drops out of Table's own layout/positioning, exactly as it would in any other manager. Table may **not** ignore the flag, and its pre-existing visibility flags are **not a substitute** for honouring it. Table already owns explicit visibility state that overlaps — and could conflict — with the displayed-honouring path:
- Per-column hiding: `_hiddenColumns: Set<string>` ([:74](../src/typescript/lib/component/table/Table.ts#L74)), seeded by `populateHiddenColumns` from each column's `hidden:true` spec flag ([:543-560](../src/typescript/lib/component/table/Table.ts#L543)), user-toggleable via the column context menu.
- Per-part visibility: `_headerVisible` / `_bodyVisible` / `_footerVisible` ([:76-81](../src/typescript/lib/component/table/Table.ts#L76)) over the `_header` / `_body` / `_footer` parts, defaulted at [:116-118](../src/typescript/lib/component/table/Table.ts#L116) and read by `isHeaderVisible`/`isBodyVisible`/`isFooterVisible` ([:327](../src/typescript/lib/component/table/Table.ts#L327)/[:345](../src/typescript/lib/component/table/Table.ts#L345)/[:363](../src/typescript/lib/component/table/Table.ts#L363)).

**Architecture Decision — strategy is Table's choice; reconcile with, do not be replaced by, the existing flags.** *Honouring* the flag is mandatory; *how* is left to implementation. Table MAY achieve "hidden child doesn't participate" by whatever internal mechanism fits — including **routing the core `displayed` flag through** its existing `_hiddenColumns` / `_headerVisible`/`_bodyVisible`/`_footerVisible` plumbing rather than building a second parallel positioning path. The non-negotiable test stays the same: a `displayed:false` child of Table genuinely drops out of Table's own layout. Note one already-covered case for clarity: a `Table` placed as a child of some *other* manager (HBox/Border/etc.) is dropped from **that parent's** layout once this plan lands — nothing inside Table is needed for that. The work inside Table is to make Table itself honour the flag on its own laid-out children. The existing flags must be **reconciled** with the displayed-honouring path — there must be no double-hide or conflict — but they may **not** *substitute* for it. The implementer must, before editing, **confirm what Table actually lays out internally** and how a child's `displayed` should flow into that positioning (e.g. whether the header/footer parts or any Table-internal child route through `setDisplayed` today), then wire the displayed path to honour the flag while keeping it consistent with the pre-existing flags. This is the highest-uncertainty section; residual risk is flagged in *Potential Challenges*.

### Slot-based `Border` — a per-slot displayed guard

`Border` never calls `getComponents()`; it reads named slot fields (`_northComponent`, `_southComponent`, `_westComponent`, `_eastComponent`, `_centerComponent`) populated through layout constraints in [`setLayoutConstraints`](../src/typescript/lib/layout/Border.ts#L113). The `getLaidOutComponents()` accessor does not reach it. Border must instead treat a **non-displayed slot component exactly like an empty slot** (`== null`), so a hidden region contributes 0 to size and is not placed.

Add one private helper and route every slot read through it:

```typescript
private laidOut(component: Component | null): Component | null {
    return component && component.isDisplayed() ? component : null;
}
```

Then each `if (this._northComponent)` site reads through a local resolved via the helper (or, equivalently, an inline `this._northComponent?.isDisplayed()` test). Every slot-reading site to update, confirmed by reading the file end to end:

- [`getPreferredSize`](../src/typescript/lib/layout/Border.ts#L477) — the five `if (this._Xcomponent)` blocks (lines 494, 502, 510, 518, 526).
- [`getMinSize`](../src/typescript/lib/layout/Border.ts#L548) — the five blocks (lines 565, 573, 581, 589, 597).
- [`getMaxSize`](../src/typescript/lib/layout/Border.ts#L626) — the `maxOf(this._Xcomponent)` calls (lines 641–645); a hidden slot must resolve to `null` (absent → no constraint), not the `INF` sentinel.
- [`computeTotalMinSize`](../src/typescript/lib/layout/Border.ts#L689) — the five `?.getMinSize()` reads (lines 695–699).
- [`doLayout`](../src/typescript/lib/layout/Border.ts#L748) — the five `if (this._Xcomponent)` placement blocks (lines 782, 824, 861, 870, 907, 931) **and** the `updateRegionGutter`/`applyRegionClip` calls within them.

The cleanest single guard form: resolve five locals at the top of each method (`const north = this.laidOut(this._northComponent)`, etc.) and switch every `this._northComponent` reference in that method body to the local. This keeps the existing `if (north) { … }` shape one-for-one and makes "hidden = absent" uniform across all five methods without scattering `?.isDisplayed()` tests. Confirm at implementation time whether the collapse machinery (`setRegionCollapsed`, the `regions` array at line 267) should also respect the guard — a hidden collapsible region shouldn't animate; resolving its slot to null naturally excludes it.

### Keep `Border.doLayout`'s preferred-size throws

The `"Unable to determine preferred size for north component."` throw (and its south/west/east siblings) stays a valid invariant for *displayed* children: a placed region with a null preferred size is a real error. Once the slot guard resolves a hidden region to `null`, the `if (north) { … }` block is skipped entirely and the throw becomes **unreachable for hidden children** — exactly as the `window-tab-header.md` detach already achieves by nulling the slot. **Do not weaken the throw.**

### `doChildrenComponentLayouts` skips non-displayed subtrees

[`doChildrenComponentLayouts`](../src/typescript/lib/core/Component.ts#L4069) calls `doLayout()` on each direct child. Migrate it to iterate `getLaidOutComponents()` so the layout pass does not recurse into a `display:none` branch and run a hidden subtree's layout needlessly. (A hidden subtree's layout is both wasted work and a source of stale committed coordinates that `reserveContentFrame` would otherwise read.)

### Relationship to `window-tab-header.md`

[`window-tab-header.md`](window-tab-header.md) (its *Collapse the header by detaching it from NORTH* decision) detaches the `WindowHeader` from Border NORTH by hand precisely because — at that plan's write time — `setDisplayed(false)` did **not** drop NORTH to 0 (Border ignored the flag). This plan removes that gap: once Border honours `isDisplayed()`, `setHeaderCollapsed(true)` *could* be re-expressed as `this._header.setDisplayed(false)`. **Do not fold the two together and do not make either depend on the other** — they ship independently. The window-tab plan's manual detach remains correct after this change (it nulls the slot, which the guard treats identically). A future simplification of that plan to lean on `setDisplayed` is a separate decision, out of scope here; note it only as context.

---

## Public API (TypeScript Signatures)

```typescript
// src/typescript/lib/core/Component.ts
class Component<TOptions extends ComponentOptions = ComponentOptions> {
    // Reads _options.displayed ?? _defaultOptions.displayed (default true).
    // Plain boolean accessor — NOT tri-state like isVisible(). Backing option
    // `displayed` and its setter `setDisplayed` already exist; this adds the
    // missing reader. No new ComponentOptions field (per CODE_CONVENTIONS,
    // accessors need none).
    isDisplayed(): boolean;

    // Layout-only child accessor: _components filtered to the displayed ones.
    // The GENERAL child accessor getComponents() is unchanged and still returns
    // ALL children for serialization/teardown/event-delegation/etc.
    getLaidOutComponents(): Component[];
}
```

No new exported class, no `callable()` wrapping, no `ComponentOptions` change. Both are additive instance methods on the existing `Component` class.

---

## The `getComponents()` Audit (first-class step — main regression risk)

`getComponents()` is the framework's **general** child accessor, used far beyond layout: serialization, teardown/`detach`, event delegation, `render()`'s `appendChild` loop, table row/cell structure, calendar/picker enumeration, `bringToFront`, etc. — all of which need **ALL** children regardless of displayed state. The fix must therefore introduce the **new parallel accessor** and **not change what `getComponents()` returns**. Every existing call site must be classified: "wants ALL children" (leave on `getComponents()`) vs "wants laid-out only" (migrate to `getLaidOutComponents()`).

Run the audit grep and classify each hit:

```
grep -rn 'getComponents()' src/typescript/lib
```

Classification from the current tree (≈80 hits across layout + components + core):

- **MIGRATE to `getLaidOutComponents()`** (simple managers — whole-list size/placement) — size-aggregation / placement / placed-extent reads:
  - `HBox.ts` (5), `VBox.ts` (5), `Grid.ts` (6), `HFlow.ts` (4), `Absolute.ts` (1), `Fit.ts` (size/place reads — confirm per file), `LayoutManager.ts:196` (`reserveContentFrame`), `Component.ts:4070` (`doChildrenComponentLayouts`).
- **BESPOKE — dual-use, NOT a blanket swap** (heavy managers, see *Per-Manager Handling*): `Split.ts`, `Tab.ts`, `Accordion.ts` each split their `getComponents()` calls into "structural membership / index / parallel-array" (keep `getComponents()`) vs. "layout participation" (filter on `isDisplayed()`); the `Table` *component* must honour `displayed` on its laid-out parts by a strategy of its choice, reconciled with — not replaced by — its existing `_hiddenColumns`/`_*Visible` machinery. These files are **not** in the mechanical migrate list — classify each hit against the per-manager decision.
- **KEEP `getComponents()`** — needs all children (identity/index/structure/DOM/teardown):
  - `Component.ts:3948` (the accessor itself), `Component.ts:4253` (`render()` appendChild — must mount hidden children too, `display:none` is applied to the mounted element).
  - `Card.ts` (`syncVisible` needs all children to hide non-visible ones), `DockRegion.ts` (all — structural insert-index arithmetic), `layout/Table.ts` (row/cell structure) — index/identity/structure.
  - `LayoutSerialization.ts` (serialization needs every child), `Window.ts:1609`, every `component/table/*` (Row/Header/Footer/Body/Table/Cell — row/cell structure), `component/input/*` (PickerColumn, AbstractCalendarDropdown — cell enumeration).

The deliverable of this step is a per-line decision; the table above is the starting classification, but the implementer **must re-run the grep** (line numbers drift) and confirm each hit, because mis-migrating an identity/index lookup (e.g. a Split gutter's neighbouring pane, or the Split `_sizes` cleanup diff) is the principal regression. This audit is the **bulk of the foundation work**, not a footnote, and it gates both the simple-manager and heavy-manager steps.

---

## Ordered Implementation Steps

1. **`Component.isDisplayed()`** — add the accessor near [`setDisplayed`](../src/typescript/lib/core/Component.ts#L1268)/[`isVisible`](../src/typescript/lib/core/Component.ts#L1194), returning `this._options.displayed ?? this._defaultOptions.displayed`. → verify: `tsc` clean; `grep -rn 'isDisplayed' src/typescript/lib` now shows the definition.

2. **`Component.getLaidOutComponents()`** — add next to [`getComponents`](../src/typescript/lib/core/Component.ts#L3947): `return this._components.filter(c => c.isDisplayed());`. Do **not** touch `getComponents()`. → verify: `tsc` clean.

3. **Run the `getComponents()` audit** (`grep -rn 'getComponents()' src/typescript/lib`) and produce the per-line keep/migrate classification (see *The `getComponents()` Audit*). This gates steps 4–7.

4. **Migrate `doChildrenComponentLayouts`** ([`Component.ts:4070`](../src/typescript/lib/core/Component.ts#L4069)) to iterate `getLaidOutComponents()`. → verify: a hidden child's `doLayout` is not invoked (set a hidden child, confirm its subtree isn't re-laid).

5. **Migrate list-based managers' size/placement loops** to `getLaidOutComponents()`: `HBox.ts`, `VBox.ts`, `Grid.ts`, `HFlow.ts`, `Absolute.ts`, `Fit.ts`, and `LayoutManager.reserveContentFrame` ([`:196`](../src/typescript/lib/layout/LayoutManager.ts#L196)). For each file, change only the size-aggregation/placement reads identified in step 3 — leave any index/identity reads on `getComponents()`. → verify: `tsc` clean; hiding a box child reflows siblings (smoke test below).

6. **Add the `Border` per-slot guard** — introduce `private laidOut(component)` and resolve five locals at the top of [`getPreferredSize`](../src/typescript/lib/layout/Border.ts#L477), [`getMinSize`](../src/typescript/lib/layout/Border.ts#L548), [`getMaxSize`](../src/typescript/lib/layout/Border.ts#L626), [`computeTotalMinSize`](../src/typescript/lib/layout/Border.ts#L689), and [`doLayout`](../src/typescript/lib/layout/Border.ts#L748); switch every `this._Xcomponent` reference in those bodies to the resolved local. Confirm the collapse machinery (`setRegionCollapsed`, the `regions` array) excludes hidden slots. **Leave the preferred-size throws intact** — they become unreachable for hidden slots. → verify: a hidden Border region reserves 0 px (adjacent region/center grows to fill); re-showing reflows back; `tsc` clean.

   *(Steps 1–6 are the foundation every heavy manager builds on: the accessors, the audit, the simple-manager swap, the recursion skip, and the slot-guard precedent. The heavy managers follow.)*

7. **`Split` — dual-use split** ([`Split.ts`](../src/typescript/lib/layout/Split.ts), per *Per-Manager Handling*). Keep `getComponents()` for the `_sizes`/`_collapsed` cleanup diff and map-key bookkeeping in `recalculateSizes` ([:1016](../src/typescript/lib/layout/Split.ts#L1016)); derive an `isDisplayed()`-filtered list for the main-axis distribution (`computeMainAxisSizes` [:942](../src/typescript/lib/layout/Split.ts#L942)), pane placement and gutter count (`doLayout` [:669](../src/typescript/lib/layout/Split.ts#L669)). → verify: hide a middle pane — its slot **and** its gutter vanish, the remaining panes reflow; re-show — the hidden pane returns at the **same dragged size** (the `_sizes` entry survived); `tsc` clean.

8. **`Tab` — entry-button gate + active reselection** ([`Tab.ts`](../src/typescript/lib/layout/Tab.ts), per *Per-Manager Handling*). Suppress the hidden child's `TabEntry.button` in the strip and its extent math; if the hidden child is the active tab, reselect the nearest displayed sibling through `onTabPressed`/`setActiveTabIndex` ([:1468](../src/typescript/lib/layout/Tab.ts#L1468)/[:1512](../src/typescript/lib/layout/Tab.ts#L1512)). Do **not** touch DnD/reorder math. → verify: hide a non-active tab — its button disappears, the strip reclaims the width, the active content is unchanged; hide the active tab — a displayed sibling becomes active and is shown; `tsc` clean.

9. **`Accordion` — per-section skip** ([`Accordion.ts`](../src/typescript/lib/layout/Accordion.ts), per *Per-Manager Handling*). Gate each index `i` on `components[i].isDisplayed()` in the size-summing loops (`getPreferredSize` [:382](../src/typescript/lib/layout/Accordion.ts#L382), `getMinSize` [:433](../src/typescript/lib/layout/Accordion.ts#L433)) and `doLayout` ([:561](../src/typescript/lib/layout/Accordion.ts#L561)); hide the section's `_headers[i]`/`_panelWrappers[i]` and exclude it from `primeWrapper`'s prime/transition set ([:776](../src/typescript/lib/layout/Accordion.ts#L776)). → verify: hide a section — its header **and** its wrapper height leave the stack (sections below slide up, no reserved gap, no animation for the hidden one); re-show restores it; `tsc` clean.

10. **`Table` — honour `isDisplayed()` on its laid-out children** ([component `Table.ts`](../src/typescript/lib/component/table/Table.ts), per *Per-Manager Handling*). The goal: Table honours `isDisplayed()` on the children it positions internally, by a strategy of Table's own choice (e.g. routing the core `displayed` flag through its existing visibility plumbing). First confirm what Table actually lays out internally and how a child's `displayed` should flow into that positioning; then wire the displayed-honouring path and **reconcile** it with the existing `_hiddenColumns` / `_headerVisible`/`_bodyVisible`/`_footerVisible` machinery so there is no double-hide or conflict — reconcile, do **not** let those flags substitute for honouring the flag, and do **not** build a second parallel positioning path. Leave `layout/Table.ts`'s row/cell `getComponents()` untouched. → verify: a `displayed:false` child of Table drops out of Table's own layout; a Table placed in a box also drops out of its parent's layout when `setDisplayed(false)` (covered by the simple-manager step); no double-hide regression against the existing hidden-column/part flags; `tsc` clean.

11. **Regression checkpoints** — `grep -rn 'isDisplayed' src/typescript/lib` shows the consult sites in `Component`, the simple managers, `Border`, and the heavy managers (`Split`, `Tab`, `Accordion`, and the Table wiring point); `grep -rn 'getComponents()' src/typescript/lib` audit signed off (every remaining hit is a deliberate "wants all children" — including Card's `syncVisible`, DockRegion's insert indices, and Split's `_sizes` cleanup diff). → verify below.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | src/typescript/lib/core/Component.ts |
| Modify | src/typescript/lib/layout/LayoutManager.ts |
| Modify | src/typescript/lib/layout/Border.ts |
| Modify | src/typescript/lib/layout/HBox.ts |
| Modify | src/typescript/lib/layout/VBox.ts |
| Modify | src/typescript/lib/layout/Grid.ts |
| Modify | src/typescript/lib/layout/HFlow.ts |
| Modify | src/typescript/lib/layout/Absolute.ts |
| Modify | src/typescript/lib/layout/Fit.ts |
| Modify | src/typescript/lib/layout/Split.ts |
| Modify | src/typescript/lib/layout/Tab.ts |
| Modify | src/typescript/lib/layout/Accordion.ts |
| Modify | src/typescript/lib/component/table/Table.ts |

(`Card.ts` and `DockRegion.ts` are intentionally **not** modified — out of scope per *Non-Goals*. The `layout/Table.ts` column-width manager is **not** modified — it is row/cell structure, not child-participation. The `component/table/Table.ts` component **is** modified: it must honour `isDisplayed()` on its laid-out children, by a strategy of its choice reconciled with the existing visibility flags. Re-confirm the exact touch points against the step-3 audit before finalising, but the component row stays.)

---

## Verification

- **Typecheck**: `tsc -p tsconfig.lib.json --noEmit` → 0 errors.
- **Grep invariants**:
  - `grep -rn 'isDisplayed' src/typescript/lib` — was empty before; now shows the accessor definition, `getLaidOutComponents`, the simple managers, the `Border` slot guard, and the heavy managers (`Split` distribution/placement, `Tab` entry gate + active reselection, `Accordion` per-section gate, and the `Table` wiring point).
  - `grep -rn 'getComponents()' src/typescript/lib` — audit complete: every remaining hit is a confirmed "wants ALL children" site (the accessor, `render()`, serialization, Card `syncVisible`, DockRegion insert indices, `layout/Table.ts` row/cell structure, and Split's `_sizes`/`_collapsed` cleanup diff + map-key bookkeeping).
- **Runtime smoke test** — no demo currently calls `setDisplayed`, so add a temporary toggle (or drive it from the console, scoping the component query to the panel class per the project's "scope DevTools queries by component class" rule) on each concrete demo screen and revert after. For every manager, `setDisplayed(false)` must reclaim the right space/chrome and `setDisplayed(true)` must restore it:
  - **VBox / HBox** — [`VBoxPanel`](../src/typescript/VBoxPanel.ts) / [`HBoxPanel`](../src/typescript/HBoxPanel.ts): hide one child row/cell → siblings reflow and reclaim the freed main-axis space; re-show reflows back.
  - **Grid** — [`GridPanel`](../src/typescript/GridPanel.ts): hide one cell → its track collapses / siblings reflow; re-show restores.
  - **HFlow** — [`HFlowPanel`](../src/typescript/HFlowPanel.ts): hide one child → wrap rows recompute; re-show restores.
  - **Border** — [`BorderPanel`](../src/typescript/BorderPanel.ts): hide the WEST (or NORTH) region's component → center grows to reclaim the region's space (0 px reserved, no `Border.doLayout` throw); re-show restores.
  - **Split** — [`SplitPanel`](../src/typescript/SplitPanel.ts): drag a pane to a non-default size, then hide a middle pane → its slot **and** its gutter vanish (no leftover strip), neighbours reflow; re-show → the pane returns at the **same dragged size** (its `_sizes` entry survived).
  - **Tab** — [`TabDemoPanel`](../src/typescript/TabDemoPanel.ts): hide a non-active tab's content child → its tab button disappears and the strip reclaims the width; hide the active tab → a displayed sibling becomes active and its content shows; re-show restores the button.
  - **Accordion** — [`AccordionDemoPanel`](../src/typescript/AccordionDemoPanel.ts): hide a section's content child → its header **and** wrapper height leave the stack (sections below slide up, no reserved gap, no animation for the hidden one); re-show restores.
  - **Table** — [`MiscPanel`](../src/typescript/MiscPanel.ts) (hosts a `Table`): `setDisplayed(false)` on a child the Table lays out → that child genuinely drops out of Table's own layout/positioning (the chosen in-Table strategy reconciles with the existing hidden-column/part flags, no double-hide); also place/observe the Table as a child of a layout container and `setDisplayed(false)` on it → the whole Table drops out of its parent's layout; re-show restores both.
- `npm run docs:build` → 0 errors, 0 new link warnings (the typedoc "unsupported TypeScript version" notice is the lone acceptable warning) — the two new accessors carry JSDoc.

---

## Documentation Impact

`isDisplayed()` and `getLaidOutComponents()` are new public members of `Component`, exported via the core barrel [`src/typescript/lib/core/index.ts`](../src/typescript/lib/core/index.ts); they appear on the generated `Component` API page automatically from their JSDoc. No new exported symbol, page, catalog `index.md`, or sidebar entry is required. If the curated `Component` / layout overview docs describe how `setDisplayed` interacts with layout, add a one-line note that a non-displayed component now drops out of its parent's layout (siblings reflow). No cross-bucket `{@link}` is introduced. Both methods must be documented with JSDoc per the conventions.

---

## Potential Challenges

- **Mis-migrating an index/identity `getComponents()` call** (a chief risk) — e.g. a Split gutter's neighbouring-pane lookup or a Tab content-by-index — would desync indices when a sibling is hidden. Mitigation: the step-3 audit classifies every hit individually; the heavy managers split membership/index reads (kept on `getComponents()`) from participation reads.
- **Split membership-vs-participation dual-use (lost split size trap)** — if a hidden pane is filtered out of the `recalculateSizes` `_sizes`/`_collapsed` cleanup diff ([:1016](../src/typescript/lib/layout/Split.ts#L1016)), its stored dragged size is deleted and the pane reappears at a recomputed default on re-show. Mitigation: keep the cleanup and map-key bookkeeping on the full `getComponents()`; filter only the distribution/placement/gutter-count math (step 7) — and the re-show-keeps-size smoke test guards it.
- **Tab active-tab reselection when the active tab is hidden** — hiding the active tab would otherwise leave the panel showing a `display:none` content or no content. Mitigation: route reselection of the nearest displayed sibling through the existing `onTabPressed`/`setActiveTabIndex` funnel (step 8); the hide-active-tab smoke test guards it.
- **Accordion animation suppression for hidden sections** — `primeWrapper`'s open/close transition must not run for or reserve space for a hidden section, or a toggle elsewhere could animate/space a section the user can't see. Mitigation: exclude hidden sections from the prime/transition set and the size-summing passes (step 9).
- **Table overlap risk (highest uncertainty)** — Table must honour `displayed` on its laid-out children AND reconcile that with its pre-existing `_hiddenColumns` and `_headerVisible`/`_bodyVisible`/`_footerVisible` flags; a naïve honouring path could double-hide or fight those flags, and the existing flags must not be treated as a substitute for honouring the flag. Mitigation: the *Per-Manager Handling* Table decision requires honouring `isDisplayed()` by a strategy of Table's choice (which may route the flag through the existing plumbing) while reconciling — not substituting — with those flags; residual risk is that an internal child relies on `setDisplayed` in a way the implementer must surface (by confirming what Table lays out internally) before editing.
- **`reserveContentFrame` reading stale coordinates** of a just-hidden child — mitigation: migrating it to `getLaidOutComponents()` (step 5) means hidden children's stale `getX/getY` never stretch the content frame.
- **Border collapse machinery vs. hidden slot** — a hidden *collapsible* region shouldn't animate; mitigation: resolving its slot to `null` via the guard excludes it from the `regions`/participant set; confirm `setRegionCollapsed` early-returns on a null-resolved slot.
- **`getMaxSize` sentinel inversion** — a null child max becomes `INF` (unbounded), so the Border `getMaxSize` guard must resolve a hidden slot to `null` (absent → *no* constraint), which it already does via the local; double-check the `maxOf(null)` path returns `null`, not `INF`.

---

## Critical Files

- [`src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts) — [`setDisplayed`](../src/typescript/lib/core/Component.ts#L1268), [`isVisible`](../src/typescript/lib/core/Component.ts#L1194) (boolean-accessor precedent), the `_defaultOptions.displayed: true` default ([:346](../src/typescript/lib/core/Component.ts#L346)), [`getComponents`](../src/typescript/lib/core/Component.ts#L3947), [`doChildrenComponentLayouts`](../src/typescript/lib/core/Component.ts#L4069), `render()`'s appendChild loop ([:4253](../src/typescript/lib/core/Component.ts)).
- [`src/typescript/lib/layout/LayoutManager.ts`](../src/typescript/lib/layout/LayoutManager.ts) — [`resolveBounds`](../src/typescript/lib/layout/LayoutManager.ts#L278) (the null-preferred → `getSize()` fallback that defeats a getter short-circuit), base [`getMinSize`/`getMaxSize`](../src/typescript/lib/layout/LayoutManager.ts#L103), [`reserveContentFrame`](../src/typescript/lib/layout/LayoutManager.ts#L189).
- [`src/typescript/lib/layout/Border.ts`](../src/typescript/lib/layout/Border.ts) — slot fields ([L54](../src/typescript/lib/layout/Border.ts#L54)), [`getPreferredSize`](../src/typescript/lib/layout/Border.ts#L477), [`getMinSize`](../src/typescript/lib/layout/Border.ts#L548), [`getMaxSize`](../src/typescript/lib/layout/Border.ts#L626), [`computeTotalMinSize`](../src/typescript/lib/layout/Border.ts#L689), [`doLayout`](../src/typescript/lib/layout/Border.ts#L748) (the preferred-size throws), [`delLayoutConstraints`](../src/typescript/lib/layout/Border.ts#L162) (how a region is nulled today).
- [`src/typescript/lib/layout/HBox.ts`](../src/typescript/lib/layout/HBox.ts) / [`VBox.ts`](../src/typescript/lib/layout/VBox.ts) — the canonical list-based size/placement loops to migrate (the simple-manager pattern).
- [`src/typescript/lib/layout/Split.ts`](../src/typescript/lib/layout/Split.ts) — `computeMainAxisSizes` ([:942](../src/typescript/lib/layout/Split.ts#L942)), `recalculateSizes` (the `_sizes`/`_collapsed` cleanup diff [:1016](../src/typescript/lib/layout/Split.ts#L1016)), `doLayout` ([:669](../src/typescript/lib/layout/Split.ts#L669)), `gutterTotal` ([:595](../src/typescript/lib/layout/Split.ts#L595)) — the membership-vs-participation split.
- [`src/typescript/lib/layout/Tab.ts`](../src/typescript/lib/layout/Tab.ts) — `_tabs` ([:515](../src/typescript/lib/layout/Tab.ts#L515)), `buildTabEntry` ([:1735](../src/typescript/lib/layout/Tab.ts#L1735)), `onTabPressed`/`setActiveTabIndex` ([:1468](../src/typescript/lib/layout/Tab.ts#L1468)/[:1512](../src/typescript/lib/layout/Tab.ts#L1512)), the active-content read ([:1658](../src/typescript/lib/layout/Tab.ts#L1658)).
- [`src/typescript/lib/layout/Accordion.ts`](../src/typescript/lib/layout/Accordion.ts) — `_headers`/`_panelWrappers` ([:102](../src/typescript/lib/layout/Accordion.ts#L102)), the size-summing loops ([:382](../src/typescript/lib/layout/Accordion.ts#L382)/[:433](../src/typescript/lib/layout/Accordion.ts#L433)), `doLayout` ([:561](../src/typescript/lib/layout/Accordion.ts#L561)), `primeWrapper` ([:776](../src/typescript/lib/layout/Accordion.ts#L776)).
- [`src/typescript/lib/component/table/Table.ts`](../src/typescript/lib/component/table/Table.ts) — `_hiddenColumns` ([:74](../src/typescript/lib/component/table/Table.ts#L74)), `_headerVisible`/`_bodyVisible`/`_footerVisible` ([:76-81](../src/typescript/lib/component/table/Table.ts#L76)), `populateHiddenColumns` ([:543](../src/typescript/lib/component/table/Table.ts#L543)) — the existing visibility flags `displayed` must reconcile with, **not** the `layout/Table.ts` column-width manager.
- [`src/typescript/lib/layout/Card.ts`](../src/typescript/lib/layout/Card.ts) — `getVisibleComponent`-only sizing ([:66-164](../src/typescript/lib/layout/Card.ts#L66)) and `syncVisible` ([:207](../src/typescript/lib/layout/Card.ts#L207)), the evidence Card needs no change.
- [`src/typescript/lib/component/display/Image.ts`](../src/typescript/lib/component/display/Image.ts) — [`getPreferredSize`](../src/typescript/lib/component/display/Image.ts#L65)/[`getMinSize`](../src/typescript/lib/component/display/Image.ts#L84) overrides that bypass `super`, evidence for rejecting the getter-short-circuit approach.
- [`plans/window-tab-header.md`](window-tab-header.md) — the manual NORTH detach this generalises.

---

## Non-Goals

- **`Card`** — `Card` never sums siblings: `getPreferredSize`/`getMinSize`/`getMaxSize` ([`Card.ts:66-164`](../src/typescript/lib/layout/Card.ts#L66)) each read only `getVisibleComponent()` (the single selected child), so a hidden sibling already reserves no space — there is no "reserve space for hidden siblings" bug to fix. Its only `getComponents()` use is in `syncVisible` ([:207](../src/typescript/lib/layout/Card.ts#L207)), which needs **all** children precisely so it can hide the non-visible ones. "Visible card" is Card's own selection axis, orthogonal to `displayed`. No change; keep on `getComponents()`.
- **`DockRegion`** — not a sizing/placement layout manager at all: it has no `doLayout`/`getMinSize` over children. It is a docking-gesture controller that restructures Split/Tab trees, and its `getComponents()` calls are structural insertion indices (`.indexOf(unit)`, `.getComponents().length` for an insert position — e.g. [:184](../src/typescript/lib/layout/DockRegion.ts#L184), [:202](../src/typescript/lib/layout/DockRegion.ts#L202), [:370](../src/typescript/lib/layout/DockRegion.ts#L370)). No layout-participation concern. No change.
- **The `layout/Table.ts` column-width manager** — distinct from the `Table` component this plan touches; its `getComponents()` calls are pure row/cell structure ([:170](../src/typescript/lib/layout/Table.ts#L170), [:201](../src/typescript/lib/layout/Table.ts#L201)) and are left untouched.
- **Redesigning Tab DnD / Split collapse / Accordion section-state machinery** — the heavy-manager sections add only the `displayed` gate; the existing reorder, gutter-collapse, and open/close-state mechanisms are unchanged.
- **Changing `getComponents()` semantics** — explicitly preserved; all displayed-filtering goes through the new `getLaidOutComponents()` (or, for the heavy managers, an inline `isDisplayed()` filter applied only to participation reads).
- **Changing the intrinsic-size getters** — `getPreferredSize`/`getMinSize`/`getMaxSize` keep reporting a hidden component's real intrinsic size; only *participation* changes.
- **Folding in `window-tab-header.md`** — that plan's manual header detach stays; re-expressing it via `setDisplayed` is a separate, later decision.
