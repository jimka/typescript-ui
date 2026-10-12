---
depends-on: [markdown-language-readonly-and-fences]
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/tests/component/markdown-editor-command-crashes.test.ts
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# MarkdownEditor Typing at a Link's Start Swallowed — Implementation Plan

## Overview

In `MarkdownEditor`'s WYSIWYG mode, text entered through a *composition* at the edge of a link goes wrong. A composition is how an input method (Japanese, Chinese, Korean), a dead key on macOS and Linux, and most mobile keyboards enter text: the browser shows the text underlined while it is being built and commits it at the end. With the caret at the start of a block that begins with a link, the composed text is dropped and the editor stops taking typed keys at that caret. At the end of a block that ends with a link, the composed text becomes part of the link. A typed key, a paste, Enter, Backspace and Delete are right at every edge.

The fix is one command listener in [MarkdownEditor.ts](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts): before a composition starts, a caret that touches a link's edge is moved to the same position just outside the link. Lexical's own composition handling then opens a text node there. The listener reuses the link-edge helpers the file already has ([MarkdownEditor.ts:585](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L585) to [:641](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L641)).

All line numbers are for the tip of `feature/markdown-language-readonly-and-fences` (`a11d86be6`). Everything was measured there on the installed Lexical 0.49.0 and `marked` 18.0.9, in headless Chromium driven with real keys and real compositions.

---

## Architecture Decisions

### The defect — only a composition, at three places

The table gives the saved Markdown after the text `日本` is entered at the caret. `U` stands for the link's URL.

| Caret | Document | Typed key, paste | Composition today |
|---|---|---|---|
| At the start of a link that has no text before it in its block | `[the docs](U) now` | `日本[the docs](U) now` | nothing is entered; no `"change"`; see below |
| Right after a link that has text after it | `see [the docs](U) now` | `see [the docs](U)日本 now` | the first update of the composition is cut off and put in as selected text |
| At the end of a link that ends its block | `see [the docs](U)` | `see [the docs](U)日本` | `see [the docs日本](U)`: the text is in the link |
| Right before a link that has text before it | `see [the docs](U) now` | `see 日本[the docs](U) now` | the same: right |
| Inside a link | `see [the docs](U)` | `see [the日本 docs](U)` | the same: right |

The first row holds for a paragraph, a heading, a list item, a table cell and a quote that begin with a link, for a link after a hard line break, for a link alone in its block, and for a reference link, an autolink and a bold link. It holds however the caret got there: a click before the link, Home, an arrow from the line above, Ctrl+Home, or code.[^reach]

After the first row's composition the editor stays in a broken state. Lexical still believes a composition is running. A typed key at that caret is dropped too, and so is a second composition, also after a click elsewhere and back. Lexical handles no key through its key commands, so Tab moves the focus out of the editor. Enter, Backspace, Ctrl+B and undo still work, through the browser's own input events, and each ends the state. Undo takes back the edit made before the composition, since the composition changed nothing.[^stuck]

The block's first inline element matters only when it is a link. An image, inline code, bold text, a styled span and a kept HTML run at a block's start all take a composition correctly.[^others]

### The cause — the browser writes outside the link, and Lexical removes what it wrote

Chromium does not insert text at the inner edge of an `<a>` element. It puts the composed text in a new text node outside the link. Lexical removes every DOM node it did not create, so the composed text is removed while the composition is running. Chromium then drops the composition without telling the page that it ended, and Lexical waits for an end that never comes.[^cause]

Lexical prepares for this for one kind of node only. When a composition starts at the edge of a text node that itself refuses text there, Lexical opens a text node of its own for the composition. A link refuses text at its edges through its element, not through its text node, so Lexical does not open one.[^lexical-gap]

No rule of the editor is involved. A plain Lexical editor with a `LinkNode` behaves the same, on Lexical 0.49.0 and on 0.46.0.[^stock]

### One rule — text entered at a link's edge is plain text outside the link

Text entered at either edge of a link, by any input, is plain text outside the link and is never lost. A typed key and a paste already follow this rule, because Lexical's `RangeSelection.insertText` implements it. This plan makes a composition follow it too.

| Caret | Text entered there becomes |
|---|---|
| at a link's start | plain text right before the link |
| at a link's end | plain text right after the link |
| at the start of the text right after a link | part of that text, at its start |
| inside a link, not at an edge | part of the link's text |

The rule covers `LinkNode` and its subclass `ReferenceLinkNode`, the only inline elements the editor registers ([editorNodes.ts](../packages/lib/src/typescript/lib/component/editor/editorNodes.ts)). Bold, italic, code and styled text are text formats, not elements: text entered at their edge takes the format, for a key and for a composition alike, and this plan does not change that.

### The fix — move the caret outside the link before the composition starts

A listener for `COMPOSITION_START_COMMAND`, registered ahead of Lexical's own, moves a collapsed caret that touches a link's edge onto an *element point* on the link's parent: a selection point given as a parent node and a child index instead of a text node and an offset. It is the same position, just outside the link. It then returns `false`, and Lexical's own handler runs. Lexical opens a text node for a composition that starts at an element point, so the composed text goes into a text node the editor knows, outside the link.[^element-point]

This mirrors `$moveRangeEdgesOutOfLinks` ([MarkdownEditor.ts:641](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L641)), which moves the ends of a range off a link's edge onto the same kind of point before `$toggleLink(null)` runs, and reuses its helpers `$findEnclosingLinkNode`, `$isAtLinkStart` and `$isAtLinkEnd`. It is registered the way the file registers its other guards: a listener that corrects a selection Lexical mishandles and lets the command go on ([`registerRangeGuards`, MarkdownEditor.ts:4020](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L4020)).[^why-guard]

### Present since the editor has had links

The defect is not from any branch of the stack. It is the same on the tip, on `master`, and on the releases 0.10.0, 0.5.0 and 0.4.1, and a plain Lexical editor shows it on both Lexical versions the releases have used. Every released version of `MarkdownEditor` has it.[^bisect]

### Decisions that await the user's sign-off

1. **Text composed at the end of a link that ends its block goes after the link, not into it.** Today it extends the link's text; a typed key there already goes after the link. Recommended: yes, one rule for every input. To extend a link's text the caret is placed inside the link. No consumer has to act.

### Results that change

| Input | Before | After |
|---|---|---|
| Composition at the start of a block that begins with a link | text dropped; later keys at that caret dropped | plain text before the link |
| Composition right after a link, text following | first update cut off and selected | plain text after the link |
| Composition at the end of a link that ends its block | text joins the link | plain text after the link |

Nothing else changes. A typed key, a paste, Enter, Backspace, Delete, a composition anywhere else, and a composition over a selected range give what they gave.[^unchanged]

---

## Internal Structure

All code goes in [MarkdownEditor.ts](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts).

### The import

Add `COMPOSITION_START_COMMAND` to the existing `import { … } from "lexical"` list ([MarkdownEditor.ts:19](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L19)). `$isLinkNode`, `PointType`, `ElementNode` and `COMMAND_PRIORITY_CRITICAL` are imported already.

### The two functions

Insert both right after `$moveRangeEdgesOutOfLinks`, which ends at [MarkdownEditor.ts:657](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L657). This is the code the measurements were taken with.

```ts
/**
 * The position just outside a link for a text point that touches the link's
 * edge: an element point on the link's parent, before the link for a point
 * at the link's start, after it for a point at the link's end or at the
 * start of the text that follows the link.
 *
 * @param point - A text point.
 * @returns The parent and the child index of the position, or `null` when the point touches no link's edge.
 */
function $pointOutsideLinkEdge(point: PointType): [parent: ElementNode, index: number] | null {
    const node = point.getNode();
    const link = $findEnclosingLinkNode(node);

    if (link === null) {
        const followsLink = point.offset === 0 && $isLinkNode(node.getPreviousSibling());

        return followsLink ? [node.getParentOrThrow(), node.getIndexWithinParent()] : null;
    }

    const atStart = $isAtLinkStart(point, link);
    const atEnd = $isAtLinkEnd(point, link);
    const index = link.getIndexWithinParent();

    if (atStart) {
        return [link.getParentOrThrow(), index];
    }

    return atEnd ? [link.getParentOrThrow(), index + 1] : null;
}

/**
 * `COMPOSITION_START_COMMAND` guard: moves a collapsed caret that touches a
 * link's edge onto the same position just outside the link, so that the text
 * an input method composes there is plain text outside the link, as a typed
 * character is.
 *
 * @remarks
 * Works around Lexical's composition handling (0.46.0–0.49.0) at the edge
 * of an inline element that refuses text there. Chromium inserts composed
 * text outside an `<a>` at its inner edge, in a text node Lexical did not
 * create; Lexical removes that node, the composition dies without a
 * `compositionend`, and the editor keeps waiting for one. Lexical opens a
 * text node of its own for a composition that starts at an element point,
 * which is where this moves the caret. Remove when the canary in
 * `markdown-editor-command-crashes.test.ts` fails.
 *
 * @returns Always `false`, so Lexical's own handler still runs.
 */
function $moveCaretOutOfLinkEdge(): boolean {
    const selection = $getSelection();
    const isTextCaret = $isRangeSelection(selection) && selection.isCollapsed() && selection.anchor.type === "text";

    if (!isTextCaret) {
        return false;
    }

    const outside = $pointOutsideLinkEdge(selection.anchor);

    if (outside !== null) {
        const [parent, index] = outside;

        selection.anchor.set(parent.getKey(), index, "element");
        selection.focus.set(parent.getKey(), index, "element");
    }

    return false;
}
```

`$pointOutsideLinkEdge` decides by these cases:

| Text point | Result |
|---|---|
| offset 0 of the first text in a link (`[¦the docs](U)`) | `[link's parent, link's index]` |
| end of the last text in a link (`[the docs¦](U)`) | `[link's parent, link's index + 1]` |
| offset 0 of a text node whose previous sibling is a link (`[the docs](U)¦ now`) | `[the text's parent, the text's index]` |
| anywhere else (`see¦ [the docs](U)`, `[the¦ docs](U)`, `plain¦`) | `null` |

### The registration

In `buildEditor`, add one line to the `mergeRegister(…)` list, right before `registerRichText(editor),` ([MarkdownEditor.ts:7571](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L7571)):

```ts
            editor.registerCommand(COMPOSITION_START_COMMAND, $moveCaretOutOfLinkEdge, COMMAND_PRIORITY_CRITICAL),
```

The same list already registers a command listener inline this way ([MarkdownEditor.ts:7576](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L7576)).[^priority]

---

## Ordered Implementation Steps

1. **Add the test helpers and the rows, and see them fail.** In `packages/lib/tests/component/markdown-editor-command-crashes.test.ts`, add the imports, the three helpers, `I_ROWS` and the `describe` block of *Rows in `markdown-editor-command-crashes.test.ts`* below. Add the canary U4 too. From `packages/lib` run `npx vitest run tests/component/markdown-editor-command-crashes.test.ts`. Exactly 14 tests must fail, rows I1 to I14, each with `expected 'in the link' to be 'before the link'` or `… 'after the link'`. Rows I15 to I18, row U4 and every older test must pass.
2. **Add the import.** `COMPOSITION_START_COMMAND` in the `lexical` import list of `MarkdownEditor.ts`.
3. **Add the two functions** of *The two functions* after `$moveRangeEdgesOutOfLinks`.
4. **Register the listener** as in *The registration*. Check: `grep -n 'COMPOSITION_START_COMMAND' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` prints three lines (the import, the JSDoc, the registration).
5. **Run the rows again.** All of I1 to I18 and U4 pass.
6. **Run the browser check** of *Browser check* below. It must end with `ALL ROWS PASS`.
7. **Write the docs** of *Documentation Impact*.
8. **Run everything in *Verification*.**

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-command-crashes.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

### Rows in `markdown-editor-command-crashes.test.ts`

The test harness has no browser, so it cannot run a composition. It can start one: it dispatches `COMPOSITION_START_COMMAND`, as Lexical does on a `compositionstart` event, and checks where Lexical will let the composition run. It then writes the composed text into that node the way a browser does, and checks the saved Markdown. The rows are unit tests of the rule; the browser check below is the test of the defect.

Add to the `lexical` import list of the test file: `COMPOSITION_START_COMMAND`, `COMPOSITION_END_TAG`, `$setCompositionKey`, `$findMatchingParent`, `UNDO_COMMAND` (keep the ones already there). Add `$isLinkNode` to the `@lexical/link` import.

Add these helpers after `recordingEditor` ([markdown-editor-command-crashes.test.ts:1033](../packages/lib/tests/component/markdown-editor-command-crashes.test.ts#L1033)):

```ts
/**
 * Stands in for a `compositionstart` event. Its time stamp is far past the
 * 30 ms after the last key press inside which Lexical opens a text node for
 * every composition, so the rows see the rule and not that timing path.
 *
 * @returns The event.
 */
function compositionStartEvent(): CompositionEvent {
    return { type: 'compositionstart', data: '', timeStamp: 1_000_000_000 } as unknown as CompositionEvent;
}

/**
 * Where the text node a composition runs in sits. Read inside an update:
 * Lexical reports no node as composing while it only reads.
 *
 * @param lexical - The Lexical editor, with a composition started.
 * @returns `'in the link'`, `'before the link'`, `'after the link'`, `'in plain text'`, or `'none'` when no node is composing.
 */
function composingPlace(lexical: LexicalEditor): string {
    let place = 'none';

    lexical.update(() => {
        const node = $dfs().map((entry) => entry.node).find((found) => $isTextNode(found) && found.isComposing());

        if (node === undefined) {
            return;
        }

        const link = $findMatchingParent(node, $isLinkNode);
        const followsLink = $isLinkNode(node.getPreviousSibling());
        const precedesLink = $isLinkNode(node.getNextSibling());

        place = link !== null ? 'in the link' : followsLink ? 'after the link' : precedesLink ? 'before the link' : 'in plain text';
    }, { discrete: true });

    return place;
}

/**
 * Ends a composition the way a browser does: the composed text replaces
 * what the selection covers in the composing node, the caret goes after it,
 * and the update carries Lexical's composition-end tag.
 *
 * @param lexical - The Lexical editor, with a composition started.
 * @param text - The composed text.
 */
function commitComposition(lexical: LexicalEditor, text: string): void {
    lexical.update(() => {
        const selection = $getSelection() as RangeSelection;
        const node = selection.anchor.getNode() as TextNode;
        const from = Math.min(selection.anchor.offset, selection.focus.offset);
        const to = Math.max(selection.anchor.offset, selection.focus.offset);
        const shown = node.getTextContent();

        node.setTextContent(shown.slice(0, from) + text + shown.slice(to));
        node.select(from + text.length, from + text.length);
        $setCompositionKey(null);
    }, { discrete: true, tag: COMPOSITION_END_TAG });
}
```

Add the rows and their test before the `upstream canaries` block ([markdown-editor-command-crashes.test.ts:1040](../packages/lib/tests/component/markdown-editor-command-crashes.test.ts#L1040)). A row is: its name; the Markdown loaded; the caret, as the text of a text node and an offset in it; where the node the composition runs in must sit; and the saved Markdown once `日本` is composed there. `u` is the links' URL.

```ts
/** A row: its name, the Markdown loaded, the caret, where the composition must run, and the save once `日本` is composed. */
type CompositionRow = readonly [row: string, source: string, caret: TextPoint, place: string, saved: string];

const TABLE_REST = ' | b |\n| --- | --- |\n| c | d |';

const I_ROWS: readonly CompositionRow[] = [
    ['I1: a paragraph that begins with a link', '[the docs](u) now', ['the docs', 0], 'before the link', '日本[the docs](u) now'],
    ['I2: a heading that begins with a link', '## [the docs](u) now', ['the docs', 0], 'before the link', '## 日本[the docs](u) now'],
    ['I3: a list item that begins with a link', '- [the docs](u) now', ['the docs', 0], 'before the link', '- 日本[the docs](u) now'],
    ['I4: a table cell that begins with a link', `| [the docs](u) now${TABLE_REST}`, ['the docs', 0], 'before the link', `| 日本[the docs](u) now${TABLE_REST}`],
    ['I5: a quote that begins with a link', '> [the docs](u) now', ['the docs', 0], 'before the link', '> 日本[the docs](u) now'],
    ['I6: a reference link at a block\'s start', '[the docs][r] now\n\n[r]: u', ['the docs', 0], 'before the link', '日本[the docs][r] now\n\n[r]: u'],
    ['I7: an autolink at a block\'s start', '<https://e.com/d> now', ['https://e.com/d', 0], 'before the link', '日本<https://e.com/d> now'],
    ['I8: a link after a hard line break', 'zero\\\n[the docs](u) now', ['the docs', 0], 'before the link', 'zero\\\n日本[the docs](u) now'],
    ['I9: a link alone in its block, at its start', '[the docs](u)', ['the docs', 0], 'before the link', '日本[the docs](u)'],
    ['I10: the start of a link that has text before it', 'see [the docs](u) now', ['the docs', 0], 'before the link', 'see 日本[the docs](u) now'],
    ['I11: a paragraph that ends with a link', 'see [the docs](u)', ['the docs', 8], 'after the link', 'see [the docs](u)日本'],
    ['I12: a link alone in its block, at its end', '[the docs](u)', ['the docs', 8], 'after the link', '[the docs](u)日本'],
    ['I13: a list item that ends with a link', '- see [the docs](u)', ['the docs', 8], 'after the link', '- see [the docs](u)日本'],
    ['I14: a reference link at a block\'s end', 'see [the docs][r]\n\n[r]: u', ['the docs', 8], 'after the link', 'see [the docs][r]日本\n\n[r]: u'],
    ['I15: the start of the text right after a link', 'see [the docs](u) now', [' now', 0], 'after the link', 'see [the docs](u)日本 now'],
    ['I16: inside a link (control)', 'see [the docs](u)', ['the docs', 3], 'in the link', 'see [the日本 docs](u)'],
    ['I17: the end of the text right before a link (control)', 'see [the docs](u) now', ['see ', 4], 'before the link', 'see 日本[the docs](u) now'],
    ['I18: plain text at a block\'s start (control)', 'plain now', ['plain now', 0], 'in plain text', '日本plain now'],
];
```

Each row runs twice: with the command dispatched inside an update, as a browser's event does, and outside any. Each row checks four things:

1. `composingPlace(lexical)` is the row's fourth field.
2. After `commitComposition(lexical, '日本')`, `editor.getValue()` is the row's last field.
3. Loading that value into a fresh editor gives the same value back.
4. One `UNDO_COMMAND` gives the loaded Markdown back.

```ts
describe('a composition at a link\'s edge runs in text outside the link (I rows)', () => {
    it.each(I_ROWS)('%s', (_row, source, caret, place, saved) => {
        for (const inUpdate of [true, false]) {
            const editor = load(source);
            const lexical = lexicalOf(editor);
            const loaded = editor.getValue();

            selectText(editor, caret, caret);

            if (inUpdate) {
                lexical.update(() => { lexical.dispatchCommand(COMPOSITION_START_COMMAND, compositionStartEvent()); }, { discrete: true });
            } else {
                lexical.dispatchCommand(COMPOSITION_START_COMMAND, compositionStartEvent());
            }

            expect(composingPlace(lexical), `in an update ${inUpdate}`).toBe(place);

            commitComposition(lexical, '日本');
            expect(editor.getValue(), `in an update ${inUpdate}`).toBe(saved);
            expect(load(saved).getValue()).toBe(saved);

            lexical.dispatchCommand(UNDO_COMMAND, undefined);
            expect(editor.getValue(), `in an update ${inUpdate}, undone`).toBe(loaded);

            editor.dispose();
        }
    });
});
```

Rows I15 to I18 pass before the change: the harness cannot show what the browser does at I15, and I16 to I18 are controls that must stay as they are.[^i15]

Add the canary as the last test of the `upstream canaries` block:

```ts
    // When this fails after a Lexical upgrade, Lexical opens a text node for a composition that starts at a
    // link's edge by itself — delete `$moveCaretOutOfLinkEdge` and `$pointOutsideLinkEdge` in `MarkdownEditor.ts`,
    // their registration and this canary, then run the browser check of
    // `plans/implemented/markdown-editor-typing-at-link-start-swallowed.md` again.
    it('U4: a composition that starts at a link\'s start is left to run in the link\'s own text', () => {
        const { editor, errors } = recordingEditor([LinkNode]);
        let composesInLink = false;

        editor.update(() => {
            const linked = $createTextNode('b');

            $getRoot().append($createParagraphNode().append($createLinkNode('u').append(linked), $createTextNode(' c')));
            linked.select(0, 0);
        }, { discrete: true });

        editor.dispatchCommand(COMPOSITION_START_COMMAND, compositionStartEvent());

        // Inside an update: Lexical reports no node as composing while it only reads.
        editor.update(() => {
            const composing = $dfs().map((entry) => entry.node).find((found) => $isTextNode(found) && found.isComposing());

            composesInLink = composing !== undefined && $isLinkNode(composing.getParent());
        }, { discrete: true });

        expect(errors).toEqual([]);
        expect(composesInLink).toBe(true);
    });
```

### Browser check

The defect needs a real browser: what Chromium does to the DOM at a link's edge is half of it. The check is scripted. It drives headless Chromium through the DevTools protocol: `Input.imeSetComposition` and `Input.insertText` for the compositions, real key and mouse events for the rest. The scripts are outside the repo, in `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans3/text-input/browser/` (`$B` below). Never copy them into the repo.

1. Serve the branch's demo on a port of its own: `node $B/serve.mjs <branch worktree>/packages/lib 5451 &`. The worktree needs `node_modules` and `packages/lib/node_modules` symlinked to the main tree's.
2. Start a browser: `chromium-browser --headless=new --remote-debugging-port=9451 --no-first-run --disable-gpu --window-size=1400,900 --incognito about:blank &`.
3. `node $B/check1.mjs 5451`. It prints one `PASS` or `FAIL` line per row and ends with `ALL ROWS PASS` and exit code 0.
4. Stop both processes.

The script runs 58 rows. Each of the 27 documents below gets a composition in one step and one in three steps. After each, the script checks the saved Markdown, that `"change"` fired, that Lexical no longer believes a composition is running, that a typed `q` lands right after the composed text, and that two undos give the loaded document back.

| Rows | Caret placed by | Document | Saved Markdown after `日本` |
|---|---|---|---|
| block start, link first | a click, then Home | paragraph, heading, list item, ordered item, table cell, quote; reference link; autolink; bold link; link after a hard break; link alone | `日本` right before the link, outside it (`**日本[the docs](U)** now` for the bold link) |
| block end, link last | a click, then End | paragraph, heading, list item, table cell; reference link; link alone | `日本` right after the link, outside it |
| mid-line, after the link | ArrowLeft from the text after; ArrowRight from inside the link | `see [the docs](U) now` | `see [the docs](U)日本 now` |
| mid-line, before the link | ArrowLeft from inside the link; from code | `see [the docs](U) now` | `see 日本[the docs](U) now` |
| controls | from code; a click, then Home | inside a link; plain text, an image, inline code, bold text and a kept HTML run at a block's start | as before the change |

The last four rows are a click inside a link followed by Enter and a composition (the case the defect was first seen in), and a typed key at a block's start, at a block's end and right after a link.

On the tip the script fails 37 rows: every composition at a block's start (22) and at a block's end (12), the two one-step compositions right after a link, and the click-Enter row. With the change it passes all 58.[^check-runs]

**By hand, on Windows.** Add *Japanese — Microsoft IME* under *Settings → Time & language → Language & region*, and switch to it with Win+Space. Open the demo's **MD Editor** page in Chrome or Edge, select all and type `[the docs](https://example.com) now`, wait for the link to show. Press Home, type `nihon`, press Space, then Enter. `日本` must show before the link in ordinary text, and the viewer beside the editor must show `日本` outside the link. Press End on a line that ends with a link and do the same: `日本` must show after the link, not underlined as part of it.

**Browsers not run here.** Firefox and Safari were not available. Do the hand check above in each. On macOS no input method is needed: hold Option and press `e`, then `e`, to compose `é`. Record what each browser does in the Implementation Notes. If a browser still loses the text, do not widen the change: report it.[^other-browsers]

---

## Verification

- `npm run typecheck` and `npm -w packages/lib run typecheck:test` (repo root).
- `npm run lint` (repo root): zero errors.
- From `packages/lib`: `npx vitest run tests/component/markdown-editor-command-crashes.test.ts`: every row passes, I1 to I18 and U4 among them.
- `npm test` (repo root): the full suite is green. No existing row is expected to change.
- `npm run docs:api` (repo root).
- The grep of step 4.
- The browser check: `ALL ROWS PASS`.
- **The differential check against the parent over the seeded fuzz harnesses.** The harnesses dispatch no composition command, so the listener never runs in them and every output must be byte-identical to the parent's.[^fuzz] The harness is outside the repo, in `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/` (`$K` below). It works on private copies of a commit, never in a worktree.
  1. `$K/plans3/text-input/mkcopy.sh branch <branch tip commit>`.
  2. `$K/plans3/text-input/runfuzz2.sh branch $K/plans3/text-input/copies/branch`. It runs two Vitest processes at a time, the most this machine allows, for about 40 minutes, and writes `fuzz-branch/`, `lif-branch/`, `lifx-branch/` and `r7-branch/` in `$K/plans3/text-input/`. Run no other Vitest process meanwhile.
  3. For each of the four folders, compare every `*.json` in it with the file of the same name in the baseline folder: `$K/impl/raw-block-edge-cases/fuzz-b6/`, `lif-b6/`, `lifx-b6/` and `r7-b6/`. `cmp` must report no difference for any file.

---

## Documentation Impact

No public API changes. Two text edits.

**`packages/lib/docs/components/MarkdownEditor.md`**, the `Link` row of the table under `## Supported constructs` (line 57). Replace the row with:

```
| Link | `[text](url)`; text entered at a link's very start or end — typed, pasted, or composed with an input method — is ordinary text outside the link |
```

**`packages/lib/docs/reference/changelog/next.md`** → `## Fixed` → `### Components`, appended:

> - **`MarkdownEditor` takes text composed at a link's edge.** Text entered
>   with an input method, a dead key or a mobile keyboard at the start of a
>   block that begins with a link was dropped, and the editor then ignored
>   typed keys at that caret; right after a link the first step of the
>   composition was cut off; at the end of a block that ends with a link the
>   text joined the link. It is now ordinary text outside the link in all
>   three places, as a typed character already was. No consumer action is
>   needed.

No migration note: no consumer has to act.

---

## Potential Challenges

- **The rows pass for the wrong reason.** `compositionStartEvent()` must keep its large time stamp. With a small one Lexical opens a text node for every composition and rows I1 to I14 pass without the change.
- **The row for the text after a link (I15) cannot fail in the harness.** Only the browser check shows that case; do not drop the check because the unit rows are green.
- **A later Lexical fixes this itself.** Then U4 fails. Follow the comment above it; do not adjust U4 to pass.
- **`markdown-editor-readonly-keyboard-selection` is open on top of the same tip and edits the same file.** If it is merged first, the line numbers here shift; the anchors by name (`$moveRangeEdgesOutOfLinks`, `registerRichText(editor),`) still hold. That branch handles a composition in a read-only editor; Lexical does not dispatch `COMPOSITION_START_COMMAND` in a read-only editor, so the two do not meet.

---

## Critical Files

- [MarkdownEditor.ts:585–657](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L585) — `$findEnclosingLinkNode`, `$isAtLinkStart`, `$isAtLinkEnd` and `$moveRangeEdgesOutOfLinks`: the helpers reused and the precedent mirrored.
- [MarkdownEditor.ts:4020](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L4020) — `registerRangeGuards`: how the file's guards are written and why they run ahead of the command's own handler.
- [MarkdownEditor.ts:7545–7591](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L7545) — `buildEditor` and its `mergeRegister` list.
- [markdown-editor-command-crashes.test.ts:1033–1112](../packages/lib/tests/component/markdown-editor-command-crashes.test.ts#L1033) — `recordingEditor` and the upstream canaries U1 to U3.
- `node_modules/lexical/src/LexicalEvents.ts:1370–1419` — `$handleCompositionStart`: when Lexical opens a text node for a composition.
- `node_modules/lexical/src/LexicalMutations.ts:143–310` — `flushMutations`: Lexical removes DOM nodes it did not create.
- `node_modules/@lexical/link/src/LexicalLinkNode.ts:270–276` — `LinkNode.canInsertTextBefore` / `canInsertTextAfter`.

---

## Non-Goals

- **Getting the editor out of a composition that died for another reason.** After this change no known input leaves Lexical waiting for a composition's end. A general reset (on blur, or on the next `compositionstart`) would be a workaround with no case to test it on.
- **The placeholder character in `"change"` while a composition is starting.** Lexical opens a text node by inserting a zero-width character, which it removes when the composition ends. The first `"change"` of such a composition reports a value that holds it (U+200B, then `[the docs](U) now`). The tip already does this at an image's edge and for a composition over a selection; this plan adds the link's edges to those places and does not change the mechanism.[^placeholder]
- **Text formats at a block's edge.** Text entered at the start of bold, italic, code or styled text takes that format, for every input. That is one rule already.
- **A block shortcut typed at the start of a table cell.** On the tip, `- `, `# ` or `> ` typed at a cell's start disappears and the cell stays as it was. Seen while measuring; it is not about links or compositions.

---

## Addendum: Measurements

All in headless Chromium against the demo's **MD Editor** page, tip `a11d86be6`. Logs are in `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans3/text-input/browser/`.

**Inputs at the start of a paragraph that begins with a link** (`m1-all.log`; the same for a heading, a list item, an ordered item, a table cell and a quote):

| Input | Saved Markdown | `"change"` | One undo |
|---|---|---|---|
| typed `q`, Shift+`Q` | `q[the docs](U) now` | fires | loaded document |
| Ctrl+V of `PP` | `PP[the docs](U) now` | fires | loaded document |
| Enter | an empty paragraph above | fires | loaded document |
| Backspace | joins the paragraph above | fires | loaded document |
| Delete | `[he docs](U) now` | fires | loaded document |
| composition | unchanged | does not fire | takes back the edit before it |

**What the DOM holds while the composition runs** (`l6-start.log`): after the first composition update the paragraph is `<p>に<a><span>the docs</span></a><span> now</span></p>`. The `に` is a text node directly in the `<p>`. One update later it is gone, the editor state never held it, and no `compositionend` is dispatched.

**Caret placement** (`l1.log`, `m2.log`): a click before the link, Home, ArrowDown from the line above, Ctrl+Home and a caret set from code all give the same selection, offset 0 of the link's text. Right after a link that has text after it, every placement gives offset 0 of that text.

**With the change** (`check1-proto.log`, `m1-copy.log`, `m2-copy.log`, `l7.log`): 58 of 58 rows pass. A composition at a link's edge makes the same sequence of updates as one at an image's edge does on the tip, and one undo takes it back.

---

## Notes

[^reach]: Measured for each block kind and each way of placing the caret, with a composition in one step and in three steps. Every placement gives the same selection: offset 0 of the link's first text node. The full table is in *Addendum: Measurements*. A task-list item is not in the list because its checkbox comes before the link, so the link has text before it.

[^stuck]: Lexical keeps the key of the node it believes is being composed in. While that key is set, its `keydown` handler returns before dispatching any key command (`onKeyDown`, `LexicalEvents.ts:1560`), and its text handling treats the link's text node as composing, which switches off the check that would have put a typed character outside the link. Measured (`l9.log`): Backspace, Enter, Ctrl+B and Ctrl+Z each clear the key, since they arrive as `beforeinput` events whose handling clears it or changes the node; an arrow key, a click, Tab and a further composition at the same caret do not.

[^others]: An image is a decorator node, so the caret beside it is an element point, and Lexical opens a text node for a composition that starts at one. A kept HTML run is a token-mode text node that refuses text at its own edges (`MarkdownSourceTextNode.canInsertTextBefore`, `markdownSourceNodes.ts:161`), which is the one case Lexical's composition start does check. Bold, code and styled text are plain text nodes with a format; the browser composes inside their `<span>` and Lexical reads the text back.

[^cause]: Seen in the DOM at the first `input` event of the composition: the composed character is a text node that is a direct child of the `<p>`, before the `<a>`. Chromium avoids typing into an anchor at its boundary. Lexical's mutation observer removes added DOM nodes that belong to no Lexical node (`flushMutations`, `LexicalMutations.ts:143`). Removing the node a composition is running in makes Chromium cancel the composition silently: the next composition update fires a new `compositionstart`, and no `compositionend` is ever dispatched for the first. At the end of a link the picture differs because Lexical appends a zero-width character to the text of the node it believes is being composed in; the caret is then not at the anchor's end, so Chromium composes inside the anchor and Lexical accepts the text as the link's.

[^lexical-gap]: `$handleCompositionStart` (`LexicalEvents.ts:1370`) inserts its placeholder character, which opens a text node for the composition, when the selection is a range, when the anchor is an element point, when the caret's format differs from the node's, or when the node is a token or `node.canInsertTextBefore()` / `canInsertTextAfter()` is false at the caret. `LinkNode` answers `false` to those two (`LexicalLinkNode.ts:270`), but it is the caret node's parent, and the parent is not asked. Lexical's check for a typed character does ask the parent (`$shouldInsertTextAfterOrBeforeTextNode`, `LexicalUtils.ts:1050`), which is why a typed key is right.

[^stock]: A second editor was built in the same page from `createEditor`, `registerRichText` and `LinkNode` alone, with none of the editor's rules, and given the same documents and compositions (`stock.log`). The outcomes match the table row for row. The same test with Lexical 0.46.0 loaded from a CDN (`stock046.log`) matches too.

[^element-point]: Measured with the change in place: a composition at a link's edge produces the same updates as a composition at an image's edge does on the tip. Lexical inserts its placeholder character into a new text node at the element point, the browser composes in that node, and the end of the composition removes the placeholder. For the text right after a link, the new node merges into that text at once.

[^why-guard]: Two other fixes were considered and rejected. Subclassing `LinkNode` so that its text nodes refuse text at the link's edges would change every other use of those nodes. Moving the DOM selection instead of the Lexical one would have to be redone after every reconcile. Asking Lexical's own predicate is not possible: `$shouldInsertTextAfterOrBeforeTextNode` and the placeholder character are not exported. The element point needs neither.

[^priority]: `COMMAND_PRIORITY_CRITICAL` is what the file's guards use, so that a guard runs ahead of every other listener of its command. Lexical's own handler is at `COMMAND_PRIORITY_EDITOR`. A browser's `compositionstart` is dispatched outside an update, and Lexical then runs each priority in an update of its own on one pending state; the selection the guard moved is the selection Lexical's handler reads. Both ways of dispatching were measured, and the rows run both.

[^bisect]: The same probe (`bisect.mjs`: a typed key and a composition at a block's start, right after a link and at a block's end) gave identical output on the tip `a11d86be6`, `master` `99ca255d9`, `v0.10.0`, `v0.5.0` and `v0.4.1`, each served from a detached worktree. No commit in the repository's history touches composition handling. Releases 0.1.0 to 0.4.1 depend on Lexical `^0.46.0` and 0.5.0 onward on `^0.49.0`; the `v0.4.1` run used the installed 0.49.0, and the plain-editor test on 0.46.0 covers the older range. The demo of `v0.1.0` has no page the probe can drive, so that tag was not run.

[^unchanged]: `m1-copy.log` against `m1-all.log`: 30 documents, three inputs each. Only composition rows at a link's edge differ. A composition over a selected range that starts or ends at a link's edge was right before and is unchanged (`l8-tip.log`, `l8-proto.log`): Lexical handles a range itself.

[^i15]: At I15 the harness shows the same composing node with and without the change, since the difference is in which DOM node the browser writes to. With the change the node additionally holds Lexical's placeholder character, which the commit helper replaces. The browser check has two rows for this caret.

[^check-runs]: `check1-tip.log` and `check1-proto.log`. The prototype is this plan's code in a private copy of the tip, never in a worktree's tracked source.

[^other-browsers]: Lexical opens its text node for a composition that starts at an element point in every browser, and its source says the mechanism exists because Safari needs a text node at the selection. That is a reading of the source, not a run.

[^fuzz]: `markdown-edit-fuzz.test.ts` and the scratch harnesses dispatch `CONTROLLED_TEXT_INSERTION_COMMAND`, the delete commands, `KEY_ENTER_COMMAND`, `PASTE_COMMAND`, indent and outdent, undo and redo. None dispatches `COMPOSITION_START_COMMAND`. The run made while drafting had this change and the change of `markdown-editor-typing-shortcuts-only-for-typing` together in one copy: all 71 output files were byte-identical to the baselines (`fuzz-p2/`, `lif-p2/`, `lifx-p2/`, `r7-p2/` in `$K/plans3/text-input/`).

[^placeholder]: Measured (`l7.log`): at an image's edge on the tip the three `"change"` values of a one-step composition are U+200B followed by `![alt](…) now`, then `に![alt](…) now`, then `日本![alt](…) now`; with the change a link's edge gives the same three with the link in place of the image.
