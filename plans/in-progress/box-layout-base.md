# BoxLayout Base Class — Implementation Plan

## Overview

Extract a new abstract base class `BoxLayout` (extends `LayoutManager`) that holds the axis-agnostic configuration plumbing currently duplicated, byte-for-byte, between [`HBox`](../src/typescript/lib/layout/HBox.ts) and [`VBox`](../src/typescript/lib/layout/VBox.ts). Today both managers carry identical copies of four private fields, a constructor, `applyOptions`, and eight accessors; the only divergence is two drifted setter bodies (`setComponentSpacing`, `setStretching`) that this plan reconciles. The geometric algorithms (`getPreferredSize`, `getMinSize`, `getMaxSize`, `computeTotalMinSize`, `doLayout`) are mirror-image — NOT identical — and stay in the subclasses untouched, as do the axis-specific `_defaultComponentWidth`/`_defaultComponentHeight` fields and HBox's baseline override `getContentBaseline`.

The new file is `src/typescript/lib/layout/BoxLayout.ts`. It also becomes the home of the shared vocabulary types `BoxMode` and `BoxOverflowSizing` (currently in [`HBox.ts:20`](../src/typescript/lib/layout/HBox.ts#L20) / [`HBox.ts:38`](../src/typescript/lib/layout/HBox.ts#L38)) and a new shared `BoxLayoutOptions` interface that `HBoxOptions`/`VBoxOptions` extend. This stops `VBox` reaching into `~/layout/HBox.js` for its types ([`VBox.ts:6`](../src/typescript/lib/layout/VBox.ts#L6)).

This is an internal refactor: no behaviour changes for consumers beyond the two reconciled setter edge cases. The only importer of the moved types is `VBox.ts`; the only `instanceof HBox || instanceof VBox` site is [`ToolBar.ts`](../src/typescript/lib/component/menubar/ToolBar.ts#L177) and is left as-is.

---

## Architecture Decisions

### `BoxLayout` is abstract, plain-exported, with no `callable` wrapper

`callable()` ([`Callable.ts:37`](../src/typescript/lib/core/Callable.ts#L37)) exists so a concrete class can be invoked without `new`. `BoxLayout` is `abstract` and never instantiated directly — the subclasses are what consumers construct, and they keep their own `callable()` wrappers + dual `_HBox`/`HBox` exports. So `BoxLayout` is exported as a plain `export abstract class BoxLayout`. `LayoutManager` itself ([`LayoutManager.ts:29`](../src/typescript/lib/layout/LayoutManager.ts#L29)) sets the precedent: it is abstract and plain-exported with no wrapper.

### Reconcile `setComponentSpacing` to `this._spacing = spacing || 0;`

HBox uses `this._spacing = spacing || 0;` ([`HBox.ts:130`](../src/typescript/lib/layout/HBox.ts#L130)); VBox uses the bare `this._spacing = spacing;` ([`VBox.ts:99`](../src/typescript/lib/layout/VBox.ts#L99)). Adopt HBox's `|| 0`. Rationale: the getter on both is already `return this._spacing || 0;` so a `null`/`undefined`/`NaN` argument is coerced on read either way, but normalising on write keeps the backing field clean and matches the getter's intent. The behaviour is identical for all valid numeric inputs; `|| 0` only differs for falsy garbage, which it defensively zeroes. This is the strictly-safer of the two drifted forms.

### Reconcile `setStretching` to `this._stretching = !!stretching;`

HBox uses `this._stretching = stretching;` ([`HBox.ts:150`](../src/typescript/lib/layout/HBox.ts#L150)); VBox uses `this._stretching = !!stretching;` ([`VBox.ts:119`](../src/typescript/lib/layout/VBox.ts#L119)). Adopt VBox's `!!`. Rationale: the parameter is typed `boolean`, so for type-correct callers the two are identical; `!!` additionally guards against a truthy/falsy non-boolean slipping through (e.g. an untyped `applyOptions` value) and guarantees the stored field is a real boolean, matching the getter's `return this._stretching || false;`. Strictly safer, behaviour-preserving for typed callers.

### Move `BoxMode` / `BoxOverflowSizing` into `BoxLayout.ts`

Move both type aliases to `BoxLayout.ts` so the base file owns the shared vocabulary and `VBox` no longer imports from its sibling `HBox`. Only one source file imports them today (`VBox.ts`), and the barrel re-export specifier ([`index.ts:20`](../src/typescript/lib/layout/index.ts#L20)) is the only other reference — both are cheap to repoint. The alternative (leave them in HBox) keeps the diff one line smaller but cements the `VBox → HBox` coupling the refactor is meant to remove, and leaves the base file not owning vocabulary its own `applyOptions`/`setMode`/`setOverflowSizing` now reference. Cleaner ownership wins. Importers to repoint:
- `VBox.ts:6` — change `from "~/layout/HBox.js"` to `from "~/layout/BoxLayout.js"` (or drop the import entirely if VBox no longer references the type names directly — see below).
- `index.ts:20` — change the `BoxMode, BoxOverflowSizing` re-export specifier from `~/layout/HBox.js` to `~/layout/BoxLayout.js`.
- `HBox.ts` — now imports both from `~/layout/BoxLayout.js` instead of declaring them.

The generated TypeDoc page paths (`/api/layout/type-aliases/BoxMode`, `/BoxOverflowSizing`) are bucket-scoped, not file-scoped, so curated doc links in `docs/layouts/HBox.md`, `docs/layouts/VBox.md`, and `docs/reference/changelog.md` remain valid with no edits.

### Shared `BoxLayoutOptions` interface; `applyOptions` typed against it

Introduce `export interface BoxLayoutOptions extends LayoutManagerOptions` in `BoxLayout.ts` carrying the four shared fields (`spacing`, `stretching`, `mode`, `overflowSizing`) — confirmed field-for-field identical between `HBoxOptions` ([`HBox.ts:52`](../src/typescript/lib/layout/HBox.ts#L52)) and `VBoxOptions` ([`VBox.ts:21`](../src/typescript/lib/layout/VBox.ts#L21)). `HBoxOptions`/`VBoxOptions` become empty `extends BoxLayoutOptions` interfaces, each keeping its own axis-specific JSDoc `@remarks` (the prose differs: "horizontal axis"/"width" vs "vertical axis"/"height"). The base `applyOptions(options: BoxLayoutOptions)` is `protected`, overriding `LayoutManager`'s `protected applyOptions(_options: LayoutManagerOptions)` no-op ([`LayoutManager.ts:56`](../src/typescript/lib/layout/LayoutManager.ts#L56)). Subclasses drop their `applyOptions` override entirely and inherit the base one.

### Subclasses drop their constructor and accessors; the class-field super-trap does not apply

The project's class-field super-cascade trap (a field written by a setter during `super()` gets re-clobbered by a subclass field *initializer* running after `super()` returns) requires a subclass that BOTH initializes the field AND has the base write it during construction. Here, after the refactor, the four shared fields (`_spacing`, `_stretching`, `_mode`, `_overflowSizing`) live ONLY on `BoxLayout`, with their initializers on `BoxLayout`, and the ONLY constructor is `BoxLayout`'s. `HBox`/`VBox` declare NO constructor (they inherit `BoxLayout`'s) and NO copies of those fields. So the sequence is: subclass instantiation → `BoxLayout` field initializers run (`_spacing = 5`, etc.) → `BoxLayout` constructor body runs `applyOptions` → setters overwrite. There is no subclass initializer to re-clobber afterward. The trap is structurally impossible. The subclasses keep their own axis-specific field (`_defaultComponentWidth`/`_defaultComponentHeight`); these are read only inside `doLayout` (well after construction), are never written by any constructor-time setter, and their initializers run after the inherited base constructor returns — which is exactly when a never-constructor-touched field should initialize. Safe.

### Keep `getComponentSpacing`/`isStretching`/`getMode`/`getOverflowSizing` bodies verbatim

The four getters are already byte-identical across both files (`return this._spacing || 0;`, `return this._stretching || false;`, `return this._mode;`, `return this._overflowSizing;`). Move them as-is. `setMode`/`setOverflowSizing` are also already identical — move verbatim.

---

## Public API (TypeScript Signatures)

```typescript
// New file: src/typescript/lib/layout/BoxLayout.ts

export type BoxMode = "preferred" | "equal";
export type BoxOverflowSizing = "preferred" | "min";

export interface BoxLayoutOptions extends LayoutManagerOptions {
    spacing?:        number;
    stretching?:     boolean;
    mode?:           BoxMode;
    overflowSizing?: BoxOverflowSizing;
}

export abstract class BoxLayout extends LayoutManager {
    private _spacing: number = 5;
    private _stretching: boolean = false;
    private _mode: BoxMode = "preferred";
    private _overflowSizing: BoxOverflowSizing = "preferred";

    constructor(options?: BoxLayoutOptions);

    protected applyOptions(options: BoxLayoutOptions): void;

    getComponentSpacing(): number;
    setComponentSpacing(spacing: number): this;   // this._spacing = spacing || 0;
    isStretching(): boolean;
    setStretching(stretching: boolean): this;      // this._stretching = !!stretching;
    getMode(): BoxMode;
    setMode(mode: BoxMode): this;
    getOverflowSizing(): BoxOverflowSizing;
    setOverflowSizing(overflowSizing: BoxOverflowSizing): this;
    // getPreferredSize / getMinSize / getMaxSize / computeTotalMinSize / doLayout
    // are NOT declared here — each remains concrete in the subclass.
}
```

```typescript
// HBox.ts — now extends BoxLayout
import { BoxLayout, BoxLayoutOptions, BoxMode, BoxOverflowSizing } from "~/layout/BoxLayout.js";

export interface HBoxOptions extends BoxLayoutOptions {}   // axis-specific JSDoc only

class HBox extends BoxLayout {
    private _defaultComponentWidth: number = 100;          // stays
    // getContentBaseline override stays
    // getPreferredSize / getMinSize / getMaxSize / computeTotalMinSize / doLayout stay
    // NO constructor, NO applyOptions, NO _spacing/_stretching/_mode/_overflowSizing, NO accessors
}
```

```typescript
// VBox.ts — now extends BoxLayout
import { BoxLayout, BoxLayoutOptions } from "~/layout/BoxLayout.js";
// BoxMode/BoxOverflowSizing no longer imported unless still referenced — they
// are only used inside the moved fields/accessors, which leave VBox, so the
// import drops entirely.

export interface VBoxOptions extends BoxLayoutOptions {}   // axis-specific JSDoc only

class VBox extends BoxLayout {
    private _defaultComponentHeight: number = 100;         // stays
    // getPreferredSize / getMinSize / getMaxSize / computeTotalMinSize / doLayout stay
    // NO constructor, NO applyOptions, NO _spacing/_stretching/_mode/_overflowSizing, NO accessors
}
```

> Note on empty-interface lint: `interface HBoxOptions extends BoxLayoutOptions {}` is an empty-extends interface. Confirm the project's ESLint config does not flag `@typescript-eslint/no-empty-object-type`/`no-empty-interface` on it; if it does, prefer `export type HBoxOptions = BoxLayoutOptions;` (a type alias preserves the public name without an empty interface body). Decide at implementation time by running `npm run lint` — the interface form is preferred for the doc `@remarks` JSDoc block to attach to, so only fall back to the alias if lint rejects it.

---

## Ordered Implementation Steps

1. **Create `src/typescript/lib/layout/BoxLayout.ts`.** SPDX header; import `LayoutManager, LayoutManagerOptions` from `~/layout/LayoutManager.js`. Add the two type aliases (`BoxMode`, `BoxOverflowSizing`) with their existing JSDoc verbatim from `HBox.ts:8-38`. Add `BoxLayoutOptions` with the four fields and a generic `@category Layouts` JSDoc. Add `export abstract class BoxLayout extends LayoutManager` containing: the four private fields with initializers, the constructor (`super(); if (options) { this.applyOptions(options); }`), `protected applyOptions(options: BoxLayoutOptions)` (the dispatch copied verbatim from either subclass — they are identical: mode → spacing → stretching-with-`equal`-default → overflowSizing), and the eight accessors with the two reconciled setter bodies (`|| 0` and `!!`). Each member keeps a JSDoc block (axis-neutral wording, e.g. "the container's cross axis" rather than "height"/"width").

2. **Rewrite `HBox.ts`.** Change import to `import { BoxLayout, BoxLayoutOptions, BoxMode, BoxOverflowSizing } from "~/layout/BoxLayout.js";` (keep `BoxMode`/`BoxOverflowSizing` — they are still referenced by `getMode`/`setMode`/`getPreferredSize`/etc. that REMAIN in HBox). Remove the two type-alias declarations. Change `HBoxOptions` to `extends BoxLayoutOptions {}` (empty body, keep its `@remarks`). Change `class HBox extends LayoutManager` → `extends BoxLayout`. Delete: the four shared fields, the constructor, `applyOptions`, and the eight accessors. KEEP: `_defaultComponentWidth`, `getContentBaseline`, `getPreferredSize`, `getMinSize`, `getMaxSize`, `computeTotalMinSize`, `doLayout`, and the `callable()` wrapper + dual export.

3. **Rewrite `VBox.ts`.** Change import line 6 to `import { BoxLayout, BoxLayoutOptions } from "~/layout/BoxLayout.js";` and remove the old `import { BoxMode, BoxOverflowSizing } from "~/layout/HBox.js";` (VBox no longer references those names after the accessors move out — verify with grep in step 6; if any reference remains, add them back to this import). Change `VBoxOptions` to `extends BoxLayoutOptions {}` (keep `@remarks`). Change `class VBox extends LayoutManager` → `extends BoxLayout`. Delete the same shared members as HBox. KEEP: `_defaultComponentHeight`, the five geometric methods, and the `callable()` wrapper + dual export.

4. **Update the barrel** `src/typescript/lib/layout/index.ts`. Repoint the `BoxMode, BoxOverflowSizing` re-export (line 20) from `~/layout/HBox.js` to `~/layout/BoxLayout.js`. Add `export { BoxLayout } from '~/layout/BoxLayout.js';` and `export type { BoxLayoutOptions } from '~/layout/BoxLayout.js';` (see Architecture Decision below on exporting the abstract base).

5. **Verify `ToolBar.ts` untouched.** Its `instanceof HBox || instanceof VBox` checks ([`ToolBar.ts:177`,`231`](../src/typescript/lib/component/menubar/ToolBar.ts#L177)) still resolve — `HBox`/`VBox` remain concrete classes. No `instanceof BoxLayout` is introduced (the two checks are deliberate and equivalent; collapsing them to `instanceof BoxLayout` is out of scope). Confirm no edit needed.

6. **Grep invariants** (see Verification).

7. **Typecheck** `npm run typecheck`.

8. **Docs build** `npm run docs:build`.

### Export-the-base decision

Export `BoxLayout` and `BoxLayoutOptions` from the barrel. Rationale: `LayoutManager` and `LayoutManagerOptions` (its sibling abstract base) are already barrel-exported ([`index.ts:3-4`](../src/typescript/lib/layout/index.ts#L3)), so omitting `BoxLayout` would be inconsistent; and a shared base enables consumer `instanceof BoxLayout` checks and shared typing (`function f(layout: BoxLayout)`). The cost is one generated TypeDoc class page, which is acceptable and consistent with `LayoutManager`'s treatment. If implementation reveals the project deliberately hides abstract bases (it does not — `LayoutManager` is public), revisit; default is export.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/layout/BoxLayout.ts` |
| Modify | `src/typescript/lib/layout/HBox.ts` |
| Modify | `src/typescript/lib/layout/VBox.ts` |
| Modify | `src/typescript/lib/layout/index.ts` |

---

## Verification

- **Typecheck:** `npm run typecheck` (`tsc -p tsconfig.lib.json --noEmit`) passes with 0 errors.
- **Lint:** `npm run lint` passes (watch for empty-interface rule on `HBoxOptions`/`VBoxOptions` — fall back to type alias if flagged, per the Public API note).
- **No duplicated accessor bodies remain.** Each must appear exactly once across the layout dir, in `BoxLayout.ts` only:
  - `grep -rn 'getComponentSpacing\|setComponentSpacing\|isStretching\|setStretching\|getOverflowSizing\|setOverflowSizing' src/typescript/lib/layout/HBox.ts src/typescript/lib/layout/VBox.ts` — expect zero matches.
  - `grep -rn 'protected applyOptions' src/typescript/lib/layout/HBox.ts src/typescript/lib/layout/VBox.ts` — expect zero matches.
  - `grep -n 'getMode\|setMode' src/typescript/lib/layout/BoxLayout.ts` — expect one each.
- **No `VBox → HBox` type coupling remains.** `grep -n 'from "~/layout/HBox' src/typescript/lib/layout/VBox.ts` — expect zero matches.
- **Type aliases live in one place.** `grep -rn 'export type BoxMode\|export type BoxOverflowSizing' src/typescript/lib/layout/` — expect both only in `BoxLayout.ts`.
- **Subclasses still concrete (instanceof intact).** `grep -n 'instanceof HBox\|instanceof VBox' src/typescript/lib/component/menubar/ToolBar.ts` — expect the two pre-existing matches, unchanged.
- **Docs build:** `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning). Relevant because `BoxLayout` becomes a new generated API page and `BoxMode`/`BoxOverflowSizing` move source files (their generated page paths are bucket-scoped and must stay resolvable for the curated links in `docs/layouts/HBox.md:58`, `docs/layouts/VBox.md:70`, `docs/reference/changelog.md`).
- **Manual smoke test:** run `npm run dev` (app at http://localhost:8015) and exercise `HBoxPanel.ts` and `VBoxPanel.ts` ([`src/typescript/HBoxPanel.ts`](../src/typescript/HBoxPanel.ts), [`src/typescript/VBoxPanel.ts`](../src/typescript/VBoxPanel.ts)). Confirm both panels render rows/columns with correct spacing, stretching, and `equal`/`preferred` modes (i.e. construction-time options still dispatch through the inherited `applyOptions`). The `ToolBarPanel.ts` exercises the `instanceof` path in `ToolBar`.

---

## Documentation Impact

Internal refactor with a small public-surface addition (the abstract base):

- **Barrel:** `src/typescript/lib/layout/index.ts` gains `BoxLayout` (class) and `BoxLayoutOptions` (type) exports; the `BoxMode`/`BoxOverflowSizing` re-export specifier is repointed (same names, same generated page paths).
- **Generated API:** `BoxLayout` will appear under `docs/api/layout/classes/BoxLayout` after `docs:api`; `BoxLayoutOptions` under `interfaces/`. These are auto-generated by TypeDoc — no manual page authoring required. Confirm they land after build.
- **Curated pages:** No new curated page is needed — `BoxLayout` is an abstract base with no standalone consumer story; `HBox`/`VBox` keep their existing `docs/layouts/HBox.md` and `docs/layouts/VBox.md`. No sidebar entry in `docs/.vitepress/config.mts` is added for the abstract base (matching how `LayoutManager` has no curated page despite being exported).
- **No curated-link edits:** the `BoxMode`/`BoxOverflowSizing` link targets in `docs/layouts/HBox.md`, `docs/layouts/VBox.md`, and `docs/reference/changelog.md` use bucket-scoped TypeDoc paths (`/api/layout/type-aliases/...`) that are independent of the source file, so they remain valid.
- **`@category Layouts`** on all new symbols (`BoxLayout`, `BoxLayoutOptions`, and the relocated `BoxMode`/`BoxOverflowSizing` keep theirs) so they file under the Layouts group.

---

## Potential Challenges

- **Empty-interface lint rule** may reject `HBoxOptions extends BoxLayoutOptions {}` — mitigation: fall back to `export type HBoxOptions = BoxLayoutOptions;` (loses the ability to hang an interface-level `@remarks` JSDoc, so prefer the interface if lint allows).
- **Stale VBox import of `BoxMode`/`BoxOverflowSizing`** — after moving the accessors out, VBox may or may not still reference the type names; grep before deciding whether to keep them in the import (step 3). A leftover unused import will fail lint/typecheck.
- **TypeDoc not picking up the new abstract class** — if `BoxLayout` lands somewhere unexpected, confirm `@category Layouts` is present and that `src/typescript` is the typedoc entry (it is, per `typedoc.json`/`docs:api`).
- **Forgetting the barrel re-export repoint** — the `index.ts:20` specifier still pointing at `~/layout/HBox.js` would keep working only by accident (HBox would no longer export the types); the docs/typecheck would surface it, but grep-verify explicitly.

---

## Critical Files

- [`src/typescript/lib/layout/HBox.ts`](../src/typescript/lib/layout/HBox.ts) — source of the shared members (fields, constructor, `applyOptions`, accessors, the two type aliases) and the `setComponentSpacing` `|| 0` form; keeps its geometric methods + `getContentBaseline`.
- [`src/typescript/lib/layout/VBox.ts`](../src/typescript/lib/layout/VBox.ts) — second copy; source of the `setStretching` `!!` form and the cross-file type import to remove.
- [`src/typescript/lib/layout/LayoutManager.ts`](../src/typescript/lib/layout/LayoutManager.ts) — the base `BoxLayout` extends; note `applyOptions` is `protected` and a no-op there ([line 56](../src/typescript/lib/layout/LayoutManager.ts#L56)), and it is itself abstract + plain-exported (the precedent for `BoxLayout`).
- [`src/typescript/lib/core/Callable.ts`](../src/typescript/lib/core/Callable.ts) — confirms the abstract base needs no wrapper.
- [`src/typescript/lib/layout/index.ts`](../src/typescript/lib/layout/index.ts) — barrel; line 20 re-export to repoint, new base exports to add.
- [`src/typescript/lib/component/menubar/ToolBar.ts`](../src/typescript/lib/component/menubar/ToolBar.ts) — the lone `instanceof HBox || instanceof VBox` consumer ([lines 177, 231](../src/typescript/lib/component/menubar/ToolBar.ts#L177)); verify it stays untouched.
- [`CODE_CONVENTIONS.md`](../CODE_CONVENTIONS.md) — explicit field/return types, JSDoc on every member, blank-line spacing, one statement per line.
- [`.claude/skills/_shared/docs-conventions.md`](../.claude/skills/_shared/docs-conventions.md) — barrel re-export + `@category` rules; `npm run docs:build` 0-error/0-warning gate.

---

## Non-Goals

- **Unifying the geometric algorithms.** `getPreferredSize`/`getMinSize`/`getMaxSize`/`computeTotalMinSize`/`doLayout` are mirror-image (width↔height, left↔top) but NOT identical; abstracting them behind an axis indirection would obscure the per-axis logic and balloon complexity for no behavioural gain. They stay as concrete per-subclass methods.
- **Collapsing the two `instanceof` checks in `ToolBar` to `instanceof BoxLayout`.** Tempting now that a shared base exists, but it is a separate behavioural decision outside this extraction's scope; leave the checks verbatim.
- **Touching `_defaultComponentWidth`/`_defaultComponentHeight`.** Axis-specific; they remain on their respective subclasses.
- **Adding a curated docs page for `BoxLayout`.** It is an abstract base with no standalone consumer narrative (matching `LayoutManager`).
