---
depends-on: [w3-0-bounding-sweep, unchanged-commit-opt-ins]
touches-shared:
  - packages/lib/src/typescript/lib/layout/Split.ts
  - packages/lib/src/typescript/lib/layout/Border.ts
  - packages/lib/docs/layouts/Split.md
  - packages/lib/docs/layouts/Border.md
  - packages/lib/docs/concepts/performance.md
  - packages/lib/docs/reference/changelog/next.md
  - packages/qa/README.md
---

# Split Collapse Static Participants — Implementation Plan

## Overview

When a `Split` pane or a `Border` edge region collapses or expands, [`runCollapse`](packages/lib/src/typescript/lib/layout/CollapseSupport.ts#L454) lays the post-toggle state out once — the **end layout**, `container.doLayout()` at [:491](packages/lib/src/typescript/lib/layout/CollapseSupport.ts#L491) — and then hands every participant (every pane or region, every gutter) to the **frame loop**, [`animateLayout`](packages/lib/src/typescript/lib/layout/CollapseSupport.ts#L358). On every animation frame the loop writes each participant's interpolated box and re-lays out its content through [`commitRect`](packages/lib/src/typescript/lib/layout/CollapseSupport.ts#L315). Some participants do not move at all: the toggled pane keeps its full size and only clip-reveals, and in a `Border` every edge region the freed space does not reach stays put. The loop still writes the same rectangle to them and re-lays out their whole subtree on every frame. This is G12's F06.9.

This plan removes that work. After the end layout, `runCollapse` keeps only the participants whose box changed; a **static participant** — one whose box, as `captureRect` reads it, is the same after the end layout as before it — never enters the frame loop. The code change is one `.filter` and one small helper in `CollapseSupport.ts`. `Split` and `Border` share `runCollapse`, so both get it; their own changes are doc comments. `CollapseSupport` is not exported from any entry point, so no public API changes.

W3.0's `g12.collapse-static` ablation, a runtime prototype of this skip, removed **56%** of the work of a sidebar toggle on `shell-deep` and **64%** on `shell-shallow`, frame time flat, with the sidebar's and status bar's geometry identical in every unit ([96 record, *G12 — `Split`*](plans/research/render-review-2026-09-15/96-w3-0-bounding-sweep.md#L172)). The shipped change should land at about **−51%** and **−59%**: it keeps one layout pass the ablation skipped by mistake (see *What the fix keeps from the ablation*).

---

## Architecture Decisions

### A participant whose box ends where it started is not animated

`runCollapse` compares each participant's start box with its end box and hands only the ones that differ to the frame loop. A static participant is left exactly as the end layout placed it.[^why-static]

The approach follows how the codebase already avoids per-frame layout of things that did not change: [`Accordion.layoutSections`](packages/lib/src/typescript/lib/layout/Accordion.ts#L1771) re-lays out only the sections whose height changed (`reflowAll || contentHeight !== oldHeight`), and `CollapseMover.relayout` ([:185-199](packages/lib/src/typescript/lib/layout/CollapseSupport.ts#L185)) already exempts a gutter from per-frame content layout. The comparison reads the boxes back after the end layout's setters ran, as [`LayoutManager.commitBounds`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L588) reads back its `changed` flag.[^precedent]

The rule, on the three scenes *Expected Behaviour* uses (boxes are `x, y, width, height`):

| Toggle | Participant | Start box | End box | In the frame loop? |
|---|---|---|---|---|
| `Split`, two panes, `lead` (weight 0) collapses | `lead` (toggled) | 0, 0, 100, 300 | 0, 0, 100, 300 | no |
| | `rest` (weight 1) | 104, 0, 296, 300 | 18, 0, 382, 300 | yes |
| | the gutter | 97, 0, 10, 300 | 0, 0, 18, 300 | yes |
| `Split`, three panes, the middle one `b` collapses | `b` (toggled) | 150, 0, 100, 300 | 193, 0, 100, 300 | yes — the neighbour before it grows, so its slot moves |
| `Border`, west collapses | north, south, east, west (toggled), the north gutter | unchanged | unchanged | no |
| | centre | 100, 30, 220, 250 | 18, 30, 302, 250 | yes |
| | the west gutter | 97, 30, 10, 250 | 0, 30, 18, 250 | yes |

So whether the toggled pane is static is decided by the numbers, not assumed. The shells' sidebar, the pane W3.0 toggled, holds one rectangle in every unit of every W3.0 run.

### The end layout is a static participant's one layout pass

The end layout places every pane and region through the manager's normal commit — `commitBounds`, or `commitRect` with `relayout: false` for one whose content is out — and every gutter through its own setters. The commit lays a pane's or region's content out, or skips that pass where the unchanged-commit gate proves it current. Nothing the frame loop used to do to a static participant is left undone:

| State of a static participant | Written by | Why it is final when the loop leaves it alone |
|---|---|---|
| Box, translate, `will-change` | the end layout | Start equals end, so every frame would write that same box. `commitBounds` takes its slow path for a box that did not move, which folds any leftover translate back to 0 and clears `will-change`. |
| Content layout | the end layout's commit | Its box did not change and no layout input did; a content change during the 200 ms schedules its own pass, as it always did. |
| `clip-path` | the end layout (`Split.commitPanes`, `Border.applyRegionClip`); a CSS transition animates it | The frame loop never wrote `clip-path`. |
| Scroll offsets | the manager's reconcile when the animation settles | The frame loop never touched scroll, and the settle happens at the same moment as before. |
| The primed `transition` | the transition's own cleanup | Unchanged. One side effect: a static *first* gutter keeps the `will-change` hint `primeCollapse` gave it until that cleanup, where today the loop's first commit clears it at once.[^will-change] |

Expected geometry follows directly:

- **A static participant** holds its box on every frame and at rest — the box today's loop wrote on every frame.
- **A mover** is placed exactly as today: the same interpolation between the same start and end, landing on its end box. Its intermediate boxes differ between any two runs, the unchanged code included, because frame timestamps differ. That is why W3.0's cells let the animated labels differ.
- **At rest**, every participant sits on its end box, the end layout's result, so the resting layout is identical to today's.[^mid-resize]

### Boxes are compared exactly

`sameRect` compares the four fields with `===`, no tolerance. A `NaN` field never matches, so a participant no layout has placed stays in the loop.[^exact]

### The frame clock still runs its full length

`animateLayout` keeps running its frames until the duration elapses even when every participant was dropped, and calls `onComplete` only then. Do not add an early return for an empty list.[^clock]

### An expanding pane that opts into the unchanged-commit skip needs the opt-ins plan's `setDisplayed` mark

On an expand, the returning content must be laid out once. Today the frame loop's forced `doLayout` guarantees it. Without that call, a pane whose class opts into the unchanged-commit skip (`MenuBar` or `ToolBar` today; `Panel`, `LabeledGrid`, `Header`, `StatusBar` after [`unchanged-commit-opt-ins`](plans/unchanged-commit-opt-ins.md)) is re-committed at an unchanged box by the end layout, and nothing marks it owed, so the pass is withheld. The opt-ins plan's closure on `Component.setDisplayed` — a child that enters or leaves the render tree marks its parent's pass owed — is exactly the missing mark. This plan therefore depends on that plan and adds no mark of its own. Case E5 pins the dependency.[^opt-ins-dependency]

### How this sits beside the unchanged-commit skip

The two remove different calls, so neither duplicates the other:

- **Wave 2's skip and the opt-ins plan** gate `commitBounds`, which the end layout uses. With `Panel` opted in, a clean static `Panel` pane — the shells' sidebar on a collapse — is not laid out even by the end layout. On an expand the `setDisplayed` mark lets that pass run.
- **This plan** removes the frame loop's calls. `commitRect` calls `doLayout` directly, never through the gate, so no opt-in reaches them.

Together, a sidebar collapse lays the static sidebar out zero times and an expand once, where today each toggle lays it out about six times in the engine.[^no-double-work]

### What the fix keeps from the ablation, and what it changes

The fix follows the ablation where it matters: it skips the same participants (a pane at an unchanged box during a collapse), at the same point (the animation's per-frame layout), with the same geometry.

It differs in four ways:

1. **It decides once per toggle, from rects `runCollapse` already captured.** The ablation wrapped each pane's `doLayout` and compared every call with the last rectangle that ran, within 1e-6 px. The fix needs no wrapper, keeps no state per pane, and has nothing to tear down.
2. **It covers `Border` and the gutters.** The ablation could only patch `Split.setPaneCollapsed`; the fix lives in the shared `runCollapse`.
3. **It never skips the end layout.** The ablation's guard outlived its collapse, so on the next toggle it withheld the end layout's pass as well — including the expand's, which lays the returning content out. The fix keeps that pass, so it saves slightly less than the ablation measured.[^ablation-gap]
4. **It has no skip counter.** Engagement shows as `sidebar.doLayout` falling, a counter the shell panels already record.

### Scope

This plan changes the collapse path only: `runCollapse`'s mover list. `commitRect`, `animateLayout`'s body, `Split.commitPanes` and every drag method (`Split.onDrag`, `scheduleDrag`) are unchanged, which leaves the later `drag-resize-outline-mode` plan a clean `Split` drag path. The two other G12 items W3.0 measured are left out (see *Non-Goals*).

---

## Public API

None. `CollapseSupport.ts` is not re-exported from `layout/index.ts` or any other entry point; `sameRect` is module-private. The documented behaviour of `Split.setPaneCollapsed` and `Border.setRegionCollapsed` changes in one sentence each (steps 6 and 7).

---

## Internal Structure

The helper, placed directly after `lerpRect` in `CollapseSupport.ts` ([:285-290](packages/lib/src/typescript/lib/layout/CollapseSupport.ts#L285)):

```ts
/**
 * Whether two rects describe the same box, field for field. Exact, with no
 * tolerance: {@link lerpRect} between two equal rects returns that rect at
 * every step, so only an exact match proves a participant would be written
 * the same box on every frame. A `NaN` field never matches, so a participant
 * no layout has placed yet stays animated.
 *
 * @param a - The first rect.
 * @param b - The second rect.
 * @returns `true` when all four fields are equal.
 */
function sameRect(a: Rect, b: Rect): boolean {
    return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
```

The mover list at the end of `runCollapse` ([:487-500](packages/lib/src/typescript/lib/layout/CollapseSupport.ts#L487)) becomes:

```ts
    // Snapshot the start geometry, write the end layout, then capture the end
    // geometry and animate between the two. A participant whose box ends where
    // it started is left out: the end layout has just committed it at the one
    // box every frame would write, and laid its content out there.
    const starts = participants.map(participant => captureRect(participant.component));

    container.doLayout();

    const movers: CollapseMover[] = participants
        .map((participant, index) => ({
            component: participant.component,
            relayout:  participant.relayout,
            start:     starts[index],
            end:       captureRect(participant.component),
        }))
        .filter(mover => !sameRect(mover.start, mover.end));

    return animateLayout(movers, onIdle);
```

`animateLayout`'s body does not change.

---

## Ordered Implementation Steps

Work test-first: step 2 writes the new cases, and all but E3 fail before step 4 lands.

1. **Record the A/B base.** In the implementation worktree, before any edit, run `git rev-parse HEAD` and write the SHA into this plan's *Implementation Notes* as "A/B base". Check: `git show <sha>:plans/implemented/unchanged-commit-opt-ins.md | head -1` prints the file's first line — the dependency is in the base.

2. **Create `packages/lib/tests/component/layout/CollapseStaticParticipants.test.ts`** with cases E1–E9 of *Expected Behaviour*. The file header names this plan as the source of the case numbers.
   - Copy from [`Split.collapseUndisplay.test.ts:37-122`](packages/lib/tests/component/layout/Split.collapseUndisplay.test.ts#L37): `CONFIG`, `PAST_FALLBACK_MS`, `MAX_FLUSH_ROUNDS`, `install()` (the frame-capturing `requestAnimationFrame` spy and fake timers), `flushFrames()` and `settle()`, and its `afterEach`.
   - Add `runFrame(offsetMs)`: take the frames captured so far, clear the list, and call each once with `performance.now() + offsetMs`. Mid-animation cases must use it, not `flushFrames`: a frame short of the duration reschedules itself, and `flushFrames` would run it up to eight times.
   - Copy `SkippableContainer` from [`UnchangedCommitSkip.test.ts:153-162`](packages/lib/tests/core/UnchangedCommitSkip.test.ts#L153) for E5.
   - Count layouts with `vi.spyOn(component, 'doLayout')`, installed **after** the scene's first `settle()`: building a scene queues layout frames, and running them later would add calls the cases do not expect.
   - Check: `npx vitest run tests/component/layout/CollapseStaticParticipants.test.ts` from `packages/lib`. E3 passes; E1, E2, E4–E9 fail.

3. **`CollapseSupport.ts` — add `sameRect`** exactly as in *Internal Structure*, directly after `lerpRect`.

4. **`CollapseSupport.ts` — filter the movers.** Replace [:487-500](packages/lib/src/typescript/lib/layout/CollapseSupport.ts#L487) with the block in *Internal Structure*. Check: the step-2 file is green; `grep -n 'movers.length' packages/lib/src/typescript/lib/layout/CollapseSupport.ts` prints nothing (no early return was added).

5. **`CollapseSupport.ts` — doc comments.** Describe the behaviour in prose; these are internal symbols.
   - `CollapseMover` ([:185-193](packages/lib/src/typescript/lib/layout/CollapseSupport.ts#L185)): add that only a participant whose end box differs from its start box becomes a mover.
   - `animateLayout` ([:331-357](packages/lib/src/typescript/lib/layout/CollapseSupport.ts#L331)): "every participant's box" becomes "every mover's box". Add a paragraph: the list holds only participants whose box changes; an empty list still runs the frames for the full duration before `onComplete`, because the caller's idle work (clearing its collapsing flag, taking collapsed content out) must wait for the primed clip-path and colour transitions, which run that long regardless.
   - `CollapseParticipant` ([:410-417](packages/lib/src/typescript/lib/layout/CollapseSupport.ts#L410)): "the moving element" becomes "an element that may move".
   - `runCollapse` ([:424-452](packages/lib/src/typescript/lib/layout/CollapseSupport.ts#L424)): in the paragraph starting "The pass:", replace "hand the lot to the rAF driver" with: hand every participant whose end box differs from its start box to the rAF driver; a participant that ends where it started is left as the end layout placed it, since that layout already committed it — and laid its content out — at the one box every frame would write.

6. **`Split.ts` — comments only.**
   - `setPaneCollapsed`'s JSDoc ([:439-442](packages/lib/src/typescript/lib/layout/Split.ts#L439)): the sentence becomes "The whole pass is one coordinated animation: the toggled pane clip-reveals while every pane and gutter whose box changes interpolates its geometry — re-laying out its content each frame — in lockstep (see `CollapseSupport.runCollapse`). A pane whose box does not change, usually the toggled pane itself, is laid out once for the end state and left alone by the animation's frames."
   - The comment above `participants` ([:485-489](packages/lib/src/typescript/lib/layout/Split.ts#L485)): its first sentence becomes "Every box that may move: the panes (content re-laid-out each frame) and the gutters (geometry only); `runCollapse` animates only the ones whose box changes." Keep the rest.
   - Check: `git diff -U0 packages/lib/src/typescript/lib/layout/Split.ts` shows only comment lines.

7. **`Border.ts` — comments only.**
   - `setRegionCollapsed`'s JSDoc ([:336-339](packages/lib/src/typescript/lib/layout/Border.ts#L336)): after "…in lockstep (see `CollapseSupport.runCollapse`).", add "A region whose box does not change — the toggled one, and every edge the reclaimed space does not reach — is laid out once for the end state and left alone by the animation's frames."
   - The comment above `participants` ([:395-399](packages/lib/src/typescript/lib/layout/Border.ts#L395)): the same first-sentence change as in step 6, with "regions" for "panes".
   - Check: `git diff -U0 packages/lib/src/typescript/lib/layout/Border.ts` shows only comment lines.

8. **Documentation**, per *Documentation Impact*.

9. **Run *Verification*'s implementer checks.** Stop there. The in-engine A/B is the orchestrator's.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/tests/component/layout/CollapseStaticParticipants.test.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/CollapseSupport.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Split.ts` (comments only) |
| Modify | `packages/lib/src/typescript/lib/layout/Border.ts` (comments only) |
| Modify | `packages/lib/docs/layouts/Split.md` |
| Modify | `packages/lib/docs/layouts/Border.md` |
| Modify | `packages/lib/docs/concepts/performance.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify (orchestrator, after the A/B) | `packages/qa/README.md` |

---

## Expected Behaviour

E1–E9 are unit-testable under the modelled DOM. E10 is in-engine only. Every number below was produced by an offline probe of this exact change against `master`'s library source.[^probe]

**Scenes.** Every component is rendered with `getElement(true)` before it is added. After building, call `host.doLayout()`, then `settle()` once, then install the `doLayout` spies. A "visual box" is `getX() + getTranslateX()`, `getY() + getTranslateY()`, `getWidth()`, `getHeight()`.

- **Two panes.** A `Container` host, 400×300, `clearInsets()`, with `new Split({ orientation: 'horizontal' })`. `lead` is a `Container` with `new VBox()` and `preferredSize: { width: 100, height: 300 }`, holding two leaves of `preferredSize` 50×40, added with `{ weight: 0 }`. `rest` is a `Container` with `new Fit()` holding one 50×50 leaf, added with `{ weight: 1 }`. Before any toggle: `lead` 0,0,100,300 with `clip-path` `inset(0 0 0 0)`, its leaves at 0,0,50,40 and 0,45,50,40; the gutter 97,0,10,300; `rest` 104,0,296,300.
- **Three panes.** The same host and manager with `a`, `b`, `c`, each a `Container` with `new Fit()` holding one 50×50 leaf. `a` and `c` have `{ weight: 1 }`; `b` has `preferredSize: { width: 100, height: 300 }` and `{ weight: 0 }`. Before: `a` 0,0,146,300; `b` 150,0,100,300; `c` 254,0,146,300.
- **Border.** The same host with `new Border({ spacing: 0 })`. Each region is a `Container` with `new Fit()` holding one 20×20 leaf, with constraints built as in [`Border.collapseUndisplay.test.ts:145-147`](packages/lib/tests/component/layout/Border.collapseUndisplay.test.ts#L145): north `preferredSize` 400×30, collapsible; south 400×20; west 100×100, collapsible; east 80×100; centre 50×50. North is added first, so its gutter is the first gutter.

**E1. A collapse leaves the static toggled pane out of the frames.** Two panes, `split.setPaneCollapsed(0, true)`:

| Moment | `lead.doLayout` | `rest.doLayout` | Today (`lead` / `rest`) |
|---|---|---|---|
| the call returns | 1 | 2 | 2 / 2 |
| after `runFrame(50)` | 1 | 3 | 3 / 3 |
| after `settle()` | 1 | 4 | 4 / 4 |

At rest: `lead` 0,0,100,300 with `clip-path` `inset(0 100% 0 0)` and both leaves undisplayed; the gutter, now the strip, 0,0,18,300; `rest` 18,0,382,300 and its leaf 0,0,382,300.

**E2. The expand does the same.** Two panes: `setPaneCollapsed(0, true)`, `settle()`, clear the spies' counts, then `split.setPaneCollapsed(0, false)`. When the call returns, `lead` 1 and `rest` 2; after `runFrame(50)`, `lead` 1 and `rest` 3; after `settle()`, `lead` 1 and `rest` 4. Today: 2 / 2, 3 / 3, 4 / 4. At rest, every pane's, leaf's and gutter's box, `clip-path` and displayed flag equal their values before the collapse.

**E3. A toggled pane that moves is still animated.** Three panes, `split.setPaneCollapsed(1, true)`: when the call returns, `a`, `b` and `c` each report 2; after `runFrame(50)`, each reports 3. At rest: `a` 0,0,189,300; `b` 193,0,100,300 with `clip-path` `inset(0 100% 0 0)`; `c` 211,0,189,300; the second gutter, now the strip, 193,0,18,300. This case passes before and after the change.

**E4. `Border` leaves every unmoved region out of the frames.** Border scene, `border.setRegionCollapsed(Placement.WEST, true)`:

| Moment | north, south, west, east (each) | centre | Today (every region) |
|---|---|---|---|
| the call returns | 2 | 3 | 3 |
| after `runFrame(50)` | 2 | 4 | 4 |
| after `settle()` | 3 | 6 | 6 |

The first two calls on each region are `setRegionCollapsed`'s own start-state layout and the end layout; the call after `settle()` is the idle layout that restores the clip frames. At rest: north, south and east have their pre-collapse visual boxes; west keeps visual box 0,30,100,250 with `clip-path` `inset(0 100% 0 0)` and its leaf undisplayed; the centre's width is 302 (was 220). After `setRegionCollapsed(Placement.WEST, false)` and `settle()`, every region's visual box, `clip-path` and displayed flag equal their pre-collapse values.

**E5. An opted-in pane's returning content is laid out once.** Two panes with `lead` a `SkippableContainer` (same options, one 50×40 leaf). Collapse, `settle()`, clear the spy, then `split.setPaneCollapsed(0, false)`: `lead.doLayout` has run exactly **1** time when the call returns, and still 1 after `settle()`. The leaf is displayed at 0,0,50,40. Without the opt-ins plan's `setDisplayed` mark the count is 0; with today's frame loop it is 2.

**E6. Reduced motion.** `vi.spyOn(Animation, 'isReducedMotion').mockReturnValue(true)`, two panes. When `setPaneCollapsed(0, true)` returns: `lead` 1, `rest` 2, both of `lead`'s leaves already undisplayed, and every box equal to E1's rest. When `setPaneCollapsed(0, false)` returns: `lead` 2, `rest` 4, and every box, `clip-path` and displayed flag equal the pre-collapse values. Today: 2 / 2, then 4 / 4.

**E7. A re-toggle mid-animation.** Two panes: `setPaneCollapsed(0, true)`, `runFrame(50)`, then `setPaneCollapsed(0, false)`. When the second call returns: `lead` 2 (one end layout per toggle), `rest` 5. After `settle()`: `lead` 2, `rest` 6, and every box, `clip-path` and displayed flag equal the pre-collapse values.

**E8. A static pane carrying a translate is left normalised.** Two panes. `lead.setX(lead.getX() - 7)` then `lead.setTranslate(7, 0)`, so its visual box is unchanged. After `setPaneCollapsed(0, true)` returns: `lead.getX()` is 0, `lead.getTranslateX()` is 0, and `lead.doLayout` ran once. This mirrors the moving bystander that [`CollapseSupport.test.ts`](packages/lib/tests/component/layout/CollapseSupport.test.ts#L39) already pins.

**E9. A static first gutter's promotion is released.** Border scene. Read the gutters as `(border as unknown as { _gutters: Map<Placement, Component> })._gutters`. When `setRegionCollapsed(Placement.WEST, true)` returns, the north gutter's `getWillChange()` is `"background-color"`. After `settle()`, every gutter's `getWillChange()` and `getTransition()` are `null`.

**E10. In-engine (manual, the orchestrator's).** The A/B in *Verification*: geometry `=` in every run, and the saving of the order listed there.

---

## Verification

**Implementer**, from `packages/lib`:

- `npm run typecheck`, `npm run typecheck:test`, `npm run lint`, `npm run test:lint` — clean.
- `npm test` — green, with E1–E9 new. **The suite is not the gate.** A wrong memo key once passed all 7,519 tests; this change, applied at runtime over the twelve suites that exercise collapse, left all 254 of their tests green while it classed 103 participants static.[^suite] Geometry in the engine, below, is the gate.
- The grep and diff checks in steps 4, 6 and 7.
- `npm run build:lib`, then `(cd ../qa && npm test)` — the QA panels still mount under jsdom; this opens no window.
- `npm run docs:api` — the 14 warnings `master` already has and no new one. `npm run docs:llms:check` — clean.
- **Never run `packages/qa/runqa.sh`, `packages/qa/sweeps/*.sh`, MiniBrowser or the Tauri host.** Each opens a full-screen window.

**Orchestrator — the in-engine A/B, with the user's go-ahead. The implementer never runs it.** Same session, MiniBrowser, `work=1&seam=1&geom=1` on every run. The cells are the two W3.0 cells that bounded this candidate, `sdt` and `sst` of batch `b06`, with the same parameters. Each is run base, fix, base, fix, base: 10 runs, about three minutes.

1. Build the base arm — `runqa.sh`'s `wt` arm — at the SHA recorded in step 1, per [`packages/qa/README.md:87-99`](packages/qa/README.md#L87):

   ```sh
   cd /home/jika/typescript/typescript-ui
   git worktree add .worktrees/_g12-base <base-sha> --detach
   ln -sfn "$PWD/node_modules" .worktrees/_g12-base/node_modules
   (cd .worktrees/_g12-base/packages/lib && npm run build:lib)
   export QA_WT_LIB="$PWD/.worktrees/_g12-base/packages/lib"
   ```

2. Build the fix arm — the `main` arm — with `npm run build:lib` in the implementation worktree.

3. Save this script outside the repository as `g12-collapse-ab.sh`, in the style of [`packages/qa/sweeps/w3-0.sh`](packages/qa/sweeps/w3-0.sh). From the implementation worktree's root run `bash g12-collapse-ab.sh --dry-run` (expect 10 `runqa` lines), then `bash g12-collapse-ab.sh`, then `bash g12-collapse-ab.sh --read`. A cell that fails part-way is re-run whole under a new tag: `G12_SESSION=s2 bash g12-collapse-ab.sh sdt`, read with `G12_SESSION=s2 bash g12-collapse-ab.sh --read sdt`.

   ```bash
   #!/bin/bash
   # G12 F06.9 in-engine A/B: bash g12-collapse-ab.sh [--dry-run | --read] [<cell> ...]
   #
   # Every run opens a full-screen window and holds it until the run ends. The
   # orchestrator runs this with the user's go-ahead; an implementer never does.
   # Run from the repository root of the checkout holding the fix, with its
   # packages/lib built (the main arm) and QA_WT_LIB set to a built packages/lib
   # at the plan's base commit (the wt arm). --dry-run and --read open nothing.
   set -u
   RUNQA=packages/qa/runqa.sh
   RESULTS=packages/qa/results
   SESSION=${G12_SESSION:-s1}
   FLAGS='work=1&seam=1&geom=1'
   CELLS="sdt sst"

   # A cell's query parameters: W3.0's b06 cells, unchanged.
   params() {
       case "$1" in
           sdt) echo 'panel=shell-deep&toggle=pane&drive=toggle:120' ;;
           sst) echo 'panel=shell-shallow&toggle=pane&drive=toggle:120' ;;
           *)   return 1 ;;
       esac
   }

   MODE=run
   case "${1:-}" in
       --dry-run) MODE=dry; shift ;;
       --read) MODE=read; shift ;;
   esac

   selected=${*:-$CELLS}

   for c in $selected; do
       params "$c" > /dev/null || { echo "unknown cell $c (cells: $CELLS)" >&2; exit 2; }
   done

   if [ "$MODE" = read ]; then
       exec python3 - "$RESULTS" "$SESSION" $selected <<'PY'
   import glob, json, sys

   # shell.ts TOGGLE_PERIOD_UNITS: the pane toggles at units 0, 30, 60 and 90.
   TOGGLE_PERIOD = 30
   # Units after a toggle that may still be mid-animation: 200 ms is 12 frames
   # at 60 Hz, plus the settle frame, and a frame is never shorter than that.
   ANIMATION_UNITS = 14
   # Labels whose rectangle the collapse never changes: gated in every unit.
   STATIC = ('sidebar', 'status')
   # Ablation bookkeeping that work/u leaves out, as qa-table.py does.
   BOOKKEEPING = ('memo.', 'skipped.', 'stubbed.', 'dose.')

   results, session, cells = sys.argv[1], sys.argv[2], sys.argv[3:]

   for cell in cells:
       paths = sorted(glob.glob(f'{results}/g12{session}-{cell}-*.json'), key=lambda p: int(p.rsplit('-', 1)[1].split('.')[0]))
       runs = [json.load(open(p)) for p in paths]
       phase = lambda run: run['phases'][0]
       ref = phase(runs[0])['geometry']
       print(f'{cell}:')

       for run in runs:
           ph = phase(run)
           bad = sorted({label for label, rects in ph['geometry'].items() for unit, rect in enumerate(rects)
                         if rect != ref[label][unit] and (label in STATIC or not 0 < unit % TOGGLE_PERIOD <= ANIMATION_UNITS)})
           work = sum(v for k, v in ph['work'].items() if not k.startswith(BOOKKEEPING))
           print(f"  {run['name']:22} avg {ph['timing']['avgMs']:6.2f}  work/u {work:8.2f}"
                 f"  sidebar.doLayout {ph['work'].get('sidebar.doLayout', 0):.2f}  main.doLayout {ph['work'].get('main.doLayout', 0):.2f}"
                 f"  geom {'=' if not bad else 'DIFF(' + ','.join(bad) + ')'}")

       arm = lambda name: [phase(r) for r in runs if f'-{name}-' in r['name']]
       mean = lambda xs: sum(xs) / len(xs)
       base_ms = [p['timing']['avgMs'] for p in arm('base')]
       fix_ms = [p['timing']['avgMs'] for p in arm('fix')]
       base_work = mean([sum(v for k, v in p['work'].items() if not k.startswith(BOOKKEEPING)) for p in arm('base')])
       fix_work = mean([sum(v for k, v in p['work'].items() if not k.startswith(BOOKKEEPING)) for p in arm('fix')])
       bracket = max(base_ms) - min(base_ms)
       delta = mean(fix_ms) - mean(base_ms)
       print(f'  bracket {bracket:.2f}  Δms {delta:+.2f} ({"win" if delta < -bracket else "regress" if delta > bracket else "flat"})'
             f'  Δwork {100 * (fix_work - base_work) / base_work:+.1f}%')
   PY
   fi

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

   # Each cell: the base at both ends and in the middle, the fix between.
   for c in $selected; do
       p="$(params "$c")&$FLAGS"
       run "g12$SESSION-$c-base-a" wt   "$p"
       run "g12$SESSION-$c-fix-1"  main "$p"
       run "g12$SESSION-$c-base-b" wt   "$p"
       run "g12$SESSION-$c-fix-2"  main "$p"
       run "g12$SESSION-$c-base-c" wt   "$p"
   done
   ```

   `--read` applies W3.0's decision rule ([`w3-0-bounding-sweep.md`, *The decision rule*](plans/implemented/w3-0-bounding-sweep.md#L114)) with the three `base` runs standing for the plain arms. Its geometry gate compares every run with `base-a`: `sidebar` and `status` in every unit, and every label outside the 14 units after each toggle — so both resting states, collapsed and expanded, are compared in full, twice each per run. W3.0's `--allow-diff` let the animated labels differ in the whole phase; this gate is stricter.[^read-validated]

**Expected readings** (phase 0, `toggle×120`, per unit).[^readings]

| Cell | `base` work/u | `fix` work/u | Δwork | `sidebar.doLayout` base → fix | `main.doLayout` | Δms |
|---|---|---|---|---|---|---|
| `sdt` (shell-deep) | ≈ 1,060 (W3.0 plain: 1,115.66) | ≈ 520 | ≈ −51%; accept −45% to −57% | ≈ 0.17 → ≤ 0.04 (0.02 expected) | fix within 0.03 of base | flat |
| `sst` (shell-shallow) | ≈ 970 (W3.0 plain: 1,027.99) | ≈ 400 | ≈ −59%; accept −51% to −65% | ≈ 0.18 → ≤ 0.04 (0.02 expected) | fix within 0.03 of base | flat |

**Pass criteria:**

1. `geom` reads `=` for every run of both cells. A `DIFF` on a `base` run means the cell is unstable: re-run it whole under a new `G12_SESSION`. A `DIFF` on a `fix` run stops the merge and returns to this plan.
2. Δwork lies inside the cell's window. A saving *larger* than the window also stops the merge: it would mean the fix skipped a pass the ablation kept.
3. Both `fix` runs read `sidebar.doLayout` ≤ 0.04 — at most the end layout's pass per toggle — and `main.doLayout` within 0.03 of the `base` mean, since `main` moves and must still be animated.
4. Δms is not `regress`. Frame time is not predicted beyond that: W3.0 read both cells flat.

**Record.** Append the readings to the `shell-deep` and `shell-shallow` rows' *Validated* cells in [`packages/qa/README.md`](packages/qa/README.md#L322), in the shape of the W3.0 baseline lines there: date, lib SHA, run names `g12s1-*`, work/u base → fix, `sidebar.doLayout`, geometry `=`. Then `git worktree remove .worktrees/_g12-base`.

---

## Documentation Impact

- **[`docs/layouts/Split.md:55-58`](packages/lib/docs/layouts/Split.md#L55).** "…the toggled pane clip-reveals while every other pane and the gutters interpolate their geometry together, re-laying out their contents each frame so nothing snaps…" becomes "…the toggled pane clip-reveals while every pane and gutter whose box changes interpolates its geometry, re-laying out its content each frame so nothing snaps…". After the `Accordion` link's sentence, add: "A pane whose box does not change — the collapsing pane itself, which only clips — is laid out once for the end state rather than on every frame."
- **[`docs/layouts/Border.md:66-70`](packages/lib/docs/layouts/Border.md#L66).** After the sentence ending "mirroring the [`Accordion`](/layouts/Accordion).", add: "A region whose box does not change — the collapsing region itself, and any edge the reclaimed space does not reach — is laid out once for the end state rather than on every frame."
- **[`docs/concepts/performance.md`](packages/lib/docs/concepts/performance.md#L60), *Collapsed panes and regions leave the render tree*.** After the section's first paragraph, add: "The animation itself only re-lays out what moves. A pane or region whose box ends where it started — the collapsing one, which keeps its full size and only clips, and any neighbour the freed space does not reach — is laid out once for the end state and left alone for the rest of the animation."
- **[`docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md#L185), *Changed → Layouts*.** One bullet: "**A `Split` pane or `Border` region whose box does not move during a collapse or expand is no longer re-laid-out on every animation frame.** The animation now interpolates — and re-lays out each frame — only the panes, regions and gutters whose box changes; one that ends where it started, usually the collapsing pane or region itself, is laid out once for the end state. A custom pane that relied on a `doLayout` call per animation frame to pick up a change it never announced must call `scheduleLayout()` itself."
- **API pages.** The JSDoc of `Split.setPaneCollapsed` and `Border.setRegionCollapsed` renders; keep the existing backticked `CollapseSupport.runCollapse` as plain text, never a `{@link}` (it is internal).
- **No export, barrel, `llms.txt` or sidebar change**, and no migration note: nothing public is renamed or removed.

---

## Potential Challenges

- **An early return for an empty mover list.** It would fire `onIdle` at once, taking collapsed content out while the clip reveal still runs. Step 4's grep guards it.
- **A tolerance in `sameRect`.** Keep `===`; see *Boxes are compared exactly*.
- **Mid-animation frames in tests.** Use `runFrame`, not `flushFrames`, or a frame short of the duration runs eight times.
- **Spies installed before the scene settles** count queued construction layouts. Settle first.
- **`Border` regions carry a translate after settling**: the idle layout re-frames them through `commitBounds`' fast path. Compare visual boxes (E4), not `getX()` alone.
- **E5 fails without `unchanged-commit-opt-ins`.** That is the dependency showing, not a defect here: do not add a local `invalidateLayout()` to make it pass.

---

## Critical Files

- [`packages/lib/src/typescript/lib/layout/CollapseSupport.ts`](packages/lib/src/typescript/lib/layout/CollapseSupport.ts) — the whole module: `commitRect` (:315), `animateLayout` (:358), `runCollapse` (:454).
- [`packages/lib/src/typescript/lib/layout/Split.ts:453-505`](packages/lib/src/typescript/lib/layout/Split.ts#L453) — `setPaneCollapsed`; [:590](packages/lib/src/typescript/lib/layout/Split.ts#L590) `redisplayPaneContent`; [:629](packages/lib/src/typescript/lib/layout/Split.ts#L629) `reconcileCollapsedContent`; [:2090-2146](packages/lib/src/typescript/lib/layout/Split.ts#L2090) `placeGutterAsStrip` and `commitPanes`, which place the toggled pane at its full size.
- [`packages/lib/src/typescript/lib/layout/Border.ts:346-425`](packages/lib/src/typescript/lib/layout/Border.ts#L346) — `setRegionCollapsed`, with its start-state layout and idle re-frame; [:550](packages/lib/src/typescript/lib/layout/Border.ts#L550) `placeRegionBox`.
- [`packages/lib/src/typescript/lib/layout/Accordion.ts:1771-1790`](packages/lib/src/typescript/lib/layout/Accordion.ts#L1771) — the precedent: reflow only what changed.
- [`packages/lib/src/typescript/lib/layout/LayoutManager.ts:588-640`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L588) — `commitBounds`: the end layout's commit, its slow path and the unchanged-commit gate.
- [`plans/unchanged-commit-opt-ins.md`](plans/unchanged-commit-opt-ins.md) — the dependency: its `setDisplayed` closure and its `Panel` opt-in.
- [`packages/qa/src/harness/ablations.ts:697-800`](packages/qa/src/harness/ablations.ts#L697) — `g12CollapseStatic` and `guardStaticRelayout`, the prototype this plan replaces.
- [`packages/lib/tests/component/layout/Split.collapseUndisplay.test.ts`](packages/lib/tests/component/layout/Split.collapseUndisplay.test.ts), [`CollapseAnimationTeardown.test.ts`](packages/lib/tests/component/layout/CollapseAnimationTeardown.test.ts), [`CollapseSupport.test.ts`](packages/lib/tests/component/layout/CollapseSupport.test.ts) — the helpers to copy and the suites that already pin this path.
- [`plans/research/render-review-2026-09-15/96-w3-0-bounding-sweep.md`](plans/research/render-review-2026-09-15/96-w3-0-bounding-sweep.md#L172) — the measured bound; [`06-layout-split-border-dockregion.md`](plans/research/render-review-2026-09-15/06-layout-split-border-dockregion.md#L378), F06.9 as found.

---

## Non-Goals

- **G12 F06.3 and F06.4.** The W3.0 record marks both *needs a different surface*: F06.3's no-op drag frame avoided 94% of its work but ran 3.3–4.3 ms slower as a runtime patch, and F06.4's `recalculateSizes` gate avoided no work anywhere.[^scope]
- **The drag path and `resizeMode`.** `drag-resize-outline-mode` owns them; this plan changes nothing a drag runs.
- **Narrowing the colour cross-fade to the toggling gutter** (F06.9's second proposal in slice 06). It removes no layout work, W3.0 did not bound it, and it changes which element's `transitionend` ends the fade.
- **Participants that move without resizing.** They are still re-laid-out each frame.[^pure-move]
- **A QA panel for `Border`'s collapse.** No panel mounts a collapsible region; E4 and E9 cover `Border` offline.
- **Deleting the `g12.collapse-static` ablation.** It is W3.0's instrument and stays with the record.

---

## Notes

[^why-static]: `lerpRect(start, end, t)` computes `a + (b - a) * t` per field. When `start` and `end` are equal, `b - a` is exactly 0 for every finite field, so every frame — and the synchronous landing on `start` before the first frame — writes the same box the end layout just committed. The end layout ran in the same call, so the participant's content was laid out at that box moments earlier, and none of its layout inputs changed in between. A per-frame `doLayout` at that box therefore recomputes the same result. A content change during the 200 ms (a child added, a text changed) announces itself through `scheduleLayout` or the preferred-size relay and gets its own pass, as it always did: the frame loop never delivered those. Slice 06 proposed exactly this skip (F06.9: "drop movers whose `start` and `end` rects are equal from the per-frame loop").

[^precedent]: Three existing mechanisms establish the pattern. `Accordion.layoutSections` takes `reflowAll` false on a drag and re-lays out only a section whose height changed; the synthesis names that gate as G12's precedent for its drag half (ordering constraint 4). `CollapseMover.relayout: false` already keeps a gutter's content out of the per-frame layout, because a chevron re-centres through CSS; a static participant is the case where neither the box nor the content needs a frame. `commitBounds` decides `changed` from the component's own fields after the setters ran, never from the request; `captureRect` after the end layout is the same read-back, including the translate a fast-path commit may carry. No new pattern is introduced.

[^will-change]: `primeCollapse` sets `will-change: background-color` on the first gutter so the colour cross-fade runs on its own layer, and clears it in the transition's cleanup. Today the loop's first `commitRect` — the synchronous landing on the start box, before any frame — clears it at once on every gutter, because every gutter is in the loop. With this change a static first gutter keeps the hint until the cleanup, at most 240 ms later, which is the state `primeCollapse`'s own comment describes. A colour hint has no layout effect, and E9 pins that the cleanup still clears it. The first gutter is static whenever the toggle does not move it, as for the north gutter in E9's scene.

[^mid-resize]: One edge differs, in the direction of correctness. If something lays the container out while the animation runs — the host resized, say — that pass places every participant for the new size. Today the next frame drags every participant back towards the old `end`, and the last frame lands them there; a static participant is now left where the fresh pass put it. Movers behave as before. `Border` lays everything out again when the animation settles, so its resting state is unaffected; in `Split` a static pane now ends at the fresh placement instead of a stale one. No W3.0 cell or existing test resizes mid-collapse.

[^exact]: A tolerance would also be safe at rest — a participant within it is already at its end box, left there by the end layout — but it would let the first frames differ from today's by a sub-pixel amount, and nothing measured needs it: the shells' sidebar is weight-0 at a pinned pixel width, and W3.0 recorded it at 8, 42, 280, 1998 in every unit of all ten `b06` runs. A pane whose start and end differ by floating-point noise (a ratio-sized pane) stays in the loop, as it is today. `NaN` is the "never positioned" seed of `getX()`/`getY()`; `NaN === NaN` is false, so such a participant is animated as before rather than silently skipped.

[^clock]: `onIdle` is what clears `Split`'s and `Border`'s collapsing flag and runs their reconcile, which takes a collapsed pane's content out of the render tree. Those must wait for the clip-path reveal and the colour cross-fade, CSS transitions that run for the full 200 ms whatever the loop does. In practice the list is never empty — the toggling gutter always changes size, 10 px as a divider against 18 px as a strip — but keeping the clock costs nothing and removes a failure mode.

[^opt-ins-dependency]: Shown offline with the change applied: a two-pane split whose `lead` is a `SkippableContainer` ran `lead.doLayout` **0** times on expand, because the end layout re-committed it at an unchanged box while nothing had marked it owed; with a `setDisplayed` that marks the parent, as the opt-ins plan's step 2 specifies, it ran once. With that mark and today's frame loop it has run twice by the time the call returns — the end layout's pass and the loop's synchronous commit at the start box — and once more per frame. A local `pane.invalidateLayout()` in `Split.redisplayPaneContent` and `Border.redisplayRegionContent` would close the same gap, but the opt-ins plan closes it for every `setDisplayed` caller — the same gap exists today in `Split.setPaneCollapsedImmediate`'s expand — so adding it here would be double work on a line that plan already owns. In the shells the missing pass would change no rectangle, because the returning content keeps the boxes it had before the collapse; that is why E5, not the in-engine geometry gate, is the guard.

[^no-double-work]: Routing `commitRect` through the unchanged-commit gate instead was considered and rejected. It would reach only classes that opted in after an audit, while the start-equals-end proof holds for every class, because the end layout laid the participant out in the same call. It would also still pay the box writes and the gate check on every frame. The opt-ins plan lists `sdt` and `sst` among its gate-only cells, reading geometry and no work there; it lands first, so this plan's base already carries its effect on these cells — about two sidebar passes per run fewer, as the note on the expected readings derives.

[^ablation-gap]: `guardStaticRelayout` removes itself only on a call made once the collapse has ended, and nothing lays a collapsed pane out, so the sidebar's guard survived into the next toggle with the rectangle of the previous one. On toggles 2–4 of each run it therefore skipped the end layout's pass too: W3.0 records `sidebar.doLayout` at 0.01 per unit on both ablated runs — one pass in 120 units — against 0.18–0.20 plain. The fix keeps the end layout's pass: four per run on a base without the opt-ins plan, two with it (the collapses' passes are then skipped by `Panel`'s own gate). Each such pass costs about 3,400–3,500 counted calls, which is where the gap between W3.0's −56%/−64% and this plan's −51%/−59% comes from. The geometry gate could not see the skipped expand pass, because the returning content keeps the boxes it had before the collapse (see the note on the dependency). This is the campaign's recurring lesson: an ablation bounds the code it actually reaches.

[^probe]: Probe run 2026-09-22 under the throwaway probe runner, against the library source of `feature/w3-0-results` (`11ad15eb`, identical to `master`'s library): a copy of `CollapseSupport.ts` with this plan's filter behind a flag, swapped in with `vi.mock`, driving the scenes above with captured frames. With the flag off it reproduces today's counts (the "Today" columns); with it on, the counts in E1–E9. Every resting digest — box, translate, `clip-path` and displayed flag of every component and gutter — was identical between the two arms in all six scenes, including reduced motion and the mid-animation re-toggle. E5 ran with `setDisplayed` patched to mark the parent, as the opt-ins plan specifies; the other scenes use plain `Container`s, which no opt-in reaches, so landing that plan first does not change their numbers.

[^suite]: The twelve suites are `CollapseSupport`, `CollapseAnimationTeardown`, `Split.collapseUndisplay`, `Border.collapseUndisplay`, `Split`, `Border`, `Split.gutterHitBox`, `Border.passRecord`, `Accordion.manager`, `LayoutSerialization`, `FocusReveal` and `PanelFlushInsets`, run with the same `vi.mock` swap: 254 tests green with the filter off and on. The filter engaged in nine of them (103 static participants in all, 43 in `Border.collapseUndisplay` alone), so the green is not from the change being unreached.

[^readings]: Derived from W3.0's `b06` runs. On `sdt`, the plain arms average 1,115.66 work per unit with about 22.7 sidebar passes per run; the ablation, 488.13 with one. So one sidebar pass costs about (1,115.66 − 488.13) × 120 ÷ 21.7 ≈ 3,470 calls; on `sst`, (1,027.99 − 369.56) × 120 ÷ 23 ≈ 3,435. The base carries the opt-ins plan, whose `Panel` gate skips the collapse's end-layout pass on the clean sidebar twice per run: base ≈ 1,115.66 − 2 × 3,470 ÷ 120 ≈ 1,058 on `sdt` and ≈ 971 on `sst`. The fix keeps two passes per run, one more than the ablation: ≈ 488 + 29 ≈ 517 and ≈ 370 + 29 ≈ 398, so ≈ −51% and ≈ −59%. On a base without the opt-ins plan the fix would keep four passes and read ≈ −48% and ≈ −56%, inside the same windows. Each window runs from 80% of the ablation's saving to just past it; frame-count jitter moves a unit's counts by a few percent.

[^read-validated]: Pointed at W3.0's own ten `b06` runs, renamed `plain → base` and `g12.collapse-static → fix`, `--read` reproduces the record's reading exactly — `sdt`: bracket 0.73, Δms −0.41 flat, Δwork −56.2%; `sst`: bracket 2.08, Δms −0.14 flat, Δwork −64.1% — and reads `geom =` on all ten. In those runs every difference between any two runs sat in the first three units after a toggle; 14 leaves room for a session whose frames run at the full 60 Hz.

[^scope]: The 96 record: `sdp`/`ssp` park work −93.8% / −93.4% for `split.noop-drag`, yet +3.28 / +4.27 ms against the plain bracket, and `split.recalc-gate` −0.6% to +0.9% with its one `regress` in the same park cell. Both need a `wt` prototype arm, which is a separate plan's job.

[^pure-move]: A participant that moves without resizing would need only its box written each frame, since a child's coordinates are relative to its parent. The unchanged-commit contract treats any move as a change and lays out, and no W3.0 cell has such a participant: the shells' only mover also resizes. Taking it would be a second decision with its own gate, not part of F06.9.

---

## Implementation Notes

**A/B base** (step 1): `54d4cf4b52567e72b5762fb5314dc498946818df` — "Mark the
layout size-read economy plan implemented", the tip of the wave-3 stack this
branch starts from. `git show 54d4cf4b:plans/implemented/unchanged-commit-opt-ins.md`
resolves, so the `unchanged-commit-opt-ins` dependency is in the base; the
`w3-0-bounding-sweep` dependency is in `plans/implemented/` there too.

**The plan was followed as written.** `sameRect` and the mover filter went in
exactly as *Internal Structure* specifies, the comment-only edits to `Split.ts`
and `Border.ts` are comment-only (`git diff -U0` shows nothing else), and
`grep -n 'movers.length'` on `CollapseSupport.ts` prints nothing. The plan's
line anchors had drifted by a few lines against this base, but every symbol it
names was where it described it.

**One addition beyond step 5.** Step 5 rewrites `runCollapse`'s "The pass:"
paragraph. Two nearby sentences in the same JSDoc described `participants` as
"every box that moves" — the opening paragraph and the `@param participants`
line — which the filter makes inaccurate in exactly the way steps 6 and 7 fix
at the two call sites. Both now read "every box that may move", matching the
call-site wording those steps prescribe. No behaviour is involved.

**Implementer verification** (all from `packages/lib` unless noted), all clean:
`npm run typecheck`, `npm run typecheck:test`, `npm run lint`,
`npm run test:lint`, `npm test` (494 files, 8,236 tests, E1-E9 new),
`npm run build:lib`, `(cd ../qa && npm test)` (17 files, 336 tests),
`npm run docs:api` (0 errors, the 14 warnings `master` already has, no new
one), `npm run docs:llms:check`.

**Test-first record.** With `CollapseStaticParticipants.test.ts` in place and
`CollapseSupport.ts` untouched, the file ran 8 failed / 1 passed: every failure
was on a `doLayout` call-count or the E9 `will-change` assertion, and the one
pass was E3, the case the plan says passes before and after. The filter turned
all nine green with no edit to the expectations.

### Pending: the in-engine A/B (E10, *Verification*'s orchestrator half)

**Not run here.** Every `runqa.sh` run opens a full-screen WebKitGTK window and
holds the desktop, so this is left for the user/orchestrator, with the user's
go-ahead. The base SHA below is the real one recorded above.

```sh
# 1. Base arm, at this branch's start point.
cd /home/jika/typescript/typescript-ui
git worktree add .worktrees/_g12-base 54d4cf4b52567e72b5762fb5314dc498946818df --detach
ln -sfn "$PWD/node_modules" .worktrees/_g12-base/node_modules
(cd .worktrees/_g12-base/packages/lib && npm run build:lib)
export QA_WT_LIB="$PWD/.worktrees/_g12-base/packages/lib"

# 2. Fix arm: already built in this worktree, rebuild if the branch moved.
(cd /home/jika/typescript/typescript-ui/.worktrees/split-collapse-static-participants/packages/lib && npm run build:lib)

# 3. The sweep, from the implementation worktree's root, with the script of
#    *Verification* step 3 saved outside the repository as g12-collapse-ab.sh.
cd /home/jika/typescript/typescript-ui/.worktrees/split-collapse-static-participants
bash g12-collapse-ab.sh --dry-run   # expect 10 runqa lines
bash g12-collapse-ab.sh             # opens a full-screen window per run
bash g12-collapse-ab.sh --read
```

Then apply *Verification*'s pass criteria and record the readings in the
`shell-deep` and `shell-shallow` rows' *Validated* cells in
`packages/qa/README.md` — the one file in *Files to Create / Modify / Delete*
this branch deliberately leaves untouched, since its content is the A/B's
result — and `git worktree remove .worktrees/_g12-base`.
