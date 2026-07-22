# DOM-Only State Audit — Implementation Plan

## Overview

A planned follow-up feature will let a `Component` **release its DOM element and rebuild it later**: the component keeps its JS state and its id, discards the element, and re-materializes on the next `getElement(true)`. The risk that feature carries is state that lives *only* in the DOM and is mirrored by no JS field — it disappears on release with nothing to restore it from.

This plan is an **audit**, not a code change. The implementer reads code and produces a catalogue. It creates exactly two files: the inventory document and one probe-test file. **No library source file is modified.**

The deliverable is [`plans/dom-only-state-inventory.md`](plans/dom-only-state-inventory.md) — a table of every place the library holds state in the DOM that a rebuild would drop, each row carrying the owning class, the file and line, how the state is written and read, whether a JS field already mirrors it, and a verdict of **replay**, **accept-loss**, or **opt-out**.

---

## Architecture Decisions

### The inventory is a Markdown document at `plans/dom-only-state-inventory.md`

One file, two fixed-column tables, checked into the repo beside the plan that will consume it.[^where]

### Three verdicts for lost state, plus a separate table for stale references

The audit found two different failure shapes while scoping, and mixing them in one column would blur both.[^two-shapes]

**Table A — state that would be lost.** Every row gets exactly one verdict:

| Verdict | Meaning |
|---|---|
| `replay` | The state must be captured before release and reapplied on rebuild. |
| `accept-loss` | Losing it is harmless; the row states why. |
| `opt-out` | This component must refuse release entirely. |

**Table B — element-derived references that would go stale.** These are not lost state; they are JS fields or map keys that point at the *old* element and would silently keep pointing there after a rebuild. Each row names the field and what must invalidate it. No verdict column.

### The sweep is defined by two greps, and that defines "complete"

The library routes **every** DOM access through the seam in [`core/DOM.ts`](packages/lib/src/typescript/lib/core/DOM.ts), enforced by the `local/no-raw-dom` ESLint rule with an empty baseline. So DOM-only state cannot exist in a file that never reaches the seam. Two greps therefore bound the sweep exactly (step 2 gives the exact commands). The audit is complete when every file in the union of those two lists is either represented by a row or listed in the inventory's "no DOM-only state" section.[^nets]

### Probe tests: yes, using `render()` as the rebuild half

The audit ships one test file that drives a component's state, calls `render()` again, and asserts what the fresh element does and does not receive. `render()` ([Component.ts:5319](packages/lib/src/typescript/lib/core/Component.ts#L5319)) creates a new element and runs `init()` on it — `init()` *is* the rebuild half of release-and-rebuild, so the probe exercises the real path without needing the release API to exist yet.[^probes]

The offline harness delivers no events and paints nothing, so the probe can only decide entries whose evidence is a **recorded write**. Focus, text selection, canvas pixels, media playhead, `contenteditable` content, and fullscreen state produce no recorded write and are classified by reading, with a `manual-verify` note naming the browser check.

### Attribute state is delegated to the sibling plan

The write-through `setElementAttribute` seam ([Component.ts:1247](packages/lib/src/typescript/lib/core/Component.ts#L1247)) keeps no cache at all, so every value written through it is DOM-only by construction. The sibling plan `element-attribute-replay-buffer` is fixing that seam. The inventory records the whole class as **one row** pointing at that plan rather than cataloguing each call site.[^attrs]

---

## The inventory document's format

The implementer writes this file. Its shape is fixed — do not invent extra columns or reorder them.

```markdown
# DOM-Only State Inventory

<!-- Not an implementation plan. A catalogue produced by plans/dom-only-state-audit.md. -->

## Verified assumptions
## Table A — state a rebuild would lose
## Table B — element-derived references a rebuild would leave stale
## Files swept with no DOM-only state
## Coverage
```

**Table A columns**, in this order:

`Class` | `Site` | `State` | `Written by` | `Read by` | `JS mirror?` | `Verdict` | `Notes`

Three worked rows, showing how each verdict is justified. Use these verbatim as the first rows — they are already verified:

| Class | Site | State | Written by | Read by | JS mirror? | Verdict | Notes |
|---|---|---|---|---|---|---|---|
| `TextInput` | [TextInput.ts:610](packages/lib/src/typescript/lib/component/input/TextInput.ts#L610) | Text selection range | `DOM.sink.setSelectionRange` | nothing — write-only | no | `replay` | probe: no `setSelectionRange` on the rebuilt element. manual-verify: caret position after rebuild while focused |
| `TextInput` | [TextInput.ts:695](packages/lib/src/typescript/lib/component/input/TextInput.ts#L695) | Input `value` | `DOM.sink.setValue` from `init()` | [TextInput.ts:134](packages/lib/src/typescript/lib/component/input/TextInput.ts#L134) `DOM.source.getValue` | yes — `_options.text` | `accept-loss` | already replayed by `init()`; probe confirms |
| `WebGLCanvas` | [WebGLCanvas.ts:192](packages/lib/src/typescript/lib/component/display/WebGLCanvas.ts#L192) | GL context + every GPU resource built against it | `DOM.sink.getContext` | `_gl` field | no — the context *is* the state | `opt-out` | a new element yields a new context; buffers, textures and shaders compiled against the old one are unrecoverable |

**Table B columns**: `Class` | `Field or map` | `Site` | `Points at` | `Invalidated by`. Two verified rows to start:

| Class | Field or map | Site | Points at | Invalidated by |
|---|---|---|---|---|
| `Canvas` | `_ctx` | [Canvas.ts:148](packages/lib/src/typescript/lib/component/display/Canvas.ts#L148) | the 2D context of the released element | nothing today — must be cleared on release |
| `Tooltip` | `elementAttachments` (static `Map<Handle, …>`) | [Tooltip.ts:75](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L75) | the released element's handle | nothing today — the entry outlives the element and the rebuilt element has no tooltip until its owner re-attaches |

**Coverage section**: the two grep commands, the file count each returned *at audit time*, and a checklist confirming every file appears either in a table or in the "no DOM-only state" list. Re-run the greps and use the live counts — do not copy the numbers from this plan.

---

## Starting list — leads already verified

These are confirmed starting points, **not** the full set. The greps in step 2 are what makes the sweep exhaustive.

| Area | Where to look | What was already established |
|---|---|---|
| Native input value | [TextInput.ts:482](packages/lib/src/typescript/lib/component/input/TextInput.ts#L482), [:695](packages/lib/src/typescript/lib/component/input/TextInput.ts#L695); cell editors [Date.ts:88](packages/lib/src/typescript/lib/component/table/cell/editor/Date.ts#L88), [Time.ts:90](packages/lib/src/typescript/lib/component/table/cell/editor/Time.ts#L90), [DateTime.ts:107](packages/lib/src/typescript/lib/component/table/cell/editor/DateTime.ts#L107) | mirrored and replayed from `init()` |
| Selection range | [TextInput.ts:610](packages/lib/src/typescript/lib/component/input/TextInput.ts#L610) | no mirror |
| File selection | [FileField.ts:135](packages/lib/src/typescript/lib/component/input/FileField.ts#L135) `getFiles` | a `FileList` cannot be written back — decide `accept-loss` vs `opt-out` |
| Focus | [Component.ts:4237](packages/lib/src/typescript/lib/core/Component.ts#L4237), [Dialog.ts:779](packages/lib/src/typescript/lib/overlay/Dialog.ts#L779) / [:1101](packages/lib/src/typescript/lib/overlay/Dialog.ts#L1101), [FocusHistory.ts:153](packages/lib/src/typescript/lib/core/FocusHistory.ts#L153) / [:262](packages/lib/src/typescript/lib/core/FocusHistory.ts#L262) | restoring focus re-runs native `focus()`, which scrolls `overflow:hidden` ancestors unless `preventScroll` is passed — note it on the row |
| Native scroll | [Component.ts:3299-3335](packages/lib/src/typescript/lib/core/Component.ts#L3299) cached; bypassed at [PickerColumn.ts:389](packages/lib/src/typescript/lib/component/input/PickerColumn.ts#L389) and [AbstractSelectableList.ts:2010](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L2010) | `_scrollLeft` / `_scrollTop` mirror it, but nothing reapplies them after a rebuild, and the two bypass sites never update the mirror |
| Library scroll models | [VirtualScroller.ts:55-56](packages/lib/src/typescript/lib/component/container/VirtualScroller.ts#L55), `Tab` / `TabBar` strip offset | offsets are cached in JS; check whether the *transform* that renders them is reapplied |
| Canvas / WebGL | [Canvas.ts:148](packages/lib/src/typescript/lib/component/display/Canvas.ts#L148), [WebGLCanvas.ts:192](packages/lib/src/typescript/lib/component/display/WebGLCanvas.ts#L192) | contexts are cached and unrecoverable |
| Media | [Video.ts:368](packages/lib/src/typescript/lib/component/display/Video.ts#L368) `setCurrentTime`, [:383](packages/lib/src/typescript/lib/component/display/Video.ts#L383) / [:398](packages/lib/src/typescript/lib/component/display/Video.ts#L398) play/pause, [:414](packages/lib/src/typescript/lib/component/display/Video.ts#L414) `getMediaState`; fullscreen at [VideoPlayer.ts:458](packages/lib/src/typescript/lib/component/display/VideoPlayer.ts#L458) | muted / volume / playbackRate are replayed from `init()` ([Video.ts:474](packages/lib/src/typescript/lib/component/display/Video.ts#L474)); playhead and paused state are not cached anywhere |
| Foreign live widgets | [MarkdownEditor.ts:259](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L259), [CodeEditor.ts:563](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L563) (`DOM.sink.mountView`) | document text is held headless outside the DOM; undo history, selection and scroll live in the mounted view |
| Element-bound native listeners | [Video.ts:561](packages/lib/src/typescript/lib/component/display/Video.ts#L561), [VideoPlayer.ts:539](packages/lib/src/typescript/lib/component/display/VideoPlayer.ts#L539), [Tooltip.ts:538-541](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L538), [Popover.ts:893](packages/lib/src/typescript/lib/overlay/Popover.ts#L893), [Animation.ts:140](packages/lib/src/typescript/lib/core/Animation.ts#L140) / [:233](packages/lib/src/typescript/lib/core/Animation.ts#L233) | these bind to an element, not an id, so they do **not** survive a rebuild — unlike everything routed through `Event` |
| Pointer capture | [Slider.ts:551](packages/lib/src/typescript/lib/component/input/Slider.ts#L551) | an active capture dies with the element mid-drag |
| Attributes | 26 `setElementAttribute` call sites | one row, delegated to `element-attribute-replay-buffer` |
| Frames and handles | [Component.ts:409](packages/lib/src/typescript/lib/core/Component.ts#L409) clip frame, [:419](packages/lib/src/typescript/lib/core/Component.ts#L419) content frame, [:325](packages/lib/src/typescript/lib/core/Component.ts#L325) `_ownedHandles` | Table B material |

Two things the audit does **not** need to re-derive, because step 1 confirms them: observers (`ResizeObserver` / `IntersectionObserver` / `MutationObserver`) do not appear anywhere in the library, and there is no `<details>`, `<dialog>`, or native `checked` state — `Checkbox` keeps its selected and indeterminate state in `_options` and draws its own mark.

---

## Ordered Implementation Steps

1. **Confirm the two framework claims the feature rests on, and record them under "Verified assumptions".** Each gets one line plus a file:line citation.
   - Lazy re-materialization: `getElement()` re-renders when `_element` is unset ([Component.ts:863](packages/lib/src/typescript/lib/core/Component.ts#L863)).
   - Id-keyed event routing: `Event` installs one window-level capture listener per type ([Event.ts:101](packages/lib/src/typescript/lib/core/Event.ts#L101)) and dispatches by resolving component ids while walking up from the target ([Event.ts:163-186](packages/lib/src/typescript/lib/core/Event.ts#L163)), so no listener is bound to the element.
   - Also record what `init()` already replays onto a fresh element ([Component.ts:5245-5300](packages/lib/src/typescript/lib/core/Component.ts#L5245)): id, class name, the buffered inline styles, the `_attributes` map, the disabled attribute, `_options.attributes`, ARIA, `applyStyle`, and re-appending each child's existing element. Anything on this list is `accept-loss` by default; anything not on it is a candidate row.

2. **Build the sweep list.** From `packages/lib`:
   ```
   grep -rl 'DOM\.\(sink\|source\)\.' src/typescript/lib/{core,component,overlay,primitive,layout,router}
   grep -rl 'this\.setElementAttribute(\|this\.removeElementAttribute(' src/typescript/lib
   ```
   Record both counts in the inventory's Coverage section. `data/`, `validation/`, and `glyphs/` are out of scope — they return zero matches, which is the evidence, not an assumption. Write the deduplicated file list into the Coverage section as a checklist.

3. **Sweep `core/` and `overlay/`** — read each file on the list and add rows. These two directories own the shared machinery (`Component`, `Event`, `Animation`, `FocusHistory`, `Dialog`, `Popover`, `Tooltip`, `DragManager`), so their rows constrain everything downstream. Tick each file off the checklist as you go.

4. **Sweep `component/`**, directory by directory in this order: `input/`, `display/`, `editor/`, `table/`, `list/`, `tree/`, `container/`, `chart/`, `diagram/`, `button/`, `menubar/`, `shared/`. Same rule: a row, or a tick in "no DOM-only state".

5. **Sweep `layout/`, `router/`, and `primitive/`.** `primitive/` has no seam calls at all — record it as swept-and-empty with the grep as evidence.

6. **Cross-check the `init()` / `render()` overrides.** `grep -rln 'protected init(\|protected render()' src/typescript/lib` returns the subclasses that extend the rebuild path. For each, confirm the override's replay set matches the rows you wrote for that class: state the override replays is `accept-loss`, state it does not is `replay` or `opt-out`. Any mismatch means a row is wrong — fix the row, not the code.

7. **Write the probe test file** `packages/lib/tests/component/dom-state-replay-probe.test.ts`, following the harness idiom in [tests/component/display/Video.test.ts](packages/lib/tests/component/display/Video.test.ts) (`installTestDOM(CONFIG)` in `beforeEach`, `DOM.reset()` in `afterEach`, assertions read off `DOM.sink.writes`). Two shared helpers at the top of the file:
   - `rebuild(component)` — calls the protected `render()` through a single cast and returns the new handle.
   - `writesFor(handle)` — filters `DOM.sink.writes` to entries whose first argument is that handle.

   Cover the cases in `## Expected Behaviour`. Every probe asserts against the **new** handle only.

8. **Add the probe results to the inventory.** Each row the probe decided gets `probe: <one-line result>` in its Notes column; each row it cannot decide gets `manual-verify: <the browser check>`.

9. **Close the coverage check.** Every file on the step-2 checklist is ticked. Add the final row and file counts to the Coverage section, derived by re-running the greps — never copied from this plan.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `plans/dom-only-state-inventory.md` |
| Create | `packages/lib/tests/component/dom-state-replay-probe.test.ts` |

No library source file is created, modified, or deleted.

---

## Expected Behaviour

### The probe test file

Each case names the state, the action, and the assertion against the rebuilt element's writes. All are unit-testable offline.

| Case | Setup | Assertion on the rebuilt element | What it proves |
|---|---|---|---|
| Input value replays | `TextInput`, render, `setText("abc")`, rebuild | a `setValue` write carrying `"abc"` | `_options.text` mirrors the value and `init()` reapplies it |
| Selection range is lost | `TextInput`, render, `setSelectionRange(1, 2)`, rebuild | no `setSelectionRange` write | selection has no mirror — verdict `replay` |
| Native scroll is lost | any `Component` with a scrollable element, `setScrollTop(40)`, rebuild | no patch carrying `scrollTop` | the `_scrollTop` mirror exists but nothing reapplies it — verdict `replay` |
| Media options replay | `Video`, render, options carrying `muted` / `volume` / `playbackRate`, rebuild | `setMuted`, `setVolume`, `setPlaybackRate` writes | `replayMediaOptions` runs from `init()` — verdict `accept-loss` |
| Playhead is lost | `Video`, render, `setCurrentTime(12)`, rebuild | no `setCurrentTime` write | the playhead has no mirror — verdict `replay` |
| Media listeners re-attach | `Video`, render, rebuild | one `addListener` write per media type | element-bound listeners are reinstalled by `init()`, so `Video`'s own listeners survive |
| Attributes written through the raw seam are lost | plain `Component`, render, then `setElementAttribute("data-probe", "1")` through the same cast the `rebuild` helper uses, rebuild | no `setAttr` write carrying `data-probe` | the write-through seam keeps no cache — the row delegating to `element-attribute-replay-buffer` is justified |

### The inventory document

- Every file on the step-2 grep list appears exactly once: as the `Site` of at least one row, or in the "no DOM-only state" list.
- Every Table A row carries exactly one of `replay`, `accept-loss`, `opt-out`, and every `accept-loss` row states its reason in Notes.
- Every row whose evidence is a probe carries `probe:`; every row that cannot be decided offline carries `manual-verify:` naming the browser check.
- No row prescribes a code change. The inventory records what is true; the follow-up plan decides what to do.

### Manual verification

Nothing in this audit is verified in a browser. A real rebuild needs the release API, which does not exist yet, so there is no way to trigger one live. Entries the offline probe cannot decide are therefore **recorded, not run**: the row states the check a browser could perform once release exists, prefixed `manual-verify:`, and the follow-up plan runs it.

Examples of the form each such note takes:

- Focus: *manual-verify: re-focus after rebuild does not scroll an `overflow:hidden` ancestor (needs `preventScroll`).*
- Canvas: *manual-verify: a rebuilt `<canvas>` starts blank until the draw hook runs again.*
- Media: *manual-verify: a rebuilt `<video>` restarts from position zero.*

---

## Verification

- `npm test` from the repo root — the new probe file passes, and no existing test changes.
- `npm run typecheck` — the cast used by the `rebuild` helper compiles.
- `npm run lint` — the probe file is under `tests/`, so the `local/no-raw-dom` rule does not apply, but the lint run must stay clean.
- Re-run both step-2 greps and confirm every returned file is ticked in the inventory's Coverage checklist.
- `git status` shows exactly two new files and no modified source file.

---

## Potential Challenges

- **The probe's `rebuild` helper reaches a protected method.** It is a test-only cast, isolated to one helper at the top of one file; do not export it or add a public method to `Component` for it.
- **`render()` does not clear `_element`.** After `rebuild(component)` the component still returns the *old* handle from `getElement()`. Assert only against the handle `rebuild` returned, never via `getElement()`.
- **The starting list is a floor, not a ceiling.** The temptation is to write rows only for the leads above and stop. The coverage checklist is what closes the audit; a file with no row must be ticked as empty explicitly.
- **Hand-copied counts go stale.** Every count in the inventory is derived by re-running a grep at audit time. Do not turn the numbers in this plan into assertions.

---

## Critical Files

- [packages/lib/src/typescript/lib/core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts) — `getElement` (:863), `init` (:5245), `render` (:5319), `destructor` (:693), `setElementAttribute` (:1247), the scroll cache (:3299-3360), clip/content frames (:409, :419), `_ownedHandles` (:325).
- [packages/lib/src/typescript/lib/core/Event.ts](packages/lib/src/typescript/lib/core/Event.ts) — the window-level capture install (:101) and the id-keyed dispatch walk (:163-186).
- [packages/lib/src/typescript/lib/core/DOM.ts](packages/lib/src/typescript/lib/core/DOM.ts) — the sink and source verb lists; the `ElementPatch` shape (:124) names every scalar a patch can carry.
- [packages/lib/tests/dom/TestDOM.ts](packages/lib/tests/dom/TestDOM.ts) — `installTestDOM` (:1219), `RecordingDOMSink.writes` (:313).
- [packages/lib/tests/component/display/Video.test.ts](packages/lib/tests/component/display/Video.test.ts) — the harness idiom the probe file mirrors.
- [packages/lib/llms.txt](packages/lib/llms.txt) — the generated capability index; use it to orient in the component surface. Never hand-edit it.
- `plans/element-attribute-replay-buffer.md` — the sibling plan the attribute row delegates to. It is being written in parallel with this one; if the file is not on disk yet, still write the delegating row and cite the plan by name.
- [ARCHITECTURE.md](ARCHITECTURE.md) — *Minimize direct DOM access*, *Three non-negotiable rules for every DOM write*.

---

## Non-Goals

- **No library source changes.** Not even an obviously-correct one-line mirror field. Every fix belongs to the follow-up plan, which needs the whole picture before it decides.
- **No release API.** This plan does not design, name, or prototype `release()`.
- **No attribute-by-attribute catalogue.** `element-attribute-replay-buffer` owns that gap; duplicating it would produce two lists that drift.
- **No performance measurement.** Whether release-and-rebuild is worth doing is a separate question from what it would break.
- **No docs pages.** The inventory is an internal engineering artefact; nothing consumer-visible changes.

---

## Notes

[^where]: `plans/` is where this repo keeps internal engineering artefacts, including two prior audits (`plans/implemented/component-setter-api-audit.md`, `plans/implemented/input-component-class-hierarchy-audit.md`). `packages/lib/docs/` was rejected because it is the consumer-facing tree rendered into the docs app — an internal catalogue of framework weak points does not belong there. A new top-level directory for a single file is worse than a slightly loose fit. The one cost of `plans/` is that `/implement` scans it, so a reader could mistake the inventory for a plan; the title (`# DOM-Only State Inventory`, no `— Implementation Plan` suffix) and the HTML comment on line 3 mark it as data.

[^two-shapes]: Scoping turned up two failure modes that need different follow-up work. The first is state that vanishes: a text selection, a scroll offset, a playhead. The second is a JS field or map key that keeps pointing at the released element — `Canvas._ctx` ([Canvas.ts:148](packages/lib/src/typescript/lib/component/display/Canvas.ts#L148)) still holds the dead element's context, `Popover._anchorElement` still holds a released anchor, and `Tooltip.elementAttachments` ([Tooltip.ts:75](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L75)) is keyed by handle, so the entry both leaks and stops firing. Forcing the second shape into a `replay`/`accept-loss`/`opt-out` column would misdescribe it: nothing is replayed, something is invalidated.

[^nets]: Two nets are needed because they catch different things. The seam grep catches any file that writes or reads DOM state directly. The `setElementAttribute` grep catches components that hold DOM-only state without naming `DOM` themselves, because they route through the inherited `Component` escape hatch — a write-through seam with no cache ([Component.ts:1247](packages/lib/src/typescript/lib/core/Component.ts#L1247)). Everything else — inline styles, CSS rules, ARIA — is buffered and replayed by `init()` / `applyStyle`, so it cannot be DOM-only. At drafting time the first grep returned 104 files and the second 7; both numbers are recorded here only to set expectations for the size of the job.

[^probes]: The alternative was to classify by reading alone. It was rejected because the single most error-prone judgement in this audit — "is this state already replayed?" — is exactly what a recorded write set answers mechanically, and `init()` replays enough (id, classes, buffered inline styles, the attribute map, ARIA, `applyStyle`, child re-append) that reading each subclass override and reasoning about what it covers is both slow and easy to get wrong. Writing a throwaway `release()` for the test was also rejected: a test-only reimplementation would prove things about itself, not about the shipped path, whereas `render()` is the real rebuild half and exists today.

[^attrs]: 26 call sites across `TextArea`, `Video`, `FileField`, `MarkdownEditor`, `TextInput`, `AbstractSelectableList`, and `TextInputCellEditor` write through `setElementAttribute`, plus 11 through `removeElementAttribute`. Some already carry their own replay field and reapply it from a subclass `init()` (`TextInput` does this for `type`, `name`, `placeholder`, `readonly`, `maxlength`, `inputmode`; `MarkdownEditor` does it for `contenteditable` at [MarkdownEditor.ts:201](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L201)); others do not. Enumerating which is which is precisely what `element-attribute-replay-buffer` is doing, and two independently-maintained lists of the same call sites would diverge on the first change. The one thing the audit must still catch: a `setElementAttribute` site whose state is *not* recoverable from an attribute value (a `<video>` `src` mid-download, say) gets its own Table A row, because an attribute replay buffer would not restore it.

## Implementation Notes

- **The mandated `TextInput` value row was factually wrong and was corrected
  after review.** This plan hard-codes that row at line 74 as "already
  verified" and instructs the implementer to reproduce it verbatim, so the
  implementer had no licence to correct it. The row attributed the `value`
  write to `init()`. `TextInput.init()` ([TextInput.ts:651-685](packages/lib/src/typescript/lib/component/input/TextInput.ts#L651-L685))
  replays only `type`/`name`/`placeholder`/`readOnly`/`maxLength`/`inputMode`/`autoComplete`
  and never calls `setValue`; the write lives in the `render()` override
  ([TextInput.ts:692-698](packages/lib/src/typescript/lib/component/input/TextInput.ts#L692-L698)),
  which calls `super.render()` — that is what runs `init()` — and *then* writes
  the value. The `accept-loss` verdict still holds, because `_options.text`
  mirrors the live value (kept current by the `"input"` listener at
  [TextInput.ts:119](packages/lib/src/typescript/lib/component/input/TextInput.ts#L119))
  and a rebuild through `getElement(true)` reaches `render()`. The distinction
  is load-bearing for the follow-up feature: a release path that re-ran `init()`
  alone would leave the input blank.

- **`writesFor(handle)` could not filter by `args[0] === handle` as specified.**
  `RecordingDOMSink` (`tests/dom/TestDOM.ts`) only includes the target handle
  in `args` for a minority of ops (`apply`, `appendChild`, `release`); most
  single-purpose ops the probes need — `setValue`, `setSelectionRange`,
  `addListener`, `focus`, `blur`, `setCurrentTime`, `setMuted`, `setVolume`,
  `setPlaybackRate` — omit the handle from `args` entirely (e.g.
  `setValue(handle, value)` records `{op: 'setValue', args: [value]}`, not
  `[handle, value]`). Filtering on `args[0] === handle` is therefore unusable
  for exactly the ops this file's cases depend on. `rebuild()` still returns a
  plain `Handle` exactly as specified; `writesFor(handle)` still takes just a
  `Handle` exactly as specified. Internally, `rebuild()` now records the
  write-log length just before calling `render()` into a small `Map<Handle,
  number>`, and `writesFor` returns the slice from that index onward. Since
  each probe renders exactly one component with no children, every write in
  that slice is unambiguously the fresh element's — the temporal window
  achieves the same isolation the plan's handle-filter approach intended.
  `Handle` is also a branded `number` (`core/DOM.ts`), not an object, so the
  first attempt (a `WeakMap`) threw `TypeError: Invalid value used as weak
  map key` — switched to a plain `Map`.
- **`rebuild`/`setRawAttribute`'s parameter type is `Component<any>`, not
  `Component`.** A bare `Component` parameter rejected `TextInput<{text:
  string}>` under `--strict` (`_options` on the narrower generic instance has
  no properties in common with `ComponentOptions`). `Component<any>` accepts
  every specialization while keeping the cast — not the parameter type — as
  the type-safety escape hatch, matching the plan's intent that only the cast
  itself is the sanctioned unsafe surface.
- **`npm run lint` does not pass clean**, contrary to the plan's Verification
  step. Five pre-existing `eslint` errors exist on unmodified `master`
  (confirmed: this branch's `src/` tree is byte-identical to `master`'s — the
  only diff is the two new files) in `component/editor/CodeEditor.ts` and
  `component/table/cell/renderer/Link.ts`, unrelated to this audit and out of
  scope to fix (`## Non-Goals`: no library source file changes). Recorded
  here rather than silently declared "clean."
- **Table A verdict divergence at two structurally similar bypass sites.**
  `PickerColumn.ts:389` and `AbstractSelectableList.ts:2010-2012` both write
  `scrollTop` directly, bypassing `Component`'s scroll mirror — but they
  reach different verdicts (`accept-loss` vs `replay`) because the caller
  context differs: `PickerColumn`'s write is reactively re-issued by the next
  relevant interaction, `AbstractSelectableList`'s is not. This is a
  deliberate per-site judgement, not an inconsistency to reconcile.
