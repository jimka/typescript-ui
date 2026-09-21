---
depends-on: [field-decorator-pointer-tooltip]
touches-shared:
    - packages/qa/src/panels/form-flat.ts
    - packages/qa/src/builders/form.ts
    - packages/qa/tests/mount.test.ts
    - packages/qa/README.md
    - packages/lib/src/typescript/MiscPanel.ts
    - plans/research/render-review-2026-09-15/01-phase2-status-pass.md
    - plans/research/render-review-2026-09-15/00-post-campaign-agenda.md
---

# Documentation and QA Record Drift — Implementation Plan

## Overview

Four records have drifted from the code on `master` (`f0d95ef8`) or from a later decision, and one QA check, C21's, cannot be run. This plan corrects the records and gives `form-flat` a drive target for C21. Every item below was checked against `master` before it was written down.

| # | Where | What is wrong | Change |
|---|---|---|---|
| 1 | [`docs/components/ButtonGroup.md:63`](packages/lib/docs/components/ButtonGroup.md#L63) | Documents a `getSelected()` that `ButtonGroup` has never had | Delete the row; add no method |
| 2 | [`MiscPanel.ts:781-782`](packages/lib/src/typescript/MiscPanel.ts#L781) | Says a scoped quick search leaves "pending edits … untouched" | Say what `Table.setQuickSearch`'s TSDoc says |
| 3 | [`packages/qa/README.md:322`](packages/qa/README.md#L322) | Predicts C23 reads `setRuleStyles` 0 once fixed; it reads 2 | State 2, and why |
| 4 | `form-flat` | C21's witness cannot be driven: nothing reaches the fields | A `call` target that runs C21's sequence on component instances, plus a `tooltip` geometry label as its readout |
| 5 | [`packages/qa/README.md:355-357`](packages/qa/README.md#L355), [`00-post-campaign-agenda.md:46-50`](plans/research/render-review-2026-09-15/00-post-campaign-agenda.md#L46), [`:133`](plans/research/render-review-2026-09-15/00-post-campaign-agenda.md#L133) | Describe Loom's harness as still pending retirement | State the 2026-09-21 decision: it is retired |

Item 4's target hovers the first field as a pointer resting on it would, which reaches the decorator's error tooltip since `field-decorator-pointer-tooltip` landed (this plan depends on it).

No library behaviour or public signature changes. Nothing needs a changelog entry.[^no-changelog]

---

## Architecture Decisions

### `ButtonGroup.md` loses the row; `ButtonGroup` gains no `getSelected()`

The row is deleted from the *Common methods* table. No other line of the page changes. No consumer needs the method. The `"selection"` event already hands each listener the button, and each member answers `isSelected()` itself.[^no-getselected]

### `MiscPanel.ts`'s comment follows `Table.setQuickSearch`'s TSDoc

The demo comment keeps its "display-only" framing. It drops "pending edits" from the list of things left untouched, and adds that an open cell edit is committed first when the search rebinds its row. That is the claim [`Table.ts:576-580`](packages/lib/src/typescript/lib/component/table/Table.ts#L576) makes. `MiscPanel.ts:781` is the only surviving copy of the stale claim.[^quick-search-sweep]

### C23's steady figure is 2, and the README says why

Since the fix, the date field's parser accepts an absolute date only as a complete `YYYY-MM-DD`, and it gives the same answer in every engine. So typing `2026-09-19` makes the field invalid on the first character and valid again on the tenth. That is two changes of state, and each change is one `setRuleStyles` on the field's `#id` rule:

| Typed so far | Node, before the fix (slice 17) | WebKitGTK, before the fix | Any engine, after the fix |
|---|---|---|---|
| `2`, `20`, `202` | invalid (write at `2`) | valid | invalid (write at `2`) |
| `2026` | valid (write) | valid | invalid |
| `2026-`, `2026-0` | invalid (write) | invalid (write) | invalid |
| `2026-09` | valid (write) | valid (write) | invalid |
| `2026-09-`, `2026-09-1` | invalid (write) | invalid (write) | invalid |
| `2026-09-19` | valid (write) | valid (write) | valid (write) |
| **`setRuleStyles` over ten characters** | **6** | **4** | **2** |

`setInvalid` returns early when the state does not change ([`AbstractPickerField.ts:502`](packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L502)). So only the rows marked "write" cost a rule write. Before the fix, each prefix was judged by `new Date(raw + "T00:00:00")`, which is lenient in different ways in different engines. That is why the old figure was 6 in slice 17's Node probe and 4 in the engine.[^c23-engines] The README's "0 once fixed" came from a larger fix that C23 did not ship.[^c23-not-zero]

### The C21 target lives in the shared form builder, as a `call` target

`form-flat.ts` is a thin wrapper over `buildForm` in [`builders/form.ts`](packages/qa/src/builders/form.ts#L455), which builds every form target. The new target goes there too, so `form-nested` gets it as well. `form-flat.ts` changes only its `description`. The target is a named function returned by a factory. That is the shape of `shell.ts`'s `toggleTarget` ([`builders/shell.ts:221`](packages/qa/src/builders/shell.ts#L221)), the existing `CallTarget` precedent.[^builder-precedent]

### The target acts on component instances

The target keeps a reference to the first two decorated text fields. It "types" into a field by calling `TextField.setText(text)` and then the same check the field's `change` listener runs (`requireShortText`'s `checkShortText`). That check calls `FieldDecorator.showError` or `clearError`, which is where C21 lives. The target dispatches no `input` events and does not use the `type` driver.[^component-typing]

### The hover goes to the first field's own element

The target sends one `mouseover` with no button held to the first field's own element, at its centre, through `tools.fireMouse`. That element is the `<input>`, what a pointer resting on the field hits, and the decorator's covering error tooltip hears the `mouseover` through its subtree since `field-decorator-pointer-tooltip`. `fireMouse`'s default `relatedTarget` of `null` reads as a fresh enter, so it arms the tooltip's 500 ms hover delay exactly as a real pointer would. The target stays a `call` target rather than the `hover` driver: the hover and the keystroke must still share one phase, the reason the `type` driver was rejected.

### One keystroke, once the tooltip is on screen

Unit 0 types both fields past their 20-character limit, so both show their error. Then it hovers the first field. Each later unit checks whether the tooltip is on screen. On the first unit it is, the target types one character into the second field, and it never types again. The second field is still over its limit, so its check calls `showError`, which calls `Tooltip.attach` → `Tooltip.detach` on the second decorator. That re-attach is C21's trigger.[^one-keystroke]

| Unit (at 60 Hz) | Target does | `geometry.tooltip`, fixed (`master`) | Before C21's fix |
|---|---|---|---|
| 0 | both fields over the limit; `mouseover` on the first field | `null` | `null` |
| 1 – ~30 | nothing (the 500 ms hover delay) | `null` | `null` |
| first unit with the tooltip up (~31) | one keystroke into the second field | a rectangle | a rectangle (fading) |
| every later unit | nothing | the same rectangle | `null` from about 100 ms after the keystroke |

### The readout is a `tooltip` geometry label

The form's `geometry` gains `tooltip: '.Tooltip'`. The harness samples a selector target once per unit under `geom=1` and records `null` when nothing matches ([`probes.ts:68-78`](packages/qa/src/harness/probes.ts#L68)). The tooltip's element exists only while a tooltip is up or fading out. The target's own on-screen check uses the same selector.[^geometry-readout]

### Only living documents change for Loom's retirement

The README's shells paragraph and the agenda's phase-1 bullet and W3.0 sentence are updated. The agenda is the running order, and the README describes the QA app as it is. Dated measurement records, slice reports, the synthesis and implemented plans stay as written.[^living-docs]

### Commit buckets

| Order | Bucket | Commit | Files |
|---|---|---|---|
| 1 | bookkeeping | move the plan to `plans/in-progress/` | the plan |
| 2 | code | the C21 `call` target, its test and its README entries | `builders/form.ts`, `panels/form-flat.ts`, `tests/mount.test.ts`, `packages/qa/README.md` |
| 3 | code | the quick-search demo comment | `MiscPanel.ts` |
| 4 | docs | `ButtonGroup.md` | `ButtonGroup.md` |
| 5 | docs | C23's prediction | `packages/qa/README.md` |
| 6 | docs | the shells paragraph | `packages/qa/README.md` |
| 7 | bookkeeping | research-doc updates and the plan's `## Implementation Notes` | agenda, status pass, the plan |
| 8 | bookkeeping | move the plan to `plans/implemented/` | the plan |

A QA panel change ships with its README row in one code commit, as `8cf1a351` and `e06d9ef2` did.[^buckets]

---

## Internal Structure

All of this goes in `packages/qa/src/builders/form.ts`.

New imports. Widen the existing type import on line 16 to:

```ts
import type { CallTarget, GeometryTarget, HarnessTools } from '../harness/types.js';
```

New constants, placed after `DATE_TEXT` (line 60):

```ts
/** Text one character past the decorated fields' limit: the shortest text that shows their error. */
const OVER_LIMIT_TEXT = 'x'.repeat(MAX_TEXT_CHARS + 1);

/** The one character C21's sequence types into the second decorated field; the field stays over its limit. */
const KEYSTROKE = 'x';

/** The tooltip's element, by the class the library gives each component's element; a page has one tooltip. */
const TOOLTIP_SELECTOR = '.Tooltip';

/** The `buttons` bitmask with no button held, fixed by the UI Events spec: a hover, not a drag. */
const NO_BUTTONS_HELD = 0;
```

New interface, placed before `FormParts`:

```ts
/** A decorated text field: the field, its decorator, and the check its `change` listener runs. */
interface DecoratedField {
    field: TextField;
    decorator: FieldDecorator;
    check: (value: string) => void;
}
```

`FormParts` gains one field, after `first`:

```ts
    /** Every decorated text field, in form order; C21's `call` target uses the first two. */
    decorated: DecoratedField[];
```

`decorate` returns what it built (JSDoc gains `@returns The decorated field.`):

```ts
function decorate(field: TextField): DecoratedField {
    const decorator = FieldDecorator(field, field.getParentComponent()!);
    const check = requireShortText(decorator);

    field.on('change', check);

    return { field, decorator, check };
}
```

`addFields` and `fieldContainers` each gain a last parameter, `decorated: DecoratedField[]` (JSDoc: `@param decorated - The decorated text fields; filled in.`). `fieldContainers` passes it through to both of its `addFields` calls. In `addFields`, the `kind === 'text'` branch becomes `decorated.push(decorate(field as TextField));`.

The target and its three helpers, placed after `clickTarget`:

```ts
/**
 * Sets a decorated field's text and runs the check its `change` listener
 * runs — what one keystroke does, done through the field and its decorator
 * rather than through DOM events.
 *
 * @param entry - The decorated field.
 * @param text - The field's new text.
 */
function enterText(entry: DecoratedField, text: string): void {
    entry.field.setText(text);
    entry.check(text);
}

/**
 * Sends `element` a `mouseover` at its centre with no button held: the
 * event that arms a tooltip's hover delay.
 *
 * @param tools - The harness tools.
 * @param element - The element hovered.
 */
function hoverCentre(tools: HarnessTools, element: HTMLElement): void {
    const rect = element.getBoundingClientRect();

    tools.fireMouse('mouseover', element, rect.left + rect.width / 2, rect.top + rect.height / 2, { buttons: NO_BUTTONS_HELD });
}

/**
 * Whether a tooltip is on screen.
 *
 * @param tools - The harness tools, for `isPainted`.
 * @returns `true` when the tooltip's element exists and is painted.
 */
function tooltipOnScreen(tools: HarnessTools): boolean {
    const element = document.querySelector(TOOLTIP_SELECTOR);

    return element !== null && tools.isPainted(element);
}

/**
 * The `call` target: C21's sequence on the first two decorated text fields.
 * Unit 0 types both past their limit, so both show their error, then hovers
 * the first field. On the first later unit that finds the
 * tooltip on screen, one character is typed into the second field, whose
 * error re-attaches its own tooltip; nothing is typed after that.
 *
 * @param tools - The harness tools.
 * @param parts - The form's parts.
 * @param panel - The panel's id, for errors.
 * @returns The target, or `undefined` when the form holds fewer than two decorated fields.
 */
function tooltipOwnershipTarget(tools: HarnessTools, parts: FormParts, panel: string): CallTarget | undefined {
    const [owner, other] = parts.decorated;

    if (!owner || !other) {
        return undefined;
    }

    const fieldElement = elementFor(tools, owner.field, panel);
    let typed = false;

    return function stepTooltipOwnership(index: number): void {
        if (index === 0) {
            enterText(owner, OVER_LIMIT_TEXT);
            enterText(other, OVER_LIMIT_TEXT);
            hoverCentre(tools, fieldElement);

            return;
        }

        if (!typed && tooltipOnScreen(tools)) {
            enterText(other, other.field.getText() + KEYSTROKE);
            typed = true;
        }
    };
}
```

Both `showError` calls must come **before** the `mouseover`.[^order-unit-zero]

`mountedTargets` gains `call: tooltipOwnershipTarget(tools, parts, panel),` in its `targets` object, and its `@returns` line becomes ``@returns `hover`, `wheel`, and `type`, `click`, `pan` and `call` where their fields exist.`` The existing `undefined` filter already drops a missing `call`.

`buildForm`:
- `const decorated: DecoratedField[] = [];` beside `first`.
- The `fieldContainers(n, depth, store, first)` call becomes `fieldContainers(n, depth, store, first, decorated)`.
- `parts` gains `decorated`.
- Line 473 becomes `const geometry: Record<string, GeometryTarget> = { header, form: scroller, tooltip: TOOLTIP_SELECTOR };`.

---

## Ordered Implementation Steps

Every quoted "before" string is the file's text at `master` `f0d95ef8`. If a string does not match, stop: the line has moved.

**Setup.** The QA app's typecheck and tests read the built library. From the worktree root, run `npm run build:lib` before step 2. If the worktree has no `node_modules`, link the main tree's first, as the README's arm recipe does.

### Commit 2 — the C21 `call` target (code)

1. **Check the driver name is free.** `grep -n "call:" packages/qa/src/builders/form.ts` should return zero matches. If `checkbox-action-activation` has already landed a `call` target in this builder, stop and ask. Two sequences cannot share one driver name.

2. **`packages/qa/tests/mount.test.ts`: write the tests first.**
   - Extend the overlay import on line 11 to `import { AbstractWindow, Tooltip } from '@jimka/typescript-ui/overlay';`.
   - Append a new `describe('form-flat call target (C21)', …)` at the end of the file, after `P14 panel parameters`.
   - Its `beforeEach` installs the same 2D-context stub the `canvas-idle hidden group` describe installs (`:206-211`), copied verbatim. Say in a comment that it is the same stub.
   - Its `afterEach` does the following, in this order:
     - if `vi.isFakeTimers()`, call `Tooltip.hide()`, then `vi.advanceTimersByTime(FADE_SETTLE_MS)`, then `vi.useRealTimers()`;
     - then `vi.restoreAllMocks()`.
   - Mount each panel with real timers. Call `vi.useFakeTimers()` only after `mountPanel` resolves.[^test-timers]

   Constants (each documented):
   - `FRAME_MS = 16`: one 60 Hz frame, the pace a `call` phase runs at.
   - `HOVER_DELAY_UNITS = 30`: 480 ms, inside the tooltip's 500 ms hover delay.
   - `C21_UNITS = 60`: 960 ms, past the delay and a 100 ms fade after the keystroke.
   - `FADE_SETTLE_MS = 500`: past the fade and its fallback timer.
   - `OVER = 'x'.repeat(21)`: the decorated fields' 20-character limit, plus one.

   Helpers (each with JSDoc):
   - `runUnits(call, from, to)`: for each `i` from `from` to `to − 1`, runs `vi.advanceTimersByTime(FRAME_MS)` and then `call(i)`.
   - `decoratedTexts()`: `tools.walkComponents()` filtered by `tools.isA(c, 'FieldDecorator')`, mapped to each decorator's first child's `getText()`, then sorted. The walk order is not form order, so compare sorted lists.
   - `tooltipElement(mounted)`: returns `document.querySelector(mounted.build.geometry!.tooltip as string)`. The test reads the tooltip through the geometry label, so the test also pins that label.

   Write three `it`s: Expected Behaviour case 1, cases 2–4 as one test, and case 5. Run `npm -w packages/qa run test -- tests/mount.test.ts`. The second and third new tests must fail, because there is no `call` target yet; the first already passes. Every existing case must still pass.

3. **`packages/qa/src/builders/form.ts`.** Make every change in *Internal Structure*, in file order: imports, constants, `DecoratedField`, `FormParts`, `decorate`, `addFields`, `fieldContainers`, the four new functions after `clickTarget`, `mountedTargets`, `buildForm`.
   *Check:* `npm -w packages/qa run typecheck`, 0 errors. `npm -w packages/qa run test -- tests/mount.test.ts`, all green, including `form-flat fails under jsdom only for the gap it is excluded for`. That test must stay green because the stub is scoped to the new describe.

4. **`packages/qa/src/panels/form-flat.ts`.** In `description` (line 4), replace:

   > `; and C23 (DateField accepts partial dates and flashes its border while typing) under type=date. The flat partner`

   with:

   > `; C23 (DateField accepts partial dates and flashes its border while typing) under type=date; and C21 (fixed: a tooltip is dismissed only by the component it shows for) under call, where geometry.tooltip keeps its rectangle after the second decorated text field is retyped. The flat partner`

   Leave `build`'s JSDoc as it is: `call` takes no parameter.

5. **`packages/qa/README.md`: the form rows (lines 322–323).** Each row is one physical line. Make exactly these five substring replacements. Each "before" string occurs once in the file.

   a. The `form-flat` drivers cell. Before:

      ```
      `pan` (the first slider), `click`, `type`. `passes=` `form`
      ```

      After:

      ```
      `pan` (the first slider), `click`, `type`, `call` (C21's sequence on the first two decorated text fields). `passes=` `form`
      ```

   b. The end of the same cell. Before:

      ```
      a slider needs `n` ≥ 8. |
      ```

      After:

      ```
      a slider needs `n` ≥ 8, and `call` a second decorated text field, `n` ≥ 9. |
      ```

   c. The `form-flat` geometry cell. Before:

      ```
      | `header`, `form` | M23,
      ```

      After:

      ```
      | `header`, `form`, `tooltip` (the tooltip on screen; `null` while none is) | M23,
      ```

   d. The `form-flat` reproduces cell, a new C21 sentence before C23's. Before:

      ```
      gives `seam.sink.apply` 7. C23:
      ```

      After:

      ```
      gives `seam.sink.apply` 7. C21 (fixed): `call:120` with `geom=1`, as the run's only phase, gives `geometry.tooltip` `null` until the first decorated field's hover delay runs out, then the same rectangle in every later unit, although the second field is retyped on the first of them; before the fix the rectangle went `null` about 100 ms after that keystroke. See *C21's witness hovers the field* below the table. C23:
      ```

   e. The `form-nested` geometry cell. Before:

      ```
      | `header`, `form`, `inspector` |
      ```

      After:

      ```
      | `header`, `form`, `tooltip`, `inspector` |
      ```

   Do not touch the C23 or C34 sentences in this commit.

6. **`packages/qa/README.md`: a new paragraph** between the shells paragraph (ends line 357) and `Which panel and driver run each wave-3 candidate's hot path` (line 359):

   > **C21's witness hovers the field.** `form-flat`'s `call` target takes the first two decorated text fields past their 20-character limit, through `setText` and the check each field's `change` listener runs, so both show their error. It then sends one `mouseover`, with no button held, to the first field's own `<input>`, the element a pointer resting on the field hits. On the first unit that decorator's error tooltip is on screen, it types one character into the second field, whose error re-attaches its own tooltip. If `geometry.tooltip` is `null` in every unit, the hover never armed, and the run says nothing about C21. The sequence leaves both fields in error and the tooltip up, so give `call` a run of its own.

   Wrap it near 78 columns, like the paragraphs around it.

7. **Commit 2.** Stage the four files and commit. Suggested title: *Give form-flat a C21 tooltip-ownership target the harness can drive*.

### Commit 3 — the quick-search demo comment (code)

8. **`packages/lib/src/typescript/MiscPanel.ts`.** Replace lines 781–782:

   ```
                   // display-only (the store, selection, and pending edits are
                   // untouched — clearing the field restores every row). Role
   ```

   with:

   ```
                   // display-only (the store and selection are untouched, and
                   // clearing the field restores every row; an open cell edit is
                   // committed first if the search rebinds its row). Role
   ```

   *Check:* `grep -rn "pending edits are" packages/lib/src` returns zero matches. Line 420's "entirely display-only" is correct and stays as it is.

9. **Commit 3.** Suggested title: *Stop the quick-search demo comment promising an open edit survives*.

### Commit 4 — `ButtonGroup.md` (docs)

10. **`packages/lib/docs/components/ButtonGroup.md`.** Delete line 63, `` | `getSelected()` | Return the currently selected button or `null`. | ``, and change nothing else.
    *Check:* `grep -rn "getSelected" packages/lib/docs/components/ButtonGroup.md` returns zero matches.

11. **Commit 4.** Suggested title: *Drop the getSelected method ButtonGroup's page documents but never had*.

### Commit 5 — C23's prediction (docs)

12. **`packages/qa/README.md`, the `form-flat` row.** Replace:

    ```
    C23: `type` with `type=date&seam=1` gives `seam.sink.setRuleStyles` above 0, and 0 once fixed.
    ```

    with:

    ```
    C23 (fixed): `type:10` with `type=date&seam=1` gives `seam.sink.setRuleStyles` 0.2 per unit, 2 over the ten characters of `2026-09-19`: the field turns invalid on the first character and valid on the tenth, one rule write each, in any engine. It stays above 0 because the red border is still a stylesheet-rule write, which C23's fix left alone.
    ```

    Leave the *Validated* cell as it is. Its "4 … where slice 17 recorded six" is the pre-fix build `608544c9`'s record.

13. **Commit 5.** Suggested title: *Correct the QA README's C23 figure to the two rule writes the fix leaves*.

### Commit 6 — the shells paragraph (docs)

14. **`packages/qa/README.md`, lines 355–357.** Replace:

    ```
    opened from the tree. So their numbers will not match Loom's history. They
    exist so that a later Loom plan can take their baselines and retire Loom's
    harness; their `Validated` entries record those baselines.
    ```

    with:

    ```
    opened from the tree. So their numbers will not match Loom's history.
    Loom's own harness is retired (decided 2026-09-21; a separate Loom plan
    removes Loom's `qa/`), so S1 and S3 are measured on these two panels now,
    and their `Validated` entries are the baselines.
    ```

15. **Commit 6.** Suggested title: *Record in the QA README that the shells replace Loom's retired harness*.

### Commit 7 — research documents and implementation notes (bookkeeping)

16. **`plans/research/render-review-2026-09-15/00-post-campaign-agenda.md`.**
    - Lines 46–50: replace the bullet with:

      ```
      - ~~**Loom's `qa/` stays as it is** until the QA app's Loom-like panels (the
        deep and shallow app layouts standing in for S1 and S3) have their own
        baselines; a small Loom plan then removes it.~~ — **settled 2026-09-21:
        Loom's harness is retired.** `shell-deep` and `shell-shallow` recorded
        their S1 and S3 stand-in baselines on 2026-09-20 under both hosts, and a
        separate Loom plan removes Loom's `qa/`. The campaign's recorded numbers
        were measured in Loom's real shell and do not carry over to a panel.
      ```

    - Line 133: replace `shallow scene — in the QA app's panels, and in Loom while its harness remains.` with `shallow scene — in the QA app's panels.`

    *Check:* `grep -n "while its harness remains" plans/research/render-review-2026-09-15/00-post-campaign-agenda.md` returns zero matches.

17. **`plans/research/render-review-2026-09-15/01-phase2-status-pass.md`.** Write the date the step is carried out as `YYYY-MM-DD` in both edits.
    - After the paragraph ending `so it is not lost.` (line 376), add a blank line and then this paragraph, wrapped at 78 columns:

      ```
      **Fixed by `plans/doc-and-qa-record-drift.md` (YYYY-MM-DD): the row is
      gone, and `ButtonGroup` gains no getter — no consumer needs one, and the
      `"selection"` event already hands its listeners the button.**
      ```

    - In the `MiscPanel.ts:781` bullet (lines 395–396), append the text below after `corrected everywhere else.`, re-wrapping the bullet at 78 columns:

      ```
      **Fixed by `doc-and-qa-record-drift` (YYYY-MM-DD).**
      ```

18. **The plan's `## Implementation Notes`**, written as the implement skill directs. Then commit steps 16–18 together. Suggested title: *Record Loom's retired harness and two fixes*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/qa/src/builders/form.ts` |
| Modify | `packages/qa/src/panels/form-flat.ts` |
| Modify | `packages/qa/tests/mount.test.ts` |
| Modify | `packages/qa/README.md` |
| Modify | `packages/lib/src/typescript/MiscPanel.ts` |
| Modify | `packages/lib/docs/components/ButtonGroup.md` |
| Modify | `plans/research/render-review-2026-09-15/00-post-campaign-agenda.md` |
| Modify | `plans/research/render-review-2026-09-15/01-phase2-status-pass.md` |

---

## Expected Behaviour

Cases 1–5 are unit tests in `packages/qa/tests/mount.test.ts` (jsdom, the 2D-context stub, fake timers after mounting). Case 6 needs a real engine.

| # | Setup | Expect | Kind |
|---|---|---|---|
| 1 | `mountPanel('form-flat', new URLSearchParams('n=8'), …)` | `mounted.targets` has no `call` property: the form holds one text field | unit |
| 2 | the same at `n=9`, then `call(0)` | `decoratedTexts()` is `[OVER, OVER]`; `tooltipElement()` is `null` | unit |
| 3 | then `runUnits(call, 1, HOVER_DELAY_UNITS + 1)` (480 ms) | `tooltipElement()` still `null`; `decoratedTexts()` still `[OVER, OVER]` | unit |
| 4 | then `runUnits(call, HOVER_DELAY_UNITS + 1, C21_UNITS)` | `tooltipElement()?.isConnected` is `true`; `decoratedTexts()` is `[OVER, OVER + 'x']`, so exactly one keystroke landed | unit |
| 5 | as 2–4, with `vi.spyOn(Tooltip, 'detach')` calling the real `detach` and then `Tooltip.hide()`, which is the behaviour before C21's fix | `decoratedTexts()` is `[OVER, OVER + 'x']`; `tooltipElement()` is `null` | unit |
| 6 | `packages/qa/runqa.sh c21 main 'panel=form-flat&drive=call:120&geom=1'` | `phases[0].geometry.tooltip` is `null` for roughly the first 30 units, then one unchanging rectangle to the last unit | **manual, user-run only** |

Case 5 shows the check can fail. Without it, a target that never typed would pass case 4 just as well.[^case-5] The outcomes of cases 4 and 5 were checked in an offline probe against `master`'s build before this plan was written.[^probe]

---

## Verification

From the worktree root, after `npm run build:lib`:

1. `npm -w packages/qa run typecheck`: 0 errors.
2. `npm -w packages/qa run test`: all green, including the three new tests and the unchanged `JSDOM_GAPS` cases.
3. `grep -rn "pending edits are" packages/lib/src`: zero matches.
4. `grep -rn "getSelected" packages/lib/docs/components/ButtonGroup.md`: zero matches.
5. `grep -c "and 0 once fixed" packages/qa/README.md`: 0. `grep -c "retire Loom's" packages/qa/README.md`: 0.

`npm run docs:api` and `npm run docs:llms:check` are not needed, because no TSDoc and no exported symbol changes.[^docs-api]

**Never run case 6, `runqa.sh`, MiniBrowser or the Tauri `qa-host` yourself.** Each one takes over the user's desktop with a full-screen window. Case 6 goes into `## Implementation Notes` as owed to the user, with its command line and what it should read.

---

## Potential Challenges

- **The form rows are one line each.** `checkbox-action-activation` edits the same `form-flat` row for C34, so a merge will conflict on the whole line. Resolve it by keeping both sets of edits.
- **A stray fade leaks into the next test.** A tooltip left up when real timers return fades out on a real timer after the test ends, so the next test starts with a tooltip element still in the page; the probe saw exactly this. `afterEach` hides the tooltip and runs the fade out under fake timers first.
- **The walk order is not form order.** Compare `decoratedTexts()` as a sorted list, and never index the walk by position.
- **`form-flat` cannot mount under jsdom without the stub.** Keep the stub scoped to the new describe. The file's `JSDOM_GAPS` case depends on it being absent everywhere else.

---

## Critical Files

| File | Why |
|---|---|
| [`packages/qa/src/builders/form.ts`](packages/qa/src/builders/form.ts) | Every edit site of commit 2; `requireShortText:113`, `decorate:157`, `mountedTargets:429`, `buildForm:455` |
| [`packages/qa/src/builders/shell.ts:212-235`](packages/qa/src/builders/shell.ts#L212) | `toggleTarget`, the `CallTarget` precedent the new target mirrors |
| [`packages/qa/src/harness/types.ts`](packages/qa/src/harness/types.ts) | `CallTarget`, `GeometryTarget`, `HarnessTools.fireMouse` and `isPainted` |
| [`packages/qa/src/harness/probes.ts:62-78`](packages/qa/src/harness/probes.ts#L62) | `sampleTarget`: a selector with no match samples `null` |
| [`packages/qa/tests/mount.test.ts:34-66`, `:205-230`](packages/qa/tests/mount.test.ts#L205) | The shared `tools` and `afterEach`, and the 2D-context stub to copy |
| [`packages/lib/src/typescript/lib/overlay/Tooltip.ts:342-506`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L342) | `hide`, `attach` (the 500 ms delay at `:416`) and `detach`, C21's guarded code |
| [`packages/lib/src/typescript/lib/validation/FieldDecorator.ts`](packages/lib/src/typescript/lib/validation/FieldDecorator.ts) | `showError` / `clearError`, which attach and detach the decorator's covering error tooltip |
| [`packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts:427-512`](packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L427) | `onInput` and `setInvalid`, C23's rule writes |
| [`packages/lib/src/typescript/lib/component/table/Table.ts:571-583`](packages/lib/src/typescript/lib/component/table/Table.ts#L571) | The corrected quick-search claim step 8 copies |
| [`packages/lib/src/typescript/lib/overlay/ButtonGroup.ts`](packages/lib/src/typescript/lib/overlay/ButtonGroup.ts) | The real method surface |

---

## Non-Goals

- **No in-engine witness of C21's pending-show half.** The sequence types only after the tooltip is up, as the check was specified. `tests/overlay/Tooltip.test.ts` cases 3 and 10 pin the pending half.[^pending-half]
- **No *Validated* entry for the post-fix C23 run.** Its run name and library build are not recorded anywhere this plan can cite. Whoever holds the report adds it in the column's format.
- **No change to `form-flat`'s C23 description wording, `form-nested`'s description, or the C34 sentence and `clickTarget`.** C34 belongs to `checkbox-action-activation`.
- **No edit to dated records.** That covers `00-baseline.md`, the slice reports, `97-`/`98-`/`99-*.md`, `plans/implemented/**` and `changelog/0.6.0.md`.
- **Nothing in the Loom repository.** Loom's own plan removes its `qa/`.

---

## Notes

[^no-changelog]: `docs/reference/changelog/next.md` records consumer-visible changes to behaviour or API. `ButtonGroup` never had `getSelected()`, so deleting the row takes away nothing that shipped. The demo comment and the QA app are not shipped to consumers. The same reasoning kept `table-editing-doc-gaps` out of the changelog.

[^no-getselected]: The class exposes the `buttons` field, `getButtons()` (widened to `Component[]`), `addButton(s)`, `removeButton`, `setContainer`, `setAllowDeselect`, `on`/`off("selection")` and `dispose`. `git log -S` shows the `getSelected()` row arrived with the page in `ec1f6b5d` ("Add basic documentation"), and the class has never had the method. Consumers checked:
    - the docs demos `radiobutton-group.ts`, `togglebutton-group.ts` and `hbox-justify.ts`, which only construct the group;
    - the demo panels: `MiscPanel.ts:1477` reacts to `"selection"`'s payload, `LayoutTestPanel.ts:66` reads nothing, and `ComplexUIPanel.ts:48` calls `getButtons()`;
    - `TabBar.ts:495`, which only adds and removes buttons;
    - Loom and SQLAdmin, which do not use `ButtonGroup` at all.

    No caller would use a getter. Under the pre-1.0 rule, public API is added only for real consumer value, so the fix belongs in the doc.

[^quick-search-sweep]: The sweep grepped `pending (in-grid )?edits?`, `edits? (are|is) untouched`, `untouched` and every comment near `setQuickSearch` / `setRowVisible`. It covered `packages/lib/src`, `packages/lib/docs` (except the generated `api/`), `packages/docs/src`, `packages/qa` and `llms.txt`. Only `MiscPanel.ts:781` still makes the claim. `MiscPanel.ts:420` says only "entirely display-only", which `Table.ts` still says too. The other hits are outside this plan's reach: `changelog/0.6.0.md:184-190` is a released record and makes no pending-edit claim, and the copies in `plans/implemented/table-quick-search.md:351` and `table-row-visibility.md:213` are historical plans.

[^c23-engines]: Measured offline, with no window. The "WebKitGTK" column comes from `libjavascriptcoregtk-4.1.so.0`, called through its C API from Python `ctypes`. That is the JavaScriptCore build MiniBrowser and the Tauri host load. The "Node" column comes from `node -e`. For every prefix of `2026-09-19`, each evaluated `!isNaN(new Date(prefix + "T00:00:00").getTime())`. JavaScriptCore accepts `2`, `20`, `202`, `2026`, `2026-09` and the full date. Node accepts `2026`, `2026-09` and the full date. So under JavaScriptCore the field stays valid through the first four characters, and the 6 of slice 17 (`17-inputs-pickers-calendar.md:157-166`, probe R3) becomes the engine's 4. After the fix, `parseIsoDate` rejects every proper prefix with the `ISO_DATE` regex (`dateMath.ts:152`) before any `Date` is built. `resolveDateMath` rejects each one too, because its grammar needs a unit letter. So both engines give 2. Probe R3b adds that `setInvalid(true)` costs one `ensureStyleRule` plus one `setRuleStyles`, and `setInvalid(false)` costs one `setRuleStyles`.

[^c23-not-zero]: The 0 comes from `plans/implemented/qa-app-panels-editors-overlays.md:143`, whose "fixed" column copied slice 17's target: F17.7's "setRuleStyles across 10 keystrokes must be 0" and Plan B's "per typed date 6 → 0" (`17-inputs-pickers-calendar.md:170`, `:337`). That target assumed the invalid border becomes a `.invalid` style class, checked on blur. C23's fix shipped only the parser half. `tooltip-picker-and-serialization-fixes.md:827` lists "the rest of F17.7" as a non-goal ("the border still turns red on the first keystroke of a date; it just stops turning back and forth") and itself predicted 2 (`:694`). The user's in-engine run on `master` after the fix read 2.

[^builder-precedent]: Every form target — `passes`, `type`, `click`, `pan`, `hover`, `wheel` — is built in `builders/form.ts`, and the two panel files only pick a depth. Giving `form-flat` alone a target would add a depth branch to a builder whose whole contract is that "only the containers differ" (`form.ts:1-4`). `form-nested`'s README row already reads "As `form-flat`" for its drivers, so `call` is documented there without a new sentence. Its geometry column lists labels one by one, so it gains `tooltip`.

[^component-typing]: The user's attempt at driving C21 found that typing through DOM value changes and events did not reach the library's change handling, and that the panel exposed no component instances. So the target keeps references to the components and uses only public component methods.
    - `TextField` has no public method that both sets text and fires `change`: `setText` is programmatic and silent.
    - The check is therefore called directly. The field's `change` fan-out is not part of C21, which starts at `showError` → `Tooltip.attach` → `Tooltip.detach`.
    - `Event.fireEvent(field, "input")` would reach `onInput`, but calling `Event` against another component is the bypass ARCHITECTURE.md forbids inside the library, and the panel keeps to the same public surface a consumer has.
    - The `type` driver was rejected for three reasons. It gets one target per run. It focuses its element and deletes what it typed after the phase, and that deletion runs the check again. And it cannot wait for the tooltip, because the hover and the keystroke would sit in two phases with no shared state.

[^one-keystroke]: Typing on every unit was tried in the probe and does not work as a readout. Before the fix, each keystroke calls `Tooltip.hide()`. Each `hide()` cancels the previous fade and starts a new one (`Tooltip.ts:360-375`). Its `onComplete` never runs, so the element stays in the DOM at opacity 0, and the geometry label would read a rectangle either way. One keystroke lets the 100 ms fade finish and remove the element. A time gate ("type at unit 60") was also rejected: at 144 Hz, 60 frames is under 500 ms, so the keystroke would land during the hover delay. The on-screen check keeps the order the check was specified in, whatever the frame rate.

[^order-unit-zero]: If the second field's `showError` ran after the `mouseover`, the hover delay would already be running when the second decorator re-attaches. Before the fix, that re-attach would cancel the pending show, so the tooltip would never appear. That is C21's other half, and not the sequence this check was specified to show.

[^geometry-readout]: The alternatives are seam or work counters. The difference in sink calls between the two outcomes (one fade and one `removeElement`) is small, and it mixes with the second field's own writes. A per-class method counter on a static method records a receiver class of `Function`. The geometry label reads the thing the check is about, a tooltip on screen, without needing any analysis. The selector relies on the library's class naming, which `.SplitGutter`, `.TabButton` and `.TreeRow` lookups in this app already rely on. The probe found the element's classes to be `ts-ui-component Tooltip`.

[^living-docs]: `00-post-campaign-agenda.md` calls itself the running order ("this file is what comes next"). Its settled items are struck through and marked in place (items 3 and 4 of phase 2), so the phase-1 bullet follows the same convention. `packages/qa/README.md` describes the app as it stands. `00-baseline.md`, `97-`/`98-`/`99-*.md` and the slice reports are dated evidence. The historical "Why first. Every number the campaign has is from Loom" paragraph of the agenda also stays, because it explains a decision rather than describing the present.

[^buckets]: The commit skill allows one code commit per functionality, and the C21 target and the demo comment are two unrelated functionalities. The three documentation corrections are also unrelated to one another, so each gets its own commit and can be reverted alone. Edits to research documents are housekeeping that fits no other bucket, so they go in the one extra bookkeeping commit with the implementation notes. `2cd30e43` and `2a70812c` did the same.

[^test-timers]: Mounting runs `Body.init`, which waits on real frames and timers for its font deadline (`c8cf1c0f`), so the test mounts under real timers and switches afterwards. The probe did exactly that. `vi.isFakeTimers()` guards the `afterEach`, because case 1 never installs fake timers.

[^case-5]: `vi.spyOn(Tooltip, 'detach')` replaces the static the library calls itself: `attach` calls `Tooltip.detach(component)` by name. `vi.restoreAllMocks()` in `afterEach` restores it. The spy's body is `const detach = Tooltip.detach.bind(Tooltip);` taken before spying, then `detach(component); Tooltip.hide();`. This reproduces the unconditional hide that `detach` ended with before C21's fix, without reaching any private member.

[^probe]: The throwaway probe printed one character per 16 ms unit, `1` while `.Tooltip` was connected. With the real `detach` it printed thirty-one `0`s and then `1`s to the end. With the pre-fix spy it printed thirty-one `0`s, nine `1`s, and then `0`s to the end.

[^pending-half]: Typing during the hover delay would exercise the pending half in the engine as well. It would also change what the check shows before the fix, from "the tooltip vanishes" to "the tooltip never appears", and it was not the sequence the check was specified to show.

[^docs-api]: If either is run anyway, the bar is "no new warnings". `master` already emits 14 (`00-post-campaign-agenda.md:185-186`), so a zero-warning bar would fail on arrival.

## Implementation Notes

**The in-engine check is pending a user run.** Expected Behaviour case 6 opens a full-screen window, so it was not run. It is owed to the user: `packages/qa/runqa.sh c21 main 'panel=form-flat&drive=call:120&geom=1'` should give `phases[0].geometry.tooltip` `null` for roughly the first 30 units, then one unchanging rectangle to the last unit. Before C21's fix the rectangle would go `null` about 100 ms after the keystroke. Everything offline passed: `npm run build:lib`; `npm -w packages/qa run typecheck` 0 errors; `npm -w packages/qa run test` all green (249 tests, the three new ones included, and the unchanged `JSDOM_GAPS` cases). Step 2's run failed exactly the second and third new tests, on `call is not a function`, while the first passed. Every grep in *Verification* came out as the plan states. The worktree has no `node_modules`, and none was linked: Node's resolution walks up to the main tree's, which a link would name too. So, as `checkbox-action-activation` recorded, the `packages/qa` typecheck reads the main tree's `.d.ts`, while its tests resolve this checkout's build through the Vite alias.

**Reconciled with the phases before this one.** The plan's line numbers and some "before" strings predate `checkbox-action-activation` and `test-suite-health`. Every anchor was found by its text, and their changes were kept:

- **`builders/form.ts`** had gained an `update` `CallTarget` and `countActions`. Step 1's grep found no `call:`, and `update` is a driver of its own name, so `call` was free. The geometry line the plan puts at 473 was at 556 and changed as written.
- **`form-flat.ts`'s description** now ends with a C40 clause after C23's. C21's clause went between the two, so C40's clause is untouched. It says `under drive=call` rather than the plan's `under call`, to match C40's `under drive=update` beside it.
- **The README's `form-flat` row.** The drivers cell now ends with `update (…)`, so `call (…)` follows that. Step 5b's anchor, "a slider needs `n` ≥ 8.", had become "a slider, and so `update`, needs `n` ≥ 8."; the `call` clause was appended to that sentence, before C40's `work=1` sentence. Steps 5c–5e, 12 and 14 matched as written. The C34 and C40 sentences are unchanged.
- **The status pass** keeps both plans' entries; the two new ones went in at the plan's text anchors, dated 2026-09-21.
- **The agenda** needed only step 16's two edits. Its 2026-09-21 section already lists the decorator fix and both gaps that plan left open, so nothing was appended there.

**The C21 tests are in their own file, `packages/qa/tests/formCallTarget.test.ts`, not appended to `mount.test.ts`.** The plan put them in a `describe` at the end of `mount.test.ts`, and held that scoping the 2D-context stub to that `describe` kept the file's `JSDOM_GAPS` cases throwing. The audit found that false. The library caches the first 2D context it is given for font metrics in a module-level variable (`core/DOM.ts:12`, `:2425-2426`) that nothing resets. So once the new tests have mounted a form, every later form or table mount in that file succeeds. The `JSDOM_GAPS` cases for `table-rows`, `form-flat` and `form-nested` then fail. They passed only because the new `describe` ran last, and a shuffled run (`--sequence.shuffle`, seeds 8–12) failed them. vitest gives each test file its own modules, so the tests moved to a file of their own. That file copies `mount.test.ts`'s `tools` override and its two waits, which is how `panels.test.ts` also mounts panels. Its tests, `describe` name, constants and helpers are the ones the plan specifies, unchanged. `mount.test.ts` is not touched. Shuffled runs of both files now pass for every seed tried, and the new file still fails its second and third tests on `call is not a function` against the start point's `form.ts`.

**Two smaller departures.** The target's JSDoc was re-wrapped, and the test's `detach` spy body is a named function, `detachThenHide`, rather than an inline closure. Neither changes behaviour.
