---
depends-on: [cell-base-background-value-class-dedup]
touches-shared:
  - packages/lib/src/typescript/lib/core/Component.ts
---

# List-marker `min-width` value-class dedup — Implementation Plan

## Overview

A live Style Audit scan ([packages/lib/src/typescript/lib/diagnostics/StyleAudit.ts:108](packages/lib/src/typescript/lib/diagnostics/StyleAudit.ts#L108)) reports several duplicate-body rows attributed to component name `Text`. The name is a labelling artifact, not the culprit: [`buildComponentIndex`](packages/lib/src/typescript/lib/diagnostics/StyleAudit.ts#L36) reads an element's `class` attribute and takes the first token that is not `ts-ui-component`, and [`getStyleClassChain`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L978) writes that attribute topmost-ancestor-first — so every `Text` subclass reports as `Text`, never as its own class.[^label-artifact]

The rows whose body is a `min-width`/`min-height` pair come from one place: [`ListItem.setMarkerColumnWidth`](packages/lib/src/typescript/lib/component/list/ListItem.ts#L223) calls `this._marker.setMinSize({ width, height: 0 })` on a `ListItemMarkerText` ([ListItem.ts:49](packages/lib/src/typescript/lib/component/list/ListItem.ts#L49)). [`AbstractMarkerList.syncMarkerColumn`](packages/lib/src/typescript/lib/component/list/AbstractMarkerList.ts#L190) measures every item's marker, takes the widest, and pushes that one number onto **every** item in the list. A list of N items therefore produces N `ListItemMarkerText` instances each writing the byte-identical `{ min-width: Wpx; min-height: 0px; }` to its own `#id` rule.

This plan routes that write through the framework's existing value-class mechanism, [`Component.setValueStyleState`](packages/lib/src/typescript/lib/core/Component.ts#L5751), so every `ListItemMarkerText` resolving the same constraint shares one `.ListItemMarkerText.minsz<w>x<h>` class rule. The change is a `setMinSize` override and a `render` token re-assert on `ListItemMarkerText`, plus one new `protected` forwarder on `Component`.

It must land after `plans/cell-base-background-value-class-dedup.md`, which is what stops the render pass from writing the per-instance declaration anyway — see `## Architecture Decisions`.

---

## Architecture Decisions

### Sharing is safe when the class token is a total function of the shared rule's declarations

Two instances may share a value-class rule when the token naming that rule is derived from **every** declaration the rule carries. Under that rule, "same token" and "same CSS" are the same statement, so sharing an immutable, write-once rule is indistinguishable from each instance writing its own.[^coincidence]

`ensureClassStateRule` ([ClassStyleRules.ts:1045](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L1045)) keys its cache on `(constructor, suffix)` and returns the existing entry untouched on a second request — the first caller's declarations win permanently. That first-caller-wins behaviour is what makes the derivation rule load-bearing: a token derived from *less* than the full declaration set lets a second caller with different declarations claim the first caller's rule and silently inherit its CSS.

| Constraint written | Token derived from width only | Token derived from both axes | Rule the instance lands on |
|---|---|---|---|
| `{ width: 12, height: 0 }` | `minsz12px` | `minsz12x0` | `{ min-width: 12px; min-height: 0px }` |
| `{ width: 12, height: 0 }`, second list | `minsz12px` — shared, correct | `minsz12x0` — shared, correct | same rule, same declarations |
| `{ width: 12, height: 5 }` | `minsz12px` — **wrong**: silently gets `min-height: 0px` | `minsz12x5` | its own `{ min-width: 12px; min-height: 5px }` |

Per-concrete-class scoping is a separate, already-satisfied requirement: `ensureClassStateRule` keys on the constructor, so `ListItemMarkerText`'s pool is disjoint from every other class's, exactly as [`text-lineheight-write-path-and-value-class-sharing.md`](implemented/text-lineheight-write-path-and-value-class-sharing.md)'s *no cross-class sharing* decision established.[^inherited-class-token]

### The write moves to `ListItemMarkerText.setMinSize`, not to `Component.setMinSize`

`ListItemMarkerText` overrides the public `setMinSize` and routes the CSS through the shared rule; every other component's `setMinSize` is untouched.[^why-not-base]

The override keeps the instance layer's cached value via [`cacheStyleValue`](packages/lib/src/typescript/lib/core/Component.ts#L5150) so `getMinSizeConstraint()` / `getMinSize()` / `clampWidth` keep resolving the constraint from JS exactly as today — only the CSS delivery tier changes.

### The shared rule only clears the `#id` declaration once the value-class layer exists

The shared rule alone is not enough. A component's render pass re-derives every layering property: `applyStyle` seeds its pending key set from **every** layer's resolved keys ([Component.ts:5866](packages/lib/src/typescript/lib/core/Component.ts#L5866)), and `minWidth`/`minHeight` are `FRAMEWORK_BASELINE_KEYS` ([Component.ts:407](packages/lib/src/typescript/lib/core/Component.ts#L407)), so they are always pending. `flushStyleBag` then compares the instance layer's `12px` against the layers below it, finds the class tier's `auto`, calls that a deviation, and writes `min-width` to `#id` anyway — where an id selector outranks the shared `.ListItemMarkerText.minsz12x0` rule.

`plans/cell-base-background-value-class-dedup.md` closes that gap by recording each value class as a real `StyleLayer` in `layersBelowInstance()` ([Component.ts:5054](packages/lib/src/typescript/lib/core/Component.ts#L5054)). With it, the comparison finds `12px` already delivered and queues an explicit removal instead. This plan therefore declares it as `depends-on` and is written against its post-change `_valueStyleTokens` shape, `Map<string, { token: string; layer: StyleLayer }>`.[^dependency]

### `Component` gains one `protected` forwarder for the constraint-change relay

`setMinSize` fires the private `_onConstraintSizeChange` slot ([Component.ts:510](packages/lib/src/typescript/lib/core/Component.ts#L510)), which the parent installs in `wireChild` ([Component.ts:6128](packages/lib/src/typescript/lib/core/Component.ts#L6128)) to relay a constraint change up the whole ancestor chain. A subclass override cannot reach a private field, so `Component` gains `protected notifyConstraintSizeChange(): void`.[^why-not-notify-intrinsic]

### `Legend`'s `max-width` is deliberately left alone

[`FieldSet.clampLegendWidth`](packages/lib/src/typescript/lib/component/container/FieldSet.ts#L114) calls `this._legend.setMaxSize({ width: innerW, height: Number.MAX_VALUE })` on every layout pass, where `innerW` is the fieldset's own committed pixel width. This plan does **not** give `Legend` a value class.

The blocking difference from the marker case is the shape of the value, not the sharing question. A marker column width is a text measurement drawn from a small, fixed set — the distinct marker strings an app renders. A fieldset's inner width is continuous and resize-driven: dragging a window from 300 px to 800 px walks `clampLegendWidth` through hundreds of distinct widths, and `ensureClassStateRule` never evicts a rule it has created. The pool would grow without bound for the lifetime of the page.[^legend-detail]

---

## Public API

No exported symbol changes. One new `protected` member on `Component`, excluded from the generated docs like every other `protected` member:

```typescript
/** Relays a constraint-size change up the ancestor chain, as setMinSize/setMaxSize do. */
protected notifyConstraintSizeChange(): void;
```

`ListItemMarkerText` is module-private to `component/list/ListItem.ts` and is not exported; its `setMinSize` override matches the inherited public signature `setMinSize(size: Size): this`.

---

## Internal Structure

### `core/Component.ts` — the new forwarder, placed immediately after `setMaxSize` ([Component.ts:3304](packages/lib/src/typescript/lib/core/Component.ts#L3304))

```typescript
/**
 * Relays a constraint-size change up the ancestor chain — the same notify
 * {@link setMinSize} and {@link setMaxSize} fire, for a subclass that
 * overrides one of them to publish its CSS through a shared value-class
 * rule instead of this instance's own `#id` rule. The slot itself is
 * installed by the parent when the child is attached, so this is a no-op
 * on a component with no wired parent.
 */
protected notifyConstraintSizeChange(): void {
    this._onConstraintSizeChange?.();
}
```

### `component/list/ListItem.ts` — the token helper, placed beside `MARKER_GAP_PX`

```typescript
/** Value-class namespace for a marker's shared minimum-size rule. */
const MARKER_MIN_SIZE_PREFIX = "minsz";

/** The CSS keys a `minSize` write resolves to, for the style-resolved hook. */
const MIN_SIZE_KEYS: ReadonlySet<string> = new Set(["minWidth", "minHeight"]);

/**
 * The value-class token body naming a marker's shared minimum-size rule —
 * e.g. `12x0` for `{ width: 12, height: 0 }`.
 *
 * Both axes appear because the shared rule declares both. A token derived
 * from one axis alone would let two different `{width, height}` pairs claim
 * the same rule, and the first to ask would silently decide the CSS for the
 * second — see the plan's Architecture Decisions. `setValueStyleState`
 * sanitizes the result, so a fractional measurement (`12.5x0`) is safe.
 *
 * @param size - The minimum size being published.
 * @returns The token body, without the prefix.
 */
function markerMinSizeToken(size: Size): string {
    return `${size.width}x${size.height}`;
}
```

### `component/list/ListItem.ts` — `ListItemMarkerText`'s two new methods

```typescript
/**
 * Publishes the shared marker-column minimum through a per-class,
 * per-value CSS rule instead of this instance's own `#id` rule. Every item
 * in a list receives the same column width, so N items would otherwise
 * write N identical `min-width`/`min-height` declarations.
 *
 * `cacheStyleValue` keeps the size getters resolving the constraint from
 * the instance layer without queueing a CSS write of its own;
 * `setValueStyleState` records the shared rule as a layer below the
 * instance layer, so `flushStyleBag` sees the value already delivered and
 * queues a removal rather than a per-instance declaration.
 *
 * @param size - The minimum size in pixels.
 * @returns This component, for method chaining.
 */
setMinSize(size: Size): this {
    const current = this.getMinSizeConstraint();

    if (current && current.width === size.width && current.height === size.height) {
        return this;
    }

    const next: Size = { width: size.width, height: size.height };

    this.cacheStyleValue("minSize", next);
    this.setValueStyleState(MARKER_MIN_SIZE_PREFIX, markerMinSizeToken(next), { minSize: next });
    this.onStyleResolved(MIN_SIZE_KEYS);
    this.notifyConstraintSizeChange();

    return this;
}

/**
 * Re-applies a value-class token recorded before this element existed —
 * `setValueStyleState`'s own DOM write is gated on `getElement()`. Mirrors
 * `Text.render()`'s re-assert for its own `lh` token.
 *
 * @returns The created element.
 */
protected render(): Handle {
    const element = super.render();

    const minSizeToken = this.getValueStyleToken(MARKER_MIN_SIZE_PREFIX);

    if (minSizeToken) {
        DOM.sink.apply(element, { addClass: [minSizeToken] });
    }

    return element;
}
```

`Size` and `Handle` are new imports in `ListItem.ts` (`~/primitive/Size.js`, `~/core/DOM.js` — `DOM` itself is already imported).

---

## Ordered Implementation Steps

1. **Write the new test file first.** Create `packages/lib/tests/component/list/ListItemMarker.valueClassDedup.test.ts`, copying the `CONFIG` constant and the `idSelector` / `declarationsDuring` helpers verbatim from [`tests/component/list/AbstractMarkerList.classStyleDefaults.test.ts:17-55`](packages/lib/tests/component/list/AbstractMarkerList.classStyleDefaults.test.ts#L17-L55), along with that file's `installTestDOM` / `fontMetrics` / `_ruleCacheHas` imports. Cover `## Expected Behaviour` rows 1-6. Reach each marker as `(item.getComponents() as Component[])[0]` — `ListItemMarkerText` is module-private and cannot be imported.
   *Check:* `npx vitest run tests/component/list/ListItemMarker.valueClassDedup.test.ts` from `packages/lib` — every case fails because the mechanism does not exist yet.

2. **`packages/lib/src/typescript/lib/core/Component.ts`** — add `notifyConstraintSizeChange` exactly as in `## Internal Structure`, immediately after `setMaxSize`.
   *Check:* `npm run typecheck`.

3. **`packages/lib/src/typescript/lib/component/list/ListItem.ts`** — add the `Size` and `Handle` imports and the three module-level constants/helpers (`MARKER_MIN_SIZE_PREFIX`, `MIN_SIZE_KEYS`, `markerMinSizeToken`) beside the existing `MARKER_GAP_PX`.
   *Check:* `npm run typecheck`.

4. **Same file** — add the `setMinSize` override and the `render` override to `ListItemMarkerText` ([ListItem.ts:49](packages/lib/src/typescript/lib/component/list/ListItem.ts#L49)), exactly as in `## Internal Structure`. Change nothing else in the class — its `ownClassStyleDefaults` and constructor stay as they are.
   *Check:* `npm run typecheck`.

5. **Run the new test file.** `npx vitest run tests/component/list/ListItemMarker.valueClassDedup.test.ts` — all green.

6. **Run the list and layout suites.** `npx vitest run tests/component/list/ tests/component/Component.test.ts` — all green. `MarkerListLayout.test.ts` reads marker geometry through `getMarkerWidth` / `getPreferredSize` / `getMinSize`, all of which resolve from the instance layer and are unaffected; `Component.test.ts`'s case 2 pins base `Component.setMinSize`'s per-instance `min-width` write, which this plan does not touch.

7. **Run the full suite.** `npx vitest run --no-file-parallelism` from `packages/lib`.

8. **Full verification.** See `## Verification`, including the mandatory live-browser step.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/tests/component/list/ListItemMarker.valueClassDedup.test.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/component/list/ListItem.ts` |

---

## Expected Behaviour

Rows 1-6 are unit-testable against the recording DOM sink. Rows 7-8 need a live browser.

| # | Case | Expected |
|---|---|---|
| 1 | A `NumberedList` of several items is hosted and laid out, so `syncMarkerColumn` pushes one width onto every item. Read the column width back as `W = list.getMarkerColumnWidth()` | No marker's own `#id` rule carries a non-null `minWidth` or `minHeight` declaration; `_ruleCacheHas('.ListItemMarkerText.minsz' + String(W).replace(/[^a-zA-Z0-9]/g, '_') + 'x0')` is `true` (the replace mirrors `setValueStyleState`'s own sanitizer, so a fractional measured width still matches) |
| 2 | Same list, every marker inspected | Every marker element carries the identical `minsz<W>x0` DOM class token |
| 3 | A `ListItem` whose marker is rendered (`marker.getElement(true)`), then `setMarkerColumnWidth(12)`, then `setMarkerColumnWidth(14)` | One `apply` write carries both `removeClass: ['minsz12x0']` and `addClass: ['minsz14x0']`; both `.ListItemMarkerText.minsz12x0` and `.ListItemMarkerText.minsz14x0` exist; the marker's `#id` rule still carries no real `minWidth`/`minHeight` |
| 4 | A freshly constructed `ListItem` — no `getElement` call on it or its marker — takes `setMarkerColumnWidth(12)`, then the marker is rendered with `getElement(true)` | No `apply` write adds a class before render; the rendered element carries `minsz12x0` |
| 5 | After `setMarkerColumnWidth(12)`, the marker's size getters are read | `getMinSizeConstraint()` returns `{ width: 12, height: 0 }` and `getMinSize()` folds it exactly as today — the value class changes CSS delivery only |
| 6 | Two `NumberedList`s in the same document whose widest markers measure the same width | Both lists' markers carry the same token and one `.ListItemMarkerText.minsz<W>x0` rule serves both; no second rule is created |
| 7 | Manual — live app: `#/marker-lists`, then `#/style-audit` | The `Text`-attributed duplicate rows whose body is a `min-width`/`min-height` pair are gone; every marker's trailing full stop still lines up down the list, labels start at the same offset, and no console errors appear |
| 8 | Manual — live app: `#/marker-lists`, resize the window and toggle a list's marker style | Marker columns re-align on every change; reading the marker element's computed `min-width` in DevTools shows the shared rule's value, and its `#id` rule declares no `min-width` |

---

## Verification

```
npm run typecheck
npm test
npm run lint
npm run docs:api        # must finish with zero warnings
```

Grep invariants, from `packages/lib`:

```
grep -n 'setValueStyleState' src/typescript/lib/component/list/ListItem.ts   # exactly one match
grep -rn 'setMinSize' src/typescript/lib/component/list/                     # exactly three: ListItem.ts's new override, its existing
                                                                            # setMarkerColumnWidth call, and AbstractSelectableList.ts:841
                                                                            # (an unrelated empty-state floor, untouched)
grep -n 'notifyConstraintSizeChange' src/typescript/lib/core/Component.ts \
                                     src/typescript/lib/component/list/ListItem.ts   # one match each
```

**Manual browser verification (rows 7-8) is required.** The offline harness records writes; it does not run a CSS cascade, and the Style Audit panel's byte counts can only be confirmed live. Start a dev server on a spare port from *this worktree*, not the user's existing one, and symlink `node_modules` first so the page resolves this worktree's `packages/lib` rather than the main tree's. Open the "Marker Lists" section (`#/marker-lists`), then the "Style Audit" section (`#/style-audit`). Read computed styles and the marker's own `#id` rule in DevTools rather than relying on screenshots.

---

## Implementation Notes

The `grep -rn 'setMinSize' src/typescript/lib/component/list/` invariant above
no longer finds a third, real match at `AbstractSelectableList.ts:841`. Since
this plan was drafted, that file's empty-state floor moved from an explicit
`setMinSize(...)` call to a declarative `minSize: { width: 100, height: 100 }`
entry in `_defaultAbstractSelectableListOptions` (dispatched through the
options-bag cascade instead) — its own comment now reads "a class default, not
a constructor `setMinSize`". The grep now finds exactly two real call sites
(`ListItem.ts`'s new override and its existing `setMarkerColumnWidth` call)
plus one comment-only mention of the string `setMinSize` at
`AbstractSelectableList.ts:162`. Unrelated codebase drift, not a defect in
this plan's implementation — noted so a future reader of this invariant isn't
surprised by the count.

**Manual browser verification (rows 7-8) was performed**, from this worktree
on a spare dev-server port (`vite --port 8021`, `node_modules` symlinked to
the main tree so the page resolved this worktree's `packages/lib`), via
Chrome DevTools. Findings:

- **Row 7:** On `#/marker-lists`, every list's trailing marker punctuation
  (`.`/`)`/etc.) lines up down the column and every label starts at the same
  offset, for all twelve `NumberedListItemStyle` variants and all four
  `BulletedListItemStyle` variants; no console errors. Inspecting a rendered
  marker in DevTools confirmed `className` carries a `minsz<W>x0` token (e.g.
  `minsz18x0`), `getComputedStyle(marker).minWidth` resolves to the expected
  pixel value, and enumerating the stylesheet found **no** rule matching that
  marker's own `#<id>` selector — its `min-width`/`min-height` come from the
  shared `.ListItemMarkerText.minsz18x0` class rule alone. On `#/style-audit`,
  after visiting `#/marker-lists` first to populate the shared stylesheet
  (switching tabs in-page, not a hard reload, so the registered rules
  persist) and clicking Refresh, no row's `body` column contains `min-width`
  or `min-height` anywhere in the table (checked via
  `document.body.innerText`) — the duplicate rows the plan's Overview
  describes are gone.
- **Row 8:** Resizing the browser window (1280×800 → 900×700) and navigating
  back to `#/marker-lists` re-flowed every list correctly, markers still
  aligned per list. Re-running the same DevTools check on a marker after the
  resize showed the same result: `getComputedStyle` reports the shared rule's
  `min-width`, and the marker's own `#<id>` rule still declares nothing.

---

## Potential Challenges

- **The per-instance `min-width` write does not disappear until `cell-base-background-value-class-dedup.md` has landed.** Without its value-class layer, `applyStyle`'s full-sweep seeding still reports the instance layer's `minWidth` as a deviation from the class tier and writes it to `#id` anyway — leaving the duplication in place *and* adding a dead shared rule. If row 1 fails with a real `minWidth` on `#id`, check that the dependency is actually merged before debugging anything else.
- **A marker measurement that lands on a fractional pixel** produces a token like `minsz12_5x0` (the sanitizer maps `.` to `_`). Correct, but two visually identical columns measured at `12` and `12.5` get separate rules — a missed dedup, never a wrong one.
- **`ListItemMarkerText` is module-private,** so the new tests must reach it through `ListItem.getComponents()[0]` rather than importing it. Exporting it purely for the test would widen the public surface for no consumer benefit.
- **`ensureClassStateRule` keys its rule on `constructor.name`,** so a minified build changes every selector. Pre-existing for every value class and shared state rule; tracked by `plans/minification-safe-class-names.md`, not by this plan.

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/component/list/ListItem.ts` | `ListItemMarkerText` (49), `getMarkerWidth` (206), `setMarkerColumnWidth` (223), `render` (238) — the class this plan edits |
| `packages/lib/src/typescript/lib/component/list/AbstractMarkerList.ts` | `doLayout` (168) and `syncMarkerColumn` (190) — the caller that pushes one width onto every item; unchanged by this plan |
| `packages/lib/src/typescript/lib/core/Component.ts` | `setMinSize` (3258), `getMinSizeConstraint` (3188), `cacheStyleValue` (5150), `layersBelowInstance` (5054), `flushStyleBag` (5395), `onStyleResolved` (5510), `setValueStyleState` (5751), `getValueStyleToken` (5778), `applyStyle`'s seeding loop (5866), `_onConstraintSizeChange` (510), `wireChild` (6128) |
| `packages/lib/src/typescript/lib/component/input/Text.ts` | `setLineHeight`'s `setValueStyleState` call (1197) and `render`'s token re-assert (1507) — the pattern both new methods mirror |
| `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` | `ensureClassStateRule` (1045) — first-caller-wins cache the safety argument rests on; `STYLE_WRITERS.minSize` (279) — the exact declarations a token must cover; `getStyleClassChain` (978) — why the audit labels every subclass `Text` |
| `plans/cell-base-background-value-class-dedup.md` | The `depends-on`. Its value-class layer is what makes `flushStyleBag` queue a removal instead of a per-instance `min-width`; its post-change `_valueStyleTokens` shape (`Map<string, { token; layer }>`) is what this plan's code is written against |
| `plans/implemented/text-lineheight-write-path-and-value-class-sharing.md` | Establishes the mechanism, the no-cross-class-sharing rule, and the caution this plan's central decision answers |
| `packages/lib/tests/component/list/AbstractMarkerList.classStyleDefaults.test.ts` | The test-file template (`CONFIG` and helpers at 17-55) the new file copies |
| `packages/lib/tests/component/list/MarkerListLayout.test.ts` | Existing marker-geometry coverage that must stay green — in particular case 14 (545), which calls `setMarkerColumnWidth` on a rendered item |

---

## Non-Goals

- **A `max-width` value class for `Legend`.** Its value is continuous and resize-driven, so the rule pool would grow without bound — see `## Architecture Decisions`. The `Legend` rows in the same audit sweep are owned by `plans/legend-margin-left-dedup.md`, whose `margin-left` hoist is what actually clears a legend's `#id` rule.
- **Routing `Component.setMinSize` / `setMaxSize` through a value class for every component.** Nothing else writes one constraint across many sibling instances, and min/max size is a layout input read back through the layer stack on every pass.
- **Generalising the value-class token re-assert into `Component.init`.** `Text.render` already hand-writes its own; a second hand-written one follows that precedent, and generalising would pile onto the `_valueStyleTokens` refactor this plan already depends on.
- **Changing `AbstractMarkerList.syncMarkerColumn`, `ListItem.setMarkerColumnWidth`, or the marker's use of `setMinSize` rather than `setPreferredSize`.** Every caller keeps working exactly as today; the deliberate choice of a minimum over a preferred size is documented at the call site and unchanged.
- **A changelog entry.** No exported symbol changes and nothing renders differently, matching `plans/legend-margin-left-dedup.md`'s reasoning for the same class of pure-dedup change.
- **Fixing the Style Audit's component labelling.** `buildComponentIndex` reporting the topmost ancestor is a real reporting weakness, but it is a diagnostics change with its own blast radius.
- **Bumping the package version.** Release-time bookkeeping.

---

## Notes

[^label-artifact]: `getStyleClassChain` builds `[...parentChain, ctor.name]`, so a participating chain writes `class="ts-ui-component Text ListItemMarkerText"` — ancestor first. `buildComponentIndex` takes `classAttr.split(/\s+/).find((cls) => cls !== "" && cls !== COMPONENT_CLASS)`, which is therefore always the topmost participating ancestor. `Text` declares `ownClassStyleDefaults`, so every `Text` subclass participates and every one of them reports as `Text`. Confirming this mattered because it is what makes several audit rows look like one problem when they are two unrelated call sites.

[^coincidence]: [`text-lineheight-write-path-and-value-class-sharing.md`](implemented/text-lineheight-write-path-and-value-class-sharing.md)'s Architecture Decisions inherited a caution from `shared-instance-style-groups.md`: a content-addressed cache "risks silently coupling two call sites that happen to produce the same value by coincidence." That caution does not survive contact with this case, for two reasons.

    First, `setValueStyleState` is not purely content-addressed. Its cache key is `(concrete constructor, prefix, sanitized value)`, and `prefix` is a caller-chosen namespace — `"lh"`, `"bg"`, and now `"minsz"`. Two call sites writing different properties on the same class cannot collide.

    Second, and more fundamentally, a CSS rule has no identity beyond its declarations. There is no sense in which two `ListItemMarkerText` instances "arrived at 12 px for different reasons" that a stylesheet could observe: both want `min-width: 12px; min-height: 0px`, full stop. `ensureClassStateRule` never rewrites an existing entry, so the shared rule is immutable once created. A future change to one list's width computation changes that list's *value*, hence its *token*, hence which rule its markers point at — it cannot mutate a rule another list is using. The failure the caution describes has no mechanism here.

    What does remain is a narrower, real hazard, and it is the one the body's decision states as a rule: because first-caller-wins, a token that under-determines the declarations lets a later caller silently inherit an earlier caller's CSS. Per-class scoping does not prevent that — a within-class collision is exactly the case the table's third row shows. Deriving the token from the full declaration set does prevent it, and is cheap to check by reading the call site.

[^inherited-class-token]: The hierarchy-aware class tier puts every ancestor's own name on the element, so a `ListItemMarkerText` element also carries the `Text` class token and would match a hypothetical `.Text.minsz12x0` rule. That is harmless under the derivation rule: a `.Text.minsz12x0` rule can only exist if some `Text` instance published the same prefix with the same declarations, which are then the declarations this element wanted anyway. Nothing in this plan creates such a rule — only `ListItemMarkerText` overrides `setMinSize`.

    The rule also picks up no resting-chrome guard. After the dependency lands, `setValueStyleState` appends `restingGuardSuffix` only when a declaration touches `restingIsolationKeys()` — the union of the class's declared `ownStyleStates` keys. Neither `Text` nor `ListItemMarkerText` declares any state, so that set is empty and the selector stays the bare `.ListItemMarkerText.minsz<w>x<h>`.

[^why-not-base]: Two alternatives were considered and rejected. Putting the routing in `Component.setMinSize` behind an opt-in hook would add configurability nothing else asked for, to a method on the hot path of every layout pass in the framework. Putting it in `ListItem.setMarkerColumnWidth` is impossible: `cacheStyleValue` and `setValueStyleState` are `protected` on the marker, not reachable from its parent, and the rule pool must be keyed on `ListItemMarkerText` for the selector to match the marker's own class token.

    The override runs during the `super()` cascade if a `minSize` option is ever passed at construction, since `Component.applyOptions` dispatches `setMinSize`. That is safe: the override reads no field `ListItemMarkerText` declares, `this.constructor` already resolves to the right class, and `getElement()` is still null so no DOM write is attempted. The `declare`-field trap in CODE_CONVENTIONS.md does not apply.

[^dependency]: `cell-base-background-value-class-dedup.md` was drafted from the same audit sweep, for `Cell.setBaseBackground` — which already calls `setValueStyleState` today and whose shared rule is created but never wins, for exactly the reason described. Its two code touchpoints matter to this plan's edits: `_valueStyleTokens` becomes a map of `{ token, layer }` records rather than plain token strings, so `getValueStyleToken` reads `?.token`, and `setValueStyleState` grows a resting-guard suffix that this plan's declarations never trigger. Landing this plan first would produce a strictly worse state than today — the duplication unchanged, plus a dead shared rule per distinct width.

[^why-not-notify-intrinsic]: The existing public `notifyIntrinsicSizeChanged()` ([Component.ts:6743](packages/lib/src/typescript/lib/core/Component.ts#L6743)) fires both size-change slots and would have needed no new API, but its own doc comment scopes it to a change the framework "cannot observe through `setPreferredSize` / `setMinSize`" — the opposite of this case, which *is* a `setMinSize` call. Using it would contradict a documented contract and over-signal a preferred-size change that did not happen. Widening `_onConstraintSizeChange` from `private` to `protected` was the other option; it exposes a parent-owned mutable slot to every subclass, where a one-line forwarder exposes only the act of firing it.

[^legend-detail]: The rest of the Legend picture reinforces leaving it alone. `Legend.applyStyle` ([Legend.ts:62](packages/lib/src/typescript/lib/component/container/Legend.ts#L62)) re-asserts `margin-left: 10px` on every render, so every legend's `#id` rule materialises regardless. Removing `max-width` from that rule would not delete a single rule — it would shorten each body and, by making more legends' bodies identical, raise the audit's duplicate *count* while lowering its byte total. `plans/legend-margin-left-dedup.md` is the plan that removes the declaration keeping those rules alive.

    The token derivation would also differ. `STYLE_WRITERS.maxSize` ([ClassStyleRules.ts:280](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L280)) folds an unbounded extent to the string `none`, where `STYLE_WRITERS.minSize` does not fold anything — so a `maxSize` token would have to run both axes through `isUnbounded` to stay a total function of the declarations, while the `minSize` token can use the raw numbers. Sharing one helper across the two would have been wrong.
