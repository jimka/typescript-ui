---
touches-shared: [packages/lib/docs/reference/changelog/next.md, packages/lib/docs/reference/migration/next.md, packages/lib/docs/concepts/accessibility.md]
---

# Spatial Navigation Region Chord Default — Implementation Plan

## Overview

`SpatialNavigation`'s region tier (the library calls it the `"target"` tier) currently defaults to `Ctrl+Shift`+arrow ([`SpatialNavigation.ts:209`](packages/lib/src/typescript/lib/core/SpatialNavigation.ts#L209)). The service claims its chords at the window, in the capture phase, with no check for text entry. It calls `preventDefault` and stops propagation on every claimed chord. On Windows and Linux that takes `Ctrl+Shift+←/→` word selection away from every `<input>`, `<textarea>`, `MarkdownEditor` (contenteditable) and `CodeEditor` (CodeMirror's `selectGroupLeft/Right`). On macOS it takes CodeMirror's `Ctrl-Shift-arrow` `selectSyntax`/`selectPage`.

This plan changes the region tier's default to `Ctrl+Alt+Shift`+arrow. The control tier (the `"component"` tier) keeps `Ctrl+Alt`+arrow. The remaining collisions are documented in `docs/concepts/accessibility.md` and on the `CodeEditor` page. Every comment, JSDoc block, doc page and test that names the old chord is updated. The change is breaking, so it gets a `Breaking changes` entry in the staged changelog and a migration note with a one-line restore.

The change ships in the next minor release (0.11.0). This plan does not bump versions or release: the user releases by hand, after SQLAdmin has verified the change against a linked build of this branch (SQLAdmin's `plans/spatial-navigation-adoption.md` depends on this plan).

---

## Architecture Decisions

### The region tier's default becomes `Ctrl+Alt+Shift`

`DEFAULT_TARGET_MODIFIERS` changes from `{ ctrl: true, shift: true }` to `{ ctrl: true, alt: true, shift: true }`, written with the keys in exactly that order.[^key-order] `Ctrl+Alt+Shift`+arrow has no binding in CodeMirror's default keymap, in native text editing, or in any browser.[^collisions]

The change is made the way the library has changed a default before: edit the default in place, and add a changelog entry that says how to restore the old behaviour. The precedent is the `Canvas` frame-rate default in [`changelog/0.4.0.md:132-138`](packages/lib/docs/reference/changelog/0.4.0.md#L132) ("Restore the old behaviour with `maxFps: 0`"). The migration note follows the "What changed and why" / "Who needs to act" shape of [`migration/0.10.0.md:109-138`](packages/lib/docs/reference/migration/0.10.0.md#L109).

### The control tier stays on `Ctrl+Alt`, and the remaining collisions are documented

`DEFAULT_COMPONENT_MODIFIERS` does not change. Three known collisions remain across the two tiers. Each is written into the docs rather than fixed:

| Chord | Taken from | Where |
|---|---|---|
| `Ctrl+Alt+↑/↓` | CodeMirror `addCursorAbove/Below` | `CodeEditor`, Windows and Linux only |
| `Ctrl+Alt`+arrow | switch workspace | GNOME desktop |
| `Ctrl+Alt+Shift`+arrow | move window to another workspace | older GNOME releases |

`configure()` is the escape for each one.[^control-tier]

### The service keeps claiming its chords inside text-entry elements

No text-entry check is added. The chords stay live while focus is in an input, a textarea, a contenteditable or a `CodeEditor`.[^no-standdown]

### Only `SpatialNavigation.test.ts` asserts the default chord

The tests in `tests/component/tree/Tree.test.ts`, `tests/component/table/Body.test.ts` and `tests/core/FocusTraversal.test.ts` do not change.[^other-tests]

### No code change in the demo

The demo's [`main.ts:46`](packages/lib/src/typescript/main.ts#L46) calls `SpatialNavigation.enable()` with no options, so it picks up the new default. It is the manual-verify entry point, not an edit.

---

## Public API

Signatures do not change. Only the documented default of one option field changes:

```typescript
export interface SpatialNavigationOptions {
    /** Fine tier. Default `{ ctrl: true, alt: true }`. Replaces the whole set, not merged. */
    componentModifiers?: SpatialNavigationModifiers;
    /** Coarse tier. Default `{ ctrl: true, alt: true, shift: true }`. Replaces the whole set, not merged. */
    targetModifiers?:    SpatialNavigationModifiers;
}
```

Restoring the old chord (the one line the migration note gives):

```typescript
SpatialNavigation.configure({ targetModifiers: { ctrl: true, shift: true } });
```

---

## Ordered Implementation Steps

All paths are relative to the worktree root. All `npm` commands run from the worktree root.

1. **Baseline.** Run `npm run typecheck && npm test && npm run lint`. Record the passing test count (call it *N*).

2. **Tests first — `packages/lib/tests/unit/core/SpatialNavigation.test.ts`.**
   - Line 118 (`afterEach`): change `targetModifiers: { ctrl: true, shift: true }` to `targetModifiers: { ctrl: true, alt: true, shift: true }`.
   - Line 287 (the "while isEnabled() is false" test): change the second key event to `{ code: 'ArrowRight', ctrlKey: true, altKey: true, shiftKey: true }`.
   - Line 290: rename the test to `'once enabled with defaults, claims Ctrl+Alt+Arrow* and Ctrl+Alt+Shift+Arrow*, and refuses a bare arrow, Ctrl-only, Shift-only, Alt-only, Ctrl+Shift, and a non-arrow code'`.
   - Line 298: change the key event to `{ code: 'ArrowRight', ctrlKey: true, altKey: true, shiftKey: true }` (still `toBe(true)`).
   - After line 302 (the Shift-only refusal), add two refusals: `{ code: 'ArrowLeft', ctrlKey: true, shiftKey: true }` and `{ code: 'ArrowRight', ctrlKey: true, shiftKey: true }`, each `toBe(false)`.
   - Line 316: change the key event to `{ code: 'ArrowRight', ctrlKey: true, altKey: true, shiftKey: true }` (still `toBe(true)`).
   - Line 321: change the key event to `{ code: 'ArrowRight', ctrlKey: true, altKey: true, shiftKey: true }` (still `toBe(false)`).
   - In `describe('SpatialNavigation.claimsKey')`, after the `configure({ componentModifiers })` test, add case U5 from [Expected Behaviour](#expected-behaviour) as a new test.
   - In `describe('SpatialNavigation keydown wiring')`, after the test `'an unclaimed keydown calls neither preventDefault nor stopPropagation'`, add case U4 as a new test. Seed the navigation target with `setQuerySelectorAllResult(body, NAVIGATION_TARGET_SELECTOR, [target])`, as the target-tier tests in the same file do.
   - Build both from that file's own helpers (`installTestDOM`, `stableBody`, `liveHandle`, `place`, `setQuerySelectorAllResult`, `dispatchKeyDown`, `keyEvent`), in the shape of the neighbouring tests.

   Run `npm test`. The changed and added tests fail (red).

3. **`packages/lib/src/typescript/lib/core/SpatialNavigation.ts`.**
   - Line 209: `const DEFAULT_TARGET_MODIFIERS:    SpatialNavigationModifiers = { ctrl: true, alt: true, shift: true };`
   - Line 184: replace the JSDoc with the `targetModifiers` line from [Public API](#public-api).
   - Line 194: change `` `Ctrl+Alt` / `Ctrl+Shift` chords`` to `` `Ctrl+Alt` / `Ctrl+Alt+Shift` chords``.
   - Lines 203-207: replace the comment above the two defaults with:

     ```typescript
     // Ctrl+Alt + arrow (fine) and Ctrl+Alt+Shift + arrow (coarse). Neither
     // chord is bound by a browser, by native text editing, or by CodeMirror's
     // default keymap, except Ctrl+Alt+Up/Down, which CodeEditor binds to
     // add-cursor-above/below on Windows and Linux. GNOME binds Ctrl+Alt+arrow
     // (switch workspace) and, on older releases, Ctrl+Alt+Shift+arrow (move
     // the window to a workspace). These are documented trades; each tier's
     // modifier set is configurable to work around them. The coarse tier was
     // Ctrl+Shift + arrow in 0.10.0, which took word selection away from
     // every text input.
     ```

   - Line 733 (the namespace JSDoc): change `` `Ctrl+Shift`+arrow (the `"target"` tier)`` to `` `Ctrl+Alt+Shift`+arrow (the `"target"` tier)``.

   Run `npm test`. Green, *N* plus the two added tests.

4. **`packages/lib/src/typescript/lib/core/Component.ts:2345`** (`setNavigationTarget` JSDoc): change `` the `Ctrl+Shift`+arrow chord`` to `` the `Ctrl+Alt+Shift`+arrow chord``.

5. **`packages/lib/src/typescript/lib/component/input/focusRing.ts:69`** (`registerFocusVisibleRing` JSDoc): change `` own `Ctrl+Alt` / `Ctrl+Shift` chords`` to `` own `Ctrl+Alt` / `Ctrl+Alt+Shift` chords``.

   Checkpoint: `grep -rn 'Ctrl+Shift' packages/lib/src/typescript/lib/core/SpatialNavigation.ts packages/lib/src/typescript/lib/core/Component.ts packages/lib/src/typescript/lib/component/input/focusRing.ts` prints exactly one line: the new "Ctrl+Shift + arrow in 0.10.0" comment in `SpatialNavigation.ts`.

6. **`packages/lib/docs/concepts/accessibility.md`.**
   - Line 157: change `` **`Ctrl+Shift`+arrow** (the **target** tier)`` to `` **`Ctrl+Alt+Shift`+arrow** (the **target** tier)``.
   - After the `configure` example that ends at line 171, insert this paragraph:

     ```markdown
     Neither default chord touches native text editing, so `Ctrl+Shift+←`/`→` still selects by word in every text field and editor. Two collisions remain, and `configure` is the way around each:

     - **`Ctrl+Alt+↑`/`↓`** is [`CodeEditor`](/components/CodeEditor)'s add-cursor-above/below on Windows and Linux. While the service is enabled, the chord moves focus instead. Alt+drag still makes a rectangular selection. macOS is not affected.
     - **GNOME** binds `Ctrl+Alt`+arrow to switching workspace, and older releases bind `Ctrl+Alt+Shift`+arrow to moving the window to another workspace. The desktop takes the chord before the page sees it.
     ```

   - Line 267: change `` `Ctrl+Alt`+arrow and `Ctrl+Shift`+arrow move focus`` to `` `Ctrl+Alt`+arrow and `Ctrl+Alt+Shift`+arrow move focus``.

7. **`packages/lib/docs/components/CodeEditor.md`.** After the keyboard table in `## Keyboard` (the table ends at line 227), insert:

   ```markdown
   When the app enables [spatial focus navigation](/concepts/accessibility#spatial-focus-navigation), its `Ctrl+Alt`+arrow chord takes `Ctrl-Alt-↑` / `Ctrl-Alt-↓` (add a cursor above / below) on Windows and Linux: the chord moves focus out of the editor instead. Alt+drag still makes a rectangular selection. Word selection (`Ctrl-Shift-←` / `Ctrl-Shift-→`) is not affected.
   ```

8. **`packages/lib/docs/reference/changelog/next.md`.** Append after the intro paragraph:

   ```markdown
   ## Breaking changes

   ### Core

   - **`SpatialNavigation`'s region chord is now `Ctrl+Alt+Shift`+arrow.**
     The `"target"` tier's default modifiers change from `Ctrl+Shift` to
     `Ctrl+Alt+Shift`, because `Ctrl+Shift+←`/`→` is word selection in every
     text input, `MarkdownEditor` and `CodeEditor`, and the service took it
     away from all of them while enabled. The `Ctrl+Alt`+arrow control chord
     is unchanged. Restore the old chord with
     `SpatialNavigation.configure({ targetModifiers: { ctrl: true, shift: true } })`.
     See [Migration](/reference/migration/next) for the full note.
   ```

9. **`packages/lib/docs/reference/migration/next.md`.** Append after the intro paragraph:

   ````markdown
   ## `SpatialNavigation`'s region chord is `Ctrl+Alt+Shift`+arrow

   **What changed and why.** The `"target"` tier — the chord that jumps
   between navigation-target containers — defaulted to `Ctrl+Shift`+arrow.
   The service claims its chords at the window before any widget sees them,
   so on Windows and Linux it took `Ctrl+Shift+←`/`→` word selection away
   from every `<input>`, `<textarea>`, `MarkdownEditor` and `CodeEditor`, and
   on macOS it took `CodeEditor`'s `Ctrl-Shift`-arrow bindings. The default is
   now `Ctrl+Alt+Shift`+arrow, which no editor or browser binds. The
   `"component"` tier stays on `Ctrl+Alt`+arrow.

   **Who needs to act.** An app that enables `SpatialNavigation` without
   passing `targetModifiers` now answers to `Ctrl+Alt+Shift`+arrow. Update any
   help text or shortcut legend that names the old chord. An app that passes
   its own `targetModifiers` is not affected. To keep the old chord:

   ```typescript
   SpatialNavigation.configure({ targetModifiers: { ctrl: true, shift: true } });
   ```
   ````

10. **Final checks.** Run the whole [Verification](#verification) table.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/SpatialNavigation.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/focusRing.ts` |
| Modify | `packages/lib/tests/unit/core/SpatialNavigation.test.ts` |
| Modify | `packages/lib/docs/concepts/accessibility.md` |
| Modify | `packages/lib/docs/components/CodeEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/docs/reference/migration/next.md` |

---

## Expected Behaviour

**Unit-testable** (`packages/lib/tests/unit/core/SpatialNavigation.test.ts`). "Defaults" means `enable()` with no options.

| # | Setup | Input | Expect |
|---|---|---|---|
| U1 | defaults | `claimsKey` for `Ctrl+Alt+Shift+ArrowRight` | `true` |
| U2 | defaults | `claimsKey` for `Ctrl+Shift+ArrowLeft` and `Ctrl+Shift+ArrowRight` | `false` for both |
| U3 | defaults | `claimsKey` for `Ctrl+Alt+ArrowUp/Down/Left/Right` | `true` (unchanged) |
| U4 | defaults; one focused origin and one candidate east of it, the candidate inside a marked navigation target | dispatch a `Ctrl+Shift+ArrowRight` keydown | neither `preventDefault` nor `stopPropagation` is called; focus stays on the origin |
| U5 | defaults, then `configure({ targetModifiers: { ctrl: true, shift: true } })` | `claimsKey` for `Ctrl+Shift+ArrowRight`, then for `Ctrl+Alt+Shift+ArrowRight` | `true`, then `false` |
| U6 | defaults, then `configure({ componentModifiers: { ctrl: true, alt: true }, targetModifiers: { meta: true } })` | `claimsKey` for `Ctrl+Alt+Shift+ArrowRight` | `false` |

**Manual** (demo: `npm run dev` from the worktree root, open the printed URL in Chromium). Focus, text selection and OS key handling do not run in the offline harness.

| # | Where | Keys | Expect |
|---|---|---|---|
| M1 | **Split** tab, the text area (itself a navigation target), caret inside a word | `Ctrl+Shift+←` / `→` | The selection extends by a word. Focus does not move. |
| M2 | **CodeEditor** tab, caret in the document | `Ctrl+Shift+←` / `→` | The selection extends by a word group. |
| M3 | **MD Editor** tab, caret in the text | `Ctrl+Shift+←` / `→` | The selection extends by a word. |
| M4 | **Misc.** tab, a control in the left column | `Ctrl+Alt+Shift+→`, then `Ctrl+Alt+Shift+←` | Focus lands in the right column, then returns to the same left-column control. A focus ring shows each time. |
| M5 | **Misc.** tab, any control | `Ctrl+Alt`+arrow | Focus moves to the nearest control in that direction (unchanged). |
| M6 | **CodeEditor** tab, caret in the document (Windows/Linux key handling) | `Ctrl+Alt+↓` | Focus moves out of the editor; no second cursor appears. This is the documented trade. |
| M7 | Any tab with a navigation target on a Linux GNOME desktop, if one is available | `Ctrl+Alt+Shift`+arrow | Record whether the desktop takes the chord. Nothing to fix here; the docs already name it. |

---

## Verification

| # | Command / action | Expect |
|---|---|---|
| 1 | `npm run typecheck` | clean |
| 2 | `npm test` | green; *N* + 2 tests |
| 3 | `npm run lint` | clean |
| 4 | `npm run docs:api` | finishes with zero warnings |
| 5 | `grep -rn 'Ctrl+Shift' packages/lib/src/typescript/lib/core/SpatialNavigation.ts packages/lib/src/typescript/lib/core/Component.ts packages/lib/src/typescript/lib/component/input/focusRing.ts` | one line: the "in 0.10.0" comment |
| 6 | `grep -n 'Ctrl+Shift' packages/lib/docs/concepts/accessibility.md` | one line: the new "still selects by word" sentence |
| 7 | `grep -n 'DEFAULT_TARGET_MODIFIERS: ' packages/lib/src/typescript/lib/core/SpatialNavigation.ts` | `{ ctrl: true, alt: true, shift: true }` |
| 8 | `npm run build:lib`, then `grep -c '{ctrl:!0,alt:!0,shift:!0}' packages/lib/dist/lib/SpatialNavigation-*.js` | `1` or more |
| 9 | `git diff --stat -- package.json packages/*/package.json package-lock.json` | empty (no version bump) |
| 10 | Manual cases M1-M7 | walked |

---

## Potential Challenges

- **Another branch also appends to `changelog/next.md` or `migration/next.md`.** If a `## Breaking changes` / `### Core` heading already exists when this lands, add the bullet under it instead of creating a second heading.
- **A stale `dist/lib` misleads SQLAdmin's check.** Verification row 8 rebuilds; SQLAdmin reads the built chunk, not the source.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/SpatialNavigation.ts:176-255`](packages/lib/src/typescript/lib/core/SpatialNavigation.ts#L176) — the options interface, the defaults, `matchesModifiers` and `claimedTier`.
- [`packages/lib/src/typescript/lib/core/SpatialNavigation.ts:729-830`](packages/lib/src/typescript/lib/core/SpatialNavigation.ts#L729) — the namespace JSDoc, `enable`, `configure`, `claimsKey`.
- [`packages/lib/tests/unit/core/SpatialNavigation.test.ts:93-120`](packages/lib/tests/unit/core/SpatialNavigation.test.ts#L93) and `:283-445` — the key-event helpers, the `afterEach` reset, and the `claimsKey` / keydown-wiring tests being changed.
- [`packages/lib/docs/reference/changelog/0.4.0.md:132-138`](packages/lib/docs/reference/changelog/0.4.0.md#L132) — precedent for a changed default with a restore line.
- [`packages/lib/docs/reference/migration/0.10.0.md:109-138`](packages/lib/docs/reference/migration/0.10.0.md#L109) — precedent for the migration note's shape.
- [`plans/implemented/spatial-focus-navigation.md`](plans/implemented/spatial-focus-navigation.md) — lines 133-135, 529-530 and its chords footnote (line 589): the original chord choice and the word-select trade this plan removes.

---

## Non-Goals

- **Version bump, release commit, tag or publish.** The user does these by hand after SQLAdmin's verification.
- **Changing the control tier's chord.** Its `CodeEditor` add-cursor trade is documented instead.
- **A text-entry stand-down in the service.** Rejected; see the decision above.
- **Moving `CodeEditor`'s add-cursor binding** to another key. The binding is CodeMirror's default keymap, which the editor uses unchanged.

---

## Notes

[^key-order]: The minified build prints the literal as `{ctrl:!0,alt:!0,shift:!0}`. SQLAdmin's `spatial-navigation-adoption` plan checks the linked build for that exact string before it starts, so a different key order would fail its gate even though the behaviour is the same.

[^collisions]: Checked against `node_modules/@codemirror/commands/dist/index.js:1727-1787` (the default keymap `CodeEditor` uses). The arrow bindings with modifiers are `Mod-Arrow` (group move, `Shift` extends), `Alt-Arrow` / `Ctrl-Arrow` on macOS (syntax move, `Shift` extends), `Alt-ArrowUp/Down` and `Shift-Alt-ArrowUp/Down` (move / copy line), `Mod-Alt-ArrowUp/Down` (add cursor) and macOS `Ctrl-ArrowUp/Down` (page, `Shift` extends). None combines Ctrl, Alt and Shift. The search, fold and autocomplete keymaps bind only bare arrows. In the library, no handler reads `altKey` together with `shiftKey` on an arrow key, and `MarkdownEditor` has no arrow binding of its own. Native `<input>` and `<textarea>` editing uses `Ctrl+Shift` (word) and `Shift` (character), never `Ctrl+Alt+Shift`.

[^control-tier]: Moving the control tier as well was not requested. `Ctrl+Alt+←/→` clashes with nothing, and `Ctrl+Alt+↑/↓` only takes CodeMirror's add-cursor, which is rarely used and keeps an Alt+drag alternative. On macOS CodeMirror's `Mod` is `Cmd`, so `Mod-Alt-Arrow` is `Cmd+Alt` there and the control tier does not touch it. GNOME's `Ctrl+Alt`+arrow collision was accepted when the service shipped (`plans/implemented/spatial-focus-navigation.md:529`); the new region chord adds the same class of collision on older GNOME, where `Ctrl+Alt+Shift`+arrow moves the window to another workspace.

[^no-standdown]: Standing down whenever focus is in a text-entry element was considered and rejected. It would fix word selection, but it would leave no spatial way out of an editor: a user in a `CodeEditor` or a long `TextArea` could only leave by Tab (which `CodeEditor` traps for indentation) or the mouse. A chord that no editor binds gives both: editing keys keep working, and the chord still works from inside the editor.

[^other-tests]: The chord was reported in those three files, but they were read and none asserts it. `Tree.test.ts:474-491` and `Body.test.ts:630-658` mock `SpatialNavigation.claimsKey` to return `true` and send a bare arrow; `FocusTraversal.test.ts` only mentions `SpatialNavigation` in a header comment, as the test-harness precedent. `TreeBody.test.ts:230-254` has the same mock shape. A grep of `packages/lib/tests` for key events carrying both `ctrlKey: true` and `shiftKey: true` finds only `SpatialNavigation.test.ts` lines 287, 298, 316 and 321.

---

## Implementation Notes

**Verification row 4 (`npm run docs:api` "0 errors and 0 link warnings"): the baseline was not clean.** `npm run docs:api` on this branch finishes with 0 errors and 14 warnings, all pre-existing on `master` and unrelated to this change (`outermostTargets`, `leafFocusables`, `ancestorGeometry`, `PRIMARY_GAP_EPSILON`, `Component.replaceComponent`, `MarkdownContentPane`, `$selectEnclosingWordIfCollapsed`, `$classifyContextMenuTarget` — confirmed present in `master`'s `SpatialNavigation.ts` before this branch touched it). This plan's own edits introduce no new warning. Fixing the pre-existing 14 is out of scope for a surgical chord-default change.

**Manual verification (Expected Behaviour table).** M1–M6 were driven live against `npm run dev` (Chromium, via chrome-devtools MCP) on this worktree's built source, not merely asserted by unit test:

- M1 (Split tab, textarea): caret placed mid-word in "gutter"; `Ctrl+Shift+→` extended the selection to `tter` (native word selection) and `document.activeElement` stayed the textarea.
- M2 (CodeEditor tab): caret placed mid-word in "function"; `Ctrl+Shift+→` grew the status line's selection from 0 to 4 chars and focus stayed on `.cm-content`.
- M3 (MD Editor tab, Lexical surface): caret placed mid-word; `Ctrl+Shift+→` produced a non-collapsed `window.getSelection()` and focus stayed on the `WysiwygSurface`.
- M4 (Misc. tab): focused a left-column button, `Ctrl+Alt+Shift+→` moved focus to a right-side control with `data-ts-ui-focus-visible` set, then `Ctrl+Alt+Shift+←` returned focus to the exact same left-column button, ring set again both times.
- M5 (Misc. tab): `Ctrl+Alt+↓` from that same button moved focus to the nearest control below it (component tier unchanged).
- M6 (CodeEditor tab): caret in the document, `Ctrl+Alt+↓` moved focus out to a `Button` element; the two `.cm-cursor-primary` nodes found afterward belong one each to the page's two separate `CodeEditor` instances (verified by inspecting their class lists), not a second cursor added within one editor.

M7 (GNOME desktop chord collision) could not be exercised — this environment is WSL2 + Chromium with no GNOME desktop session available. The plan itself frames M7 as conditional ("if one is available"), so this is a documented gap rather than a skipped check.

All other unit-testable behaviour (U1–U6, plus the full existing `SpatialNavigation.test.ts` and `packages/lib` suites) is covered by automated tests, not manual verification.
