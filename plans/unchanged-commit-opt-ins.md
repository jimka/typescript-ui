---
depends-on: [unchanged-commit-skip-staged, w3-0-bounding-sweep]
touches-shared:
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/src/typescript/lib/core/Panel.ts
  - packages/lib/src/typescript/lib/layout/BoxLayout.ts
  - packages/lib/src/typescript/lib/layout/Grid.ts
  - packages/lib/src/typescript/lib/layout/Split.ts
  - packages/lib/docs/concepts/layout-system.md
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/docs/reference/migration/next.md
---

# Unchanged-Commit Opt-Ins, Stage 2 — Implementation Plan

## Overview

Wave 2 put the unchanged-commit skip on [`LayoutManager.commitBounds`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L588) behind the protected opt-in [`Component.canSkipUnchangedLayout()`](packages/lib/src/typescript/lib/core/Component.ts#L4374), and opted in only `MenuBar`, `ToolBar` and `Cell` ([`unchanged-commit-skip-staged`](plans/implemented/unchanged-commit-skip-staged.md)). A component that opts in, is handed the rectangle it already holds, and owes no pass is not re-laid-out, and neither is anything beneath it. W3.0's `g09.all` arm opted every class in and held geometry in every cell it ran, avoiding 27–97% of work ([`96-w3-0-bounding-sweep.md`](plans/research/render-review-2026-09-15/96-w3-0-bounding-sweep.md#L128)). That arm is a ceiling, not a plan.

This plan opts in four more classes: **`Panel`** (the class itself, not its subclasses), **`LabeledGrid`**, **`Header`** (and so `WindowHeader`, which extends it) and **`StatusBar`**. Measured offline on the QA app's own panels, these four capture **93% of the work `g09.all` avoided**, summed over the eight cells where it won. Every cell except the dock drag keeps 72–100% of its ceiling.

To pass the audit, the plan also closes the placement inputs that change a layout without announcing it: a child's `setDisplayed`, padding and border writes, `removeAllComponents`, 23 layout-manager setters, and three `Panel` scroll setters. Each now marks the pass as owed, as stage 1 already did for `setInsets`. The in-engine A/B in *Verification* is the acceptance gate. The offline suite is not.

---

## Architecture Decisions

### Opt in `Panel`, `LabeledGrid`, `Header` and `StatusBar`

These four classes carry nearly all of `g09.all`'s avoided work in the W3.0 cells.[^attribution] A skip happens at the top-most unchanged component, so the class that matters in each cell is the one sitting at the root of an unchanged subtree:

| Cell (W3.0) | Driver | Top-most skipped components under `g09.all` | Chosen set captures |
|---|---|---|---|
| `sdq`, `ssq` | settled pass on the shell | the centre `Panel`, the `StatusBar` | 100% |
| `sdr`, `ssr` | shell width resize | the weight-0 sidebar `Panel`; 12 toolbar `Button`s, 4 `MenuBarButton`s, the tab buttons | 72%, 74% |
| `fnq` | settled pass, nested form | the form's scrolling `Panel`, the inspector `Table` | 99% |
| `ffq` | settled pass, flat form | the two `LabeledGrid`s | 100% |
| `wq` | settled pass, bare window | the `WindowHeader` | 100% |
| `sdh` | dock gutter drag (S1) | 4 `TabButton`s, 4 page `Header`s | 19% |

The per-class breakdown and the method are in *Addendum: Attribution*.

### `Panel` opts in only as itself, not through its subclasses

`Panel.canSkipUnchangedLayout()` returns `Object.getPrototypeOf(this) === Panel.prototype`. This is the check [`Button`'s constructor](packages/lib/src/typescript/lib/component/button/Button.ts#L871) already uses to wire its `listeners` bag only for a plain `Button`. The `callable()` Proxy defeats `new.target`, but the instance's prototype still resolves to the raw class.[^panel-exact]

`LabeledGrid`, `Header` and `StatusBar` return `true` and let subclasses inherit, as `MenuBar` and `ToolBar` do. `WindowHeader` is the only library subclass among them, and its audit is part of `Header`'s.

### Every placement input that announces nothing marks the pass owed

An opted-in component is skipped when nothing marked it. Any write that changes how its subtree is placed, but schedules nothing, must therefore call `invalidateLayout()`. That call marks the component and every opted-in ancestor, without scheduling a frame. Stage 1 closed four such writers this way (`setInsets` / `clearInsets`, `setLayoutManager`, `sortComponents`, `LayoutManager.setLayoutConstraints`). This plan closes the rest the audit found:[^closures]

| Writer | Marks | Only on a real change? |
|---|---|---|
| `Component.setDisplayed` | the parent | yes — after the existing same-value early return |
| `Component.setPadding`, `setBorder` | itself | yes — after the existing same-value early return |
| `Component.clearPadding`, `clearBorder` | itself | yes — a new check; see *Internal Structure* |
| `Component.removeAllComponents` | itself | no — every call |
| 23 layout-manager setters (listed in step 4) | the manager's container | no — every call, as `setLayoutConstraints` does |
| `Panel.setAutoScroll`, `setScrollShadows`, `setScrollbarStyle` | itself | no — every call |

[`LayoutManager.setLayoutConstraints`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L663) is the pattern for the manager setters: `this.getContainer()?.invalidateLayout();`.

The closures also make `MenuBar` and `ToolBar` safer. Each bar's documented "not covered" list shrinks to one item.

### One caveat remains, as for the bars

A custom component whose intrinsic size changes without calling `setPreferredSize` or `notifyIntrinsicSizeChanged` is not re-flowed inside an opted-in ancestor until that ancestor moves or something schedules it. That caveat applies today to `MenuBar` and `ToolBar`. The plan documents it for the four new classes, and in a migration note for `Panel`.[^remaining]

### Theme changes and web-font swaps need no new mechanism

A theme switch or a font swap changes measured text sizes without moving any rectangle. The re-measure is covered anyway. The parent's size query reaches each `Text`, the re-measure fires the preferred-size relay, and that relay marks every ancestor dirty. Case E12 pins this.[^theme]

### What the fix keeps from the `g09.all` ablation, and what it changes

The ablation patched the root gate to answer `true` for every class ([`g09SkipUnchanged`](packages/qa/src/harness/ablations.ts#L934)). The fix keeps the ablation's gate and its point of engagement, the unchanged commit in `commitBounds`. So the same components skip in every cell where one of the four classes sits at the top of an unchanged subtree.

The fix changes four things:

- It uses per-class overrides instead of a root patch.
- `Panel` opts in only as itself.
- It closes the writers above, which the ablation could ignore for 150 units of one driver.
- It has no skip counter. Engagement shows as `doLayout@<Class>` counts falling, which the harness already records.[^vs-ablation]

The fix adds no per-instance state and no memory.

### Classes not opted in, and why

| Class | Work it carries in the W3.0 cells | Why not in this stage |
|---|---|---|
| `Button` family (`TabButton`, `MenuBarButton`, the toolbar `Button`s, 16 subclasses) | 81% of `sdh`'s ceiling; 29–31% of `sdr` / `ssr` | Not audited. Most of its ~40 content writers announce only to the parent, through `recomputePreferredSize`'s relay, and never mark the button. A pinned or stretched button committed unchanged would then withhold its own content pass unless every writer also changes a child. Checking that is the next stage's audit.[^buttons] |
| `Panel` subclasses (`ScrollStrip`, `Form`, `AbstractChart`, `DiagramView`, `MarkdownViewer`, `FloatingPanel`, …) | none beyond what `Panel` captures | `AbstractChart`, `DiagramView` and `MarkdownViewer` override `doLayout` (the chart repaint, the diagram's viewport anchor, the Markdown measure), and `ScrollStrip` keeps its own scroll resync. None has been audited. |
| `Container` | — | The base of nearly every class. Opting it in is the unrestricted form under another name (stage 1's *Non-Goals*). |
| `Table` | `fnq`'s last 1% | Has its own layout economy through `Cell` and `applyBounds`, pinned by six suites. |
| `Text`, `Tree`, `List`, `Dock`, `CodeEditor`, `AccordionHeader` | only under a `Panel` that now skips first | Not needed for any measured cell. `Text.setText` schedules only its parent (stage 1's *Non-Goals*). |

---

## Public API

No symbol is added or removed. Four classes gain a protected override:

```ts
class Panel<TOptions extends PanelOptions = PanelOptions> extends Container<TOptions> {
    protected canSkipUnchangedLayout(): boolean;   // Object.getPrototypeOf(this) === Panel.prototype
}
class LabeledGrid extends Container<LabeledGridOptions> {
    protected canSkipUnchangedLayout(): boolean;   // true
}
class Header<TOptions extends HeaderOptions = HeaderOptions> extends Container<TOptions> {
    protected canSkipUnchangedLayout(): boolean;   // true; WindowHeader inherits it
}
class StatusBar extends Container<StatusBarOptions> {
    protected canSkipUnchangedLayout(): boolean;   // true
}
```

The public methods in the closures table keep their signatures. Their documented behaviour gains one sentence each: the write marks the layout pass as owed.

---

## Internal Structure

`Panel`'s override, placed after `setScrollbarStyle` in [`core/Panel.ts`](packages/lib/src/typescript/lib/core/Panel.ts#L534). Its doc comment carries the writer audit, as [`Cell.canSkipUnchangedLayout`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L229) does:

```ts
protected canSkipUnchangedLayout(): boolean {
    return Object.getPrototypeOf(this) === Panel.prototype;
}
```

The `setDisplayed` closure goes directly after the existing early return in [`Component.setDisplayed`](packages/lib/src/typescript/lib/core/Component.ts#L2433):

```ts
if (this.isDisplayed() === v && this.getElement()) {
    return this;
}

// Entering or leaving the parent's laid-out children changes where the
// parent places its other children, and nothing here schedules that pass.
this.getParentComponent()?.invalidateLayout();
```

`clearPadding` and `clearBorder` have no same-value guard today, so each gets a narrow one around the new mark only. `Accordion.doLayout` calls `clearBorder()` on a non-themed host on every pass. An unconditional mark there would stop that host from ever skipping.

```ts
clearPadding(): this {
    const alreadyCleared = this._instanceStyle.padding === null;

    // ... the two existing writes, unchanged ...

    if (!alreadyCleared) {
        this.invalidateLayout();
    }

    return this;
}

clearBorder(): this {
    const changed = borderSidesKey(this._border) !== borderSidesKey({ border: "none" });

    // ... the three existing lines, unchanged ...

    if (changed) {
        this.invalidateLayout();
    }

    return this;
}
```

`borderSidesKey` is the module function at [`core/Component.ts:413`](packages/lib/src/typescript/lib/core/Component.ts#L413) that `setBorder` already compares with.

Each manager setter ends the same way, before `return this`:

```ts
setComponentSpacing(spacing: number): this {
    this._spacing = spacing || 0;
    this.getContainer()?.invalidateLayout();

    return this;
}
```

---

## Ordered Implementation Steps

Work test-first: step 1 writes the new cases, and each closure case must fail before its closure lands.

1. **Create `packages/lib/tests/core/UnchangedCommitOptIns.test.ts`** with every unit-testable case in *Expected Behaviour* (E1–E12). Copy `makeHost()` ([:211](packages/lib/tests/core/UnchangedCommitSkip.test.ts#L211)), `flatten()` and `geometryOf()` ([:428-445](packages/lib/tests/core/UnchangedCommitSkip.test.ts#L428)), and `install()` / `flushFrame()` ([:552-572](packages/lib/tests/core/UnchangedCommitSkip.test.ts#L552), the frame-capturing `requestAnimationFrame`) from `tests/core/UnchangedCommitSkip.test.ts`. For E12 copy `makeConfig()` / `widenFont()` from [`tests/component/tree/TreeFontReflow.test.ts`](packages/lib/tests/component/tree/TreeFontReflow.test.ts#L37). The `afterEach` must dispose every root it built and call `ThemeManager.setTheme(ModernTheme)`, because `setTheme` fires every live listener in the process ([`TextThemeReflow.test.ts`](packages/lib/tests/component/input/TextThemeReflow.test.ts#L1) explains why). The file header names this plan as the source of the case numbers. Check: run the file. E1–E8 fail. E9–E12 pass: they guard writers that already lay out, and must stay green once the opt-ins land.

2. **`core/Component.ts` — `setDisplayed`** ([:2433](packages/lib/src/typescript/lib/core/Component.ts#L2433)). Add the parent mark shown in *Internal Structure*, after the early return and before `setStyleState`. Extend the JSDoc with one sentence: a change marks the parent's layout pass as owed, because the parent's laid-out children changed. Do not `{@link}` anything `@internal`.

3. **`core/Component.ts` — padding, border, `removeAllComponents`.**
   - `setPadding` ([:2791](packages/lib/src/typescript/lib/core/Component.ts#L2791)): `this.invalidateLayout();` after `this.writeStyle({ padding });`.
   - `clearPadding` ([:2815](packages/lib/src/typescript/lib/core/Component.ts#L2815)) and `clearBorder` ([:3147](packages/lib/src/typescript/lib/core/Component.ts#L3147)): exactly as in *Internal Structure*.
   - `setBorder` ([:3166](packages/lib/src/typescript/lib/core/Component.ts#L3166)): `this.invalidateLayout();` after `this.writeStyle({ border: this._border });`.
   - `removeAllComponents` ([:7498](packages/lib/src/typescript/lib/core/Component.ts#L7498)): `this.invalidateLayout();` after the unwire loop. Reword its summary line to "Removes all child components and their DOM elements, marking the layout owed without scheduling it."
   - Each JSDoc gains the sentence "Padding / a border / the child list is a layout input, so the write marks the layout pass as owed." Leave `cacheBorderSpec` alone.

4. **The 23 layout-manager setters.** Add `this.getContainer()?.invalidateLayout();` as the last statement before `return this` in each. Add one sentence to each JSDoc: "Marks the container's layout pass as owed."

   | File | Setters (line) |
   |---|---|
   | `layout/BoxLayout.ts` | `setComponentSpacing` (202), `setItemAlign` (253), `setMode` (277), `setOverflowSizing` (303), `setJustify` (327). `setStretching` (228) delegates to `setItemAlign`; leave it alone. |
   | `layout/FlowLayout.ts` | `setComponentSpacing` (160), `setLineSpacing` (182), `setUniform` (269), `setAlign` (295), `setItemAlign` (322), `setJustify` (353) |
   | `layout/Grid.ts` | `setDefaultFill` (137), `setDefaultAnchor` (160), `setBaselineAlign` (186), `setRows` (206), `setComponentSpacing` (227), `setColumns` (247), `setColumnTracks` (268), `setRowTracks` (289) |
   | `layout/Fit.ts` | `setFill` (75) |
   | `layout/Border.ts` | `setComponentSpacing` (299) |
   | `layout/Split.ts` | `setOrientation` (733), `setPaneSize` (752) |

   Leave `Split.setPaneResizeWeight` alone: a weight bites only on a resize, which moves the rectangle.[^weight] Check: `grep -rn 'setComponentSpacing\|setItemAlign\|setJustify\|setRows\|setColumns\|setRowTracks\|setColumnTracks\|setPaneSize\|setFill(' packages/lib/src/typescript/lib --include=*.ts` shows no call inside any `doLayout` body. (The ones at `IconLabel.ts:108,182`, `ToolBar.ts:295`, `MenuBarButton.ts:155` and `LabeledGrid.ts:274-275` run from setters or constructors.)

5. **`core/Panel.ts` — the three scroll setters.**
   - `setAutoScroll` ([:399](packages/lib/src/typescript/lib/core/Panel.ts#L399)): `this.invalidateLayout();` directly after `this._autoScroll = mode;`. It must come before `setOverflowing`: when the overflow flags change, that call lays the panel out itself and clears the mark.
   - `setScrollShadows` ([:506](packages/lib/src/typescript/lib/core/Panel.ts#L506)) and `setScrollbarStyle` ([:534](packages/lib/src/typescript/lib/core/Panel.ts#L534)): `this.invalidateLayout();` before `return this`.
   - Each JSDoc gains: "The gutter and shadows are re-measured by a layout pass, so the write marks one as owed."

6. **The four opt-ins.** Each override has a doc comment in the shape of [`ToolBar`'s](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L615): what opts in, the writers and why each is covered, and the one remaining caveat. The per-class writer lists are in *Addendum: Writer Audit*; copy them.
   - `core/Panel.ts`: the override from *Internal Structure*, after `setScrollbarStyle`. Extend the class JSDoc ([:168](packages/lib/src/typescript/lib/core/Panel.ts#L168)) with one paragraph: a `Panel` itself, not a subclass, is not re-laid-out when its parent re-commits it at the rectangle it already holds with no pass owed; a subclass keeps being laid out on every commit unless it overrides the protected gate.
   - `component/container/LabeledGrid.ts` ([:80](packages/lib/src/typescript/lib/component/container/LabeledGrid.ts#L80)): `return true`, after `getColumns`.
   - `component/display/Header.ts` ([:45](packages/lib/src/typescript/lib/component/display/Header.ts#L45)): `return true`, after `getBaseline`. The comment also covers `WindowHeader`.
   - `component/container/StatusBar.ts` ([:103](packages/lib/src/typescript/lib/component/container/StatusBar.ts#L103)): `return true`, after the last public method.
   - Check: `grep -rn 'protected canSkipUnchangedLayout' packages/lib/src` lists 8 lines: the base, `Cell`, `MenuBar`, `ToolBar` and these four.

7. **`MenuBar.ts` and `ToolBar.ts` override comments** ([MenuBar :240-266](packages/lib/src/typescript/lib/component/menubar/MenuBar.ts#L240), [ToolBar :615-648](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L615)). Move `setDisplayed`, a manager reconfigured through `getLayoutManager()`, and padding or border into the covered list, "each marks the layout owed". The "Not covered" paragraph keeps only the custom-child intrinsic-size case.

8. **`tests/core/UnchangedCommitSkip.test.ts` — case 13's skip count** ([:150](packages/lib/tests/core/UnchangedCommitSkip.test.ts#L150)). Change `SHELL_SWEEP_SKIPS` to `SWEEP_FRAMES + 1 + 4 * SWEEP_FRAMES` (101). Extend its doc comment: each editor pane's scrolling `Panel` is now skipped on every frame of either sweep, four panes over twenty frames. Leave `BASELINE.geometry` untouched: both digests must still match. Check: `npx vitest run tests/core/UnchangedCommitSkip.test.ts` is green, and so is every other case in the file.

9. **Documentation**, per *Documentation Impact*.

10. **Run *Verification*'s offline checks.** Stop there. The in-engine A/B is the orchestrator's.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/tests/core/UnchangedCommitOptIns.test.ts` |
| Modify | `packages/lib/tests/core/UnchangedCommitSkip.test.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Panel.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/BoxLayout.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/FlowLayout.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Grid.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Fit.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Border.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Split.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/LabeledGrid.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/Header.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/StatusBar.ts` |
| Modify | `packages/lib/src/typescript/lib/component/menubar/MenuBar.ts` |
| Modify | `packages/lib/src/typescript/lib/component/menubar/ToolBar.ts` |
| Modify | `packages/lib/docs/concepts/layout-system.md` |
| Modify | `packages/lib/docs/components/Header.md` |
| Modify | `packages/lib/docs/components/StatusBar.md` |
| Modify | `packages/lib/docs/components/LabeledGrid.md` |
| Modify | `packages/lib/docs/components/MenuBar.md` |
| Modify | `packages/lib/docs/components/ToolBar.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/docs/reference/migration/next.md` |

---

## Expected Behaviour

E1–E12 are unit-testable under the modelled DOM. "Settled" means the scene was laid out four times at its box. "Plain" means the same scene with `canSkipUnchangedLayout` spied to `false` on the four new prototypes. A "position" is the visual one, `getX() + getTranslateX()` and `getY() + getTranslateY()`, as `geometryOf` reads it: a size-stable move commits through the translate fast path, so `getY()` alone keeps its old value. E13 is the updated case 13. E14 is in-engine only.

**E1. Who opts in.** On a rendered, settled instance, `canSkipUnchangedCommit()` is:

| Instance | Answer |
|---|---|
| `new Panel({ layoutManager: VBox() })` | `true` |
| `new LabeledGrid()`, `new Header("T")`, `new WindowHeader("T")`, `new StatusBar()` | `true` |
| `new Form()`, `new ScrollStrip()` (library `Panel` subclasses) | `false` |
| `new (class LocalPanel extends Panel {})()` | `false` |
| `new LabeledFieldSet()` (composes a `LabeledGrid`; is not one) | `false` |

**E2. A settled repeat pass stops at the four classes.** The scene is a `Container` root with `Border({ spacing: 0 })` at 800×600. It holds `Header("Title")` NORTH, a `Panel` with `VBox` CENTER, and `StatusBar({ defaultMessage: "Ready" })` SOUTH. The `Panel` holds a `LabeledGrid({ columns: 1 })` of two `TextField`s ("Name", "City") and `Text("Notes")`. That is 13 components. A second `root.doLayout()` makes **3** commits, all skipped, and calls `doLayout` once (the root's). Plain makes 12 commits and 13 `doLayout` calls. Every rectangle equals the first pass's in both arms.

**E3. A pass owed below still runs.** In E2's scene, `grid.invalidateLayout()` then `root.doLayout()` lays out the `Panel` and the `LabeledGrid`, and the `Header` and `StatusBar` stay skipped.

**E4. `setDisplayed` marks the parent.** A `Panel` with `VBox({ spacing: 0 })` and its insets cleared holds two rendered leaves `a` and `b` (`Component`s with `preferredSize` 100×20). It sits under a `Fit` root 400×200, and is settled.

| Step | `b`'s y after `root.doLayout()` | `panel.canSkipUnchangedCommit()` before the pass |
|---|---|---|
| `a.setDisplayed(false)` | 0 (was 20) | `false` |
| `a.setDisplayed(false)` again, after a settling pass | 0 | `true` — the same-value call marked nothing |
| `a.setDisplayed(true)` | 20 | `false` |

Without step 2 the first row reads 20. This is the break found on the shell's sidebar: hiding the Outline list left the Files tree at its old height.

**E5. Padding and border mark the owner.** Padding offsets the children. A border does not move them, because a child's coordinates start inside the border, but it shrinks the content box. So the border rows use a second scene: a `Panel` with `Fit`, insets cleared, over one leaf, under the same 400×200 `Fit` root.

| Scene | Step | Child after `root.doLayout()` | Marked? |
|---|---|---|---|
| E4's | `panel.setPadding(new Insets(10, 10, 10, 10))` | `a` at (10, 10), `b` at (10, 30) | yes |
| E4's | the same `setPadding` again | unchanged | no — the existing early return |
| E4's | `panel.clearPadding()` | `a` at (0, 0) | yes |
| E4's | `panel.clearPadding()` again | unchanged | no |
| `Fit` | `panel.setBorder("5px solid red")` | the leaf 390×190 (was 400×200) | yes |
| `Fit` | `panel.clearBorder()` | the leaf 400×200 | yes |
| `Fit` | `panel.clearBorder()` again | unchanged | no |

"Marked" is `panel.isLayoutDirty()` read right after the call, following a settling pass.

**E6. `removeAllComponents` marks.** On a settled rendered `Container`, `removeAllComponents()` leaves `isLayoutDirty()` `true`.

**E7. Every listed manager setter marks its container.** A table-driven case, one row per setter in step 4. Build the manager, attach it to a rendered `Container` holding two leaves, `doLayout()`, check `isLayoutDirty()` is `false`, call the setter with a value other than the current one, and check it is `true`. One geometry row as well, in a fresh E4 scene: after `vbox.setComponentSpacing(10)` and `root.doLayout()`, `b`'s y is 30 (was 20). Without step 4 it stays 20.

**E8. `Panel`'s scroll setters mark.** On a settled rendered `Panel`, each of `setAutoScroll("both")` (from `"none"`), `setScrollShadows(false)` and `setScrollbarStyle("native")` leaves `isLayoutDirty()` `true`.

**E9. `Header` and `WindowHeader` writers still lay out.** In E2's scene, `header.getText().setText("A much longer title")` then `flushFrame()` leaves the label wider than before the call. On a settled `WindowHeader("T")` under a `Fit` root, `setGlyph("xmark")` then `flushFrame()` gives the glyph a non-zero width, and moves the title `Text`'s x right by at least the glyph's width.

**E10. `StatusBar` writers still lay out.** In E2's scene, `setMessage("Saved 42 files")` then `flushFrame()` leaves the message `Text` wider than before the call. `addRight(new Text("Ln 1"))` then `flushFrame()` gives the new widget a non-zero width and an x greater than the message's right edge.

**E11. `LabeledGrid.addField` still lays out.** In E2's scene, `grid.addField("Zip", new TextField())` then `flushFrame()` places the new field below "City": its y is greater than City's.

**E12. A web-font swap re-measures through the skip.** Take E2's scene with a cloned font table. Settle it. Double every advance (`widenFont`) and call `ThemeManager.setTheme(ThemeManager.getTheme())`. After `root.doLayout()`:

- Every rectangle equals plain's after the same steps.
- At least one rectangle differs from before the swap: the label column widens, so the fields' x moves. This guards against a test that passes because nothing moved.

**E13. Case 13 holds its geometry.** Both shell sweeps skip 101 commits: 21 for the bars, as before, and 80 for the four editor-pane scrolling `Panel`s over 20 frames. Both geometry digests equal the pre-change baselines.

**E14. In-engine (manual, the orchestrator's).** The A/B in *Verification*. Geometry is `=` in every run, and the saving is of the order the table there lists.

---

## Verification

From `packages/lib` (implementer):

- `npm run typecheck`, `npm run typecheck:test`, `npm run lint`, `npm run test:lint` — clean.
- `npm test` — green, with E1–E13 and every stage-1 case in `UnchangedCommitSkip.test.ts`, `ComponentBounds.test.ts`, `CellLayoutSkip.test.ts` and `HeaderColumnWindow.test.ts`. **The suite is not the gate.** The closures and all four opt-ins, applied at runtime over this checkout, left all 8,036 tests green except case 13's skip count. A wrong gate passes too.
- `npm run build:lib`, then `(cd ../qa && npm test)` — the QA panels still mount under jsdom. This opens no window.
- `npm run docs:api` — the 14 pre-existing warnings and no new one. `npm run docs:llms:check` — clean.
- `grep -rn 'protected canSkipUnchangedLayout' src` — 8 lines (step 6).
- Mutation checks, one at a time, each reverted: dropping step 2's line fails E4's first row; dropping any of step 3's marks fails its E5 or E6 row; dropping a manager setter's mark fails its E7 row; dropping a step-5 mark fails E8; dropping `clearBorder`'s or `clearPadding`'s guard fails E5's "again" row; making `Panel`'s check `return true` fails E1's subclass rows.

**In-engine A/B — the acceptance gate. The orchestrator runs it, never the implementer.** Every run opens a full-screen MiniBrowser window.

Arms. `wt` is the library at the commit the implementation branch forked from (`11ad15eb` if nothing else lands first; the implementation notes record the actual SHA). `main` is the implementation branch with its `packages/lib` built. Build the base with the README recipe ([`packages/qa/README.md:86`](packages/qa/README.md#L86)), from the repository root of the checkout that holds the fix:

```sh
git worktree add .worktrees/_g09-base <base-sha> --detach
ln -sfn "$PWD/node_modules" .worktrees/_g09-base/node_modules
(cd .worktrees/_g09-base/packages/lib && npm run build:lib)
(cd packages/lib && npm run build:lib)
export QA_WT_LIB="$PWD/.worktrees/_g09-base/packages/lib"
```

The sweep, in the style of [`packages/qa/sweeps/w3-0.sh`](packages/qa/sweeps/w3-0.sh). Save it outside the repository and run it from the repository root: `bash g09-opt-ins-ab.sh --dry-run` first, then `bash g09-opt-ins-ab.sh`. Each cell is `wt-a, main-1, wt-b, main-2, wt-c`, so the fix is bracketed by the base at both ends. That is 13 cells and 65 runs, about 20–25 minutes.

```bash
#!/bin/bash
# G09 stage-2 opt-ins, in-engine A/B: bash g09-opt-ins-ab.sh [--dry-run] [<cell> ...]
#
# Every run opens a full-screen window and holds it until the run ends. The
# orchestrator runs this with the user's go-ahead; an implementer never does.
# Run from the repository root of the checkout holding the fix, with its
# packages/lib built (the main arm) and QA_WT_LIB set to a built packages/lib
# at the plan's base commit (the wt arm). --dry-run opens nothing.
set -u
RUNQA=packages/qa/runqa.sh
SESSION=${G9_SESSION:-s1}
FLAGS='work=1&seam=1&geom=1'

# Scored: the W3.0 cells where g09.all won. Gate-only: cells where a closure or
# an opt-in engages on another path (a pane collapse, a theme switch, a field
# error), read for geometry alone.
CELLS="sdh sdr ssr sdq ssq fnq ffq wq sdt sst sd4m ss4m ffy"

# Prints a cell's query parameters, exactly as W3.0's matrix ran them.
params() {
    case "$1" in
        sdh)  echo 'panel=shell-deep&drive=drag' ;;
        sdr)  echo 'panel=shell-deep&drive=resize' ;;
        ssr)  echo 'panel=shell-shallow&drive=resize' ;;
        sdq)  echo 'panel=shell-deep&drive=passes' ;;
        ssq)  echo 'panel=shell-shallow&drive=passes' ;;
        fnq)  echo 'panel=form-nested&passes=form&drive=passes' ;;
        ffq)  echo 'panel=form-flat&passes=form&drive=passes' ;;
        wq)   echo 'panel=windows&drive=passes' ;;
        sdt)  echo 'panel=shell-deep&toggle=pane&drive=toggle:120' ;;
        sst)  echo 'panel=shell-shallow&toggle=pane&drive=toggle:120' ;;
        sd4m) echo 'panel=shell-deep&n=4&drive=theme:10' ;;
        ss4m) echo 'panel=shell-shallow&n=4&drive=theme:10' ;;
        ffy)  echo 'panel=form-flat&type=text&drive=type' ;;
        *)    return 1 ;;
    esac
}

MODE=run
if [ "${1:-}" = --dry-run ]; then
    MODE=dry
    shift
fi

selected=${*:-$CELLS}

for c in $selected; do
    params "$c" > /dev/null || { echo "unknown cell $c (cells: $CELLS)" >&2; exit 2; }
done

if [ "$MODE" = run ]; then
    [ -f packages/lib/dist/lib/core.es.js ] || { echo "build packages/lib first" >&2; exit 2; }
    [ -f "${QA_WT_LIB:-/nonexistent}/dist/lib/core.es.js" ] || { echo "set QA_WT_LIB to a built packages/lib at the base commit" >&2; exit 2; }
fi

# One run: printed under --dry-run, otherwise run, stopping at the first failure.
run() {
    if [ "$MODE" = dry ]; then
        printf 'runqa %s %s %s\n' "$1" "$2" "$3"
    else
        "$RUNQA" "$1" "$2" "$3" || exit 1
    fi
}

for c in $selected; do
    p="$(params "$c")&$FLAGS"
    run "g9$SESSION-$c-wt-a"   wt   "$p"
    run "g9$SESSION-$c-main-1" main "$p"
    run "g9$SESSION-$c-wt-b"   wt   "$p"
    run "g9$SESSION-$c-main-2" main "$p"
    run "g9$SESSION-$c-wt-c"   wt   "$p"
done
```

**Reading.** Per cell, run `python3 packages/qa/bin/qa-table.py packages/qa/results g9s1-<cell>- --work`. Its `geom` column compares each run with `wt-a`. Apply W3.0's rule by hand ([`w3-0-bounding-sweep.md`](plans/implemented/w3-0-bounding-sweep.md#L114), *The decision rule*):

- **bracket** is the largest `wt` average minus the smallest.
- **Δms** is the mean of the two `main` averages minus the mean of the three `wt` averages. It is a win below −bracket and a regress above +bracket.
- **Δwork** is `main` work/u minus `wt` work/u. Counts are deterministic per build, so the three `wt` runs of a cell read alike, and so do the two `main` runs.[^no-qa-ab]

**Expected readings, scored cells.** The `wt` column is W3.0's plain reading, valid when the base carries no other wave-3 change. The `main` column applies the offline capture fraction to W3.0's ceiling. The engagement counters come from `--work`.

| Cell | `wt` work/u | `main` work/u ≈ | Δwork | Engagement (`wt` → `main`, per unit) | `wt` ms | `main` ms ≈ |
|---|---|---|---|---|---|---|
| `sdh` | 872 | 826 | −5% — work `flat` by the 10% bar, as expected | `doLayout@Header` 4 → 0 | 60.3 | flat |
| `sdr` | 6,656 | 3,175 | −52% | `doLayout@SelectableListRow` 60.4 → 0; `doLayout@Panel` 13.1 → 11.0 | 69.3 | −2 to −3.5 (`g09.all`: −3.65) |
| `ssr` | 5,833 | 2,355 | −60% | as `sdr`; `doLayout@Panel` 7.1 → 5.0 | 61.8 | −1.5 to −2.2 (`g09.all`: −2.16) |
| `sdq` | 4,938 | 157 | −97% | `doLayout@Panel` 13 → 1, `@Header` 4 → 0, `@StatusBar` 1 → 0 | 2.78 | ≈ 0.15 |
| `ssq` | 4,120 | 157 | −96% | `doLayout@Panel` 7 → 1, `@StatusBar` 1 → 0 | 2.16 | ≈ 0.13 |
| `fnq` | 13,550 | 2,210 | −84% | `doLayout@LabeledGrid` 9 → 0, `@TextField` 16 → 0, `@Panel` 2 → 1 | 7.09 | ≈ 0.7–0.8 |
| `ffq` | 11,747 | 1,887 | −84% | `doLayout@LabeledGrid` 2 → 0, `@TextField` 16 → 0 | 5.35 | ≈ 0.6 |
| `wq` | 521 | 89 | −83% | `doLayout@WindowHeader` 1 → 0 | 0.26 | ≈ 0.08 |

**Pass criteria:**

1. `geom` is `=` for every run of all 13 cells. `wt-b` and `wt-c` also read `=`; a cell whose `wt` runs disagree is unstable and is re-run.
2. Every scored cell except `sdh` lands within 10% of its `main` work/u estimate (the estimates carry the few-percent gap between offline and engine counts), and its engagement counters move as listed.
3. No scored cell's `ms` is `regress`. The five passes cells read `win`.
4. The gate-only cells (`sdt`, `sst`, `sd4m`, `ss4m`, `ffy`) carry no work or time expectation. A `regress` there is reported with its size.

A geometry `DIFF` anywhere stops the plan until the writer behind it is found and closed. Narrowing the opt-in list until the symptom goes away is not a fix. That is stage 1's rule. Record the readings in the implemented plan's *Implementation Notes*.

---

## Documentation Impact

- **[`docs/concepts/layout-system.md`](packages/lib/docs/concepts/layout-system.md#L31), *The write is diffed*.**
  - Add the new placement inputs to the "announce nothing" sentence: a child's `setDisplayed`, `setPadding` / `clearPadding`, `setBorder` / `clearBorder`, `removeAllComponents`, the configuration setters of the box, flow, grid, fit and border managers, and `Split.setOrientation` / `setPaneSize`.
  - Replace "The table's cells, `MenuBar` and `ToolBar` opt in" with the full list: `Panel` itself (not its subclasses), `LabeledGrid`, `Header` and `WindowHeader`, `StatusBar`, `MenuBar`, `ToolBar` and the table's cells.
  - Add one sentence: a custom component that changes its intrinsic size must say so through `setPreferredSize` or `notifyIntrinsicSizeChanged`, or its opted-in ancestors will not re-flow it.
- **`docs/components/Header.md`, `StatusBar.md`, `LabeledGrid.md`.** Add a `## Notes` section before `## See also` with one bullet in the shape of `MenuBar.md`'s last note. The bullet says the component is not re-laid-out when re-committed at its rectangle, names its own writers that still lay it out (from *Addendum: Writer Audit*), and states the custom-child caveat. `Header.md`'s bullet also covers `WindowHeader`.
- **`docs/components/MenuBar.md:60` and `ToolBar.md:104`.** Rewrite the caveat as in step 7: only the custom-child intrinsic-size case still needs `bar.scheduleLayout()`.
- **`docs/reference/changelog/next.md`.**
  - *Breaking changes → Core*: a bullet for `Panel`, linking the migration note.
  - *Changed → Components*: one bullet for `LabeledGrid`, `Header` / `WindowHeader` and `StatusBar`.
  - *Changed → Core*: one bullet for the new owed-pass marks (`setDisplayed`, padding, border, `removeAllComponents`).
  - *Changed → Layouts*: one bullet for the manager setters.
  - Edit the existing `MenuBar` / `ToolBar` bullet ([:160](packages/lib/docs/reference/changelog/next.md#L160)) so its caveat names only the custom-child case.
- **`docs/reference/migration/next.md`.** A new section, "A `Panel` re-committed at its own rectangle is not re-laid-out", in the page's *What changed and why* / *Who needs to act* shape. *Who needs to act*: code that changes a component's intrinsic size inside a plain `Panel` without `setPreferredSize` or `notifyIntrinsicSizeChanged`, and relied on some later, unrelated layout pass to pick it up. The fix is to call `notifyIntrinsicSizeChanged()`, or `scheduleLayout()` on the component.
- **`Panel`'s class JSDoc**, which renders on its API page: the paragraph in step 6.
- **No export, barrel, `llms.txt` or sidebar change.** The overrides are `protected` and render nowhere. `scripts/llms/check-coverage.mjs` tracks classes, not methods.

---

## Potential Challenges

- **The exact-class check.** Compare `Object.getPrototypeOf(this)` with `Panel.prototype`, as `Button` does. `instanceof` would opt every subclass in, and `new.target` is the `callable()` Proxy.
- **The `setDisplayed` mark belongs after the early return.** Placed before it, every same-value call marks the parent and costs a skip.
- **`clearBorder` / `clearPadding` without their new guards.** A non-themed `Accordion` host would then never skip, and neither would its opted-in ancestors, silently. E5's "again" rows catch it.
- **Manager setters called from a layout pass.** None are today (step 4's check). A future call from inside a `doLayout` would keep its container permanently marked. Keep the grep in the checklist.
- **E12's theme state leaks between tests.** Clone the font table per test, dispose every root, and restore `ModernTheme` in `afterEach`.
- **`docs:api` links.** `invalidateLayout` is public and may be linked. `canSkipUnchangedCommit` and `markPassOwedAbove` are `@internal` and must be described in prose.

---

## Critical Files

- [`plans/implemented/unchanged-commit-skip-staged.md`](plans/implemented/unchanged-commit-skip-staged.md) — the contract, stage 1's closures, and its *Implementation Notes* (the owed-pass helper `markPassOwedAbove`, and the flush that stops pruning at a skippable link).
- [`core/Component.ts:4327-4426`](packages/lib/src/typescript/lib/core/Component.ts#L4327) — `applyBounds`, `canSkipUnchangedLayout`, `canSkipUnchangedCommit`, `markPassOwedAbove`; [`:7886`](packages/lib/src/typescript/lib/core/Component.ts#L7886) `invalidateLayout`; [`:262-300`](packages/lib/src/typescript/lib/core/Component.ts#L262) the batched flush, whose ancestor walk stops at a skippable link.
- [`layout/LayoutManager.ts:588-640`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L588) — `commitBounds` and the gate; [`:663`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L663) `setLayoutConstraints`, the precedent for the manager setters.
- [`component/menubar/ToolBar.ts:615-648`](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L615) and [`component/table/cell/Cell.ts:229-258`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L229) — the override doc-comment shape.
- [`component/button/Button.ts:862-873`](packages/lib/src/typescript/lib/component/button/Button.ts#L862) — the exact-class check.
- [`core/Panel.ts:168-330`](packages/lib/src/typescript/lib/core/Panel.ts#L168) — the class comment, the scroll setters, `doLayout`.
- [`tests/core/UnchangedCommitSkip.test.ts`](packages/lib/tests/core/UnchangedCommitSkip.test.ts) — helpers, case 13, and the forced-on arm (case 12).
- [`packages/qa/src/harness/ablations.ts:921-970`](packages/qa/src/harness/ablations.ts#L921) — the `g09.all` ablation this plan replaces.
- [`plans/research/render-review-2026-09-15/96-w3-0-bounding-sweep.md`](plans/research/render-review-2026-09-15/96-w3-0-bounding-sweep.md#L128) — the measured ceiling.
- [`ARCHITECTURE.md`](ARCHITECTURE.md), *Size constraints: who is responsible for what* — a withheld pass must never leave a child placed against a rectangle it no longer holds.

---

## Non-Goals

- **The `Button` family.** It is the next stage: 81% of the dock drag's ceiling and about a quarter of the resize cells', behind an audit of 16 subclasses.
- **`Panel` subclasses, `Container`, `Table`, `Tree`, `List`, `Dock`, `CodeEditor`.** Each needs its own audit, and no measured cell needs it once `Panel` skips.
- **Flipping the base default.** The staged contract stands: each opt-in is bought with an audit.
- **Making `Text` announce a re-measure upward**, and a gate in `TabBar.placeStrip`. Both are stage 1's non-goals, for the same reasons.
- **Teaching `qa-ab.py` to score a build arm.** The A/B is read with `qa-table.py`.[^no-qa-ab]
- **Committing the A/B script.** It verifies this plan once. W3.0's script was committed because the sweep was the deliverable.
- **`Panel`'s settled-pass remeasure gate (G16) and `resolveBounds`' size reads (G05).** Separate plans. A skipped `Panel` already runs neither.

---

## Addendum: Attribution

**Method.** The W3.0 JSON gives each cell's work per class but not which component skipped. A probe therefore mounted the QA app's own builders (`buildShell`, `buildForm`) in the library's modelled DOM at the sweep's viewport (5120×2075). It drove each cell's unit for 20 units: `passes` as `root.doLayout()`; `resize` as ±3 px width steps; the dock drag as `Split.onDrag` on the vertical dock split, ±3 px. It counted the six methods that make up nearly all of the harness's `work` count (`doLayout`, the three size hints, `beginSizeHintRecord`, `getLaidOutComponents`), under each opt-in set applied to the prototypes at runtime, and compared every rectangle with plain.

Offline counts track the engine's: plain `sdq` 4,734 against 4,938, `fnq` 13,377 against 13,550, `sdr` 6,397 against 6,656. The windows panel mounts outside `Body` and was not probed. Its figure is W3.0's in-engine `g09.chrome` arm (Header and StatusBar only), which avoided all of `g09.all`'s work there (521 → 89).

**Work avoided per unit, by opt-in set.** Geometry was `=` for every set in every cell.

| Cell | Offline plain | `g09.all` ceiling | `Panel` (exact) | `LabeledGrid` | `Header`+`StatusBar` | `TabButton` | `Button` family | **Chosen four** | **% of ceiling** |
|---|---|---|---|---|---|---|---|---|---|
| `sdh` | 836 | 228 | 0 | 0 | 44 | 184 | 184 | 44 | 19% |
| `sdr` | 6,397 | 4,648 | 3,331 | 0 | 0 | 184 | 1,449 | 3,331 | 72% |
| `ssr` | 5,617 | 4,504 | 3,331 | 0 | 0 | 46 | 1,311 | 3,331 | 74% |
| `sdq` | 4,734 | 4,579 | 4,540 | 0 | 83 | 184 | 328 | 4,579 | 100% |
| `ssq` | 3,954 | 3,799 | 3,760 | 0 | 50 | 46 | 190 | 3,799 | 100% |
| `fnq` | 13,377 | 11,310 | 11,194 | 9,386 | 0 | 0 | 1,909 | 11,194 | 99% |
| `ffq` | 11,658 | 9,778 | 0 | 9,778 | 0 | 0 | 1,856 | 9,778 | 100% |
| `wq` (engine) | 521 | 432 | — | — | 432 | — | — | 432 | 100% |
| **Sum** | | **39,278** | | | | | | **36,488** | **93%** |

Weighting the same fractions by W3.0's in-engine ceilings gives 37,379 of 40,285, also 93%. Adding the whole `Button` family would bring the set to 99.8%. The extra 2,709 per unit sits almost entirely in `sdr`, `ssr` and `sdh`.

**The closures change none of these numbers.** With every closure applied, the chosen set avoided the same work in every cell.

---

## Addendum: Writer Audit

What each opted-in class's layout reads, and how each change to it reaches a pass. "Relays" means the preferred-size relay (`setPreferredSize` → the parent's `scheduleLayout()` → every ancestor's). "Own pass" means the change queues the component or a descendant, and the batched flush keeps that pass because it stops pruning at a skippable link (stage 1, step 4).

**Every class (the generic writers).**

- Adding, inserting, removing or moving a child schedules the container, and relays.
- `setInsets` / `clearInsets`, `setLayoutManager`, `sortComponents` and `setLayoutConstraints` mark it owed (stage 1).
- A child's `setDisplayed`, the container's padding and border, `removeAllComponents`, and the listed manager setters mark it owed (this plan).
- A descendant's `invalidateLayout`, first-layout drain or fast-path move marks every opted-in ancestor (stage 1's `markPassOwedAbove`).
- A `Text` descendant's text or font change schedules its parent (own pass). A size change it causes relays.
- A theme switch or font swap: the ancestors' size queries reach each `Text`, whose re-measure relays (E12).

**`Panel` (a plain instance).** Its own inputs beyond the generic ones:

- `autoScroll`, `scrollShadows` and `scrollbarStyle` mark it owed (step 5).
- The scroll gutter and shadows are re-measured by its own pass. A gutter change schedules the panel. A content shrink schedules it (`scheduleGutterSettleOnShrink`). A return to visibility schedules it (`onEffectiveVisibilityChange`). The resize-settle relay calls the remeasure directly.
- The inner overlay scroller is sized from the panel's own box, which a skip by definition did not change.
- A `Split`, `Border`, `Accordion`, `Tab` or `Card` it hosts announces its own state changes, through `scheduleLayout`, `doLayout` or its host relayout. The two `Split` setters that did not are closed in step 4.

**`LabeledGrid`.**

- `addField`, `addRow` and `addFullWidthRow` add children (schedule, relay). The grid-shape setters they call (`setRows`, `setRowTracks`) now mark it too.
- Description tooltips attach without layout.

**`Header`.**

- `getText().setText(...)` and the font setters schedule the header (own pass).
- The theme subscription calls `updatePreferredSize` → `setPreferredSize` (relays).

**`WindowHeader`**, which inherits `Header`'s opt-in.

- `setGlyph` / `clearGlyph` insert or remove in the title row (own pass, then relay).
- `setMinimizable` / `setMaximizable` use `setVisible`, which keeps the layout slot.
- `setActive` and `setCloseable` are style or enabled state only.
- The control buttons' glyph swaps relay.

**`StatusBar`.**

- `setMessage`, `clearMessage` and the timed revert set the message `Text` (own pass, relay on a width change).
- `addLeft` / `addRight` / `removeLeft` / `removeRight` add or remove children.
- A widget's own intrinsic change must relay (the remaining caveat).

---

## Notes

[^attribution]: `g09.all` records one skip counter per arm, not per class, so the per-class work (`doLayout@<Class>` and the size-hint keys) only shows which work disappeared, not who withheld it. The skip happens at the top-most component whose commit is unchanged, and everything beneath it disappears with it. So the class that captures a cell's work is the class of that top-most node, not the classes whose counters fall. The probe in *Addendum: Attribution* recorded the skipping instances directly, and then measured each candidate set. The table's "top-most skipped" column is that probe's list. W3.0's per-class counters agree with it: in `sdq`, `doLayout@Panel` falls 13 → 1 and `doLayout@StatusBar` 1 → 0 under `g09.all`, and nothing below them is laid out.

[^panel-exact]: `Panel`'s class comment tells consumers to use it as the base class for grouped containers, and eleven library classes extend it: `ScrollStrip`, `AbstractChart`, `DiagramView`, `MarkdownViewer`, `FloatingPanel`, `Form`, `ChartLegend`, `DiagramNode`, `DiagramGroupNode`, `MarkdownContentPane` and `PickerCellList`. Three override `doLayout`, and others keep layout state of their own (`ScrollStrip`'s scroll resync, `FloatingPanel`'s anchoring). An inherited opt-in would make each of them, and every consumer subclass, skip on the strength of an audit of `Panel` alone. The exact-class check confines the claim to the class that was audited, and a subclass opts in by overriding the gate after its own audit. The measured work needs nothing more: every `Panel` the W3.0 cells skip is a plain `Panel`. `LabeledGrid`, `Header` and `StatusBar` have no library subclass except `WindowHeader`, which was audited, so they follow `MenuBar` / `ToolBar` and inherit.

[^closures]: Each closure was found by reading the four classes' layout inputs, then shown by a runtime probe over this checkout. Hiding the shell sidebar's Outline list with the `Panel` opt-in alone left the Files tree at 1,775 px against plain's 1,934, because nothing re-laid-out the sidebar. With the `setDisplayed` closure the geometry matched plain. `Split.setPaneSize` is documented public API ("Seed or override a pane's stored main-axis size") that writes a map entry and nothing else. Behind an opted-in host, an unrelated ancestor pass would no longer apply it. The other manager setters are the same bare field writes, and stage 1 listed "a manager reconfigured through `getLayoutManager()`" as uncovered for the bars. Padding and border feed `getPerimeterSize`, which every manager places children inside, and stage 1 listed them as uncovered too. Stage 1 rejected marking on every resolved-style change, because `Border` calls `setVisible` on each region after committing it. Marking in the four setters after a real change does not have that cost. `removeAllComponents` is documented as "without triggering layout", and an emptied scrolling `Panel` would otherwise keep its gutter and shadows. Applied at runtime, all the closures together left the whole suite green (8,036 tests), and left every probed cell's work and geometry unchanged. Unconditional marks in the manager setters follow `setLayoutConstraints`. No library code calls them from inside a layout pass.

[^remaining]: The relay is the only way the framework learns a leaf's intrinsic size changed. A component that re-renders foreign content (its own DOM, a canvas) and changes size without calling `setPreferredSize` or `notifyIntrinsicSizeChanged` is invisible to every mark. Before this plan it was picked up by whichever unrelated pass next reached it. `MenuBar` and `ToolBar` already carry this caveat. Closing it would mean relaying from `Text` and every foreign-DOM leaf. Stage 1 measured that at 39 test failures and left it to its own plan.

[^theme]: A font swap was modelled as in `TreeFontReflow.test.ts`, by doubling every advance in a cloned font table and calling `ThemeManager.setTheme` with the current theme, on `shell-deep`, `form-flat`, `form-nested` and E2's scene. With each of the four classes opted in, with all four together (E2's scene), and with every class forced on, every rectangle equalled plain's after the swap, although the swap moved 134 of 165 rectangles in the shell and 240 of 403 in the flat form. The re-measure reaches the leaves because a parent's layout asks its children's size hints. The size-hint memo is dropped by the `scheduleLayout` the theme reflow makes. Each `Text` re-measures on that query, and the changed size relays up and marks every ancestor. A per-component "laid out at metrics generation N" check in the gate was considered. It is not needed on this evidence, and it would change the gate `Cell` already shares.

[^vs-ablation]: The ablation could ignore invalidation because a sweep drives one gesture 150 times and never hides a child, re-pads a panel or reconfigures a manager mid-run. Geometry held in its cells because those writers never ran, not because they were covered. A shipped opt-in meets them in real code, so the closures are the difference between the prototype and the fix. The ablation also opted in every class, subclasses included. That is why its ceiling includes the `Button` family's share, which this plan leaves for the next stage.

[^buttons]: `Button.recomputePreferredSize` pushes the new size through `super.setPreferredSize`, whose relay schedules the parent and its ancestors, never the button. A button whose rectangle does not move with its content — a stretched toolbar or tab button, or one with a consumer `preferredSize`, where `recomputePreferredSize` returns early — then depends on the content change also scheduling one of the button's own children. The glyph and label paths do, through `addComponent` and `Text.setText`. Whether every one of the roughly 40 writers across `Button`, `ToggleButton`, `TabButton`, `MenuBarButton`, `SpinButton`, `PickerButton` and their siblings does, `setWritingMode` and `setTextAlign` among them, is the audit this stage does not do.

[^weight]: [`docs/layouts/Split.md`](packages/lib/docs/layouts/Split.md#L138): "A toggle produces no immediate visual change — the pin only bites on the next container resize." A resize moves the host's rectangle, which is never skipped.

[^no-qa-ab]: `qa-ab.py` accepts only the arm `plain` and arms named by the report's `abl=`, and it reads engagement from an arm's own `skipped.` / `memo.` counters. A library build arm has neither. The arithmetic for one arm and five runs is short, and the engagement signal is the `doLayout@<Class>` counters `--work` already lists, so extending the analyser for a single A/B would add tooling and tests for no new information.
