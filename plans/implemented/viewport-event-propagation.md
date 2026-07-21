# Viewport Event Propagation — Implementation Plan

## Overview

`Event.addViewportListener` currently kills every event of a registered type,
app-wide. The window-capture dispatcher
[`baseViewportListener`](packages/lib/src/typescript/lib/core/Event.ts#L147)
calls `evnt.stopPropagation()` at line 153 — before it has run a single
handler, and regardless of what any handler decides. It is installed on
`window` with `{ capture: true }` (`captureOpts`,
[Event.ts:44](packages/lib/src/typescript/lib/core/Event.ts#L44)), so it runs
before anything else in the page. The moment one component registers a
viewport listener for `keydown`, no `keydown` in the whole application reaches
`document`, any element, or any third-party library mounted inside the
framework.

The fix is to delete that unconditional stop and let each handler decide, then
add an explicit `stopPropagation()` call at the handlers that genuinely want to
consume the event. The non-viewport dispatcher
[`baseListener`](packages/lib/src/typescript/lib/core/Event.ts#L84) already
works this way and its comment records that this same bug was found and fixed
there; the viewport path never got the same treatment.[^precedent]

Severity: release-relevant. Both bundled editors are broken by it today, and
any consumer's document-level keyboard accelerator is silently swallowed.[^evidence]

---

## Architecture Decisions

### Port `baseListener`'s propagation policy to the viewport path

The dispatcher never stops propagation on a component's behalf. An event is
halted only when a handler explicitly calls `stopPropagation()`. This is
exactly the policy
[`baseListener`](packages/lib/src/typescript/lib/core/Event.ts#L84-L102)
already implements and documents, and the change makes the two dispatchers
agree.[^precedent]

The mechanism differs from `baseListener` in one respect, deliberately.
`baseListener` wraps `evnt.stopPropagation` in order to *detect* a consume and
skip its own second dispatch stage (the ancestor subtree walk). The viewport
dispatcher has no second stage to gate, so it needs no wrapper — deleting line
153 is the whole change. A consuming handler calls the event's own
`stopPropagation`, which halts native propagation immediately.[^no-wrapper]

### `stopPropagation` in a viewport handler does not skip the other components

Viewport dispatch is a broadcast: every component registered for the type
receives the event, whatever its target. A `stopPropagation()` call from one of
those components stops the event escaping to the page, but the remaining
registered components still receive it. Dispatch order therefore never changes
the outcome.[^broadcast]

Worked example — a `Dialog` (consumes `Tab` when trapping focus) and a
`MenuBar` (observes `keydown`, never consumes) are both registered for
`keydown`. `App` is a `document`-level listener in consumer code.

| Registration order | Dialog runs | MenuBar runs | App sees the event |
|---|---|---|---|
| Dialog, then MenuBar | yes, consumes | yes | no |
| MenuBar, then Dialog | yes | yes, consumes | no |
| MenuBar only (no Dialog open) | — | yes | yes |

### Registrars consume only while they own the interaction

A viewport handler calls `stopPropagation()` when both of these hold: it
actually acted on this event (not just inspected it), and it owns the
interaction for the duration. In practice that means two groups — key handlers
on the branch where they handle the key, and gesture handlers whose listeners
were registered at gesture start and are removed at gesture end. Observers
(`resize`, `focusin`, `blur`, hover tracking, modifier-state watchers) and
listeners registered permanently in a constructor never consume.[^consume-rule]
The full per-registrar verdict is in `## Registrar Audit`.

---

## Registrar Audit

Every `Event.addViewportListener` call site in `packages/lib/src`, and what it
must do after the dispatcher stops consuming on its behalf. Paths are relative
to `packages/lib/src/typescript/lib/`.

**Consume — add an explicit `stopPropagation()`:**

| Site | Type(s) | Where to add the call |
|---|---|---|
| `core/FocusHistory.ts:255` | `keydown` | In `onKeyDown`, beside the existing `e.preventDefault()` (~line 221), on the matched-combo branch only. |
| `core/LayerManager.ts:564` | `keydown` | In `onKeyDown`, immediately before the `return` that follows `_stack[i].layer.requestClose()` — i.e. only when Escape actually closed a layer. |
| `component/menubar/MenuBar.ts:226` | `keydown` | In the `_onKeyDown` arrow (constructor, ~line 86), beside each `e.preventDefault()` in the `switch`. Not on the `_openIndex < 0` early return. |
| `overlay/Dialog.ts:815` | `keydown` | In `onKeyDown`, beside each `e.preventDefault()` in the `Tab` branch; and in `onEnter`, beside its `e.preventDefault()`. |
| `overlay/AbstractWindow.ts:1479-1480` | `mouseup`, `mousemove` | In `onDrag` / `onMouseUp` — registered at title-bar drag start, removed at drag end. |
| `overlay/AbstractWindow.ts:1512-1514` | `mouseup`, `touchend`, `touchcancel` | In `onResizeEnd` — registered at resize start. |
| `overlay/AbstractWindow.ts:2251` | `mousedown` | In `onSnapMouseDown`, only on the branch that calls `target.onDragStart()`. |
| `overlay/DragManager.ts:360-361` | `mousemove`, `mouseup` | In `onMouseMove` / `onMouseUp` — a live drag session. |
| `component/container/Scrollbar.ts:800-804` | `mousemove`, `mouseup`, `touchmove`, `touchend`, `touchcancel` | In `_onDragMove` / `_onDragEnd` — registered at thumb-drag start (line 800), removed at line 837. |
| `component/container/SplitGutter.ts:513-517` | `mouseup`, `touchend`, `touchcancel`, `mousemove`, `touchmove` | In `onDrag` / `onDragStop`. |
| `component/container/WindowBorder.ts:228-232` | same five | In `_fireDragListener` / `_dragStopListener`. |
| `component/table/cell/Header.ts:453-454` | `mousemove`, `mouseup` | In `onResizeDrag` / `onResizeDragStop` — column-resize drag. |
| `layout/Accordion.ts:1760-1762` | `mouseup`, `touchend`, `touchcancel` | In `_boundOnGutterDragEnd`'s target (`onGutterDragEnd`) — gutter drag. |

**Do not consume — no change needed:**

| Site | Type(s) | Why |
|---|---|---|
| `core/Body.ts:85` | `resize` | Observer. |
| `core/FocusHistory.ts:254` | `focusin` | Records the focus trail; must not interfere. |
| `core/LayerManager.ts:562, 563, 565` | `pointerdown`, `focusin`, `blur` | Outside-interaction observers; consuming would break every click in the page. |
| `overlay/Dialog.ts:816`, `Drawer.ts:359`, `Rail.ts:801`, `Popover.ts:887`, `AbstractWindow.ts:2173` | `resize` | Observers. |
| `overlay/AbstractWindow.ts:2221-2223` | `keydown`, `keyup`, `blur` | Snap arming watches a bare modifier press and calls no `preventDefault`. Consuming a bare `Ctrl` keydown would break every Ctrl-chord in the app.[^snap-keys] |
| `overlay/AbstractWindow.ts:2250` | `mousemove` | Highlights the nearest snap border; hover tracking, not a gesture. |
| `overlay/Tooltip.ts:282` | `mousemove` | Anchor watch. |
| `component/container/Scrollbar.ts:180-181` | `mouseup`, `mouseleave` | Registered permanently in the arrow button's constructor. Today these silently kill every `mouseup` in the application as soon as any scrollbar exists. |
| `component/input/SpinButton.ts:116-117` | `mouseup`, `mouseleave` | Registered permanently in the constructor; same reasoning as `Scrollbar`. |

---

## Ordered Implementation Steps

Base this work on `master` **after** the `feature/markdown-tables` →
`feature/hash-router` → `feature/packages-docs` stack merges.[^base-branch]

1. **Write the failing tests first**, in
   `packages/lib/tests/dom/events.test.ts`, appended to the existing
   `Modelled event delivery — polite propagation` describe block (line 262).
   Cover cases 1–4 of `## Expected Behaviour`. Use the same technique that
   block already uses: build the event with `makeEvent`, replace its
   `stopPropagation` with a counting spy, dispatch, assert the count.
   → verify: `npm -w packages/lib run test -- events.test` — the new cases fail.
2. **`packages/lib/src/typescript/lib/core/Event.ts`** — delete the
   `evnt.stopPropagation();` statement at line 153 (and the now-orphaned blank
   line). Leave `baseListener` untouched.
   → verify: `grep -n 'stopPropagation' packages/lib/src/typescript/lib/core/Event.ts`
   returns only the three lines inside `baseListener` (~98–99, and the comment).
3. **`packages/lib/src/typescript/lib/core/Event.ts`** — update the
   `addViewportListener` JSDoc `@remarks` (lines 419-422) to state the new
   policy: every registered component receives the event, and the event keeps
   propagating to the page unless a handler calls `stopPropagation()`.
   → verify: `npm -w packages/lib run docs:build` finishes with zero warnings.
4. **Add the explicit consume calls**, one file at a time, in the order of the
   "Consume" table in `## Registrar Audit`. Do not add a call anywhere in the
   "Do not consume" table.
   → verify: `npm -w packages/lib run typecheck`.
5. **Add the registrar regression tests** — case 5 in
   `packages/lib/tests/unit/core/FocusHistory.test.ts`, case 6 in
   `packages/lib/tests/overlay/LayerManager.test.ts`, case 7 in
   `packages/lib/tests/overlay/Dialog.test.ts`.
   `packages/lib/tests/unit/core/FocusHistory.test.ts` is the model for all
   three — it spies `preventDefault` on a `makeEvent` sentinel and dispatches
   through `DOM.sink.dispatchEvent(DOM.source.getWindow(), …)`; spy
   `stopPropagation` the same way.
   → verify: `npm -w packages/lib run test`.
6. **Update `packages/lib/docs/concepts/events.md`** — the
   `## addViewportListener` section (line 63) gains the propagation rule.
   → verify: `npm -w packages/lib run docs:build`.
7. **Manual verification** of the two editor surfaces (see `## Verification`).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Event.ts` |
| Modify | `packages/lib/src/typescript/lib/core/FocusHistory.ts` |
| Modify | `packages/lib/src/typescript/lib/core/LayerManager.ts` |
| Modify | `packages/lib/src/typescript/lib/component/menubar/MenuBar.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Dialog.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/DragManager.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/Scrollbar.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/SplitGutter.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/WindowBorder.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/Header.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Accordion.ts` |
| Modify | `packages/lib/tests/dom/events.test.ts` |
| Modify | `packages/lib/tests/unit/core/FocusHistory.test.ts` |
| Modify | `packages/lib/tests/overlay/LayerManager.test.ts` |
| Modify | `packages/lib/tests/overlay/Dialog.test.ts` |
| Modify | `packages/lib/docs/concepts/events.md` |

---

## Expected Behaviour

Cases 1–4 are unit-testable in `packages/lib/tests/dom/events.test.ts`. The
offline harness has no `document` node, so "reaches a document-level listener"
is modelled the way the existing polite-propagation tests model it: by counting
calls to the event's native `stopPropagation`. Zero calls means the event was
left free to propagate.

1. **An unconsumed viewport event keeps propagating.** One component registers a
   viewport listener for a fresh type; its handler does nothing. Dispatch an
   event of that type. The handler runs once and the native `stopPropagation`
   is called **0** times. *(Fails before the fix — today the count is 1.)*
2. **A consumed viewport event is halted.** Same setup, but the handler calls
   `evnt.stopPropagation()`. The native `stopPropagation` is called exactly
   **1** time.
3. **A consume does not silence the other registered components.** Two
   components register viewport listeners for the same type. The first
   consumes; the second still runs. Repeat with the registration order
   reversed — both handlers run in both orderings.
4. **No registrations, no effect.** Dispatch a type with no viewport
   registrations: no handler runs and the native `stopPropagation` is called 0
   times.
5. **`FocusHistory` consumes only its combos.** With `FocusHistory.enable()`,
   a `keydown` matching the back combo calls `stopPropagation` once; a
   `keydown` of an unrelated key calls it 0 times.
6. **`LayerManager` consumes Escape only when it closes something.** With a
   dismissable layer registered, `Escape` calls `stopPropagation` once. With
   an empty stack, or with only `"manual"` layers, `Escape` calls it 0 times.
7. **`Dialog` consumes the trapped `Tab` only.** With a shown `Dialog`, a
   `Tab` press that wraps focus calls `stopPropagation` once; a plain
   letter-key `keydown` calls it 0 times.
8. **The `baseListener` path is unchanged.** Every existing case in
   `events.test.ts` still passes, including the two polite-propagation cases at
   lines 270 and 288.

Manual only — the offline harness cannot drive a real editor or real caret:

9. **`MarkdownEditor`**: with the caret inside a WYSIWYG table cell, `Tab`
   moves the caret to the next cell instead of moving focus out of the editor.
10. **`CodeEditor`**: `Tab` inserts an indent instead of moving focus to the
    next control.
11. **Unaffected paths stay working**: `Ctrl+B` in `MarkdownEditor` still
    bolds, and typing still inserts text. Both already work today because they
    ride `beforeinput` / `input` and native default actions rather than
    `keydown` — which is why this bug stayed hidden.[^asymmetry]
12. **Drag gestures are unchanged**: window title-bar drag, window resize,
    split-gutter drag, accordion-gutter drag, scrollbar thumb drag, and table
    column resize all behave as before.

---

## Verification

- `npm -w packages/lib run typecheck`
- `npm -w packages/lib run test` — all suites, including the new cases above.
- `grep -rn 'evnt.stopPropagation' packages/lib/src/typescript/lib/core/Event.ts`
  — expect matches only inside `baseListener`.
- `npm -w packages/lib run docs:build` — zero warnings.
- **Manual, in the demo app** (`npm -w packages/lib run dev`, then
  http://localhost:8015):
  1. **MD Editor tab** — put the caret in a cell of the WYSIWYG table, press
     `Tab`. The caret moves to the next cell. Press `Shift+Tab`; it moves back.
     Confirm focus does not leave the editor.
  2. **CodeEditor tab** — click into the CodeMirror surface, press `Tab`. An
     indent is inserted; focus stays in the editor.
  3. **MD Editor tab** — press `Ctrl+B` over a selection; it still bolds.
  4. **Window demo tab** — drag a window by its title bar, resize it from a
     border, and press `Escape` over an open dialog. All unchanged.

---

## Documentation Impact

No exported signature changes. Two documentation edits:

- `packages/lib/src/typescript/lib/core/Event.ts` — the `addViewportListener`
  JSDoc `@remarks` (lines 419-422) currently describes only the
  not-filtered-by-id behaviour; it must also state the propagation rule.
- `packages/lib/docs/concepts/events.md` — the `## addViewportListener`
  section (line 63) gains one paragraph: a viewport listener does not swallow
  the event; call `stopPropagation()` from the handler when the component
  genuinely consumes it.

---

## Potential Challenges

- **Two window-level capture listeners see the same event.** When a type has
  both element-scoped and viewport registrations, `baseListener` and
  `baseViewportListener` are separately registered on `window`, so both run
  regardless of any `stopPropagation` — a stop does not silence a co-registered
  listener on the same target. That is unchanged by this plan and must stay
  unchanged; do not add cross-dispatcher gating.
- **`Scrollbar` and `SpinButton` become genuinely more permissive.** Their
  constructor-registered `mouseup` / `mouseleave` listeners stop swallowing
  every `mouseup` in the application. Watch for anything that was accidentally
  depending on that during the manual pass — the drag checks in
  `## Verification` cover the plausible cases.
- **Passive listener types.** `wheel` / `scroll` / `touchstart` / `touchmove`
  register passive (`PASSIVE_TYPES`, [Event.ts:42](packages/lib/src/typescript/lib/core/Event.ts#L42)).
  `stopPropagation` is permitted in a passive handler; only `preventDefault` is
  ignored. No special handling needed.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/Event.ts`](packages/lib/src/typescript/lib/core/Event.ts) —
  read `baseListener` (lines 84-145) **first**. It is the precedent this plan
  ports; its comment block at lines 85-95 states the policy in full.
- [`packages/lib/tests/dom/events.test.ts`](packages/lib/tests/dom/events.test.ts) —
  the `polite propagation` block (lines 262-305) is the exact test shape to
  copy for the viewport cases.
- [`packages/lib/tests/dom/TestDOM.ts`](packages/lib/tests/dom/TestDOM.ts) —
  `dispatchEvent` (line 516) and `makeEvent` (line 1247); how events reach the
  real dispatchers offline.
- [`packages/lib/tests/unit/core/FocusHistory.test.ts`](packages/lib/tests/unit/core/FocusHistory.test.ts) —
  the model for testing a viewport registrar offline.
- [`packages/lib/docs/concepts/events.md`](packages/lib/docs/concepts/events.md) —
  the consumer-facing description of the three listener kinds.

---

## Non-Goals

- **No new dispatch layer.** `Event.ts` already is the layer between
  `window` / `document` and the framework, and it already holds the correct
  policy in `baseListener`. Adding another one would duplicate that.[^no-new-layer]
- **No change to `baseListener`.** It is correct; touching it only risks a
  regression in a path this plan does not need to move.
- **No change to viewport registration or teardown.** `addViewportListener` /
  `removeViewportListener` keep their current shape, including the
  `Component`-keyed bucket.
- **No Tab-traversal feature.** This plan makes `Tab` reach the editors that
  already handle it. It does not add framework focus traversal.[^focus-traversal]

---

## Implementation Notes

- **Signature changes to receive the event.** Several of the "Consume" table's
  handlers discarded the event entirely (`AbstractWindow.onMouseUp` /
  `onResizeEnd`, `SplitGutter.onDragStop`, `WindowBorder.onDragStop`,
  `Header.onResizeDragStop`, `Accordion.onGutterDragEnd`) because they only
  ever ran teardown work. Calling `stopPropagation()` from inside them needed
  an event parameter that did not exist. Added one everywhere. The parameter is
  **optional (`e?: Event`) on every method that is public on an exported
  class** — `AbstractWindow.onMouseUp`, `SplitGutter.onDragStop`,
  `WindowBorder.onDragStop` — because a required parameter there is a breaking
  API change for any consumer that overrides or calls the method, and the
  plan's `## Documentation Impact` promises no exported signature changes.
  Internal call-site counting cannot see external consumers, so it is not a
  sufficient criterion for these three. The parameter is required only on
  methods that are `private` and therefore unreachable from outside
  (`AbstractWindow.onResizeEnd`, `Header.onResizeDragStop`).
  `Accordion.onGutterDragEnd` is also optional, because `detach()` calls it
  mid-drag with no event at `Accordion.ts:1130`. Not called out explicitly in
  the plan's audit table, which only named *where* to add the call, not that
  the surrounding signature needed to widen to reach it.
- **A bound wrapper that drops the event silently defeats the consume.**
  `Accordion._boundOnGutterDragEnd` was `() => this.onGutterDragEnd()`, which
  discarded the event, so the `stopPropagation()` inside the handler could
  never run on the viewport path — and because the parameter is optional, the
  typechecker saw nothing wrong. Widened the wrapper to
  `(e: Event) => this.onGutterDragEnd(e)`. The equivalent wrappers on
  `AbstractWindow` (`_boundOnMouseUp`, `_boundOnDrag`, `_boundOnResizeEnd`),
  `WindowBorder` (`.bind(this)`) and `SplitGutter` (method reference) were all
  checked and already forward the event.
- **Manual verification (plan `## Verification` items 1-4), performed live in
  a browser against a dev server serving this branch:**
  - *Item 1 — `MarkdownEditor` Tab in a WYSIWYG table cell: **passes**.* The
    caret moves cell 0→1 on Tab and back on Shift+Tab, and focus stays on the
    editing surface. A `document`-capture probe records `["Tab"]` on this
    branch where it recorded `[]` before the fix. This is the defect that
    motivated the plan and it is fixed.
  - *Item 2 — `CodeEditor` Tab-indent: **still fails, and is out of scope**.*
    Tab does not insert an indent; focus leaves the editor exactly as it did
    before the fix. The cause is unrelated to this dispatcher:
    `CodeEditor.ts:526` registers `keymap.of([...defaultKeymap,
    ...historyKeymap])` and never CodeMirror 6's `indentWithTab`, which is
    required for Tab→indent; `indentWithTab` appears nowhere in the repo.
    **The plan's `[^evidence]` footnote misattributed this symptom to the
    dispatcher bug**, and the claim "breaking Tab in both bundled editors"
    is therefore wrong for `CodeEditor`. Fixing it is a one-line keymap change
    belonging to its own plan, not this one.
  - *Items 3-4 — gesture regressions: **pass**.* Split-gutter drag still works
    and its `mouseup` does not reach a document-capture probe, and post-mouseup
    mousemoves no longer move the gutter, so the consume and the teardown are
    both intact.
  - *Not verified live:* touch-gesture paths (`touchend`/`touchcancel`) and
    window title-bar drag / border resize, which are covered by code review and
    unit tests only.
- **`Dialog`'s Tab branch has three `e.preventDefault()` calls, not two.**
  Beyond the two wrap-focus branches (shift-Tab from first, Tab from last),
  `onKeyDown` also traps Tab entirely when the dialog has zero focusable
  elements (`focusable.length === 0`). Read "beside each `e.preventDefault()`
  in the Tab branch" as covering all three, and added `stopPropagation()`
  there too — trapping Tab in an empty dialog is as much a genuine consume as
  the wrap case.
- **Corrected a stale offline-harness comment in `LayerManager.test.ts`.** Its
  "Documented offline gap" block asserted that `LayerManager`'s private
  `onKeyDown` was unreachable because "the recording sink records
  `dispatchEvent` without invoking listeners." That is no longer true —
  `TestDOM.ts`'s `dispatchEvent` invokes window-registered viewport listeners
  (the same mechanism `FocusHistory.test.ts` already relies on for its own
  keydown-combo tests), which is exactly how the new Escape regression tests
  (case 6) reach it. Narrowed the comment to the part that is still an
  offline gap — the outside-click/pointerdown/blur dispatch, which stays
  unreachable for the reasons `containsAcrossLayers`' tests already document
  — rather than leave a claim beside new passing tests that falsify it.
- **`Dialog` case 7 exercises the empty-focusable trap branch, not the
  wrap-focus branch.** `getFocusable()` reads via `DOM.source.querySelectorAll`,
  which the offline DOM harness stubs to `[]` (already noted by
  `TestDialog`'s own comment for the Enter tests), so offline a shown Dialog
  always finds zero focusable elements and takes the "trap the whole dialog"
  branch on Tab. Both branches now call `stopPropagation()` per the plan, but
  only the empty-list branch is reachable from the offline harness; the
  wrap-focus branch's consume is implemented but not independently
  unit-tested — consistent with the plan's own manual-verification carve-out
  for the caret/focus-dependent behaviour in `## Expected Behaviour` cases
  9-12.
- **The gesture registrars' consume is regression-tested in its own file.**
  `tests/dom/viewport-consume.test.ts` drives a real `mouseup` through
  `DOM.sink` to assert the Accordion gutter drag-end consumes it — the test
  that catches the dropped-event wrapper above, which handler-level tests
  cannot. It needs its own file because `Event`'s `viewportListenerMap` is
  module-level state and the window listener is attached only when a type is
  *first* registered, while `DOM.reset()` replaces the sink without clearing
  that map. Once any earlier test in the same file registers `"mouseup"`, a
  later registration of the same type never re-attaches and no dispatch reaches
  it. That is a pre-existing harness limitation, not something this change
  introduced, and it is why `tests/dom/events.test.ts` gives every dispatcher
  test a `uniqueType()`.
- **Event.ts's two edits landed in separate commits despite sharing a file.**
  The commit skill's bucket rule puts the `baseViewportListener` logic delete
  in the code commit and the `addViewportListener` JSDoc `@remarks` update in
  the documentation commit; the two hunks were applied, staged, and committed
  in two passes to keep them apart even though the file itself is touched
  twice.

---

## Notes

[^precedent]: The precedent is `baseListener` at
    [Event.ts:84-102](packages/lib/src/typescript/lib/core/Event.ts#L84-L102).
    Its comment reads: *"The dispatcher does NOT stop propagation on a
    component's behalf: an event is halted only when a handler explicitly
    consumes it. An unconsumed event therefore keeps propagating — through the
    bubble phase and on to any `document`-level listener (e.g. a consumer's
    global keyboard accelerator), which a proactive stop here used to swallow
    whenever the focused element happened to carry a library listener."* The
    same defect, the same reasoning, the same fix — applied to the other
    dispatcher in the same file. `plans/implemented/hash-router.md` noted the
    viewport stop in passing (*"It also calls `evnt.stopPropagation()` on every
    viewport event, which would be wrong for a global `hashchange`"*) while
    justifying a different decision, but its blast radius was never followed
    up. The finding is not new; only the fix is.

[^evidence]: Root-caused live on the demo app. A probe registered on `window`
    with `{ capture: true }` *after* the framework's own listener recorded
    `["a", "Tab"]`; a `document`-capture probe recorded `[]`. `stopPropagation()`
    does not silence listeners co-registered on the same target, so the window
    probe firing while the document probe stays empty is the precise signature
    of a window-capture stop. Two concrete failures follow from it.
    `MarkdownEditor`: `Tab` inside a WYSIWYG table cell does not move the caret
    cell-to-cell; focus leaves the editor by native traversal instead. The
    `@lexical/table` wiring is correct and was verified with an instrumented
    build — `registerTableSelectionObserver` is registered live, `hasTabHandler`
    is `true` (which enables `KEY_TAB_COMMAND`), and the mutation listener uses
    `{ skipInitialization: false }` so imported tables are initialised. The key
    simply never arrives. `CodeEditor` (CodeMirror): `Tab` does not indent;
    focus escapes to a `Button`.

[^no-wrapper]: `baseListener` needs the wrapper because it dispatches in two
    stages — exact-target listeners, then an ancestor subtree walk — and a
    consume in stage one must skip stage two. The wrapper's `propagationStopped`
    flag is how it learns that. `baseViewportListener` has one stage, and
    `## Architecture Decisions` fixes that a consume does not cut the broadcast
    short, so there is nothing for a flag to gate. Adding a wrapper anyway
    would be dead code. A shared helper extracted across both dispatchers was
    considered and rejected for the same reason: after this change the viewport
    path has no wrapping to share.

[^broadcast]: The alternative, first-consumer-wins (stop dispatching to the
    remaining components), was rejected on two grounds. Registration order among
    viewport listeners is incidental — it reflects which overlay happened to
    open when — so making behaviour depend on it would produce failures that
    reproduce only in one interaction sequence. And several registrars are
    state machines that must see every event to stay consistent:
    `AbstractWindow`'s snap `keyup` disarms a mode armed by an earlier `keydown`,
    and `LayerManager`'s `focusin` / `pointerdown` track outside-interaction
    state. Skipping them on an unrelated component's consume would strand that
    state. `baseListener`'s flag does cut its dispatch short, but the stage it
    cuts is a DOM-hierarchy walk where "an inner handler already dealt with
    this" is meaningful; a flat broadcast has no such ordering to appeal to.

[^consume-rule]: The two-part test — acted on it, and owns the interaction —
    is what separates the two groups in `## Registrar Audit`. A key handler
    that matched its combo and moved focus or closed a menu has acted; the same
    handler on a key it does not recognise has not. A gesture handler
    registered at `mousedown` and removed at `mouseup` owns the pointer for
    that window of time, so consuming is bounded and matches today's behaviour.
    A listener registered permanently in a constructor owns nothing — consuming
    from there is exactly the app-wide swallow this plan removes.

[^snap-keys]: `AbstractWindow.onSnapKeyDown` / `onSnapKeyUp`
    ([AbstractWindow.ts:2294](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2294)
    and 2317) only set `_snapEnabled` and attach or detach the snap mouse
    listeners. They call no `preventDefault` and change nothing the user can
    see beyond a border highlight. The keys they watch are bare modifiers
    (`ctrl` / `meta` / `alt` / `shift`), so consuming would break every
    modifier chord in the application whenever a window is open — a worse
    version of the bug being fixed. The snap subsystem's one genuine consume is
    `onSnapMouseDown`, which hijacks a press to start a border drag.

[^asymmetry]: The affected surface is exactly the events that ride `keydown`.
    Text entry and `Ctrl+B` in `MarkdownEditor` keep working because they are
    driven by `beforeinput` / `input` and by native default actions, which a
    `stopPropagation` on the `keydown` does not touch (that would take
    `preventDefault`). So the bug presents as "some keys work, navigation keys
    don't", which is why it survived so long. The implementer should expect no
    change in typing or formatting behaviour after the fix.

[^no-new-layer]: The question that prompted this plan was whether to add a
    dispatch layer between `window` / `document` and the framework. The answer
    is no. `Event.ts` already occupies that position — one window-level capture
    handler per type, routing to per-id buckets — and it already contains the
    correct propagation policy in `baseListener`. The defect is that one of its
    two dispatchers does not follow it. A second layer would add a seam,
    another ordering question, and a second place for the policy to drift, in
    exchange for nothing. Recorded here so it is not re-proposed.

[^focus-traversal]: `plans/framework-focus-traversal.md` is a **deferred** plan
    for a future opt-in framework `Tab` / `Shift+Tab` traversal service. It is
    unrelated to this one and is not implemented here. The overlap is only that
    both mention `Tab`: this plan stops the framework swallowing key events so
    the browser and the mounted editors handle them, which is the opposite
    direction from installing a framework key interceptor. Nothing here makes
    that deferred plan more or less likely to be picked up.

[^base-branch]: `core/Event.ts` is byte-identical across `master`,
    `feature/markdown-tables`, `feature/hash-router`, and
    `feature/packages-docs` (`git diff master feature/packages-docs --
    packages/lib/src/typescript/lib/core/Event.ts` is empty), so this fix does
    not conflict with the stack. Branching from `master` after the stack merges
    avoids forcing a rebase on work already in flight.
