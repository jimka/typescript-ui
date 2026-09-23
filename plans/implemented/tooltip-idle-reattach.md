---
depends-on: [w3-0-bounding-sweep]
touches-shared:
  - packages/lib/src/typescript/lib/overlay/Tooltip.ts
  - packages/lib/docs/components/Tooltip.md
  - packages/lib/docs/reference/changelog/next.md
  - packages/qa/README.md
---

# Tooltip Idle Re-attach — Implementation Plan

## Overview

`Tooltip.attach` and `Tooltip.attachCovering` rebuild a component's tooltip attachment on every call, even when the call repeats the attachment the component already has. Both go through the private `_attachWith` ([`overlay/Tooltip.ts:435`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L435)), which starts with `Tooltip.detach(component)` (`:436`). That detach removes four `Event` registrations, cancels a hover delay the component armed and hides a tooltip on screen for it; `_attachWith` then builds four new closures and registers them again. `FieldDecorator.showError` ([`validation/FieldDecorator.ts:72`](packages/lib/src/typescript/lib/validation/FieldDecorator.ts#L72)) triggers that whole rebuild on every keystroke while a field stays invalid, with the same message each time.

This plan makes `_attachWith` return at once when the call would rebuild the current attachment unchanged — same text, same colours, same mode — keeping its listeners and all tooltip state. It is G19 `tooltip-hover-path` of the render-performance campaign ([`99-synthesis.md:1840`](plans/research/render-review-2026-09-15/99-synthesis.md#L1840)). Two earlier fixes closed G19's other halves: C15 (`Animation.play` removing its own listeners) and C21 (`detach` acting only on the tooltip its own component owns — on screen for it, or waiting out the hover delay it armed). W3.0, the bounding sweep run before wave 3, measured this last half with the `g19.tooltip-idle` **ablation** — a runtime patch in the QA app that prototypes the fix — and read **plan it** on work alone ([`96-w3-0-bounding-sweep.md:243-254`](plans/research/render-review-2026-09-15/96-w3-0-bounding-sweep.md#L243)). "Sink calls" are DOM writes through the library's DOM seam:

| W3.0 cell | Reading with the `g19.tooltip-idle` ablation |
|---|---|
| `ffy` — `form-flat`, typing into a decorated field | sink calls per keystroke 2.74 → 1.02 (−63%), frame time flat, geometry `=` |
| `fny` — `form-nested`, the same typing | the same 0.86 skips per keystroke, but no seam counter moves: sink 1.01 → 1.01 |
| `clh`, `cdh` — chart hover | `unreached`: charts call `Tooltip.show` / `hide` directly and never attach |

The library change is one early return and one private helper in `overlay/Tooltip.ts`, plus JSDoc. The plan also adds one test file, rewrites one keystroke of the QA app's C21 witness so it still reaches C21's code, and updates the `Tooltip` guide, the changelog and the QA README. Library paths in link text below are relative to `packages/lib/src/typescript/lib/`.

---

## Architecture Decisions

### The early return lives in `_attachWith`, ahead of its `detach`

`_attachWith` reads the component's current attachment from `Tooltip.attachments` and returns before `Tooltip.detach(component)` when the call would rebuild it unchanged. Every caller of `attach` and `attachCovering` gets the saving; no caller changes. This is the library's same-value guard: a setter may return early when the incoming value equals the one it already holds, skipping its side effects with it ([ARCHITECTURE.md:158](ARCHITECTURE.md#L158)). `SplitGutter.updateTooltip` already applies it to this exact call at the caller ([`SplitGutter.ts:463-465`](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L463)), and `Tooltip.show` skips its entrance fade on a repeat call ([`Tooltip.ts:226-231`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L226), `:324-330`).[^precedent]

### What counts as identical

A call matches the current attachment only when all three of these match; any difference replaces the attachment:

- **Text**, compared with `===`.
- **Mode**: `attach`'s own-element listeners or `attachCovering`'s subtree listeners (`covering`, `===`).
- **Colours**, compared by value on the three `TooltipColors` keys `_applyColors` reads (`background`, `color`, `border`). A key that is left out matches a key set to `undefined`, and a missing colours object matches `{}`.

| Current attachment | New call | Result | Why |
|---|---|---|---|
| `attach(c, 'Save')` | `attach(c, 'Save')` | kept | nothing differs |
| `attach(c, 'Save', { background: 'red', border: 'black' })` | `attach(c, 'Save', { border: 'black', background: 'red' })`, a new object | kept | the colours are equal by value; key order and object identity do not count |
| `attach(c, 'Save')` | `attach(c, 'Save', {})` | kept | every colour is the theme default either way |
| `attach(c, 'Save', { background: 'red' })` | `attach(c, 'Save', { background: 'blue' })` | replaced | a colour differs |
| `attach(c, 'Save')` | `attachCovering(c, 'Save')` | replaced | the mode differs, so the listeners must be registered differently |
| `attach(c, 'Save')` | `attach(c, 'Save as…')` | replaced | the text differs |
| none (never attached, or detached since) | `attach(c, 'Save')` | attached | nothing to keep |

Beyond these three, the attachment holds only the component, which is its lookup key, and the last pointer position, which a kept attachment should keep.[^identical]

### A kept attachment keeps the component's hover delay and its tooltip on screen

The early return touches no shared tooltip state, so C21's ownership rules hold unchanged for every other component. For the calling component itself, the visible behaviour changes on purpose:[^visible-change]

| The component's tooltip | It re-attaches | Today | After |
|---|---|---|---|
| on screen | the same text and colours | fades out, and stays hidden until the pointer leaves and comes back | stays up |
| hover delay running | the same text and colours | the delay is cancelled, so the tooltip never appears under a still pointer | the delay runs out and the tooltip appears |
| on screen | a new text or colour | fades out | fades out (unchanged) |
| another component's, on screen or pending | anything | left alone (C21) | left alone |

In a form this means typing into a field whose error stays the same no longer makes the error tooltip over it vanish.

### How the fix follows the ablation, and where it differs

The `g19.tooltip-idle` ablation ([`packages/qa/src/harness/ablations.ts:1587-1634`](packages/qa/src/harness/ablations.ts#L1587)) proved the saving with identical geometry. The shipped fix makes the same decision at the same point, and differs where a runtime patch could take shortcuts:

| Ablation | Shipped fix | Why |
|---|---|---|
| Skips the whole `_attachWith` call before its `detach` | Returns before `_attachWith`'s `detach` | the same point: the `detach` is what cancels and hides |
| Keeps its own `WeakMap` from component to the last call's arguments, and wraps `detach` to forget an entry | Reads `Tooltip.attachments`, the map `detach` and the destroy hook already clear | no second registry to keep in step; nothing new to hold in memory |
| Compares `JSON.stringify(colors ?? null)` | Compares the three colour keys by value | `JSON.stringify` counts key order and tells `{}` from no colours, and allocates a string per call; `_applyColors` reads exactly these three keys |
| Left `hide()` alone | Leaves `hide()` alone | an idle `hide` already returns before any fade ([`w3-0-bounding-sweep.md`](plans/implemented/w3-0-bounding-sweep.md), *Implementation Notes*) |
| No tests, no docs | Tests for the ownership cases, the colour rule and the edge cases; JSDoc, guide and changelog | a shipped behaviour change needs its contract written down |

### `Button` needs no change of its own

`Button.setText` with an unchanged title already returns before `_rebuildTooltip` ([`Button.ts:1177-1181`](packages/lib/src/typescript/lib/component/button/Button.ts#L1177)), so it never reaches `attach`. `Button.setDescription` has no such guard and does re-attach identical text ([`Button.ts:1389-1410`](packages/lib/src/typescript/lib/component/button/Button.ts#L1389)); the `Tooltip` check covers it, and case 19 pins that.[^button]

### The C21 witness's keystroke becomes a Backspace

The QA app's C21 witness — `form-flat`'s `call` target — shows the first decorated field's error tooltip, then types one character into a second decorated field whose error stays the same. After this change that keystroke re-attaches an identical tooltip, which returns before `detach`. The witness would no longer reach the code C21 fixed, and `formCallTarget.test.ts`'s pre-fix control — the case that reproduces the old `detach` and expects the tooltip gone — would fail. The keystroke becomes one Backspace that takes the second field back within its limit. Its check then calls `clearError`, which calls `Tooltip.detach` on the second decorator — C21's exact path.[^witness]

### The `g19.tooltip-idle` ablation stays registered

The ablation, its test and its README row stay. `sweeps/w3-0.sh` names it, and retiring wave 3's ablations is one QA change for the whole wave, as `motion-transform-inline` decided for its own. The README row gains a note that the arm removes nothing more on a library carrying this change.[^ablation-stays]

### The two open audit advisories stay open

`00-post-campaign-agenda.md` lists two advisories on this code (*Found by the post-merge audit*, `:275`). Neither is fixed here.[^advisories]

- **The decorator's error arms only when the pointer enters from outside.** Unchanged: a first `showError` under a resting pointer still arms nothing. This plan only stops a later, identical `showError` from cancelling a delay that did arm.
- **A tooltip shown through `Tooltip.show` is not hidden on leaving an `attach` host.** No interaction: a kept attachment keeps its leave listener, which applies the same ownership test.

---

## Public API

No signature changes and no new exports. `Tooltip.attach`'s documented behaviour gains the identical-call rule (step 9).

One private static is added to `Tooltip`:

```ts
private static _sameAttachment(att: TooltipAttachment, text: string, colors: TooltipColors | undefined, covering: boolean): boolean;
```

---

## Internal Structure

Both snippets are in `packages/lib/src/typescript/lib/overlay/Tooltip.ts`.

**`_sameAttachment`**, placed after `_cancelPendingShow` (`:555-567`) and before `_owns`'s JSDoc (`:569`):

```ts
/**
 * Whether `att` is the attachment `_attachWith` would build from these
 * arguments: the same text, the same mode and the same three colors.
 * Colors are compared by value, key by key, so a fresh object with equal
 * values matches — `FieldDecorator.showError` passes a new one on every
 * call — and a color left out matches one set to `undefined`, since
 * `_applyColors` reads both as the theme default. The three keys are the
 * ones `_applyColors` reads; a key added to `TooltipColors` must be added
 * to both.
 *
 * @param att - The component's current attachment.
 * @param text - The text the new call passes.
 * @param colors - The color overrides the new call passes.
 * @param covering - Whether the new call is `attachCovering`'s.
 * @returns `true` when the new call would rebuild `att` unchanged.
 */
private static _sameAttachment(att: TooltipAttachment, text: string, colors: TooltipColors | undefined, covering: boolean): boolean {
    return att.text === text
        && att.covering === covering
        && att.colors?.background === colors?.background
        && att.colors?.color === colors?.color
        && att.colors?.border === colors?.border;
}
```

**`_attachWith`** (`:435`): its first statement, `Tooltip.detach(component);` (`:436`), gets this block in front of it. Everything from `Tooltip.detach(component);` on is unchanged, and `detach` must still be called by the class name.[^by-name]

```ts
private static _attachWith(component: Component, text: string, colors: TooltipColors | undefined, covering: boolean): void {
    const current = Tooltip.attachments.get(component.getId());

    // An identical call keeps the attachment it would rebuild. Replacing
    // it detaches first, which cancels the hover delay this component armed
    // and hides the tooltip on screen for it.
    if (current !== undefined && Tooltip._sameAttachment(current, text, colors, covering)) {
        return;
    }

    Tooltip.detach(component);

    // …unchanged from here to the end of the method.
}
```

---

## Ordered Implementation Steps

Line numbers are at the plan's base (`feature/w3-0-results` at `11ad15eb`, whose `packages/lib` equals `master` `83cfb0d7`). Run library commands from `packages/lib` and everything else from the repository root unless a step says otherwise. **Never run `packages/qa/runqa.sh`, `packages/qa/sweeps/*.sh` in a running mode, MiniBrowser or the Tauri `qa-host`**: each opens a full-screen window.

1. **Record the base.** Run `git rev-parse HEAD` in the implementation worktree before any edit and write the SHA into `## Implementation Notes` as `BASE_SHA`; the in-engine A/B builds its base arm from it. *Check:* `grep -n "Tooltip.detach(component);" packages/lib/src/typescript/lib/overlay/Tooltip.ts` prints line 436.

### Tooling commit — the C21 witness reaches `detach`

2. **`packages/qa/src/builders/form.ts`.**
   - Delete `KEYSTROKE` and its JSDoc (`:65-66`).
   - In `tooltipOwnershipTarget` (`:536`), replace `enterText(other, other.field.getText() + KEYSTROKE);` with the two lines below.

     ```ts
     // One Backspace: 21 characters become 20, back within the limit.
     enterText(other, other.field.getText().slice(0, -1));
     ```

   - Replace the JSDoc sentence "On the first later unit that finds the tooltip on screen, one character is typed into the second field, whose error re-attaches its own tooltip; nothing is typed after that." (`:506-508`) with: "On the first later unit that finds the tooltip on screen, one character is deleted from the second field. That takes it back within its limit, so its check clears its error and detaches its tooltip — the `detach` C21 fixed. A keystroke that left its error as it was would re-attach an identical tooltip, which `Tooltip` keeps without detaching, so it would not reach C21's code. Nothing is typed after that."

   *Check:* `grep -rn "KEYSTROKE" packages/qa/src` — no match.
3. **`packages/qa/src/panels/form-flat.ts`** (`:4`). In `description`, replace "after the second decorated text field is retyped" with "after a keystroke clears the second decorated text field's error".
4. **`packages/qa/tests/formCallTarget.test.ts`.**
   - Header (`:3-5`): replace "and once its error tooltip is up types one character into the second." with "and once its error tooltip is up deletes one character from the second, which clears its error."
   - Both `'exactly one keystroke'` expectations (`:148`, `:167`) become `.toEqual([OVER.slice(0, -1), OVER])` — `decoratedTexts()` sorts, and the 20-character text sorts first.
   - `:147`: the message becomes `'the tooltip survives the second field\'s cleared error'`.
   - `:157`: "`attach` calls `Tooltip.detach` by name" becomes "`clearError` calls `Tooltip.detach` by name".
   - `:168`: the message becomes `'hidden by the second field\'s detach'`.
5. **Check on the unchanged library.** `npm run build:lib && npm -w packages/qa run test` — all green. The new witness passes before the library change too.
6. **Commit (tooling).** Stage the three QA files. Suggested title: *Make the C21 witness's keystroke clear the second field's error*.

### Code commit — the identical re-attach

7. **Write the tests first.** Create `packages/lib/tests/overlay/Tooltip.identicalAttach.test.ts` with the fixture below and one `it` per row of *Expected Behaviour*, numbered and named as there. Put cases 1–12 in `describe('Tooltip — an identical attach keeps the attachment')`, 13–18 in `describe('FieldDecorator — an unchanged error under a pointer')` and 19 in `describe('Button — an unchanged description')`.[^new-file]
   - **File header comment.** Say three things. The file pins that an identical `attach` keeps the attachment, its hover delay and its tooltip on screen. Cases 13–18 dispatch real events, as `FieldDecorator.pointerTooltip.test.ts` does. And every component a case creates is disposed in `afterEach`, because `Event`'s installed-listener bookkeeping outlives `DOM.reset()`: one component left registered makes every later real-event case's dispatch vanish.
   - **Constants**, each with a comment: `HOVER_DELAY_MS = 500` (mirrors `attach`'s `setTimeout` delay), `FADE_SETTLE_MS = 500` (past the 100 ms fade and its fallback timer), `HOST_WIDTH = 200` and `HOST_HEIGHT = 24` (the sizes `FieldDecorator.pointerTooltip.test.ts` uses, which give a decorated field a hit area), `CURSOR_PX = 10` (any in-viewport pointer position), `ERROR = 'Too long'`.
   - **State:** `let root: Component;`, `let strays: Component[] = [];`, `let showSpy: MockInstance<typeof Tooltip.show>;`.
   - **Helpers**, each with a one-line JSDoc:
     - `host(y)`: a `new Component({})` added to `root`, placed at `y`, sized `HOST_WIDTH` × `HOST_HEIGHT`, then `getElement(true)`.
     - `mountDecorated(field, y = 0)`, `hitAt(x, y)`, `hitCentre(component)`, `enter(target)` and `shownTexts()`: copied from `FieldDecorator.pointerTooltip.test.ts` (functions at `:74`, `:95`, `:105`, `:161` and `:190`), with `enter` inlining that file's `pointer('mouseover', …)` (`:144`) and its `outside()` (`:152`).
     - `hoverOver(component)` and `showFor(component)`: copied from `Tooltip.test.ts` (`:323-344`).
     - `record(component)`: returns `(Tooltip as any).attachments.get(component.getId())`.
   - **`beforeEach`:** as in `FieldDecorator.pointerTooltip.test.ts:194-202` — `installTestDOM(CONFIG)`, `vi.useFakeTimers()`, a rendered `root`, and `showSpy = vi.spyOn(Tooltip, 'show')`.
   - **`afterEach`:** as in `FieldDecorator.pointerTooltip.test.ts:204-222`, with one addition after `root.dispose()`: dispose every component in `strays`, then empty it.

   `CONFIG` is the block from `Tooltip.test.ts:10-16`. Imports: `describe`, `it`, `expect`, `beforeEach`, `afterEach`, `vi` and `type MockInstance` from `vitest`; `Component`, `DOM` and `type Handle`, `Event`, `Tooltip`, `TextField`, `Button` (the callable) and `FieldDecorator` through `~/…`; `installTestDOM`, `makeEvent` and the font metrics from `../dom/`.
8. **Check the tests fail for the right reason.** `npx vitest run tests/overlay/Tooltip.identicalAttach.test.ts`. Expected failures, and no others: cases 1, 2, 5, 7, 9, 11, 13, 14, 16 and 19. Cases 3, 4, 6, 8, 10, 12, 15, 17 and 18 pass.
9. **`Tooltip.ts`.**
   - Add `_sameAttachment` after `_cancelPendingShow`, as in *Internal Structure*.
   - Add the early return at the top of `_attachWith`, as in *Internal Structure*.
   - `_attachWith`'s JSDoc (`:425-434`): replace its first sentence, "The body `attach` and `attachCovering` share: replaces any attachment `component` already has, builds its four hover listeners, registers them and records the attachment.", with: "The body `attach` and `attachCovering` share. Returns at once when `component`'s current attachment already has this text, these colors and this mode, keeping its listeners, its running hover delay and its tooltip on screen. Otherwise replaces any attachment `component` already has, builds its four hover listeners, registers them and records the attachment."
   - `attach`'s JSDoc (`:397`): replace "Calling `attach` on a component that already has an attachment replaces it." with: "Calling `attach` on a component that already has an attachment replaces it, unless the call would rebuild that attachment unchanged — the same text and the same colors, compared by value. Such a call changes nothing: a hover delay the component armed keeps running, and a tooltip on screen for it stays up. A replacement cancels the component's own pending show and hides its own tooltip first."
   - `attachCovering`'s JSDoc (`:413`): "Replaced, detached and torn down like an `attach` attachment." becomes "Kept when unchanged, and replaced, detached and torn down like an `attach` attachment."
   - The `teardownWired` comment (`:96-100`) becomes:

     ```ts
     // Components with a destroy hook already registered to auto-detach on
     // teardown. `attach` may be called many times over a component's life
     // (e.g. Button re-deriving its tooltip text on every setTitle), and each
     // call that changes the attachment replaces it through `_attachWith`'s
     // `detach` — this guard keeps that from also registering a redundant
     // hook per call.
     ```

   *Check:* `grep -n "_sameAttachment" packages/lib/src/typescript/lib/overlay/Tooltip.ts` — two lines, the definition and the call. `grep -n "Tooltip.detach(component);" packages/lib/src/typescript/lib/overlay/Tooltip.ts` — one line, directly after the early return's closing brace and a blank line.
10. **Run the tests again.** Step 8's command passes in full. Then, from the repository root: `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build:lib && npm -w packages/qa run test`.
11. **Commit (code).** Stage `Tooltip.ts` and the new test file. Suggested title: *Keep a tooltip attachment that an identical attach would rebuild*.

### Documentation commit

12. **`packages/lib/docs/components/Tooltip.md`.** In `## Notes`, after the bullet that begins "Leaving a component hides the tooltip only when it is that component's" (`:58`), add:

    > - Calling `attach()` again with the same text and colors changes nothing: a hover delay the component armed keeps running, and its tooltip on screen stays up. Colors are compared by value, so an equal object passed afresh matches. A call that changes the text or a color replaces the attachment, which cancels that component's pending show or hides its tooltip.

    The page and `TooltipColors` spell it "color"; keep that spelling in steps 12 and 13.

13. **`packages/lib/docs/reference/changelog/next.md`** (shared: edit it last and keep the diff to this subsection). Under `## Changed`, after `### Layouts` and its one bullet (`:185-189`) and before `## Added`, add a subsection with a blank line on each side:

    ```
    ### Overlay

    - **Re-attaching a tooltip with the same text and colors no longer
      rebuilds it.** `Tooltip.attach()` replaced a component's attachment on
      every call, even an identical one, so re-running the same
      `FieldDecorator.showError` on every keystroke, setting a `Button`'s
      description to the one it already had, or rebinding a list row to an
      item with the same tooltip removed and re-registered four listeners
      each time — and dismissed that component's own tooltip if it was on
      screen, or cancelled the hover delay it was waiting out. An identical
      call now changes nothing: the tooltip stays up, or appears when its
      delay runs out. Colors are compared by value. A call that changes the
      text or a color still replaces the attachment as before. Code that
      relied on an identical re-attach to dismiss its own tooltip calls
      `Tooltip.detach(component)` first.
    ```

14. **`packages/qa/README.md`.**
    - *C21's witness hovers the field* (`:372-381`): replace "it types one character into the second field, whose error re-attaches its own tooltip." with "it deletes one character from the second field, which takes it back within its limit, so its check clears its error and detaches its tooltip — the `detach` C21 fixed. (A keystroke that left the second field's error as it was would re-attach an identical tooltip, which `Tooltip` keeps without detaching since `tooltip-idle-reattach`, so it would not reach C21's code.)" Replace "The sequence leaves both fields in error and the tooltip up" with "The sequence leaves the first field in error with its tooltip up, and the second within its limit".
    - The `form-flat` row (`:334`), *Reproduces* cell: replace "although the second field is retyped on the first of them" with "although a keystroke on the first of them clears the second field's error".
    - The ablation table's `g19.tooltip-idle` row (`:473`): append "On a library with `tooltip-idle-reattach`, `Tooltip` itself keeps an identical attachment, so the arm removes nothing more there: read it only against an earlier build."
15. **Docs build.** `npm run docs:api` — no warning beyond the 14 `master` already emits. `npm run docs:llms:check` — passes.
16. **Commit (docs).** Stage the three files. Suggested title: *Document the kept identical tooltip attachment*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/overlay/Tooltip.ts` |
| Create | `packages/lib/tests/overlay/Tooltip.identicalAttach.test.ts` |
| Modify | `packages/qa/src/builders/form.ts` |
| Modify | `packages/qa/src/panels/form-flat.ts` |
| Modify | `packages/qa/tests/formCallTarget.test.ts` |
| Modify | `packages/lib/docs/components/Tooltip.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/qa/README.md` |

---

## Expected Behaviour

Every case derives from the contract: a call that would rebuild the current attachment unchanged changes nothing; any other call replaces it as before. "Visible for A" is `showFor(a)`; "A's delay running" is `hoverOver(a)`. "Wait" advances fake timers `HOVER_DELAY_MS`. "Shown" is `shownTexts()`. "Anchor" is `(Tooltip as any).activeElement`, "dismissing" `(Tooltip as any).dismissing`, "the record" `record(component)`. The *On base* column was run against a runtime prototype and the base; see *Addendum: Offline Evidence*.

**`Tooltip.identicalAttach.test.ts`** — unit. Cases 1–12 drive the stored closures, as `Tooltip.test.ts`'s ownership describe does; 13–18 dispatch real events through `Event`.

| # | Setup | Action | Expect | On base |
|---|---|---|---|---|
| 1 | `a = host(0)`, `b = host(2 * HOST_HEIGHT)`; `attach(a, 'A')`, `attach(b, 'B')`; visible for A | `attach(a, 'A')` | not dismissing; anchor = A's element; `watching` `true` | fails |
| 2 | as 1; A's delay running | `attach(a, 'A')`, then wait | before the wait: `showTimer` not `null`, `pendingId` = A's id. After: shown `['A']`, anchor = A's element | fails |
| 3 | as 1; visible for A | `attach(b, 'B')` | not dismissing; anchor = A's element | passes |
| 4 | as 1; A's delay running | `attach(b, 'B')`, then wait | `pendingId` = A's id before the wait; shown `['A']` after | passes |
| 5 | `a = host(0)`; `attach(a, 'A', { background: 'red', border: 'black' })`; keep the record; visible for A | `attach(a, 'A', { border: 'black', background: 'red' })` | the record is the same object; not dismissing | fails |
| 6 | `attach(a, 'A', { background: 'red' })`; keep the record; visible for A | `attach(a, 'A', { background: 'blue' })` | a new record; dismissing; anchor `null` | passes |
| 7 | `attach(a, 'A')`; keep the record | `attach(a, 'A', {})` | the same record | fails |
| 8 | `attach(a, 'A')`; keep the record | `attachCovering(a, 'A')` | a new record, whose `covering` is `true` | passes |
| 9 | `attach(a, 'A')`; `b = host(2 * HOST_HEIGHT)`, `attachCovering(b, 'B')`; spy on `Event.addListener`, `removeListener`, `addSubtreeListener`, `removeSubtreeListener` | `attach(a, 'A')`; `attachCovering(b, 'B')` | every spy: 0 calls | fails (4 and 4 each) |
| 10 | `attach(a, 'A')`; keep the record; `Tooltip.detach(a)`; spy on `Event.addListener` | `attach(a, 'A')` | a new record; `Event.addListener` called 4 times | passes |
| 11 | `c = new Component({})`, never rendered, pushed to `strays`; `attach(c, 'U')`; keep the record | `attach(c, 'U')` | the same record; `(Tooltip as any).instance` `null` | fails |
| 12 | `attach(a, 'A')` three times | read `(a as any)._destroyCleanups.length`; `a.dispose()` | 2 before the dispose — `Tooltip`'s hook plus `Component`'s own, as `Tooltip.test.ts:306-310` explains; `attachments.has(a.getId())` `false` after | passes |
| 13 | `field = new TextField()`, `d = mountDecorated(field)`, `d.showError(ERROR)`; assert `hitCentre(d)` is the field's element; `enter` it; wait | `d.showError(ERROR)` | not dismissing; anchor = `d`'s element; shown `[ERROR]` | fails |
| 14 | as 13, but advance only half the delay | `d.showError(ERROR)`, then advance the other half | before: `pendingId` = `d`'s id. After: shown `[ERROR]` | fails |
| 15 | as 13 | `d.showError('Too short')` | dismissing; anchor `null` | passes |
| 16 | `d = mountDecorated(new TextField())`, `d.showError(ERROR)`; spy on `DOM.sink.addListener` and `DOM.sink.removeListener` | `d.showError(ERROR)` ten times | both spies: 0 calls | fails (40 each) |
| 17 | `field = new TextField()`, `first = mountDecorated(field)`, `second = mountDecorated(new TextField(), 2 * HOST_HEIGHT)`; `first.showError(ERROR)`, `second.showError('Other')`; `enter` the hit at `first`'s centre (assert: `field`'s element); wait | `second.showError('Other')` | not dismissing; anchor = `first`'s element | passes |
| 18 | as 17, without the wait | `second.showError('Other')`, then wait | `pendingId` = `first`'s id before the wait; shown `[ERROR]` after | passes |
| 19 | `b = new Button({ text: 'Save' })` added to `root`, rendered; `b.setDescription('Writes the file')`; keep the record | `b.setDescription('Writes the file')` | the same record | fails |

Cases 1, 2, 13 and 14 are the calling component's own tooltip. Cases 3, 4, 17 and 18 are C21's rules reached through an identical call. Cases 6, 8 and 15 pin that a real change still replaces. Every existing case in `Tooltip.test.ts` and `FieldDecorator.pointerTooltip.test.ts` passes unchanged.

**`packages/qa/tests/formCallTarget.test.ts`** — unit, jsdom, against the built library. Both existing witness cases pass on the base library and with this change:

| Case | Expect |
|---|---|
| `types once, after the hover delay, and the tooltip stays up` | texts `[OVER.slice(0, -1), OVER]`; the tooltip's element is connected |
| `reads null once the keystroke hides the tooltip, as before C21's fix` | texts `[OVER.slice(0, -1), OVER]`; no tooltip element |

`tests/ablations.test.ts`' A15 (`g19.tooltip-idle`) passes unchanged.

**Manual — user-run only.** Each opens a browser window; the implementer must not run them, and records them in `## Implementation Notes` as owed to the user. All three are in the library demo app's *Binding* tab, whose name field shows "Name must be at most 50 characters." past 50 characters.

- **M1.** Type 51 characters into the name field, so the error shows. Move the pointer off the field and back on, and wait for the error tooltip. Type one more character: the tooltip stays up. Before this change it faded.
- **M2.** Move the pointer off and back on, and type a character within half a second: the tooltip appears about half a second after the pointer came to rest. Before, it did not appear until the pointer left and came back.
- **M3.** With the tooltip up, select all and type one character: the message becomes "Name must be at least 2 characters." and the tooltip fades, as before.

---

## Verification

**Implementer:**

- `npx vitest run tests/overlay/Tooltip.identicalAttach.test.ts` (in `packages/lib`) — all 19 green; step 8 recorded the expected red cases.
- `npm run typecheck` — 0 errors. `npm run lint` — no new findings. `npm test` — all green.
- `npm run build:lib && npm -w packages/qa run test` — all green, `formCallTarget.test.ts` and `ablations.test.ts` included.
- `npm run docs:api` — no warning beyond `master`'s 14. The bar is "no new warning", not zero. `npm run docs:llms:check` — passes.
- The grep checks in steps 2 and 9.
- **Never run `packages/qa/runqa.sh`, `packages/qa/sweeps/*.sh`, MiniBrowser or the Tauri host.** M1–M3 are owed to the user.

**Orchestrator — the in-engine A/B, with the user's go-ahead.** Same session, MiniBrowser, `work=1&seam=1&geom=1` on every run. The two typing cells W3.0 ran for G19 are each run base, fix, base, fix, base. The two chart cells and the C21 witness are each run base, fix, base.[^ab-shape]

1. Build the base arm — `runqa.sh`'s `wt` arm — from `BASE_SHA` (step 1), per [`packages/qa/README.md:87-99`](packages/qa/README.md#L87):

   ```sh
   cd /home/jika/typescript/typescript-ui
   git worktree add .worktrees/_g19-base <BASE_SHA> --detach
   ln -sfn "$PWD/node_modules" .worktrees/_g19-base/node_modules
   (cd .worktrees/_g19-base/packages/lib && npm run build:lib)
   export QA_WT_LIB="$PWD/.worktrees/_g19-base/packages/lib"
   ```

2. Build the fix arm — the `main` arm — with `npm run build:lib` in the implementation worktree. Both arms then serve the implementation's QA page, with its Backspace witness.
3. From the implementation worktree's root, run in this order. Stop at the first non-zero exit and re-run that cell whole.

   ```sh
   F='work=1&seam=1&geom=1'
   FFY="panel=form-flat&type=text&drive=type&$F"
   FNY="panel=form-nested&type=text&drive=type&$F"
   CLH="panel=chart-line&drive=hover&$F"
   CDH="panel=chart-dashboard&n=50&drive=hover&$F"
   C21="panel=form-flat&drive=call:120&$F"
   packages/qa/runqa.sh g19-ffy-base-a wt   "$FFY"
   packages/qa/runqa.sh g19-ffy-fix-1  main "$FFY"
   packages/qa/runqa.sh g19-ffy-base-b wt   "$FFY"
   packages/qa/runqa.sh g19-ffy-fix-2  main "$FFY"
   packages/qa/runqa.sh g19-ffy-base-c wt   "$FFY"
   packages/qa/runqa.sh g19-fny-base-a wt   "$FNY"
   packages/qa/runqa.sh g19-fny-fix-1  main "$FNY"
   packages/qa/runqa.sh g19-fny-base-b wt   "$FNY"
   packages/qa/runqa.sh g19-fny-fix-2  main "$FNY"
   packages/qa/runqa.sh g19-fny-base-c wt   "$FNY"
   packages/qa/runqa.sh g19-clh-base-a wt   "$CLH"
   packages/qa/runqa.sh g19-clh-fix-1  main "$CLH"
   packages/qa/runqa.sh g19-clh-base-b wt   "$CLH"
   packages/qa/runqa.sh g19-cdh-base-a wt   "$CDH"
   packages/qa/runqa.sh g19-cdh-fix-1  main "$CDH"
   packages/qa/runqa.sh g19-cdh-base-b wt   "$CDH"
   packages/qa/runqa.sh g19-c21-base-a wt   "$C21"
   packages/qa/runqa.sh g19-c21-fix-1  main "$C21"
   packages/qa/runqa.sh g19-c21-base-b wt   "$C21"
   ```

   19 runs, about four to five minutes.
4. Read each cell. The first run listed, `base-a`, is the geometry reference. `qa-ab.py` does not apply: it scores ablation arms.

   ```sh
   for c in ffy fny clh cdh; do python3 packages/qa/bin/qa-table.py packages/qa/results g19-$c- --seam; done
   for r in base-a fix-1 base-b; do python3 -c "import json,glob; r=json.load(open(sorted(glob.glob('packages/qa/results/g19-c21-$r-*.json'))[-1])); t=r['phases'][0]['geometry']['tooltip']; f=next((i for i,x in enumerate(t) if x), None); print('$r', f, f is not None and all(x==t[f] for x in t[f:]))"; done
   ```

5. Score `ffy` and `fny` with W3.0's decision rule ([`w3-0-bounding-sweep.md:114-160`](plans/implemented/w3-0-bounding-sweep.md#L114)), the three `base` runs standing for its plain arms. The bracket is the largest `base` average minus the smallest; Δms is the mean `fix` average minus the mean `base` average; `work` is read on sink calls per unit.

**Expected readings**, per unit. Counts are deterministic, so the `fix` runs must match each other to the hundredth. The `base` column is W3.0's plain reading on `83cfb0d7`; the `base` runs must reproduce it unless a plan that landed since changed that count. Whatever the base, `ffy`'s `fix` is its `base` minus 1.72 on sink calls and minus 1.72 on `getWindow`.[^work]

| Cell | Reading | `base` | `fix` |
|---|---|---|---|
| `ffy` (type ×150) | sink/u | 2.74: `setValue` 1.00, `addListener` 0.87, `removeListener` 0.86, `setRuleStyles` 0.01 | **1.02**: `setValue` 1.00, `setRuleStyles` 0.01, `addListener` 0.01 |
| `ffy` | `seam.source.getWindow` | 1.73 | **0.01** |
| `ffy` | avg ms | 17.76, bracket 0.69 | flat; the ablation read 17.27 |
| `fny` (type ×150) | sink/u; source/u | 1.01; 3.00 | 1.01; 3.00 |
| `clh` (hover ×150) | sink/u | 9.41 (9.39–9.43 across runs) | the same |
| `cdh` (hover ×150) | sink/u | 10.22 | the same |
| `c21` (call ×120) | the one-liner | `<N> True`, N about 28–30 | the same |

- **Geometry.** `=` in every run of `ffy`, `fny`, `clh` and `cdh`, on every label: `header`, `form` and `tooltip` (`null` in every unit), plus `inspector` in `fny`; `chart` in `clh`; `grid`, `chart0`–`chart3` and `bars` in `cdh`. `c21`'s `tooltip` label goes non-`null` when the hover delay runs out, which depends on frame timing, so its `geom` column is not a gate; the one-liner is.
- **Verdict.** `ffy`: `work` `win` (−1.72 per unit, −62.8%), `ms` `flat`. `fny`: flat on every count; its saving is script-side and invisible to the seam counters, as in W3.0. `clh`, `cdh`: counts equal to their `base` runs. A `regress`, a geometry `DIFF`, a `False` or `None` from the `c21` one-liner, or a count off this table stops the merge and returns to this plan.
- **Record.** Append the readings to the `form-flat` row's *Validated* cell in `packages/qa/README.md`, as the W3.0 baseline line there is written, naming both commits and the `g19-*` runs.
- **Clean up.** `git worktree remove .worktrees/_g19-base`.

---

## Documentation Impact

- **JSDoc** (step 9): `attach` (public; its API page regenerates), `attachCovering` (`@internal`), `_attachWith` and `_sameAttachment` (private). No public JSDoc may `{@link}` `attachCovering` or a private member.
- **[`docs/components/Tooltip.md`](packages/lib/docs/components/Tooltip.md#L51)** gains the identical-call bullet in `## Notes` (step 12). The earlier bullet's "Since `attach()` begins by detaching" stays true for every call that changes something.
- **Changelog** — `docs/reference/changelog/next.md`, a new `### Overlay` under `## Changed` (step 13). No migration note: no signature changes, and the one consumer action fits the changelog bullet.
- **QA README** (step 14): the C21 witness paragraph, the `form-flat` row and the `g19.tooltip-idle` row. The orchestrator's *Validated* line follows the A/B.
- No export changes; `llms.txt` is unaffected.

---

## Potential Challenges

- **A failing case leaks listeners into later ones.** `Event` keeps its installed window listeners across `DOM.reset()`. In a draft where case 11 disposed its own component at its end, the case failed on the base before reaching the dispose, and cases 15, 17 and 18 then failed too while case 16 passed. Disposing `strays` in `afterEach` makes step 8's red list exact.
- **`Tooltip.detach` is spied on by name.** `formCallTarget.test.ts`'s pre-fix control and the W3.0 ablation replace the static; `_attachWith` must keep calling `Tooltip.detach(component)`, not a local alias.
- **`text-tooltip-on-truncate` widens `attach`'s text to a resolver function.** Whichever plan lands second widens `_sameAttachment`'s `text` parameter to the same union. `===` stays correct: a resolver matches only itself, and a `.bind(this)` made per call never matches, so it always replaces.
- **`feature/tooltip-ownership-test-gaps` is unmerged.** It appends cases to `Tooltip.test.ts` and `FieldDecorator.pointerTooltip.test.ts`. This plan edits neither, so the branches do not conflict; its 48 cases pass with this change applied.
- **A caller that mutates a colours object after passing it.** A kept attachment holds the colours object of the call that built it. A later equal-valued object is compared and dropped. The tooltip reads colours when it shows, so mutating the dropped object has no effect. No library caller mutates one.
- **The QA tests read the build.** Run `npm run build:lib` before `npm -w packages/qa run test`, or they test the previous build.

---

## Critical Files

| File | Why |
|---|---|
| [`overlay/Tooltip.ts:31-43`, `:96-101`, `:382-513`, `:515-567`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L382) | `TooltipAttachment`, `teardownWired`, `attach`, `attachCovering`, `_attachWith`, `detach`, `_cancelPendingShow`: every edit site |
| [`overlay/Tooltip.ts:674-690`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L674) | `_applyColors`: the three colour keys `_sameAttachment` compares |
| [`component/container/SplitGutter.ts:439-474`](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L439) | The precedent: the same same-text guard, at the caller |
| [`validation/FieldDecorator.ts:72-92`](packages/lib/src/typescript/lib/validation/FieldDecorator.ts#L72) | `showError` passes a fresh colours literal per call; `clearError` detaches |
| [`component/button/Button.ts:1167-1192`, `:1389-1410`, `:1464-1488`](packages/lib/src/typescript/lib/component/button/Button.ts#L1464) | `setText`'s guard, `setDescription`, `_rebuildTooltip` |
| [`packages/qa/src/harness/ablations.ts:1587-1634`](packages/qa/src/harness/ablations.ts#L1587) | `g19TooltipIdle`, the prototype this ships |
| [`tests/overlay/Tooltip.test.ts:317-344`](packages/lib/tests/overlay/Tooltip.test.ts#L317) | `hoverOver` and `showFor`, the stored-closure helpers the new file copies |
| [`tests/unit/validation/FieldDecorator.pointerTooltip.test.ts:1-222`](packages/lib/tests/unit/validation/FieldDecorator.pointerTooltip.test.ts#L1) | The real-event fixture the new file copies: header, helpers and hooks |
| [`packages/qa/src/builders/form.ts:503-539`](packages/qa/src/builders/form.ts#L503), [`packages/qa/tests/formCallTarget.test.ts`](packages/qa/tests/formCallTarget.test.ts) | The C21 witness and its tests |
| [`plans/implemented/field-decorator-pointer-tooltip.md`](plans/implemented/field-decorator-pointer-tooltip.md) | The covering mode and `_attachWith` this plan edits |
| [`plans/research/render-review-2026-09-15/96-w3-0-bounding-sweep.md:243-254`](plans/research/render-review-2026-09-15/96-w3-0-bounding-sweep.md#L243) | The measured bound |

---

## Non-Goals

- **The idle `hide` half of G19.** With nothing showing, fading or watched, the tooltip has no element and `hide` already returns before any fade.
- **The fade restarted on every blank chart move.** W3.0 left it unbounded: stopping it changes when the fade ends.
- **Updating the text of an existing attachment in place.** A call with new text still replaces the attachment and dismisses the component's own tooltip (`Tooltip.test.ts` case 8). F13.5's in-place update is a separate design.
- **F11.2's other proposals**: shared module-level `mouseout` / `mousedown` handlers, and a `mousemove` listener confined to the hover window.
- **`attachToElement` / `detachElement`.** Their raw-element path is unchanged.
- **Removing caller-side guards.** `SplitGutter`'s `_tooltipText` and `Button.setText`'s guard also skip their own composition work.
- **The two open audit advisories** (see *The two open audit advisories stay open*).
- **Retiring `g19.tooltip-idle`.** A wave-wide QA change.

---

## Addendum: Offline Evidence

Throwaway probes under `.worktrees/_probes/tooltip-idle-reattach/`, run against the base's library source. "Prototype" is the early return of *Internal Structure*, patched onto `Tooltip._attachWith` at run time.

| Probe | Base | Prototype |
|---|---|---|
| A's delay running; `attach(a, 'A')` | timer and `pendingId` cleared; nothing shows after 500 ms | the delay runs; shows `A` anchored to A |
| visible for A; `attach(a, 'A')` | dismissing, anchor `null`, anchor watch off | stays; anchor A; watching |
| B's identical `attach` while A's tooltip is visible or pending | A untouched (C21) | A untouched |
| `Event` calls per identical `attach` | 4 removes, 4 adds, a new record | none; the same record |
| decorator's error visible; the same `showError` | dismissed | stays up |
| decorator's delay running; the same `showError` | cancelled; never shows | shows when the delay runs out |
| ten identical `showError`, one decorator alone | 40 subtree removes and adds; 40 window-listener uninstalls and 40 installs | none |
| the same, beside a second decorator in error | no window-listener churn | none |
| `Button.setText('Save')` on a button titled `Save` | no `attach` (the guard at `Button.ts:1177`) | the same |
| `Button.setDescription(d)` twice | the second call re-attaches identical text | kept |

- **The whole `packages/lib` suite with the prototype applied:** 8,035 of 8,036 run tests pass. The one failure, `llms-generate.test.ts`'s doc-override case, fails without the prototype too; the probe runner's working directory causes it.
- **The QA tests with the prototype, against a build of the base:** `formCallTarget.test.ts`'s pre-fix control fails (*hidden by the second field's re-attach*: the tooltip stays), which is why step 2 changes the witness. `ablations.test.ts` passes.
- **The Backspace witness**, simulated in the QA test harness on a build of the base: with C21's fix the tooltip stays and with the pre-fix `detach` it is hidden — with and without the prototype.
- **`feature/tooltip-ownership-test-gaps`'s three test files:** 48 of 48 pass with and without the prototype.

---

## Notes

[^precedent]: The guard lives in `Tooltip` rather than at each caller because the callers that repeat themselves are spread out: `FieldDecorator.showError` on every validation, `Button.setDescription`, `AbstractSelectableList.applyTooltip` on every pooled-row rebind (`AbstractSelectableList.ts:422-433`), and whatever consumers do. `SplitGutter` guards its own call and says why: "No-op when the text is unchanged so repeated layouts don't re-wire the hover listeners" (`SplitGutter.ts:435-437`). Putting the same check in `_attachWith` gives every caller that guard, and covers `attachCovering` with no second check. Slice 11's F11.2 proposed exactly this one-line guard. ARCHITECTURE.md's rule 2 is written for style setters, but its reasoning — an unchanged value cannot change the outcome, so skipping the call skips its side effects too — is the reasoning here.

[^identical]: `_attachWith` stores `text`, `colors` and `covering` in the record, and its four closures capture `component`, `text`, `colors`, `covering` and the pointer position (`cursorX`, `cursorY`). The component is the lookup key itself. The pointer position is state a kept attachment should keep, since a pending show fires at the last position. Nothing else is captured. The `Event` registrations are keyed by component id, not by element, so they survive a re-render; the only path that drops them without `Tooltip.detach` is `Component.destructor`'s `Event.purgeComponent`, whose destroy hook then detaches, clearing the record too. The map is keyed by the id at attach time, and `Component.setId` moves the `Event` registrations but not this key. That staleness is older than this plan and the early return does not change it: a call after `setId` finds no record and takes today's path. Colours are compared by value because `FieldDecorator.showError` passes a fresh literal on every call, so a reference comparison would never match in the measured case. Hoisting that literal to a constant would fix one caller and leave the others.

[^visible-change]: Four reasons. First, an identical call carries nothing new, so it should look like no call; the fade and the cancelled delay were side effects of replace-by-detach, never a documented contract — `attach`'s JSDoc only says it "replaces" the attachment. Second, C21 already decided that a component's tooltip goes away on a leave, a press, or its own detach; a keystroke that re-runs the same validation is none of these. Third, the cancelled delay is the symptom C21's changelog entry names — "because no fresh `mouseover` fires under a stationary pointer the cancelled tooltip never appeared at all" — here caused by the component's own identical call instead of another's. Fourth, no other hover tooltip hides on a keystroke; a `Button`'s does not. `field-decorator-pointer-tooltip`'s non-goal "`showError` re-attaches, which dismisses the decorator's own visible error … That is C21's rule (`Tooltip.test.ts` case 8)" cites a case that re-attaches *new* text, which this plan keeps. No test pinned the identical case: the whole suite passes with the prototype. The alternative — skip the listener churn but still hide and cancel — was rejected: it keeps an accidental behaviour at the cost of a special path, and the W3.0 ablation measured the state-keeping version.

[^button]: F13.5 found `Button._rebuildTooltip` re-attaching on every `setText`. Wave 1's guard (`component-setter-guards`, G07) has since made an unchanged `setText` return first, so the remaining repeat callers are `setDescription` with an unchanged description (no guard), `applyOptions` re-dispatching the same description, and `setTooltipSuppressed`, which has its own guard (`Button.ts:1502`). `clearDescription` returns early when there is no description (`:1437`). F20.3's filter keystroke (`FilterCell.syncBadge` → `setText` + `clearDescription`) therefore reaches no `attach` at all in the single-clause case, and an identical `setDescription` in the multi-clause case is covered here.

[^witness]: Three other shapes were rejected. Keeping the retype leaves a witness that passes whether or not C21's fix is present — the identical re-attach never reaches `detach` — so the in-engine record would claim a check it no longer makes. Making the error message vary with the text would keep the retype a real replacement, but the same check drives `ffy`, whose identical re-attaches are this plan's measured saving; varying it would leave nothing to measure. Adjusting only the pre-fix control would keep the tests green over a witness that cannot fail. The Backspace goes through `clearError` → `Tooltip.detach` on the second decorator, the method C21 changed, so the witness stays sensitive to C21 with or without this plan (*Addendum: Offline Evidence*).

[^ablation-stays]: `packages/qa/tests/sweep.test.ts` (W4) requires every `abl=` that `sweeps/w3-0.sh` names to be registered, and batches `b10` and `b12` name this one. On a fixed library the ablation's wrapper still counts `skipped.g19.tooltip-idle.attach` for calls the library now skips itself, so its `engaged` reading there means nothing — hence the README note. Unlike the chart ablations in `chart-repaint-gate`, it cannot break the fix: it only ever skips calls the library would also skip. `motion-transform-inline` set the precedent of leaving its ablation in place until one wave-wide retirement.

[^advisories]: For a future fix of the first advisory — arming the error when `showError` finds the pointer already inside — this plan matters: such arming must happen only for a new or changed attachment. The early return guarantees that an unchanged `showError` per keystroke does not reach it, so the delay would not restart on every keystroke and never run out. The second advisory concerns `Tooltip.show`'s missing owner and the leave listener's `_owns` test, neither of which this plan touches.

[^by-name]: `formCallTarget.test.ts`'s pre-fix control spies on `Tooltip.detach` to reproduce the old unconditional hide, and the W3.0 ablation wraps `detach`. Both replace the static property, so only a call through `Tooltip.detach` reaches them.

[^new-file]: A new file, not new cases in `Tooltip.test.ts` or `FieldDecorator.pointerTooltip.test.ts`. The unmerged `feature/tooltip-ownership-test-gaps` appends numbered cases to the ends of both — case 15 in the first, 13–16 in the second — so appending here would collide in numbering and in the merge. One file also lets the closure-driven cases and the real-event cases share one fixture that disposes everything it creates.

[^work]: Per identical re-attach in `form-flat`, today's `detach` drops one of the four window-level listener types to no registrations, so `Event` uninstalls it and the new registration installs it again: one `removeListener`, one `addListener` and two `getWindow` calls. The typing phase re-attaches on 129 of 150 keystrokes — the text passes the 20-character limit on the 21st — so 129 × 2 = 258 sink calls, 1.72 per unit. In `form-nested` other registrations keep all four types installed, so the re-attach costs no seam call. Its saving there — four registry removals, four registrations, four closures and a record per keystroke — is script-side work no counter reads. W3.0's ablation counted 0.86 skips per unit in both cells.

[^ab-shape]: `ffy` is the cell that bounded G19. `fny` is its deep partner and the deep half of the geometry gate. The campaign's rule is geometry equality in a deep and a shallow panel, since the test suite cannot see a layout change. `clh` and `cdh` are the other two cells W3.0 ran for G19; they never attach, so three runs confirm their counts are untouched. The `c21` runs are the ownership check in the engine: with this change, the witness's Backspace must still leave the first field's tooltip up. Base, fix, base, fix, base mirrors W3.0's scored cell, and base at both ends cancels a linear drift.

---

## Implementation Notes

**`BASE_SHA` = `77ce5a1d422dd067f7ee7cf44557a5c5a396d6cd`** (step 1), the tip of
`feature/event-dispatch-walk`. This branch starts from the wave-3 stack, not
from the plan's `feature/w3-0-results` base, so the in-engine A/B's base arm is
built from this SHA — `git merge-base … master` is far behind it. Line numbers
in the plan sit about one line above their real positions in `Tooltip.ts`
(`text-measurement-without-reflow` added an import); every anchor was matched by
text, and the `Tooltip.ts` diff against `master` is otherwise only that plan's
two `measureTextMetrics` call sites.

**Three deviations, all local:**

- *Step 13, the changelog.* `## Changed` already carried a `### Overlay`
  subsection, in exactly the position the plan asks for a new one — after
  `### Layouts` and before `## Added`. Earlier wave-3 plans in this stack added
  it. The bullet was appended to that subsection rather than repeating the
  heading.
- *Step 3, `packages/qa/src/panels/form-flat.ts`.* `description` is a
  single-quoted string literal, so the apostrophe in "field's error" is escaped
  as `field\'s`, the spelling `form-nested.ts`, `list-items.ts` and the other
  panels already use. Unescaped, the file does not parse.
- *Step 7, the test file's constants.* Two beyond the plan's list, both because
  the conventions require a literal to be named and explained: `HOVER_LISTENERS`
  (4, case 10's expectation), copied with its comment from
  `FieldDecorator.pointerTooltip.test.ts`, and `IDENTICAL_CALLS` (10, case 16's
  repeat count).

**Step 8's red list was exactly the plan's.** Against the unchanged library the
new file failed cases 1, 2, 5, 7, 9, 11, 13, 14, 16 and 19, and passed the other
nine; all 19 pass with the change. `npm test` is 8,411 green over 507 files,
`npm -w packages/qa run test` 344 green, `npm run typecheck` and `npm run lint`
clean, `npm run docs:api` 14 warnings (`master`'s own count, no new one) and
`npm run docs:llms:check` OK.

### Owed to the user — nothing in-engine was run

Both of these open a full-screen window, so the implementation ran neither.

**M1–M3, the manual checks** of *Expected Behaviour*, in the library demo app's
*Binding* tab, whose name field errors past 50 characters. M1: with the error
tooltip up, one more character leaves it up (it faded before). M2: a character
typed within half a second of the pointer coming to rest still lets the tooltip
appear (it did not before). M3: a keystroke that changes the message still fades
the tooltip.

**The in-engine A/B** of *Verification*, unchanged except for the base SHA:

```sh
cd /home/jika/typescript/typescript-ui
git worktree add .worktrees/_g19-base 77ce5a1d422dd067f7ee7cf44557a5c5a396d6cd --detach
ln -sfn "$PWD/node_modules" .worktrees/_g19-base/node_modules
(cd .worktrees/_g19-base/packages/lib && npm run build:lib)
export QA_WT_LIB="$PWD/.worktrees/_g19-base/packages/lib"
```

Then the 19 `packages/qa/runqa.sh` runs and the two readers of *Verification*
step 3–4, from this worktree's root, scored by its step 5. The expected-readings
table's `base` column is W3.0's reading on `83cfb0d7`; the `base` runs here are
on the wave-3 stack tip instead, so a count may have moved — the gate that holds
whatever the base is remains `ffy`'s `fix` at its `base` minus 1.72 on both sink
calls and `getWindow`, geometry `=` everywhere, and `c21`'s one-liner `True`.

One worktree-local convenience, untracked and not committed: a
`node_modules/@jimka/typescript-ui -> ../../packages/lib` symlink, without which
`npm -w packages/qa` resolves the library to the main checkout's stale build.
