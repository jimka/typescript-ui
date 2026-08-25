---
touches-shared:
  - packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts
  - packages/lib/tests/component/default-options-fallback.test.ts
  - packages/lib/docs/reference/changelog/next.md
---

# AbstractSelectableList 100×100 minSize Fallback Dedup — Implementation Plan

## Overview

Every `List` and `MultiSelectList` writes the same `min-width: 100px; min-height: 100px` pair onto its own per-instance `#id` stylesheet rule. The cause is an imperative floor in the constructor: [`AbstractSelectableList.ts:834-842`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L834) checks whether the caller supplied a `minSize` and, when they did not, calls `this.setMinSize({ width: 100, height: 100 })`. `setMinSize` writes the *instance* style layer, so the value can never dedupe against a shared class rule — a Style Audit scan flags one duplicate declaration pair per list on the page.

The fix moves the floor one line up the layer stack: `minSize` becomes an entry in [`_defaultAbstractSelectableListOptions`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L154), the bag this class already registers as its class-tier contribution at [`AbstractSelectableList.ts:731`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L731), and the constructor block is deleted. The floor is then declared once, on the shared `.AbstractSelectableList` rule, and a caller-supplied `minSize` still wins because the instance layer outranks the class layer.

This touches one source file plus tests and the changelog. No public API changes, no rendered DOM class list changes, and no visual change.

---

## Architecture Decisions

### The floor moves into the class defaults bag, not into a different guard

`minSize` is added to `_defaultAbstractSelectableListOptions` and the constructor's conditional `setMinSize` call is removed outright.[^why-defaults-bag] The nearest precedent is in the same file: `SelectableListRow`'s `cursor` and `border` were hoisted from imperative constructor setters into [`_defaultSelectableListRowOptions`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L260) by an earlier dedup pass, and its regression test [`SelectableListRow.classStyleDefaults.test.ts:1`](packages/lib/tests/component/list/SelectableListRow.classStyleDefaults.test.ts#L1) describes exactly that transformation. `TextArea` is the precedent for this specific field and value: it carries `minSize: { width: 100, height: 100 }` in [`_defaultTextAreaOptions:53`](packages/lib/src/typescript/lib/component/input/TextArea.ts#L53) and registers that same bag as `ownClassStyleDefaults` at [`TextArea.ts:75`](packages/lib/src/typescript/lib/component/input/TextArea.ts#L75).[^textarea-holds] `AbstractChart` is the same shape one level of abstraction up — an abstract middle class holding `minSize: { width: 80, height: 60 }` in its defaults bag for two concrete leaves ([`AbstractChart.ts:98`](packages/lib/src/typescript/lib/component/chart/AbstractChart.ts#L98), registered at [line 126](packages/lib/src/typescript/lib/component/chart/AbstractChart.ts#L126)).

### One edit covers both the layout floor and the CSS rule

`_defaultAbstractSelectableListOptions` is already doing double duty: the constructor spreads it into `_defaultOptions` (which is what pre-render getters resolve against), and [`AbstractSelectableList.ts:731`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L731) registers the same object as the static `ownClassStyleDefaults` the class-tier hierarchy walk reads. Adding one key to the const therefore fixes the JS-side floor and the CSS-side dedup together; no new static field and no second constant are needed.[^single-const]

### `List` and `MultiSelectList` need no registration of their own

Neither subclass declares a defaults bag, forwards `subclassDefaults`, or declares `ownClassStyleDefaults` — both constructors are a bare `super(options)` plus late-dispatch of their own selection fields ([`List.ts:36`](packages/lib/src/typescript/lib/component/list/List.ts#L36), [`MultiSelectList.ts:44`](packages/lib/src/typescript/lib/component/list/MultiSelectList.ts#L44)). ARCHITECTURE.md's rule that a class customising a hoistable field must register its own `ownClassStyleDefaults` applies only to a class that *deviates*; neither of these does, so both resolve straight through to `AbstractSelectableList`'s rule. The hoisted 100×100 is correct for both.

### Precedence is unchanged — the layer stack already encodes it

`getMinSizeConstraint()` is `resolveStyleValue("minSize")` ([`Component.ts:3141`](packages/lib/src/typescript/lib/core/Component.ts#L3141)), which returns the first layer whose authored bag *contains* the key, walking instance → group → class ([`Component.ts:5119`](packages/lib/src/typescript/lib/core/Component.ts#L5119)). A caller-supplied `minSize` is dispatched to `setMinSize` during the options cascade ([`Component.ts:768`](packages/lib/src/typescript/lib/core/Component.ts#L768)) and lands in the instance layer, so it still wins:

| Construction / call | Layer declaring `minSize` | `getMinSizeConstraint()` | `min-width` on the instance's own `#id` rule |
|---|---|---|---|
| `new List()` | class (`.AbstractSelectableList`) | `{ width: 100, height: 100 }` | none (an explicit removal, never `100px`) |
| `new List({ minSize: { width: 40, height: 30 } })` | instance | `{ width: 40, height: 30 }` | `40px` |
| `new List()` then `list.setMinSize({ width: 0, height: 0 })` | instance | `{ width: 0, height: 0 }` | `0px` |

Row 1's "explicit removal" is not an oversight: `minWidth`/`minHeight` are members of `FRAMEWORK_BASELINE_KEYS` ([`Component.ts:406`](packages/lib/src/typescript/lib/core/Component.ts#L406)), so a class-default-only value still queues a `null` on the instance rule rather than being skipped.[^baseline-removal] The point that matters for the audit finding is that no real `100px` value is written per instance any more.

---

## Internal Structure

Before — [`AbstractSelectableList.ts:154-162`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L154) and [`:834-842`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L834):

```typescript
const _defaultAbstractSelectableListOptions: Partial<AbstractSelectableListOptions> = {
    tag:             "div",
    // ... colours, border, borderRadius ...
    preferredSize:   { width: 200, height: 200 },
    maxSize:         { width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER },
};

// (in the constructor, after `this.addComponent(this._innerPanel);`)
if (this.instanceLayer().authored.minSize === undefined) {
    this.setMinSize({ width: 100, height: 100 });
}
```

After — the key joins the bag, the constructor block is gone:

```typescript
const _defaultAbstractSelectableListOptions: Partial<AbstractSelectableListOptions> = {
    tag:             "div",
    // ... colours, border, borderRadius ...
    preferredSize:   { width: 200, height: 200 },
    // 100×100 keeps a short empty/placeholder list a usable size. A class
    // default, not a constructor `setMinSize`, so the declaration lands once on
    // the shared `.AbstractSelectableList` rule instead of on every list's own
    // `#id` rule; a caller-supplied `minSize` still wins because it lands in the
    // higher-priority instance layer.
    minSize:         { width: 100, height: 100 },
    maxSize:         { width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER },
};
```

---

## Ordered Implementation Steps

1. **Add the regression test** — create `packages/lib/tests/component/list/AbstractSelectableList.classStyleDefaults.test.ts`, modelled on [`SelectableListRow.classStyleDefaults.test.ts`](packages/lib/tests/component/list/SelectableListRow.classStyleDefaults.test.ts) (same `CONFIG`, `idSelector`, and `declarationsDuring` helpers; import `_List` from `~/component/list/List` and `_MultiSelectList` from `~/component/list/MultiSelectList`). Cover the four cases in `## Expected Behaviour` marked *new test* — case 5 first in the file, then case 1's `MultiSelectList` half, case 3, and case 4. Run `npm -w packages/lib run test -- AbstractSelectableList.classStyleDefaults` — expect the `#id`-rule and `.AbstractSelectableList`-rule cases to **fail** (red).

2. **Add the class default** — in [`packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts), insert `minSize: { width: 100, height: 100 },` into `_defaultAbstractSelectableListOptions` between the existing `preferredSize` and `maxSize` entries, with the comment shown in `## Internal Structure`. Keep the file's existing value-column alignment.

3. **Delete the constructor floor** — in the same file, remove the whole block at lines 834-842 (the `// Default floor, but let a caller-supplied minSize option win.` comment, the `if (this.instanceLayer().authored.minSize === undefined) {` guard, its inner comment, the `this.setMinSize(...)` call, and the closing brace), leaving one blank line between `this.addComponent(this._innerPanel);` and `Event.addListener(this, "keydown", this.handleKeyDown);`. Steps 2 and 3 must land together — with both the class default and the guard in place, the guard would still fire and re-create the per-instance declaration.

4. **Check the removal is complete** — `grep -n 'setMinSize' packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts` — expect zero matches. `grep -n 'instanceLayer' packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts` — expect zero matches. No import becomes unused (the deleted block called only inherited methods).

5. **Register the default** — in [`packages/lib/tests/component/default-options-fallback.test.ts`](packages/lib/tests/component/default-options-fallback.test.ts), add a row to the registry array beside the existing `SelectableListRow` rows at lines 360-361, matching the shape of the `AbstractChart minSize (via LineChart)` row at [line 499](packages/lib/tests/component/default-options-fallback.test.ts#L499):

   ```typescript
   { label: 'AbstractSelectableList minSize (via List)', resolve: () => new List().getMinSizeConstraint(), expected: { width: 100, height: 100 } },
   ```

   `List` is already imported in that file at line 49; no new import is needed. This row is required by ARCHITECTURE.md — every class that defaults a field carries one. Run `npm -w packages/lib run test -- default-options-fallback` — expect green.

6. **Fix the stale comment** — in [`packages/lib/tests/component/list/RegionFill.test.ts:101`](packages/lib/tests/component/list/RegionFill.test.ts#L101), replace `The list carries setMinSize({ width: 100, height: 100 }); it must not` with `The list carries a 100x100 class-default minSize; it must not`. The assertions below it are unchanged.

7. **Changelog** — add a bullet to the `## Fixed` → `### Components` list in [`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md) (the `### Components` heading at line 115), beside the sibling dedup entries at lines 155-175. Exact wording in `## Documentation Impact`.

8. **Verify** — run the commands in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts` |
| Create | `packages/lib/tests/component/list/AbstractSelectableList.classStyleDefaults.test.ts` |
| Modify | `packages/lib/tests/component/default-options-fallback.test.ts` |
| Modify | `packages/lib/tests/component/list/RegionFill.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

All cases below are unit-testable offline; none needs manual verification, because the change writes no new geometry and the recording DOM sink sees every stylesheet write.

1. **Default floor still resolves** — `new List().getMinSizeConstraint()` and `new MultiSelectList().getMinSizeConstraint()` both return `{ width: 100, height: 100 }`, without rendering. *(Already covered for `List` by [`EmptyState.test.ts:84`](packages/lib/tests/component/list/EmptyState.test.ts#L84); add the `MultiSelectList` half as a new test.)*

2. **A caller-supplied `minSize` wins** — `new List({ minSize: { width: 40, height: 30 } }).getMinSizeConstraint()` returns `{ width: 40, height: 30 }`. *(Already covered by [`EmptyState.test.ts:84`](packages/lib/tests/component/list/EmptyState.test.ts#L84).)*

3. **A runtime `setMinSize` wins** — `new List()`, then `setMinSize({ width: 0, height: 0 })`, then `getMinSizeConstraint()` returns `{ width: 0, height: 0 }`. *(New test.)*

4. **No per-instance `min-width` / `min-height` value** — render a plain `new List()` and capture the writes to its own `#id` rule. Neither `minWidth` nor `minHeight` is written with a real value; each is either absent or an explicit `null`. Assert `expect(declarations.minWidth ?? null).toBeNull()` (and the same for `minHeight`) — **not** `toBeUndefined()`, which would fail on the explicit removal these two baseline keys always queue. *(New test — this is the case that fails before the change.)*

5. **The shared class rule carries the floor, exactly once** — open the capture window, then construct and render two `List`s and one `MultiSelectList`. The flattened writes to the `.AbstractSelectableList` selector include `minWidth: '100px'` and `minHeight: '100px'`, and exactly one `setRuleStyles` write to that selector carries a `minWidth` key — the floor is declared once for all three components, not once each. *(New test — fails before the change. **Must be the first test in the file**; see `## Potential Challenges`.)*

6. **Layout floor is unchanged** — a `List` placed in a 50px-tall `Border` region still lays out at least 100px tall. *(Already covered by [`RegionFill.test.ts:91`](packages/lib/tests/component/list/RegionFill.test.ts#L91).)*

7. **Rendered class list is unchanged** — a rendered `List` still carries `ts-ui-component`, `AbstractSelectableList`, and `List`. `AbstractSelectableList` already declared `ownClassStyleDefaults` before this change, so its chain already participated and already widened; nothing about the DOM class list moves. *(Already covered by the existing list suites; no new test.)*

---

## Verification

```bash
npm run typecheck
npm -w packages/lib run test -- AbstractSelectableList.classStyleDefaults
npm -w packages/lib run test -- component/list
npm -w packages/lib run test -- default-options-fallback
npm -w packages/lib run test -- diagnostics
npm test        # full suite, from the repo root
npm run lint
```

Plus the grep checks in step 4:

```bash
grep -n 'setMinSize'   packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts   # expect zero
grep -n 'instanceLayer' packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts  # expect zero
```

Manual smoke check (optional, since nothing visual moves): open the docs app (`npm run docs:dev`, http://localhost:5173) on the `List` component page, open the Style Audit overlay (`DiagnosticsOverlay.open()`, stylesheet-dedup tab), and confirm the `min-width: 100px` / `min-height: 100px` duplicate group for `List` / `MultiSelectList` is gone and the lists still render at their usual size.

---

## Documentation Impact

No public API changes — `minSize` was already a documented `ComponentOptions` field and the resolved value is identical. `packages/lib/docs/components/List.md` and `MultiSelectList.md` never mention the 100×100 floor, so neither needs an edit.

One changelog bullet, under `## Fixed` → `### Components` in [`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md#L115) — the list holding the sibling dedup entries at lines 155-175, whose phrasing it follows:

> - **`List` and `MultiSelectList` now dedupe their default 100×100 minimum
>   size onto the shared `.AbstractSelectableList` class rule instead of
>   repeating `min-width`/`min-height` on every list's own `#id` rule.** A
>   caller-supplied `minSize` still wins, and every list keeps the same
>   minimum it had before. No consumer action is needed; nothing renders
>   differently.

This is not a breaking change and gets no `## Breaking changes` entry: the rendered DOM class list is untouched, so no consumer stylesheet selector changes meaning.

---

## Potential Challenges

- **A sibling worktree edits the same file.** `.worktrees/selectablelistrow-padding-resolvedeclarations-dedup` targets `SelectableListRow`'s `padding` in `AbstractSelectableList.ts`. The two edits sit in different regions (that one around lines 260-330, this one at 154-162 and 834-842), but merge them one at a time and re-run `npm -w packages/lib run test -- component/list` after the second.
- **Class-tier resolution is memoized process-wide, and `DOM.reset()` does not clear it.** `ClassStyleRules.ts`'s `_bags` and `_levels` maps ([lines 142](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L142) and [449](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L449)) are never emptied, so within one test file the `.AbstractSelectableList` rule's declarations are written to the sink exactly once — during whichever test first constructs and renders a list. Behaviour case 5 must therefore be the file's first test, with the capture window opened before the first `new List(...)`. Cases 1, 3, and 4 read per-instance state and can sit anywhere.
- **Asserting absence of the instance declaration.** `minWidth`/`minHeight` are `FRAMEWORK_BASELINE_KEYS`, so the instance rule still receives an explicit `null` for them. A test asserting `toBeUndefined()` will fail for the wrong reason — use `?? null` and `toBeNull()`, as spelled out in behaviour case 4.
- **`.AbstractSelectableList` already exists as a rule.** The class already deviates from the framework tier on colour, border, and border-radius, so this change *adds two declarations to an existing rule* rather than creating a new one. A test that asserts the rule was created fresh would be wrong; assert on the declarations written to that selector instead.

---

## Critical Files

| File | Why read it |
|---|---|
| [`packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts) | The file being changed. Lines 154-162 (defaults bag), 260 (`SelectableListRow`'s bag — the in-file precedent), 731 (`ownClassStyleDefaults`), 834-842 (the block to delete). |
| [`packages/lib/src/typescript/lib/component/input/TextArea.ts`](packages/lib/src/typescript/lib/component/input/TextArea.ts) | Precedent for this exact field and value: line 53 (`minSize` in the defaults bag), line 75 (registration). |
| [`packages/lib/src/typescript/lib/component/chart/AbstractChart.ts`](packages/lib/src/typescript/lib/component/chart/AbstractChart.ts) | Precedent at the same abstraction level — an abstract middle class holding a `minSize` default for concrete leaves (lines 96-98, 126). |
| [`plans/implemented/class-hierarchy-cascade.md`](plans/implemented/class-hierarchy-cascade.md) | The class-tier mechanism this relies on: `ownClassStyleDefaults`, the own-property check, and the ancestor-first hierarchy walk. |
| [`packages/lib/src/typescript/lib/core/ClassStyleRules.ts`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts) | `FRAMEWORK_DEFAULTS` (line 135), the `minSize` writer (line 279), `resolveDeclarations` (line 205), `chainParticipates` (line 495). |
| [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) | `FRAMEWORK_BASELINE_KEYS` (line 406), `getMinSizeConstraint` (line 3141), `styleLayers` (line 4954), `resolveStyleValue` (line 5119), `flushStyleBag` (line 5348). |
| [`packages/lib/tests/component/list/SelectableListRow.classStyleDefaults.test.ts`](packages/lib/tests/component/list/SelectableListRow.classStyleDefaults.test.ts) | The test template to copy — helpers and assertion shape. |
| [`packages/lib/tests/component/list/RegionFill.test.ts`](packages/lib/tests/component/list/RegionFill.test.ts) and [`EmptyState.test.ts`](packages/lib/tests/component/list/EmptyState.test.ts) | The existing tests that pin the behaviour and must keep passing. |

---

## Non-Goals

- **No `ownClassStyleDefaults` on `List` or `MultiSelectList`.** Neither deviates from `AbstractSelectableList` on any hoistable field, so a registration would add a rule declaring nothing.
- **No change to `preferredSize` or `maxSize`.** Both already live in the defaults bag; neither is duplicating per instance.
- **`SelectableListRow`'s remaining imperative writes (`setPreferredSize`, `setPadding`) stay.** `padding` is owned by a separate in-flight plan, and `preferredSize` is not a hoistable CSS key.
- **No change to the rendered DOM class list**, and therefore no `## Breaking changes` changelog entry.
- **The hand-written `.List, .MultiSelectList` module-level rules** (`userSelect`, `outline`, and the `:focus::after` ring, lines 182-209) are untouched — they carry keys outside this change's scope.

---

## Notes

[^why-defaults-bag]: A class default and a constructor `setMinSize` produce the same resolved value, but land in different style layers, and only the class layer can be shared. `setMinSize` writes `_instanceStyle`, which `flushStyleBag` compares against the layers below; because the class layer's `minSize` resolves to the framework baseline `0px`, the comparison is always a mismatch and every list gets its own real `min-width: 100px; min-height: 100px` declaration pair. Moving the value into the class layer removes the instance's opinion entirely, so the shared `.AbstractSelectableList` rule supplies it once for every list in the app. Two alternatives were considered and rejected: a hand-rolled module-level `StyleRule` for `.List, .MultiSelectList` (the file already has one) would dedupe the CSS but leave `getMinSizeConstraint()` reporting `null`, silently breaking the layout floor the `RegionFill` test pins — the framework's box math reads the resolved `StyleBag` value, not the stylesheet; and keeping the constructor call while adding the class default would double-declare, since the guard tests the instance layer, which the class default never populates.

[^textarea-holds]: The prior investigation flagged `TextArea` as the sibling precedent, and the comparison holds on every axis that matters. Same field (`minSize`), same literal value (`{ width: 100, height: 100 }`), same reason (a usable floor for a box whose content may be empty), same mechanism (an entry in a `_default<Name>Options` const that is also registered as the class's `ownClassStyleDefaults`), and the same subclass story (`TextArea` is itself a subclass of `TextInput` that deviates on `minSize` and registers for exactly that reason — see its comment at `TextArea.ts:69`). The only difference is that `TextArea` has always had the value in its bag, so it is a precedent for the destination shape rather than for the migration itself; `SelectableListRow`'s `cursor`/`border` hoist, in the file being edited, is the precedent for the migration.

[^single-const]: `getClassStyleDefaults()` returns `_defaultOptions` (`Component.ts:5763`), which is the merged bag the constructor built — that is what pre-render getters resolve against. Once the component renders, `applyStyle` replaces the virtual class layer with the real one from `ensureClassStyleRule`, and for a chain that participates in the hierarchy walk that function ignores the passed bag and rebuilds from the static `ownClassStyleDefaults` chain instead (`ClassStyleRules.ts:928-950`). Because `AbstractSelectableList` points both at the same object, a single key added to the const is visible on both paths — pre-render and post-render — with no chance of the two drifting apart.

[^baseline-removal]: `flushStyleBag` skips a key the instance never declared, *unless* it is in `FRAMEWORK_BASELINE_KEYS`, in which case it queues the lower tier's own value as an explicit `null` removal (`Component.ts:5371-5416`). A batch of nothing but removals never materialises the `#id` rule at all, so in the common case the list gets no rule; when some other real declaration in the same batch does materialise it, the removal keeps that rule's declaration set comprehensive rather than partial. Either way no `100px` is written per instance, which is what the Style Audit finding was about.
