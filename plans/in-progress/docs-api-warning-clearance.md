---
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/tsconfig.json
  - CODE_CONVENTIONS.md
  - plans/research/render-review-2026-09-15/00-post-campaign-agenda.md
---

# Docs API Warning Clearance — Implementation Plan

## Overview

Two long-parked toolchain defects, each a check that does not measure what it
claims to. They are independent work and never share a commit.

**(a) `npm run docs:api` emits 14 warnings.** Every one is a `{@link}` in a
*public* JSDoc comment pointing at a symbol TypeDoc excludes from the docs, so
the generated page renders the symbol's name as dead plain text. Because the
bar was unreachable, plans drifted to writing "no new warnings" into their
verification sections — six pending plans currently say some variant of
it.[^drifted-bar] Clearing all 14 makes zero the real bar, and the standing
rule moves into [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) so no future plan
restates it.

**(b) `tsc -p packages/lib/tsconfig.json` reports 37 errors** — not the 30 the
2026-09-20 analysis recorded; the count grew with the test suite.[^count-drift]
[packages/lib/tsconfig.json](packages/lib/tsconfig.json) has no `include`, so
the bare command compiles the test tree and six non-library files, measuring a
program no npm script ever builds. Adding
`"include": ["src/typescript/lib/**/*"]` clears all 37 and leaves both derived
configs untouched.

Neither half changes runtime behaviour. The work is 14 doc-comment edits in
four source files, one line of `tsconfig.json`, one conventions section, and
the agenda bookkeeping.

---

## Architecture Decisions

### Describe internal mechanics in prose, never `{@link}` them

Twelve of the 14 warnings are fixed by deleting the `{@link}` and keeping the
sentence that already explains the behaviour. This is the rule
[CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) already states, and
[`MarkdownEditor.toggleUnderline`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1450)
is the in-file precedent: it documents the identical caret-expansion behaviour
as its four warning-emitting siblings, in the same words, with no
link.[^prose-precedent]

### A cross-module member link needs the `subpath!` qualifier

`{@link Component.replaceComponent}` in
[packages/lib/src/typescript/lib/validation/FieldDecorator.ts:12](packages/lib/src/typescript/lib/validation/FieldDecorator.ts#L12)
warns even though `Component.replaceComponent` *is* documented: an unqualified
`{@link Class.member}` resolves only from inside the class's own TypeDoc
module. The fix is the module-qualified form with a display alias, which the
library already uses twice.[^cross-module]

| `{@link …}` written in `validation/FieldDecorator.ts` | Rendered result |
|---|---|
| `Component.replaceComponent` | `Component.replaceComponent` — plain text, 1 warning |
| `Component!Component.replaceComponent` | links to the class page, **no member anchor** |
| `core!Component.replaceComponent` | `[core!Component.replaceComponent](…/Component.md#replacecomponent)` — right target, raw link text |
| `core!Component.replaceComponent \| Component.replaceComponent` | `[Component.replaceComponent](…/Component.md#replacecomponent)` — **use this** |

### None of the 14 is a TypeDoc limitation

All 14 are genuine doc-comment defects, and all 14 are fixable in source. The
honest bar after this plan is therefore **zero**, not "zero except N". Thirteen
name a symbol the reader cannot look up; one (`MarkdownViewer.getScrollTop`) is
additionally malformed — its `{@link}` is split across a line break, so it has
never rendered as a link at all.[^malformed-link]

### Suppressing a warning is not fixing it

No fix may add an `externalSymbolLinkMappings` entry, add `@internal`, or make
a member `private` — each would clear a warning while leaving the reader
exactly where they were. `## Verification` pins this two ways: the
`typedoc.json` mapping block must be byte-identical to `master`'s, and the
rendered `docs/api` pages must show the replacement prose (or, for
`FieldDecorator`, a live link), not merely the absence of a symbol name.

### The three pre-existing `externalSymbolLinkMappings` entries stay

[packages/lib/typedoc.json:34](packages/lib/typedoc.json#L34) maps
`CellTextResolver`, `ColumnWindowSlidePlan` and `RetargetedCell` to `"#"`.
Removing all three raises the count from 14 to 17, so the pre-fix truth is 17
warnings, of which 3 are hidden by config. Those 3 are a different defect — a
public signature exposing a type that is never exported — and fixing them means
widening the public API surface, which ripples into the llms.txt coverage
guard. They stay out of scope and get their own agenda entry.[^suppressed-three]

### Scope the bare `tsc` program with `include`, mirroring `tsconfig.lib.json`

[packages/lib/tsconfig.lib.json:17](packages/lib/tsconfig.lib.json#L17)
already carries exactly `"include": ["src/typescript/lib/**/*"]` and compiles
clean; putting the same line in the base config gives the bare command the same
program. `include` is not inherited once a child declares its own, so
`tsconfig.lib.json` and `tsconfig.test.json` are unaffected.[^include-evidence]

### Two functionalities, four commits

(a) and (b) are independent, so they never share a commit. Per the commit
skill's buckets, the conventions doc is *tooling*, not part of (a)'s code
commit:

| # | Bucket | Contents |
|---|---|---|
| 1 | Code | the 14 doc-comment edits, four source files |
| 2 | Tooling | `CODE_CONVENTIONS.md` — the standing zero bar and the link rules |
| 3 | Tooling | `packages/lib/tsconfig.json` — the `include` |
| 4 | Bookkeeping | the agenda entries, plus this plan's `## Implementation Notes` |

---

## Warning Inventory

All 14, with what each was actually telling the reader and the check that tells
a fix from a suppression. "Rendered page" means the file under
`packages/lib/docs/api/` after `npm run docs:api`.

| # | Site | Link | What it was telling us | Fix |
|---|---|---|---|---|
| 1 | [SpatialNavigation.ts:737](packages/lib/src/typescript/lib/core/SpatialNavigation.ts#L737) | `outermostTargets` | the namespace doc points at a module-private filter | drop `— see {@link outermostTargets} —` |
| 2 | [SpatialNavigation.ts:745](packages/lib/src/typescript/lib/core/SpatialNavigation.ts#L745) | `leafFocusables` | same, module-private | drop `({@link leafFocusables})` |
| 3 | [SpatialNavigation.ts:747](packages/lib/src/typescript/lib/core/SpatialNavigation.ts#L747) | `ancestorGeometry` | same, module-private | drop `({@link ancestorGeometry})` |
| 4 | [SpatialNavigation.ts:104](packages/lib/src/typescript/lib/core/SpatialNavigation.ts#L104) | `PRIMARY_GAP_EPSILON` | the eligibility rule is stated as an unreadable constant name | state the value: `1px` |
| 5 | [FieldDecorator.ts:12](packages/lib/src/typescript/lib/validation/FieldDecorator.ts#L12) | `Component.replaceComponent` | a documented public method renders as dead text across a module boundary | module-qualify with a display alias |
| 6 | [MarkdownViewer.ts:112](packages/lib/src/typescript/lib/component/display/MarkdownViewer.ts#L112) | `MarkdownContentPane` | the class doc names a file-local class | describe it: `plain scrolling Panel` |
| 7 | [MarkdownViewer.ts:453](packages/lib/src/typescript/lib/component/display/MarkdownViewer.ts#L453) | `MarkdownContentPane` | link split across a newline — never resolved at all | same prose, on one line |
| 8 | [MarkdownViewer.ts:465](packages/lib/src/typescript/lib/component/display/MarkdownViewer.ts#L465) | `MarkdownContentPane` | file-local class again | same prose |
| 9 | [MarkdownEditor.ts:1381](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1381) | `$selectEnclosingWordIfCollapsed` | public method doc points at a test-only export | drop the parenthetical |
| 10 | [MarkdownEditor.ts:1398](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1398) | `$selectEnclosingWordIfCollapsed` | same | drop the parenthetical |
| 11 | [MarkdownEditor.ts:1415](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1415) | `$selectEnclosingWordIfCollapsed` | same | drop the parenthetical |
| 12 | [MarkdownEditor.ts:1430](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1430) | `$selectEnclosingWordIfCollapsed` | same | drop the parenthetical |
| 13 | [MarkdownEditor.ts:1652](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1652) | `$selectEnclosingWordIfCollapsed` | same, in `copy()` | drop the parenthetical |
| 14 | [MarkdownEditor.ts:1655](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1655) | `$classifyContextMenuTarget` | same, in `copy()` | drop the parenthetical |

Nothing here is deletable dead code: every referenced symbol has live callers,
so the pre-1.0 "delete unused public API" rule does not apply to any of the
14.[^all-have-callers]

---

## Ordered Implementation Steps

Run `npm install` first — a fresh worktree has no `node_modules`. Record the
baseline before touching anything: `npm run docs:api` must print
`Found 0 errors and 14 warnings`.

### Commit 1 — the 14 doc-comment fixes

1. **`packages/lib/src/typescript/lib/core/SpatialNavigation.ts:104`** — in
   `rankInDirection`'s JSDoc, replace
   `{@link PRIMARY_GAP_EPSILON} negative` with `1px negative`. Leave the
   `PRIMARY_GAP_EPSILON` constant and its own comment at line 37 alone.

2. **`SpatialNavigation.ts:737`** — in the `SpatialNavigation` namespace's
   JSDoc, replace

   ```
    * on the outer one first — see {@link outermostTargets} — which then hands
   ```

   with

   ```
    * on the outer one first, which then hands
   ```

3. **`SpatialNavigation.ts:745–747`** — in the same block, replace

   ```
    * descendant is also a candidate ({@link leafFocusables}), and never on a
    * candidate a collapsed ancestor is currently clipping to nothing
    * ({@link ancestorGeometry}). Opt-in — call {@link enable} to start;
   ```

   with

   ```
    * descendant is also a candidate, and never on a candidate a collapsed
    * ancestor is currently clipping to nothing. Opt-in — call
    * {@link enable} to start;
   ```

   `{@link enable}` and `{@link claimsKey}` resolve (same namespace) — keep
   both. So does `{@link Component.setNavigationTarget}` at line 733: it is in
   the `core` module, same as `Component`.

   Checkpoint: `grep -c '{@link outermostTargets}\|{@link leafFocusables}\|{@link ancestorGeometry}' packages/lib/src/typescript/lib/core/SpatialNavigation.ts`
   — expect `4`, down from `7`. The survivors are lines 482 (`effectiveRect`)
   and 495, 500, 502 (`collectCandidates`), both module-private functions,
   where links are allowed. Do not touch them, and do not touch
   `collectCandidates`'s own newline-split `({@link\n * ancestorGeometry})` at
   lines 498–499 — it never rendered anywhere, so it never warned.

4. **`packages/lib/src/typescript/lib/validation/FieldDecorator.ts:12`** —
   replace `{@link Component.replaceComponent}` with
   `{@link core!Component.replaceComponent | Component.replaceComponent}`.
   Keep the rest of the sentence.

5. **`packages/lib/src/typescript/lib/component/display/MarkdownViewer.ts:111–112`** —
   in the `MarkdownViewer` class JSDoc, replace

   ```
    * The viewer itself never scrolls: `_markdown` renders into an internal
    * {@link MarkdownContentPane} (a plain scrolling `Panel`, stretched to fill)
   ```

   with

   ```
    * The viewer itself never scrolls: `_markdown` renders into an internal,
    * plain scrolling `Panel`, stretched to fill,
   ```

6. **`MarkdownViewer.ts:453–455`** — in `getScrollTop`'s JSDoc, replace

   ```
    * The prose's scroll offset — delegates to the internal {@link
    * MarkdownContentPane} that actually scrolls; this outer viewer never does
    * (see the class doc for why).
   ```

   with

   ```
    * The prose's scroll offset — delegates to the internal `Panel` that
    * actually scrolls; this outer viewer never does (see the class doc for
    * why).
   ```

7. **`MarkdownViewer.ts:464–465`** — in `setScrollTop`'s JSDoc, replace
   `{@link MarkdownContentPane}` with `` `Panel` ``. Keep
   `{@link getScrollTop}` — it resolves and renders as a link.

   Checkpoint: `grep -c MarkdownContentPane packages/lib/src/typescript/lib/component/display/MarkdownViewer.ts`
   — expect `3`, down from `6`. The survivors are the class declaration (line
   91), the field type (line 122) and the construction (line 163) — all code,
   no JSDoc.

8. **`packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts:1380–1383`** —
   `toggleBold`: replace

   ```
    * Toggles bold on the current selection, first expanding a collapsed
    * caret to its enclosing word (see {@link $selectEnclosingWordIfCollapsed})
    * so the toggle has more than an empty span to act on. No-op (without
    * throwing) when there is no range selection.
   ```

   with

   ```
    * Toggles bold on the current selection, first expanding a collapsed
    * caret to its enclosing word so the toggle has more than an empty span
    * to act on. No-op (without throwing) when there is no range selection.
   ```

9. **`MarkdownEditor.ts:1397–1399`** — `toggleItalic`: replace

   ```
    * Toggles italic on the current selection, first expanding a collapsed
    * caret to its enclosing word (see {@link $selectEnclosingWordIfCollapsed}).
    * No-op without a range selection.
   ```

   with

   ```
    * Toggles italic on the current selection, first expanding a collapsed
    * caret to its enclosing word. No-op without a range selection.
   ```

10. **`MarkdownEditor.ts:1413–1415`** — `toggleInlineCode`: replace

    ```
     * Toggles inline code on the current selection, first expanding a
     * collapsed caret to its enclosing word or run (see
     * {@link $selectEnclosingWordIfCollapsed}). No-op without a range selection.
    ```

    with

    ```
     * Toggles inline code on the current selection, first expanding a
     * collapsed caret to its enclosing word or run. No-op without a range
     * selection.
    ```

11. **`MarkdownEditor.ts:1429–1431`** — `toggleStrikethrough`: replace

    ```
     * Toggles strikethrough on the current selection, first expanding a
     * collapsed caret to its enclosing word (see {@link $selectEnclosingWordIfCollapsed}).
     * No-op without a range selection.
    ```

    with

    ```
     * Toggles strikethrough on the current selection, first expanding a
     * collapsed caret to its enclosing word. No-op without a range selection.
    ```

    After this step `toggleBold`, `toggleItalic`, `toggleInlineCode`,
    `toggleStrikethrough` and the existing `toggleUnderline` (line 1450) all
    document the same behaviour the same way.

12. **`MarkdownEditor.ts:1650–1657`** — `copy()`: replace

    ```
     * Writes the current selection's text to the system clipboard, first
     * expanding a collapsed caret to its enclosing word or run (see
     * {@link $selectEnclosingWordIfCollapsed}) so Copy has something to act
     * on — matching the right-click menu's own Cut/Copy-enabled state, which
     * reflects that same hypothetical expansion without performing it (see
     * {@link $classifyContextMenuTarget}). No-op (without throwing, and
     * without writing) when there is no range selection, or the selection is
     * collapsed with nothing to expand into.
    ```

    with

    ```
     * Writes the current selection's text to the system clipboard, first
     * expanding a collapsed caret to its enclosing word or run so Copy has
     * something to act on — matching the right-click menu's own
     * Cut/Copy-enabled state, which reflects that same hypothetical expansion
     * without performing it. No-op (without throwing, and without writing)
     * when there is no range selection, or the selection is collapsed with
     * nothing to expand into.
    ```

    Checkpoint:
    `grep -c '{@link \$selectEnclosingWordIfCollapsed}\|{@link \$classifyContextMenuTarget}' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`
    — expect `13`, down from `19`. Every survivor is inside the JSDoc of a
    module-private member or of the two `$`-functions themselves, where links
    are allowed.[^surviving-links] Do not touch them, and do not touch
    `setLink`'s backticked prose mention at line 1558.

13. Run `npm run docs:api`. Expect `Found 0 errors and 0 warnings`.

14. Run `npm run lint` (green on `master`) and `npm test`. Commit as the code
    commit.

### Commit 2 — record the standing bar

15. **`CODE_CONVENTIONS.md`**, section *Don't `{@link}` internal symbols from
    public JSDoc*. Replace its closing line —

    ```
    Run `npm run docs:api` after touching public JSDoc — it must finish with zero warnings.
    ```

    — with three paragraphs:

    - **The standing bar.** `npm run docs:api` finishes with **zero**
      warnings, on every branch. As of `docs-api-warning-clearance` that is
      the measured state of `master`, so any warning is a regression
      introduced by the branch that shows it. An implementation plan must not
      restate this bar and must never write a weaker one — "no new warnings"
      and "no warnings against the base branch" are both dead phrasings.
    - **Cross-module member links need the module qualifier.** Reproduce the
      four-row table from `## Architecture Decisions` above, verbatim.
    - **Never silence a warning.** Adding an `externalSymbolLinkMappings`
      entry, an `@internal` tag, or a `private` modifier to clear a docs
      warning is prohibited: it removes the message, not the dead reference
      the reader lands on. State that `typedoc.json`'s three existing
      `"#"` mappings predate this rule, hide three *type-reference* warnings
      of a different kind, and are tracked on the post-campaign agenda.

    Commit as a tooling commit.

### Commit 3 — scope the bare `tsc` program

16. **`packages/lib/tsconfig.json`** — after the closing brace of
    `compilerOptions`, add a sibling key:

    ```json
        "include": ["src/typescript/lib/**/*"]
    ```

    Nothing inside `compilerOptions` changes. In particular do **not** add
    `"types": []`, which the 2026-09-20 note floated as an
    alternative.[^no-types-flag]

17. Verify, in this order:

    | Check | Expected |
    |---|---|
    | `npx tsc -p packages/lib/tsconfig.json --noEmit` | exit 0, no output |
    | `npx tsc -p packages/lib/tsconfig.json --noEmit --listFiles \| grep -c '/src/typescript/lib/'` | `3241` |
    | `npx tsc -p packages/lib/tsconfig.json --noEmit --listFiles \| grep -c '@types/node'` | `0` (was `82`) |
    | `npm run typecheck` | exit 0 |
    | `npm run typecheck:test` | exit 0 |
    | `npm run build:lib` | succeeds |

18. **Mutation proof.** Append `const __probe: number = 'x';` to
    `packages/lib/src/typescript/lib/core/BaseObject.ts`, re-run
    `npx tsc -p packages/lib/tsconfig.json --noEmit`, and confirm it reports
    `BaseObject.ts(…): error TS2322: Type 'string' is not assignable to type
    'number'.` (It also reports `TS6133` for the unused `__probe`; both are
    expected.) Then revert the probe and confirm
    `git diff --exit-code packages/lib/src/typescript/lib/core/BaseObject.ts`
    is clean. An `include` matching nothing would exit 0 in step 17 too; this
    is the step that rules it out.

    Never run `tsc -p packages/lib/tsconfig.json` without `--noEmit`: the
    config emits, and it will scatter ~3,800 `.js` files next to their `.ts`
    sources.

19. Commit as a tooling commit.

### Commit 4 — bookkeeping

20. **`plans/research/render-review-2026-09-15/00-post-campaign-agenda.md`**,
    section `## Open, not yet placed` (starts at line 177). Make three edits,
    each following the file's existing strike-through-plus-**answered**
    convention:

    1. The `tsc` bullet (lines 179–186) keeps its strike-through; append one
       sentence saying it was cleared on 2026-09-29 by
       `docs-api-warning-clearance` with an `include` scoping the program to
       the library sources, and that the count had grown from 30 to 37 by
       then.
    2. The `docs:api` bullet (lines 187–188) gets its text struck through and
       an **answered 2026-09-29** note: all 14 cleared by
       `docs-api-warning-clearance`; zero is now the standing bar, recorded in
       `CODE_CONVENTIONS.md`.
    3. Add one new bullet for the three suppressed type-reference warnings.
       It must name all three symbols and where each is referenced from —
       `CellTextResolver` from `buildColumnFilter`'s `display` parameter,
       `ColumnWindowSlidePlan` from `Row.setColumnWindow`'s `plan`,
       `RetargetedCell` from `Row.getRetargetedCells`'s return type — say that
       all three are exported from their own module but not from
       `component/table/index.ts`, that deleting the three `typedoc.json`
       mappings takes `docs:api` from 0 to 3 warnings, and that exporting them
       would make `CellTextResolver` a concrete public class
       `scripts/llms/check-coverage.mjs` then requires be catalogued or
       excluded — so it needs its own plan.

    Touch no other bullet, and no other file under `plans/`.

---

## Files to Create / Modify / Delete

| Action | File | Commit |
|---|---|---|
| Modify | `packages/lib/src/typescript/lib/core/SpatialNavigation.ts` | 1 |
| Modify | `packages/lib/src/typescript/lib/validation/FieldDecorator.ts` | 1 |
| Modify | `packages/lib/src/typescript/lib/component/display/MarkdownViewer.ts` | 1 |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` | 1 |
| Modify | `CODE_CONVENTIONS.md` | 2 |
| Modify | `packages/lib/tsconfig.json` | 3 |
| Modify | `plans/research/render-review-2026-09-15/00-post-campaign-agenda.md` | 4 |
| Modify | `plans/docs-api-warning-clearance.md` (this plan's `## Implementation Notes`) | 4 |

Nothing is created or deleted. `packages/lib/typedoc.json`,
`packages/lib/tsconfig.lib.json`, `packages/lib/tsconfig.test.json`,
`packages/lib/llms.txt` and every test file must come out of this branch
unchanged — `## Verification` checks each of them.

---

## Expected Behaviour

Doc-comment edits have no runtime behaviour, so what must be pinned is the
*generated output*. Every row counts occurrences in one file under
`packages/lib/docs/api/` after `npm run docs:api`, with newlines collapsed
first so a re-wrap cannot change the answer:

```sh
count() { tr '\n' ' ' < "packages/lib/docs/api/$1" | grep -o -F "$2" | wc -l; }
```

The "Before" column is the measured state of `master`.

| Rendered page | Pattern | Before | After | Why this discriminates |
|---|---|---|---|---|
| `component/display/classes/MarkdownViewer.md` | `MarkdownContentPane` | 3 | **0** | the file-local name is gone from the public page |
| `component/display/classes/MarkdownViewer.md` | `plain scrolling` | 1 | **1** | the class doc still describes what it renders into |
| `component/display/classes/MarkdownViewer.md` | `internal ` + backticked `Panel` + ` that actually scrolls` | 0 | **1** | `getScrollTop` describes the delegate instead of naming it |
| `component/display/classes/MarkdownViewer.md` | `delegates to the internal ` + backticked `Panel` | 0 | **1** | same for `setScrollTop` |
| `core/namespaces/SpatialNavigation/index.md` | `outermostTargets` | 1 | **0** | |
| `core/namespaces/SpatialNavigation/index.md` | `leafFocusables` | 1 | **0** | |
| `core/namespaces/SpatialNavigation/index.md` | `ancestorGeometry` | 1 | **0** | |
| `core/namespaces/SpatialNavigation/index.md` | `lands on the outer one first` | 1 | **1** | the sentence survived the link's removal |
| `core/namespaces/SpatialNavigation/index.md` | `clipping to nothing` | 1 | **1** | same |
| `core/namespaces/SpatialNavigation/index.md` | `(functions/enable.md)` | 2 | **2** | the links that *did* resolve still do |
| `core/functions/rankInDirection.md` | `PRIMARY` | 1 | **0** | the constant name is gone (it renders escaped, as `PRIMARY\_GAP\_EPSILON`) |
| `core/functions/rankInDirection.md` | `1px negative` | 0 | **1** | and the rule now states its own tolerance |
| `component/editor/classes/MarkdownEditor.md` | `selectEnclosingWordIfCollapsed` | 6 | **1** | five link renderings gone; `setLink`'s backticked prose mention is the survivor |
| `component/editor/classes/MarkdownEditor.md` | `classifyContextMenuTarget` | 1 | **0** | |
| `component/editor/classes/MarkdownEditor.md` | `enclosing word` | 11 | **11** | **the key check** — the behaviour sentences were kept, only the parentheticals removed |
| `validation/classes/FieldDecorator.md` | `](../../core/classes/Component.md#replacecomponent)` | 1 | **2** | the class-doc reference becomes a live deep link, which no suppression can produce; the first occurrence is the inherited-member row |
| `validation/classes/FieldDecorator.md` | `](#)` | 0 | **0** | proves no `"#"` mapping was used |

For (b), the behaviour to pin is the program's *membership*, not its exit code:
3,241 library sources in, `@types/node` and the six non-library files out:
`build/keepNames.ts`, `packages/lib/vite.config.ts`,
`packages/lib/vite.lib.config.ts`, `packages/lib/vitest.config.ts`,
`packages/lib/scripts/import-fontawesome.ts` and
`packages/lib/scripts/llms/generate.d.mts`.

All of the above is command-checkable; nothing here needs manual or visual
verification.

---

## Verification

Run from the worktree root, in this order. `npm install` first; never invoke
vitest with a bare `--root`.

1. `npm run docs:api` → `Found 0 errors and 0 warnings`.
2. Every row of `## Expected Behaviour`'s table.
3. **No-suppression audit.** `git diff master -- packages/lib/typedoc.json`
   → empty. Then `git diff master -- packages/lib/src | grep -c '@internal'`
   → `0`, and the same diff must contain no `private ` or `protected `
   addition on a previously public member.
4. **Suppression-blind re-run.** Temporarily delete the three entries inside
   `typedoc.json`'s `"@jimka/typescript-ui"` mapping object, run
   `npm run docs:api`, and confirm **exactly 3** warnings, all of the form
   `X, defined in …, is referenced by … but not included in the
   documentation`, naming `CellTextResolver`, `ColumnWindowSlidePlan` and
   `RetargetedCell`. Restore the file and confirm
   `git diff --exit-code packages/lib/typedoc.json`. A count above 3, or any
   `links to "…"` warning, means one of the 14 was silenced by a mapping
   rather than fixed.
5. `npm run docs:llms:check` (after `docs:api`) → `Coverage OK: 108
   catalogued, 121 explicitly excluded, 0 unaccounted for.`
6. `npm run docs:llms` → prints `llms.txt: ~7055 tokens` and
   `../docs/public/llms.txt: ~8004 tokens`, then
   `git diff --exit-code -- packages/lib/llms.txt`. The committed manifest
   must not move.[^manifest-unmoved] If it does, the site variant's budget is
   the one at risk — 8,004 of 8,010 — so re-read the printed estimate before
   anything else and report the overshoot rather than raising
   `TOKEN_BUDGET`.
7. `npm run lint` → exit 0 (green on `master`).
8. `npm test` → green. This runs `typecheck:test` first, so it also covers
   `tsconfig.test.json` surviving the `include`.
9. Steps 17 and 18 of `## Ordered Implementation Steps`, in full.
10. `npm run build:lib`, then `npm run build:docs` → both succeed.

Do not run `packages/qa/runqa.sh`, MiniBrowser, the Tauri qa-host, or
`npm run dev` — each takes over the user's screen. Do not add a CI gate for
`docs:api`; the user explicitly declined one.

---

## Documentation Impact

No public symbol is added, renamed or removed, so no catalog or sidebar entry
changes. The only hand-written docs touched are `CODE_CONVENTIONS.md`
(commit 2) and the agenda file (commit 4). The four edited source files' pages
under `packages/lib/docs/api/` are regenerated and gitignored.

No page under `packages/lib/docs/` outside `docs/api/` mentions any of the
seven referenced symbols — checked with
`grep -rln 'MarkdownContentPane\|selectEnclosingWordIfCollapsed\|classifyContextMenuTarget\|outermostTargets\|leafFocusables\|ancestorGeometry\|PRIMARY_GAP_EPSILON' packages/lib/docs --include=*.md`,
which hits only three files inside `docs/api/`.

---

## Potential Challenges

- **`MarkdownEditor.ts` is being edited on another branch.**
  `feature/markdown-source-mode-editing` has its own worktree on this file.
  The edits here are confined to five JSDoc blocks between lines 1380 and 1657;
  resolve any conflict by re-applying the parenthetical removals rather than
  taking either side whole.
- **Line numbers drift as you edit.** Steps 8–12 all sit in one file and each
  removes one or two lines. Work top-down as ordered, and match on the quoted
  text rather than the line number.
- **`{@link enable}` and `{@link getScrollTop}` look like the links being
  removed.** They resolve and render correctly; removing them would lose real
  links. Only the eight symbols in `## Warning Inventory` are targets.
- **The `include` line goes outside `compilerOptions`.** Nested inside it, TS
  reports `Unknown compiler option 'include'` and the 37 errors stay.

---

## Critical Files

| File | Why |
|---|---|
| [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) | the *Don't `{@link}` internal symbols* section this plan amends; read it before editing any JSDoc |
| [packages/lib/typedoc.json](packages/lib/typedoc.json) | `excludePrivate`/`excludeProtected`/`excludeInternal` and the three `"#"` mappings; must come out of this branch unchanged |
| [packages/lib/tsconfig.lib.json](packages/lib/tsconfig.lib.json) | the precedent `include`, and the config `npm run typecheck` actually uses |
| [packages/lib/tsconfig.test.json](packages/lib/tsconfig.test.json) | declares its own `include`, which is why it is unaffected |
| [packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts:1450](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1450) | `toggleUnderline` — the in-file wording every sibling is being matched to |
| [packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts:681](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L681) | `$selectEnclosingWordIfCollapsed`'s own doc, which states it is exported only for tests |
| [packages/lib/src/typescript/lib/component/editor/CodeEditor.ts:1131](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1131) | `{@link core!Component.focus}` — the existing module-qualified link form step 4 copies |
| [packages/lib/src/typescript/lib/component/display/MarkdownViewer.ts:91](packages/lib/src/typescript/lib/component/display/MarkdownViewer.ts#L91) | `MarkdownContentPane`, documented as file-local |
| [packages/lib/scripts/llms/generate.mjs:191](packages/lib/scripts/llms/generate.mjs#L191) | `summarize()` — reads only a class's *first* JSDoc paragraph, which is why the manifest should not move |
| [plans/research/render-review-2026-09-15/00-post-campaign-agenda.md:177](plans/research/render-review-2026-09-15/00-post-campaign-agenda.md#L177) | the two entries being closed, and the strike-through-plus-**answered** format to copy |

---

## Non-Goals

- **No CI gate for `docs:api`.** The user declined one; do not add a workflow,
  a pre-commit hook, or a test that shells out to `typedoc`.
- **The three `externalSymbolLinkMappings` entries stay.** Exporting
  `CellTextResolver`, `ColumnWindowSlidePlan` or `RetargetedCell` is separate
  work with its own llms.txt coverage consequences; this plan only records it.
- **No edits to the six pending plans that carry the old wording.** They belong
  to unrelated work; `CODE_CONVENTIONS.md` is where the bar lives from now on.
  Stage nothing under `plans/` beyond this plan's own file and the agenda.
- **`setLink`'s backticked `$selectEnclosingWordIfCollapsed` mention stays**
  (line 1558). It is prose, emits no warning, and changing it is not this
  plan's business.
- **`build/`, the Vite configs and `scripts/import-fontawesome.ts` gain no
  typecheck.** They have none today — the bare command is in no npm script —
  so scoping the program loses no coverage.
- **`"types": []` is not added** to `tsconfig.json`.
- **No `@types/node`, timer-type or unused-local edit in any test file.** The
  25 unused locals and the 10 timer-type casts are switched off on purpose by
  `tsconfig.test.json`; the `include` removes those files from the bare
  program instead of touching them.

---

## Notes

[^drifted-bar]: The phrasings currently in `plans/`, all of which
    `CODE_CONVENTIONS.md` supersedes:
    `spatial-navigation-region-chord-default.md:233` ("finishes with zero
    warnings"), `table-cell-alignment-override.md:497,596` ("confirm no new
    warnings", "reports no new warnings against the base branch"),
    `directional-panel-navigation.md:708,900`,
    `text-tooltip-on-truncate.md:282`,
    `dialog-escape-releases-tab-owner.md:462,556`, and
    `two-phase-baseline-resolution.md:465`. Three of them already wrote the
    unreachable zero bar, which is how the drift stayed invisible: the check
    was never run to completion, so nobody noticed it could not pass.

[^count-drift]: Measured on `master` (`467ffb4e`) as 25 × `TS6133` (unused
    local, all in `tests/`), 10 × `TS2352` (`typeof setTimeout` cast, all in
    `tests/`) and 2 × `TS2322` (`Type 'Timeout' is not assignable to type
    'number'`, in `component/container/StatusBar.ts:260` and
    `component/input/AbstractCalendarDropdown.ts:1548`). The 2026-09-20
    analysis recorded 21 + 9 = 30; the extra seven arrived with test files
    added since. The two `TS2322` in *library* sources are the interesting
    ones — they are the proof that `@types/node` was reaching the library
    program, because `setTimeout` then resolves to Node's declaration
    returning `Timeout` instead of the DOM's returning `number`.

[^prose-precedent]: `toggleUnderline` reads "first expanding a collapsed caret
    to its enclosing word. No-op without a range selection." — word for word
    what `toggleItalic` and `toggleStrikethrough` say, minus the
    `(see {@link $selectEnclosingWordIfCollapsed})` parenthetical. It calls
    `$selectEnclosingWordIfCollapsed()` in its body exactly like its four
    siblings, so the parenthetical is the only difference between the fixed
    and unfixed forms. That is the strongest available evidence that removing
    it costs the reader nothing.

[^cross-module]: Measured, not inferred. Adding
    `{@link Component.replaceComponent}` to the `core.SpatialNavigation`
    namespace doc produced a working link
    (`[Component.replaceComponent](../../classes/Component.md#replacecomponent)`)
    and no warning; moving `{@link Component.setNavigationTarget}` — which
    resolves fine from `core` — into `validation/FieldDecorator.ts` made *it*
    warn instead. So the discriminator is the referring module, not the member.
    Every one of the six working `{@link Component.…}` links in the library
    sits in a `core.*` reflection. The repo already uses the qualified form
    twice, in
    `component/editor/MarkdownEditor.ts:1359` and
    `component/editor/CodeEditor.ts:1131`
    (`{@link core!Component.focus}`), plus `{@link layout!Accordion}` in
    `core/Component.ts:8207` — so this is precedent, not a new pattern. The
    display alias matters: without the `| …` half, the rendered link text is
    the raw reference `core!Component.replaceComponent`.

[^malformed-link]: TypeDoc distinguishes the two cases by message.
    `node_modules/typedoc/dist/lib/validation/links.js:70` emits *"links to X
    which was resolved but is not included"* when a TS symbol was found but no
    documented reflection maps to it, and *"Failed to resolve link to X"* when
    no symbol was found at all. Thirteen of the 14 are the first kind. The
    fourteenth, on `MarkdownViewer.getScrollTop`, is the second: its source
    reads `{@link\n * MarkdownContentPane}`, and a declaration reference does
    not survive the line break. The rendered page confirms it — the text
    appears with no link markup at all.

[^suppressed-three]: Restoring the three entries takes `docs:api` back to 14,
    and deleting them yields 17. The extra three are not `{@link}` warnings at
    all: `CellTextResolver, defined in …/cell/CellText.ts, is referenced by
    component/table.buildColumnFilter.display but not included in the
    documentation`, and the same shape for `ColumnWindowSlidePlan`
    (`Row.setColumnWindow.plan`) and `RetargetedCell`
    (`Row.getRetargetedCells`). All three are `export`ed from their own module
    but absent from `component/table/index.ts`, so a public signature names a
    type the docs never describe. The pre-1.0 delete rule does not apply —
    each has many callers inside `component/table`. Fixing them means either
    barrel-exporting them or reshaping three public signatures, and
    barrel-exporting `CellTextResolver` makes it a concrete public class that
    `scripts/llms/check-coverage.mjs` will then require be catalogued in or
    excluded from `manifest.data.mjs`.

[^include-evidence]: Measured with the `include` applied to
    `packages/lib/tsconfig.json`: the bare command goes from 37 errors to 0;
    the program keeps all 3,241 files under `src/typescript/lib/`; `@types/node`
    drops from 82 files to 0; and `tsc -p tsconfig.lib.json --noEmit` and
    `tsc -p tsconfig.test.json --noEmit` both stay at 0, because `extends`
    inherits `include` only when the child does not declare its own and both
    children do. `@types/node` is not auto-included here — `tsconfig.lib.json`
    lists 0 of its files today — it arrives transitively through
    `build/keepNames.ts` and the three Vite/Vitest configs, whose `vite`,
    `esbuild` and `vitest/config` typings pull in Node's globals. Dropping
    those four files from the program is what removes it. Nothing in the build
    depends on the bare config's file set: `packages/lib/vite.config.ts`,
    `vite.lib.config.ts` and `vitest.config.ts` all declare `resolve.alias`
    explicitly rather than reading `tsconfig.json`'s `paths`, and
    `build:lib` uses `tsconfig.lib.json`.

[^no-types-flag]: `"types": []` would clear the two library-source `TS2322`
    errors by starving the program of ambient type packages, but it leaves the
    35 test-file errors untouched and it would be inherited by
    `tsconfig.lib.json` and `tsconfig.test.json`, which do not declare their
    own `types`. That risks removing type packages the tests legitimately rely
    on. The `include` fixes all 37 and is inherited by neither child.

[^all-have-callers]: `outermostTargets`, `leafFocusables`, `ancestorGeometry`
    and `PRIMARY_GAP_EPSILON` are module-private and used inside
    `SpatialNavigation.ts`. `MarkdownContentPane` is file-local and
    instantiated at `MarkdownViewer.ts:163`.
    `$selectEnclosingWordIfCollapsed` and `$classifyContextMenuTarget` are
    exported from their module so
    `packages/lib/tests/component/markdown-editor.test.ts` can drive them
    directly — a pattern `MarkdownDocumentPanel.ts:53-58` documents for
    `LinkPopupPanel` and names them as its precedent — and are called from
    `MarkdownEditor`'s own methods. `Component.replaceComponent` is called by
    `FieldDecorator.ts:55` and covered by
    `tests/component/Component.test.ts:338-373`. So no warning here is the
    "exported with no callers" case the pre-1.0 rule deletes.

[^surviving-links]: The thirteen are lines 586, 595, 607, 609, 611, 615, 673,
    675, 707, 739, 781, 2331 and 2600. Each sits either in the JSDoc of
    `$selectEnclosingWordIfCollapsed`, `$computeWordExpansion` or
    `$classifyContextMenuTarget` themselves, or in that of a `private` member
    such as `clipboardMenuItems` (line 2600) — none of which TypeDoc renders.
    `CODE_CONVENTIONS.md` permits a link inside an internal symbol's own
    JSDoc; the constraint applies only to comments that actually render, which
    is why these thirteen never warned.

[^manifest-unmoved]: `generate.mjs`'s `summarize()` takes
    `joined.split(/\n\s*\n/)[0]` — the first paragraph only — and the
    manifest catalogues classes and interfaces, never namespaces or functions.
    None of the 14 sites is in the first paragraph of a catalogued class:
    `MarkdownViewer`'s link is in its fourth paragraph, `MarkdownEditor`'s six
    are on methods, `FieldDecorator` is in `excludedSymbols`, and
    `SpatialNavigation` and `rankInDirection` are not catalogued at all. So
    the prediction is a byte-identical `llms.txt` and the same two token
    estimates, which is a sharper check than "still under budget". The tight
    number is the gitignored site variant at 8,004 of 8,010; the committed
    `llms.txt` sits at 7,055.
