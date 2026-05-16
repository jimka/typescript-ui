# Eliminate redundant `applyOptions` calls via an options-bag-as-state refactor

## Context

Commit 5bfa2ae on `feature/super-options-from-subclasses` dropped two leaf gates in `Component` and `Panel` so that `super({ layoutManager, ... })` from a Panel subclass like `ComplexUIPanel` would actually apply the options. The fix works, but introduced a **double-apply** for every direct subclass of `Component` (Panel, Input, Text, Glyph, Header, …): each one forwards `super({ tag: ... })`, Component's now-ungated constructor calls `applyOptions({ tag })` redundantly, and the leaf's own gate later calls `applyOptions(fullOptions)`.

We explored several remediation paths in discussion:

1. **Strategy 1 — minimal revert.** Restore Component's leaf gate; keep Panel's dropped. One-line code change. Fixes the cost across all classes. Asymmetric: Panel is the only base whose subclasses get `super(options)` working.
2. **"Component-only calls applyOptions, virtual dispatch cascades up."** Architecturally elegant but blocked by JavaScript's class-field initialization order: subclass field initializers run *after* `super()` returns, so any value `applyOptions` sets on a field with an initializer in a subclass (e.g. `private text: String = ""` in `TextInput`) gets clobbered. Defaults *can* live in `applyOptions`, but then we need to also handle classes whose constructor bodies depend on positional parameters (`Glyph(name, options)`).
3. **Defer applyOptions to render time.** Breaks the synchronous configuration contract — `getLayoutManager()` would return defaults until the element is materialized, and `addComponent` / `scheduleLayout` read state synchronously.
4. **Options-bag-as-state.** Replace the per-field private backing variables (`private text: String = ""`) with a single shared `_options` bag initialized in Component's constructor body. Setters write to the bag; getters read from it. With no option-backed field initializers anywhere in the chain, the field-init clobber goes away, and `Component`'s constructor can safely cascade `applyOptions` via virtual dispatch.

We chose option 4 as the canonical fix. This plan designs that refactor end-to-end. Each phase will be executed by a fresh sub-agent so the main session can supervise without accumulating per-class implementation detail.

## Approach

**Refactor Component and its subclasses to store option-backed state in a single bag.**

### Core design

```ts
class Component<TOptions extends ComponentOptions = ComponentOptions> {
    protected _options!: TOptions;

    constructor(options?: TOptions) {
        super();

        // Structural state that is NOT option-backed stays as fields:
        this._parent = null;
        this.components = [];
        this.attributes = new Map();
        this.dirtyStyle = {};
        this.dirtyCSSRule = {};
        this.cssRule = null;

        // Option-backed state lives in _options. Initialize in the body (not via
        // field initializer) so subclass field initializers can't clobber it.
        this._options = (options ?? {}) as TOptions;

        // Tag has no setter and must be available before render — apply directly.
        if (options?.tag !== undefined) {
            (this._options as ComponentOptions).tag = options.tag;
        }

        // Single cascading applyOptions call. Virtual dispatch reaches the leaf's
        // override; super.applyOptions chains back up. No leaf gate anywhere.
        this.applyOptions(this._options);
    }

    protected applyOptions(options: TOptions): this {
        // Side-effect setters: trigger layout, DOM updates, scheduling, etc.
        // Values already live in this._options because setters mutate the bag.
        // This pass is purely for triggering side effects.
        if (options.layoutManager !== undefined) this.setLayoutManager(options.layoutManager);
        // ... rest of the 28 dispatches
        return this;
    }

    // Typed accessors read from the bag, never from individual fields:
    getLayoutManager(): LayoutManager {
        return this._options.layoutManager ?? this._defaultLayoutManager;
    }

    setLayoutManager(lm: LayoutManager): this {
        this._options.layoutManager = lm;
        this.scheduleLayout();
        return this;
    }
}
```

### Why no field-init clobber

Field initializers run after `super()` returns in subclasses, but **only run for fields declared in that subclass**. If `TextInput` no longer has `private text: String = ""` (because `text` lives in `_options`), then there's nothing to clobber. The single declaration of `_options` exists only on `Component`, and Component's constructor body initializes it — no field initializer fires for it again.

### Why Glyph-class positional-param dependency still works

```ts
class Glyph<TOptions extends GlyphOptions = GlyphOptions> extends Component<TOptions> {
    private _name: string;
    private _def: GlyphDef;

    constructor(name: string, options?: TOptions) {
        const def = Glyphs[name];
        if (!def) throw new Error(`Unknown glyph: ${name}`);

        super({ ...options, tag: def.kind === "svg" ? "svg" : "span" } as TOptions);

        this._name = name;
        this._def = def;

        // Per-def defaults applied AFTER super(), so they CAN override the bag,
        // but only for fields the user didn't explicitly set. The bag preserves
        // the user's intent — these setters just fill in defaults conditionally:
        if (this._options.preferredSize === undefined) {
            this.setPreferredSize(16, 16);
        }
        if (def.kind === "char") {
            if (this._options.lineHeight === undefined) this.setLineHeight("1");
            if (this._options.textAlign === undefined) this.setTextAlign("center");
        }
    }
}
```

The bag tells Glyph what the user explicitly asked for; Glyph fills in defaults conditionally. No clobber because we check `_options.x === undefined` before applying defaults.

### Scope and phasing

This is a large refactor. Each phase runs in its own fresh sub-agent (`subagent_type: claude`, isolation via worktree where appropriate) so the main session stays uncluttered and each phase gets a clean context with only the design pattern + target class as briefing.

**Phase 1 + Phase 2 — Component base and Panel.** **One sub-agent, sequential.** These are tightly coupled: Panel's migration validates the design pattern Component establishes, and any design issues surface here. Don't split. Sub-agent briefing: full design (this plan), target files (Component.ts, Panel.ts), verification steps. Ships as commits 1-2 + docs.

**Phase 3 — Input hierarchy.** **One sub-agent per class (or per closely-related pair).** Targets: `Input`, `TextInput` (covers `TextField`, `PasswordField`), `TextArea`, `Checkbox`, `Slider`, `DateField`, `Button` (covers `ToggleButton`, `SpinButton`, `TabCloseButton`). Each sub-agent gets: a pointer to the established pattern in Phase 1+2 commits, the target class file path, and a per-class verification step (which demo tab to load). Run sub-agents sequentially to avoid merge conflicts in shared barrel files.

**Phase 4 — Display hierarchy.** Same sub-agent-per-class shape: `Text`, `Label`, `Header`, `Legend`, `Glyph` (special — positional name param), `IconText`, `PaginationBar`, `AccordionHeader`.

**Phase 5 — Stateful components.** `ComboBox`, `List`, `MultiSelectList`, `Table`, `Tree`, `ColorPicker`, `AutoCompleteField`, `NumberSpinner`. These have richer internal state — sub-agent briefing must emphasise: **only migrate option-backed fields to the bag; leave internal state (selection caches, virtual-scroller indices, etc.) as private fields.** A pre-migration audit step per class identifies which fields are option-backed.

**Phase 6 — Sweep.** **One sub-agent.** Audit remaining `this.constructor === X` leaf gates across `src/typescript/lib`, remove them. Ensure every `applyOptions` override is a pure side-effect dispatcher. Audit `callable()` wrapper, `Aria` helpers, and any code path that introspects component state. Run the full demo end-to-end.

Each phase is independently shippable. Phase 1+2 alone resolves the regression and gives the clean Panel hierarchy.

### Sub-agent briefing template

For consistency across the per-class sub-agents in Phases 3-5, each invocation should pass:

1. **The pattern** — point at the merged Phase 1+2 commits (Component.ts + Panel.ts) as the canonical reference. Quote the `_options` field declaration, the bag-mutating setter shape, the bag-reading getter shape, the `applyOptions` override shape.
2. **The target** — single class file, expected field migrations (audit list of option-backed fields), expected getter/setter rewrites, expected applyOptions override shape.
3. **What stays** — explicit list of fields that are NOT option-backed (e.g. Glyph's `_name`, `_def`; ComboBox's selection state) and must remain as private fields.
4. **Verification** — which demo tab to load, what to visually confirm, what `git grep` should report (zero remaining leaf gates in this class).
5. **Output expectations** — single class migration only. Don't touch unrelated classes. Don't touch barrel exports unless adding the generic-parameter type alias.

### What stays as fields (not migrated to bag)

- Structural references: `_parent`, `components`, `attributes` map
- Render-related caches: `cssRule`, `dirtyStyle`, `dirtyCSSRule`
- Lifecycle flags: `autoCommitStyle`, `layoutPaused`, `_aria`
- Positional constructor params: `_name` and `_def` in Glyph; equivalents in classes that take more than `options`
- Constants without an options counterpart: `boxSizing`, `display`, `whiteSpace`, `userSelect`, `verticalAlign`

A field is migrated **only if it has a corresponding `XOptions` field**.

### Type narrowing

The generic parameter `Component<TOptions extends ComponentOptions = ComponentOptions>` makes `this._options` strongly typed inside each class. External references to `Component` resolve to `Component<ComponentOptions>` via the default — no signature change for callers. The 144 in-tree references already use `Component` bare; they keep working as-is. Specialized utilities (`callable()`, layout-manager parent typing) get re-checked once during Phase 1.

## Critical files (Phase 1 + Phase 2 — this plan executes through Phase 6)

- [src/typescript/lib/core/Component.ts](src/typescript/lib/core/Component.ts) — full restructure: add `<TOptions extends ComponentOptions = ComponentOptions>` generic parameter, introduce `protected _options!: TOptions` initialized in the constructor body, migrate the ~28 option-backed private fields to bag-reads, rewrite their setters to mutate the bag, remove the leaf gate, simplify the `applyOptions` walk.
- [src/typescript/lib/core/Panel.ts](src/typescript/lib/core/Panel.ts) — extends `Component<PanelOptions>`, removes its leaf gate, moves the `setInsets` default to a conditional after-super check (`if (this._options.insets === undefined) this.setInsets(new Insets(4,4,4,4))`).
- [src/typescript/ComplexUIPanel.ts](src/typescript/ComplexUIPanel.ts) — unchanged; remains the canonical demonstration of `super({ layoutManager: ... })`.
- Phase 3–5 target files: every class file under `src/typescript/lib/component/**` plus `src/typescript/lib/layout/**` that has option-backed private fields. Each is migrated by a dedicated sub-agent.
- [docs/recipes/component-options.md](docs/recipes/component-options.md) — revise the "Forwarding options from a subclass" section; the new pattern works from arbitrary depth, no asymmetry.
- [plans/implemented/support-super-options-from-subclasses.md](plans/implemented/support-super-options-from-subclasses.md) — append a note that the bag refactor supersedes the leaf-gate model.

## Verification

1. `npm run typecheck` — should be clean for `src/`; existing pre-existing Vite/`@types/node` and ComplexUIPanel `Button("…")` errors persist (unrelated).
2. `npm run build` and `npm run build:lib` — both pass.
3. `npm run docs:build` — 0 errors, 0 link warnings.
4. `npm run dev` — load every demo tab. Confirm: Complex tab renders all 7 sub-panels (the canonical regression case); Binding tab still binds models; Border, Layout, and Theme tabs all render unchanged.
5. Spot-check single-apply: instrument `Component.prototype.setLayoutManager` with a counter on `Panel({ layoutManager: HBox() })`. Confirm count === 1.
6. Spot-check getter/setter correctness: `const p = Panel({ border: ... }); p.getBorder()` returns the border; `p.setBorder(other); p.getBorder()` returns `other`. Same for all migrated fields.
7. `git grep "this.constructor === " src/typescript/lib/core` — confirm Component and Panel no longer carry leaf gates after Phase 1.
8. Add a focused test: subclass Component with `super({ border, layoutManager, padding, components: [...] })` and assert all four take effect. Subclass Panel with `super({ layoutManager })`, do the same.

## Commits (per phase, in order, per project workflow)

Each phase produces its own code → docs → graphify trio. Inside a phase, each class migration may be its own commit if the phase has multiple classes (recommended for reviewability).

**Phase 1+2 commits** (executed by the first sub-agent):
1. **Code (Component)** — generic parameter, `_options` introduction, field-to-bag migration, leaf gate removal, applyOptions rewrite.
2. **Code (Panel)** — generic parameter, leaf gate removal, conditional `setInsets` default after super().
3. **Documentation** — recipe revision in `docs/recipes/component-options.md`, follow-up note appended to `plans/implemented/support-super-options-from-subclasses.md`.
4. **Graphify** — `graphify update . --directed`.

**Phases 3-5 commits** (one sub-agent per class or close-knit pair):
- One **Code** commit per class migrated.
- A shared **Documentation** commit per phase if docs change (most class migrations don't change docs since the recipe was generalised in Phase 1+2).
- One **Graphify** commit at the end of each phase.

**Phase 6 commits**:
1. **Code (sweep)** — remove residual `this.constructor === X` gates, simplify applyOptions overrides, audit-driven fixes.
2. **Documentation** — final docs pass.
3. **Graphify** — final update.

**Plan file movement.** Once Phase 6 completes successfully, move this plan to `plans/implemented/options-bag-state-refactor.md` as part of the Phase 6 docs commit.

## Outcome

The refactor landed across **43 commits** on `feature/options-bag-state`.

- **Phases 1+2 — Component + Panel.** Component grew a `_options` bag (caller/setter state, starts empty) plus a `_defaultOptions` bag (class-level fallback consulted by getters). The constructor seeds defaults, then dispatches the caller's options once through virtual `applyOptions`, so subclass overrides are reached automatically without each leaf reinstating a `this.constructor === Foo` gate. Panel followed the same shape and kept only a conditional `setInsets` default. The `TOptions` generic was introduced so subclass methods can narrow `this._options` to the local options interface.
- **Phase 3 — Input hierarchy.** Migrated Input, TextInput, TextField, PasswordField, TextArea, Checkbox, RadioButton, Slider, DateField, NumberSpinner, Button, ToggleButton, TabCloseButton, SpinButton. Button/NumberSpinner established the children-build pattern: `super({ tag })`, build children, optional conditional defaults, then `if (options) this.applyOptions(options)` at the constructor tail.
- **Phase 4 — Display hierarchy.** Migrated Text, Label, Header, Legend, Glyph, IconText, PaginationBar, AccordionHeader. Glyph is the canonical "positional ctor arg stays private" case — its `_name` field is not option-backed.
- **Phase 5 — Stateful components.** Migrated AutoCompleteField, ComboBox, List, MultiSelectList, Table, Tree. ComboBox split `store/displayField/valueField` into a paired setter, and AutoCompleteField introduced the partial-config bag-write fallback for store/displayField pairs.
- **Phase 6 — Final sweep.** Removed the last three residual leaf gates (IconLabel, MenuBarButton, Window — none had subclasses, so the gate was dead defense), tightened Column/Row's applyOptions to route the `gap` field through `setGap` instead of writing the private field directly, migrated AutoCompleteDropdown's last surviving option-backed private (`maxItems`) to `_options.maxItems` with a real `setMaxItems` setter, and updated Callable.ts's JSDoc to drop the now-obsolete reference to leaf-only `this.constructor === Foo` checks.

**Mid-flight design adjustment.** The `_defaultOptions` bag was not in the original plan — it was introduced after the Phase 3 sub-agent flagged that Component's pre-seeded `_options` defaults silently disabled subclass `if (this._options.X === undefined)` guards. Splitting defaults into a dedicated bag preserved the "caller didn't supply X" semantics that subclass constructors rely on for conditional defaults.

**Architecture-level outcomes.**

- Zero `this.constructor === X` leaf gates remain anywhere in `src/typescript/lib`.
- Every `applyOptions` override is now a pure dispatcher: `super.applyOptions(options)` then `if (options.X !== undefined) this.setX(options.X)` lines, no direct bag writes outside of a deliberately documented store/displayField fallback in AutoCompleteField.
- Neither `Callable.ts` nor `Aria.ts` introspects the option bags.
- Subclasses can extend either bag in their own constructors (after `super()`) and still get cascade dispatch — no per-class leaf-gate boilerplate required.
