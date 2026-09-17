# 17 inputs-pickers-calendar — render-work review

**Summary**

- A **closed, settled picker field fights its own layout manager**: `AbstractPickerField.doLayout` runs the default `Absolute` manager first, which commits both children at their *preferred* rect, then overwrites both rects and re-lays the button out. Measured on 3 identical passes: **5 real (non-empty) DOM style writes and 10 `doLayout` calls per pass, forever**, against a `TextField`'s 1 empty apply and 1 pass — and 161 size-hint queries per pass against 4. This is hot path 1, multiplied by every picker field on screen. (F17.1, HIGH)
- **Every selection/highlight change writes stylesheet rules, not classes.** One arrow keypress in the day grid costs 2–4 `setRuleStyles` on per-instance `#id` rules — 2–4 full-document restyles at ~195 ms each in the target engine, at key-repeat rate. In the year scroller the same keypress then does two forced geometry reads *after* those rule writes in the same task. (F17.2, HIGH)
- **Opening the year scroller rebuilds 171 identical cells every time and never releases them**: the second open costs **513 shared-stylesheet mutations** (171 delete + 171 insert + 171 write) for a byte-identical year list, and the column's 171 rules stay on the sheet for the field's life — `dispose()` releases 44, not 215. (F17.3, HIGH)
- **`showAt` lays the whole 59-component panel out twice per open**, the first time at the panel's old (first time: zero) size, and both passes run **before** the element is mounted. The sibling `TimePickerDropdown.showAt` already does the opposite and explains why in a comment. (F17.4, HIGH)
- **Every month step and every re-open tears down and rebuilds all 42 day cells** (489 applies, 61 rule ops, 59 layout passes, 62 fresh listener registrations) — where re-opening on the same month changes the state of **2 of 42 cells**, and the file already contains two in-place rebind helpers. (F17.5, HIGH)
- Corrections to this slice's brief: **`PickerColumn` has no wheel handler, no drag scroll and no snap animation** — it is a `Panel` with native `autoScroll: "y"`. There is no continuous-motion path anywhere in this slice, so slice 09's `setWillChange`/`setTranslate` pattern has nothing to check against here. All three 2026-08-29 dead-code items for this slice are **closed**.

---

## Findings

### F17.1 A closed picker field writes 5 geometry values and runs 10 layout passes per settled parent pass

- **Category**: A (indirect), B, D, H
- **Impact**: **HIGH** — per frame on hot path 1 (continuous resize / gutter drag), multiplied by the number of `DateField`/`TimeField`/`DateTimeField` instances on screen.
- **Where**:
  - `component/input/AbstractPickerField.ts:249-277` (`doLayout`)
  - `component/input/AbstractPickerField.ts:275` (the explicit `this._button.doLayout()` re-fire)
  - `layout/Absolute.ts` `doLayout` — the default manager (`Component.getLayoutManager` falls back to `new Absolute()`)
- **Hot path**:
  1. `Split`/`Dock` gutter drag → `Body.doLayout` → … → parent manager `commitBounds` → `field.doLayout()`
  2. `AbstractPickerField.doLayout:250` → `super.doLayout()` → `Component.doLayout:7224` → `Absolute.doLayout()`
  3. `Absolute.doLayout` reads each child's `getPreferredSize()` / `getSize()` / `getX()` / `getY()` and commits that rect → `_button` is committed at its **preferred** `{24×16}` at its **previous** x
  4. `commitBounds` → `_button.doLayout()` (pass 1, against the wrong rect) → button's content row → `Glyph` `setTranslate`
  5. back in `AbstractPickerField.doLayout:252` → `getContentBounds()` → `:260-268` rewrites both children's x/y/w/h — `_button` height becomes `box.height` (18)
  6. `:275` → `_button.doLayout()` (pass 2) → `Glyph` `setTranslate` again
- **Evidence** (probes in `.worktrees/_probes/17-inputs-pickers-calendar/`):
  - Probe **S1**, three *identical* settled `applyBounds(0,0,300,28)` passes on a `DateField` → **15 non-empty patches, exactly 5 per pass**, the same five every pass:

        other:  {"style":{"transform":null}}
        button: {"style":{"top":"3px","height":"16px"}}
        button: {"style":{"top":"3px"}}
        button: {"style":{"height":"18px"}}
        other:  {"style":{"transform":"translate3d(0px,1px,0)"}}

    The button's height is flipped 18 → 16 → 18 on every pass, so no unchanged-value guard anywhere can ever catch it.
  - Probe **R2**, one changed-bounds pass, button call sequence:
    `setX(273) setY(3) setWidth(24) setHeight(16) doLayout() setX(393) setY(3) setWidth(24) setHeight(18) doLayout()`
  - Probe **R1**, 10 identical passes, all elements connected:
    `DateField` → **110 applies (60 empty), 100 layout passes**; `TextField` → **10 applies (10 empty), 10 layout passes**.
  - Probe **T2**, same 10 passes, size hints:
    `DateField` → **410 `getPreferredSize` + 600 `getMinSize` + 600 `getMaxSize`** (161/pass);
    `TextField` → **0 + 20 + 20** (4/pass). A closed picker field is ~40× a `TextField` in size-hint traffic per settled pass, half of it from committing the same two children twice.
- **Proposed change**: the field must not let `Absolute` commit a rect it is about to overwrite. Compute `getContentBounds()` **before** `super.doLayout()`, `setX`/`setY`/`setPreferredSize` both children to the final values, then let `super.doLayout()` commit them once and recurse once; delete the manual `_button.doLayout()` re-fire (the comment at `:270-275` is only true because the manager already ran with the wrong values). Once the flip is gone the field also becomes a candidate for `canSkipUnchangedLayout`.
- **Risk / blast radius**: `AbstractPickerField` is the base of all three public picker fields. No test pins the layout order (`grep -rn "doLayout\|_button" tests/component/input/{DateField,DateTimeField,TimeField,DatePickerDropdown,TimePickerDropdown}.test.ts` → 2 hits, both in `TimePickerDropdown.test.ts`, neither about the field). `component/input/ComboBox.ts:~890` has the same "manager first, override second" shape (slice 16) — worth fixing together.
- **Proof at implement time**: probe S1 re-run — non-empty patches per settled pass must be **0**; probe R1 — `DateField` applies/passes must match `TextField`'s; ms/frame on a form-with-picker-fields horizontal drag.

### F17.2 Selection and keyboard highlight write stylesheet rules per keypress instead of toggling a class

- **Category**: C, A (in the year scroller), G
- **Impact**: **HIGH** — per keystroke on hot path 4; 2–4 full-document restyles each, at key-repeat rate while the user scans a month or a year list.
- **Where**:
  - `component/input/AbstractCalendarDropdown.ts:343-359` (`PickerDay.setSelected` → `setBackgroundColor` + `setFontWeight`)
  - `component/input/PickerColumn.ts:195-211` (`PickerCell.setSelected`, byte-identical body)
  - `component/input/AbstractCalendarDropdown.ts:1221-1244` (`setHighlightedDay`)
  - `component/input/AbstractCalendarDropdown.ts:1435-1451` (`applyYearHighlight`, then `scrollSelectedIntoView`)
  - `component/input/PickerColumn.ts:351-392` (`scrollSelectedIntoView`, reads `getOffsetSize` :380 + `getScrollMetrics` :381)
- **Hot path** (day grid): `PickerInput` `keydown` → `AbstractPickerField.onKeyDown:526` → `AnimatedDropdown.handleKey` → `AbstractCalendarDropdown.handleKeyInDayGrid:1124` → `moveHighlightedDay:1169` → `setHighlightedDay:1221` → `PickerDay.setSelected` ×2 → `Component.setBackgroundColor` + `setFontWeight` → `StyleTarget.setRuleStyles` ×2 per cell.
- **Hot path** (year scroller): … → `handleKeyInYearScroller:1328` → `moveHighlightedYear:1386` → `applyYearHighlight:1435` (loops **all 171 cells**) → 2 changed cells × 2 rule writes → `:1449` `_yearColumn.scrollSelectedIntoView()` → `DOM.source.getOffsetSize` + `DOM.source.getScrollMetrics` **after** those rule writes, same task.
- **Evidence**:
  - Probe **P3**: one highlight move → 4 `setRuleStyles`, on two `#id` selectors, one per property (`backgroundColor`, then `fontWeight`) — the per-property fan-out slice 02 documented — plus 2 `_dayGrid.scheduleLayout()` calls (from `setFontWeight`).
  - Probe **T3**: `ArrowRight` = **2** `setRuleStyles`, 0 text measurements; `ArrowDown` = **4** `setRuleStyles`.
  - Probe **U1**: one `ArrowDown` in the year scroller = `{"setRuleStyles":2,"apply":1}` and then `getOffsetSize` + `getScrollMetrics` at write-index 2 — i.e. both forced reads land after the rule writes. A type-ahead digit = `{"setRuleStyles":4,"apply":1}` plus the same two reads. This is the exact hazard `packages/lib/docs/concepts/performance.md:140` names, and the same crossing slice 12 found in `Menu.show()`.
  - Probe **Q5**: one minute pick in `TimeColumns` = 4 `setRuleStyles` (`backgroundColor`, `fontWeight`, ×2 cells), 0 layout passes.
- **Proposed change**: give `PickerDay`/`PickerCell` a `.selected` class rule alongside the `.disabled` rule they already have, and flip it through `Component.setStyleState` (guarded class toggle) — the precedent slice 18 cites for `TreeRow`. Move the `scrollSelectedIntoView` read ahead of the highlight writes, or defer it to the next frame, so the geometry read never lands after a rule write in the same task.
- **Risk / blast radius**: `PickerCell` is a public export (`component/input/index.ts:33`). `tests/component/input/PickerColumn.test.ts` and `TimeColumns.test.ts` assert through `isSelected()`, not through style, so the cached-state API is unchanged. The rule specificity note in the source (`.PickerDay { cursor }` losing to the `#id` rule) applies to `cursor` only, not to background/weight.
- **Proof at implement time**: probe T3/U1 re-run — `setRuleStyles` per arrow keypress must be **0**; and a probe asserting `getOffsetSize`/`getScrollMetrics` never follow a rule write within one `handleKey`.

### F17.3 The year scroller rebuilds 171 identical cells on every open and leaks their rules

- **Category**: D, E, J, G
- **Impact**: **HIGH** — per event (opening the year list is a one-click affordance on the header label), plus a permanent shared-stylesheet leak per picker field.
- **Where**:
  - `component/input/AbstractCalendarDropdown.ts:980-1001` (`openYearScroller` — calls `buildYearScroller()` unconditionally)
  - `component/input/AbstractCalendarDropdown.ts:1027-1050` (`buildYearScroller` — `clearCells()` then 171 `new PickerCell`)
  - `component/input/AbstractCalendarDropdown.ts:1007-1020` (`closeYearScroller` — `removeComponent`, never disposes)
  - `component/input/AbstractCalendarDropdown.ts:68,75` (`DEFAULT_YEAR_SPAN_BACK = 120`, `DEFAULT_YEAR_SPAN_FORWARD = 50` → 171 cells by default)
  - `component/input/AbstractCalendarDropdown.ts:1057-1069` (`refreshYearSelection` — the in-place helper that already exists and is only used by the month arrows)
- **Hot path**: click the month label → `PickerMonthLabel` `click` → `toggleYearScroller:965` → `openYearScroller:980` → `buildYearScroller:1027` → `PickerColumn.clearCells` (171 disposals) → 171 × (`new PickerCell` → `Text` ctor → `setLineHeight` → 2 `Event.addListener`) → `_root.insertComponent` → `doLayout()` → `scrollSelectedIntoView()` (2 forced reads).
- **Evidence**:
  - Probe **P6** (first open): `{"createElement":192,"setId":185,"apply":2110,"ensureStyleRule":172,"setRuleStyles":173,"appendChild":533}`, 190 layout passes, and the first `getOffsetSize`/`getScrollMetrics` lands after **2,604** sink writes in the same task.
  - Probe **V1** (second open, identical year list): `{"removeElement":343,"deleteStyleRule":171,"release":171,"createElement":171,"setId":171,"apply":1905,"ensureStyleRule":171,"setRuleStyles":171,"insertBefore":172}` — **513 shared-stylesheet mutations to rebuild a list that did not change**.
  - Probe **V1** (while closed): `_yearColumn` retained, **171 cells retained, all 171 still holding an element and its per-instance rule**.
  - Probe **V1b**: `dropdown.dispose()` issues `{"removeElement":59,"deleteStyleRule":44,"release":63}` — the detached `_yearColumn` is not a registered child of `_root` any more, so `destructor()`'s recursion never reaches it. This is exactly the case `docs/concepts/performance.md` § *Disposing `Text` components* warns about ("a `Text` held only in a field … is unreachable by that recursion").
  - Probe **S3**: **366** `Event.addListener` registrations per `openYearScroller`.
- **Proposed change**: build the year list once (it depends only on `minDate`/`maxDate`, both construction-time), and on every later open call the existing `refreshYearSelection()` instead of `buildYearScroller()`; rebuild only when the bounds change. Add an `AbstractCalendarDropdown.destructor()` that disposes `_yearColumn`. Separately, the 171-cell default span deserves a second look — a scrollable `PickerColumn` is not virtualised, so 171 cells is 171 components, 171 rules and 342 listeners for a "pick a year" affordance.
- **Risk / blast radius**: `refreshYearSelection` is already the month-arrow path, so the highlight semantics are proven. `tests/component/input/DatePickerDropdown.test.ts` covers the scroller; check its type-ahead and Escape cases.
- **Proof at implement time**: probe V1 re-run — second-open `ensureStyleRule`/`deleteStyleRule` must be **0**; and the `DiagnosticsOverlay` "stylesheet rules" counter must return to its pre-open value after `closeYearScroller()` + `dispose()`.

### F17.4 `showAt` lays the panel out twice, the first time at the wrong size, and both passes run detached

- **Category**: D, A, E
- **Impact**: **HIGH** per open — one whole wasted 59-component layout pass, and the useful one runs before the element is in the document.
- **Where**: `component/input/AbstractCalendarDropdown.ts:688-718` (`showAt`), specifically `:703-705` (`pauseLayout` / `rebuild` / `resumeLayout`) and `:707-711` (`computePanelHeight` / `setWidth` / `setHeight` / `doLayout`), with `AnimatedDropdown.showAnimated:213` (`LayerManager.mount`) only at `:715`.
- **Hot path**: `AbstractPickerField.openDropdown:570` → `dropdown.showAt` →
  1. `:704` `rebuild()` → `buildDayGrid()` builds 42 cells (with layout paused)
  2. `:705` `resumeLayout()` — per `docs/concepts/performance.md`, "runs a synchronous `doLayout()`" — **full pass #1**, at the panel's stale size (0×0 on the first open)
  3. `:707-709` `computePanelHeight()` → `getPerimeterSize()` → `getBorderSize()`; `setWidth`/`setHeight`
  4. `:711` `doLayout()` — **full pass #2**
  5. `:713` `placeAnchored(DOM.source.getElementRect(anchorEl))` → forced rect read + `getViewportSize()`
  6. `:715` `showAnimated()` → **only now** `LayerManager.mount(el)`
- **Evidence**:
  - Probe **R4** warm re-open: **118 layout passes** for a panel of 59 components (probe Q6) = exactly two full recursive passes.
  - Probe **Q2c**: the open is one task of **899 sink writes with 91 stylesheet-rule ops**, first rule op at write #15 and last at write #898; **124 of 124** modelled `DOM.source` reads in that task land *after* the first rule write. The anchor `getElementRect` and `getViewportSize` land at write #895.
  - The contrast is in this slice: `component/input/TimePickerDropdown.ts:149-156` mounts (`showAnimated`) *before* `doLayout()` and the comment says why — "unlike the calendar dropdown, whose show-time `buildDayGrid` forces element creation". Probe Q2b: the time picker's open is one pass, not two.
  - Slice 09 measured the production cost of laying out detached (`AbstractWindow.show()` → 516 `getComputedStyle(documentElement)` vs 0 attached) and slice 01 found the cause: `Component.getBorderSize:3685` caches only the *connected* result and falls through to an **uncached** `estimateBorderSideWidth` → `DOM.source.getThemeVar` path when the element is not connected.
  - **Not verified offline**: the modelled source cannot reproduce that production `getComputedStyle` count (probe S2 showed the modelled `getThemeVar` traffic is an artefact of `ModelledDOMSource.measureText`, not of border estimation). The *ordering* and the *double pass* are verified; the detached-layout cost is inferred from slices 01/09.
- **Proposed change**: size the panel before laying it out and lay it out once — set width/height, mount, then a single `doLayout()`, mirroring `TimePickerDropdown.showAt`. `computePanelHeight()` is pure arithmetic over constants plus `getPerimeterSize()`, so it can run before the grid is built. Move the `getElementRect`/`getViewportSize` anchor reads ahead of the frame's first rule write, or hold them from before the rebuild.
- **Risk / blast radius**: `showAt` is the only entry point for both calendar dropdowns; `DateTimePickerDropdown`'s extra time-row participates through `getExtraInnerHeight()`. `tests/component/input/DatePickerDropdown.test.ts` and `DateTimeField.test.ts` pin the resulting geometry.
- **Proof at implement time**: probe R4 re-run — layout passes per open must halve (118 → 59); a probe asserting `LayerManager.mount` precedes the first `doLayout` in `showAt`.

### F17.5 Every month step and every re-open rebuilds all 42 day cells, when 2 of 42 change

- **Category**: D, G, I, B
- **Impact**: **HIGH** per event — a month arrow is a click-repeat affordance, and the re-open case fires on every single dropdown open.
- **Where**:
  - `component/input/AbstractCalendarDropdown.ts:762-802` (`buildDayGrid` — `disposeAllComponents()` then 42 fresh components)
  - called from `:704` (`rebuild` ← `showAt`), `:923`/`:945` (`prevMonth`/`nextMonth`), `:1018` (`closeYearScroller`), `:888` (`onDateSelected`)
  - the in-place precedents in the same file / module: `:1057` `refreshYearSelection`, `component/input/PickerColumn.ts:405` `setSelectedValue`
- **Hot path**: chevron `click` → `PickerNavButton` handler → `nextMonth:932` → `buildDayGrid:762` → 42 × (dispose + `new PickerDay`/`PickerBlankCell` + `Text` ctor + `setLineHeight` + `setCursor` + 2 `Event.addListener` + a fresh closure) → `:946` `doLayout()`.
- **Evidence**:
  - Probe **R4b** (one month arrow): `{"removeElement":84,"release":42,"deleteStyleRule":30,"apply":489,"createElement":42,"setId":42,"insertBefore":42,"ensureStyleRule":31,"setRuleStyles":31}`, 42 empty applies, **59 layout passes**.
  - Probe **S3**: **62** `Event.addListener` registrations per month step, each with a fresh inline closure.
  - Probe **Q3**: after one month step, **9 of 42** labels are unchanged at the same index — a rebind would rewrite 33 labels and touch nothing else.
  - Probe **U2**: re-opening on the *same* month with a different selected day changes the `(label, selected, disabled)` triple of **2 of 42** cells. Probe **R4c** shows that identical re-open still costs the full `{"createElement":43,...,"apply":555,...}` / 118-pass rebuild.
  - Text measurement is *not* the problem here: probe R4b shows 1 `measureTexts` covering 31 of the 32 modelled `measureText` calls, i.e. the framework's batched probe is being used correctly (unlike the tree renderers slice 18 found).
- **Proposed change**: build the 42 grid slots once and rebind them — `setText`, `setSelected`, `setDisabled` per slot, guarded (all three setters already have unchanged-value guards). The blank/day distinction becomes a `setVisible`-free label swap plus an "is a day" flag, so the component identity, its rule and its listeners survive a month step. `showAt` then only rebinds when `_monthAnchor` or `_value` actually moved.
- **Risk / blast radius**: `buildDayGrid` is `protected` and overridable; `_highlightedDayIdx` is reset by it (`:764`) and several keyboard helpers index into `getDayGridChildren()`, so a rebind must keep the 42-slot indexing contract (it does — the padding to 42 already guarantees a stable length). `tests/component/input/DatePickerDropdown.test.ts` walks the grid by index.
- **Proof at implement time**: probe R4b re-run — `createElement`/`removeElement`/`deleteStyleRule` per month step must be **0**; probe R4c — an identical re-open must issue 0 element ops.

### F17.6 `DateTimePickerDropdown` pays the full grid rebuild on every day click; `DatePickerDropdown` proves it is avoidable

- **Category**: D
- **Impact**: **MEDIUM-HIGH** — per day click in the combined picker, which is the picker the user clicks repeatedly (the panel stays open).
- **Where**:
  - `component/input/AbstractCalendarDropdown.ts:884-890` (`onDateSelected` → `rebuild()` + `doLayout()`)
  - `component/input/DatePickerDropdown.ts:66-70` (the override that skips it, with the comment "the field's selection callback closes the panel, so refreshing the grid would be wasted work")
  - `component/input/DateTimePickerDropdown.ts` — no override, so it inherits the rebuild
- **Hot path**: day cell `click` → `PickerDay.onClick:329` → `onDateSelected:884` → `applyDateSelection` → `notifyValueChanged` → `rebuild():753` → `buildDayGrid` (42 components) + `rebuildExtraRowsAfterValueChange` → `doLayout()`.
- **Evidence**: probe **P2** — `DatePickerDropdown.onDateSelected` = `{}` (zero sink ops, 0 layout passes); `DateTimePickerDropdown.onDateSelected` = `{"removeElement":84,"release":42,"deleteStyleRule":30,"apply":507,"createElement":42,"setId":42,"insertBefore":42,"ensureStyleRule":30,"setRuleStyles":30,"setValue":1}`, **69 layout passes** — to move one highlight inside the month that is already displayed.
- **Proposed change**: rides on F17.5. Once the grid rebinds, `onDateSelected` becomes "clear the old selected cell, set the new one, re-seed the time row" — two guarded `setSelected` calls (and, with F17.2, two class toggles).
- **Risk / blast radius**: the base method is `protected` and both concrete dropdowns are public. `tests/component/input/DateTimeField.test.ts` pins that a day click preserves the time portion (`applyDateSelection:120`).
- **Proof at implement time**: probe P2 re-run — `DateTimePickerDropdown.onDateSelected` element ops must be 0.

### F17.7 The invalid-border flips a stylesheet rule on most keystrokes, and partial input silently commits

- **Category**: C, H
- **Impact**: **MEDIUM** — per keystroke on hot path 4, plus a visible red-border flash while typing.
- **Where**:
  - `component/input/AbstractPickerField.ts:427-446` (`onInput`), `:501-512` (`setInvalid` → `Component.setBorder`)
  - `component/input/DateField.ts:116-131` (`parseRaw`), `TimeField.ts:123-151`, `DateTimeField.ts:134-155`
- **Hot path**: `<input>` `input` event → `AbstractPickerField.onInput:427` → `parseRaw(raw)` → `setInvalid(…)` → `setBorder(…)` → `StyleTarget.setRuleStyles` on the field's `#id` rule → full-document restyle.
- **Evidence**: probe **R3**, typing `2026-09-16` one character at a time:

      key 1  "2"           setRuleStyles ×1 (+ensureStyleRule)   invalid: true
      key 4  "2026"        setRuleStyles ×1                       invalid: false
      key 5  "2026-"       setRuleStyles ×1                       invalid: true
      key 7  "2026-09"     setRuleStyles ×1                       invalid: false
      key 8  "2026-09-"    setRuleStyles ×1                       invalid: true
      key 10 "2026-09-16"  setRuleStyles ×1                       invalid: false

  **6 stylesheet mutations to type a 10-character date**, and the border visibly flashes red three times. Probe **R3b** confirms the isolated cost: `setInvalid(true)` = 1 `ensureStyleRule` + 1 `setRuleStyles`; `setInvalid(false)` = 1 `setRuleStyles`.
  The `invalid: false` rows at keys 4 and 7 are also a correctness smell: `DateField.parseRaw:128` does `new Date(raw + "T00:00:00")`, so the bare `"2026"` and `"2026-09"` prefixes parse and `notifyChange` fires with a value the user never typed.
- **Proposed change**: carry the invalid state as a `.invalid` class toggled through `Component.setStyleState` (one class flip, no rule mutation), and only evaluate it on blur / Enter — `commitShorthandIfPresent:476` already establishes that "commit on blur and Enter, never mid-keystroke" is this class's contract. Tighten `parseRaw` to require a complete `YYYY-MM-DD`.
- **Risk / blast radius**: `setInvalid` is `protected` with no external callers (`grep -rn "setInvalid" packages/` → the base class and its own tests). `tests/component/input/DateField.test.ts:273+` asserts `onInput` behaviour including the change fan-out — the parse tightening will need those cases revisited, so it may be worth splitting from the styling change.
- **Proof at implement time**: probe R3 re-run — `setRuleStyles` across 10 keystrokes must be 0.

### F17.8 Two cell classes re-apply a class the framework already applied — 32 redundant applies per calendar build

- **Category**: B
- **Impact**: **MEDIUM** — per dropdown build and per month step (32 extra `apply` calls each time), LOW individually.
- **Where**:
  - `component/input/AbstractCalendarDropdown.ts:412-422` (`PickerDay.render` → `addClass: ["PickerDay"]`)
  - `component/input/AbstractCalendarDropdown.ts:216-222` (`PickerNavButton.render` → `addClass: ["PickerNavButton"]`)
  - `core/Component.ts:7585` — `init` already applies `[COMPONENT_CLASS, ...getStyleClassChain(this.constructor), …]`, and `getStyleClassChain` (`core/ClassStyleRules.ts:1026`) includes the class's own name.
- **Evidence**: probe **T1** — during a cold calendar open the recorded `addClass` patches are
  `["ts-ui-component","Text","PickerDay","lh24px"]` ×30 followed by `["PickerDay"]` ×30, and
  `["ts-ui-component","PickerNavButton"]` ×2 followed by `["PickerNavButton"]` ×2.
  The in-slice proof that the explicit add is unnecessary: `PickerCell` (`PickerColumn.ts:266-274`) does **not** add its own name and still gets `["ts-ui-component","Text","PickerCell","lh22px"]`.
  `PickerDay.render:417-419` and `PickerCell.render:269-271` also split the `.disabled` add into a *second* `apply` instead of folding it into the same patch.
- **Proposed change**: delete the self-name `addClass` in `PickerDay.render` and `PickerNavButton.render`; fold the conditional `.disabled` token into the one patch `init` already issues (or into the `activeStateTokens` path, once F17.2 moves selection to a state class). Keep `PickerMonthLabel.render:263-269`'s `addClass: ["PickerNavButton"]` — that one names a *different* class and is load-bearing; it is a candidate for a `StyleTrait`.
- **Risk / blast radius**: none beyond this file; `tests/component/input/TextClassStyleHoisting.test.ts:234` references these classes by name in a comment only.
- **Proof at implement time**: probe T1 re-run — no `addClass` patch whose only token is the component's own class name.

### F17.9 42–171 per-cell `pointerdown` listeners duplicate the panel-wide subtree guard

- **Category**: G, I
- **Impact**: **MEDIUM** — allocation and registration churn on every grid/scroller build; no per-frame cost.
- **Where**:
  - `component/input/AbstractCalendarDropdown.ts:302` (`PickerDay`), `:197` (`PickerNavButton`), `:245` (`PickerMonthLabel`), `component/input/PickerColumn.ts:163` (`PickerCell`) — four registrations whose handler bodies (`:322`, `:207`, `:255`, `:174`) are **deliberate no-ops**, present only to carry `prevent: true`
  - the guard that already covers all of them: `component/input/AbstractCalendarDropdown.ts:633` and `component/input/TimePickerDropdown.ts:111` — `Event.addSubtreeListener(this, "pointerdown", …)` returning `{ prevent: true }` for every target that is not an `<input>` (`:670`) or a scrollbar (`:674`)
- **Evidence**: probe **S3** — 60 `Event.addListener` on a cold calendar open, **62 more per month step**, **366 on opening the year scroller**. Each is a fresh inline closure, which slice 11 showed also defeats `Event`'s same-reference dedup. Day cells and year cells are neither `<input>`s nor scrollbars, so the subtree guard already prevents default on every one of them.
- **Proposed change**: drop the per-cell `pointerdown` registrations and the four empty handler bodies; keep the one subtree listener per dropdown. The `click` listeners stay.
- **Risk / blast radius**: `PickerCell` and `PickerColumn` are public exports (`component/input/index.ts:33`), so a consumer could mount them outside a dropdown and lose the focus-loss guard. If that matters, move the guard onto `PickerColumn` itself (one subtree listener per column) rather than per cell. `PickerNavButton`/`PickerMonthLabel` are module-private, so those two are unconditionally safe.
- **Proof at implement time**: probe S3 re-run — `Event.addListener` per month step must drop by ~2 per day cell.

### F17.10 `PickerDay` is `PickerCell` plus a `Date`, with a duplicated rule triple

- **Category**: I, H
- **Impact**: **LOW** (code health) — but it doubles the surface every one of F17.2, F17.8 and F17.9 has to be fixed on.
- **Where**: `component/input/AbstractCalendarDropdown.ts:278-423` vs `component/input/PickerColumn.ts:137-275`.
  - `setSelected` (`:343-359` vs `:195-211`): byte-identical, same two theme tokens, same guard, same else branch.
  - `setDisabled` (`:377-394` vs `:232-249`): identical modulo a comment.
  - `isSelected` / `isDisabled`: identical.
  - constructors differ only in the cell height (24 vs 22) and the `Date` payload + its click adapter.
  - The module-level rules are duplicated too: `.PickerDay` / `.PickerDay:hover` / `.PickerDay.disabled` (`AbstractCalendarDropdown.ts:93-121`) are the same three declarations as `.PickerCell` / `.PickerCell:hover` / `.PickerCell.disabled` (`PickerColumn.ts:38-67`) — **6 shared stylesheet rules where 3 would do**.
- **Proposed change**: make `PickerDay extends PickerCell`, overriding only the cell height and adding `getDate()`; delete the `.PickerDay*` rule triple and let the day cell carry `.PickerCell`.
- **Risk / blast radius**: the day cell's height constant (`CELL_HEIGHT = 24` in the calendar, `22` in `PickerColumn`) must stay distinct — the day grid's `DAY_GRID_HEIGHT` (`:40`) is derived from it and `computePanelHeight` (`:740`) from that.
- **Proof at implement time**: the shared-stylesheet rule count at module load drops by 3; `DatePickerDropdown`/`PickerColumn` test suites unchanged.

### F17.11 `AbstractCalendarDropdown.ts` is three widgets and five components in one 1,616-line file

- **Category**: H
- **Impact**: **LOW** (structure only), but it is what keeps F17.3 and F17.5 entangled.
- **Where / responsibility split** (`component/input/AbstractCalendarDropdown.ts`):

  | Lines | Responsibility |
  |---|---|
  | 24-142 | glyph registration, 7 layout constants, `navGlyphPx()`, 5 module `StyleRule`s |
  | 145-167 | `PickerDayHeader`, `PickerBlankCell` |
  | 175-270 | `PickerNavButton`, `PickerMonthLabel` |
  | 278-423 | `PickerDay` (duplicate of `PickerCell` — F17.10) |
  | 425-446 | `dayStart` / `dayEnd` date helpers |
  | 566-745 | panel construction + open/close lifecycle + panel-height arithmetic |
  | 753-901 | day-grid model: build, range clamping, day commit |
  | 907-959 | month navigation |
  | **980-1096, 1328-1549** | **the year scroller: open/close/build/refresh/commit, its own keyboard router, its own 4-digit type-ahead buffer and idle timer** (~400 lines, ~35 % of the class) |
  | 1106-1320 | day-grid keyboard router |
  | 1559-1610 | subclass hooks |

  The year scroller shares exactly one piece of state with the rest of the class (`_monthAnchor`) and one piece of chrome (the `_root` slot at `DAY_GRID_INDEX`). It is a separate widget living inside the calendar.
- **Proposed change**: extract a `YearScroller` component (a `PickerColumn` subclass owning `_highlightedYear`, `_yearTypeBuffer`, `_yearTypeTimer`, `handleKey`, and the build/refresh pair), and move the five cell classes to their own module alongside `PickerCell`. This also gives F17.3's "build once, refresh thereafter" and the missing `destructor()` a natural home.
- **Risk / blast radius**: all the moved members are `private`; the only `protected` surface used by subclasses is `openYearScroller`/`closeYearScroller` (`DateTimePickerDropdown` does not override either) and `applyYearSelection`.
- **Proof at implement time**: no behaviour change; the file drops below ~900 lines and `DatePickerDropdown.test.ts` passes unchanged.

### F17.12 One settled calendar layout pass issues 2,708 size-hint queries

- **Category**: D
- **Impact**: **MEDIUM** per open / per month step — corroborating evidence for the slices 01/05 memo finding, not a new root cause.
- **Where**: `component/input/AbstractCalendarDropdown.ts:618-619` — `_dayGrid` is a `Grid({ columns: 7, spacing: 2 })` with 42 children; `:609-610` `_weekdayRow` another 7-child `Grid`.
- **Evidence**: probe **S4b** — one settled `dd.doLayout()` on the 59-component calendar (probe Q6) → **911 `getPreferredSize` + 1,519 `getMinSize` + 278 `getMaxSize`** ≈ 46 size-hint queries per component per pass. Slice 05 measured 267/263/263 on a 31-component tree; the 7-column `Grid` track solve over 42 children is the multiplier here. Probe **S4** separately shows **0** `getScrollMetrics` over 5 identical time-picker passes, so slice 04's settled-`Panel` remeasure does **not** reproduce inside a picker dropdown.
- **Proposed change**: nothing local — this is the memo lever slices 01/05 propose. Locally, F17.5 removes most of the *occasions* on which this pass runs at all, and `PickerBlankCell` / `PickerDay` could report `clampsToContentSize() === false` (slice 19's finding that this drives `getMinSize`/`getMaxSize` to zero calls) since their size is fully determined by the grid cell.
- **Proof at implement time**: probe S4b re-run after the memo lands; the per-component ratio should fall towards slice 05's ~8.

### F17.13 Four near-identical `updateHeight()` bodies remain (2026-08-29 audit item #9, partially closed)

- **Category**: I
- **Impact**: **LOW** (code health), cross-slice (15 / 16 / 17).
- **Where**: `component/input/AbstractPickerField.ts:292-297`, `component/input/TextField.ts:75-80`, `component/input/ComboBox.ts:884-889` — byte-identical apart from the default-width constant; `component/input/NumberSpinner.ts:285-291` differs only in reading `this._input.getPadding()` instead of `this.getPadding()`.
- **Evidence**: `grep -rln "protected updateHeight(): void" packages/lib/src/typescript/lib` → 2 files; `grep -rn "updateHeight" … | grep -v "this.updateHeight()"` → 4 definitions total. The audit listed **six**; `PasswordField`/`UsernameField` now inherit `TextField`'s, so two are closed and four remain.
- **Proposed change**: one `AbstractInput`-level `applySingleLineBoxFor(paddingSource, defaultWidth)` helper. Not worth a plan of its own — ride along with whichever of slices 15/16 touches `AbstractInput`.

---

## Entity inventory

| Entity | Stated function | Owns DOM (elements, rules) | Per-layout-pass writes / reads | Verdict | Findings |
|---|---|---|---|---|---|
| `AbstractPickerField` | Shared chrome for the three picker fields: inner `PickerInput` + 24-px `PickerButton`, dropdown lifecycle, invalid border, keyboard contract (`AbstractPickerField.ts:52-68`) | root element + its `#id` rule; `INPUT_CHROME_TRAIT` layer; one `registerFocusWithinRing` selector shared by all three fields | **5 real style writes + 10 `doLayout` calls + 161 size-hint queries per settled pass** (probes S1/R1/T2) vs a `TextField`'s 1 empty apply / 1 pass / 4 queries | **mismatch** | F17.1, F17.7, F17.13 |
| `DateField` / `TimeField` / `DateTimeField` | Concrete picker fields: format/parse, glyph, dropdown factory, preferred width (160 / 140 / 200) | nothing of their own | none (all layout is the base's) | fits | F17.7 (`parseRaw` accepts prefixes) |
| `AbstractCalendarDropdown` | Shared calendar structure, keyboard contract, year scroller, min/max clamping, open/close (`:477-492`) | panel root + `#id` rule; `_root`/`_headerRow`/`_weekdayRow`/`_dayGrid` (4 components); 5 module `StyleRule`s; 1 subtree `pointerdown` listener | **2 full passes per open** (118 for 59 components), 2,708 size-hint queries per pass, 91 rule ops + 899 writes in the open task | **over-built** (three widgets in one class) | F17.3, F17.4, F17.5, F17.6, F17.11, F17.12 |
| `DatePickerDropdown` | Panel width only; overrides `onDateSelected` to skip the rebuild | none | none | **fits** (and is the positive precedent) | — |
| `DateTimePickerDropdown` | Adds an embedded `TimeField` row and preserves the time portion | the `TimeField` child | inherits the base's | fits, but inherits the rebuild | F17.6 |
| `TimePickerDropdown` | Hour/Min(/Sec) columns, built once, re-highlighted in place | panel root + `#id` rule; `TimeColumns`; 1 subtree `pointerdown` listener | one pass per open (probe Q2b); 0 `getScrollMetrics` over 5 identical passes (probe S4) | **fits** — the in-slice precedent for `showAt` ordering | — |
| `PickerColumn` | Header + scrollable cell list stacked by a `VBox` | a `PickerCellList` (a `Panel`, `autoScroll:"y"`, overlay scrollbars, scroll shadows) + optional header | none of its own; `scrollSelectedIntoView` does 1 `getOffsetSize` + 1 `getScrollMetrics` + 1 `scrollTop` write **per call** | fits | F17.2 (read-after-rule-write), F17.3 |
| `PickerCellList` | A `Panel` reporting no vertical content minimum so the inner scroll engages | panel element + inner overlay scroller + 2 `Scrollbar`s | inherits `Panel`; measured 0 forced scroll reads on settled passes | fits | — |
| `PickerCell` | One clickable, selectable, disable-able cell | own element + `#id` rule; 2 `Event` listeners | `setSelected` = 2 `setRuleStyles`; `setDisabled` = 1 class toggle + 1 cursor rule | mismatch (selection should be a class) | F17.2, F17.9, F17.10 |
| `PickerDay` | Same as `PickerCell`, plus a `Date` payload | own element + `#id` rule + a redundant self-name `addClass`; 2 `Event` listeners | as `PickerCell`, plus 1 extra `apply` per render | **mismatch / duplicate** | F17.2, F17.8, F17.9, F17.10 |
| `PickerBlankCell` | Empty 24-px spacer so the grid is always 6×7 | own element + `#id` rule | none | fits | — |
| `PickerDayHeader` / `PickerColumnHeader` | Static column/weekday labels | own element + `#id` rule + an `lh<N>px` value class | none | fits (`PickerColumnHeader`'s *export* is dead) | dead-code list |
| `PickerNavButton` | Chevron click target with a centred `Glyph` | own element + `#id` rule + redundant self-name `addClass`; a `Fit` manager; 2 `Event` listeners | none per pass | fits | F17.8 |
| `PickerMonthLabel` | Month label rendered as a button, carries `.PickerNavButton` | own element + `#id` rule + a legitimate cross-name `addClass` | `setText` per month step | fits | — |
| `TimeColumns` | Hour/Min(/Sec) grid, built once, re-highlighted in place (`TimeColumns.ts:24-32`) | 2–3 `PickerColumn`s (26–38 cells) | none per pass; one pick = 4 `setRuleStyles`, 0 layout passes (probe Q5) | **fits** — the in-slice rebind precedent | F17.2 |
| `dateMath.ts` | Tokenize / apply / resolve the relative shorthand grammar | none | none — pure, two module-level regexes, no allocation per call beyond the token array | **fits** (cleanest module in the slice) | `applyDateMath` export is prod-dead |
| `data/temporalText.ts` | One locale formatter shared by the `Date`/`Time`/`DateTime` cell renderers and their filters | none | none | fits | — |

---

## Redundant, duplicated and dead code

Items not already covered by a finding above. Greps run over all of `packages/` (lib, docs app, create-app, tests), excluding `node_modules` and `lib/dist`.

1. **`PickerColumnHeader` is a dead export.** `grep -rn --include='*.ts' -w PickerColumnHeader packages/ | grep -v node_modules | grep -v /dist/` → **3 hits**: its own declaration (`PickerColumn.ts:71`), its own single use (`:295`), its export (`:420`). Not re-exported from `component/input/index.ts` (which exports only `PickerCell, PickerCellList, PickerColumn` at `:33`) and imported nowhere. Drop it from the export block.
2. **`PICKER_CELL_HEIGHT` has one caller, a test.** `grep -rn -w PICKER_CELL_HEIGHT packages/ | grep -v /dist/` → **5 hits**: the alias (`PickerColumn.ts:421`) and 3 uses in `tests/component/input/TimePickerDropdown.test.ts`. Keep (a test-only export of a layout constant is legitimate), but note it is not public API.
3. **`applyDateMath` has no production caller.** `grep -rn -w applyDateMath packages/ | grep -v /dist/` → **9 hits**: the declaration (`dateMath.ts:87`), one internal call from `resolveDateMath` (`:145`), and 6 in `tests/component/input/dateMath.test.ts`. `tokenizeDateMath` *does* have production callers (the three fields' `isRawShorthand`). Either keep `applyDateMath` module-private and test it through `resolveDateMath`, or leave it and record it as deliberately test-exposed.
4. **`AbstractPickerField._showSeconds` is unused on one third of its subclasses.** `AbstractPickerField.ts:88-90` hoists it to the base with the JSDoc "Harmless-and-unused on `DateField`". A base field that one subclass provably never reads is the `H` shape — either push it down into `TimeField`/`DateTimeField` (which would restore the duplication the hoist removed) or give the base an abstract `isShowingSeconds()` the three subclasses answer.
5. **`AbstractCalendarDropdown.getDayGridChildren():1158` is a one-line wrapper** around `this._dayGrid.getComponents()` with 6 callers, all inside the class. It allocates a fresh array per call, and `moveHighlightedDay:1169` then builds a second ~30-entry array of `{idx, cell}` objects per arrow keypress. Merge the wrapper away and cache the day-cell index list alongside the grid (it only changes when the grid does — which, after F17.5, is rarely).
6. **Two identical rule triples** — see F17.10: `.PickerDay` / `.PickerDay:hover` / `.PickerDay.disabled` (`AbstractCalendarDropdown.ts:93-121`) vs `.PickerCell` / `.PickerCell:hover` / `.PickerCell.disabled` (`PickerColumn.ts:38-67`).
7. **Four empty listener bodies** exist purely to name a removable reference for a `prevent: true` registration: `AbstractCalendarDropdown.ts:207, :255, :322` and `PickerColumn.ts:174`. All four registrations are redundant (F17.9).

### 2026-08-29 health-audit items for this slice: all three CLOSED

- *"15 of 17 symbols in an `AbstractCalendarDropdown.ts:1613-1633` export block"* — the block is now `:1613-1616` and exports exactly **two** symbols, `AbstractCalendarDropdown` and `ROOT_GAP`, both used (`grep -rn -w ROOT_GAP packages/ | grep -v /dist/` → 8 hits, including `DateTimePickerDropdown.ts:6,158`). **Closed.**
- *"`PickerColumn.ts:422`'s `PICKER_HEADER_HEIGHT` alias"* — `grep -rn -w PICKER_HEADER_HEIGHT packages/` → **0 hits**. **Closed.**
- *"`TimeColumns.ts:192,194`"* — the file is now 190 lines and its whole export block is `export { TimeColumns };` at `:190`. **Closed.**
- Item #9's *"six copies of an identical `updateHeight()` body"* is **partially** closed — four remain (F17.13).

### Positives to protect (a plan must not regress these)

- `DatePickerDropdown.onDateSelected:66` — **zero** sink ops and zero layout passes on a day click (probe P2).
- `TimeColumns` / `PickerColumn.setSelectedValue` — selection changes rebind in place; a pick never resets a scrolled column (probe Q5: 4 rule writes, 0 element ops, 0 layout passes).
- Day-grid text measurement **is** batched: 31 of 32 modelled `measureText` calls come from a single `measureTexts` (probe R4b) — not the per-string loop slice 18 found in the tree renderers.
- `setSelected` / `setDisabled` / `setInvalid` all have unchanged-value guards.
- **An open picker dropdown costs the host app zero per-frame work**: it is `Position.FIXED`, mounted by `LayerManager` (which registers no `resize`/`scroll` listeners — `grep -n "resize\|scroll" core/LayerManager.ts` → 0 hits), and sits outside the parent's layout tree. Unlike `Popover` (slice 11), it pays nothing on window scroll or resize.
- A picker field does **not** depend on a no-op setter still doing work, so slice 14's `ProgressSpinner` ordering constraint does not apply here.
- `dateMath.ts` allocates its two regexes once at module scope and is otherwise pure.
- `Text.setLineHeight` value classes stay bounded: the slice uses a fixed set of pixel line heights (18/20/22/24), so slice 14's unbounded rule leak does not bite (probe T1 shows `lh24px` / `lh22px` / `lh20px` reused, never minted per instance).

---

## Cross-slice notes

- **→ 05 layout-base-box-flow-grid**: `Absolute.doLayout` commits every child at `getPreferredSize() ?? getSize()` and then unconditionally recurses. For a container whose own `doLayout` override rewrites those rects afterwards (this slice's `AbstractPickerField`, and `ComboBox` in slice 16), that is a guaranteed double geometry write per pass with an intermediate value the user never sees. Either `Absolute` should skip a child whose rect is unchanged, or the "manager then override" pattern needs a documented alternative. This is the root of F17.1.
- **→ 05 / 01**: probe S4b gives a second data point for the un-memoised size hints — **46 size-hint queries per component per settled pass** on a 42-child 7-column `Grid`, vs slice 05's ~8 on a plain tree. `Grid` track solving is the worst amplifier found so far.
- **→ 02 core-component-styling**: the per-property `setRuleStyles` fan-out is what makes F17.2 cost *two* full-document restyles per cell rather than one. Every `setSelected` in this slice writes `backgroundColor` and `fontWeight` as two separate rule mutations.
- **→ 02**: `Component.setFontWeight` schedules a layout (probe P3: 2 `_dayGrid.scheduleLayout()` per highlight move). For a fixed-height grid cell whose box cannot change, that is an avoidable layout root — a candidate for the "setter whose `scheduleLayout()` provably never re-runs useful work" list slice 07 started.
- **→ 14 text-and-small-display**: probe T1 shows `Text`'s `lh<N>px` value class is applied as a **separate second `apply`** after `init`'s combined patch — 38 extra applies per calendar build (31 `lh24px` + 7 `lh20px`). Folding the value-class token into `init`'s single patch would remove them library-wide.
- **→ 16 inputs-combo-spinner-file**: `PickerInput` and `PickerButton` are yours; the double geometry commit in F17.1 is charged to them, and `ComboBox.doLayout:~890` has the same "`super.doLayout()` then overwrite" shape as `AbstractPickerField.doLayout`. Worth fixing as one change set. `ComboBox`'s `updateHeight` is one of the four copies in F17.13.
- **→ 04 core-panel-scrolling**: every `PickerColumn` contains a `Panel` with the default `scrollbarStyle: "overlay"` + `scrollShadows: true` — 3 of them in a seconds-enabled time picker, 1 in the year scroller. Probe S4 measured **0 `getScrollMetrics` over 5 identical time-picker layout passes**, so slice 04's "settled overlay `Panel` still runs the full live remeasure" does **not** reproduce here. Recording that as a limit on that finding's scope.
- **→ 03 core-dom-seam-events**: this slice registers **two subtree listeners for `pointerdown`** (`AbstractCalendarDropdown.ts:633`, `TimePickerDropdown.ts:111`), both installed in the constructor and never removed — so a field that has opened its dropdown once keeps them for the app's life. Adding to the registrant list slice 08 asked for (`SplitGutter`, `Accordion` ×2/section). `pointerdown` is not a per-frame event, so the cost is bounded, but the registrations are permanent.
- **→ 01 / 09**: F17.4's detached-layout claim rests on slice 01's uncached `Component.getBorderSize` pre-connect estimate (`core/Component.ts:3705-3712` falls through to `estimateBorderSideWidth` → `DOM.source.getThemeVar` and never caches) and slice 09's measured 516-vs-0 `getComputedStyle(documentElement)` contrast. **I could not reproduce the production count offline** — probe S2 showed the modelled `getThemeVar` traffic comes from `ModelledDOMSource.measureText` resolving its font, not from border estimation. The ordering (`doLayout` before `LayerManager.mount`) and the double pass are verified; the detached cost is inferred.
- **Seam gap**: `PickerColumn.scrollSelectedIntoView` (`:351-392`) has to reach for `DOM.source.getOffsetSize` + `getScrollMetrics` + a raw `scrollTop` write because, as its own JSDoc says, "the framework's typed scroll setter lives only on the `VirtualScroller`-backed components". `AbstractSelectableList.scrollIndexIntoView` does the same thing for the same reason. A `Panel`-level "reveal this child" that serves the offset from cached layout state (the framework already knows every child's `y`) would remove two forced document layouts from every picker-column reveal and from every list reveal. → **04 core-panel-scrolling**.

---

## Suggested plan grouping

**Plan A — "picker field layout: one pass, one commit" (F17.1, + F17.13 riding along).**
The single highest-value change in the slice and the only one on hot path 1. Self-contained in `AbstractPickerField.doLayout`. Measurable on its own: non-empty patches per settled pass 5 → 0, layout passes per pass 10 → 1, size-hint queries 161 → ~4 (probes S1 / R1 / T2). Should be sized alongside slice 16's `ComboBox`, which has the identical shape — one plan covering both is cheaper than two.
*Depends on:* nothing. *Blocks:* a later `canSkipUnchangedLayout` opt-in for picker fields.

**Plan B — "picker selection is a class, not a rule" (F17.2, F17.7, F17.8, F17.10).**
One coherent change set: give `PickerCell` a `.selected` state class driven through `Component.setStyleState`, make `PickerDay` a `PickerCell` subclass, delete the duplicate rule triple and the redundant self-name `addClass`es, and move the invalid border to a `.invalid` class evaluated on blur. Measurable: `setRuleStyles` per arrow keypress 2–4 → 0, per typed date 6 → 0, redundant applies per calendar build 32 → 0.
*Depends on:* nothing. *Note:* the `parseRaw` tightening in F17.7 is a behaviour change with its own test surface — split it out if it slows the plan down.

**Plan C — "the calendar grid rebinds, it does not rebuild" (F17.5, F17.6, and the occasions half of F17.12).**
Build 42 day slots once; `showAt`, the month arrows, `closeYearScroller` and the base `onDateSelected` all rebind. Measurable: element ops per month step 168 → 0, layout passes 59 → 1, listener registrations 62 → 0; `DateTimePickerDropdown` day click 507 applies → ~4.
*Depends on:* Plan B (the rebind wants the guarded state-class setters in place, otherwise every rebind writes rules).

**Plan D — "the year scroller is built once, and is released" (F17.3, F17.11).**
Extract `YearScroller`; build the cell list once per bounds configuration; call the existing `refreshYearSelection` on later opens; add the missing `destructor()`. Measurable: second-open stylesheet mutations 513 → 0, retained rules after close 171 → 0, `Event.addListener` per open 366 → 0.
*Depends on:* Plan B for the highlight path. The extraction (F17.11) is the natural vehicle; if it is deferred, the "build once + dispose" half still stands alone and is where the measurable win is.

**Plan E — "open the panel once, at the right size, mounted" (F17.4, F17.9).**
Reorder `showAt` to mirror `TimePickerDropdown.showAt`, hoist the anchor reads ahead of the frame's first rule write, and drop the per-cell `pointerdown` registrations now that only one guard is needed. Measurable: layout passes per open 118 → 59, `DOM.source` reads landing after a rule write 124 → 0.
*Depends on:* Plan C (there is little point halving the passes while each pass still rebuilds 42 components). Best sequenced C → E.

**Too small to plan — ride along:**
- F17.13 (four `updateHeight` copies) → with Plan A, or with whichever of slices 15/16 touches `AbstractInput`.
- The dead-code list items 1, 3, 5 → with Plan D (they are all in the two files it already opens).
- F17.12's `clampsToContentSize()` suggestion for `PickerDay`/`PickerBlankCell` → with Plan C.

**Cross-slice dependencies:** Plan A wants slice 05's view on `Absolute.doLayout`; Plan B's `setStyleState` route depends on slice 02's `StyleTarget` last-written-value work landing or not (it is independent, but the two together are what removes the restyle entirely); the seam gap under `scrollSelectedIntoView` belongs to slice 04 and would make Plan D's reveal free.

---

*Probes for this slice live in `.worktrees/_probes/17-inputs-pickers-calendar/` (`pickers.probe.test.ts`, `pickers2`–`pickers7`), run with*
`PROBE_DIR=.worktrees/_probes/17-inputs-pickers-calendar npx vitest run --config .worktrees/_probes/vitest.probe.config.ts`.
*No file outside that directory and this report was modified.*
