---
depends-on: [markdown-columns-fixes]
touches-shared:
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/docs/components/MarkdownEditor.md
---

# Markdown Source Mode HTML Typing — Implementation Plan

## Overview

Typing an HTML block in `MarkdownEditor`'s source mode changes the document. Typing `<div>` Enter `:::` Enter `</div>` produces this, with the caret at `|`:

```
<div>
  :::
</div>|
</div>
```

Source mode is a `CodeEditor` built with `language: "markdown"` ([MarkdownEditor.ts:2201](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2201)). The built-in `"markdown"` language calls `@codemirror/lang-markdown`'s `markdown()` with no options ([languages.ts:134](packages/lib/src/typescript/lib/component/editor/languages.ts#L134)). By default, `markdown()` hands HTML to `@codemirror/lang-html`, and two parts of that HTML support act on Markdown text:

| Cause | Where (installed versions) | What it does |
|---|---|---|
| `autoCloseTags` | `@codemirror/lang-html` 6.4.12, `html()` installs it unless `autoCloseTags: false`; `markdown()`'s default `htmlTagLanguage` is `html({ matchClosingTags: false })` | Typing the `>` of `<div>` inserts `</div>` after the caret. Typing `</` inside an element that has no close tag inserts `div>`. |
| The HTML grammar's indentation rules (`indentNodeProp` on `Element`, `OpenTag`, `CloseTag`, `SelfClosingTag`, `Document`) | `@codemirror/lang-html` 6.4.12, `htmlLanguage` | Enter (`insertNewlineAndIndent`, the fallback after Markdown's own Enter command declines in HTML) indents the next line one unit deeper and splits `<div>|</div>` onto three lines. `indentOnInput()` re-indents a line the moment it reads `</tag>`. |

Each step of the example traces to one row.[^cause] Indentation means something in Markdown: four spaces start an indented code block, and inside a list it decides which item a line belongs to. So both behaviours can silently change what the document says.

This plan changes the built-in `"markdown"` language so HTML is typed literally. The change sits in its loader in `languages.ts`. `CodeEditor` and `MarkdownEditor` are not edited, and no public API changes.

---

## Architecture Decisions

### The fix lives in the `"markdown"` loader — mirrors the `"json"` loader

The `"markdown"` entry's `loadExtension` builds `markdown()` with a custom `htmlTagLanguage`. That HTML language parses and highlights HTML as before, but has no `autoCloseTags` and no indentation rules. This follows the `"json"` entry ([languages.ts:39](packages/lib/src/typescript/lib/component/editor/languages.ts#L39)), whose loader adds behaviour to a built-in grammar inside `loadExtension`.[^json-precedent] `htmlTagLanguage` is `markdown()`'s documented option for replacing its HTML support.

### Change the built-in default, not a per-host option

Every `CodeEditor` with `language: "markdown"` gets literal HTML typing. That covers `MarkdownEditor`'s source mode, a standalone `CodeEditor`, and the `Markdown` viewer's read-only ```` ```md ```` blocks (which cannot be typed in, so they are unaffected). No `MarkdownLanguageOptions` type is added, and `MarkdownEditor` passes no `languageOptions`.[^default-not-option] A consumer who wants HTML auto-closing in Markdown can register its own `"markdown"` language: `registerLanguage` replaces an entry with the same id.

### Indentation rules return `null`; Enter then keeps the current line's indentation

The custom HTML language overrides the five indentation rules with `() => null`. A `null` from CodeMirror's indentation lookup means "no opinion". `insertNewlineAndIndent` then copies the current line's leading whitespace, and `indentOnInput()` leaves the line alone. That is what Enter already does on a plain Markdown paragraph line. Inside a list item, copying the indentation keeps an HTML block inside the item.[^null-indent]

| Typed (caret at end) | Next line after Enter, before | After |
|---|---|---|
| `<div>` | `··` (two spaces) | empty (column 0) |
| `··foo` inside `<div>` | `··` | `··` (copied) |
| `··</div>` typed on that line | moved to column 0 | stays at `··` |

### Markdown list and blockquote continuation stays

Markdown's own Enter command (`insertNewlineContinueMarkup`, installed by `markdown()` at high precedence) is unchanged. It runs wherever the Markdown grammar is active at the caret, including at the end of a list item's first line that holds HTML. So `- <div>` Enter gives `- <div>` over `- `, the same as `- item` Enter. One Backspace then turns the new `- ` into `··`, CodeMirror's built-in way to continue an item without a new marker.[^keep-continuation]

### HTML tag completion stays

`markdown()`'s `completeHTMLTags` and the HTML completion source stay on. They insert nothing unless the user accepts a suggestion.[^keep-completion]

---

## Internal Structure

The new `"markdown"` loader. All three packages are imported dynamically, like every other loader in the file. `@codemirror/language` and `@codemirror/lang-html` are already runtime dependencies (`packages/lib/package.json`) and are `external` in the lib build.

```ts
registerLanguage({
    id: "markdown",
    label: "Markdown",
    loadExtension: async () => {
        // Indentation in Markdown is meaningful (four spaces start an indented
        // code block; inside a list it picks the item a line belongs to), so
        // HTML inside Markdown is typed literally: no auto-inserted close tags,
        // and no HTML indentation rules. A `null` indentation makes Enter keep
        // the current line's indentation, as on any other Markdown line.
        const [{ markdown }, { html, htmlLanguage }, { indentNodeProp, LanguageSupport }] = await Promise.all([
            import("@codemirror/lang-markdown"),
            import("@codemirror/lang-html"),
            import("@codemirror/language"),
        ]);

        // dialect "noMatch" mirrors markdown()'s own default HTML language
        // (tag matching off); html({ autoCloseTags: false }).support keeps its
        // tag completion and the nested <script>/<style> support.
        const literalHtml = new LanguageSupport(
            htmlLanguage.configure({
                dialect: "noMatch",
                props:   [indentNodeProp.add({ "Document Element OpenTag CloseTag SelfClosingTag": () => null })],
            }),
            html({ autoCloseTags: false }).support,
        );

        return markdown({ htmlTagLanguage: literalHtml });
    },
    loadFormatter: async () => formatWithPrettier("markdown", async () => [await import("prettier/plugins/markdown")]),
});
```

`indentNodeProp.add` takes space-separated node names, and a later prop source overrides the grammar's own value for the same node, so the five HTML rules are replaced only in this configured copy. The standalone `"html"` language still uses the plain `html()` and keeps auto-closing and indentation.

---

## Ordered Implementation Steps

1. **Write the failing tests** in [packages/lib/tests/component/code-editor.test.ts](packages/lib/tests/component/code-editor.test.ts). Add `describe('built-in markdown language typing', …)` between `describe('built-in sql language options'` (line 2988) and `describe('CodeEditor languageOptions'` (line 3102).
   - Imports. Change line 19 `import type { EditorView } from '@codemirror/view';` to `import { EditorView, keymap } from '@codemirror/view';`. Add `import type { Extension, Transaction } from '@codemirror/state';`. Add `indentOnInput` to the `@codemirror/language` import on line 20, and `closeBrackets` to the `CompletionContext` import on line 21. Add `import { defaultKeymap } from '@codemirror/commands';`.
   - Add a DOM-free typing harness inside the `describe`, with JSDoc on each function:[^harness]
     - `const TYPING_EXTENSIONS: Extension[] = [keymap.of(defaultKeymap), indentOnInput(), closeBrackets()]`. Comment: these are the extensions from `CodeEditor`'s `mount()` that take part in typing ([CodeEditor.ts:2162](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2162), 2178, 2198).
     - `async buildTypingState(languageId: string, doc: string): Promise<EditorState>`. Loads `getLanguage(languageId)!.loadExtension()` and creates `EditorState.create({ doc, selection: EditorSelection.cursor(doc.length), extensions: [extension, ...TYPING_EXTENSIONS] })`.
     - `settle(state: EditorState): EditorState`. Runs `ensureSyntaxTree(state, state.doc.length, Infinity)` and returns `state.update({}).state`, as `buildSqlState` does.
     - `pressKey(state: EditorState, key: "Enter" | "Backspace"): EditorState`. Walks `state.facet(keymap)` (binding groups, highest precedence first). Runs each binding whose `key` matches and has a `run`, passing `{ state, dispatch }`. Stops at the first that returns `true`. Returns the dispatched state, or `state` if none ran.
     - `typeText(state: EditorState, text: string): EditorState`. For each character, it first settles the state. `"\n"` calls `pressKey(state, "Enter")` and `"\b"` calls `pressKey(state, "Backspace")`. Any other character goes to each `state.facet(EditorView.inputHandler)` handler in turn. Each handler gets a view stub `{ state, composing: false, compositionStarted: false, dispatch }` cast through `unknown` to `EditorView`, plus `(from, to, char, insert)`, where `insert()` returns `state.update({ changes: { from, to, insert: char }, selection: EditorSelection.cursor(from + 1), userEvent: "input.type" })`. If no handler returns `true`, apply `insert()`. The stub's `dispatch` takes `...trs: (Transaction | readonly Transaction[])[]` and keeps the last `.state` from the flattened list (`autoCloseTags` dispatches an array).
     - `show(state: EditorState): string`. Returns the doc with `|` inserted at the main caret.
   - Move `completionLabels` out of the `built-in sql language options` `describe` to module scope, unchanged, so M16 can use it too. Do not copy it.
   - Write one `it` per row of `## Expected Behaviour` marked *offline*. Run `npx vitest run tests/component/code-editor.test.ts -t 'built-in markdown language typing'` from `packages/lib`. Expect M1–M6, M12 and M14 to fail. Expect M7–M11, M13, M15–M17, H1 and H2 to pass already: they are regression pins.
2. **Change the `"markdown"` loader** in [packages/lib/src/typescript/lib/component/editor/languages.ts:134](packages/lib/src/typescript/lib/component/editor/languages.ts#L134) to the version in `## Internal Structure`. Re-run the step-1 command: all pass.
3. **Run the whole file and the Markdown suites.** `npx vitest run tests/component/code-editor.test.ts tests/component/markdown-editor.test.ts tests/component/display/Markdown.test.ts` — all green.
4. **Document the behaviour** in [packages/lib/docs/components/CodeEditor.md](packages/lib/docs/components/CodeEditor.md). Insert this paragraph after the built-in languages table, before line 64 ("Both the grammar and the formatter load…"):

   > The `markdown` language types HTML literally, because indentation changes what Markdown means (four spaces start a code block; in a list it decides the item). Typing `<div>` does not add `</div>`, typing `</` does not complete the tag, and Enter inside an HTML block keeps the current line's indentation, as on any other Markdown line. HTML is still highlighted, and tag completion still offers names when you type `<`. To get HTML auto-closing back, register your own `markdown` language with [`registerLanguage`](#registering-a-language).
5. **Point to it from** [packages/lib/docs/components/MarkdownEditor.md](packages/lib/docs/components/MarkdownEditor.md). Append one sentence to the paragraph at line 211 ("Both surfaces are bound…"): `In "source" mode, HTML is typed literally — no close tags are added and Enter keeps the line's indentation; see [CodeEditor's built-in languages](/components/CodeEditor#built-in-languages).`
6. **Add the changelog entry** to [packages/lib/docs/reference/changelog/next.md](packages/lib/docs/reference/changelog/next.md), under `## Fixed` → `### Components`, as the last bullet of that subsection (after the `MarkdownEditor` saves `:::` columns entry at line 540):

   > - **Typing HTML in Markdown source no longer adds or re-indents text.** In `MarkdownEditor`'s `"source"` mode, and in any `CodeEditor` with `language: "markdown"`, typing `<div>` inserted a `</div>` after the caret. Typing `</` inside an open element completed the tag, so typing the rest of `</div>` left `</div>div>`. Enter inside an HTML block indented the next line, which can turn Markdown inside the block into a code block or move it out of a list item. HTML is now typed as written: no close tag is added, and Enter keeps the current line's indentation, as on any other Markdown line. List and blockquote continuation on Enter is unchanged. No consumer action is needed.
7. **Run the full checks** in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/languages.ts` |
| Modify | `packages/lib/tests/component/code-editor.test.ts` |
| Modify | `packages/lib/docs/components/CodeEditor.md` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Notation: `⏎` is Enter (`"\n"` in `typeText`), `⌫` is Backspace (`"\b"`), `|` is the caret, `·` is one space. "Start doc" is the text before typing, with the caret at its end. *Offline* rows are unit tests through the step-1 harness against `getLanguage('markdown')` (M rows) or `getLanguage('html')` (H rows). The "Before" column records what the unfixed language produces. It shows which rows must start red and is not asserted.

| # | Start doc | Keys | After (asserted) | Before | Test |
|---|---|---|---|---|---|
| M1 | empty | `<div>⏎:::⏎</div>` | `<div>\n:::\n</div>\|` | `<div>\n··:::\n</div>\|\n</div>` | offline |
| M2 | empty | `<details>⏎<summary>S</summary>⏎⏎Body⏎⏎</details>` | the keys exactly, caret at end | every non-blank line after the first indented `··`, plus a trailing `\n</details>` after the caret | offline |
| M3 | `<div>\nfoo\n` | `</` | `<div>\nfoo\n</\|` | `<div>\nfoo\n</div>\|` | offline |
| M4 | `<div>\nfoo\n` | `</div>` | `<div>\nfoo\n</div>\|` | `…</div>div>\|` | offline |
| M5 | `<div>` | `⏎` | `<div>\n\|` | `<div>\n··\|` | offline |
| M6 | `<div>\n··foo` | `⏎</div>` | `<div>\n··foo\n··</div>\|` | `…\n</div>div>\|` | offline |
| M7 | empty | `text </` | `text </\|` | same | offline |
| M8 | empty | `- item⏎` | `- item\n- \|` | same | offline |
| M9 | empty | `1. one⏎` | `1. one\n2. \|` | same | offline |
| M10 | empty | `> quote⏎` | `> quote\n> \|` | same | offline |
| M11 | ```` ```\n··code ```` | `⏎` | ```` ```\n··code\n··\| ```` | same | offline |
| M12 | empty | `- <div>⏎` | `- <div>\n- \|` | `- <div>\n··\|\n</div>` | offline |
| M13 | `- a\n··<div>` | `⏎` | `- a\n··<div>\n··\|` | same | offline |
| M14 | empty | `- <div>⏎⌫:::⏎</div>` | `- <div>\n··:::\n··</div>\|` | `- <div>\n:::\n</div>\|\n</div>` | offline |
| M15 | `<div>\n:::\n</div>` | none | `syntaxTree(state).resolveInner(2, 1).name` is `"TagName"`: HTML is still parsed, so still highlighted | same | offline |
| M16 | `<di` | none | `completionLabels(state)` includes `"<div"` | same | offline |
| M17 | `> <div>` | `⏎:::` | `> <div>\n> :::\|` | same | offline |
| H1 | empty | `<div>` on `getLanguage('html')` | `<div>\|</div>` — the standalone HTML language still auto-closes | same | offline |
| H2 | empty | `<div>⏎` on `getLanguage('html')` | `<div>\n··\|\n</div>` | same | offline |
| V1 | `MarkdownEditor` in `"source"` mode (demo "MD Editor" tab, "Edit Markdown source" toggle) | M1, M4, M6, M12 and M14 typed by hand | the source text matches the offline rows exactly | — | manual |
| V2 | a standalone `CodeEditor` with `language: "markdown"` | M1–M17 | same results: a standalone editor loads the same `getLanguage('markdown')` extension the M rows test, and `MarkdownEditor`'s source surface (V1) is such an editor, built with only `language: "markdown"` | — | offline (M rows) + V1 |
| V3 | the V1 editor | type `<di`, wait for the completion popup, keep typing `v>` | popup closes on `>`; text is `<div>` only | — | manual |

---

## Verification

- `npm run typecheck` and `npm run test` from the repo root — green.
- `npm run lint` — clean.
- `npm run docs:api` — finishes with zero warnings.
- `grep -n 'htmlTagLanguage' packages/lib/src/typescript/lib/component/editor/languages.ts` — one match, in the `"markdown"` entry.
- `git diff --stat` touches only the five files in `## Files to Create / Modify / Delete`; `CodeEditor.ts` and `MarkdownEditor.ts` are unchanged.
- Manual: V1 and V3 with `npm run dev`, on the demo's "MD Editor" tab.

---

## Potential Challenges

- **The harness and the real editor drift apart.** `TYPING_EXTENSIONS` copies three entries from `mount()`; the V1 manual check confirms the live editor matches.
- **`autoCloseTags` dispatches two transactions as an array.** The stub's `dispatch` must flatten its arguments and keep the last state, or M3/M4 under the old language give misleading results.
- **The syntax tree must be complete before each keystroke.** Input handlers and indentation read `syntaxTree(state)`; `settle()` before every character keeps results deterministic.
- **`EditorView` becomes a value import in the test file.** Other uses of `EditorView` there are type positions and keep compiling unchanged.

---

## Critical Files

- [packages/lib/src/typescript/lib/component/editor/languages.ts](packages/lib/src/typescript/lib/component/editor/languages.ts) — the `"markdown"` entry (line 134) and the `"json"` entry (line 39), the precedent for adding behaviour inside a loader.
- [packages/lib/src/typescript/lib/component/editor/CodeEditor.ts:2140](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2140) — `mount()`'s extension list: the keymap (2162), `indentOnInput()` (2178), `closeBrackets()` (2198) the harness mirrors.
- [packages/lib/tests/component/code-editor.test.ts:2988](packages/lib/tests/component/code-editor.test.ts#L2988) — `buildSqlState` and `completionLabels`, the pattern for loader-level state tests.
- `node_modules/@codemirror/lang-markdown/dist/index.js` — `htmlNoMatch` (line 402), `markdown()` (406–429), `insertNewlineContinueMarkupCommand` (204).
- `node_modules/@codemirror/lang-html/dist/index.js` — the indentation rules (536–560), `html()` (594–610), `autoCloseTags` (627–668).
- `node_modules/@codemirror/commands/dist/index.js` — `isBetweenBrackets` (1497) and `newlineAndIndent` (1521; the `null` fallback at 1532–1533).

---

## Non-Goals

- **List continuation inside HTML.** `- <div>` Enter starting a new item is Markdown's existing behaviour and stays (see the decision above).
- **Indentation inside `<script>` / `<style>`.** JavaScript and CSS keep their own indentation there. An HTML block that starts with `<script>` or `<style>` runs to its closing tag, so indentation inside it does not change the Markdown.
- **`closeBrackets()`.** It is a generic `CodeEditor` behaviour, and typing the closing character types over the inserted one, so typed text still comes out as written.
- **An options type for the `"markdown"` language.** Nothing needs to turn the old behaviour back on (see the decision above).
- **A Markdown button in the CodeEditor demo.** `MarkdownEditor`'s source mode exercises the same language.

---

## Notes

[^cause]: Traced by running the installed packages (lang-markdown 6.5.2, lang-html 6.4.12,
    commands 6.10.4, language 6.12.4) on an `EditorState`, with `defaultKeymap`,
    `indentOnInput()` and `closeBrackets()` added as `mount()` adds them. Typing `<div>`:
    on `>`, `autoCloseTags` inserts `</div>` → `<div>|</div>`. Enter: Markdown's
    `insertNewlineContinueMarkup` declines because the caret is in HTML, so
    `insertNewlineAndIndent` runs. It sees the caret between an `OpenTag` and a
    `CloseTag` (`isBetweenBrackets` follows the tag's `closedBy` prop), splits them onto
    three lines, and indents the middle line by the HTML `Element` rule →
    `<div>\n··|\n</div>`. `:::` lands indented. The second Enter keeps that indentation.
    The user's own `</div>` does not trigger the `/` completion here, because the
    element already has a close tag. On `>`, `indentOnInput()` matches the HTML
    language's `indentOnInput: /^\s*<\/\w+\W$/` and moves the line to column 0. That
    leaves the auto-inserted `</div>` below it. When the open tag was not just typed
    (a loaded document, or after deleting the auto-inserted tag), typing `</` makes
    `autoCloseTags` insert `div>`, and typing on gives `</div>div>` (rows M4, M6).

[^json-precedent]: Searched for how the codebase adjusts a built-in grammar's behaviour.
    The `"json"` loader returns `[json(), jsonLanguage.data.of(…)]`, adding a completion
    source inside `loadExtension`. The `"sql"` loader picks a grammar variant inside
    `loadExtension` from `SqlLanguageOptions`. Both keep language-specific behaviour in
    the language's own registry entry, which is why `CodeEditor` has no SQL- or
    JSON-named API. The same seam keeps `CodeEditor` free of Markdown- or HTML-named API
    here. `MarkdownEditor` does not configure the language today: it passes only
    `language: "markdown"`, no `languageOptions` (MarkdownEditor.ts:2201). So there is no
    existing Markdown options path to extend.

[^default-not-option]: The alternative was a `MarkdownLanguageOptions` (for example
    `{ htmlTyping: "literal" }`) passed through `languageOptions` by `MarkdownEditor`
    only. It was rejected. The behaviour changes the meaning of Markdown text wherever it
    is typed, so a standalone `CodeEditor` with `language: "markdown"` has the same
    defect. Keeping it as the default would leave that defect in place. Defaulting the
    option to "literal" instead would add an option nobody asked for, whose only use is
    turning a defect back on (CLAUDE.md: no unrequested configurability). The
    `registerLanguage` override is already a documented escape hatch. Changing the
    default needs no `MarkdownEditor` edit, which also keeps this plan off
    `MarkdownEditor.ts`, the file the sibling Markdown plans edit.

[^null-indent]: Two other mechanisms were considered. (1) An `indentService` returning
    `null` whenever `htmlLanguage.isActiveAt(...)` is true. It works, but it is a second,
    document-wide hook that has to re-detect "inside HTML" itself, while overriding the
    HTML grammar's own rules scopes the change to exactly the HTML nodes. (2) A high-
    precedence Enter binding that inserts a plain newline in HTML. It fixes Enter but not
    `indentOnInput()`, which would still move a typed `··</div>` to column 0 (row M6).
    Returning `null` reaches both paths, because both ask the same indentation lookup.
    `newlineAndIndent` falls back to copying the line's whitespace on `null`
    (commands/dist/index.js:1532–1533), and `indentOnInput` skips a line whose
    indentation is `null`. Markdown's own grammar already returns `null` for its
    `Document` node, which is why a paragraph line keeps its indentation on Enter. HTML
    lines now behave the same way.

[^keep-continuation]: `insertNewlineContinueMarkup` decides by whether the Markdown
    grammar is active on either side of the caret (lang-markdown index.js:207). At the
    end of `- <div>` with nothing after it, the right side is Markdown, so it continues
    the list as for `- item`. Special-casing "first line of an item that holds HTML"
    would mean re-implementing lang-markdown's private list-context logic (`getContext`)
    to compute the item's content indent. The Backspace idiom already gets there in one
    key: `deleteMarkupBackward` turns a fresh list marker into spaces (row M14). On later
    lines of the item and in blockquotes, continuation already produces the right prefix
    (rows M13, M17). Before this fix the case only looked different because the
    auto-inserted `</div>` after the caret made the right side HTML too.

[^keep-completion]: Completion is opt-in per keystroke: the popup inserts only when the
    user accepts a suggestion (Enter or click). The first `>` or space closes it, because
    neither matches the source's `validFor` pattern (row V3). It does not change what
    literal typing produces. Turning `completeHTMLTags` off would also lose a useful
    affordance the user did not ask to remove.

[^harness]: `CodeEditor` mounts nothing under the offline test seam, so source-mode
    typing cannot be driven through `MarkdownEditor` or `CodeEditor` in a unit test.
    CodeMirror runs typed text through the `EditorView.inputHandler` facet and keys
    through the `keymap` facet. Both are readable from an `EditorState`, and the handlers
    involved (`autoCloseTags`, `closeBrackets`) read only `state`, `composing` /
    `compositionStarted` and `dispatch` from the view. A stub carrying those fields runs
    them unchanged. The completion keymap is not simulated: completion needs a mounted
    view, and none of the asserted rows type Enter while a popup would be open.
