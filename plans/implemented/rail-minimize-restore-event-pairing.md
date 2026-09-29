---
depends-on: [animation-finish-transition-clear]
touches-shared:
  - packages/lib/src/typescript/lib/overlay/AbstractWindow.ts
  - packages/lib/tests/overlay/AbstractWindow.railHandoverAnimated.test.ts
  - packages/lib/docs/components/Rail.md
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/docs/reference/migration/next.md
---

# Pairing the Rail Minimize with its Restore — Implementation Plan

## Overview

A window minimizing into a [`Rail`](packages/lib/src/typescript/lib/overlay/Rail.ts) shrinks into its handle over 150 ms — the *genie* animation, in the source's own term, and a *reverse genie* plays it backwards on restore. The window's `"minimize"` event is held back until that shrink lands — [`AbstractWindow.ts:1268-1273`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1268) sets a flag, `_railMinimizeEmitPending`, and the animation's completion emits the event. The flag is the window's **debt**: an event it owes because it entered `"minimized"` but has not said so yet.

Two paths end the shrink early, and today they disagree. [`setRail`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1492) **pays** the debt — it emits the owed `"minimize"` before handing the window over. [`animateRailExpand`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2955) **voids** it, on the ground that a window leaving `"minimized"` has nothing left to announce. A consumer pairing the two events therefore sees a restore that interrupts the shrink as a bare `"restore"`, with no `"minimize"` before it.

This plan makes `animateRailExpand`'s caller pay too, so an interrupted restore announces `['minimize', 'restore']`. The payment becomes one guarded private helper, called from both paths. It also moves: each event must fire while the window reads the state that event names, so the owed `"minimize"` is emitted from [`setWindowState`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1210) ahead of the state flip rather than from inside `animateRailExpand`. Everything changed lives in `AbstractWindow.ts`; `Rail` is the library's only in-tree consumer of these events and needs no change.

**Every line number in this plan is relative to `master` at `5b1a6543`, not to this branch's start point.** This branch starts from `animation-finish-transition-clear`, which inserts roughly 25 lines into `onExitAction` — above every site touched here — so each `AbstractWindow.ts` citation below sits about that much earlier than the real line. The citations are there to locate a site, never to select lines: **the quoted code is what identifies what to change**, and each step that replaces or deletes existing code quotes it. Re-derive any number that matters with `grep -n` in the branch's own tree before editing.

---

## Architecture Decisions

### The debt is paid on every route — R9 is inverted

A restore interrupting the shrink emits the owed `"minimize"` first, then the `"restore"`. Row **R9** in [`AbstractWindow.railHandoverAnimated.test.ts:289`](packages/lib/tests/overlay/AbstractWindow.railHandoverAnimated.test.ts#L289) — "a restore voids the collapse's debt" — pins the opposite rule by name, and is rewritten here rather than deleted.[^reverses-r9]

### One guarded helper, called from both paths

`setRail`'s three-line payment block becomes a private `payRailMinimizeDebt()`, guarded on the flag, called from `setRail` and from `setWindowState`. It sits beside [`restoreNormalMinSize`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1338), the class's nearest existing instance of the shape: a private method that no-ops unless something is owed, called from more than one point that can settle the debt.[^one-helper]

### The owed `"minimize"` fires while the state still reads `"minimized"`

Every other emit in the class announces the state the window is now in: the dock path's `"minimize"` fires inside the `state === "minimized"` branch, `"restore"` fires after the flip to `"normal"`, and `setRail`'s payment fires inside its `isMinimized()` branch. The owed `"minimize"` follows the same rule, which puts it before the state flip — the `this._options.windowState = state` write on [`:1220`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1220).[^announce-the-state]

| Emit | `getWindowState()` inside the listener |
|---|---|
| dock path's `"minimize"` | `"minimized"` |
| completed shrink's `"minimize"` | `"minimized"` |
| `setRail`'s owed `"minimize"` | `"minimized"` |
| **an interrupted restore's owed `"minimize"`** | **`"minimized"`** |
| `"restore"` | `"normal"` (or `"maximized"`) |

### The reverse genie reads its target before the payment

`payRailMinimizeDebt()` is the **last** statement of `setWindowState`'s rail re-show block, after `animateRailExpand()`. Both genies aim at the window's rail handle, and while the collapse runs there is no handle yet — so it aims at a *predicted slot*, extrapolated from the rail's last handle. The owed `"minimize"` is what makes the rail raise the real handle, and `Rail.handleMainAxisOffset` switches to that handle the moment it exists. That handle has not been laid out when it is raised, so a payment ahead of the reverse genie hands the animation a start transform read off geometry that does not exist yet.[^genie-before-payment]

| Order | Reverse genie's `from` transform |
|---|---|
| `animateRailExpand()` then `payRailMinimizeDebt()` | `translate(-50px, -50px) scale(0.005)` — the collapse's own target |
| `payRailMinimizeDebt()` then `animateRailExpand()` | `translate(-50px, NaNpx) scale(0.085)` — an invalid declaration the browser drops |

### A close mid-collapse still announces `"close"` alone

`onExitAction` neither pays nor voids, and stays that way. Row **R12** keeps that pinned.[^close-unchanged]

---

## Internal Structure

### The new helper

Insert after `restoreNormalMinSize`, at [`AbstractWindow.ts:1346`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1346).

```typescript
    /**
     * Emits the `"minimize"` a rail collapse deferred to its completion but
     * was ended before reaching, so a window that entered `"minimized"`
     * announces it exactly once however that collapse finished. A no-op unless
     * a collapse is still holding the debt — a completed one has already
     * emitted, and a minimize into the built-in dock defers nothing.
     *
     * @remarks Called from the two paths that end a collapse on a window that
     * is still `"minimized"`: `setRail`, whose window stays minimized under a
     * new owner, and `setWindowState`'s rail re-show, whose window is leaving
     * `"minimized"` and whose `"restore"` would otherwise be unpaired. The
     * flag is cleared before the emit, so a listener that calls back into
     * either path cannot draw on the debt a second time. `onExitAction`
     * deliberately does not call this: it has already emitted `"close"`, and
     * the window is being destroyed.
     */
    private payRailMinimizeDebt(): void {
        if (!this._railMinimizeEmitPending) {
            return;
        }

        this._railMinimizeEmitPending = false;
        this.emit("minimize");
    }
```

### `setWindowState`'s rail re-show block

Two adjacent pieces of `setWindowState` are involved, near [`AbstractWindow.ts:1220`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1220): the state flip, `this._options.windowState = state;`, and the `if (from === "minimized" && this._rail !== null) {` block directly below it. Locate the block by its own first comment line, `// A rail-minimized window is hidden outright (the rail handle is its`. The two swap places — the block moves **above** the flip, the flip is unchanged and now follows it — and the block gains one call and one comment, with the third line of its existing comment reworded. This is what to replace:

```typescript
        this._options.windowState = state;

        // A rail-minimized window is hidden outright (the rail handle is its
        // minimized representation), so re-show it and play the reverse genie —
        // scaling/fading back up out of the rail — before the state branch runs.
        if (from === "minimized" && this._rail !== null) {
            this.setDisplayed(true);
            this.animateRailExpand();
        }
```

And this is the result, exactly:

```typescript
        // A rail-minimized window is hidden outright (the rail handle is its
        // minimized representation), so re-show it and play the reverse genie —
        // scaling/fading back up out of the rail — before the state flip and
        // the state branch below.
        if (from === "minimized" && this._rail !== null) {
            this.setDisplayed(true);
            this.animateRailExpand();

            // Then pay what an interrupted collapse still owes, so the
            // `"restore"` at the end of this method is not the first thing the
            // consumer hears about a window that did enter `"minimized"`.
            //
            // Placed last in this block, for two reasons. The state has not
            // flipped yet, so the event announces the state the window is
            // still in, as every other emit in this class does. And the
            // reverse genie above has already read its target: this emit makes
            // the rail raise a handle, `Rail.handleMainAxisOffset` answers from
            // that handle rather than from the predicted slot the collapse
            // aimed at, and the handle is not laid out yet — so a payment
            // ahead of `animateRailExpand` hands it a `NaN` translate. The
            // `"restore"` below takes the handle straight back off, leaving the
            // rail as it was.
            this.payRailMinimizeDebt();
        }

        this._options.windowState = state;
```

### `animateRailExpand`'s void

Delete these six lines — five of comment and the write — plus the blank line that follows them, so no double blank is left behind. They sit between the `_railCollapseActive = false;` write and the collapse-cancel paragraph, near [`AbstractWindow.ts:2950`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2950):

```typescript
        // And the collapse's deferred `"minimize"` is void: expanding means the
        // window is no longer minimized, so there is nothing left to announce.
        // A debt kept past the state it describes is a stale debt — the shape
        // `Card`'s parked scroll restore follows when its own becomes
        // unreachable.
        this._railMinimizeEmitPending = false;
```

Nothing replaces them — the caller pays immediately after this method returns.

### `setRail`'s payment

One contiguous edit inside `setRail`'s `isMinimized()` branch, near [`AbstractWindow.ts:1479`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1479). **These seventeen lines** — thirteen of comment and the four-line `if`, the only `if (this._railMinimizeEmitPending)` in the file — are what to replace:

```typescript
            // That completion was also the rail path's only emitter of
            // `"minimize"`, deferred to the end of the collapse — so cancelling
            // it would swallow the event outright, leaving a window that is
            // minimized and docked having never announced it, and a later
            // restore emitting an unpaired `"restore"`. Fire what the collapse
            // owed, as `Accordion.detach` runs the cleanup branch its own
            // cancelled animations owned. Sitting after the `unregisterWindow`
            // above is not load-bearing — a rail reached here would raise a
            // handle and have it removed again inside this same call — but it
            // keeps the old rail out of an event that no longer concerns it. A
            // newly attached rail has already raised its handle in
            // `registerWindow`, and takes this as the no-op its
            // `showWindowHandle` guard makes it.
            if (this._railMinimizeEmitPending) {
                this._railMinimizeEmitPending = false;
                this.emit("minimize");
            }
```

And these sixteen are the replacement — fifteen of comment and one call, so the block is one line shorter than it was. The whole argument survives; `Fire` becomes `Pay` to match the helper's name, and one sentence is added naming the other site that now calls it. Splice by matching the first and last lines above, not by counting:

```typescript
            // That completion was also the rail path's only emitter of
            // `"minimize"`, deferred to the end of the collapse — so cancelling
            // it would swallow the event outright, leaving a window that is
            // minimized and docked having never announced it, and a later
            // restore emitting an unpaired `"restore"`. Pay what the collapse
            // owed, as `Accordion.detach` runs the cleanup branch its own
            // cancelled animations owned. `setWindowState`'s rail re-show pays
            // the same debt through the same helper, for a window that is
            // leaving `"minimized"` rather than staying in it. Sitting after the
            // `unregisterWindow` above is not load-bearing — a rail reached here
            // would raise a handle and have it removed again inside this same
            // call — but it keeps the old rail out of an event that no longer
            // concerns it. A newly attached rail has already raised its handle
            // in `registerWindow`, and takes this as the no-op its
            // `showWindowHandle` guard makes it.
```

---

## Ordered Implementation Steps

1. **Reconcile the row numbering first.** Run `grep -c "it('R" packages/lib/tests/overlay/AbstractWindow.railHandoverAnimated.test.ts`. **Expect `18`** — R1-R14 from the two earlier rail plans plus R15-R18 from `animation-finish-transition-clear`, this branch's start point. If the count is not 18, the dependency's row set has moved since this plan was written: renumber this plan's four rows to continue from the real highest `R` in the file, and carry the new numbers through every step and table below rather than editing around the collision.

2. **`packages/lib/tests/overlay/AbstractWindow.railHandoverAnimated.test.ts`** — rewrite **R9** (`:289`) and **R11** (`:351`) to the sequences in `## Expected Behaviour`, which quotes the existing text of each alongside its replacement. Take the new titles and comments from there too. Add rows **R19**, **R21** and **R22** at the end of the `describe`. Append one sentence to the file's header comment, leaving the dependency's own header sentence intact: *R19-R22 are `plans/implemented/rail-minimize-restore-event-pairing.md`'s rows, which also invert R9 and R11 — a restore that interrupts the collapse pays the deferred `"minimize"` instead of voiding it, so the pair balances.*

3. **Run it** — `npm -w packages/lib run test -- AbstractWindow.railHandoverAnimated`. Twenty-one rows: **R9, R11, R19, R21 and R22 fail; R1-R8, R10 and R12-R18 pass.** Each of the five must fail on its event assertion; R22 in particular must fail on `['minimize', 'restore']` and not on `getWindowState()`, which already reads `'maximized'` today. R15-R18 in the pass list are the dependency's, not this plan's.

4. **`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts`** — add `payRailMinimizeDebt()` immediately after `restoreNormalMinSize`'s closing brace and before `isMaximized()`'s JSDoc, exactly as `## Internal Structure` gives it.

5. **Same file, `setRail`** — replace the whole `if (this._railMinimizeEmitPending) { … }` block inside the `isMinimized()` branch with the `this.payRailMinimizeDebt();` call, and replace the comment paragraph directly above it with the reworded text `## Internal Structure` quotes in full.

6. **Re-run step 3's file** — unchanged from step 3. R6 and R7 must still pass: they pin `setRail`'s call site, and this step only moved its body.

7. **Same file, `animateRailExpand`** — delete the six-line block `## Internal Structure` quotes verbatim: the five comment lines beginning `// And the collapse's deferred` and the `this._railMinimizeEmitPending = false;` write beneath them, plus the blank line that follows. Do not leave `// unreachable.` behind — it is the fifth comment line, not a separate paragraph.

8. **Same file, `setWindowState`** — replace the nine lines `## Internal Structure` quotes as the original (the flip, then the rail re-show block) with the result it quotes beneath them: the two swap order, the block gains the `payRailMinimizeDebt()` call as its last statement, and its comment's third line is reworded.

9. **Re-run step 3's file** — all twenty-one rows pass. R20 does not exist yet.

10. **Add row R20** to the same test file, per `## Expected Behaviour` — twenty-two rows now. It passes immediately; step 11 is what verifies it.

11. **Mutation-verify R19 and R20.** Move `payRailMinimizeDebt()` from the end of `setWindowState`'s rail re-show block to its start (before `setDisplayed(true)`) and re-run the file — **R20 must fail, and only R20**. Move it instead to just after `this._options.windowState = state;` and re-run — **R19 must fail, and only R19**. Restore the prescribed position; neither mutation may be left in place.

12. **Grep invariants** —
    - `grep -c 'payRailMinimizeDebt' packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` — expect `3`: the declaration, `setRail`'s call, `setWindowState`'s call.
    - `grep -c '_railMinimizeEmitPending' packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` — expect `5`: the field declaration on `:338`, the arming write in the `"minimized"` branch, the clear in the collapse's own completion, and the helper's guard and clear. None inside `animateRailExpand`.

13. **`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` — public JSDoc.** Update `WindowEvent`'s JSDoc (`:101-114`), `setWindowState`'s `@remarks` (`:1205-1208`) and `setRail`'s `@remarks` (`:1431-1436`), per `## Documentation Impact`. Do not `{@link}` `payRailMinimizeDebt` from any of the three — it is private, and `CODE_CONVENTIONS.md` forbids linking an excluded symbol from rendered docs.

14. **`packages/lib/docs/components/Rail.md`** — extend the deferred-`minimize` sentence on `:78`, per `## Documentation Impact`.

15. **`packages/lib/docs/reference/changelog/next.md`** — add the `## Breaking changes` → `### Overlay` entry from `## Documentation Impact`, above the page's existing `## Added`. Both headings are new.

16. **`packages/lib/docs/reference/migration/next.md`** — add the entry from `## Documentation Impact`, under the `##` heading it gives verbatim, in the `**What changed and why.**` / `**Who needs to act.**` shape [`migration/0.10.0.md:109`](packages/lib/docs/reference/migration/0.10.0.md#L109) uses for a behaviour-only change.

17. **Run `## Verification`.**

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` |
| Modify | `packages/lib/tests/overlay/AbstractWindow.railHandoverAnimated.test.ts` |
| Modify | `packages/lib/docs/components/Rail.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/docs/reference/migration/next.md` |

---

## Expected Behaviour

### Every route into and out of `"minimized"`

The contract is the deliverable, so the whole of it is below. "Inside 150 ms" means the shrink-into-the-rail animation is still running; `WINDOW_ANIM_DURATION_MS` is 150.

| # | Route | Before | After |
|---|---|---|---|
| A | Rail minimize, shrink completes | `['minimize']` | unchanged |
| B | Rail minimize, then `restore()` inside 150 ms | `['restore']` | **`['minimize', 'restore']`** |
| C | Rail minimize, then `setRail(other)` inside 150 ms | `['minimize']` | unchanged |
| D | Rail minimize, then `setRail(null)` inside 150 ms, then `restore()` | `['minimize', 'restore']` | unchanged |
| E | Rail minimize, then `requestClose()` inside 150 ms | `['close']` | unchanged |
| F | Rail minimize, then `setWindowState("normal")` inside 150 ms | `['restore']` | **`['minimize', 'restore']`** |
| G | Rail minimize, then `setWindowState("maximized")` inside 150 ms | `['restore']` | **`['minimize', 'restore']`** |
| H | Rail minimize, shrink completes, then `restore()` | `['minimize', 'restore']` | unchanged |
| I | Minimize with no rail attached (the built-in dock strip) | `['minimize']` | unchanged |
| J | Any of A-I under `prefers-reduced-motion: reduce` | as A / H / I | unchanged |
| K | Rail minimize, then `dispose()` inside 150 ms | `[]` | unchanged |

B and F are the same route whenever `_preMinimizeState` is `"normal"`, because `restore()` is `setWindowState(this._preMinimizeState)` ([`AbstractWindow.ts:1405-1410`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1405)); a window that was maximized before it minimized reaches **G** through the same `restore()` call. Either way the payment is the same line. The user's route to B and G alike is the header's minimize button, which calls `toggleMinimize` — it takes `setWindowState("normal")` on a window whose state already reads `"minimized"`, so two quick clicks land on F's wording and B's behaviour.

J is unchanged because `Animation.play` under reduced motion writes the `to` styles and calls `onComplete` in the same task ([`core/Animation.ts:120-125`](packages/lib/src/typescript/lib/core/Animation.ts#L120)). The shrink therefore lands, and emits, before the next call can run: no debt is ever outstanding, so B-E and K have no in-flight shrink to interrupt and this plan changes none of them.

G runs the same line as B — the rail re-show block's condition is `from === "minimized" && this._rail !== null`, which does not look at the target state. R22 exists to keep it that way.

### Rows R9 and R11 — rewritten, unit-testable

Both live in [`AbstractWindow.railHandoverAnimated.test.ts`](packages/lib/tests/overlay/AbstractWindow.railHandoverAnimated.test.ts) and use its existing `collapsingWindow` helper.

**R9** — new title: *a restore pays the collapse's debt, so the next minimize announces on its own*. Its `const` and `win.on` setup lines are unchanged. Replace the ten lines from its comment to its expectation:

```typescript
        // Restoring mid-collapse ends the debt rather than parking it: the
        // window is not minimized any more, so there is nothing left to
        // announce, and carrying it forward would spend it on the *next*
        // minimize.
        win.restore();
        win.setRail(null);
        win.minimize();
        win.setRail(rail);

        expect(events).toEqual(['restore', 'minimize']);
```

with:

```typescript
        // Restoring mid-collapse pays the debt rather than voiding it: the
        // window did enter `"minimized"`, so the event is owed, and it lands
        // before the `"restore"` that superseded it. The debt is settled by
        // that payment, so the `minimize()` below announces once on its own
        // account and the `setRail` after it adds nothing.
        win.restore();
        win.setRail(null);
        win.minimize();
        win.setRail(rail);

        expect(events).toEqual(['minimize', 'restore', 'minimize']);
```

**R11** — new title: *a restore mid-collapse announces the minimize it owed, before the restore*. The whole body is replaced, because `runAnimationToCompletion()` moves: it currently runs before the single assertion and must now sit between two. Replace everything between the `it(` line and its closing `});`:

```typescript
        const events: string[] = [];

        const { win } = collapsingWindow(events);

        win.restore();
        runAnimationToCompletion();

        // The cancelled collapse owes nothing: the window is `"normal"` again,
        // so there is no minimize left to announce, and one arriving after the
        // restore would leave the pair inverted.
        expect(events).toEqual(['restore']);
```

with:

```typescript
        const events: string[] = [];

        const { win } = collapsingWindow(events);

        win.restore();

        // Asserted before the drain, and as an ordered sequence: the owed
        // `"minimize"` lands first, in the same task as the `"restore"`.
        expect(events).toEqual(['minimize', 'restore']);

        runAnimationToCompletion();

        // And the collapse the restore cancelled adds nothing behind them.
        expect(events).toEqual(['minimize', 'restore']);
```

### Rows R19-R22 — new, unit-testable

Numbered from R19 because `animation-finish-transition-clear` — this branch's start point — already adds **R15, R16, R17 and R18** to this file, a set verified against that plan on 2026-09-29. Step 1's row count is what catches any later drift in it.

**R19** — *each event announces the state the window reads*:

```typescript
    it('R19: the owed minimize announces `"minimized"`, the restore `"normal"`', () => {
        const seen: string[] = [];

        const { win } = collapsingWindow();

        win.on('minimize', () => { seen.push(`minimize:${win.getWindowState()}`); });
        win.on('restore',  () => { seen.push(`restore:${win.getWindowState()}`);  });

        // A consumer that reads the state in the handler must see the state the
        // event names. That is what the debt is for: the window's state reads
        // `"minimized"` for the whole shrink, so an interrupted restore that
        // announced only `"restore"` left a transition no event ever reported.
        win.restore();

        expect(seen).toEqual(['minimize:minimized', 'restore:normal']);
    });
```

**R20** — *the reverse genie's start transform is the collapse's own target*:

```typescript
    it('R20: the reverse genie replays from the transform the collapse aimed at', () => {
        const { win } = collapsingWindow();

        const target = (win as unknown as { railGenieTransform(): string }).railGenieTransform();

        // Guard: the comparison below is a string equality, so a degenerate
        // target would satisfy it from both sides at once.
        expect(target).not.toContain('NaN');

        const apply = vi.spyOn(DOM.sink, 'apply');

        // The owed `"minimize"` makes the rail raise a handle, and
        // `Rail.handleMainAxisOffset` reads that handle's laid-out position
        // instead of the slot the collapse predicted — but the handle has not
        // been laid out, so it answers `NaN`. Paying the debt before the
        // expansion reads its target therefore hands `Animation.play` a
        // transform the browser drops, and the window expands from nowhere
        // rather than out of the rail.
        win.restore();

        expect(styleWritesFor(apply, win, 'transform')).toEqual([target]);
    });
```

**R21** — *the transient handle balances*:

```typescript
    it('R21: the handle the owed minimize raises is gone again by the end of the restore', () => {
        const { win, rail } = collapsingWindow();

        const handles: number[] = [];

        // Registered after `collapsingWindow`, so the rail's own listeners are
        // ahead of these in the bucket and each reading is post-rail.
        win.on('minimize', () => { handles.push(rail.getComponents().length); });
        win.on('restore',  () => { handles.push(rail.getComponents().length); });

        win.restore();

        // The rail treats the owed `"minimize"` as any other: it raises a
        // handle, and the `"restore"` behind it takes the handle off. An
        // interrupted restore is therefore indistinguishable from a completed
        // shrink followed at once by a restore, which is the point.
        expect(handles).toEqual([1, 0]);
        expect(rail.getComponents().length).toBe(0);
    });
```

**R22** — *a restore to `"maximized"` pays the same debt*:

```typescript
    it('R22: a maximize mid-collapse pays the debt the same way a restore does', () => {
        const events: string[] = [];

        const { win } = collapsingWindow(events);

        // The payment is gated on leaving `"minimized"` with a rail attached,
        // not on the state being entered — a condition narrowed to
        // `state === "normal"` would drop this arm silently.
        win.setWindowState('maximized');

        expect(events).toEqual(['minimize', 'restore']);
        expect(win.getWindowState()).toBe('maximized');
    });
```

### What each assertion catches

Every row below goes red on at least one mutation of a line this plan ships, and no row is satisfied by an outcome the change did not produce.

| Row | Assertion | Mutation of a shipped line that turns it red |
|---|---|---|
| R9 | `['minimize', 'restore', 'minimize']` | `payRailMinimizeDebt`'s `emit("minimize")` dropped, leaving the bare flag clear (the void restored) — gives `['restore', 'minimize']` |
| R9 | same | the helper's `_railMinimizeEmitPending = false` dropped (paid but not settled) — the closing `setRail(rail)` pays again, giving `['minimize', 'restore', 'minimize', 'minimize']` |
| R9 | same | `setWindowState`'s `payRailMinimizeDebt()` call dropped — the debt survives the restore and the closing `setRail(rail)` spends it, giving `['restore', 'minimize', 'minimize']` |
| R11 | `['minimize', 'restore']` before the drain | `setWindowState`'s call dropped — gives `['restore']` |
| R11 | the same array after the drain | `animateRailExpand`'s collapse cancel dropped — the completion emits a third `"minimize"` |
| R19 | `['minimize:minimized', 'restore:normal']` | the call moved below `this._options.windowState = state` — gives `minimize:normal` |
| R20 | one `transform` write, equal to `target` | the call moved above `animateRailExpand()` — gives `translate(…, NaNpx) scale(…)` |
| R20 | same | `animateRailExpand`'s `from` dropped — `Animation.play` then runs `applyTransitionAndTo` synchronously ([`core/Animation.ts:247-254`](packages/lib/src/typescript/lib/core/Animation.ts#L247)) instead of yielding two frames, so the one write is the animation's `to`: `['translate(0, 0) scale(1)']` |
| R21 | `[1, 0]` | `setWindowState`'s call dropped — only `"restore"` fires, and the rail's own handler no-ops on a null handle, giving `[0]` |
| R22 | `['minimize', 'restore']` | a `state === "normal"` guard added around the payment — gives `['restore']` |
| R6 (existing) | `['minimize']` right after `setRail(null)` | `setRail`'s `payRailMinimizeDebt()` call dropped — gives `[]` |
| R7 (existing) | `['minimize']` after `setRail(other)` | the same call dropped |
| R12 (existing) | `['close']` | a `payRailMinimizeDebt()` call added to `onExitAction` — gives two events |
| W27 / W28 (existing) | one `"minimize"` counted | the helper's `if (!this._railMinimizeEmitPending) return;` guard dropped |

No existing row is left vacuous by this change.[^no-row-vacuous]

R20 passes on the code as it stands, so it gets no red-green cycle: the steps add it after the fix and step 11's mutation is what verifies it.

### Manual verification — in-engine, the user's to run

The demo app's rail demo ([`packages/lib/src/typescript/MiscPanel.ts:1194-1217`](packages/lib/src/typescript/MiscPanel.ts#L1194)) is the only in-engine affordance for route B, and it is the useful one: its rail carries two drawer handles, so the predicted-slot offset the genie aims at is non-zero and a corrupted start transform is visible rather than coincidentally correct.

1. Open the launcher rail, minimize the rail-docked window, and click the minimize button a second time inside the shrink. The window must grow back **out of the rail handle's corner**, as it does after a completed shrink — not appear at full size and fade in, which is what a dropped `transform` looks like.
2. Through the same gesture, no handle may be left on the rail afterwards, and none may be seen to flash: the raise and the removal happen in one task, before a paint.

---

## Verification

1. `npm run typecheck` and `npm -w packages/lib run typecheck:test` — both clean.
2. `npm -w packages/lib run test -- AbstractWindow.railHandoverAnimated` — 22 rows, all passing: R1-R14 from the two earlier rail plans, R15-R18 from `animation-finish-transition-clear`, and R19-R22 from this one.
3. `npm test` from the worktree root — the whole library suite green, with four more tests than the branch point had and the same file count. Measured on `master` at `8dfdf8f5`: **521 files, 8763 passed, 2 todo** — still the count at `5b1a6543`, which touched only the post-campaign agenda and a QA sweep script, neither in `packages/lib`. This branch starts from `animation-finish-transition-clear`, which adds rows of its own, so compare against the branch point rather than against that number. Never pass a bare `--root`: `llms-generate.test.ts` resolves its fixture from the working directory.
4. Step 11's two mutations, each run and reverted: R20 red with the payment ahead of `animateRailExpand()`, R19 red with it behind the state flip, and no other row red in either run.
5. `npm run lint` — clean.
6. `npm run docs:api` — `0 errors`, and no more than the 14 pre-existing warnings. The three JSDoc edits name no private symbol, so they add none.
7. `npm run docs:llms:check` after `docs:api` — `108 catalogued, 0 unaccounted for`. No doc page is added or renamed.
8. Step 12's two greps.

Nothing here opens a window: the in-engine pass is `## Expected Behaviour`'s manual list, which is the user's to run.

---

## Documentation Impact

`payRailMinimizeDebt` is private and gets no doc page. Four documented surfaces state the old contract and change.

**`WindowEvent`'s JSDoc** ([`AbstractWindow.ts:101-114`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L101)) already says `"minimize"` fires when the window enters `"minimized"` and `"restore"` when it leaves it. That becomes true on every route that announces anything, so the sentence stays and gains one after it, in the same careful register `setRail`'s own `@remarks` already uses: on the rail path the `"minimize"` is held back until the shrink-into-the-rail animation lands, and a restore or a `setRail` that ends that animation early emits it first — so a `"minimize"` always precedes the `"restore"` it pairs with. It fires **at most** once per minimize, whichever route that minimize takes: a window closed inside the shrink announces `"close"` alone, and one disposed inside it announces nothing.

**`setWindowState`'s `@remarks`** ([`:1205-1208`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1205)) gains one sentence: leaving `"minimized"` while a rail's shrink animation is still running emits that shrink's deferred `"minimize"` before the `"restore"`.

**`setRail`'s `@remarks`** ([`:1431-1436`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1431)) currently reads "so a `setRail` that cancels one part-way fires it here instead". `setRail` is no longer the only path that does, so the clause becomes: a `setRail` that cancels one part-way fires it here, as a restore that cancels one fires it before its own `"restore"`. The following sentence — "It fires at most once per minimize, whichever route it takes" — is already correct and stays.

**`packages/lib/docs/components/Rail.md:78`** ends the same claim with "so a `setRail` that cancels one part-way fires it instead of losing it. It arrives once per minimize either way." Extend the first of those two sentences to name the other path: *…so a `setRail` that cancels one part-way fires it instead of losing it, and so does a restore that interrupts the shrink — the `minimize` arrives before the `restore` that ended it.*

**`packages/lib/docs/reference/changelog/next.md`** gains a `## Breaking changes` section with a `### Overlay` subsection, placed **above** the page's existing `## Added`, matching [`changelog/0.10.0.md:3`](packages/lib/docs/reference/changelog/0.10.0.md#L3)'s section order. A change to a public event's firing is filed there rather than under `## Changed`, as `Checkbox`'s and `Slider`'s `"action"` narrowing was ([`0.10.0.md:84`](packages/lib/docs/reference/changelog/0.10.0.md#L84)). One entry: a restore that interrupts a rail minimize now announces `['minimize', 'restore']` instead of `"restore"` alone, matching what `setRail` already did for a window that stays minimized, and matching the two events' documented meaning — the window's state reads `"minimized"` for the whole 150 ms shrink, so the old behaviour left that transition unannounced. A consumer that counts the two events now sees them balance. Close with `See [Migration](/reference/migration/next) for the full note.`, the form every other breaking entry uses.

**`packages/lib/docs/reference/migration/next.md`** gains an entry headed exactly **## A restore that interrupts a rail minimize fires the `minimize` it owed first**, in the sibling pages' `##`-per-change shape ([`migration/0.10.0.md:109`](packages/lib/docs/reference/migration/0.10.0.md#L109) is the nearest behaviour-only precedent). *What changed and why*: the rule that a restore voided the shrink's deferred `"minimize"` is reversed, with the state/event disagreement as the reason. *Who needs to act*: nothing fails to compile; a listener that treated `"minimize"` as "the window is now hidden behind a rail handle" sees one more call, for a window that is about to be shown again in the same task, and should read `getWindowState()` or wait for the paired `"restore"` rather than assume. Code block:

```typescript
// Before — a restore inside the 150 ms shrink
win.on("minimize", onMin);
win.on("restore",  onRes);
win.minimize();
win.restore();      // onRes only

// After
win.minimize();
win.restore();      // onMin, then onRes — in that order, in the same task
```

---

## Potential Challenges

- **The payment's position in `setWindowState` is load-bearing in both directions**, and neither direction is obvious from the code. Ahead of `animateRailExpand()` it corrupts the genie; behind the state flip it announces the wrong state. The two mutations in step 11 are the only thing keeping it there.
- **The rail constructs and detaches a `RailHandle` per interrupted restore.** `Component.removeComponent` is detach-only, so the handle is never disposed — the same cost a completed minimize followed by a restore already pays, through the same `showWindowHandle` / `removeWindowHandle` pair. Not addressed here.[^transient-handle]
- **A `"minimize"` listener that calls `win.restore()`** does *not* early-return, because the payment runs before the state flip and `restore()`'s `isMinimized()` still reads `"minimized"`. The re-entrant call runs the whole of `setWindowState` and emits its own `"restore"`, and the outer call then emits a second one from its captured `from` — `['minimize', 'restore', 'restore']`. This is the one cost of paying before the flip rather than after; it is accepted, because the rule that each event announces the state it names is worth more and holds for every consumer, while this needs a listener that restores a window from inside that window's own minimize event. `Rail.registerWindow`'s `onMinimize` only calls `showWindowHandle` ([`Rail.ts:993`](packages/lib/src/typescript/lib/overlay/Rail.ts#L993)), so no in-tree consumer reaches it.
- **A `"minimize"` listener that calls `setRail(null)` on the same window** now reaches a case it could not reach before, and leaves the window wearing the reverse genie's transform. The window is still visible and still restorable, and the general gap is already recorded as open.[^reentrancy]
- **`ListenerBag.fire` walks the live bucket**, so a `"minimize"` listener that unregisters another `"minimize"` listener skips it. Pre-existing for every emit in the library, and already noted in the test file's `collapsingWindow` helper for the `"close"` bucket; nothing here changes it.

---

## Critical Files

- [`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts) — `:338` the debt flag; `:1210-1323` `setWindowState`, including the flip on `:1220`, the rail re-show block on `:1222-1228`, the arming write on `:1268` and the `"restore"` emit on `:1319`; `:1338-1345` `restoreNormalMinSize`, the precedent for the new helper; `:1448-1550` `setRail`; `:2934-2975` `animateRailExpand`.
- [`packages/lib/src/typescript/lib/overlay/Rail.ts:993-1082`](packages/lib/src/typescript/lib/overlay/Rail.ts#L993) — `registerWindow`'s three listeners, `showWindowHandle` and `removeWindowHandle`: the only in-tree consumer of these events, and what the transient handle costs.
- [`packages/lib/src/typescript/lib/overlay/Rail.ts:1172-1231`](packages/lib/src/typescript/lib/overlay/Rail.ts#L1172) — `handleMainAxisOffset` and `handleMainAxisExtent`, whose handle-present branch is why the payment comes after the reverse genie.
- [`packages/lib/tests/overlay/AbstractWindow.railHandoverAnimated.test.ts`](packages/lib/tests/overlay/AbstractWindow.railHandoverAnimated.test.ts) — `collapsingWindow`, `runAnimationToCompletion`, `styleWritesFor`, and R6/R7/R9/R11/R12.
- [`plans/implemented/rail-minimized-dock-slot.md`](plans/implemented/rail-minimized-dock-slot.md) — where the deferred `"minimize"`, the debt, and R9 were introduced. Read its Implementation Notes' fifth and seventh rounds before touching the flag.
- [`plans/implemented/rail-handover-follow-ups.md`](plans/implemented/rail-handover-follow-ups.md) — its `### Surfaced, not changed: the unpaired "restore" a voided debt leaves` states the defect, and its `[^exit-no-emit]` is why `onExitAction` stays out.
- [`plans/animation-finish-transition-clear.md`](plans/animation-finish-transition-clear.md) — the sibling branch this one follows. It edits `onExitAction` and adds **R15, R16, R17 and R18** to the same test file, which is why this plan's rows start at R19.

---

## Non-Goals

- **`onExitAction` still pays nothing.** A close mid-collapse announces `['close']`, unchanged — see the decision of the same name above.
- **The `"minimize"` is not moved off the shrink's completion.** Route A's event still lands 150 ms after the gesture. Emitting it up front would change every rail consumer's timing, and the debt mechanism exists precisely so the handle appears when the window has finished shrinking into it.
- **`_railCollapseActive` keeps its current meaning.** `animateRailExpand` still clears it, so `endRailCollapse` is still a no-op on the expand arm. Widening the flag to cover either genie is named as out of scope by `plans/animation-finish-transition-clear.md`'s own `## Non-Goals`, and this plan does not reopen it.
- **`Rail.removeWindowHandle` is not made to dispose its handle.** A change to `Rail`'s own lifecycle, not to an event contract.
- **No new demo or QA affordance.** The manual pass uses `MiscPanel`'s existing rail demo; adding a rail to a QA panel is a demo change with its own argument to make, exactly as `rail-minimized-dock-slot` concluded.

---

## Notes

[^reverses-r9]: R9 shipped with [`plans/implemented/rail-minimized-dock-slot.md`](plans/implemented/rail-minimized-dock-slot.md), which names it at `:598` — as does the test file's own header comment. It states the opposite rule — that a restore voids the debt — with its reasoning in the case's own comment: "the window is not minimized any more, so there is nothing left to announce". Reversing a recorded decision needs a reason the original did not have, and there is one. The original argument treats the debt as stale, citing `Card`'s parked scroll restore as precedent (`layout/Card.ts:290`). That precedent does not fit: `Card` voids a parked restore in `componentRemoved`, when the component the restore was *for* has left the container, so the debt has no payee left. The rail's debt has a live payee — the listener — and describes an event that really happened: the window's state reads `"minimized"` for the whole 150 ms shrink, so a consumer polling state sees a transition into and out of `"minimized"` that no event ever announced. That asymmetry is what the user decided on, recorded in `plans/research/render-review-2026-09-15/00-post-campaign-agenda.md`'s `## Decisions taken 2026-09-29`. Three alternatives were put and rejected when the decision was taken, and the agenda row does not list them: keeping the void and documenting the asymmetry, voiding both events, and parking the question behind a wider look at state/event disagreement. Do not reopen them. Note that the same agenda's earlier `## The rail follow-ups` section attributed R9 to `split-noop-drag-frame-gate`, which mentions it nowhere; that was the branch R9 was observed on rather than the plan that wrote it, and the agenda was corrected on `5b1a6543`. R9 is rewritten rather than deleted because its sequence — restore mid-collapse, detach, minimize, re-attach — is the only row in the file that proves the debt is settled exactly once rather than carried into the next minimize, and that property survives the inversion.

[^one-helper]: Two call sites and one three-line body, so the alternative is copying the guard-clear-emit triple. `restoreNormalMinSize` ([`AbstractWindow.ts:1338`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1338)) is the same shape already in this class: a private method guarded on its own flag field, a no-op when nothing is owed, called from two sites — the `animateRect` completions in `setWindowState`'s `"normal"` and `"maximized"` branches (`:1251` and `:1309`). Its own JSDoc names `setRail`'s detach as a path that *relaxes* the floor it reinstates, not as a caller. `endRailCollapse` and `endBodyFade` are two more instances of the shape. Unifying also keeps each site pinned separately rather than collapsing the coverage: deleting `setRail`'s call turns R6 and R7 red, deleting `setWindowState`'s turns R9, R11, R19, R21 and R22 red, and deleting the guard inside the helper turns W27 and W28 red. What unification does *not* buy is a shared ordering: the two sites call it at different points for different reasons, which is why the position is spelled out at each.

[^announce-the-state]: `setWindowState` flips `_options.windowState` on `:1220` and then runs the state branches, so everything after that line reads the new state. The dock path's `"minimize"` is emitted from inside the `state === "minimized"` branch and `"restore"` from the tail of the method, so each announces the state the window is now in; `setRail`'s payment sits inside `if (this.isMinimized())` and does the same. Emitting the owed `"minimize"` after the flip would break that rule for one route only, and a listener doing `if (win.isMinimized())` — the natural shape — would silently skip its own work. Re-entrancy cuts both ways and does not decide this. Before the flip, a listener calling `win.minimize()` hits `setWindowState`'s `from === state` early return and nothing happens; after the flip, the same call starts a whole second collapse, arms a new debt, and then the outer call emits `"restore"` over the top of it. The reverse holds for a listener calling `win.restore()`: before the flip it does not early-return and the consumer sees a doubled `"restore"`, where after the flip it would. Both hazards need a listener that changes the window's state from inside that window's own state event, neither is reachable in-tree, and the doubled `"restore"` is recorded in `## Potential Challenges`. The announce-the-state rule is what decides the position; re-entrancy is a tie. Checked against the code as it stands: `animateRailExpand` and `setDisplayed` both read no window state, so moving the rail re-show block above the flip changes nothing else.

[^genie-before-payment]: `Rail.handleMainAxisOffset` and `handleMainAxisExtent` ([`Rail.ts:1172`](packages/lib/src/typescript/lib/overlay/Rail.ts#L1172), [`:1216`](packages/lib/src/typescript/lib/overlay/Rail.ts#L1216)) each answer from `this._windows.get(window)?.handle` when a handle exists, and from the predicted append slot when it does not. Mid-collapse there is no handle, because the handle is raised by the `"minimize"` the collapse's completion emits — so the collapse aimed at the predicted slot, and the reverse genie must aim at the same place. The owed `"minimize"` raises a handle, and `Rail.showWindowHandle` only calls `scheduleLayout()`, so that handle has no laid-out geometry when `railGenieTransform` reads it. Measured offline on the test file's own `collapsingWindow` fixture: the collapse's target is `translate(-50px, -50px) scale(0.005)`, and re-reading it with the handle raised gives `translate(-50px, NaNpx) scale(0.085)` — `NaN` from the unlaid-out handle's main-axis position, and a different scale because adding a handle re-derived the rail's content-fit thickness. Removing the handle again returns the value exactly. A `NaN` in a CSS transform makes the whole declaration invalid, so `Animation.play` writes a `from` the browser drops and the window expands from its resting position instead of from the rail. On a rail that already holds handles the same `NaN` appears, so one row on the empty-rail fixture is a real pin rather than one arm of a pair; the in-engine check uses the two-drawer demo rail because the offset there is non-zero and the difference is visible.

[^close-unchanged]: The user's decision names two paths — `setRail`, which pays, and `animateRailExpand`, which voids — and makes both pay. `onExitAction` is a third and was not part of it. `rail-handover-follow-ups`' `[^exit-no-emit]` argues it separately and the argument still holds: `onExitAction` has already emitted `"close"` as its first statement, the rail has already dropped the window through its own `onClose` listener, and a `"minimize"` after a `"close"` is the defect R12 was written to close. Paying before the `"close"` instead would give `['minimize', 'close']`, which is arguably consistent — and is exactly the sort of public event-contract change that needs deciding rather than inferring, so it is left alone. R12 turns red if a later reader adds the call, which is what keeps this a decision rather than an oversight.

[^transient-handle]: `Component.removeComponent` never disposes what it removes: its own source says so at [`Component.ts:1228`](packages/lib/src/typescript/lib/core/Component.ts#L1228) — "`removeComponent` never calls destructor (a removed child may be re-parented by a move)" — and `removeAllComponents`' `@remarks` restates it for both ([`:7708-7710`](packages/lib/src/typescript/lib/core/Component.ts#L7708)). `Rail.removeWindowHandle` calls it without a `dispose()`. So every minimize-then-restore cycle through a rail already leaves a detached `RailHandle` behind, and an interrupted restore now adds one more per occurrence. The cost is one component and its per-instance stylesheet rules, on a gesture a user performs a handful of times; the fix belongs to `Rail`'s own lifecycle and would want its own row. Worth recording rather than bundling: this plan's whole diff is about which events fire, and quietly changing `Rail`'s disposal in the same branch would make the event change harder to review.

[^reentrancy]: Traced: a `"minimize"` listener calling `win.setRail(null)` runs while the state still reads `"minimized"`, so `setRail`'s `isMinimized()` branch is taken. It cancels `_railExpandAnimation` — the expansion `animateRailExpand` armed one line earlier — and then calls `endRailCollapse()`, which no-ops because `animateRailExpand` has already cleared `_railCollapseActive`. `Animation.cancel` writes no styles, so the window is left carrying the genie's transform and opacity. It is still displayed, its state finishes as `"normal"`, and the next write to its transform clears the leftover, so nothing is unrecoverable. The underlying gap — that an interrupted rail *expand* leaves the element mid-genie with nothing to undo it — is already recorded as open in `plans/animation-finish-transition-clear.md`'s `## Non-Goals`, which states that closing it means widening `_railCollapseActive` to mean "either rail genie owns these styles" and thereby reverses a different recorded decision. Reaching it requires a consumer to change a window's rail ownership from inside that window's own minimize event, which no in-tree consumer does.

[^no-row-vacuous]: Checked row by row, because a fix that satisfies an existing assertion by a second route leaves the line that assertion was written for deletable. **R9 and R11** pinned the void and are rewritten, so neither survives as a row whose expectation the new code happens to meet. **R6** asserts `['minimize']` immediately after `setRail(null)` and then `['minimize', 'restore']` after a restore; the first assertion still fails if `setRail`'s call goes, and the tail cannot be rescued by `setWindowState`'s payment because that block is gated on `this._rail !== null` and the rail is gone by then. **R7** is the same for the re-attach direction. **R10** asserts the window is displayed and `"normal"` after the drain and never looked at events. **R12** now pins the close path's deliberate non-payment as well as what it pinned before. **W27** and **W28** in `AbstractWindow.minimizedViewportResize.test.ts` count `"minimize"` emissions under that file's reduced-motion mock, where no debt is ever outstanding, and both still fail if the helper's guard goes. **R13**, **R14** and `animation-finish-transition-clear`'s **R15** are about `transition` writes and listener releases and touch no event. All four of that plan's rows were checked. Its **R16** does drive a restore, but it lets the collapse land first — so the completion has already emitted and cleared the debt, `payRailMinimizeDebt()` is a no-op there, no handle is raised or removed, and the row's `transition` values are untouched. Its **R17** and **R18** close a plain `Window` with no rail attached, so `_rail` is `null`, no collapse ever deferred anything, and the payment is unreachable on both. `Rail.test.ts`'s rail-window cases reach the rail through `minimize()` before `setRail`, which takes the dock path and defers nothing.

---

## Implementation Notes

Implemented as written — the helper, its two call sites, the deleted void and
the swapped `setWindowState` block all landed exactly as `## Internal
Structure` quotes them, and step 1's row count was `18` as predicted. The
notes below record what the plan could not have known and two small
departures.

**Stale figures in `## Verification`, both from `master` rather than from this
branch's start point.** Step 6's "no more than the 14 pre-existing warnings"
is dead: `docs-api-warning-clearance` cleared all fourteen and
`CODE_CONVENTIONS.md` now records a standing zero-warning bar. `npm run
docs:api` measured **0 warnings, 0 errors** both before and after this
branch. Step 3's "521 files, 8763 passed, 2 todo" is likewise master's; the
branch point `22925f01` measured **521 files, 8773 passed, 2 todo (8775)**,
and this branch ends at **521 files, 8777 passed, 2 todo (8779)** — the four
new rows the plan predicts, with the file count unchanged. `npm run lint`,
`npm run typecheck`, `npm -w packages/lib run typecheck:test` and `npm run
build:lib` are clean, `docs:llms:check` reports `108 catalogued, 0
unaccounted for`, and `packages/qa`'s suite is unchanged at 453 passed. Step
12's second grep reads `5` as prescribed; its first reads **`4`** rather than
`3`, for the reason the flag-comment departure below gives. The test file ends
at 22 contiguous rows, R1-R22.

**`plans/in-progress/` did not exist in this tree** and was created by the
in-progress move; every prior plan here went straight to `plans/implemented/`.

**R20 sits between R19 and R21, not after R22.** Step 10 fixes when R20 is
added but not where, and the plan's own numbering reads in order this way.

**The debt flag's own comment was repointed, which is why step 12's first
grep reads `4` and not `3`.** `_railMinimizeEmitPending`'s declaration comment
read ``See `setRail`.`` — true while `setRail` held the guard/clear/emit
triple, stale the moment this branch moved that triple into the helper and
added a second settle point. Its two sibling flags each name the helper that
settles them (`_bodyFadeActive` → ``endBodyFade``, `_railCollapseActive` →
``endRailCollapse``), so it now reads ``See `payRailMinimizeDebt`.`` The plan's
`## Internal Structure` does not quote this line, and step 12's enumeration —
"the declaration, `setRail`'s call, `setWindowState`'s call" — did not
anticipate a fourth mention. The second grep is unaffected, because it counts
the field's declaration line rather than its comment. Raised by the audit, not
planned.

**`setRail`'s `@remarks` was rewrapped one line beyond the replaced clause.**
The paragraph carried a pre-existing one-word wrap artifact — `whichever
route it takes. A` / `detached window is cleared of…` — inside the text the
prescribed clause replacement rewraps. No wording changed beyond the clause
`## Documentation Impact` prescribes.

**The whole mutation table was applied, not only step 11's two.** Each
mutation was applied, run against the row's own file, and reverted; the
source was byte-compared against its pre-mutation state at the end. One row
of coverage only shows up suite-wide and was added to the table after the
audit measured it: dropping the helper's guard turns R9 red as well as W27 and
W28, because R9's closing `setRail(rail)` then pays a debt that is not owed. Every
one of the fourteen rows of `### What each assertion catches` goes red under
the mutation named for it, so none of them is vacuous:

| Mutation | Rows red |
|---|---|
| payment moved ahead of `animateRailExpand()` (step 11) | R20 **only** |
| payment moved below the state flip (step 11) | R19 **only** |
| the helper's `emit("minimize")` dropped | R6, R7, R9, R11, R19, R21, R22 |
| the helper's `_railMinimizeEmitPending = false` dropped | R9 **only** |
| `setWindowState`'s `payRailMinimizeDebt()` dropped | R9, R11, R19, R21, R22 |
| `animateRailExpand`'s collapse cancel dropped | R10, R11 |
| `animateRailExpand`'s `from` dropped | R20 **only** |
| a `state === "normal"` guard added around the payment | R22 **only** |
| `setRail`'s `payRailMinimizeDebt()` dropped | R6, R7 |
| a `payRailMinimizeDebt()` call added to `onExitAction` | R12 **only** |
| the helper's early-return guard dropped | R9, W27, W28 |

Two results are worth keeping. The four-row set the plan predicts for the
dropped `setWindowState` call is exactly what appeared, and R20 was *not* in
it — with no payment no handle is raised, so the genie's target is the one
the collapse aimed at and R20 still passes, which is why R20 needs its
position mutation rather than its deletion. And dropping the helper's
flag-clear turns **only** R9 red, confirming that R9's four-step sequence is
the file's only row proving the debt is settled once rather than carried into
the next minimize — the property `[^reverses-r9]` gives as the reason for
rewriting R9 instead of deleting it.

**`## Expected Behaviour`'s in-engine manual list is unrun, and remains the
user's to run.** It opens a window on the desktop, which this run was not
permitted to do. Both checks — the window growing back out of the rail
handle's corner rather than fading in at full size, and no handle left on or
flashing across the rail afterwards — have offline proxies that pass (R20 for
the start transform, R21 for the transient handle), but neither observes a
paint.
