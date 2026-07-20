# `Body.init` as the Canonical Mount Idiom — Implementation Plan

## Overview

`Body.init(options)` ([packages/lib/src/typescript/lib/core/Body.ts:44](packages/lib/src/typescript/lib/core/Body.ts#L44)) already exists, is tested ([packages/lib/tests/core/Body.test.ts:17](packages/lib/tests/core/Body.test.ts#L17)), and applies a `ComponentOptions` bag to the singleton via `Component.applyOptions` — dispatching `layoutManager` through `setLayoutManager` ([Component.ts:548](packages/lib/src/typescript/lib/core/Component.ts#L548)) and `components` through `addComponents` ([Component.ts:601](packages/lib/src/typescript/lib/core/Component.ts#L601)). Nothing in the codebase uses `Body.init` outside its own test: every example still writes `Body.getInstance()` followed by `setLayoutManager(...)` / `addComponent(...)`.

This plan makes `Body.init` the idiom every example teaches. It touches **13 mount sites** (10 published doc pages, 2 app entry points, 1 JSDoc example), adds a mount rule to the generated capability index, and documents the `init`-vs-`getInstance` division of labour on both the doc page and the `getInstance` JSDoc. It changes **no `Body` implementation and adds no API**.

Four `Body.getInstance` sites are deliberately **not** migrated; the per-site classification in [`## The mount-vs-accessor split`](#the-mount-vs-accessor-split) is the load-bearing part of this plan.[^blanket-replace]

Docs under `packages/lib/docs/` are the live VitePress site deployed to GitHub Pages — every page listed here is user-facing.

---

## Architecture Decisions

### Per-site manual migration, not an automated sweep

Each of the 13 sites is edited individually, exactly as spelled out in `## Ordered Implementation Steps`. **Do not write a `sed` sweep for this plan.**[^no-sed]

### `init` mounts; `getInstance` accesses

`init` is the *mount-in-one-call* entry point: it establishes the page's top-level layout and children. `getInstance` is the *singleton accessor*: it hands back the already-mounted body so a caller can read it, add a further child later, or assert identity. A site migrates only when it is doing the first thing.[^tie-breaker]

### `getInstance` gains a clarifying sentence, not a deprecation

`getInstance` gets no `@deprecated` tag. Its JSDoc gains one sentence pointing mount-shaped use at `init`.[^no-deprecation]

### `Body.ts`'s class-level example switches to `init`

The class docstring at [Body.ts:11-15](packages/lib/src/typescript/lib/core/Body.ts#L11) currently teaches `getInstance()` + `addComponent(...)` and must teach the canonical idiom instead. The `init` JSDoc at [Body.ts:32-43](packages/lib/src/typescript/lib/core/Body.ts#L32) needs no change.[^class-example]

### Self-references in `Body.ts` JSDoc stay in plain backticks

Write `` `Body.init` `` / `` `Body.getInstance` ``, never `{@link Body.init}`.[^self-ref-backticks]

### The mount rule lands in the llms manifest, not in `llms.txt`

The new convention goes in the `conventions` array in [`scripts/llms/manifest.data.mjs:126-133`](packages/lib/scripts/llms/manifest.data.mjs#L126), and [`packages/lib/llms.txt`](packages/lib/llms.txt) is then regenerated with `npm run docs:llms`. The `mentalModel` prose block is left alone.[^llms-generated]

---

## The mount-vs-accessor split

### Migrate to `Body.init` — 13 sites

| # | Site | Why it is a mount |
|---|---|---|
| 1 | [Body.ts:13](packages/lib/src/typescript/lib/core/Body.ts#L13) — class docstring example | Teaches the canonical way to put content on the page |
| 2 | [packages/lib/src/typescript/main.ts:40,45](packages/lib/src/typescript/main.ts#L40) | Demo app's sole top-level mount (`getInstance` + `setLayoutManager`) |
| 3 | [packages/docs/src/main.ts:8-9](packages/docs/src/main.ts#L8) | Docs app's sole top-level mount (`getInstance` + `addComponent`) |
| 4 | [docs/components/Body.md:15,18](packages/lib/docs/components/Body.md#L15) | The `Body` page's own Usage snippet |
| 5 | [docs/components/MenuBar.md:23](packages/lib/docs/components/MenuBar.md#L23) | Snippet's single top-level attach |
| 6 | [docs/components/Window.md:25](packages/lib/docs/components/Window.md#L25) | Snippet's single top-level attach |
| 7 | [docs/components/TabWindow.md:19](packages/lib/docs/components/TabWindow.md#L19) | Snippet's single top-level attach |
| 8 | [docs/guide/index.md:16,22-24](packages/lib/docs/guide/index.md#L16) | Getting Started "Bootstrap" — the page imports `Body` but mounts nothing[^guide-dead-import] |
| 9 | [docs/recipes/crud-table.md:47](packages/lib/docs/recipes/crud-table.md#L47) | Recipe's single top-level attach |
| 10 | [docs/recipes/custom-theme.md:47](packages/lib/docs/recipes/custom-theme.md#L47) | "Apply at startup" — the mount step |
| 11 | [docs/recipes/floating-window.md:57](packages/lib/docs/recipes/floating-window.md#L57) | Recipe's single top-level attach[^site-11] |
| 12 | [docs/recipes/keyboard-shortcuts.md:35](packages/lib/docs/recipes/keyboard-shortcuts.md#L35) | Recipe's single top-level attach |
| 13 | [docs/recipes/virtualized-list.md:28](packages/lib/docs/recipes/virtualized-list.md#L28) | Recipe's single top-level attach |

### Keep `Body.getInstance` — 4 sites

| # | Site | Why it stays | Edited? |
|---|---|---|---|
| A | [Body.ts:28-30](packages/lib/src/typescript/lib/core/Body.ts#L28) — `getInstance` JSDoc | It *is* the accessor's own documentation | Yes — one clarifying sentence |
| B | [docs/components/Body.md:24](packages/lib/docs/components/Body.md#L24) — "created automatically on first `Body.getInstance()`" | Prose about singleton lifetime, not a mount | Yes — reworded for accuracy (`init` also triggers creation) |
| C | [docs/reference/troubleshooting.md:34](packages/lib/docs/reference/troubleshooting.md#L34) — "reachable from `Body.getInstance()`" | Prose about tree reachability from the root | **No — leave byte-identical** |
| D | [packages/lib/tests/core/Body.test.ts:30](packages/lib/tests/core/Body.test.ts#L30) — `expect(body).toBe(Body.getInstance())` | The assertion is the singleton-identity coverage | **No — leave byte-identical** |

`plans/` and `plans/implemented/` matches are never rewritten, with the single exception of the `create-tsui-app` frontmatter in Step 15.[^plans-history]

---

## Ordered Implementation Steps

Paths below are repo-relative. Doc paths under `packages/lib/docs/`.

### Source (`Body.ts` JSDoc — no implementation change)

1. **`packages/lib/src/typescript/lib/core/Body.ts`** — replace the class-docstring body at lines 11-15:

   ```
    * Mount a top-level layout in one call:
    * ```
    * Body.init({ layoutManager: Fit(), components: [shell] });
    * ```
    *
    * Once mounted, reach the singleton again with `Body.getInstance()` — to add a
    * further child, read the layout manager, or attach a listener.
   ```

   Keep the first line (`A {@link Component} that wraps the page's \`<body>\` element.`) and the `@category Core` tag unchanged. Use plain backticks for the self-references, never `{@link}`.

2. **`packages/lib/src/typescript/lib/core/Body.ts`** — extend the `getInstance` JSDoc (lines 23-27) description to:

   ```
    * Returns the singleton Body instance — the accessor for reaching the body
    * *after* it exists: adding a further child, reading its layout manager, or
    * attaching a listener. To mount a top-level layout in one call, use
    * `Body.init` instead.
   ```

   Leave the `@returns` line and the method body untouched. **Do not add `@deprecated`.**

   *Checkpoint:* `git diff --stat packages/lib/src/typescript/lib/core/Body.ts` — comment lines only; no change inside any method body.

### App entry points

3. **`packages/lib/src/typescript/main.ts`** — delete line 40 (`let body = Body.getInstance();`) and its following blank line; replace line 45 (`body.setLayoutManager(layoutManager);`) with `Body.init({ layoutManager });`.

   `Body.init` stays where `setLayoutManager` was, i.e. *before* the `addLazyTab` block, and `layoutManager` must still be declared on the preceding line so the `addLazyTab` calls below can reach it.[^main-ordering] Keep `let layoutManager = new Tab();` exactly as it is. The `Body` import is still used.

4. **`packages/docs/src/main.ts`** — replace lines 8-9 with:

   ```typescript
   Body.init({ components: [new Header(`typescript-ui docs — ${moduleCount} modules, ${symbolCount} documented symbols`)] })
   ```

   Keep the three-line explanatory comment above it verbatim. Keep `new Header(...)` as-is — converting to the callable form is out of scope.

   *Checkpoint:* `npm run typecheck` passes.

### Doc pages — component reference

5. **`packages/lib/docs/components/Body.md`** — rewrite the Usage snippet (lines 9-20) to:

   ```typescript
   import { Body, ThemeManager, ClassicTheme } from '@jimka/typescript-ui/core';
   import { Window } from '@jimka/typescript-ui/overlay';

   ThemeManager.setTheme(ClassicTheme);

   const win = Window('Hello');

   Body.init({ components: [win] });
   win.show();
   ```

   `Window('Hello')` replaces the separate `setHeaderText` call.[^usage-restructure]

6. **`packages/lib/docs/components/Body.md`** — insert a new `## Mounting` section between the Usage and Notes sections. It contains, in order:

   - An `h2` heading: `## Mounting`
   - A paragraph: ``` `Body.init(options)` is the canonical way to mount a top-level layout — one call that applies a [`ComponentOptions`](/api/core/interfaces/ComponentOptions) bag to the singleton and returns it: ```
   - A `typescript` code block containing exactly: `Body.init({ layoutManager: Fit(), components: [appShell] });`
   - A paragraph: ``` Only the fields you supply are dispatched, so the body's viewport-size tracking and default theme survive. `components` **appends** — calling `init` twice adds both sets of children rather than replacing the first. ```
   - A paragraph: ``` `Body.getInstance()` is the accessor for everything after the mount: adding a further child, reading the layout manager, attaching a listener. Reach for `init` when you are putting the page's top-level content on screen, and `getInstance()` when you are working with a body that is already there. ```

7. **`packages/lib/docs/components/Body.md:24`** — reword the Notes bullet to: `- **Singleton** — created automatically on first access (\`Body.init()\` or \`Body.getInstance()\`). Do not \`Body()\` yourself.` Leave the other two Notes bullets unchanged.

8. **`packages/lib/docs/components/MenuBar.md:23`** — `Body.getInstance().addComponent(bar);` → `Body.init({ components: [bar] });`

9. **`packages/lib/docs/components/Window.md:25`** — `Body.getInstance().addComponent(win);` → `Body.init({ components: [win] });`

10. **`packages/lib/docs/components/TabWindow.md:19`** — `Body.getInstance().addComponent(win);` → `Body.init({ components: [win] });`

### Doc pages — guide & recipes

11. **`packages/lib/docs/guide/index.md`** — in the Bootstrap snippet (lines 15-24), insert the mount between the `Window` construction and `show()`:

    ```typescript
    const win = Window('Hello');

    Body.init({ components: [win] });
    win.show();
    ```

    The existing `Body` import on line 16 becomes used. Do **not** touch the unused `Button` import on line 19 or the prose paragraph on line 26.

12. **Recipes** — one-line substitutions, no surrounding prose changes:

    | File:line | From | To |
    |---|---|---|
    | `packages/lib/docs/recipes/crud-table.md:47` | `Body.getInstance().addComponent(panel);` | `Body.init({ components: [panel] });` |
    | `packages/lib/docs/recipes/custom-theme.md:47` | `Body.getInstance().addComponent(root);` | `Body.init({ components: [root] });` |
    | `packages/lib/docs/recipes/floating-window.md:57` | `Body.getInstance().addComponent(settingsWin);` | `Body.init({ components: [settingsWin] });` |
    | `packages/lib/docs/recipes/keyboard-shortcuts.md:35` | `Body.getInstance().addComponent(bar);` | `Body.init({ components: [bar] });` |
    | `packages/lib/docs/recipes/virtualized-list.md:28` | `Body.getInstance().addComponent(table);` | `Body.init({ components: [table] });` |

13. **Do not edit** `packages/lib/docs/reference/troubleshooting.md` or `packages/lib/tests/core/Body.test.ts`. They are sites C and D.

    *Checkpoint:* `grep -rn 'Body\.getInstance' packages/lib/docs packages/lib/src packages/docs/src packages/lib/tests` — expect **exactly two** matches: `troubleshooting.md:34` and `Body.test.ts:30`. Any third match is an unmigrated mount site.

### Generated capability index

14. **`packages/lib/scripts/llms/manifest.data.mjs`** — append one entry to the `conventions` array (after the existing callable + options-bag rule on line 128):

    ```javascript
    { rule: "Mount the top-level layout with `Body.init({ layoutManager, components })` — one call; use `Body.getInstance()` only to reach the body afterwards.", doc: "docs/components/Body.md" },
    ```

    Then regenerate the committed index: `npm run docs:llms`. Commit the resulting `packages/lib/llms.txt` diff (`packages/lib/docs/public/llms.txt` is gitignored and is not committed).

    *Checkpoint:* `grep -n 'Body.init' packages/lib/llms.txt` — expect one match under `## Conventions`.

### Cross-plan bookkeeping

15. **`plans/create-tsui-app.md`** — **already done; verify only.** Its frontmatter should already read:

    ```yaml
    depends-on: [workspace-restructure, publish-0-1-0, body-init-idiom]
    ```

    Confirm the line above is present and change **nothing else** in that file. If it is already correct, this step is a no-op — do not "fix" it into something else.[^step-15-noop]

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Body.ts` (JSDoc only) |
| Modify | `packages/lib/src/typescript/main.ts` |
| Modify | `packages/docs/src/main.ts` |
| Modify | `packages/lib/docs/components/Body.md` |
| Modify | `packages/lib/docs/components/MenuBar.md` |
| Modify | `packages/lib/docs/components/Window.md` |
| Modify | `packages/lib/docs/components/TabWindow.md` |
| Modify | `packages/lib/docs/guide/index.md` |
| Modify | `packages/lib/docs/recipes/crud-table.md` |
| Modify | `packages/lib/docs/recipes/custom-theme.md` |
| Modify | `packages/lib/docs/recipes/floating-window.md` |
| Modify | `packages/lib/docs/recipes/keyboard-shortcuts.md` |
| Modify | `packages/lib/docs/recipes/virtualized-list.md` |
| Modify | `packages/lib/scripts/llms/manifest.data.mjs` |
| Modify | `packages/lib/llms.txt` (regenerated, not hand-edited) |
| Modify | `plans/create-tsui-app.md` (frontmatter line only) |

---

## Expected Behaviour

No runtime logic changes — `Body.init` already behaves as documented and is pinned by [`tests/core/Body.test.ts`](packages/lib/tests/core/Body.test.ts). The behaviours this plan must preserve:

**Already unit-tested — must stay green, no new tests needed:**

- `Body.init({ layoutManager, components })` returns the same instance `Body.getInstance()` returns, with the layout manager set and the child present ([Body.test.ts:20-33](packages/lib/tests/core/Body.test.ts#L20)).

**Manual verification (no test harness covers app bootstrap):**

- **Demo app** (`npm run dev`): renders the full tab strip with every demo tab present and switchable, identical to before Step 3. A blank page or a missing tab strip means the `Body.init` call landed after the `addLazyTab` block.
- **Docs app** (`npm run build:docs`, then serve `packages/docs/dist`): renders the single `Header` line with the module/symbol counts interpolated, identical to before Step 4.
- **Docs site** (`npm run docs:build`): `/components/Body` shows the new Usage snippet and the `## Mounting` section; the generated `/api/core/classes/Body` page shows the `init`-based class example and the extended `getInstance` description.

---

## Verification

Run in order from the repo root:

1. `npm run typecheck` — passes (covers both `main.ts` edits).
2. `npm run test` — passes; `Body.test.ts` unchanged and green.
3. `npm run lint` — passes.
4. `grep -rn 'Body\.getInstance' packages/lib/docs packages/lib/src packages/docs/src packages/lib/tests` — **exactly two** matches (`docs/reference/troubleshooting.md:34`, `tests/core/Body.test.ts:30`).
5. `grep -rn 'getInstance()\.\(addComponent\|setLayoutManager\)' packages/lib/docs packages/lib/src packages/docs/src` — **zero** matches. This is the mount-site check.[^why-not-count-init]
6. `npm run docs:build` — **0 errors, 0 link warnings** (typedoc's "unsupported TypeScript version" notice is the only acceptable warning). This is the gate for the JSDoc edits in Steps 1-2.
7. `npm run docs:llms` — re-run; `git diff packages/lib/llms.txt` must be empty on the second run (idempotent).
8. Manual smoke tests per `## Expected Behaviour`.

---

## Potential Challenges

- **`docs/guide/index.md` is a scope expansion.** It is included deliberately.[^guide-dead-import] The edit is additive (one statement) and touches no prose.
- **`Body.md`'s Usage snippet is restructured, not substituted.**[^usage-restructure] The change is confined to one snippet on the page this plan is about.
- **`llms.txt` is generated.** Hand-editing it will be overwritten by the next `docs:llms` run. Step 14 edits the manifest and regenerates; verification step 7 proves idempotence.
- **`main.ts` step ordering.**[^main-ordering] Step 3 states the position explicitly.
- **Unrelated dead code noticed, not touched:** `packages/lib/docs/guide/index.md:19` imports `Button` and never uses it. Left alone per the project's surgical-changes rule.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/Body.ts`](packages/lib/src/typescript/lib/core/Body.ts) — `getInstance` (28-30), `init` (44-48), class docstring (8-18). Read before Steps 1-2.
- [`packages/lib/tests/core/Body.test.ts`](packages/lib/tests/core/Body.test.ts) — what `init` is already pinned to. Do not edit.
- [`packages/lib/src/typescript/lib/core/Component.ts:548,601`](packages/lib/src/typescript/lib/core/Component.ts#L548) — how `applyOptions` dispatches `layoutManager` and `components`; confirms `components` **appends** via `addComponents`.
- [`plans/implemented/callable-docs-sweep.md`](plans/implemented/callable-docs-sweep.md) — the precedent for a docs-wide idiom migration.
- [`.claude/skills/_shared/docs-conventions.md`](.claude/skills/_shared/docs-conventions.md) — JSDoc link forms (self-reference → plain backticks) and the `docs:build` zero-warning gate.
- [`packages/lib/scripts/llms/manifest.data.mjs:126-133`](packages/lib/scripts/llms/manifest.data.mjs#L126) — the `conventions` array Step 14 extends.

---

## Non-Goals

- **No change to `Body`'s implementation or API.** `init` and `getInstance` keep their current signatures and bodies; only JSDoc moves. No `@deprecated` on `getInstance`.
- **No scaffolder work.** `packages/create-app` belongs to [plans/create-tsui-app.md](plans/create-tsui-app.md); Step 15 is a verification, not an edit.
- **No migration of accessor sites.** `docs/reference/troubleshooting.md:34` and `tests/core/Body.test.ts:30` stay byte-identical — see [`## The mount-vs-accessor split`](#the-mount-vs-accessor-split).
- **No rewriting of `plans/` history.** Matches in `plans/implemented/*.md` are records of shipped work.
- **No callable-form conversion.** `new Header(...)` in `packages/docs/src/main.ts` and `new Tab()` in `packages/lib/src/typescript/main.ts` stay as they are; that is a separate concern.
- **No `mentalModel` prose change in the llms manifest.**

---

## Addendum: Classifying mount sites versus accessor sites

`Body.getInstance()` means "mount this" at some call sites and "reach the singleton" at others. Only the first kind becomes `Body.init`. The tie-breaker applied to every site: **is this call the snippet's single act of putting the page's top-level content on screen?** If yes → `init`. If the call reaches for a body that is conceptually already mounted — prose about tree reachability, a test identity assertion — → `getInstance`.

The four kept sites, and why each fails the tie-breaker:

- **A — `getInstance`'s own JSDoc.** The method is the accessor; its documentation is where the accessor role is defined. It gains one sentence pointing mount-shaped use at `init`, and nothing else.
- **B — `docs/components/Body.md:24`.** The Notes bullet describes when the singleton comes into existence, not how a page is mounted. It is reworded only because `Body.init()` also triggers creation, so "on first `Body.getInstance()`" is now inaccurate.
- **C — `docs/reference/troubleshooting.md:34`.** "Reachable from `Body.getInstance()`" is prose about walking the component tree from its root. The reader is diagnosing a page that is already mounted.
- **D — `tests/core/Body.test.ts:30`.** `expect(body).toBe(Body.getInstance())` asserts that `init` returns the same singleton `getInstance` hands out. Rewriting that call to `Body.init` would make the assertion compare a value with itself and delete the singleton-identity coverage.

Site 11 (`docs/recipes/floating-window.md:57`) was the ambiguous case on the migrate side. The recipe attaches `settingsWin` in a *later* section, after the window is fully built, and immediately hides it (`setVisible(false)`); it also declares an `openBtn` it never attaches anywhere. That shape reads more incremental than the other recipes. **Decision: migrate.** The call is still the recipe's one and only act of putting content on the page, and the incremental look comes from the unattached `openBtn` — a pre-existing looseness in the recipe, not an accessor use. Leaving it as `getInstance` would make the recipe the lone published counter-example to the idiom.

---

## Implementation Notes

Four things the plan did not anticipate. None changed the design; all change how the work is *checked*.

**1. Verification step 4's count is wrong — step 5 is the real check.** The plan expects `grep -rn 'Body\.getInstance'` to return "exactly two" matches afterwards. It returns **five**, correctly: Steps 1, 6, and 7 each *write a new* `Body.getInstance()` reference — the class docstring's "reach the singleton again" line, the `## Mounting` section's accessor paragraph, and the reworded Notes bullet. Footnote `[^why-not-count-init]` anticipates this hazard for counting `Body.init` but never applies the same reasoning to counting `Body.getInstance`. Verification step 5 (`getInstance()\.(addComponent|setLayoutManager)` → zero) is what actually proves the migration, and it passes.

**2. The verification greps need generated directories excluded.** `packages/lib/docs/api/` (TypeDoc output) and `packages/lib/docs/.vitepress/dist/` are gitignored build artefacts, but they exist on any machine where `docs:build` has run and they contain `Body.getInstance` matches. Without `--exclude-dir=api --exclude-dir=dist --exclude-dir=.vitepress` the checks report false positives.

**3. Step 14 needs `npm run docs:api` first.** `docs:llms` reads `docs/api/typedoc-model.json`, which does not exist in a fresh worktree; it fails with "TypeDoc model not found".

**4. Verification steps 2 and 3 fail on `master` already — not caused by this plan.**

| Check | State on `master` |
|---|---|
| `npm run test` | **red** — `typecheck:test` fails: `tests/component/container/leaves.smoke.test.ts:127,128`, TS2554 "Expected 3-5 arguments, but got 2" |
| `npm run lint` | **red** — 5 errors: `component/editor/CodeEditor.ts:492-493` (4× `local/no-raw-dom`), `component/table/cell/renderer/Link.ts:57` (`local/forward-super-options`) |

Both were confirmed identical in the untouched main tree, are in files this plan does not touch, and were left alone per the surgical-changes rule. Because `typecheck:test` gates vitest, the suite was run directly to confirm it is healthy: **211 files, 2617 tests, all passing**, `Body.test.ts` included.

**Verified green:** `typecheck`; vitest (2617 tests); `docs:build` (exit 0); `docs:llms` idempotent on re-run; `build:docs` (docs app, 728ms). The generated `/api/core/classes/Body` page renders the `init`-based example, confirming the JSDoc edit propagated through TypeDoc. Note `ignoreDeadLinks: true` means `docs:build` cannot catch a dead link, so the one link this work adds — `/api/core/interfaces/ComponentOptions` — was confirmed to resolve in both the source tree and the built HTML.

**Still outstanding:** the demo-app render smoke test (`npm run dev` — full tab strip present and switchable). Step 3's ordering was verified statically: `Body.init({ layoutManager })` sits before the `addLazyTab` block with `layoutManager` declared immediately above it.

---

## Notes

[^blanket-replace]: A find-and-replace of `Body.getInstance` → `Body.init` across the repo would rewrite `tests/core/Body.test.ts:30`, whose `expect(body).toBe(Body.getInstance())` exists to assert that `init` and `getInstance` return the same singleton, and would also corrupt prose that talks about reaching an already-mounted body. See `## Addendum: Classifying mount sites versus accessor sites` for the per-site reasoning.

[^no-sed]: The precedent for a repo-wide doc-idiom migration is [`plans/implemented/callable-docs-sweep.md`](plans/implemented/callable-docs-sweep.md), which converted `new X(...)` → `X(...)` across ~50 files with a `sed` driver. That mechanism worked there because the substitution was context-free: `new Panel(` is always `Panel(`. Even so, that plan paired the sweep with an allowlist, a denylist, and a manual Pass 2. Here the substitution is not context-free — `Body.getInstance()` is a mount at some sites and an accessor at others — so the precedent's denylist discipline points at the opposite mechanism. Thirteen sites is small enough to edit individually.

[^tie-breaker]: The tie-breaker question applied to every call site, and the reasoning for each of the four sites that keep `getInstance`, are in `## Addendum: Classifying mount sites versus accessor sites`.

[^no-deprecation]: `getInstance` remains the accessor half of a two-method surface, so a deprecation would be wrong on the merits and would surface as noise on every legitimate remaining call site.

[^class-example]: The class docstring is the highest-authority example in the codebase — it renders on `/api/core/classes/Body`. The `init` JSDoc already carries the right framing.

[^self-ref-backticks]: Per the project's documentation conventions (`.claude/skills/_shared/docs-conventions.md`, *JSDoc cross-bucket references*), a class's JSDoc referencing its own members uses plain backticks rather than `{@link}`. Following that rule keeps `npm run docs:build` at zero link warnings.

[^llms-generated]: `packages/lib/llms.txt` is generated (`npm run docs:llms` → `scripts/llms/generate.mjs`) and carries a "do not edit by hand" banner on line 1, so the rule must be added at its source. The mount idiom is a convention, which puts it in the `conventions` array directly alongside the existing "Construct with the callable + options-bag idiom" rule — its nearest structural sibling. The `mentalModel` block describes *construction*; mounting is a separate concern the conventions list already models.

[^guide-dead-import]: `docs/guide/index.md` was not in the original site list because it imports `Body` without calling it — a dead import on the Getting Started page. Mounting `win` there fixes the dead import and puts the canonical idiom on the first page a new user reads.

[^site-11]: `floating-window.md` was the ambiguous case; the reasoning for migrating it is in `## Addendum: Classifying mount sites versus accessor sites`.

[^plans-history]: Files under `plans/` and `plans/implemented/` are historical records of shipped or pending work. Several `Body.init` matches in them are the unrelated table `Body.init` method in `component/table/Body.ts` — do not confuse the two symbols.

[^main-ordering]: Moving `Body.init({ layoutManager })` below the `addLazyTab` block would still work, but it changes when the first layout pass runs.

[^usage-restructure]: Folding `setHeaderText('Hello')` into `Window('Hello')` is a second change riding along with the migration. `Window`'s positional title argument is documented at [docs/components/Window.md:31](packages/lib/docs/components/Window.md#L31), so the snippet matches that page's own documented form.

[^step-15-noop]: `plans/create-tsui-app.md` was updated ahead of this plan during its own audit: it already writes `Body.init` throughout (its starter snippet and Architecture Decision) and already declares the `depends-on` line.

[^why-not-count-init]: Counting `Body.init` occurrences would not work as a check, because the new `## Mounting` section in `docs/components/Body.md` legitimately adds several.
