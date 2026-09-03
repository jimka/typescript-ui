---
touches-shared: [packages/lib/src/typescript/lib/component/button/Button.ts]
---

# Tab glyph swapping — Implementation Plan

## Overview

A tab's leading icon is fixed when the tab is created. `TabBar.createBarEntry` reads `constraints.glyph` once and passes it to the `TabButton` constructor ([packages/lib/src/typescript/lib/component/container/TabBar.ts:1575](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1575)), and nothing changes it afterwards. A tab's *label* does have a runtime setter — `Tab.setTabName(content, name)` ([packages/lib/src/typescript/lib/layout/Tab.ts:1228](packages/lib/src/typescript/lib/layout/Tab.ts#L1228)) forwarding to `TabBar.setEntryName(id, name)` ([packages/lib/src/typescript/lib/component/container/TabBar.ts:1460](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1460)) — but there is no glyph equivalent.

This plan adds one, at both seams and in the same shapes: `TabBar.setEntryGlyph` / `clearEntryGlyph` / `getEntryGlyph` keyed by cell id, and `Tab.setTabGlyph` / `clearTabGlyph` keyed by the content component. All of them reach the live `TabButton` through the inherited `Button.setGlyph` / `Button.clearGlyph` ([packages/lib/src/typescript/lib/component/button/Button.ts:1734](packages/lib/src/typescript/lib/component/button/Button.ts#L1734)), which rebuild only the button's inner content row and leave every other part of the tab alone.

Two supporting changes ride along. `Tab.setTabGlyph` writes the new name back to the stored `LayoutConstraints.glyph`, because that constraint is where a tab glyph durably lives — `Tab.createTab` re-reads it on a re-dock and `serializeLayout` captures it. And `Button.setGlyph` / `Button.clearGlyph` gain a `dispose()` of the glyph they replace or remove, which they omit today. The `addTab` / `createBarEntry` / `TabButton` construction path is untouched.

The motivating consumer is a desktop code editor that re-icons an open editor tab when a file is saved under a new name with a different type. The API is designed as a general capability; nothing here is editor-specific.

---

## Architecture Decisions

### Mirror the `setTabName` chain exactly

The new methods sit at the same two seams as the rename, with the same signatures, lookups and no-op behaviour: the bar method returns `this` and no-ops on an unknown id; the layout-manager method returns `boolean` and keys on the content component by identity.[^mirror-rename]

### Swap through `Button.setGlyph`; do not rebuild the tab button

`TabBar.setEntryGlyph` calls `entry.button.setGlyph(glyph)` and nothing else. `Button.setGlyph` constructs a fresh `ButtonIconGlyph` and calls `_rebuildContentRow` ([packages/lib/src/typescript/lib/component/button/Button.ts:1546](packages/lib/src/typescript/lib/component/button/Button.ts#L1546)), which empties and repopulates the button's inner `_content` row only. The button's own element keeps its background, borders, `.selected` / `:hover` state classes, focus, drag source, and its two raw-appended overlays — the close ✕ and the busy wash that marks a tab whose content is still loading.[^why-content-row]

### The identity glyph gets no pin and no style trait

A tab button carries up to two icons: its **identity glyph**, the leading icon this feature swaps, and — on a closeable tab — the ✕ inside its close button. Leave the new identity glyph to `Button`'s line-height auto-sync, which sizes a leading icon to match its own label's rendered line height. Do not call `pinGlyphSize` on it and do not give it `GLYPH_XS_INK_TRAIT`; both of those belong to the close ✕, a separate component instance.[^sizing-precedent]

### `Tab.setTabGlyph` also writes `LayoutConstraints.glyph`

The stored constraint is a tab glyph's durable home: `Tab.createTab` reads it when a torn-off or re-docked tab's cell is rebuilt ([packages/lib/src/typescript/lib/layout/Tab.ts:1513](packages/lib/src/typescript/lib/layout/Tab.ts#L1513)), and `serializeLayout` captures it into the saved arrangement ([packages/lib/src/typescript/lib/layout/LayoutSerialization.ts:234](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L234)). A swap that only touched the button would silently revert on any of those paths. `TabBar.setEntryGlyph` does **not** write constraints — the bar is a pure view over cells it does not own.[^constraint-writeback]

### Take a `string` and add a separate `clearX`, not a `string | null`

`setEntryGlyph(id, glyph: string)` plus `clearEntryGlyph(id)`, and the same pair on `Tab`. A nullable single setter is the shape this codebase deliberately moved *away* from for exactly this property.[^clear-convention]

### `Button.setGlyph` and `clearGlyph` dispose the glyph they discard

Both capture the outgoing `_glyph`, rebuild the row, then `dispose()` it. `_rebuildContentRow` detaches without destroying, so today every glyph swap strands a `Glyph` component holding its element and its per-instance stylesheet rule.[^dispose-outgoing]

### A caller-driven icon change is not the transient-state case that was rejected before

`tab-loading-indicator.md` kept load state out of the glyph slot because an earlier attempt painted an hourglass over the tab's identity icon and never cleared it. That decision is about *transient* state borrowing the identity slot. Here the caller is changing the identity itself, and the busy wash stays a separate overlay, so the two never contend for the slot.

---

## Public API

No new state-bearing property is introduced. The glyph's backing field is `Button._glyph` (existing, read via `getGlyph()`); its config field is `LayoutConstraints.glyph` (existing, [packages/lib/src/typescript/lib/layout/LayoutConstraints.ts:22](packages/lib/src/typescript/lib/layout/LayoutConstraints.ts#L22)). The five new methods are accessors over those.

```typescript
// packages/lib/src/typescript/lib/component/container/TabBar.ts — class TabBar

/** Replaces the leading icon of the cell with `id`. No-op for an unknown id. */
setEntryGlyph(id: string, glyph: string): this;

/** Removes the leading icon of the cell with `id`. No-op for an unknown id. */
clearEntryGlyph(id: string): this;

/** The registry glyph name on the cell with `id`, or `null` when it has none or the id is unknown. */
getEntryGlyph(id: string): string | null;
```

```typescript
// packages/lib/src/typescript/lib/layout/Tab.ts — class Tab

/** Replaces the leading icon of the tab hosting `content`. Returns false when no tab matches. */
setTabGlyph(content: Component, glyph: string): boolean;

/** Removes the leading icon of the tab hosting `content`. Returns false when no tab matches. */
clearTabGlyph(content: Component): boolean;
```

```typescript
// packages/lib/src/typescript/lib/component/button/Button.ts — class Button
// Signatures unchanged; both now dispose the glyph they replace or remove.

setGlyph(name: string): this;
clearGlyph(): this;
```

---

## Internal Structure

`TabBar`'s three methods follow `setEntryName` / `isEntryBusy` line for line:

```typescript
setEntryGlyph(id: string, glyph: string): this {
    const entry = this.entryById(id);

    if (entry) {
        entry.button.setGlyph(glyph);
        this.scheduleLayout();
    }

    return this;
}

clearEntryGlyph(id: string): this {
    const entry = this.entryById(id);

    if (entry) {
        entry.button.clearGlyph();
        this.scheduleLayout();
    }

    return this;
}

getEntryGlyph(id: string): string | null {
    return this.entryById(id)?.button.getGlyph()?.getGlyphName() ?? null;
}
```

`Tab`'s two public methods share one private helper, so the constraint write-back and the container re-layout are written once:

```typescript
setTabGlyph(content: Component, glyph: string): boolean {
    return this.applyTabGlyph(content, glyph);
}

clearTabGlyph(content: Component): boolean {
    return this.applyTabGlyph(content, null);
}

private applyTabGlyph(content: Component, glyph: string | null): boolean {
    const entry = this._contents.find(e => e.component === content);

    if (!entry) {
        return false;
    }

    // The stored constraint is the glyph's durable home: createTab re-reads it
    // when a torn-off or re-docked tab's cell is rebuilt, and serializeLayout
    // captures it. Writing only the button would revert on both paths.
    let constraints = this.getLayoutConstraints(content);

    if (!constraints) {
        constraints = new LayoutConstraints();
        this.setLayoutConstraints(content, constraints);
    }

    constraints.glyph = glyph;

    if (glyph === null) {
        this._bar.clearEntryGlyph(entry.id);
    } else {
        this._bar.setEntryGlyph(entry.id, glyph);
    }

    this.getContainer()?.scheduleLayout();

    return true;
}
```

`Button.setGlyph`'s change is the two added lines marked below; everything else in the method stays as it is:

```typescript
setGlyph(name: string): this {
    const outgoing = this._glyph;                       // added
    const glyph    = new ButtonIconGlyph(name);

    glyph.setPointerEvents("none");

    this._glyph           = glyph;
    this._glyphSyncedSize = null;

    if (this._options.glyphColor !== undefined) {
        glyph.setForegroundColor(this._options.glyphColor);
    }

    this._rebuildContentRow();

    // The rebuild only detaches the replaced glyph (removeAllComponents is
    // detach-only), so discard it here or every swap strands its element and
    // its per-instance stylesheet rule.
    outgoing?.dispose();                                // added

    this.recomputePreferredSize();

    return this;
}
```

`clearGlyph` takes the same two lines: capture `this._glyph` before nulling it, and `dispose()` it after `_rebuildContentRow()`.

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/component/button/Button.ts`** — in `setGlyph` (line 1734), capture `const outgoing = this._glyph;` as the first statement and add `outgoing?.dispose();` immediately after the `this._rebuildContentRow();` call, with the comment from `## Internal Structure`. Extend the method's JSDoc with one sentence: the replaced glyph is destroyed, so a caller holding a reference from `getGlyph()` must not reuse it across a `setGlyph`.
2. **`packages/lib/src/typescript/lib/component/button/Button.ts`** — apply the same capture-and-dispose to `clearGlyph` (line 1765), and add the same JSDoc sentence.
   - Check: `npm run typecheck` passes; `npm test` passes with no new failures. `VideoPlayer`, `Dialog`, `Window`, `Notification`, `ComboBox`, `ToolBar`, `SpinButton` and `table/Header` all call `getGlyph()` freshly at each use, so none is broken by the destroy — confirm with `grep -rn '\.getGlyph()' packages/lib/src/typescript/` and read each hit.
3. **`packages/lib/src/typescript/lib/component/container/TabBar.ts`** — add `setEntryGlyph`, `clearEntryGlyph` and `getEntryGlyph` from `## Internal Structure`, placed immediately after `setEntryName` (line 1460) so the label and icon setters sit together. Give each the JSDoc shape `setEntryName` uses: one-sentence summary naming the no-op-on-unknown-id behaviour, `@param` per argument, `@returns`.
4. **`packages/lib/src/typescript/lib/layout/Tab.ts`** — add the private `applyTabGlyph` helper and the public `setTabGlyph` / `clearTabGlyph` from `## Internal Structure`, placed immediately after `setTabName` (line 1228). `LayoutConstraints` is already imported at line 4 — do not add an import.
   - Check: `grep -n 'import { LayoutConstraints }' packages/lib/src/typescript/lib/layout/Tab.ts` — expect exactly one match.
5. **`packages/lib/tests/component/container/TabBar.test.ts`** — add cases 7–10, 13 and 14 from `## Expected Behaviour`, following the file's existing `installTestDOM(CONFIG)` + `threeEntryBar()` setup. Cases 9, 13 and 14 need the cell's `TabButton`, which the bar keeps private; reach it through `(bar as unknown as { _entries: Array<{ button: TabButton }> })._entries`, the same private-field cast `packages/lib/tests/layout/Tab.renameAndVeto.test.ts` uses. `Component.onDestroy(fn)` is the disposal probe for cases 13 and 14, as in `packages/lib/tests/core/ComponentDispose.test.ts:213`.
6. **`packages/lib/tests/layout/Tab.tabGlyph.test.ts`** — new file for cases 1–6, 11 and 12. Model it on `packages/lib/tests/layout/Tab.renameAndVeto.test.ts`: same `CONFIG`, same `hostTab()` helper, same `barEntries()` private-field reach, same `afterEach` teardown.
   - Check: `npm test` passes.
7. **`packages/lib/docs/components/TabBar.md`** — add one row to the *Cell lifecycle* table, directly under the `setEntryBusy` row.
8. **`packages/lib/docs/layouts/Tab.md`** — rename the `## Renaming a tab` heading to `## Renaming and re-iconing a tab` and add the `setTabGlyph` / `clearTabGlyph` paragraph and example beneath the existing `setTabName` one. In the *Per-child constraints* table, extend the `glyph` row to say the value is also what `setTabGlyph` updates, so the icon survives a tear-off, a re-dock and a saved layout.
9. **`packages/lib/docs/reference/changelog/next.md`** — add a bullet under `## Changed` → `### Layouts` for `Tab.setTabGlyph` / `clearTabGlyph`, a `### Components` bullet for the three `TabBar` methods, and a `## Fixed` bullet for the `Button.setGlyph` / `clearGlyph` disposal.
   - Check: `npm run docs:api` finishes with zero warnings; `npm run lint` passes.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/button/Button.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/TabBar.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Tab.ts` |
| Modify | `packages/lib/tests/component/container/TabBar.test.ts` |
| Create | `packages/lib/tests/layout/Tab.tabGlyph.test.ts` |
| Modify | `packages/lib/docs/components/TabBar.md` |
| Modify | `packages/lib/docs/layouts/Tab.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Cases 1–14 are unit-testable in the offline harness. Cases M1–M3 need a browser and are documented manual checks.

| # | Setup | Action | Expected |
|---|---|---|---|
| 1 | Tab created with `constraints.glyph = 'file'` | `tab.setTabGlyph(content, 'file-lines')` | returns `true`; the entry's button reports glyph name `'file-lines'` |
| 2 | After case 1 | `tab.setTabGlyph(content, 'file')` | returns `true`; the button reports `'file'` — repeated swaps keep working |
| 3 | A component never added to the strip | `tab.setTabGlyph(neverAdded, 'file')` | returns `false`; no entry's glyph changes |
| 4 | Tab created with a glyph | `tab.clearTabGlyph(content)` | returns `true`; the button's `getGlyph()` is `null` |
| 5 | Tab created with **no** glyph | `tab.setTabGlyph(content, 'file')` | returns `true`; `getGlyph()` goes from `null` to a glyph named `'file'` |
| 6 | Laid-out strip, `host.isLayoutDirty()` is `false` | `tab.setTabGlyph(content, 'file-lines')` | `host.isLayoutDirty()` becomes `true` |
| 7 | Three-entry bar | `bar.setEntryGlyph('nope', 'file')` | returns the bar; no entry changes; `bar.getEntryGlyph('nope')` is `null` |
| 8 | Bar entry `'a'` is the active, selected cell | `bar.setEntryGlyph('a', 'file')` | `bar.getActiveEntryId()` is still `'a'` and the button is still selected |
| 9 | Bar entry created with `closeable: true` | `bar.setEntryGlyph(id, 'file')` | `entry.button.getCloseButton()` returns the **same instance** as before the call |
| 10 | `bar.setEntryBusy(id, true)` | `bar.setEntryGlyph(id, 'file')` | `bar.isEntryBusy(id)` is still `true` |
| 11 | Tab created with `constraints.glyph = 'file'` | `tab.setTabGlyph(content, 'file-lines')` | `tab.getLayoutConstraints(content)!.glyph` is `'file-lines'` — the value `serializeLayout` captures |
| 12 | Tab added with **no** constraints at all | `tab.setTabGlyph(content, 'file')` | returns `true`; `tab.getLayoutConstraints(content)` is now a `LayoutConstraints` whose `glyph` is `'file'` |
| 13 | A bar entry with a glyph; `entry.button.getGlyph()!.onDestroy(fn)` registered | `bar.setEntryGlyph(id, 'file-lines')` | `fn` has fired — the replaced glyph is destroyed, not merely detached |
| 14 | Same setup as case 13 | `bar.clearEntryGlyph(id)` | `fn` has fired, and `bar.getEntryGlyph(id)` is `null` |
| M1 | A **selected, hovered** closeable tab in a rendered strip | swap its glyph | the icon changes; the tab's fill, border, selection indicator and close ✕ do not blink or move |
| M2 | A tab whose button carries a non-default font size | swap its glyph | the new icon renders at the same size as the one it replaced — the label's line height — not at an unsynced construction size |
| M3 | A `scrollable` strip scrolled part-way | `setTabGlyph` on a tab that already had a glyph, then on one that had none | the first leaves every tab's width unchanged; the second widens that tab and reflows the strip |

A lazy tab whose factory has not run has no content component, so `setTabGlyph` / `clearTabGlyph` return `false` for it — the same limitation `setTabName` and `closeTab` already have. `TabBar.setEntryGlyph(id, …)` reaches such a cell directly.

---

## Verification

- `npm run typecheck` — clean.
- `npm test` — the new `Tab.tabGlyph` file and the extended `TabBar.test.ts` pass; nothing in `packages/lib/tests/component/button/`, `packages/lib/tests/component/display/VideoPlayer.test.ts`, `packages/lib/tests/component/MenuButton.test.ts`, `packages/lib/tests/component/GlyphIconScale.test.ts` or `packages/lib/tests/core/ComponentDispose.test.ts` regresses.
- `npm run lint` — clean.
- `npm run docs:api` — finishes with **zero** warnings (the `{@link}` rule in `CODE_CONVENTIONS.md`).
- `grep -rn 'setEntryGlyph\|setTabGlyph\|clearEntryGlyph\|clearTabGlyph\|getEntryGlyph' packages/lib/src packages/lib/docs packages/lib/tests` — every hit is one of the sites this plan names.
- `grep -Fn 'constraints?.glyph' packages/lib/src/typescript/lib/component/container/TabBar.ts` — still exactly one match, at line 1575 in `createBarEntry` (the construction path must be unchanged).
- Manual (M1–M3): `npm run dev` and open the demo app's tab panel, `packages/lib/src/typescript/TabDemoPanel.ts` — its `TabPanel` already builds glyph-bearing closeable tabs (`{ label: "Alpha", …, glyph: "star" }` at line 159). Drive `setTabGlyph` against a selected, hovered tab from the console via the panel's `getTab()`.

---

## Documentation Impact

No export or barrel change: `Tab`, `TabBar` and `Button` are already exported through their package entry points, and no new type is introduced. `packages/lib/llms.txt` is a task-to-component index and needs no entry for methods on existing components.

| Page | Change |
|---|---|
| `packages/lib/docs/components/TabBar.md` | One *Cell lifecycle* row: `setEntryGlyph(id, glyph)` / `clearEntryGlyph(id)` / `getEntryGlyph(id)` — swap, remove or read a cell's leading icon after creation. |
| `packages/lib/docs/layouts/Tab.md` | `## Renaming a tab` becomes `## Renaming and re-iconing a tab`, gaining a `setTabGlyph` / `clearTabGlyph` paragraph and example. The *Per-child constraints* `glyph` row gains a clause: `setTabGlyph` updates this value, so a runtime icon change survives a tear-off, a re-dock and a saved layout. |
| `packages/lib/docs/reference/changelog/next.md` | `## Changed` → `### Layouts`: `Tab.setTabGlyph` / `clearTabGlyph`. `## Changed` → `### Components`: the three `TabBar` methods. `## Fixed`: `Button.setGlyph` / `clearGlyph` now destroy the glyph they replace. |

JSDoc on all five new methods must obey the `{@link}` rule in `CODE_CONVENTIONS.md` — link only exported, non-`private`/`protected`/`@internal` symbols. `entryById`, `applyTabGlyph`, `_rebuildContentRow` and `_glyphSyncedSize` are all excluded from the generated docs, so describe their behaviour in prose rather than linking them.

---

## Potential Challenges

- **`Button.setGlyph` does not clear `_glyphSizePinned`.** A button whose glyph was pinned via `pinGlyphSize` gets its replacement stuck at its unsynced construction size, because the line-height sync stays suppressed. Not reachable through this plan's methods — nothing pins a *tab* button's own glyph; `TabBar.positionCloseButtons` pins the close button's, which is a separate component. Leave it alone.
- **Adding or removing a glyph changes the tab's width.** A glyph-to-glyph swap is same-width (both icons sync to the same line height), but `null` → glyph adds an icon cell plus its gap and reflows the strip, which under a `scrollable` strip also shifts the scroll position. Expected, not a defect; case M3 pins it and the `Tab.md` prose should say so.
- **Disposing the outgoing glyph changes behaviour for every existing `setGlyph` caller.** Step 2's grep-and-read of all `getGlyph()` sites is the mitigation: none holds a glyph reference across a `setGlyph`, so nothing observes the destroy.
- **A lazy tab has no content component to key on.** `setTabGlyph` returns `false` there. State it in the JSDoc rather than working around it; `TabBar.setEntryGlyph` covers the case by cell id.

---

## Critical Files

Read before writing code:

- [packages/lib/src/typescript/lib/layout/Tab.ts:1228](packages/lib/src/typescript/lib/layout/Tab.ts#L1228) — `setTabName`, the precedent the new `Tab` methods mirror; also `setTabBusy` at line 1253 and `createTab` at line 1512.
- [packages/lib/src/typescript/lib/component/container/TabBar.ts:1460](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1460) — `setEntryName`, the precedent the new `TabBar` methods mirror; also `getEntryName` (1447), `setEntryBusy` (1504), `entryById` (1540) and `createBarEntry` (1568).
- [packages/lib/src/typescript/lib/component/button/Button.ts:1734](packages/lib/src/typescript/lib/component/button/Button.ts#L1734) — `setGlyph`, `clearGlyph` (1765), `_rebuildContentRow` (1546) and `_syncGlyphSize` (1689).
- [packages/lib/src/typescript/lib/component/button/TabButton.ts:349](packages/lib/src/typescript/lib/component/button/TabButton.ts#L349) — the close button's raw append onto the button's own element; the busy wash does the same at line 407. Both are why a content-row rebuild cannot disturb them.
- [packages/lib/src/typescript/lib/core/Component.ts:6674](packages/lib/src/typescript/lib/core/Component.ts#L6674) — `removeAllComponents`, documented detach-only, which is why the outgoing glyph must be disposed explicitly.
- [packages/lib/src/typescript/lib/layout/LayoutSerialization.ts:234](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L234) — `constraints.glyph` captured into a saved arrangement; restored at line 446.
- [packages/lib/tests/layout/Tab.renameAndVeto.test.ts](packages/lib/tests/layout/Tab.renameAndVeto.test.ts) — the template for the new test file.
- [packages/lib/tests/core/ComponentDispose.test.ts:213](packages/lib/tests/core/ComponentDispose.test.ts#L213) — the `onDestroy` disposal probe cases 13 and 14 use.
- `plans/implemented/glyph-icon-size-scale.md` — the decision that a `Button`'s leading icon stays on the per-instance line-height sync rather than a global size step.
- `plans/implemented/component-lifecycle-leak-fixes-round-2.md` — "A discarded child is disposed where it is discarded".

---

## Non-Goals

- **No `Tab.getTabGlyph`.** `Tab` ships `setTabName` with no `getTabName`; the reader lives on the bar, where `getEntryGlyph` joins `getEntryName`.
- **No `TabPanel` forwarders.** `TabPanel` routes per-tab operations through `getTab()` by design ([packages/lib/src/typescript/lib/component/container/TabPanel.ts:65](packages/lib/src/typescript/lib/component/container/TabPanel.ts#L65)) rather than mirroring a method per setter.
- **No change to `addTab`, `createBarEntry`, or `TabButton`'s constructor glyph dispatch.** The construction path stays exactly as it is.
- **No `Glyph` name setter.** `plans/implemented/embedded-glyph.md` decided against one: a glyph's tag is fixed at construction, and a swap means a new instance.
- **No `setCloseable` runtime toggle.** `plans/implemented/extract-tabbutton.md` says not to add one speculatively, and no call site needs it.
- **No constraint write-back for `setTabName`.** A tab's label has a different durable home from its glyph, so the two are not the same gap; changing `setTabName` is separate work.
- **No `pinGlyphSize` or style trait on the identity glyph.** Those belong to the close ✕ only.

---

## Notes

[^mirror-rename]: The bar-versus-manager split, the return types and the no-op semantics all come from the pair this feature copies. `TabBar.setEntryName` returns `this`, looks the cell up through the private `entryById`, and does nothing for an unknown id; `Tab.setTabName` returns `true` / `false` and finds its entry by `e.component === content`. Keying on the content component rather than an index or a label is itself a settled decision — both drift under reorder and rename, and it is the key `closeTab` already uses. `setEntryBusy` / `isEntryBusy` and `getEntryName` establish that a `TabBar` setter ships with a matching reader, which is why `getEntryGlyph` is included even though the motivating consumer does not need it.

[^why-content-row]: `Button` keeps its glyph, title and description in an inner `_content` row and rebuilds that row wholesale on any glyph or description change; it never recreates `_content` itself. Everything that makes a tab look and behave like a tab lives one level up, on the `TabButton`'s own element: the fill and border rules, the `.selected` and `:hover` state classes, the DOM focus, the drag source `TabBar` registered, the button-group and roving-tab-index memberships, and the two overlays `TabButton` raw-appends to `getElement()` — the close ✕ and the busy wash. None of them is a child of `_content`, so the rebuild cannot reach them. `TabButton` also does not override `_afterRebuildContentRow`, the hook a subclass with its own `_content` child (such as `SplitButton`'s chevron) uses to survive a rebuild, because it has no such child. Rebuilding the whole `TabButton` instead was never a candidate: it would drop focus, drag wiring and every registration, which is what the "no rebuild of unrelated chrome" requirement rules out.

[^sizing-precedent]: `plans/implemented/glyph-icon-size-scale.md` puts free icon-size choices on five `glyphXs`…`glyphXl` steps and then explicitly excludes a `Button`'s leading icon from the scheme, because it already derives its size per instance from its own label's line box — strictly more specific than a global step, and what makes a button with a custom font size get a proportionate icon. `Button.setGlyph` resets `_glyphSyncedSize` to `null`, which is the flag telling `_syncGlyphSize` that the glyph is unsynced, so the replacement re-adopts the line-height track on the next `recomputePreferredSize` with no work from the caller. Separately, `plans/implemented/glyph-icon-trait-dedup.md` rejected declaring `GLYPH_XS_INK_TRAIT` on `ButtonIconGlyph` itself, because that would hand the trait to every leading icon in the app — a plain `Button`'s, `PickerButton`'s, `MenuButton`'s — none of which are `glyphXs`-sized. The trait stays an instance-level opt-in on the close ✕.

[^constraint-writeback]: `plans/implemented/dock-tab-manager.md` states the rule this rests on: the tab glyph is per-container constraint state that a re-home would drop, which is why `PanelNode` gained an optional `glyph` that `serializePanel` captures and `constraintsFor` restores. The constraint is therefore not incidental configuration — it is where a tab's glyph lives between cell rebuilds. Three paths re-read it: `Tab.createTab` on a re-dock, `TabWindow.createTab` on a tear-off, and `restoreLayout` on a saved arrangement. `setTabName` has no equivalent write-back, but that is not the same gap: the same plan deliberately moved the *label* off the constraint and onto `component.setName()` precisely so it survives a re-home, so the label already has a durable home elsewhere while the glyph's only home is the constraint. The write-back stays on `Tab` rather than `TabBar` because `TabBar` is documented as a pure dependency sink that never touches content, a `Window`, or a `Tab` — reaching a container's constraint map from the bar would break that. When a tab was added with no constraints at all, `applyTabGlyph` mints a `LayoutConstraints` and registers it, which is the same thing `LayoutSerialization.constraintsFor` does on restore.

[^clear-convention]: `plans/implemented/typed-style-setters-and-clear-api.md` removed the `| null` overload from both `Button#setGlyph` and `WindowHeader#setGlyph` and introduced `clearGlyph()` in its place, as part of a repo-wide harmonisation onto a `setX` / `clearX` pair. Taking `string | null` here would reintroduce exactly the shape that pass deleted, one call level above the method it deleted it from. The clear path costs nothing to support: `Button.clearGlyph` already exists and `_rebuildContentRow` already handles the no-glyph topology. `Column.setHeaderGlyph` still accepts `null` alongside its `clearHeaderGlyph`, but it predates the harmonisation and is not the method being wrapped here.

[^dispose-outgoing]: `plans/implemented/component-lifecycle-leak-fixes-round-2.md` sets the rule under the heading *"A discarded child is disposed where it is discarded"*, and applied it to the two other glyph-swap sites in the codebase — `component/tree/renderer/IconLabel.ts` and `component/list/renderer/Glyph.ts` — where a glyph change now calls `this._icon?.dispose()`. `Button.setGlyph` was never brought in line. It reassigns `_glyph` and calls `_rebuildContentRow`, whose `removeAllComponents` is documented detach-only, so the replaced glyph stays alive holding its element handle and its per-instance stylesheet rule. That is a rounding error for a button whose glyph is set once, and it is not for a method this plan is turning into a supported repeated operation. The dispose is scoped to the glyph the caller replaced or cleared: `_text` and `_description` are *reparented* by the same rebuild between its two topologies and must never be disposed. Disposal is safe for existing callers because no site in the library holds a `getGlyph()` result across a `setGlyph` — every one of `VideoPlayer`, `Dialog`, `Window`, `Notification`, `ComboBox`, `ToolBar`, `SpinButton` and `table/Header` re-reads it at each use. Doing this as separate follow-up work was rejected: the leak is one stranded `Glyph` per swap — its element handle and its per-instance stylesheet rule — on the exact call pattern this API exists to serve, so shipping the API without it means shipping a known leak.

---

## Implementation Notes

- **`packages/lib/tests/component/dispose-full-teardown.test.ts` needed an update the plan's Files table didn't list.** Its `VideoPlayer` registry row carried `undisposedBaseline: 4`, a pre-existing, deliberately-tolerated leak: `VideoPlayer`'s constructor calls `syncFromState` (twice, once directly and once via the first render), which redundantly re-sets the play and mute buttons' already-correct glyphs. Before this plan, `Button.setGlyph` discarded each outgoing glyph without disposing it, so those four redundant swaps leaked. The disposal fix in `Button.setGlyph` / `clearGlyph` (`## Architecture Decisions`, `Button.setGlyph and clearGlyph dispose the glyph they discard`) closes that leak as a side effect, dropping the observed balance to zero — confirmed empirically (traced via a temporary instrumented `Button.prototype.setGlyph` spy, removed afterward) rather than assumed. The row's `undisposedBaseline: 4` and its stale rationale comment are removed; the row now reads like every other zero-baseline entry, with a comment pointing at this plan for why.
- **Manual verification (M1–M3) used a temporary, reverted debug hook rather than a new demo control.** The plan's own `## Verification` section already specifies driving `setTabGlyph` from the browser console against `TabDemoPanel`'s existing glyph-bearing "Alpha" tab, and the Files table does not list `TabDemoPanel.ts` — so no demo UI was added. To get a console handle on the running demo's `TabPanel` instance, `packages/lib/src/typescript/main.ts` was temporarily edited to stash it on `window`, exercised via `npm run dev` + a browser, and the edit was reverted before committing; no trace of it remains on this branch. All three cases passed: M1 (swapping a selected, hovered, closeable tab's glyph left its fill, border, selection and close ✕ undisturbed), M2 (a glyph swapped on a button with a forced non-default line height re-synced to the same size, not an unsynced construction size), and M3 (a glyph-to-glyph swap left every tab's width unchanged; adding a glyph where none existed widened only that tab).
