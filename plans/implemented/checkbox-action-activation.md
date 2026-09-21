---
depends-on: []
touches-shared:
  - ARCHITECTURE.md
  - packages/lib/docs/concepts/events.md
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/docs/reference/migration/next.md
  - packages/qa/src/panels/form-flat.ts
  - packages/qa/src/builders/form.ts
  - packages/qa/README.md
  - packages/qa/tests/mount.test.ts
  # Not edited by this plan. Listed so /implement serialises it with the
  # parallel doc-and-qa-record-drift plan, which may edit it.
  - packages/lib/src/typescript/MiscPanel.ts
  - plans/research/render-review-2026-09-15/01-phase2-status-pass.md
  - plans/research/render-review-2026-09-15/99-synthesis.md
---

# Checkbox and Slider Action Activation — Implementation Plan

## Overview

This plan fixes register entry C40 and the `Slider` follow-up recorded beside it, both in [`01-phase2-status-pass.md:322`](plans/research/render-review-2026-09-15/01-phase2-status-pass.md#L322) and [`:393`](plans/research/render-review-2026-09-15/01-phase2-status-pass.md#L393).

`Checkbox.on("action", fn)` registers a listener for DOM `click` on the checkbox's own root element ([`component/input/Checkbox.ts:558`](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L558)). A real click lands on the inner box ([`:335`](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L335)), and `Event` matches such a listener only when the event's target is that exact element ([`core/Event.ts:272-290`](packages/lib/src/typescript/lib/core/Event.ts#L272)). So the listener hears a user toggle only through the synthetic `click` that `setSelected` dispatches on every change ([`Checkbox.ts:459-463`](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L459)). That one binding misbehaves in both directions: `"action"` fires for every programmatic write, and it fires with no state change for a click on the root itself — the gap beside the box, the label (which passes pointer events through to the root), or a disabled checkbox. `Slider.setValue` has the programmatic half of the same shape: it re-fires the DOM `input` its `"action"` wraps on every change, with no way out ([`component/input/Slider.ts:256-259`](packages/lib/src/typescript/lib/component/input/Slider.ts#L256)).

After this plan both controls announce `"action"` only for the user's own activation, as `RadioButton` and `ToggleButton` already do. `Checkbox.activate()` fires a DOM `change` that `on("action")` listens for; `Slider`'s pointer and keyboard handlers fire `input` through a new private method; `setSelected` and `setValue` dispatch nothing. `Checkbox.setSelected`'s `fireAction` parameter loses its purpose and is deleted. The QA app's `form-flat` panel gets a witness that shows the fix, replacing the C34 check that read 0 on both arms because it never toggled anything.[^witness-zero]

---

## Architecture Decisions

### `"action"` reports user activations only — programmatic writes never fire it (needs the user's approval)

**This is the decision the user must approve before implementation starts.**

After the fix, a programmatic write to a `Checkbox` or a `Slider` — `setSelected`, `setValue`, or a `Binding` update, which calls `setValue` — fires `"change"` and `"binding"` exactly as today, and never `"action"`. Both classes get the same treatment. `Slider` gains no opt-out parameter, and `Checkbox.setSelected`'s `fireAction` parameter is deleted.

The evidence is the consumer survey: every existing subscriber to either control's `"action"`, across the library, the docs demos, the demo app, the QA app, Loom and SQLAdmin, wants user activations only, and the two in-library subscribers hand-roll a guard to get that.[^survey]

The alternative keeps programmatic fan-out as the default, keeps `fireAction`, and adds the same opt-out to `Slider.setValue`. It would still need this plan's delivery fix, so it saves no work. It would add two public parameters whose default no current consumer wants, and it would leave `Binding` writes announcing `"action"` with no way to suppress them, since `Bindable.setValue` takes one argument.[^alternative]

### `Checkbox` fires a DOM `change` from `activate()`, as `RadioButton` does

`Checkbox.activate()` changes the state through `setSelected` and then calls `Event.fireEvent(this, "change")`. `on("action")` / `off("action")` register and remove a DOM `change` listener on the root. This mirrors [`RadioButton.activate`](packages/lib/src/typescript/lib/component/input/RadioButton.ts#L331) with its [`on("action")` at `:455`](packages/lib/src/typescript/lib/component/input/RadioButton.ts#L455), and [`ToggleButton.onAction`](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L281) with its [`on("action")` at `:139`](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L139). Each fires the event its shorthand wraps from its activation path, never from its setter.

`activate()` fires unconditionally, because both of its branches always change the state (a flip, or mixed → checked). `activate()` is reached only through `AbstractBooleanInput`'s enabled / read-only guard ([`AbstractBooleanInput.ts:146-176`](packages/lib/src/typescript/lib/component/input/AbstractBooleanInput.ts#L146)), so a disabled or read-only checkbox announces nothing.

The DOM event type changes from `click` to `change`.[^why-change-type]

### `Slider` fires `input` from a private user-path method

A new private `Slider.setValueFromUser(value)` calls `setValue(value)` and, when that moved the value, fires `Event.fireEvent(this, "input")`. All eight `this.setValue(...)` calls inside `installInteraction` ([`Slider.ts:544`, `:557`, `:597`, `:602`, `:606`, `:610`, `:614`, `:618`](packages/lib/src/typescript/lib/component/input/Slider.ts#L526)) switch to it. `setValue` itself dispatches nothing. `on("action")` keeps listening for `input`. This is the same "setter mutates, activation path dispatches" split as the `Checkbox` change above. Removing the dispatch from `setValue` also makes a `setValue` before mount stop throwing.[^unmounted-throw]

### `fireAction` is deleted in a commit of its own, after the behaviour change

The work lands as two code commits for `Checkbox`. The first moves `"action"` to the DOM `change` that `activate()` fires, and leaves `setSelected`'s synthetic `click` and its `fireAction` switch in place, now heard by nothing. The second deletes that synthetic `click`, the `fireAction` parameter, its pre-mount `console.warn`, and `BooleanEditor`'s two `false` arguments. `fireAction` never shipped in a release, so its `## Added` changelog entry is removed and no migration note is written for it.[^fireaction-commit]

### `List` and `ComboBox` keep their `setSelectedIndex` fan-out, recorded as a follow-up

`AbstractSelectableList.setSelectedIndex(idx, fireEvent = true)` and `ComboBox.setSelectedIndex(idx, fireEvent = true)` still announce `"action"` on their default path. This plan does not change them. ARCHITECTURE.md names them as the one known deviation from the new rule, and the status pass records a follow-up entry for them.[^list-combo]

### `Body.onSubtreeClick` keeps its `MouseEvent` guard, with a general reason

The `if (!(e instanceof MouseEvent))` guard at [`component/table/Body.ts:1501`](packages/lib/src/typescript/lib/component/table/Body.ts#L1501) stays. Only its comment ([`:1493-1500`](packages/lib/src/typescript/lib/component/table/Body.ts#L1493)) is rewritten: a checkbox no longer dispatches any synthetic `click`, but any programmatic `click` from a control hosted in a cell (a `Button.click()`, say) must still not select a row.[^body-guard]

### `VideoPlayer` drops the scrubber's half of its `_syncing` guard

`VideoPlayer.beginScrub`'s `if (this._syncing) { return; }` ([`component/display/VideoPlayer.ts:678-680`](packages/lib/src/typescript/lib/component/display/VideoPlayer.ts#L678)) becomes unreachable, since a programmatic `setValue` no longer reaches the scrubber's `"action"` listener. It is deleted. `_syncing` itself stays, because `onVolumeSlider` listens on `"change"`, which a programmatic `setValue` still fires. The field's doc comment ([`:165-169`](packages/lib/src/typescript/lib/component/display/VideoPlayer.ts#L165)) is rewritten to say so.

### The QA witness clicks each control's own click surface, and adds a programmatic-write target

`form-flat`'s form builder ([`packages/qa/src/builders/form.ts`](packages/qa/src/builders/form.ts)) changes in three ways:

- `click=toggle` clicks the first toggle's `.ToggleTrack` and the first checkbox's `.CheckboxBox`, the elements each one toggles from, instead of their root elements.
- A new `click=root` clicks the first checkbox's own root element, where a click on a label lands.
- A new `update` target makes one programmatic write per unit to the first checkbox and the first slider. Under `work=1`, `installWork` counts each control's `"action"` deliveries as `checkbox.action` and `slider.action`.

Finding an inner element by its class name follows [`builders/shell.ts:270`](packages/qa/src/builders/shell.ts#L270) (`requireElement(dockElement, '.TabButton', …)`). `installWork` follows [`panels/tree-nodes.ts:48`](packages/qa/src/panels/tree-nodes.ts#L48), and `update` is the existing call driver ([`harness/drivers.ts:321`](packages/qa/src/harness/drivers.ts#L321)).[^witness-zero]

---

## Public API

```typescript
class Checkbox<TOptions extends CheckboxOptions = CheckboxOptions>
    extends AbstractBooleanInput<TOptions>
{
    /** Was `setSelected(value: boolean, fireAction: boolean = true)`. Dispatches no DOM event. */
    setSelected(value: boolean): this;

    /**
     * "action" now listens for the DOM `change` that `activate()` fires once per
     * user activation. Signatures unchanged.
     */
    on(event: "action",  listener: Event.Listener): this;
    on(event: "change",  listener: (value: boolean) => void): this;
    on(event: "binding", listener: () => void): this;
    off(event: "action" | "change" | "binding", listener: Function): this;
}

class Slider<TOptions extends SliderOptions = SliderOptions>
    extends AbstractInput<number, TOptions>
{
    /** Signature unchanged. No longer dispatches `input`; no longer throws before mount. */
    setValue(value: number): this;

    /** Signature and DOM type (`input`) unchanged; fired from the user's pointer and key steps only. */
    on(event: "action", listener: Event.Listener): this;
}
```

No options field is added or removed, so the default-resolution registry in [`tests/component/default-options-fallback.test.ts`](packages/lib/tests/component/default-options-fallback.test.ts) needs no row. `Checkbox.setValue(value)` keeps its one-parameter `Bindable` signature and delegates to the new `setSelected`.

---

## Internal Structure

### What delivers `"action"`, before and after

Rows marked *probe* were measured offline against `master` `f0d95ef8` with the recording DOM. Each "after" column was checked by monkey-patching the proposed `Checkbox` bodies below onto the prototype in a throwaway probe.

| Trigger | `Checkbox` today | `Checkbox` after | `Slider` today | `Slider` after |
|---|---|---|---|---|
| Click on the box / a drag sample or value key that moves the thumb | 1, the echo of `setSelected`'s synthetic `click` (probe) | 1, the DOM `change` from `activate` (probe) | 1 (probe) | 1 |
| Space on the focused checkbox | 1 (probe) | 1 (probe) | — | — |
| Click on the box of an indeterminate checkbox | 1, lands checked (probe) | 1, lands checked (probe) | — | — |
| Click on the root: the label, the gap, empty stretched space | **1, state unchanged** (probe) | 0 (probe) | — | — |
| Click on a disabled checkbox's root | **1** (probe) | 0 (probe) | — | — |
| Click on a disabled or read-only box / key on a disabled slider | 0 (probe) | 0 (probe) | 0 (probe) | 0 |
| `setSelected(…)` / `setValue(…)`, including a `Binding` write | **1** (probe) | 0 (probe) | **1** (probe) | 0 |
| `setIndeterminate(…)` | 0 | 0 | — | — |
| The same call before mount | `console.warn` | silent (probe) | **throws** (probe) | silent |
| Event object an `"action"` listener receives | `CustomEvent` of type `click` | `CustomEvent` of type `change` (probe) | `CustomEvent` of type `input` | unchanged |

On a user activation, listeners run in the order `"change"`, `"binding"`, `"action"`, and `isSelected()` already reads the new value inside the `"action"` listener (probe).

### `Checkbox`, final shape (after both commits)

```typescript
protected activate(): void {
    if (this.isIndeterminate()) {
        this.setSelected(true);
    } else {
        this.setSelected(!this.isSelected());
    }

    // Both branches change the state, so every activation announces itself.
    // `on("action", fn)` listens for this DOM `change`, as on RadioButton.
    Event.fireEvent(this, "change");
}

setSelected(value: boolean): this {
    const next = !!value;
    if (next === this.isSelected() && !this.isIndeterminate()) {
        return this;
    }

    this._options.selected = next;
    this._options.indeterminate = false;
    this.applySelected(next, false);
    this.notifyChange(next);

    return this;
}

// on():  if (event === "action") { Event.addListener(this, "change", listener as Event.Listener); return this; }
// off(): if (event === "action") { Event.removeListener(this, "change", listener as Event.Listener); return this; }
```

### `Slider`

```typescript
setValue(value: number): this {
    const next = this.snap(value);
    if (next === this.getValue()) {
        return this;
    }

    this._options.value = next;
    this.applyValue(next);
    this.notifyChange(next);

    return this;
}

/**
 * The user's value path, for the pointer and keyboard handlers: sets the value
 * like {@link setValue} and, when that moved it, fires the DOM `input` that
 * `on("action", fn)` listens for. Dispatching here rather than in `setValue`
 * is what keeps a programmatic write out of `"action"`.
 *
 * @param value - The value the gesture asks for, before clamping and snapping.
 */
private setValueFromUser(value: number): void {
    const before = this.getValue();

    this.setValue(value);

    if (this.getValue() !== before) {
        Event.fireEvent(this, "input");
    }
}
```

Place `setValueFromUser` directly after `installInteraction` (before `valueAtPointer`, [`Slider.ts:625`](packages/lib/src/typescript/lib/component/input/Slider.ts#L625)).

### QA form builder additions

```typescript
/** What `click` clicks: the controls' own click surfaces, the first checkbox's element outside its box, or the first combo box. */
const CLICKS = ['toggle', 'root', 'combo'] as const;

/**
 * What each `click=` mode clicks: a field kind, and the element inside that
 * field which takes the click — `null` for the field's own element. A toggle
 * toggles from its track and a checkbox from its box, never from their own
 * elements, so `toggle` clicks those surfaces; `root` clicks the checkbox's
 * own element on purpose, since that is where a click on a label lands.
 */
const CLICK_SURFACES: Record<typeof CLICKS[number], ReadonlyArray<readonly [FieldKind, string | null]>> = {
    toggle: [['toggle', '.ToggleTrack'], ['checkbox', '.CheckboxBox']],
    root: [['checkbox', null]],
    combo: [['combo', null]],
};

/** How far `update` moves the slider off its start and back: one step at a `Slider`'s default step of 1, so the write stays on the step grid and always changes the value. */
const SLIDER_NUDGE = 1;

function clickTarget(tools: HarnessTools, parts: FormParts, mode: FormChoices['click'], panel: string): { elements: HTMLElement[] } | undefined {
    const elements = CLICK_SURFACES[mode]
        .filter(([kind]) => parts.first[kind] !== undefined)
        .map(([kind, selector]) => {
            const element = elementFor(tools, parts.first[kind]!, panel);

            return selector === null ? element : requireElement(element, selector, panel);
        });

    return elements.length > 0 ? { elements } : undefined;
}

function programmaticWrites(first: FormParts['first']): CallTarget | undefined {
    const checkbox = first.checkbox as Checkbox | undefined;
    const slider = first.slider as Slider | undefined;

    if (!checkbox || !slider) {
        return undefined;
    }

    return function writeCheckboxAndSlider(): void {
        checkbox.setSelected(!checkbox.isSelected());
        slider.setValue(slider.getValue() === SLIDER_VALUE ? SLIDER_VALUE + SLIDER_NUDGE : SLIDER_VALUE);
    };
}

function countActions(tools: HarnessTools, first: FormParts['first']): string[] {
    const checkbox = first.checkbox as Checkbox | undefined;
    const slider = first.slider as Slider | undefined;
    const notes: string[] = [];

    if (checkbox) {
        checkbox.on('action', function countCheckboxAction(): void {
            tools.bumpWork('checkbox.action');
        });
        notes.push('counting checkbox.action on the first Checkbox');
    } else {
        notes.push('no Checkbox');
    }

    // … the same for `slider`, bumping 'slider.action' from `countSliderAction`.

    return notes;
}
```

Both writes read the current state rather than the unit index, so every unit is a real transition for both controls even after an earlier phase moved them. Give every new function a JSDoc block in the file's existing style: a summary, then `@param` / `@returns`.

---

## Ordered Implementation Steps

Paths under `packages/lib/src/typescript/lib/` are written `lib/…`. Each phase is test-first: write its tests, see the listed ones fail, then change the code.

### Phase 1 — `Checkbox` announces `"action"` from its activation (code commit 1)

1. **`packages/lib/tests/component/input/Checkbox.test.ts`** — add `import { Event } from '~/core/Event';` and `makeEvent` to the `TestDOM` import. Add a new `describe('Checkbox action delivery (mounted)')` after the existing `Checkbox action fan-out (mounted)` block (it ends at [`:270`](packages/lib/tests/component/input/Checkbox.test.ts#L270)), with `afterEach(() => DOM.reset())`. Inside it, copy `freshEventWindow` from [`RadioButton.test.ts:124-130`](packages/lib/tests/component/input/RadioButton.test.ts#L124), and write a `mountedCheckbox(options?)` helper modelled on [`mountedRadio` at `:138-157`](packages/lib/tests/component/input/RadioButton.test.ts#L138). It returns `{ cb, box }`, where `box` is `(cb as any)._box.getElement(true)!`, and pauses `_box`, `_check`, `_dash`, the checkbox and the host before flushing. Write cases 1–8 of `## Expected Behaviour` as `it`s. Dispatch a click with `Event.fireEvent(cb, makeEvent(box, 'click', { button: 0 }) as any)`, a root click with the root's handle, and Space with `makeEvent(root, 'keydown', { key: ' ' })`.[^event-window]
2. **`packages/lib/tests/component/table/cell/BooleanCell.test.ts`** — add `makeEvent` to the `TestDOM` import and add case 12 as a new `it` in `BooleanCell commit fan-out` ([`:139`](packages/lib/tests/component/table/cell/BooleanCell.test.ts#L139)), using the module-scope `mountedCell()` and `editorCheckbox()`. Call `cell.setValue(false)` first, then dispatch a click on `(editorCheckbox(cell) as any)._box.getElement(true)`. Case 12 passes before and after; it pins the editor's only user-toggle signal across the change.
3. **Check** — `npx vitest run tests/component/input/Checkbox.test.ts` from `packages/lib`: cases 1 (event type), 4, 5 (root clicks) and 6 fail; the rest pass.
4. **`lib/component/input/Checkbox.ts`** — replace `activate()`'s body ([`:397-405`](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L397)) with the `## Internal Structure` version. Rewrite its TSDoc ([`:389-396`](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L389)): keep the WAI-ARIA mixed-state sentence, then state that it changes the state through `setSelected` and fires the DOM `change` that `on("action", fn)` listens for.
5. **`Checkbox.ts`** — in `on` ([`:558`](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L558)) and `off` ([`:577`](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L577)), change `"click"` to `"change"`.
6. **`Checkbox.ts`** — rewrite the `on` TSDoc ([`:536-552`](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L536)). `"action"` is a typed semantic shorthand over {@link Event.addListener} for the DOM `change` the checkbox fires once per user activation — a click on its box, or Space. It never fires for a programmatic {@link setSelected} or {@link setValue}, a click on its label or empty area, or a disabled or read-only checkbox: the same contract as [`RadioButton`](/api/component/input/classes/RadioButton)'s. `"change"` and `"binding"` are the inherited {@link AbstractInput} listener-bag events and fire for programmatic writes too. Keep the `BooleanEditor` link. Link only to public symbols, per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md).
7. **`Checkbox.ts`** — interim wording for `setSelected`, which keeps `fireAction` until Phase 2. Do **not** remove the `if (!fireAction) { return this; }` early return: the parameter must stay used, or `noUnusedParameters` fails the build.[^fireaction-commit]
   - Replace the `@param fireAction` text ([`:430-434`](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L430)) with: when `true` (the default), a real transition also dispatches a synthetic DOM `click` on the root, which `on("action", fn)` no longer listens for; pass `false` to skip it.
   - Replace the comment at [`:453-458`](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L453) with: this synthetic `click` is no longer what `on("action", fn)` hears, since that is the DOM `change` `activate` fires; it is skipped before mount, where `fireEvent` would throw on the missing element.
8. **`lib/component/input/AbstractBooleanInput.ts`** — in the class TSDoc ([`:31-33`](packages/lib/src/typescript/lib/component/input/AbstractBooleanInput.ts#L31)), replace "`ButtonGroup` change firing, synthetic-click behaviour" with "the DOM event a subclass fires from `activate` for its `"action"`".
9. **`packages/lib/tests/component/input/RadioButton.test.ts`** — rewrite the comment at [`:160-163`](packages/lib/tests/component/input/RadioButton.test.ts#L160): a radio's `"action"` means "the user selected this one", the same contract `Checkbox` has; `ButtonGroup`'s sibling-deselect sweep writes `setSelected(false)` across every untouched button and listens on `"action"` itself.
10. **Check** — `npm test`: all green, including every existing `Checkbox`, `BooleanCell`, cell-editor and `ColumnVisibilityMenu` test. `npm run typecheck`: 0 errors.

### Phase 2 — delete the synthetic `click` and `fireAction` (code commit 2, deletion only)

11. **`Checkbox.test.ts`** — edit before the code:
    - Rewrite the file header ([`:1-7`](packages/lib/tests/component/input/Checkbox.test.ts#L1)). Most cases run on a bare checkbox, where `setSelected` dispatches nothing. The mounted blocks either assert that a programmatic write dispatches nothing, or drive real events to assert `"action"` delivery.
    - Turn the test at [`:78-86`](packages/lib/tests/component/input/Checkbox.test.ts#L78) into `'flips state silently when unmounted'`, asserting `warn` was called 0 times (case 10).
    - Delete the `console.warn` spies and their comments at [`:89-90`](packages/lib/tests/component/input/Checkbox.test.ts#L89), [`:117`](packages/lib/tests/component/input/Checkbox.test.ts#L117) and [`:142`](packages/lib/tests/component/input/Checkbox.test.ts#L142). Drop the `afterEach(() => vi.restoreAllMocks())` at [`:107`](packages/lib/tests/component/input/Checkbox.test.ts#L107) and [`:139`](packages/lib/tests/component/input/Checkbox.test.ts#L139), which then restore nothing; keep the one at [`:76`](packages/lib/tests/component/input/Checkbox.test.ts#L76), which case 10's spy still needs.
    - Rename `describe('Checkbox action fan-out (mounted)')` to `'Checkbox programmatic writes (mounted)'`.
      - Replace its first test ([`:165-196`](packages/lib/tests/component/input/Checkbox.test.ts#L165)) with case 9. Use the block's `mountedCheckbox` and count every `dispatchEvent` write since the call, of any type.
      - Delete the `fireAction: false` test ([`:223-245`](packages/lib/tests/component/input/Checkbox.test.ts#L223)).
      - Reduce the no-op-guard test ([`:247-269`](packages/lib/tests/component/input/Checkbox.test.ts#L247)) to one `cb.setSelected(true)` call asserting no change, no binding and no dispatch (case 11).
      - Replace `clickDispatches` with a `dispatches(sink, start)` helper that counts every `dispatchEvent` write.
    - Delete `describe('Checkbox action fan-out (unmounted)')` ([`:272-291`](packages/lib/tests/component/input/Checkbox.test.ts#L272)).
12. **`BooleanCell.test.ts`** — edit before the code:
    - Rewrite the `beforeEach` comment ([`:32-36`](packages/lib/tests/component/table/cell/BooleanCell.test.ts#L32)): a listener installed against a previous case's window would leave the checkbox's DOM `change` undelivered, and every commit assertion passing for the wrong reason.
    - Rewrite `mountedCell`'s doc ([`:48-54`](packages/lib/tests/component/table/cell/BooleanCell.test.ts#L48)): realising the checkbox element is what lets a dispatched click reach the box.
    - Rename `clickDispatches` ([`:67-70`](packages/lib/tests/component/table/cell/BooleanCell.test.ts#L67)) to `dispatches` and count every `dispatchEvent` write, of any type (case 13). Update its two callers.
13. **Check** — `npx vitest run tests/component/input/Checkbox.test.ts`: cases 9 and 10 fail.
14. **`Checkbox.ts`** — make `setSelected` the `## Internal Structure` version: drop the `fireAction` parameter, the `if (!fireAction)` return, the comment, the synthetic-click block and the `console.warn` ([`:449-463`](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L449)). Rewrite its TSDoc ([`:425-437`](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L425)): it notifies `"change"` and `"binding"` on a real transition and is a no-op when unchanged; a programmatic write never fires `"action"`, which reports the user's own toggles only.
15. **`lib/component/table/cell/editor/Boolean.ts`** — `setValue` ([`:125`](packages/lib/src/typescript/lib/component/table/cell/editor/Boolean.ts#L125)) and `toggle` ([`:167`](packages/lib/src/typescript/lib/component/table/cell/editor/Boolean.ts#L167)) call `setSelected(value)` with one argument. Replace the comment at [`:120-124`](packages/lib/src/typescript/lib/component/table/cell/editor/Boolean.ts#L120): a checkbox announces `"action"` for a user toggle only, so this rebind never reaches the editor's own listener. Replace the comment at [`:164-166`](packages/lib/src/typescript/lib/component/table/cell/editor/Boolean.ts#L164): the same holds for this write, so the `emit` below is the activation's single commit. Keep the constructor's inline arrow listener unchanged.
16. **`lib/component/table/Body.ts`** — rewrite the comment at [`:1493-1500`](packages/lib/src/typescript/lib/component/table/Body.ts#L1493). The guard filters any synthetic `click`: a `CustomEvent` from a programmatic `fireEvent(…, "click")`, such as `Button.click()` on a control hosted in a cell. Only a real pointer `MouseEvent` may select the row. Leave the guard itself unchanged.
17. **Test comments that describe the deleted dispatch** — rewrite each so it no longer claims `Checkbox.setSelected` dispatches a click. Leave every data choice and assertion as it is:
    - [`tests/component/table/cell/editor.test.ts:729-741`](packages/lib/tests/component/table/cell/editor.test.ts#L729) and [`:777-783`](packages/lib/tests/component/table/cell/editor.test.ts#L777)
    - [`tests/component/table/CellLayoutSkip.test.ts:122-130`](packages/lib/tests/component/table/CellLayoutSkip.test.ts#L122)
    - [`tests/component/table/RotatedView.test.ts:33-42`](packages/lib/tests/component/table/RotatedView.test.ts#L33)
    - [`tests/component/table/QuickSearch.test.ts:49-56`](packages/lib/tests/component/table/QuickSearch.test.ts#L49)

    The `active: false` fixtures in the last two files stay. They are now conservative rather than required, as `CellLayoutSkip.test.ts` already says of its own.
18. **Check** — `npm test` all green; `npm run typecheck` 0 errors. Then:
    - `grep -rn 'fireAction' packages/lib/src packages/lib/tests` — zero matches.
    - `grep -rn 'setSelected(.*, false)' packages/lib/src` — zero matches.
    - `grep -n '"click"' packages/lib/src/typescript/lib/component/input/Checkbox.ts` — exactly one match, the `_box` listener at `:335`.

### Phase 3 — `Slider` announces `"action"` from its user steps (code commit 3)

19. **`packages/lib/tests/component/input/Slider.test.ts`**:
    - Rewrite the header's second bullet ([`:7-10`](packages/lib/tests/component/input/Slider.test.ts#L7)): `setValue` dispatches nothing and works unmounted. The mounted blocks mount for layout, or to drive real events.
    - In `Slider setValue round-trip (mounted)`, rewrite the comments at [`:213-221`](packages/lib/tests/component/input/Slider.test.ts#L213) and [`:248-250`](packages/lib/tests/component/input/Slider.test.ts#L248) so they no longer say the mount exists for `fireEvent`. The drain-and-pause reasoning stays.
    - Add `describe('Slider setValue (unmounted)')` holding case 15.
    - Add `describe('Slider action delivery (mounted)')` holding cases 16–19. Use the same `freshKeydownWindow` purge ritual as [`:289-295`](packages/lib/tests/component/input/Slider.test.ts#L289). For the pointer case, position the slider exactly as the `mapper` helper does ([`:339-361`](packages/lib/tests/component/input/Slider.test.ts#L339): host and slider at `(0, 0)`, slider `200 × 16`, `doLayout()`, `quiesce`). Dispatch `makeEvent(el, 'pointerdown', { button: 0, buttons: 1, pointerId: 1, clientX: 100, clientY: 8 })`, then `pointermove`s with the same `pointerId`.
20. **`packages/lib/tests/component/display/VideoPlayer.test.ts`** — add `describe('VideoPlayer scrubber action')` after `VideoPlayer.syncFromState` (it starts at [`:115`](packages/lib/tests/component/display/VideoPlayer.test.ts#L115)). In a `beforeEach` of its own, purge every component registered with `Event` (the ritual from step 19), since the file-level `beforeEach` installs the DOM but does not purge. Build the player and realise every descendant's element. Spy on `_video.setCurrentTime` with `vi.spyOn((internals(player) as any)._video, 'setCurrentTime')`. Then write cases 20 and 21, reading the sink returned by `installTestDOM` for case 20's dispatch count.
21. **Check** — `npx vitest run tests/component/input/Slider.test.ts tests/component/display/VideoPlayer.test.ts`: cases 15, 16 and 20 fail.
22. **`lib/component/input/Slider.ts`** — replace `setValue`'s body ([`:246-262`](packages/lib/src/typescript/lib/component/input/Slider.ts#L246)) with the `## Internal Structure` version. Its TSDoc ([`:238-245`](packages/lib/src/typescript/lib/component/input/Slider.ts#L238)) gains: never fires `"action"`, which reports the user's own drag and key steps only.
23. **`Slider.ts`** — add `setValueFromUser` after `installInteraction` and switch the eight call sites listed in `## Architecture Decisions` to it.
24. **`Slider.ts`** — rewrite the `on` TSDoc ([`:384-395`](packages/lib/src/typescript/lib/component/input/Slider.ts#L384)): `"action"` is the shorthand for the DOM `input` the slider fires for each user step that moves the value (a drag sample, or an arrow, Page, Home or End key), never for a programmatic {@link setValue}. `"change"` and `"binding"` fire for both.
25. **`lib/component/display/VideoPlayer.ts`** — delete the `if (this._syncing) { return; }` block from `beginScrub` ([`:678-680`](packages/lib/src/typescript/lib/component/display/VideoPlayer.ts#L678)). Rewrite the `_syncing` doc ([`:165-169`](packages/lib/src/typescript/lib/component/display/VideoPlayer.ts#L165)): it guards `onVolumeSlider` against the `"change"` that a `syncFromState` volume write fires. The scrubber's `"action"` never fires for a programmatic write, so it needs no guard.
26. **Check** — `npm test` all green, `npm run typecheck` 0 errors. Then:
    - `grep -n 'this.setValue(' packages/lib/src/typescript/lib/component/input/Slider.ts` — exactly one match, inside `setValueFromUser`.
    - `grep -n 'fireEvent(this, "input")' packages/lib/src/typescript/lib/component/input/Slider.ts` — exactly one match.
    - `grep -n '_syncing' packages/lib/src/typescript/lib/component/display/VideoPlayer.ts` — no match inside `beginScrub`.

### Phase 4 — the QA witness (tooling)

27. **`packages/qa/tests/mount.test.ts`** — in `describe('P14 panel parameters')` ([`:250`](packages/qa/tests/mount.test.ts#L250)), add cases 22 and 23. Model case 22 on the `passes` case at [`:251-257`](packages/qa/tests/mount.test.ts#L251). Case 23 imports `loadPanel` from `../src/panels.js` and the `CallTarget` type from `../src/harness/types.js`, and builds without mounting (as P1 in `panels.test.ts` does).
28. **`packages/qa/src/builders/form.ts`**:
    - Replace `CLICKS` ([`:38-39`](packages/qa/src/builders/form.ts#L38)) and add `CLICK_SURFACES` and `SLIDER_NUDGE` beside the slider constants ([`:62-66`](packages/qa/src/builders/form.ts#L62)).
    - Replace `clickTarget`'s body ([`:407-416`](packages/qa/src/builders/form.ts#L407)) and its TSDoc. `requireElement` and `elementFor` are already imported from `./dom.js`.
    - Add `programmaticWrites` and `countActions`. Add `import type { CallTarget } from '../harness/types.js';`. `Checkbox` and `Slider` are already imported from the input barrel; use them as types.
    - In `buildForm` ([`:455-492`](packages/qa/src/builders/form.ts#L455)), add `targets.update` when `programmaticWrites(first)` returns a function, beside the existing `passes` branch. Return `installWork: (tools: HarnessTools): string[] => countActions(tools, first)`.
    - Update `buildForm`'s and `clickTarget`'s docs to name the new `root` mode and the `update` target.
29. **`packages/qa/src/panels/form-flat.ts`** — in `description` ([`:4`](packages/qa/src/panels/form-flat.ts#L4)), replace `and C23 (DateField accepts partial dates and flashes its border while typing) under type=date.` with `C23 (DateField accepts partial dates and flashes its border while typing) under type=date; and C40 (a Checkbox or Slider announcing action for a programmatic write, and a Checkbox for a click outside its box) under drive=update and click=root, read through the checkbox.action and slider.action counters under work=1.` The string is single-quoted, so the new text carries no quote or apostrophe.
30. **Check** — `npm run build:lib`, then `npm -w packages/qa run typecheck` (0 errors) and `npm -w packages/qa test` (all green; cases 22 and 23 pass).

### Phase 5 — documentation and records

31. Apply every change listed in `## Documentation Impact`.
32. **Check** — `npm run docs:api` shows no warning beyond master's 14 pre-existing ones, and none naming `Checkbox`, `Slider`, `AbstractBooleanInput` or `VideoPlayer`. `npm run docs:llms:check` passes. `npm run lint`: 0 errors. `grep -rn 'fireAction' packages/ --include=*.ts --include=*.md`: zero matches outside `node_modules`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/input/Checkbox.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/AbstractBooleanInput.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Slider.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/editor/Boolean.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Body.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/VideoPlayer.ts` |
| Modify | `packages/lib/tests/component/input/Checkbox.test.ts` |
| Modify | `packages/lib/tests/component/input/RadioButton.test.ts` |
| Modify | `packages/lib/tests/component/input/Slider.test.ts` |
| Modify | `packages/lib/tests/component/display/VideoPlayer.test.ts` |
| Modify | `packages/lib/tests/component/table/cell/BooleanCell.test.ts` |
| Modify | `packages/lib/tests/component/table/cell/editor.test.ts` |
| Modify | `packages/lib/tests/component/table/CellLayoutSkip.test.ts` |
| Modify | `packages/lib/tests/component/table/RotatedView.test.ts` |
| Modify | `packages/lib/tests/component/table/QuickSearch.test.ts` |
| Modify | `packages/qa/src/builders/form.ts` |
| Modify | `packages/qa/src/panels/form-flat.ts` |
| Modify | `packages/qa/tests/mount.test.ts` |
| Modify | `packages/qa/README.md` |
| Modify | `ARCHITECTURE.md` |
| Modify | `packages/lib/docs/concepts/events.md` |
| Modify | `packages/lib/docs/components/Checkbox.md` |
| Modify | `packages/lib/docs/components/Slider.md` |
| Modify | `packages/lib/docs/components/RadioButton.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/docs/reference/migration/next.md` |
| Modify | `plans/research/render-review-2026-09-15/01-phase2-status-pass.md` |
| Modify | `plans/research/render-review-2026-09-15/99-synthesis.md` |

---

## Expected Behaviour

Cases 1–21 are unit-testable offline in `packages/lib`. Cases 22–23 are offline QA tests, which need `npm run build:lib` first. Cases 24–27 are manual: they need the QA app, which opens a full-screen window, so only the user runs them. "Mounted" means the element is realised under a host `Container` and `Event`'s window listeners were purged first.[^event-window] "An action" means one call of a listener registered with `on("action", …)`.

**`Checkbox`, mounted (Phase 1)**

1. A click on the box of an unchecked checkbox leaves `isSelected()` true and delivers one action. The listener's event has `type === "change"`.
2. Space (`keydown`, `key: ' '`) on the root toggles the checkbox and delivers one action.
3. A click on the box of an indeterminate checkbox leaves it selected and not indeterminate, and delivers one action.
4. A click on the checkbox's root element — the dead area, where a label click lands — leaves `isSelected()` unchanged and delivers zero actions.
5. On a disabled checkbox, a click on the box and a click on the root each leave the state unchanged and deliver zero actions. On a read-only checkbox, a click on the box delivers zero.
6. `setSelected(true)`, then `setValue(false)`, then `setIndeterminate(true)` deliver zero actions in total. `"change"` fires twice, once for each of the two value writes.
7. On a click on the box, listeners run as `change`, `binding`, `action`. Inside the `"action"` listener, `isSelected()` already returns the new value.
8. After `off("action", fn)`, a click on the box still toggles and delivers zero actions to `fn`.

**`Checkbox`, after the deletion (Phase 2)**

9. On a mounted checkbox, `setSelected(true)` records zero `dispatchEvent` writes of any type, and still fires `"change"` once with `true` and `"binding"` once.
10. On an unmounted checkbox, `setSelected(true)` flips the state, fires `"change"` once, and calls `console.warn` zero times.
11. On an already-selected, not-indeterminate checkbox, `setSelected(true)` fires no `"change"` and no `"binding"`, and records zero `dispatchEvent` writes.

**Boolean table cell**

12. On a mounted `BooleanCell` holding `false`, a click on its checkbox's box fires the cell's `"commit"` exactly once, with `true`. This passes before and after the change; it pins the editor's user-toggle path.
13. `cell.setValue(true)`, `cell.setValue(false)` and `cell.setValue(null)` fire zero commits and record zero `dispatchEvent` writes of any type.
14. `cell.startEdit()` fires one commit. This is already covered at [`BooleanCell.test.ts:123-136`](packages/lib/tests/component/table/cell/BooleanCell.test.ts#L123); keep it.

**`Slider`**

15. On an unmounted slider, `setValue(30)` does not throw, leaves `getValue()` at 30, and fires `"change"` once. (Today it throws `Cannot fire event 'input'`.)
16. On a mounted slider, `setValue(20)` delivers zero actions, records zero `dispatchEvent` writes of type `input`, and fires `"change"` once.
17. On a mounted slider built with `{ min: 0, max: 100, step: 1, value: 10 }`, `ArrowRight` moves the value to 11 and delivers one action. A first `End` moves it to 100 and delivers one more action; a second `End` delivers none.
18. Positioned as in step 19, a `pointerdown` at `clientX: 100` sets the value to 50 and delivers one action. A `pointermove` to `clientX: 150` sets 75 and delivers one more. A second `pointermove` to `clientX: 150` delivers none.
19. After `setEnabled(false)`, `Home` leaves the value unchanged and delivers zero actions.

**`VideoPlayer`**

20. On a mounted player, `syncFromState({ currentTime: 30, duration: 120, … })` calls `_video.setCurrentTime` zero times, leaves `_scrubbing` false, and records zero `dispatchEvent` writes of type `input`. (Today one `input` is recorded.)
21. After that sync, `ArrowRight` on the scrubber calls `_video.setCurrentTime` once with `31` and sets `_scrubbing` true.

**QA, offline**

22. `mountPanel('form-flat', 'n=3&click=nope', …)` rejects with `form-flat: unknown click "nope" (expected toggle, root, combo)`, before any wait runs.
23. `form-flat` built at `n=8` has a function `update` target; built at `n=7` it has none. Calling the `n=8` target once, unmounted, does not throw. (Today `Slider.setValue` throws there.)

**QA, manual — the witness (the user runs these; see `## Verification`)**

Units must be an even count wherever a figure is given as 0.50.

24. `form-flat`, `drive=update&seam=1`: `seam.sink.dispatchCustomEvent` reads **2.00 per unit before, 0 after**. Before the fix, each unit dispatches one synthetic `click` from `Checkbox.setSelected` and one `input` from `Slider.setValue`. With `work=1` added, `checkbox.action` and `slider.action` each read **1.00 before, 0 after**.
25. `form-flat`, `drive=click&click=root&work=1`: `checkbox.action` reads **1.00 per unit before, 0 after**. The checkbox's state never changes on either arm, and `seam.sink.dispatchCustomEvent` (with `seam=1`) reads 0 on both.
26. `form-flat`, `drive=click&click=toggle&seam=1&work=1`: `seam.sink.dispatchCustomEvent` and `checkbox.action` each read **0.50 per unit on both arms**. The two arms dispatch a different event: a synthetic `click` before, a DOM `change` after. Every checkbox unit toggles it and announces once; every toggle unit toggles the `Toggle` and dispatches nothing.
27. `form-flat`, `drive=pan&work=1`: `slider.action` per unit is **the same on both arms**.

---

## Verification

- `npm run typecheck` — 0 errors, after each phase.
- `npm test` — all green, after each phase; cases 1–21 are the new coverage.
- `npm run lint` — 0 errors.
- The grep checks in steps 18, 26 and 32.
- `npm run build:lib`, then `npm -w packages/qa run typecheck` and `npm -w packages/qa test` — cases 22–23.
- `npm run docs:api` — no warning beyond `master`'s 14 pre-existing ones. The bar is "no new warning", not zero.
- `npm run docs:llms:check` — passes. No class summary line changes, so `llms.txt` needs no regeneration.
- **Manual, QA app — only the user runs this; never run `packages/qa/runqa.sh`, MiniBrowser or the Tauri host yourself.** Cases 24–27 compare two library builds under the same, reworked panel:
  - Build the base commit as the `wt` arm, following [`packages/qa/README.md:87-98`](packages/qa/README.md#L87) (`QA_WT_LIB`).
  - Run from this branch's checkout: `wt` is the before arm, `main` the after arm.
  - Record the results in `packages/qa/README.md`'s *Validated* cell for `form-flat`.

---

## Documentation Impact

**TSDoc** (written in steps 4, 6, 7, 8, 14, 22 and 24; the public members' docs render through TypeDoc): `Checkbox.activate`, `Checkbox.setSelected`, `Checkbox.on`, `AbstractBooleanInput`'s class summary, `Slider.setValue` and `Slider.on`. No new public symbol is exported, so no barrel or catalogue entry changes.

**ARCHITECTURE.md**

- [Line 19](ARCHITECTURE.md#L19), in the list of `"action"` shorthands: `Checkbox.on("action", fn)` becomes "(DOM `change`)". `ComboBox.on("action", fn)` becomes "(an alias of its `ListenerBag` `"change"`)".[^architecture-combobox]
- New paragraph directly after line 19:

  > **`"action"` reports the user's own activation.** It fires once per user gesture the control acts on. It never fires for a programmatic write — a setter call or a `Binding` update — nor for a gesture the control ignores, such as a click on a checkbox's label or on a disabled control. A control whose activation changes its value therefore fires the DOM event its shorthand wraps from its activation path — `RadioButton.activate`, `ToggleButton`'s click handler, `Checkbox.activate`, `Slider`'s pointer and keyboard handlers — never from its value setter. A consumer that must also hear programmatic writes subscribes to `"change"`. The one sanctioned programmatic source is an explicit act-as-the-user verb (`Button.click()`, `Link.click()`). `List.setSelectedIndex` and `ComboBox.setSelectedIndex` are a known deviation: their default path still announces `"action"`, and they are to be brought in line by their own change.

**Doc pages**

- [`docs/concepts/events.md:23-44`](packages/lib/docs/concepts/events.md#L23):
  - In the example sentence, make `ComboBox.on("action", fn)` an alias of its `"change"`.
  - Replace the paragraph at `:32-44` with the consumer-facing form of the ARCHITECTURE.md rule: `"action"` means the user acted; subscribe to `"change"` for every committed change; `Button.click()` / `Link.click()` act as the user.
  - Name `List.setSelectedIndex` / `ComboBox.setSelectedIndex` as the exception, whose second argument `false` keeps a programmatic selection silent.
- [`docs/components/Checkbox.md`](packages/lib/docs/components/Checkbox.md):
  - Row `:28` becomes `isSelected()` / `setSelected(boolean)`: read / write checked state; a programmatic write fires `"change"` and `"binding"`, never `"action"`.
  - Row `:36` becomes: subscribe to the user's own toggles — a click on the box, or Space; never fires for `setSelected` / `setValue`, a click on the label, or a disabled checkbox.
  - Rewrite the *Programmatic writes and `action`* section (`:42-51`): `"action"` reports the user's own toggle only; a click on the label or beside the box changes nothing and announces nothing; subscribe to `"change"` to hear every change.
  - Give the section this example, and cross-link `RadioButton`, `ToggleButton` and `Slider` as following the same contract:

    ```typescript
    cb.on("action", () => console.log("user toggled:", cb.isSelected()));
    cb.on("change", on => console.log("now:", on));

    cb.setSelected(true); // "change" and "binding" only
    ```
- [`docs/components/Slider.md`](packages/lib/docs/components/Slider.md):
  - Add a method-table row after `on("binding", fn)` (`:37`): `on("action", fn)` — subscribe to the user's value steps (each drag sample or value key that moves the thumb); never fires for a programmatic `setValue`.
  - Rewrite the Notes bullet at `:54` to say `"change"` covers the user's steps and your own `setValue` calls, while `"action"` carries the user's per-step drag and key stream alone.
- [`docs/components/RadioButton.md:50`](packages/lib/docs/components/RadioButton.md#L50) — replace the last sentence ("[`Checkbox`] differs here …") with: [`Checkbox`](/components/Checkbox) and [`Slider`](/components/Slider) follow the same contract.
- `docs/reference/changelog/next.md`:
  - **Delete** the `## Added` entry for `fireAction` ([`:189-199`](packages/lib/docs/reference/changelog/next.md#L189)).
  - Add under `## Breaking changes` → `### Components`, after the `WindowBorder` bullet ([`:30-35`](packages/lib/docs/reference/changelog/next.md#L30)): **`Checkbox` and `Slider` fire `"action"` for the user's own activations only.** State the old behaviour (programmatic and `Binding` writes announced it; so did a click on a checkbox's label, the space beside its box, or a disabled checkbox) and the new one. Say that a checkbox's listener now receives a DOM `change`, not a `click`. Link [Migration](/reference/migration/next).
  - Add under `## Fixed` → `### Components` ([`:710`](packages/lib/docs/reference/changelog/next.md#L710)): `Slider.setValue` no longer throws before the slider is mounted, and `Checkbox.setSelected` no longer logs a warning there. No consumer action is needed.
  - In the existing *boolean table cell no longer commits twice* entry ([`:721-730`](packages/lib/docs/reference/changelog/next.md#L721)), replace "The editor's programmatic writes now opt out of the checkbox's `"action"` fan-out" with "A checkbox now announces `"action"` for a user toggle only, so the editor's own programmatic writes never reach it".
- `docs/reference/migration/next.md` — append a section **`Checkbox` and `Slider` fire `"action"` for user activations only**, in the page's *What changed and why* / *Who needs to act* shape:
  - *Who needs to act:* a consumer that relied on `"action"` after its own `setSelected` / `setValue`, or after a `Binding` write, subscribes to `"change"` instead. A listener that read the event object sees a DOM `change` on a checkbox.
  - Give a before/after example: `cb.on("action", syncPreview)` becomes `cb.on("change", syncPreview)`.
  - No section for `fireAction`: it never shipped.[^fireaction-commit]

**QA README** — [`packages/qa/README.md:322`](packages/qa/README.md#L322), the `form-flat` row:

- *Drivers and parameters* cell:
  - Add `update` ("one programmatic write per unit: flips the first checkbox and moves the first slider one step off its start and back").
  - `click=toggle` becomes "the first toggle's track and the first checkbox's box — the surface each one toggles from".
  - Add `root` ("the first checkbox's own element, outside its box — where a click on its label lands").
  - The closing note becomes "a slider, and so `update`, needs `n` ≥ 8".
  - Add a sentence: `work=1` adds `checkbox.action` and `slider.action`, one per `"action"` delivered.
- *Reproduces* cell: replace the C34 sentence ("C34: `click` with `click=toggle&seam=1` gives the same …") with the text below. Leave *Validated* untouched.

  > C40: `update` with `seam=1` gives `seam.sink.dispatchCustomEvent` 2.00 per unit before the fix — a synthetic `click` from `Checkbox.setSelected` and an `input` from `Slider.setValue` — and 0 after; with `work=1`, `checkbox.action` and `slider.action` read 1.00 each before and 0 after. `click` with `click=root&work=1` gives `checkbox.action` 1.00 per unit before, for a click that changes nothing, and 0 after. C34 and C40's user side: `click` with `click=toggle&seam=1&work=1` over an even count gives `seam.sink.dispatchCustomEvent` and `checkbox.action` 0.50 each per unit on both arms — one announcement per checkbox toggle, a synthetic `click` before and a DOM `change` after — unlike the pooled rebind in `table-rows`; `pan` with `work=1` gives the same `slider.action` on both arms.

**Records**

- `plans/research/render-review-2026-09-15/01-phase2-status-pass.md`:
  - C34's row ([`:73`](plans/research/render-review-2026-09-15/01-phase2-status-pass.md#L73)): append "`fireAction` itself removed by `plans/implemented/checkbox-action-activation.md`, which made `"action"` user-only (C40)".
  - C34's row in *Tests that pin the current, wrong behaviour* ([`:225`](plans/research/render-review-2026-09-15/01-phase2-status-pass.md#L225)): append "inverted by the C40 fix: a programmatic `setSelected` now dispatches nothing".
  - The C40 paragraph ([`:322-338`](plans/research/render-review-2026-09-15/01-phase2-status-pass.md#L322)): append a bold **Fixed by `plans/implemented/checkbox-action-activation.md`** note, dated the day it lands, in the style of C37's. Say that `form-flat`'s old `click=toggle` witness never toggled anything, because it clicked each control's root.
  - The `Slider.setValue` bullet ([`:393-394`](plans/research/render-review-2026-09-15/01-phase2-status-pass.md#L393)): append "Fixed by the same plan: `setValue` no longer fires `"action"`; no opt-out was needed".
  - Add a new bullet after it: **`List.setSelectedIndex` and `ComboBox.setSelectedIndex` still announce `"action"` on their default path**. Name it the last deviation from ARCHITECTURE.md's `"action"` rule. Say why it needs its own plan: the same flag also gates `"change"`, which live callers rely on, and `ComboBox`'s `"action"` is an alias of its `"change"` that passes listeners the value.[^list-combo]
- `plans/research/render-review-2026-09-15/99-synthesis.md` — C34's row ([`:921`](plans/research/render-review-2026-09-15/99-synthesis.md#L921)): append a bold "`fireAction` was removed again by `plans/implemented/checkbox-action-activation.md` (C40): `"action"` now fires for user activations only, so no programmatic write needs an opt-out".

---

## Potential Challenges

- **A zero can pass for the wrong reason.** `Event` keeps each event type's window listener bound to the first test's window, so a later case can have nothing listening.[^event-window] Every new mounted `describe` purges first, and each contains a positive case that must read 1, which proves delivery works in that block.
- **`noUnusedParameters` in Phase 1.** Keep the `if (!fireAction) { return this; }` early return until step 14. Removing it early leaves an unused parameter and fails the build.
- **A test click reaching `Body.onSubtreeClick` throws under node**, where `MouseEvent` is undefined. No new test mounts a `Table` body, so the guard is never reached. Keep it that way.
- **The QA "before" arm must run the reworked panel.** `master`'s own panel has neither `update` nor `click=root`, so the base library is built as the `wt` arm and run from this branch's checkout.
- **`.CheckboxBox` / `.ToggleTrack` lookups depend on class names surviving the build.** The library build keeps names (`keepNamesMinify`, [`packages/lib/vite.lib.config.ts:104`](packages/lib/vite.lib.config.ts#L104)), and `.TabButton` / `.DiagramNodeLayer` lookups already rely on that.
- **`doc-and-qa-record-drift` edits the same QA files and README row.** Whichever lands second rebases onto the other; `click=` and `update` are additive, so the conflict is textual.

---

## Critical Files

| File | Why |
|---|---|
| [`lib/component/input/RadioButton.ts:324-336`, `:435-480`](packages/lib/src/typescript/lib/component/input/RadioButton.ts#L324) | The precedent: `activate()` fires the DOM `change` that `on("action")` listens for; `setSelected` stays silent. |
| [`lib/component/button/ToggleButton.ts:87`, `:137-142`, `:278-285`](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L87) | The same precedent on the button side. |
| [`lib/component/input/AbstractBooleanInput.ts:140-192`](packages/lib/src/typescript/lib/component/input/AbstractBooleanInput.ts#L140) | The enabled / read-only guard in front of `activate()`, which keeps disabled checkboxes silent. |
| [`lib/component/input/Checkbox.ts`](packages/lib/src/typescript/lib/component/input/Checkbox.ts) | The whole file is in scope. |
| [`lib/component/input/Slider.ts:238-262`, `:384-426`, `:523-623`](packages/lib/src/typescript/lib/component/input/Slider.ts#L238) | `setValue`, the `on` / `off` pair and the eight user-path call sites. |
| [`lib/core/Event.ts:248-300`, `:386-411`](packages/lib/src/typescript/lib/core/Event.ts#L248) | Exact-target matching, and `fireEvent`'s throw on a missing element. |
| [`lib/component/table/cell/editor/Boolean.ts`](packages/lib/src/typescript/lib/component/table/cell/editor/Boolean.ts) | The one in-library `Checkbox` `"action"` subscriber. |
| [`lib/component/display/VideoPlayer.ts:158-180`, `:575-600`, `:655-700`](packages/lib/src/typescript/lib/component/display/VideoPlayer.ts#L158) | The one in-library `Slider` `"action"` subscriber, and its `_syncing` guard. |
| [`tests/component/input/RadioButton.test.ts:114-196`](packages/lib/tests/component/input/RadioButton.test.ts#L114) | The event-window purge and mount ritual to copy. |
| [`packages/qa/src/builders/form.ts`](packages/qa/src/builders/form.ts), [`builders/dom.ts`](packages/qa/src/builders/dom.ts), [`harness/types.ts:130`, `:178`](packages/qa/src/harness/types.ts#L130) | The witness's builder, element lookups, `CallTarget` and `bumpWork`. |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) (*Event handling*) | The two event surfaces and the `"action"` shorthand rule this plan extends. |

---

## Non-Goals

- **Changing `List` / `ComboBox`'s `setSelectedIndex` fan-out.** It is recorded as a follow-up.[^list-combo]
- **Making a click on a checkbox's label toggle it.** The box is deliberately the only toggle surface ([`Checkbox.ts:328-334`](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L328)); this plan only stops such a click from announcing an `"action"`.
- **Giving `Toggle` an `"action"` event.** `Toggle` exposes only `"change"` / `"binding"`, which no consumer has asked to change.
- **An act-as-the-user verb for `Checkbox` or `Slider`**, like `Button.click()`. No consumer needs one.
- **Changing `RadioButton`, `ToggleButton`, `TextInput`, `NumberSpinner`, `SpinButton` or `Link`.** Their `"action"` already follows the rule (see the addendum).
- **Removing `Body.onSubtreeClick`'s guard**, or the `active: false` fixtures in `RotatedView` / `QuickSearch` / `RowVisibility` tests.
- **Running the QA app.** The plan states what the user-run check must read.

---

## Addendum: Consumer survey

Every row was found with a type-aware `ts-morph` scan and cross-checked by grep. The scan matched `on` / `off` calls with `"action"`, `setSelected` / `setValue` / `setSelectedIndex` calls, `listeners: { action }` bags and raw `Event.*Listener` calls, each by receiver type. It covered `packages/lib` (library, demo app, tests), `packages/docs`, `packages/qa`, `packages/create-app`, Loom (`src`, which links this checkout's `packages/lib`) and SQLAdmin (`frontend/src`, on the 0.9.0 package).

**`Checkbox` `"action"` subscribers:** exactly one. `lib/component/table/cell/editor/Boolean.ts:44` (`BooleanEditor`) wants user toggles only; it passes `false` at both of its programmatic sites (`:125`, `:167`). No docs demo, demo-app panel, QA panel, Loom or SQLAdmin code subscribes. Loom's two checkboxes (`src/explorer/SearchPanel.ts:236-237`) and SQLAdmin's thirteen use `"change"` or read `getValue()`. No code anywhere calls `Event.addListener` on a checkbox, and none subclasses it.

**Programmatic `Checkbox` writes:**

- `BooleanEditor` ×2.
- `AbstractBooleanMenuRow.setChecked` → `getControl().setValue` (`:99`). The row listens on itself; the synthetic click never reached it.
- `core/Binding.ts:101`, through `Bindable.setValue`.
- The docs `checkbox-states` demo (`:38`, `:45`; no `"action"` listener).
- SQLAdmin `SequenceInfoPanel.ts:267` and `filteredDiagramShell.ts:70`, both listening on `"change"` only.

**`Slider` `"action"` subscribers:**

- `lib/component/display/VideoPlayer.ts:660`, the scrubber. It hand-guards programmatic writes out with `_syncing` (`:678`).
- The docs `slider-range` demo (`:34`) and the demo app's `LayoutTestPanel.ts:89` and `SplitPanel.ts:74`. All three update a readout from user drags and never call `setValue`.

Loom and SQLAdmin have no slider.

**Programmatic `Slider` writes:** `VideoPlayer.syncFromState` (`:586`, `:592`), which runs on every media `timeupdate` and `volumechange`. Each changed value dispatches a DOM `input` that `_syncing` then discards. There are no others outside tests.

**Every control that exposes `"action"`, checked against the rule:**

| Control | Shorthand wraps | Fired from | Programmatic write fires it? | Fires with no state change? |
|---|---|---|---|---|
| `Button`, `SpinButton` | DOM `click` on the root (inner parts `pointer-events: none`) | a real click; `Button.click()` | only the explicit `click()` verb | no |
| `ToggleButton` | DOM `change` | `onAction` on the root's click | no | no |
| `RadioButton` | DOM `change` | `activate` | no | no |
| `Checkbox` (today) | DOM `click` on the root | `setSelected`'s synthetic click | **yes** | **yes** (root, label, disabled root) |
| `Toggle` | — (no `"action"`) | — | — | — |
| `Slider` (today) | DOM `input` | `setValue` | **yes, no opt-out** | no |
| `TextInput` family | native `input` | keystrokes; `cut()` / `paste()` | no (`setText` is silent) | no |
| `NumberSpinner` | — (no `"action"`) | — | — | — |
| `Link` | DOM `click` | a real click; `Link.click()` | only the explicit `click()` verb | no |
| `List` / `MultiSelectList` | DOM `change` | user reducers via `fireChange`; `setSelectedIndex` | **`setSelectedIndex(idx)` default** | no |
| `ComboBox` | alias of `ListenerBag` `"change"` | dropdown commit; `setSelectedIndex` | **`setSelectedIndex(idx)` default** | no |

Only `Checkbox` has the binding defect: a listener on the root while the user's click lands on an inner element. `ToggleButton` and `Button` receive clicks on their own roots, because their inner parts pass pointer events through. `Slider`'s children do the same.

---

## Notes

[^witness-zero]: The C34 check (`click=toggle&seam=1`) read 0 `dispatchCustomEvent` on both arms because it toggled nothing, not because of how `"action"` is bound. The `click` driver dispatches its `MouseEvent` straight onto each target element ([`packages/qa/src/harness/drivers.ts:828-832`](packages/qa/src/harness/drivers.ts#L828), [`harness/dom.ts:128-133`](packages/qa/src/harness/dom.ts#L128)) with no hit test. `clickTarget` handed it each control's root ([`builders/form.ts:407-416`](packages/qa/src/builders/form.ts#L407)). `Checkbox` toggles only from `_box` ([`Checkbox.ts:335`](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L335)) and `Toggle` only from `_track` ([`Toggle.ts:191`](packages/lib/src/typescript/lib/component/input/Toggle.ts#L191)), so no unit changed any state. No state change means no synthetic click, on either side of C34. Measured offline on `master` `f0d95ef8`: a root click leaves both controls unchanged, and a box / track click toggles them. C40's dead-area face was present in that run, but only as an in-process call to root listeners, and the form registered none; it never reaches the DOM seam. The reworked witness therefore needs a listener (`work=1`'s counters) to show that face, and a programmatic `update` to show the fan-out as a seam count.

[^survey]: The full survey is in `## Addendum: Consumer survey`. The facts that decide the question: the only `Checkbox` `"action"` subscriber, `BooleanEditor`, already opts out at every programmatic write it makes. The only in-library `Slider` subscriber, `VideoPlayer`'s scrubber, hand-rolls `_syncing` to drop the `"action"` its own `syncFromState` writes cause, the same shape C34 removed from `BooleanEditor` as `_suppressCommit`. The three demo `Slider` subscribers only ever see user drags. No subscriber anywhere wants a programmatic write announced as `"action"`. The rule also matches every sibling that already follows it (`RadioButton`, `ToggleButton`, `TextInput`) and `List`'s own documentation ("fired only on user-driven … selection changes, never on programmatic `setValue` / `setValues`", [`AbstractSelectableList.ts:1546-1550`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1546)).

[^alternative]: The rejected alternative is to keep programmatic fan-out as the default, keep `Checkbox.setSelected`'s `fireAction`, and add `Slider.setValue(value, fireAction = true)`. What it would cost: (1) It still needs this plan's change of DOM type and firing site to fix the real-click and dead-area faces of C40, so it saves no work. (2) Two public parameters would default to behaviour that no current consumer wants, and every internal programmatic caller (`BooleanEditor` ×2, `VideoPlayer` ×2) would have to remember to pass `false`. (3) A `Binding` write cannot pass the flag, because `Bindable.setValue(value)` takes one argument, so a bound checkbox or slider would keep announcing `"action"` whenever its model changes, with no way out. (4) `Checkbox` and `Slider` would keep meaning the opposite of `RadioButton` and `ToggleButton` by the same event name. What it would buy: a consumer that wants a programmatic write announced keeps it without subscribing to `"change"`. The survey found no such consumer.

[^why-change-type]: A `click`-typed listener on the root cannot tell the checkbox's own announcement from a real user click that happens to land on the root. `Event` delivers a direct listener whenever the event's target is the root, whatever dispatched it. So as long as `"action"` listens for `click` on the root, a click on the label (which passes pointer events through), on the gap beside the box, or on a disabled checkbox's root reaches `"action"`. Only a type that no user gesture produces on a `<div>` can carry the announcement alone. DOM `change` is the type `RadioButton`, `ToggleButton` and `List` already use for exactly this. The alternative of registering `"action"` on the box (`_box`) instead would reach past the component's own element, which ARCHITECTURE.md's `Event`-on-self rule forbids. It would also still need a second listener for Space, which lands on the root.

[^unmounted-throw]: `Event.fireEvent` throws when the component has no element ([`core/Event.ts:399-404`](packages/lib/src/typescript/lib/core/Event.ts#L399)). So today `new Slider().setValue(5)` sets the value, fires `"change"`, and then throws `Cannot fire event 'input'` (measured offline on `master` `f0d95ef8`). The test file's own header documents this, and `VideoPlayer.test.ts` realises the player's element before every `syncFromState` because of it. `Checkbox` guarded the same call with a `getElement()` check and a `console.warn`. Moving the dispatch into the user path removes both, because a user gesture can only reach a mounted control.

[^fireaction-commit]: `fireAction` was added after the last release: `git show v0.9.0:…/Checkbox.ts` has no `fireAction`, and its only changelog entry sits in the unreleased `next.md`. No released version ever had it, so deleting it breaks no consumer, and the entry is removed rather than answered with a migration note. The user's pre-1.0 policy puts a deletion in its own commit, never folded into a feature commit. Phase 1 therefore changes where `"action"` comes from and leaves the synthetic click and its switch in place, harmless because nothing listens for it (`Body.onSubtreeClick` already filters synthetic clicks). Phase 2 is then a pure deletion that could be reverted on its own. Merging the phases would be simpler, but it would bury the deletion inside the behaviour change the policy wants kept visible.

[^list-combo]: Two things make these a separate change. First, their flag is a different contract: `setSelectedIndex(idx, fireEvent)` gates the committed-value `"change"` and `"binding"` as well as `"action"`, and its live callers want the `"change"` half. SQLAdmin's `QueriesView.ts:258`, `:311` pass `true` to arm its tools through `list.on("change")`, and `ComboBox`'s own dropdown commit passes `true` ([`ComboBox.ts:1082`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L1082)). Second, `ComboBox`'s `"action"` is not a DOM event at all but an alias of its `"change"`, which hands listeners the value: the demo app's `ToolBarPanel.ts:83` reads `(value: string)`. Making it user-only means giving it its own dispatch and changing its listener's argument. Changing `List` alone would split the selection family down the middle. Neither class has C40's binding defect; both deviate only on the programmatic side, through a documented flag whose `false` already silences them.

[^body-guard]: After Phase 2 no library control dispatches a `click` as a side effect of a state change. The guard's original reason (the pooled-rebind burst) and its C34 reason (the user-toggle echo) are both gone. It still filters a programmatic `click` from any control hosted in a cell — `Button.click()` and `Link.click()` both dispatch one ([`Button.ts:2028`](packages/lib/src/typescript/lib/component/button/Button.ts#L2028), [`Link.ts:262`](packages/lib/src/typescript/lib/component/input/Link.ts#L262)). Without the guard, such a call would select the row. It costs one `instanceof` per click, so it stays with the reason it has now.

[^event-window]: `Event` installs one window-level listener per event type on first registration and remembers it across `installTestDOM` calls. A test file's later cases can then dispatch to a window nobody listens on, and every "zero actions" assertion would pass vacuously. The C34 implementation hit exactly this in `BooleanCell.test.ts`. Purging `Event._registeredComponentIds()` through `Event.purgeComponent` before building the component re-installs the listener against the current window. `RadioButton.test.ts:124-130` and `Slider.test.ts:289-295` already do this.

[^architecture-combobox]: ARCHITECTURE.md's list currently calls `ComboBox`'s shorthand "(DOM `change`)", but [`ComboBox.on`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L1131) forwards `"action"` to its `ListenerBag` `"change"` and never touches the DOM. The new paragraph names `ComboBox` as the rule's one deviation, so the parenthetical in the same list is corrected in the same edit. Otherwise the file would describe the class two ways.

---

## Implementation Notes

**The QA witness is pending a user run.** Cases 24–27 were not run in-engine: they need the QA app, which opens a full-screen window, so only the user runs them (see `## Verification`). Everything offline passed: `npm run typecheck` 0 errors; `npm test` all green (482 files, 8021 tests); `npm run lint` 0 errors; `npm run docs:api` 14 warnings, the same 14 as the start point, none naming `Checkbox`, `Slider`, `AbstractBooleanInput` or `VideoPlayer`; `npm run docs:llms:check` OK; `npm run build:lib`, then `npm -w packages/qa run typecheck` 0 errors and `npm -w packages/qa test` all green (246 tests, cases 22 and 23 included). Every grep check in steps 18, 26 and 32 came out as the plan states. The `packages/qa` typecheck in a worktree still reads the main tree's `.d.ts` through `node_modules` (the limitation `test-suite-health` recorded); its tests resolve this checkout's build.

**Deviations, all minor:**

- **Case 5 is two `it`s**, one for the disabled checkbox and one for the read-only one. Mounting a second checkbox inside one case reinstalls the TestDOM mid-case, which would leave the first one's listeners on a dead window.
- **One documentation commit, not one per code commit.** The three code commits change one consumer-visible rule, and the changelog's new *Fixed* entry covers both setters. The `fireAction` changelog entry is removed in that same commit.
- **Commit buckets for the non-library files.** The QA witness — `form.ts`, `form-flat.ts`, `mount.test.ts` and the QA README row — is one tooling commit, since `packages/qa` does not ship to consumers. `ARCHITECTURE.md` is its own tooling commit. The two research records ride in this bookkeeping commit with these notes.
- **The changelog's new *Fixed* entry** sits directly after the boolean-table-cell entry it is related to.
- **`Slider.test.ts:248-250`** needed no rewrite: that comment only gives the drain-and-pause reasoning and never mentioned `fireEvent`.
- **`RowVisibility.test.ts`'s comment is unchanged.** The plan does not list it. It defers to `RotatedView.test.ts`'s comment, which now explains that the gap is gone.
- **`plans/in-progress/` did not exist** on the start point, so it was created for the plan move.
