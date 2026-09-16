---
touches-shared:
  - packages/lib/docs/reference/changelog/next.md
---

# Focusable Selector Honours `tabindex="-1"` — Implementation Plan

## Overview

The framework decides what is keyboard-reachable with one CSS selector,
[`FOCUSABLE_SELECTOR`](packages/lib/src/typescript/lib/core/Focusable.ts#L12).
Its trailing `:not([tabindex="-1"])` binds only to the last branch of the
comma-separated list, so a `<button>`, `<input>`, `<select>` or `<textarea>`
still matches its own branch no matter what `tabindex` it carries. Every
element that a *roving tab index* — the pattern where a group of sibling
controls shares one tab stop, the active member holding `tabindex="0"` and the
rest `tabindex="-1"` — has deliberately taken out of the tab order is
therefore still a tab stop.

This plan rewrites that constant so the guard binds to every branch, narrows
its `[href]` branch to real anchors, and adds a `[contenteditable]` branch so
an editing surface such as CodeMirror's `.cm-content` becomes reachable at
all. The constant feeds
[`FocusTraversal`](packages/lib/src/typescript/lib/core/FocusTraversal.ts#L114),
[`SpatialNavigation`](packages/lib/src/typescript/lib/core/SpatialNavigation.ts#L533)
and six direct call sites in
[`Dialog`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L1028), so it
changes keyboard behaviour library-wide; `## Expected Behaviour` pins both what
changes and what must not.

A second, unrelated crash in the same subsystem rides along as its own commit:
[`ToolBar._onKeyDown`](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L199)
dereferences a `RovingTabIndex` that only
[`addComponent`](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L542)
ever creates, while the bar makes itself focusable at
[`:189`](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L189) —
so an arrow key on a focused, childless bar throws
`Cannot read properties of undefined (reading 'moveNext')`.

---

## Architecture Decisions

### Fix the selector string, not its callers

The guard moves into every branch of `FOCUSABLE_SELECTOR` itself. No caller
gains a `tabindex` filter.[^string-not-filter]

### Build the selector from one branch list and one guard suffix

`Focusable.ts` declares the branches as an array and joins each to a single
shared `:not([tabindex="-1"])` suffix, so the guard cannot come loose from a
branch again — including a branch someone adds later.[^branch-list] This
mirrors [`core/ClassStyleRules.ts:34`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L34),
where `FRAMEWORK_SELECTOR` is likewise assembled from a constant rather than
typed out as literal selector text.

The resulting match rule, with the cases it decides:

| Element | Today | After | Why |
|---|---|---|---|
| `<button>` | match | match | `button` branch |
| `<button tabindex="0">` — a roving group's active member | match | match | guard passes |
| `<button tabindex="-1">` — roved off | match | **no match** | guard now binds to `button` |
| `<input tabindex="-1">` | match | **no match** | same, for `input` |
| `<div tabindex="0">` | match | match | `[tabindex]` branch, unchanged |
| `<div tabindex="-1">` | no match | no match | unchanged |
| `<a href="/x">` | match | match | `a[href]` branch |
| `<a>` (no `href`) | no match | no match | unchanged |
| `<use href="#icon">` — a `Glyph`'s SVG icon | match | **no match** | `[href]` narrowed to anchors |
| `<div contenteditable="true">` — CodeMirror's `.cm-content` | no match | **match** | new branch |
| `<div contenteditable="false">` | no match | no match | that branch's own guard |

### `[href]` narrows to anchors, and `SpatialNavigation`'s glyph workaround goes with it

The `[href]` branch becomes `a[href], area[href]`. That stops a `Glyph`'s
decorative `<use href="#…">` element matching, which in turn makes
`withoutDecorativeGlyphs`
([`SpatialNavigation.ts:318-320`](packages/lib/src/typescript/lib/core/SpatialNavigation.ts#L318))
dead; it is deleted in the same commit, along with its call at
[`:533`](packages/lib/src/typescript/lib/core/SpatialNavigation.ts#L533).[^glyph]

### `[contenteditable]` is added in the same change

A branch `[contenteditable]:not([contenteditable="false"])` joins the list, so
a resting `CodeEditor` exposes one tab stop instead of zero.[^contenteditable]

### `ToolBar` guards its roving group rather than constructing it eagerly

`ToolBar._onKeyDown` returns early when `_rovingTabIndex` is still undefined,
and the field's declared type becomes `RovingTabIndex | undefined`. The group
is **not** moved to a field initializer or to the constructor
body.[^guard-not-construct] The guard mirrors
[`overlay/ButtonGroup.ts:240`](packages/lib/src/typescript/lib/overlay/ButtonGroup.ts#L240),
the sibling that holds the same delegate optionally and tests it before every
use.

### The "owned by another plan" annotation on the pending tests is stale

`tests/core/FocusTraversalCompositeWidgets.test.ts:72-75` says `core/Focusable.ts`
is owned by `plans/directional-panel-navigation.md` and must not be edited.
That plan was never implemented and has been superseded; the file has no live
owner and this plan edits it freely.[^blocker-stale] The implementer must
delete that annotation, not preserve it.

---

## Internal Structure

`core/Focusable.ts`, replacing the single-line constant at `:12`:

```typescript
// Every branch carries the same `tabindex="-1"` guard, joined here rather
// than written into each branch by hand: the guard binding to only the last
// branch of a hand-written list is the defect this shape exists to prevent.
const FOCUSABLE_BRANCHES: readonly string[] = [
    "button",
    "a[href]",
    "area[href]",
    "input",
    "select",
    "textarea",
    '[contenteditable]:not([contenteditable="false"])',
    "[tabindex]",
];

// `-1` exactly, matching the only value `RovingTabIndex.add` ever writes.
const NOT_TAB_REACHABLE = ':not([tabindex="-1"])';

export const FOCUSABLE_SELECTOR = FOCUSABLE_BRANCHES
    .map(branch => branch + NOT_TAB_REACHABLE)
    .join(", ");
```

---

## Ordered Implementation Steps

**Commit 1 — the selector.**

1. `packages/lib/tests/core/FocusTraversalCompositeWidgets.test.ts`: replace the
   comment block at `:56-75` with one stating the selector now honours
   `tabindex="-1"` on every branch, and drop the "owned by
   plans/directional-panel-navigation.md" sentence entirely. Turn the
   `ButtonGroup` (`:78`) and `TabBar` (`:79`) `it.todo`s into real tests
   asserting `stopCount(el) === 1`. Build the `ButtonGroup` case as a
   `Container` host holding three `ToggleButton`s, with `group.setContainer(host)`
   called — without that call no roving group exists and the count stays at 3.
   Build the `TabBar` case as `new Container({ layoutManager: new Tab() })` with
   three child `Component`s, sized and `flushLayout()`-ed, then measure the
   element found by `DOM.source.querySelectorAll(hostEl, '[role="tablist"]')[0]`.
   Both must fail here; step 4 is what makes them pass.
2. Same file: rewrite the two `it.todo`s that this change does **not** fix.
   `MenuBar` (`:76`) and `ToolBar` (`:77`) keep `it.todo` status, with text and
   comment naming their real causes — `MenuBar` enrols its buttons in no roving
   group at all, and `ToolBar` carries its own `tabindex="0"` on top of its
   active member's.[^two-widgets]
3. Same file: invert the `CodeEditor` pair. The live test at `:104-120` currently
   asserts `stopCount(el)` is `0`; change it to `1` and retitle it, and turn the
   `it.todo` at `:122` into a real test asserting the one stop is the
   `.cm-content` element (`DOM.source.querySelector(el, '.cm-content')`), and
   retitle it to match what it asserts — its current name promises a
   reachable-from-outside check it does not perform. Rewrite the `:83-103`
   comment accordingly.
4. `packages/lib/src/typescript/lib/core/Focusable.ts`: replace `:12` with the
   block from `## Internal Structure`, and rewrite the constant's doc comment at
   `:7-11` — it currently claims the value is copied verbatim from `Dialog`, which
   stops being true. Run `npx vitest run tests/core/FocusTraversalCompositeWidgets.test.ts`
   from `packages/lib`; steps 1 and 3's tests go green.
5. `packages/lib/src/typescript/lib/core/SpatialNavigation.ts`: delete
   `withoutDecorativeGlyphs` and its doc comment (`:305-320`) and unwrap the call
   at `:533`, leaving
   `leafFocusables(mergeHandles(visibleFocusable(root), rovingGroupMembers(root)).filter(handle => handle !== origin))`.
   Three comments in the same file then describe behaviour that no longer exists
   and must be rewritten:
   - `:322-326`, above `NATIVE_FOCUSABLE_TAGS` — that set is no longer "tags
     `FOCUSABLE_SELECTOR` matches unconditionally, independent of tabindex". It is
     the set `leafFocusables` uses to tell an interactive leaf from a passive
     container, and its membership does not change.
   - `:363-368`, in `rovingGroupMembers`' doc comment — drop the "unless it also
     happens to render as a native focusable tag" clause. Every roved-off member
     is now hidden from the selector, which is what makes this helper load-bearing
     rather than a corner case.
   - `:515`, in `collectCandidates`' doc comment — remove the
     `{@link withoutDecorativeGlyphs}` clause, or `npm run docs:api` reports a
     dangling link.
6. `packages/lib/tests/unit/core/SpatialNavigation.test.ts`: delete the test at
   `:655-673` ("does not treat a decorative glyph icon as a candidate…"). It seeds
   a `<use>` element into the `FOCUSABLE_SELECTOR` result set, which the selector
   can no longer produce. Leave every other test in the file untouched.
7. `packages/lib/src/typescript/lib/core/RovingTabIndex.ts`: update the comment at
   `:6-16`. It says a roved-off member is hidden from the selector only when it
   renders as a non-native tag; after step 4 every roved-off member is hidden,
   which is exactly why `SpatialNavigation` still needs the
   `data-ts-ui-roving-member` marker to reach them. The constants at `:17-18` and
   the code do not change.
8. `packages/lib/tests/core/FocusTraversal.test.ts`: fix the stale comment at
   `:277-281`, which cites CodeMirror's `.cm-content` as an element
   `FOCUSABLE_SELECTOR` never matches. The test itself is offline-seeded and its
   assertions stay as they are — only the example in the comment is wrong.
9. Run `npm test` from the repo root. Checkpoint:
   `grep -rn 'withoutDecorativeGlyphs' packages/lib/src packages/lib/tests` —
   expect zero matches.
10. `packages/lib/docs/concepts/accessibility.md`: add a short paragraph to the
    *Tab traversal* section (ends at `:118`) stating what counts as a tab stop —
    a focusable element that is not `tabindex="-1"`, so a roving group
    contributes one stop and not one per member, and an editing surface marked
    `contenteditable` counts as one.
11. `packages/lib/docs/reference/changelog/next.md`: add two bullets under
    `## Fixed` → `### Core` (`:152-154`) — one for the `tabindex="-1"` guard now
    binding to every branch (naming the consequence: roved-off toolbar, tab-strip
    and button-group members are no longer tab stops, and no longer trapped by a
    `Dialog`), one for `contenteditable` surfaces becoming reachable.

**Commit 2 — the childless `ToolBar` crash.**

12. `packages/lib/tests/component/menubar/ToolBar.test.ts`: add a test to the
    `describe('ToolBar keydown — stands down while SpatialNavigation claims the key')`
    block (`:148`) that calls `(bar as any)._onKeyDown({ key: 'ArrowRight' } as KeyboardEvent)`
    on a `new ToolBar()` with no children and expects it not to throw; repeat for
    `ArrowLeft`, and for `ArrowDown` / `ArrowUp` on a
    `new ToolBar({ orientation: 'vertical' })` with no children. Run it — every
    case throws today.
13. `packages/lib/src/typescript/lib/component/menubar/ToolBar.ts`: change `:159`
    to `declare private _rovingTabIndex: RovingTabIndex | undefined;`, and insert
    an early return in `_onKeyDown` immediately after the `claimsKey` guard at
    `:192`:

    ```typescript
    if (this._rovingTabIndex === undefined) {
        return;
    }
    ```

    The `claimsKey` guard stays the handler's first statement — it is the
    cross-service arbitration contract twelve other handlers share. Step 12's
    test goes green.
14. Run `npm test` and `npm run lint` from the repo root, plus
    `npm run typecheck` (the field's type changed).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Focusable.ts` |
| Modify | `packages/lib/src/typescript/lib/core/SpatialNavigation.ts` |
| Modify | `packages/lib/src/typescript/lib/core/RovingTabIndex.ts` |
| Modify | `packages/lib/src/typescript/lib/component/menubar/ToolBar.ts` |
| Modify | `packages/lib/tests/core/FocusTraversalCompositeWidgets.test.ts` |
| Modify | `packages/lib/tests/core/FocusTraversal.test.ts` |
| Modify | `packages/lib/tests/unit/core/SpatialNavigation.test.ts` |
| Modify | `packages/lib/tests/component/menubar/ToolBar.test.ts` |
| Modify | `packages/lib/docs/concepts/accessibility.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

### Selector matching — unit-testable

The match table under *Build the selector from one branch list and one guard
suffix* is the specification. `tests/core/FocusTraversalCompositeWidgets.test.ts`
runs against the real browser selector engine (its `@vitest-environment jsdom`
pragma), so each row is directly testable there. The existing test at `:130-143`
already covers the `<div tabindex="0">` / `<div tabindex="-1">` pair and must
stay green unchanged.

### Tab stops per composite widget — unit-testable

Measured on real rendered widgets, three items each:[^measured]

| Widget | Stops today | Stops after | One stop? |
|---|---|---|---|
| `ButtonGroup` with `setContainer(host)` | 3 | 1 | yes |
| A `Tab` layout's `TabBar` | 3 | 1 | yes |
| `CodeEditor`, resting | 0 | 1 | yes |
| `ToolBar` | 4 | 2 | no — the bar's own stop remains |
| `MenuBar` | 4 | 4 | no — it has no roving group |

`Tree` and `Table`'s body already expose exactly one stop
(`FocusTraversalCompositeWidgets.test.ts:36-54`) and must still do so.

### Behaviour that must not change

- **Spatial navigation still reaches every roved-off member.**
  `SpatialNavigation.collectCandidates` merges `visibleFocusable(root)` with
  `rovingGroupMembers(root)`, which queries the `data-ts-ui-roving-member`
  marker and ignores `tabindex` entirely. Pinned by
  `tests/unit/core/SpatialNavigation.test.ts:620` ("reaches a roving-tabindex
  member roved to `tabindex="-1"`…"). Unit-testable; that test must pass
  untouched.
- **A disabled roving member is still not a candidate** —
  `tests/unit/core/SpatialNavigation.test.ts:639`.
- **`leafFocusables`'s three rulings are unchanged** —
  `tests/unit/core/SpatialNavigation.test.ts:547`, `:570`, `:593`.
- **`FocusTraversal`'s ordering, wrap, disabled-skip, hidden-skip and
  Tab-key-owner release** all keep their current results —
  `tests/core/FocusTraversal.test.ts` in full. Every candidate there is seeded
  by selector string, so a changed string is invisible to it.
- **`Dialog`'s focus trap keeps cycling within the dialog** —
  `tests/overlay/Dialog*.test.ts` in full.

### New behaviour in `Dialog` — needs manual verification

`Dialog` uses `FOCUSABLE_SELECTOR` directly at six sites and never goes through
`findFocusable`, so it inherits the fix: a dialog containing a `ToolBar` no
longer gives initial focus to, or traps Tab on, a roved-off button, and a dialog
containing a `CodeEditor` or `MarkdownEditor` can now focus and trap on the
editing surface. `Dialog`'s own tests seed their candidate sets offline, so the
changed selector string is invisible to them — the check is the demo-dialog
sweep below.

### `ToolBar` with no children — unit-testable

`ArrowRight`, `ArrowLeft`, `ArrowUp` and `ArrowDown` on a focused, childless
`ToolBar` do nothing and throw nothing. The handler returns no disposition, so
the key keeps propagating — a childless bar must not swallow an arrow key an
ancestor or `SpatialNavigation` may want.

### Needs manual verification

Real keyboard focus order cannot be exercised by the test harness. Run
`npm run dev` from `packages/lib` and check, with the mouse unplugged:

- **`ToolBarPanel`** — Tab reaches the bar once and then leaves it; arrow keys
  cycle through its buttons; Tab never walks button-by-button.
- **`TabDemoPanel`** — Tab reaches the tab strip once, not once per tab; arrow
  keys move between tabs.
- **`CodeEditorPanel`** — Tab from a control before the editor lands inside the
  editor; pressing `Escape` and then `Tab` leaves it again, since a `CodeEditor`
  marks itself a Tab-key owner and hands Tab back only after an `Escape`.
- **`MenuBarPanel`** — unchanged from today: the bar and each menu button are
  still separate stops. This is the known gap step 2 records.
- Any demo dialog containing a toolbar — Tab cycles the dialog's own controls
  and the toolbar's single active member, and does not escape the dialog.

---

## Verification

- `npm run typecheck` and `npm run typecheck:test` (run from `packages/lib`) —
  the `ToolBar` field type changed.
- `npm test` from the repo root — full suite, including the rewritten
  `FocusTraversalCompositeWidgets.test.ts`.
- `npm run lint`.
- `grep -rn 'withoutDecorativeGlyphs' packages/lib/src packages/lib/tests` —
  zero matches.
- `grep -rn 'directional-panel-navigation' packages/lib/tests/core/FocusTraversalCompositeWidgets.test.ts` —
  zero matches.
- `npm run docs:api` — must finish with zero warnings.
- The manual sweep listed under *Needs manual verification*.

---

## Documentation Impact

`core/Focusable.ts` is not re-exported from `core/index.ts` or any package entry
point, so none of its symbols appear in the generated API docs and no reference
page changes. The consumer-facing impact is covered by the *Tab traversal*
section of `packages/lib/docs/concepts/accessibility.md` and by the changelog
entries in step 11. No public signature changes, so `packages/lib/llms.txt` needs
no new entry.

---

## Potential Challenges

- **A `Tab` layout's content component is given `tabindex="-1"`**
  ([`layout/Tab.ts:1745`](packages/lib/src/typescript/lib/layout/Tab.ts#L1745)).
  A leaf component used directly as tab content — a `TextArea`, say, which
  renders as a bare `<textarea>` — therefore drops out of the tab order.
  Dropping it matches what a real browser's own traversal already does with
  `tabindex="-1"`, so this change removes a divergence rather than creating one;
  if a demo surfaces the loss, it is a bug in `Tab.wireComponentAria`, not here.
- **`MenuBar` and `ToolBar` do not reach one stop per widget.** Their remaining
  extra stops are component-level defects, out of this plan's scope; step 2
  records them in the test file so the stale selector explanation does not
  outlive the fix.
- **Deleting `withoutDecorativeGlyphs` touches a shared hot path.** Run the whole
  of `tests/unit/core/SpatialNavigation.test.ts`, not just the deleted case — a
  failure anywhere else means a `<use>` element was load-bearing somewhere this
  plan did not find.
- **The offline harness has no selector engine.** `ModelledDOMSource` returns
  whatever a test seeded for a given selector string, so no offline test can
  catch a mistake in the selector text. Only
  `FocusTraversalCompositeWidgets.test.ts`, which runs under `jsdom` against the
  real engine, can — keep every new selector assertion in that file.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/Focusable.ts`](packages/lib/src/typescript/lib/core/Focusable.ts) —
  the constant, plus `findFocusable` / `visibleFocusable` / `focusCandidates` —
  the helpers the two focus services go through, and which `Dialog` bypasses.
- [`packages/lib/src/typescript/lib/core/ClassStyleRules.ts:34`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L34) —
  the precedent for assembling a selector from constants.
- [`packages/lib/src/typescript/lib/core/SpatialNavigation.ts:305-533`](packages/lib/src/typescript/lib/core/SpatialNavigation.ts#L305) —
  `withoutDecorativeGlyphs`, `NATIVE_FOCUSABLE_TAGS`, `rovingGroupMembers`,
  `leafFocusables`, `collectCandidates`.
- [`packages/lib/src/typescript/lib/core/FocusTraversal.ts`](packages/lib/src/typescript/lib/core/FocusTraversal.ts) —
  six `visibleFocusable` call sites (`:114`, `:134`, `:234`, `:320`, `:331`, `:342`).
- [`packages/lib/src/typescript/lib/overlay/Dialog.ts:1028-1112`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L1028) —
  the six direct uses of the raw constant.
- [`packages/lib/src/typescript/lib/core/RovingTabIndex.ts`](packages/lib/src/typescript/lib/core/RovingTabIndex.ts) —
  writes the `tabindex="-1"` the selector must honour, and the marker attribute
  that keeps roved-off members reachable by direction.
- [`packages/lib/src/typescript/lib/overlay/ButtonGroup.ts:58`](packages/lib/src/typescript/lib/overlay/ButtonGroup.ts#L58) —
  the precedent for an optionally-present `RovingTabIndex` field.
- [`packages/lib/src/typescript/lib/core/Component.ts:871`](packages/lib/src/typescript/lib/core/Component.ts#L871) —
  `applyOptions` dispatching `addComponents`, the reason `ToolBar`'s roving field
  must stay `declare`.
- [`packages/lib/tests/core/FocusTraversalCompositeWidgets.test.ts`](packages/lib/tests/core/FocusTraversalCompositeWidgets.test.ts) —
  the acceptance tests and the audit comment being rewritten.

---

## Non-Goals

- **`SpatialNavigation`'s per-keypress cost.** The ~1,500 computed-style
  resolutions per arrow chord and the quadratic candidate scan in
  `leafFocusables` are a separate plan. This plan changes how many candidates
  that plan will count, so its measurements must be taken *after* this one
  lands, or the before/after numbers are not attributable.
- **Making `MenuBar` expose one tab stop.** It would have to adopt
  `RovingTabIndex` for its `MenuBarButton`s — a component behaviour change, not
  a selector fix.
- **Removing `ToolBar`'s own `tabindex="0"`.** Dropping it would give the bar one
  stop instead of two, but it also changes where Tab lands and what
  `SpatialNavigation`'s container ranking sees. Separate change, separate
  evidence.
- **`Tab.wireComponentAria`'s blanket `tabindex="-1"` on tab content.** Noted
  under `## Potential Challenges`; not touched here.
- **`Dialog`'s focus-trap ordering, `disabled` handling, or `initialFocus`
  resolution.** `Dialog` inherits the selector fix and nothing else.

---

## Notes

[^string-not-filter]: The alternative — keep a broad selector and drop
    `tabindex="-1"` handles inside `findFocusable`, beside its existing
    `disabled` filter — was rejected for two reasons. First, `Dialog` never calls
    `findFocusable`: it uses the raw constant at `Dialog.ts:1028`, `:1045`,
    `:1070`, `:1074`, `:1095` and `:1112`, so a helper-level filter would leave
    the dialog's focus trap stopping on roved-off buttons — the same defect, in
    the one place a keyboard user cannot escape. Second, the offline
    `ModelledDOMSource` has no selector engine and returns whatever each test
    seeded for a given selector string; the ~70 seeded cases in
    `tests/unit/core/SpatialNavigation.test.ts` and `tests/core/FocusTraversal.test.ts`
    import `FOCUSABLE_SELECTOR` rather than hard-coding it, so changing the
    string is invisible to them, while a new filter inside `findFocusable` would
    newly apply to every seeded handle in every one of those tests.

[^branch-list]: Writing the guard into each of eight branches by hand
    reproduces the failure mode exactly once someone appends a ninth — which is
    how the current single-line constant came to be wrong. Joining one suffix
    onto a list makes "every branch carries the guard" true by construction. The
    cost is that the constant is computed rather than literal; it is still a
    module-level `const` evaluated once at import, and
    `ClassStyleRules.ts:34` already establishes computed selector text as normal
    here.

[^glyph]: `Glyph` renders `<svg><use href="#…">`
    (`component/display/Glyph.ts:721-722`), and the bare `[href]` branch matches
    that `<use>`. `SpatialNavigation` filtered it out locally;
    `FocusTraversal` never did, so Tab could land on an element the browser
    cannot focus at all. Narrowing the branch to `a[href], area[href]` fixes
    both and leaves nothing for the local filter to remove — its own doc comment
    already names this change as the follow-up that retires it. Nothing else in
    the library renders a non-anchor element carrying `href`.

[^contenteditable]: It is the same constant, the same test file, and the same
    class of gap — an element the browser treats as focusable that the selector
    cannot see. Splitting it into a second plan would mean editing `Focusable.ts`
    and rewriting the same test comments twice. A resting `CodeEditor` exposes
    zero tab stops today, asserted as a live gap at
    `tests/core/FocusTraversalCompositeWidgets.test.ts:104-120`; with the branch
    added it exposes exactly one, CodeMirror's `.cm-content`.

[^guard-not-construct]: A field initializer would be wrong here.
    `Component.applyOptions` dispatches `addComponents` when `options.components`
    is set (`core/Component.ts:871`), and `applyOptions` runs inside `super()` —
    so `ToolBar.addComponent`, which creates the group and enrols each focusable
    child, executes *during* the `super()` cascade. A class-field initializer runs
    *after* `super()` returns and would replace that fully-populated group with an
    empty one, silently losing every child passed as `new ToolBar({ components: […] })`.
    This is the trap `CODE_CONVENTIONS.md`'s *Fields written during the `super()`
    cascade* describes, and the reason every `ToolBar` field is declared with
    `declare`. Constructing the group in the constructor body would need a
    "unless it already exists" check anyway, which is the guard again with extra
    steps.

[^blocker-stale]: `plans/directional-panel-navigation.md` is still in `plans/`,
    not `plans/implemented/`, and its `## Overview` describes *creating*
    `core/Focusable.ts` — a file that exists on master already, added by commit
    `f88e0fad`. `plans/implemented/spatial-focus-navigation.md:143` carries a
    decision heading reading "This supersedes the `directional-panel-navigation`
    plan", and `core/SpatialNavigation.ts:204` calls it "superseded" in a source
    comment. Slice 28's reviewer reached the same conclusion independently.

[^measured]: Counted with a throwaway probe under `.worktrees/_probes/` (the
    git-ignored probe area the render review used), running each widget under
    `jsdom` against the real selector engine and applying `findFocusable`'s own
    rules — descendants plus `root` itself, minus `disabled`, minus
    `isRenderedVisible` failures — once with today's selector string and once
    with the proposed one. The `ToolBar` figure of 2 is its own element's
    `tabindex="0"` (set at `ToolBar.ts:189`) plus the roving group's single
    active member; `MenuBar`'s 4 is its own element (`MenuBar.ts:94`) plus one
    per `MenuBarButton`, each a `<button>` carrying `tabindex="0"` from
    `Button.ts:778` and enrolled in no roving group.

[^two-widgets]: Neither is a selector problem, so neither can be fixed by this
    change. `MenuBar` builds plain `MenuBarButton`s at `MenuBar.ts:184-205` and
    never constructs a `RovingTabIndex`, so every button legitimately keeps
    `tabindex="0"`. `ToolBar` does rove its children, but also makes its own
    element a tab stop at `ToolBar.ts:189`, so the bar and its active member are
    two stops. Leaving both as `it.todo` with an accurate cause follows the
    convention the test file already sets for itself: a widget exposing more than
    one stop is a bug in that widget and gets its own plan rather than being
    patched in place.
