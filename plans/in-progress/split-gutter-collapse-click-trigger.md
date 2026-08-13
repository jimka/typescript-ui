# Split Gutter Collapse Click Trigger — Implementation Plan

## Overview

A `Split` gutter's collapse chevron only ever collapses or restores its pane on a **double-click** — the button that draws it, [`CollapseButton`](../packages/lib/src/typescript/lib/component/container/CollapseButton.ts), hardcodes `Event.addListener(this, "dblclick", this.onDoubleClick)` at [CollapseButton.ts:157](../packages/lib/src/typescript/lib/component/container/CollapseButton.ts#L157). This plan adds an opt-in option that switches that gesture to a single click instead, defaulting to today's double-click so every existing call site is unaffected.

The option is added at its mechanism's source, `CollapseButtonOptions.trigger` on [CollapseButton.ts:40](../packages/lib/src/typescript/lib/component/container/CollapseButton.ts#L40), and threaded down two container layers that already forward construction options to their children this same way: `SplitGutterOptions.collapseTrigger` on [SplitGutter.ts:38](../packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L38), which the gutter forwards into the `CollapseButton` it constructs at [SplitGutter.ts:154-157](../packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L154-L157); and `SplitOptions.collapseTrigger` on [Split.ts:62](../packages/lib/src/typescript/lib/layout/Split.ts#L62), which `Split` forwards into every gutter it constructs at [Split.ts:1194](../packages/lib/src/typescript/lib/layout/Split.ts#L1194). `SplitGutter.updateTooltip()` ([SplitGutter.ts:371-405](../packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L371-L405)) is updated so its hover hint reads "Click to …" instead of "Double-click to …" when the click trigger is active.

`Border` ([Border.ts:380-386](../packages/lib/src/typescript/lib/layout/Border.ts#L380-L386)) and `Rail` ([Rail.ts:313-316](../packages/lib/src/typescript/lib/overlay/Rail.ts#L313-L316)) both construct a `SplitGutter` / `CollapseButton` without the new field, so neither gains the option and neither changes behaviour — see `## Non-Goals`.

---

## Architecture Decisions

### The flag lives on `CollapseButtonOptions`, forwarded through `SplitGutterOptions` and `SplitOptions`

`CollapseButtonOptions.trigger` is the source of truth; `SplitGutterOptions.collapseTrigger` and `SplitOptions.collapseTrigger` are pass-through fields that each layer forwards to the next when it constructs its child.[^placement] This mirrors how `SplitGutter` already forwards `collapseDirection` into `CollapseButtonOptions.direction` at construction ([SplitGutter.ts:154-157](../packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L154-L157)), and how `Split` already forwards its own configuration into every `SplitGutter` it builds in `doLayout` ([Split.ts:1194](../packages/lib/src/typescript/lib/layout/Split.ts#L1194)) — a container option-bag field threaded one construction call at a time into the child's own option bag, the established pattern for this class of problem in this codebase.

### Field renames at each layer, matching the `direction` / `collapseDirection` precedent

`CollapseButtonOptions` calls the field `trigger` (unambiguous inside a button that has only one gesture concept); `SplitGutterOptions` and `SplitOptions` both call it `collapseTrigger` (disambiguating it from the gutter's own drag/orientation concepts). This exactly mirrors the existing split: `CollapseButtonOptions.direction` becomes `SplitGutterOptions.collapseDirection` for the same reason ([SplitGutter.ts:58](../packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L58) vs. [CollapseButton.ts:41](../packages/lib/src/typescript/lib/component/container/CollapseButton.ts#L41)).

### Default is `"dblclick"` everywhere, purely additive

Every layer defaults the field to `"dblclick"`, so a caller that never sets it sees no behaviour change. This is a hard requirement from the request, not just a convenience.

### `Border` and `Rail` are unchanged, not extended

Neither `BorderOptions` nor `RailOptions` gains the field. `Border` builds its gutters at [Border.ts:380-386](../packages/lib/src/typescript/lib/layout/Border.ts#L380-L386) without passing `collapseTrigger`, and `Rail` builds its own `CollapseButton` at [Rail.ts:313-316](../packages/lib/src/typescript/lib/overlay/Rail.ts#L313-L316) without passing `trigger` — both fall through to the `"dblclick"` default, so their behaviour is provably unaffected without touching either file.[^border-rail-scope]

### No new setter or getter on `SplitGutter` or `Split`

`SplitGutter` and `Split` gain no `setCollapseTrigger` / `getCollapseTrigger` pair. The value is read once at construction and forwarded; nothing in the request needs it to change afterward, and `SplitGutter.expandedBackground` — a field of the same shape (construction-only, forwarded once, never re-read) — already has neither accessor ([SplitGutter.ts:64](../packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L64), no `getExpandedBackground`). `CollapseButton` does gain a read-only `getTrigger()`, because `CollapseButton` already exposes the equivalent `getDirection()` / round-trips it in tests ([CollapseButton.test.ts:18-28](../packages/lib/tests/component/container/CollapseButton.test.ts#L18-L28)), and a future direct `CollapseButton` consumer (e.g. `Rail`, if it opts in later) needs a way to read back what it configured.

### The default-options-fallback registry gets no new row

`collapseTrigger` and `trigger` are plain fields assigned once in their constructors, never folded through a class-level `_defaultXxxOptions` getter — so they fall outside what [`default-options-fallback.test.ts`](../packages/lib/tests/component/default-options-fallback.test.ts) guards against, and no row is added there.[^no-registry-row]

### The chevron's `mousedown`-swallow keeps drag-safety in both trigger modes

`CollapseButton.onMouseDown` unconditionally stops `mousedown` from reaching the host ([CollapseButton.ts:296-305](../packages/lib/src/typescript/lib/component/container/CollapseButton.ts#L296-L305)), so a press on the chevron never starts a gutter drag, regardless of trigger mode. Separately, a browser only fires `click` (or `dblclick`) when `mousedown` and `mouseup` land on the same element — a genuine drag releases off the button and produces neither event. Switching the trigger to `"click"` does not weaken this: no new guard is needed.[^double-click-in-click-mode]

---

## Public API

```typescript
// CollapseButton.ts
export type CollapseTrigger = "click" | "dblclick";

export interface CollapseButtonOptions extends ComponentOptions {
    direction?: CollapseDirection;
    /**
     * The gesture that fires `collapse`: `"dblclick"` (the default,
     * preserving today's behaviour) or `"click"` for a single click.
     */
    trigger?: CollapseTrigger;
    listeners?: { collapse?: () => void };
}

class CollapseButton {
    /** Returns the configured activation trigger. Backed by `_trigger`. */
    getTrigger(): CollapseTrigger;
}
```

```typescript
// SplitGutter.ts
export interface SplitGutterOptions extends ComponentOptions {
    // ...existing fields...
    /**
     * The chevron's activation gesture: `"dblclick"` (the default,
     * preserving today's behaviour) or `"click"`. Forwarded to the
     * {@link CollapseButton}'s own `trigger` option. Read once at
     * construction.
     */
    collapseTrigger?: CollapseTrigger;
}
```

```typescript
// Split.ts
export interface SplitOptions extends LayoutManagerOptions {
    // ...existing fields...
    /**
     * The gutters' chevron activation gesture: `"dblclick"` (the default,
     * preserving today's behaviour) or `"click"`. Forwarded to every
     * {@link SplitGutter} this manager creates, via its own
     * `collapseTrigger` option. Read once at construction; changing it
     * after gutters exist has no effect on them.
     */
    collapseTrigger?: CollapseTrigger;
}
```

`CollapseTrigger` is re-exported from `component/container/index.ts` alongside `CollapseDirection`; `SplitGutterOptions` and `SplitOptions` already export their whole interface, so the new field needs no separate barrel entry.

---

## Tooltip text per trigger mode

`SplitGutter.updateTooltip()` picks the leading verb from `this._collapseTrigger`; everything else about the sentence (action, direction) is unchanged from today:

| `collapseTrigger` | `isOpaque()` | action | tooltip text |
|---|---|---|---|
| `"dblclick"` (default) | `false` | collapse | `Double-click to collapse westward` |
| `"click"` | `false` | collapse | `Click to collapse westward` |
| `"click"` | `true` | expand | `Click to expand eastward` |

---

## Ordered Implementation Steps

1. **`CollapseButton.ts`** — add the type and option field.
   - After `export type CollapseDirection = ...` ([CollapseButton.ts:26](../packages/lib/src/typescript/lib/component/container/CollapseButton.ts#L26)), add `export type CollapseTrigger = "click" | "dblclick";` with a short JSDoc block matching `CollapseDirection`'s style.
   - In `CollapseButtonOptions` ([CollapseButton.ts:40-49](../packages/lib/src/typescript/lib/component/container/CollapseButton.ts#L40-L49)), add `trigger?: CollapseTrigger;` with the JSDoc from `## Public API`.
   - Add a private field, initialised to the default: `private _trigger: CollapseTrigger = "dblclick";` (no `declare` — it is never written by an `applyOptions`-dispatched setter, so it is not subject to the `super()`-cascade trap).

2. **`CollapseButton.ts`** — read the option and wire the right listener.
   - In the constructor ([CollapseButton.ts:139-159](../packages/lib/src/typescript/lib/component/container/CollapseButton.ts#L139-L159)), immediately after `this._direction ??= "east";`, add `this._trigger = options?.trigger ?? "dblclick";`.
   - Replace `Event.addListener(this, "dblclick", this.onDoubleClick);` ([CollapseButton.ts:157](../packages/lib/src/typescript/lib/component/container/CollapseButton.ts#L157)) with `Event.addListener(this, this._trigger === "click" ? "click" : "dblclick", this.onActivate);`. Only one of `"click"` / `"dblclick"` is ever registered per instance.
   - Rename the private handler `onDoubleClick` ([CollapseButton.ts:290-294](../packages/lib/src/typescript/lib/component/container/CollapseButton.ts#L290-L294)) to `onActivate`, updating its JSDoc to describe both trigger modes (it now fires on whichever DOM event was registered).
   - Add a getter next to `getDirection()` ([CollapseButton.ts:227-229](../packages/lib/src/typescript/lib/component/container/CollapseButton.ts#L227-L229)): `getTrigger(): CollapseTrigger { return this._trigger; }`.
   - Update the class-level JSDoc paragraph ([CollapseButton.ts:118-125](../packages/lib/src/typescript/lib/component/container/CollapseButton.ts#L118-L125)) — it currently states activation "is a double-click, never a single click"; rewrite it to state the default is double-click, `trigger: "click"` makes it single-click, and that grabbing the button for a drag can't accidentally activate it in *either* mode (per the `## Architecture Decisions` reasoning: a genuine drag releases off the button, producing neither `click` nor `dblclick`, and `mousedown` is separately stopped from reaching the host).
   - Update the constructor's `@param options` JSDoc to mention the trigger alongside direction and the listener bag.
   - Do **not** add `trigger` to `applyOptions` — it is read directly from the constructor's `options` parameter, the same way `SplitGutter` reads `expandedBackground` directly rather than routing it through a setter.

3. **`component/container/index.ts`** — export the new type.
   - On the `CollapseButtonOptions` type-export line ([index.ts:36](../packages/lib/src/typescript/lib/component/container/index.ts#L36)), add `CollapseTrigger` to the list: `export type { CollapseButtonOptions, CollapseButtonEvent, CollapseDirection, CollapseTrigger } from '~/component/container/CollapseButton.js';`.
   - Check: `grep -n "CollapseTrigger" packages/lib/src/typescript/lib/component/container/index.ts` finds the new entry.

4. **`SplitGutter.ts`** — accept and forward the option.
   - Change the import at [SplitGutter.ts:6](../packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L6) to `import { CollapseButton, CollapseDirection, CollapseTrigger } from "~/component/container/CollapseButton.js";`.
   - In `SplitGutterOptions` ([SplitGutter.ts:38-75](../packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L38-L75)), add `collapseTrigger?: CollapseTrigger;` with the JSDoc from `## Public API`, placed next to `collapseDirection`.
   - Add a private field next to `_collapseDirection` ([SplitGutter.ts:115](../packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L115)): `private _collapseTrigger: CollapseTrigger = "dblclick";`.
   - In the constructor, immediately before the `_collapseDirection` assignment ([SplitGutter.ts:152](../packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L152)), add: `this._collapseTrigger = options?.collapseTrigger ?? "dblclick";`.
   - In the `new CollapseButton({...})` call ([SplitGutter.ts:154-157](../packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L154-L157)), add `trigger: this._collapseTrigger,` alongside `direction`.

5. **`SplitGutter.ts`** — update the tooltip.
   - In `updateTooltip()` ([SplitGutter.ts:371-405](../packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L371-L405)), before building `text`, add: `const verb = this._collapseTrigger === "click" ? "Click" : "Double-click";` and change the template to `` `${verb} to ${action} ${direction}ward` ``, replacing the hardcoded `Double-click`.
   - Update `updateTooltip`'s own JSDoc ("to describe the double-click action for the current state") to say "the configured activation gesture" instead of hardcoding double-click.

6. **`Split.ts`** — accept and forward the option.
   - Change the import at [Split.ts:5](../packages/lib/src/typescript/lib/layout/Split.ts#L5) to `import { CollapseDirection, CollapseTrigger } from "~/component/container/CollapseButton.js";`.
   - In `SplitOptions` ([Split.ts:62-76](../packages/lib/src/typescript/lib/layout/Split.ts#L62-L76)), add `collapseTrigger?: CollapseTrigger;` with the JSDoc from `## Public API`.
   - Add a private field near the other per-instance state (e.g. beside `_orientation` at [Split.ts:87](../packages/lib/src/typescript/lib/layout/Split.ts#L87)): `private _collapseTrigger: CollapseTrigger = "dblclick";`.
   - In `applyOptions` ([Split.ts:159-189](../packages/lib/src/typescript/lib/layout/Split.ts#L159-L189)), after the `orientation` dispatch ([Split.ts:162-164](../packages/lib/src/typescript/lib/layout/Split.ts#L162-L164)), add: `if (options.collapseTrigger !== undefined) { this._collapseTrigger = options.collapseTrigger; }`.
   - In `doLayout`'s gutter-construction loop ([Split.ts:1194](../packages/lib/src/typescript/lib/layout/Split.ts#L1194)), change `new SplitGutter(this._orientation, { expandedBackground: "transparent" })` to `new SplitGutter(this._orientation, { expandedBackground: "transparent", collapseTrigger: this._collapseTrigger })`.
   - Check: `grep -n "collapseTrigger" packages/lib/src/typescript/lib/layout/Split.ts` shows the field, the `applyOptions` dispatch, and the `doLayout` forward — three hits.

7. **Tests — `CollapseButton.test.ts`.** Add a `describe('CollapseButton trigger', ...)` block next to the existing `describe('CollapseButton direction', ...)` ([CollapseButton.test.ts:15-38](../packages/lib/tests/component/container/CollapseButton.test.ts#L15-L38)), covering behaviours 1-2 in `## Expected Behaviour`.

8. **Tests — `SplitGutter.tooltip.test.ts`.** Add a `tooltipText(id)` helper next to `hasTooltip(id)` ([SplitGutter.tooltip.test.ts:19-21](../packages/lib/tests/component/container/SplitGutter.tooltip.test.ts#L19-L21)) that reads `(Tooltip as any).attachments.get(id)?.text`, then add a `describe('SplitGutter collapse tooltip text', ...)` block covering behaviours 3-5.

9. **Tests — `Split.test.ts`.** Add a test in a new `describe('Split collapseTrigger', ...)` block. `_gutters` is only populated inside `doLayout`'s gutter-construction loop, so — mirroring the existing `'caps a gutter-drag at the pane max...'` test's setup ([Split.test.ts:692-701](../packages/lib/tests/component/layout/Split.test.ts#L692-L701)) — build the host with `hostSplit`, call `host.doLayout()` explicitly, then read `(split as any)._gutters[0]._collapseButton.getTrigger()` — covers behaviour 6.

10. **Docs — `packages/lib/docs/layouts/Split.md`.** In the "Collapsible panels" section ([Split.md:50-59](../packages/lib/docs/layouts/Split.md#L50-L59)), which currently states "A single click or a drag never collapses — only a `dblclick` does", add a short paragraph describing the `collapseTrigger` option and that `"click"` changes this. Do not change `docs/layouts/Border.md` — its "only a `dblclick` collapses" statement stays true (`## Non-Goals`).

11. **Docs — `packages/lib/docs/reference/changelog/next.md`.** Under `## Added` → `### Layout` ([next.md:65-75](../packages/lib/docs/reference/changelog/next.md#L65-L75)), add a bullet describing `SplitOptions.collapseTrigger` / `SplitGutterOptions.collapseTrigger` / `CollapseButtonOptions.trigger`, in the same style as the existing `BoxLayout.itemAlign` entry.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/container/CollapseButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/index.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/SplitGutter.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Split.ts` |
| Modify | `packages/lib/tests/component/container/CollapseButton.test.ts` |
| Modify | `packages/lib/tests/component/container/SplitGutter.tooltip.test.ts` |
| Modify | `packages/lib/tests/component/layout/Split.test.ts` |
| Modify | `packages/lib/docs/layouts/Split.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Unit-testable (offline, via `vitest`):

1. `new CollapseButton().getTrigger()` returns `"dblclick"`.
2. `new CollapseButton({ trigger: "click" }).getTrigger()` returns `"click"`.
3. `new SplitGutter('horizontal')`'s tooltip text (via the new `tooltipText` helper) is `"Double-click to collapse westward"` — the existing default, now asserted on exact text rather than only presence.
4. `new SplitGutter('horizontal', { collapseTrigger: 'click' })`'s tooltip text is `"Click to collapse westward"`.
5. Calling `setOpaque(true)` on a `collapseTrigger: 'click'` gutter changes its tooltip text to `"Click to expand eastward"` — verb stays `"Click"`, action and direction flip exactly as they do today for the double-click default.
6. After a layout pass, `new Split({ collapseTrigger: 'click' })`'s first constructed gutter has `_collapseButton.getTrigger() === 'click'`; a plain `new Split()`'s gutter has `_collapseButton.getTrigger() === 'dblclick'`.

Not unit-testable — requires a real browser (the offline recording DOM sink does not dispatch `click`/`dblclick` to the window-level capture handler, per the existing note in [CollapseButton.test.ts:63-67](../packages/lib/tests/component/container/CollapseButton.test.ts#L63-L67)). Mark these manual-verify:

7. A default `CollapseButton` fires `collapse` on a real `dblclick` and does not fire it on a single `click` — confirms no regression.
8. A `CollapseButton({ trigger: "click" })` fires `collapse` on a single `click` and needs no second click.
9. Dragging from the chevron (mousedown, move, mouseup elsewhere) never fires `collapse`, in either trigger mode.
10. A `Split({ collapseTrigger: 'click' })` pane collapses and restores on a single click of its gutter chevron — full end-to-end smoke test, including the collapse animation and the `panecollapse` event.
11. Rapid double-clicking a `collapseTrigger: 'click'` chevron fires `collapse` twice in quick succession, netting the pane back to its starting state (an expand immediately following a collapse, or vice versa). This is expected, not a bug: `Split`'s existing `_collapseAnimation` cancel-and-retarget logic (built for exactly this kind of rapid re-toggle) absorbs it without new code. Verify no stuck animation or visual glitch results.

Confirm unaffected (no test needed, verified by inspection during implementation):

12. `Border`'s regions still collapse only on double-click — its `SplitGutter` construction at [Border.ts:380-386](../packages/lib/src/typescript/lib/layout/Border.ts#L380-L386) never sets `collapseTrigger`.
13. `Rail`'s chevron still collapses only on double-click — its `CollapseButton` construction at [Rail.ts:313-316](../packages/lib/src/typescript/lib/overlay/Rail.ts#L313-L316) never sets `trigger`.

---

## Verification

- `npm run typecheck` — must pass with zero errors.
- `npm run lint` — must pass with zero new warnings.
- `npx vitest run tests/component/container/CollapseButton.test.ts tests/component/container/SplitGutter.tooltip.test.ts tests/component/layout/Split.test.ts` (run from `packages/lib`) — new and existing cases in these three files pass.
- `npm run test` (root) — full suite, confirms no regression elsewhere.
- `npm run docs:api` — zero warnings (the new public `trigger` / `collapseTrigger` JSDoc must not `{@link}` anything excluded from the public docs).
- Manual smoke test, per behaviours 7-11 above: run the app (`npm run dev`), open a page with a `Split` (e.g. the Split demo), construct one instance with `collapseTrigger: 'click'` and confirm single-click collapse/restore, then confirm a default `Split` still requires a double-click.

---

## Documentation Impact

- `packages/lib/docs/layouts/Split.md` — the "Collapsible panels" section currently asserts double-click is the only trigger; update per step 10.
- `packages/lib/docs/layouts/Border.md` — no change; its double-click-only statement remains accurate since `Border` doesn't gain the option.
- `packages/lib/docs/reference/changelog/next.md` — add the `### Layout` entry per step 11.
- TypeDoc picks up the new `CollapseTrigger` type and the three option fields automatically from their JSDoc once `component/container/index.ts` re-exports `CollapseTrigger` (step 3) — no separate API-reference page edits needed.

---

## Potential Challenges

- **Rapid double-click while in `"click"` mode nets a no-op toggle.** Not a defect — see `Expected Behaviour` item 11. No mitigation needed; `Split`'s existing re-toggle handling already covers it.
- **`onDoubleClick` rename to `onActivate` is a private method — grep for stragglers.** `grep -rn "onDoubleClick" packages/lib/src` after step 2 should show zero remaining references outside this file's own history (git blame), confirming no other file reached past `CollapseButton`'s private surface.

---

## Critical Files

- [`CollapseButton.ts`](../packages/lib/src/typescript/lib/component/container/CollapseButton.ts) — the mechanism being made configurable; read in full before editing.
- [`SplitGutter.ts`](../packages/lib/src/typescript/lib/component/container/SplitGutter.ts) — the forwarding precedent for `collapseDirection` (cited in `## Architecture Decisions`) and the tooltip logic to update.
- [`Split.ts`](../packages/lib/src/typescript/lib/layout/Split.ts) — the outer forwarding layer and the `doLayout` gutter-construction site.
- [`Border.ts`](../packages/lib/src/typescript/lib/layout/Border.ts) and [`Rail.ts`](../packages/lib/src/typescript/lib/overlay/Rail.ts) — confirm both stay behaviourally unchanged (`## Non-Goals`).
- [`CollapseButton.test.ts`](../packages/lib/tests/component/container/CollapseButton.test.ts), [`SplitGutter.tooltip.test.ts`](../packages/lib/tests/component/container/SplitGutter.tooltip.test.ts), [`Split.test.ts`](../packages/lib/tests/component/layout/Split.test.ts) — existing test patterns (offline-testable surface, private-field casts, tooltip attachment inspection) the new tests must follow.
- [`ARCHITECTURE.md`](../ARCHITECTURE.md) — "All attributes and styles go through typed setters" (the options-bag-is-the-cache rule the new fields follow) and "Class-level defaults must survive the getter" (the trap `## Architecture Decisions` confirms does not apply to these fields).

---

## Non-Goals

- **`BorderOptions` does not gain a `collapseTrigger` field.** The request was scoped to `Split`; `Border`'s regions keep double-click-only. Revisit only if a future request asks for it explicitly.
- **`RailOptions` does not gain a `trigger` field.** Same reasoning; `Rail`'s chevron keeps double-click-only. Placing the option on `CollapseButtonOptions` (rather than only on `SplitGutterOptions`) means a future `Rail` opt-in needs no `CollapseButton` changes — only a `RailOptions` field and one forwarded constructor argument.
- **No gutter-body click/double-click trigger.** Today, only the chevron (`CollapseButton`) reacts to the collapse gesture — the gutter's own body has no `click`/`dblclick` listener, only `mousedown` for dragging. This plan does not add one; it only changes which gesture the existing chevron listens for.
- **No runtime `setCollapseTrigger`.** See `## Architecture Decisions` — construction-time only, matching `expandedBackground`.

---

## Notes

[^placement]: An alternative considered was putting `collapseTrigger` only on `SplitOptions` / `SplitGutterOptions`, leaving `CollapseButtonOptions` untouched and instead passing a private, undocumented field into the `CollapseButton` constructor. Rejected: `CollapseButton` is where the actual `Event.addListener` call lives, so hiding the option there would mean duplicating the click-vs-dblclick decision at a second layer instead of reading it once at the source. Putting it on the public `CollapseButtonOptions` costs one extra field and gets `Rail` (and any future direct `CollapseButton` consumer) the same capability for free, without committing this plan to actually wiring it into `RailOptions` — see `## Non-Goals`.

[^border-rail-scope]: `Border` and `Rail` were investigated specifically because both reuse `SplitGutter` / `CollapseButton` and both carry the same "double-click to collapse" convention in their own doc comments ([Border.ts:365-366](../packages/lib/src/typescript/lib/layout/Border.ts#L365-L366), [Rail.ts:309-312](../packages/lib/src/typescript/lib/overlay/Rail.ts#L309-L312)). Since the default is `"dblclick"` and neither passes the new field, both are provably unaffected by construction — no test addition or manual re-verification of `Border`/`Rail` collapse behaviour is required beyond the existing suites continuing to pass.

[^double-click-in-click-mode]: Browsers fire `click` (and, for two clicks close together, `dblclick`) only when `mousedown` and the matching `mouseup` land on the same element. A real drag — press, move the pointer away, release elsewhere — produces neither event on the button, in either trigger mode. This is why no new drag-guard code is needed when adding the `"click"` trigger: the existing safety property ("grabbing the button for a drag can never collapse by accident") was never specific to `dblclick`: swap in "click" and the reasoning is checked separately in the ordered steps' rewrite of the class JSDoc.

[^no-registry-row]: The registry only guards fields whose getter folds in a class-level `_defaultXxxOptions` value (`this._options.foo ?? this._defaultOptions.foo ?? null`, or the equivalent `_collapsible ?? this._defaultOptions.collapsible!` shape) — the pattern `SplitGutter.isCollapsible()` / `isMovable()` use, both of which have registry rows ([default-options-fallback.test.ts:297-298](../packages/lib/tests/component/default-options-fallback.test.ts#L297-L298)). `collapseTrigger` and `trigger` instead follow `SplitGutter._expandedBackground` / `_collapseDirection`'s pattern: a plain field assigned once in the constructor from `options?.field ?? default`, with a getter (where one exists, i.e. `CollapseButton.getTrigger()`) that returns it directly with no `??` fallback. Neither `expandedBackground` (which has no getter) nor `collapseDirection` (which has one, unfolded) has a registry row, confirming the pattern is exempt by design, not by oversight.
