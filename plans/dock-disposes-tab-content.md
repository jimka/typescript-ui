---
touches-shared:
  - packages/lib/src/typescript/lib/layout/Tab.ts
  - packages/lib/src/typescript/lib/layout/LayoutConstraints.ts
  - packages/lib/src/typescript/lib/layout/LayoutSerialization.ts
  - packages/lib/src/typescript/lib/overlay/Dock.ts
  - packages/lib/src/typescript/lib/overlay/Notification.ts
  - packages/lib/src/typescript/lib/component/container/TabBar.ts
  - packages/lib/src/typescript/lib/component/container/TabPanel.ts
  - packages/lib/docs/reference/migration.md
  - packages/lib/docs/reference/changelog/index.md
---

# Closing a Tab Destroys Its Content — Implementation Plan

## Overview

Closing a tab removes its content component from the container and drops the strip cell, but never destroys either. [`Tab.closeEntry`](packages/lib/src/typescript/lib/layout/Tab.ts#L1088) calls `container.removeComponent(content)` ([Tab.ts:1111](packages/lib/src/typescript/lib/layout/Tab.ts#L1111)), which only detaches — it deliberately does not tear down, because a removed child may be re-parented by a move. Nothing else calls `dispose()`. So no `destructor()` anywhere in the closed subtree runs, and every per-instance `#uuid` stylesheet rule that subtree allocated stays on the shared sheet for the life of the page. [`TabBar.removeBarEntry`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1568) has the same gap for the strip cell's own button, and [`Notification.finishDismiss`](packages/lib/src/typescript/lib/overlay/Notification.ts#L574) has it for a dismissed toast.

The cost is measurable in a real consumer. Opening and closing one 20-column, 42-row table tab in SQLAdmin strands **2288** rules per cycle, linearly; after four cycles 15,385 of 15,923 rules on the sheet were orphaned. Live components and DOM nodes returned to baseline each cycle, so nothing is retained in memory — but style recalculation cost grows with the size of the sheet, so a long session degrades.[^gc-backstop] The 0.4.0 row-pool fix ([`VirtualRowView.destructor`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L125)) is present and correct; it is simply never reached.

This plan makes a tab close a **destroy**: `Tab.closeEntry` disposes the content it removed, `TabBar.removeBarEntry` disposes the cell button it dropped, `Notification.finishDismiss` disposes the toast, and a new per-child constraint `disposeOnClose` lets a caller keep a component it intends to re-use. [`Dock`](packages/lib/src/typescript/lib/overlay/Dock.ts#L212) and [`TabPanel`](packages/lib/src/typescript/lib/component/container/TabPanel.ts#L82) forward that constraint from their own spec objects, and layout serialization is widened to carry it — along with `closeable` and `tooltip`, which a restore drops today — so a restored tab keeps the behaviour it was registered with.

---

## Architecture Decisions

### `Tab` owns the disposal, not `Dock`

The disposal happens in [`Tab.closeEntry`](packages/lib/src/typescript/lib/layout/Tab.ts#L1088) — the single close implementation shared by the ✕ click, the right-click context menu's close items, and the public `Tab.closeTab`. Every close in the library reaches it, including `Dock.removePanel` (which delegates to `closeTab` at [Dock.ts:1750](packages/lib/src/typescript/lib/overlay/Dock.ts#L1750)) and `TabPanel`'s closeable tabs.[^why-tab]

This follows [`AbstractWindow.onExitAction`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L839), which ends in `this.destructor()` — a window's chrome ✕ already destroys its whole content subtree. A tab's ✕ is the same gesture on a different container and should mean the same thing.

### Destroying is the default; `disposeOnClose: false` is the opt-out

`LayoutConstraints` gains `disposeOnClose?: boolean`. `Tab` reads it as opt-**out**: unset or `true` destroys, only an explicit `false` keeps the component alive.[^default-destroy]

`Dock` exposes it as `DockPanelSpec.disposeOnClose` and `TabPanel` as an `addTab` / `addLazyTab` option, each forwarding into the constraint it already builds.

### A content component that was re-homed during `"tabclose"` is never destroyed

`Tab` emits `"tabclose"` first, then destroys. If a listener re-parented the content (`otherContainer.moveComponent(content)`), it now has a parent again and `Tab` leaves it alone.[^parent-guard]

The full rule, and the cases it settles:

| Case | `disposeOnClose` | Content's parent once `"tabclose"` listeners have run | Destroyed? |
|---|---|---|---|
| Ordinary closeable tab | unset (default) | none | yes |
| `Dock` empty-state placeholder | `false` | none | no |
| Listener re-homed the content | unset | the new container | no |
| Tab closed while its lazy factory is still running | unset | no content exists yet | nothing to destroy now; the built component is destroyed when it arrives |
| Tab torn off into a float window | — | the float's container | no — a tear-off is not a close, see the next decision |

### The tear-off path is untouched

[`Tab.removeEntryKeepingContent`](packages/lib/src/typescript/lib/layout/Tab.ts#L2050) — the tear-off and cross-strip re-dock path — drops the strip cell without taking the content out of the container and without emitting `"tabclose"`, and must keep doing exactly that. Only `closeEntry` gains the destroy. The cell **button** is destroyed on both paths, because both mint a fresh cell at the destination.

### An in-flight async build needs no new machinery

A tab closed while its content factory is still running is already handled end to end, and this plan adds nothing for it. `closeEntry` cancels the entry's materialization ([Tab.ts:1105](packages/lib/src/typescript/lib/layout/Tab.ts#L1105)); [`Animation.materialize`](packages/lib/src/typescript/lib/core/Animation.ts#L532) then destroys the component the factory eventually produced rather than attaching it ([Animation.ts:551](packages/lib/src/typescript/lib/core/Animation.ts#L551), [Animation.ts:559](packages/lib/src/typescript/lib/core/Animation.ts#L559)). For a `Dock` lazy panel the same holds one level in: destroying the panel's identity frame detaches the frame's own `Tab`, and [`Tab.detach`](packages/lib/src/typescript/lib/layout/Tab.ts#L969) cancels every in-flight materialization it owns.[^async-covered]

### The restore path is fixed at its source, in `LayoutSerialization`

[`serializeLayout`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts) captures only a leaf's `glyph`, so a restored tab loses `closeable` (its ✕ disappears) and would lose `disposeOnClose` (its opt-out silently reverting to destroy). `PanelNode` therefore gains `closeable`, `tooltip` and `disposeOnClose` alongside `glyph`, captured in `nodeFor` and rebuilt in `constraintsFor` ([LayoutSerialization.ts:391](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L391)).

Repairing the capture is the whole fix. `Dock` gets no compensating re-apply after `setLayoutState`, and no other caller of `restoreLayout` needs one: a defect in one part of the library is corrected where it lives, never patched from another part.[^restore-fix]

### A dismissed notification is destroyed

[`Notification.finishDismiss`](packages/lib/src/typescript/lib/overlay/Notification.ts#L574) calls `removeElement()`, which strips the DOM node but leaves the toast's and its close button's rules on the sheet. It calls `dispose()` instead. A dismissed toast is unreachable — `Notification.show` returns `void` and the instance is dropped from the private static active list on the line above — so this is a pure destroy with no consumer-visible contract change.[^notification]

### `Tab` is the only *container* with this gap

Every other content-owning container in the library either already destroys on its destroy verb or has no destroy verb at all, so none is changed here.[^siblings]

| Container | Destroy verb | Destroys its content today? |
|---|---|---|
| `Tab` (and `TabPanel`, `Dock` tabs) | tab ✕ / `closeTab` / `removePanel` | **no** — this plan |
| `Window` / `TabWindow` / `Dialog` | chrome ✕ | yes — `onExitAction` calls `destructor()` |
| `Accordion` | none — `closeSection` collapses | n/a |
| `Split` | none — a pane collapses, never closes | n/a |
| `Border` | none | n/a |

`Notification` is not a container — it owns its own message and chrome — but its dismiss is the same defect in the same shape, which is why it is fixed alongside.

### Ships as 0.4.1

The library takes breaking changes in point releases before 1.0, so a behaviour change does not force a minor bump: this ships as `0.4.1`, with the migration-page entry that the project's compatibility policy actually requires.[^version] This plan writes the changelog page and the migration entry; it does **not** touch any `package.json` version.

---

## Public API

New per-child constraint ([`LayoutConstraints`](packages/lib/src/typescript/lib/layout/LayoutConstraints.ts#L14)):

```typescript
/**
 * Whether closing this component's tab destroys it. Read by the `Tab`
 * manager only, where it defaults to `true`: a closed tab's content is
 * disposed, releasing its element, handles and per-instance stylesheet
 * rules. Pass `false` for a component the caller owns and intends to
 * re-use after the tab closes. Ignored by every other layout manager,
 * and by the tear-off / re-dock path, which relocates rather than closes.
 */
disposeOnClose?: boolean;
```

New field on `DockPanelSpec` ([Dock.ts:26](packages/lib/src/typescript/lib/overlay/Dock.ts#L26)):

```typescript
/**
 * Whether closing this panel's tab destroys its content. Defaults to
 * `true`. Pass `false` when `content` is a live component you hold and
 * intend to re-add later; a factory needs no opt-out, since a re-add
 * rebuilds through it.
 */
disposeOnClose?: boolean;
```

Widened `PanelNode` ([LayoutSerialization.ts:54](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L54)) — all optional, so a state written by an earlier version still parses:

```typescript
export interface PanelNode {
    kind:            "panel";
    panelId:         string;
    glyph?:          string | null;
    /** Captured from the leaf's `LayoutConstraints.tooltip`. */
    tooltip?:        string | null;
    /** Captured from the leaf's `LayoutConstraints.closeable`. */
    closeable?:      boolean;
    /** Captured from the leaf's `LayoutConstraints.disposeOnClose`. */
    disposeOnClose?: boolean;
}
```

Widened `TabPanel` surface ([TabPanel.ts:131](packages/lib/src/typescript/lib/component/container/TabPanel.ts#L131), [TabPanel.ts:157](packages/lib/src/typescript/lib/component/container/TabPanel.ts#L157)) and its `tabs` option entry:

```typescript
interface TabEntryConfig {
    // ...existing fields unchanged...
    /** Whether closing this tab destroys its content. Defaults to `true`. */
    disposeOnClose?: boolean;
}

addTab(
    component: Component | ComponentFactory,
    label: string,
    options?: { closeable?: boolean; glyph?: string; lazy?: boolean; disposeOnClose?: boolean },
): this;

addLazyTab(
    factory: ComponentFactory,
    label: string,
    options?: { closeable?: boolean; glyph?: string; disposeOnClose?: boolean },
): this;
```

No new methods. The only signature changes are the additive option-bag and node fields above.

---

## Implementation

`Tab.closeEntry` reads the flag off the constraints `removeComponent` hands back, so there is no ordering trap: `Component.removeComponent` returns the child's constraints and deletes them in the same call ([Component.ts:5025](packages/lib/src/typescript/lib/core/Component.ts#L5025), [Component.ts:4858](packages/lib/src/typescript/lib/core/Component.ts#L4858)). The destroy sits after the `"tabclose"` emit, so every listener still sees a live component.

```typescript
let constraints: LayoutConstraints | undefined;

if (content) {
    constraints = container.removeComponent(content);
}

// ...existing spinner removal, unchanged...

if (content) {
    this.emit("tabclose", content);

    // A close is a destroy: the content, its children, and the pooled rows
    // and overlay chrome their own destructors reach all release their
    // per-instance stylesheet rules here. Skipped when the caller opted out,
    // and when a "tabclose" listener re-homed the content — it has an owner
    // again, so destroying it would take out a live subtree.
    if (constraints?.disposeOnClose !== false && content.getParentComponent() === null) {
        content.dispose();
    }
}
```

`constraintsFor` builds a constraints object when the node carries any captured field, not only a glyph:

```typescript
function constraintsFor(node: LayoutNode): LayoutConstraints | undefined {
    if (node.kind !== "panel") {
        return undefined;
    }

    const carries = node.glyph != null
        || node.tooltip != null
        || node.closeable !== undefined
        || node.disposeOnClose !== undefined;

    if (!carries) {
        return undefined;
    }

    const constraints = new LayoutConstraints();

    constraints.glyph          = node.glyph ?? null;
    constraints.tooltip        = node.tooltip ?? null;
    constraints.closeable      = node.closeable;
    constraints.disposeOnClose = node.disposeOnClose;

    return constraints;
}
```

`TabBar.removeBarEntry` ends with `entry.button.dispose()`, after every existing unhook (`removeButton`, `_rovingTabIndex.remove`, `_tabClip.removeItem`, the `contextmenu` subtree listener, `Tooltip.detach`). `removeItem` only detaches ([`ScrollStrip.removeItem`](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts)), so nothing else reaches the button.

---

## Ordered Implementation Steps

**Tests first** — each behavioural step below has its case in `## Expected Behaviour`; write the test, watch it fail, then make it pass. Step 1 declares the new constraint field ahead of the tests so they compile; every behavioural change comes after them.

1. `packages/lib/src/typescript/lib/layout/LayoutConstraints.ts` — add the `disposeOnClose?: boolean` field with the JSDoc from `## Public API`, placed after `lazy` ([LayoutConstraints.ts:64](packages/lib/src/typescript/lib/layout/LayoutConstraints.ts#L64)) and before `transient`.

2. Create `packages/lib/tests/layout/Tab.closeDisposal.test.ts`, beside the existing [`tests/layout/DockRegion.styleRuleDisposal.test.ts`](packages/lib/tests/layout/DockRegion.styleRuleDisposal.test.ts). Mirror the harness in [`tests/overlay/Dock.styleRuleDisposal.test.ts`](packages/lib/tests/overlay/Dock.styleRuleDisposal.test.ts): `installTestDOM(CONFIG)` with the shared `CONFIG` bag, `afterEach(() => DOM.reset())`, and `_ruleCacheKeys()` from `~/core/StyleTarget` for the rule inventory. Copy the local `collectIds(component)` helper from [`tests/component/dispose-full-teardown.test.ts`](packages/lib/tests/component/dispose-full-teardown.test.ts) so each assertion is scoped to the ids of the subtree under test rather than to the whole sheet. Cover cases **T1**–**T5**.

3. Create `packages/lib/tests/overlay/Dock.closeDisposal.test.ts`. Reuse the `mountDock` / `captureRaf` / `flush` harness from [`tests/overlay/Dock.lifecycle.test.ts`](packages/lib/tests/overlay/Dock.lifecycle.test.ts) — the sweep and the post-close focus recompute both run on a captured `requestAnimationFrame`. Cover cases **D1**–**D5**.

4. Extend `packages/lib/tests/component/layout/LayoutSerialization.test.ts` with cases **S1**–**S2**, and create `packages/lib/tests/overlay/Notification.styleRuleDisposal.test.ts` for case **N1**.

5. `packages/lib/src/typescript/lib/layout/Tab.ts` — rewrite `closeEntry` ([Tab.ts:1088](packages/lib/src/typescript/lib/layout/Tab.ts#L1088)) per `## Implementation`: capture the constraints `removeComponent` returns, and destroy after the `"tabclose"` emit under the two guards. Update the method's own doc comment and the class-level `"tabclose"` note at [Tab.ts:29](packages/lib/src/typescript/lib/layout/Tab.ts#L29) to say a close destroys the content.

6. `packages/lib/src/typescript/lib/layout/Tab.ts` — extend the `closeTab` JSDoc ([Tab.ts:1147](packages/lib/src/typescript/lib/layout/Tab.ts#L1147)) and the `"tabclose"` `on` overload doc ([Tab.ts:2258](packages/lib/src/typescript/lib/layout/Tab.ts#L2258)) with the destroy contract and the `disposeOnClose` opt-out. Leave `removeEntryKeepingContent` ([Tab.ts:2050](packages/lib/src/typescript/lib/layout/Tab.ts#L2050)) untouched.

7. `packages/lib/src/typescript/lib/component/container/TabBar.ts` — add `entry.button.dispose();` as the last statement of `removeBarEntry` ([TabBar.ts:1568](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1568)), after the `_activeId` reset and before `return this`, with a comment naming the two callers (`Tab.closeEntry`, `Tab.removeEntryKeepingContent`) and why both genuinely destroy the cell.

8. `packages/lib/src/typescript/lib/overlay/Dock.ts` — add `disposeOnClose?: boolean` to `DockPanelSpec` ([Dock.ts:26](packages/lib/src/typescript/lib/overlay/Dock.ts#L26)) with the JSDoc from `## Public API`, and forward it in `leafConstraints` ([Dock.ts:638](packages/lib/src/typescript/lib/overlay/Dock.ts#L638)) as `constraints.disposeOnClose = spec.disposeOnClose ?? true;`, beside the existing `closeable` line. `addPanel`, `addLazyPanel` and `compileTabs` all route through `leafConstraints`, so no other call site changes.

9. `packages/lib/src/typescript/lib/overlay/Dock.ts` — set `constraints.disposeOnClose = false;` in `placeholderConstraints` ([Dock.ts:1014](packages/lib/src/typescript/lib/overlay/Dock.ts#L1014)), beside `closeable` and `transient`. The placeholder is consumer-owned chrome that `hideEmptyState` closes through `closeTab` ([Dock.ts:982](packages/lib/src/typescript/lib/overlay/Dock.ts#L982)) and `showEmptyState` re-mounts. Nothing else in `Dock` changes — in particular, `setLayoutState` gets no constraint re-apply, because step 10 repairs the restore where it breaks.

10. `packages/lib/src/typescript/lib/layout/LayoutSerialization.ts` — add `tooltip`, `closeable` and `disposeOnClose` to `PanelNode` ([LayoutSerialization.ts:54](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L54)) per `## Public API`; capture all three in `nodeFor`'s panel-leaf branch beside the existing `glyph` read (same `component.getParentComponent()?.getLayoutConstraints(component)` lookup); and rewrite `constraintsFor` ([LayoutSerialization.ts:391](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L391)) per `## Implementation`. Update both doc comments: `constraintsFor` no longer describes itself as glyph-only.

11. `packages/lib/src/typescript/lib/overlay/Notification.ts` — in `finishDismiss` ([Notification.ts:574](packages/lib/src/typescript/lib/overlay/Notification.ts#L574)), replace `this.removeElement();` with `this.dispose();`, keeping the active-list filter above it and the `Notification.restack()` below it. Add a comment stating that a dismissed toast is discarded and never re-shown, so the dismiss is a destroy. Then add the two matching `Event.removeSubtreeListener(this, "mouseover" | "mouseout", …)` calls to `destructor()` ([Notification.ts:644](packages/lib/src/typescript/lib/overlay/Notification.ts#L644)), unhooking the pair `init` registers ([Notification.ts:234-235](packages/lib/src/typescript/lib/overlay/Notification.ts#L234)) — subtree listeners live in a module-level map keyed by component id that element removal does not purge, so a destroy that skipped them would still leak. Its existing active-list removal is already guarded by an `includes` check, so it needs no other change.

12. `packages/lib/src/typescript/lib/component/container/TabPanel.ts` — add `disposeOnClose?: boolean` to `TabEntryConfig`, widen the `addTab` and `addLazyTab` option bags per `## Public API`, forward it into the `LayoutConstraints` `addTab` builds (`constraints.disposeOnClose = options?.disposeOnClose;` — leave `undefined` alone so `Tab`'s default applies), and pass `entry.disposeOnClose` through the constructor's `tabs` loop ([TabPanel.ts:99](packages/lib/src/typescript/lib/component/container/TabPanel.ts#L99)).

13. Regression checkpoint: `grep -rln 'disposeOnClose' packages/lib/src/typescript/lib` names exactly five files — `layout/LayoutConstraints.ts`, `layout/LayoutSerialization.ts`, `layout/Tab.ts`, `overlay/Dock.ts`, `component/container/TabPanel.ts`. Within them, confirm every site from steps 1, 5, 8, 9, 10 and 12 is present.

**Documentation.**

14. `packages/lib/docs/layouts/Tab.md` — add a `disposeOnClose` row to the per-child constraints table (line 61-65) and a short paragraph under the `tabclose` event table (line 52-56) stating that a close destroys the content after the event fires, that a listener which re-homes the content keeps it, and that `disposeOnClose: false` opts out.

15. `packages/lib/docs/components/TabPanel.md` — extend the `addTab` / `addLazyTab` option list (line 37) and the `onTabClose` paragraph (line 76) with the destroy contract and the opt-out. Correct the existing sentence "the closed component is passed in so callers can dispose any external state" — the component itself is now disposed for them.

16. `packages/lib/docs/components/Dock.md` — document `DockPanelSpec.disposeOnClose` and add to the `close` event notes (line 113) that the panel's content is destroyed once the event has been delivered. Add one sentence to the `addPanel` prose (line 172): a spec whose `content` is a live component you intend to re-add needs `disposeOnClose: false`, since re-adding a registered id rebuilds the frame around the same component.

17. `packages/lib/docs/layouts/LayoutSerialization.md` — correct the two places that describe a leaf as a bare reference (line 5's `{ kind: "panel", panelId }`, and the `PanelNode` row at line 81 reading "just its `panelId`") to list the captured presentation fields, and note that a state written before 0.4.1 carries only `glyph`, so a restore from one leaves `closeable` and `disposeOnClose` at their defaults.

18. `packages/lib/docs/concepts/component-lifecycle.md` — in `## Disposal` (line 131), after the "`removeComponent` only detaches" paragraph, add that closing a tab is the one container operation that *does* dispose, and name the opt-out. Also note that a consumer's own cleanup must be a `protected destructor()` override — the recursion calls `destructor()`, so a `dispose()` method or field on a non-`Component` wrapper is never reached.

19. Create `packages/lib/docs/reference/changelog/0.4.1.md` and add its entry to `packages/lib/docs/reference/changelog/index.md`, with the content listed in `## Documentation Impact`.

20. `packages/lib/docs/reference/migration.md` — retitle the final upgrade section from `## Upgrading from 0.2.x to 0.3.0` (line 219) to `## Upgrading from 0.2.x to 0.4.0`, which is what it actually documents, then add a new `## Upgrading from 0.4.0 to 0.4.1` section before `## Versioning policy` (line 467) with the content listed in `## Documentation Impact`.

21. Run the full `## Verification` list.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/layout/LayoutConstraints.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/LayoutSerialization.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Tab.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/TabBar.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/TabPanel.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Dock.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Notification.ts` |
| Create | `packages/lib/tests/layout/Tab.closeDisposal.test.ts` |
| Create | `packages/lib/tests/overlay/Dock.closeDisposal.test.ts` |
| Create | `packages/lib/tests/overlay/Notification.styleRuleDisposal.test.ts` |
| Modify | `packages/lib/tests/component/layout/LayoutSerialization.test.ts` |
| Modify | `packages/lib/docs/layouts/Tab.md` |
| Modify | `packages/lib/docs/layouts/LayoutSerialization.md` |
| Modify | `packages/lib/docs/components/TabPanel.md` |
| Modify | `packages/lib/docs/components/Dock.md` |
| Modify | `packages/lib/docs/concepts/component-lifecycle.md` |
| Create | `packages/lib/docs/reference/changelog/0.4.1.md` |
| Modify | `packages/lib/docs/reference/changelog/index.md` |
| Modify | `packages/lib/docs/reference/migration.md` |

---

## Expected Behaviour

All cases below are unit-testable under the offline harness. The three manual checks are called out separately at the end.

**`Tab` — `packages/lib/tests/layout/Tab.closeDisposal.test.ts`**

- **T1 — a closed tab's content subtree leaves no rule behind.** Build a `Container` with a `Tab` manager, add a content component that itself has a registered child, render and `doLayout()` so both materialise their rules. Snapshot `collectIds(content)`. Call `tab.closeTab(content)`. No id in that snapshot appears in `_ruleCacheKeys()`.
- **T2 — `disposeOnClose: false` keeps the content alive.** Same setup, but the content is added with constraints carrying `disposeOnClose = false`. After `closeTab`, the content's own `#uuid` rule is still in `_ruleCacheKeys()`, and re-adding it to a second container and laying out succeeds.
- **T3 — a content re-homed during `"tabclose"` survives.** Register a `"tabclose"` listener that calls `other.moveComponent(content)`. After `closeTab`, the content's rule is still present and `content.getParentComponent()` is `other`.
- **T4 — a tear-off does not destroy the content.** Call the private `detachTabToWindow(id, content, x, y, false)` ([Tab.ts:2090](packages/lib/src/typescript/lib/layout/Tab.ts#L2090)) through the private-surface cast the existing disposal tests use. The content's rule survives; the cell button's rules do not.
- **T5 — the closed cell's button leaves no rule behind.** Snapshot `collectIds(button)` for the strip's cell button before the close (reachable via the bar's entry list on `Tab`'s private `_bar`). After `closeTab`, none of those ids is in `_ruleCacheKeys()`.

**`Dock` — `packages/lib/tests/overlay/Dock.closeDisposal.test.ts`**

- **D1 — `removePanel` destroys the panel's whole subtree.** `addPanel` a spec whose `content` is a component with a child, `doLayout()`, `flush()`, then `removePanel(id)`. No id under the panel content appears in `_ruleCacheKeys()`.
- **D2 — the `"close"` event is delivered before the destroy.** A `dock.on("close", …)` listener registered before the close records `_ruleCacheKeys()` from inside the handler; the frame's own `#uuid` rule is still present there, and gone once `removePanel` returns.
- **D3 — the empty-state placeholder survives an empty → populated → empty cycle.** Construct a dock with `emptyContent`, `flush()` so the placeholder mounts, `addPanel` one panel (which calls `hideEmptyState`), `flush()`, then `removePanel` it and `flush()` again. The placeholder's `#uuid` rule is present throughout and the placeholder is parented to the root region at the end.
- **D4 — a panel closed while its lazy factory is in flight destroys the late arrival.** `addLazyPanel` with a factory returning a deferred promise, activate the tab, `flush()` so `materializeAsync` starts, `removePanel(id)`, then resolve the promise. The built component's `#uuid` rule never appears in `_ruleCacheKeys()`, and no `"exception"` is emitted.
- **D5 — an opt-out survives a save / restore round trip.** `addPanel` a spec with `disposeOnClose: false` and a live `content` component, `getLayoutState()`, `setLayoutState(state)`, `flush()`, then `removePanel(id)`. The content's `#uuid` rule is still present.

**Layout serialization — `packages/lib/tests/component/layout/LayoutSerialization.test.ts`**

- **S1 — a captured leaf round-trips its presentation and disposal constraints.** Add a leaf to a `Tab` region with constraints `{ glyph: "star", tooltip: "T", closeable: true, disposeOnClose: false }`, `serializeLayout`, then `restoreLayout` onto a fresh root with a factory returning the same component. The re-homed leaf's constraints report all four values.
- **S2 — a state written without the new fields still restores.** Hand `restoreLayout` a hand-built state whose panel node carries only `{ kind: "panel", panelId, glyph }`. The restore succeeds, the glyph is applied, and `closeable` / `disposeOnClose` read back `undefined`.

**`Notification` — `packages/lib/tests/overlay/Notification.styleRuleDisposal.test.ts`**

- **N1 — a dismissed toast leaves no rule behind.** Call `Notification.show("msg")`, reach the instance through the private static `activeNotifications` list, snapshot `collectIds(toast)`, then call the private `finishDismiss()`. No id in that snapshot appears in `_ruleCacheKeys()`, and a following `Notification.pauseAll()` / `resumeAll()` pair does not throw (the disposed toast really left the active list).

**Manual verification** (the offline harness cannot drive these):

- Tearing a tab off into a float window and dragging it back onto a strip keeps the panel rendering correctly — the button destroy in `removeBarEntry` runs on that path too.
- Closing a tab through the right-click context menu's **Close**, **Close others** and **Close all** items destroys each closed tab's content, and the surviving tabs still render and switch.
- In the demo app, several toasts stacked and left to auto-dismiss disappear one by one with the survivors re-stacking correctly, and the demo `TabPanel` panel's Beta and Gamma tabs close leaving the strip usable.

---

## Verification

- `npm run typecheck` — clean.
- `npm run lint` — clean.
- `npm run test` — full suite green. Pay attention to the existing `tests/overlay/Dock.lifecycle.test.ts`, `tests/overlay/Dock.styleRuleDisposal.test.ts`, `tests/overlay/Notification.test.ts`, `tests/component/layout/LayoutSerialization.test.ts`, `tests/component/dispose-full-teardown.test.ts` and any `TabBar` / drag test: the three new destroy sites and the serialization change are on their paths.
- The step 13 checkpoint: `grep -rln 'disposeOnClose' packages/lib/src/typescript/lib` names exactly the five files listed there.
- `grep -n 'content.dispose()' packages/lib/src/typescript/lib/layout/Tab.ts` — exactly one hit, inside `closeEntry`.
- `grep -n 'button.dispose()' packages/lib/src/typescript/lib/component/container/TabBar.ts` — exactly one hit, inside `removeBarEntry`.
- `grep -n 'removeElement()' packages/lib/src/typescript/lib/overlay/Notification.ts` — zero hits.
- `npm run docs:api` — must finish with **zero** warnings (the new JSDoc `{@link}`s must only name exported, non-internal symbols).
- `npm run build:lib` — succeeds.
- Manual: run the demo app and exercise the three manual cases in `## Expected Behaviour`.

---

## Documentation Impact

`LayoutConstraints`, `DockPanelSpec`, `PanelNode` and `TabPanel` are all public API — `LayoutConstraints` and `PanelNode` are re-exported from `layout/index.ts` ([lines 48-49](packages/lib/src/typescript/lib/layout/index.ts#L48)), `DockPanelSpec` from `overlay/index.ts`, `TabPanel` from `component/container/index.ts` — so the change needs both a changelog page and a migration entry. The `Notification` fix changes no signature and no consumer-visible contract (`show` returns `void` and the instance is never handed out), so it earns a changelog *Fixed* line and no doc-page edit. `packages/lib/llms.txt` is a capability index keyed by component and needs no edit.

**`packages/lib/docs/reference/changelog/0.4.1.md`** (new), with `packages/lib/docs/reference/changelog/index.md` gaining `- [0.4.1](/reference/changelog/0.4.1)` at the top of its version list:

- Under `## Breaking changes` → `### Layout`: closing a tab now disposes its content component. `Tab` (and therefore `TabPanel` and `Dock`) treats a close as a destroy — the content, its children, and everything their `destructor()` overrides reach are torn down and their per-instance stylesheet rules released. A caller that holds a closed tab's component to re-add later must pass the new `LayoutConstraints.disposeOnClose: false` (or `DockPanelSpec.disposeOnClose: false`, or `TabPanel.addTab`'s `disposeOnClose: false`). A `"tabclose"` listener that re-parents the content also keeps it. Tear-off and re-dock are unaffected.
- Under `## Added` → `### Layout`: `LayoutConstraints.disposeOnClose`, `DockPanelSpec.disposeOnClose`, a `disposeOnClose` option on `TabPanel.addTab` / `addLazyTab` / the `tabs` config entries, and `PanelNode.tooltip` / `.closeable` / `.disposeOnClose` on the serialized layout leaf.
- Under `## Fixed` → `### Layout`: a closed tab no longer strands its content's — or its own strip button's — stylesheet rules on the shared sheet. Closing one 20-column, 42-row table tab used to leak 2288 rules per open/close cycle, without bound. A restored layout now also keeps each tab's `closeable`, `tooltip` and `disposeOnClose`, which `serializeLayout` previously dropped (only the glyph survived), so a restored tab no longer silently loses its ✕.
- Under `## Fixed` → `### Overlay`: a dismissed `Notification` is now disposed rather than only removed from the DOM, releasing its own and its close button's stylesheet rules and unhooking its two subtree listeners.

**`packages/lib/docs/reference/migration.md`**:

- Retitle `## Upgrading from 0.2.x to 0.3.0` to `## Upgrading from 0.2.x to 0.4.0`. The section documents 0.3.0's *and* 0.4.0's breaking changes; only the heading is wrong.[^migration-title]
- Add `## Upgrading from 0.4.0 to 0.4.1` before `## Versioning policy`, containing one `### Closing a tab now destroys its content` subsection. It is the specification a real consumer will follow, so it must carry all of:
  - **What changed and why** — a closed tab's content, and everything below it, is now disposed; before, nothing was, and the shared stylesheet grew without bound across open/close churn.
  - **Who needs to act** — nobody who discards a closed tab's content, which is the normal case. Action is needed only where a component is re-used after its tab closes.
  - **The three opt-out spellings** — `LayoutConstraints.disposeOnClose: false`, `DockPanelSpec.disposeOnClose: false`, `TabPanel.addTab(..., { disposeOnClose: false })` — plus the re-homing escape: a `"tabclose"` listener that re-parents the content keeps it alive with no flag. The opt-out survives a `getLayoutState` / `setLayoutState` round trip.
  - **The `Dock` case worth checking** — a `DockPanelSpec` whose `content` is a live component that is re-added after a close. A spec whose `content` is a factory needs nothing, because a re-add rebuilds through the factory.
  - **What a consumer's own disposal registry can now delete.** Any registry that existed only to dispose a panel when its tab closed becomes dead code — including the flag that gated it, the per-panel `register` call, and the in-flight `beginLoad` / `settle` token pair. The in-flight case is covered by the library: closing a tab cancels that tab's materialization, and the materialize helper then disposes the component the factory later produces instead of mounting it, so nothing arrives unowned and no token is needed to recognise an abandoned build.
  - **What stays the consumer's job, and where it must live.** Releasing a resource the panel owns — terminating a worker, closing a socket, clearing an interval — is still app code. It moves into a `protected destructor()` override on the panel's `Component` subclass, ending in `super.destructor()`.
  - **The wrapper trap, stated in full.** Teardown recursion calls `destructor()` on each registered child. A `dispose()` **method or arrow-field on a plain object that wraps a `Component`** is therefore never reached — the wrapper is not in any parent's child list, and even a `dispose()` on a `Component` subclass is not what the recursion calls. A consumer must audit every composition wrapper that declares `dispose`: either move its body into a `protected destructor()` override on a `Component` subclass, or have an owning `Component`'s `destructor()` call the wrapper explicitly. An empty or no-op `dispose` on such a wrapper is the signal that cleanup was never wired at all.

---

## Potential Challenges

- **Destroying the cell button could disturb an in-flight drag.** `removeBarEntry` runs from the tear-off / re-dock path as well as from a close. Mitigation: the destroy is the last statement, after every unhook, and `TabBar`'s drag machinery emits `"detach"` / `"tearoffrequested"` as its final act and holds no field pointing at the button; the manual tear-off and re-dock check in `## Expected Behaviour` is the guard.
- **The `Dock` placeholder is consumer-owned and closed by the library.** Destroying it would hand the consumer a corpse. Mitigation: step 9 sets the opt-out on `placeholderConstraints`. A close precedent exists: `Accordion.detach()` destroying a consumer-owned header tool was found and fixed the same way in `plans/implemented/scrollbar-leak-and-layout-guards.md`.
- **`Notification.dispose()` runs from inside its own dismiss animation's `onComplete`.** The destructor cancels that same animation handle. Mitigation: this is the shape `AbstractWindow.onExitAction` already uses — its `finalize`, called from the close animation's `onComplete`, calls `destructor()`, which cancels `_closeAnimation`. Case **N1** exercises `finishDismiss` directly, so the path is covered even though the offline harness cannot run the animation.
- **A saved layout from an earlier version has no `closeable` / `disposeOnClose`.** Mitigation: both fields are optional and absent means "unset", which is exactly today's post-restore behaviour, so nothing regresses. No panel can have opted out in such a state, because the field ships in this release. Case **S2** pins it.
- **A second destroy of an already-destroyed component.** `Component.dispose()` is documented idempotent ([Component.ts:736](packages/lib/src/typescript/lib/core/Component.ts#L736)), so a close following a consumer's own `dispose()` is a harmless no-op.

---

## Critical Files

- [`packages/lib/src/typescript/lib/layout/Tab.ts`](packages/lib/src/typescript/lib/layout/Tab.ts) — `closeEntry` (1088), `closeTab` (1147), `detach` (969), `removeEntryKeepingContent` (2050), `materializeAsync` (1583).
- [`packages/lib/src/typescript/lib/component/container/TabBar.ts`](packages/lib/src/typescript/lib/component/container/TabBar.ts) — `BarEntry` (195), `removeBarEntry` (1568).
- [`packages/lib/src/typescript/lib/layout/LayoutSerialization.ts`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts) — `PanelNode` (54), `nodeFor` (201), `serializeLayout` (278), `constraintsFor` (391), `restoreLayout` (561).
- [`packages/lib/src/typescript/lib/overlay/Dock.ts`](packages/lib/src/typescript/lib/overlay/Dock.ts) — `DockPanelSpec` (26), `setLayoutState` (549), `resolvePanel` (575), `leafConstraints` (638), `showEmptyState` (944), `hideEmptyState` (968), `placeholderConstraints` (1014), `onPanelClosed` (1482), `removePanel` (1737).
- [`packages/lib/src/typescript/lib/overlay/Notification.ts`](packages/lib/src/typescript/lib/overlay/Notification.ts) — `show` (246), `finishDismiss` (574), `restack` (586), `destructor` (644).
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — `dispose` (736), `destructor` (753), `unwireChild` (4858), `removeComponent` (5025).
- [`packages/lib/src/typescript/lib/core/Animation.ts`](packages/lib/src/typescript/lib/core/Animation.ts) — `materialize` (532) and its cancelled / stale destroy branches (547-565).
- [`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts:839`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L839) — the precedent this plan mirrors: a chrome ✕ ends in `destructor()`.
- [`packages/lib/tests/overlay/Dock.styleRuleDisposal.test.ts`](packages/lib/tests/overlay/Dock.styleRuleDisposal.test.ts) and [`packages/lib/tests/component/dispose-full-teardown.test.ts`](packages/lib/tests/component/dispose-full-teardown.test.ts) — the `_ruleCacheKeys()` / `collectIds` harness the new tests reuse.
- [`packages/lib/tests/overlay/Dock.lifecycle.test.ts`](packages/lib/tests/overlay/Dock.lifecycle.test.ts) — the `captureRaf` / `flush` harness for the `Dock` tests.
- `plans/implemented/component-teardown-seam.md` and `plans/implemented/component-style-rule-disposal.md` — the disposal contract this plan extends.

---

## Non-Goals

- **Making `removeComponent` destroy.** It is the move-safe verb `moveComponent` is built on; destroying there would corrupt every re-parent. This is settled in `plans/implemented/component-style-rule-disposal.md`.
- **Purging a disposed component's `Event` listener buckets in general.** `Component.destructor()` does not unregister the module-level, id-keyed listener maps, so every disposed component leaves entries behind. This plan unhooks only the pair on the class it touches (`Notification`), matching what `TabBar.removeBarEntry` already does for its own; the framework-wide fix is a separate change, not a workaround for one.
- **Carrying every `LayoutConstraints` field through serialization.** Only the four a tab's appearance and close behaviour depend on are captured. `weight`, `collapsible`, `fill` and friends belong to managers whose own state serialization already covers them.
- **Any app-side change.** SQLAdmin's hand-rolled panel-disposal registry becomes unnecessary once the library owns teardown, but removing it is the consumer's work — driven by the migration entry this plan specifies.

---

## Notes

[^gc-backstop]: The rules are not permanently unreclaimable — `Component` registers a `FinalizationRegistry` finalizer holding a snapshot of the selectors it allocated, so a garbage-collected component's rules are deleted eventually (`plans/implemented/component-style-rule-disposal.md`, *Dual disposal*). That is a best-effort backstop with no timing guarantee, and it demonstrably did not fire during the measured session: four open/close cycles grew the sheet perfectly linearly at +2288 rules each while live component and DOM-node counts returned to baseline. The eager `destructor()` path is the only one with deterministic timing, which is why the fix belongs on the close path rather than being left to GC.

[^why-tab]: `Dock.onPanelClosed` ([Dock.ts:1482](packages/lib/src/typescript/lib/overlay/Dock.ts#L1482)) was the other candidate — it already receives the closed identity frame and evicts it from the registry. Fixing it there would leave `TabPanel` and every bare `Container` + `Tab` consumer with the same trap, and would need a second fix in `Dock.onFloatClosed` for the float path. `Tab.closeEntry` is upstream of both: `Dock.removePanel` delegates to `Tab.closeTab`, and a float's chrome ✕ already destroys its subtree through `AbstractWindow.onExitAction`.

[^default-destroy]: Opt-in was the alternative and is what the consuming app hand-rolled — SQLAdmin threaded a `disposeOnClose: true` flag through its own `openAsyncPanel` helper and a `PanelDisposers` registry. It passed the flag at nine diagram sites (which own ELK workers) and *not* at `openTable` or the structure panel, its two highest-traffic tabs — so the app built the entire workaround and still missed the panels that mattered. An opt-in default puts the leak one forgotten argument away at every call site; an opt-out puts a live corpse one forgotten argument away at the few call sites that genuinely re-use a component, where the failure is immediate and visible rather than silent and cumulative.

[^parent-guard]: Without the guard, a `"tabclose"` listener that stashes the panel by re-parenting it — a plausible consumer caching pattern, and the natural way to say "I am keeping this" — would have its live, newly-attached subtree destroyed out from under its new owner. The check costs one comparison and reuses the framework's own move-vs-discard signal: `removeComponent` nulls `_parent` ([Component.ts:4858](packages/lib/src/typescript/lib/core/Component.ts#L4858)), so a non-null parent at this point can only mean a listener re-homed it.

[^async-covered]: Traced end to end for a `Dock` lazy panel, which is the case the consuming app hits: `Dock.addLazyPanel` builds an identity frame whose own hidden-strip `Tab` runs the factory through `Animation.materialize` ([Dock.ts:595-611](packages/lib/src/typescript/lib/overlay/Dock.ts#L595)). Closing the *outer* tab destroys the frame; `Component.destructor` detaches the frame's layout manager ([Component.ts:800-804](packages/lib/src/typescript/lib/core/Component.ts#L800)); `Tab.detach` cancels each entry's `materializeAnimation` ([Tab.ts:973-976](packages/lib/src/typescript/lib/layout/Tab.ts#L973)); and `materialize`'s `attach` sees `cancelled` and calls `component.dispose()` on the arriving component instead of mounting it. The `isStale` predicate ([Tab.ts:1629](packages/lib/src/typescript/lib/layout/Tab.ts#L1629)) covers the inner-tab close the same way. Case **D4** pins it so a later change cannot quietly break the chain.

[^restore-fix]: An earlier draft compensated inside `Dock` — a private `reapplyLeafConstraints()` called from `setLayoutState` that re-derived each panel's constraints from its registered spec. It is rejected on principle and on merit. On principle: one part of the library must not work around another; only browser, CSS and HTML behaviour is outside the library's control and therefore legitimate to design around. On merit: it repaired one caller of `restoreLayout` and left every direct `Tab` consumer with the same silent loss, and it would have had a saved arrangement's values overridden by the current spec — a second, unrelated policy decision smuggled in. Fixing the capture is strictly smaller and repairs the pre-existing `closeable` loss at the same time. The `Dock` empty-state placeholder needs no compensation either: it is `transient`, so it is never captured, and `restoreLayout`'s `root.removeAllComponents()` merely detaches it — leaving it parentless, which makes `showEmptyState`'s `getParentComponent() !== region` branch re-mount it with fresh `placeholderConstraints()` on the next sweep.

[^notification]: Checked for retention before deciding: `Notification.show` is `static … : void`, so no consumer ever receives the instance; `finishDismiss` filters it out of the private static `activeNotifications` list on the line above the destroy; and the in-session history stores plain `NotificationRecord` data, not the toast. `destructor()` already exists and cancels both animation handles before `super.destructor()`, and its active-list removal is guarded by an `includes` check, so calling it from `finishDismiss` cannot double-`restack`. The two `Event.removeSubtreeListener` calls are added because element removal does not purge the module-level, id-keyed subtree-listener map — the same reason `TabBar.removeBarEntry` unhooks its `contextmenu` listener explicitly.

[^siblings]: Checked rather than assumed. `AbstractWindow.onExitAction` ends in `this.destructor()`, which recurses into the window's children — so `Window`, `TabWindow` and `Dialog` already destroy their content, and `Dock.onFloatClosed` inherits that. `Accordion.closeSection` collapses a section rather than removing it, and `Accordion.detach` already disposes the headers, panel wrappers and gutters it created. `Split` panes collapse and never close. `Border` regions have no removal verb of their own. In every one of those containers the only way to take a child out is `removeComponent`, which is the move-safe verb and correctly does not destroy. `Tab` is the sole container with a user-facing *destroy* affordance that did not destroy.

[^version]: `packages/lib/docs/reference/migration.md` states the rule this follows. Under *Versioning policy*, `0.x.y` means "anything may change in any release, including breaking the public API"; under *Pre-1.0 compatibility*, "the version number alone is not a compatibility guarantee" and what a breaking change owes the consumer is an entry on the migration page, not a particular bump size. A patch release is therefore the right vehicle: it carries the fix to a blocked consumer without implying a feature release, and the migration entry does the work the version number cannot. The bump itself stays out of this plan: `packages/lib/package.json` still reads `0.4.0` when this lands, and the version strings across the four packages are bumped as their own release step per `release-steps.md`. Writing the changelog page ahead of the bump is what that document expects — its publish-readiness check is "verify that the changelog contains everything in the coming version".

[^migration-title]: Verified subsection by subsection against the changelog pages. The section holds nine subsections: three are 0.4.0 material (*Marker lists paint their own bullets and numbers*, *`DOMSource` gained `startFontLoad`*, *`SplitGutter.destroy()` and `CollapseButton.destroy()` were removed*, all matching `changelog/0.4.0.md`'s breaking-change list), five are genuinely 0.3.0 (*`Aria.applyToElement` was removed*, *The optional `elkjs` peer moved to `^0.12.0`*, *Rewriting an element's `class` attribute drops its positioning*, *`Component._defaultOptions` is frozen and shared per class*, *`DOMSink.setRuleStyle` became `setRuleStyles`*, all matching `changelog/0.3.0.md`), and the closing *Behaviour changes worth a check* list mixes one 0.3.0 bullet with two 0.4.0 ones. So the section spans both releases and the heading names only the first — retitling to `0.2.x to 0.4.0` is accurate, whereas splitting it in two would mean re-sorting nine subsections and one mixed bullet list for no consumer benefit. The mislabelling has a traceable cause: `plans/implemented/scrollbar-leak-and-layout-guards.md`'s addendum records that its removal note was added "inside the existing `## Upgrading from 0.2.x to 0.3.0` section" because that plan named the changelog but not the migration page. This plan's own entry gets a correctly-named section, so the pattern stops here.
