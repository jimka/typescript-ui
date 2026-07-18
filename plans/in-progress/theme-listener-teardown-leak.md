# Theme-Listener Teardown Leak — Implementation Plan

## Overview

`ThemeManager.themeListeners` ([core/Theme.ts:1256](src/typescript/lib/core/Theme.ts#L1256)) is a static, only-growing `Array<() => void>`. `ThemeManager.onThemeChange(listener)` ([Theme.ts:1264](src/typescript/lib/core/Theme.ts#L1264)) pushes the listener and returns a disposer that filters it out. Fifteen `Component` subclasses call `onThemeChange` and **discard** the disposer, so their theme-change closure — which captures `this` — lives forever in the static array. Because the closure retains the component, and the component retains its whole subtree (children via `_components`, parent via `_parent`, detached DOM, and per-instance `#uuid` CSS rules), an entire closed `Window`/`Table` tree can never be garbage-collected. Live heap analysis proved it: opening then closing four table windows and forcing GC twice leaves 5 `Window` / 5 `TablePanel` / 17 `Table` objects live, 3868 detached DOM nodes, and ~4978 leaked CSS rules, with the retainer path `themeListeners → listener closure → component → _parent → Window → whole tree`.

The fix is systemic, not per-class. Add a base-`Component` subscription helper that stores every disposer in a per-instance bag and flushes the bag in `Component.destructor()`, generalising the existing single-disposer `_borderThemeCleanup` field ([Component.ts:1924](src/typescript/lib/core/Component.ts#L1924), disposed at [Component.ts:631](src/typescript/lib/core/Component.ts#L631)) into an array. Then route all fifteen discarding sites through the helper.

A second change is **required** for the fix to actually reach those components: `Component.destructor()` is currently **non-recursive** and is only ever invoked on the three explicit-teardown roots (`AbstractWindow`, `Dialog`, `DialogBackdrop`). A closing window never calls its descendants' destructors, so a per-component bag flush alone would never fire for the leaking cells/headers/bodies. `Component.destructor()` must recurse into `_components` so a discarded root tears down its entire subtree. See _Architecture Decisions_.

---

## Architecture Decisions

### Base `subscribeTheme` helper + `_themeCleanups` bag flushed in `destructor()`

Add a `protected subscribeTheme(listener)` on `Component` that calls `ThemeManager.onThemeChange(listener)` and pushes the returned disposer into a per-instance `_themeCleanups: Array<() => void>`. `Component.destructor()` iterates the bag, calls each disposer, and clears it. This mirrors the framework's existing precedent exactly — `_borderThemeCleanup` is a single-disposer field disposed in `destructor()` ([Component.ts:631](src/typescript/lib/core/Component.ts#L631)) — generalised to an array so a component can hold more than one subscription. Correct sibling precedents that already store-and-dispose: [chart/AbstractChart.ts:178/1074](src/typescript/lib/component/chart/AbstractChart.ts#L178) (`_themeCleanup`), [layout/Tab.ts:314/942](src/typescript/lib/layout/Tab.ts#L314) (`_themeCleanup`).

`_themeCleanups` is a **base-`Component` field with a plain `= []` initializer**, which is safe for the same reason [`_ownedHandles`](src/typescript/lib/core/Component.ts#L287) is: base-class field initializers run before `Component`'s own constructor body dispatches `applyOptions`, so no cascade-dispatched setter (e.g. `setBorder`) can clobber it. It does **not** need `declare` — that rule applies only to *subclass* fields written during `super()`.

### Fold `_borderThemeCleanup` into the bag

Remove the `_borderThemeCleanup: (() => void) | null` field and its dedicated disposal block in `destructor()`; route border invalidation through the new bag so there is a single teardown mechanism. `setBorder` can be called repeatedly, so it must still subscribe only once — replace the `if (!this._borderThemeCleanup)` guard with a boolean `_borderThemeSubscribed`:

```typescript
if (!this._borderThemeSubscribed) {
    this._borderThemeSubscribed = true;
    this.subscribeTheme(() => this._borderWidths = null);
}
```

`_borderThemeSubscribed` is a base field written by a cascade-dispatched setter (border is a `ComponentOptions` field), identical in safety to the existing `_border` / `_borderWidths` base fields — plain `= false` initializer is correct.

### `Component.destructor()` must recurse into `_components`

**This is load-bearing and is why per-site migration alone is insufficient.** `destructor()` today removes only the component's *own* element, style rules, and handles; it never touches `_components`. It is invoked from exactly three sites — [AbstractWindow.ts:862](src/typescript/lib/overlay/AbstractWindow.ts#L862), [Dialog.ts:1091](src/typescript/lib/overlay/Dialog.ts#L1091), [DialogBackdrop.ts:74](src/typescript/lib/component/container/DialogBackdrop.ts#L74) — plus `super.destructor()` chains. `removeComponent` deliberately does **not** call `destructor` (a removed child may be re-parented by a move; see [Component.ts:243-251](src/typescript/lib/core/Component.ts#L243)). Consequently a closing window's cells, headers, renderers and body never have their destructors called, so a bag flush placed in `destructor()` would never run for them and the proven leak would persist.

The framework's design intent — stated in the eager-release comment at [Component.ts:240-251](src/typescript/lib/core/Component.ts#L240) — is that `destructor()` is the **eager** counterpart to the `FinalizationRegistry` GC path: it releases a discarded component's resources up-front instead of waiting for GC. Making it recurse completes that intent: a discarded container discards its whole subtree (the children are being *destroyed*, not *moved*). Add, at the top of `Component.destructor()`:

```typescript
for (const child of this._components) {
    child.destructor();
}
this._components = [];
```

`child.destructor()` is a legal protected access (same class), and dispatches virtually to subclass overrides (`Panel`, `StatusBar`, `Canvas`, …), each of which already calls `super.destructor()`. Move-safety is preserved: anything re-parented out of the window (torn-off tabs, moved children) is already gone from `_components` before close, so recursion only reaches genuinely-discarded descendants.

Without this recursion the offline recursion test and the live window-collection verification cannot pass.

### Test seam: `ThemeManager._themeListenerCount()`

`themeListeners` is `private static`. Add a `@internal` static method `_themeListenerCount(): number` returning `themeListeners.length`, mirroring the existing `@internal` test accessors [`_ruleCacheHas` / `_ruleCacheKeys`](src/typescript/lib/core/StyleTarget.ts#L209). `@internal` keeps it out of the TypeDoc build. Tests assert the count returns to its pre-construction baseline after teardown.

### Rejected: WeakRef / GC-native subscription

A design where `themeListeners` holds the component weakly (so GC reclaims it without any destructor call) was considered and rejected: it contradicts the established store-and-dispose-in-`destructor` precedent the whole framework uses (`_borderThemeCleanup`, `AbstractChart._themeCleanup`, `Tab._themeCleanup`), would require rewriting every subscriber closure to take `self` as a parameter, and adds a dead-entry sweep. The destructor-based approach is the framework's existing pattern; follow it.

---

## Public API

No public (consumer-visible) API changes. All new symbols are non-public:

```typescript
// core/Component.ts — protected, subclass-only
protected subscribeTheme(listener: () => void): void;

// core/Theme.ts — @internal, test-only
static _themeListenerCount(): number;
```

---

## Internal Structure

`Component` new/changed members:

```typescript
// New base field — plain initializer is safe (base field, set before applyOptions).
private readonly _themeCleanups: Array<() => void> = [];

// Replaces `_borderThemeCleanup` (removed). Guards setBorder's one-time subscription.
private _borderThemeSubscribed = false;

/**
 * Subscribes to theme changes and records the disposer so it is released on
 * teardown. Prefer this over calling ThemeManager.onThemeChange directly — a
 * discarded disposer leaks the component (its closure pins `this`).
 */
protected subscribeTheme(listener: () => void): void {
    this._themeCleanups.push(ThemeManager.onThemeChange(listener));
}
```

`Component.destructor()` shape after edits (recursion first, then bag flush, then the existing frame/element/rule/handle teardown; the old `_borderThemeCleanup` block is gone):

```typescript
protected destructor() {
    // Discard the subtree eagerly — a destroyed container destroys its children.
    for (const child of this._components) {
        child.destructor();
    }
    this._components = [];

    // Release every recorded theme subscription (includes border invalidation).
    for (const dispose of this._themeCleanups) {
        dispose();
    }
    this._themeCleanups.length = 0;

    this.clearClipFrame();
    this.clearContentFrame();
    // ... unchanged: removeElement, _styleRule.dispose, deferred rules,
    //     finalizer unregister, handle release, _element = undefined.
}
```

---

## Ordered Implementation Steps

1. **`core/Component.ts` — add the bag + helper.** Add `private readonly _themeCleanups: Array<() => void> = [];` beside `_ownedHandles`. Add the `protected subscribeTheme(listener)` method (body above). Verify: `tsc` clean.

2. **`core/Component.ts` — fold border into the bag.** Remove the field `private _borderThemeCleanup: (() => void) | null = null;` ([~L340](src/typescript/lib/core/Component.ts#L340)). Add `private _borderThemeSubscribed = false;` in its place. In `setBorder` ([~L1923](src/typescript/lib/core/Component.ts#L1923)) replace the `if (!this._borderThemeCleanup) { this._borderThemeCleanup = ThemeManager.onThemeChange(() => this._borderWidths = null); }` block with the `_borderThemeSubscribed`-guarded `this.subscribeTheme(...)` form (see _Architecture Decisions_).

3. **`core/Component.ts` — make `destructor()` recursive and flush the bag.** Remove the `if (this._borderThemeCleanup) { … }` block at [L631-634](src/typescript/lib/core/Component.ts#L631). Add the child-recursion loop and the `_themeCleanups` flush loop at the top of `destructor()` (see _Internal Structure_). Verify: `tsc` clean; run `tests/component/Component.test.ts`.

4. **`core/Theme.ts` — add the test seam.** Add `static _themeListenerCount(): number { return ThemeManager.themeListeners.length; }` with an `@internal` JSDoc tag, near `onThemeChange` ([L1264](src/typescript/lib/core/Theme.ts#L1264)).

5. **Migrate the 15 discarding sites.** In each file below, replace `ThemeManager.onThemeChange(<arg>)` with `this.subscribeTheme(<arg>)` — the `<arg>` closure/method reference is unchanged. All are `Component` subclasses, so `this.subscribeTheme` is in scope.
   - [component/display/Header.ts:80](src/typescript/lib/component/display/Header.ts#L80)
   - [component/input/TextField.ts:42](src/typescript/lib/component/input/TextField.ts#L42)
   - [component/input/PasswordField.ts:47](src/typescript/lib/component/input/PasswordField.ts#L47)
   - [component/input/UsernameField.ts:46](src/typescript/lib/component/input/UsernameField.ts#L46)
   - [component/display/ProgressSpinner.ts:94](src/typescript/lib/component/display/ProgressSpinner.ts#L94)
   - [component/button/Button.ts:519](src/typescript/lib/component/button/Button.ts#L519) (`this._onThemeChange` — keep the stable `_onThemeChange` field; only the subscribe call changes)
   - [component/input/AbstractPickerField.ts:106](src/typescript/lib/component/input/AbstractPickerField.ts#L106)
   - [component/input/NumberSpinner.ts:133](src/typescript/lib/component/input/NumberSpinner.ts#L133)
   - [component/table/cell/Cell.ts:67](src/typescript/lib/component/table/cell/Cell.ts#L67)
   - [component/input/AutoCompleteField.ts:122](src/typescript/lib/component/input/AutoCompleteField.ts#L122)
   - [component/input/ComboBox.ts:651](src/typescript/lib/component/input/ComboBox.ts#L651)
   - [component/table/cell/editor/CellEditor.ts:86](src/typescript/lib/component/table/cell/editor/CellEditor.ts#L86) (`applyPadding`)
   - [component/input/SpinButton.ts:85](src/typescript/lib/component/input/SpinButton.ts#L85)
   - [component/table/Body.ts:144](src/typescript/lib/component/table/Body.ts#L144)
   - [component/table/cell/renderer/CellRenderer.ts:33](src/typescript/lib/component/table/cell/renderer/CellRenderer.ts#L33) (`applyPadding`)

6. **Remove orphaned `ThemeManager` imports.** After step 5, any migrated file with **zero** remaining `ThemeManager` references must drop its `ThemeManager` import. Per-file check: `grep -c 'ThemeManager' <file>` — the eleven files that had 2 references (Header, TextField, PasswordField, UsernameField, ProgressSpinner, AbstractPickerField, NumberSpinner, Cell, AutoCompleteField, ComboBox, SpinButton) go to 0 and must have the import removed; the four with 3 (Button, CellEditor, Body, CellRenderer) retain a `ThemeManager.getTheme`/other use and keep it.

7. **Grep checkpoint.** `grep -rn 'ThemeManager.onThemeChange' src/typescript/lib/component` — expect **zero** matches. `grep -rn 'ThemeManager.onThemeChange' src/typescript/lib` — expect exactly one match (the `static onThemeChange` definition in `core/Theme.ts`), i.e. `core/Component.ts` no longer calls it directly either.

8. **Write regression tests** (see _Expected Behaviour_ / _Verification_).

9. **Verify:** `npm run typecheck`, the full unit suite, and the live window-close heap check.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | src/typescript/lib/core/Component.ts (bag + `subscribeTheme`, border fold, recursive+flushing `destructor`) |
| Modify | src/typescript/lib/core/Theme.ts (`_themeListenerCount` seam) |
| Modify | src/typescript/lib/component/display/Header.ts |
| Modify | src/typescript/lib/component/input/TextField.ts |
| Modify | src/typescript/lib/component/input/PasswordField.ts |
| Modify | src/typescript/lib/component/input/UsernameField.ts |
| Modify | src/typescript/lib/component/display/ProgressSpinner.ts |
| Modify | src/typescript/lib/component/button/Button.ts |
| Modify | src/typescript/lib/component/input/AbstractPickerField.ts |
| Modify | src/typescript/lib/component/input/NumberSpinner.ts |
| Modify | src/typescript/lib/component/table/cell/Cell.ts |
| Modify | src/typescript/lib/component/input/AutoCompleteField.ts |
| Modify | src/typescript/lib/component/input/ComboBox.ts |
| Modify | src/typescript/lib/component/table/cell/editor/CellEditor.ts |
| Modify | src/typescript/lib/component/input/SpinButton.ts |
| Modify | src/typescript/lib/component/table/Body.ts |
| Modify | src/typescript/lib/component/table/cell/renderer/CellRenderer.ts |
| Modify | tests/component/Component.test.ts (or a new `tests/component/theme-listener-teardown.test.ts`) |

---

## Expected Behaviour

Let `base = ThemeManager._themeListenerCount()` captured immediately before construction in each case.

1. **Bag flush on destructor (unit).** `const c = new Component({ border: '1px solid red' });` → count is `base + 1` (border subscribes once via the folded path). `(c as unknown as { destructor(): void }).destructor();` → count is `base` again.

2. **`setBorder` subscribes only once (unit).** `const c = new Component({}); const b0 = _themeListenerCount(); c.setBorder('1px solid red'); c.setBorder('2px solid blue');` → count is `b0 + 1`, not `b0 + 2` (the `_borderThemeSubscribed` guard holds across repeated `setBorder`).

3. **Recursion flushes descendants (unit).** Build a `Container` holding a bordered child: `const parent = new Container({}); parent.addComponent(new Component({ border: '1px solid red' }));` → count rises by the number of subscribing components in the subtree. `(parent as unknown as { destructor(): void }).destructor();` → count returns to `base`. This proves `Component.destructor()` reaches children.

4. **Surface component (unit).** `const t = new TextField({});` → count is `base + 1` (its `updateHeight` theme subscription). `(t as unknown as { destructor(): void }).destructor();` → count is `base`. (`TextField` subscribes unconditionally in its constructor.)

5. **No behavioural change to theme reactivity (unit, existing coverage).** A live component still re-reacts to `ThemeManager.setTheme(...)` before teardown exactly as before — the migration changes only *where the disposer is stored*, not whether the listener fires. Covered by existing theme tests (e.g. [Markdown.test.ts](tests/component/display/Markdown.test.ts) style); no new assertion required, but the migrated components' existing tests must stay green.

6. **Window close reclaims the subtree (manual / live only — not offline-testable).** Open N table windows, close all, force GC via a heap snapshot; no `Window` / `TablePanel` / `Table` from the closed windows remains, detached-node count returns toward baseline, and the `document.styleSheets` `#uuid` rule count returns to ~baseline. Requires the browser's GC + `FinalizationRegistry`, which the offline harness cannot drive.

---

## Verification

- **Typecheck:** `npm run typecheck` — clean.
- **Grep invariants:** `grep -rn 'ThemeManager.onThemeChange' src/typescript/lib/component` → zero; `grep -rn 'ThemeManager.onThemeChange' src/typescript/lib` → only the definition in `core/Theme.ts`. `grep -rn '_borderThemeCleanup' src/typescript/lib` → zero (field removed).
- **Unit tests:** the cases in _Expected Behaviour_ 1-4 (new), plus the full existing suite green — pay attention to `tests/component/Component.test.ts` (destructor now recurses) and every migrated component's own test.
- **Build:** `npm run build:lib` succeeds.
- **Live heap check (case 6):** run the dev app (`npm run dev`, http://localhost:8015), open several table/`Window` instances via the Misc panel, close them all, then in DevTools force GC and take a heap snapshot filtered on `Window` / `Table`; confirm zero retained instances from the closed windows and that the `#uuid` CSS-rule count in `document.styleSheets` returns to roughly its pre-open baseline. This is the definitive proof the leak is gone and the reason the recursion change is required.

---

## Documentation Impact

None. `subscribeTheme` is `protected` and `_themeListenerCount` is `@internal`; TypeDoc excludes both, so `npm run docs:build` needs no content changes and must still finish with zero warnings. No public export or JSDoc `{@link}` surface changes.

---

## Potential Challenges

- **Recursion double-teardown / re-entrancy.** `destructor()` must stay idempotent: it already clears `_element`, `_ownedHandles`, and unregisters the finalizer; add `this._components = []` and `this._themeCleanups.length = 0` so a second call is a no-op. A child reached by recursion whose own `destructor` was somehow already run is harmless (empty bag, detached element).
- **Idle pooled `CellEditor`s are not in the tree.** Each `Body` owns a `CellEditorPool` ([Body.ts:127](src/typescript/lib/component/table/Body.ts#L127)) that lazily constructs shared editors *only after an edit* and holds them in a `Map`, not in any cell's `_components`. Subtree recursion won't reach an idle pooled editor, so its migrated `subscribeTheme` bag won't flush on window close. This is a **secondary, edit-triggered** residual that leaks an *isolated* editor (its `_parent` is null when idle, so it does **not** retain the `Window`); it is out of scope here (see _Non-Goals_).
- **Orphaned imports break `no-unused` lint.** Removing the `onThemeChange` call orphans the `ThemeManager` import in the eleven 2-reference files; step 6 + the per-file `grep -c` guards against both leaving a dead import and removing a still-needed one.
- **Field-cascade safety.** `_themeCleanups` and `_borderThemeSubscribed` are *base* fields with plain initializers; they run before `Component`'s constructor dispatches `applyOptions`, so a cascade `setBorder` cannot clobber them (unlike subclass fields, which would need `declare`).

---

## Critical Files

- [src/typescript/lib/core/Component.ts](src/typescript/lib/core/Component.ts) — `destructor()` ([L630](src/typescript/lib/core/Component.ts#L630)), `setBorder` ([L1919](src/typescript/lib/core/Component.ts#L1919)), `_borderThemeCleanup` ([L340](src/typescript/lib/core/Component.ts#L340)), `_ownedHandles` field-safety precedent ([L287](src/typescript/lib/core/Component.ts#L287)), eager-release rationale ([L240-251](src/typescript/lib/core/Component.ts#L240)).
- [src/typescript/lib/core/Theme.ts](src/typescript/lib/core/Theme.ts) — `themeListeners` / `onThemeChange` ([L1256-1269](src/typescript/lib/core/Theme.ts#L1256)).
- [src/typescript/lib/component/chart/AbstractChart.ts](src/typescript/lib/component/chart/AbstractChart.ts) — the store-and-dispose precedent to mirror (`_themeCleanup`, [L178](src/typescript/lib/component/chart/AbstractChart.ts#L178) / [L1074](src/typescript/lib/component/chart/AbstractChart.ts#L1074)).
- [src/typescript/lib/core/StyleTarget.ts](src/typescript/lib/core/StyleTarget.ts) — `@internal` test-accessor precedent (`_ruleCacheHas`, [L209](src/typescript/lib/core/StyleTarget.ts#L209)).
- [src/typescript/lib/component/table/Body.ts](src/typescript/lib/component/table/Body.ts) — owns the per-table `CellEditorPool` ([L127](src/typescript/lib/component/table/Body.ts#L127)); context for the pooled-editor residual.

---

## Non-Goals

- **Migrating the existing store-and-dispose sites** (`Text`, `Markdown`, `CodeEditor`, `Tab`, `TabBar`, `AbstractChart`). They already dispose their theme subscription through their own `dispose()`/`destructor()` and are not part of the proven leak; leave them untouched. (`Text`/`Markdown`/`CodeEditor` dispose via a public `dispose()` that is not on the window-close path — a separate pre-existing teardown-propagation gap, not this leak.)
- **Disposing idle pooled `CellEditor`s** held by `Body`'s `CellEditorPool`. They are constructed only after an in-cell edit, are not in the `_components` tree, and leak in isolation without retaining any `Window`. A `Body`/`CellEditorPool` teardown for them is follow-up work.
- **A WeakRef/GC-native theme-subscription redesign** — rejected in favour of the framework's established destructor-disposal pattern (see _Architecture Decisions_).
- **Changing when or how often theme listeners fire** — only the disposer's *ownership* changes.

---

## Implementation Notes

Three places where implementation surfaced an inaccuracy in this plan's own numbers/claims. In each case the *mechanism* (the bag, `subscribeTheme`, the recursive/flushing `destructor()`) was implemented exactly as designed; only the plan's arithmetic/wording was off, discovered because the test-first assertions failed in ways the code changes didn't explain.

1. **Expected Behaviour case 4 (TextField) undercounted by one.** The plan asserted `new TextField({})` yields `base + 1` ("its `updateHeight` theme subscription"). Actual is `base + 2`: `TextInput`'s `_defaultTextInputOptions.border` (`TextInput.ts:72`) means `Component`'s `applyOptions` always-dispatches `setBorder` with the class-default border even though the caller passed none (`Component.ts:596-601`), and after this plan's border-fold that dispatch now also calls `subscribeTheme`. So every `TextField` (and by the same logic `PasswordField`/`UsernameField`/`AbstractPickerField`, which share the same default-border pattern) picks up two subscriptions, not one: the folded border subscription plus its own explicit one. Both are correctly released by the same `destructor()` bag flush — the test in `tests/component/Component.test.ts` ("releases a surface component's (TextField) theme subscriptions on destructor") was corrected to assert `base + 2`, with a comment explaining the second source, and to verify the full return to `base` after `destructor()` (which passes, proving both subscriptions are tracked).

2. **The "Grep checkpoint" (step 7) and "Verification" grep invariants don't hold given the plan's own Non-Goals.** `grep -rn 'ThemeManager.onThemeChange' src/typescript/lib/component` is not zero, and the whole-`lib` grep is not "exactly one match" — both counts omit the plan's own explicitly-preserved Non-Goal sites (`Text.ts`, `Markdown.ts`, `TabBar.ts`, `AbstractChart.ts`, `CodeEditor.ts` under `component/`, plus `layout/Tab.ts`), which correctly still call `ThemeManager.onThemeChange` directly and were deliberately left untouched, and also omit `Component.ts`'s own `subscribeTheme` helper, which necessarily contains the one real call the bag wraps. The applicable invariant actually verified: grepping each of the 15 files named in step 5 individually shows zero remaining `ThemeManager.onThemeChange` calls (one incidental hit, a pre-existing JSDoc prose reference at `Button.ts:1906`, not a call); and outside the six Non-Goal files, `subscribeTheme`'s own call is the sole remaining call site in `src/typescript/lib`.

3. **Step 6's per-file classification of `Button.ts` was wrong; the import ended up orphaned.** Step 6 grouped `Button.ts`/`CellEditor.ts`/`Body.ts`/`CellRenderer.ts` as the four "3-reference" files that "retain a `ThemeManager.getTheme`/other use" after migration and so keep their import. For `CellEditor.ts`/`Body.ts`/`CellRenderer.ts` that's correct — each keeps a real `ThemeManager.getTheme()` call. `Button.ts`'s third reference, though, was only the JSDoc prose comment at line ~1907 ("`ThemeManager.onThemeChange` handler — the content mutations that do..."), not a functional call; once the `onThemeChange` call itself was migrated to `this.subscribeTheme(...)`, the `ThemeManager` import had no remaining use. Applied the plan's own stated guard (a still-needed import must stay, an orphaned one must go) over the plan's specific per-file bucketing: removed the `Button.ts` import, left the prose comment untouched (still accurate — the handler is still registered with `ThemeManager`, just via `subscribeTheme`'s wrapper).

**Case 6 (live heap check) — documented manual-verify, not executed.** Per the plan's own classification this is "manual / live only — not offline-testable" (requires real browser GC + `FinalizationRegistry`). It was not executed in this implementation pass: the host machine was memory-constrained (~1.1 GB free at the time) and the only reachable dev server on the project's usual port (8015) was an already-running process outside this worktree with an active Chrome DevTools connection, not safe to commandeer for a heap-snapshot workflow. The offline unit test "recurses into children so a discarded container releases their subscriptions too" exercises the identical mechanism (destructor recursion into `_components` + bag flush) the live check would validate end-to-end; it does not substitute for the live proof, which remains outstanding and is called out here explicitly rather than silently skipped.
