# `applyOptions` Lifecycle Cleanups — Implementation Plan

## Overview

Two `applyOptions`-lifecycle cleanups bundled together because they share an investigation surface (every `Component`-subclass constructor that touches an options bag) and converge on the same architectural answer.

**Cleanup A — Popover applyPopoverOptions.** [`Popover`](../src/typescript/lib/core/Popover.ts) is the lone class that still spells its options-dispatch helper as `applyPopoverOptions` and invokes it from the constructor tail rather than overriding `applyOptions` like every other Component subclass. Convert it to the standard `protected applyOptions(options): this` override and let the existing `Component`-constructor cascade dispatch it.

**Cleanup B — Trailing `if (options) { this.applyOptions(options); }`.** The brief asserted ~10 leaf classes still have this redundant call. Investigation showed the call is **not** redundant in any of them as the code stands today — none of the candidate leaf classes forward the consumer `options` to `super(...)`, so the trailing call is the only path that delivers the consumer's options to `applyOptions`. The real follow-up is therefore to migrate each leaf to the modern `super(options, { ..._defaultX, ... })` pattern that [`Panel`](../src/typescript/lib/core/Panel.ts) and [`AnimatedDropdown`](../src/typescript/lib/core/AnimatedDropdown.ts) already use; then — and only then — the trailing call becomes the actual no-op the brief described. This plan enumerates the candidates, classifies each, and stages the conversion class-by-class.

Together these align the entire `Component` hierarchy on one constructor-time dispatch idiom: defaults live in a module-level `Partial<TOptions>` const, the constructor forwards `(options, defaults)` to `super(...)`, `Component`'s cascade virtually dispatches into the leaf's `applyOptions` override, and the constructor body holds only structural / child-construction work.

---

## Architecture Decisions

### Cleanup A — Popover adopts the standard `applyOptions` override

[`Popover.constructor`](../src/typescript/lib/core/Popover.ts#L147-L224) currently spreads the caller options into the `super({ insets: ..., ...(options ?? {}) })` call so the inherited Component / Panel cascade sees them, then runs a private `applyPopoverOptions(options)` at the constructor tail to dispatch its four Popover-specific fields (`placement`, `dismissOn`, `showArrow`, `title`). The private helper is functionally equivalent to a leaf `applyOptions` override; only the name and the explicit tail call are non-standard.

The fix is a rename plus a one-line surgery:

1. Hoist Popover's defaults (`insets: new Insets(5, 5, 5, 5)`) into a module-level `_defaultPopoverOptions: Partial<PopoverOptions>` const so they ride the cascade rather than mutating the constructor argument.
2. Forward `options` to `super(...)` via Panel's `(options, subclassDefaults)` shape: `super(options as PopoverOptions, _defaultPopoverOptions);`.
3. Rename `applyPopoverOptions(options)` → `protected applyOptions(options): this`, prefix it with `super.applyOptions(options)`, and read each field off the merged `opts` (`{...this._defaultOptions, ...options}`) for parity with the rest of the framework.
4. Delete the `if (options) { this.applyPopoverOptions(options); }` tail.

`applyPopoverOptions` is **private** and the grep `applyPopoverOptions` returns exactly two hits — its declaration and its self-call inside [Popover.ts:222](../src/typescript/lib/core/Popover.ts#L222). No external migration is required. The rename keeps the same behaviour for every option-field-bearing constructor invocation since `Component`'s cascade calls `this.applyOptions(options ?? {})` virtually, hitting the new Popover override exactly as the old direct call hit `applyPopoverOptions`.

The constructor body's handler closures (`_onViewportMouseDown`, `_onFocusOut`, `_onWindowResize`, `_onScroll`) and the chrome setup (background color, border, padding, position, z-index, contain, overflow, aria role) stay in the constructor body — they are not option-backed today and the cleanup is intentionally surgical.

### Cleanup B — the "redundant" call is only redundant if super carries options

The premise from the brief is that `if (options) { this.applyOptions(options); }` is redundant because "defaults survive the re-merge". Investigation showed the calls described are **all** in classes whose `super(...)` call does **not** forward `options`. In every case the super call carries only positional/structural data — `super()`, `super({ tag: "li" })`, `super("ol", NumberedListItemStyle.DECIMAL)`, `super(text)`, `super({ tag: "div" })`. The Component constructor at [Component.ts:312](../src/typescript/lib/core/Component.ts#L312) then runs `this.applyOptions(options ?? {})` — but the `options` it sees is the super-time bag, not the caller's bag.

That means the trailing `applyOptions(options)` is currently the **only** site that delivers the consumer's options to the dispatcher; removing the line without also changing `super(...)` would silently drop every consumer option. The brief's premise holds only after each class is converted to the modern `super(options, { ..._defaultX })` shape used by Panel / AnimatedDropdown / Button.

The clean migration shape is therefore:

```typescript
// Before
class Foo extends Component {
    constructor(options?: FooOptions) {
        super();
        // ...structural work...
        if (options) { this.applyOptions(options); }
    }

    protected applyOptions(options: FooOptions): this {
        super.applyOptions(options);
        // ...dispatch own fields...
        return this;
    }
}

// After
const _defaultFooOptions: Partial<FooOptions> = { /* ... */ };

class Foo extends Component<FooOptions> {
    constructor(options?: FooOptions) {
        super(options, _defaultFooOptions);
        // ...structural work that doesn't depend on options...
    }

    protected applyOptions(options: FooOptions): this {
        super.applyOptions(options);
        const opts = { ...this._defaultOptions, ...options };
        // ...dispatch own fields from opts...
        return this;
    }
}
```

The classes whose constructor builds inner children **before** the options should apply (e.g. [`AutoCompleteField`](../src/typescript/lib/component/input/AutoCompleteField.ts#L85-L130), [`ProgressBar`](../src/typescript/lib/component/display/ProgressBar.ts#L46-L77), [`PaginationBar`](../src/typescript/lib/component/display/PaginationBar.ts#L73-L122), [`MenuItem`](../src/typescript/lib/component/container/MenuItem.ts#L134-L266), [`ToggleButton`](../src/typescript/lib/component/button/ToggleButton.ts#L36-L53)) **cannot** safely forward `options` to `super(...)` — the cascade would dispatch their option-backed setters before the children exist, which is the exact failure mode flagged in saved-memory `setter-defer-dom-work` (every "setter dispatched via applyOptions must not call `getElement(true)` … subclass-specific state is only assigned in the constructor BODY"). These classes must keep the trailing call; the cleanup is bounded to classes whose `applyOptions` override only touches the component's own surface (Component setters and own private state).

### `class-field` super-cascade and setter-defer-DOM-work invariants

Both saved memories cited in the brief apply to the migration:

- **`class-field-super-cascade-trap`** ([feedback memory](../../.claude/projects/-home-jika-typescript-typescript/memory/feedback_class_field_super_trap.md), summarised at [Panel.ts:75-81](../src/typescript/lib/core/Panel.ts#L75-L81)): any subclass field written by a setter that is now dispatched during `super(...)` (because options newly cascade) must be declared with `declare` rather than an initializer or `!`. Audit each migrated class for backing fields that are written by an option-backed setter.
- **`setter-defer-dom-work`**: any setter whose body reaches `getElement(true)` or otherwise materialises the DOM is unsafe during the super cascade. The setters dispatched here today (the four Popover fields, the various leaf component fields) are all pure state writes or class-list toggles that guard their DOM access with `getElement()` (no force), so this invariant holds; verify per-class during migration.

Classes that exhibit the children-built-before-options-applied pattern (the list above) **must be left alone** in this plan; converting them is a separate design call that intersects with `lazy-panel-construction.md` ordering.

### Surgical scope — no setter signature changes, no new `XOptions` fields

The cleanup is mechanical: rename one method (Cleanup A), and where viable, move defaults into a module const and reshape the super call (Cleanup B). No setter behaviour changes, no new option fields, no new public API. If a migration step reveals a class that genuinely needs a defaults reshape (e.g. `Popover`'s `insets` default), the reshape lands inside that class's commit and stays minimal.

---

## Cleanup B — Per-Class Findings

Every hit from `grep -rnP 'this\.applyOptions\(options\)' src/typescript/lib/` listed, classified, and verified. Twenty-nine hits across twenty-eight files; six are LayoutManager subclasses (not in scope — see below); two are inside MenuItem's separator/non-separator branches (one logical class, counted once). The trailing-constructor candidate count is twenty-three, of which **ten** are migratable in this plan and the rest are flagged for follow-up.

### Out of scope — LayoutManager subclasses

`LayoutManager`'s constructor ([LayoutManager.ts:43-45](../src/typescript/lib/layout/LayoutManager.ts#L43-L45)) does not route `options` through `applyOptions` — it takes no `options` parameter at all. Every LayoutManager subclass therefore needs the trailing `if (options) { this.applyOptions(options); }` to dispatch consumer options at all. Removing the call would silently drop every consumer-supplied layout option. **These stay as-is.**

| File | Line | Why kept |
|---|---|---|
| [layout/Absolute.ts:28](../src/typescript/lib/layout/Absolute.ts#L28) | 28 | LayoutManager subclass — only call site |
| [layout/Accordion.ts:100](../src/typescript/lib/layout/Accordion.ts#L100) | 100 | LayoutManager subclass |
| [layout/Border.ts:47](../src/typescript/lib/layout/Border.ts#L47) | 47 | LayoutManager subclass |
| [layout/Card.ts:34](../src/typescript/lib/layout/Card.ts#L34) | 34 | LayoutManager subclass |
| [layout/Fit.ts:36](../src/typescript/lib/layout/Fit.ts#L36) | 36 | LayoutManager subclass |
| [layout/Grid.ts:38](../src/typescript/lib/layout/Grid.ts#L38) | 38 | LayoutManager subclass |
| [layout/HBox.ts:58](../src/typescript/lib/layout/HBox.ts#L58) | 58 | LayoutManager subclass |
| [layout/Split.ts:41](../src/typescript/lib/layout/Split.ts#L41) | 41 | LayoutManager subclass |
| [layout/Tab.ts:110](../src/typescript/lib/layout/Tab.ts#L110) | 110 | LayoutManager subclass |
| [layout/Table.ts:49](../src/typescript/lib/layout/Table.ts#L49) | 49 | LayoutManager subclass |
| [layout/VBox.ts:45](../src/typescript/lib/layout/VBox.ts#L45) | 45 | LayoutManager subclass |

(Refitting LayoutManager itself to accept and cascade `options` would be a separate plan — it touches every subclass and changes a fundamental shape of the layout system.)

### Out of scope — children-before-options classes

These classes build inner Components in the constructor body **before** options need to apply. Forwarding `options` to `super(...)` would dispatch their option-backed setters during the super cascade — before `this._textField`, `this._titleText`, `this._fill`, etc. exist. The trailing call is currently the correct shape; reshaping any of them is a per-class redesign that touches `setter-defer-dom-work`-style ordering and falls outside an `applyOptions`-cleanup pass.

| File | Line | Inner children built before options apply |
|---|---|---|
| [component/input/AutoCompleteField.ts:120](../src/typescript/lib/component/input/AutoCompleteField.ts#L120) | 120 | `_textField`, `_dropdown` constructed at [L90-L100](../src/typescript/lib/component/input/AutoCompleteField.ts#L90-L100); options reference text-field state |
| [component/input/AutoCompleteItem.ts:75](../src/typescript/lib/component/input/AutoCompleteItem.ts#L75) | 75 | Children + listener registration precede options dispatch |
| [component/button/ToggleButton.ts:51](../src/typescript/lib/component/button/ToggleButton.ts#L51) | 51 | Comment at [L37-L42](../src/typescript/lib/component/button/ToggleButton.ts#L37-L42) explicitly documents the constraint: Button is a children-build class, options must apply after children exist |
| [component/container/WindowHeader.ts:107](../src/typescript/lib/component/container/WindowHeader.ts#L107) | 107 | Inner `Text` / close button built before options apply |
| [component/container/MenuItem.ts:164](../src/typescript/lib/component/container/MenuItem.ts#L164), [:264](../src/typescript/lib/component/container/MenuItem.ts#L264) | 164 / 264 | One logical class. The two hits are the separator-early-return branch and the leaf branch; both rely on `_titleText` / `_iconGlyph` etc. existing before applyOptions reaches `setText` |
| [component/display/PaginationBar.ts:120](../src/typescript/lib/component/display/PaginationBar.ts#L120) | 120 | Page buttons + label built in constructor body before options apply |
| [component/display/ProgressBar.ts:75](../src/typescript/lib/component/display/ProgressBar.ts#L75) | 75 | `_track` / `_fill` children + indeterminate animation set up before options apply |
| [component/display/ProgressSpinner.ts:115](../src/typescript/lib/component/display/ProgressSpinner.ts#L115) | 115 | Same children-first ordering |

### In scope — leaf classes whose `applyOptions` touches only own state

These classes either (a) own no inner children, or (b) build inner children that the `applyOptions` override does not touch. They are safe to convert to the `super(options, _defaultX)` shape; the trailing call then becomes the genuine no-op the brief described and can be deleted.

| File | Line | Current super | Conversion notes |
|---|---|---|---|
| [core/Popover.ts:222](../src/typescript/lib/core/Popover.ts#L222) | 222 | `super({ insets: ..., ...options })` | Cleanup A — handled in its own section. |
| [component/display/Image.ts:41](../src/typescript/lib/component/display/Image.ts#L41) | 41 | `super({ tag: "img" })` | Add `_defaultImageOptions: Partial<ImageOptions> = { tag: "img" }`; super call becomes `super(options, _defaultImageOptions)`. `this.clearInsets()` stays in the body (no option counterpart). `_src` assignment stays in the body. |
| [component/container/MenuSeparator.ts:46](../src/typescript/lib/component/container/MenuSeparator.ts#L46) | 46 | `super()` | Body sets height, preferred size, background, border, margin, aria role from the `cssVarPrefix` positional. The CSS-rule writes are queued in the buffered style channel and stay in the body (they're not option-backed). Add an empty `_defaultMenuSeparatorOptions: Partial<MenuSeparatorOptions> = {}` so the super shape matches the framework; or pass `(options, {} as Partial<MenuSeparatorOptions>)` — both equivalent. `MenuSeparator` has no `applyOptions` override today (no Separator-specific fields), so the existing `super.applyOptions` chain in Component will dispatch any inherited `ComponentOptions` fields the caller passes. The trailing call vanishes; the body shrinks. |
| [component/container/SplitGutter.ts:43](../src/typescript/lib/component/container/SplitGutter.ts#L43) | 43 | `super()` | Body sets direction-driven background colour and cursor before options apply. The `applyOptions` override at [L53-L67](../src/typescript/lib/component/container/SplitGutter.ts#L53) only dispatches Component-inherited fields (no SplitGutter-specific options yet — `SplitGutterOptions` extends `ComponentOptions` with no added fields per [L11-L13](../src/typescript/lib/component/container/SplitGutter.ts#L11-L13)). Migration: introduce empty `_defaultSplitGutterOptions`, forward options. Direction-driven setters stay in the body. |
| [component/container/DialogBackdrop.ts:39](../src/typescript/lib/component/container/DialogBackdrop.ts#L39) | 39 | `super()` | Body sets fixed positioning + background + z-index. Migrate identically — empty defaults, forward options. |
| [component/container/WindowBorder.ts:88](../src/typescript/lib/component/container/WindowBorder.ts#L88) | 88 | `super({ tag: "div" })` | Body wires drag listeners and the snap-target style rule. `applyOptions` override is absent (no WindowBorder-specific fields). Migrate: `_defaultWindowBorderOptions: Partial<WindowBorderOptions> = { tag: "div" }`, forward options. Direction enum + listener wiring stays in the body. |
| [component/menubar/ToolBarSeparator.ts:87](../src/typescript/lib/component/menubar/ToolBarSeparator.ts#L87) | 87 | `super()` | Body sets the vertical-rule visual via direct `setElement*` writes. Migrate as for MenuSeparator. |
| [component/list/ListItem.ts:35](../src/typescript/lib/component/list/ListItem.ts#L35) | 35 | `super({ tag: "li" })` | `applyOptions` dispatches only `text` (renders via `element.textContent`). The text setter reads `this._value` and writes to the DOM via `getElement()` (no force) at [L52-L56](../src/typescript/lib/component/list/ListItem.ts#L52-L56), so it's safe to dispatch during the super cascade. Migrate: `_defaultListItemOptions: Partial<ListItemOptions> = { tag: "li" }`, forward options. `_key` and `_value` assignment stays in the body and runs **before** `super(...)` returns — but the cascade-dispatched `setText` writes `_value` only when `text` is in the bag, so the constructor's `_value = value` assignment must move ahead of `super(...)`, which TypeScript forbids. **Resolution:** assign `_key` / `_value` from the positional args before delegating; route the positional `value` argument into the defaults bag as `{ tag: "li", text: value }` so the cascade's `setText` covers both the positional and option paths. Equivalent end state; one fewer dual-source field. Verify by inspecting both call sites of `new ListItem(...)` after migration. |
| [component/list/BulletedList.ts:28](../src/typescript/lib/component/list/BulletedList.ts#L28) | 28 | `super("ul", BulletedListItemStyle.DISC)` | `AbstractListComponent` accepts `(tag, style)` and has no `options` parameter today, so the super call cannot forward options without first widening `AbstractListComponent`'s signature to `(tag, style, options?, subclassDefaults?)` and reshaping its body to delegate to `Component(options, subclassDefaults)`. That widening is the cleaner conversion; both BulletedList and NumberedList collapse to `super(options, { tag: "ul" })` (with style baked into a separate field-init or moved into `AbstractListOptions`). Migration is one-and-half files — feasible but the rewrite spans AbstractListComponent and both leaves. Flagged here; ride-along with this plan if the widening is in scope, otherwise spin out. |
| [component/list/NumberedList.ts:28](../src/typescript/lib/component/list/NumberedList.ts#L28) | 28 | `super("ol", NumberedListItemStyle.DECIMAL)` | Same shape as BulletedList — paired migration. |

Counting the migratable set excluding Popover: eight classes (Image, MenuSeparator, SplitGutter, DialogBackdrop, WindowBorder, ToolBarSeparator, ListItem, plus the BulletedList/NumberedList pair via AbstractListComponent reshaping). Including Popover, nine. Close to the "roughly 10" in the brief.

---

## Public API (TypeScript Signatures)

No public API changes. Every method that becomes `applyOptions` is `protected`; the rename in Popover is from a `private applyPopoverOptions(...)` to a `protected applyOptions(...)` override (still not part of the public surface). No new exports, no new options fields, no setter signature changes.

---

## Ordered Implementation Steps

### Cleanup A — Popover

1. **Add the defaults const.** In [src/typescript/lib/core/Popover.ts](../src/typescript/lib/core/Popover.ts), after the `POPOVER_FADE_DURATION_MS` constant (around line 44), add:

   ```typescript
   /**
    * User-overridable visual defaults forwarded to `super` via the options
    * bag. The cascade in `Component`'s constructor dispatches each present
    * setter once with the final value, so any field the caller supplied wins.
    */
   const _defaultPopoverOptions: Partial<PopoverOptions> = {
       insets: new Insets(5, 5, 5, 5),
   };
   ```

2. **Reshape the super call.** Replace [Popover.ts:148-151](../src/typescript/lib/core/Popover.ts#L148-L151):

   ```typescript
   super({
       insets: new Insets(5, 5, 5, 5),
       ...(options ?? {}),
   } as PopoverOptions);
   ```

   with:

   ```typescript
   super(options as PopoverOptions, _defaultPopoverOptions);
   ```

3. **Rename `applyPopoverOptions` to `applyOptions`.** Change the signature at [Popover.ts:233](../src/typescript/lib/core/Popover.ts#L233) from `private applyPopoverOptions(options: PopoverOptions): this` to `protected applyOptions(options: PopoverOptions): this`, prefix the body with `super.applyOptions(options);`, and switch the field reads to consume the merged `opts`:

   ```typescript
   protected applyOptions(options: PopoverOptions): this {
       super.applyOptions(options);

       const opts = { ...this._defaultOptions, ...options } as PopoverOptions;

       if (opts.placement !== undefined) this.setPlacement(opts.placement);
       if (opts.dismissOn !== undefined) this.setDismissOn(opts.dismissOn);
       if (opts.showArrow !== undefined) this.setShowArrow(opts.showArrow);
       if (opts.title     !== undefined) this.setTitle(opts.title);

       return this;
   }
   ```

4. **Remove the trailing call.** Delete the `if (options) { this.applyPopoverOptions(options); }` block at [Popover.ts:221-223](../src/typescript/lib/core/Popover.ts#L221-L223). The handler-closure assignments (`_onViewportMouseDown`, `_onFocusOut`, `_onWindowResize`, `_onScroll`) that precede it stay in the constructor body.

5. **Verify private-API references.** Run `grep -rn 'applyPopoverOptions' src/typescript` — expect zero matches. The original grep returned exactly two hits (declaration + self-call); both are removed by the rename.

6. **Typecheck.** `npm run typecheck` — should be clean. The body shrinks, the `applyOptions` override picks up the same four field dispatches, and the cascade-driven dispatch matches the previous explicit call.

### Cleanup B — Per-class migrations

Each class is independent — land in any order. Each step is small enough for a single commit.

7. **`Image`** ([component/display/Image.ts](../src/typescript/lib/component/display/Image.ts)). Add `_defaultImageOptions: Partial<ImageOptions> = { tag: "img" }`. Change `super({ tag: "img" })` → `super(options, _defaultImageOptions)`. `this.clearInsets()` and `_src` assignment stay in the body. Delete the trailing `if (options) { this.applyOptions(options); }`. `Image` has no `applyOptions` override today (the empty `ImageOptions` carries no Image-specific fields), so the cascade flows through Component's override only.

8. **`MenuSeparator`** ([component/container/MenuSeparator.ts](../src/typescript/lib/component/container/MenuSeparator.ts)). Add an empty `_defaultMenuSeparatorOptions: Partial<MenuSeparatorOptions> = {}`. Change `super()` → `super(options, _defaultMenuSeparatorOptions)`. Body retains the `cssVarPrefix`-driven `setElementCSSRule` writes (they're CSS theme inputs, not option-backed). Delete the trailing call.

9. **`ToolBarSeparator`** ([component/menubar/ToolBarSeparator.ts](../src/typescript/lib/component/menubar/ToolBarSeparator.ts)). Same shape as MenuSeparator — empty defaults, forward options, delete the trailing call.

10. **`DialogBackdrop`** ([component/container/DialogBackdrop.ts](../src/typescript/lib/component/container/DialogBackdrop.ts)). Empty defaults, forward options, delete the trailing call. The fixed-positioning and z-index writes stay in the body.

11. **`WindowBorder`** ([component/container/WindowBorder.ts](../src/typescript/lib/component/container/WindowBorder.ts)). `_defaultWindowBorderOptions: Partial<WindowBorderOptions> = { tag: "div" }`. Forward options, delete the trailing call. The drag-listener wiring and snap-target style-rule allocation stay in the body. Verify the `_snapTargetStyleRule` declare-field and lazy getter still work under the new ordering — both are guarded against undefined access, so this is a typecheck spot-check, not a refactor.

12. **`SplitGutter`** ([component/container/SplitGutter.ts](../src/typescript/lib/component/container/SplitGutter.ts)). Empty defaults, forward options, delete the trailing call. The `direction`-positional-driven body writes stay.

13. **`ListItem`** ([component/list/ListItem.ts](../src/typescript/lib/component/list/ListItem.ts)). Add `_defaultListItemOptions: Partial<ListItemOptions> = { tag: "li" }`. The constructor takes `(key, value, options?)` positionals; refactor to inject `value` as the bag's `text` default per the migration note in the table:

    ```typescript
    constructor(key: string, value: string, options?: ListItemOptions) {
        super(options, { ..._defaultListItemOptions, text: value });
        this._key   = key;
        this._value = value;
    }
    ```

    The body assignment of `_value` survives so subsequent setter calls operate on a known field value; the cascade-driven `setText` will overwrite it via the override at [L50-L56](../src/typescript/lib/component/list/ListItem.ts#L50-L56). Delete the trailing call. Run `grep -rn 'new ListItem(' src/typescript` to confirm both existing call sites still compile (the positional signature is unchanged).

14. **`AbstractListComponent` widening + `BulletedList` / `NumberedList`** ([component/list/AbstractListComponent.ts](../src/typescript/lib/component/list/AbstractListComponent.ts), [BulletedList.ts](../src/typescript/lib/component/list/BulletedList.ts), [NumberedList.ts](../src/typescript/lib/component/list/NumberedList.ts)). Widen `AbstractListComponent`'s constructor from `(tag, style)` to `(tag, style, options?, subclassDefaults?)`, forward `(options, { tag, ...(subclassDefaults ?? {}) })` to `super(...)`. Move the body's `setStyle(style)` and default padding/size into the cascade-time `applyOptions` if `itemStyle` is in the merged bag; otherwise dispatch from the constructor body once after super returns. Then in `BulletedList`/`NumberedList`, switch `super("ul", DISC)` / `super("ol", DECIMAL)` to `super("ul", DISC, options)` / `super("ol", DECIMAL, options)` and delete the trailing calls. Verify with a focused smoke test that bullet/numbering still appears.

15. **Regression checkpoint.** `grep -rnP 'if \(options\) \{ this\.applyOptions\(options\); \}' src/typescript/lib/` — expect a much-reduced count: the LayoutManager subclasses (11) plus the children-built-first classes (~7) only. The eight or nine classes touched here are gone.

16. **Typecheck after each step.** `npm run typecheck` clean after every commit; never batch multiple class migrations into one commit (per the project's "one functionality per code commit" convention).

---

## Files to Modify

| Action | File | Cleanup |
|---|---|---|
| Modify | [src/typescript/lib/core/Popover.ts](../src/typescript/lib/core/Popover.ts) | A |
| Modify | [src/typescript/lib/component/display/Image.ts](../src/typescript/lib/component/display/Image.ts) | B |
| Modify | [src/typescript/lib/component/container/MenuSeparator.ts](../src/typescript/lib/component/container/MenuSeparator.ts) | B |
| Modify | [src/typescript/lib/component/menubar/ToolBarSeparator.ts](../src/typescript/lib/component/menubar/ToolBarSeparator.ts) | B |
| Modify | [src/typescript/lib/component/container/DialogBackdrop.ts](../src/typescript/lib/component/container/DialogBackdrop.ts) | B |
| Modify | [src/typescript/lib/component/container/WindowBorder.ts](../src/typescript/lib/component/container/WindowBorder.ts) | B |
| Modify | [src/typescript/lib/component/container/SplitGutter.ts](../src/typescript/lib/component/container/SplitGutter.ts) | B |
| Modify | [src/typescript/lib/component/list/ListItem.ts](../src/typescript/lib/component/list/ListItem.ts) | B |
| Modify | [src/typescript/lib/component/list/AbstractListComponent.ts](../src/typescript/lib/component/list/AbstractListComponent.ts) | B |
| Modify | [src/typescript/lib/component/list/BulletedList.ts](../src/typescript/lib/component/list/BulletedList.ts) | B |
| Modify | [src/typescript/lib/component/list/NumberedList.ts](../src/typescript/lib/component/list/NumberedList.ts) | B |

---

## Verification

1. **Typecheck.** `npm run typecheck` clean at every step and at the end.

2. **`applyPopoverOptions` is gone.** `grep -rn 'applyPopoverOptions' src/typescript` returns zero matches after Cleanup A.

3. **Trailing-call count drops.** Before: `grep -rnP 'this\.applyOptions\(options\)' src/typescript/lib/ | wc -l` returns 29. After: roughly 20 (LayoutManager subclasses + children-first classes still keep the call; the migratable set is gone). Compare counts to confirm the expected delta.

4. **Behavioural smoke tests.** `npm run dev`, then exercise the affected demos:
   - **Popover** — the `Window` panel includes a popover demo; open it, verify placement / dismissOn / showArrow / title options still drive the rendered popover (passing each as a constructor option). Verify auto-flip still works when explicit placement would overflow the viewport.
   - **Image** — `MiscPanel` (or any panel with an `<img>` demo) renders with the same insets-cleared layout it had before; pass a `borderRadius` option and confirm it applies.
   - **MenuSeparator / ToolBarSeparator** — open the menu-bar demo and a toolbar demo; separators render with the same divider line and theme tint.
   - **DialogBackdrop** — open any modal dialog; backdrop still covers the viewport with the correct z-index.
   - **WindowBorder** — drag a `Window` edge / corner; resize cursors and snap-target highlight still work.
   - **SplitGutter** — open a `Split`-layout demo; gutter still drags correctly with the cursor and background colour matching `direction`.
   - **ListItem / BulletedList / NumberedList** — open the list demo (BulletedList and NumberedList both feature in `MiscPanel`); bullets / numbers render, items still display their `value` / `text`, `selectedIndex` option still picks the initial selection.

5. **Theme toggle.** Toggle the theme on every affected demo screen; theme-driven CSS variables in each touched component still respond.

6. **`npm run docs:build`** — 0 errors and 0 link warnings (typedoc's unsupported-TS-version notice is the only acceptable warning). The signature changes don't touch the public surface, so the documentation diff should be empty apart from the Popover JSDoc rename.

---

## Potential Challenges

- **Popover's `setTitle` reaches `insertComponent`.** [Popover.setTitle](../src/typescript/lib/core/Popover.ts#L328-L345) lazily allocates a `Text` child and inserts it. If the cascade dispatches `setTitle` during `super(...)` (before the constructor body runs), the popover hasn't installed its `VBox` layout manager yet ([L153-L156](../src/typescript/lib/core/Popover.ts#L153-L156)). Mitigation: move the `VBox` layout-manager allocation **before** the chrome setup in the constructor body, or include `layoutManager` in `_defaultPopoverOptions` so the cascade-dispatched `setLayoutManager` runs before `setTitle`. Either resolves the ordering. Test by constructing `new Popover({ title: "Hi" })` after migration and checking the title row renders. (Note: `setTitle` is only reachable via `applyOptions` if a `title` option is supplied; passing no `title` keeps the migration trivial.)

- **`WindowBorder._snapTargetStyleRule`.** Declared with `declare` ([WindowBorder.ts:65](../src/typescript/lib/component/container/WindowBorder.ts#L65)) and accessed via a lazy getter at [L66-L68](../src/typescript/lib/component/container/WindowBorder.ts#L66-L68). The `snapTargetStyleRule.set(...)` write at [L85](../src/typescript/lib/component/container/WindowBorder.ts#L85) lands during the constructor body, not during the cascade. Migration doesn't change this; the lazy getter is safe regardless. No action.

- **`ListItem`'s `_value` dual-source.** The positional `value` argument and the `text` option both write to `_value`. After migration, the positional path becomes "seed the defaults bag with `text: value` and let the cascade's `setText` apply." Edge case: if a caller passes both `new ListItem("k", "v1", { text: "v2" })`, the cascade resolves to `v2` (caller-options win over defaults), which matches today's behaviour where the trailing `applyOptions` runs after the positional assignment. Smoke-test this case explicitly.

- **`AbstractListComponent` widening risk.** The two leaf classes (Bulleted, Numbered) are the only callers; widening the abstract constructor doesn't touch any application code. Still, run `grep -rn 'new AbstractListComponent\|extends AbstractListComponent' src/typescript` to confirm.

- **Removing a trailing call from a class that secretly built children before options.** The investigation flagged ToggleButton / WindowHeader / MenuItem / AutoCompleteField / PaginationBar / ProgressBar / ProgressSpinner / AutoCompleteItem as children-built-first. If the brief's "roughly 10" was meant to include any of these, the answer is "leave them — converting them is a per-class redesign". Surface this in the plan summary so reviewers can decide whether the bounded scope here matches the brief's intent.

- **Class-field super-cascade trap regressions.** For every newly-migrated class, audit private backing fields that are written by an option-backed setter. If any has a value-initialiser (e.g. `private _foo: string = "x"`), switch it to `declare` per the `class-field-super-cascade-trap` saved memory. The candidate set is small for the migrations in scope: Image (`_src` — set from positional, not from an option, stays as-is); WindowBorder (`_direction` — same); ListItem (`_key`, `_value` — `_value` is the dual-source case above); the separator classes own no option-backed private state.

---

## Critical Files

- [src/typescript/lib/core/Component.ts](../src/typescript/lib/core/Component.ts) — the canonical constructor at [L255-L313](../src/typescript/lib/core/Component.ts#L255-L313), the cascade-driving `applyOptions` at [L330-L380](../src/typescript/lib/core/Component.ts#L330-L380), and the `_options` / `_defaultOptions` initialisation pattern at [L279-L295](../src/typescript/lib/core/Component.ts#L279-L295).
- [src/typescript/lib/core/Panel.ts](../src/typescript/lib/core/Panel.ts) — the modern reference shape: `_defaultPanelOptions` const, `super(options, defaults)`, `applyOptions` override. Cleanup A mirrors this exactly.
- [src/typescript/lib/core/AnimatedDropdown.ts](../src/typescript/lib/core/AnimatedDropdown.ts) — second reference; especially [L76-L82](../src/typescript/lib/core/AnimatedDropdown.ts#L76-L82) for the defaults-const docstring style and [L123-L134](../src/typescript/lib/core/AnimatedDropdown.ts#L123-L134) for the super-forwarding shape.
- [src/typescript/lib/component/button/Button.ts](../src/typescript/lib/core/component/button/Button.ts) — the children-built-first variant; the `_options.text` / `_options.glyph` indirection at [L213-L214](../src/typescript/lib/component/button/Button.ts#L213-L214) and the late dispatch at [L186-L192](../src/typescript/lib/component/button/Button.ts#L186-L192) demonstrate why ToggleButton, MenuItem, etc. cannot drop their trailing call without also redesigning the children-build flow.
- [src/typescript/lib/core/Popover.ts](../src/typescript/lib/core/Popover.ts) — target of Cleanup A.
- [plans/implemented/component-constructor-options.md](implemented/component-constructor-options.md) — original constructor-options refactor; explains why every applyOptions override starts with `super.applyOptions(options)`.
- [plans/implemented/component-options-follow-ups.md](implemented/component-options-follow-ups.md) — render-deferred StyleRule context; explains why `WindowBorder._snapTargetStyleRule` allocation during the body is still safe after migration.
- [plans/implemented/support-super-options-from-subclasses.md](implemented/support-super-options-from-subclasses.md) — why the leaf-gate was dropped and why `applyOptions` must be idempotent; underpins the "double-apply is harmless" guarantee Cleanup B relies on.
- [plans/implemented/options-bag-state-refactor.md](implemented/options-bag-state-refactor.md) — the "defaults survive the re-merge" claim from the brief; explains why the migration is now structurally safe.

---

## Non-Goals

- **No refactor of the applyOptions lifecycle itself.** The cascade, the merge-defaults pattern, and the virtual-dispatch shape stay as-is. Cleanup A is a name change + a default move; Cleanup B is a per-class shape conversion using the existing pattern.
- **No changes to defaults handling.** Module-level `_defaultXOptions` consts already exist for Panel, Button, AnimatedDropdown; this plan introduces a few more (Popover, Image, the separator classes, WindowBorder, ListItem). No mechanism change.
- **No LayoutManager-side rework.** LayoutManager and its subclasses keep their current constructor shape; their trailing `applyOptions` calls remain. A `LayoutManagerOptions` cascade would be a separate plan.
- **No conversion of children-built-first classes.** ToggleButton, MenuItem, WindowHeader, AutoCompleteField, AutoCompleteItem, PaginationBar, ProgressBar, ProgressSpinner keep their trailing calls. Reshaping any of them requires resolving the children-build-vs-options ordering and is out of scope here.
- **No new options fields.** Every dispatched field already exists on the relevant `XOptions` interface. The cleanup is purely about how the dispatch is wired, not what gets dispatched.
- **No demo / test rewrite.** Existing call sites continue to compile and behave identically. The "ride-along" demo conversions that some prior plans encouraged are deferred.
