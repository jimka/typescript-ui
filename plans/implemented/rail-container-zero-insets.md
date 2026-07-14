# Rail-Style Zero-Inset Panel — Implementation Plan

## Overview

Add an opt-in `flush?: boolean` construction option to [`Panel`](src/typescript/lib/core/Panel.ts#L98) that seeds the panel's default content insets to zero instead of the standard `(4, 4, 4, 4)`. This gives rail-style containers — a fixed-width strip hosting an activity rail, or a narrow `Border`/`VBox` region — a declarative way to sit flush against their host's edges so their width stays pixel-constant, replacing the `container.setInsets(new Insets(0, 0, 0, 0))` workaround the `sqladmin` app applied to its activity bar.

The 4-pixel default originates in `Panel` alone. [`Component._defaultOptions.insets`](src/typescript/lib/core/Component.ts#L430) is `new Insets(0, 0, 0, 0)` and [`Container`](src/typescript/lib/core/Container.ts#L26) keeps that zero default; [`_defaultPanelOptions`](src/typescript/lib/core/Panel.ts#L98) overrides it with `new Insets(4, 4, 4, 4)`. Layout managers read the host's insets through [`Component.getContentInsets`](src/typescript/lib/core/Component.ts#L1621) (insets + padding) and offset every region by it — see [`Border.doLayout`](src/typescript/lib/layout/Border.ts#L851) reading `container.getContentInsets()` and positioning each region at `containerInsets.getLeft()/getTop()`. So a fixed-width rail hosted in a default `Panel` is shifted and reserved against by that 4px, and is not flush or size-predictable.

Note the rail's own `ToolBar` is already flush: `ToolBar` defaults to `compact: true`, which [zeroes its own panel insets](src/typescript/lib/component/menubar/ToolBar.ts#L268). The gap is purely the **host** container that wraps the rail — that is what this plan targets.

---

## Architecture Decisions

### Opt-in flag over auto-detection

Recommend an explicit opt-in flag; reject auto-detecting a "narrow fixed-width region." Auto-detection needs a magic width threshold with no principled value, misfires while a `Border` region is transiently narrow mid-collapse-animation (the region is laid out at full size and clip-revealed — see `Border.applyRegionClip`), and couples inset policy to live layout geometry. The repo's conventions favour explicit typed options and forbid unexplained magic numbers ([CODE_CONVENTIONS.md](CODE_CONVENTIONS.md), global conventions), so a declarative flag is both cleaner and lower-risk.

### Place the flag on `Panel`

The 4px default lives only on `Panel`; `Container` and `Component` are already zero-inset. The flag therefore belongs where the default it overrides is defined. This also matches the app's own workaround, which was container-level (`activityBar.setInsets(0,0,0,0)` on the whole panel), and it composes with **any** layout manager the rail panel uses (a `Border` host, a `VBox` of launcher buttons, etc.) rather than being tied to one.

### `flush` is a construction-time default selector — no runtime setter or backing field

`flush` only chooses which default `insets` the panel starts with; after construction, `insets` is the single source of truth (mutable via the existing `setInsets`/`clearInsets`). A runtime `setFlush` would be redundant and ambiguous, so `flush` gets **no** backing field, getter, or setter — it is read once in the constructor. This mirrors the existing construction-only [`tag`](src/typescript/lib/core/Panel.ts#L74) option on `PanelOptions`, which likewise has no setter (an element's tag can't change at runtime). It sidesteps the `super()`-cascade field trap entirely (no field to `declare`), and respects ARCHITECTURE.md's rule to reserve runtime setters for genuinely mutable state.

### Thin semantic default, not a new mechanism

The zero-inset *mechanism* already exists (`insets: new Insets(0, 0, 0, 0)`). `flush` adds a discoverable, named intent for the rail pattern and — because it changes a **default** — composes with subclass defaults and can't be silently clobbered, while a caller-supplied explicit `insets` still wins (see below). The plan deliberately keeps it to this: one boolean that flips the inset default, no extra behaviour.

### Explicit `insets` always wins over `flush`

`Component.applyOptions` calls `setInsets(options.insets)` only when `options.insets !== undefined` ([Component.ts:488](src/typescript/lib/core/Component.ts#L488)); otherwise `getInsets()` falls back to `_defaultOptions.insets`. `flush` only rewrites that fallback default, so a caller passing both `flush: true` and an explicit `insets` gets the explicit value — the same precedence `Panel`'s doc comment already promises for the 4px default.

### Name: `flush`, not `rail`

`Rail` is already a public class in `@jimka/typescript-ui/overlay` (a window/drawer launcher strip — [Rail.ts](src/typescript/lib/overlay/Rail.ts#L259), with `RailHandle`). A `rail` option on `Panel` would collide semantically with that subsystem. `flush` names the effect (content sits flush to the panel edges) unambiguously.

### Rejected alternative: extend `Border`'s `ignoreParentInsets` to west/east/south

`Border` already supports `constraints.ignoreParentInsets`, but only wires it for the NORTH region ([Border.ts:898-901](src/typescript/lib/layout/Border.ts#L898)); the west/east/south branches only ever add `containerInsets.getLeft()/getTop()` and never add the inset back into the width the way NORTH does. Extending it to a west rail region would touch `Border`'s trickier per-region geometry (which has a pre-existing left/top-only offset quirk) and would only help `Border`-hosted rails. A `Panel`-level `flush` is more general and far lower-risk, so it is preferred.

---

## Public API

```typescript
// src/typescript/lib/core/Panel.ts — added to PanelOptions
export interface PanelOptions extends ContainerOptions {
    tag?:        string;
    autoScroll?: AutoScrollMode;
    scrollShadows?: boolean;

    /**
     * When `true`, the panel's default content insets are zero instead of the
     * usual `(4, 4, 4, 4)` — the rail-style default for a fixed-width strip
     * (activity rail, narrow Border/VBox region) that must sit flush against
     * its host and keep a constant width. Construction-time only; a
     * caller-supplied `insets` still wins. Defaults to `false`.
     */
    flush?: boolean;
}
```

No new accessor/setter/backing field. `flush` is consumed once, in the constructor, to select the default `insets`.

---

## Internal Structure

`Panel`'s constructor already merges `_defaultPanelOptions` with a `subclassDefaults` bag before handing them to `super` as the effective `_defaultOptions`. Add a zero-inset override to that merged default when `flush` is set and no explicit `insets` is present:

```typescript
constructor(options?: TOptions, subclassDefaults?: Partial<TOptions>) {
    // `flush` seeds a zero-inset default; a caller-supplied `insets` still
    // wins because Component.applyOptions dispatches setInsets only when
    // options.insets is defined, overriding whatever default we pick here.
    const flushDefault: Partial<TOptions> =
        options?.flush ? ({ insets: new Insets(0, 0, 0, 0) } as Partial<TOptions>) : {};

    super(
        options,
        { ..._defaultPanelOptions, ...(subclassDefaults ?? {}), ...flushDefault } as Partial<TOptions>,
    );
}
```

Key points for the implementer:

- `options` (the first `super` argument) is forwarded **verbatim** — only the defaults bag (second argument) is computed — so the `local/forward-super-options` lint rule is satisfied, exactly as the existing constructor already forwards `options` untouched.
- `flushDefault` is spread **last** so it wins over any `insets` a subclass passed in `subclassDefaults` (e.g. a subclass with roomy insets constructed with `flush: true` still goes flush — an explicit opt-in, not a regression, since `flush` defaults off).
- Do **not** mutate `_defaultPanelOptions` (a shared module const); the spread builds a fresh object.
- Reading `options?.flush` before `super()` is legal — it touches a parameter, not `this`.

---

## Ordered Implementation Steps

1. **`src/typescript/lib/core/Panel.ts` — add the option field.** In the `PanelOptions` interface, add `flush?: boolean;` with the JSDoc block from *Public API*. Check `Insets` is already imported (it is — line 4).
2. **`src/typescript/lib/core/Panel.ts` — seed the default in the constructor.** Replace the constructor body's `super(...)` call with the *Internal Structure* version that computes `flushDefault` and spreads it last. Keep the existing constructor JSDoc; extend its `@param options` note to mention `options.flush` zeroes the default insets.
3. **`src/typescript/lib/core/Panel.ts` — class JSDoc.** Add one sentence to the class doc noting that `flush: true` opts a panel into zero default insets for rail-style strips, alongside the existing 4px-default description.
4. **Typecheck.** `npm run typecheck` — expect zero errors.
5. **Add unit tests.** Create `tests/core/PanelFlushInsets.test.ts` per *Expected Behaviour*. Run `vitest run tests/core/PanelFlushInsets.test.ts` — expect green.
6. **Docs build.** `npm run docs:build` — expect zero warnings (the new JSDoc `{@link}`s, if any, must only reference public symbols per CODE_CONVENTIONS.md).
7. **Changelog.** Add a bullet under the "Unreleased (pre-1.0)" section of `docs/reference/changelog.md`.
8. **Regression check.** `grep -rn 'new Panel(' src/ tests/` sanity: no existing call passes `flush`, so every existing panel keeps the 4px default — confirm the test in step 5 pins the omitted/`false` case.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/Panel.ts` (add `flush` to `PanelOptions`; seed zero-inset default in constructor; JSDoc) |
| Create | `tests/core/PanelFlushInsets.test.ts` |
| Modify | `docs/reference/changelog.md` (Unreleased bullet) |

---

## Expected Behaviour

All cases are unit-testable against `getInsets()` / `getContentInsets()` (no DOM geometry needed).

- **`flush: true` → zero default insets.** `new Panel({ flush: true }).getInsets()` returns `(0, 0, 0, 0)`; `getContentInsets()` (with no padding) is likewise all-zero.
- **`flush` omitted → 4px default preserved.** `new Panel().getInsets()` returns `(4, 4, 4, 4)` — unchanged from today.
- **`flush: false` → 4px default.** Same as omitted.
- **Explicit `insets` wins over `flush`.** `new Panel({ flush: true, insets: new Insets(2, 2, 2, 2) }).getInsets()` returns `(2, 2, 2, 2)`.
- **Explicit `insets` wins without `flush` too** (regression guard for the existing precedence): `new Panel({ insets: new Insets(1,1,1,1) }).getInsets()` returns `(1,1,1,1)`.
- **`_defaultPanelOptions` is not mutated.** After constructing a `flush` panel, a subsequent `new Panel()` still reports `(4, 4, 4, 4)` (guards against accidental shared-const mutation).
- **Rail composes with a host layout.** A `Panel({ flush: true, layoutManager: Fit() })` hosting a content-sized child, docked at `Placement.WEST` in a `Border`-managed host, reports the child's bare preferred width (not `+8` for insets) and holds it across a sibling region's collapse/expand — matching the removed `setInsets(0,0,0,0)` workaround. Contrary to the original plan draft, this is unit-testable offline against the project's existing `Border` geometry test harness (`installTestDOM` + `setRegionCollapsed`, see `tests/component/layout/Border.test.ts`) — no real browser or "manual verify" is needed, since `Border.doLayout` computes region geometry from `getPreferredSize()`/`getContentInsets()` alone, without reading live DOM metrics.

---

## Verification

- `npm run typecheck` — zero errors.
- `vitest run tests/core/PanelFlushInsets.test.ts` — the cases above pass.
- `npm run test` — full suite still green (no existing panel passes `flush`, so behaviour is unchanged for all of them; confirms no accidental default shift).
- `npm run docs:build` — finishes with **zero** warnings (CODE_CONVENTIONS.md requirement after touching public JSDoc).
- The `Border`-hosted rail composition case above is covered by an automated test in `tests/core/PanelFlushInsets.test.ts` (no manual/visual step needed — see *Expected Behaviour*).

---

## Documentation Impact

- **Export surface:** `PanelOptions` is re-exported from the `~/core` barrel ([core/index.ts:22](src/typescript/lib/core/index.ts#L22)); the new field ships automatically. No barrel edit needed.
- **API docs:** `Panel` has no hand-written `docs/**` page — it is documented via TypeDoc from JSDoc. The new field's JSDoc and the class-doc sentence are the entire rendered-docs change. `npm run docs:build` regenerates `/api/core/interfaces/PanelOptions` and `/api/core/classes/Panel`; it must pass with zero warnings, and any `{@link}` in the new JSDoc may reference only public symbols (do not link the private inset internals).
- **Changelog:** add a one-line bullet under `docs/reference/changelog.md` → "Unreleased (pre-1.0)" describing the new `Panel({ flush })` option.
- **`llms.txt`:** `Panel` is not a catalogued capability entry there (only referenced in the mental-model line), so no `llms.txt` change is required.

---

## Potential Challenges

- **Shared-const mutation.** Must spread into a new object, never write onto `_defaultPanelOptions`; the *"not mutated"* test guards this.
- **`forward-super-options` lint.** The rule inspects that `options` is forwarded to `super` unchanged; only the second (defaults) argument may be computed. Keep the first argument as the bare `options`.
- **Subclass inset defaults.** A `Panel` subclass that passes its own inset default through `subclassDefaults` — e.g. [`DiagramNode`](src/typescript/lib/component/diagram/DiagramNode.ts#L35) (`_defaultDiagramNodeOptions.insets = new Insets(4, 8, 4, 8)`, its node-chrome breathing room) — has that default overridden when spreading `flushDefault` last: `flush: true` on such a subclass zeroes it too. Acceptable (explicit opt-in, default-off), but note it so it isn't mistaken for a bug. (`StatusBar` and `FieldSet` are not examples of this — neither extends `Panel`, so neither's options type carries `flush` at all.)

---

## Critical Files

- `src/typescript/lib/core/Panel.ts` — the class being changed; see the existing constructor default-merge and `_defaultPanelOptions`.
- `src/typescript/lib/core/Component.ts` — `_defaultOptions.insets` seed (line 430), `getInsets`/`getContentInsets` (1521, 1621), and the `applyOptions` inset dispatch (line 488) that gives explicit `insets` precedence.
- `src/typescript/lib/layout/Border.ts` — `doLayout` (line 851) reading `container.getContentInsets()`; shows why the host's insets squeeze a rail region.
- `src/typescript/lib/component/menubar/ToolBar.ts` — `setCompact` (line 268) shows the rail's own bar already zeroes its insets, scoping the fix to the host.
- `tests/core/PanelGutterSettle.test.ts` — existing `Panel` vitest, for the test harness/style to mirror.

---

## Non-Goals

- **No change to `ToolBar`.** A compact (default) `ToolBar` rail already zeroes its own insets; touching it would risk regressing normal toolbars for no benefit.
- **No change to `Border`'s `ignoreParentInsets`.** Extending it to west/east/south is a separate, riskier `Border`-only change (see Architecture Decisions) and is not pursued here.
- **No global change to the `Panel` 4px default.** Existing panels must keep their breathing room; the flag is strictly opt-in.
- **No runtime `setFlush`/`isFlush` API.** `flush` is a construction-time default selector; runtime inset changes go through the existing `setInsets`/`clearInsets`.
- **App adoption is downstream.** Replacing the `sqladmin` activity-bar `setInsets(0,0,0,0)` workaround with `flush: true` happens after this library change ships in the built `dist/lib`.
