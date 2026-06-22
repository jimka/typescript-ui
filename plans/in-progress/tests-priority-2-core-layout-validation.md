# Priority 2 — Core Algorithmic Gaps (Layout Math, Core Utilities, Validation Rules) — Implementation Plan

## Overview

This plan adds Vitest tests for the *algorithmic* modules that currently have **no** coverage: the layout managers (size/position math), the untested core utilities, and the validation rule/result/decorator surface. The framework already proves out two offline test seams that make this cheap and deterministic:

- **Node, pure logic** — most core utilities and all validation-rule logic have no DOM dependency and run under the default `node` environment (the merged Vitest config defaults to `node`; opt into `jsdom` per-file via the `// @vitest-environment jsdom` pragma, as [`HBox.test.ts:1`](../tests/component/layout/HBox.test.ts#L1) does).
- **jsdom + the modelled-DOM oracle** — layout `doLayout()` math is testable offline by installing the recording sink + modelled source from [`tests/dom/TestDOM.ts`](../tests/dom/TestDOM.ts) via `installTestDOM(CONFIG)` (the pattern in [`tests/dom/geometry.test.ts`](../tests/dom/geometry.test.ts)). Layout managers read children's *stored* `preferredSize`/`minSize`/`maxSize` (plain fields, not browser-measured) and write child geometry through `commitBounds` → `setX/setY/setWidth/setHeight`, which is read straight back via `getX/getY/getWidth/getHeight`. No browser layout is involved.

All new files live under `tests/` mirroring the existing tree (`tests/component/layout/`, `tests/unit/core/`, `tests/unit/validation/`). Use the `~/...` import alias for library code (e.g. `import { VBox } from '~/layout/VBox'`) exactly as existing tests do; reach into the test harness with a relative path (`../../dom/TestDOM`).

This is a **test-authoring** plan: it adds no source changes. Where the implementer finds the code diverges from the contract, the plan directs them to STOP and surface it (see the **Methodology** section) rather than conform the test to current output.

---

## Methodology — Assert the Contract, Never Snapshot the Code

**This is the load-bearing section. It applies to every module below.**

For each module, the implementer MUST:

1. **Derive expected behaviour from the contract** — the JSDoc, the type signatures, the documented layout semantics, and how real callers use it — *independently of what the current implementation emits*. For a layout manager this means: write down what the algorithm is *supposed* to do (VBox stacks children top-to-bottom and separates them by `componentSpacing`; Fit fills its single child to the container's inner size; Border docks NORTH to the top edge spanning the full width; Card shows exactly one child and hides the rest) **before** running anything.
2. **Assert against that derived expectation**, with literal expected numbers/relations computed by hand from the inputs (e.g. "child B's `y` = child A's height + spacing").
3. **If the observed output diverges from the derived expectation, STOP.** Do not edit the assertion to match the code. Investigate whether the bug is in the *expectation* (re-read the contract) or in the *code*. Surface every genuine discrepancy explicitly: leave a clear `// DISCREPANCY:` comment naming the contract clause and the observed value, mark the test `it.fails(...)` (so the suite stays green while pinning the divergence), and flag it in the completion report for the user. Never silently mutate an assertion to get green.

### Do NOT golden-snapshot geometry

It is tempting to run `doLayout()`, read whatever pixel numbers come out, and bake them into `toBe(...)`. **Do not.** That locks in bugs and tests nothing. Two concrete guards:

- **Absolute pixels only when they are derived from the algorithm.** `b.getY()` for two stacked VBox children of preferred heights 30 and 40 with spacing 5 is `30 + 5 = 35` — assert `35` because the contract says so, not because the code printed it.
- **Where exact numbers depend on DOM measurement that the modelled source stubs** (text metrics, natural sizes, computed borders all read 0 offline — see [`TestDOM.ts:352`](../tests/dom/TestDOM.ts#L352) and the zero-returning readers), assert **structural / relational invariants** instead of brittle absolutes: ordering (A above B), which region got which edge, weight proportionality (a weight-2 child gets ~2× the slack of a weight-1 child), full-width spanning (`width === innerWidth`), centring (`x === (inner - childWidth) / 2`). These hold regardless of the stub's zeros and are the *real* contract.

---

## The jsdom Layout Harness (read once, reuse everywhere)

The single recipe every layout `doLayout` test uses. Established empirically against the live code while drafting this plan:

```ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { VBox } from '~/layout/VBox';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

describe('VBox doLayout', () => {
    afterEach(() => DOM.reset());

    it('stacks children top-to-bottom separated by componentSpacing', () => {
        installTestDOM(CONFIG);

        const host = new Container({ layoutManager: new VBox() }); // default spacing 5
        host.getElement(true);     // materialise the host element so getInnerSize() is non-null
        host.setWidth(200);
        host.setHeight(400);
        host.clearInsets();        // zero the default 4px insets so cell origins are predictable

        const a = new Component({ preferredSize: { width: 50, height: 30 } });
        const b = new Component({ preferredSize: { width: 60, height: 40 } });
        host.addComponent(a);
        host.addComponent(b);

        host.doLayout();

        // Derived from the VBox contract: stack at insets.top (0), spacing 5 between.
        expect(a.getY()).toBe(0);
        expect(a.getHeight()).toBe(30);
        expect(b.getY()).toBe(35);        // 30 + spacing(5)
        expect(b.getHeight()).toBe(40);
    });
});
```

### Non-obvious harness facts the implementer MUST know (each cost a real debugging cycle while drafting)

- **The host MUST be `Container`, not a bare `Component`.** A bare `Component` has `clampsToContentSize() === true`, so `setWidth(200)` is clamped against the manager's content-derived `getMaxSize()` and collapses to `0` — `getInnerSize()` then returns `{0,0}` and every child lays out to `0×0`. `Container` overrides `clampsToContentSize()` to `false` ([`Container.ts:49`](../src/typescript/lib/core/Container.ts#L49)), so it accepts its allocated size. This is the framework's documented size-constraint behaviour, not a test hack — real layout hosts are `Container`/`Panel`.
- **`getInnerSize()` returns `null` until the host has a DOM element.** Call `host.getElement(true)` before `doLayout()`; otherwise `doLayout()` early-returns and nothing is placed ([`Component.ts:2376`](../src/typescript/lib/core/Component.ts#L2376)).
- **Children only need explicit `preferredSize`/`minSize`/`maxSize`** (and a parent). They do **not** need their own elements — `getLaidOutComponents()` includes element-less children and `commitBounds` writes their geometry fields directly. Children sized only by text would measure 0 offline, so always give layout children explicit sizes.
- **`clearInsets()` the host** so cell origins start at `(0,0)`; otherwise the default 4px insets shift every coordinate and obscure the relation you are asserting.
- **Constraints are passed to `addComponent(component, constraints)`** — e.g. Border regions: `host.addComponent(north, Object.assign(new LayoutConstraints(), { placement: Placement.NORTH }))`. Weighted box children: a `LayoutConstraints` with `weight` set.
- **`afterEach(() => DOM.reset())`** in every jsdom layout suite, mirroring `geometry.test.ts`.

---

## Ordered Implementation — High-Value, Low-Cost Tier First

Author in this order. Tiers 1–2 are pure/near-pure logic, fast to write, and catch the most bugs per line. Tier 3 (layout math) reuses the one harness above.

### Tier 1 — Pure logic, `node` environment (no jsdom, no harness)

These need no DOM at all. Plain `import { describe, it, expect } from 'vitest'`.

1. **`tests/unit/validation/ValidationRule.test.ts`** *(actually exercises `applyRule` from `~/validation/Validator`; the rule types live in `ValidationRule.ts`)*
   `ValidationRule.ts` is type-only (a discriminated union + a config interface) so there is no runtime to call there directly — the testable contract is `applyRule(rule, value)` ([`Validator.ts`](../src/typescript/lib/validation/Validator.ts)), which the existing `Validator.test.ts` only partially covers (just `required` + `minLength`). Complete every variant and its default-message contract:
   - `required`: fails on `null`, `undefined`, and whitespace-only string (`'   '`); passes on a non-empty string, on `0`, and on `false` (derive from the code's emptiness predicate — only null/undefined/blank-string are empty; a numeric `0` is **not** empty). Default message `'This field is required.'`; custom `message` overrides it.
   - `minLength` / `maxLength`: boundary cases at exactly `min`/`max` (inclusive — `length < min` fails, `length === min` passes); non-string values are coerced via `String(value ?? '')` (assert e.g. `minLength 2` against the number `5` → `'5'` length 1 → fails).
   - `min` / `max`: numeric coercion via `Number(value)`; `NaN` (e.g. value `'abc'`) **fails** both `min` and `max` (derive from `isNaN(num) || …`); boundary equality passes.
   - `regex`: `pattern.test(String(value ?? ''))`; assert a matching and a non-matching value, and that `null` coerces to `''`.
   - `custom`: the `predicate` result drives validity; assert both branches and that the predicate receives the raw `value` (including non-string).
   - For each: assert the default message text *and* that a supplied `message` overrides it.

2. **`tests/unit/validation/ValidationResult.test.ts`**
   `ValidationResult.ts` is a single interface (`FieldValidationResult { valid; message }`) — type-only, **no runtime**. Do **not** invent a runtime test. Instead fold the result-*shape* contract into the `applyRule` suite above: every passing rule returns `{ valid: true, message: '' }` (empty message on success is the documented contract) and every failing rule returns `{ valid: false, message: <non-empty> }`. Note in the report that `ValidationResult.ts` has no independent runtime surface; omitting a dedicated file for it is correct, not a gap.

3. **`tests/unit/core/Type.test.ts`** — pure predicate/assertion logic, `node`.
   `Type.ts` is a namespace of `is*` / `if*` / `require*` helpers. Cover the `is*` predicates against true and false inputs, then the `require*` throw/no-throw contract and the default messages. Concrete, source-grounded cases (some encode quirks the implementer should assert *as the contract the JSDoc states*, flagging via the Methodology if a quirk contradicts the doc):
   - `isBoolean` true for `true`/`false`, false for `0`/`'x'` (uses `toString.call` tag).
   - `isString(v, allowNull)`: `allowNull` makes `null`/`undefined` pass.
   - `isNumber` true for `NaN` and `Infinity` (doc says "including NaN and Infinity") — assert that explicitly.
   - `isInteger(v, allowNull)`: `5`→true, `5.5`→false, `'5'`→false; with `allowNull` a falsy `0`/`null` passes (doc-stated).
   - `isFloat`: `5.5`→true, `5`→false, non-number→false.
   - `isArray`/`isObject`: `isObject([])` is **false** (arrays excluded), `isObject({})` true, `isObject(null)` false.
   - `requireNonNull`/`requireBoolean`/`requireString`/`requireInteger`/etc.: throw with the default message when the check fails, no-throw when it passes. **Watch the signatures**: `requireString(value, allowNull, msg)` and `requireInteger(value, allowNull, msg)` take `allowNull` as the 2nd arg; `requireNonNull(obj, msg)` / `requireBoolean(value, msg)` take `msg` 2nd. Assert against the literal default strings (e.g. `'Argument must be a boolean.'`).
   - **Methodology flag candidate:** `requireNonNull` is typed `(obj: object, ...)` but the runtime test is `if (obj) return` — so it throws on `0`/`''`/`false` too. If asserting that contradicts the "null or undefined" JSDoc, surface it per the Methodology rather than quietly encoding it.

4. **`tests/unit/core/Util.test.ts`** — split by environment.
   `Util.ts` mixes pure helpers and DOM-backed measurement.
   - **`node`-safe, pure:** `kebabToCamel` (`'border-top-width'` → `'borderTopWidth'`; leading/trailing/no-hyphen cases), `isInteger`, and `generateUUID` (matches the UUID v4 shape and — the documented contract — its **first character is never a digit**: generate many and assert `/^[^0-9]/`).
   - **`jsdom` + harness, measurement helpers:** `measureTextSize` / `measureTextWidth` / `lineHeightPx` / `measureTextBaseline` / `opticalCenterOffset` all delegate to `DOM.source`. Under `installTestDOM(CONFIG)` with the baked `font-metrics.test-font.json`, these are deterministic. Prefer asserting the **derived relationship** the JSDoc spells out over the raw pixel: e.g. `lineHeightPx({ fontSizePx: 14, linePadding: false })` returns `round(14)` (no leading); `linePadding: 4` returns `round(18)`; `measureTextBaseline()` equals `round(gap/2 + ascent)` computed from the baked ascent/descent and the `lineHeightPx()` it derives from. **Critically test the cache contract**: read a value, call `Util.invalidateTextMetricsCache()`, and confirm a re-read still works (the cache sentinel is `-1`); this is the documented invalidation surface and is cheap to pin.

5. **`tests/unit/core/ListenerBag.test.ts`** — `node`, **high value (known prior bug class)**.
   `ListenerBag.add` **appends** with no dedupe ([`ListenerBag.ts:32`](../src/typescript/lib/core/ListenerBag.ts#L32)); the project has a documented prior bug where re-running wiring stacked duplicate listeners. Pin the exact add/remove/fire/get semantics so a future dedupe or re-wire regression is caught:
   - `add` appends — registering the **same** function twice yields `get(event).length === 2` (this is the documented append-only behaviour; assert it as the contract, with a comment noting the duplicate-stacking hazard it implies for callers).
   - `fire` invokes **every** listener in **registration order** with the forwarded payload (use an order-recording array; assert order and that each got the same args). Firing an event with no bucket is a silent no-op.
   - `remove` removes only the **first occurrence** of a reference (`indexOf`/`splice`): add the same fn twice, remove once → `length === 1`, and the survivor still fires. Removing an unregistered fn or unknown event is a no-op.
   - `get` returns a **defensive copy** in registration order — mutating the returned array does **not** affect the bag (add to the returned array, re-`get`, assert unchanged), and `add`/`remove` *during* a caller's iteration over a prior `get()` result don't disturb that snapshot.
   - Empty bucket: `get` on an unregistered event returns `[]` (a fresh empty array, not shared).
   - **There is no `once` method on `ListenerBag`.** Do not invent one. "once" semantics, if tested at all, belong to host-level wrappers, not this class — note this in the report so the absence isn't mistaken for a coverage gap.

6. **`tests/unit/core/BaseObject.test.ts`** — `node`, tiny.
   `BaseObject` assigns a UUID at construction and exposes `getId`/`setId`/`getClassName`. Assert: two instances get distinct, non-empty ids; `setId` overrides and returns `this` (chainable); `getClassName()` returns the constructor name (`'BaseObject'` for a direct instance, and the subclass name for a trivial local subclass). **Note for the report:** `BaseObject.getClassName()` relies on `constructor.name`, which the prod minifier mangles (a known project issue) — but that does not affect the Vitest run (unminified), so the test is valid; just flag the minify caveat.

7. **`Bindable.ts` — no test file.** `Bindable.ts` is **type-only** (`BindingAccessors` + `Bindable` interfaces, zero runtime). There is nothing to execute. Explicitly **do not** create `tests/unit/core/Bindable.test.ts`; record in the report that the file has no runtime surface so its absence from coverage is by design.

### Tier 2 — Core, light jsdom + harness

8. **`tests/unit/core/Event.test.ts`** — `jsdom` + `installTestDOM`, `afterEach(DOM.reset())`.
   The `Event` namespace routes DOM listeners through the sink/source. Under the recording sink, registrations and the window-base-listener install/uninstall lifecycle are observable in `sink.writes` and via behaviour. Focus on the *bookkeeping contract* the JSDoc promises, not on real event delivery (the modelled source returns no live nodes):
   - `addListener(component, type, fn)` installs exactly **one** window base listener the first time a `type` is registered, and a second registration of the same `type` does **not** install another (assert via counting `addListener` entries in `sink.writes` whose recorded `type` matches — see the recording sink in [`TestDOM.ts:209`](../tests/dom/TestDOM.ts#L209)).
   - The **last** `removeListener` for a `type` (no exact + subtree listeners remaining) uninstalls the base listener (a `removeListener` write appears); a non-last removal does not.
   - `addListener`/`removeListener` are **no-ops** when `component` or `listener` is falsy (no writes, no throw).
   - **Passive-conflict contract:** registering the same `type` first with default passive then again with a conflicting `options.passive` **throws** `"… conflict with earlier registration"` ([`Event.ts:67`](../src/typescript/lib/core/Event.ts#L68)); same setting does not throw. This is the most behaviour-rich, regression-prone branch — pin it.
   - `fireEvent(component, type)` **throws** when the component has no element (`"… is not in the DOM."`); with an element (`component.getElement(true)`) it records a `dispatchEvent` write.
   - Multiple listeners per `(component, type)` accumulate (the bag pushes), mirroring the ListenerBag append contract.
   - Keep `addSubtreeListener`/`addViewportListener` to the same install/uninstall-accounting assertions; do **not** attempt to assert subtree *dispatch* (the modelled source's `getParentElement` returns `null`, so the subtree walk can't be exercised offline — note this boundary in the report).

9. **`tests/unit/core/Theme.test.ts`** — `node`-safe portions only.
   `Theme.ts` (1305 LOC) is mostly token tables + a `ThemeManager` that touches the DOM. Scope the **pure, exported** algorithmic surface and leave DOM-applying paths for a future integration plan (state that as a Non-Goal):
   - `defineTheme(base, overrides)` ([`Theme.ts:763`](../src/typescript/lib/core/Theme.ts#L763)) — assert the deep-merge contract: an override key replaces only that leaf, sibling keys from `base` survive, nested partials merge rather than clobber. Derive expectations from the `DeepPartial<Theme>` signature, not from a dumped result.
   - Confirm the exported `BaseTheme`/`ModernTheme`/`DarkTheme`/`ClassicTheme` objects are present and well-formed (e.g. each carries the `scale`/`font` blocks the `Theme` interface requires) — a structural smoke test that guards accidental export/shape breakage.
   - **Do not** instantiate `ThemeManager` or assert applied CSS variables here. Note in the report that `themeToVars`/`ThemeManager` belong to a DOM-integration tier.

### Tier 3 — Layout math, `jsdom` + the harness above

One file per manager under `tests/component/layout/`, mirroring [`HBox.test.ts`](../tests/component/layout/HBox.test.ts) for the setter/getter portion and using the **jsdom layout harness** for `doLayout` geometry. For each manager, first assert the cheap **option/getter-setter + `doLayout()` does-not-throw-without-a-container** contract (as HBox does), then the geometry.

10. **`VBox.test.ts`** — the canonical case (already proven in the harness section).
    - Setters/getters: `componentSpacing` default `5`, `isStretching` default `false`, toggles (mirror HBox).
    - **Stacking (contract):** N children stack top-to-bottom; child *i*'s `y` = Σ(prev heights) + i·spacing; each child keeps its preferred height in default/preferred mode.
    - **Cross-axis:** non-stretching keeps each child's preferred width; `stretching: true` fills every child to the inner width (assert `width === innerWidth`).
    - **Weight distribution (relational, not absolute):** two children with `weight` 1 and 2 (via `LayoutConstraints.weight` on `addComponent`) split the leftover vertical slack ~1:2 — assert the *ratio* of their heights, not raw pixels, so it survives inset/rounding noise.
    - `doLayout()` without a container does not throw (HBox-style).

11. **`Fit.test.ts`** — single-child fill.
    - `getFill()` default and `setFill(FillType.NONE)` round-trip.
    - **Fill contract:** the single child fills the host inner size exactly (`width === innerWidth`, `height === innerHeight`, `x === 0`, `y === 0` after `clearInsets()`). Proven in drafting: a 50×30 preferred child in a 200×150 host fills to 200×150.
    - With `fill: FillType.NONE` the child keeps its preferred size and is **centred** — assert `x === (innerWidth - prefWidth)/2` (relational centring, derived from the JSDoc "centre the child"), not a baked pixel.
    - More than one child: assert the documented "single child" behaviour (`getComponent()` resolves the first; extras are not placed) — read [`Fit.ts:192`](../src/typescript/lib/layout/Fit.ts#L192) to pin exactly what the contract is and assert *that*.

12. **`Card.test.ts`** — visibility switching.
    - `getVisibleComponentId()` default; `setVisibleComponentId(id)` round-trips.
    - **One-visible contract:** after `setVisibleComponentId(b.getId())`, exactly the chosen child is visible and the rest hidden — assert via `child.isVisible()` (Card toggles `setVisible` per [`Card.ts:246`](../src/typescript/lib/layout/Card.ts#L246)). Switching to a different id flips visibility cleanly (old hidden, new shown).
    - The visible child fills the host inner size (Card's `doLayout` sizes it like Fit). Assert relationally.

13. **`Border.test.ts`** — region docking (the richest geometry).
    - **Docking contract (derive from the compass semantics):** with `clearInsets()` on a `W×H` host —
      - NORTH child docks to the top: `y === 0`, `x === 0`, spans the full content width (`width === W`), height = its preferred height.
      - SOUTH docks to the bottom: `y === H − prefHeight` (after the north band is reserved if both present).
      - WEST docks left full content height; EAST docks right.
      - CENTER fills the residual rectangle between the docked edges.
      Assert **which edge each region pins to** and **full-span** along the cross axis — these are the contract and survive the stubbed zeros; avoid baking the residual CENTER pixels unless every neighbour's extent is explicitly set.
    - Regions are assigned via `addComponent(child, constraints)` where `constraints.placement` is a `Placement` ([`Border.ts:126`](../src/typescript/lib/layout/Border.ts#L126)); a child added with no/blank placement defaults to CENTER.
    - `componentSpacing` getter/setter; collapse flags: `isRegionCollapsed`/`setRegionCollapsed` only act on collapsible, non-CENTER regions (assert CENTER and non-collapsible regions reject collapse) — pure state, no geometry needed.

14. **`Grid.test.ts`** — row/column distribution.
    - Setters/getters: `rows`, `columns`, `componentSpacing`, `defaultFill`, `defaultAnchor`, `baselineAlign`, `columnTracks`/`rowTracks`.
    - `getColRowCount()` derivation from child count and the configured rows/columns (read [`Grid.ts:293`](../src/typescript/lib/layout/Grid.ts#L293) and assert the documented row/col inference for a given N children and fixed `columns`).
    - **Placement contract:** in a 2-column grid, children fill row-major — child 0 at column 0 row 0, child 1 at column 0… (verify the actual major order from the source, then assert it). Equal columns split the inner width into equal cells (relational: cell width ≈ innerWidth / cols, minus spacing) — assert the *partition*, not absolute pixels.
    - Spacing inserts gaps between tracks (child in column 1 starts after column 0's width + spacing).

15. **`Anchor.test.ts`** — proportional/edge anchoring.
    - Re-read [`Anchor.ts:110`](../src/typescript/lib/layout/Anchor.ts#L110) `resolveAxis` to derive the per-axis edge/proportional offset contract, then assert a child anchored to an edge sits at that edge and a proportional offset scales with the inner extent. Use relational assertions (offset proportional to inner size).
    - `doLayout()` early-returns cleanly when `getInnerSize()` is null (no container / no element) — assert no-throw.

16. **`FlowLayout.test.ts` (+ `HFlow.test.ts`, `VFlow.test.ts`)** — wrapping flow.
    - `FlowLayout` is abstract; test its concrete setters/getters (`componentSpacing`, `lineSpacing`, `uniform`, `align`, `itemAlign`, `justify`) through `HFlow`/`VFlow` instances (mirror HBox's setter tests). Default values come straight from [`FlowLayout.ts`](../src/typescript/lib/layout/FlowLayout.ts) (`_align = "start"`, `_justify = "start"`).
    - **HFlow wrapping contract:** children flow left-to-right and **wrap to a new row** when the next child would exceed the inner width; the second row's `y` = first row height + `lineSpacing`. Construct children whose summed widths exceed the host width and assert the wrap (row 2 children have a larger `y` than row 1, and the leftmost row-2 child resets to `x === insets.left`). Assert the **wrap relation**, not absolute coordinates.
    - **VFlow** is the mirror image (top-to-bottom, wrap into a new column) — assert the transposed invariant.
    - `uniform` width/height makes every cell the max child extent on that axis — assert two differently-sized children get equal placed widths under `uniform: "width"`.

17. **`Absolute.test.ts`** — pass-through positioning.
    - Contract ([`Absolute.ts:40`](../src/typescript/lib/layout/Absolute.ts#L40)): each child keeps its own `getX`/`getY` and is sized to its preferred size, bypassing the cell clamp. Set a child's `x`/`y`/`preferredSize`, run `doLayout`, assert the child's committed `x`/`y` equal what was set and size equals preferred. This is the cleanest exact-pixel case because the manager copies inputs through.

18. **`Split.test.ts`** — pane ratios (mostly stateful, light geometry).
    - Constructor `orientation` option; `getOrientation`. `getPaneRatios()` / `applyPaneRatios([...])` round-trip and **normalise to sum ≈ 1.0** (assert the documented normalisation by feeding un-normalised ratios and checking the sum). `isPaneCollapsed(index)` / `setPaneCollapsedImmediate(index, true)` state. These mirror exactly the surface `LayoutSerialization` depends on, so pinning them protects the serialization round-trip too. Geometry (gutter positions) is heavy and DOM-coupled — keep to ratio/collapse **state** assertions and note deeper Split geometry as a Non-Goal.

19. **`Tab.test.ts`** — active-tab state.
    - `getActiveTabIndex()` / `setActiveTabIndex(i)` with **clamping** (out-of-range index clamps to the valid range — derive the clamp bounds from the source and assert both an under- and over-range index). `createTab(child)` registers a tab synchronously (the path `LayoutSerialization.populateContainer` relies on — [`LayoutSerialization.ts:467`](../src/typescript/lib/layout/LayoutSerialization.ts#L467)). Options `reorderable`/`compact` round-trip. Tab is 1933 LOC and heavily DOM-coupled; scope this file to **active-index + tab-registration state**, not strip geometry — state that boundary as a Non-Goal.

20. **`LayoutSerialization.test.ts`** — `jsdom` + harness, **high-value round-trips**.
    The 10 exports here are highly testable because `serializeLayout` produces a plain object and `restoreLayout` rebuilds from one. The round-trip is the headline contract.
    - **`serializeLayout(root)` shape:** build a `Container` whose manager is a `Split` (with two leaf children) → assert the returned `LayoutState` has `version: 1`, `root.kind === "split"`, the correct `orientation`, `children` length 2, `ratios` summing ~1.0, and a `collapsed` array of matching length. A `Tab` host → `root.kind === "tab"` with the right `activeIndex`. A leaf host → `root.kind === "panel"` with `panelId === root child's getId()`.
    - **`glyph` capture:** a leaf whose parent constraint carries a `glyph` records it on the `PanelNode` ([`LayoutSerialization.ts:213`](../src/typescript/lib/layout/LayoutSerialization.ts#L213)).
    - **Round-trip identity:** `restoreLayout(root, serializeLayout(root), factory)` where the `factory` returns the **same leaf instances** reproduces the arrangement — same child order, same active tab / pane ratios. Then mutate (switch active tab / change ratios), serialize state B, restore A, and assert A is reproduced exactly with **no residue from B** (the documented park-and-rebuild guarantee). Build the factory as a `Map<id, Component>` honouring the same-instance contract ([`LayoutSerialization.ts:137`](../src/typescript/lib/layout/LayoutSerialization.ts#L137)).
    - **Missing-leaf skip:** a `factory` returning `null` for one panel id skips that leaf with a `console.warn` and re-aligns the surviving ratios (spy on `console.warn`, assert the survivors are placed and the dropped one is absent).
    - **Legacy window node:** a `WindowNode` carrying only `panelId` (no `content`) restores through the single-panel path ([`LayoutSerialization.ts:490`](../src/typescript/lib/layout/LayoutSerialization.ts#L491)). Window-plane tests need `Window`; if the offline `Window` surface proves too DOM-heavy, scope to the in-root `Split`/`Tab`/`panel` round-trips and flag windows as deferred in the report.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `tests/unit/validation/ValidationRule.test.ts` (completes `applyRule` coverage; folds in `ValidationResult` shape) |
| Create | `tests/unit/core/Type.test.ts` |
| Create | `tests/unit/core/Util.test.ts` |
| Create | `tests/unit/core/ListenerBag.test.ts` |
| Create | `tests/unit/core/BaseObject.test.ts` |
| Create | `tests/unit/core/Event.test.ts` |
| Create | `tests/unit/core/Theme.test.ts` |
| Create | `tests/component/layout/VBox.test.ts` |
| Create | `tests/component/layout/Fit.test.ts` |
| Create | `tests/component/layout/Card.test.ts` |
| Create | `tests/component/layout/Border.test.ts` |
| Create | `tests/component/layout/Grid.test.ts` |
| Create | `tests/component/layout/Anchor.test.ts` |
| Create | `tests/component/layout/FlowLayout.test.ts` |
| Create | `tests/component/layout/HFlow.test.ts` |
| Create | `tests/component/layout/VFlow.test.ts` |
| Create | `tests/component/layout/Absolute.test.ts` |
| Create | `tests/component/layout/Split.test.ts` |
| Create | `tests/component/layout/Tab.test.ts` |
| Create | `tests/component/layout/LayoutSerialization.test.ts` |
| (none) | No `Bindable` / standalone `ValidationResult` test — type-only modules, intentionally omitted |

---

## Verification

- `npx vitest run` — the whole suite stays green. Any genuine contract divergence is pinned with `it.fails(...)` + a `// DISCREPANCY:` comment (so green ≠ "no bugs found"; the report enumerates them).
- `npx vitest run tests/unit tests/component/layout` — the new files alone pass.
- Optional coverage check: `npx vitest run --coverage` and confirm the targeted modules move off 0% (Vitest coverage already includes `src/typescript/lib/**` and excludes `index.ts`/`glyphs` per `vitest.config.ts`).
- Self-review checklist before declaring done: (1) every layout numeric assertion traces to a hand-derived value, not a copied run output; (2) every `jsdom` layout suite uses a `Container` host with `getElement(true)` + `clearInsets()` and `afterEach(DOM.reset())`; (3) no `node`-tier file imports the harness; (4) every discrepancy is surfaced, none silently conformed.

---

## Potential Challenges

- **Bare `Component` host collapses to 0×0** — the single biggest trap; always host layouts on `Container`. Documented in the harness section.
- **`getInnerSize()` null without an element** — call `getElement(true)` first.
- **Stubbed-zero readers** (text metrics, natural size, computed border, `getParentElement`) — assert structural/relational invariants, never the stubbed pixel; pick `node` + pure logic where measurement isn't the point.
- **Heavy managers (`Tab` 1933 LOC, `Split` 1176, `Border` 1144)** — scope each test to its core algorithmic contract (active index, ratios, region edges); deep strip/gutter geometry is explicitly a Non-Goal here.
- **`Window`-plane serialization** is DOM-heavy — fall back to in-root round-trips and defer windows if the offline `Window` surface fights the modelled source.
- **Discrepancy discipline** — the temptation under time pressure is to snapshot. The Methodology section is the guard; the reviewer should reject any assertion whose expected value isn't independently derived.

---

## Critical Files

- [`tests/dom/TestDOM.ts`](../tests/dom/TestDOM.ts) — `installTestDOM`, the recording sink (`sink.writes`), the modelled source's zero-returning readers.
- [`tests/dom/geometry.test.ts`](../tests/dom/geometry.test.ts) — the canonical `installTestDOM` + `afterEach(DOM.reset())` pattern.
- [`tests/component/layout/HBox.test.ts`](../tests/component/layout/HBox.test.ts) — the setter/getter + `doLayout()`-no-throw style to mirror.
- [`tests/component/Component.test.ts`](../tests/component/Component.test.ts) — the `// @vitest-environment jsdom` component-construction pattern.
- [`tests/setup/jsdom-setup.ts`](../tests/setup/jsdom-setup.ts) — self-guarding `matchMedia` polyfill (auto-applied; nothing to import).
- [`vitest.config.ts`](../vitest.config.ts) — `node` default, `~` alias merge, coverage scope.
- [`src/typescript/lib/core/Container.ts`](../src/typescript/lib/core/Container.ts) — `clampsToContentSize() === false`, the reason the host must be a `Container`.
- [`src/typescript/lib/layout/LayoutManager.ts`](../src/typescript/lib/layout/LayoutManager.ts) — `placeComponent`/`resolveBounds`/`commitBounds`: how managers turn children into committed geometry.

---

## Non-Goals

- **No source changes.** Discrepancies are surfaced (`it.fails` + comment + report), never fixed here.
- **No DOM-integration / applied-CSS tests** for `Theme` (`ThemeManager`, `themeToVars`) — token-merge + structure only; the applying path is a separate integration tier.
- **No deep strip/gutter geometry** for `Tab` or `Split`, and no real event *delivery* for `Event` (the modelled source has no live tree) — both are scoped to state/bookkeeping.
- **No tests for type-only modules** (`Bindable.ts`, standalone `ValidationResult.ts`) — they have no runtime surface.
- **No `Window`-plane serialization** if it proves DOM-heavy — in-root `Split`/`Tab`/`panel` round-trips are the priority.
