# Spacer Component — Implementation Plan

## Overview

Add a `Spacer` — a deliberately invisible [`Component`](../src/typescript/lib/core/Component.ts#L1) whose only job is to take up space inside a layout. Two modes: a **fixed** spacer that advertises a hard `(width, height)` preferred size, and a **flex** spacer that absorbs the row/column's leftover space.

The flex mode rides the existing `weight` constraint already honoured by [`HBox.doLayout`](../src/typescript/lib/layout/HBox.ts#L224) and [`VBox.doLayout`](../src/typescript/lib/layout/VBox.ts#L218) — children with `weight > 0` share remaining width/height proportionally after fixed-preferred children take their slice. This avoids editing the layout managers entirely and reuses the mechanism Form, Toolbar, and any future BoxLayout consumer already rely on.

Lives in `src/typescript/lib/component/container/` alongside other structural, non-text leaf components ([`MenuSeparator`](../src/typescript/lib/component/container/MenuSeparator.ts#L22), [`SplitGutter`](../src/typescript/lib/component/container/SplitGutter.ts)). Touches one new source file plus three barrels (container index, docs catalog, sidebar).

---

## Architecture Decisions

### Flex via existing `weight` constraint, not via `getMaxSize`

HBox and VBox **do not** consult `getMaxSize` for distribution — `getMaxSize` is only used to clamp individual child dimensions inside [`LayoutManager.placeComponent`](../src/typescript/lib/layout/LayoutManager.ts#L126) (see [LayoutManager.ts:159-163](../src/typescript/lib/layout/LayoutManager.ts#L159-L163) for width and [LayoutManager.ts:185-189](../src/typescript/lib/layout/LayoutManager.ts#L185-L189) for height). HBox's distribution loop ([HBox.ts:239-256](../src/typescript/lib/layout/HBox.ts#L239-L256)) and the matching loop in VBox ([VBox.ts:233-250](../src/typescript/lib/layout/VBox.ts#L233-L250)) read `weight` off the [`LayoutConstraints`](../src/typescript/lib/layout/LayoutConstraints.ts#L13) attached to each child and split the leftover space proportionally. **`weight` is already the absorb-rest primitive.**

The user-suggested "advertise `getMaxSize = MAX_SAFE_INTEGER`" approach would do nothing on its own — HBox/VBox would still use `getPreferredSize` (or `getMinSize` fallback, then `defaultComponentWidth`) for the child's allocated width. To make max-size drive distribution we'd have to teach both layout managers a new growth pass, which contradicts the request to keep this surgical. Reusing `weight` is one line per spacer at attach time and zero layout-manager edits.

The plan's earlier suggestion to fall back on `setPreferredSize(9999, 9999)` is rejected too — it disturbs `getPreferredSize`-driven scroll containers and would force layouts that respect preferred size (Card, Fit, Absolute, Border) to honour a fake number.

### Two construction forms — positional and options bag

Match the project's mixed convention. `MenuSeparator(cssVarPrefix?, options?)` ([MenuSeparator.ts:32](../src/typescript/lib/component/container/MenuSeparator.ts#L32)) takes a positional first argument and a trailing options bag; `VBox(spacing | options, options?)` ([VBox.ts:30](../src/typescript/lib/layout/VBox.ts#L30)) uses a discriminated union. Spacer adopts the latter so `new Spacer(8)` reads as "8-pixel gap" and `new Spacer({ flex: true })` reads as "absorb the rest" without a second positional surprise. A second positional `height` falls through for the `(w, h)` ergonomics the brief asks for.

### `flex: true` writes a `weight` constraint on the parent's layout manager

A flex spacer needs the **parent's** `LayoutManager` to know about its weight. The component cannot set its own `LayoutConstraints` until it has been added to a container. Wire it through the existing `onAddedToParent` lifecycle hook so that the moment the spacer is added to a parent with an `HBox`/`VBox` layout manager, it installs a `LayoutConstraints` with `weight: this._flexWeight` via [`LayoutManager.setLayoutConstraints`](../src/typescript/lib/layout/LayoutManager.ts#L260). Containers using other layout managers (Card, Fit, Absolute, Border, Grid, Tab, Split, Accordion, Column, Row, Table) ignore `weight` — the flex spacer simply takes its preferred size there. Document that flex mode is meaningful only inside HBox/VBox.

### `Spacer extends Component`, not `Panel`

`Spacer` is a leaf — no children, no chrome, no 4-pixel insets. Extending [`Panel`](../src/typescript/lib/core/Panel.ts#L39) would inherit the panel's `(4, 4, 4, 4)` insets default ([Panel.ts:25-27](../src/typescript/lib/core/Panel.ts#L25-L27)) and force a `setInsets(0,0,0,0)` overide on every fixed-size spacer to keep `getPreferredSize` honest. Direct `Component` subclassing matches `MenuSeparator`, which is the nearest sibling in spirit.

### Why a dedicated `Spacer` rather than an ad-hoc `Panel`

Three reasons:

1. **Self-documenting at the call site.** `new Spacer(8)` reads as intent; `new Panel().setPreferredSize(8, 8).setInsets(new Insets(0,0,0,0))` reads as a workaround.
2. **Cheaper at construction.** No insets-defaulting cascade through `Panel`'s super call, no `applyOptions` pass over Panel-only fields, no `getComponents()` allocation. The Spacer constructor body sets a preferred size, a transparent background, and `aria-hidden` — under twenty lines.
3. **Hooks for future optimisation.** Layout managers can `instanceof Spacer` short-circuit child-positioning passes (e.g. skip `doLayout` recursion since a spacer has no children) if profiling ever calls for it. The base `Component` doesn't expose a "leaf" marker today, so the type identity is the cheapest signal.

### No theme tokens

Spacer is invisible by definition. Background `transparent`, no border, no border-radius, no shadow. Nothing to theme. If a consumer wants a visible divider, they should reach for `MenuSeparator` or a `Component` with an explicit border — not for `Spacer`.

### A11y — `aria-hidden="true"` on the root

The element carries no information. Set `aria-hidden="true"` via [`getAria().setHidden(true)`](../src/typescript/lib/core/Component.ts#L790) in the constructor so screen readers skip it. The role stays implicit (`div`), which matches the inherited generic-container semantics; assigning `role="presentation"` would be redundant once `aria-hidden` is set.

### `static flex()` factory mirrors the recipe

`Spacer.flex()` is sugar for `new Spacer({ flex: true })`. Cheap to write, reads naturally at call sites: `HBox().add(Button("A"), Spacer.flex(), Button("B"))`. Returns a `_Spacer` instance — the callable wrapper does the export-time renaming, matching [`MenuSeparator`](../src/typescript/lib/component/container/MenuSeparator.ts#L51-L56).

### `pointerEvents: "none"` on the root

A flex Spacer can grow to cover hundreds of pixels of empty row. Without `pointer-events: none`, it intercepts hover and click events that should fall through to the underlying container (drag-pickup, panel context menu). Setting it during construction is one line and prevents a class of "phantom click target" bugs. Fixed-size Spacers get the same treatment for consistency; they're invisible too.

---

## Public API (TypeScript Signatures)

### `Spacer` — `src/typescript/lib/component/container/Spacer.ts`

```typescript
/**
 * Construction-time options for {@link Spacer}.
 *
 * @category Components
 */
export interface SpacerOptions extends ComponentOptions {
    /** Fixed preferred width in pixels. Defaults to 0. */
    width?:  number;

    /** Fixed preferred height in pixels. Defaults to 0. */
    height?: number;

    /**
     * When `true`, the spacer absorbs remaining row/column space inside an
     * {@link HBox} or {@link VBox} parent via the `weight` layout constraint.
     * Defaults to `false`.
     */
    flex?:   boolean;

    /**
     * Flex weight, used when `flex` is `true`. Defaults to `1`. Multiple flex
     * spacers in the same row/column share the leftover space proportionally
     * to their weights.
     */
    flexWeight?: number;
}

class Spacer extends Component<SpacerOptions> {

    /**
     * Constructs a fixed-size spacer.
     *
     * @param width  - Preferred width in pixels.
     * @param height - Optional. Preferred height in pixels. Defaults to `width`.
     */
    constructor(width: number, height?: number);

    /**
     * Constructs a spacer from an options bag — use for the flex variant.
     */
    constructor(options?: SpacerOptions);

    /** Factory for the absorb-rest variant. Equivalent to `new Spacer({ flex: true })`. */
    static flex(weight?: number): Spacer;

    /** Returns the cached flex flag. */
    isFlex(): boolean;

    /**
     * Toggles flex mode at runtime. When a parent is already attached, the
     * stored `LayoutConstraints` are updated immediately.
     */
    setFlex(value: boolean): this;

    /** Returns the flex weight (defaults to `1`). */
    getFlexWeight(): number;

    /** Sets the flex weight; only meaningful when `isFlex()` is `true`. */
    setFlexWeight(weight: number): this;
}
```

Typed setters with matching backing fields and option-bag entries:

| Setter           | Cached field    | `SpacerOptions` key |
|------------------|-----------------|---------------------|
| `setFlex`        | `_flex`         | `flex`              |
| `setFlexWeight`  | `_flexWeight`   | `flexWeight`        |

Fixed `width` / `height` route through the inherited [`setPreferredSize`](../src/typescript/lib/core/Component.ts#L1347) — no new cached field needed. The two `width` / `height` option keys are Spacer-specific syntactic sugar over the existing [`preferredSize`](../src/typescript/lib/core/Component.ts#L316) option key; both write to `_options.preferredSize` via `setPreferredSize(width, height)`.

---

## Internal Structure

### Constructor sketch

```typescript
class _Spacer extends Component<SpacerOptions> {

    private _flex:       boolean = false;
    private _flexWeight: number  = 1;

    constructor(arg1?: number | SpacerOptions, arg2?: number) {
        super();

        let opts: SpacerOptions;
        if (typeof arg1 === "number") {
            opts = { width: arg1, height: arg2 ?? arg1 };
        } else {
            opts = arg1 ?? {};
        }

        // Invisible by design — no chrome, no hit-testing.
        this.setBackgroundColor("transparent");
        this.setElementCSSRule("pointerEvents", "none");
        this.getAria().setHidden(true);

        this.applyOptions(opts);
    }

    protected applyOptions(options: SpacerOptions): this {
        super.applyOptions(options);

        if (options.width !== undefined || options.height !== undefined) {
            const w = options.width  ?? 0;
            const h = options.height ?? w;
            this.setPreferredSize(w, h);
        }
        if (options.flexWeight !== undefined) {
            this.setFlexWeight(options.flexWeight);
        }
        if (options.flex !== undefined) {
            this.setFlex(options.flex);
        }

        return this;
    }

    static flex(weight: number = 1): Spacer {
        return new Spacer({ flex: true, flexWeight: weight });
    }
}
```

### `setFlex` / `setFlexWeight` reach into the parent's layout manager

```typescript
setFlex(value: boolean): this {
    if (this._flex === value) {
        return this;
    }
    this._flex = value;
    this.syncFlexConstraints();
    return this;
}

setFlexWeight(weight: number): this {
    if (this._flexWeight === weight) {
        return this;
    }
    this._flexWeight = weight;
    if (this._flex) {
        this.syncFlexConstraints();
    }
    return this;
}

private syncFlexConstraints(): void {
    const parent = this.getParent();
    const lm = parent?.getLayoutManager();
    if (!lm) {
        // Stored locally; will be reapplied via onAddedToParent once attached.
        return;
    }

    if (this._flex) {
        const c = lm.getLayoutConstraints(this) ?? new LayoutConstraints();
        c.weight = this._flexWeight;
        lm.setLayoutConstraints(this, c);
    } else {
        const c = lm.getLayoutConstraints(this);
        if (c && c.weight !== undefined) {
            c.weight = undefined;
            lm.setLayoutConstraints(this, c);
        }
    }
}

// Hook the moment the parent is set so the constraint lands on the right LM.
protected onAddedToParent(): void {
    super.onAddedToParent?.();
    this.syncFlexConstraints();
}
```

The exact name of the lifecycle hook (`onAddedToParent`, `onParentChange`, etc.) is whatever `Component` exposes — verify against [Component.ts](../src/typescript/lib/core/Component.ts) during step 2 and pick the matching name. If no such hook exists, fall back to overriding `setParent` (the path `Container.addComponent` already calls into) and trigger `syncFlexConstraints` after the super call.

---

## Ordered Implementation Steps

1. **Verify** that [HBox.doLayout](../src/typescript/lib/layout/HBox.ts#L224) and [VBox.doLayout](../src/typescript/lib/layout/VBox.ts#L218) honour `weight` (already confirmed — `weight = constraints?.weight ?? 0` at [HBox.ts:245](../src/typescript/lib/layout/HBox.ts#L245) and [VBox.ts:239](../src/typescript/lib/layout/VBox.ts#L239); `(weight / totalWeight) * remainingWidth` distribution at [HBox.ts:275-276](../src/typescript/lib/layout/HBox.ts#L275-L276) and [VBox.ts:269-270](../src/typescript/lib/layout/VBox.ts#L269-L270)). **No layout-manager edits required.**
2. **Identify the parent-change lifecycle hook** on [`Component`](../src/typescript/lib/core/Component.ts#L1) — grep for `onAddedToParent`, `onParentChange`, `setParent`. Pick the matching method to override in step 4.
3. **Create** `src/typescript/lib/component/container/Spacer.ts` with the `_Spacer` class, `SpacerOptions` interface, constructor overloads, `applyOptions`, and `static flex(weight?: number)`. End with the `callable(_Spacer)` wrapper and the export-rename block, matching [MenuSeparator.ts:51-56](../src/typescript/lib/component/container/MenuSeparator.ts#L51-L56).
4. **Implement** `setFlex`, `getFlexWeight`, `setFlexWeight`, `isFlex`, and the private `syncFlexConstraints`. Wire `syncFlexConstraints` into the parent-change hook from step 2.
5. **Add `aria-hidden`, transparent background, `pointer-events: none`** in the constructor before the `applyOptions` dispatch so the visual / semantic defaults apply unconditionally.
6. **Export** `Spacer` and `SpacerOptions` from [src/typescript/lib/component/container/index.ts](../src/typescript/lib/component/container/index.ts) in alphabetical position (between `SplitGutter` and `VirtualScroller`).
7. **JSDoc** the class with a usage example showing both modes:
   ```typescript
   new HBox().getContainer()
       .add(Button("A"), Spacer(16), Button("B"), Spacer.flex(), Button("C"));
   ```
   `@category Components` on the class and `SpacerOptions`. Same-bucket `{@link}` to `Spacer` / `SpacerOptions`; cross-bucket markdown links to [`HBox`](/api/layout/classes/HBox), [`VBox`](/api/layout/classes/VBox), and [`LayoutConstraints`](/api/layout/classes/LayoutConstraints) per [CLAUDE.md](../CLAUDE.md).
8. **Add a docs page** at `docs/components/Spacer.md` mirroring the [MenuSeparator template](../docs/components/MenuSeparator.md): one paragraph overview, a `## Usage` block with the HBox example, a `## Notes` block stating that flex mode requires an HBox/VBox parent, and a `## See also` cross-link to HBox / VBox.
9. **Register the sidebar entry** in [docs/.vitepress/config.mts](../docs/.vitepress/config.mts) — add `{ text: 'Spacer', link: '/components/Spacer' }` to the **Display** group (insertion point near [config.mts:94](../docs/.vitepress/config.mts#L94), after `PaginationBar`) — visual category, not menu/list/table; the container bucket has no dedicated sidebar group.
10. **Regression checkpoint:**
    ```
    grep -n 'weight' src/typescript/lib/layout/HBox.ts src/typescript/lib/layout/VBox.ts
    ```
    Expect: unchanged from baseline. Spacer must not require either file to be edited.
11. **Regression checkpoint:**
    ```
    grep -rn 'new Spacer\|Spacer(' src/typescript/
    ```
    Expect: zero hits outside the demo screen, until consumers opt in.
12. **Demo wire-up** for manual smoke (Verification step 4): pick the existing demo screen that already mounts an `HBox`, add `Button("L"), Spacer(16), Button("M"), Spacer.flex(), Button("R")` for one resize-test cycle, then revert before commit.
13. **Build and graph refresh:** `npm run docs:build` (zero errors, zero new link warnings — typedoc's "unsupported TypeScript version" notice is the lone acceptable warning) and `graphify update . --directed`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/component/container/Spacer.ts` — class, options interface, callable wrapper. |
| Modify | `src/typescript/lib/component/container/index.ts` — barrel export of `Spacer` and `SpacerOptions`. |
| Create | `docs/components/Spacer.md` — curated docs page. |
| Modify | `docs/.vitepress/config.mts` — sidebar entry under the **Display** group. |

No layout-manager edits. No theme changes. No new top-level exports outside the `component/container` barrel — per [CLAUDE.md](../CLAUDE.md) the library has subpath-only exports.

---

## Verification

1. **Type-check:**
   ```
   npm run typecheck
   ```
2. **Library build:**
   ```
   npm run build:lib
   ```
3. **Docs build clean** (per [CLAUDE.md](../CLAUDE.md) — zero errors, zero new link warnings; typedoc's "unsupported TypeScript version" is the only acceptable warning):
   ```
   npm run docs:build
   ```
4. **Manual smoke** on the dev server (`npm run dev`, http://localhost:8015). Wire up:
   ```typescript
   const row = new Container().setLayoutManager(new HBox());
   row.add(Button("A"), Spacer(16), Button("B"), Spacer.flex(), Button("C"));
   ```
   Confirm: a 16-pixel gap between A and B, then Button C pinned to the right edge regardless of container width. Resize the window — the gap stays 16 px, the flex spacer grows.
5. **Multi-flex distribution:** `Button("A"), Spacer.flex(), Button("B"), Spacer.flex(2), Button("C")` — the second gap is twice the first.
6. **VBox sanity:** swap `HBox` for `VBox` in the demo; flex spacer absorbs vertical leftover.
7. **A11y inspection:** open the spacer in DevTools Accessibility tree — node is marked `aria-hidden`, not reachable by screen reader cursor walk.
8. **Hit-test sanity:** hover the flex spacer's pixel region — cursor does not change to a clickable affordance; underlying container `mousemove` listeners fire.
9. **Grep invariants:**
   ```
   grep -n 'weight' src/typescript/lib/layout/HBox.ts src/typescript/lib/layout/VBox.ts
   ```
   Expect: no diff vs main.
10. **Refresh the knowledge graph:**
    ```
    graphify update . --directed
    ```

---

## Documentation Impact

- `Spacer` and `SpacerOptions` are exported from `src/typescript/lib/component/container/index.ts` (new entries alongside [`SplitGutter`](../src/typescript/lib/component/container/index.ts#L15)). There is no root barrel per [CLAUDE.md](../CLAUDE.md).
- New curated page at `docs/components/Spacer.md` mirroring the [`MenuSeparator`](../docs/components/MenuSeparator.md) template.
- Sidebar entry in [docs/.vitepress/config.mts](../docs/.vitepress/config.mts) under the **Display** group (near line 94, after `PaginationBar`).
- Cross-bucket JSDoc references — `HBox`, `VBox`, `LayoutConstraints` live in `layout/`, not `component/container/`, so the JSDoc on `setFlex` / `flex:` / class header must use markdown links (`[`HBox`](/api/layout/classes/HBox)`), not `{@link HBox}`. Same-bucket links to `Spacer` and `SpacerOptions` use `{@link}`.
- Update the existing `HBox` and `VBox` docs pages (if they cover `weight`) with a one-line cross-reference to `Spacer.flex()` — the easiest call-site recipe for the `weight` mechanism they already document. Skip if those pages don't discuss `weight` today.

---

## Potential Challenges

- **Flex without a layout-aware parent.** A flex Spacer inside Card / Fit / Absolute / Border / Grid silently degrades to its `(0, 0)` preferred size, which looks like a bug. Mitigation: JSDoc on `setFlex` says explicitly "meaningful only inside HBox/VBox"; the docs page repeats the warning under `## Notes`.
- **Parent reparenting** mid-life. If a spacer is moved between two HBox containers, the old container's `LayoutConstraints` map retains a stale entry. Mitigation: `Component`'s existing parent-change path either already clears constraints (verify in step 2) or `syncFlexConstraints` overwrites them at the new parent — the only risk is the old LM holding a dangling entry until GC, which is harmless since the spacer's id is no longer in its `getComponents()`.
- **`pointer-events: none` blocks drag-pickup for any consumer who genuinely wants the spacer to be draggable.** Mitigation: drag-pickup on an invisible spacer is unlikely; if a real use case shows up, expose a `setInteractive(true)` later. Not in scope.
- **`width: 0, height: 0` rendering quirks.** A zero-sized div with no content still consumes a layout slot in HBox/VBox spacing math ([HBox.ts:129](../src/typescript/lib/layout/HBox.ts#L129) adds `spacing * (components.length - 1)` unconditionally). Document this: `Spacer.flex()` between two buttons in a 5-px-spacing HBox produces `5 + flex + 5`, not just `flex`. If the consumer wants exactly the flex amount, they need to set `setComponentSpacing(0)` on the HBox or accept the extra gap.

---

## Critical Files

- [src/typescript/lib/core/Component.ts](../src/typescript/lib/core/Component.ts) — base class, the `getPreferredSize` / `getMinSize` / `getMaxSize` contracts at [Component.ts:1324](../src/typescript/lib/core/Component.ts#L1324), [Component.ts:1366](../src/typescript/lib/core/Component.ts#L1366), [Component.ts:1433](../src/typescript/lib/core/Component.ts#L1433); `getAria()` at [Component.ts:790](../src/typescript/lib/core/Component.ts#L790); option-routing pattern at [Component.ts:299-335](../src/typescript/lib/core/Component.ts#L299-L335).
- [src/typescript/lib/component/container/MenuSeparator.ts](../src/typescript/lib/component/container/MenuSeparator.ts) — the closest stylistic precedent for a minimal `Component` subclass with `callable` export and ARIA wiring.
- [src/typescript/lib/layout/HBox.ts](../src/typescript/lib/layout/HBox.ts) and [src/typescript/lib/layout/VBox.ts](../src/typescript/lib/layout/VBox.ts) — confirm `weight`-based distribution at [HBox.ts:239-256](../src/typescript/lib/layout/HBox.ts#L239-L256) and [VBox.ts:233-250](../src/typescript/lib/layout/VBox.ts#L233-L250); **do not edit**.
- [src/typescript/lib/layout/LayoutManager.ts](../src/typescript/lib/layout/LayoutManager.ts) — `placeComponent` clamp logic at [LayoutManager.ts:159-189](../src/typescript/lib/layout/LayoutManager.ts#L159-L189) and the constraints CRUD trio at [LayoutManager.ts:260-293](../src/typescript/lib/layout/LayoutManager.ts#L260-L293).
- [src/typescript/lib/layout/LayoutConstraints.ts](../src/typescript/lib/layout/LayoutConstraints.ts) — the `weight` field that the flex spacer writes.
- [src/typescript/lib/component/container/index.ts](../src/typescript/lib/component/container/index.ts) — the only barrel to touch.
- [docs/components/MenuSeparator.md](../docs/components/MenuSeparator.md) — template for the new docs page.
- [docs/.vitepress/config.mts](../docs/.vitepress/config.mts) — sidebar insertion point near [line 94](../docs/.vitepress/config.mts#L94).

---

## Non-Goals

- **No new layout-manager mode.** A "growth pass that respects `getMaxSize`" is a separate plan with its own scope (every layout manager would need auditing). Spacer ships on the existing `weight` mechanism.
- **No `Spacer.minFlex` / `Spacer.maxFlex`** clamps. The `weight` math already saturates at the container's inner size; adding caps is configurability beyond the brief.
- **No visible-divider mode.** If a consumer wants a thin rule, they use `MenuSeparator` or a `Component` with an explicit border. Spacer stays invisible.
- **No layout-manager `instanceof Spacer` short-circuit.** Mentioned in Architecture Decisions as a future optimisation; not implemented unless profiling demands it.
- **No `setSpacerSize` runtime setter.** Live size updates go through the inherited `setPreferredSize` — no reason to wrap it.
- **No baseline reporting.** `Spacer` is invisible and has no text; the inherited `getBaseline()` returning `null` is the correct answer and keeps it out of HBox row-baseline math.
