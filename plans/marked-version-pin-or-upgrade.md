---
depends-on:
  - markdown-list-toggle-task-item-parity
touches-shared:
  - packages/lib/package.json
  - package-lock.json
  - packages/lib/docs/components/Markdown.md
  - packages/lib/docs/reference/changelog/next.md
---

# marked Version Pin and Guard — Implementation Plan

## Overview

The `Markdown` viewer and the `MarkdownEditor` both read a document through the `marked` parser. [packages/lib/package.json:222](packages/lib/package.json#L222) declares it as `"marked": "^18.0.5"`, a range that today admits eleven published versions, 18.0.5 to 18.1.0. The lockfile installs 18.0.9, and every Markdown test of the stack ran on that one version. The library build leaves `marked` out of `dist/lib` ([vite.lib.config.ts:99](packages/lib/vite.lib.config.ts#L99)), so the range in the published `package.json` decides which version an application gets.

That version changes what the library does. The library's 8,128 Markdown tests were run on each of the eleven versions, on commit `75d022ba1`, the tip of the Markdown stack:[^measured]

| `marked` | Failing tests | Who gets this version today |
|---|---|---|
| 18.0.5 – 18.0.8 | 2 | SQLAdmin's lockfile holds 18.0.6 |
| 18.0.9 | 0 | this repository's lockfile: tests, CI, the demo, docs and QA apps |
| 18.0.10 | 0 | nobody |
| 18.0.11, 18.0.12 | 40 | nobody |
| 18.0.13 | 41 | nobody |
| 18.0.14, 18.1.0 | 48 | a fresh `npm install` of the library resolves 18.1.0 |

This plan does two things. It pins `marked` to exactly `18.0.9`, so every install of the library gets the version the tests ran on. And it adds one unit test that fails when the installed `marked` is not the declared one, or when the declaration is a range again. No library source file changes.

Moving to a newer `marked` is the plan [`marked-upgrade`](marked-upgrade.md), which starts from this one.

---

## Decisions Awaiting Sign-off

The plan is written for the recommended answer to each. A different answer means revising the plan before it is implemented; the implementer does not choose.

| # | Question | Recommended, and what the plan builds | If answered otherwise |
|---|---|---|---|
| 1 | Which version is pinned now? | **18.0.9**, the version the lockfile installs and all 8,128 tests pass on. Only the declared range changes; no package is installed.[^why-18-0-9] | 18.0.10 passes the same tests. It needs a lockfile version change and an install, and three documents read differently on it (see the addendum). |
| 2 | One exact version, or a narrow range? | **One exact version.** A patch release of `marked` changes how documents read, so no range is safe.[^exact] | `>=18.0.9 <18.0.11` admits the two versions that pass. Test MV1 would have to accept a range, and two applications could again read one document differently. |
| 3 | Is `marked` a dependency, a peer dependency, or bundled into `dist/lib`? | **A dependency, left out of the bundle**, as today.[^external] | Bundled: the lockfile at release time decides and the range stops mattering, but the build pattern for runtime dependencies changes and the notices file gains a bundled entry. Peer: every application must install the exact version itself. |
| 4 | Does the published 0.10.0 get a patch release with the pin? | **No.** The pin ships with the next release.[^no-patch] | A 0.10.1 cut from the release commit `99e78bdfe` with the one-line pin. That is release work outside this plan. |
| 5 | When does this plan run? | **Before every other unstarted Markdown plan.** It touches none of their source or test files, and it makes the version they are measured on the declared one.[^order] | Later: each plan implemented before it keeps running on whatever the lockfile holds, which is 18.0.9 as long as nobody refreshes it. |

Nothing here changes what an application sees: 18.0.9 is what this repository's applications already run. No migration note is needed.[^not-breaking]

---

## Architecture Decisions

### `marked` is pinned to one exact version — 18.0.9

`packages/lib/package.json` declares `"marked": "18.0.9"`. The lockfile's entry for the library workspace changes to match; the installed package stays the same.[^why-18-0-9] [^exact]

| Declared | A fresh install gets | An application whose lockfile holds 18.0.6 gets |
|---|---|---|
| `^18.0.5` (before) | 18.1.0 today, and whatever 18.x is newest later | 18.0.6, kept because it satisfies the range |
| `18.0.9` (after) | 18.0.9 | 18.0.9, moved by the library update |

### `marked` stays a runtime dependency the build leaves out

Nothing changes in [vite.lib.config.ts:99](packages/lib/vite.lib.config.ts#L99): `marked` stays in the `external` list and in `dependencies`.[^external]

An application that depends on `marked` itself keeps working. When its own version is 18.0.9, npm installs one copy and both use it. When its version differs, npm installs a second copy under `node_modules/@jimka/typescript-ui/node_modules/marked`, and the library's imports resolve to that copy.[^two-copies]

### A unit test is the guard

A new test file, `packages/lib/tests/unit/marked-version.test.ts`, holds two tests:

- **MV1** — `dependencies.marked` in the library's `package.json` is one exact version.
- **MV2** — the `marked` in `node_modules` is that version.

The file reads both values with JSON imports. It mirrors [import-without-dom.test.ts:2](packages/lib/tests/unit/import-without-dom.test.ts#L2), which imports `../../package.json` the same way, and [readme-mirror.test.ts](packages/lib/tests/unit/readme-mirror.test.ts), which turns a silent drift between two files into a test failure.[^guard]

| Declared | Installed | MV1 | MV2 |
|---|---|---|---|
| `18.0.9` | 18.0.9 | passes | passes |
| `18.0.9` | 18.1.0 | passes | fails |
| `^18.0.9` or `~18.0.9` | 18.0.9 | fails | fails |

The test runs with the rest of the suite: locally through `npm run test`, in CI through [lib-tests.yml:17](.github/workflows/lib-tests.yml#L17), and at release through the `npm test --workspaces --if-present` line of [release-steps.md](release-steps.md). No workflow file changes.[^no-ci-step]

### The user makes the dependency change

The implementer does not edit `packages/lib/package.json` or `package-lock.json` and runs no npm command that writes. Step 3 hands one command to the user and waits. The command changes one line in each of the two files; npm is not run.[^user-step]

### The upgrade is a plan of its own

This plan does not move to a newer `marked`. The plan `marked-upgrade` does, and lists what changes with it.[^upgrade-separate]

---

## Internal Structure

The whole of `packages/lib/tests/unit/marked-version.test.ts`:

```ts
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { describe, it, expect } from 'vitest';
import installedMarked from 'marked/package.json';
import packageJson from '../../package.json';

// `marked` is pinned to one exact version, and this suite fails when the
// version in `node_modules` is any other. The Markdown viewer and the
// MarkdownEditor both read a document through `marked`, and its patch
// releases change that reading: when the pin was introduced, the library's
// Markdown tests passed on two of the eleven versions the old range,
// `^18.0.5`, admitted. The build leaves `marked` out of `dist/lib`, so the
// version declared in `package.json` is the one an application's install
// resolves.
//
// To move to another version, change `dependencies.marked` and the lockfile
// together and make the Markdown suites pass on it. Do not widen the range.

/** The `marked` entry of the library's `dependencies`, as written. */
const DECLARED: string = packageJson.dependencies.marked;

/** One exact version: digits and dots, with no `^`, `~`, comparator, range or tag. */
const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

describe('the marked version the Markdown suites run on', () => {
    it('MV1. package.json declares marked as one exact version', () => {
        expect(DECLARED, 'packages/lib/package.json must pin "marked" to one exact version, not a range').toMatch(EXACT_VERSION);
    });

    it('MV2. the installed marked is the declared version', () => {
        const message = `node_modules holds marked ${installedMarked.version} but packages/lib/package.json declares ${DECLARED}: `
            + 'install the declared version, or move the pin and make the Markdown suites pass on the new one';

        expect(installedMarked.version, message).toBe(DECLARED);
    });
});
```

`marked` exports its `package.json` (`"./package.json": "./package.json"` in its `exports` map), so the import needs no path into `node_modules`. The test program type-checks both JSON imports as it stands; no `tsconfig` change is needed.[^typecheck]

---

## Ordered Implementation Steps

Work in the plan's worktree. Its `node_modules` and `packages/lib/node_modules` are symlinks to the main tree's. Run no `npm install`, `npm ci` or `npm update` anywhere.

1. **Add the guard test.** Create `packages/lib/tests/unit/marked-version.test.ts` with the text in `## Internal Structure`, unchanged.
   - Check, from `packages/lib`: `npx vitest run tests/unit/marked-version.test.ts` reports **2 failed**. MV1's message ends `expected '^18.0.5' to match /^\d+\.\d+\.\d+$/`. MV2's message starts `node_modules holds marked 18.0.9 but packages/lib/package.json declares ^18.0.5`.
   - Check, from `packages/lib`: `npm run typecheck:test` exits 0.

2. **Write the documentation.** Make the two edits in `## Documentation Impact`.

3. **Stop, and ask the user to pin the version.** Show the user this block and wait for them to say it is done. Do not run the commands yourself.

   ```sh
   # From the worktree's root. Changes one line in each file:
   #     "marked": "^18.0.5",   becomes   "marked": "18.0.9",
   sed -i 's/"marked": "\^18\.0\.5"/"marked": "18.0.9"/' packages/lib/package.json package-lock.json
   git diff --stat -- package-lock.json packages/lib/package.json
   ```

   The result is the lockfile npm itself would write for this change, byte for byte.[^lock-only]
   - Check: `git diff -- packages/lib/package.json` shows one changed line, line 222.
   - Check: `git diff -- package-lock.json` shows one changed line, line 6056, in the `packages/lib` entry. The `node_modules/marked` entry still reads `"version": "18.0.9"`.
   - Check: `grep -c -F '"marked": "^18.0.5"' packages/lib/package.json package-lock.json` prints `0` for both files.
   - When either diff shows more than its one line, stop and tell the user what it shows.

4. **Run the guard again.** From `packages/lib`: `npx vitest run tests/unit/marked-version.test.ts` reports **2 passed**.

5. **Run the full checks** in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/tests/unit/marked-version.test.ts` |
| Modify (by the user, step 3) | `packages/lib/package.json` |
| Modify (by the user, step 3) | `package-lock.json` |
| Modify | `packages/lib/docs/components/Markdown.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Unit-tested, by the new file:

| ID | Case | Result |
|---|---|---|
| MV1 | `dependencies.marked` is `18.0.9` | passes |
| MV1 | `dependencies.marked` is `^18.0.5`, `~18.0.9`, `>=18.0.9 <18.0.11`, `latest` or `18.x` | fails, and the message names `packages/lib/package.json` |
| MV2 | `node_modules/marked/package.json` has `"version": "18.0.9"` and the declaration is `18.0.9` | passes |
| MV2 | the installed version differs from the declaration | fails, and the message holds both versions |

The suite can only show the first and third rows green after step 3, and the second row red before it (step 1's check). The fourth row cannot be produced in the suite without installing another `marked`. It was shown once while drafting, with the import of `marked/package.json` redirected to a 18.1.0 copy outside the repository; the message read `node_modules holds marked 18.1.0 but packages/lib/package.json declares 18.0.9`.[^guard-proof] It needs no manual step from the implementer.

Unchanged, and checked by the existing suites: every Markdown test passes, because the installed `marked` is the same package as before.

---

## Verification

Run from the worktree's root unless a line says otherwise.

- `npm run test` — runs `typecheck:test` and the whole library suite. Expect every test to pass, with two more tests than before (MV1, MV2).
- `npm run typecheck` and `npm run lint` — no source file changed; both pass as before.
- `git status --short` — exactly the five paths of `## Files to Create / Modify / Delete`.
- `grep -n '"marked"' packages/lib/package.json` — one line, `"marked": "18.0.9",`.
- `grep -n -A3 '"node_modules/marked"' package-lock.json` — `"version": "18.0.9"`.
- `npm run docs:llms:check` — unchanged; no public symbol moved.

No browser check is needed: no file the applications load has changed.

---

## Documentation Impact

No public symbol changes. Two pages change.

1. [packages/lib/docs/components/Markdown.md:25](packages/lib/docs/components/Markdown.md#L25). Replace the line

   ```markdown
   `marked` is a runtime dependency of the library, installed transitively when you install `@jimka/typescript-ui`.
   ```

   with

   ```markdown
   `marked` is a runtime dependency of the library, installed transitively when you install `@jimka/typescript-ui`. The library declares one exact version of it, because a patch release of `marked` can change how a document reads. An application that uses `marked` itself at another version gets its own copy beside the library's.
   ```

2. `packages/lib/docs/reference/changelog/next.md`, under `## Changed`, `### Components`. Add as the last bullet of that subsection:

   ```markdown
   - **`marked` is pinned to exactly 18.0.9.** The library declared
     `^18.0.5`, so a fresh install resolved the newest 18.x, and an
     application with an older lockfile kept an older one. `marked`'s patch
     releases change how a document reads, so the same document could read
     differently in two applications: of the eleven versions the range
     admitted, the library's Markdown tests pass on two. The library now
     declares the version it is tested on. No consumer action is needed; an
     application that depends on `marked` itself at another version gets a
     second copy beside the library's.
   ```

`packages/lib/docs/reference/migration/next.md` is not touched.[^not-breaking] `packages/lib/THIRD-PARTY-NOTICES.md` lists `marked` without a version and is not touched.

---

## Potential Challenges

- **A worktree shares the main tree's `node_modules`.** MV2 reads the `marked` installed there. After `marked-upgrade` merges and the user reinstalls in the main tree, a branch that still declares 18.0.9 fails MV2 until it is rebased. That failure is the guard working: the message names both versions.
- **The `sed` command finds no line, or more than one.** That means `package.json` or the lockfile changed since this plan was measured. Step 3's checks catch it; the implementer stops and reports.
- **Running npm in a worktree.** A worktree's `node_modules` is a symlink to the main tree's, and npm writes through it: even `npm install --package-lock-only` writes `node_modules/.package-lock.json` there. That is why step 3 runs no npm command.
- **SQLAdmin's notices.** SQLAdmin's `THIRD-PARTY-NOTICES.md` lists `marked` 18.0.6. Its lockfile moves to 18.0.9 when it takes the next library release, and that row must follow. Nothing in this plan writes to the SQLAdmin repository.
- **A later dependency sweep.** A sweep that rewrites every range to `^latest` turns MV1 red. The comment at the top of the test file says why the pin exists and what moving it takes.

---

## Critical Files

- [packages/lib/tests/unit/import-without-dom.test.ts](packages/lib/tests/unit/import-without-dom.test.ts) — the precedent for a test that imports `../../package.json` (line 2). Mirror its import form.
- [packages/lib/tests/unit/readme-mirror.test.ts](packages/lib/tests/unit/readme-mirror.test.ts) — the precedent for a drift guard: a header comment that says what drifted before and why the test exists.
- [packages/lib/package.json](packages/lib/package.json) — line 222 holds the declaration; line 182 holds `"typedoc": "0.28.19"`, the repository's existing exact pin.
- [packages/lib/vite.lib.config.ts](packages/lib/vite.lib.config.ts) — line 99, the `external` list that keeps `marked` out of `dist/lib`. Read only.
- [packages/lib/src/typescript/lib/component/display/markdownExtensions.ts](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts) — where the library reaches into `marked`'s tokenizer, rules and lexer state. Read only.
- [release-steps.md](release-steps.md) — the release checklist whose test line runs the guard. Read only.

---

## Non-Goals

- **Moving to a newer `marked`.** The plan `marked-upgrade` owns it.[^upgrade-separate]
- **A runtime check inside the library.** `marked` exports no version at runtime, and an exact declaration already decides what an install resolves.[^no-runtime-check]
- **A CI job that runs the tests on the newest `marked`.** With an exact pin there is no newer version in range to test; 48 tests fail on the newest today, so such a job could only be red.[^no-ci-step]
- **Pinning other dependencies.** `lexical`, the CodeMirror packages and `@lezer/markdown` keep their ranges. Nothing was measured for them here.
- **Writing to the SQLAdmin repository.** Its lockfile and notices follow when it takes the next library release.
- **A patch release of 0.10.x.** See decision 4.

---

## Addendum: Measured

Everything here was measured on commit `75d022ba1`, the tip of the Markdown stack. Each `marked` version was installed into a folder of its own outside the repository and put in place of `marked` with a temporary Vitest alias; nothing in the repository was installed or changed. A fingerprint of the loaded `Lexer`, `Tokenizer`, `Parser` and `Renderer` confirmed, in every run, that the aliased version was the one the tests ran on. The scripts and outputs are kept under `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans3/marked-version/`.

### Is `marked` bundled?

No. The library ships one build output, `dist/lib` (`"files"` in [packages/lib/package.json:134](packages/lib/package.json#L134)), in one format (`formats: ['es']`, [vite.lib.config.ts:75](packages/lib/vite.lib.config.ts#L75)). A build of `75d022ba1` inside the drafting worktree gave:

| Built file | How it gets `marked` |
|---|---|
| `dist/lib/markdownExtensions-*.js` | `import{Marked as e,Tokenizer as t}from"marked"` |
| `dist/lib/component/editor.es.js` | `import{Lexer as Ue}from"marked"` |
| six `.d.ts` files under `dist/lib/types/component/` | `import type … from "marked"` |
| every other file | does not use it |

No `marked` code is inlined: none of its rule names (`emStrongLDelim`, `reflinkSearch`) occurs in any built file.

### What each consumer resolves today

| Consumer | What decides | `marked` |
|---|---|---|
| Library tests, CI (`npm ci`), the demo app, the docs app, the QA app | the root `package-lock.json` | 18.0.9 |
| SQLAdmin, installed from the registry (its Docker build runs `npm ci`) | `frontend/package-lock.json`, written when 18.0.6 was newest | 18.0.6 |
| SQLAdmin with `node_modules/@jimka/typescript-ui` symlinked to this repository | this repository's `node_modules`, found from the library's real path | 18.0.9 |
| A new project (`npm create @jimka/tsui-app`, or a first `npm install @jimka/typescript-ui`) | the newest version in `^18.0.5` | 18.1.0 |

SQLAdmin does not import `marked` itself. The published 0.10.0 declares `^18.0.5` too; its own 572 Markdown tests pass on 18.0.6, 18.0.9 and 18.1.0.

### Which upstream change breaks which tests

Each release from 18.0.9 to 18.1.0 was run, and then each upstream commit of the three releases where the count changes, built from `marked`'s source. Building the tags `v18.0.9` and `v18.1.0` the same way gave 0 and 48 failures, the same as the published packages.

| First fails at | Upstream change | Tests | What the tests pinned |
|---|---|---|---|
| 18.0.11 | "do not nest a link inside a link" (#4051) | 40 | `[[a](/in)](/out)` read as a link holding a link |
| 18.0.13 | "match html block start conditions when ending a list item" (#4072) | 1 | `- a ⏎ <div` read as an HTML block inside the item |
| 18.0.14 | "preserve internal tabs in list item content" (#4086) | 2 | a tab in an item's text read as spaces |
| 18.0.14 | "decode numeric character references in text" (#4076) | 3 | `&#35;` shown as typed |
| 18.0.14 | "keep text after empty nested blockquote" (#4101) | 2 | the line after a fence closed inside a nested quote not shown at all |

The two tests of the last row are also the two that fail on 18.0.5 to 18.0.8. They pin a defect that only 18.0.9 to 18.0.13 have: "Fix spurious deeper nesting in a blockquote continuation" (#4030, 18.0.9) made `marked` drop the line `b` of `> > ``` ⏎ > > a ⏎ > > ``` ⏎ b`, and #4101 brought it back.

18.1.0 adds no failure over 18.0.14. The whole library suite on 18.1.0 (16,870 tests) fails only these 48.

### The round-trip rules on each version

The round-trip harness's six checks were run on 608 documents for every version: the 431 corpus documents, 66 documents from the test fixtures upstream added with its fixes, and the 111 tab documents of the plan `markdown-tab-column-parity`.

| Compared with 18.0.9 | 18.0.5 | 18.0.6 | 18.0.7, 18.0.8 | 18.0.10 | 18.0.11 | 18.0.12 | 18.0.13 | 18.0.14 | 18.1.0 |
|---|---|---|---|---|---|---|---|---|---|
| Documents the viewer reads differently | 9 | 7 | 3 | 3 | 14 | 21 | 43 | 69 | 71 |
| Viewer and editor read the same on 18.0.9, and no longer do | 3 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| A save that reloaded on 18.0.9, and no longer does | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| An unedited document saved in other bytes | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

So a document that is only loaded and saved keeps the stack's rules on every version from 18.0.9 up; what moves is the reading, for the viewer and the editor together. The one document SQLAdmin's 18.0.6 reads differently in the viewer and the editor is `> foo ⏎ - ⏎⏎ > foo ⏎ > bar ⏎ 1.`.

Text typed into the editor is a different matter. 19,893 strings were each put into a paragraph, saved, and read back by the viewer. On 18.0.9, 18,839 read back as typed. On 18.1.0, 3,378 of those no longer do, and every one of them holds a numeric character reference such as `&#35;`. The editor saves the text as typed and 18.1.0 reads it as `#`. This is the case test E10 of `markdown-serializer.test.ts` catches, and the plan `marked-upgrade` fixes it in the serializer.

### Which reading is the correct one

Of the 71 documents whose reading differs between 18.0.9 and 18.1.0, `marked`'s output moves onto `commonmark.js` 0.31.2's on 56, matched it before and after on 7, and matches it neither before nor after on 8. None moves away. The 8 are GFM constructs CommonMark does not have (strikethrough, `mailto:` and `xmpp:` autolinks, where 18.1.0 follows the GFM specification's examples 633 to 635), one document only the library's own HTML tokenizer reads correctly, and one tab document.

Of the 652 examples of the CommonMark 0.31.2 specification, `marked` alone renders 628 as the specification does on 18.0.5 to 18.0.10, 632 on 18.0.11, 640 on 18.0.12 and 646 on 18.0.13 to 18.1.0. No example that passes on one version fails on a later one.

### What staying on 18.0.9 costs

Two things, both removed by the plan `marked-upgrade`:

- **A line that is not shown.** For `> > ``` ⏎ > > a ⏎ > > ``` ⏎ b`, versions 18.0.9 to 18.0.13 give the line `b` no token, so the viewer shows nothing for it. Upstream introduced this in 18.0.9 and fixed it in 18.0.14.
- **Slow documents.** Three of the documents upstream wrote to catch slow regular expressions, lexed by `marked` alone:

  | Document | 18.0.9 | 18.1.0 | Fixed by |
  |---|---|---|---|
  | 250,781 characters of footnote-like definitions | 12.6 s | 76 ms | #4040 (18.0.11) |
  | 406,792 characters of nested reference definitions | 12.5 s | 93 ms | #4040 (18.0.11) |
  | `[](` followed by 50,000 no-break spaces | stopped after 20 s | 5 ms | #4106 (18.1.0) |

  These are inline rules, which the library's guarded block slots do not bound.

### Do the library's tokenizers still earn their place?

The three tokenizers in `markdownExtensions.ts` that correct `marked` were tried against `marked` alone on every version. Each defect is still there on 18.1.0, so none of the three can be deleted after an upgrade:

| Tokenizer | Document | `marked` alone, 18.0.5 to 18.1.0 |
|---|---|---|
| `listWithOwnTaskMarker` | `- [ ] foo ⏎⏎   [x] bar` | the item's text keeps `[ ] `, the later paragraph loses `[x] ` |
| `blockquoteWithSourceRaw` | `> - a ⏎ > - a ⏎ c ⏎ > - a ⏎ c ⏎ <div>` | the tokens' `raw` do not join back into the source |
| `htmlWithInputEndAsLineEnd` | `<div` as the last line | a paragraph, where CommonMark reads an HTML block |

`markdownLexer.test.ts`, which compares the bounded tokenizers with their unbounded twin on 5,000 random documents, passes on all eleven versions.

---

## Notes

[^measured]: The 8,128 tests are the 27 library test files whose path holds "markdown", run with Vitest on commit `75d022ba1`. `## Addendum: Measured` holds the method, the cause of every failure and the per-version comparison of the round-trip checks.

[^why-18-0-9]: 18.0.9 is what `package-lock.json` installs, so it is the only version every test of the stack, every plan's measurement and every application of this repository has run on. Pinning it changes one line of `package.json` and one line of the lockfile, and installs nothing. 18.0.10 also passes all 8,128 tests, but nothing was developed against it, and three documents read differently on it: a paragraph line followed by a last line that holds only a code fence, in backticks or in tildes (one paragraph on 18.0.9; a paragraph and an empty code block on 18.0.10), and emphasis before an escaped character outside the Basic Multilingual Plane. Staying on 18.0.9 has a cost that the upgrade plan removes: 18.0.9 to 18.0.13 drop the line after a fence closed inside a nested quote (`> > ``` ⏎ > > a ⏎ > > ``` ⏎ b` shows no `b`).

[^exact]: `marked` releases its parsing fixes as patch versions, and each one changes what some document reads as: of the eleven versions `^18.0.5` admits, the tests pass on two. A tilde range (`~18.0.9`) admits 18.0.10 to 18.0.14 and so four of the five breaking changes. The library also reaches into parts of `marked` that are not its documented extension points and can change in any release: `Tokenizer.prototype.list`, `.blockquote`, `.html`, `.hr` and `.lheading`, `this.rules.other.listReplaceTask`, `this.rules.block.blockquote`, the lexer's `inlineQueue`, `state.top` and `tokens.links` ([markdownExtensions.ts:373](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L373), lines 387, 468, 475, 503, 677), and `Lexer.rules.block.gfm.def` and two inline rules ([markdownImporter.ts:81](packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L81)). A range also drifts in both directions: a fresh install takes the newest version, while an application whose lockfile already holds an older one keeps it, as SQLAdmin's holds 18.0.6. The repository has an exact pin already, for the same kind of reason: `"typedoc": "0.28.19"` ([package.json:8](package.json#L8)), kept by commit `034b03039` because newer releases break the docs toolchain.

[^external]: The build keeps every runtime dependency out of `dist/lib`: `marked`, the CodeMirror packages, the Lexical packages, `prettier`, `sql-formatter` and `elkjs` are all in the `external` list of `vite.lib.config.ts`. Bundling `marked` alone would be a new pattern for one package. `marked` is MIT-licensed, so the project's rule against vendoring third-party code under a restrictive licence would not forbid it; the reason to keep it external is the build pattern, plus that an exact declaration already gives the same determinism. A peer dependency would push the exact version onto every application's own `package.json` and fail their install on a mismatch, for a package most of them never import.

[^two-copies]: The library lexes through an instance of its own, `new Marked({ … })` ([markdownExtensions.ts:602](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L602)), and never calls `use()` on `marked`'s shared default instance, so a second copy and the library's copy do not affect each other. `marked` 18.0.9's ESM build is 43 kB before compression; that is the cost of the second copy in such an application's bundle. An application that forces one version for both, with npm `overrides` or a bundler alias, runs the library on a version it is not tested on; that is the application's choice and nothing in the library detects it.

[^guard]: A constant in the test that names "the verified version" was considered and dropped: it would be a third place to change on an upgrade, and the declaration in `package.json` already is the record of what the suite is verified on. With the declaration exact, "the installed version equals the declared one" is the whole guard. The case MV2 exists for is a `node_modules` that does not match the branch's `package.json`: every worktree of this repository symlinks its `node_modules` to the main tree's, so a branch can run on a `marked` its own `package.json` does not declare, and without the test that shows up as dozens of unrelated Markdown failures.

[^guard-proof]: While drafting, the test file was run four ways with temporary import redirects and no change to `package.json`: as the tip stands (`^18.0.5`: both fail), with the declaration redirected to a copy holding `18.0.9` (both pass), with that copy and `marked/package.json` redirected to a 18.1.0 install outside the repository (MV1 passes, MV2 fails with the message quoted), and with a copy holding `~18.0.9` (both fail).

[^typecheck]: `npx tsc -p tsconfig.test.json --noEmit` was run with the file in place and reported no error in it. The test program is free of Node's types on purpose (see the header of `tests/helpers/readReadmes.mjs`), which is why the file uses JSON imports and not `node:fs`.

[^no-ci-step]: The existing workflow installs with `npm ci`, which fails by itself when the lockfile and `package.json` disagree, and then runs the suite that now holds MV1 and MV2. A separate job that installs the newest `marked` and runs the Markdown tests was considered. With an exact pin no newer version is ever in range, so the job would test a version no install can resolve, and it would be red from its first run. What the newest version changes is listed, once, in the plan `marked-upgrade`.

[^user-step]: The user makes dependency and lockfile changes by hand, so the change is a step the user runs and can read the diff of. It is two one-line text edits, and the implementer's part is to check them.

[^lock-only]: Tried on copies of the repository's manifests outside the repository: after the edit of `packages/lib/package.json`, `npm install --package-lock-only` changed exactly line 6056 of `package-lock.json`, from `"marked": "^18.0.5",` to `"marked": "18.0.9",`, and the `sed` command of step 3 gives the same file byte for byte. The plan uses `sed` because npm is not free of side effects here: with `node_modules` a symlink, as it is in every worktree, `npm install --package-lock-only` wrote `node_modules/.package-lock.json` through the link, which in a worktree is the main tree's folder. The existing workflow's `npm ci` fails when the lockfile and `package.json` disagree, so a wrong hand edit cannot pass CI.

[^upgrade-separate]: Moving to 18.1.0 changes 48 tests, one line of the serializer, two corpus rows, three documentation pages, and what an application's users see for several kinds of document. It needs decisions of its own and a migration note. Keeping it out lets this plan land at once, with no behaviour change.

[^no-runtime-check]: A check at import time would need `marked`'s version, which `marked` does not export; reading `marked/package.json` from library code would put a JSON import of a dependency's manifest into `dist/lib` for every application's bundler to resolve.

[^no-patch]: The published 0.10.0 cannot be changed; a patch would be a new 0.10.1. Its code is from before the Markdown stack: its 572 Markdown tests pass on 18.0.6, 18.0.9 and 18.1.0 alike, so no test shows it broken on any version an install can resolve. What its viewer shows still follows the installed `marked`, as it always has.

[^order]: Besides `changelog/next.md`, where it adds one bullet, this plan shares no file with `markdown-editor-cross-item-range-removal`, `markdown-editor-link-format-command-fixes`, `markdown-editor-raw-block-edge-cases`, `markdown-editor-raw-block-range-edits`, `markdown-editor-readonly-keyboard-selection`, `markdown-editor-table-command-fixes`, `markdown-language-readonly-and-fences`, `markdown-tab-column-parity` or `markdown-source-mode-list-lift-parity`. Each of them was measured on 18.0.9, and `markdown-tab-column-parity` and `markdown-source-mode-list-lift-parity` both name this plan as the owner of the version question.

[^not-breaking]: A migration note is for a change an application has to act on. Here the declared version becomes the one this repository's applications already run, no API changes, and an application that resolved another 18.x before now resolves 18.0.9 on its next install of the library. That is a `## Changed` entry in the changelog. The reading changes that come with a newer `marked` are breaking, and the plan `marked-upgrade` writes their migration note.
