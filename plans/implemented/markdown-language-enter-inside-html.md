---
depends-on: [markdown-demo-sample-table-width]
touches-shared:
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/tests/component/code-editor.test.ts
  - packages/lib/docs/components/CodeEditor.md
---

# Markdown Language Enter Inside HTML — Implementation Plan

## Overview

In a `CodeEditor` whose language is `"markdown"`, Enter pressed inside HTML can move text out of the blockquote or list item the HTML sits in. Two cases are known, and tests pin them as limits today (rows M26, M32 and M33, [code-editor.test.ts:3397](packages/lib/tests/component/code-editor.test.ts#L3397)). The caret is drawn `▮`:

```
> <div>▮            Enter gives      > <div>
> x                                  ▮            no ">": the quote ends here and
                                     > x          the HTML block is split in two

- <div>▮</div>      Enter gives      - <div>
                                       ▮
                                     </div>       the close tag is outside the list item
```

Three terms are used throughout. A **container** is a blockquote or a list item. A line's **prefix** is the text at its start that keeps the line in its containers: the `>` markers and the indentation. A **binding** pairs a key with a command; a command returns `true` when it handled the key, and `false` to pass the key on to the next binding.

`@codemirror/lang-markdown` binds Enter to its own command, `insertNewlineContinueMarkup`, which writes the prefix on a plain Markdown line. That command first checks that Markdown is the active language beside the caret, and passes the key on when it is not. Inside HTML the active language is HTML. Enter then reaches the editor's plain command, which can only write whitespace.[^cause]

This plan adds one Enter command to the built-in `"markdown"` language, in its loader ([languages.ts:185](packages/lib/src/typescript/lib/component/editor/languages.ts#L185)). Inside HTML that sits in a container, the new line starts with the same prefix as the caret's line. Every `CodeEditor` with `language: "markdown"` gets the command, which includes `MarkdownEditor`'s source mode. `CodeEditor.ts` and `MarkdownEditor.ts` are not edited, and no public API changes.

The plan touches [languages.ts](packages/lib/src/typescript/lib/component/editor/languages.ts), [code-editor.test.ts](packages/lib/tests/component/code-editor.test.ts), [CodeEditor.md](packages/lib/docs/components/CodeEditor.md) and the changelog's [next.md](packages/lib/docs/reference/changelog/next.md).

---

## Architecture Decisions

### A dedicated Enter command, bound in the `"markdown"` loader — mirrors the `"json"` loader and Markdown's own keymap

The `"markdown"` loader returns the Markdown support plus one more extension: `[support, Prec.high(keymap.of([{ key: "Enter", run: … }]))]`. The command, `continueContainersInsideHtml`, is a module-level function in `languages.ts`, next to `indentInsideMarkdownHtml` ([languages.ts:157](packages/lib/src/typescript/lib/component/editor/languages.ts#L157)).[^dedicated]

Three existing pieces of code set this shape:

- The `"json"` loader returns its grammar plus one addition as an array ([languages.ts:49–54](packages/lib/src/typescript/lib/component/editor/languages.ts#L49)). It establishes that a built-in language's extra behaviour lives inside its own loader.
- `markdown()` installs its own Enter and Backspace bindings as `Prec.high(keymap.of(markdownKeymap))` (`node_modules/@codemirror/lang-markdown/dist/index.js:424`). `Prec.high` is CodeMirror's wrapper that puts a binding ahead of ordinary ones. `CodeEditor` raises its two search bindings the same way ([CodeEditor.ts:2171](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2171)).
- `indentInsideMarkdownHtml` is the existing Markdown-and-HTML rule in this file. It already walks from an HTML node up to the `Blockquote` and `ListItem` nodes that hold it.

Enter is then tried in this order:

| # | Command | Installed by | Handles Enter when |
|---|---|---|---|
| 1 | `acceptCompletion` | `autocompletion()`, at `Prec.highest` | a completion list is open |
| 2 | `insertNewlineContinueMarkup` | `markdown()`, at `Prec.high` | Markdown is active beside the caret, in a container |
| 3 | `continueContainersInsideHtml` (new) | the `"markdown"` loader, at `Prec.high` | the caret is inside HTML, in a container |
| 4 | `insertNewlineAndIndent` | the editor's own keymap | always |

### The command takes the carets Markdown's own command refuses for being outside Markdown

The command acts on a caret only when all five conditions hold. Otherwise the command returns `false` and Enter goes on to binding 4, exactly as today.

1. The editor is not read-only.
2. Nothing is selected: the selection range is a bare caret.
3. Markdown is the active language on neither side of the caret. This condition is the exact opposite of the check `insertNewlineContinueMarkup` starts with, so the two commands never want the same caret.[^guard]
4. The syntax node at the caret has a `Blockquote` or `ListItem` ancestor.
5. The caret is not in front of a quote or list marker on its own line.

| Caret | Markdown active beside the caret | In a container | Handled by |
|---|---|---|---|
| `> quote▮` | yes | yes | Markdown's own command (unchanged, row M10) |
| `> <div>▮` at the end of the document | yes, after the caret | yes | Markdown's own command (unchanged, row M17) |
| `> <div>▮` with `> x` on the next line | no | yes | the new command |
| `<div>▮` with `x` on the next line | no | no | the editor's plain Enter (unchanged, row M24) |
| `> code▮` inside a fenced code block | yes | yes | the editor's plain Enter (unchanged, see `## Non-Goals`) |

With several carets, the command acts only when every caret meets the conditions, as Markdown's own command does.

### The new line copies the caret line's prefix; a list marker becomes spaces

The new line starts with the caret line's own text from the line's start up to its content. Each list marker in that text is replaced by spaces of the same length. A `>` is kept. No new list marker is ever written.[^copy]

`·` is one space.

| Caret line | Prefix of the new line | Why |
|---|---|---|
| `> <div>` | `>·` | the quote marker and its space |
| `> - <div>` | `>···` | `-` becomes a space |
| `1. <div>` | `···` | both characters of `1.` become spaces |
| `- > <div>` | `··>·` | the list marker is blanked, the quote marker kept |
| `··<div>` (a later line of the item `- a`) | `··` | no marker on this line: its indentation is copied |
| `>·····foo` (a deeper-indented line in a quoted block) | `>·····` | indentation after the marker is kept |
| `··> not a quote` (text inside `<pre>` in a list item) | `··` | this `>` is text, not a marker |

What counts as a marker comes from the syntax tree: the `QuoteMark` and `ListMark` nodes on the caret's line. A regular expression over the line would misread the last row.

The prefix is taken from the whole line, not only from the part before the caret. Spaces and tabs directly after the caret are dropped, because the prefix replaces them:

| Before (`▮` is the caret) | After Enter |
|---|---|
| `> <div>foo▮·bar` | `> <div>foo` then `>·▮bar` |
| `▮··x` (a later line of the item `- <div>`) | an empty line, then `··▮x` |
| `>·▮··x` | `>·` then `>···▮x` |

### Tabs are copied, never measured

The prefix is copied character for character. The command never converts a tab to spaces and never counts columns. Markdown counts a tab as four columns whatever the editor's `tabSize` is, and a copied tab is still that tab.[^tabs]

`→` is one tab.

| Caret line | Editor `tabSize` | Prefix of the new line |
|---|---|---|
| `→- <div>` (an item nested under `- a`) | 2, 4 or 8 | `→··` |
| `→<div>` (a later line of the item `1. a`) | 2, 4 or 8 | `→` |
| `-→<div>` | any | `·→` |

### Between an adjacent open and close tag, both new lines get the prefix

With the caret directly between an element's open tag and its close tag, the close tag moves to a line of its own, as it already does outside a container (row M19). Both new lines start with the prefix.[^tag-pair]

| Before | After Enter |
|---|---|
| `- <div>▮</div>` | `- <div>`, `··▮`, `··</div>` |
| `> <div>▮</div>` | `> <div>`, `>·▮`, `>·</div>` |
| `> a <b>▮</b> c` (two inline tags) | `> a <b>`, `>·▮</b> c` (one new line, as outside a container) |

### Enter never removes a prefix; leaving a container stays with Markdown's own command

The new command only ever adds a line with the prefix. A second or third Enter inside HTML that continues below the caret adds another prefixed line. Removing the prefix there would end the quote or item in the middle of the HTML block.[^never-leaves]

Leaving a container on an empty line is what Markdown's own command does, and that command still runs wherever Markdown is active:

| Start | Keys | Result | Handled by |
|---|---|---|---|
| `> <pre>▮` over `> x`, `> </pre>` | Enter ×3 | three new `>·` lines; the caret is on the third | the new command, each time |
| `- <pre>▮` over `··x`, `··</pre>` | Enter ×2 | two new `··` lines | the new command, each time |
| `> <div>` at the end of the document | Enter ×3 | `> <div>`, an empty line, the caret at column 0: out of the quote | Markdown's own command, exactly as after `> quote` |
| `- <div>▮` over `··x`, `··</div>` | Enter ×2 | first Enter: a `··` line. Second Enter: that line's indentation is removed | the new command, then Markdown's own: the blank line ended the `<div>` block, so the caret is in Markdown again, as in a plain item |

### Backspace gets no new binding

The inserted prefix is ordinary text, and the existing Backspace bindings delete it. No command is added for Backspace.[^backspace]

| After Enter, the caret line is | Backspace gives | Handled by |
|---|---|---|
| `>·▮` (inside an HTML block in a quote) | `>▮`, then `▮` | the editor's plain Backspace, one character per press |
| `··▮` (a `<div>` block in a list item) | `▮` in one press | Markdown's own Backspace command: the blank line ended the block, so the caret is in Markdown |
| `>···▮` (an item in a quote) | `>··▮`, then `>·▮` | the editor's plain Backspace, one character per press |

### `indentInsideMarkdownHtml` stays, for Enter over a selection

`indentInsideMarkdownHtml` is kept and its body is not edited. Enter at a bare caret inside HTML in a container is now handled by the new command before any indentation rule is asked. Enter that replaces a selection still reaches the rule: both Markdown commands pass a selection on, and the editor's plain Enter asks the indentation rules. Row C36 pins that path. The function's JSDoc gains one paragraph saying so.[^indent-rule-stays]

### JavaScript and CSS inside a container get the prefix too

Inside `<script>`, `<style>`, and a `style` or `on…` attribute value, the active language is JavaScript or CSS. In a container the new command handles those carets like any other caret outside Markdown: the new line gets the prefix, and JavaScript's or CSS's own indentation is not applied. Outside every container nothing changes (rows M27 and C34).[^nested-languages]

### No option and no API; the core CodeMirror packages are imported statically

The behaviour is the built-in default, with no `languageOptions` field to turn it off. A consumer who wants something else registers its own `markdown` language, as today.

`languages.ts` imports `syntaxTree`, `EditorSelection`, `Prec` and `keymap` with ordinary static imports. The language packages (`@codemirror/lang-*`) stay behind dynamic `import()`.[^static-imports]

### Implement after `codeeditor-bracket-pair-backspace`

`codeeditor-bracket-pair-backspace` is implemented first, then this plan. The two plans do not depend on each other in code: that plan edits `CodeEditor.ts`'s keymap list and this plan edits `languages.ts`. Every row of this plan gives the same result on either keymap order.[^order]

---

## Internal Structure

### Imports (top of `languages.ts`)

Line 10, `import type { TreeIndentContext } from "@codemirror/language";`, becomes these five lines:

```ts
import { syntaxTree } from "@codemirror/language";
import type { Language, TreeIndentContext } from "@codemirror/language";
import { EditorSelection, Prec } from "@codemirror/state";
import type { EditorState, SelectionRange, StateCommand } from "@codemirror/state";
import { keymap } from "@codemirror/view";
```

### The four functions (final form)

They go directly above the `registerLanguage({ id: "markdown", …` call, after `indentInsideMarkdownHtml`. `SyntaxNode` is the type alias already declared at [languages.ts:140](packages/lib/src/typescript/lib/component/editor/languages.ts#L140).

```ts
/**
 * Whether continueContainersInsideHtml handles Enter at a selection range:
 * the range is a caret, the caret is outside Markdown on both sides (inside
 * HTML, or the JavaScript or CSS nested in it), and it sits in a blockquote
 * or list item. "Outside Markdown on both sides" is the exact opposite of the
 * test Markdown's own Enter command starts with, so the two commands never
 * want the same caret.
 *
 * @param state - The editor state.
 * @param markdownLanguage - The Markdown language the editor runs.
 * @param range - The selection range Enter was pressed on.
 * @returns `true` when the range is a caret inside HTML inside a blockquote or list item.
 */
function isCaretInsideContainedHtml(state: EditorState, markdownLanguage: Language, range: SelectionRange): boolean {
    if (!range.empty) {
        return false;
    }

    const activeBefore = markdownLanguage.isActiveAt(state, range.from, -1);
    const activeAfter  = markdownLanguage.isActiveAt(state, range.from, 1);

    if (activeBefore || activeAfter) {
        return false;
    }

    // The HTML tree is mounted inside the Markdown one, so the ancestors of
    // an HTML node continue into the Markdown blocks that hold it.
    for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(range.from, -1); node; node = node.parent) {
        if (node.name === "Blockquote" || node.name === "ListItem") {
            return true;
        }
    }

    return false;
}

/**
 * The text that starts a new line in the same blockquotes and list item as
 * the caret's line: that line's own start, up to its content, with each list
 * marker replaced by spaces. `> - <div>` gives `>   `, and `  x` gives `  `.
 *
 * The characters are copied, not measured, so the new line's columns equal
 * the current line's whatever the editor's tab size is. Markdown counts a tab
 * as four columns; a copied tab is still that tab.
 *
 * Only the syntax tree says what is a marker: inside a `<pre>` block a line
 * may start with `>` or `-` as plain text.
 *
 * @param state - The editor state.
 * @param pos - The caret position.
 * @returns The prefix for the new line, or `null` when the caret is in front of a marker on its line.
 */
function containerPrefixAt(state: EditorState, pos: number): string | null {
    const line  = state.doc.lineAt(pos);
    let prefix  = "";
    let markEnd = 0;

    syntaxTree(state).iterate({
        from:  line.from,
        to:    line.to,
        enter: (node) => {
            const isListMark = node.name === "ListMark";

            if (!isListMark && node.name !== "QuoteMark") {
                return;
            }

            const from = node.from - line.from;
            const to   = node.to - line.from;

            prefix += line.text.slice(markEnd, from) + (isListMark ? " ".repeat(to - from) : line.text.slice(from, to));
            markEnd = to;
        },
    });

    if (pos - line.from < markEnd) {
        return null;
    }

    const rest = line.text.slice(markEnd);

    return prefix + rest.slice(0, rest.search(/[^ \t]|$/));
}

/**
 * Whether the caret sits directly between an element's open tag and its close
 * tag, as in `<div>|</div>`.
 *
 * @param state - The editor state.
 * @param pos - The caret position.
 * @returns `true` when the open tag ends, and the close tag starts, at the caret.
 */
function isBetweenAdjacentTags(state: EditorState, pos: number): boolean {
    const around = syntaxTree(state).resolveInner(pos);
    const open   = around.childBefore(pos);
    const close  = around.childAfter(pos);

    return open?.name === "OpenTag" && close?.name === "CloseTag" && open.to === pos && close.from === pos;
}

/**
 * Builds the Enter command the built-in `"markdown"` language adds for a
 * caret inside HTML that sits in a blockquote or list item. Markdown's own
 * Enter command refuses a caret inside HTML, and the editor's plain Enter can
 * only write whitespace, so without this command the new line loses its `>`
 * and leaves the quote.
 *
 * The new line starts with the caret line's own prefix (see
 * containerPrefixAt). It never gets a new list marker, and the command never
 * removes a prefix. Between an adjacent open and close tag the close tag moves
 * to a line of its own, with the same prefix.
 *
 * The command passes Enter on (returns `false`) in a read-only editor, for a
 * selection, for a caret Markdown's own command handles, for HTML outside
 * every blockquote and list item, and for a caret in front of a marker on its
 * line. With several carets it acts only when it can act on all of them.
 *
 * @param markdownLanguage - The Markdown language the editor runs.
 * @returns The command, for an Enter key binding.
 */
function continueContainersInsideHtml(markdownLanguage: Language): StateCommand {
    return ({ state, dispatch }) => {
        if (state.readOnly) {
            return false;
        }

        let declined = false;

        const changes = state.changeByRange((range) => {
            const pos      = range.from;
            const eligible = isCaretInsideContainedHtml(state, markdownLanguage, range);
            const prefix   = eligible ? containerPrefixAt(state, pos) : null;

            if (prefix === null) {
                declined = true;

                return { range };
            }

            const line    = state.doc.lineAt(pos);
            const after   = line.text.slice(pos - line.from);
            const newLine = state.lineBreak + prefix;
            const split   = isBetweenAdjacentTags(state, pos);

            return {
                // Spaces and tabs after the caret are dropped, as the editor's
                // plain Enter drops them: the prefix replaces them.
                changes: { from: pos, to: pos + after.search(/[^ \t]|$/), insert: split ? newLine + newLine : newLine },
                // A line break is one document position, whatever the length
                // of the editor's line separator.
                range:   EditorSelection.cursor(pos + 1 + prefix.length),
            };
        });

        if (declined) {
            return false;
        }

        dispatch(state.update(changes, { scrollIntoView: true, userEvent: "input" }));

        return true;
    };
}
```

`rest.search(/[^ \t]|$/)` is the length of the run of spaces and tabs at the start of `rest`. The pattern always matches, at the latest at the end of the string, so the result is never `-1`.

### The loader's last statement

`return markdown({ htmlTagLanguage: literalHtml });` ([languages.ts:212](packages/lib/src/typescript/lib/component/editor/languages.ts#L212)) becomes:

```ts
        const support = markdown({ htmlTagLanguage: literalHtml });

        // Prec.high puts this Enter binding beside Markdown's own, ahead of
        // the editor's. It comes second, so Markdown's own command is still
        // tried first.
        return [support, Prec.high(keymap.of([{ key: "Enter", run: continueContainersInsideHtml(support.language) }]))];
```

`support.language` is the Markdown `Language` object `markdown()` built. Its `isActiveAt` is the same test `insertNewlineContinueMarkup` runs.

### Test code that is not a plain row

The three rows this plan changes, in their new form:

```ts
    it('M26: Enter on an item marker line inside a blockquote keeps the quote and indents to the item content', async () => {
        expect(await typed('markdown', '> - <div>|\n>   x\n>   </div>', '\n')).toBe('> - <div>\n>   |\n>   x\n>   </div>');
    });

    it('M32: Enter between adjacent tags on an item marker line keeps the close tag in the item', async () => {
        expect(await typed('markdown', '- <div>|</div>', '\n')).toBe('- <div>\n  |\n  </div>');
    });

    it('M33: Enter inside an HTML block in a blockquote continues the quote marker', async () => {
        expect(await typed('markdown', '> <div>|\n> x', '\n')).toBe('> <div>\n> |\n> x');
    });
```

One new helper, for rows that need a tab size or a read-only state:

```ts
    /**
     * Types `keys` like `typed`, on a Markdown state with one more extension
     * added (a tab size, read-only).
     *
     * @param extension - The extension to add to the state.
     * @param startDoc - The document before typing, with the caret as `buildTypingState` reads it.
     * @param keys - The keys to type (see `typeText`).
     * @returns The resulting document with `|` at the caret.
     */
    async function typedWith(extension: Extension, startDoc: string, keys: string): Promise<string> {
        const state = await buildTypingState('markdown', startDoc);

        return show(typeText(state.update({ effects: StateEffect.appendConfig.of(extension) }).state, keys));
    }
```

Three rows that set a selection or use the helper directly:

```ts
    it('C36: Enter over a selection on an item marker line still indents to the item content', async () => {
        const state = settle(await buildTypingState('markdown', '- <div>x\n  y\n  </div>'));

        // Offsets 7 to 8 select the "x" after the open tag.
        const selected = state.update({ selection: EditorSelection.range(7, 8) }).state;

        expect(show(typeText(selected, '\n'))).toBe('- <div>\n  |\n  y\n  </div>');
    });

    it('C37: Enter with two carets inside an HTML block in a blockquote continues the quote at both', async () => {
        const start = await buildTypingState('markdown', '> <div>\n> x\n> </div>');
        const state = start.update({ effects: StateEffect.appendConfig.of(EditorState.allowMultipleSelections.of(true)) }).state;

        // Offset 7 is the end of the first line, 11 the end of the second.
        const carets = EditorSelection.create([EditorSelection.cursor(7), EditorSelection.cursor(11)]);
        const after  = typeText(state.update({ selection: carets }).state, '\n');

        expect(after.doc.toString()).toBe('> <div>\n> \n> x\n> \n> </div>');
    });

    it('C38: Enter inside an HTML block in a blockquote does nothing in a read-only editor', async () => {
        expect(await typedWith(EditorState.readOnly.of(true), '> <div>|\n> x', '\n')).toBe('> <div>|\n> x');
    });
```

---

## Ordered Implementation Steps

Run every command from `packages/lib`. Line numbers are those at the base commit `4f68f3556`. Other branches of the stack and sibling plans edit the same files, so find each place by its quoted text when a number has moved.

1. **Write the tests first** in [code-editor.test.ts](packages/lib/tests/component/code-editor.test.ts), inside `describe('built-in markdown language typing', …)` (line 3104).
   - Line 18: change `import { EditorState, EditorSelection } from '@codemirror/state';` to `import { EditorState, EditorSelection, StateEffect } from '@codemirror/state';`.
   - Replace the whole `it('M26: …')` block (lines 3397–3404), the whole `it('M32: …')` block (3430–3435) and the whole `it('M33: …')` block (3437–3441), comments included, with the three blocks in `## Internal Structure`. Each stays where it is.
   - Directly after the new M33 block and before `it('H1: …')` (line 3443), add in this order: the `typedWith` helper; rows C1–C35 from `## Expected Behaviour`; the C36, C37 and C38 blocks from `## Internal Structure`; rows C39–C41. The helper's `Extension` type is already imported on line 19.
   - The M26, M32 and M33 lines in that list repeat the three replaced blocks for reference; do not add them twice.
   - Each C row of `## Expected Behaviour` is one `it`, in the shape of the M33 block: the title is `'<id>: <title>'`, and the body is `expect(await typed('markdown', <start>, <keys>)).toBe(<after>);`. A row with two `start + keys → after` lines has two `expect` lines in the same `it`. A row marked `typedWith(<extension>, …)` calls `typedWith(<extension>, <start>, <keys>)` in place of `typed('markdown', <start>, <keys>)`. Paste the string literals exactly as written. When a line gets long, hoist the start document into a `const start`, as row M22 does.
   - Run `npx vitest run tests/component/code-editor.test.ts -t 'built-in markdown language typing'`. Expect exactly the rows marked `R` to fail: M26, M32, M33, C1–C18, C21, C23, C24, C28, C29, C31, C32, C33, C37, C39 and C41 (32 rows). Every row marked `P`, and every other M and H row, passes. A different red set means a row was mistyped: fix it before going on.
2. **Add the command** in [languages.ts](packages/lib/src/typescript/lib/component/editor/languages.ts).
   - Replace the import on line 10 with the five lines in `## Internal Structure`.
   - In the JSDoc of `indentInsideMarkdownHtml`, insert this paragraph directly above the ` * @param context - …` line, followed by an empty ` *` line. Do not change the function's body or the rest of its JSDoc.

     ```ts
      * Inside a blockquote or list item, continueContainersInsideHtml handles
      * Enter at a plain caret before this rule is asked. The rule still answers
      * for HTML outside both, when Enter replaces a selection, and when that
      * command passes the key on.
     ```
   - Add the four functions from `## Internal Structure`, JSDoc included, directly above the `registerLanguage({` call whose `id` is `"markdown"`.
   - Replace the loader's `return markdown({ htmlTagLanguage: literalHtml });` with the block in `## Internal Structure`.
   - Check: `grep -c 'run: continueContainersInsideHtml(support.language)' src/typescript/lib/component/editor/languages.ts` prints `1`. `npm run typecheck` passes.
3. **Re-run the step-1 command**: all green. Then `npx vitest run tests/component/code-editor.test.ts tests/component/markdown-editor.test.ts tests/component/display/Markdown.test.ts tests/unit/import-without-dom.test.ts`: all green.
4. **Update the docs** in [CodeEditor.md](packages/lib/docs/components/CodeEditor.md). Replace the list under "Enter inside HTML does something other than keep the line's indentation in these places:" (the four bullets on lines 68–71) with these five. The sentence above the list and the paragraph on line 64 stay.

   > - **In a blockquote or a list item**, the new line starts with the same prefix as the line the caret is on: its `>` markers and its indentation, with a list marker replaced by spaces. After `> - <div>` the new line starts with `>` and three spaces. So the new line stays in the same quote and the same item, and never starts a new item. The prefix is copied character for character: a tab stays a tab, and the result does not depend on `tabSize`. Enter never removes the prefix while the HTML continues after the caret. Backspace deletes it like any other text.
   > - **At the end of an HTML block**, where nothing of the block follows the caret, Markdown's own continuation runs, as after any other text: `> <div>` then Enter adds `> `, and `- <div>` then Enter adds a new `- ` marker, which Backspace turns into indentation.
   > - **Between an adjacent open and close tag** (`<div>|</div>`), the close tag moves to its own line, as a closing bracket does. In a blockquote or list item both new lines get the prefix.
   > - **Inside `<script>` and `<style>`, and inside a `style` or `on…` attribute value**, JavaScript and CSS keep their own indentation. In a blockquote or list item the new line gets the prefix instead.
   > - **With text selected**, Enter replaces the selection and adds no `>`, in HTML as in any other quoted text. On a list item's marker line the new line is still indented to the item's content.
5. **Add the changelog entry** to [next.md](packages/lib/docs/reference/changelog/next.md), under `## Fixed` → `### Components`, as the last bullet of that subsection (directly above `### Core`; at the base commit the last bullet is "Typing HTML in Markdown source no longer adds or re-indents text", ending on line 638). Wrap the lines like the neighbouring bullets.

   > - **Enter inside HTML in a Markdown blockquote or list item keeps the new line in it.** In `MarkdownEditor`'s `"source"` mode, and in any `CodeEditor` with `language: "markdown"`, Enter inside an HTML block in a blockquote started the new line without the `>`, which ends the quote and splits the HTML block. Enter between `<div>` and `</div>` on a list item's first line left the close tag outside the item. Inside HTML that sits in a blockquote or list item, the new line now starts with the same prefix as the line the caret is on: its `>` markers and its indentation, with a list marker replaced by spaces. It never starts a new list item. The prefix is copied as written, so a tab stays a tab whatever the editor's `tabSize`. Inside `<script>` and `<style>` in a blockquote or list item, the new line gets that prefix too, in place of JavaScript's or CSS's own indentation. Markdown's own continuation at the end of an HTML block is unchanged. No consumer action is needed.
6. **Run the full checks** in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/languages.ts` |
| Modify | `packages/lib/tests/component/code-editor.test.ts` |
| Modify | `packages/lib/docs/components/CodeEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

The contract: Enter inside HTML that sits in a blockquote or list item gives a line that stays in the same containers, never starts a new list item, and leaves every line below meaning what it meant.

### Offline rows

All rows run through the typing harness in `describe('built-in markdown language typing', …)`, on the `markdown` language. Each row is its id, then `R` or `P`, then the test title. The line under it is `start + keys → after`, written as the JavaScript string literals to paste.

- In a start document and in a result, `|` is the caret. A start document with no `|` has the caret at its end.
- In the keys, `\n` is Enter and `\b` is Backspace.
- `R` rows fail before step 2 and pass after it. `P` rows pass before and after: they pin behaviour that must not change.[^rows-prefix]

```text
# Blockquote
M33  R  Enter inside an HTML block in a blockquote continues the quote marker
        '> <div>|\n> x'  +  '\n'  →  '> <div>\n> |\n> x'
C1   R  text typed after Enter inside an HTML block in a blockquote lands in the quote
        '> <div>|\n> x'  +  '\n:::'  →  '> <div>\n> :::|\n> x'
C2   R  Enter in the middle of a quoted HTML line drops the spaces after the caret
        '> <div>foo| bar\n> x'  +  '\n'  →  '> <div>foo\n> |bar\n> x'
C3   R  Enter on a deeper-indented quoted HTML line keeps that indentation after the marker
        '>   <div>\n>     foo|\n>   </div>'  +  '\n'  →  '>   <div>\n>     foo\n>     |\n>   </div>'
C4   R  Enter copies a quote marker with no space after it as written
        '><div>|\n>x'  +  '\n'  →  '><div>\n>|\n>x'
C5   R  Enter inside an HTML block in a nested blockquote keeps both markers
        '> > <div>|\n> > x'  +  '\n'  →  '> > <div>\n> > |\n> > x'
C6   R  Enter after a close tag keeps the quote while the block continues below
        '> <div>\n> x\n> </div>|\n> after'  +  '\n'  →  '> <div>\n> x\n> </div>\n> |\n> after'

# Nested containers
M26  R  Enter on an item marker line inside a blockquote keeps the quote and indents to the item content
        '> - <div>|\n>   x\n>   </div>'  +  '\n'  →  '> - <div>\n>   |\n>   x\n>   </div>'
C7   R  Enter on the marker line of an item holding a blockquote blanks the list marker and keeps the quote marker
        '- > <div>|\n  > x'  +  '\n'  →  '- > <div>\n  > |\n  > x'
C8   R  Enter on a continuation line of an item inside a blockquote copies the line prefix
        '> - <div>\n>   x|\n>   </div>'  +  '\n'  →  '> - <div>\n>   x\n>   |\n>   </div>'
C9   R  Enter on an ordered item marker line inside a blockquote blanks the whole marker
        '> 1. <div>|\n>    x'  +  '\n'  →  '> 1. <div>\n>    |\n>    x'
C10  R  Enter keeps three levels of containers
        '> - > <div>|\n>   > x'  +  '\n'  →  '> - > <div>\n>   > |\n>   > x'

# Adjacent open and close tag
M32  R  Enter between adjacent tags on an item marker line keeps the close tag in the item
        '- <div>|</div>'  +  '\n'  →  '- <div>\n  |\n  </div>'
C11  R  Enter between adjacent tags in a blockquote gives both new lines the quote marker
        '> <div>|</div>'  +  '\n'  →  '> <div>\n> |\n> </div>'
C12  R  Enter between adjacent tags on an item marker line inside a blockquote keeps both new lines in the item
        '> - <div>|</div>'  +  '\n'  →  '> - <div>\n>   |\n>   </div>'
C13  R  Enter between adjacent tags on a nested item marker line keeps the close tag in the nested item
        '- a\n  - <div>|</div>'  +  '\n'  →  '- a\n  - <div>\n    |\n    </div>'

# Tabs
C14  R  Enter on a tab-indented nested item marker line copies the tab
        '- a\n\t- <div>|\n\t  x'  +  '\n'  →  '- a\n\t- <div>\n\t  |\n\t  x'
C15  R  Enter on a tab-indented nested item marker line gives the same text at tab size 8
        '- a\n\t- <div>|\n\t  x'  +  '\n'  →  '- a\n\t- <div>\n\t  |\n\t  x'
        typedWith(EditorState.tabSize.of(8), …)
C16  R  Enter on an item marker line with a tab after the marker keeps the tab
        '-\t<div>|\n\tx'  +  '\n'  →  '-\t<div>\n \t|\n\tx'
C17  R  Enter on a tab-indented item continuation line copies the tab at tab size 2
        '1. a\n\t<div>|\n\tx\n\t</div>'  +  '\n'  →  '1. a\n\t<div>\n\t|\n\tx\n\t</div>'
        typedWith(EditorState.tabSize.of(2), …)
C18  R  Enter inside an HTML block in a blockquote copies a tab after the quote marker
        '>\t<div>|\n>\tx'  +  '\n'  →  '>\t<div>\n>\t|\n>\tx'

# What counts as the prefix
C19  P  text that only looks like a marker inside an HTML block is not copied
        '- <pre>\n  > not a quote|\n  - not a list\n  </pre>'  +  '\n'  →  '- <pre>\n  > not a quote\n  |\n  - not a list\n  </pre>'
C20  P  Enter in the indentation of an item continuation line keeps the line indented
        '- <div>\n|  x\n  </div>'  +  '\n'  →  '- <div>\n\n  |x\n  </div>'
C21  R  Enter between a quote marker and deeper-indented HTML keeps the indentation on the new line
        '> <div>\n> |  x'  +  '\n'  →  '> <div>\n> \n>   |x'
C22  P  Enter in front of a quote marker on its line leaves the line as it is
        '- > <div>\n|  > x\n  > </div>'  +  '\n'  →  '- > <div>\n\n  |> x\n  > </div>'

# Repeated Enter and the end of the block
C23  R  repeated Enter inside an open HTML block in a blockquote never drops the quote marker
        '> <pre>|\n> x\n> </pre>'  +  '\n\n\n'  →  '> <pre>\n> \n> \n> |\n> x\n> </pre>'
C24  R  repeated Enter inside an open HTML block in a list item never drops the indentation
        '- <pre>|\n  x\n  </pre>'  +  '\n\n'  →  '- <pre>\n  \n  |\n  x\n  </pre>'
C25  P  at the end of an HTML block, repeated Enter leaves the blockquote as after plain quoted text
        '> <div>'  +  '\n\n\n'  →  '> <div>\n\n|'
        '> quote'  +  '\n\n\n'  →  '> quote\n\n|'
C26  P  Enter on the blank line that ended an HTML block in a list item behaves as in a plain item
        '- <div>|\n  x\n  </div>'  +  '\n\n'  →  '- <div>\n|\n  x\n  </div>'
        '- a\n  b|\n  c'  +  '\n\n'  →  '- a\n  b\n|\n  c'
C27  P  Enter on the last line of an HTML block at the end of the document continues the quote
        '> <div>\n> x'  +  '\n'  →  '> <div>\n> x\n> |'

# Inline HTML and other content
C28  R  Enter inside an inline tag in a blockquote keeps the quote marker
        '> text <a href="x"| title="y"> more\n> next'  +  '\n'  →  '> text <a href="x"\n> |title="y"> more\n> next'
C29  R  Enter between two inline tags in a blockquote keeps the quote marker and adds one line
        '> a <b>|</b> c\n> d'  +  '\n'  →  '> a <b>\n> |</b> c\n> d'
C30  P  Enter inside an inline tag on a line with no quote marker adds none
        '> text\n<a hr|ef="x"> more'  +  '\n'  →  '> text\n<a hr\n|ef="x"> more'
C31  R  Enter inside an HTML comment in a blockquote keeps the quote marker
        '> <!-- a|\n> b -->'  +  '\n'  →  '> <!-- a\n> |\n> b -->'
C32  R  Enter inside <script> in a blockquote keeps the quote marker
        '> <script>\n> function f() {|\n> }\n> </script>'  +  '\n'  →  '> <script>\n> function f() {\n> |\n> }\n> </script>'
C33  R  Enter inside <script> in a list item copies the line indentation
        '- a\n  <script>\n  if (x) {|\n  }\n  </script>'  +  '\n'  →  '- a\n  <script>\n  if (x) {\n  |\n  }\n  </script>'
C34  P  JavaScript inside a top-level <script> that continues below keeps its own indentation
        '<script>\nfunction f() {|\n}\n</script>'  +  '\n'  →  '<script>\nfunction f() {\n  |\n}\n</script>'
C35  P  Enter in a fenced code block in a blockquote is not continued (a known limit)
        '> ```\n> code|\n> ```'  +  '\n'  →  '> ```\n> code\n|\n> ```'

# Selection, several carets, read-only (code in ## Internal Structure)
C36  P  Enter over a selection on an item marker line still indents to the item content
C37  R  Enter with two carets inside an HTML block in a blockquote continues the quote at both
C38  P  Enter inside an HTML block in a blockquote does nothing in a read-only editor

# Backspace on the new prefix
C39  R  Backspace deletes the continued quote prefix one character at a time
        '> <div>|\n> x'  +  '\n\b'  →  '> <div>\n>|\n> x'
        '> <div>|\n> x'  +  '\n\b\b'  →  '> <div>\n|\n> x'
C40  P  Backspace deletes the continued item indentation in one press
        '- <div>|\n  x\n  </div>'  +  '\n\b'  →  '- <div>\n|\n  x\n  </div>'
        '1. <div>|\n   x'  +  '\n\b'  →  '1. <div>\n|\n   x'
C41  R  Backspace on the continued prefix of an item in a blockquote deletes the indentation first
        '> - <div>|\n>   x'  +  '\n\b\b'  →  '> - <div>\n> |\n>   x'
```

C35 pins a limit this plan leaves in place (see `## Non-Goals`), the way M26, M32 and M33 pinned theirs until now. Give its `it` this comment: `// Not HTML, so not this command's: Markdown's own Enter command declines inside fenced code, and plain Enter cannot write a ">".`

**Existing rows.** M1–M25, M27–M31, H1 and H2 keep their results. M20–M23 now go through the new command and give the same text as before.

### Manual checks

The mounted editor and real key events are outside the offline harness. Run `npm run dev` from the repo root, open the demo's "MD Editor" tab and switch on "Edit Markdown source". Replace the source with:

```
> <div>
> x
> </div>

- <div></div>
```

| # | Do | Expect |
|---|---|---|
| V1 | caret at the end of line 1 (`> <div>`), press Enter, type `:::` | a new line 2 reading `> :::`; lines below unchanged |
| V2 | caret between `<div>` and `</div>` on the list line, press Enter | three lines: `- <div>`, a line of two spaces holding the caret, and `  </div>` |
| V3 | caret at the end of line 1 again, press Enter, type `<sp`, wait for the completion list (`Ctrl-Space` opens it if it does not appear), then press Enter | Enter accepts the highlighted completion; no new line is added |
| V4 | type `abc` at the end of line 1, press Enter, then `Ctrl-Z` once | only the new line and its `> ` go; `abc` stays |

A standalone `CodeEditor` with `language: "markdown"` needs no manual run of its own: `MarkdownEditor`'s source mode is such an editor, and the offline rows test the loader both use.

---

## Verification

- `npm run typecheck`, `npm run test` and `npm run lint` from the repo root: green and clean.
- `npm run docs:api`: held to the standing bar in [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md). Then `npm run docs:llms:check`.
- `grep -c 'run: continueContainersInsideHtml(support.language)' packages/lib/src/typescript/lib/component/editor/languages.ts` prints `1`.
- `git diff --stat` touches only the four files in `## Files to Create / Modify / Delete`. `CodeEditor.ts` and `MarkdownEditor.ts` are unchanged.
- `npm run build:lib` from `packages/lib` succeeds, and `grep -c 'from"@codemirror/lang-' dist/lib/languages-*.js` prints `0`: the language packages are still loaded with dynamic `import()`.
- The offline rows: 32 red before step 2, all green after (step 1 lists them). `## Addendum: What pins each part of the command` shows which rows guard which line of the command.
- Manual: V1–V4.

---

## Potential Challenges

- **The base moves under this plan.** Review fixes on the stack may have changed the body of `indentInsideMarkdownHtml` (its tab handling) and moved lines. Find each edit by its quoted text, and leave that function's body alone.
- **M26, M32 or M33 may already differ.** At the base commit M26 and M33 assert a new line with no `>`, and M32 asserts `</div>` at column 0. If one of them asserts something else, stop and report instead of overwriting it.
- **The check on the active language looks removable.** Keep both `isActiveAt` calls: they limit the command to HTML. Without them the command also takes fenced code and every other caret Markdown's own command passes on, and row C35 fails.
- **The syntax tree must be complete at the caret.** The command reads `syntaxTree(state)`. The harness parses the whole document before every key (`settle`), so the rows are deterministic.
- **`open?.name === "OpenTag" && … && open.to === pos`** relies on TypeScript narrowing `open` after the optional-chain comparison. It compiles as written; do not rewrite it with non-null assertions.

---

## Critical Files

- [languages.ts](packages/lib/src/typescript/lib/component/editor/languages.ts) — the `"json"` loader (40–58, the precedent for adding behaviour inside a loader), the `SyntaxNode` alias (140), `indentInsideMarkdownHtml` (157–183), the `"markdown"` loader (185–215).
- [CodeEditor.ts:2140](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2140) — `mount()`: the editor's keymap (2162), its `Prec.high` bindings (2171), `autocompletion()` (2197), the language compartment (2201). Read only; not edited.
- [syntaxDiagnostics.ts:4](packages/lib/src/typescript/lib/component/editor/syntaxDiagnostics.ts#L4) — the existing static import of `syntaxTree` in this folder.
- [code-editor.test.ts:3104](packages/lib/tests/component/code-editor.test.ts#L3104) — the typing harness: `TYPING_EXTENSIONS` (3113), `buildTypingState` (3126), `settle` (3145), `pressKey` (3160), `typeText` (3239), `show` (3263), `typed` (3278); rows M22 (3377), M26 (3397), M32 (3430), M33 (3437), H1 (3443).
- [CodeEditor.md:64](packages/lib/docs/components/CodeEditor.md#L64) — the paragraph on typing HTML in Markdown and the list of exceptions (66–71).
- [plans/implemented/markdown-source-mode-html-typing.md](plans/implemented/markdown-source-mode-html-typing.md) — the plan this one follows up; its Implementation Notes describe rows M18–M33 and the two limits.
- `plans/codeeditor-bracket-pair-backspace.md` — the sibling plan to implement first.
- `node_modules/@codemirror/lang-markdown/dist/index.js` — `getContext` (122–159), `insertNewlineContinueMarkupCommand` (204–284; the language check on 207), `deleteMarkupBackward` (350–390), `markdownKeymap` (398–401), `markdown()` (406–429; `Prec.high` on 424). `dist/index.d.ts` documents the command's one option and its "does nothing in non-Markdown context" contract.
- `node_modules/@codemirror/commands/dist/index.js` — `isBetweenBrackets` (1497), `newlineAndIndent` (1521–1549).
- `node_modules/@codemirror/language/dist/index.js:88` — `Language.isActiveAt`.
- `node_modules/@lezer/markdown/dist/index.js` — `leftOverSpace` (1986) and `parseCode` (2002–2023): the HTML parser is mounted on `HTMLBlock`, `HTMLTag` and `CommentBlock`.

---

## Non-Goals

- **Fenced code in a container.** Enter in a fenced code block inside a blockquote also loses the `>` (`> code▮` gives a line with no `>`), and on a list item's marker line (`` - ```js▮ ``) the new line starts at column 0. Markdown is the active language there, so the cause is a different one: Markdown's own command passes the key on inside fenced code. Row C35 pins the limit. This plan is scoped to HTML.[^fenced]
- **Enter over a selection, and mixed carets.** Both Markdown commands pass a selection on, in HTML as in plain quoted text (`> a▮b▮c` gives `> a` and `c`). With several carets of which only some are inside HTML, no caret gets a prefix, as today.
- **A caret in front of a marker on its line** (`▮··> x` inside a quoted HTML block in a list item). The command passes the key on, and the result is what it was before (row C22).
- **Text after the caret that starts with a marker character.** Enter right before the `>` that closes a tag, in a blockquote, gives a new line `> > …`, which reads as a nested quote. Breaking a line before `>` or `-` reads as markup in plain text too, and no prefix can prevent it.[^split-before-marker]
- **JavaScript's and CSS's own indentation inside a container.** See the decision above.
- **A Backspace command.** See the decision above.
- **The body of `indentInsideMarkdownHtml`.** The stack changes its tab handling separately.
- **Markdown's own commands in a read-only editor.** `insertNewlineContinueMarkup` and `deleteMarkupBackward` do not check `state.readOnly`. The new command does (row C38).[^readonly]
- **`MarkdownEditor.md`.** Its one sentence on source-mode HTML typing links to the `CodeEditor.md` section this plan updates, and stays as it is.
- **An options type for the `"markdown"` language.** Nothing asks for the old behaviour back.

---

## Addendum: What pins each part of the command

Each line of the command was removed or changed in turn on a working copy, and the offline rows were re-run. Every change makes at least one row fail, so no part is untested.

| Part removed or changed | Rows that fail |
|---|---|
| the `state.readOnly` check | C38 |
| the `!range.empty` check | C36 |
| the two `isActiveAt` checks | C35 |
| the `Blockquote` / `ListItem` ancestor check | C34 |
| list markers copied as written, not blanked | 17 rows, among them M20, M21, M22, M26 and M32 |
| the `null` for a caret in front of a marker | C22 |
| the prefix taken only from the text before the caret | C20, C21 |
| the dropped spaces after the caret | C2, C20, C21, C28 |
| the second line between adjacent tags | M32, C11, C12, C13 |
| a second line added on every Enter | 37 rows |
| the binding itself, or its `Prec.high` | the 32 `R` rows |
| `indentInsideMarkdownHtml`'s marker-line answer | C36 |

Listing the new binding ahead of `markdown()`'s support in the returned array changes no row: the two commands never want the same caret.

---

## Notes

[^cause]: Traced on the installed packages (`@codemirror/lang-markdown` 6.5.2, `lang-html` 6.4.12,
    `commands` 6.10.4, `language` 6.12.4, `@lezer/markdown` 1.7.2). `insertNewlineContinueMarkupCommand`
    gives up on a range when `!range.empty || !markdownLanguage.isActiveAt(state, range.from, -1) &&
    !markdownLanguage.isActiveAt(state, range.from, 1)` (index.js:207). `@lezer/markdown`'s `parseCode`
    mounts the HTML parser on every `HTMLBlock`, `HTMLTag` (an inline tag) and `CommentBlock` node
    (index.js:2017), so inside those the active language is HTML. The key then reaches
    `insertNewlineAndIndent` (commands index.js:1521), which builds the new line with `indentString`:
    whitespace only. For row M32 it gives the close tag's line `cx.lineIndent(line.from, -1)`
    (line 1542), the marker line's own leading whitespace, which is none. The command's own
    documentation states the limit: "The command does nothing in non-Markdown context, so it should not
    be used as the only binding for Enter (even in a Markdown document, HTML and code regions might use
    a different language)".

[^dedicated]: Three ways were weighed. (1) Configure Markdown's command:
    `insertNewlineContinueMarkupCommand(config)` takes one option, `nonTightLists`, and nothing about
    HTML. (2) Wrap it with a command registered ahead of it: the language check is the first statement
    inside the command, with no parameter to skip it, so a wrapper cannot make the command work inside
    HTML. If it could, the command would write a new list marker on an item's marker line, which is the
    result to prevent. (3) Copy its private `getContext` (index.js:122–159), which rebuilds the prefix
    from each container's first line with regular expressions and pads to columns. The earlier plan
    declined that, and it is not needed: the caret line already carries the prefix, and the tree marks
    its markers. Precedent search: `StateCommand`, `changeByRange`, `keymap.of` and `Prec.` were grepped
    under `packages/lib/src`. The only key bindings in the library are `CodeEditor`'s own two keymaps
    (CodeEditor.ts:2162 and 2171), and no `StateCommand` exists yet. The command's body therefore
    follows lang-markdown's own: `state.changeByRange` with a flag for "pass the key on", then one
    dispatch with `scrollIntoView` and `userEvent: "input"`. Keeping language behaviour in the
    language's registry entry is what the `"json"` and `"sql"` loaders establish, and it is why
    `CodeEditor` gains no Markdown- or HTML-named code.

[^guard]: `support.language` is the object `markdown()` built, and `isActiveAt` on it is the call
    lang-markdown makes (its CommonMark and GFM languages share one data facet, which is all the check
    compares). The condition ties the command to the one thing lang-markdown documents about when its
    own command does nothing: a non-Markdown context. With the two commands wanting opposite carets,
    their order in the keymap changes no result. A looser rule was tried: "act on whatever Markdown's
    own command passed on, inside a container". A probe pressed Enter at each of 1,092 caret positions
    over 32 small documents; the looser rule gave a different text at 38 of them. Of those, 29 were in
    fenced code, where a blockquote then keeps its `>`. But the looser rule also takes over fenced code in a list
    item, where Enter works today: between a bracket pair (`f(▮)`) the editor's plain Enter puts the
    close bracket on its own line, and the new command does not. It also rests on every reason
    Markdown's own command passes a key on (a caret inside a marker, a line that continues a paragraph
    without its prefix, fenced code), none of which is documented. Those are changes outside HTML that
    need their own decision, so the condition stays.

[^copy]: Every line of an HTML block inside a container already carries the full prefix. An HTML block
    cannot continue on a line that lacks it; only a paragraph can (a "lazy" line). So the caret line's
    prefix is, by construction, the right one for the next line, and no column needs computing. An
    inline tag on a lazy paragraph line has no `>`, and none is added, which keeps the line lazy
    (row C30). A list marker is blanked to spaces of the same length, which lands the new line on the
    item's content column. The alternative was to compute columns from the tree, as
    `indentInsideMarkdownHtml` does with `context.column()`; that needs a tab width, and the editor's is
    not Markdown's. The markers come from the tree because `@lezer/markdown` emits a `QuoteMark` node
    for the `>` of every continuation line, as a child of the block that line belongs to, and a
    `ListMark` for an item's marker. `tree.iterate` over the line's range finds them without entering
    the mounted HTML tree. A probe pressed Enter at each of 1,092 caret positions over 32 small
    documents and counted the positions where Enter changed which containers some later character sits
    in: 182 before this plan, 78 after. Of the 78, 71 give the same text as before (plain Markdown
    carets, fenced code, a caret in front of a marker). The other 7 are a caret directly before a
    character that reads as a marker, which `## Non-Goals` lists.

[^tabs]: CommonMark fixes tab stops at four columns. `context.column()` and the editor's plain Enter
    (`countColumn(…, state.tabSize)`, then `indentString`) measure with the editor's tab size and write
    spaces. With `tabSize` 2, Enter on a tab-indented later line of `1. a` wrote two spaces: column 2,
    one short of the item's content column 3, so the new line left the item (row C17, red before this
    plan). The stack corrects `indentInsideMarkdownHtml`'s own arithmetic separately. The new command
    has no arithmetic to correct. `-→<div>` gives `·→`: one space, then a tab that still runs to
    column 4, the item's content column.

[^tag-pair]: Outside a container the split comes from the editor's plain Enter, through
    `isBetweenBrackets` (commands index.js:1497), which reads each tag's `closedBy` prop. That function
    is not exported, and the prop type belongs to `@lezer/common`, which is not a direct dependency
    (`languages.ts` names its `SyntaxNode` type from `TreeIndentContext` for the same reason). The new
    command checks the HTML grammar's node names, `OpenTag` and `CloseTag`, and requires both tags to
    touch the caret. The HTML grammar turns whitespace between tags into a `Text` node, so the generic
    check only fires when the tags touch too. Not splitting was the alternative: `- <div>` then
    `··▮</div>`. It keeps the close tag in the item as well, but differs from what the same key does at
    the top level. Bracket pairs such as `(▮)` are not split: inside a container Markdown's own command
    does not split them in plain text either (`> (▮)` gives `> (` then `> ▮)`), so brackets behave the
    same in and out of HTML there. Two inline tags are separate mounted trees with no shared element,
    so they get one new line, as at the top level.

[^never-leaves]: The question was whether a second Enter on an empty continuation line should leave
    the container, as it does for plain quoted text. Inside HTML that continues below the caret the
    answer is no: dropping the prefix there splits the block and changes what the lines below mean,
    which is the harm this plan removes. The plain-text behaviour is Markdown's own command's, and it
    still applies wherever Markdown is active: at the end of the block (row C25), and on a blank line
    that ended the block (row C26; in a list item a blank line ends a `<div>` block). One parser detail:
    inside a blockquote the editor's parser keeps a `<div>` block open across a blank quoted line (`>`),
    where CommonMark ends it. There the new command keeps answering and writes `>·` again. That is the
    safe result under either reading, and it also fixes Enter in plain quoted text that follows such a
    blank line, which lost its `>` before.

[^backspace]: `deleteMarkupBackward` (index.js:350–390) is Markdown's own Backspace command. Called
    directly on each state in the table, it handles the list item row and passes the key on for both
    blockquote rows, at `>·▮` and again at `>▮`. The editor's plain Backspace then deletes one character.
    Plain quoted text needs one press for `>·`; here it takes two. A second command that copies
    `deleteMarkupBackward`'s rules for HTML would save that one press. It was judged not worth a second
    command: every intermediate state is valid Markdown, and nothing is deleted that the user did not
    ask to delete.

[^indent-rule-stays]: lang-markdown's Enter command gives up on `!range.empty` first, and the new
    command does the same, so Enter over a selection reaches the editor's plain Enter, which asks the
    indentation rules. On an item's marker line `indentInsideMarkdownHtml` still supplies the content
    column there (row C36; with the rule answering `null`, C36 gives column 0). Making the new command
    replace selections as well would leave this rule with no caller, but it would also make HTML differ
    from plain quoted text, where a selection gets no `>` either. Rows M20–M22 used to be the rule's
    tests and now pass through the new command, which is why C36 is added.

[^nested-languages]: Before this plan, Enter inside `<script>` in a list item used JavaScript's own
    indentation, and in a blockquote it used JavaScript's indentation with no `>`, which left the quote.
    JavaScript's and CSS's rules compute a column from the line's start with the editor's tab size, and
    know nothing about a `>`. Keeping them inside list items but not inside quotes would be two rules
    for one situation. One rule was chosen: in a container, copy the prefix. The cost is that
    `··if (x) {` then Enter gives `··`, not `····` (row C33).

[^static-imports]: `languages.ts` keeps the language packages and formatters behind dynamic `import()`
    so they stay out of the base editor chunk; its header comment says so. The four values the command
    needs come from `@codemirror/language`, `@codemirror/state` and `@codemirror/view`. `CodeEditor.ts`
    imports all three statically (lines 17–26) and is loaded by the same barrel. `syntaxDiagnostics.ts`,
    which `languages.ts` already imports statically, imports `syntaxTree` this way (line 4), so the built
    `languages` chunk already has a static import of `@codemirror/language`. The alternative, passing the
    four values into the command from the loader's dynamic imports, adds parameters and saves no bytes.
    The loader's existing dynamic `import("@codemirror/language")` is left as it is. Checked with
    `npm run build:lib` on a working copy: the seven `@codemirror/lang-*` packages are still dynamic
    imports in the chunk. An option to switch the command off was not added, for the reason the earlier
    plan gave: `registerLanguage` with the same id already replaces the built-in language.

[^order]: Three reasons to implement `codeeditor-bracket-pair-backspace` first. (1) It replaces the
    harness's hand-copied keymap in `TYPING_EXTENSIONS` with the editor's real list, so this plan's 44
    rows are then written once, on the final harness. They were run on both keymap orders with identical
    results, so neither order of implementation breaks a row. (2) It adds the docs paragraph telling a
    language author to raise a keymap with `Prec.high`; this plan's binding is the first in-repo example
    of that rule. (3) Both plans append a changelog bullet and edit neighbouring import lines of
    `code-editor.test.ts`, so doing them one after the other avoids a merge conflict. That plan's keymap
    audit lists Enter as `acceptCompletion`, then Markdown's command, then `insertNewlineAndIndent`. This
    plan adds one binding between the last two, at the precedence that audit describes for a language's
    own keymap.

[^rows-prefix]: The new rows are numbered C1–C41 ("containers"), not M34 onward. Review fixes on the
    stack may add M rows after M33, and a separate prefix cannot collide with them. The sibling plan
    uses B and K in the same way.

[^fenced]: Found while planning. `getContext` returns an empty context as soon as it meets a
    `FencedCode` ancestor (index.js:125), so Markdown's own command passes the key on and the editor's
    plain Enter copies leading whitespace only. In a list item that keeps a later line in the item. In
    a blockquote the `>` is lost, and on an item's marker line the new line starts at column 0. Letting
    the new command take fenced code too would fix both, but it would also change Enter between a
    bracket pair in fenced code inside a list item, which works today. That trade is outside HTML and
    was not asked for, so it is left for its own decision.

[^split-before-marker]: A probe that pressed Enter at 1,092 caret positions found seven where the
    result changes more containers than before, and all seven are of this kind, for example
    `> text <a href="x"▮> more`. Before, the remainder became a line `> more`, where the tag's own `>`
    was read as the quote marker. Now it becomes `> > more`. The tag is broken either way, because
    inside a quote a continuation line cannot start with a literal `>`.

[^readonly]: Seen offline while probing: on a state with `EditorState.readOnly.of(true)`, Enter after
    `- item` still gives `- item` over `- `, because lang-markdown's two commands never read
    `state.readOnly`. Whether a live read-only editor delivers the key to them was not checked. It is
    outside this plan and is reported in the hand-back.

---

## Implementation Notes

Implemented on `feature/markdown-language-enter-inside-html`, branched from `feature/codeeditor-bracket-pair-backspace` at `c0b7ab18f`. That base is six branches above the tip the plan was written against (`4f68f3556`), so every path, line number and claim of the plan was checked against the code before a test was written. The command itself is the plan's, character for character. The differences are around it, and are listed here.

### Differences from the plan

1. **Line numbers.** Each edit was placed by the text the plan quotes. The numbers have moved:

   | Place | Plan | At the base (`c0b7ab18f`) | After this branch |
   |---|---|---|---|
   | the `TreeIndentContext` import in `languages.ts` | 10 | 14 | 14–18 (the five import lines) |
   | the `SyntaxNode` alias | 140 | 144 | 148 |
   | `indentInsideMarkdownHtml` | 157 | 169 | 178 |
   | the four new functions, JSDoc included | — | — | 210–372 (the functions at 223, 262, 302, 330) |
   | the `"markdown"` loader | 185 | 201 | 374; its last statement 401–406 |
   | `describe('built-in markdown language typing', …)` | 3104 | 3223 | 3223 |
   | rows M26 / M32 / M33 | 3397 / 3430 / 3437 | 3521 / 3556 / 3563 | 3521 / 3551 / 3555 |
   | row H1 | 3443 | 3600 | 3810 |
   | the bullets in `CodeEditor.md` | 68–71 | 68–72 | 68–73 |

2. **`languages.ts` already imported from `@codemirror/state`.** A branch of the stack added `import { countColumn } from "@codemirror/state";` for the tab fix in `indentInsideMarkdownHtml`. The plan's value import became `import { countColumn, EditorSelection, Prec } from "@codemirror/state";`. The other four import lines are the plan's.

3. **The file's header comment was corrected.** It said `@codemirror/state` is the one external package imported statically for its code. With this branch there are three (`@codemirror/language`, `@codemirror/state`, `@codemirror/view`), all of which `CodeEditor.ts` imports statically too. The comment now says so. The plan did not name this edit.

4. **Row ids: nothing was renumbered.** Since the plan was written the harness gained rows M34, M36 and M37 (each run at `tabSize` 2, 4 and 8) and M35, between M33 and H1, and rows B1–B24 after H2. The plan numbers its new rows C1–C41 so they cannot collide with later M rows, and no C id exists in `code-editor.test.ts`. The ids were kept as the plan has them, because `plans/markdown-language-readonly-and-fences.md` refers to C21, C23, C24, C25, C35, C36 and C38 by id. The C rows went in after M35 and before H1.

5. **Rows M34 and M36 changed their expected text.** The plan could not name them; it says "M1–M25, M27–M31, H1 and H2 keep their results", and those do. M34 and M36 press Enter on a tab-indented item marker line with HTML below the caret, which is now the new command's case. The new line used to get six spaces, counted in Markdown's columns by `indentInsideMarkdownHtml`. It now gets the marker line's own start: the tab, and two spaces for the marker.

   | Row | Start (`→` is a tab, `·` a space) | Before | After |
   |---|---|---|---|
   | M34 | `→- <div>▮` over `······x` | `······▮` | `→··▮` |
   | M36 | `·→- <div>▮` over `······x` | `······▮` | `·→··▮` |

   Both are column 6 as Markdown counts, at every `tabSize`, so each row's title still holds and was kept. Their comments say what is now copied. M37 (`-→<div>▮` at the end of the document) and M35 keep their results. M37 is now the one row that reaches the rule's column arithmetic with a tab: with `MARKDOWN_TAB_STOP` swapped for the editor's `tabSize`, M37 fails at sizes 2 and 8 and no other row does.

   At step 1 the red set was exactly the plan's 32 rows. After step 2 the six tests of M34 and M36 failed, and were then given the text above. Their new text follows from the plan's own rule (row C14 has the same marker line), but it was confirmed against the implementation, not written before it.

6. **No `typedWith` helper.** The harness's `typed` and `buildTypingState` gained a `tabSize` parameter after the plan was written, which sets `tabSize` and `indentUnit` the way `CodeEditor` does. Rows C15 and C17 pass 8 and 2 through it. That left the helper with one caller, row C38, which builds its read-only state inline, as C36 and C37 build theirs.

7. **`CodeEditor.md`: the list had five bullets and other wording.** The plan replaces "the four bullets on lines 68–71". The base has five, reworded by the stack's review fixes, and one of them (the tab bullet) is not in the plan at all. The list now has six: the plan's five, and the tab bullet narrowed to what is still true.

   | Bullet at the base | Now |
   |---|---|
   | A list item's marker line: indented to the item's content, counted in Markdown's columns | replaced by the plan's "In a blockquote or a list item" bullet. Its clause on what "HTML follows the caret" means — more of the block below, or another tag on the same line (`- <div>\|<p>x</p>`, row M35) — was kept in the new bullet. The Markdown-column sentence moved to the two places where the rule still answers on a marker line: "With text selected", and the end of a block after a bullet followed by a tab (`-→<div>▮`, row M37), which the "At the end of an HTML block" bullet now names |
   | In a blockquote: neither `>` nor the item's indentation | gone: this is the limit the plan removes |
   | Between an adjacent open and close tag: the close tag lands outside the item | the plan's bullet: both new lines get the prefix |
   | Inside `<script>` and `<style>` | the plan's bullet |
   | On a line indented with a tab: counted with `tabSize`, written as spaces | kept, narrowed to "outside every blockquote and list item", plus one sentence: the same holds in a list item when Enter replaces a selection off the marker line. Both were probed at `tabSize` 2 and 8 |
   | — | the plan's "At the end of an HTML block" bullet |
   | — | the plan's "With text selected" bullet |

8. **Changelog.** The last bullet under `## Fixed` → `### Components` is now the bracket-pair one. The new bullet follows it, hard-wrapped at 76 columns with a two-space hanging indent like its neighbours. Its text is the plan's, plus one sentence on bracket pairs added after the review (A2 under "Changes made after the review").

9. **Three test files outside the plan's table.** The run's briefing asked for a round-trip corpus case for each shape Enter can now produce, so that the viewer (`Markdown`) and the WYSIWYG importer are shown to read them alike.

   - `tests/component/markdown-roundtrip/corpus/enterInsideHtml.ts` (new, registered in `corpus/index.ts`): 36 cases. 31 are the documents the rows end with (M26, M32–M34, M36, C1–C14, C16–C18, C21, C23, C24, C28, C29, C31–C33, C37), named by row. Four have text typed on a new line that starts with a tab, and one is M36's document with every line on the marker line's prefix. `referenceLinks.ts` is the precedent for a corpus file per feature.
   - Every case passes `parity`, `idempotence`, `verbatim`, `canonical`, `canonicalIdempotence` and the edit fuzz, so the editor reads each document as the viewer does. 23 cases list a known `surface` divergence, all existing ones: 21 `quoteBlocks` (a quote holding an HTML block loads as a raw block) and 2 `listItemBlocks`. No new divergence was needed.
   - `markdown-roundtrip.test.ts` gained one `describe` of 36 tests and a helper, `leavesWithContainer`. Each test reads a case's document with the viewer and checks two things: the document is one blockquote or one list, and every block from the HTML's first line on sits in the same quote or list item, at any depth. The documents Enter gave before this branch fail it (`> <div>`, an empty line, `> x`: two quotes; `- <div>`, a line of two spaces, `</div>`: a list and a raw block), and so do documents in which a line leaves a nested container only (a close tag one level out of a nested item; a line in the outer of two quotes).
   - **One case is listed as failing that check, and it shows a defect of the viewer, not of Enter.** In M36's document the two lines the row starts with, `······x` and `······</div>`, are read as a code block of the outer item. The viewer counts the tab of the marker line `·→- <div>` as four columns wherever it starts, so it puts the nested item's content at column 7; CommonMark, and the editor's parser, put it at 6. It shows only after an empty line, since before one the lines continue the block lazily. The line Enter adds is not affected: it carries the marker line's own prefix, and the case with all lines on that prefix passes. The document Enter gave before this branch, with six spaces on the new line, is read the same way. The test holds the case in a list of its own, `READ_OUT_OF_ITS_ITEM`, and expects the check to fail for it, so a fix of the viewer turns it red until the entry is removed, as a corpus case's known divergence does.

   So `git diff --stat` against the base touches nine files, not the four of `## Verification`: the plan's four, these three, `component/editor/index.ts` (see 11) and the plan file. `CodeEditor.ts` and `MarkdownEditor.ts` are unchanged.

10. **The addendum's table was re-run** on the final code, one mutant at a time, and again after row C42 was added in the review (see "Changes made after the review"); the table holds the second run. Every part is still pinned. The rows that fail differ from the plan's table only by rows added since:

    | Part removed or changed | Rows that fail now |
    |---|---|
    | the `state.readOnly` check | C38 |
    | the `!range.empty` check | C36 |
    | the two `isActiveAt` checks | C35, M37 |
    | the `Blockquote` / `ListItem` ancestor check | C34, C42 (its top-level line) |
    | list markers copied as written | 20 rows: the plan's 17, and M34, M35, M36 |
    | the `null` for a caret in front of a marker | C22 |
    | the prefix taken only from the text before the caret | C20, C21 |
    | the dropped spaces after the caret | C2, C20, C21, C28 |
    | the second line between adjacent tags | M32, C11, C12, C13 |
    | a second line added on every Enter | 41 rows |
    | the binding itself, or its `Prec.high` | the 32 `R` rows, and M34, M36 and C42 |
    | `indentInsideMarkdownHtml`'s marker-line answer | C36, M37 |
    | the binding listed ahead of `markdown()`'s support | none, as the plan says |

    One part is pinned by no row: the two position tests at the end of `isBetweenAdjacentTags` (`open.to === pos && close.from === pos`). With both removed, every row passes, and so did eleven probes written to separate them (a close tag on the next quoted or indented line, a space or a tab between the tags, a comment or a `<br>` between them, a caret inside the open tag). The HTML grammar puts a `Text` node between two tags that do not touch, so the name test alone already fails there. The tests were kept as the plan has them: they state the function's contract, and the following plan carries the same expression into `isBetweenPair`.

11. **The comment fix asked for with this run** is its own commit. `component/editor/index.ts:3` said "five built-in language definitions"; seven are registered (`javascript`, `json`, `html`, `sql`, `markdown`, `css`, `python`). The same stale count stood in `languages.ts:3` and in the comment on `code-editor.test.ts:11`, and all three were corrected.

12. **No demo was added** (worker step 7). The demo's "MD Editor" tab already holds a source-mode editor in which the fix shows, and V1–V4 were run in it.

13. **Shared files** (`code-editor.test.ts`, `CodeEditor.md`, `next.md`) were edited in the one code commit and the one documentation commit, not in commits of their own, as the commit rules require.

### Checks beyond the plan's own

- **Reach.** `MarkdownEditor` builds its source editor as a `CodeEditor` with `language: "markdown"` ([MarkdownEditor.ts:5038](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L5038)); nothing else in the library names the language. Both get the command from the one loader. `CodeEditor.ts` has no Markdown- or HTML-named code.
- **Read-only.** Row C38, and on a mounted view: with `EditorState.readOnly` set on the demo's source editor, a real Enter key at `> <div>▮` changes nothing. Markdown's own Enter still edits a read-only editor (`- item▮` gains a `- ` line), as the plan's note says; that is defect 2 of the following plan and was not touched.
- **A tab, mounted.** `→- <div>▮` over `→··x` in the demo, a real Enter: the new line is `→··`.
- **Carets the plan has no row for**, probed on the harness. All give what the plan's rules say: an ordered marker of two digits (`10. <div>▮` gives four spaces); an indented list and an indented quote (`··- <div>▮`, `···> <div>▮`: the indentation is copied); an inline tag on an item's marker line (`- text <a href="x"▮ title="y">` gives two spaces); an inline tag on a lazy line of a list item (no prefix); a `style` attribute and a `<style>` block in a quote (the `>` is kept); Enter, typed text, Enter again in a quoted block (both new lines have the `>`); a caret right after a `>` on a line inside the block (`>▮ x`: Markdown is active there, so Markdown's own command answers, as before).
- **A task marker.** `- [ ] <div>▮` over `··x` is not this command's: the `<div>` is an inline tag at the end of the item's paragraph, Markdown is active after the caret, and Markdown's own command continues the task list, as before this branch.
- **Line separator.** `CodeEditor` never sets `EditorState.lineSeparator`, so `state.lineBreak` is always one character there. The caret is placed with `pos + 1 + prefix.length`, which is right for any separator, as the plan's comment says; no row sets another separator, since the editor cannot.
- **IME composition**, read from the source only: CodeMirror drops key events during a composition, so no Enter binding runs then, before or after this branch.
- **The editor's parser against the viewer's.** After Enter on `> <div>▮` over `> x`, the editor's parser still reads one HTML block across the new empty `> ` line, and the viewer ends the block there, as CommonMark does. Both keep every line in the quote, which is what the corpus cases and the test over them pin. The same difference exists at the top level (row M24) and is not new.

### Changes made after the review

The first review round had one blocking finding, a wrong line number in these notes (the five import lines are at 14–18, not 13–17; corrected in difference 1). Its advisory findings were fixed in the same pass, under the user's standing rule for this stack that advisories are fixed, not left, so that the second round read the fixes. Each fix was folded into the commit it belongs to.

| # | Advisory | What was done |
|---|---|---|
| A1 | `CodeEditor.md` said "Enter never removes the prefix while the HTML continues after the caret", while row C26 shows a second Enter removing the indentation under `- <div>` with `</div>` still below | The bullet now explains the case: in a list item outside a blockquote, the new line holds only spaces, which is a blank line to Markdown, and a blank line ends a block such as `<div>` (not `<pre>`, `<script>`, `<style>` or a comment). The second Enter is then on a Markdown line. Probed for each of those five blocks, and in a blockquote, where the prefix is kept for all of them |
| A2 | Inside `<script>` or `<style>` in a list item, Enter between a bracket pair (`f(▮)`) used to move the closing bracket to its own line and no longer does. The plan decides this (notes `[^tag-pair]` and `[^nested-languages]`), but no row pinned it and neither the docs nor the changelog said it | Row **C42** pins it in a blockquote and in a list item, for `<script>` and `<style>`, with the top-level result beside them, which is unchanged. The `<script>` bullet of `CodeEditor.md` and the changelog bullet each gained a sentence |
| A3 | The two position tests in `isBetweenAdjacentTags` are pinned by no row | Nothing changed: see difference 10 |
| A4 | The comment-fix commit and the corpus cases rest on the run's briefing, which the reviewer could not see | Nothing changed. Both are listed under "Decisions that await the user's sign-off" |
| A5 | M34 and M36 were given their new text after they went red | Nothing changed: see difference 5 |

The second round had one blocking finding, again in these notes: the table in difference 10 had not been re-run after row C42 was added, and three of its cells lacked C42. It was re-run and corrected. Its one advisory was fixed in the same pass:

| # | Advisory | What was done |
|---|---|---|
| A6 | The test "what Enter leaves inside HTML stays in its blockquote or list" checked only that the document is one top-level block, so a line that left a nested container but stayed in the outermost one passed | The test now also checks that every block from the HTML's first line on sits in the same quote or list item (difference 9). Tried on ten documents with a line moved out of a container, it fails for the eight the viewer reads that way. It also failed for one real case, M36, which is how the viewer's column count for a tab after a space was found (difference 9, and "Found on the way") |

The third round was the loop's last: its cap is three. It had one blocking finding, once more in these notes, and its fix and the fixes of its advisories were made after the loop ended. **No reviewer has read them.** They touch only `CodeEditor.md` and these notes. The session that ran the work compared the two documentation sentences with row M37 on 2026-10-11, found them to agree, and closed the plan on that.

| # | Finding | What was done |
|---|---|---|
| B | Difference 7 called "With text selected" the one place the rule still answers on a marker line. Row M37 is a second: a bare caret at `-→<div>▮`, a bullet followed by a tab with the block ending at the caret. Markdown's own command accepts only spaces after a bullet, passes the key on, and the rule answers. `CodeEditor.md` had the same gap, as it had at the base | Difference 7 corrected. The "At the end of an HTML block" bullet of `CodeEditor.md` gained a sentence for that marker line. Probed: `-→<div>▮` gives four spaces, also with `- next` below; an ordered marker followed by a tab (`1.→<div>▮`) is continued by Markdown's own command with `2.` |
| A7 | `CodeEditor.md` said that with text selected "on a list item's marker line the new line is still indented to the item's content", which does not hold in a blockquote: `> - <div>` with text selected gives a new line at column 0 | The sentence now says "outside a blockquote". The sentence before it already says a selection gets no `>` |
| A8 | Inside `<script>` or `<style>` in a list item, JavaScript's or CSS's own indentation and the bracket-pair split are gone (rows C33 and C42), and the entry is filed under "Fixed" | Nothing changed: the plan decides both, and the docs and the changelog say both. It is listed for the user's eye under "Decisions that await the user's sign-off" |
| A9 | A new line of only spaces can still change what follows it: in `- <table>` over a deeper-indented `<tr>▮` and `<td>` lines, Enter adds a blank line that ends the HTML block, and the deeper lines below become an indented code block | Nothing changed: the result is the same before this branch, and the same at the top level (row M24's kind). Recorded under "Found on the way" |
| — | The two position tests in `isBetweenAdjacentTags`; the additions that rest on the run's briefing; V1–V4 not re-run by the reviewer | Carried forward from the earlier rounds; nothing changed |

These fixes add to what differs from the plan: row C42 is not in the plan, four docs sentences and one changelog sentence go beyond the plan's wording, and the corpus has one more case.

### Found on the way

- **The viewer counts a tab that follows a space as four columns.** A nested list item whose marker line is indented by a space and a tab (`·→- b`) has its content at column 6 in CommonMark and at column 7 in `Markdown`. After a blank line, a line indented by six spaces is then an indented code block of the outer item in the viewer, and a paragraph of the nested item in CommonMark; a line indented by seven spaces, or by the marker line's own `·→··`, is in the nested item in both. `MarkdownEditor` reads it as the viewer does, so the two agree with each other. A tab with nothing in front of it (`→- b`) and a tab after the marker (`-→b`) are read as CommonMark reads them. This is not Enter's doing and was not changed here; it is a defect of the viewer's list reading, for a plan of its own. It also means the copied prefix is the one prefix both readers agree on for such a line: the six spaces Enter wrote there before this branch are the column CommonMark counts, which the viewer does not.
- **A blank new line can end the HTML block it is in.** Enter inside an HTML block that a blank line ends (`<div>`, `<table>`; not `<pre>`, `<script>`, `<style>` or a comment) leaves a line that is blank until something is typed on it, and in a list item, where the prefix is spaces only, the block ends there for the editor's parser too. Lines below that are indented deeper than the item's content then read as an indented code block. This is the same before this branch and at the top level, and typing on the new line undoes it. The plan's "leaves every line below meaning what it meant" holds for which container a line is in, not for this.
- **Markdown's own Enter and Backspace still edit a read-only editor**, as the plan's note `[^readonly]` says and as "Checks beyond the plan's own" confirms. It is defect 2 of the following plan.

### Verification

- `npm run typecheck`, `npm run typecheck:test`, `npm run lint`: clean. `npm run test`: green (the count is in the run's report). `npm run docs:api`: no warnings. `npm run docs:llms:check`: OK.
- `grep -c 'run: continueContainersInsideHtml(support.language)' …/languages.ts` prints `1`.
- `npm run build:lib` succeeds, and `grep -c 'from"@codemirror/lang-' dist/lib/languages-*.js` prints `0`. The chunk's static CodeMirror imports are `@codemirror/language`, `@codemirror/state` and `@codemirror/view`; the seven `@codemirror/lang-*` packages are dynamic imports.
- V1–V4 were run on 2026-10-11 against the worktree's own demo server (`127.0.0.1:5397`, not 8015), in the "MD Editor" tab's source mode, with real key events sent through Chrome DevTools. All four gave the expected result: `> :::` on a new line 2; `- <div>`, a line of two spaces with the caret, `··</div>`; Enter accepted the `span` completion and added no line; one `Ctrl-Z` removed the new line and its `> ` and left `abc`. The console showed no error or warning.

### Decisions that await the user's sign-off

No non-goal was reversed and the command does nothing the plan does not describe. Five things were written that the user has not seen, and a sixth is listed for the user's eye:

- **Rows M34 and M36 now expect the copied tab** (difference 5). It follows from the plan's "Tabs are copied, never measured", and the following plan already assumes it, but these two rows were accepted with six spaces. It cannot be separated from the command: it is in the code commit.
- **The corpus cases and the test over them** (difference 9). Tests only; the cases were asked for by the run's briefing, the test over them was not. They are in the code commit, in three files of their own under `tests/component/markdown-roundtrip/`. The test lists M36's document as one the viewer reads out of its item, which is the viewer's defect under "Found on the way"; whether to fix that is the user's call.
- **The `CodeEditor.md` list** (difference 7): six bullets where the plan wrote five, with the tab bullet kept in a narrower form. It is in the documentation commit, with the sentences added after the review (A1, A2, B and A7 above), one of them in the changelog.
- **Row C42** (A2 above) pins a result the plan decides in a footnote but has no row for. It is in the code commit.
- **For the user's eye, though the plan decides it:** inside `<script>` or `<style>` in a list item, Enter used to apply JavaScript's or CSS's own indentation and to split a bracket pair over three lines, and no longer does (rows C33 and C42). It worked there before; in a blockquote it never did, since the `>` was lost. The changelog files the whole entry under "Fixed" and says so in its text. The following plan brings the bracket-pair split back.
- **The comment fix reaches three files** (difference 11), where the briefing named one. It is its own commit.

### For the plan that follows

**`markdown-language-readonly-and-fences`**

- The four functions it replaces are in `languages.ts` exactly as this plan's `## Internal Structure` gives them, at 210–372, JSDoc included, and the loader's last statement is at 401–406. Its replacement block applies as written.
- The value import from `@codemirror/state` is `import { countColumn, EditorSelection, Prec } from "@codemirror/state";`: keep `countColumn` when adding `ChangeSpec` to the type import.
- The header comment of `languages.ts` now names the three CodeMirror packages imported statically. A type-only import does not change it.
- `CodeEditor.ts` is untouched: `buildReadOnlyExtension` is still at 372–385 and unexported, and `codeEditorKeymap` at 412.
- `code-editor.test.ts`: the value import from `@codemirror/state` already names `StateEffect`. There is no `typedWith` helper (difference 6). Rows C1–C42 are at 3598–3808, between M35 and H1; C24 is at 3700, C35 at 3754, C36 at 3759, C38 at 3779, C42 at 3800. Row ids taken in the file: M1–M37, C1–C42, H1, H2, B1–B24, K1–K4.
- M34 and M36 are as its note `[^m34]` expects: they hold the copied tab.
- **Row C42 is a third row that plan changes**, beside C24 and C35, which it names. C42 pins that Enter between a bracket pair inside `<script>` or `<style>` in a container adds one line. That plan's "Between an empty pair, both new lines get the prefix" (its row F27) splits the pair there, so C42's three contained results change with it; its fourth, at the top level, does not. The sentences on bracket pairs in the `<script>` bullet of `CodeEditor.md` and in this branch's changelog bullet change with it too.
- **The corpus follows its changed rows.** `corpus/enterInsideHtml.ts` holds the document row C24 ends with (`'Enter twice in a pre block in a list item (C24)'`). When that plan empties C24's middle line, change the case's `source` with the row. C35 has no case, since its result leaves the quote; once Enter keeps the `>` there, a fenced-code case belongs in the corpus too (`'code fence in blockquote'` in `dialect.ts` is the nearest existing one), and so do the new shapes its F and S rows end with. The test over them in `markdown-roundtrip.test.ts` runs over every case of that file. It expects one quote or one list, by the document's first character, and every block from the first HTML block on in one quote or list item; a case the viewer reads otherwise has to be listed in `READ_OUT_OF_ITS_ITEM` with its reason.
- `CodeEditor.md`'s list has six bullets (difference 7). The tab bullet says a tab is measured "outside every blockquote and list item", and in a list item when Enter replaces a selection off the marker line; that plan's F16–F18, F32, F34 and its selection rows change parts of it.
- The read-only check in the command is pinned by C38 on a state that sets only `EditorState.readOnly`. On a mounted view the same was seen by appending `Prec.highest(EditorState.readOnly.of(true))` to the demo's source editor: the "MD Editor" tab has no read-only switch, as that plan notes.
- No row can tell `isBetweenAdjacentTags`'s two position tests from their absence (difference 10). `isBetweenPair` carries the same expression, so the same will hold there unless a row is found.
