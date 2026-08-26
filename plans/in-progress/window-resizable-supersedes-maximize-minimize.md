---
depends-on: [window-resizable-option]
touches-shared:
  - packages/lib/src/typescript/lib/overlay/AbstractWindow.ts
---

# `resizable` supersedes `maximizable` / `minimizable` — Implementation Plan

## Overview

The `resizable` option added by [`plans/implemented/window-resizable-option.md`](plans/implemented/window-resizable-option.md) turns off drag-resizing only; a non-resizable window still shows its minimize and maximize buttons and still responds to them. This plan makes `resizable` the master switch: when a window is not resizable it can neither be minimized nor maximized by the user, whatever the caller passed for `minimizable` / `maximizable`.

That override — `resizable` vetoing the other two flags — is applied at the *read* boundary. [`isMinimizable()`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1359) and [`isMaximizable()`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1383) start reporting the **effective** value — the caller's flag AND `isResizable()` — while `_options.minimizable` / `_options.maximizable` keep holding the caller's own flag untouched, so `setResizable(true)` restores exactly what the caller asked for. Every existing consumer of those two getters (`toggleMinimize`, `toggleMaximize`, `Window.onHeaderDoubleClick`, `TabWindow.onBarDoubleClick`) inherits the gate with no edit of its own.

All source changes land in [`AbstractWindow.ts`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts); `Window.ts`, `TabWindow.ts`, and `WindowHeader.ts` are read-only references here. The tests extend the existing [`AbstractWindow.resizable.test.ts`](packages/lib/tests/overlay/AbstractWindow.resizable.test.ts).

**Branch placement — this plan does not get a fresh branch off `master`.** Its changes are follow-up commits on the existing `feature/window-resizable-option` branch, placed *before* that branch's final "Move window-resizable-option plan to implemented" bookkeeping commit. `master` does not carry the `resizable` option at all, so a worktree branched off `master` cannot even compile this work. `/implement` must therefore be run in a worktree checked out from `feature/window-resizable-option`.[^branch-mechanics]

---

## Architecture Decisions

### The override lives in the getter, not in each action

`isMinimizable()` returns `this.isResizable() && (this._options.minimizable ?? this._defaultOptions.minimizable!)`, and `isMaximizable()` mirrors it. Both getters therefore answer "can this window be minimized / maximized right now", not "what was configured".[^getter-gate]

`_options.minimizable` and `_options.maximizable` are never written with a gated value. They stay the record of the caller's intent, which is what makes the override reversible:

| `resizable` | caller's `minimizable` | stored `_options.minimizable` | `isMinimizable()` | minimize button |
|---|---|---|---|---|
| `true` (default) | not passed | `undefined` | `true` | shown |
| `true` | `false` | `false` | `false` | hidden |
| `false` | `true` | `true` | `false` | hidden |
| `false` | not passed | `undefined` | `false` | hidden |
| `false`, then `setResizable(true)` | `true` | `true` | `true` | shown again |
| `false`, then `setResizable(true)` | `false` | `false` | `false` | still hidden |

### Affordance refreshes go through the `reflect*` hooks, never through the setters

Three call sites push the effective value into the subclass chrome: `setMinimizable`, `setMaximizable`, and `setResizable`. Each calls [`reflectMinimizable`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L457) / [`reflectMaximizable`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L466) directly with `this.isMinimizable()` / `this.isMaximizable()`. `initChrome`'s two dispatch lines change from `this.setMinimizable(this.isMinimizable())` to `this.reflectMinimizable(this.isMinimizable())` for the same reason.

Routing a refresh through `setMinimizable` / `setMaximizable` instead would corrupt the caller's option: those setters write their argument straight into `_options`, so feeding them a gated value overwrites the caller's `true` with `false` permanently, and `setResizable(true)` could never bring the button back.[^writeback-trap]

### Turning `resizable` off hides the buttons — it does not disable them

The override reuses the existing reflect path unchanged, so a non-resizable window's chrome looks exactly like a window built with `minimizable: false, maximizable: false`: [`WindowHeader.setMinimizable`](packages/lib/src/typescript/lib/component/container/WindowHeader.ts#L374) and [`setMaximizable`](packages/lib/src/typescript/lib/component/container/WindowHeader.ts#L397) hide their buttons, and [`TabWindow.reflectMinimizable`](packages/lib/src/typescript/lib/overlay/TabWindow.ts#L195) hides its tool. No `WindowHeader` behaviour changes.[^hide-not-disable]

### The user-facing actions are gated; the programmatic ones are not

`toggleMinimize`, `toggleMaximize`, and the two double-click handlers already consult the getters, so they are gated by the change above with no edit. The programmatic sugar — `minimize()`, `restore()`, `setWindowState(...)` — stays open, matching how the `resizable` option itself left `setWidth` / `setHeight` alone while gating the drag entry point.[^programmatic]

### The restore-from-minimized double-click branch stays ungated

[`Window.onHeaderDoubleClick`](packages/lib/src/typescript/lib/overlay/Window.ts#L299) and [`TabWindow.onBarDoubleClick`](packages/lib/src/typescript/lib/overlay/TabWindow.ts#L167) both restore a minimized window by calling `setWindowState(this._preMinimizeState)` before any `isMaximizable()` check. Neither branch is touched. A window can reach the minimized state while non-resizable (constructed with `windowState: "minimized"`, deserialized, or minimized programmatically), and with its minimize button hidden the double-click is the user's only way back out.[^restore-branch]

---

## Public API

No new symbols. Two existing getters change meaning:

```typescript
abstract class AbstractWindow extends Container<WindowOptions> {
    // Now returns the *effective* value: false whenever isResizable() is false,
    // regardless of the `minimizable` / `maximizable` the caller supplied.
    isMinimizable(): boolean;
    isMaximizable(): boolean;

    // Unchanged signatures; both now reflect the effective value into the
    // subclass chrome, while still storing the caller's raw value.
    setMinimizable(value: boolean): this;
    setMaximizable(value: boolean): this;

    // Unchanged signature; now also refreshes both affordances.
    setResizable(value: boolean): this;
}
```

Backing store is unchanged: `_options.minimizable` / `_options.maximizable` / `_options.resizable`, class defaults `true` in `_defaultWindowOptions`, no private fields.

---

## Internal Structure

The two getters ([AbstractWindow.ts:1359](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1359), [:1383](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1383)) and the two setters that feed them:

```typescript
setMinimizable(value: boolean): this {
    this._options.minimizable = value;

    // Reflect the effective value, not `value`: `resizable` can veto it. The
    // raw write above keeps the caller's intent recoverable.
    this.reflectMinimizable(this.isMinimizable());

    return this;
}

isMinimizable(): boolean {
    return this.isResizable() && (this._options.minimizable ?? this._defaultOptions.minimizable!);
}

setMaximizable(value: boolean): this {
    this._options.maximizable = value;
    this.reflectMaximizable(this.isMaximizable());

    return this;
}

isMaximizable(): boolean {
    return this.isResizable() && (this._options.maximizable ?? this._defaultOptions.maximizable!);
}
```

The refresh appended to `setResizable` ([AbstractWindow.ts:1397](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1397)), after the existing `clearSnapState()` block and before `return this`:

```typescript
    // `resizable` supersedes minimizable/maximizable, so both affordances
    // re-reflect against their effective value. Straight to the reflect hooks:
    // setMinimizable/setMaximizable would write the gated value into
    // `_options` and destroy the caller's own setting.
    this.reflectMinimizable(this.isMinimizable());
    this.reflectMaximizable(this.isMaximizable());
```

The two replaced lines in `initChrome` ([AbstractWindow.ts:367-368](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L367)):

```typescript
    this.setCloseable(this.isCloseable());
    this.reflectMinimizable(this.isMinimizable());
    this.reflectMaximizable(this.isMaximizable());
    this.setResizable(this.isResizable());
```

---

## Ordered Implementation Steps

1. **`packages/lib/tests/overlay/AbstractWindow.resizable.test.ts`** — append a second `describe` block, `'resizable supersedes minimizable/maximizable'`, holding rows 1-11 of _Expected Behaviour_. Reuse the file's existing `CONFIG`, `installTestDOM`, and `afterEach(() => DOM.reset())`; no new imports beyond a white-box accessor for `TabWindow`'s tools:

   ```typescript
   /** White-box access to TabWindow's trailing control tools. */
   function tools(win: TabWindow): { _minTool: { isVisible(): boolean | null }, _maxTool: { isVisible(): boolean | null } } {
       return win as unknown as { _minTool: { isVisible(): boolean | null }, _maxTool: { isVisible(): boolean | null } };
   }
   ```

   `Window`'s buttons are readable through the public surface instead — `win.getHeader().isMinimizable()` / `.isMaximizable()`. The rows fail until step 2 lands; that is the red state.

2. **`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts`** — replace the bodies of `isMinimizable` ([line 1359](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1359)) and `isMaximizable` ([line 1383](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1383)) per _Internal Structure_, and change the `reflectMinimizable(value)` / `reflectMaximizable(value)` calls inside `setMinimizable` ([line 1349](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1349)) and `setMaximizable` ([line 1373](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1373)) to pass `this.isMinimizable()` / `this.isMaximizable()`.
   *Check:* `npm run typecheck` is clean.

3. **`AbstractWindow.ts`** — in `initChrome` ([line 367](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L367)), replace `this.setMinimizable(this.isMinimizable());` with `this.reflectMinimizable(this.isMinimizable());` and `this.setMaximizable(this.isMaximizable());` with `this.reflectMaximizable(this.isMaximizable());`. Leave the surrounding `setCloseable` / `setResizable` / `setMaximizeBounds` / `setWindowState` lines alone. Extend the block's existing comment with one sentence: the two flags reflect rather than re-set, so the caller's own values survive in `_options`.
   *Check:* `grep -n "this.setMinimizable\|this.setMaximizable" packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` — expect **zero** matches.

4. **`AbstractWindow.ts`** — append the two-line refresh from _Internal Structure_ to `setResizable` ([line 1397](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1397)), after the `if (!value) { this.clearSnapState(); }` block.

5. **`AbstractWindow.ts`** — update the JSDoc on the four touched methods:
   - `setMinimizable` / `isMinimizable` / `setMaximizable` / `isMaximizable`: say the affordance is also hidden, and the getter also reports `false`, whenever the window is not resizable — and that the value the caller sets is remembered and comes back when `resizable` is turned on again.
   - `setResizable` ([line 1388](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1388)): its current text says it "does not affect moving, minimizing, or maximizing" — replace with: disabling also hides the minimize and maximize affordances and blocks `toggleMinimize` / `toggleMaximize`; moving is unaffected.
   - The class JSDoc's "the closeable / minimizable / maximizable *state*" line ([line 177](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L177)) needs no change.
   *Check:* `npm run docs:api` finishes with zero warnings.

6. **Regression check:** `git diff --name-only` — expect exactly `packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` and `packages/lib/tests/overlay/AbstractWindow.resizable.test.ts`. In particular `Window.ts` and `TabWindow.ts` are not edited: their `isMaximizable()` guards ([Window.ts:304](packages/lib/src/typescript/lib/overlay/Window.ts#L304), [TabWindow.ts:173](packages/lib/src/typescript/lib/overlay/TabWindow.ts#L173)) pick up the override through the getter, and their restore-from-minimized branches must stay ungated.

7. Run the full `## Verification` list, then the manual smoke tests.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` |
| Modify | `packages/lib/tests/overlay/AbstractWindow.resizable.test.ts` |

---

## Expected Behaviour

Rows 1-11 are unit-testable offline under the recording sink; rows 12-15 need a real browser.

| # | Case | Expected | How |
|---|---|---|---|
| 1 | `new Window('W')` | `isMinimizable()` and `isMaximizable()` both `true` | unit |
| 2 | `new Window('W', { resizable: false })` | both `false` | unit |
| 3 | `new Window('W', { resizable: false }).getHeader()` | `isMinimizable()` and `isMaximizable()` both `false` — the buttons are hidden | unit |
| 4 | `new TabWindow({ resizable: false })` | both getters `false`; `_minTool.isVisible()` and `_maxTool.isVisible()` both `false` | unit |
| 5 | `new Window('W', { resizable: false })`, then `setResizable(true)` | both getters `true`; header reports both buttons shown | unit |
| 6 | `new Window('W', { resizable: false, minimizable: false })`, then `setResizable(true)` | `isMinimizable()` `false` (caller's own setting survived), `isMaximizable()` `true` | unit |
| 7 | `new Window('W')`, then `setResizable(false)`, then `setResizable(true)` | both getters `true`; header reports both buttons shown | unit |
| 8 | `new Window('W', { resizable: false })`, then `toggleMinimize()` | `getWindowState()` stays `"normal"` | unit |
| 9 | `new Window('W', { resizable: false })`, then `toggleMaximize()` | `getWindowState()` stays `"normal"` | unit |
| 10 | `new Window('W', { resizable: false })`, then `minimize()` | `getWindowState()` is `"minimized"` — the programmatic path is not gated | unit |
| 11 | `new Window('W', { resizable: false })`, then `setMinimizable(true)` | `isMinimizable()` still `false` and the header button still hidden; a following `setResizable(true)` makes both `true` / shown | unit |
| 12 | Open a `{ resizable: false }` `Window` | no minimize or maximize button in the header; the close button is still there and still evenly spaced | manual |
| 13 | Double-click the header of a `{ resizable: false }` `Window` | nothing happens — no maximize | manual |
| 14 | `{ resizable: false, windowState: "minimized" }` `Window`, double-click its docked header | restores to normal — the escape hatch is intact | manual |
| 15 | Same for a `{ resizable: false }` `TabWindow`: no minimize/maximize tools in the strip; double-clicking the strip's empty area does not maximize | as described | manual |

Unchanged behaviour to confirm during the manual pass: a resizable window (the default) still shows and honours both buttons; a non-resizable window still moves by its header/bar, still closes, and still shows the same border, shadow, and gutter width.

---

## Verification

- `npm run typecheck` — clean.
- `npm run test` — full suite, including the extended `AbstractWindow.resizable.test.ts`.
- `npm run lint` — clean.
- `npm run docs:api` — zero warnings.
- Manual smoke test: `npm run dev` (app on `localhost:8015`), open the demo shell's **Misc** panel and its "Hello World!" window ([`MiscPanel.ts:224`](packages/lib/src/typescript/MiscPanel.ts#L224)). Pass `{ resizable: false }` at that call site to walk rows 12-14, and add `windowState: "minimized"` for row 14; revert both afterwards — these are scratch edits for the manual pass and must not be committed.

---

## Documentation Impact

This change alters consumer-visible behaviour, so **run the `document` skill after the code lands**. Do not hand-edit docs as part of this plan. What the skill needs to cover:

- No new exports. The changed contract is on `AbstractWindow.isMinimizable` / `isMaximizable` (now effective values) and `AbstractWindow.setResizable` (now also hides the two affordances).
- [`packages/lib/docs/components/AbstractWindow.md`](packages/lib/docs/components/AbstractWindow.md) — its "Resize borders" row currently reads "*without affecting move, minimize, or maximize*", which this change makes wrong; its "Closeable / minimizable / maximizable" row should state the override.
- [`packages/lib/docs/components/Window.md`](packages/lib/docs/components/Window.md) and [`packages/lib/docs/components/TabWindow.md`](packages/lib/docs/components/TabWindow.md) — the `minimizable` / `maximizable` / `resizable` rows in each options table; `TabWindow.md`'s "Minimize / maximize / close" bullet too.
- A behaviour-change entry in [`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md) — `resizable: false` now suppresses minimize and maximize, which changes what an existing caller passing `resizable: false` gets.
- `packages/lib/llms.txt` is generated — `npm run docs:llms`.

---

## Potential Challenges

- **`initChrome` reflects the two flags twice at construction.** Its explicit `reflectMinimizable` / `reflectMaximizable` lines run, then `setResizable(this.isResizable())` on the next line reflects both again with the same values. Both writes are identical `setVisible` calls, so the second is a no-op in effect; the explicit lines stay because a reader must be able to see where each flag is dispatched.[^double-reflect]
- **A window already maximized when `setResizable(false)` runs stays maximized, with no user-facing way out** — its maximize button is hidden and the header double-click is gated. The caller who created that situation owns the exit (`setWindowState("normal")`, or `setResizable(true)`). See `## Non-Goals`.
- **`isMinimizable()` no longer round-trips `setMinimizable()`** on a non-resizable window: `win.setMinimizable(true); win.isMinimizable()` returns `false`. That asymmetry is the point of the feature, and row 11 of _Expected Behaviour_ pins it.

---

## Critical Files

| File | Why |
|---|---|
| [`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts) | The only source file changed. Read `initChrome` (:354), `applyOptions` (:394), the `reflect*` abstracts (:448-475), `toggleMinimize` (:1162), `toggleMaximize` (:1300), and the `setCloseable` … `isResizable` accessor block (:1323-1425). |
| [`plans/implemented/window-resizable-option.md`](plans/implemented/window-resizable-option.md) | The plan this one extends and partly reverses (its "No change to minimize, maximize, or the move drag" non-goal). Its `[^gates]` note explains the affordance-versus-programmatic split this plan follows. |
| [`packages/lib/src/typescript/lib/overlay/Window.ts`](packages/lib/src/typescript/lib/overlay/Window.ts) | Read-only reference: `reflectMinimizable` / `reflectMaximizable` (:184, :193) are pure UI pushes with no `_options` write, and `onHeaderDoubleClick` (:293) shows the ungated restore branch. Not edited. |
| [`packages/lib/src/typescript/lib/overlay/TabWindow.ts`](packages/lib/src/typescript/lib/overlay/TabWindow.ts) | Read-only reference: the same two hooks (:195, :204) and `onBarDoubleClick` (:166), structurally identical to `Window`'s. Not edited. |
| [`packages/lib/src/typescript/lib/component/container/WindowHeader.ts`](packages/lib/src/typescript/lib/component/container/WindowHeader.ts) | A *different* `setMinimizable` / `setMaximizable` pair (:374, :397) that toggles button visibility, plus `setCloseable` (:351) which disables instead. Read to avoid confusing the two pairs. Not edited. |
| [`packages/lib/tests/overlay/AbstractWindow.resizable.test.ts`](packages/lib/tests/overlay/AbstractWindow.resizable.test.ts) | The file the new rows are appended to, and the harness header they reuse. |

---

## Non-Goals

- **No gate on `minimize()`, `restore()`, or `setWindowState(...)`.** They are the programmatic surface, kept open for the same reason the `resizable` option left `setWidth` / `setHeight` open. [`LayoutSerialization.ts:589`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L589) restores a serialized window's state through `setWindowState` and must keep working for a non-resizable window.
- **No forced state change in `setResizable(false)`.** A window that is already minimized or maximized keeps that state. Auto-restoring would make a boolean setter move the window, and during construction it would collide with `initChrome`'s own `setWindowState` dispatch two lines later.
- **No `WindowHeader` change.** Its minimize/maximize buttons keep hiding rather than disabling; see the hide-not-disable decision.
- **No change to `closeable`.** A non-resizable window can still be closed.
- **No new option.** There is no separate "effective minimizable" accessor and no opt-out of the override — `resizable` is the master switch, unconditionally.

---

## Notes

[^branch-mechanics]: The `feature/window-resizable-option` branch's tip commit is `572e469c "Move window-resizable-option plan to implemented"`, a bookkeeping commit that moved the plan file into `plans/implemented/`. The code commits from this plan belong before it. Non-interactive route, run from a worktree checked out on that branch (`git worktree add .worktrees/<slug> feature/window-resizable-option`): `git reset --mixed HEAD~1` to un-commit the plan move (the working tree keeps the file where the commit put it, as an unstaged rename), then implement and commit the code and test changes, then stage `plans/` and re-commit both plan moves as the final bookkeeping commit. `git rebase -i` is unavailable in this environment.

[^getter-gate]: Gating at the getter is what makes the change small: `toggleMinimize` ([:1163](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1163)), `toggleMaximize` ([:1301](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1301)), `Window.onHeaderDoubleClick` ([Window.ts:304](packages/lib/src/typescript/lib/overlay/Window.ts#L304)) and `TabWindow.onBarDoubleClick` ([TabWindow.ts:173](packages/lib/src/typescript/lib/overlay/TabWindow.ts#L173)) are every consumer of the two getters, and all four already ask before acting. The alternative — leaving the getters reporting the raw option and adding a separate `isResizable()` check at each of those four sites plus each reflect site — was rejected: it is six edits across three files instead of two edits in one, and a fifth action site added later would silently miss the gate. The cost of the getter route is that `isMinimizable()` stops being a pure read-back of `setMinimizable()`; that is stated in the JSDoc and pinned by row 11 of _Expected Behaviour_.

[^writeback-trap]: Verified against the code on this branch. `setMinimizable` is `this._options.minimizable = value; this.reflectMinimizable(value);` ([:1347-1352](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1347)) — a raw write, not a merge. `initChrome` calls `this.setMinimizable(this.isMinimizable())` ([:367](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L367)). With the getter gated and that line left alone, a window constructed `{ resizable: false, minimizable: true }` would compute `isMinimizable() === false` and write that `false` over the caller's `true` at construction time; `setResizable(true)` later would then read `_options.minimizable === false` and the button would never return. The same corruption recurs if `setResizable` refreshes the chrome by calling `this.setMinimizable(this.isMinimizable())`. Both are avoided by calling the `reflect*` hooks directly — `Window.reflectMinimizable` is a one-line `this._header.setMinimizable(value)` ([Window.ts:184](packages/lib/src/typescript/lib/overlay/Window.ts#L184)) and `TabWindow.reflectMinimizable` a one-line `this._minTool.setVisible(value)` ([TabWindow.ts:195](packages/lib/src/typescript/lib/overlay/TabWindow.ts#L195)); neither touches `_options`.

[^hide-not-disable]: `WindowHeader.setCloseable` disables its button rather than hiding it, so the button row stays evenly spaced ([WindowHeader.ts:342-356](packages/lib/src/typescript/lib/component/container/WindowHeader.ts#L342)) — a closer structural precedent than the resize plan's strip-hiding, and a reason to consider switching the minimize/maximize buttons to the same treatment. It was rejected because it would change what `minimizable: false` does today for every existing caller of that option, which is outside this plan's request, and because a *disabled* minimize button on a non-resizable window advertises an affordance the window does not have. Reusing the existing hide path also means a non-resizable window and an explicitly non-minimizable one are visually identical, so there is one appearance to reason about instead of two.

[^programmatic]: The precedent is [`plans/implemented/window-resizable-option.md`](plans/implemented/window-resizable-option.md): it gated `onResize` (the drag entry point) and `onSnapKeyDown` (the snap arm), and its Non-Goals kept `setWidth` / `setHeight` / `setWindowState("maximized")` untouched — block the user-facing affordance, leave the programmatic escape hatch alone. The same split applies here, and one concrete call site depends on it: `LayoutSerialization` restores a deserialized window's state via `setWindowState` ([:589](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L589)), which would break for any serialized non-resizable window that was minimized or maximized if the programmatic path were gated. `Rail`'s handle click routes through `restore()` ([Rail.ts:992](packages/lib/src/typescript/lib/overlay/Rail.ts#L992)); that one is user-driven, but it is an *exit* from minimized, covered by the restore-branch decision.

[^restore-branch]: The asymmetry is deliberate: entering minimized or maximized is gated, leaving minimized is not. Both double-click handlers check `getWindowState() === "minimized"` first and return before reaching the `isMaximizable()` guard, so no edit is needed to preserve the exit — the branch already sits above the gate in both files. Gating it would strand a window that was minimized programmatically or restored from serialization while non-resizable, because its minimize button (whose glyph swaps to `window-restore` while minimized, [Window.ts:209](packages/lib/src/typescript/lib/overlay/Window.ts#L209)) is exactly what the override hides.

[^double-reflect]: Two shapes that remove the duplicate were rejected. Dropping `initChrome`'s two reflect lines and letting `setResizable` be the sole construction-time dispatch makes the minimize/maximize chrome depend implicitly on the `resizable` dispatch existing on the line below, which a later edit could remove without any signal. Moving the refresh out of `setResizable` into a shared private helper called from `initChrome` only would leave runtime `setResizable` toggles without a refresh, which is the case the feature exists for.
