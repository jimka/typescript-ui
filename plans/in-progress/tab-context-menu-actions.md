# Tab Context-Menu Actions — Implementation Plan

## Overview

The tab strip's right-click context menu is built in [`TabBar.openTabMenu`](src/typescript/lib/component/container/TabBar.ts#L1612). Today it lists every tab flat (switch-to items), a separator, then a single `Close` gated on the clicked tab's `closeable` constraint, and calls [`Menu.show`](src/typescript/lib/overlay/Menu.ts#L185) with a flat `MenuItemConfig[]`.

This plan adds three things, all confined to `openTabMenu` and the tool-registration seam:

- **Part A — bulk close operations**: `Close all`, `Close others`, `Close all to the right`, `Close all to the left`, each closing a computed set of closeable tabs via a snapshot of ids fed to the existing `this.emit("tabclose", id)` path.
- **Part B — submenu reorganization**: the per-tab switch items move into their own `Switch to` submenu ([`MenuItemConfig.submenu`](src/typescript/lib/component/container/MenuItem.ts#L63) → [`MenuConfig`](src/typescript/lib/component/container/MenuItem.ts#L73)); the close actions sit at the top level.
- **Part C — descriptor-built tools**: [`TabBar.addTool`](src/typescript/lib/component/container/TabBar.ts#L1114) / [`Tab.addTool`](src/typescript/lib/layout/Tab.ts#L794) gain a **second overload** taking a `TabToolDescriptor` (`{ label, glyph?, action }`). The plain `addTool(Component)` form is unchanged (bare strip tool, no menu entry — backward-compatible). The descriptor form **builds the `Button` and the context-menu row from one descriptor**, so glyph/label/action are declared exactly once; the built tool appears in a trailing `Tools` submenu. Plain-Component tools never appear in the menu.

The close path is synchronous: `TabBar.emit("tabclose", id)` → `Tab._onBarTabClose` → [`Tab.closeEntry`](src/typescript/lib/layout/Tab.ts#L1008), which splices `_contents` and calls [`removeBarEntry`](src/typescript/lib/component/container/TabBar.ts#L1487) (mutating `_entries`). So a bulk close **must** iterate a captured id snapshot, never `_entries` live.

The pure id-set computation is extracted to a DOM-free module so it is unit-testable outside the browser harness (see [Architecture Decisions](#decision--pure-id-set-computation-lives-in-a-dom-free-module)).

---

## Architecture Decisions

### Decision — "Close all" includes the clicked tab; "Close others" excludes it

`Close all` closes **every** closeable tab, including the right-clicked one. `Close others` closes every closeable tab **except** the clicked one. This matches the near-universal editor convention (VS Code, browsers) and keeps `Close` (single) / `Close others` / `Close all` a clean nested progression. Stated explicitly in [Expected Behaviour](#expected-behaviour) so the implementer does not guess.

### Decision — snapshot ids before emitting

Every bulk action computes its full target id list **first**, then loops the snapshot calling `this.emit("tabclose", id)`. Because each emit synchronously removes an entry from `_entries`, reading `_entries` mid-loop would skip tabs (index shift) or throw. The pure helper returns a plain `string[]` snapshot; the loop never touches `_entries`.

### Decision — closeable gating and disabled state

Only closeable tabs are ever closed (a bulk target list is pre-filtered through [`isEntryCloseable`](src/typescript/lib/component/container/TabBar.ts#L1319)). A bulk menu item is **disabled** (`enabled: false`) when its filtered target set is empty — e.g. `Close all to the right` is disabled when no closeable tab exists to the right of the clicked tab. The single `Close` keeps its existing gate (the clicked tab's own `closeable`). Disabled items still render (dimmed), matching the existing active-tab switch item.

### Decision — pure id-set computation lives in a DOM-free module

The set arithmetic (right/left/others/all, filtered to closeable) is extracted to a new **DOM-free** module `src/typescript/lib/component/container/tabCloseTargets.ts` exporting a pure function. Rationale: `TabBar.ts` executes DOM-touching side effects at import scope (per project convention every component module builds style rules etc.), so importing it into a bare node vitest fails; a standalone module with zero framework imports is importable from both this repo's harnessed vitest **and** a downstream node vitest. The extraction is justified specifically by testability, not speculative reuse (the one caller is `openTabMenu`).

### Decision — submenu items are a static array, not a provider

[`MenuConfig.items`](src/typescript/lib/component/container/MenuItem.ts#L83) accepts an array or a provider. The whole context menu is rebuilt on every right-click through `Menu.show`, and a submenu panel is rebuilt each time it opens ([`handleItemOpenSubmenu`](src/typescript/lib/overlay/Menu.ts#L928) constructs a fresh `Menu` from `submenu.items`). Because `openTabMenu` runs at click time with `_entries` already current, a **static** `MenuItemConfig[]` captured then is correct — no provider needed. `MenuConfig.label` is required by the type but is inert for a right-click submenu (the row text comes from the parent `MenuItemConfig.text`); set it to the same visible string.

### Decision — two entry points via a discriminated `addTool` overload (not a second parameter, not a second method)

`addTool` gains a **second overload** rather than a second parameter: the old design duplicated glyph/label/action across a caller-built `Button` and a separate descriptor. The two forms are `addTool(button: Component): this` and `addTool(descriptor: TabToolDescriptor): this`, discriminated at runtime by `arg instanceof Component`. An overload beats a distinctly-named method (`addToolItem`) here because the discrimination is unambiguous — a `TabToolDescriptor` is a plain object literal and can never be a `Component`, so `instanceof Component` is a total, safe split — and one memorable name keeps the call surface small and lets the widened `tools?` option dispatch every element through a single method. The plain-Component overload is byte-for-byte the current behaviour, so existing callers ([`TabDemoPanel.ts:141`](src/typescript/TabDemoPanel.ts#L141), [`AccordionDemoPanel.ts:85`](src/typescript/AccordionDemoPanel.ts#L85), [`TabWindow.ts:101`](src/typescript/lib/overlay/TabWindow.ts#L101)) are untouched.

### Decision — the descriptor form builds the `Button` + menu row internally; returns `this`

`addTool(descriptor)` is the single source of truth for a menu-backed tool. Inside `TabBar` it: `new Button({ glyph: descriptor.glyph })`, forces `setFlat(true)`, attaches `descriptor.label` as the tooltip (via `Tooltip.attach`, the same call `createBarEntry` already uses), wires `button.on("action", descriptor.action)`, appends it as a strip tool, and registers a menu row carrying the **same** `descriptor.label` / `descriptor.glyph` / `descriptor.action`. The strip button's action and the menu row's action are literally the same function reference — no divergence possible. It returns **`this`** for chaining consistency with every other builder on the class; a caller that needs a live `Button` reference uses the plain `addTool(Component)` path instead. Flat-forcing lives **in the `TabBar` descriptor path** (where the `Button` is built), so `Tab.addTool(descriptor)` merely forwards — the `button instanceof Button` flat-forcing in `Tab.addTool` stays only for the plain-Component overload.

### Decision — widen `tools?` to `(Component | TabToolDescriptor)[]`

Both option interfaces ([`TabBarOptions`](src/typescript/lib/component/container/TabBar.ts#L150), [`TabOptions`](src/typescript/lib/layout/Tab.ts#L163)) widen from `Component[]` to `(Component | TabToolDescriptor)[]` for symmetry with the imperative API — a construction-time tool can now declare its menu entry too. Existing `tools: [button]` callers keep compiling because `Component` is still a member of the union. The `applyOptions` loops must dispatch each element with an explicit `instanceof Component` branch (calling the matching overload in each arm) rather than a bare `this.addTool(tool)`, because TypeScript overload resolution does not accept a union argument against separate non-union overload signatures.

### Decision — descriptors stored in a `Map<Component, TabToolDescriptor>` keyed by the built tool

`_tools: Component[]` stays the ordering source of truth; a parallel `private _toolMenuItems: Map<Component, TabToolDescriptor>` maps each descriptor-built `Button` to its descriptor. The descriptor overload sets the entry; `removeTool` deletes it. `openTabMenu` iterates `_tools` in order and includes only tools present in the map — preserving strip order and dropping plain-Component tools automatically.

---

## Public API

New exported descriptor type (declared in `TabBar.ts`, re-exported from the container barrel; `Tab.ts` imports it for its own overload):

```typescript
/**
 * Declares a strip tool that also surfaces in the tab context menu's "Tools"
 * submenu. Passed to `addTool`, which builds both the strip `Button` and the
 * menu row from this single descriptor — glyph/label/action declared once.
 */
export interface TabToolDescriptor {
    /** Tooltip on the strip button and label on the menu row (required). */
    label: string;
    /** Optional registry glyph name for the button and menu row (matches MenuItemConfig.glyph). */
    glyph?: string;
    /** Invoked by both the strip button's action and the menu row — the same reference. */
    action: () => void;
}
```

New `addTool` overloads on both classes (the plain-`Component` signature is unchanged; the descriptor signature is new). The implementation signature takes the union and discriminates via `instanceof Component`:

```typescript
// TabBar.ts
addTool(button: Component): this;              // unchanged: bare strip tool, no menu row
addTool(descriptor: TabToolDescriptor): this;  // new: builds Button + menu row internally
// impl: addTool(arg: Component | TabToolDescriptor): this

// Tab.ts — same two overloads; the descriptor arm forwards to the bar (which builds + flats)
addTool(button: Component): this;
addTool(descriptor: TabToolDescriptor): this;
// impl: addTool(arg: Component | TabToolDescriptor): this
```

Widened option field on both `TabBarOptions` and `TabOptions`:

```typescript
tools?: (Component | TabToolDescriptor)[];   // was Component[]
```

New pure module:

```typescript
// src/typescript/lib/component/container/tabCloseTargets.ts
export type BulkCloseScope = "others" | "right" | "left" | "all";

/**
 * Returns the ordered ids to close for a bulk scope, pre-filtered to closeable
 * tabs. `clickedIndex` is the right-clicked tab's position in `ids`.
 *   - "all"    → every closeable id (including the clicked tab)
 *   - "others" → every closeable id except the clicked tab
 *   - "right"  → closeable ids after clickedIndex
 *   - "left"   → closeable ids before clickedIndex
 */
export function computeBulkCloseIds(
    ids: readonly string[],
    clickedIndex: number,
    isCloseable: (id: string) => boolean,
    scope: BulkCloseScope,
): string[];
```

No new backing state is consumer-configurable, so no `XOptions` field is added (per the "reserve the options bag for consumer config" rule — `_toolMenuItems` is framework bookkeeping).

---

## Internal Structure

`computeBulkCloseIds` body (pure, no framework imports):

```typescript
export function computeBulkCloseIds(ids, clickedIndex, isCloseable, scope) {
    const inScope = ids.filter((id, i) => {
        switch (scope) {
            case "all":    return true;
            case "others": return i !== clickedIndex;
            case "right":  return i > clickedIndex;
            case "left":   return i < clickedIndex;
        }
    });

    return inScope.filter(isCloseable);
}
```

`openTabMenu` rebuild (replaces the current body):

```typescript
private openTabMenu(entry: BarEntry, x: number, y: number): void {
    const activeEntry = this.activeEntry();
    const ids         = this.getEntryIds();
    const clickedIdx  = ids.indexOf(entry.id);
    const closeable   = (id: string): boolean => this.isEntryCloseable(id);

    // Part B: per-tab switch items move into a "Switch to" submenu.
    const switchItems: MenuItemConfig[] = this._entries.map(t => ({
        text:    t.name,
        enabled: t !== activeEntry,
        action:  () => this.setActiveEntry(t.id),
    }));

    const configs: MenuItemConfig[] = [
        { text: "Switch to", submenu: { label: "Switch to", items: switchItems } },
        { separator: true },
        {
            text:    "Close",
            enabled: entry.constraints?.closeable === true,
            action:  () => this.emit("tabclose", entry.id),
        },
        this.bulkCloseItem("Close others",           ids, clickedIdx, closeable, "others"),
        this.bulkCloseItem("Close all to the right",  ids, clickedIdx, closeable, "right"),
        this.bulkCloseItem("Close all to the left",   ids, clickedIdx, closeable, "left"),
        this.bulkCloseItem("Close all",               ids, clickedIdx, closeable, "all"),
    ];

    // Part C: trailing "Tools" submenu, only when a tool supplied a descriptor.
    const toolItems: MenuItemConfig[] = this._tools
        .filter(tool => this._toolMenuItems.has(tool))
        .map(tool => {
            const d = this._toolMenuItems.get(tool)!;
            return { text: d.label, glyph: d.glyph, action: d.action };
        });

    if (toolItems.length > 0) {
        configs.push({ separator: true });
        configs.push({ text: "Tools", submenu: { label: "Tools", items: toolItems } });
    }

    this._contextMenu.show(x, y, configs);
}
```

`bulkCloseItem` helper (private, on `TabBar`), capturing the snapshot and the disabled state in one place:

```typescript
private bulkCloseItem(
    text: string,
    ids: readonly string[],
    clickedIdx: number,
    closeable: (id: string) => boolean,
    scope: BulkCloseScope,
): MenuItemConfig {
    const targets = computeBulkCloseIds(ids, clickedIdx, closeable, scope);

    return {
        text,
        enabled: targets.length > 0,
        action:  () => { for (const id of targets) { this.emit("tabclose", id); } },
    };
}
```

`targets` is captured at menu-build time (a stable snapshot); the closure closes over that array, satisfying the snapshot-before-emit constraint automatically.

`TabBar.addTool` overload + descriptor builder (the plain-Component arm is the current body verbatim):

```typescript
addTool(button: Component): this;
addTool(descriptor: TabToolDescriptor): this;
addTool(arg: Component | TabToolDescriptor): this {
    const button = arg instanceof Component ? arg : this.buildDescriptorTool(arg);

    this._tools.push(button);
    this._toolGroup.addComponent(button);
    this.scheduleLayout();

    return this;
}

/** Builds the flat strip Button for a descriptor tool and registers its menu row. */
private buildDescriptorTool(descriptor: TabToolDescriptor): Button {
    const button = new Button({ glyph: descriptor.glyph });

    button.setFlat(true);
    Tooltip.attach(button, descriptor.label);
    button.on("action", descriptor.action);
    this._toolMenuItems.set(button, descriptor);

    return button;
}
```

`Tab.addTool` mirrors the overload; its descriptor arm forwards to the bar (which builds + flats), and its plain-Component arm keeps the existing `button instanceof Button` flat-forcing:

```typescript
addTool(button: Component): this;
addTool(descriptor: TabToolDescriptor): this;
addTool(arg: Component | TabToolDescriptor): this {
    if (arg instanceof Component) {
        // Plain tool: keep the existing flat-forcing for Button tools.
        if (arg instanceof Button) {
            arg.setFlat(true);
        }
        this._bar.addTool(arg);
    } else {
        // Descriptor tool: the bar builds + flats the Button and registers the menu row.
        this._bar.addTool(arg);
    }

    this.getContainer()?.scheduleLayout();

    return this;
}
```

The `applyOptions` `tools` loop (both classes) dispatches per element so the union resolves against the overloads:

```typescript
for (const tool of options.tools) {
    if (tool instanceof Component) {
        this.addTool(tool);
    } else {
        this.addTool(tool);   // TabToolDescriptor arm
    }
}
```

---

## Ordered Implementation Steps

1. **Create `src/typescript/lib/component/container/tabCloseTargets.ts`** with `BulkCloseScope` and `computeBulkCloseIds` exactly as in [Internal Structure](#internal-structure). No framework imports. Add the SPDX header line matching the other files in that directory (`// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0`). Document the function per the code-conventions doc-comment rule.

2. **TabBar.ts — imports.** Import `computeBulkCloseIds` and the `BulkCloseScope` type from `~/component/container/tabCloseTargets.js`. Import `Button` from `~/component/button/Button.js` (needed to build descriptor tools; `Component` and `Tooltip` are already imported). Confirm `Button` is not already imported before adding.

3. **TabBar.ts — descriptor type + state.** Add and export `interface TabToolDescriptor` (JSDoc per [Public API](#public-api)). Add field `private _toolMenuItems: Map<Component, TabToolDescriptor> = new Map();` next to `_tools` (~line 492).

4. **TabBar.ts — `addTool` overload + `buildDescriptorTool` (~line 1114).** Replace the single-signature method with the two overloads + union implementation from [Internal Structure](#internal-structure), and add the private `buildDescriptorTool` helper. The plain-Component arm is the current body verbatim. Update the JSDoc to document both overloads.

4a. **TabBar.ts — widen the `tools` option (`TabBarOptions`, ~line 150)** to `tools?: (Component | TabToolDescriptor)[];` and update the `applyOptions` `tools` loop (~line 670) to the per-element `instanceof Component` dispatch from [Internal Structure](#internal-structure).

5. **TabBar.ts — `removeTool` (~line 1130).** After the successful splice, add `this._toolMenuItems.delete(button);` so a removed tool leaves no dangling descriptor.

6. **TabBar.ts — `bulkCloseItem` helper.** Add the private method from [Internal Structure](#internal-structure) near `openTabMenu`.

7. **TabBar.ts — rewrite `openTabMenu` (~line 1612)** to the [Internal Structure](#internal-structure) body (Parts A + B + C). Update its JSDoc to describe the new layout (switch submenu, single + bulk closes, optional tools submenu).

8. **TabBar.ts — barrel export.** In `src/typescript/lib/component/container/index.ts`, add `export type { TabToolDescriptor } from '~/component/container/TabBar.js';` beside the existing `TabBarOptions, TabBarEvent` export (line 36).

9. **Tab.ts — imports + `addTool` overload (~line 794).** Import the `TabToolDescriptor` type from `~/component/container/TabBar.js` (`Button` is already imported). Replace the single-signature `addTool` with the two overloads + union implementation from [Internal Structure](#internal-structure): the plain-Component arm keeps the `button instanceof Button` flat-forcing and forwards `this._bar.addTool(button)`; the descriptor arm forwards `this._bar.addTool(descriptor)` (the bar builds + flats). Update JSDoc.

9a. **Tab.ts — widen the `tools` option (`TabOptions`, ~line 163)** to `tools?: (Component | TabToolDescriptor)[];` and update the `applyOptions` `tools` loop (~line 395) to the per-element `instanceof Component` dispatch.

10. **Verify existing single-tool call sites are unaffected.** `TabWindow.ts:101-103` and any `tools: [button]` callers pass a `Component`, which still resolves to the plain overload — no change needed.

11. **Typecheck**: `npm run typecheck` — expect clean.

12. **Regression grep**: `grep -rn "addTool(" src/typescript/` — confirm every existing call site (`TabWindow.ts:101-103`, `Accordion.ts`, demos) passes a `Component` and resolves to the plain overload (Accordion's `addTool` is a *different* class and is out of scope — confirm it is untouched).

13. **Tests**: add `tests/component/container/tabCloseTargets.test.ts` covering [Expected Behaviour](#expected-behaviour) cases 1–8. Optionally extend `tests/component/container/TabBar.test.ts` for the menu-config assertions (10–13) if the existing harness exposes a way to inspect the built configs; otherwise those are manual.

14. **Demo (manual-verify aid)**: in `TabDemoPanel.ts`, exercise the descriptor form — replace the current `addToolBtn` construction + `tools: [addToolBtn]` with a descriptor tool, e.g. `tab.addTool({ label: "New tab", glyph: "plus", action: () => { /* existing add-tab handler */ } })` (or pass the descriptor inside the widened `tools` option), so the `Tools` submenu is exercisable by hand. Keep this minimal and clearly a demo change.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/component/container/tabCloseTargets.ts` |
| Create | `tests/component/container/tabCloseTargets.test.ts` |
| Modify | `src/typescript/lib/component/container/TabBar.ts` |
| Modify | `src/typescript/lib/component/container/index.ts` |
| Modify | `src/typescript/lib/layout/Tab.ts` |
| Modify | `docs/layouts/Tab.md` |
| Modify | `src/typescript/TabDemoPanel.ts` (demo aid) |

---

## Expected Behaviour

`computeBulkCloseIds` — **unit-testable** (pure). Fixture: ids `["a","b","c","d","e"]`, clicked `"c"` (index 2), closeable = all except `"a"` (pinned):

1. `scope "all"` → `["b","c","d","e"]` (every closeable, **including** clicked `"c"`; `"a"` excluded as non-closeable).
2. `scope "others"` → `["b","d","e"]` (excludes clicked `"c"`; excludes non-closeable `"a"`).
3. `scope "right"` → `["d","e"]` (indices > 2, all closeable).
4. `scope "left"` → `["b"]` (indices < 2; `"a"` filtered out).
5. Clicked at index 0, `scope "left"` → `[]` (nothing to the left).
6. Clicked at last index, `scope "right"` → `[]`.
7. All tabs non-closeable → every scope returns `[]`.
8. Single tab, clicked it, `scope "others"` → `[]`; `scope "all"` → `[the tab]` iff closeable.

Menu construction in `openTabMenu` — **unit-testable if the harness can read the built `MenuItemConfig[]`**, otherwise **manual**:

9. Top-level order is: `Switch to` (submenu) · separator · `Close` · `Close others` · `Close all to the right` · `Close all to the left` · `Close all` · (separator + `Tools` submenu only when ≥1 tool has a descriptor).
10. The `Switch to` submenu lists every tab; the active tab's item is `enabled: false`, others enabled.
11. `Close` is enabled iff the clicked tab's `constraints.closeable === true`.
12. Each bulk item's `enabled` equals `computeBulkCloseIds(...).length > 0` for its scope.
13. The `Tools` submenu is **absent** when no descriptor tool exists; present with one row per descriptor-built tool in `_tools` order when ≥1 does, each row showing the descriptor's `label`/`glyph`.

`addTool` dispatch — **unit-testable** under the component harness (construct a `TabBar`, call the overloads, inspect `_tools` / `_toolMenuItems`):

18. `addTool(component)` pushes the component to `_tools`, adds it to `_toolGroup`, and leaves `_toolMenuItems` unchanged (no menu row).
19. `addTool(descriptor)` pushes a **built** `Button` to `_tools`, registers it in `_toolMenuItems` under that same `Button`, forces it flat, and sets its tooltip to `descriptor.label`; the built button's `"action"` and the menu row both invoke the identical `descriptor.action` reference.
20. `removeTool(builtButton)` removes it from `_tools` **and** deletes its `_toolMenuItems` entry (the next `Tools` submenu omits it).
21. The widened `tools?: (Component | TabToolDescriptor)[]` option dispatches each element to the correct overload — a `Component` element becomes a plain tool, a descriptor element becomes a built menu tool.

Runtime behaviour — **manual** (needs real DOM events / geometry):

14. Right-click a tab → menu opens at the cursor; hovering `Switch to` opens the tab list; clicking a tab switches to it (via `setActiveEntry`).
15. `Close all to the right` with three closeable tabs to the right closes exactly those three and leaves the clicked tab and everything to its left; no index-shift skips (validates snapshot-before-emit).
16. `Close all` on a strip with one pinned (non-closeable) tab closes every other tab and leaves the pinned tab; the strip does not throw.
17. A tool added via `addTool(descriptor)` appears in the `Tools` submenu and invokes `descriptor.action` both from the strip button and the menu row; a tool added via plain `addTool(component)` does not appear. After `removeTool` of the built button, the row is gone on the next menu open.

---

## Verification

- `npm run typecheck` — clean.
- `npm run test` (runs `typecheck:test` then `vitest run`) — the new `tabCloseTargets.test.ts` covers cases 1–8; existing `TabBar` / `Tab` suites still green.
- `grep -rn "addTool(" src/typescript/` — every pre-existing call site passes a `Component` and resolves to the unchanged plain overload.
- `npm run docs:build` — zero warnings (new `TabToolDescriptor` is exported from the barrel, so any `{@link}` to it resolves).
- **Manual smoke** in the Tab demo (`TabDemoPanel`): exercise cases 14–17 — right-click a tab, walk the `Switch to` submenu, run each bulk close (watch tab-to-the-right/left counts), confirm the `Tools` submenu shows the registered tool and fires its action.

---

## Documentation Impact

- **Barrel**: `TabToolDescriptor` is exported from `src/typescript/lib/component/container/index.ts` (added in step 8), so TypeDoc generates its API page under `component/container`.
- **`docs/layouts/Tab.md` → "Tab tools" section** (line 160): document the two `addTool` overloads — `addTool(button)` for a bare strip tool and `addTool(descriptor)` which builds the button **and** a `Tools`-submenu row from one `TabToolDescriptor` (`{ label, glyph?, action }`), and the widened `tools?: (Component | TabToolDescriptor)[]` option. Note a plain-Component tool stays menu-invisible. Link the descriptor via `[`TabToolDescriptor`](/api/component/container/interfaces/TabToolDescriptor)`.
- **Context-menu behaviour**: add a short note (in `docs/layouts/Tab.md`, near the close/`tabclose` prose around line 158) describing the right-click menu's `Switch to` submenu and the four bulk-close actions with their closeable gating, so the feature is discoverable.
- Follow the "don't `{@link}` internal symbols" rule: `computeBulkCloseIds` and `_toolMenuItems` are internal and must not be linked from any public JSDoc — describe the behaviour in prose instead.

---

## Potential Challenges

- **Snapshot vs. live `_entries`**: mitigated structurally — `bulkCloseItem` captures the target array before the menu is even shown, so the action closure can never read a mutated `_entries`.
- **Downstream node vitest import**: keeping `tabCloseTargets.ts` free of any `~/core/*` import is essential; a stray framework import re-introduces the import-scope DOM side effect. The step-1 "no framework imports" note guards this.
- **`MenuConfig.label` required but inert**: harmless; set it to the row text so the type is satisfied and the value is self-documenting.
- **Menu-config assertions may not be harness-reachable**: if `Menu`/`TabBar` do not expose the built config array to a test, cases 9–13 fall back to manual verification (documented in Expected Behaviour) rather than being forced through a brittle DOM probe.
- **Union argument vs. overloads**: passing a `Component | TabToolDescriptor` value straight to a method with two *separate* non-union overloads is a TS error — mitigated by the explicit `instanceof Component` branch in every dispatch site (the option loops and `Tab.addTool`'s forward), so each call passes a narrowed type that matches one overload.

---

## Critical Files

- [`src/typescript/lib/component/container/TabBar.ts`](src/typescript/lib/component/container/TabBar.ts) — `openTabMenu` (~1612), `addTool`/`removeTool` (~1114/1130), `isEntryCloseable` (~1319), `getEntryIds` (~1298), `_tools`/`_toolGroup`/`_contextMenu`/`_entries` fields (~485–495), `BarEntry` (~170).
- [`src/typescript/lib/layout/Tab.ts`](src/typescript/lib/layout/Tab.ts) — `addTool` (~794), `options.tools` handling (~395), `closeEntry` (~1008), `_onBarTabClose` (~994).
- [`src/typescript/lib/component/container/MenuItem.ts`](src/typescript/lib/component/container/MenuItem.ts) — `MenuItemConfig` / `MenuConfig` shapes (~40/73).
- [`src/typescript/lib/overlay/Menu.ts`](src/typescript/lib/overlay/Menu.ts) — `show` (~185), `handleItemOpenSubmenu` (~928) — confirms static-array submenus rebuild per open.
- [`src/typescript/lib/component/container/index.ts`](src/typescript/lib/component/container/index.ts) — barrel export surface.
- [`docs/layouts/Tab.md`](docs/layouts/Tab.md) — "Tab tools" section.

---

## Non-Goals

- **No changes to `Accordion.addTool` / `AccordionHeader.addTool`** — a separate class hierarchy; the descriptor is Tab-strip-only. Widening it there is out of scope.
- **No caller-built `Button` + separate descriptor** — the descriptor overload owns the `Button` construction so glyph/label/action live in one place; a caller wanting to hold the `Button` uses the plain `addTool(Component)` path instead.
- **No glyphs on the close items** — the bulk/single close rows stay text-only, matching the existing `Close` row; only descriptor-driven tool rows carry a glyph.
- **No new close semantics on the owner** — bulk close reuses the existing `emit("tabclose", id)` → `closeEntry` path verbatim; `Tab.closeEntry` is not modified.
- **No confirmation dialogs / undo** for bulk close — out of scope.
