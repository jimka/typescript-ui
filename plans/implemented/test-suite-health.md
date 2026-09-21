---
touches-shared:
  - packages/lib/docs/reference/changelog/next.md
  - packages/qa/README.md
  - plans/research/render-review-2026-09-15/01-phase2-status-pass.md
---

# Test Suite Health — Implementation Plan

## Overview

The `packages/lib` suite passes, but every run's console output carries a CodeMirror stack trace, and now and then a run reports an unhandled error or a failed test that does not come back. Separately, the `packages/docs` suite run from a worktree tests the main checkout's library build instead of the worktree's. This plan removes the cause of each problem. It does not hide any output: no reporter, `silent`, `onConsoleLog` or unhandled-error setting changes.

The work covers the items recorded under "Test-suite health" in [01-phase2-status-pass.md:398-409](plans/research/render-review-2026-09-15/01-phase2-status-pass.md#L398), the `ColumnFilterRow` debounce found since, and one more flaky test found while reproducing them. The changes land in three `packages/lib` test files, one library source file ([Header.ts](packages/lib/src/typescript/lib/component/table/Header.ts)), the Vite configs of `packages/docs` and `packages/qa` with one test each, and a new shared `build/libraryBuildAlias.ts`.

---

## Findings

Reproduced on `master` (`f0d95ef8`) from a fresh worktree over 27 full `packages/lib` runs: 4 with the default reporter and 23 with `--reporter=verbose`. One more instrumented run is described in [*Addendum: The timer probe*](#addendum-the-timer-probe).

| # | Symptom | How often | Source | Fix |
|---|---|---|---|---|
| 1 | `TypeError: textRange(...).getClientRects is not a function`, printed twice | 23 of 23 verbose runs. The default reporter hides it.[^reporter] | The two `CodeEditor` cases in [FocusTraversalCompositeWidgets.test.ts:189](packages/lib/tests/core/FocusTraversalCompositeWidgets.test.ts#L189) (a `jsdom` suite) never dispose their editor. CodeMirror measures on an animation frame after the case ends and calls `Range.getClientRects`, which jsdom does not implement. CodeMirror catches the throw and logs it with `console.error`. | Dispose the editors. |
| 2 and 3 | Unhandled rejection `DOM handle 58 is not registered (released or never minted)`; summary `Errors 1 error`; every test passes | 1 of 27 | One defect, not two. Four tests in [ColumnFilterRow.test.ts](packages/lib/tests/component/table/ColumnFilterRow.test.ts) type into a filter cell under real timers and end with `TableHeader`'s 200 ms keystroke debounce still armed. It fires during a later test or after the file's last `DOM.reset()`, and the header redraws through handles from a discarded DOM. `DOM.reset()` cannot cancel it: the header uses the global `setTimeout`, not the DOM seam's. | Seam timer in `Header.ts`, plus a fake clock in the four tests. |
| 4 | Docs tests in a worktree import the main checkout's `packages/lib/dist` | Every worktree run | [packages/docs/vite.config.ts](packages/docs/vite.config.ts) has no alias, so `@jimka/typescript-ui` resolves through the `node_modules` symlink, and a worktree has only the main tree's `node_modules`. | Alias to this checkout's build, as `packages/qa` does. |
| 5 (new) | `code-editor.test.ts > collectSyntaxErrors > caps output at 100 diagnostics …` fails: `expected … to have a length of 100 but got 90` | 1 of 27 | The test's `EditorState.create` parses for at most 20 ms and keeps whatever tree it has then. The test took 5–23 ms across the verbose runs, so a busy machine cuts the parse short. | Parse to completion in the test's state builder. |

The debounce in row 2 is left armed in every run, not just the failing one, and in the instrumented run all four timers fired inside later tests. The error shows only when one lands between two tests. Inside a test it usually lands silently, because every `installTestDOM()` restarts handle numbering at 1: an old handle often names some unrelated element of the later test.[^silent-late-fire]

---

## Architecture Decisions

### Dispose the editors the `CodeEditor` cases build

The `CodeEditor` describe block in `FocusTraversalCompositeWidgets.test.ts` keeps every editor it builds in an `editors` array and disposes them in an `afterEach`. `CodeEditor`'s destructor destroys the CodeMirror view, and `EditorView.destroy()` cancels the pending measure frame. This mirrors [MarkdownHeadingScoping.test.ts:32-61](packages/lib/tests/component/display/MarkdownHeadingScoping.test.ts#L32), the jsdom precedent for tearing down live components after each case. No `Range.getClientRects` polyfill is added.[^no-polyfill]

### Route `TableHeader`'s filter debounce through `DOM.sink`

`TableHeader._filterTimer` becomes a `TimerId | null`, armed with `DOM.sink.setTimeout` and cleared with `DOM.sink.clearTimeout` at all four clear sites. `DOM.reset()` then cancels a pending keystroke write. The seam documents this for "a deferred callback that will write to an element" ([dom-seams.md:71](packages/lib/docs/concepts/dom-seams.md#L71)). [AutoCompleteField.ts:136](packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts#L136) got the same change in commit `eb6f2ac6` for its own 200 ms debounce, which `COLUMN_FILTER_DEBOUNCE_MS` says it matches.[^seam-timer]

### Fake the clock in the four `ColumnFilterRow` tests that type

Each of the four tests gets `vi.useFakeTimers()` as its first line. Both enclosing describe blocks already call `vi.useRealTimers()` in `afterEach`. Every other test in the file that types already fakes the clock: tests 24–28 ([ColumnFilterRow.test.ts:372](packages/lib/tests/component/table/ColumnFilterRow.test.ts#L372)) and "Enter applies immediately…" ([:436](packages/lib/tests/component/table/ColumnFilterRow.test.ts#L436)) fake the clock even when they never advance it. Both this fix and the seam timer above ship.[^both-fixes]

### Parse the `collectSyntaxErrors` test documents to completion

`buildJsonState` finishes the parse with `ensureSyntaxTree(state, state.doc.length, Infinity)` and returns `state.update({}).state`, which carries the finished tree. CodeMirror's own `forceParsing` makes these same two moves for a view. A new test runs the cap case under a clock that makes every parse budget expire at its first check, following [List.test.ts:340-348](packages/lib/tests/component/list/List.test.ts#L340)'s deterministic-clock pattern. `collectSyntaxErrors` itself is unchanged: returning fewer diagnostics for an incomplete tree is its documented behaviour ([syntaxDiagnostics.ts:19-21](packages/lib/src/typescript/lib/component/editor/syntaxDiagnostics.ts#L19)).[^complete-parse]

### Point `packages/docs` at this checkout's library build

`packages/docs/vite.config.ts` installs the plugin [packages/qa/vite.config.ts:23](packages/qa/vite.config.ts#L23) already installs. Every exported subpath of `@jimka/typescript-ui` becomes an alias to this checkout's `packages/lib/dist/lib` file, derived from the build's `package.json` `exports`, and any other import of the package fails. The docs app keeps consuming the built library, not the library source.[^build-not-source] Vitest reads the same config file, so the docs tests, dev server and production build all resolve the library the same way.

### Share the alias from `build/`, like `keepNames`

The alias code moves out of [packages/qa/vite/plugins.ts](packages/qa/vite/plugins.ts) into a new `build/libraryBuildAlias.ts`, which both packages import. [build/keepNames.ts](build/keepNames.ts) is the precedent: the repo-level home for Vite config that more than one package shares (commit `ca740d6a`). `qaLibraryPlugin` is renamed `libraryBuildPlugin` and its plugin name `'qa-library-arm'` becomes `'library-build-alias'`, since it no longer belongs to QA alone.[^shared-module]

### Commit grouping

Test-setup and build-config changes are tooling. Test fixes that ship with a source fix are code. The two test-only fixes are code too: each fixes test code, and each is its own functionality.

| Commit | Bucket | Contents |
|---|---|---|
| 1 | code | Steps 1–4: `Header.ts` seam timer, its two regression tests, fake clock in the four tests |
| 2 | code | Step 5: `FocusTraversalCompositeWidgets.test.ts` editor teardown |
| 3 | code | Steps 6–7: `code-editor.test.ts` builder and slow-clock test |
| 4 | tooling | Steps 8–12: `build/libraryBuildAlias.ts`, both Vite configs, qa test import, docs resolution test, qa README row |
| 5 | documentation | Step 13: changelog entry for commit 1 |
| 6 | bookkeeping | Step 14: research-record update (with the plan's Implementation Notes) |

---

## Internal Structure

`TableHeader` after the change. The field and the arm site are shown; the four clear sites change from `clearTimeout(this._filterTimer)` to `DOM.sink.clearTimeout(this._filterTimer)` and nothing else.

```typescript
import type { TimerId } from "~/core/DOM.js";

private _filterTimer       : TimerId | null = null;

// onFilterCellChange, the non-immediate branch:
this._filterTimer = DOM.sink.setTimeout(() => this.applyPendingFilter(), COLUMN_FILTER_DEBOUNCE_MS);
```

`applyPendingFilter` already clears and nulls `_filterTimer` on entry, so the callback needs no `this._filterTimer = null` of its own.[^fired-id]

`build/libraryBuildAlias.ts` exports two functions: the current `libraryAliases` and `qaLibraryPlugin`, moved with the private helpers they use. Step 10 lists the only edits.

```typescript
export function libraryAliases(libDir: string): RegexAlias[];
export function libraryBuildPlugin(options: { libDir: string }): Plugin;   // name: 'library-build-alias', enforce: 'pre'
```

The `collectSyntaxErrors` test builder:

```typescript
function buildJsonState(doc: string): EditorState {
    const state = EditorState.create({ doc, extensions: [json()] });

    ensureSyntaxTree(state, state.doc.length, Infinity);

    return state.update({}).state;
}
```

---

## Ordered Implementation Steps

Run every `vitest` command below from inside the worktree. Never run `packages/qa/runqa.sh`, MiniBrowser, the Tauri `qa-host`, or anything else that opens a window. Nothing in this plan needs one.

**Commit 1 — `TableHeader`'s filter debounce**

1. **Regression tests, red first.** In [ColumnFilterRow.test.ts](packages/lib/tests/component/table/ColumnFilterRow.test.ts), add `import type { RecordingDOMSink } from '../../dom/TestDOM';` on the line after the `installTestDOM` import (`:20`). Inside the describe block `'Column filter row — typing filters the store (debounced)'` (`:361`), after the `'Enter applies immediately; Escape clears and applies immediately'` case, add E4 and E5 exactly as written in *Expected Behaviour*. Run `npx vitest run tests/component/table/ColumnFilterRow.test.ts` in `packages/lib`. Expect E4 and E5 to fail. E5's red run also prints a `DOM handle N is not registered` unhandled rejection, the symptom this commit removes.
2. **Seam timer.** In [Header.ts](packages/lib/src/typescript/lib/component/table/Header.ts):
   - Add `import type { TimerId } from "~/core/DOM.js";` after the `DOM` import at `:4`.
   - `:296`: change the field's type to `TimerId | null`.
   - `:1396`: arm with `DOM.sink.setTimeout(...)`, as in *Internal Structure*.
   - `:671`, `:1387`, `:1429`, `:1748`: `clearTimeout(` becomes `DOM.sink.clearTimeout(`.

   Check: `grep -n "setTimeout\|clearTimeout" packages/lib/src/typescript/lib/component/table/Header.ts` shows only `DOM.sink.` forms (five lines). Rerun the file: E4 and E5 pass, and so does every existing case.
3. **Fake clock in the four tests.** Add `vi.useFakeTimers();` followed by a blank line as the first statement of each of these tests (lines as of `f0d95ef8`, before step 1 moved them down):
   - `:1247` `'clicking the operator button with 2+ clauses opens the clauses popover directly instead of the menu'`
   - `:1324` `'a real condition plus one still-blank added row does not show "2" — …'` (inside the nested `describe` at `:1323`, which inherits the outer block's `afterEach` at `:1151`)
   - `:1562` `'setOperators([]) drops a stale multi-clause list and hides the badge on a cell going non-filterable'`
   - `:1676` `'14. the gate is stateless — a second "-" is still allowed after text already holds one'`

   Add nothing else: none of these tests needs to advance time. Check: the file passes, 80 tests.
4. Run `npm run test` in `packages/lib` (typecheck plus the full suite). Commit (code).

**Commit 2 — `CodeEditor` teardown in the jsdom focus suite**

5. In [FocusTraversalCompositeWidgets.test.ts](packages/lib/tests/core/FocusTraversalCompositeWidgets.test.ts):
   - `:14`: add `afterEach` to the `vitest` import.
   - Inside `describe('A Tab-key owner\'s own tab stop (CodeEditor)', …)` (`:171`), after its leading comment (ends `:188`) and before the first `it(`, add:

     ```typescript
     // Every editor a case below builds, disposed after it. Mounting starts
     // CodeMirror's measure cycle on an animation frame; left undisposed, that
     // frame runs after the case has ended, and its selection layer calls
     // `Range.getClientRects`, which jsdom does not implement, so CodeMirror
     // logs a TypeError. Disposing destroys the view, which cancels the frame.
     // Mirrors MarkdownHeadingScoping.test.ts's `panes`.
     const editors: CodeEditor[] = [];

     afterEach(() => {
         for (const editor of editors.splice(0)) {
             editor.dispose();
         }
     });
     ```
   - In both cases (`:190` and `:208`), add `editors.push(editor);` on the line after `const editor = new CodeEditor('hello');`.

   Check: `npx vitest run tests/core/FocusTraversalCompositeWidgets.test.ts --reporter=verbose 2>&1 | grep -c getClientRects` prints `0` (it prints `2` before the change). Run it three times. Commit (code).

**Commit 3 — `collectSyntaxErrors` test determinism**

6. **Slow-clock test, red first.** In [code-editor.test.ts](packages/lib/tests/component/code-editor.test.ts), inside `describe('collectSyntaxErrors', …)` (`:2158`):
   - As the block's first statement, add `afterEach(() => vi.restoreAllMocks());`. Both `afterEach` and `vi` are already imported at `:1`.
   - Below it, add the constant:

     ```typescript
     // How far each Date.now() read lands past the previous one in the
     // slow-clock case. Anything above the 20 ms budget CodeMirror gives a new
     // EditorState's first parse works; 25 clears it by a margin, so that
     // budget expires at its very first check.
     const CLOCK_STEP_MS = 25;
     ```
   - After the `'caps output at 100 …'` case (`:2203-2212`), add E6 exactly as written in *Expected Behaviour*.

   Run `npx vitest run tests/component/code-editor.test.ts -t collectSyntaxErrors`. Expect E6 to fail with a length below 100 (the probe got 1).
7. **Complete-parse builder.** Add `ensureSyntaxTree` to the `@codemirror/language` import at `:20`. Replace `buildJsonState` (`:2159-2161` before step 6 moved it down) with the body in *Internal Structure*. Above it, add this JSDoc:

   ```typescript
   /**
    * Builds a JSON editor state whose syntax tree is complete.
    * `EditorState.create` parses for at most 20 ms and keeps whatever tree it
    * has by then, so on a busy machine a longer document comes back
    * half-parsed and yields fewer diagnostics. Parsing on with no time limit
    * and applying one empty transaction publishes the finished tree: the two
    * moves CodeMirror's own `forceParsing` makes for a view.
    *
    * @param doc - The document text.
    * @returns A state whose `syntaxTree` covers the whole document.
    */
   ```

   Rerun: all six `collectSyntaxErrors` cases pass. Run `npm run test` in `packages/lib`. Commit (code).

**Commit 4 — `packages/docs` resolves this checkout's library build**

8. **Build this checkout's library and API tree.** From the worktree root, run `npm run build:lib`, then `NODE_OPTIONS=--max-old-space-size=12288 npm run docs:api` (the heap pin CI uses in [docs.yml](.github/workflows/docs.yml#L47)). Both write gitignored output. Without them, the docs suite cannot run in a worktree at all: `virtual:typedoc-api` throws "TypeDoc API tree not found".
9. **Resolution test, red first.** Create `packages/docs/tests/libraryResolution.test.ts` with E9 exactly as written in *Expected Behaviour*, header comment included. Run `npx vitest run tests/libraryResolution.test.ts` in `packages/docs`. From a worktree, expect it to fail with `expected [Function Body] to be [Function Body]` (two different module instances).
10. **Move the alias into `build/`.** Create `build/libraryBuildAlias.ts`. Move these parts of [packages/qa/vite/plugins.ts](packages/qa/vite/plugins.ts) into it verbatim: `RegexAlias` and `PackageJson` (`:8-18`), `escapeRegExp` and `readPackage` (`:20-39`), and `exactAlias`, `wildcardAlias`, `libraryAliases` and `qaLibraryPlugin` (`:96-196`). Delete them from `plugins.ts`. Then, in the new file:
    - Give it the three imports the moved code uses: `import * as fs from 'node:fs';`, `import * as path from 'node:path';` and `import type { Plugin } from 'vite';`.
    - Rename `qaLibraryPlugin` to `libraryBuildPlugin` and its `name` to `'library-build-alias'`.
    - In `libraryBuildPlugin`'s JSDoc, replace "load a second library instance whose prototypes the counters never see" with "load a second library instance".
    - In `libraryAliases`'s JSDoc (`:133` today), "The alias list `qaLibraryPlugin` installs" becomes "The alias list `libraryBuildPlugin` installs".
    - Open the file with this comment, above the imports:

      ```typescript
      // The library-build alias shared by every in-repo Vite config that imports
      // `@jimka/typescript-ui` (packages/qa, packages/docs). Each exported subpath
      // resolves to one checkout's own packages/lib build, never to whatever the
      // node_modules symlink points at, which in a worktree is the main tree's
      // build. Node-side: no page imports this file.
      ```

    `plugins.ts` keeps all three imports: `writeReport` uses `fs` and `path`, `isUnder` uses `path`, and `qaReportPlugin` uses `Plugin`.
11. **Point both packages at it.**
    - [packages/qa/vite.config.ts](packages/qa/vite.config.ts): at `:4`, import `outsideAppSource` and `qaReportPlugin` from `'./vite/plugins.js'` and `libraryBuildPlugin` from `'../../build/libraryBuildAlias.js'`. At `:23`, call `libraryBuildPlugin({ libDir: LIB_DIR })`.
    - [packages/qa/tests/plugins.test.ts:5](packages/qa/tests/plugins.test.ts#L5): import `libraryAliases` from `'../../../build/libraryBuildAlias.js'`; `outsideAppSource` stays on `'../vite/plugins.js'`.
    - [packages/docs/vite.config.ts](packages/docs/vite.config.ts): import `libraryBuildPlugin` from `'../../build/libraryBuildAlias.js'` beside the `keepNames` import (`:5`). After `API_DIR` (`:7`), add the lines below. The file has no semicolons; keep it that way.

      ```typescript
      // The library build the app, its dev server and its tests import: this
      // checkout's own packages/lib, never the node_modules symlink, which in a
      // worktree points at the main tree's build. Run `npm run build:lib` first.
      const LIB_DIR = fileURLToPath(new URL('../lib', import.meta.url))
      ```

      At `:129`, make it `plugins: [libraryBuildPlugin({ libDir: LIB_DIR }), typedocApi(), spaFallback()]`.

    Check: `grep -rn "qaLibraryPlugin\|qa-library-arm" packages build --include=*.ts --include=*.md` finds nothing.
12. [packages/qa/README.md:25](packages/qa/README.md#L25): replace the row's second cell, so the row reads:

    ```markdown
    | `vite.config.ts`, `vite/plugins.ts` | The app's own Vite config: the report endpoint, and the library-build alias from the shared [`build/libraryBuildAlias.ts`](../../build/libraryBuildAlias.ts). |
    ```

    Leave the rest of the README alone.

    Run, in order: `npm -w packages/qa run typecheck`, `npm -w packages/qa run test`, `npm -w packages/docs run typecheck`, `npm -w packages/docs run test`. All pass, and E9 is now green. Commit (tooling).

**Commit 5 — changelog**

13. In [changelog/next.md](packages/lib/docs/reference/changelog/next.md), under `## Fixed` → `### Components`, append one entry just before `### Data` (`:1094`). It follows the shape of the `AutoCompleteField` timer entry at `:787-792`:

    ```markdown
    - **`DOM.reset()` now cancels a `Table` filter-row keystroke that is still
      waiting on its debounce.** The filter row's 200 ms keystroke timer used the
      bare global `setTimeout`, which `DOM.reset()` cannot reach, so a test that
      typed into a filter cell and then reset the DOM had the store write fire
      afterwards. The table then redrew through handles the reset had discarded,
      and the seam threw a "DOM handle N is not registered" rejection. The timer
      now goes through `DOM.sink`, like `AutoCompleteField`'s. No consumer action
      is needed.
    ```

    Commit (documentation).

**Commit 6 — record**

14. In [01-phase2-status-pass.md:398-409](plans/research/render-review-2026-09-15/01-phase2-status-pass.md#L398), append to each of the three test-suite bullets a bold line in the style the file already uses for settled items: "**Fixed by `plans/test-suite-health.md` (<date>):** <one sentence naming the cause>". The causes are those in this plan's *Findings* rows 1, 2 and 4. Then add three bullets to the same list:
    - The `ColumnFilterRow` debounce (row 3): the same defect as the `DOM handle` bullet, fixed by the same plan.
    - The `collectSyntaxErrors` cap test (row 5): a flake found while reproducing these, fixed by the same plan.
    - Open: `Notification.startTimer` is a bare `setTimeout` whose callback writes to elements, left armed by about 60 tests per run and dormant only because 3 s outlasts every test file.

    This rides in the plan's single "other" bookkeeping commit.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/table/Header.ts` |
| Modify | `packages/lib/tests/component/table/ColumnFilterRow.test.ts` |
| Modify | `packages/lib/tests/core/FocusTraversalCompositeWidgets.test.ts` |
| Modify | `packages/lib/tests/component/code-editor.test.ts` |
| Create | `build/libraryBuildAlias.ts` |
| Modify | `packages/qa/vite/plugins.ts` |
| Modify | `packages/qa/vite.config.ts` |
| Modify | `packages/qa/tests/plugins.test.ts` |
| Modify | `packages/qa/README.md` |
| Modify | `packages/docs/vite.config.ts` |
| Create | `packages/docs/tests/libraryResolution.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `plans/research/render-review-2026-09-15/01-phase2-status-pass.md` |

---

## Expected Behaviour

E1–E3 are command checks on test output. E4–E9 are unit tests, each written red first.

- **E1.** A verbose run of `FocusTraversalCompositeWidgets.test.ts` prints no `getClientRects` line, three runs out of three. Before: two per run.
- **E2.** A full verbose `packages/lib` run contains no `getClientRects`, `is not registered` or `Unhandled` text and no `Errors` line in its summary. The only stderr/stdout blocks left carry the five messages listed under *Non-Goals*.
- **E3.** The full suite passes 20 times in a row (see *Verification*).
- **E4.** Typing schedules the debounce through the DOM seam:

  ```typescript
  it('the keystroke debounce is scheduled through the DOM seam', async () => {
      vi.useFakeTimers();

      const { table } = await makeTable({ columns: [{ field: 'name', filterable: true }] });
      table.setFilterRowVisible(true);

      const sink   = DOM.sink as RecordingDOMSink;
      const before = sink.writes.length;

      typeInto(nameCell(table), 'ali');

      const timers = sink.writes.slice(before).filter(w => w.op === 'setTimeout');

      expect(timers.map(w => w.args[0])).toEqual([200]);
  });
  ```
- **E5.** `DOM.reset()` cancels a pending keystroke write. `500` mirrors test 34 (`:785`): well past the 200 ms debounce.

  ```typescript
  it('DOM.reset() cancels a pending keystroke write, so nothing reaches the store afterwards', async () => {
      vi.useFakeTimers();

      const { table, store } = await makeTable({ columns: [{ field: 'name', filterable: true }] });
      table.setFilterRowVisible(true);

      typeInto(nameCell(table), 'ali');
      DOM.reset();
      vi.advanceTimersByTime(500);

      expect(store.getFilter('name')).toBeNull();
  });
  ```
- **E6.** The cap holds when the parse budget runs out:

  ```typescript
  it('caps at 100 even when every parse budget expires at its first check', () => {
      let now = 0;

      vi.spyOn(Date, 'now').mockImplementation(() => (now += CLOCK_STEP_MS));

      const doc = Array.from({ length: 250 }, () => ']').join(' ');

      expect(collectSyntaxErrors(buildJsonState(doc))).toHaveLength(100);
  });
  ```

  The same clock with the old builder yields 1 diagnostic.
- **E7.** The five existing `collectSyntaxErrors` cases keep their assertions unchanged: `[]` for `{"a": 1}`, one diagnostic for `""`, one merged `0–10` diagnostic for ten `]`, and so on.
- **E8.** Every existing `ColumnFilterRow` debounce case keeps passing unchanged: 24–28, "Enter applies immediately…", 13, 18, 19, 34, and numeric 18. So do qa's `E10 libraryAliases` cases, now importing from `build/`.
- **E9.** Docs import this checkout's build (`packages/docs/tests/libraryResolution.test.ts`, default `node` environment):

  ```typescript
  // Guards the library-build alias in packages/docs/vite.config.ts: the docs
  // app, its dev server and this suite must import `@jimka/typescript-ui` from
  // this checkout's own packages/lib build. Without the alias the import goes
  // through the node_modules symlink, which in a worktree is the main
  // checkout's build, so the suite would quietly test a different library. In
  // the main checkout both routes reach the same file; only a worktree run can
  // fail here.
  import { fileURLToPath, pathToFileURL } from 'node:url';
  import { describe, it, expect } from 'vitest';
  import { Body } from '@jimka/typescript-ui/core';

  // This checkout's own library build, which the Vite config's
  // library-build alias must resolve `@jimka/typescript-ui/*` to.
  const OWN_CORE_BUILD = fileURLToPath(new URL('../../lib/dist/lib/core.es.js', import.meta.url));

  describe('library resolution', () => {
      it("imports @jimka/typescript-ui from this checkout's own packages/lib build", async () => {
          const own = await import(/* @vite-ignore */ pathToFileURL(OWN_CORE_BUILD).href) as { Body: unknown };

          expect(Body).toBe(own.Body);
      });
  });
  ```

  In the main checkout this passes with or without the alias: the symlink resolves to the same file. It separates the two cases only in a worktree, which is where the bug lives.

---

## Verification

1. `npm run test` in `packages/lib`: typecheck and suite green.
2. Twenty full runs, each checked for noise and failure. From `packages/lib`:

   ```sh
   for i in $(seq 1 20); do
     npx vitest run --reporter=verbose > /tmp/tsh-$i.log 2>&1; code=$?
     echo "run $i exit=$code getClientRects=$(grep -c 'getClientRects' /tmp/tsh-$i.log)" \
          "handle=$(grep -c 'is not registered' /tmp/tsh-$i.log)" \
          "unhandled=$(grep -c 'Unhandled' /tmp/tsh-$i.log)" \
          "errors=$(grep -cE '^ +Errors ' /tmp/tsh-$i.log)"
   done
   ```

   Every line must read `exit=0 getClientRects=0 handle=0 unhandled=0 errors=0`. On master, `getClientRects` is 2 on every line, and roughly one run in 27 has `handle=1` or a failed cap test. `--reporter=verbose` is required: the default reporter hides a passing file's console output.
3. In one of those logs, `grep -E '^(stderr|stdout) \|' /tmp/tsh-1.log | sed 's/ > .*//' | sort | uniq -c` lists only the files named under *Non-Goals*.
4. `npm -w packages/qa run typecheck && npm -w packages/qa run test`.
5. After step 8's builds: `npm -w packages/docs run typecheck && npm -w packages/docs run test`. All 12 files pass, E9 among them.
6. Greps: step 2's `Header.ts` grep and step 11's `qaLibraryPlugin` grep.
7. Nothing opens a window: no `runqa.sh`, MiniBrowser or `qa-host`, and no `npm run dev` or `docs:dev` left for a person to open.

---

## Documentation Impact

- `changelog/next.md`: one *Fixed → Components* entry (step 13). `DOM.install` / `DOM.reset` are public test support ([dom-seams.md:27-35](packages/lib/docs/concepts/dom-seams.md#L27)), so a consumer's own suite sees the change.
- `packages/qa/README.md:25`: the file-table row (step 12).
- No change to `dom-seams.md`: its `:71` rule already covers the header's timer. No migration entry: nothing is renamed or removed from the public API. `build/` and qa's plugin names are internal tooling.

---

## Potential Challenges

- **The default reporter hides console output.** Every noise check uses `--reporter=verbose`; a default-reporter run looks clean on master too.
- **E5's red run prints the unhandled rejection this plan removes.** That is expected before step 2 and must be gone after it.
- **`docs:api` is heavy.** Use CI's heap pin (step 8). It is needed only for the docs suite, not for `packages/lib`.
- **A missing library build now fails loudly in a worktree.** The docs config aliases to `packages/lib/dist/lib`, which exists only after `npm run build:lib` in that checkout. That matches `packages/qa` ("Build the library first") and CI, which builds before testing docs.
- **`state.update({})` relies on CodeMirror comparing tree identity.** `LanguageState.apply` rebuilds its state only when the parse context's tree differs from the one it published. E6 pins this: if a CodeMirror upgrade changes it, E6 fails rather than the cap test flaking again.

---

## Critical Files

- [packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts:136](packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts#L136) and `:504-521`: the seam-timer precedent (`TimerId | null`, `DOM.sink.setTimeout` / `clearTimeout`).
- [packages/lib/tests/component/input/AutoCompleteField.test.ts:577-592](packages/lib/tests/component/input/AutoCompleteField.test.ts#L577): the "schedules … through the DOM seam" test E4 mirrors.
- [packages/lib/src/typescript/lib/core/DOM.ts:2942-2956](packages/lib/src/typescript/lib/core/DOM.ts#L2942) (`DOM.reset`) and `:857-872` (the sink timer contract); [packages/lib/tests/dom/TestDOM.ts:763-788](packages/lib/tests/dom/TestDOM.ts#L763) (the recording sink's timers).
- [packages/lib/docs/concepts/dom-seams.md:69-71](packages/lib/docs/concepts/dom-seams.md#L69): which timers go through the seam.
- [packages/lib/tests/component/display/MarkdownHeadingScoping.test.ts:32-61](packages/lib/tests/component/display/MarkdownHeadingScoping.test.ts#L32): the jsdom teardown precedent.
- [packages/lib/tests/component/list/List.test.ts:340-348](packages/lib/tests/component/list/List.test.ts#L340): the `Date.now` spy precedent.
- [packages/qa/vite/plugins.ts:96-196](packages/qa/vite/plugins.ts#L96) and [packages/qa/vite.config.ts:10-23](packages/qa/vite.config.ts#L10): the alias being shared.
- [build/keepNames.ts](build/keepNames.ts): the shared-build-module precedent.
- [.github/workflows/docs.yml:47-51](.github/workflows/docs.yml#L47): CI builds the library before testing docs.

---

## Non-Goals

- **The remaining console output.** Each line below is a library warning a test triggers, on purpose or not. None fails or flakes. Quieting each is its own decision: assert it with a console spy, or change the library.
  - `Checkbox '…' setSelected before mount; synthetic 'click' skipped.`: `MenuRow.test.ts` (5 cases), `Menu.test.ts`, `Checkbox.test.ts`, `markdown-editor.test.ts`. This is `Checkbox.setSelected`'s synthetic click, which `checkbox-action-activation` (C40) reworks.
  - `typescript-ui: text was measured before the startup font settled…`: the jsdom suites `FocusTraversalCompositeWidgets`, `StyleAuditView` and `StyleAudit.regression`, which build components without awaiting `Body.init`.
  - `Button #…: setFlat(true) ignored…`: `Button.test.ts`, the case that tests that warning.
  - `Visible component id is specified but no matching component was found.`: `DegenerateChildSets.test.ts` C7.
  - `small.txt: ~100 tokens` (stdout): `llms-generate.test.ts`.
- **`Notification`'s auto-dismiss timer.** `Notification.startTimer` is also a bare `setTimeout` whose callback writes to elements. About 60 tests per run leave one armed, mostly in `NotificationHistory.test.ts`. None fired inside a run: 3 s outlasts every file. It is dormant, so it is recorded (step 14) rather than changed.
- **An audit of every raw timer in the library.** Only the timers the probe caught firing late are in scope.
- **Docs and qa typechecks in a worktree.** Both still read the main tree's `.d.ts` through `node_modules`. `packages/qa` shares this today, and aligning the typecheck is a separate change.
- **`demos.test.ts`'s `jsdom` pragma** and the pragma comments of the docs suites: unchanged.
- **Lexical's internal 0 ms `scheduleCascadeReset` timer** (`markdown-editor.test.ts`): it fires after its test but never touches the DOM seam.

---

## Addendum: The timer probe

A throwaway Vitest setup file (never committed) replaced `setTimeout`, `clearTimeout` and, under jsdom, `requestAnimationFrame` with wrappers that record the scheduling test and stack. It ran after each test's own teardown and reported every timer still armed. A wrapper also reported any callback that ran while a different test was current. Results of one full run:

| Left armed after teardown | Fired inside a later test | Source |
|---|---|---|
| 4 (ColumnFilterRow) | 4: the three multi-condition leaks inside case `20.`, the numeric one inside case `22.` (both wait on a real `setTimeout(0)`) | `TableHeader.onFilterCellChange`, 200 ms |
| 2 (FocusTraversal) | 2 | CodeMirror `EditorView.requestMeasure` (rAF) |
| 61 | 0 | `Notification.startTimer`, 3 000–6 000 ms |
| 12 | 12 | Lexical `scheduleCascadeReset`, 0 ms |
| 21, in jsdom suites | 18, none of which threw or logged | the library's own rAF layout flush and font wait, and jsdom's `select` event |
| 4 (Border) | 0 | seam timers, which `DOM.reset()` already cancels |

The probe also checked the two test-side fixes on copies of the files. With the fake clock, the `ColumnFilterRow` copy left no timer armed (78 of 78 passing). With the teardown, the `FocusTraversal` copy printed no `getClientRects` in 5 of 5 runs. With the alias, the docs suite passed 2601 of 2601 against a worktree build whose `core.es.js` carried a marker export the main tree's lacks.

---

## Notes

[^reporter]: Vitest 4.1's default reporter drops console output from a passing file: `MenuRow.test.ts`'s seven `Checkbox` warnings print 0 times with the default reporter and 7 times with `--reporter=verbose`. That is why a default-reporter run on master looks clean and why *Verification* uses `--reporter=verbose`. The research record's "prints on every run" holds for any run that shows console output.

[^silent-late-fire]: `installTestDOM` creates a new `TestHandleTable` whose `_next` starts at 1 ([TestDOM.ts:143](packages/lib/tests/dom/TestDOM.ts#L143)). A later test that builds a similar table mints the same numbers, so a stale header's write resolves to that test's stub and changes it without an error. A throw happens only when the number is not minted yet (`TestHandleTable: handle N is not registered`) or when the timer lands between a `DOM.reset()` and the next install, which gives the production `DOM handle N is not registered` seen here. A late write that changes a later test's stub is the likely source of the one-off failure the phase 3 run reported. That failure did not recur here, so the link is unproven.

[^no-polyfill]: The error comes from an editor outliving its test, not from a missing environment feature the test needs. Neither case asserts anything about geometry. A polyfilled `Range.getClientRects` returning empty lists would let CodeMirror's late measure "succeed" on made-up zero geometry and hide the leaked editor. The polyfill would also need a new jsdom setup file: `tests/setup/node-setup.ts` deliberately does nothing under jsdom, because those suites exist to test the real production seam. This file is the only place a jsdom suite mounts a real CodeMirror view.

[^seam-timer]: The header's timer callback calls `store.setFilter`, whose `.then` fires `filterchange` and `datachange`. The header and the body both redraw from those, so the timer's callback does write to elements, one microtask later. `TableHeader.destructor` already clears the timer, so disposing a table was never the problem. The gap is `DOM.reset()`, the public test-support call ([dom-seams.md:27-35](packages/lib/docs/concepts/dom-seams.md#L27)) that promises to cancel such callbacks and cannot see this one. A consumer's own suite that types into a filter row and resets the DOM hits the same unhandled rejection this suite does.

[^both-fixes]: Either fix alone stops the observed error. The fake clock matches the file's other typing tests and keeps these four from depending on hook order at all. The seam timer makes `DOM.reset()` a real safety net for this file's future tests, the other table suites, and consumers' suites. They cover different failures and cost a few lines each, so both ship. After the seam timer lands, the four tests would also be safe without the fake clock, because the module-level `afterEach(() => DOM.reset())` at `:46` cancels the timer. But they would still arm a real 200 ms timer, which every other typing test in the file avoids.

[^complete-parse]: `LanguageState.init` runs `parseState.work(20, …)` and keeps a partial tree when time runs out (`node_modules/@codemirror/language/dist/index.js:540-545`). The 250-token document took 5–23 ms per test across 23 verbose runs, and one of 27 runs went past the budget and returned 90. `ensureSyntaxTree`'s timeout feeds `Date.now() + timeout`, so `Infinity` removes the limit. `state.update({})` then yields a state whose `syntaxTree` is the finished tree, because `LanguageState.apply` rebuilds when its context's tree has moved on. `forceParsing` does the same with `view.dispatch({})` (`:225-230`). Rejected alternatives: a smaller document (still time-dependent); `vi.useFakeTimers()` to freeze `Date` (relies on the same internal clock read, and freezing the clock gives no red run to prove the fix); and changing `collectSyntaxErrors` (its partial-tree behaviour is documented and correct for a live editor).

[^build-not-source]: The docs app is a consumer of the published library. CI runs `build:pages` (which runs `build:lib`) before the docs typecheck and tests, and `packages/qa` imports the build for the same reason. A source alias would compile library source through the docs app's own Vite pipeline, which differs from the library's build (`vite.lib.config.ts`, its store-worker chunking, `sideEffects`) and would make the docs tests stop checking what the site ships. It would also pull in the library's `~` path alias. In the main checkout the build alias resolves to the files the symlink reached before, so CI's output does not change.

[^shared-module]: The move adds no new pattern: `build/keepNames.ts` was extracted the same way when a second package needed the same Vite config piece (commit `ca740d6a`, "Dedupe the minifier keepNames guard into a shared module"). Importing `../qa/vite/plugins.js` from the docs config was rejected because it would make the docs app depend on the QA harness's internal file, and a QA-named plugin would report docs errors. Copying the ~100 lines of alias derivation was rejected as a second copy that could drift from the first.

[^fired-id]: `DOMSink.clearTimeout` ignores an id that has already fired or been cleared ([DOM.ts:859-863](packages/lib/src/typescript/lib/core/DOM.ts#L859)), so `applyPendingFilter` clearing the id of the timer that is calling it is harmless, exactly as with the global `clearTimeout` today. `AutoCompleteField` nulls its field inside the callback because its callback does not clear on entry; the header's does.
