# 15 inputs-text-boolean-slider — render-work review

**Summary**

1. `FieldDecorator.clearError()` issues a **stylesheet-rule mutation on every call, including when no error is showing** (probe: 10 calls → 10 `setRuleStyles`). The target app wires it to `on("change")`, i.e. one full-document restyle **per keystroke** while typing in a rename / go-to-line dialog — in the target engine the most expensive single write class there is (F15.1, HIGH).
2. A settled `Slider.doLayout()` writes **12 same-valued geometry declarations and schedules 3 child layout roots** (probe: 13 applies / pass, 12 real, 3 `scheduleLayout`), because it drives its three children through the unguarded `Component.setSize`. Per frame, on every resize frame that reaches a slider (F15.2, HIGH).
3. A `Slider` drag is a continuous-motion path that moves an **un-promoted thumb with `left`/`top`, never `setTranslate` + `setWillChange`**, and takes an **uncoalesced `getViewportRect` forced layout read per raw pointer sample** — including on samples that change nothing (probe: 10 no-op moves → 0 writes, still 10 `getViewportRect`) (F15.3 + F15.4, HIGH/MEDIUM).
4. `Toggle`'s state flip routes the thumb through `Component.setTransform`, which writes the instance's **`#id` stylesheet rule** — probe: 1 `ensureStyleRule` + 1 `setRuleStyles` (11 declarations) per flip, where `Checkbox` and `RadioButton` do the same job with one inline `opacity` write (F15.5, MEDIUM).
5. Every `TextField` construction resolves the identical `--ts-ui-input-border` through **8 `getComputedStyle(documentElement)` calls**, 4 of them inside a `setBorder` recompute that is then discarded by its own `if (pref)` gate (F15.6, MEDIUM — 80 forced style resolutions for a 10-field form).

Positives to protect: a keystroke costs **one** sink op and zero layout/rule/geometry work; construction is JS-only for every class in the slice; focus in/out is entirely CSS (`:focus` / `:focus-visible` rules registered once at module load) and costs **zero** JS DOM writes; `Checkbox`/`RadioButton` flips write no stylesheet rule; `Binding.commit()` writes nothing; `Component.setStyleState`, `Aria.setAttribute`, `setCursor`, `setTransition` and `setDirty` are all guarded and the boolean controls route through them correctly.

---

## Findings

### F15.1 `FieldDecorator.clearError()` mutates the stylesheet even when there is no error

- **Category**: C, B, D
- **Impact**: HIGH — one full-document restyle per keystroke on the target app's two modal text prompts.
- **Where**: `validation/FieldDecorator.ts:84-89` (`clearError`), `:69-79` (`showError`); `core/Component.ts:3167-3171` (`clearOutline` → `writeStyle`), `:5635-5655` (`writeStyle` flushes immediately once the element exists). Consumers: `/home/jika/typescript/loom/src/explorer/fileTreePrompts.ts:29`, `/home/jika/typescript/loom/src/editor/goToLinePrompt.ts:26`; library-internal: `core/Binding.ts:418-426` (`clearValidation`), `:465`.
- **Hot path**:
  - keystroke → native `input`
  - → `TextInput.onInput` (`component/input/TextInput.ts:187`)
  - → `AbstractInput.notifyChange` → `emit("change")` (`component/input/AbstractInput.ts:218-222`)
  - → app listener `() => decorator.clearError()`
  - → `FieldDecorator.clearError` → `Component.clearOutline` → `writeStyle({ outline: null })`
  - → `flushStyleBag` → `commitCSSRule` → `DOM.sink.setRuleStyles(#id, { outline: null })` — a shared-stylesheet mutation.
- **Evidence**: probe `decorator.probe.test.ts`.
  `CLEARERROR (no error) ops: {"setRuleStyles":1}` with `setRuleStyles: ["#c68c…", {"outline":null}]`;
  `10x CLEARERROR (no error) ops: {"setRuleStyles":10} ruleWrites= 10`.
  There is no "am I showing an error" flag on the decorator, and `StyleTarget` has no last-written-value filter (slice 02), so the `null` is re-written every time. The same probe shows `showError` with an identical message costs `1 setRuleStyles + 4 removeListener + 4 addListener` (slice 11's non-idempotent `Tooltip.attach`).
- **Proposed change**: give `FieldDecorator` a private `_message: string | null` flag; `clearError()` early-returns when it is already `null`, `showError(m)` early-returns when `m` is unchanged. Both are pure guards — no change to the outline recipe or the tooltip contract.
- **Risk / blast radius**: callers are `Binding._validateField` / `clearValidation` / `removeValidation` and any app using the decorator directly. No test pins a redundant write. Low.
- **Proof at implement time**: a probe asserting `0 setRuleStyles` across 10 `clearError()` calls on an error-free decorator, and `0` across a repeated `showError` with the same message.

### F15.2 A settled `Slider.doLayout()` rewrites all three children's geometry and schedules 3 child layouts

- **Category**: B, D
- **Impact**: HIGH — per frame, on hot path 1, for every visible `Slider`; 12 same-valued inline writes plus 3 needless layout roots per pass.
- **Where**: `component/input/Slider.ts:506`, `:511`, `:515` (horizontal) and `:522`, `:528`, `:532` (vertical) — six unguarded `setSize` calls; `core/Component.ts:3918-3936` (`setSize` has no unchanged-value guard: it writes both geometry axes and calls `scheduleLayout()` unconditionally, unlike its four per-axis siblings `setX`/`setY`/`setWidth`/`setHeight`, which are all guarded — `Component.ts:4055`, `:4204`, `:4271`, `:4307`).
- **Hot path**:
  - `Split`/`Dock` gutter drag frame → `Body.doLayout` → … → `LayoutManager.commitBounds:567` → `Slider.doLayout()` (unconditional; `Slider` does not opt into `canSkipUnchangedLayout`)
  - → `this._track.setSize(...)` → `writeHorizontalGeometry()` + `writeVerticalGeometry()` → 4 inline declarations, then `scheduleLayout()` on `_track`
  - → same for `_activeTrack` and `_thumb`.
- **Evidence**: probe `slider.probe.test.ts`.
  `SLIDER settled pass ops: {"apply":13} emptyStyle= 1 selfSchedule= 0` with the patch stream
  `{"style":{"left":"0px"}} | {"style":{"width":"200px"}} | {"style":{"top":"6px"}} | {"style":{"height":"4px"}} | …` — 12 identical declarations plus the known empty `InlineStyle` flush.
  `SLIDER 10 settled passes ops: {"apply":130}`.
  `SLIDER unchanged pass -> child scheduleLayout: track= 1 activeTrack= 1 thumb= 1`.
  The `setX`/`setY` calls on the same lines write nothing (they are guarded); every one of the 12 writes comes from `setSize`.
- **Proposed change**: in `Slider.doLayout`, replace each `setSize({w,h})` with the guarded per-axis pair `setWidth(w)` / `setHeight(h)`. That is a local change with no dependency on slice 01's proposed `Component.setSize` guard (which slice 14 has flagged as blocked behind the `ProgressSpinner` fix). `_thumb`'s size is a compile-time constant and can move to a one-time write in the constructor entirely.
- **Risk / blast radius**: `Slider.doLayout` alone; `tests/component/input/Slider.test.ts` pins values, not write counts. Low. Note `Slider` does **not** depend on `setSize`'s unconditional `scheduleLayout()` — the probe shows `selfSchedule = 0` and the geometry stays correct across 10 passes.
- **Proof at implement time**: a probe asserting ≤ 1 `apply` (the empty flush) and 0 child `scheduleLayout` calls on an unchanged `Slider.doLayout()`.

### F15.3 `Slider` drags with `left`/`top` on an un-promoted layer, not `setTranslate` on a pre-promoted one

- **Category**: F, B
- **Impact**: HIGH during a drag — the thumb, the track and the active fill all move by layout position on a software-rasterized engine, and each move re-writes the two unchanged cross-axis declarations too.
- **Where**: `component/input/Slider.ts:474-538` (`doLayout` writes `left`/`top`/`width`/`height` only), `:697-701` (`applyValue` → `scheduleLayout`). No `setWillChange` anywhere in the file (`grep -c setWillChange component/input/Slider.ts` → 0).
- **Hot path**: `pointermove` → `Slider.setValue` → `applyValue` → `scheduleLayout()` → next rAF → `doLayout()` → 12 inline geometry writes across 3 elements.
- **Evidence**: probe `slider.probe.test.ts` — `SLIDER setValue(50) style keys written: ["left","width","top","height"]`, and the assertion `styleKeys.has('transform') === false` passes. Compare `AbstractWindow`'s header drag, which slice 10 identified as the correct pattern (`setWillChange("transform")` on `pointerdown`, `setTranslate` per move, `setWillChange(null)` on `pointerup`), and `docs/concepts/performance.md:68-86`, which documents exactly that recipe and lists window drag, table rows and the table header as the framework's own users of it. Slider is a continuous-motion path that never adopted it.
- **Proposed change**: on `pointerdown`, `this._thumb.setWillChange("transform")` and `this._activeTrack.setWillChange("transform")`; during the drag move the thumb with `setTranslate` (inline, `Component.ts:4647`) from a fixed layout origin rather than re-writing `left`; clear the hint on `pointerup`/`pointercancel`/`lostpointercapture` (the existing `release` closure, `Slider.ts:577-588`, is the natural home). The active fill still needs a real width; scaling it with `transform: scaleX` is the compositor-friendly alternative but changes the rounded-cap rendering, so leave it on `width` unless a measurement says otherwise.
- **Risk / blast radius**: `Slider.doLayout` must then treat the thumb's `left` as a resting origin and the translate as the live offset; `tests/component/input/Slider.test.ts:292-353` pins `valueAtPointer`'s mapping, not the thumb's write mechanism. Medium — it changes which surface carries the motion.
- **Proof at implement time**: ms/frame for a sustained drag on a `Slider` in the WebKitGTK harness, plus a probe asserting the per-move patch stream contains a `transform` and no `left` on the thumb.

### F15.4 `Slider` reads `getViewportRect` once per *raw* pointer sample, coalescing nothing

- **Category**: A, G
- **Impact**: MEDIUM-HIGH — one forced synchronous document layout per raw `pointermove`, at pointer rate (which exceeds frame rate), landing after the previous frame's style writes.
- **Where**: `component/input/Slider.ts:569-575` (the raw `pointermove` listener), `:645-672` (`valueAtPointer`), `:657` (`DOM.source.getViewportRect(this)` — `ProductionDOMSource` returns `getBoundingClientRect()`), `:658` (`getContentBounds()` → `Component.getContentInsets()` allocates a fresh `Insets` per call, `Component.ts:2624-2638`), `:659` (`getBorderSize()`).
- **Hot path**:
  - raw `pointermove` (uncoalesced) → `Slider`'s listener
  - → `valueAtPointer(e)` → `DOM.source.getViewportRect(this)` — live geometry read, after the previous sample's `applyValue` → `doLayout` style writes
  - → `getContentBounds()` → one `Insets` allocation
  - → `setValue` → `applyValue` → `Aria.setValueNow` + `scheduleLayout`.
- **Evidence**: probe `slider.probe.test.ts`.
  `SLIDER 10 DRAG FRAMES … DOM.source reads over 10 frames: {"intern":10,"getId":10,"getViewportRect":10,"transposeIfRotated":10}`.
  And, decisively, on a slider with `step: 50` where ten small moves change nothing:
  `SLIDER 10 NO-OP drag frames sink ops: {"dispatchEvent":10}` — zero writes — yet
  `DOM.source reads: {"intern":10,"getId":10,"getViewportRect":10,"transposeIfRotated":10}`. The read is unconditional.
- **Proposed change**: two independent guards. (a) Cache the slider's own rect for the duration of a drag: it is captured on `pointerdown` and can only change if the layout moves the slider, which a drag does not — invalidate it from `doLayout` and on `pointerup`. That removes the read from the per-sample path entirely. (b) Coalesce `pointermove` to one rAF, the shape `plans/implemented/dragmanager-pointer-coalescing.md` already established for `DragManager`; store the latest event and resolve it in the frame callback.
- **Risk / blast radius**: `tests/component/input/Slider.test.ts:292-353` calls the private `valueAtPointer` directly and would still pass with a cached rect as long as the cache is seeded. Coalescing changes the number of `"change"`/`"input"` emissions per drag — `Slider.test.ts:162-227` counts `change` fires on `setValue`, not on drags, so it is not pinned, but consumers counting drag events would see fewer. Medium.
- **Proof at implement time**: a probe asserting 1 `getViewportRect` for a 10-sample drag; ms/frame on a WebKitGTK slider drag.

### F15.5 `Toggle`'s state flip writes a stylesheet rule; its two sibling controls do not

- **Category**: C, I
- **Impact**: MEDIUM — one full-document restyle per user flip (and a rule *insert* on the first flip), where the same visual job costs one inline write in `Checkbox` and `RadioButton`.
- **Where**: `component/input/Toggle.ts:390` (`this._thumb.setTransform(value ? "translateX(16px)" : "translateX(0px)")`), `core/Component.ts:3276-3282` (`setTransform` → `setElementCSSRule` → the instance's `#id` rule; no unchanged-value guard). Contrast `component/input/Checkbox.ts:583-584` and `component/input/RadioButton.ts:488`, which both use `setOpacity` (inline).
- **Hot path**: click / Space / Enter on the track → `AbstractBooleanInput.activateFromPointer` / `handleActivationKey` → `Toggle.activate` → `setValue` → `applyValue` → `_thumb.setTransform(...)` → `StyleRule` materialise + `setRuleStyles`.
- **Evidence**: probe `boolean.probe.test.ts`.
  `TOGGLE flip ops: {"apply":2,"ensureStyleRule":1,"setRuleStyles":1}` with
  `setRuleStyles: ["#aaad…", {"borderRadius":null,"boxShadow":null,"whiteSpace":null,"userSelect":null,"minWidth":null,"minHeight":null,"maxWidth":null,"maxHeight":null,"overflowX":null,"overflowY":null,"transform":"translateX(16px)"}]` — the rule materialises on the first flip and carries ten no-op removals alongside the one real declaration.
  `CHECKBOX flip ops: {"apply":4,"dispatchEvent":1}` (aria + `addClass` + two opacity writes, no rule op).
  `RADIO flip ops: {"apply":3}`.
- **Proposed change**: `Toggle.applyValue` writes `this._thumb.setTranslate(value ? 16 : 0, 0)` (inline, `Component.ts:4647`) instead of `setTransform`, and sets `will-change: transform` on the thumb once at construction (a Toggle has exactly one promoted element, well under the per-page hint budget documented at `docs/concepts/performance.md:86`). The existing `transition: transform 120ms ease-out` (`Toggle.ts:173`) animates an inline transform identically.
- **Risk / blast radius**: `tests/component/input/Toggle.test.ts:150-260` asserts the *track*'s class-rule hoisting, not the thumb's transform surface — not pinned. Note `Component.setTranslate` and `setTransform` are documented as independent surfaces (`Component.ts:3260-3267`), so `getTransform()` would stop reflecting the thumb's position; nothing reads it. Low.

### F15.6 `TextField` construction resolves the same theme variable through 8 uncached `getComputedStyle` calls, half of them for a discarded result

- **Category**: A, D, B
- **Impact**: MEDIUM — 8 forced style resolutions per text-input instance at construction (80 for a 10-field form; 112 for a 14-column table's filter row), on the first-render path; 4 of them are provably wasted.
- **Where**: `component/input/TextField.ts:109` (`Util.singleLineBoxHeight(..., this.getBorderSize())` — computed **before** the `if (pref)` gate at `:114`), `:77` (`updateHeight`'s own call); `core/Component.ts:3685-3714` (`getBorderSize`'s pre-connect branch is uncached), `:3742` (`estimateBorderSideWidth` → `DOM.source.getThemeVar`), `core/DOM.ts:2331-2333` (`getThemeVar` = `getComputedStyle(document.documentElement).getPropertyValue(name)`, uncached).
- **Hot path**:
  - `new TextField()` → `Component.applyChromeOptions` dispatches the class-default `setBorder(...)`
  - → `TextField.setBorder:109` → `getBorderSize()` → 4 × `estimateBorderSideWidth` → 4 × `getThemeVar("--ts-ui-input-border")`
  - → `:114` `if (pref)` — `pref` is still `null` at this point (by design, per `plans/implemented/abstractinput-height-dedup.md`), so the entire result is thrown away
  - → constructor body `:62` `updateHeight()` → `:77` → `getBorderSize()` → 4 more identical reads.
- **Evidence**: probe `themevar.probe.test.ts`, which records the call names and stacks:
  `TEXTFIELD ctor getThemeVar names: ["--ts-ui-input-border" ×4 (from TextField.setBorder:109), "--ts-ui-font-size", "--ts-ui-line-padding", "--ts-ui-input-border" ×4 (from TextField.updateHeight:77)]`.
  `10x TEXTFIELD ctor getThemeVar count: 80`.
  The two `Util` reads are cached module-wide (`Util.ts:114-146`) and cost once per process; the eight border reads are not cached at all. Probe `alloc.probe.test.ts` confirms the same 8 under a plain read tally, and that a *connected* `updateHeight()` costs only `{"isConnected":1,"getThemeVar":4}`.
- **Proposed change**: two independent fixes.
  (a) In `TextField.setBorder`, move the `const h = …getBorderSize()` computation inside the existing `if (pref)` block — the plan that introduced the gate (`plans/implemented/abstractinput-height-dedup.md`, *"`TextField.setBorder` skips its whole height recompute until a real preferred size exists"*) intended exactly this; the computation was simply left outside the gate. Halves the count with a two-line move and no behaviour change.
  (b) Memoise `getBorderSize`'s pre-connect estimate per border-spec string — this is slice 01's finding, and my slice supplies a per-instance count for it.
- **Risk / blast radius**: (a) touches only `TextField.setBorder`, whose behaviour inside the gate is unchanged; `tests/component/input/single-line-min-height.test.ts` and `SingleLineHeightValueClassSharing.test.ts` pin the resulting heights. Low.
- **Proof at implement time**: a probe asserting ≤ 4 `getThemeVar` calls per `new TextField()`, and 0 for a second instance once (b) lands.

### F15.7 `TextInput.init()` and `TextArea.init()` replay attributes the batched `ElementAttributes` flush has already written

- **Category**: J, B, I
- **Impact**: MEDIUM — 7 redundant `DOM.sink.apply` calls (7 handle resolves, 7 same-valued attribute writes) per text input at first render, 10 for a `TextArea`; multiplied by every field in a form, every filter input in a table header, and every text cell editor.
- **Where**: `component/input/TextInput.ts:860-894` (the whole block after `super.init(element)`), `component/input/TextArea.ts:254-272`; `core/ElementAttributes.ts:114-133` (`attach(handle)` writes the *whole retained state* as one patch, so the same values are already on the element), `:30-38` (every `setElementAttribute` from `setType`/`setName`/`setPlaceholder`/`setMaxLength`/`setInputMode`/`setAutoComplete`/`applyReadOnly` lands in that state).
- **Hot path**: first render → `Component.render` → `ElementAttributes.attach` (one batched patch) → `TextInput.init` → 7 × `DOM.sink.apply(el, { setAttr: { … } })`.
- **Evidence**: probe `init.probe.test.ts` on a `TextField` configured with every attribute option:
  `applies carrying a setAttr: 11`, and the patch stream begins with the single batched flush
  `{"setAttr":{"name":"field","data-layout":"Absolute","placeholder":"p","readonly":"","maxlength":"10","inputmode":"numeric","autocomplete":"off",…,"type":"text"}}`
  followed by seven separate re-writes of the *same* values: `{"setAttr":{"type":"text"}} | {"setAttr":{"name":"field"}} | {"setAttr":{"placeholder":"p"}} | {"setAttr":{"readonly":""}} | {"setAttr":{"maxlength":"10"}} | {"setAttr":{"inputmode":"numeric"}} | {"setAttr":{"autocomplete":"off"}}`.
  `TextArea` adds three more (`rows`, `cols`, `wrap`) on the same shape.
  `ElementAttributes.attach` also covers the `release()` → rematerialise path, so the replay has no second job either.
- **Proposed change**: delete both `init()` overrides' attribute-replay blocks. `TextInput.init` then has nothing left to do and can go entirely; `TextArea.init` likewise. Each class's in-code comment ("`init()` replays it from there once the element exists", `TextInput.ts:420-421`) describes a mechanism `ElementAttributes` now owns and should be corrected or removed with it.
- **Risk / blast radius**: `tests/component/input/CredentialFields.test.ts` asserts the rendered `type`/`name`/`autocomplete`; `TextArea.test.ts` asserts the `overflow` default. Both read post-render state, which `attach` supplies. Verify with those suites plus a probe asserting each attribute is present after one render. Low.

### F15.8 `TextInput.setText` echoes the browser's own value back to the element on every keystroke

- **Category**: B
- **Impact**: MEDIUM — one strictly same-valued `HTMLInputElement.value` write per keystroke, on the typing hot path, for every text input in the app; and a caret-position hazard (not verified in WebKitGTK).
- **Where**: `component/input/TextInput.ts:187-192` (`onInput` reads `DOM.source.getValue(element)` then immediately `setText`s it back), `:562-573` (`setText` has no same-value guard before `DOM.sink.setValue`).
- **Hot path**: keystroke → native `input` → `Event`'s exact-target router → `TextInput.onInput` → `this.setText(DOM.source.getValue(element))` → `DOM.sink.setValue(element, <the value it just read>)`.
- **Evidence**: probe `keystroke.probe.test.ts`.
  `KEYSTROKE changed ops: {"setValue":1} scheduleLayout= 0` — the one write is the echo; nothing else happens (no layout, no rule write, no geometry read).
  `KEYSTROKE same-value ops: {"setValue":1}` — the echo fires even when the cache already matches.
  `SETTEXT same-value ops: {"setValue":1}` — `setText("hello")` on a field already holding `"hello"` writes through.
  `10 KEYSTROKES ops: {"setValue":20}` — 10 of those 20 are the probe's own simulated browser writes, so the component contributes exactly one per keystroke.
  The same write shows up on `Binding.setRecord` with unchanged data: `BINDING setRecord #2 (identical) ops: {"setValue":1}` (the bound `Checkbox` contributes 0, because `setSelected` *is* guarded).
- **Proposed change**: guard `setText` — compare against `this._options.text` **before** the cache assignment and return early on a match. That makes `onInput`'s echo free without changing `onInput`'s ordering contract (the cache is still synced before `notifyChange`, which is what `tests/component/input/TextInput.test.ts:425-440` pins).
- **Risk / blast radius**: `TextInput.cut`/`paste` rely on `setText` writing through after a real change — unaffected. One subtlety: a consumer that mutates the element's value out-of-band and then calls `setText` with the cached value to "resync" would become a no-op; no such call site exists in `packages/`. Low.
- **Proof at implement time**: a probe asserting 0 `setValue` sink ops for an `input` event whose value equals the cache, and 0 for a `Binding.setRecord` re-load of identical data.

### F15.9 Every `TextInput` eagerly builds a `Menu` (and its `Panel`) it will probably never show

- **Category**: G, H
- **Impact**: MEDIUM — 2 of the 3 `Component`s a `TextField` allocates exist only to serve a right-click that most instances never receive. A 14-column table's filter row pays 28 of them; a form with 10 fields pays 20.
- **Where**: `component/input/TextInput.ts:129` (`private readonly _contextMenu: Menu = new Menu();` — a class-field initialiser, so it runs for every instance), `:203-224` (`handleContextMenu`, the only consumer), `:158-162` (`destructor` disposes it). `overlay/Menu.ts:184-212` — a no-items `Menu` constructor builds a `Fit`, a `Panel` with a `VBox`, and calls `applyRebuildChrome()`.
- **Evidence**: probe `alloc.probe.test.ts` — `TEXTFIELD live Components delta: 3`, `TEXTINPUT live Components delta: 3` (the field itself plus the `Menu` and its item `Panel`). For comparison `CHECKBOX live Components delta: 5`, all five of which are load-bearing. Construction remains JS-only in both cases (`TEXTFIELD construction ops: {}`), so this is allocation and GC pressure, not DOM work.
- **Proposed change**: make `_contextMenu` lazy — a `private _contextMenu: Menu | null = null` built on the first `contextmenu` event inside `handleContextMenu`, with `destructor` guarding on `null`. The menu is shown from an event handler, so there is no construction-time ordering constraint.
- **Risk / blast radius**: `tests/component/input/TextInput.test.ts:327-390` exercises the menu through a real `contextmenu`, which would build it on demand. Low.

### F15.10 `Toggle.doLayout` fights the layout manager's size-stable fast path every pass

- **Category**: B, D, H
- **Impact**: LOW-MEDIUM — 2 real inline `transform` writes per pass per labelled `Toggle` whose net visual effect is zero, plus the fast path it defeats.
- **Where**: `component/input/Toggle.ts:369-380` (`doLayout` folds the label's translate into `setY`, then zeroes the translate), `:343-352` (`labelCenterOffset`).
- **Hot path**: any layout pass reaching the toggle → `super.doLayout()` (HBox commits the label through `LayoutManager.commitBounds`'s size-stable position fast path, writing a `transform`) → `label.setY(...)` (guarded, writes nothing once settled) → `label.setTranslate(x, 0)` (writes `transform: null`).
- **Evidence**: probe `boolean.probe.test.ts`.
  `Toggle 10 SETTLED PASSES ops: {"apply":50} emptyStyle= 30` and the patch stream repeats, once per pass:
  `{"style":{}} | {"style":{}} | {"style":{"transform":"translate3d(0px,-2px,0)"}} | {"style":{"transform":null}} | {"style":{}}`.
  `TOGGLE 10 passes -> label.setY calls= 10 setTranslate calls= 20`.
  A label-less `Toggle` pays nothing extra: `Toggle (no label) 10 SETTLED PASSES ops: {"apply":30} emptyStyle= 30`.
- **Proposed change**: guard the nudge on the label actually needing to move — `if (label.getTranslateY() !== 0 || label.getY() !== targetY)` — so a settled pass writes neither. The deeper fix belongs upstream: the toggle's label offset is a per-child vertical alignment the `HBox` could honour through a constraint, removing the post-layout correction entirely. `tests/component/input/Toggle.test.ts:112-149` ("keeps the label at a stable static Y across no-op relayouts") pins the *result*, and the guarded version still satisfies it.
- **Risk / blast radius**: that test is the contract; the label's baseline reporting (`Toggle.getBaseline:315-327`) already folds `labelCenterOffset()` in and is unaffected. Low.

### F15.11 `Slider`, `Toggle`, `Checkbox` and `RadioButton` do not react to a theme scale change; two of them document tokens they never read

- **Category**: H, J
- **Impact**: LOW (correctness/health, on hot path 7) — after `setTheme` raises `scale.base`, a `TextField` re-derives its box height while every graphical control in this slice keeps the size it was built with, so a form's controls drift out of alignment.
- **Where**: `component/input/TextField.ts:63` is the **only** `subscribeTheme` in the slice (`grep -n subscribeTheme component/input/{Slider,Toggle,Checkbox,RadioButton,TextField,TextArea,TextInput,AbstractInput,AbstractBooleanInput}.ts` → one hit). `Checkbox.ts:49-60` and `RadioButton.ts:29-39` resolve their sizes from `ThemeManager.getResolvedScale()` **per construction only** — the classes' own comments (`Checkbox.ts:275-282`, `RadioButton.ts:220-228`) acknowledge the first-instance-wins hazard but do not address a theme change after construction. `Slider.ts:38-39` and `Toggle.ts:50-51`/`:103`/`:160-166`/`:390` hard-code their geometry as module constants.
- **Evidence**: `core/Theme.ts:1040-1041` publishes `--ts-ui-slider-thumb-size` and `--ts-ui-slider-track-thickness` from `theme.form.slider.thumbSize` / `trackThickness`, and `docs/components/Slider.md:57` documents both as the slider's theming surface — but `grep -rn "ts-ui-slider" packages/lib/src --include=*.ts` shows `Slider.ts` reads only the three colour tokens; `THUMB_SIZE = 16` / `TRACK_THICKNESS = 4` are never derived from the theme. `docs/components/Toggle.md:41` documents `--ts-ui-toggle-width` and `--ts-ui-toggle-height`; `grep -rn "ts-ui-toggle" packages/lib/src --include=*.ts` shows neither token exists anywhere in the library.
- **Proposed change**: smallest correct step — have `Slider` read the two published tokens instead of its constants, and give the four controls the `subscribeTheme(() => this.updateGeometry())` treatment `TextField` already has. If theme-reactive sizing is deliberately out of scope for these controls, delete the two unread `Theme.ts` rows and fix both doc pages instead; the current state advertises a contract that does not exist.
- **Risk / blast radius**: `Toggle.applyValue:390` hard-codes the 16 px thumb travel derived from the 36/20/16 constants — a theme-driven size must derive the travel too. Medium if sizing is made live; trivial if the docs are corrected instead.

### F15.12 `FieldValidationConfig.validateOnChange` is write-once `false`, making its `||` branch unreachable

- **Category**: J
- **Impact**: LOW — dead configurability and an unreachable branch on the per-change validation path.
- **Where**: `core/Binding.ts:345-350` — the only write site, hard-coding `validateOnChange: false`; `:482` — `const live = config.validateOnChange || this._globalValidateOnChange;`, whose left operand is therefore always `false`; `validation/ValidationRule.ts:34-35` documents the field as "When true, validation runs on every field change. Overrides the global flag."
- **Evidence**: `grep -rn "validateOnChange" packages/lib/src packages/docs/src packages/create-app --include=*.ts` → 3 hits, all three in the two files above plus `Binding.setValidateOnChange`; no call site ever sets the per-field flag. `Binding.getValidateOnChange` (`:410-412`) and `Binding.removeValidation` (`:362-372`) each have **zero** callers in `packages/lib/src`, `packages/docs/src`, `packages/create-app`, `packages/lib/tests` and `/home/jika/typescript/loom/src`.
- **Proposed change**: either drop the field and simplify `:482` to `this._globalValidateOnChange`, or give `addValidation` an optional per-field override that actually reaches it. The second is only worth doing if a consumer asks; the first is the honest default.
- **Risk / blast radius**: none — no caller reads it.

### F15.13 `Slider`'s `showTicks` option is inert end to end

- **Category**: J, H
- **Impact**: LOW.
- **Where**: `component/input/Slider.ts:26` (option field), `:224` (`applyOptions` stores it), `:392-394` (`isShowTicks`), `:404-408` (`setShowTicks`). Nothing reads `_options.showTicks` outside its own getter; `doLayout` (`:474-538`) renders no ticks. The JSDoc admits it: *"Not yet rendered visually — the field is reserved for a follow-up."*
- **Evidence**: `grep -rn "\bsetShowTicks\b\|\bisShowTicks\b" packages/lib/src packages/docs/src packages/create-app packages/lib/tests /home/jika/typescript/loom/src` → 2 hits, both the definitions themselves. Not mentioned on `docs/components/Slider.md` either.
- **Proposed change**: remove the option, both accessors, and the `applyOptions` line, until ticks are actually implemented. Same shape as slice 12's invisible-but-present `MenuItem` icon: speculative surface with zero callers. `Slider.setLargeStep` (`:355-359`) likewise has zero callers, but `largeStep` is honoured through `applyOptions` and read by the keyboard path, so the setter is a legitimate API completion — keep it.

### F15.14 `Checkbox.applySelected` writes an unchanged opacity, and `setAnimated`'s JSDoc names a caller that does not exist

- **Category**: B, H
- **Impact**: LOW — one wasted inline write per flip; one misleading doc.
- **Where**: `component/input/Checkbox.ts:583-584` — `applySelected` writes both `_check` and `_dash` opacity on every call, but for a checkbox that is never indeterminate `_dash`'s opacity is `0` at construction and `0` forever after; `core/Component.ts:5310-5316` (`setOpacity` has no unchanged-value guard — one of slice 02's fifteen). `Checkbox.ts:509-515` — `setAnimated`'s JSDoc says *"Used by `BooleanCell` to suppress the per-rebind transition flash when a virtualized table re-binds many cells per scroll frame"*; `grep -rn "setAnimated" packages/lib/src` shows the only `Checkbox.setAnimated` caller is `component/table/cell/editor/Boolean.ts:42`, called once per editor construction, and no `BooleanCell` calls it at all.
- **Evidence**: probe `boolean.probe.test.ts` — `CHECKBOX flip ops: {"apply":4,…}` with patches `… | {"style":{"opacity":"1"}} | {"style":{"opacity":"0"}}`; the second write is the dash going from 0 to 0. The redundant `setSelected` *is* correctly guarded: `CHECKBOX redundant flip ops: {}`.
- **Proposed change**: the durable fix is an unchanged-value guard on `Component.setOpacity`, which belongs to slice 02's guard-parity work — this slice is one of its beneficiaries. Locally, gate the `_dash` write on `indeterminate !== wasIndeterminate`. Correct the `setAnimated` JSDoc to name its real caller.

---

## Entity inventory

| Entity | Stated function | Owns DOM | Per-layout-pass writes/reads (settled) | Verdict | Findings |
|---|---|---|---|---|---|
| `AbstractInput` | Value contract + change/binding bag + enabled/readOnly cache + the shared single-line box writer | none | none | fits | — |
| `TextInput` | `<input>`-backed base: attributes, text cache, clipboard menu, native disabled/readonly | its own `<input>`; no rules of its own beyond `#id` | 1 empty `InlineStyle` flush | over-built | F15.7, F15.8, F15.9 |
| `TextField` | Single-line `<input type=text>` with theme-tracked box height | inherits | 1 empty flush | fits (construction over-reads) | F15.6 |
| `PasswordField` | `TextField` preset: `type=password`, credential `name`/`autocomplete` | inherits | as `TextField` | fits | — |
| `UsernameField` | `TextField` preset: credential `name`/`autocomplete` | inherits | as `TextField` | fits | — |
| `TextArea` | Multi-line `<textarea>`, `resize:none`, `overflow:auto` | its own `<textarea>`; one module `.TextArea` rule | 1 empty flush | over-built | F15.7; duplicate `getBaseline`; inert `rows`/`cols` |
| `AbstractBooleanInput` | Shared label / enabled / readOnly / keyboard-activation mechanics for the three boolean controls | the optional label `Text` | none of its own | fits | — |
| `Checkbox` (+ `CheckboxBox`, `CheckboxCheckGlyph`, `CheckboxDash`) | Custom-drawn `role=checkbox` with check + indeterminate bar | 5 elements, 4 shared class rules, 0 per-instance rules | 5 applies, **all empty** | fits | F15.14, F15.11 |
| `RadioButton` (+ `RadioButtonRing`, `RadioButtonDot`) | Custom-drawn `role=radio`, group selection via `ButtonGroup` | 4 elements, shared class rules only | 4 applies, **all empty** | fits | F15.11 |
| `Toggle` (+ `ToggleTrack`, `ToggleThumb`) | Custom-drawn `role=switch` sliding pill | 3 elements + the label; shared class rules; **one `#id` rule minted on first flip** | 3 empty applies; **+2 real `transform` writes when labelled** | mismatch | F15.5, F15.10, F15.11 |
| `Slider` (+ `SliderTrack`, `SliderActiveTrack`, `SliderThumb`) | Continuous `role=slider` with pointer-capture drag and WAI-ARIA keys | 4 elements, shared class rules + one `#id` rule | **13 applies, 12 of them same-valued; 3 child `scheduleLayout`** | over-built | F15.2, F15.3, F15.4, F15.11, F15.13 |
| `Form` | `<form>`-tagged `Panel` wiring native `submit` to one callback | inherits `Panel` | inherits `Panel` (see slice 04's settled-panel remeasure) | fits | — |
| `Binding` | Record ↔ component sync, plus validation dispatch | none | none | over-built (validation half) | F15.12 |
| `FieldDecorator` | Wrapper that outlines a field red and shows an error tooltip | one wrapper `<div>` + its `#id` rule | none | mismatch | F15.1 |
| `Validator.applyRule` | Pure rule evaluator | none | none | fits | — |
| `ValidationRule` / `ValidationResult` | Rule union + result shape | none | none | fits | F15.12 (`validateOnChange`) |

---

## Redundant, duplicated and dead code

**The 2026-08-29 audit's `updateHeight()` item is partly closed: six copies are now four.**
`grep -rn "updateHeight" packages/lib/src/typescript/lib --include=*.ts` → bodies at `component/input/TextField.ts:75`, `AbstractPickerField.ts:292`, `ComboBox.ts:884`, `NumberSpinner.ts:285`. `PasswordField` and `UsernameField` lost theirs (they now extend `TextField`), which is exactly what `plans/implemented/credential-field-and-input-updateheight-dedup.md` promised. Three of the four survivors are byte-identical apart from one constant:

```
this.applySingleLineBox(
    Util.singleLineBoxHeight(this.getInsets(), this.getPadding(), this.getBorderSize()),
    <DEFAULT_WIDTH>,
);
```

(`NumberSpinner` differs — it passes `this._input.getPadding()`.) That plan's `## Architecture Decisions` deliberately kept "its own one-line height expression" per caller, so this is an accepted decision, not a regression. What the plan did *not* dedupe is the **constructor pair**, repeated verbatim four times (`TextField.ts:62-63`, `AbstractPickerField.ts:119-120`, `ComboBox.ts:798-799`, `NumberSpinner.ts:214-215`):

```
this.updateHeight();
this.subscribeTheme(() => this.updateHeight());
```

One `protected installSingleLineBoxHeight()` on `AbstractInput` calling an abstract/overridable `updateHeight()` would collapse all four with no behaviour change. A fifth site computes the same height inline for the table filter row: `layout/Table.ts:212`.

**`TextArea.getBaseline` is a verbatim copy of the method it overrides.** `component/input/TextArea.ts:250-252` and `component/input/TextInput.ts:508-510` have identical bodies (`return this.wrapInnerBaseline(Util.measureTextBaseline());`). The override exists only to carry a different doc comment explaining why the first-line baseline is used; the doc belongs on the class, not on a redundant method.

**Zero-caller API in the slice** (grep across `packages/lib/src`, `packages/docs/src`, `packages/create-app`, `packages/lib/tests` and `/home/jika/typescript/loom/src`; counts are non-definition hits):

| Symbol | Where | Non-definition callers |
|---|---|---|
| `Slider.setShowTicks` / `isShowTicks` / the `showTicks` option | `Slider.ts:26`, `:224`, `:392`, `:404` | 0 — see F15.13 |
| `Slider.setLargeStep` | `Slider.ts:355` | 0 (option + getter are used; keep as API completion) |
| `Binding.removeValidation` | `Binding.ts:362` | 0 |
| `Binding.getValidateOnChange` | `Binding.ts:410` | 0 (`setValidateOnChange` has one, `packages/lib/src/typescript/BindingPanel.ts:113`) |
| `FieldValidationConfig.validateOnChange` | `ValidationRule.ts:35` | write-once `false` — see F15.12 |
| `TextInput.clearName` / `clearInputMode` / `clearAutoComplete` / `clearMaxLength` / `clearTextAlign` | `TextInput.ts:382`, `:433`, `:479`, `:664`, `:542` | 0 each |
| `TextArea.clearRows` / `clearCols` / `clearWrap` | `TextArea.ts:147`, `:186`, `:225` | 0 each |
| `TextArea.setRows` / `setCols` | `TextArea.ts:135`, `:174` | only their own `applyOptions` |

The `clear*` family is mandated by `ARCHITECTURE.md`'s *Three non-negotiable rules* as the companion of each typed setter, so zero callers is expected there and I do **not** recommend deleting them. `setShowTicks`/`isShowTicks` and `removeValidation`/`getValidateOnChange` are different: they are not setter/clearer pairs, they are features that were never finished or never used.

**`TextArea`'s `rows` / `cols` have no rendering effect.** Every `Component` is absolutely positioned with an explicit `width`/`height` written by the layout pass (`ARCHITECTURE.md` *Positioning is always absolute*; probe stream shows `{"style":{"width":…}}` on every commit), which overrides `<textarea>`'s `rows`/`cols` intrinsic sizing entirely. `wrap` does still do real work. Either document the two as inert or drop them.

**Doc/implementation mismatches** (LOW, but they mislead):
- `docs/components/TextArea.md:37` documents `setColumns(n)`; the method is `setCols(n)` (`grep -rn "setColumns" packages/lib/src` finds only `Grid`, `MenuRow`, `MenuItem` and `Table`).
- `docs/components/Toggle.md:41` documents `--ts-ui-toggle-width` / `--ts-ui-toggle-height`; neither token exists anywhere in the library.
- `docs/components/Slider.md:57` documents `--ts-ui-slider-thumb-size` / `--ts-ui-slider-track-thickness`; `Theme.ts:1040-1041` publishes them but `Slider.ts` never reads them (F15.11).
- `Checkbox.setAnimated`'s JSDoc names `BooleanCell` as its caller; the real one is `component/table/cell/editor/Boolean.ts:42` (F15.14).

**Still open from the 2026-08-29 audit, Priority 1 #12, as it touches this slice.** The audit's claim that `Checkbox.setSelected` fires its synthetic click "on the wrong element id" is now **fixed** — `Checkbox.ts:450-454` fires on the root, which is where `on("action")` registers (`:543-547`), and `tests/component/input/Checkbox.test.ts:162-197` pins it. The asymmetry the audit also noted is **not** fixed: `RadioButton.setSelected` (`RadioButton.ts:365-376`) fires nothing, while `RadioButton.activate` (`:331-336`) fires `change`. So a programmatic `setSelected` notifies `on("change")`/`on("binding")` but never `on("action")` on a radio, and does on a checkbox. Two sibling controls with the same `on("action")` documentation behave differently; worth settling one way or the other.

**Closed since that audit**: the "four deprecated `Slider` min/max methods" are gone (`grep -n "@deprecated" component/input/Slider.ts` → no hits).

---

## Cross-slice notes

- **→ 01 core-component-lifecycle.** `Component.setSize`'s missing unchanged-value guard is the direct cause of F15.2's 12 wasted writes per pass. My slice does **not** depend on its unconditional `scheduleLayout()` (probe: `selfSchedule = 0`, geometry stable across 10 passes), so unlike `ProgressSpinner` (slice 14's ordering constraint) `Slider` is safe under that guard — but F15.2 can and should be fixed inside `Slider` first, independently, so the slider stops paying regardless of when slice 01's guard lands.
- **→ 01 core-component-lifecycle.** `Component.getElement()` (`Component.ts:1284-1297`) re-runs `DOM.source.getElementById(this.getId())` on **every** call while `_element` is unset. A single `new TextField()` makes 24 such lookups before any element exists (probe `alloc.probe.test.ts`: `{"escapeSelector":4,"getElementById":24,"getThemeVar":8}`). Once rendered the field is cached and free, so this is a construction-path cost only — but it scales with instance count.
- **→ 01 core-component-lifecycle.** `getBorderSize`'s uncached pre-connect estimate costs exactly **8 `getComputedStyle(documentElement)` calls per `TextField`**, all for the same `--ts-ui-input-border` string (F15.6). That is a concrete per-instance figure for slice 01's finding, and the `TextField.setBorder` half of it is fixable in this slice alone.
- **→ 02 core-component-styling.** Three of slice 02's unguarded setters are called from this slice's paths: `setTransform` (Toggle flip, F15.5), `setOpacity` (Checkbox/RadioButton flip, F15.14), and `setTransform` again would be reachable from any future Slider transform work. `Component.setValueStyleState` (`Component.ts:6293-6306`) also lacks a same-token guard: a theme change that resolves the same height still issues `{"removeClass":[],"addClass":["h22px"]}` (probe `binding.probe.test.ts`: `3x updateHeight ops: {"apply":3}`, all three identical). Cheap, but it is the same missing-guard shape.
- **→ 03 core-dom-seam-events / 01.** The empty-`InlineStyle`-flush bug is confirmed again with per-control multipliers: **5** empty applies per settled pass for a `Checkbox`, **4** for a `RadioButton`, **3** for a `Toggle`, **1** for a `TextField`, **1** for a `Slider` (probe `boolean.probe.test.ts`, `keystroke.probe.test.ts`, `slider.probe.test.ts`). A form of 10 mixed controls issues ~35 empty patches per resize frame.
- **→ 05 layout-base-box-flow-grid.** `LayoutManager.commitBounds`'s size-stable position fast path (which carries a move via `translate3d` instead of `top`) is defeated on every pass for a labelled `Toggle`: the manager writes the transform, `Toggle.doLayout` folds it into `top` and clears it again (F15.10). If a plan makes that fast path load-bearing, `Toggle` is the component that will fight it.
- **→ 11 overlay-popups-layers-animation.** `FieldDecorator.showError` calls `Tooltip.attach` with a fresh options object on every error, and `clearError` calls `Tooltip.detach`. Probe: a repeated `showError` with the **same** message costs `4 removeListener + 4 addListener`, and `clearError` after a real error costs `4 removeListener` — exactly slice 11's non-idempotent-`attach` finding, reached from the validation path. F15.1's guard fixes the library side of it; slice 11 owns the `Tooltip` side.
- **→ 10 overlay-dock-drag-rail-drawer.** `Slider` is the second continuous-motion path (after the drag ghost) that moves by `left`/`top` on an un-promoted layer instead of `setWillChange("transform")` + `setTranslate`. If a plan lands a shared "continuous motion" helper, `Slider.doLayout`/`applyValue` should be one of its adopters.
- **→ 28 focus-navigation-forms-primitives.** `Slider.valueAtPointer` calls `getContentBounds()` → `Component.getContentInsets()` per raw pointer sample, which allocates a fresh `Insets` (with a UUID) each time — one allocation per `pointermove`.
- **Seam contract that does not hold for this slice.** `docs/concepts/layout-system.md:29` promises that "a child handed the exact rectangle it already has is not re-laid-out". No component in this slice opts into `canSkipUnchangedLayout`, and `LayoutManager.commitBounds:567` calls `doLayout()` unconditionally — so `Slider.doLayout` runs on every frame of every drag that reaches it. `Slider`, `Checkbox`, `RadioButton` and `Toggle` are all good candidates for the opt-in once slice 19's `clampsToContentSize()` lever is understood: all four have fixed-size children and no content-derived size, so there is nothing for an unchanged pass to recompute.

---

## Suggested plan grouping

**Plan A — "Validation decoration writes only on a real transition"** (F15.1, plus the `Tooltip` half as a dependency note). One guard flag on `FieldDecorator`, plus the `Binding.clearValidation` path that multiplies it by the number of decorated fields on every `setRecord`. This is the largest user-visible payoff in the slice and it is a ~10-line change. Independent of everything else. Depends on nothing; **coordinates with slice 11**, whose `Tooltip.attach` idempotency fix removes the remaining listener churn.

**Plan B — "Slider stops re-writing settled geometry"** (F15.2, and F15.11's Slider half rides along if the tokens are adopted). Replace the six `setSize` calls with guarded per-axis writes and hoist the thumb's constant size out of `doLayout`. Measurable on its own as applies-per-settled-pass. Independent of slice 01's `Component.setSize` guard — and should land **before** it, so the guard's arrival is a no-op here rather than a behaviour change.

**Plan C — "Slider drag becomes a compositor path"** (F15.3 + F15.4 together — they share the drag lifecycle and the same `pointerdown`/`release` hooks). Cache the rect for the drag's duration, coalesce `pointermove` to one rAF, promote the thumb with `setWillChange`, move it with `setTranslate`. **Depends on Plan B** (it rewrites the same `doLayout` geometry block). Cite slice 10's `AbstractWindow` header drag as the precedent and `plans/implemented/dragmanager-pointer-coalescing.md` for the coalescing shape.

**Plan D — "Text input first render and keystroke write only what changed"** (F15.7 + F15.8 + F15.9). Three independent small changes that all live in `TextInput.ts` / `TextArea.ts` and are best measured together as "sink ops per text input, construction → first render → 10 keystrokes". Depends on nothing. Also the right place to delete `TextArea.getBaseline`'s duplicate override.

**Plan E — "Halve the text-input construction style storm"** (F15.6). The two-line `TextField.setBorder` move is self-contained and should not wait for slice 01's `getBorderSize` memo; the memo then removes the other half. Small enough to ride along with Plan D if the plan phase prefers fewer plans, but it has its own clean counter (`getThemeVar` calls per construction), so it measures better alone.

**Plan F — "Toggle stops writing the stylesheet and stops fighting the layout manager"** (F15.5 + F15.10). Both live in `Toggle.ts`, both are about the same two children, and both are pinned by the same test file. **Soft-depends on slice 02** only for the `setTransform` guard discussion; the `setTranslate` switch makes that moot for this component.

**Too small to plan — ride along with a neighbour:**
- F15.12 (`validateOnChange` dead branch) and the `Binding.removeValidation` / `getValidateOnChange` zero-caller pair → ride with **Plan A**, which is already in `Binding`/`validation`.
- F15.13 (`showTicks`) → ride with **Plan B**.
- F15.14 (`_dash` opacity; `setAnimated` JSDoc) → the guard belongs to **slice 02**'s setter-parity work; the JSDoc correction rides with whichever plan touches `Checkbox.ts` first.
- The four-way `updateHeight()` constructor-pair duplication and the `layout/Table.ts:212` fifth site → ride with **Plan E**, which is already in that code.
- The three doc/token mismatches (`setColumns`, `--ts-ui-toggle-*`, `--ts-ui-slider-*`) → a single documentation commit, or fold the Slider one into **Plan B** if the tokens are made live.

**Cross-slice ordering.** Nothing in this slice blocks another slice. Plan B should precede slice 01's `Component.setSize` guard; Plan A should be sequenced with, not after, slice 11's `Tooltip` work so the two fixes are measured on the same path.

---

### Probe artefacts

Eight probe files, 45 assertions, all passing, in
`/home/jika/typescript/typescript-ui/.worktrees/_probes/15-inputs-text-boolean-slider/`
(`harness.ts`, `keystroke.probe.test.ts`, `slider.probe.test.ts`, `boolean.probe.test.ts`,
`decorator.probe.test.ts`, `alloc.probe.test.ts`, `themevar.probe.test.ts`,
`init.probe.test.ts`, `binding.probe.test.ts`). Run with:

```
cd /home/jika/typescript/typescript-ui
PROBE_LOG=/tmp/probe15.log PROBE_DIR=.worktrees/_probes/15-inputs-text-boolean-slider \
  npx vitest run --config .worktrees/_probes/vitest.probe.config.ts
```

(vitest 4 swallows `console.log` from passing tests under this config, so the probes append their
numbers to `$PROBE_LOG` instead.) No file in the main tree was modified.
