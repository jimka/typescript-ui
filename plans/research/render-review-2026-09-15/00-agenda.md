# Render-review agenda — decisions taken after the synthesis

Records what the user decided once `99-synthesis.md` landed, so the plan
authors inherit the decisions rather than re-deriving them. The synthesis
stays the evidence; this file is the running order.

## Decision 1 — the correctness bugs get their own wave, first

The synthesis lists 36 (section 5). They are not render-work findings and do
not wait behind a performance plan. Wave 0 takes the ones that can lose a
user's data, crash a frame, or lock a user out of the keyboard:

| Plan slug | Covers | Why first |
|---|---|---|
| `cell-editor-record-binding` | C1 | Silent data loss: an open editor commits onto whichever record the pool slot now holds. |
| `autocomplete-store-query` | C2, C5 | Silent data loss: the field destroys the consumer's own store filters on every keystroke, and leaks two timers past disposal. |
| `layout-flush-degenerate-inputs` | C3, C17, C20, C28 | An auto `Grid` with zero laid-out children throws and drops the whole frame's layout flush; the emptied-box size reports and the blank `Card` are the same degenerate-input family. |
| `focusable-selector-and-roving` | C32, C4 | Every roved-off button is still a Tab stop and a resting `CodeEditor` exposes none; five `it.todo`s already pin it. Carries the childless-`ToolBar` arrow-key crash. |

The remaining 30 — the unbounded leaks, the wrong-render set, the stuck-state
set — are grouped in `99-synthesis.md` §5 and ride in later waves, mostly
inside whichever performance group already edits that file. Three exceptions
that should not wait, because each is a growing leak on a path the target app
runs constantly: C7 (`codeEditorTheme` rules, in G25), C8 (`Dock` and `Window`
drop-target retention), C6 (`Text.setLineHeight(NaN)`, in G07).

## Decision 2 — a library flag for live-resize versus outline-preview

**The user's proposal.** A flag controlling whether dragging a gutter or a
window edge relays out the content live, or moves an outline and commits once
on release.

**Status: adopted, needs a plan.** It is a new feature, not a finding from
the review, so it gets its own plan rather than joining a performance group.
It supersedes the `CodeEditor` box-decoupling lever (23 F23.2) that the
synthesis deliberately left out of every group as a product decision: the flag
is that decision, taken generally instead of per-component.

### Precedent to follow

1. **`plans/implemented/window-large-resize-fade.md` already implements the
   mechanism.** Above a 960 px sweep, `AbstractWindow` stops relaying out the
   body every tween frame, pauses the body's layout for the glide, and pays
   for one relayout when it lands
   (`overlay/AbstractWindow.ts:33-61`). That is outline mode with a fade
   instead of an outline, chosen automatically instead of by a flag. The plan
   generalises it; it does not invent it.
2. **Swing's `JSplitPane.setContinuousLayout(false)`** is the API precedent.
   `packages/lib/llms.txt` states the framework's mental model is "closer to
   Java Swing than to React", so the name and the semantics should be
   recognisable to that reader.
3. **One seam covers every drag.** `core/PointerDrag.ts` is routed through by
   all four drag owners — `component/container/SplitGutter.ts`,
   `component/container/WindowBorder.ts`, `component/table/cell/Header.ts`,
   `component/container/Scrollbar.ts`. The flag belongs at that seam, not
   copied into each owner.
4. **The outline itself must not repeat the drag ghost's mistake.** Slice 10
   found `DragGhost` moving a translucent, box-shadowed, un-composited fixed
   box with `left`/`top` per raw mousemove. The outline is a 1–2 px border on
   its own pre-promoted layer, moved with `setTranslate`, per the pattern
   slice 09 verified in `AbstractWindow`'s header drag — one apply per frame,
   no rule write, no forced read, and no blur or large translucent fill.

### Decisions the plan must settle, with the recommendation

| Question | Recommendation |
|---|---|
| Name and shape | `resizeMode: "live" \| "outline"` — a string union, matching the house style (`widthMode`, `scrollbarStyle`, the box `mode` options) and leaving room for a third value without a breaking change. |
| Default | `"live"`. No behaviour change for any existing consumer; the target app opts in. |
| Where it is set | Per-instance option on `Split`, `Accordion` and `AbstractWindow`, plus a global default through `core/ComponentDefaults.ts`, so an app sets it once. |
| Which drags | The container resizes: `Split` gutter, `Accordion` section, in-page window edge, and `Dock` panes (which get it through `Split`). Table column resize stays live — slice 20 measured that path already clean, and a column outline reads oddly against a live header. |
| Clamping, snap, collapse | The outline honours them live. A user must never see an outline in a position the release cannot produce. |
| Cancel | Escape restores and commits nothing. |
| Keyboard resize | Stays live; there is no drag to preview. |

### The `pauseLayout` hazard the plan must handle

The obvious implementation is `pauseLayout()` on the affected subtree for the
duration of the drag. `plans/implemented/collapsed-panes-leave-render-tree.md`
**considered and rejected** exactly that for the collapsed pane, for three
reasons: it is a public boolean flag, `resumeLayout()` runs a synchronous
layout, and widgets read `isLayoutPaused()` for non-layout behaviour. The
window-fade path uses it anyway, so it is not forbidden — but the plan must say
which of the three objections apply to a drag and how each is answered.

### What the flag buys, and what it does not

Buys: the per-frame cost of a gutter drag and an in-page window resize drops
to one outline move, whatever the rest of the library does. It is the only
lever on the measured 15–20 ms per visible `CodeEditor` per frame.

Does **not** buy, so the performance groups still stand:

- **OS-driven window resize.** Under Tauri, dragging the native window frame
  is the compositor's drag, not the library's — there is nothing to outline.
  The user's own report that maximising on an ultra-wide monitor got faster
  after the shadow-strip fix came from that path.
- **Every non-drag hot path** — scroll, typing, hover, data refresh, theme
  change, first render — is untouched by the flag.
- **Consumers who keep `"live"`**, which is the default and what most modern
  apps choose, get nothing from it.

So the flag is complementary to G04, G07, G09 and G10, not a substitute. It
should be planned alongside them, and measured with `resizeMode: "live"` so the
two effects stay separable.
