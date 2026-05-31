---
touches-shared: [src/typescript/lib/component/container/TabPanel.ts]
---

# Phantom UUID Tab on the Demo App — Implementation Plan

## Overview

The top-level demo app builds a single root [`Tab`](../src/typescript/lib/layout/Tab.ts) layout manager and registers every demo screen as a **lazy** tab via `addLazyTab` ([main.ts:31-50](../src/typescript/main.ts#L31)). After the user clicks around the tab strip for a while, a spurious tab button appears at the far right whose label is a component UUID; selecting it shows the multi-select demo.

The bug is a real framework defect in the interaction between [`Animation.materialize`](../src/typescript/lib/core/Animation.ts#L411) and [`Tab.doLayout`](../src/typescript/lib/layout/Tab.ts#L600), not in the demo wiring. `materialize` permanently adds each lazily-built panel as a child of the tab container and transiently adds a spinner child on top; `Tab.doLayout`'s catch-up loop then auto-creates a tab for any container child whose index is `>= _tabs.length`, labelling it with the child's UUID because no `LayoutConstraints.name` was attached.

The fix lives in [`Tab.ts`](../src/typescript/lib/layout/Tab.ts) (the auto-`createTab` loop must not treat materialize-injected children as new eager tabs). Per the task brief, `src/typescript/lib/component/container/TabPanel.ts` is listed in `touches-shared` because the parallel modern-theme/L&F plan restyles tab buttons in the same tab subsystem; this plan does **not** edit `TabPanel.ts` and keeps its `Tab.ts` edits scoped to tab-creation logic, away from styling/layout geometry.

---

## Root Cause — Confirmed by Code Read

### 1. Lazy tabs do not pre-populate the container

`main.ts` calls `addLazyTab` 18 times. `Tab.addLazyTab` ([Tab.ts:486-492](../src/typescript/lib/layout/Tab.ts#L486)) builds a tab *entry* (button + bookkeeping) but leaves `component: null`, `state: "lazy"`. No component is added to the container. So initially `_tabs.length === 18` and `container.getComponents().length === 0`.

### 2. `materialize` adds children to the container — and never removes the built one

On first activation, `onTabPressed` → `materializeAsync` ([Tab.ts:525-559](../src/typescript/lib/layout/Tab.ts#L525)) calls `Animation.materialize`. That helper ([Animation.ts:411-441](../src/typescript/lib/core/Animation.ts#L411)) does:

```ts
host.addComponent(spinner);                 // +1 container child (transient)
...
const component = factory();
host.addComponent(component);               // +1 container child (PERMANENT)
...
onComplete: () => { host.removeComponent(spinner); ... }   // spinner removed; component stays
```

The materialized panel is appended to the tab **container** as a real child and is never removed. The spinner is added before it and removed only after the ~160 ms cross-fade. So while a tab is materializing, the container momentarily holds *(previously-materialized panels) + spinner + new panel*.

### 3. `doLayout`'s catch-up loop turns container children into tabs

`Tab.doLayout` ([Tab.ts:612-615](../src/typescript/lib/layout/Tab.ts#L612)) runs:

```ts
for (let i = this._tabs.length; i < componentCount; i += 1) {
    let component = components[i];
    this.createTab(component);
}
```

This loop fires whenever `componentCount > _tabs.length`. It exists for the **bare `Panel` + `Tab`** path, where consumers call `container.addComponent(child)` directly and expect a tab to appear; the loop's contract is "every container child beyond the known tab entries is a new eager tab." Lazy mode violates that contract: `materialize` injects container children (the built panels and the transient spinner) that are **not** meant to be new tabs.

The trigger is the count crossing `_tabs.length`. Each materialization permanently grows `componentCount` by one. Once enough tabs have been visited that the count of materialized panels reaches `_tabs.length`, the very next materialization's transient spinner (or the next built panel) pushes `componentCount` past `_tabs.length`, and `doLayout` calls `createTab` on the overflow child. *(Even before that ceiling, the same overflow can occur transiently if the container ever holds spinner + components exceeding `_tabs.length`.)* This is why the phantom appears only "after clicking the tab buttons for a while" — it needs accumulated materialized children.

### 4. Why the label is a UUID

`createTab` ([Tab.ts:433-450](../src/typescript/lib/layout/Tab.ts#L433)) derives the button label from `LayoutConstraints.name` when present, else `component.getId()`:

```ts
if (constraints && constraints.name) { name = constraints.name; }
else { name = component.getId(); }     // UUID
```

`materialize` adds its children with no constraints, so `getLayoutConstraints(component)` is empty and the label is the component's UUID — exactly the symptom.

### 5. Why the phantom's content is the multi-select panel

The overflow child that `createTab` consumes is `components[i]` at the overflow index. The multi-select demo (`MultiSelectListPanel`) is one of the heavier lazy panels, so its factory + cross-fade window is among the longest, making it the panel most likely to be the freshly-appended overflow child when `componentCount` crosses `_tabs.length`. The phantom tab's content is therefore a previously-materialized panel that got re-tabbed — observed in practice as the multi-select panel. *(The attribution of "specifically multi-select" is empirical to the report; the deterministic core — an unnamed materialize-injected child becoming a UUID tab — holds for any overflow child. Verification step confirms the exact child.)*

### Scope conclusion

The defect is the auto-`createTab` loop mistaking `materialize`-injected children for eager tabs. The fix belongs in `Tab.ts`. `TabPanel.ts` and `Animation.ts` are not the right edit sites: `Animation.materialize`'s "add child to host" behaviour is correct and shared with `Window.show`; `TabPanel` merely forwards to `Tab`.

---

## Architecture Decisions

### Make `doLayout` ignore materialize-managed children, not all extra children

The catch-up loop must keep working for the **bare-Panel eager path** (direct `container.addComponent` → new tab). It must **stop** turning lazy-materialized panels and spinners into tabs. The distinguishing fact already tracked by `Tab` is its own `_tabs[]` bookkeeping: every materialized panel and spinner is referenced by an existing `TabEntry` (`entry.component` / `entry.spinner`), whereas a genuinely eager, directly-added child is not referenced by any entry.

**Chosen fix:** in the catch-up loop, skip any container child that is already owned by an existing tab entry (i.e. equals some `entry.component` or `entry.spinner`); only call `createTab` for children that no entry references. This preserves the bare-Panel path (those children are referenced by no entry, so they still get a tab) while making lazy mode immune to the phantom (materialize's children are all entry-referenced).

Concretely, replace the index-threshold loop with an ownership test:

```ts
const owned = new Set<Component>();
for (const entry of this._tabs) {
    if (entry.component) { owned.add(entry.component); }
    if (entry.spinner)   { owned.add(entry.spinner);   }
}
for (const component of components) {
    if (!owned.has(component)) {
        this.createTab(component);
    }
}
```

This is a behavioural correction local to tab-creation, with no change to toolbar geometry, fade logic, or sizing — keeping it clear of the parallel L&F/indicator/max-width changes.

### Reject the alternative: removing the materialized panel on tab switch

One could make `materialize`/`Tab` remove the previous panel from the container when switching tabs. Rejected: `Tab` intentionally keeps built panels attached and toggles visibility (`doLayout` sets `setVisible(false/true)` per child, [Tab.ts:625-655](../src/typescript/lib/layout/Tab.ts#L625)) so re-selecting a tab is instant. Detaching/reattaching would re-incur build/layout cost and risk losing panel state — a larger, riskier change than the ownership guard.

### Do not edit `TabPanel.ts` or `Animation.ts`

`TabPanel` only forwards to `Tab`. `Animation.materialize`'s child-add behaviour is correct and shared with `Window`. Both stay untouched; `TabPanel.ts` is declared in `touches-shared` solely for coordination with the parallel styling plan per the task brief.

---

## Public API (TypeScript Signatures)

No public API changes. The fix is internal to `Tab.doLayout`'s private catch-up logic; no new setter, option, or exported symbol.

---

## Ordered Implementation Steps

1. In [`src/typescript/lib/layout/Tab.ts`](../src/typescript/lib/layout/Tab.ts), inside `doLayout` ([Tab.ts:612-615](../src/typescript/lib/layout/Tab.ts#L612)), replace the index-threshold catch-up loop with the ownership-test loop from _Architecture Decisions_: build a `Set<Component>` of every `entry.component` and `entry.spinner`, then `createTab` only for container children not in that set.
2. Confirm `Component` is already imported in `Tab.ts` (it is — line 7) so the `Set<Component>` type resolves with no new import.
3. Leave `createTab`, `materializeAsync`, the visibility loop, and all sizing/fade code unchanged — the fix is confined to which children become tabs.
4. Typecheck / build — expect zero errors.
5. Grep regression check: confirm the old threshold loop is gone —
   `grep -n "i < componentCount" src/typescript/lib/layout/Tab.ts` — expect zero matches.
6. Confirm the bare-Panel path is intact by inspection: a directly-`addComponent`-ed child (no entry references it) still hits `createTab`.

---

## Files to Create / Modify / Delete

| Action | File |
|--------|------|
| Modify | `src/typescript/lib/layout/Tab.ts` |

> `src/typescript/lib/component/container/TabPanel.ts` is listed in `touches-shared` for coordination only; it is **not** edited by this plan.

---

## Verification

- **Build/typecheck** passes with no errors.
- **Manual smoke test** (app on http://localhost:8015): the app's root tab strip is the demo under test.
  1. Click through many tabs repeatedly, including "MultiSelect", "Misc.", and "Complex" (the heavy lazy panels), switching back and forth 15+ times.
  2. Confirm **no** new tab button appears at the far right and **no** tab is ever labelled with a UUID.
  3. Each demo tab still materializes (spinner → content fade) on first open and re-selects instantly afterwards.
- **Runtime confirmation (recommended)** via Chrome DevTools MCP: after heavy clicking, evaluate the tab toolbar button count and assert it equals the registered tab count (18) and does not grow. Capturing the phantom child's identity before the fix (its `getId()` and which `entry.component` it equals) confirms the "multi-select content" attribution in Root Cause §5.
- **Regression — bare-Panel tab path:** in a scratch check (or the `TabDemoPanel` eager `addTab` flow), confirm directly-added components still produce correctly-labelled tabs, proving the ownership guard did not break the eager path.

---

## Potential Challenges

- **Spinner timing window.** The phantom can appear transiently (spinner pushes the count over) or permanently (built panels accumulate). The ownership-set guard covers both because spinners are tracked in `entry.spinner` and built panels in `entry.component`. Verify a spinner mid-build no longer spawns a tab.
- **Bare-Panel eager path must keep working.** The guard relies on eager directly-added children NOT being referenced by any entry — true today, since only `createTab`/`materializeAsync` populate `entry.component`. If a future change pre-registers entries for eager children, revisit. Mitigated by the step-6 inspection and the regression check.
- **Parallel L&F plan touches the tab subsystem.** Keep edits inside the catch-up loop; do not touch toolbar sizing, the (planned) sliding indicator, or tab max-width. The two plans should merge cleanly because they edit disjoint regions.

---

## Critical Files

- [`src/typescript/lib/layout/Tab.ts`](../src/typescript/lib/layout/Tab.ts) — the fix site; read `doLayout` (600-706), `createTab` (433-450), `addLazyTab` (486-492), `materializeAsync` (525-559), and the `TabEntry` shape (77-86).
- [`src/typescript/lib/core/Animation.ts`](../src/typescript/lib/core/Animation.ts) — `materialize` (411-441); explains how container children are injected. **Do not edit** (shared with `Window.show`).
- [`src/typescript/main.ts`](../src/typescript/main.ts) — the demo app; all tabs are lazy (31-50), which is why the bug surfaces here.
- [`src/typescript/lib/component/container/TabPanel.ts`](../src/typescript/lib/component/container/TabPanel.ts) — thin forwarder over `Tab`; read only to confirm it is not the culprit. **Do not edit** (parallel L&F plan owns its styling).

---

## Non-Goals

- **Changing `Animation.materialize` or `Window` activation.** The child-add behaviour is correct and shared; out of scope.
- **Detaching built panels on tab switch.** Rejected for cost/state reasons (see Architecture Decisions); the fix keeps the instant-reselect behaviour.
- **Any tab-button styling, sliding indicator, or max-width work.** Owned by the parallel modern-theme/L&F plan.
