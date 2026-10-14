---
depends-on:
  - code-editor-flash-after-dispose
touches-shared:
  - packages/lib/package.json
  - package-lock.json
  - packages/lib/tests/component/display/Markdown.test.ts
  - packages/lib/tests/component/markdown-roundtrip/corpus/dialect.ts
  - packages/lib/docs/components/Markdown.md
  - packages/lib/docs/reference/changelog/next.md
---

# marked Version Pin and Guard — Implementation Plan

## Overview

The `Markdown` viewer and the `MarkdownEditor` both read a document through the `marked` parser. [packages/lib/package.json:222](packages/lib/package.json#L222) declares it as `"marked": "^18.0.5"`, a range that today admits eleven published versions, 18.0.5 to 18.1.0. The lockfile installs 18.0.9. The library build leaves `marked` out of `dist/lib` ([vite.lib.config.ts:99](packages/lib/vite.lib.config.ts#L99)), so the range in the published `package.json` decides which version an application gets.

That version changes what the library does. The library's 9,778 Markdown tests were run on each of the eleven versions, on commit `34d48e32c`:[^measured]

| `marked` | Failing tests | Who gets this version today |
|---|---|---|
| 18.0.5 – 18.0.8 | 2 | SQLAdmin's lockfile holds 18.0.6 |
| 18.0.9 | 0 | this repository's lockfile: tests, CI, the demo, docs and QA apps |
| 18.0.10 | 0 | nobody |
| 18.0.11, 18.0.12 | 40 | nobody |
| 18.0.13 | 41 | nobody |
| 18.0.14, 18.1.0 | 48 | a fresh `npm install` of the library resolves 18.1.0 |

This plan pins `marked` to exactly `18.0.10`, so every install of the library gets one tested version. It adds a unit test that fails when the installed `marked` is not the declared one, or when the declaration is a range again. No library source file changes.

18.0.10 reads three kinds of document differently from 18.0.9. Each new reading is the one CommonMark specifies, and the plan pins each with a test. `⏎` is a line end:

| Document | On 18.0.9 | On 18.0.10 |
|---|---|---|
| `` foo ⏎ ``` `` | one paragraph, `` foo ``` `` | the paragraph `foo`, then an empty code block |
| `foo ⏎ ~~~` | one paragraph, `foo ~~~` | the paragraph `foo`, then an empty code block |
| `*a*\🙂` | emphasis holding `a*`, then `🙂`; the backslash is lost | emphasis holding `a`, then the text `\🙂` |

Nothing else reads differently: of 669 measured documents these three are the only ones, and every other test of the library passes on 18.0.10 unchanged.

Moving to a newer `marked` is the plan [`marked-upgrade`](marked-upgrade.md), which starts from this one.

---

## Decisions (signed off 2026-10-14)

The repository's owner answered these on 2026-10-14. The plan is written for these answers.

| # | Question | Answer |
|---|---|---|
| 1 | Which version is pinned now? | **18.0.10.**[^why-18-0-10] |
| 2 | One exact version, or a narrow range? | **One exact version.**[^exact] |
| 3 | Is `marked` a dependency, a peer dependency, or bundled into `dist/lib`? | **A dependency, left out of the bundle**, as today.[^external] |
| 4 | Does the published 0.10.0 get a patch release with the pin? | **No.** The pin ships with the next release.[^no-patch] |
| 5 | When does this plan run? | **Before every other unstarted Markdown plan.**[^order] |

---

## Architecture Decisions

### `marked` is pinned to one exact version — 18.0.10

`packages/lib/package.json` declares `"marked": "18.0.10"`. The lockfile's `node_modules/marked` entry and its declaration line in the `packages/lib` entry change to match.[^why-18-0-10] [^exact]

| Declared | A fresh install gets | An application whose lockfile holds 18.0.6 gets |
|---|---|---|
| `^18.0.5` (before) | 18.1.0 today, and whatever 18.x is newest later | 18.0.6, kept because it satisfies the range |
| `18.0.10` (after) | 18.0.10 | 18.0.10, moved by the library update |

### `marked` stays a runtime dependency the build leaves out

Nothing changes in [vite.lib.config.ts:99](packages/lib/vite.lib.config.ts#L99): `marked` stays in the `external` list and in `dependencies`.[^external]

An application that depends on `marked` itself keeps working. When its own version is 18.0.10, npm installs one copy and both use it. When its version differs, npm installs a second copy under `node_modules/@jimka/typescript-ui/node_modules/marked`, and the library's imports resolve to that copy.[^two-copies]

### A unit test is the guard

A new test file, `packages/lib/tests/unit/marked-version.test.ts`, holds two tests:

- **MV1** — `dependencies.marked` in the library's `package.json` is one exact version.
- **MV2** — the `marked` in `node_modules` is that version.

The file reads both values with JSON imports. It mirrors [import-without-dom.test.ts:2](packages/lib/tests/unit/import-without-dom.test.ts#L2), which imports `../../package.json` the same way, and [readme-mirror.test.ts](packages/lib/tests/unit/readme-mirror.test.ts), which turns a silent drift between two files into a test failure.[^guard]

| Declared | Installed | MV1 | MV2 |
|---|---|---|---|
| `18.0.10` | 18.0.10 | passes | passes |
| `18.0.10` | 18.0.9 | passes | fails |
| `^18.0.10` or `~18.0.10` | 18.0.10 | fails | fails |

The test runs with the rest of the suite: locally through `npm run test`, in CI through [lib-tests.yml:17](.github/workflows/lib-tests.yml#L17), and at release through the `npm test --workspaces --if-present` line of [release-steps.md](release-steps.md). No workflow file changes.[^no-ci-step]

### The three new readings are pinned where their kind is pinned today

Two viewer tests go into `tests/component/display/Markdown.test.ts`, beside the tests of the same construct: `EM1` in `describe('Markdown emphasis'`, and `CF1` (for backticks and for tildes) in `describe('Markdown fenced code block'`. They follow the hard-break tests `HB4` and `HB6` of that file, which pin a CommonMark reading through the DOM writes the viewer makes and cite the specification's example.

Three rows go into the round-trip corpus, `tests/component/markdown-roundtrip/corpus/dialect.ts`, so the editor is checked to read, show and save each document as the viewer does. They pass on 18.0.9 and on 18.0.10.[^corpus-rows]

### Nobody but the orchestrator installs, and only at step 6

The implementer edits `packages/lib/package.json` and `package-lock.json` as text, in the worktree, and runs no npm command that installs. The orchestrator then installs 18.0.10 into the main tree's `node_modules`, with the owner's permission of 2026-10-14, at a moment when no other agent is running tests. Every worktree's `node_modules` is a symlink to that folder, so the one install is what every branch then runs on.[^install-step]

### The upgrade is a plan of its own

This plan does not move past 18.0.10. The plan `marked-upgrade` does, and lists what changes with it.[^upgrade-separate]

---

## Internal Structure

### `packages/lib/tests/unit/marked-version.test.ts`

The whole file:

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
            + 'the Markdown suites are verified on the declared version only';

        expect(installedMarked.version, message).toBe(DECLARED);
    });
});
```

`marked` exports its `package.json` (`"./package.json": "./package.json"` in its `exports` map), so the import needs no path into `node_modules`. The test program type-checks both JSON imports as it stands; no `tsconfig` change is needed.[^typecheck]

### The viewer tests, in `tests/component/display/Markdown.test.ts`

In `describe('Markdown emphasis'`, add after the test `builds <em> for *italic* with the text inside it`, as the last test of the `describe`:

```ts

    // A backslash before a character that is not ASCII punctuation is text (CommonMark 13). An emoji after the
    // closing `*` leaves that `*` a closing delimiter.
    it('EM1: emphasis before an escaped emoji holds only its text, and the backslash stays text after it', () => {
        new Markdown('*a*\\🙂').getElement(true);

        expect(childTagsOf('p')).toContain('EM');
        expect(textWrites()).toEqual(['a', '\\🙂']);
    });
```

In `describe('Markdown fenced code block'`, add after the test `wraps a supported-language fenced block in a ts-ui-md-code-host wrapper`, as the last test of the `describe`:

```ts

    // A code fence interrupts a paragraph (CommonMark 140), and an unclosed one runs to the end of the document (CommonMark 126).
    it.each(['```', '~~~'])('CF1: a %s fence alone on a paragraph\'s last line ends the paragraph and opens an empty code block', (fence) => {
        new Markdown(`foo\n${fence}`).getElement(true);

        expect(createdTags()).toEqual(expect.arrayContaining(['p', 'pre']));
        expect(textWrites()).toEqual(['foo', '']);
    });
```

### The corpus rows, in `tests/component/markdown-roundtrip/corpus/dialect.ts`

Add directly after the row `{ name: 'code fence holding a dash line', source: '```\n---\n```' },`:

```ts
    { name: 'code fence alone on the last line after a paragraph', source: 'foo\n```' },
    { name: 'tilde fence alone on the last line after a paragraph', source: 'foo\n~~~' },
    { name: 'emphasis before an escaped emoji', source: '*a*\\🙂 and x*ab*\\🙂y' },
```

---

## Ordered Implementation Steps

Work in the plan's worktree, `.worktrees/marked-version-pin-or-upgrade`. Its `node_modules` and `packages/lib/node_modules` are symlinks to the main tree's. Never run `npm install`, `npm ci` or `npm update`, in the worktree or anywhere else: step 6 is the only install, and the orchestrator runs it. Run commands from `packages/lib` unless a step says otherwise.

1. **Add the guard test.** Create `packages/lib/tests/unit/marked-version.test.ts` with the text in `## Internal Structure`, unchanged.
   - Check: `npx vitest run tests/unit/marked-version.test.ts` reports **2 failed**. MV1's message ends `expected '^18.0.5' to match /^\d+\.\d+\.\d+$/`. MV2's message starts `node_modules holds marked 18.0.9 but packages/lib/package.json declares ^18.0.5`.
   - Check: `npm run typecheck:test` exits 0.

2. **Add the viewer tests.** Make the two additions of `## Internal Structure`, *The viewer tests*.
   - Check: `npx vitest run tests/component/display/Markdown.test.ts` reports **3 failed**, all three new: `EM1` with `expected [ 'a*', '🙂' ] to deeply equal [ 'a', '\🙂' ]`, and both `CF1` rows with `expected [ 'div', 'p' ] to deeply equal ArrayContaining ["p", "pre"]`. These are 18.0.9's readings; they turn green at step 7.

3. **Add the corpus rows.** Make the addition of `## Internal Structure`, *The corpus rows*.
   - Check: `npx vitest run tests/component/markdown-roundtrip` reports 0 failed.

4. **Write the documentation.** Make the two edits in `## Documentation Impact`.

5. **Change the declared version, then stop.** From the worktree's root, run:

   ```sh
   sed -i 's/"marked": "\^18\.0\.5",/"marked": "18.0.10",/' packages/lib/package.json package-lock.json
   sed -i '/^    "node_modules\/marked": {$/,/^    },$/{s/"version": "18\.0\.9",/"version": "18.0.10",/;s#marked-18\.0\.9\.tgz#marked-18.0.10.tgz#;s#"integrity": "sha512-[^"]*"#"integrity": "sha512-FJeH4bRpYoXiggcgriCGItKCSv3xkngJc4QCZ/rkQCogU3VYaLxYJoZl8Nw/b4+x7iij/pd+09mZ6A1dXzpL0A=="#}' package-lock.json
   git diff -U0 -- packages/lib/package.json package-lock.json
   ```

   The result is the lockfile npm writes for this change.[^lock-edit]
   - Check: the diff shows one changed line in `packages/lib/package.json` (line 222, `"marked": "18.0.10",`) and four in `package-lock.json`: `"version": "18.0.10",`, `"resolved": "https://registry.npmjs.org/marked/-/marked-18.0.10.tgz",` and the new `"integrity"` of the `node_modules/marked` entry (lines 4390 to 4392), and `"marked": "18.0.10",` in the `packages/lib` entry (line 6056). When it shows anything else, stop and report what it shows.
   - Check, from `packages/lib`: `npx vitest run tests/unit/marked-version.test.ts` — MV1 passes; MV2 fails with `node_modules holds marked 18.0.9 but packages/lib/package.json declares 18.0.10`.
   - Then stop, and report to the orchestrator: "Ready for the marked 18.0.10 install (step 6)." Do not go on until the orchestrator says step 6 is done.

6. **The orchestrator installs 18.0.10 (owner's permission of 2026-10-14).** Not the implementer. The orchestrator runs this block at a moment when no other agent is running tests or a dev server, in any worktree:

   ```sh
   cd /home/jika/typescript/typescript-ui        # the main tree, on master
   git status --short -- package.json package-lock.json packages/lib/package.json    # must print nothing
   npm install marked@18.0.10 --save-exact -w packages/lib --dry-run
   npm install marked@18.0.10 --save-exact -w packages/lib
   git diff -U0 -- package-lock.json packages/lib/package.json
   node -p "require('marked/package.json').version"
   git checkout -- package-lock.json packages/lib/package.json
   ```

   - Check: the dry run names `marked` (18.0.9 to 18.0.10) and no other package. When it names any other package, do not run the install; report to the owner.
   - Check: the diff shows the declaration line of `packages/lib/package.json` and, in `package-lock.json`, the three lines of the `node_modules/marked` entry and the declaration line of the `packages/lib` entry, exactly as step 5's diff shows them. One more line may change: `"dev": true,` becoming `"devOptional": true,` in the `node_modules/typescript` entry, which npm 11.12.1 writes on any install.[^lock-edit] Any other changed line: report to the owner before going on.
   - Check: `node -p` prints `18.0.10`.
   - The last command puts master's two files back. The main tree's `node_modules` keeps 18.0.10; master gets the declaration when the branch is merged.[^install-step]
   - Then tell the implementer that step 6 is done.

7. **Run the guard and the viewer tests again.** `npx vitest run tests/unit/marked-version.test.ts tests/component/display/Markdown.test.ts` reports 0 failed.

8. **Run the full checks** in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/tests/unit/marked-version.test.ts` |
| Modify | `packages/lib/tests/component/display/Markdown.test.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/dialect.ts` |
| Modify (step 5, by `sed`) | `packages/lib/package.json` |
| Modify (step 5, by `sed`) | `package-lock.json` |
| Modify | `packages/lib/docs/components/Markdown.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

The main tree's `node_modules` changes at step 6, by the orchestrator. It is not part of the branch.

---

## Expected Behaviour

Unit-tested:

| ID | Case | On 18.0.9 | On 18.0.10 |
|---|---|---|---|
| MV1 | `dependencies.marked` is `18.0.10` | passes | passes |
| MV1 | `dependencies.marked` is `^18.0.5`, `~18.0.10`, `>=18.0.9 <18.0.11`, `latest` or `18.x` | fails, and the message names `packages/lib/package.json` | fails the same way |
| MV2 | the declaration is `18.0.10` | fails, and the message holds both versions | passes |
| EM1 | `*a*\🙂` in the viewer | fails: the writes are `a*`, `🙂` | passes: emphasis holding `a`, then the text `\🙂` |
| CF1 | `` foo ⏎ ``` `` and `foo ⏎ ~~~` in the viewer | fails: one paragraph, no `pre` | passes: the paragraph `foo`, then an empty code block |
| corpus | the three new rows: the editor shows what the viewer shows, saves the document unedited byte for byte, and its save reads back the same | passes | passes |

Every other test of the library passes on 18.0.10 unchanged.[^measured]

Nothing needs manual verification: no rendering, focus or pointer behaviour changes beyond what the viewer tests read from the DOM writes.

---

## Verification

Run from the worktree's root unless a line says otherwise.

- `npm run test` — `typecheck:test`, then the whole library suite. Expect 0 failed, and 29 more tests than the branch's parent: MV1, MV2, EM1, two `CF1` rows, seven round-trip checks for each of the three corpus rows, and one edit-fuzz test for each.[^counts]
- `npm run typecheck` and `npm run lint` — no source file changed; both pass as before.
- `git status --short` — exactly the seven paths of `## Files to Create / Modify / Delete`.
- `grep -n '"marked"' packages/lib/package.json` — one line, `"marked": "18.0.10",`.
- `grep -n -A3 '"node_modules/marked"' package-lock.json` — `"version": "18.0.10"`.
- `node -p "require('marked/package.json').version"` — `18.0.10`.
- `npm run docs:llms:check` — unchanged; no public symbol moved.

No browser check is needed: the viewer tests read the same DOM writes a browser receives.[^no-docs-app]

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
   - **`marked` is pinned to exactly 18.0.10.** The library declared
     `^18.0.5`, so a fresh install resolved the newest 18.x, and an
     application with an older lockfile kept an older one. `marked`'s patch
     releases change how a document reads, so the same document could read
     differently in two applications: of the eleven versions the range
     admitted, the library's Markdown tests pass on two. The library now
     declares a version it is tested on. Two readings change from 18.0.9,
     both to what CommonMark specifies: a code fence alone on a paragraph's
     last line (`foo` then ```` ``` ````) ends the paragraph and opens an
     empty code block, and emphasis followed by a backslash and an emoji
     (`*a*\🙂`) holds only its text, with the backslash shown. No consumer
     action is needed; an application that depends on `marked` itself at
     another version gets a second copy beside the library's.
   ```

`packages/lib/docs/reference/migration/next.md` is not touched.[^not-breaking] `packages/lib/THIRD-PARTY-NOTICES.md` lists `marked` without a version and is not touched.

---

## Potential Challenges

- **A worktree shares the main tree's `node_modules`.** From step 6 on, every branch runs on 18.0.10, including branches that still declare `^18.0.5`. That was measured as harmless: on 18.0.10, every test of the base passes, and the held branch `markdown-editor-raw-block-range-edits` fails the same 43 tests it fails on 18.0.9.[^measured]
- **The `sed` commands find no line, or more than one.** That means `package.json` or the lockfile changed since this plan was measured. Step 5's checks catch it; the implementer stops and reports.
- **Running npm in a worktree.** A worktree's `node_modules` is a symlink to the main tree's, and npm writes through it: even `npm install --package-lock-only` writes `node_modules/.package-lock.json` there. That is why step 5 uses `sed`.
- **A dev server started before step 6.** Vite may keep serving its pre-bundled copy of 18.0.9. Restart any demo or docs dev server after step 6, with `--force` if a page still reads the old way.
- **SQLAdmin's notices.** SQLAdmin's `THIRD-PARTY-NOTICES.md` lists `marked` 18.0.6. Its lockfile moves to the library's pinned version when it takes the next library release, and that row must follow. Nothing in this plan writes to the SQLAdmin repository.
- **A later dependency sweep.** A sweep that rewrites every range to `^latest` turns MV1 red. The comment at the top of the test file says why the pin exists and what moving it takes.

---

## Critical Files

- [packages/lib/tests/unit/import-without-dom.test.ts](packages/lib/tests/unit/import-without-dom.test.ts) — the precedent for a test that imports `../../package.json` (line 2). Mirror its import form.
- [packages/lib/tests/unit/readme-mirror.test.ts](packages/lib/tests/unit/readme-mirror.test.ts) — the precedent for a drift guard: a header comment that says what drifted before and why the test exists.
- [packages/lib/tests/component/display/Markdown.test.ts](packages/lib/tests/component/display/Markdown.test.ts) — the helpers `createdTags`, `textWrites` and `childTagsOf` (lines 29 to 72), and the hard-break tests `HB4` and `HB6` (lines 323 and 336), the precedent for a viewer test that pins a CommonMark reading.
- [packages/lib/tests/component/markdown-roundtrip/corpus/dialect.ts](packages/lib/tests/component/markdown-roundtrip/corpus/dialect.ts) — the corpus; line 119 holds the row the new rows follow.
- [packages/lib/package.json](packages/lib/package.json) — line 222 holds the declaration; line 182 holds `"typedoc": "0.28.19"`, the repository's existing exact pin.
- [packages/lib/vite.lib.config.ts](packages/lib/vite.lib.config.ts) — line 99, the `external` list that keeps `marked` out of `dist/lib`. Read only.
- [packages/lib/src/typescript/lib/component/display/markdownExtensions.ts](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts) — where the library reaches into `marked`'s tokenizer, rules and lexer state. Read only.
- [release-steps.md](release-steps.md) — the release checklist whose test line runs the guard. Read only.

---

## Non-Goals

- **Moving past 18.0.10.** The plan `marked-upgrade` owns it.[^upgrade-separate]
- **A runtime check inside the library.** `marked` exports no version at runtime, and an exact declaration already decides what an install resolves.[^no-runtime-check]
- **A CI job that runs the tests on the newest `marked`.** With an exact pin there is no newer version in range to test; 48 tests fail on the newest today, so such a job could only be red.[^no-ci-step]
- **Pinning other dependencies.** `lexical`, the CodeMirror packages and `@lezer/markdown` keep their ranges. Nothing was measured for them here.
- **Writing to the SQLAdmin repository.** Its lockfile and notices follow when it takes the next library release.
- **A patch release of 0.10.x.** See decision 4.

---

## Addendum: Measured

The test counts were measured on commit `34d48e32c` (the tip of `feature/markdown-editor-typing-shortcuts-only-for-typing`) in a private copy of the repository outside every worktree. The copy had a `node_modules` of its own, whose `marked` folder was replaced by each published version in turn; nothing was installed into the main tree or a worktree. A probe confirmed in each run that the library lexed through the version in place. The scripts and outputs are kept under `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans4/marked-revision/`. Measurements that do not depend on the library's tests (the build output, upstream's changes, CommonMark, timings) were taken on commit `75d022ba1` and are kept under `scratch-keep/plans3/marked-version/`.

### Is `marked` bundled?

No. The library ships one build output, `dist/lib` (`"files"` in [packages/lib/package.json:134](packages/lib/package.json#L134)), in one format (`formats: ['es']`, [vite.lib.config.ts:75](packages/lib/vite.lib.config.ts#L75)). A build gave:

| Built file | How it gets `marked` |
|---|---|
| `dist/lib/markdownExtensions-*.js` | `import{Marked as e,Tokenizer as t}from"marked"` |
| `dist/lib/component/editor.es.js` | `import{Lexer as Ue}from"marked"` |
| six `.d.ts` files under `dist/lib/types/component/` | `import type … from "marked"` |
| every other file | does not use it |

No `marked` code is inlined: none of its rule names (`emStrongLDelim`, `reflinkSearch`) occurs in any built file. A build of `34d48e32c` with 18.0.10 in place still imports `marked` from those two files.

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

The two tests of the last row are also the two that fail on 18.0.5 to 18.0.8. They pin a defect that only 18.0.9 to 18.0.13 have: "Fix spurious deeper nesting in a blockquote continuation" (#4030, 18.0.9) made `marked` drop the line `b` of `> > ``` ⏎ > > a ⏎ > > ``` ⏎ b`, and #4101 brought it back. On `34d48e32c` the same 2, 40, 41 and 48 tests fail on the same versions.

18.1.0 adds no failure over 18.0.14. The whole library suite of `34d48e32c` (19,592 tests) passes on 18.0.10 and fails only these 48 on 18.1.0.

### What 18.0.10 changes

Upstream's 18.0.10 holds three fixes: "parse EOF backtick fences after paragraphs" (#4039), "keep the em/strong mask the same length as the source" (#4044) and "place task checkboxes after list loose is finalized" (#4046). The round-trip harness's checks were run on 669 documents on 18.0.9 and on 18.0.10: the 492 corpus documents of `34d48e32c`, 66 documents from the test fixtures upstream added with its fixes, and the 111 tab documents of the plan `markdown-tab-column-parity`.

| Compared with 18.0.9 | 18.0.10 |
|---|---|
| Documents the viewer reads differently | 3, all upstream fixtures: the two fence documents of #4039 and the emphasis document of #4044 |
| Corpus documents the viewer reads differently | 0 |
| A rule that held on 18.0.9 and no longer does (editor shows what the viewer shows, save reloads, unedited block saved byte for byte, standard-form save) | 0 |
| An unedited document saved in other bytes | 0 |

The #4046 fix changes the tokens of two task-list documents and not what the viewer shows. The emphasis fix covers every character outside the Basic Multilingual Plane after a closing delimiter:

| Document | 18.0.9 | 18.0.10 |
|---|---|---|
| `*a*\🙂` | emphasis `a*`, text `🙂` | emphasis `a`, text `\🙂` |
| `x*ab*\🙂y` | `x`, emphasis `ab*`, `🙂y` | `x`, emphasis `ab`, `\🙂y` |
| `__a__\🙂b` | strong `a_`, `🙂b` | strong `a`, `\🙂b` |
| `~~a~~\🙂` | struck `a~`, `🙂` | struck `a`, `\🙂` |
| `*foo\🙂bar*` | emphasis `foo\🙂bar` | the same |

The fence fix covers a paragraph of any length and a fence with an info string (`foo ⏎ ```js` gives an empty `js` block), and inside a quote (`` > foo ⏎ > ``` `` gives the paragraph and an empty code block inside the quote). Inside a list item the reading was already the new one on 18.0.9.

### The round-trip rules on each version

The checks were also run on the 608 documents of the earlier base for every version:

| Compared with 18.0.9 | 18.0.5 | 18.0.6 | 18.0.7, 18.0.8 | 18.0.10 | 18.0.11 | 18.0.12 | 18.0.13 | 18.0.14 | 18.1.0 |
|---|---|---|---|---|---|---|---|---|---|
| Documents the viewer reads differently | 9 | 7 | 3 | 3 | 14 | 21 | 43 | 69 | 71 |
| Viewer and editor read the same on 18.0.9, and no longer do | 3 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| A save that reloaded on 18.0.9, and no longer does | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| An unedited document saved in other bytes | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

So a document that is only loaded and saved keeps the stack's rules on every version from 18.0.9 up; what moves is the reading, for the viewer and the editor together. The one document SQLAdmin's 18.0.6 reads differently in the viewer and the editor is `> foo ⏎ - ⏎⏎ > foo ⏎ > bar ⏎ 1.`.

Text typed into the editor is a different matter. 19,893 strings were each put into a paragraph, saved, and read back by the viewer. On 18.0.9 and on 18.0.10, 18,839 read back as typed. On 18.1.0, 3,378 of those no longer do, and every one of them holds a numeric character reference such as `&#35;`. This is the case test E10 of `markdown-serializer.test.ts` catches, and the plan `marked-upgrade` fixes it in the serializer.

### Which reading is the correct one

Of the 71 documents whose reading differs between 18.0.9 and 18.1.0, `marked`'s output moves onto `commonmark.js` 0.31.2's on 56, matched it before and after on 7, and matches it neither before nor after on 8. None moves away. Of the 3 that change on 18.0.10, the two fence documents move onto `commonmark.js`; the emphasis document is in the "neither" group because it holds GFM strikethrough, which CommonMark does not have.

Of the 652 examples of the CommonMark 0.31.2 specification, `marked` alone renders 628 as the specification does on 18.0.5 to 18.0.10, 632 on 18.0.11, 640 on 18.0.12 and 646 on 18.0.13 to 18.1.0. No example that passes on one version fails on a later one.

### What staying on 18.0.10 costs

Two things, both removed by the plan `marked-upgrade`:

- **A line that is not shown.** For `> > ``` ⏎ > > a ⏎ > > ``` ⏎ b`, versions 18.0.9 to 18.0.13 give the line `b` no token, so the viewer shows nothing for it. Upstream introduced this in 18.0.9 and fixed it in 18.0.14.
- **Slow documents.** Three of the documents upstream wrote to catch slow regular expressions, lexed by `marked` alone:

  | Document | 18.0.9 | 18.0.10 | 18.1.0 | Fixed by |
  |---|---|---|---|---|
  | 250,781 characters of footnote-like definitions | 12.6 s | 12.6 s | 76 ms | #4040 (18.0.11) |
  | 406,792 characters of nested reference definitions | 12.5 s | 12.4 s | 93 ms | #4040 (18.0.11) |
  | `[](` followed by 50,000 no-break spaces | stopped after 20 s | stopped after 25 s | 5 ms | #4106 (18.1.0) |

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

[^measured]: The 9,778 tests are the 30 library test files whose path holds "markdown", run with Vitest on commit `34d48e32c`. The whole library suite of that commit, 19,592 tests in 589 files, passes on 18.0.10. The held branch `markdown-editor-raw-block-range-edits` (tip `2a7c8bc9c`, 11,192 Markdown tests) fails 43 of its own tests on 18.0.9 and the same 43 on 18.0.10. `## Addendum: Measured` holds the method, the cause of every failure and the comparison of the round-trip checks.

[^why-18-0-10]: The owner chose 18.0.10 over 18.0.9, the version the lockfile installs. Both pass every test of the library. 18.0.10 adds three upstream fixes: two of them change what three kinds of document read as, each to the CommonMark reading, and the third changes tokens only. Pinning 18.0.10 needs a lockfile change and an install, which steps 5 and 6 make. 18.0.10 keeps the two costs 18.0.9 has, the dropped line and the slow documents of `## Addendum: Measured`; the plan `marked-upgrade` removes them.

[^exact]: `marked` releases its parsing fixes as patch versions, and each one changes what some document reads as: of the eleven versions `^18.0.5` admits, the tests pass on two. A tilde range (`~18.0.10`) admits 18.0.11 to 18.0.14 and so all five breaking changes. The library also reaches into parts of `marked` that are not its documented extension points and can change in any release: `Tokenizer.prototype.list`, `.blockquote`, `.html`, `.hr` and `.lheading`, `this.rules.other.listReplaceTask`, `this.rules.block.blockquote`, the lexer's `inlineQueue`, `state.top` and `tokens.links` ([markdownExtensions.ts:373](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L373), lines 387, 468, 475, 503, 677), and `Lexer.rules.block.gfm.def` and two inline rules ([markdownImporter.ts:81](packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L81)). A range also drifts in both directions: a fresh install takes the newest version, while an application whose lockfile already holds an older one keeps it, as SQLAdmin's holds 18.0.6. The repository has an exact pin already, for the same kind of reason: `"typedoc": "0.28.19"` ([package.json:8](package.json#L8)), kept by commit `034b03039` because newer releases break the docs toolchain.

[^external]: The build keeps every runtime dependency out of `dist/lib`: `marked`, the CodeMirror packages, the Lexical packages, `prettier`, `sql-formatter` and `elkjs` are all in the `external` list of `vite.lib.config.ts`. Bundling `marked` alone would be a new pattern for one package. `marked` is MIT-licensed, so the project's rule against vendoring third-party code under a restrictive licence would not forbid it; the reason to keep it external is the build pattern, plus that an exact declaration already gives the same determinism. A peer dependency would push the exact version onto every application's own `package.json` and fail their install on a mismatch, for a package most of them never import.

[^two-copies]: The library lexes through an instance of its own, `new Marked({ … })` ([markdownExtensions.ts:602](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L602)), and never calls `use()` on `marked`'s shared default instance, so a second copy and the library's copy do not affect each other. `marked`'s ESM build is about 43 kB before compression; that is the cost of the second copy in such an application's bundle. An application that forces one version for both, with npm `overrides` or a bundler alias, runs the library on a version it is not tested on; that is the application's choice and nothing in the library detects it.

[^guard]: A constant in the test that names "the verified version" was considered and dropped: it would be a third place to change on an upgrade, and the declaration in `package.json` already is the record of what the suite is verified on. With the declaration exact, "the installed version equals the declared one" is the whole guard. The case MV2 exists for is a `node_modules` that does not match the branch's `package.json`: every worktree of this repository symlinks its `node_modules` to the main tree's, so a branch can run on a `marked` its own `package.json` does not declare, and without the test that shows up as dozens of unrelated Markdown failures. Between steps 5 and 6 it is also the signal that the install is still owed.

[^typecheck]: `npx tsc -p tsconfig.test.json --noEmit` was run with the file in place and reported no error. The test program is free of Node's types on purpose (see the header of `tests/helpers/readReadmes.mjs`), which is why the file uses JSON imports and not `node:fs`.

[^corpus-rows]: A corpus row checks the round-trip rules, not the reading itself, so it is green on both versions and gives no red step. The viewer tests give that step, and the rows check that the editor follows the viewer's new reading: measured on 18.0.9, 18.0.10 and 18.1.0, each of the three rows passes its seven checks and the edit fuzz.

[^install-step]: The owner's rule is that no agent runs `npm install`, `npm ci` or `npm update`: every worktree's `node_modules` is a symlink to the main tree's, so an install changes what every branch runs on. The owner permitted the orchestrator, on 2026-10-14, to run this one install, limited to `marked`. It runs in the main tree because that is the folder every worktree reads. The main tree is on `master`, so `npm install` also rewrites master's `packages/lib/package.json` and `package-lock.json`; the orchestrator puts them back, and the change reaches `master` when the branch is merged. Master's lockfile and the branch's list the same 424 packages (they differ only in the declaration of `@lexical/clipboard`, which is installed either way as a dependency of another Lexical package), so the install leaves the same tree it would leave from the branch's manifests. The dry run is there to catch the case where it would not: npm would then list packages it adds or removes.

[^lock-edit]: Tried on copies of the repository's manifests outside the repository, with no `node_modules`: `npm install marked@18.0.10 --save-exact -w packages/lib --package-lock-only` wrote the same `packages/lib/package.json` as the first `sed` command, byte for byte, and the same `package-lock.json` as both `sed` commands but for one line: npm 11.12.1 rewrites `"dev": true,` as `"devOptional": true,` in the `node_modules/typescript` entry. It writes that line with no package requested at all, so it is not part of the `marked` change, and the branch leaves it out. The lockfile's other `"version": "18.0.9"` strings belong to no `marked` entry; the second `sed` command only edits lines between `"node_modules/marked": {` and the entry's closing `},`. CI's `npm ci` fails when the lockfile and `package.json` disagree, so a wrong edit cannot pass CI.

[^upgrade-separate]: Moving to 18.1.0 changes 48 tests, one line of the serializer, a function for reference labels, corpus rows, documentation pages, and what an application's users see for several kinds of document. It needs decisions of its own and a migration note. Keeping it out lets this plan land first with only the three readings above.

[^no-ci-step]: The existing workflow installs with `npm ci`, which fails by itself when the lockfile and `package.json` disagree, and then runs the suite that now holds MV1 and MV2. A separate job that installs the newest `marked` and runs the Markdown tests was considered. With an exact pin no newer version is ever in range, so the job would test a version no install can resolve, and it would be red from its first run. What the newest version changes is listed, once, in the plan `marked-upgrade`.

[^no-runtime-check]: A check at import time would need `marked`'s version, which `marked` does not export; reading `marked/package.json` from library code would put a JSON import of a dependency's manifest into `dist/lib` for every application's bundler to resolve.

[^no-patch]: The published 0.10.0 cannot be changed; a patch would be a new 0.10.1. Its code is from before the Markdown stack: its 572 Markdown tests pass on 18.0.6, 18.0.9 and 18.1.0 alike, so no test shows it broken on any version an install can resolve. What its viewer shows still follows the installed `marked`, as it always has.

[^order]: The plans `markdown-viewer-stale-code-upgrade-kickoff` and `code-editor-flash-after-dispose` land before this one; they change no Markdown reading. This plan was measured on `34d48e32c`, below both. Neither touches a file this plan edits but `changelog/next.md`, where each adds bullets of its own; the stale-kickoff plan's tests are in a file of their own, `MarkdownStaleCodeUpgrade.test.ts`. Of the unstarted plans, `markdown-editor-table-command-fixes` and `marked-upgrade` also edit `corpus/dialect.ts`, at other rows, and `table-cell-alignment-override` adds tests to `Markdown.test.ts`; none of them changes the rows or tests this plan adds. Each unstarted Markdown plan was measured on 18.0.9; none of them names a document that reads differently on 18.0.10. `markdown-tab-column-parity` and `markdown-source-mode-list-lift-parity` both name this plan as the owner of the version question.

[^not-breaking]: A migration note is for a change an application has to act on. Here no API changes, an application that resolved another 18.x before now resolves 18.0.10 on its next install of the library, and the two readings that change are CommonMark's, for input that read wrongly before. That is a `## Changed` entry in the changelog. The plan `marked-upgrade` ships in the same release, replaces this bullet, and lists these two readings in its migration note with its own.

[^counts]: On `34d48e32c` the whole suite holds 19,592 tests and, with this plan, 19,621; `Markdown.test.ts` goes from 242 to 245 tests, `markdown-roundtrip.test.ts` from 3,583 to 3,604 and `markdown-edit-fuzz.test.ts` from 1,901 to 1,904. The branches that land between `34d48e32c` and this plan add tests of their own, so compare with the branch's parent, not with these totals.

[^no-docs-app]: The docs app renders the library's pages through the viewer. Its suite (2,615 tests) and its type check were run on 18.0.10 in the drafting copy, against a `dist/lib` built there, and pass. In a worktree that check does not test the branch: the workspace link `node_modules/@jimka/typescript-ui` leads to the main tree's `packages/lib`, whatever the worktree holds.
