---
touches-shared:
  - packages/lib/src/typescript/lib/component/input/Slider.ts
---

# Activation After Dispose — Implementation Plan

## Overview

Four interactive controls end a user activation by dispatching a DOM event, and none of them re-checks that the control still has an element first: [`Checkbox.ts:407`](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L407), [`RadioButton.ts:334`](packages/lib/src/typescript/lib/component/input/RadioButton.ts#L334), [`ToggleButton.ts:284`](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L284) and [`Slider.ts:636`](packages/lib/src/typescript/lib/component/input/Slider.ts#L636). Between the state write and the dispatch, each one runs arbitrary consumer code — a `"change"` or `"binding"` listener — and that code may dispose the control. A form rebuilt when the record it edits changes does exactly this, and it is ordinary application code.

When a listener does dispose the control, [`Event.fireEvent`](packages/lib/src/typescript/lib/core/Event.ts#L410) throws `Cannot fire event '<type>'. Component '<id>' is not in the DOM.`, because the disposed control's `getElement()` now returns nothing. The throw escapes the control, escapes the library's single window-level dispatcher, and ends that event's dispatch: every listener the dispatcher had not yet reached is skipped, and the browser reports an uncaught error.

This plan adds the missing element check at all four sites, so an activation whose own listener disposed the control commits the state, skips the dispatch, and returns quietly. The check is the guard the old `Checkbox.setSelected` path carried until commit `283cc5f0` removed it along with the dispatch it protected, and the one [`AbstractSelectableList.fireChange`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1764) still carries today. No public API changes; no `"action"` contract changes. Recorded as an open advisory by the phase-2 post-merge audit ([`00-post-campaign-agenda.md:284`](plans/research/render-review-2026-09-15/00-post-campaign-agenda.md#L284)), which asks for all four to be fixed together.

---

## Architecture Decisions

### The guard is an inline element check at each of the four sites

Each site becomes `if (this.getElement()) { Event.fireEvent(…); }`, written in place. No shared helper, no base-class method, no change to `Event.fireEvent` itself.[^why-inline]

This mirrors [`AbstractSelectableList.fireChange`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1764), which reads the element and dispatches only when it is there, and it restores the shape `Checkbox.setSelected` used before its own dispatch was deleted.

### A skipped dispatch is silent

When the element is gone the control dispatches nothing and logs nothing. A listener disposing the control it is listening to is supported application behaviour, not a programming error.[^why-silent]

### `Event.fireEvent` keeps throwing

`Event.fireEvent` still throws for a component with no element. The throw is its documented contract and the signal that a caller dispatched at the wrong time; callers that have a legitimate reason to dispatch late are the ones that check.[^why-keep-throwing]

### The regression tests run under the real DOM, in one file

All cases live in one new file, `packages/lib/tests/component/activation-after-dispose.test.ts`, carrying the `// @vitest-environment jsdom` pragma and running against the production `DOM.sink` / `DOM.source` pair.

The modelled test DOM cannot express this bug. `RecordingDOMSink.removeElement` clears a handle's parent but leaves it in the id index, so `DOM.source.getElementById()` still answers after a dispose and `getElement()` still returns a handle — every assertion here would pass against the unfixed code.[^why-jsdom] [`tests/component/display/MarkdownHeadingScoping.test.ts`](packages/lib/tests/component/display/MarkdownHeadingScoping.test.ts) is the precedent for a component-level suite that keeps the pragma for exactly this reason; [`tests/dom/event-subtree-reentrant-dispose.test.ts`](packages/lib/tests/dom/event-subtree-reentrant-dispose.test.ts) is the precedent for driving a dispose from inside a live dispatch and catching what the browser reports.

One file rather than four: the four controls sit in two directories (`component/input/` and `component/button/`) and share one rule, so the suite belongs beside the other cross-cutting teardown suites at the root of `tests/component/`.

---

## Internal Structure

The four guarded bodies, in full. Each keeps its existing comment and gains one sentence explaining the check.

`Checkbox.activate` ([`Checkbox.ts:398`](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L398)):

```typescript
protected activate(): void {
    if (this.isIndeterminate()) {
        this.setSelected(true);
    } else {
        this.setSelected(!this.isSelected());
    }

    // Both branches change the state, so every activation announces itself.
    // `on("action", fn)` listens for this DOM `change`, as on RadioButton.
    // Re-read the element first: `setSelected` has just run this checkbox's
    // `"change"` and `"binding"` listeners, and one of them may have disposed
    // it — `fireEvent` would then throw and abort the rest of the dispatch.
    if (this.getElement()) {
        Event.fireEvent(this, "change");
    }
}
```

`RadioButton.activate` ([`RadioButton.ts:331`](packages/lib/src/typescript/lib/component/input/RadioButton.ts#L331)):

```typescript
protected activate(): void {
    if (!this.isSelected()) {
        this.setSelected(true);

        // Re-read the element first: `setSelected` has just run this radio's
        // `"change"` and `"binding"` listeners, and one of them may have
        // disposed it. Same guard as Checkbox.activate.
        if (this.getElement()) {
            Event.fireEvent(this, "change");
        }
    }
}
```

`ToggleButton.onAction` ([`ToggleButton.ts:281`](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L281)):

```typescript
private onAction() {
    this.setSelected(!this.isSelected());

    // Guarded like the other three activation paths: a button with no element
    // commits its state and announces nothing, rather than throwing.
    if (this.getElement()) {
        Event.fireEvent(this, "change");
    }
}
```

`Slider.setValueFromUser` ([`Slider.ts:630`](packages/lib/src/typescript/lib/component/input/Slider.ts#L630)):

```typescript
private setValueFromUser(value: number): void {
    const before = this.getValue();

    this.setValue(value);

    // Re-read the element as well as the value: `setValue` has just run this
    // slider's `"change"` and `"binding"` listeners, and one of them may have
    // disposed it. Same guard as Checkbox.activate.
    if (this.getValue() !== before && this.getElement()) {
        Event.fireEvent(this, "input");
    }
}
```

---

## Ordered Implementation Steps

1. **Create `packages/lib/tests/component/activation-after-dispose.test.ts`** with the `// @vitest-environment jsdom` pragma on line 1 and a file header comment explaining why the modelled DOM cannot carry these cases (see `## Architecture Decisions`). Import `DOM`, `ProductionDOMSink`, `ProductionDOMSource` from `~/core/DOM`, `Event` from `~/core/Event`, `Container` from `~/core/Container`, and the four controls. Add `afterEach(() => DOM.reset())`.

2. **Add the two file-local helpers** (both copied in shape from [`tests/dom/event-subtree-reentrant-dispose.test.ts`](packages/lib/tests/dom/event-subtree-reentrant-dispose.test.ts)):

   ```typescript
   /** A Container mounted under the real document body, to host one control. */
   function mountedHost(): Container {
       const host = new Container({});
       (DOM.sink as ProductionDOMSink).appendChild(
           (DOM.source as ProductionDOMSource).getBody(),
           host.getElement(true)!,
       );

       return host;
   }

   /**
    * Dispatches `event` on the element with `id` and reports whether jsdom's
    * `reportException` surfaced an uncaught error. An exception thrown inside a
    * native listener does not propagate through `dispatchEvent()`'s own call
    * stack — jsdom dispatches a synchronous 'error' event on `window` instead.
    */
   function dispatchAndCatch(id: string, event: globalThis.Event): ErrorEvent | null {
       let caught: ErrorEvent | null = null;
       const onError = (e: ErrorEvent): void => {
           caught = e;
           e.preventDefault();
       };

       window.addEventListener('error', onError);
       try {
           document.getElementById(id)!.dispatchEvent(event);
       } finally {
           window.removeEventListener('error', onError);
       }

       return caught;
   }
   ```

3. **Write the mounted cases** (A1–A3 in `## Expected Behaviour`), one `describe` block. `ToggleButton` has no mounted case; it is covered by B4 in step 4. Each case has the same shape:

   ```typescript
   const host = mountedHost();
   const cb   = new Checkbox() as any;
   host.addComponent(cb);
   cb.getElement(true);
   cb._box.getElement(true);          // the element the gesture targets
   // …quiesce, register listeners, dispatch, assert
   ```

   Quiesce before dispatching: `pauseLayout()` on the control, on each of its private children, and on the host, then `host.flushLayout()` and `control.flushLayout()`. Copy that ritual — and only that ritual — from [`Checkbox.test.ts:265`](packages/lib/tests/component/input/Checkbox.test.ts#L265)'s `mountedCheckbox`; its `freshEventWindow` / `installTestDOM` calls must **not** come with it, since installing the modelled DOM is what makes these cases vacuous. Skipping the quiesce leaves a queued layout that runs against the disposed control and prints a stray `Layout flush … threw` line. Per control:
   - **Checkbox** — gesture target is `(cb as any)._box`; private children are `_box`, `_check`, `_dash`. Dispatch `new MouseEvent('click', { bubbles: true, button: 0 })`.
   - **RadioButton** — gesture target is `(rb as any)._ring`; private children are `_ring`, `_dot`. Same event.
   - **Slider** — gesture target is the slider's own element; it has no private children to pause and no inner graphic to realize. Dispatch `new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' })`, which reaches `setValueFromUser` with no geometry. Build it as `new Slider({ min: 0, max: 100, step: 1, value: 10 })`.

4. **Write the unmounted cases** (B1–B4), a second `describe` block. Each constructs the control and calls its activation entry point directly through an `as any` cast — `activate()` for `Checkbox` and `RadioButton`, `onAction()` for `ToggleButton`, `setValueFromUser(20)` for `Slider` — with no host and no `getElement(true)`. Existing suites already reach private members this way (`Checkbox.test.ts`'s `cb._box`).

5. **Run the new file — every case must fail.** From `packages/lib`: `npx vitest run tests/component/activation-after-dispose.test.ts`. Each failure must trace back to the `Cannot fire event …` error, not to a harness mistake. If any case passes here, the test is vacuous and the guard it covers is untested.

6. **Guard `Checkbox.activate`** ([`Checkbox.ts:398`](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L398)) exactly as `## Internal Structure` shows. Extend the method's JSDoc with: the DOM `change` is skipped when a `"change"` or `"binding"` listener disposed the checkbox.

7. **Guard `RadioButton.activate`** ([`RadioButton.ts:331`](packages/lib/src/typescript/lib/component/input/RadioButton.ts#L331)) and extend its JSDoc the same way.

8. **Guard `ToggleButton.onAction`** ([`ToggleButton.ts:281`](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L281)) and extend its JSDoc the same way.

9. **Guard `Slider.setValueFromUser`** ([`Slider.ts:630`](packages/lib/src/typescript/lib/component/input/Slider.ts#L630)) and extend its JSDoc the same way, naming the DOM `input` rather than `change`.

10. **Re-run the new file — every case must pass**, then run the four controls' existing suites unchanged: `npx vitest run tests/component/input/Checkbox.test.ts tests/component/input/RadioButton.test.ts tests/component/input/Slider.test.ts tests/component/button/ToggleButton.test.ts`.

11. **Check the guard reaches every site**: from the repo root,

    ```
    grep -n -B 1 'Event.fireEvent(this, "change")' \
      packages/lib/src/typescript/lib/component/input/Checkbox.ts \
      packages/lib/src/typescript/lib/component/input/RadioButton.ts \
      packages/lib/src/typescript/lib/component/button/ToggleButton.ts
    grep -n -B 1 'Event.fireEvent(this, "input")' \
      packages/lib/src/typescript/lib/component/input/Slider.ts
    ```

    Each of the four hits must be preceded by a line containing `this.getElement()`.

12. **Add the changelog entry** to `packages/lib/docs/reference/changelog/next.md`, at the end of the `### Components` list under `## Fixed` (the list starting at line 943). See `## Documentation Impact` for the wording.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/tests/component/activation-after-dispose.test.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Checkbox.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/RadioButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/ToggleButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Slider.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

All cases below are unit-testable; none needs manual verification. Every statement about today's behaviour was measured against `master` at the time of writing.

### The undisturbed dispatch, unchanged

A mounted `Checkbox` whose listeners do nothing but record. One primary-button click on its box graphic runs, in this order:

| # | What runs | Registered as |
|---|---|---|
| 1 | `"change"` listeners | `cb.on("change", fn)` — `AbstractInput`'s `ListenerBag` |
| 2 | `"binding"` listeners | `cb.on("binding", fn)` — the same bag |
| 3 | `"action"` listeners | `cb.on("action", fn)` — a DOM `change` on the checkbox |
| 4 | later listeners on the clicked element | a second DOM `click` registration on the box |
| 5 | subtree listeners on ancestors | `Event.addSubtreeListener(host, "click", fn)` |

This plan changes none of it, and the existing suites already cover `"action"` delivery, so the new file adds no case for this order. It is the baseline the cases below are read against.

### A — mounted, and a `"change"` listener disposes the control

Each case mounts the control, registers a `"change"` listener that calls `control.dispose()`, registers an `"action"` listener, and drives one real user gesture.

| Case | Control | Gesture | Must hold after the fix |
|---|---|---|---|
| A1 | `Checkbox` | click on `_box` | no uncaught error; `isSelected()` is `true`; the disposing `"change"` listener ran once; no `"action"` listener ran |
| A2 | `RadioButton` | click on `_ring` | no uncaught error; `isSelected()` is `true`; the disposing `"change"` listener ran once; no `"action"` listener ran |
| A3 | `Slider` (`min: 0, max: 100, step: 1, value: 10`) | `keydown` `ArrowRight` | no uncaught error; `getValue()` is `11`; the disposing `"change"` listener ran once; no `"action"` listener ran |
| A4 | `ToggleButton` | — | not reachable; see B4 |

Currently A1–A3 each end with an uncaught `Error: Cannot fire event 'change'` (A3: `'input'`) and no `"action"` listener runs. The state is already committed when the error lands, so the visible change after the fix is the absence of the error, not a different value.

Two further points, both of which the tests should assert on A1:

- **A later listener on the clicked element now runs.** Register a second DOM `click` listener on the same element the gesture targets. It is skipped today, because the throw ends the dispatch; after the fix it runs.
- **A subtree listener on an ancestor still does not run, before or after.** Once the clicked element's handle has been released, the ancestor walk cannot climb through it and ends — the existing, intentional guard at [`Event.ts:267-278`](packages/lib/src/typescript/lib/core/Event.ts#L267), covered by `event-subtree-reentrant-dispose.test.ts`'s EV1. This plan does not change it.

### What the surviving listeners of the same notification see

A `"change"` listener that disposes the control does not stop the notification it is part of, and this plan does not change that. On A1, with three listeners registered in this order — `"change"` #1 (disposes), `"change"` #2, `"binding"` #1 — the observed result is:

| Listener | Runs? | Why |
|---|---|---|
| `"change"` #1 | yes | it is the one doing the disposing |
| `"change"` #2 | yes | `ListenerBag.fire` walks the bucket array it already holds; `clear()` empties the bag's map, not that array |
| `"binding"` #1 | no | `emit("binding")` is a second `fire` call, and the bag it reads has been cleared by `registerListenerBag`'s destroy hook |

That is the contract [`concepts/component-lifecycle.md`](packages/lib/docs/concepts/component-lifecycle.md) states for `registerListenerBag` — "once the component is destroyed, `_listeners` is cleared". Pin it as a test so the fix does not quietly alter it.

### B — activation on a control with no element

Each case constructs the control, never mounts it, and calls its activation path directly. Today all four throw; after the fix all four return normally with the state committed and nothing dispatched.

| Case | Control | Call | Must hold after the fix | Throws today with |
|---|---|---|---|---|
| B1 | `Checkbox` | `activate()` | no throw; `isSelected()` is `true` | `Cannot fire event 'change'` |
| B2 | `RadioButton` | `activate()` | no throw; `isSelected()` is `true` | `Cannot fire event 'change'` |
| B3 | `Slider` (`min: 0, max: 100, step: 1, value: 10`) | `setValueFromUser(20)` | no throw; `getValue()` is `20` | `Cannot fire event 'input'` |
| B4 | `ToggleButton` (`new ToggleButton('Bold')`) | `onAction()` | no throw; `isSelected()` is `true` | `Cannot fire event 'change'` |

B4 is `ToggleButton`'s only reachable case, and it is why the group exists.[^why-toggle-unmounted]

### C — nothing dispatches twice, and nothing stops dispatching

`Slider.setValueFromUser` must keep its existing "only when the value moved" rule: a second `ArrowRight` at `max`, or a pointer sample at the same position, still dispatches nothing. The existing case *"fires action once per value key that moves the thumb"* in [`Slider.test.ts`](packages/lib/tests/component/input/Slider.test.ts) covers this and must keep passing unchanged, as must every `"action"` delivery case in the four controls' existing suites.

---

## Verification

From the repo root unless stated otherwise.

1. `npm -w packages/lib run typecheck` and `npm -w packages/lib run typecheck:test` — both clean.
2. From `packages/lib`: `npx vitest run tests/component/activation-after-dispose.test.ts` — all A and B cases pass. Step 5 of `## Ordered Implementation Steps` already confirmed they fail before the guards land.
3. From `packages/lib`: `npx vitest run tests/component/input/Checkbox.test.ts tests/component/input/RadioButton.test.ts tests/component/input/Slider.test.ts tests/component/button/ToggleButton.test.ts tests/component/table/cell/BooleanCell.test.ts tests/overlay/ButtonGroup.test.ts` — unchanged. `BooleanCell` and `ButtonGroup` are the two in-library consumers of these controls' `"action"` event.
4. `npm test` — the full suite, no new failures and no new stderr output.
5. The grep check in step 11: four hits, each preceded by a `this.getElement()` line.
6. `npm -w packages/lib run lint` — clean.

No manual verification step. Every behaviour in `## Expected Behaviour` is reachable from the test harness.

---

## Documentation Impact

No public API changes, so no component page, no `llms.txt` entry and no TypeDoc page changes. The four JSDoc comments this plan extends all sit on `protected` or `private` members, which TypeDoc excludes, so `npm run docs:api` is not required either.

One changelog entry, appended to the `### Components` list under `## Fixed` in `packages/lib/docs/reference/changelog/next.md`, in that file's established voice (bold one-sentence lead, the mechanism, then the consumer's action):

> - **A user activation no longer throws when its own listener disposes the control.** `Checkbox`, `RadioButton`, `ToggleButton` and `Slider` each dispatch a DOM event at the end of a click or key activation, after the control's `"change"` and `"binding"` listeners have run — so a listener that disposed the control (a form rebuilt on a record change) left the dispatch with no element to fire on, and the resulting `Cannot fire event` error ended the whole event's dispatch, skipping every listener the framework had not yet reached. All four now check for the element first and stay silent when it is gone. The activation's own `"action"` listeners do not run in that case, because disposal has already unregistered them. The same check makes an activation on an unmounted control a no-op instead of a throw. No consumer action is needed.

---

## Potential Challenges

- **A test written against the modelled DOM would pass against the unfixed code.** The suite must keep its `// @vitest-environment jsdom` pragma and must not call `installTestDOM`; step 5 catches the mistake by requiring every case to fail first.
- **A stray `Layout flush … threw` line in the test output.** A host with a queued layout runs it against the just-disposed control. The quiesce ritual in step 3 prevents it; the line is a caught, logged error rather than a test failure, so it will not fail a case that forgets the ritual — watch for it in the output.
- **jsdom does not propagate a listener's exception through `dispatchEvent`.** Asserting `expect(() => …).toThrow()` around the dispatch would never see the error. `dispatchAndCatch` is what observes it, via the `error` event jsdom reports on `window`.
- **`Slider`'s guard has two conditions, not one.** Dropping the existing `this.getValue() !== before` half would make every drag sample dispatch, including the ones that move nothing. Case C is the check.

---

## Critical Files

| File | Why |
|---|---|
| [`component/list/AbstractSelectableList.ts:1764`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1764) | `fireChange` — the guarded precedent this plan follows |
| [`core/Event.ts:410`](packages/lib/src/typescript/lib/core/Event.ts#L410) | `fireEvent` and the throw; read its two overload doc comments before changing any caller |
| [`core/Event.ts:261`](packages/lib/src/typescript/lib/core/Event.ts#L261) | `dispatchToSubtreeListeners` — the existing released-handle guard that ends the ancestor walk, and the reason case A's subtree listener stays silent |
| [`component/input/AbstractBooleanInput.ts:147`](packages/lib/src/typescript/lib/component/input/AbstractBooleanInput.ts#L147) | the keyboard and pointer paths that call `activate()` on `Checkbox` and `RadioButton` |
| [`component/input/AbstractInput.ts:218`](packages/lib/src/typescript/lib/component/input/AbstractInput.ts#L218) | `notifyChange` — where the consumer listeners that can dispose the control run |
| [`core/ListenerBag.ts`](packages/lib/src/typescript/lib/core/ListenerBag.ts) | `fire` and `clear`, which decide which surviving listeners of the same notification still run |
| [`tests/dom/event-subtree-reentrant-dispose.test.ts`](packages/lib/tests/dom/event-subtree-reentrant-dispose.test.ts) | the dispose-inside-a-live-dispatch test recipe, and `dispatchAndCatch` |
| [`tests/component/display/MarkdownHeadingScoping.test.ts`](packages/lib/tests/component/display/MarkdownHeadingScoping.test.ts) | a component-level suite that keeps the jsdom pragma because the modelled DOM would make it vacuous |
| [`tests/component/input/Checkbox.test.ts:265`](packages/lib/tests/component/input/Checkbox.test.ts#L265) | `mountedCheckbox` — the mount-and-quiesce ritual to copy |
| [`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md) | the `## Fixed` → `### Components` list and its entry voice |

---

## Non-Goals

- **`Toggle`** ([`component/input/Toggle.ts:241`](packages/lib/src/typescript/lib/component/input/Toggle.ts#L241)) is not touched. Its `activate()` flips the value and dispatches no DOM event, so it has nothing to guard.
- **The library's other `Event.fireEvent` call sites** are not touched. The nearest lookalikes, `TextInput.cut` and `TextInput.paste`, were checked and are safe: `TextInput.setText` notifies no listener, so no consumer code runs between their element read and their dispatch, and `paste` already re-reads the element after its await. The rest — `Button.click`, `Link.click`, `TreeTable`'s row-reparent notice, the table cell editors and `DragManager` — sit outside the audit's finding and are not reviewed here.
- **No shared "fire if mounted" helper** on `Component` or on a base class. See `## Architecture Decisions`.
- **No change to `"action"` semantics.** `"action"` still means the user's own activation and still never fires for a programmatic write. A disposed control simply has no listeners left to deliver it to.

---

## Notes

[^why-inline]: The four sites sit in two class hierarchies — `Checkbox`, `RadioButton` and `Slider` under `AbstractInput`, `ToggleButton` under `Button` — whose only common ancestor is `Component`. A shared helper would therefore have to be a new protected `Component` method: new framework surface, added by a bug fix, for four call sites of one line each. CLAUDE.md's *Simplicity First* rules that out ("no abstractions for single-use code"), and the codebase's own answer to this exact problem is an inline check: `AbstractSelectableList.fireChange` guards at the call site, `Slider`'s own pointer-release handler uses the same `getElement()`-then-branch shape a hundred lines above the site being fixed, and so does `Component.destructor`. `fireChange` is a per-class method rather than a shared one, so it is precedent for guarding locally, not for hoisting. The form chosen is `if (this.getElement())` rather than `fireChange`'s `const element = this.getElement(); if (element)`, because none of the four sites has any other use for the handle — and because it is verbatim what `Checkbox.setSelected` carried before commit `283cc5f0`.

[^why-silent]: The deleted `Checkbox.setSelected` guard had an `else { console.warn(…) }` branch, which commit `83031cfd` describes as marking a pre-mount write. That framing does not survive the move: a listener disposing its own control mid-activation is a supported pattern (`Event.ts`'s subtree walk is built to survive it, and `Tab.closeTab` disposes the very content a click just acted on), so warning about it would put a console line in front of correct application code on every rebuild-on-change form. `AbstractSelectableList.fireChange` is likewise silent.

[^why-keep-throwing]: Making `fireEvent` tolerate a missing element would change behaviour for the library's twenty-odd other call sites, several of which dispatch on a component they have just constructed and where a missing element really is a bug worth surfacing loudly. The throw is documented in both of `fireEvent`'s overload comments ("Throws an error if the component has no DOM element") and is what `Slider.setValue` and `Checkbox.setSelected` were rewritten around in commits `23ee20fd` and `283cc5f0` rather than suppressed.

[^why-jsdom]: Measured: `RecordingDOMSink.removeElement` calls `_table.setParent(handle, null)` and nothing else, while `ModelledDOMSource.getElementById` answers from `_table.byId`, an index only ever written to. So after `dispose()` under the modelled DOM, `Component.getElement()` falls back to `getElementById`, finds the stale entry, and returns a handle — the unguarded `fireEvent` succeeds and the case passes without the fix. `tests/dom/event-subtree-reentrant-dispose.test.ts`'s own file header records the same trap for its own cases. Under jsdom with `ProductionDOMSource`, the element is genuinely out of the document and `getElement()` returns `undefined`, which is what reproduces the error. The `jsdom` pragma also keeps `tests/setup/node-setup.ts` from installing the modelled baseline, since that file self-guards on `typeof document === 'undefined'`.

[^why-toggle-unmounted]: `ToggleButton` is the one control of the four with no mounted case, because nothing runs between its state write and its dispatch: `ToggleButton.setSelected` writes `_options`, an ARIA attribute and a style state, and notifies no listener at all — it is not an `AbstractInput` and owns no `ListenerBag`. Its own DOM `click` listener is registered in its constructor, ahead of any consumer's, and `ButtonGroup` subscribes through `on("action")`, which is the very event `onAction` dispatches. So the guard there covers the unmounted and already-disposed activation only. It is still worth having, for three reasons: the audit asks for all four together; `setSelected` is public and overridable, so a subclass can open the window that `Checkbox` and `RadioButton` have today; and B4 shows the throw is real on the path that is reachable.

---

## Implementation Notes

- **A second, unrelated `DOM.reset()` trap surfaced while writing the new
  test file, and needed a narrow test-only workaround.** `Glyphs.ts` caches
  the shared SVG glyph sprite's own `Handle` in a module-level
  `_spriteElement` variable, set once when the sprite is first mounted, and
  never refreshed by `DOM.reset()` (unlike `DOM.ts`'s own `mainSheet()`,
  which re-queries `<head>` for the `<style id="Base">` element by id on
  every call and so stays correct across a reset). `afterEach(() =>
  DOM.reset())` rebuilds the shared `HandleRegistry` from empty on every
  case, so handle numbers are reused across cases. The plan's mounted cases
  render two different SVG-mode glyphs — Checkbox's check mark and
  RadioButton's dot — and case A1 (Checkbox) runs before case A2
  (RadioButton) in file order. Mounting RadioButton for the first time in a
  fresh case, after `DOM.reset()` has already run once, calls
  `Glyphs.ts`'s `ensureGlyphSymbolMounted("circle")`, which resolves the
  stale sprite handle against the *new* registry and appends the `<symbol>`
  into whatever element that recycled handle number now happens to name —
  observed as a real `<symbol>` being appended under an SVG `<path>`, which
  jsdom rejects as `HierarchyRequestError: The operation would yield an
  incorrect node tree`, aborting the whole case before it reaches the
  behaviour under test. Confirmed with a minimal repro (a plain Checkbox
  mount followed by a plain RadioButton mount, no dispose or activation
  involved) that this reproduces from the reset/registry interaction alone
  and is unrelated to this plan's fireEvent guards.
  `tests/component/activation-after-dispose.test.ts` works around it with a
  `beforeAll` that renders one throwaway `Checkbox` and one throwaway
  `RadioButton` (each just `.getElement(true)`, unattached to any host)
  before the file's first `DOM.reset()` ever runs. `Glyphs.ts`'s
  `_addSymbolToSprite` is idempotent per symbol name (`_mountedSymbols.has`
  short-circuits it), so once both symbols are registered against the
  pristine initial registry, every later mount in the file — across as many
  resets as it runs — finds its symbol already there and never touches the
  stale sprite handle again. This is a test-file-local workaround, not a
  library fix: `Glyphs.ts` itself is unchanged, and the underlying
  `_spriteElement` staleness is a pre-existing gap outside this plan's
  scope (guarding the four `fireEvent` call sites), surfaced only because
  this is the first test in the suite to mount multiple distinct SVG-glyph
  components under the real production DOM across more than one
  `DOM.reset()`.

- **`ToggleButton.onAction`'s JSDoc departs from step 8's prescribed
  wording, because that wording is false for `ToggleButton`.** Steps 6–9
  each say to extend the guarded method's JSDoc with "the DOM `change` is
  skipped when a `\"change\"` or `\"binding\"` listener disposed the
  control," copying `Checkbox.activate`'s case. `ToggleButton` is not an
  `AbstractInput` and owns no listener bag — `setSelected`
  ([`ToggleButton.ts`](packages/lib/src/typescript/lib/component/button/ToggleButton.ts))
  notifies nobody — so it has no `"change"`/`"binding"` listener to dispose
  it, and `onAction` is the only `"click"` listener registered on the
  button ahead of any consumer's. The guard's real reach here, per
  `[^why-toggle-unmounted]`, is `onAction` called directly on an unmounted
  button, or a subclass's override of the public `setSelected` disposing
  the button before the dispatch is reached — the JSDoc says that instead.

- **The changelog entry departs from `## Documentation Impact`'s prescribed
  text in two places, because both are inaccurate.** First, the prescribed
  text ends "...makes an activation on an unmounted control a no-op
  instead of a throw" — but the activation still commits its state
  (`isSelected()`/`getValue()` change; see cases B1–B4 in `## Expected
  Behaviour`), so it is not a no-op. The published entry instead says an
  activation with no element "commits the state and skips just the dispatch
  rather than throwing." Second, the prescribed lead names all four
  controls as dispatching "after the control's `"change"` and `"binding"`
  listeners have run" — true of `Checkbox`, `RadioButton` and `Slider`, but
  not of `ToggleButton`, for the reason the bullet above and
  `[^why-toggle-unmounted]` give. The published entry scopes that mechanism
  to the three and describes `ToggleButton`'s narrower reach in its own
  sentence. The same false generalisation had been copied into the new test
  file's header comment, which is corrected the same way. The plan's prose
  described the shared mechanism of the other three and let `ToggleButton`
  ride along with it, which is why this needed catching in three separate
  places.
