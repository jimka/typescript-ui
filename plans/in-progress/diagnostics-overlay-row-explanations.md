---
depends-on: [debug-diagnostics-overlay]
touches-shared:
  - packages/lib/src/typescript/lib/component/container/LabeledGrid.ts
  - packages/lib/src/typescript/lib/component/container/LabeledFieldSet.ts
---

# Diagnostics Overlay Row Explanations — Implementation Plan

## Overview

[`DiagnosticsOverlay`](packages/lib/src/typescript/lib/diagnostics/DiagnosticsOverlay.ts) shows twelve metric rows — a label on the left, a live number on the right — and says nothing about what any of them measures. A developer reading *Layout passes* mid-session took it for a cost figure; it is a raw count of `doLayout()` calls ([`Diagnostics.noteLayoutPass`](packages/lib/src/typescript/lib/core/Diagnostics.ts#L68), incremented at [`Component.doLayout`](packages/lib/src/typescript/lib/core/Component.ts#L6480)), and a deep tree of cheap layouts scores higher than a shallow tree of expensive ones. The explanation exists, in [`docs/components/DiagnosticsOverlay.md`](packages/lib/docs/components/DiagnosticsOverlay.md#L13) — just not where the number is.

This plan puts one sentence-or-three of explanation behind every metric row, shown as a hover tooltip on both the row's label and its value. The copy lives in one `ROW_DESCRIPTIONS` block at the top of `DiagnosticsOverlay.ts`, next to the row list it feeds.

[`LabeledGrid`](packages/lib/src/typescript/lib/component/container/LabeledGrid.ts) builds each row's label `Text` internally and never hands it back, so the overlay cannot reach the label to hover-wire it. `LabeledGrid` therefore gains one optional `description` on its row descriptor and does the wiring itself — the same shape [`Field.getDescription()`](packages/lib/src/typescript/lib/data/Field.ts#L110) already has, feeding a header cell's tooltip at [`table/Header.ts:849`](packages/lib/src/typescript/lib/component/table/Header.ts#L849).

---

## Architecture Decisions

### Explanations are hover tooltips, on both the label and the value

Each metric row's explanation is attached with [`Tooltip.attach`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L386) to two components: the row's label and the row's value `Text`. The precedent is [`FlowDemoPanel.addLabelled`](packages/lib/src/typescript/FlowDemoPanel.ts#L205), which wires the identical hint onto a caption and its control "so the setting is discoverable whichever the pointer lands on".[^tooltip-not-subtext]

### `LabeledGrid` carries the description; the overlay only supplies the text

`LabeledFieldDescriptor` gains an optional `description`, and `LabeledGrid.addField` attaches it to the label it just created and to the field component. The overlay passes strings and touches no wiring.[^labeledgrid-change]

### `LabeledGrid` detaches its tooltips when it is destroyed

`LabeledGrid` records every component it attached a tooltip to and calls [`Tooltip.detach`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L446) on each from a `destructor()` override. `Tooltip`'s attachment registry is a plain `Map` keyed by component id whose entries close over the component, so an attachment left behind after teardown pins that component and its ancestor chain.[^detach-on-teardown]

### The copy lives in one block in `DiagnosticsOverlay.ts`, not a separate file

A module-level `ROW_DESCRIPTIONS` object sits directly above the class, keyed by the same names as the value-`Text` fields (`fps`, `frameTime`, `heap`, …), and the row list references `ROW_DESCRIPTIONS.fps` and friends. No new file.[^copy-location]

---

## Public API

### `component/container/LabeledGrid.ts`

```typescript
export interface LabeledFieldDescriptor {
    title: string;
    component: Component;
    /** Optional hover explanation, attached to both the label and the component. */
    description?: string;
}

class LabeledGrid extends Container<LabeledGridOptions> {
    addField(title: string, component: Component, description?: string): this;
}
```

### `component/container/LabeledFieldSet.ts`

```typescript
class LabeledFieldSet extends _FieldSet {
    addField(title: string, component: Component, description?: string): this;
}
```

`LabeledGridOptions.rows`, `addRow`, and `addFullWidthRow` keep their current signatures — a `description` reaches `addRow` inside the descriptor, and a full-width row has no label to hang one on.

---

## Internal Structure

### The attach rule

A description is attached only when it is a non-empty string. Both targets get the identical text.

| `description` passed to `addField` | Label tooltip | Field-component tooltip |
|---|---|---|
| `"doLayout() calls per second — a raw call count…"` | that text | that text |
| `undefined` (or omitted) | none | none |
| `""` | none | none |

### `LabeledGrid.addField`

```typescript
addField(title: string, component: Component, description?: string): this {
    this.openRow();

    const label = new Text(title);

    this.addComponent(label);
    this.addComponent(component);

    if (description) {
        Tooltip.attach(label, description);
        Tooltip.attach(component, description);

        this._tooltipTargets.push(label, component);
    }

    this._flowCol += 2;

    if (this._flowCol >= 2 * this._columns) {
        this._flowCol = 0;
    }

    return this;
}
```

`_tooltipTargets` is a plain `private _tooltipTargets: Component[] = [];` field. A bare initializer is correct here — `applyRows` runs from the `LabeledGrid` constructor *body*, after field initializers, not from an `applyOptions`-dispatched setter, so the `declare` rule in [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) does not apply.

### `LabeledGrid.destructor`

```typescript
protected destructor(): void {
    for (const target of this._tooltipTargets) {
        Tooltip.detach(target);
    }
    this._tooltipTargets = [];

    super.destructor();
}
```

Detaching runs before `super.destructor()`, which destroys the children. Clearing the array afterwards makes a second `destructor()` call a no-op, which `Component`'s contract requires.

### The row copy

`ROW_DESCRIPTIONS`, verbatim. Each string is one TypeScript string literal using single quotes internally so the file's double-quoted string style is preserved.

| Key (row) | Description text |
|---|---|
| `fps` (FPS) | Frames completed in the last half-second, expressed per second. The overlay asks the browser for a frame every frame, so an idle app reads at the display's refresh rate — a drop is the signal, the absolute number is not. |
| `frameTime` (Frame time) | Average gap between frames over the last half-second, with the longest single gap in brackets. The average is just 1000 / FPS; the maximum is where a one-off stutter shows up. |
| `heap` (JS heap) | Used JavaScript heap against the engine's limit, from `performance.memory`. Chromium-only and quantised — read the trend across an interaction, not the digits. Shows 'unavailable' on engines that do not expose it. |
| `domNodes` (DOM nodes) | Elements in the document, counted with `document.querySelectorAll('*')`. Elements only — text and comment nodes are not counted. A count that does not return to its starting point after a repeated open/close means elements are outliving their components. |
| `longTasks` (Long tasks) | Main-thread tasks longer than 50 ms, reported by `PerformanceObserver`: the total since the overlay opened, with the count from the last half-second in brackets. Stays at 0 on engines with no long-task reporting. |
| `components` (Components) | Live `Component` count — constructed minus disposed. A component dropped without `dispose()` is still counted, on purpose: that is the leak this number exists to expose. It is not garbage-collection aware. |
| `constructedDisposed` (Constructed / disposed) | The two running totals the Components figure is derived from. Both only ever rise. Rising together with a steady gap is ordinary churn; a gap that widens is a leak. |
| `layoutPasses` (Layout passes) | `doLayout()` calls per second — a raw call count, not a measure of layout cost. A deep tree of cheap layouts scores higher than a shallow tree of expensive ones, so read Layout flush for cost. A rate that stays high while nothing is happening means something calls `scheduleLayout()` on every pass. |
| `layoutFlush` (Layout flush) | Average and longest time one coalesced layout flush took, in milliseconds. Timed once per flush, never per component. Both figures reset each time the overlay opens: the average dilutes over a long session, the maximum only ever rises. |
| `domListeners` (DOM listeners) | Live DOM-event registrations across the framework's exact-target, subtree and viewport maps. Destroying a component purges its registrations, so a count that does not come back down after a repeated open/close means components are not being destroyed. |
| `semanticListeners` (Semantic listeners) | Live `ListenerBag` registrations — the framework's own `on()` / `off()` subscriptions such as theme changes and model events, not DOM events. Added minus removed. |
| `styleRules` (Stylesheet rules) | Rules currently materialised on the framework's shared stylesheet, with the per-component (`#id`) and shared-class counts in brackets. The two bracketed figures do not add up to the total — verbatim selector rules make up the rest. Per-component rules should fall as their components are disposed. |

Every one of these is checked against the code that produces the number: [`DiagnosticsSampler.emitSample`](packages/lib/src/typescript/lib/diagnostics/DiagnosticsSampler.ts#L266), [`Diagnostics`](packages/lib/src/typescript/lib/core/Diagnostics.ts), [`Event.listenerCounts`](packages/lib/src/typescript/lib/core/Event.ts#L861), [`styleRuleCounts`](packages/lib/src/typescript/lib/core/StyleTarget.ts#L270), and [`DOMSource.countElements`](packages/lib/src/typescript/lib/core/DOM.ts#L2400).

### The row list after the change

```typescript
[{ title: "FPS", component: this._fps, description: ROW_DESCRIPTIONS.fps }],
```

The two `Header` rows (`Browser`, `Framework`) are `fullWidth` and get no description.

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/component/container/LabeledGrid.ts`** — add `description?: string` to `LabeledFieldDescriptor` ([:23](packages/lib/src/typescript/lib/component/container/LabeledGrid.ts#L23)) with a JSDoc line saying it is attached as a hover tooltip to both the label and the component.
2. **Same file** — add `import { Tooltip } from "~/overlay/Tooltip.js";` and the `private _tooltipTargets: Component[] = [];` field beside `_flowCol` ([:84](packages/lib/src/typescript/lib/component/container/LabeledGrid.ts#L84)).
3. **Same file** — rewrite `addField` ([:125](packages/lib/src/typescript/lib/component/container/LabeledGrid.ts#L125)) to the body in *Internal Structure*, and extend its JSDoc with the `description` parameter. Verify: `npm run typecheck` passes.
4. **Same file** — in `addRow` ([:147](packages/lib/src/typescript/lib/component/container/LabeledGrid.ts#L147)) change the loop body to `this.addField(field.title, field.component, field.description);`.
5. **Same file** — add the `protected destructor()` override from *Internal Structure*, placed after `growRows`. It must end with `super.destructor()`.
6. **`packages/lib/src/typescript/lib/component/container/LabeledFieldSet.ts`** — widen `addField` ([:77](packages/lib/src/typescript/lib/component/container/LabeledFieldSet.ts#L77)) to `addField(title: string, component: Component, description?: string)` and forward the third argument to `this._labeledGrid.addField(...)`. Extend its JSDoc the same way.
7. **`packages/lib/src/typescript/lib/diagnostics/DiagnosticsOverlay.ts`** — add the `ROW_DESCRIPTIONS` object immediately below the `OVERLAY_*` constants ([:16](packages/lib/src/typescript/lib/diagnostics/DiagnosticsOverlay.ts#L16)), declared `as const`, with a JSDoc line saying it is the in-app copy for each metric row and that a change here should be mirrored in `docs/components/DiagnosticsOverlay.md`. Use the exact text from the table in *Internal Structure*.
8. **Same file** — add `description: ROW_DESCRIPTIONS.<key>` to each metric row in the `rows` array ([:70](packages/lib/src/typescript/lib/diagnostics/DiagnosticsOverlay.ts#L70)). Leave the two `Header` rows untouched. Verify: one `ROW_DESCRIPTIONS.` reference per metric row, and one `ROW_DESCRIPTIONS` key per value-`Text` field, with no key unused — count these from the file itself, and if the three counts disagree, stop and report rather than guessing which is right.
9. **`packages/lib/tests/component/container/LabeledGrid.tooltip.test.ts`** (new) — cases 1–6 of *Expected Behaviour*, following [`SplitGutter.tooltip.test.ts`](packages/lib/tests/component/container/SplitGutter.tooltip.test.ts) for the `(Tooltip as any).attachments` helpers and its `afterEach` singleton reset.
10. **`packages/lib/tests/component/container/LabeledFieldSet.test.ts`** — add case 7.
11. **`packages/lib/tests/diagnostics/DiagnosticsOverlay.rowTooltips.test.ts`** (new) — cases 8–10, reusing `DiagnosticsOverlay.test.ts`'s `CONFIG`, `currentInstance()` helper and `afterEach` teardown.
12. **Docs** — the four files in *Documentation Impact*.
13. Run the full *Verification* list.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/container/LabeledGrid.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/LabeledFieldSet.ts` |
| Modify | `packages/lib/src/typescript/lib/diagnostics/DiagnosticsOverlay.ts` |
| Create | `packages/lib/tests/component/container/LabeledGrid.tooltip.test.ts` |
| Create | `packages/lib/tests/diagnostics/DiagnosticsOverlay.rowTooltips.test.ts` |
| Modify | `packages/lib/tests/component/container/LabeledFieldSet.test.ts` |
| Modify | `packages/lib/docs/components/LabeledGrid.md` |
| Modify | `packages/lib/docs/components/LabeledFieldSet.md` |
| Modify | `packages/lib/docs/components/DiagnosticsOverlay.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Unit-testable (offline harness):

1. `addField('Name', input, 'What a name is')` leaves a tooltip attachment carrying exactly `'What a name is'` on both the created label and `input`. The label is `grid.getComponents()[0]`; `input` is `[1]`.
2. `addField('Name', input)` leaves no attachment on either component.
3. `addField('Name', input, '')` leaves no attachment on either component.
4. `addRow([{ title: 'Name', component: input, description: 'What a name is' }])` produces the same two attachments as case 1.
5. The declarative `rows` option and the imperative `addRow` produce identical attachments for the same descriptor.
6. After `grid.dispose()`, neither the label's id nor `input`'s id is present in the tooltip attachment registry.
7. `LabeledFieldSet.addField('Name', input, 'What a name is')` produces the same two attachments as case 1.
8. After `DiagnosticsOverlay.open()`, every metric row's label and value `Text` carries a tooltip, and each of those tooltips' text is non-empty.
9. After `DiagnosticsOverlay.open()` followed by a `dispose()` of the instance, no id from the overlay's component tree remains in the tooltip attachment registry.
10. The two full-width `Header` components carry no tooltip.

Manual verification (hover, timing and rendered position are outside the harness) — `npm run dev`, open http://localhost:8015, **Misc** panel, *Show diagnostics overlay*:

11. Resting the pointer on the words *Layout passes* for about half a second shows a tooltip whose text says it is a call count, not a cost.
12. Resting the pointer on that row's number shows the same text.
13. The tooltip for a row near the bottom of the overlay flips above the pointer rather than running off the viewport.
14. *DOM listeners* reads a constant amount higher while the overlay is open than after it is closed, and returns to its pre-open value once closed.

---

## Verification

- `npm run typecheck` — clean.
- `npm test` — all suites green, including the three test files above.
- `npm run lint` — no new findings.
- `npm run docs:api` — finishes with zero warnings (the new `description` JSDoc must not `{@link}` any private symbol).
- `npm run docs:llms` — run it and commit any `packages/lib/llms.txt` diff; none is expected, since no class summary sentence changes.
- Manual: cases 11–14 above.

---

## Documentation Impact

- **[`packages/lib/docs/components/LabeledGrid.md`](packages/lib/docs/components/LabeledGrid.md)** — change the *Common methods* row to `addField(title, component, description?)` and say the optional description becomes a hover tooltip on both the label and the field. Add `description` to one descriptor in the declarative *Usage* example.
- **[`packages/lib/docs/components/LabeledFieldSet.md`](packages/lib/docs/components/LabeledFieldSet.md)** — the same *Common methods* row change.
- **[`packages/lib/docs/components/DiagnosticsOverlay.md`](packages/lib/docs/components/DiagnosticsOverlay.md)** — under *What each row means*, add a sentence: the same explanation is available in-app by hovering a row's label or its number. Note in the same place that the table and `ROW_DESCRIPTIONS` state the same facts and are edited together.
- **[`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md)** — an *Added* entry under *Components* for the overlay's per-row hover explanations and for `LabeledGrid` / `LabeledFieldSet` gaining the optional `description`. No breaking-changes entry: `description` is optional and the third parameter of `addField` is optional, so every existing call still compiles.

---

## Potential Challenges

- **The overlay's own *DOM listeners* number rises.** `Tooltip.attach` registers four listeners per component, so twelve rows × two components adds a constant 96 registrations while the overlay is open. Mitigation: the 96 registrations are a fixed amount and are purged on close (case 14 pins that), and the doc page already tells the reader to treat the overlay's self-count as a fixed offset — extend that paragraph with this figure.
- **Detaching creates the `Tooltip` singleton.** `Tooltip.detach` calls `Tooltip.hide()`, which lazily constructs the singleton, so closing an overlay nobody hovered adds the tooltip's own two components to the live count. Mitigation: the singleton is constructed once per page, not once per close, and any hover would have constructed it anyway.
- **Long copy wraps tall.** `Tooltip` caps its width at 300 px and wraps beyond that; the longest description here runs to roughly six wrapped lines. Mitigation: `Tooltip.show` measures the wrapped height and flips the box to stay on screen — case 13 checks the worst row.
- **`LabeledGrid` importing `Tooltip` is a new edge from `component/container` to `overlay`.** Mitigation: none needed — [`SplitGutter`](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L10) in the same directory already imports it.

---

## Critical Files

| File | Why the implementer must read it |
|---|---|
| [`packages/lib/src/typescript/lib/component/container/LabeledGrid.ts`](packages/lib/src/typescript/lib/component/container/LabeledGrid.ts) | The descriptor, `addField`, `addRow`, `applyRows` — every edit outside the overlay lands here. |
| [`packages/lib/src/typescript/lib/diagnostics/DiagnosticsOverlay.ts`](packages/lib/src/typescript/lib/diagnostics/DiagnosticsOverlay.ts) | The row list and the twelve value-`Text` fields the description keys mirror. |
| [`packages/lib/src/typescript/FlowDemoPanel.ts:205`](packages/lib/src/typescript/FlowDemoPanel.ts#L205) | **The precedent** — one hint attached to both a caption and its control. |
| [`packages/lib/src/typescript/lib/component/table/Header.ts:849`](packages/lib/src/typescript/lib/component/table/Header.ts#L849), [`packages/lib/src/typescript/lib/data/Field.ts:110`](packages/lib/src/typescript/lib/data/Field.ts#L110) | The existing `description` → tooltip pairing the new descriptor field is named after. |
| [`packages/lib/src/typescript/lib/overlay/Tooltip.ts:386`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L386), [`:446`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L446) | `attach` / `detach` — what they register, and that `detach` calls `hide()`. |
| [`packages/lib/tests/component/container/SplitGutter.tooltip.test.ts`](packages/lib/tests/component/container/SplitGutter.tooltip.test.ts) | The `(Tooltip as any).attachments` test helpers and the singleton reset every new test copies. |
| [`packages/lib/tests/diagnostics/DiagnosticsOverlay.test.ts`](packages/lib/tests/diagnostics/DiagnosticsOverlay.test.ts) | `CONFIG`, `currentInstance()`, and the `afterEach` dispose the overlay test file reuses. |
| [`packages/lib/src/typescript/lib/diagnostics/DiagnosticsSampler.ts:266`](packages/lib/src/typescript/lib/diagnostics/DiagnosticsSampler.ts#L266) | `emitSample` — the arithmetic behind every number the copy describes. |
| [`packages/lib/docs/components/DiagnosticsOverlay.md`](packages/lib/docs/components/DiagnosticsOverlay.md) | The existing row-by-row table the in-app copy has to agree with. |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) *Event handling* | Why the tooltip wiring goes through `Tooltip`, never a raw `Event` call from the caller. |

---

## Non-Goals

- **A permanent explanation line under each row.** It would roughly triple the overlay's row count and its layout work, in the component whose job is to measure layout work.
- **A `?` affordance per row.** Twelve more `Glyph` components and twelve more grid cells buy nothing a hover on the label does not.
- **Explanations on the `Browser` / `Framework` section headers.** They name a grouping, not a measurement.
- **Reflecting the description into `aria-label` or `title`.** Accessibility for the overlay is a separate question from this one, and reflecting it here would set a convention for every `LabeledGrid` in the library without a decision behind it.
- **Detaching tooltips from `Button`, `TabBar`, `AbstractSelectableList`, or `FieldDecorator` on teardown.** They have the same retention gap `LabeledGrid` is being given the fix for, but each is a separate change with its own call sites.
- **Generating the doc page's row table from `ROW_DESCRIPTIONS`.** Two short lists edited together are cheaper than a build step.
- **Making the descriptions configurable by a consumer.** The overlay has no options bag and no public constructor.

---

## Notes

[^tooltip-not-subtext]: Three mechanisms were weighed. A permanent subtext line under each label is the most discoverable, and was rejected on the overlay's own stated design constraint: `plans/implemented/debug-diagnostics-overlay.md` lists "the overlay perturbs layout timing" as a live concern and answers it by keeping the tree to labels only and sampling at 2 Hz. Twelve wrapped explanation lines would add twelve components, triple the scroll height and add real per-sample layout cost to the instrument measuring layout cost. A `?` glyph per row costs the same twelve components plus twelve grid cells and still needs a tooltip behind it. A tooltip costs zero components, zero DOM nodes and zero layout — only listener registrations, which are constant and purged on close. `title` attributes were not considered a candidate: the library routes every hover hint through `Tooltip`, and a native `title` would be the only one in the codebase.

[^labeledgrid-change]: `LabeledGrid` has no existing description or help affordance — `LabeledFieldDescriptor` is `{ title: string; component: Component }` and nothing else — so there is nothing to reuse. Composing from what it exposes today does not work either: `addField` does `this.addComponent(new Text(title))` and drops the reference, so the label is reachable only by index-walking `grid.getComponents()`, whose parity flips at every full-width row. That would couple the overlay to `LabeledGrid`'s internal child ordering to avoid a six-line addition to `LabeledGrid` — a worse trade. The addition is fully additive: `description` is optional, the third `addField` parameter is optional, and a grid that passes neither behaves exactly as before. Its naming follows the library's existing description-becomes-a-tooltip pairing — `Field.getDescription()` feeding a header cell's tooltip, and `ButtonOptions.description` feeding a button's.

[^detach-on-teardown]: `Tooltip.attachments` is `Map<string, TooltipAttachment>` keyed by component id, and each attachment's `mouseoverFn` closes over the component. `Component.destructor` calls `Event.purgeComponent`, which drops the DOM registrations, but nothing clears the attachment entry — so the entry survives, holding the component, whose `_parent` chain holds the grid, the panel and the window. In an overlay a developer opens and closes repeatedly, that is a per-cycle retention leak inside the tool built to find retention leaks. `Button`, `TabBar`, `AbstractSelectableList` and `FieldDecorator` all attach without ever detaching on teardown and have the same gap; fixing them is out of scope here, and each needs its own call-site pass.

[^copy-location]: Three facts per row could in principle live together: the label, the value formatting, and the explanation. Today only two of the three are adjacent — label and component sit in the `rows` array, while formatting sits in the twelve `setText` calls in `onSample`. Folding all three into one descriptor table would mean replacing the twelve named `Text` fields with a keyed collection and rewriting both the constructor and `onSample` — a rewrite of a file that shipped days ago, for a feature that adds one string per row. Inlining the full text into the `rows` array was also rejected: the descriptions run to two or three sentences each and would bury the row list they belong to. A block of named constants keyed to the field names keeps the copy reviewable in one place, keeps the `rows` array readable, and keeps both in the same file, so a row added without a description is visible in a single screen. A separate copy module was rejected for the same reason in reverse — nothing else would import it, and it adds a second file for the row list to drift from.
