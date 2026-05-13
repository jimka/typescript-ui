# Support `super(options)` from subclasses of Panel / Component

## Context

When a subclass of `Panel` or `Component` calls `super(options)` to declaratively set up properties on its parent, the options are silently dropped. For example:

```ts
class ComplexUIPanel extends Panel {
    constructor() {
        super({ layoutManager: VBox({ stretching: true })});
        this.initLayout();
    }
}
```

In this code the `layoutManager` never gets applied. The ComplexUIPanel ends up with no layout manager and `addComponents(...)` adds children that have nowhere to be positioned. (A real instance of this bug was the broken Complex tab in the demo: only the empty "Preferences" `<fieldset>` rendered because `<fieldset>` has intrinsic content sizing; everything else collapsed.)

The reason is the leaf-only gate in [Panel.ts:45-47](src/typescript/lib/Panel.ts#L45-L47):

```ts
if (this.constructor === Panel && options) {
    this.applyOptions(options);
}
```

The same gate exists in [Component.ts:236-238](src/typescript/lib/Component.ts#L236-L238). When `ComplexUIPanel` instantiates, `this.constructor === ComplexUIPanel` inside Panel's constructor, so the gate is false and `applyOptions` never runs.

The current design's rationale (documented at [Component.ts:233-235](src/typescript/lib/Component.ts#L233-L235)):

> Dispatch the rest of the options at the leaf only. Subclass constructors call `applyOptions(options)` themselves with their full bag once their internal child components are built.

This was a deliberate choice for two reasons:

1. **Performance.** `applyOptions` runs ~30 `!== undefined` checks plus the relevant setters. The gate keeps this from running at every super() hop in long inheritance chains.
2. **Ordering.** A subclass typically wants to build its own internal child components first, and only then apply consumer-supplied options like `components: [...]` or `layoutManager: ...`.

The workaround used by every other demo panel is "call `super()` with no args and use direct setters in the subclass body" (e.g. [HBoxPanel.ts](src/typescript/HBoxPanel.ts), [BindingPanel.ts](src/typescript/BindingPanel.ts)). That works but is the only reason `super(options)` is unsupported.

We want to support `super(options)` because:
- It reads naturally — declarative configuration at construction time.
- Newcomers reach for it first; the silent failure is a footgun.
- It's the obvious pattern for hand-rolled demo subclasses where the options are literals.

## Goal

Make `super({ ...optionsBag })` work from any direct subclass of `Panel` (and by extension, `Component`), without breaking the existing leaf-gated pattern that other subclasses already rely on.

## Approach

Drop the `this.constructor === X` gate in `Panel` and `Component`, and rely on `applyOptions` being idempotent.

### Changes

**[Panel.ts:45-47](src/typescript/lib/Panel.ts#L45-L47):**

```ts
// Before
if (this.constructor === Panel && options) {
    this.applyOptions(options);
}

// After
if (options) {
    this.applyOptions(options);
}
```

**[Component.ts:236-238](src/typescript/lib/Component.ts#L236-L238):**

```ts
// Before
if (this.constructor === Component && options) {
    this.applyOptions(options);
}

// After
if (options) {
    this.applyOptions(options);
}
```

That's the entire change *if* every option setter is safely idempotent. They mostly are — most are `setX(value)` calls where re-calling with the same value is a no-op-after-equality-check or harmless overwrite. The exception that breaks naive idempotency is the `components` option.

### The `components` option problem

[Component.ts:288](src/typescript/lib/Component.ts#L288) handles it:

```ts
if (options.components !== undefined) this.addComponents(options.components);
```

`addComponent` (the singular form) at [Component.ts:1952-1954](src/typescript/lib/Component.ts#L1952-L1954) throws when re-adding an already-attached child:

```ts
if (component._parent !== null) {
    throw new Error(`Component ${component.getId()} already has a parent. Remove it first.`);
}
```

So if `applyOptions` ran twice along the super chain with `components` set on both levels (or even just on one — the second pass would re-walk and try to re-attach), it would throw.

In practice, only the leaf typically carries `components: [...]`. Subclass authors don't put `components` in their `super(options)` calls — they build their own children procedurally. But the codebase shouldn't depend on convention to avoid a crash.

**Two viable fixes for `components`:**

**Fix A — make `addComponent` idempotent when the child is already this component's child.** Change [Component.ts:1952](src/typescript/lib/Component.ts#L1952):

```ts
if (component._parent === this) {
    return this;  // already a child of this component; skip
}
if (component._parent !== null) {
    throw new Error(`Component ${component.getId()} already has a parent. Remove it first.`);
}
```

This is the smallest change and matches the spirit of "re-applying options should be safe."

**Fix B — guard `components` in `applyOptions` with a "already applied" flag.** Add a private `_componentsApplied: boolean = false` to `Component` and gate the children-attach:

```ts
if (options.components !== undefined && !this._componentsApplied) {
    this._componentsApplied = true;
    this.addComponents(options.components);
}
```

Less invasive at the addComponent layer but adds bookkeeping state.

**Recommendation:** Fix A. It also helps future users who hit "I'm trying to re-parent a component to its current parent" by making it a no-op instead of an error.

### Cost

For a class N levels deep in the inheritance chain that uses `super(options)`:

- Before: `applyOptions` runs once at the leaf.
- After: `applyOptions` runs once at every level along the super chain that passes options up — up to N times.

Each call is N field-presence checks plus the setters for any provided fields. In this codebase the typical depth is 2-3 (`Component` → `Panel` → `MySubclass`). The extra setter calls are guarded by `!== undefined`, so they're a few microbenchmarks per construction. Negligible for a UI framework that constructs components on user actions, not in tight loops.

If a future class proves performance-critical, it can opt back into a leaf gate locally. The default becomes "works as expected," and optimization is the exception, not the rule.

### Ordering concerns

Currently, a subclass can do:

```ts
constructor(options?: PanelOptions) {
    super(options);
    this.buildInternalChildren();  // runs AFTER Panel's leaf-applyOptions would have, but BEFORE consumer's leaf-applyOptions
}
```

With the leaf gate dropped, `super(options)` causes `applyOptions(options)` to run inside Panel's constructor — BEFORE `buildInternalChildren()`. If the consumer's options include `components: [...]`, those children get added before the subclass's internal children are built.

In practice this is rarely a problem — most demo subclasses do all their setup procedurally and don't accept consumer-supplied options. But it's a real semantic change. The plan should explicitly call out:

> Subclasses that accept consumer options AND build internal children should either (a) call `super()` with no args and apply consumer options at the end of their own constructor, or (b) be aware that consumer options are applied before subclass-built children.

This matches what (a) the codebase already does for every demo panel, and (b) is consistent with the simpler "apply once eagerly" mental model the rest of the framework uses (setters fire immediately, not on a defer).

## Critical files

- [src/typescript/lib/Panel.ts](src/typescript/lib/Panel.ts) — drop the `this.constructor === Panel` gate
- [src/typescript/lib/Component.ts](src/typescript/lib/Component.ts) — drop the `this.constructor === Component` gate; make `addComponent` idempotent for the same-parent case (Fix A)
- Update the comment at [Component.ts:233-235](src/typescript/lib/Component.ts#L233-L235) to reflect the new "apply at every level along the super chain" semantics, and add a one-line note about the ordering implication for subclasses that build internal children.
- Revert [ComplexUIPanel.ts:7-11](src/typescript/ComplexUIPanel.ts#L7-L11) to the original `super({ layoutManager: ... })` form — it becomes the canonical demonstration that `super(options)` works.

## Verification

1. `npm run typecheck` — clean.
2. `npm run build` and `npm run build:lib` — both pass.
3. `npm run dev` — every tab renders identically to before, including:
   - The 16 demo panels that currently use `super()` + direct setters (unchanged behaviour).
   - The Complex tab now showing all 7 sub-panels with proper layout (the regression caught the bug).
4. Add a focused test: a subclass of `Panel` that passes `{ layoutManager, components, backgroundColor }` to `super(...)` and asserts the layout manager is set, children are attached, and background color is applied.
5. Sanity test the idempotent `addComponent`: call `parent.addComponent(child)` twice in a row; the second call should be a no-op (no throw, no duplicate in children list, no double DOM append). Verify with `parent.getComponents().length === 1`.

## Out of scope

- A formal "leaf detection" mechanism (e.g. a sentinel value passed through the super chain). Not needed if `applyOptions` is idempotent.
- Refactoring other gating classes (none currently exist outside `Panel` and `Component`).
- Changing the demo panels that already use `super()` + setters — they continue to work as-is. Only ComplexUIPanel reverts to the new idiom because it's the proof case.
