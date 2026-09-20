---
touches-shared:
  - packages/lib/src/typescript/lib/component/table/Body.ts
  - packages/lib/docs/reference/changelog/next.md
  - packages/qa/README.md
  - plans/research/render-review-2026-09-15/99-synthesis.md
  - plans/research/render-review-2026-09-15/01-phase2-status-pass.md
---

# Boolean Input Action Fan-Out Opt-Out — Implementation Plan

## Overview

`Checkbox.setSelected` dispatches a synthetic DOM `click` on the checkbox root after every real state change ([`component/input/Checkbox.ts:451`](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L451)). `RadioButton.setSelected` dispatches nothing ([`component/input/RadioButton.ts:365-376`](packages/lib/src/typescript/lib/component/input/RadioButton.ts#L365)). Two sibling controls document the same `on("action", fn)` event and behave differently for a programmatic write — entry C34 of the correctness register ([`99-synthesis.md:921`](plans/research/render-review-2026-09-15/99-synthesis.md#L921)).

This plan adds one defaulted parameter, `fireAction`, to `Checkbox.setSelected`, so a caller performing a programmatic write can suppress that dispatch. Today's behaviour is the default and does not change. The table's boolean cell editor then becomes the first caller: `component/table/cell/editor/Boolean.ts` passes `fireAction: false` at both of its programmatic write sites and deletes the `_suppressCommit` flag it currently wraps around them ([`:32`](packages/lib/src/typescript/lib/component/table/cell/editor/Boolean.ts#L32), [`:132-142`](packages/lib/src/typescript/lib/component/table/cell/editor/Boolean.ts#L132)). That removal also fixes a second, user-visible defect the flag was hiding: `BooleanEditor.toggle()` commits twice per activation, so a keyboard or double-click toggle of a boolean cell fires its `"commit"` listener twice.[^double-commit]

`RadioButton` is not changed. Its `"action"` already fires exactly once per user activation and never on a programmatic write, which is what the event means; the checkbox is the deviant sibling.[^radio-is-right] A deeper defect found while verifying C34 — `Checkbox.on("action")` is never reached by the real user click itself, and *is* reached by a click on dead space that changes nothing — is recorded as a new register entry rather than fixed here.[^c40-boundary]

---

## Architecture Decisions

### The opt-out is a defaulted second parameter on `setSelected`

`setSelected(value: boolean, fireAction: boolean = true)`. The library already solves "same write, no event fan-out" this way: [`AbstractSelectableList.setSelectedIndex(idx, fireEvent = true)`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1485) and [`ComboBox.setSelectedIndex(idx, fireEvent = true)`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L1198), whose own documentation reads "pass `false` for programmatic writes". `ComboBox` is also the precedent for an *in-library* caller passing `false` ([`ComboBox.ts:1202`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L1202)), which is exactly the role `BooleanEditor` takes here.[^why-per-call]

The new parameter extends the conditional that is already in `setSelected` — the pre-mount skip at [`Checkbox.ts:450-454`](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L450) — rather than introducing a second decision point.

### The parameter gates the `action` dispatch only, and is named for it

`fireAction: false` suppresses the synthetic click and nothing else. `notifyChange(next)` still runs, so `"change"` and `"binding"` still fire and `setDirty` still relays up the ancestor chain.[^narrow-scope]

The name deviates from the precedent's `fireEvent`, deliberately. `Checkbox` carries two separate event surfaces — the DOM-routed `"action"` shorthand and the `ListenerBag` `"change"` / `"binding"` pair — which [ARCHITECTURE.md](ARCHITECTURE.md) requires be kept apart. A flag called `fireEvent` would straddle both; `fireAction` names the one event it gates.

### `RadioButton` gains no parameter and no fan-out

`RadioButton.setSelected` keeps its exact current signature and body. It does not start dispatching an `"action"` under any flag.[^radio-is-right]

### The cell editor drops `_suppressCommit` entirely

`BooleanEditor` passes `fireAction: false` at its two programmatic write sites — `setValue` ([`:138`](packages/lib/src/typescript/lib/component/table/cell/editor/Boolean.ts#L138)) and `toggle` ([`:180`](packages/lib/src/typescript/lib/component/table/cell/editor/Boolean.ts#L180)) — and the `_suppressCommit` field, its `try`/`finally`, and the guard inside the `"action"` listener all go. The listener itself stays: it is how a real user toggle reaches the editor.[^why-listener-stays]

### `Body.onSubtreeClick`'s filter stays; only its comment changes

The `instanceof MouseEvent` guard at [`component/table/Body.ts:1542`](packages/lib/src/typescript/lib/component/table/Body.ts#L1542) is not removed. After this change the burst of synthetic clicks it was written for — one per pool slot per scroll tick — no longer happens, but a real user toggle of a boolean cell still produces one synthetic echo that must not be read as a second row click. The guard's comment at [`:1534-1541`](packages/lib/src/typescript/lib/component/table/Body.ts#L1534) gives that burst as its reason and is rewritten to give the user-toggle echo instead.

### The real-click delivery defect is recorded, not fixed

`Checkbox.on("action", fn)` registers a **direct-target** listener on the checkbox root ([`Checkbox.ts:544`](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L544)), a real user click lands on the inner `_box` ([`:335`](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L335)), and `Event`'s dispatcher matches direct listeners by exact target id ([`core/Event.ts:276-290`](packages/lib/src/typescript/lib/core/Event.ts#L276)). So the real click never reaches the listener; the synthetic click from `setSelected` is the sole delivery path, for user and programmatic toggles alike. A click on the root's own area — the gap between box and label, or any stretched empty area — *does* reach it, and fires `"action"` with no state change at all.

Both faces are recorded as register entry **C40**, not fixed here.[^c40-boundary]

---

## Public API

```typescript
class Checkbox<TOptions extends CheckboxOptions = CheckboxOptions>
    extends AbstractBooleanInput<TOptions>
{
    /** `fireAction` defaults to `true` — today's behaviour. */
    setSelected(value: boolean, fireAction?: boolean): this;
}
```

Nothing else changes shape. `Checkbox.setValue(value: boolean): this` keeps its one-parameter signature ([`Checkbox.ts:477`](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L477)) because it implements [`Bindable<boolean>`](packages/lib/src/typescript/lib/core/Bindable.ts#L30); `Checkbox.setIndeterminate`, `RadioButton.setSelected` and `Toggle.setValue` are untouched. No new `CheckboxOptions` field is added, so the default-resolution registry in [`tests/component/default-options-fallback.test.ts`](packages/lib/tests/component/default-options-fallback.test.ts) needs no row.

`BooleanEditor._suppressCommit` is private; its removal changes no exported signature.

---

## Internal Structure

`Checkbox.setSelected`'s body, with the new early return between the notify and the dispatch:

```typescript
setSelected(value: boolean, fireAction: boolean = true): this {
    const next = !!value;
    if (next === this.isSelected() && !this.isIndeterminate()) {
        return this;                       // unchanged: no-op guard runs first
    }

    this._options.selected = next;
    this._options.indeterminate = false;
    this.applySelected(next, false);
    this.notifyChange(next);               // unchanged: change / binding always fire

    if (!fireAction) {
        return this;                       // new: no dispatch, and no pre-mount warning
    }

    // ... existing synthetic-click block, unchanged ...
}
```

### What delivers `on("action")`

The pointer and programmatic rows below are probe-verified against `master` `b3d67f7f` using the offline test DOM, which routes `Event.fireEvent` through the same window-level dispatcher a browser does.[^probe] The keyboard rows follow from sharing the pointer rows' `activate()` path; the label row follows from neither control registering a listener on the label.

| Trigger | `Checkbox` today | `Checkbox` after | `RadioButton` (unchanged) |
|---|---|---|---|
| User clicks the box / ring graphic | fires once, via `setSelected`'s synthetic click | same | fires once, via `activate()`'s DOM `change` |
| Space on the focused control | fires once, same path | same | fires once, same path |
| User clicks the control root outside the graphic | **fires, with no state change** | same | does not fire |
| User clicks the label | does not fire | same | does not fire |
| `setSelected(true)` | fires | fires | does not fire |
| `setSelected(true, false)` | — | **does not fire** | parameter does not exist |
| `setValue(true)` (a `Binding` write) | fires | fires | does not fire |
| `setIndeterminate(true)` | does not fire | same | — |
| Pooled `BooleanEditor.setValue(…)` rebind | fires, then discarded twice over | **nothing is dispatched** | — |

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/component/input/Checkbox.ts`** — add the parameter. Change the signature at [`:433`](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L433) to `setSelected(value: boolean, fireAction: boolean = true): this`, and insert `if (!fireAction) { return this; }` immediately after `this.notifyChange(next);` at [`:442`](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L442) and before the existing comment block at [`:444`](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L444). Do not move or reword the existing synthetic-click comment; it still explains the default path.

2. **`Checkbox.ts`** — extend `setSelected`'s TSDoc at [`:426-432`](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L426) with an `@param fireAction` line: when `true` (the default) a real transition also dispatches the synthetic DOM `click` that `on("action", fn)` rides on; pass `false` for a programmatic write that should reach only `"change"` / `"binding"`. State that `"change"` and `"binding"` fire either way.

3. **`Checkbox.ts`** — extend the `on` overload TSDoc at [`:527-538`](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L527) to say that `"action"` also fires for a programmatic `setSelected` unless the caller passes `fireAction: false`. Keep the wording clear of `{@link}` references to private members, per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md).

4. **Check**: `npm run typecheck` — expect 0 errors. Every existing `setSelected` call site still compiles, because the parameter is optional.

5. **`packages/lib/src/typescript/lib/component/table/cell/editor/Boolean.ts`** — delete the `_suppressCommit` field at [`:32`](packages/lib/src/typescript/lib/component/table/cell/editor/Boolean.ts#L32).

6. **`Boolean.ts`** — in the constructor's `"action"` listener at [`:45-59`](packages/lib/src/typescript/lib/component/table/cell/editor/Boolean.ts#L45), delete the comment block and the `if (this._suppressCommit) { return; }` guard, leaving the two-line body that caches the value and emits `"change"`. **Keep the listener as an inline arrow function** — a listener registered through `Checkbox.on("action", …)` is invoked bound to the *checkbox*, not the editor, so a named method reference would break `this`.[^arrow-required]

7. **`Boolean.ts`** — rewrite `setValue` at [`:125-145`](packages/lib/src/typescript/lib/component/table/cell/editor/Boolean.ts#L125): drop the `try`/`finally` and both `_suppressCommit` assignments, and call `this._checkBox.setSelected(this._value as boolean, false)`. Replace the comment at [`:128-131`](packages/lib/src/typescript/lib/component/table/cell/editor/Boolean.ts#L128) with one sentence saying the write is programmatic so it must not reach the editor's own `"action"` listener. The `setIndeterminate` branch needs no flag — it never dispatched one.

8. **`Boolean.ts`** — in `toggle` at [`:176-185`](packages/lib/src/typescript/lib/component/table/cell/editor/Boolean.ts#L176), change `this._checkBox.setSelected(next)` to `this._checkBox.setSelected(next, false)`, so the method's own `emit("change", …)` on the next line is the single commit.

9. **Check**: `grep -rn '_suppressCommit' packages/lib/src/` — expect zero matches.

10. **`packages/lib/src/typescript/lib/component/table/Body.ts`** — rewrite the comment at [`:1534-1541`](packages/lib/src/typescript/lib/component/table/Body.ts#L1534) so it describes what the guard now catches: a user toggle of a boolean cell fires one synthetic `CustomEvent("click")` from `Checkbox.setSelected` on top of the real `MouseEvent`, and only the real one may select a row. Leave the `if (!(e instanceof MouseEvent))` guard itself unchanged.

11. **`packages/lib/tests/component/input/Checkbox.test.ts`** — leave the existing `it` in the `Checkbox action fan-out (mounted)` block at [`:162-195`](packages/lib/tests/component/input/Checkbox.test.ts#L162) exactly as it is; it pins the default. Add cases 2 and 4 from `## Expected Behaviour` as new `it`s inside that block, reusing its mount-and-pause setup. Add case 3, which needs an **unmounted** checkbox, in its own new `describe` instead, with the `vi.spyOn(console, 'warn')` / `afterEach(() => vi.restoreAllMocks())` pair that [`:138-142`](packages/lib/tests/component/input/Checkbox.test.ts#L138) already uses.

12. **`packages/lib/tests/component/input/RadioButton.test.ts`** — add a new `describe` after `RadioButton selected transitions` ([`:67-110`](packages/lib/tests/component/input/RadioButton.test.ts#L67)) holding case 5, which pins the asymmetry nothing currently covers.

13. **`packages/lib/tests/component/table/cell/BooleanCell.test.ts`** — move the `BooleanCell read-only` block's `mountedCell` helper at [`:66-75`](packages/lib/tests/component/table/cell/BooleanCell.test.ts#L66) out to module scope (delete the local copy; leave the `BooleanCell fills the row height` block's own helper at [`:29-38`](packages/lib/tests/component/table/cell/BooleanCell.test.ts#L29) alone), and make it also realise the editor's checkbox element: `cell.getRenderer().getComponents()[0].getElement(true)`. That makes the existing `expect(commits).toHaveLength(1)` at [`:102`](packages/lib/tests/component/table/cell/BooleanCell.test.ts#L102) a real assertion — it reads 2 before the fix and 1 after.[^double-commit] Then add a new `describe('BooleanCell commit fan-out')` holding cases 7 and 8, using that hoisted helper.

14. **Check**: `npm test` — expect all green, including the two geometry tests in `BooleanCell.test.ts`, which use their own separate helper and are untouched.

15. **Documentation** — apply every change in `## Documentation Impact`.

16. **Check**: `npm run docs:api` — must finish with zero warnings. Then `npm run docs:llms:check` and `npm run lint`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/input/Checkbox.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/editor/Boolean.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Body.ts` |
| Modify | `packages/lib/tests/component/input/Checkbox.test.ts` |
| Modify | `packages/lib/tests/component/input/RadioButton.test.ts` |
| Modify | `packages/lib/tests/component/table/cell/BooleanCell.test.ts` |
| Modify | `packages/lib/docs/components/Checkbox.md` |
| Modify | `packages/lib/docs/components/RadioButton.md` |
| Modify | `packages/lib/docs/concepts/events.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/qa/README.md` |
| Modify | `plans/research/render-review-2026-09-15/99-synthesis.md` |
| Modify | `plans/research/render-review-2026-09-15/01-phase2-status-pass.md` |

---

## Expected Behaviour

Cases 1–8 are unit-testable offline. Cases 9 and 10 need the QA app and are manual.

1. **The default is unchanged.** A mounted `Checkbox`; `cb.setSelected(true)` leaves `isSelected()` true and records one `dispatchEvent` sink write of type `click`. *(Already covered by [`Checkbox.test.ts:162-195`](packages/lib/tests/component/input/Checkbox.test.ts#L162) — keep it.)*

2. **`fireAction: false` suppresses only the dispatch.** The same mounted checkbox; `cb.setSelected(true, false)` leaves `isSelected()` true, records **zero** `dispatchEvent` writes of type `click`, and still fires `"change"` once with `true` and `"binding"` once.

3. **`fireAction: false` is silent before mount.** An unmounted `Checkbox`; `cb.setSelected(true, false)` sets the state and calls `console.warn` zero times. `cb.setSelected(true)` on an unmounted checkbox still warns once, as today.

4. **The no-op guard still wins.** A checkbox already selected and not indeterminate; `cb.setSelected(true, false)` and `cb.setSelected(true)` both return early — no `"change"`, no `"binding"`, no dispatch. The flag is never read on that path.

5. **The asymmetry is deliberate and pinned.** A mounted `RadioButton` with an `on("action", …)` listener: `rb.setSelected(true)` fires the listener **zero** times, while a `click` whose target is the radio's inner ring element fires it exactly once. A `click` targeting the radio's own root element fires it zero times.

6. **A boolean cell commits once per activation.** A mounted `BooleanCell` whose editor's checkbox element is realised, with an `on("commit", …)` listener: `cell.startEdit()` fires it exactly once, with `true`. *(Reads 2 before the fix.)*

7. **A pooled rebind commits nothing and dispatches nothing.** A cell built the same way; `cell.setValue(true)` then `cell.setValue(false)` fire `"commit"` zero times and record zero `dispatchEvent` writes of type `click`.

8. **The indeterminate branch is unaffected.** A cell built the same way; `cell.setValue(null)` puts the checkbox into the indeterminate state, fires `"commit"` zero times and records zero `dispatchEvent` writes. A read-only `cell.startEdit()` still fires `"commit"` zero times.

9. **Manual — the rebind burst is gone.** `table-rows` with `drive=wheel&seam=1`: `seam.sink.dispatchCustomEvent` is above 0 before the change and 0 after.

10. **Manual — a user toggle still fans out.** `form-flat` with `drive=click&click=toggle&seam=1`: `seam.sink.dispatchCustomEvent` per unit is the same before and after.

---

## Verification

- `npm run typecheck` — 0 errors.
- `npm test` — all green; cases 1–8 above are the new coverage.
- `npm run lint` — 0 errors.
- `grep -rn '_suppressCommit' packages/lib/src/` — zero matches.
- `grep -rn 'setSelected(.*, false)' packages/lib/src/` — exactly 2 matches, both in `component/table/cell/editor/Boolean.ts`. (The literal `setSelected(` does not match `setSelectedIndex(`, so `ComboBox`'s and `AbstractSelectableList`'s calls are excluded.)
- `npm run docs:api` — finishes with zero warnings.
- `npm run docs:llms:check` — passes. No class summary line changes, so `llms.txt` needs no regeneration.
- **Manual, QA app — do not run without the user's explicit go-ahead.** Every QA run opens a full-screen window on the user's desktop. Cases 9 and 10 are the two runs to ask for; record their results in `packages/qa/README.md`'s *Validated* column for `table-rows` and `form-flat`.

---

## Documentation Impact

**TSDoc** (rendered into `/api/…` by TypeDoc; steps 2 and 3 cover the first two bullets, step 7 the last, and step 15 the `RadioButton` one)

- `Checkbox.setSelected` — new `@param fireAction`, plus a sentence stating that `"change"` / `"binding"` fire regardless.
- `Checkbox.on` — the `"action"` overload's description gains the programmatic-fan-out sentence and names the opt-out.
- `RadioButton.on` — the `"action"` overload's description at [`RadioButton.ts:435-447`](packages/lib/src/typescript/lib/component/input/RadioButton.ts#L435) already says "fired on user-driven selection"; add "never on a programmatic `setSelected`" so the contrast with `Checkbox` is explicit on both pages.
- `BooleanEditor.setValue`'s `@remarks` — the comment rewrite in step 7 replaces a description of a flag that no longer exists.

**Doc pages**

- [`docs/components/Checkbox.md:28`](packages/lib/docs/components/Checkbox.md#L28) — the `setSelected` row becomes `isSelected()` / `setSelected(boolean, fireAction?)`.
- [`docs/components/Checkbox.md:36`](packages/lib/docs/components/Checkbox.md#L36) — the `on("action", fn)` row replaces "Subscribe to the click action" with a description that matches the code: fires on a user toggle *and* on a programmatic `setSelected`, unless the caller passes `fireAction: false`.
- `docs/components/Checkbox.md` — a new short section after *Indeterminate / mixed state* ([`:38-40`](packages/lib/docs/components/Checkbox.md#L38)) titled **Programmatic writes and `action`**, giving the two-line example (`cb.setSelected(true)` fans out; `cb.setSelected(true, false)` does not) and pointing at `RadioButton` for the contrast.
- [`docs/components/RadioButton.md:48-49`](packages/lib/docs/components/RadioButton.md#L48) — the method table has **no** `on("action", fn)` row at all; add one stating that it fires once per user activation and never on a programmatic `setSelected`, and cross-link `Checkbox` for the difference.
- [`docs/concepts/events.md:23-30`](packages/lib/docs/concepts/events.md#L23) — the `on("action")` paragraph lists `Button`, `Slider` and `ComboBox`; add one sentence noting that `Checkbox` is the one control whose `"action"` also fires for a programmatic write, and that `setSelected`'s `fireAction` parameter opts out.
- `docs/reference/changelog/next.md` — one entry under `## Added` → `### Components` ([`:137`](packages/lib/docs/reference/changelog/next.md#L137)) for the parameter, and one under `## Fixed` → `### Components` ([`:596`](packages/lib/docs/reference/changelog/next.md#L596)) for the boolean cell's double commit. No migration note: no existing call changes behaviour, so `docs/reference/migration/next.md` is untouched.

**Records**

- [`99-synthesis.md:921`](plans/research/render-review-2026-09-15/99-synthesis.md#L921) — append to C34's row, in the inline-correction style the row already uses: settled by this plan; the opt-out is `Checkbox.setSelected`'s `fireAction`, `RadioButton` is unchanged, and the residue is C40.
- `01-phase2-status-pass.md` — mark C34's row in the *Stuck state, a11y, battery* table ([`:73`](plans/research/render-review-2026-09-15/01-phase2-status-pass.md#L73)) as settled, and add **C40** to *Found while planning and implementing, not in the register* ([`:248`](plans/research/render-review-2026-09-15/01-phase2-status-pass.md#L248)), alongside C37–C39.[^c40-boundary]
- `packages/qa/README.md` — extend the *Reproduces* cell for `table-rows` ([`:312`](packages/qa/README.md#L312)) and `form-flat` ([`:322`](packages/qa/README.md#L322)) with cases 9 and 10.

---

## Potential Challenges

- **The existing `BooleanCell` read-only test passes for the wrong reason.** It never realises the editor's checkbox element, so `setSelected` takes the pre-mount branch and the second commit never happens. Step 13 must realise the element first, or the regression goes uncovered.
- **The `"action"` listener's `this` binding.** `Event`'s dispatcher invokes a listener bound to the component it was registered on. Converting `BooleanEditor`'s inline arrow to a named method would silently bind `this` to the `Checkbox`.[^arrow-required] Step 6 says to leave it.
- **`Checkbox.on("action")` remains the editor's only user-toggle signal.** A per-instance switch (a `CheckboxOptions` field, or a `setActionOnProgrammaticChange` setter) would have silenced the user path too and broken the editor; only a per-call flag works.[^why-per-call]
- **`AbstractBooleanMenuRow.setChecked` still fans out.** It reaches the checkbox through `Bindable.setValue`, which takes no flag. The dispatch is harmless there — the row listens on itself, not the control.[^menu-rows] Leave it.

---

## Critical Files

| File | Why |
|---|---|
| [`component/list/AbstractSelectableList.ts:1474-1503`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1474) | The precedent: a defaulted `fireEvent` parameter suppressing a fan-out for a programmatic write, with the doc wording to mirror. |
| [`component/input/ComboBox.ts:1193-1211`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L1193) | The same precedent seen from the calling side — an in-library consumer passing `false`. |
| [`component/input/Checkbox.ts:325-340`, `:426-455`, `:526-570`](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L325) | The listener wiring, `setSelected`, and the `on` / `off` pair being changed. |
| [`component/input/RadioButton.ts:325-378`, `:435-478`](packages/lib/src/typescript/lib/component/input/RadioButton.ts#L325) | The sibling being left alone, and the `activate()`-fires-`change` shape that makes its `"action"` correct. |
| [`component/table/cell/editor/Boolean.ts`](packages/lib/src/typescript/lib/component/table/cell/editor/Boolean.ts) | The whole file is in scope; read it before editing. |
| [`core/Event.ts:248-300`, `:386-411`](packages/lib/src/typescript/lib/core/Event.ts#L248) | The dispatcher's exact-target matching and `fireEvent`, which together explain why the real click never reaches `on("action")`. |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | The two-event-surface split the `fireAction` naming decision rests on. |

---

## Non-Goals

- **Removing the default fan-out.** The register requires an opt-out, not a removal, and the synthetic click is currently `on("action")`'s only delivery path for user toggles too.
- **Fixing `on("action")`'s real-click delivery.** Recorded as C40.[^c40-boundary]
- **Giving `RadioButton` an `action` on programmatic writes**, or a `fireAction` parameter.[^radio-is-right]
- **Changing `ButtonGroup`.** Its mutual-exclusivity sweep at [`overlay/ButtonGroup.ts:114-121`](packages/lib/src/typescript/lib/overlay/ButtonGroup.ts#L114) calls `setSelected` on `RadioButton` and `ToggleButton` only — never `Checkbox` — so nothing it does changes.
- **Changing `CheckboxMenuRow` / `RadioMenuRow`, or their doc pages.** Their `"action"` is the row's own `ListenerBag` event, fired from `activate()`, and never touched the checkbox's.[^menu-rows]
- **Removing `Body.onSubtreeClick`'s `instanceof MouseEvent` guard.** Still load-bearing for the user path.
- **Touching `Toggle`.** It exposes no `"action"` event and its `setValue` dispatches nothing.

---

## Notes

[^double-commit]: `BooleanEditor.toggle()` calls `this._checkBox.setSelected(next)` and then emits `"change"` itself. With `_suppressCommit` false on that path, the synthetic click reaches the constructor's `"action"` listener, which emits `"change"` too — so one activation produces two. `BooleanCell.startEdit()` is the reachable trigger, and it is wired to a double-click on the cell and to the body's keyboard activation, so a user toggling a boolean cell by keyboard commits the value twice. Measured offline against `master` `b3d67f7f`: a `BooleanCell` whose editor's checkbox element is realised reports `commits` of `[true, true]` from a single `startEdit()`. `ModelRecord.set` short-circuits the identical second write, so the visible damage is bounded — but a consumer's own `"commit"` handler runs twice.

[^radio-is-right]: Probe-verified against `master` `b3d67f7f`. `RadioButton.on("action", fn)` is `Event.addListener(this, "change", fn)` on the root ([`RadioButton.ts:453`](packages/lib/src/typescript/lib/component/input/RadioButton.ts#L453)), and `activate()` fires exactly that event on exactly that element ([`:334`](packages/lib/src/typescript/lib/component/input/RadioButton.ts#L334)). Measured: a click on the ring gives 1 delivery, a click on the root gives 0, `setSelected(true)` gives 0, and `activate()` on an already-selected radio gives 0. That is precisely what ARCHITECTURE.md's `"action"` contract asks for — the component's primary user interaction — so the radio is the correct sibling and the checkbox the deviant one. Aligning the radio *upward* was rejected for a concrete reason, not only a purist one: `ButtonGroup.updateButtonStates` deselects every sibling with `setSelected(false)` ([`overlay/ButtonGroup.ts:119`](packages/lib/src/typescript/lib/overlay/ButtonGroup.ts#L119)), so a programmatic fan-out on the radio would announce an `"action"` on every button in the group the user did not touch, once per selection change — and `ButtonGroup` itself listens on `"action"` ([`:270`](packages/lib/src/typescript/lib/overlay/ButtonGroup.ts#L270)), so the sweep would re-enter itself.

[^c40-boundary]: The proposed C40 entry: *`Checkbox.on("action")` is delivered by the wrong event in both directions. `on("action", fn)` registers a direct-target listener on the checkbox root ([`Checkbox.ts:544`](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L544)); the user's click lands on the inner `_box` ([`:335`](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L335)); and `Event`'s dispatcher matches direct listeners by exact target id ([`core/Event.ts:276`](packages/lib/src/typescript/lib/core/Event.ts#L276)). So the real click is never delivered, while a click on the root's own area — which changes nothing — is. Measured on `master` `b3d67f7f`: a click on `_box` delivers 1 (via the synthetic re-fire), a click on the root delivers 1 with `isSelected()` unchanged.* It is left out of this plan because every fix for it changes the contract in a way no default can preserve. Widening the registration to `Event.addSubtreeListener` would deliver `"action"` for clicks on the label, on dead space, and on a disabled or read-only checkbox — strictly more spurious deliveries than today. Having `Checkbox.activate()` fire `"action"` the way `RadioButton.activate()` does, and deleting the synthetic click, is the removal the register forbids, and would break every consumer that relies on the programmatic fan-out. This plan's change is instead byte-compatible by default: one optional parameter, and no behaviour changes unless a caller passes it.

[^why-per-call]: A per-instance switch was considered and rejected on a hard constraint, not a preference. `BooleanEditor`'s `on("action", …)` listener is its *only* signal that the user toggled the checkbox — a real click reaches the editor solely through the synthetic click `setSelected` re-fires. An instance-level "never fan out" flag would therefore silence the user path along with the rebind path, and the boolean cell would stop committing user edits entirely. Only a per-call flag separates the editor's own programmatic writes from the user's, which is also exactly what `_suppressCommit` was hand-rolling — a dynamically scoped per-call flag, implemented as a field.

[^narrow-scope]: Gating `notifyChange` as well would have matched `setSelectedIndex`'s scope, and was rejected. `notifyChange` calls `setDirty` ([`component/input/AbstractInput.ts:219`](packages/lib/src/typescript/lib/component/input/AbstractInput.ts#L219)), which relays a dirty flag up the ancestor chain; suppressing it on a pooled table rebind would silently change the table's dirty-state bookkeeping, which [`tests/component/table/Table.dirtyState.test.ts`](packages/lib/tests/component/table/Table.dirtyState.test.ts) covers. Keeping the flag narrow means the change is confined to a single DOM dispatch with one known consumer.

[^why-listener-stays]: After the change, `BooleanEditor`'s two programmatic sites suppress the dispatch and the user path does not, so the listener fires only for a genuine user toggle — which is what the guard was approximating. Verified by enumeration: the only three routes into `Checkbox.setSelected` from inside the editor are `setValue` (suppressed), `toggle` (suppressed), and `Checkbox.activate()` from a pointer or Space press (not suppressed, and reached only through `AbstractBooleanInput.activateFromPointer` / `handleActivationKey`, both of which already guard on enabled and not read-only).

[^arrow-required]: `Event`'s dispatcher invokes each listener as `entry.listener.apply(compFunc.component, [evnt])` ([`core/Event.ts:285`](packages/lib/src/typescript/lib/core/Event.ts#L285)), where `compFunc.component` is the component the listener was registered against. `Checkbox`'s own constructor documents the same trap for its `_box` click listener ([`Checkbox.ts:328-334`](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L328)). ARCHITECTURE.md's *Listeners must reference a named function* rule is therefore already unsatisfiable at this site without a bound wrapper; the inline arrow is pre-existing and stays, under the surgical-changes rule.

[^menu-rows]: Verified against the register's own correction. `AbstractBooleanMenuRow.installControl` sets `setPointerEvents("none")` on the hosted control and registers a **direct** click listener on the row itself ([`component/container/AbstractBooleanMenuRow.ts:256-270`](packages/lib/src/typescript/lib/component/container/AbstractBooleanMenuRow.ts#L256)). The synthetic click targets the checkbox's own element, so the dispatcher's exact-target match never reaches the row's bucket. The rows emit their own `"action"` from `activate()` through a `ListenerBag` ([`:132-139`](packages/lib/src/typescript/lib/component/container/AbstractBooleanMenuRow.ts#L132)), which this change does not touch.

[^probe]: The offline `RecordingDOMSink` routes `dispatchEvent` to the handlers registered on the window handle, which is where `Event` installs its single capture dispatcher, so `Event.fireEvent(component, makeEvent(handle, "click", { button: 0 }))` exercises the real routing path offline. That is what makes cases 1–8 offline-assertable, and it is why `tests/component/input/SelectableText.test.ts` and `Slider.test.ts` already drive real events this way. The comment at [`Checkbox.test.ts:166-172`](packages/lib/tests/component/input/Checkbox.test.ts#L166) claiming a listener cannot be invoked offline is narrower than the harness; do not extend that claim to the new cases, and do not rewrite the comment either — it explains why *that* test asserts the sink write.
