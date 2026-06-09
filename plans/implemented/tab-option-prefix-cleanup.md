# Tab Option-Prefix Cleanup — Implementation Plan

## Overview

Drop the redundant `tab` prefix from the [`Tab`](../src/typescript/lib/layout/Tab.ts) layout manager's **own** option fields, setter/getter methods, and private backing fields — the class is already named `Tab`, so `tabSide`/`setTabSide`/`_tabSide` are redundant on its own surface. Replace [`TabPanel`](../src/typescript/lib/component/container/TabPanel.ts)'s eleven flattened `tab*`/`compact`/`reorderable` construction options with a single nested `tabOptions?: TabOptions` bag passed straight to the manager's constructor, while keeping (and fully prefixing) every runtime forwarder so they disambiguate on a `Panel` reference.

The renamed manager surface has exactly two real external call sites — `TabPanel`'s forwarders and the `TabDemoPanel` demo — plus the manager's own `applyOptions` self-dispatch. No sibling work (Border layout, the dock/detach tab plans) calls these methods; those plans are unimplemented markdown only. Exported **type** names (`TabSide`, `TabAlign`, `TabOrientation`, `TabWidthMode`, `TabOptions`, `TabEvent`) stay prefixed — they live in the flat layout barrel [`src/typescript/lib/layout/index.ts:15`](../src/typescript/lib/layout/index.ts#L15) where bare `Side`/`Align` would collide.

This lands on the existing `feature/tab-layout-extensions` branch (3 consolidated commits, **not pushed, not merged**). Implementation follows the project's commit-bucket structure: one code commit, one docs commit, one bookkeeping commit.

---

## Architecture Decisions

### Manager surface loses the prefix; types keep it

Per the converged design (decided — not re-litigated here): on `Tab` itself, every option field, setter, getter, `is*` predicate, and private backing field that carries `tab` drops it. The six exported type aliases keep `Tab` because they're re-exported from the flat layout barrel and bare names would collide or be too generic. This split is the whole point of the refactor.

### `TabPanel` construction via nested `tabOptions`, runtime via prefixed forwarders

`TabPanelOptions` drops its eleven flattened pass-through fields and gains one `tabOptions?: TabOptions`. The constructor replaces eleven `if (options?.tabX !== undefined) this.setTabX(...)` blocks with a single `this.setLayoutManager(new Tab(options?.tabOptions))`. This is sound because `Tab`'s constructor calls `applyOptions`, which dispatches **every** one of these options (`widthMode`, `maxWidth`, `fixedWidth`, `underBorderFullWidth`, `side`, `align`, `orientation`, `scrollable`, `compact`, `reorderable`, `tools`) — verified against [`Tab.ts:588-640`](../src/typescript/lib/layout/Tab.ts#L588), so the pass-through is complete. Precedent for a nested manager-options bag exists: `AjaxStore`'s `proxy: AjaxProxyOptions` ([`AjaxStore.ts:13`](../src/typescript/lib/data/AjaxStore.ts#L13)) and `DragManager`'s `options: DropTargetOptions` / `sourceOptions: DragSourceOptions` ([`DragManager.ts:89,94`](../src/typescript/lib/core/DragManager.ts#L89)).

Runtime forwarders all stay **prefixed** on `TabPanel` (the prefix disambiguates `tabPanel.setSide` from a future `Panel.setSide`). The four currently-unprefixed forwarders gain the prefix: `setCompact`→`setTabCompact`, `isCompact`→`isTabCompact`, `setReorderable`→`setTabReorderable`, `isReorderable`→`isTabReorderable`. The already-prefixed forwarders keep their `TabPanel` names but their **bodies** now call the manager's renamed methods.

### `_underBorderFullWidth` / `_underBorderFromTheme` already unprefixed — left alone

The rename map in the brief said to verify backing-field names. Confirmed: only `_tabWidthMode`, `_tabMaxWidth`, `_tabFixedWidth`, `_tabSide`, `_tabAlign`, `_tabOrientation`, `_tabScrollable`, `_tabTools` carry the prefix. `_underBorderFullWidth` and `_underBorderFromTheme` are **already** unprefixed ([`Tab.ts:459-460`](../src/typescript/lib/layout/Tab.ts#L459)) and must not be touched. `_compact` and `_reorderable` are already unprefixed too.

### `ToolBar.setCompact` is a false-positive caller

A `grep` for `setCompact`/`isCompact` hits [`ToolBar.ts:151,218,245`](../src/typescript/lib/component/menubar/ToolBar.ts#L218), but those are `ToolBar`'s **own** independent `setCompact`/`isCompact` methods and its own `opts.compact` dispatch — nothing to do with `Tab`. `ToolBar` does not touch the `Tab` manager. Do **not** edit `ToolBar.ts`.

---

## Public API (TypeScript Signatures)

### `Tab` (`src/typescript/lib/layout/Tab.ts`) — renamed surface

```typescript
export interface TabOptions extends LayoutManagerOptions {
    listeners?: { tabclose?: (component: Component) => void };
    widthMode?: TabWidthMode;            // was tabWidthMode
    maxWidth?: number | null;            // was tabMaxWidth
    fixedWidth?: number;                 // was tabFixedWidth
    underBorderFullWidth?: boolean;      // was tabUnderBorderFullWidth
    side?: TabSide;                      // was tabSide
    align?: TabAlign;                    // was tabAlign
    orientation?: TabOrientation;        // was tabOrientation
    scrollable?: boolean;                // was tabScrollable
    tools?: Component[];                 // was tabTools
    compact?: boolean;                   // unchanged
    reorderable?: boolean;               // unchanged
}

// Methods (return `this` / value as before):
setWidthMode(mode: TabWidthMode): this;              getWidthMode(): TabWidthMode;
setMaxWidth(px: number | null): this;                getMaxWidth(): number | null;
setFixedWidth(px: number): this;                     getFixedWidth(): number;
setUnderBorderFullWidth(full: boolean): this;        isUnderBorderFullWidth(): boolean;
setSide(side: TabSide): this;                        getSide(): TabSide;
setAlign(align: TabAlign): this;                     getAlign(): TabAlign;
setOrientation(o: TabOrientation): this;             getOrientation(): TabOrientation;
setScrollable(value: boolean): this;                 isScrollable(): boolean;
addTool(button: Component): this;                    removeTool(button: Component): this;
setCompact(value: boolean): this;                    isCompact(): boolean;        // unchanged
setReorderable(value: boolean): this;                isReorderable(): boolean;    // unchanged
```

Private backing fields renamed: `_tabWidthMode`→`_widthMode`, `_tabMaxWidth`→`_maxWidth`, `_tabFixedWidth`→`_fixedWidth`, `_tabSide`→`_side`, `_tabAlign`→`_align`, `_tabOrientation`→`_orientation`, `_tabScrollable`→`_scrollable`, `_tabTools`→`_tools`. (`_underBorderFullWidth`, `_underBorderFromTheme`, `_compact`, `_reorderable` unchanged.)

### `TabPanel` (`src/typescript/lib/component/container/TabPanel.ts`) — construction + forwarders

```typescript
export interface TabPanelOptions extends PanelOptions {
    tabs?:       TabEntryConfig[];                       // kept
    onTabClose?: (component: Component) => void;          // kept
    tabOptions?: TabOptions;                              // NEW — replaces the 11 flattened fields
}

// Runtime forwarders — ALL prefixed. Names unchanged except the four below:
setTabCompact(value: boolean): this;     isTabCompact(): boolean;       // were setCompact / isCompact
setTabReorderable(value: boolean): this; isTabReorderable(): boolean;   // were setReorderable / isReorderable
// Unchanged TabPanel names (bodies retargeted to renamed manager methods):
setTabWidthMode / getTabWidthMode / setTabMaxWidth / getTabMaxWidth /
setTabFixedWidth / getTabFixedWidth / setTabUnderBorderFullWidth / isTabUnderBorderFullWidth /
setTabSide / getTabSide / setTabAlign / getTabAlign / setTabOrientation / getTabOrientation /
setTabScrollable / isTabScrollable / addTabTool / removeTabTool
```

Import line adds `TabOptions`: `import { Tab, TabEvent, TabWidthMode, TabSide, TabAlign, TabOrientation, TabOptions } from "~/layout/Tab.js";`

---

## Ordered Implementation Steps

**Bucket 1 — code (one commit, one functionality).**

1. **`src/typescript/lib/layout/Tab.ts` — option fields.** In `TabOptions` rename the nine fields per the map above (`tabWidthMode`→`widthMode` … `tabTools`→`tools`); leave `compact`/`reorderable`/`listeners` alone.

2. **`Tab.ts` — private backing fields.** Rename the eight prefixed fields at the declarations ([`Tab.ts:456-475`](../src/typescript/lib/layout/Tab.ts#L456)) and at every internal read/write. Expected raw occurrence counts to update (grep-verified): `_tabWidthMode` 9, `_tabMaxWidth` 6, `_tabFixedWidth` 5, `_tabSide` 10, `_tabAlign` 7, `_tabOrientation` 8, `_tabScrollable` 11, `_tabTools` 8. Do **not** touch `_underBorderFullWidth` (7), `_underBorderFromTheme`, `_compact` (10), `_reorderable` (8).

3. **`Tab.ts` — methods.** Rename the setters/getters/predicates: `setTabWidthMode`→`setWidthMode`, `getTabWidthMode`→`getWidthMode`, `setTabMaxWidth`→`setMaxWidth`, `getTabMaxWidth`→`getMaxWidth`, `setTabFixedWidth`→`setFixedWidth`, `getTabFixedWidth`→`getFixedWidth`, `setTabUnderBorderFullWidth`→`setUnderBorderFullWidth`, `isTabUnderBorderFullWidth`→`isUnderBorderFullWidth`, `setTabSide`→`setSide`, `getTabSide`→`getSide`, `setTabAlign`→`setAlign`, `getTabAlign`→`getAlign`, `setTabOrientation`→`setOrientation`, `getTabOrientation`→`getOrientation`, `setTabScrollable`→`setScrollable`, `isTabScrollable`→`isScrollable`, `addTabTool`→`addTool`, `removeTabTool`→`removeTool`. Leave `setCompact`/`isCompact`/`setReorderable`/`isReorderable` unchanged.

4. **`Tab.ts` — `applyOptions` dispatch ([`Tab.ts:588-640`](../src/typescript/lib/layout/Tab.ts#L588)).** Update both the option reads and the method calls: `options.tabWidthMode`→`options.widthMode` + `this.setWidthMode(...)`, … `options.tabTools`→`options.tools` + `this.addTool(tool)`. Keep the `listeners.tabclose`, `compact`, `reorderable` branches as-is.

5. **`Tab.ts` — JSDoc.** Update `@param`/prose references that name the renamed options (e.g. the `TabWidthMode` doc comment mentions `tabMaxWidth`/`tabFixedWidth`; `applyTabWidths`/`stripThickness`/`tabModeExtent` comments mention `tabScrollable`/`tabMaxWidth`/`tabFixedWidth`). These are comments only — retarget the bare names, leave the `{@link Tab}`/type links alone.

6. **`src/typescript/lib/component/container/TabPanel.ts` — options + constructor.** Add `TabOptions` to the import ([`TabPanel.ts:6`](../src/typescript/lib/component/container/TabPanel.ts#L6)). In `TabPanelOptions` ([`TabPanel.ts:28-58`](../src/typescript/lib/component/container/TabPanel.ts#L28)) delete the eleven `tab*`/`compact`/`reorderable` fields and add `tabOptions?: TabOptions;`; keep `tabs` and `onTabClose`. In the constructor ([`TabPanel.ts:91-154`](../src/typescript/lib/component/container/TabPanel.ts#L91)) replace `this.setLayoutManager(new Tab());` **and** the eleven following `if (options?.tabX …)` blocks with a single `this.setLayoutManager(new Tab(options?.tabOptions));`. Keep the `tabs` loop and the `onTabClose` `on("tabclose", …)` wiring unchanged.

7. **`TabPanel.ts` — forwarder bodies + four renames.** Retarget every forwarder body to the renamed manager method: `setTabMaxWidth` body→`setMaxWidth`, `getTabMaxWidth`→`getMaxWidth`, `setTabWidthMode`→`setWidthMode`, `getTabWidthMode`→`getWidthMode`, `setTabFixedWidth`→`setFixedWidth`, `getTabFixedWidth`→`getFixedWidth`, `setTabUnderBorderFullWidth`→`setUnderBorderFullWidth`, `isTabUnderBorderFullWidth`→`isUnderBorderFullWidth`, `setTabSide`→`setSide`, `getTabSide`→`getSide`, `setTabAlign`→`setAlign`, `getTabAlign`→`getAlign`, `setTabOrientation`→`setOrientation`, `getTabOrientation`→`getOrientation`, `setTabScrollable`→`setScrollable`, `isTabScrollable`→`isScrollable`, `addTabTool`→`addTool`, `removeTabTool`→`removeTool`. Then rename the four TabPanel methods themselves: `setCompact`→`setTabCompact`, `isCompact`→`isTabCompact`, `setReorderable`→`setTabReorderable`, `isReorderable`→`isTabReorderable` (their bodies still call the manager's unchanged `setCompact`/`isCompact`/`setReorderable`/`isReorderable`). Keep `getTabManager`.

8. **`src/typescript/TabDemoPanel.ts` — construction.** In the `new TabPanel({...})` call ([`TabDemoPanel.ts:112-127`](../src/typescript/TabDemoPanel.ts#L112)), move `tabWidthMode: "equal"`, `tabMaxWidth: 160`, `tabFixedWidth: 120`, `reorderable: true`, `tabTools: [addToolBtn]` into a nested `tabOptions: { widthMode: "equal", maxWidth: 160, fixedWidth: 120, reorderable: true, tools: [addToolBtn] }`. Keep `preferredSize`, `tabs`, `onTabClose` at the top level.

9. **`TabDemoPanel.ts` — runtime calls.** The prefixed forwarders stay: `setTabSide`, `setTabAlign`, `setTabOrientation`, `setTabScrollable`/`isTabScrollable`, `setTabWidthMode`, `setTabMaxWidth`, `setTabFixedWidth`, `setTabUnderBorderFullWidth`/`isTabUnderBorderFullWidth` are unchanged (lines 133-197). Rename only the four that gained a prefix: `setCompact`→`setTabCompact` and `isCompact`→`isTabCompact` ([`TabDemoPanel.ts:149`](../src/typescript/TabDemoPanel.ts#L149)), `setReorderable`→`setTabReorderable` and `isReorderable`→`isTabReorderable` ([`TabDemoPanel.ts:153`](../src/typescript/TabDemoPanel.ts#L153)).

10. **Typecheck checkpoint:** `npm run build` (or `tsc --noEmit`) — expect 0 errors. Then `grep -rn -E 'setTabWidthMode|setTabMaxWidth|setTabFixedWidth|setTabSide|setTabAlign|setTabOrientation|setTabScrollable|isTabScrollable|addTabTool|removeTabTool' src/typescript/lib/layout/Tab.ts` — expect **zero** matches (the manager no longer defines or calls any prefixed name). `grep -rn '_tabSide\|_tabScrollable\|_tabTools' src/` — expect zero.

**Bucket 2 — docs (one commit).**

11. **`docs/layouts/Tab.md`** — this page documents the **manager**, so its method names and `/api/layout/classes/Tab#...` anchors must change. Update prose names `setTabSide`→`setSide`, `setTabAlign`→`setAlign`, `setTabOrientation`→`setOrientation`, `setTabScrollable`→`setScrollable` and their anchors `#settabside`→`#setside`, `#settabalign`→`#setalign`, `#settaborientation`→`#setorientation`, `#settabscrollable`→`#setscrollable` (lines 77, 79, 85, 111, 120). Leave `#setcompact` (122, 130) and `#setreorderable` (140) **unchanged** — those manager methods keep their names. Update any `TabOptions` field names mentioned in prose (`tabMaxWidth`, `tabFixedWidth`, etc.) to the unprefixed forms.

12. **`docs/components/TabPanel.md`** — documents the **panel**. Construction examples switch to the nested `tabOptions: { … }` bag. Runtime forwarder names and their `/api/component/container/classes/TabPanel#...` anchors (`#settabwidthmode`, `#settabmaxwidth`, `#settabfixedwidth`, `#settabunderborderfullwidth`, `#settabside`, `#settabalign`, `#settaborientation`, `#settabscrollable`, `#gettabmanager`) stay **as-is** — TabPanel keeps prefixed forwarders. Update `#setcompact`→`#settabcompact` and `#setreorderable`→`#settabreorderable` (lines 121-122) to match the renamed TabPanel methods.

13. **`docs/concepts/theming.md:63`** — mentions "an explicit `tabUnderBorderFullWidth` layout option overrides it". Reword to reference the new option path (`tabOptions.underBorderFullWidth`), since the flattened `tabUnderBorderFullWidth` option no longer exists.

14. **Regenerate the typedoc API pages.** `docs/api/**` and `docs/.vitepress/dist/**` are **generated** (typedoc + vitepress build) — do not hand-edit. They get refreshed by the docs build in Verification. List them as "regenerated, not authored".

**Bucket 3 — bookkeeping (one commit).**

15. Update memory note `project_tab_feature_backlog.md` only if it references the old names (optional, check first). No `plans/implemented/` move is needed unless the project convention requires it on completion.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/layout/Tab.ts` |
| Modify | `src/typescript/lib/component/container/TabPanel.ts` |
| Modify | `src/typescript/TabDemoPanel.ts` |
| Modify | `docs/layouts/Tab.md` |
| Modify | `docs/components/TabPanel.md` |
| Modify | `docs/concepts/theming.md` |
| Regenerate (build, not hand-edit) | `docs/api/**`, `docs/.vitepress/dist/**` |

---

## Verification

- **Typecheck:** `npm run build` (or `tsc --noEmit`) — 0 errors. The compiler is the primary safety net: any missed forwarder body or demo call surfaces as a "property does not exist" error.
- **Grep invariants:**
  - `grep -rn -E 'setTab(WidthMode|MaxWidth|FixedWidth|UnderBorderFullWidth|Side|Align|Orientation|Scrollable)|isTab(UnderBorderFullWidth|Scrollable)|addTabTool|removeTabTool' src/typescript/lib/layout/Tab.ts` → **0** matches (manager surface fully unprefixed).
  - `grep -rn -E '_tab(WidthMode|MaxWidth|FixedWidth|Side|Align|Orientation|Scrollable|Tools)\b' src/` → **0** matches.
  - `grep -rn -E '\b(tabWidthMode|tabMaxWidth|tabFixedWidth|tabUnderBorderFullWidth|tabSide|tabAlign|tabOrientation|tabScrollable|tabTools)\s*:' src/` → **0** matches (no flattened option literals remain).
  - `grep -rn -E 'setTabCompact|isTabCompact|setTabReorderable|isTabReorderable' src/typescript/TabDemoPanel.ts src/typescript/lib/component/container/TabPanel.ts` → present on both.
- **Docs build:** `npm run docs:build` — 0 errors and 0 dead-link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning). This regenerates `docs/api/**` against the renamed symbols and validates the `#set...` anchors in the curated pages.
- **Manual smoke (the `TabDemoPanel` screen):** open the app, exercise the live controls — side, align, orientation, scrollable toggle, compact toggle, reorderable toggle, width mode, max/fixed width, under-border toggle. All must behave exactly as before the rename (pure rename, no behaviour change). Scope DevTools queries to `.TabDemoPanel .TabPanel` since multiple `TabPanel`s coexist.

---

## Documentation Impact

- The renamed manager methods and `TabOptions` fields are exported through the layout barrel [`src/typescript/lib/layout/index.ts`](../src/typescript/lib/layout/index.ts); the `TabPanel` surface through [`src/typescript/lib/component/container/index.ts`](../src/typescript/lib/component/container/index.ts). No new exports — `TabOptions` is already exported (verified, [`index.ts:16`](../src/typescript/lib/layout/index.ts#L16)).
- Curated pages to hand-edit: `docs/layouts/Tab.md` (manager — anchors change), `docs/components/TabPanel.md` (panel — construction example + four anchor renames), `docs/concepts/theming.md` (one option mention).
- `docs/api/**` is typedoc output — refreshed by `npm run docs:build`, never authored.
- No sidebar (`docs/.vitepress/config.mts`) or catalog `index.md` changes: no pages are added or removed, only symbol names within existing pages.

---

## Potential Challenges

- **Anchor asymmetry between the two curated pages.** On `Tab.md` the manager method anchors lose `tab` (`#settabside`→`#setside`) but `#setcompact`/`#setreorderable` stay; on `TabPanel.md` the forwarder anchors keep `tab` but `#setcompact`→`#settabcompact`. Mitigation: the per-page anchor lists are enumerated in steps 11-12 — follow them literally and let `docs:build` link-check catch a miss.
- **Sweeping rename could clobber the unprefixed look-alikes.** `_underBorderFullWidth`, `_compact`, `_reorderable`, and `ToolBar`'s own `setCompact` must survive untouched. Mitigation: rename by the explicit field/method list, not a blanket `s/tab//`; the grep invariants confirm the right things changed and the wrong things didn't.
- **`compact`/`reorderable` straddle the boundary.** They stay unprefixed in `TabOptions`/`tabOptions` and on the manager, but gain the prefix as TabPanel forwarders — the only fields whose name depends on which surface you're on. Mitigation: called out explicitly in steps 7-9.

---

## Critical Files

- [`src/typescript/lib/layout/Tab.ts`](../src/typescript/lib/layout/Tab.ts) — the manager; option fields 154-203, backing fields 456-475, `applyOptions` 588-640, setters/getters 650-1295.
- [`src/typescript/lib/component/container/TabPanel.ts`](../src/typescript/lib/component/container/TabPanel.ts) — options 28-58, constructor 91-154, forwarders 234-484.
- [`src/typescript/TabDemoPanel.ts`](../src/typescript/TabDemoPanel.ts) — construction 112-127, runtime controls 133-197.
- [`src/typescript/lib/layout/index.ts`](../src/typescript/lib/layout/index.ts) — barrel; confirms `TabOptions`/type exports (no change needed).
- [`src/typescript/lib/core/DragManager.ts`](../src/typescript/lib/core/DragManager.ts), [`src/typescript/lib/data/AjaxStore.ts`](../src/typescript/lib/data/AjaxStore.ts) — nested-options-bag precedents.

---

## Non-Goals

- **No behaviour change.** This is a pure rename; every control must work identically. No new options, modes, or defaults.
- **No type-alias renames.** `TabSide`/`TabAlign`/`TabOrientation`/`TabWidthMode`/`TabOptions`/`TabEvent` keep `Tab` — barrel collision risk.
- **No `ToolBar.ts` edit.** Its `setCompact`/`isCompact` are unrelated.
- **No dock/detach plan changes.** `plans/dock-tab-manager.md` and `plans/tab-detach-redock.md` are unimplemented markdown and reference no live `Tab` method calls.
- **No push/merge.** Work stays on the local `feature/tab-layout-extensions` branch.
