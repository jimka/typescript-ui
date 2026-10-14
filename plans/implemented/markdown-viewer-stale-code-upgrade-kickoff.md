---
depends-on: [markdown-language-readonly-and-fences]
touches-shared:
  - packages/lib/src/typescript/lib/component/display/Markdown.ts
  - packages/lib/docs/reference/changelog/next.md
---

# Markdown Viewer Stale Code Upgrade Kickoff — Implementation Plan

## Overview

The `Markdown` viewer logs `Layout flush: an afterNextLayout callback threw … DOM handle N is not registered (released or never minted)` when its text is replaced twice before one layout flush. A *layout flush* is the pass the library runs once per animation frame: it lays out every component that asked for layout, then runs the callbacks queued with `Component.afterNextLayout`. The error was first seen while typing fast into the "MD Editor" demo, whose editor feeds a live `Markdown` preview on every change.

The cause is in [packages/lib/src/typescript/lib/component/display/Markdown.ts:1350](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1350). Four terms are used throughout this plan:

- A *handle* is the library's opaque id for one DOM element. The *handle registry* in `core/DOM.ts` maps each handle to its element; `DOM.sink.release(handle)` removes the entry.
- A *render* is one build of the viewer's content from a source string: the first build, or one `setMarkdown` call on a viewer whose element exists. Each render has a number, `_renderGeneration`.
- A *kickoff* is the deferred callback `appendCode` registers for each fenced block in a supported language. The kickoff starts that block's upgrade from a plain `<pre>` to a highlighted `CodeEditor`.
- A *stale* kickoff is one whose render has been replaced by a later `setMarkdown`, or whose viewer has been disposed, before the kickoff ran.

`setMarkdown` and `dispose` release every handle of the render they replace. A stale kickoff still runs later and reads its block's released handle, and the handle registry throws on that read by design. The fix makes a kickoff compare its render number first and do nothing when the number is no longer current. The change is one guard in `Markdown.ts`, one new test file, and one changelog bullet. No public API changes.

The defect is in the viewer alone. `MarkdownEditor`, `MarkdownDocumentPanel`, `CodeEditor` and source mode are not involved.[^not-source-mode]

---

## Architecture Decisions

### A kickoff checks its render number before it touches anything

`startCodeEditorImport` returns at once when `entry.generation !== this._renderGeneration`. The same class already makes the same check, with the same number, one step later: `loadCodeEditorUpgrade` at [Markdown.ts:1572](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1572). `DiagramView.applyLayout` at [DiagramView.ts:879](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L879) is the pattern both mirror.[^at-consumer]

### One check, at the top of `startCodeEditorImport`

The check goes in `startCodeEditorImport` and nowhere else. Every stale entry enters through `startCodeEditorImport`, so the viewer's three queues (`_awaitingVisibilityKickoffs`, `_awaitingViewportKickoffs`, `_pendingCodeUpgrades`) and their readers (`onEffectiveVisibilityChange`, `onViewportPass`, `flushPendingCodeUpgrades`) need no check of their own.[^one-check]

### `Component.afterNextLayout`, `Component.onFirstLayout` and the handle registry stay as they are

No file under `core/` changes. A kickoff that is stale because its render was replaced belongs to a viewer that is still alive, so dropping callbacks of disposed owners in `afterNextLayout` would not fix the main case. The registry's throw on a released handle is the signal that found this defect.[^core-unchanged]

### The flush keeps catching and reporting a throwing callback

`flushPendingLayouts` runs each `afterNextLayout` callback in its own `try`/`catch` and reports a throw through `console.error` and the `Diagnostics` "Layout errors" count ([Component.ts:322-328](packages/lib/src/typescript/lib/core/Component.ts#L322)). That behaviour is what the library wants and this plan does not change it.[^report-stays]

### The tests drive a real layout flush, in a new test file

The new cases live in `packages/lib/tests/component/display/MarkdownStaleCodeUpgrade.test.ts`, not in `Markdown.test.ts`. They capture `DOM.sink.requestAnimationFrame` from the first line of each test and run the captured frame, the way `tests/core/AfterNextLayout.test.ts` and `tests/core/LayoutFlushIsolation.test.ts` do.[^own-file]

### The branch goes on the Markdown stack

The branch starts from the tip of the unmerged Markdown stack (`feature/markdown-language-readonly-and-fences`, or a later branch of that stack if one exists by then). The code change itself does not depend on the stack.[^stack]

---

## Internal Structure

### How a kickoff becomes stale

`appendCode` ([Markdown.ts:1940](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1940)) builds each fenced block and ends with:

```ts
const entry: QueuedCodeUpgrade = { wrapper, pre, code, text: token.text, languageId, generation: this._renderGeneration };

this.onFirstLayout(() => this.startCodeEditorImport(entry));
```

`onFirstLayout` ([Component.ts:8101](packages/lib/src/typescript/lib/core/Component.ts#L8101)) puts the callback in one of two queues. Neither queue is emptied when the viewer rebuilds its content.

| Viewer's element when `appendCode` runs | Queue the kickoff lands in | When the kickoff runs |
|---|---|---|
| connected to the document | the library-wide `afterNextLayout` queue | on the next layout flush, whatever happens to the viewer in between |
| created but not connected | the viewer's own first-layout queue | at the end of the viewer's first layout while connected |

`clearContent` ([Markdown.ts:1169](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1169)) runs at the start of every `setMarkdown` and from `destructor`. It releases every content handle, adds one to `_renderGeneration`, and empties the viewer's own three queues (`_awaitingVisibilityKickoffs`, `_awaitingViewportKickoffs`, `_pendingCodeUpgrades`). It cannot reach the two queues in the table.

A stale kickoff therefore still calls `startCodeEditorImport(entry)` with `entry.wrapper` released. What happens next depends on whether the viewer is *effectively visible*, which means the viewer and every ancestor are visible and displayed (`isEffectivelyVisible()`):

| Viewer when the stale kickoff runs | What `startCodeEditorImport` does today | Result |
|---|---|---|
| effectively visible | calls `isBlockNearViewport(entry.wrapper)`, which reads the released handle ([Markdown.ts:1381](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1381)) | throws |
| not effectively visible | pushes the stale entry onto `_awaitingVisibilityKickoffs` ([Markdown.ts:1352](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1352)) | no throw yet; the throw comes later, from `onEffectiveVisibilityChange`, when the viewer is shown |

### The fix

In `startCodeEditorImport`, before the visibility test:

```ts
    private startCodeEditorImport(entry: QueuedCodeUpgrade): void {
        if (entry.generation !== this._renderGeneration) {
            // A later setMarkdown() (or disposal, which also bumps the
            // generation) rebuilt since this block was queued. clearContent
            // released entry.wrapper, so the viewport read below would throw,
            // and the visibility queue must not hold an entry of a render that
            // is gone.
            return;
        }

        if (!this.isEffectivelyVisible()) {
```

The rest of the function is unchanged.

### The test harness

The new test file starts with this setup. Every helper below is used by the cases in `## Expected Behaviour`.

```ts
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// Coverage for a fenced block's deferred CodeEditor kickoff outliving the
// render that queued it (plans/markdown-viewer-stale-code-upgrade-kickoff.md,
// cases K1-K9).
//
// The offline sink's `requestAnimationFrame` is a no-op recorder, so these
// spy on it to drive the layout flush — the same shim `AfterNextLayout.test.ts`
// and `LayoutFlushIsolation.test.ts` use. `loadCodeEditorUpgrade` is stubbed,
// so no test loads CodeMirror: a started import is one recorded call.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Markdown } from '~/component/display/Markdown';
import { Component } from '~/core/Component';
import { Container } from '~/core/Container';
import { Diagnostics } from '~/core/Diagnostics';
import { DOM } from '~/core/DOM';
import { Fit } from '~/layout/Fit';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

const FENCE_A = 'para\n\n```js\nlet a = 1;\n```\n';
const FENCE_B = 'para\n\n```js\nlet b = 2;\n```\n';

describe('Markdown fenced code block — a kickoff that outlived its render', () => {
    let frames: Array<FrameRequestCallback>;
    let connected: boolean;
    let errorSpy: ReturnType<typeof vi.spyOn>;
    let loadSpy: ReturnType<typeof vi.spyOn>;
    let layoutErrorsBefore: number;

    beforeEach(() => {
        installTestDOM(CONFIG);
        frames = [];
        connected = true;
        vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
            frames.push(cb);

            return frames.length;
        });
        vi.spyOn(DOM.source, 'isConnected').mockImplementation(() => connected);
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        loadSpy = vi.spyOn(Markdown.prototype as any, 'loadCodeEditorUpgrade').mockImplementation(() => Promise.resolve());
        layoutErrorsBefore = Diagnostics.counters().layoutErrors;
    });

    afterEach(() => {
        settle();
        vi.restoreAllMocks();
        DOM.reset();
    });

    /** Invokes every animation-frame callback captured since the last flush. */
    function flushFrame(): void {
        const pending = frames;
        frames = [];

        for (const cb of pending) {
            cb(0);
        }
    }

    /** Flushes until no frame is pending, so the next test starts with an idle queue. */
    function settle(): void {
        while (frames.length > 0) {
            flushFrame();
        }
    }

    /** A viewer inside a sized host, laid out once while connected. */
    function mounted(source: string, options?: { displayed?: boolean }): Markdown {
        const host = new Container({ layoutManager: new Fit() });
        const md = new Markdown(source, options);

        host.addComponent(md);
        host.getElement(true);
        host.setWidth(600).setHeight(400);
        host.scheduleLayout();
        settle();
        loadSpy.mockClear();

        return md;
    }

    /** The fenced block text of every started import, in call order. */
    function loadedTexts(): string[] {
        return loadSpy.mock.calls.map((call: unknown[]) => call[3] as string);
    }

    /** Asserts the batched flush reported no failure, on the console or on Diagnostics. */
    function expectNoFlushFailure(): void {
        expect(errorSpy).not.toHaveBeenCalled();
        expect(Diagnostics.counters().layoutErrors).toBe(layoutErrorsBefore);
    }
```

Five of the nine cases are written out here because their order of statements matters. The other four follow the form of K2.

```ts
    it('K2: two renders before one flush start only the second render\'s block', () => {
        const md = mounted('hello');

        md.setMarkdown(FENCE_A);
        md.setMarkdown(FENCE_B);
        flushFrame();

        expect(loadedTexts()).toEqual(['let b = 2;']);
        expectNoFlushFailure();
    });

    it('K6: a hidden viewer rendered twice keeps one waiting block and starts it when shown', () => {
        const md = mounted('hello', { displayed: false });
        const anyMd = md as any;
        const measureSpy = vi.spyOn(anyMd, 'scheduleContentMeasure');

        md.setMarkdown(FENCE_A);
        md.setMarkdown(FENCE_B);
        flushFrame();

        expect(anyMd._awaitingVisibilityKickoffs.map((entry: { text: string }) => entry.text)).toEqual(['let b = 2;']);
        expect(loadedTexts()).toEqual([]);

        measureSpy.mockClear();
        md.setDisplayed(true);

        expect(() => Component.flushEffectiveVisibility()).not.toThrow();
        expect(loadedTexts()).toEqual(['let b = 2;']);
        expect(anyMd._awaitingVisibilityKickoffs).toHaveLength(0);
        expect(measureSpy).toHaveBeenCalled();
        expectNoFlushFailure();
    });

    it('K7: a viewer rendered twice before it is connected starts only the second render\'s block', () => {
        connected = false;

        const host = new Container({ layoutManager: new Fit() });
        const md = new Markdown(FENCE_A);

        host.addComponent(md);
        host.getElement(true);
        md.setMarkdown(FENCE_B);
        settle();

        expect(loadedTexts()).toEqual([]);

        connected = true;
        host.setWidth(600).setHeight(400);
        host.scheduleLayout();
        settle();

        expect(loadedTexts()).toEqual(['let b = 2;']);
        expectNoFlushFailure();
    });

    it('K8: a stale entry handed to startCodeEditorImport reads no handle and queues nothing', () => {
        const md = mounted('hello');
        const anyMd = md as any;
        const startSpy = vi.spyOn(anyMd, 'startCodeEditorImport');

        md.setMarkdown(FENCE_A);
        flushFrame();

        const staleEntry = startSpy.mock.calls[0]![0];

        md.setMarkdown('plain');
        loadSpy.mockClear();

        const rectSpy = vi.spyOn(DOM.source, 'getElementRect');

        expect(() => anyMd.startCodeEditorImport(staleEntry)).not.toThrow();
        expect(rectSpy).not.toHaveBeenCalled();
        expect(loadedTexts()).toEqual([]);
        expect(anyMd._awaitingVisibilityKickoffs).toHaveLength(0);
        expect(anyMd._awaitingViewportKickoffs).toHaveLength(0);
    });

    it('K9: a stale entry handed to startCodeEditorImport while hidden is not queued', () => {
        const md = mounted('hello');
        const anyMd = md as any;
        const startSpy = vi.spyOn(anyMd, 'startCodeEditorImport');

        md.setMarkdown(FENCE_A);
        flushFrame();

        const staleEntry = startSpy.mock.calls[0]![0];

        md.setMarkdown('plain');
        md.setDisplayed(false);
        Component.flushEffectiveVisibility();

        anyMd.startCodeEditorImport(staleEntry);

        expect(anyMd._awaitingVisibilityKickoffs).toHaveLength(0);
    });
```

---

## Ordered Implementation Steps

1. **Check the anchors.** In `packages/lib`, run `grep -n "private startCodeEditorImport\|if (generation !== this._renderGeneration)\|this.onFirstLayout(() => this.startCodeEditorImport" src/typescript/lib/component/display/Markdown.ts`. Expect three lines (near 1350, 1572 and 1971). If `startCodeEditorImport` already begins with a generation check, stop and report: the defect is fixed.

2. **Create the test file** `packages/lib/tests/component/display/MarkdownStaleCodeUpgrade.test.ts`. Copy the harness and the five cases from `## Internal Structure` → *The test harness*. Add K1, K3, K4 and K5 from the list in `## Expected Behaviour`, each in the form of K2, and order the nine cases K1 to K9. Close the `describe` block with `});`.

3. **See the tests fail.** Run `npx vitest run tests/component/display/MarkdownStaleCodeUpgrade.test.ts --maxWorkers=1` from `packages/lib`. Expect K1 to pass and K2–K9 to fail. The failures of K2–K5 name `handle … is not registered`; K6 fails on the queue holding two texts; K7 fails on an empty list of started imports; K8 fails on a throw; K9 fails on a queue of length 1. If K2 passes, stop and report: the defect is not present on this base.

4. **Apply the fix.** In `packages/lib/src/typescript/lib/component/display/Markdown.ts`, insert the guard from `## Internal Structure` → *The fix* as the first statement of `startCodeEditorImport` (line 1350). Change nothing else in the function body.

5. **Update two doc comments in the same file.**
   - The JSDoc of `startCodeEditorImport` (lines 1328-1349) opens with "Starts a fenced block's `CodeEditor` upgrade once it clears two gates in series." Put this sentence in front of it: "Does nothing for an entry whose render has been replaced or whose viewer was disposed (its `generation` no longer equals {@link _renderGeneration}): `clearContent` has released that entry's handles." Leave the rest of the comment as it is.
   - The JSDoc of `_renderGeneration` (lines 691-696) says "a resolved dynamic import compares its captured generation against this". Change that clause to "a deferred kickoff and a resolved dynamic import each compare their captured generation against this".

6. **See the tests pass.** Run the command of step 3 again: 9 passed. Then run `npx vitest run tests/component/display/Markdown.test.ts --maxWorkers=1`: no failure.

7. **Add the changelog bullet** from `## Documentation Impact` to `packages/lib/docs/reference/changelog/next.md`, as the last bullet of `## Fixed` → `### Components` (directly above the `### Core` heading that follows it), with one blank line before and after.

8. **Run the full checks** listed in `## Verification`.

9. **Do the browser check** in `## Verification` → *Manual*, and record its result in the plan's Implementation Notes.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/display/Markdown.ts` |
| Create | `packages/lib/tests/component/display/MarkdownStaleCodeUpgrade.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

**The contract.** A kickoff acts only for the render that queued it. Once that render has been replaced, or the viewer disposed, the kickoff reads no handle, starts no import, adds nothing to `_awaitingVisibilityKickoffs` or `_awaitingViewportKickoffs`, and causes no error report. The blocks of the current render are unaffected by any number of stale kickoffs.

`A` and `B` are two source strings that each hold one `js` fenced block (`FENCE_A`, `FENCE_B`). "Starts" means `loadCodeEditorUpgrade` was called with that block's text. All nine cases are unit tests in the new file.

| # | Viewer | Before the flush | Required after the flush | Today |
|---|---|---|---|---|
| K1 | mounted, visible | `setMarkdown(A)` | starts `A`'s block; no failure report | same (control) |
| K2 | mounted, visible | `setMarkdown(A)`, `setMarkdown(B)` | starts `B`'s block only; no failure report | starts `B`'s block; 1 failure report |
| K3 | mounted, visible | `setMarkdown(A + B)`, `setMarkdown(B + A)` | starts two blocks, texts in order `let b = 2;`, `let a = 1;`; no failure report | 2 failure reports |
| K4 | mounted, visible | `setMarkdown(A)`, `setMarkdown('plain')` | starts nothing; no failure report | 1 failure report |
| K5 | mounted, visible | `setMarkdown(A)`, `dispose()` | starts nothing; no failure report | 1 failure report |
| K6 | mounted, `displayed: false` | `setMarkdown(A)`, `setMarkdown(B)` | `_awaitingVisibilityKickoffs` holds `B`'s entry only. Then `setDisplayed(true)` + `Component.flushEffectiveVisibility()` does not throw, starts `B`'s block, empties the queue, and calls `scheduleContentMeasure` | the queue holds `A`'s and `B`'s entries; showing throws; nothing starts; no measure is scheduled |
| K7 | rendered, not connected, built from `A` | `setMarkdown(B)`, then connect and lay out | starts `B`'s block only; no failure report | `Layout flush: doLayout for #… threw`; nothing starts |
| K8 | mounted, visible | a stale entry passed straight to `startCodeEditorImport` | no throw; `DOM.source.getElementRect` not called; nothing starts; `_awaitingVisibilityKickoffs` and `_awaitingViewportKickoffs` empty | throws |
| K9 | mounted, then hidden | a stale entry passed straight to `startCodeEditorImport` | `_awaitingVisibilityKickoffs` stays empty | the stale entry is queued |

"No failure report" means `console.error` was not called and `Diagnostics.counters().layoutErrors` did not move (`expectNoFlushFailure()`).

The four cases not written out in `## Internal Structure` are built like this:

- **K1** — `mounted('hello')`, `setMarkdown(FENCE_A)`, `flushFrame()`; expect `loadedTexts()` to equal `['let a = 1;']`, then `expectNoFlushFailure()`.
- **K3** — as K2 with the two sources of the table; expect `['let b = 2;', 'let a = 1;']`.
- **K4** — as K2 with `'plain'` as the second source; expect `[]`.
- **K5** — `mounted('hello')`, `setMarkdown(FENCE_A)`, `md.dispose()`, `flushFrame()`; expect `[]`, then `expectNoFlushFailure()`.

**Manual only:** the browser check in `## Verification`. The unit tests reproduce every case, so the browser check confirms the same result against a real DOM and adds nothing the tests lack.[^offline-ok]

---

## Verification

Run from `packages/lib`. Keep to one vitest process at a time with `--maxWorkers=1` or `--maxWorkers=2`, and check `free -g` before the full suite.

- `npx vitest run tests/component/display/MarkdownStaleCodeUpgrade.test.ts --maxWorkers=1` — 9 passed.
- `npx vitest run tests/component/display/Markdown.test.ts --maxWorkers=1` — no failure.
- `npm run typecheck` and `npm run typecheck:test` — clean.
- `npm run lint` — clean.
- `npm run test` — no failure; the count rises by 9.
- `npm run docs:api` — zero warnings.
- `npm run docs:llms:check` and `npm run build:lib` — succeed.
- `grep -n "entry.generation !== this._renderGeneration" src/typescript/lib/component/display/Markdown.ts` — one match, inside `startCodeEditorImport`.

**Manual — the MD Editor demo.** Start the demo app (`npm run dev`, or a dev server on a port of your own) and open `#/md-editor`.

1. Click the toolbar button "Edit Markdown source".
2. Put the caret at the end of the source and type a new paragraph, then a line with three backticks followed by `js`, then press Enter.
3. Type the text `let a = 1; let b = 2; let c = 3;` at machine speed, so that several characters arrive within one animation frame. An agent does this with the Chrome DevTools `type_text` tool. By hand, press several letter keys at the same moment a few times, or set DevTools → Performance → CPU to "6x slowdown" and type fast.
4. Read the console.

Before the fix the console shows this line several times while the text is typed: `Layout flush: an afterNextLayout callback threw; the rest of the frame continued. Error: DOM handle N is not registered (released or never minted).` After the fix the console shows no such line, and the preview's code block is highlighted and holds the typed text. Typing one key at a time at human speed shows no error before or after the fix, so slow typing proves nothing.[^human-speed]

---

## Documentation Impact

No public API changes, so no component page changes. One changelog entry for `packages/lib/docs/reference/changelog/next.md` → `## Fixed` → `### Components`:

```markdown
- **`Markdown` no longer fails on a fenced block of text it has already
  replaced.** Calling `setMarkdown` twice before the next layout — a live
  preview fed by fast typing or by streamed text, or a page updated while its
  browser tab is in the background — or disposing the viewer right after
  `setMarkdown`, logged `Layout flush: an afterNextLayout callback threw …
  DOM handle … is not registered`, once for each fenced block in a
  supported language of each replaced text. If the viewer was hidden at the
  time, showing it later threw instead, and the fenced blocks of the current
  text stayed without highlighting until the next `setMarkdown`. No consumer
  action is needed.
```

---

## Potential Challenges

- **A locally mocked `requestAnimationFrame` sees nothing in `Markdown.test.ts`.** Earlier tests of that file leave the library's flush marked as scheduled, so no new frame is requested. Keep the new cases in their own file, where every test captures the frame from its first line and `afterEach` drains it with `settle()`.
- **`mounted()` clears `loadSpy`.** The mount itself can start imports for the initial source. Read `loadedTexts()` only after the actions of the test, as every case does.
- **K7 needs `connected = false` before the viewer is built.** `onFirstLayout` picks its queue from `DOM.source.isConnected` at the moment `appendCode` runs. Setting `connected` after `host.getElement(true)` sends both kickoffs to the other queue and turns K7 into a copy of K2.
- **The modelled DOM words the error differently.** Offline the message is `TestHandleTable: handle N is not registered`; in a browser it is `DOM handle N is not registered (released or never minted).` Match on `is not registered` if a test ever needs the text.

---

## Critical Files

- [packages/lib/src/typescript/lib/component/display/Markdown.ts](packages/lib/src/typescript/lib/component/display/Markdown.ts) — `appendCode` (1940), `clearContent` (1169), `startCodeEditorImport` (1350), `isBlockNearViewport` (1380), `onEffectiveVisibilityChange` (1510), and the precedent `loadCodeEditorUpgrade` (1559, check at 1572).
- [packages/lib/src/typescript/lib/component/diagram/DiagramView.ts:744](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L744) — `relayout` and `applyLayout` (879): the generation-number pattern `Markdown` mirrors.
- [packages/lib/src/typescript/lib/core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts) — read only: `flushPendingLayouts` (265), `flushPendingVisibility` (353), `onFirstLayout` (8101), `runFirstLayoutCallbacks` (8128), `afterNextLayout` (8254).
- [packages/lib/src/typescript/lib/core/DOM.ts:458](packages/lib/src/typescript/lib/core/DOM.ts#L458) — read only: `HandleRegistry.resolve`, the source of the message.
- [packages/lib/tests/core/AfterNextLayout.test.ts](packages/lib/tests/core/AfterNextLayout.test.ts), [packages/lib/tests/core/OnFirstLayout.test.ts](packages/lib/tests/core/OnFirstLayout.test.ts), [packages/lib/tests/core/LayoutFlushIsolation.test.ts](packages/lib/tests/core/LayoutFlushIsolation.test.ts) — the frame-capturing harness the new file copies.
- [packages/lib/tests/component/display/Markdown.test.ts:725](packages/lib/tests/component/display/Markdown.test.ts#L725) — the existing kickoff tests, and the comment that explains why they do not drive a real flush.
- [plans/implemented/layout-flush-degenerate-inputs.md](plans/implemented/layout-flush-degenerate-inputs.md) — the decision that a throwing flush entry is isolated and reported, not silenced.
- [plans/implemented/markdown-viewport-lazy-code-upgrade.md](plans/implemented/markdown-viewport-lazy-code-upgrade.md) — the plan whose change introduced the defect.

---

## Non-Goals

- **Making `Component.afterNextLayout` or `Component.onFirstLayout` aware of an owner.** The decision "`Component.afterNextLayout`, `Component.onFirstLayout` and the handle registry stay as they are" covers this. Every other call site of the two methods was read and is safe as it is (`## Addendum: Other Deferred Call Sites Checked`, first table).
- **Fixing the other deferred work found at risk** — the wheel-scroll and touch-fling loops of `VirtualScroller`, `Tree.revealByPredicate`, the async button guard of `Dialog`, and the rest of the table in `## Addendum: Other Deferred Call Sites Checked`. Each has a different owner and a different remedy (cancel in `destructor`), and none goes through `Markdown.ts`. They need a plan of their own, which should also finish the sweep that addendum leaves partial.
- **Isolating a throwing `onEffectiveVisibilityChange` in `flushPendingVisibility`, or a throwing callback in `runFirstLayoutCallbacks`.** Both let one throw skip the work queued behind it, and this defect reached both (K6, K7). With the fix nothing in the library throws there. Guarding the two loops is a separate decision about `core/Component.ts`, whose flush code the unmerged `nested-scroll-reveal` branch rewrites.[^core-gaps]
- **Cancelling a stale kickoff instead of letting it run and return.** `onFirstLayout` returns the component, not a handle to cancel with, and the generation check costs one comparison per stale kickoff.
- **Coalescing `setMarkdown` calls, or debouncing the demo's preview.** Each `setMarkdown` rebuilds at once by contract, and callers may call it as often as they like.
- **Changing the "Found on the way" entry of `plans/implemented/markdown-language-readonly-and-fences.md`.** That entry names a different cause; this plan's Implementation Notes carry the correct one.[^record]

---

## Addendum: How the Defect Was Established

**Message and stack** (Chromium, the demo app served from tip `a11d86be6`). The line numbers are those of the TypeScript source; the browser reports the lines of the served JavaScript.

```
Layout flush: an afterNextLayout callback threw; the rest of the frame continued.
Error: DOM handle 194 is not registered (released or never minted).
    at HandleRegistry.resolve             core/DOM.ts:462
    at ProductionDOMSource.getElementRect core/DOM.ts:2570
    at Markdown.isBlockNearViewport       component/display/Markdown.ts:1381
    at Markdown.startCodeEditorImport     component/display/Markdown.ts:1357
    at (arrow function in appendCode)     component/display/Markdown.ts:1971
    at (afterNextLayout's wrapper)        core/Component.ts:8259
    at flushPendingLayouts                core/Component.ts:324
```

In the demo the callback was queued from `Markdown.setMarkdown` ← the demo panel's `syncViewer` ← the editor's `"change"` event. The handle number differs on every occurrence.

**Minimal steps.** A bare `Markdown` added to `Body`, no editor on the page:

| Calls in one tick, then wait for frames | Errors logged |
|---|---|
| `setMarkdown(A)` once per frame, twice | 0 |
| `setMarkdown(A)`, `setMarkdown(B)` | 1 |
| five `setMarkdown` calls | 4 |
| `setMarkdown(A)`, `setMarkdown('plain')` | 1 |
| two sources with a fence without a language | 0 |
| two sources with two `js` fences each | 2 |
| `setMarkdown(A)`, `dispose()` | 1 |
| viewer hidden: `setMarkdown(A)`, `setMarkdown(B)`, wait, show | uncaught `DOM handle … is not registered`; the block stays a plain `<pre>` (a control with one `setMarkdown` gets its `CodeEditor`) |

The count is one error per supported-language fenced block of each replaced render.

**In the demo.** Ten characters sent by the Chrome DevTools `type_text` tool produced ten `setMarkdown` calls spread over six frames, and four errors: one for each frame that held two calls. Keys pressed one at a time (one `setMarkdown` per frame) produced none, for a typed character, Backspace, Tab, `(`, Ctrl+Z and Enter alike. The editor's WYSIWYG mode gives the same errors as source mode when typed into at machine speed inside a `js` code block. The "CodeEditor" demo, which has no viewer, gives none.

**Where else it can happen.** The docs app's Markdown page has a live-preview demo (`packages/docs/src/demos/markdown-preview.ts`) with the same wiring: a `TextArea` whose `"change"` calls `preview.setMarkdown`. That demo was read, not run. Docs pages themselves build one `Markdown` per block and never call `setMarkdown`, so they are not exposed.

**When it started.** Commit `1d64ed014` (2026-08-08, "Gate Markdown's fenced-code upgrade on viewport proximity", plan `markdown-viewport-lazy-code-upgrade`) added the `isBlockNearViewport(entry.wrapper)` read in front of the generation check. Checked in a browser on both sides of that commit, with a bare viewer and two `setMarkdown` calls in one tick:

| Commit | Result |
|---|---|
| `25323fedc` (parent) | no error; a callback queued behind the stale kickoff ran; the current block was upgraded |
| `1d64ed014` | uncaught `DOM handle … is not registered`; the callback queued behind the stale kickoff did not run; the current block was not upgraded |

Before `1d64ed014` a stale kickoff existed too (since `604546790`, 2026-08-04), but it went straight to `loadCodeEditorUpgrade`, whose generation check made it a no-op.

| Versions | Behaviour |
|---|---|
| up to 0.4.1 | not present |
| 0.5.0 – 0.9.0 | the throw escapes the flush: an uncaught error, and every `afterNextLayout` callback queued behind the stale kickoff in that frame is dropped, the current render's kickoff among them (run on `1d64ed014`; these versions hold it and lack `5e691cc78`) |
| 0.10.0, `master`, the Markdown stack | the throw is isolated and logged (`5e691cc78`, 2026-09-16); the hidden and not-connected cases still lose the current render's upgrade (K6, K7) |

The modelled DOM of the unit tests could not show the defect before `dfb630aa6` (2026-09-28, `test-dom-handle-eviction`), which made it forget released handles. A `git bisect` with the offline test stops at that merge for this reason; it is not the cause.

**What it costs today** (0.10.0 and later):

| Situation | Cost |
|---|---|
| viewer visible, text replaced twice before a flush | one logged error and one "Layout errors" count per stale block; nothing else is skipped, because the flush isolates each callback and the stale kickoff has no work of its own to do |
| browser tab in the background while the text is updated N times | N−1 renders' worth of errors when the tab returns; nothing else skipped. Not run: it follows from the count rule above, since a background tab gets no animation frames |
| viewer hidden (for example in a tab that is not showing) and text replaced twice | on show, `onEffectiveVisibilityChange` throws out of `flushPendingVisibility` as an uncaught error. The current text's fenced blocks are not upgraded until the next `setMarkdown`, and the content height is not re-measured. By reading, not run: the components queued behind the viewer in that same visibility pass are not reconciled either |
| viewer rendered but not yet connected, text replaced once | the viewer's first connected layout reports `doLayout for #… threw`; the current text's fenced blocks are not upgraded until the next `setMarkdown` (reproduced in the unit harness only) |

---

## Addendum: Other Deferred Call Sites Checked

The question was whether other deferred work in `packages/lib/src/typescript/lib` has the shape of this defect: a callback that runs later and then touches a handle, or a component, that was released, disposed or rebuilt in the meantime. The answer has two parts. The layout-queue call sites were all read and only the one this plan fixes is at risk. Other kinds of deferred work (animation frames, timers, promise continuations) were swept in part: several sites are at risk, one of them confirmed by a run, and none of them is fixed by this plan.

### Layout-queue call sites — complete

Every `Component.afterNextLayout(` and `.onFirstLayout(` call in `packages/lib/src/typescript/lib` was read together with its owner's teardown. Two facts decide most verdicts. A callback that `onFirstLayout` puts in a component's own first-layout queue can only run from that component's `doLayout`, and a disposed component has no element and is never laid out. A callback in the library-wide queue runs on the next flush whatever happened to its owner.

| Site | Deferred work | Verdict |
|---|---|---|
| `component/display/Markdown.ts:1971` | `startCodeEditorImport(entry)` | **at risk — fixed by this plan** |
| `component/display/Markdown.ts:764` | `measureContentHeight()` | safe: registered in the constructor (own queue); the method returns when `getElement()` is null |
| `component/display/Markdown.ts:1437` | `onViewportPass()` | safe: reads only `_awaitingViewportKickoffs`, which `clearContent` empties on rebuild and on dispose; dispose with a pass scheduled was run in the unit harness, no error |
| `component/display/Markdown.ts:1600` | `onScheduledMeasure()` | safe: `measureContentHeight` returns when `getElement()` is null; same run as the row above |
| `component/display/AbstractCanvasSurface.ts:361` | `reconcileAnimation()` | safe: registered in `render()` (own queue); reads live fields, and `destructor` calls `stopAnimation()` first |
| `component/display/WebGLCanvas.ts:258` | `startAnimation()` | safe: registered in `render()` (own queue), so it cannot run after dispose |
| `component/diagram/DiagramEdgeLayer.ts:515` | `rebuildPaths()` | safe: registered only while there is no element (own queue); re-reads `getElement()` and returns on null; captures no handle |
| `component/diagram/DiagramNodeLayer.ts:148` | `redraw()` | safe: same shape as the row above |
| `component/shared/VirtualRowView.ts:1062-1063` | `flushResizeSettle()` | safe: the returned handle is kept in `_resizeSettleHandle` and cancelled in `destructor` (192-193) |
| `component/container/ScrollStrip.ts:636-637` | `flushResizeSettle()` | safe: same, cancelled in `destructor` (1056-1057) |
| `component/editor/MarkdownEditor.ts:5319` | the surface's `_onReady()` | safe: registered in the constructor (own queue) |
| `component/editor/CodeEditor.ts:845` | `mount()` | safe: registered in the constructor (own queue); returns when `getElement()` is null |
| `component/editor/CodeEditor.ts:2555` | `syncAutoHeight()` | safe: returns when `_view` or `_scrollElement` is null, and `destructor` clears both |
| `overlay/Dialog.ts:1004`, `:1015` | `resizeToContent()`, `focusFirst()` | safe: both handles are kept and cancelled in `destructor` (1510-1513) |
| `core/Component.ts:8471` | `restoreReleasedState(element)` | safe: pushed on the component's own queue; the captured handle is used only to refocus, and `release()` re-derives the refocus flag each time, so an element released again before its first connected layout is not refocused |

### Other deferred work — partial sweep

About sixty sites that use `requestAnimationFrame`, `setTimeout`, an `await` or a `.then` were read with their owner's teardown. Most are safe by one of the guard patterns listed under *How the library guards deferred work*. The sites below are not. Each was established by one reading of the code and its line numbers were checked; only the first was also run, so the other rows are leads for a later plan, not confirmed defects.

| Site | Deferred work | What goes wrong | Status |
|---|---|---|---|
| `core/SmoothScroller.ts:164`, `:229`, as built at `component/container/VirtualScroller.ts:121` | the eased wheel-scroll loop of a `Tree` or a `Table` body | the owner is disposed while the ease is running; the next frame writes the scroll transform through a released handle (`VirtualScroller.ts:492`). The error is uncaught: the loop is a bare animation frame, outside the layout flush | **run** in the unit harness on a `Tree`: throws `handle … is not registered` from `:492` ← `:258` ← `:123` |
| `component/container/VirtualScroller.ts:681`, `:684` | the touch-fling momentum loop | same write, same throw; nothing cancels the loop on dispose | read |
| `component/tree/Tree.ts:816`-`:934` | `revealByPredicate` resuming after an awaited lazy load | the `Tree` is disposed during the load; the walk then scrolls to the match through the same released handle, and the returned promise rejects | read |
| `overlay/Dialog.ts:541` | an async button guard (`await cfg.onClick()`) | the dialog is dismissed while the guard is pending; the `finally` block re-enables destroyed buttons (`:543`), which throws as an unhandled rejection | read |
| `layout/CollapseSupport.ts:416`, `:422` | the collapse animation of `Split` and `Border` | a pane is disposed mid-animation while its container lives; the next frame commits a style on the destroyed pane (`:345`) | read; needs the application to dispose a pane within the 200 ms animation |
| `overlay/Dock.ts:1857` | the focus recompute after a panel closes | the `Dock` is disposed before the frame; the callback acts on a destroyed region. Traced to wrong behaviour, not to a throw | read |
| `overlay/AbstractWindow.ts:3288` → `:3311` | the fade-in at the end of a maximise or restore glide | the window's body host is disposed during the glide; `Animation.play` then runs on a released handle | read; narrow |
| `component/editor/CodeEditor.ts:1710`, `:1714` | `format()` resuming after its awaits, read-only branch | the editor is made read-only and disposed during a format; the rejection flash plays on a released overlay handle (`:3033`) | read; narrow |
| `core/AutoRepeat.ts:91`, started at `component/input/SpinButton.ts:248` and `component/container/Scrollbar.ts:384` | the press-and-hold repeat timer | the button is disposed while pressed; the timer reschedules itself for ever. No throw, each tick is a no-op | read |
| `component/container/MenuItem.ts:319` | the 150 ms submenu-open timer | not cancelled when the owning `Menu` hides; it may open a submenu of a closed menu. No handle is involved | undecided |

Not reviewed, and so without a verdict: `layout/Accordion.ts:1844`, `:3011`; `overlay/Rail.ts:677`, `:849`, `:870`; `overlay/Drawer.ts:536`, `:571`, `:596`, `:616`; `overlay/Popover.ts:512`, `:539`; the continuations after a dialog in `component/editor/MarkdownEditor.ts:7697`-`:7770` and `component/editor/MarkdownDocumentPanel.ts:473`-`:499`; `component/table/Table.ts:1225`, `:2039`; every `await` under `data/`; `core/Body.ts:141`; the `onEffectiveVisibilityChange` overrides of `component/display/Glyph.ts:620` and `core/Panel.ts:1114`; and whether every component that subscribes to a store unsubscribes in its `destructor`.

### How the library guards deferred work

| Pattern | Where it is used | Example |
|---|---|---|
| keep the timer, frame or cancel handle in a field and cancel it in `destructor` | the most common, about twenty sites; all three users of `afterNextLayout`'s cancel handle | `overlay/Dialog.ts:1510`, `component/shared/VirtualRowView.ts:192`, `component/container/StatusBar.ts:359` |
| a registry keyed by handle that the framework cancels just before it releases the handle | every `Animation.play` and `Animation.afterTransition` | `core/Animation.ts:264`, cancelled from `core/Component.ts:1325` |
| re-read `getElement()`, or a field the destructor clears, and return on null | about twelve sites | `component/editor/CodeEditor.ts:1780`, `component/input/TextInput.ts:797` |
| a generation number captured when the work starts and compared when it resumes | five sites, all of them work that belongs to one build of a component's content | `component/diagram/DiagramView.ts:879`, `component/display/Markdown.ts:1572`, `component/display/Image.ts:663` |

The generation number is the pattern for this plan's case, because a kickoff becomes stale when the viewer's content is rebuilt, which the first three patterns cannot see: the viewer is alive and its element exists. The at-risk sites of the table above are of the other kind, an owner that was disposed, and their precedent is the first pattern.

---

## Notes

[^not-source-mode]: The first report named source mode because that is where the fast typing happened. A bare `Markdown` with no editor on the page reproduces the error with two `setMarkdown` calls in one tick, the editor's WYSIWYG mode reproduces it the same way as source mode, and a `CodeEditor` typed into at the same speed without a viewer shows nothing. See `## Addendum: How the Defect Was Established`.

[^at-consumer]: The render number already exists for exactly this purpose and is already carried inside every entry (`CodeUpgradeIdentity.generation`, [Markdown.ts:523](packages/lib/src/typescript/lib/component/display/Markdown.ts#L523)). The step after the kickoff, `loadCodeEditorUpgrade`, compares it; the kickoff itself was written when it had nothing to read from the entry before that comparison, and a later change (`1d64ed014`) added a handle read in front of it. Putting the comparison first restores the rule the class already follows: nothing touches an entry's handles until the entry is known to be current. Two other shapes were considered and rejected. Keeping a cancel handle per kickoff and cancelling in `clearContent` is the pattern `Dialog`, `VirtualRowView` and `ScrollStrip` use for their own `afterNextLayout` work, but `onFirstLayout` returns the component and offers nothing to cancel with, so it would need a new core API. Wrapping the read in `try`/`catch` would hide the message and still leave a stale entry in the visibility queue.

[^one-check]: A stale entry can only come from a kickoff, and a kickoff only calls `startCodeEditorImport`. The entries in `_awaitingVisibilityKickoffs` and `_awaitingViewportKickoffs` are put there by `startCodeEditorImport` alone, and `clearContent` empties both queues on every rebuild, so once the function refuses stale entries the queues hold current entries only. `_pendingCodeUpgrades` is filled by `loadCodeEditorUpgrade` after its own check and is emptied by `clearContent` as well. Adding the same comparison to `onViewportPass` or to the drain loop of `onEffectiveVisibilityChange` would guard a state that cannot occur, which the project's "no error handling for impossible scenarios" rule excludes.

[^core-unchanged]: Three reasons. First, the library-wide queue is not owner-aware and its callers do not need it to be: `afterNextLayout` is a static method with no owner argument, and the three components that bind its work to their own lifetime already hold the returned handle and cancel it in `destructor` ([Dialog.ts:1510](packages/lib/src/typescript/lib/overlay/Dialog.ts#L1510), [VirtualRowView.ts:192](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L192), [ScrollStrip.ts:1056](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L1056)). Second, an owner-aware queue would drop a kickoff only when the viewer is disposed (K5); in K2, K3, K4, K6 and K7 the viewer is alive and only its content was rebuilt, which the queue cannot know. Third, making the registry tolerant (a zero rectangle for a released handle) would turn a use-after-release into silently wrong geometry; `HandleRegistry.resolve`'s own comment says the loud failure is the point. Leaving `core/Component.ts` alone also avoids a conflict with the other unmerged family of branches. The `context-menu-keyboard-operation` … `focus-history-can-go-back-follows-focus` branches change that file only to add an `inert` attribute setter (hunks at lines 596, 702 and 5838 of `master`), far from the flush. The `nested-scroll-reveal` branch, which sits on top of them, also rewrites the `flushPendingLayouts` region (hunks at 200, 262 and 315) and adds a block after `afterNextLayout` (8269), so a fix placed in the flush or in `afterNextLayout` would collide with `nested-scroll-reveal`. Neither the family nor `nested-scroll-reveal` touches `Markdown.ts` or `Markdown.test.ts`, so this plan's code change does not collide with them. Both add bullets to `packages/lib/docs/reference/changelog/next.md`, as every branch does, which is why that file is listed in `touches-shared`.

[^report-stays]: `plans/implemented/layout-flush-degenerate-inputs.md` made the decision: before it (versions 0.5.0 to 0.9.0) one throwing callback dropped every callback queued behind it in the frame and left only an uncaught error; since it, each entry is isolated, counted, and logged with its stack. That plan states that a component which keeps throwing logs every frame on purpose, and that "the fix is the underlying throw, not a rate limiter". This defect is a case of that rule working: the report named the callback and the handle, and the work lost in 0.5.0–0.9.0 (the current render's kickoff, queued behind the stale one) is no longer lost in the visible case. Silencing or rate-limiting the report would have hidden K6 and K7, where real work is still lost.

[^own-file]: `Markdown.test.ts` says why its kickoff tests call the captured callback by hand ([Markdown.test.ts:726-735](packages/lib/tests/component/display/Markdown.test.ts#L726)): the flush is scheduled through a module-level handle that earlier tests of the same file leave set, because the offline sink drops the frame, so a spy installed later never sees a new request. Calling the callback by hand cannot show this defect, which is about what the real queues do between two renders. A file of its own starts with an idle flush, captures every frame, and drains it in `afterEach`. A new file also keeps the change out of `Markdown.test.ts`, which the Markdown stack has edited heavily.

[^stack]: The defect is on `master` and in 0.10.0, and the stack's own changes to `Markdown.ts` (eight hunks against `master`) do not touch `startCodeEditorImport`, `appendCode`'s last lines, or `clearContent`. The fix could therefore be made on `master`. The stack is chosen because every branch of it adds to `packages/lib/docs/reference/changelog/next.md` under `## Fixed` → `### Components`, where this plan adds its bullet, and because the anchors and line numbers in this plan were taken at the stack's tip. `depends-on` names the plan at that tip for the same reason; nothing in `markdown-language-readonly-and-fences` is needed by the fix.

[^offline-ok]: The modelled DOM forgets a released handle and throws on a read through it, as the production registry does (since `test-dom-handle-eviction`), and the tests run the library's real flush by capturing the animation frame. K2 to K6 were also run against a real browser, with the outcomes of the "Today" column.

[^human-speed]: A browser runs a layout flush every animation frame, about every 16 ms. One key per frame means one `setMarkdown` per flush, and the kickoff of each render runs before the next render replaces it. The defect needs two renders between two flushes.

[^core-gaps]: `flushPendingVisibility` ([Component.ts:353](packages/lib/src/typescript/lib/core/Component.ts#L353)) clears its queue and then calls each component's reconcile with no `try`/`catch`, so a throw from one `onEffectiveVisibilityChange` leaves the components behind it unreconciled and surfaces as an uncaught error. `runFirstLayoutCallbacks` ([Component.ts:8128](packages/lib/src/typescript/lib/core/Component.ts#L8128)) sets the queue to `null` and then calls each callback with no `try`/`catch`, so a throw drops the callbacks behind it and aborts the enclosing `doLayout`. `flushPendingLayouts` was given per-entry isolation by `layout-flush-degenerate-inputs`; these two were not. Whether they should be is for a plan of its own, written after `nested-scroll-reveal`, which rewrites the flush code of `core/Component.ts`, has merged.

[^record]: The entry says "A code block's `CodeEditor` defers its first height sync to the next layout, and the preview has disposed that editor by then." The stack shows otherwise: the throwing callback is the viewer's kickoff, and no `CodeEditor` exists yet for the stale block. `CodeEditor`'s deferred height sync returns early on a disposed editor (`syncAutoHeight` tests `_view` and `_scrollElement`, both cleared by `destructor`). An implemented plan is a record of its own run and is not rewritten by a later one.

---

## Implementation Notes

- The plan matched the code on this branch: the three anchors of step 1 were present at lines 1350, 1572 and 1971 (the JSDoc and `_renderGeneration` line numbers also held), so nothing drifted despite the longer stack.
- Step 3 went as predicted: K1 passed and K2-K9 failed. K2-K5 failed on a `console.error` call with `handle N is not registered`, K6 and K9 on the queue contents, K7 on an empty list of started imports, and K8 on a thrown `handle … is not registered`.
- Full suite: 19,599 passed, 2 todo (base 19,590, +9 as predicted).
- Departure from step 9: the manual browser check of `#/md-editor` was not run, though step 9 asks for it and for its result to be recorded. The nine unit cases reproduce every row of the Expected Behaviour table against the modelled DOM, and K8 shows that no handle is read; the planner reproduced K2-K6 in a real browser before the fix. Nobody has looked at the fixed code in a real browser.
- After the first review: the comment in `clearContent` on why `_renderGeneration` is bumped now names the deferred kickoff too (the plan's step 5 had missed it), and one reflowed doc-comment line was wrapped to the file's width.
