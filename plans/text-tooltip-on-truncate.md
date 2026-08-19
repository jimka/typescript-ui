---
touches-shared:
  - packages/lib/src/typescript/lib/component/input/Text.ts
  - packages/lib/src/typescript/lib/overlay/Tooltip.ts
---

# Text tooltip on truncate — Implementation Plan

## Overview

`Text` can already clip its content to one ellipsised line ([`Text.setTruncate`](packages/lib/src/typescript/lib/component/input/Text.ts#L1267)). When it does, the clipped part of the string is unreadable. This plan adds an opt-in `truncateTooltip` option so a `Text` whose content is *actually* overflowing right now shows the full string as a hover tooltip, and shows nothing when the string fits.

Two files carry the change. [`Tooltip.attach`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L386) learns to take a function in place of a fixed string, resolved when the 500 ms hover delay expires; returning nothing suppresses that hover. [`Text`](packages/lib/src/typescript/lib/component/input/Text.ts#L114) gains a public `isTruncated()` query — "is this Text's content overflowing right now", as distinct from `isTruncate()`'s "is truncation mode configured" — built on the inherited [`Component.getMaxScrollLeft()`](packages/lib/src/typescript/lib/core/Component.ts#L3815), plus the `truncateTooltip` option and its `setTruncateTooltip` / `isTruncateTooltip` pair, whose private resolver is a thin wrapper around `isTruncated()`.

No existing call site changes behaviour: the option defaults to `false`, and a plain-string `Tooltip.attach` keeps working exactly as before.

---

## Architecture Decisions

### Overflow is detected with `getMaxScrollLeft()`, exposed as `isTruncated()`

"Truncated right now" is `isTruncate() && getMaxScrollLeft() > 0` — `scrollWidth - clientWidth` read through the component's own element. This mirrors [`Panel.updateScrollbarReserve`](packages/lib/src/typescript/lib/core/Panel.ts#L771), which decides whether to reserve a scrollbar gutter from the same comparison.[^why-scroll-metrics] The check is exposed as a public `isTruncated()` method rather than kept as a private detail of the tooltip resolver: "is my content overflowing right now" is a generally useful question in its own right, distinct from `isTruncate()`'s "is truncation mode configured". The tooltip resolver becomes a thin wrapper around it.

### `Tooltip.attach` accepts a text resolver

`attach`'s second parameter widens from `string` to `string | (() => string | null | undefined)`. When a function is passed it is called once, inside the existing 500 ms timer, immediately before the tooltip would be shown; a falsy result cancels that show. `Text` then reuses `attach` / `detach` unchanged instead of growing its own copy of the hover machinery.[^why-resolver]

### The option is opt-in, named `truncateTooltip`

`TextOptions.truncateTooltip` defaults to `false`. `setTruncateTooltip(value)` / `isTruncateTooltip()` follow the naming of the `truncate` pair it sits beside, and of every other boolean option in the library (`isAutoSizeColumns`, `isDescriptionUnderGlyph`, …): the accessor repeats the option name verbatim.[^why-opt-in]

### `setTruncateTooltip` is the only owner of attach and detach

Turning the option on attaches; turning it off detaches; `destructor` detaches. Nothing else — in particular `setTruncate(false)` and `setLineClamp` — attaches or detaches. A `Text` that stops truncating keeps its attachment and simply resolves to `null` on every hover, because the resolver reads `isTruncate()` live.[^why-single-owner]

### `Text` importing `Tooltip` introduces the library's first module cycle

`Tooltip` already imports `Text` for its own label ([`Tooltip.ts:10`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L10)), so `Text` importing `Tooltip` closes a two-module cycle — the first in `packages/lib/src/typescript/lib`, whose import graph is otherwise fully acyclic. The cycle is safe because neither module touches the other while its own module body evaluates, and both load orders are already exercised by the test suite.[^why-cycle]

---

## Public API

`packages/lib/src/typescript/lib/overlay/Tooltip.ts`:

```typescript
static attach(
    component: Component,
    text: string | (() => string | null | undefined),
    colors?: TooltipColors,
): void
```

The private `TooltipAttachment` record's `text` field widens to the same union. `attachToElement` / `detachElement` are untouched and stay `string`-only.

`packages/lib/src/typescript/lib/component/input/Text.ts`:

```typescript
export interface TextOptions extends ComponentOptions {
    // …existing fields…
    truncateTooltip?: boolean;
}

isTruncated(): boolean
setTruncateTooltip(value: boolean): this
isTruncateTooltip(): boolean
```

| Concern | Where it lives |
|---|---|
| Options field | `TextOptions.truncateTooltip?: boolean` |
| Backing store | `this._options.truncateTooltip` (no private field) |
| Class default | `_defaultTextOptions.truncateTooltip = false` |
| Overflow query | `isTruncated(): boolean` — public, reads `isTruncate() && getMaxScrollLeft() > 0` live |
| Setter / getter | `setTruncateTooltip` / `isTruncateTooltip` |
| Resolver | `private truncatedTooltipText(): string \| null` — thin wrapper around `isTruncated()` |

---

## Internal Structure

`Tooltip.attach`'s timer body, with the two added lines and the early return:

```typescript
Tooltip.showTimer = setTimeout(() => {
    const resolved = typeof text === "function" ? text() : text;

    // A resolver returning nothing suppresses this hover entirely: no
    // tooltip, no colour write, and no anchor recorded for the watch.
    if (!resolved) {
        Tooltip.showTimer = null;

        return;
    }

    Tooltip._applyColors(colors);
    Tooltip.activeElement = component.getElement() ?? null;
    Tooltip.show(resolved, cursorX, cursorY);
    Tooltip.showTimer = null;
}, 500);
```

`Text`'s resolver and setter:

```typescript
isTruncated(): boolean {
    return this.isTruncate() && this.getMaxScrollLeft() > 0;
}

private truncatedTooltipText(): string | null {
    if (!this.isTruncated()) {
        return null;
    }

    return this.getText().valueOf() || null;
}

setTruncateTooltip(value: boolean): this {
    this._options.truncateTooltip = value as TOptions["truncateTooltip"];

    if (value) {
        Tooltip.attach(this, this.truncatedTooltipText.bind(this));
    } else {
        Tooltip.detach(this);
    }

    return this;
}

isTruncateTooltip(): boolean {
    return this._options.truncateTooltip ?? this._defaultOptions.truncateTooltip ?? false;
}
```

`.valueOf()` runs *before* the `|| null` test: `setText` accepts a `String` and stores it as given, and a boxed empty `String` is truthy. The same normalisation appears in [`Text.render`](packages/lib/src/typescript/lib/component/input/Text.ts#L1486) and [`Button._rebuildTooltip`](packages/lib/src/typescript/lib/component/button/Button.ts#L1185).

`.bind(this)` gives `Tooltip` a callable that keeps its receiver; the bound reference need not be stable, because `Tooltip.detach` finds the attachment by component id, not by function identity. Three existing sites bind the same way ([`WindowBorder.ts:112-114`](packages/lib/src/typescript/lib/component/container/WindowBorder.ts#L112)).

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/overlay/Tooltip.ts`** — widen the `text` field of the private `TooltipAttachment` interface (line 33) to `string | (() => string | null | undefined)`.

2. **`Tooltip.ts`** — widen `attach`'s `text` parameter (line 386) to the same union, and replace the timer body with the block in _Internal Structure_. Extend the method's JSDoc `@param text` to describe the resolver form and the falsy-suppresses rule.
   *Check:* `npm run typecheck` in `packages/lib` is clean.

3. **`packages/lib/src/typescript/lib/component/input/Text.ts`** — add `import { Tooltip } from "~/overlay/Tooltip.js";` to the import block at the top.

4. **`Text.ts`** — add `truncateTooltip?: boolean;` to `TextOptions` (after `truncate`, line 44) with a JSDoc block saying it is off by default, that it shows `getText()` only while the content is really overflowing, and that it does nothing while `truncate` is `false`.

5. **`Text.ts`** — add `truncateTooltip: false` to `_defaultTextOptions` (line 62–74).

6. **`Text.ts`** — add the public `isTruncated()` query, the private `truncatedTooltipText()` resolver, `setTruncateTooltip`, and `isTruncateTooltip` next to `setTruncate` / `isTruncate` (lines 1244–1286), using the bodies in _Internal Structure_. `isTruncated()` needs its own JSDoc block distinguishing it from `isTruncate()`: "is truncation mode configured" vs. "is the content overflowing right now".

7. **`Text.ts`** — in `applyOptions`, immediately after the existing `this.setTruncate(...)` line (line 269), add:

   ```typescript
   // Always dispatched, for the same reason as `truncate` above: the
   // setter's whole effect is a listener attach/detach with no render-time
   // recompute, so a class default that never dispatched would be reported
   // by the getter and never actually wired.
   this.setTruncateTooltip(options.truncateTooltip ?? this._defaultOptions.truncateTooltip!);
   ```

8. **`Text.ts`** — in `destructor()` (line 184), detach before anything else:

   ```typescript
   protected destructor(): void {
       if (this.isTruncateTooltip()) {
           Tooltip.detach(this);
       }

       _measurableRefs.delete(this._measureRef);
       super.destructor();
   }
   ```

   Detaching first matters: `super.destructor()` calls `Event.purgeComponent(this.getId())`, and the entry in `Tooltip`'s static, id-keyed `attachments` map would otherwise outlive the component — the leak [`AbstractSelectableList.syncRows`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1567) already guards against.

9. **`packages/lib/tests/component/default-options-fallback.test.ts`** — add one registry row, next to the other `Text`-family rows around line 401:

   ```typescript
   { label: 'Text truncateTooltip', resolve: () => new Text().isTruncateTooltip(), expected: false },
   ```

   with the matching `import { Text } from '~/component/input/Text';`.

10. **New file `packages/lib/tests/overlay/TooltipAttachResolver.test.ts`** — the `Tooltip.attach` resolver cases from _Expected Behaviour_ (rows 1–4). Own file, not folded into `tests/overlay/Tooltip.test.ts`, because it drives `vi.useFakeTimers()`; follow the header rationale in [`tests/core/TextDispose.test.ts:1-16`](packages/lib/tests/core/TextDispose.test.ts#L1) for splitting globally-sensitive suites out. Copy the `afterEach` singleton reset from [`tests/overlay/Tooltip.test.ts:61-79`](packages/lib/tests/overlay/Tooltip.test.ts#L61).

11. **New file `packages/lib/tests/component/input/TextTruncateTooltip.test.ts`** — the `isTruncated()` cases (rows a–d) and the `Text.truncateTooltip` cases (rows 5–12) from _Expected Behaviour_. Reach the attachment registry with the `(Tooltip as any).attachments` helpers from [`tests/component/container/SplitGutter.tooltip.test.ts:19-26`](packages/lib/tests/component/container/SplitGutter.tooltip.test.ts#L19); fake overflow by mocking `DOM.source.getScrollMetrics`, as [`tests/component/code-editor.test.ts:222`](packages/lib/tests/component/code-editor.test.ts#L222) does.

12. **Regression check:** `grep -n "attach(component: Component, text: string" packages/lib/src/typescript/lib/overlay/Tooltip.ts` — expect zero matches, confirming `attach`'s parameter really widened (`attachToElement`'s own `text: string` is untouched and must still be there).

13. Run the full `## Verification` list.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/overlay/Tooltip.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Text.ts` |
| Modify | `packages/lib/tests/component/default-options-fallback.test.ts` |
| Create | `packages/lib/tests/overlay/TooltipAttachResolver.test.ts` |
| Create | `packages/lib/tests/component/input/TextTruncateTooltip.test.ts` |

---

## Expected Behaviour

All rows are unit-testable unless marked otherwise.

### `Tooltip.attach`

| # | Case | Expectation |
|---|---|---|
| 1 | `attach(c, "Save")`, hover, 500 ms elapse | `Tooltip.show` called with `"Save"` — unchanged from today |
| 2 | `attach(c, () => "Save")`, hover, 500 ms elapse | `Tooltip.show` called with `"Save"` |
| 3 | `attach(c, () => null)`, hover, 500 ms elapse | `Tooltip.show` not called; `Tooltip.activeElement` stays `null`; `Tooltip.showTimer` back to `null` so a later hover can arm again |
| 4 | `attach(c, () => "…")`, hover, `mouseout` before 500 ms | resolver never called (the timer is cleared by `hide`) |

### `Text.isTruncated()`

| # | `truncate` | `scrollWidth` / `clientWidth` | `isTruncated()` |
|---|---|---|---|
| a | `true` | 240 / 120 | `true` |
| b | `true` | 120 / 120 | `false` |
| c | `false` | 240 / 120 | `false` |
| d | `true` | element not rendered → `getMaxScrollLeft()` is `0` | `false` |

### `Text.truncateTooltip`

| # | Case | Expectation |
|---|---|---|
| 5 | `new Text("hi")` | `isTruncateTooltip()` is `false`; no entry in `Tooltip.attachments` |
| 6 | `new Text("hi", { truncateTooltip: true })` | `isTruncateTooltip()` is `true`; an entry exists keyed by `getId()` |
| 7 | `setTruncateTooltip(false)` after (6) | the entry is gone |
| 8 | `setTruncateTooltip(true)` twice | still exactly one entry (attach replaces) |
| 9 | `dispose()` after (6) | the entry is gone |
| 10 | `dispose()` after (5) | still no entry, and no throw |
| 11 | plain string still accepted elsewhere | `SplitGutter` / `Button` tooltips unchanged (existing suites) |
| 12 | resolver output | per the table below |

The resolver is a thin wrapper around `isTruncated()` (tested independently above); it adds only the text and its empty-string guard:

| `isTruncated()` | `getText()` | resolver returns | hover result |
|---|---|---|---|
| `true` | `"Quarterly revenue"` | `"Quarterly revenue"` | tooltip after 500 ms |
| `false` | `"Short"` | `null` | nothing |
| `true` | `""` | `null` | nothing |

### Manual verification

- **Real hover.** The offline harness models scroll metrics but never lays out real glyphs, so "the ellipsis is on screen exactly when the tooltip appears" has to be seen in a browser. Temporarily construct a narrow `Text('A very long label that will not fit', { truncateTooltip: true })` in the tooltip section of [`packages/lib/src/typescript/MiscPanel.ts:890`](packages/lib/src/typescript/MiscPanel.ts#L890), run `npm run dev` (app on `localhost:8015`), and hover it wide and narrow. Revert the edit before committing — it is a probe, not part of the change.

---

## Verification

Run from `packages/lib`:

- `npm run typecheck` — zero errors.
- `npm test` — runs `typecheck:test` then the full vitest suite; the two new files pass and nothing existing regresses (watch `tests/overlay/Tooltip.test.ts`, `tests/component/container/SplitGutter.tooltip.test.ts`, `tests/component/input/TextTruncateOption.test.ts`, `tests/core/TextDispose.test.ts`).
- `npm run lint` — no new findings.
- `npm run build:lib` — must succeed. This is the check that the new `Text` ↔ `Tooltip` cycle survives the multi-entry Rollup build, which emits `component/input` and `overlay` as separate chunks. A `CIRCULAR_DEPENDENCY` warning is expected and acceptable; a build failure is not.
- `grep -n "attach(component: Component, text: string" packages/lib/src/typescript/lib/overlay/Tooltip.ts` — zero matches.
- Manual hover check as described above.

---

## Documentation Impact

This change is consumer-visible, so **run the `document` skill after the code lands**. Do not hand-edit docs as part of this plan. The surface the skill needs to cover:

- New exported API: `Text.isTruncated`, `TextOptions.truncateTooltip`, `Text.setTruncateTooltip`, `Text.isTruncateTooltip`.
- Changed signature: `Tooltip.attach`'s `text` parameter.
- Pages that describe the affected surface today: `packages/lib/docs/components/Text.md` (its "Common methods" table), `packages/lib/docs/components/Tooltip.md` (its "Attach to a component" section), and `packages/lib/docs/reference/changelog/next.md`.
- `packages/lib/llms.txt` is generated — `npm run docs:llms`.
- `npm run docs:api` must finish with zero warnings; per `CODE_CONVENTIONS.md`, the new JSDoc must not `{@link}` the private resolver.

---

## Potential Challenges

- **Sub-pixel overflow.** `scrollWidth` and `clientWidth` are integers, so a fraction-of-a-pixel overflow can read as 0 or 1 and disagree with what the browser paints. Mitigation: accept it — this is the same tolerance `Panel`'s scrollbar reservation already ships with, and being one pixel wrong at the boundary costs at most a redundant tooltip.
- **Re-entrancy through the singleton.** `setTruncateTooltip(false)` calls `Tooltip.detach`, which calls `Tooltip.hide()` → `getInstance()` → `new Tooltip()` → `new Text()` → `setTruncateTooltip(false)` again. Mitigation: none needed, but do not change it — `detach` returns early when there is no attachment, *before* it reaches `hide()`, which caps the recursion at one level. Keep that early return first in `detach`.
- **The cycle can be broken by a careless edit.** It is only safe while neither module uses the other during module evaluation. Mitigation: `Tooltip`'s `new Text()` must stay inside its constructor (reached lazily from `getInstance`), and `Text`'s `Tooltip.*` calls must stay inside method bodies — never at module scope, never in a field initialiser.
- **`Text` is a hot class.** Adding an always-dispatched setter puts one `Map.get` miss on every `Text` construction. Mitigation: that is the whole cost on the default path; `Tooltip.detach` allocates nothing and never creates the singleton when there is no attachment.

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/component/input/Text.ts` | The class being extended; `setTruncate`/`isTruncate` (1244–1286) are the naming and always-dispatch precedent, `destructor` (184) the teardown seam. |
| `packages/lib/src/typescript/lib/overlay/Tooltip.ts` | `attach` (386–438) and `detach` (446–461) are the methods being widened and reused. |
| `packages/lib/src/typescript/lib/core/Panel.ts` (755–777) | The overflow-detection precedent this plan mirrors. |
| `packages/lib/src/typescript/lib/core/Component.ts` (1052, 3815–3824) | `getScrollElement` and `getMaxScrollLeft` — the inherited signal. |
| `packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts` (355–366, 1567) | Precedent for attach/detach lifecycle around a static id-keyed tooltip registry. |
| `packages/lib/tests/component/container/SplitGutter.tooltip.test.ts` | The assertion style for tooltip attachment tests. |
| `packages/lib/tests/component/code-editor.test.ts` (222–270) | The precedent for faking scroll metrics offline. |
| `ARCHITECTURE.md` — "All attributes and styles go through typed setters", "Class-level defaults must survive the getter" | Governs the option/setter/getter/default shape used here. |

---

## Non-Goals

- **Line-clamp (multi-line) truncation.** `setLineClamp` renders through `-webkit-line-clamp`, which sizes the box from the clamp, so `scrollHeight` vs `clientHeight` is not a dependable overflow signal there and the offline harness cannot model it either. `isTruncated()` — like the tooltip built on it — reports only single-line ellipsis overflow (gated on `isTruncate()`'s mode); a line-clamped `Text` reads `false` from `isTruncated()` regardless of whether its clamped lines are themselves cut off. Adding a vertical check needs its own browser-verified investigation.
- **Changing `Tooltip.attachToElement`.** The raw-element path keeps its `string` parameter. `Text` renders its content as `textContent` with no child elements, so the component-keyed `attach` — which matches on the exact target id — already reaches it.
- **Turning the option on anywhere in the library.** No `Text` call site, and no `Text` subclass (`Label`, `Link`, `Legend`, `SelectableText`, the picker cells), opts in as part of this change.
- **Re-evaluating truncation outside hover.** Nothing is read during layout, and no listener re-checks overflow on resize. The single read happens when the hover delay expires.
- **Suppressing the tooltip while a `Text` is inside a component that has its own tooltip.** Out of scope; the option is off by default, so a caller that turns it on owns that decision.

---

## Notes

[^why-scroll-metrics]: Three candidate signals were compared. `getMaxScrollLeft()` reads the browser's own view of the laid-out content, so it is true whatever the font fallback, kerning, or theme did — and it costs one DOM read per *completed* hover, i.e. at most twice a second while a user hovers around. The alternative was deriving truncation from `Text`'s cached measurement (`getPreferredSize().width` against the laid-out inner width), which needs no DOM read but is wrong in two shipped configurations: `setPreferredSize` sets `_hasExplicitPreferredSize` and stops the measured natural width reaching the preferred size at all, and `setAutoMeasure(false)` disables the probe outright. A third option — recomputing on every `doLayout` and caching a boolean — was rejected because reading geometry inside a layout pass is exactly the hazard `ARCHITECTURE.md` and the project's own `commitBounds` note warn about, and it would pay the read on every layout instead of on every hover.

[^why-resolver]: Duplicating the wiring inside `Text` would mean a second copy of `mouseover` / `mousemove` / `mouseout` / `mousedown` registration, the 500 ms timer, cursor-coordinate tracking, the `activeElement` anchor bookkeeping, and the press-dismisses-the-hint rule — roughly 40 lines of behaviour that `Tooltip.attach` already owns, in a class that would then drift from it. Widening the parameter costs five lines in one place. The concern about speculative generality does not apply: there is no way to express "show only when truncated" through the current `string` signature, so this is the capability the one requested consumer needs, not spare flexibility. It is worth being clear that it stays a single-consumer feature for now — the other conditional-tooltip sites in the library (`Button._rebuildTooltip`, `SplitGutter`, `AbstractSelectableList.applyTooltip`, `Header.setTooltip`, `ParentHeader.setTooltip`) all decide *at attach time* whether a tooltip exists and pass a fixed string, so none of them wants a resolver.

[^why-opt-in]: The library has 200-plus `Text` construction sites. Turning the option on by default would give each of them four entries in `Event`'s internal listener registry (see [^why-listeners-already-shared] — this is registry bookkeeping, not four native DOM listeners) plus an entry in `Tooltip`'s static, id-keyed `attachments` map — an entry that leaks unless something detaches it, which is exactly the bug [`AbstractSelectableList.syncRows`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1567) exists to prevent for pooled rows. It would also change visible behaviour in places that already have a considered tooltip story: a container whose own hover hint is attached to itself would be shadowed wherever its inner label happens to receive the hover instead, since `Event.addListener` matches the exact target id. `Button` happens to be safe (it sets `pointerEvents: "none"` on its label at [`Button.ts:637`](packages/lib/src/typescript/lib/component/button/Button.ts#L637)) but that is a property of `Button`, not a guarantee across the library. These two — the leak risk and the shadowing risk — are what actually motivate `false`; the registry-entry cost itself is small enough that it wouldn't justify the default on its own. Default `false` keeps every existing screen bit-identical and leaves the feature to callers who want it.

[^why-listeners-already-shared]: `Tooltip.attach` never adds a native DOM listener per component. `Event.addListener` (`Event.ts:540`) routes every registration through `registerEntry` into a module-private `listenerMap: Map<eventType, Map<elementId, CompFunc>>`; the actual `window.addEventListener` call happens once per event type, in `installBaseListener` (`Event.ts:214`), the first time *anything* registers for that type — so there is exactly one native `mouseover`, `mousemove`, `mouseout`, and `mousedown` listener for the whole app, shared by every component that has ever called `Event.addListener` (including every other `Tooltip.attach` consumer: `Button`, `SplitGutter`, `AbstractSelectableList`, table headers). The single shared `baseListener` (`Event.ts:248`) dispatches by resolving the event target to an element id and doing one `Map.get` per map, then invoking whichever `CompFunc.listeners` matched. What scales per `Text` that opts in to `truncateTooltip` is therefore just the registry-side cost: four small closures plus four `Map` entries plus one `Tooltip.attachments` entry — cheap, but not zero, and still something `destructor` has to release (step 8). A design that shares even that — one global handler that checks "is the hovered component a truncating `Text`" directly, with no per-instance registration at all — was considered and rejected as out of scope: it would mean replacing the attach/detach model for every `Tooltip` consumer, not just `Text`, to save bookkeeping that is already inexpensive.

[^why-single-owner]: The alternative was making `setTruncate(false)` detach and `setTruncate(true)` re-attach, so the attachment mirrors whether truncation is even possible. That splits ownership of the wiring across two setters and creates an ordering question (what does `setTruncateTooltip(true)` do on a `Text` that is not truncating, and what happens when `setTruncate` flips afterwards?). Gating inside the resolver has none of that: the attachment tracks exactly one option, and the truncation state is read fresh at hover time, which is the only moment it matters.

[^why-cycle]: A Tarjan run over every `~/`-prefixed import in `packages/lib/src/typescript/lib` finds zero non-trivial strongly-connected components today, so this is a new pattern and needs justifying rather than assuming. Three cycle-free alternatives were considered and rejected. Replacing `Tooltip`'s internal `Text` label with something that does not import `Text` means rewriting the sizing and layout of a shared overlay to fix an import edge — far larger and riskier than the feature. A registration seam in `core/` that `Tooltip` populates and `Text` reads is a service locator built for one consumer, with no precedent anywhere in this codebase. A dynamic `import()` inside the setter makes a synchronous hover path asynchronous. What makes the cycle safe is that it is runtime-only in both directions: `Tooltip` touches `Text` only in `new Text()` inside its private constructor, reached lazily through `getInstance()`, and `Text` touches `Tooltip` only inside `setTruncateTooltip`, `destructor`, and the resolver. Neither module body evaluates a binding from the other, so whichever loads first finishes evaluating before any use. Both orders are already covered: `tests/overlay/Tooltip.test.ts` imports `~/overlay/Tooltip` first and `tests/component/input/TextTruncateOption.test.ts` imports `~/component/input/Text` first, and vitest gives each file its own module graph.
