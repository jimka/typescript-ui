---
depends-on: [markdown-task-lists, markdown-source-mode-tab-highlighting]
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/theme.ts
  - packages/lib/src/typescript/lib/component/editor/languages.ts
  - packages/lib/docs/components/CodeEditor.md
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# Markdown Source Mode as Plain Text — Implementation Plan

## Overview

`MarkdownEditor`'s source mode is a `CodeEditor` running the built-in `"markdown"` language ([MarkdownEditor.ts:9606](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L9606)). Its colours come from the one `HighlightStyle` every `CodeEditor` language shares ([theme.ts:245-268](packages/lib/src/typescript/lib/component/editor/theme.ts#L245)). Part of that style draws Markdown the way the viewer renders it. Every part of a link is blue and underlined, so `[Markdown][commonmark]` looks like a hyperlink. Headings and `**bold**` are bold, and `*italic*` is italic. A styled span such as `[coloured]{color=#cc0000}` looks like a link too, because the grammar reads `[coloured]` as one.

This plan makes the source surface show Markdown as source text. Colour may hint at syntax, the way a code editor colours keywords. Nothing is drawn as the viewer draws it: no underline, no link colour over a link, no bold, no italic, no size. Two source files change: `theme.ts` restyles its Markdown-only rules, and `languages.ts` gives a link's reference label the tag of a URL. A new test file reads the look of every range offline.

The same language also highlights a `markdown` fenced code block in the `Markdown` viewer ([Markdown.ts:1293](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1293)), so those blocks change the same way. The WYSIWYG surface and the viewer's own rendering do not change.

---

## Architecture Decisions

### The look rule — source text with colour hints

Markup marks are grey, and so is a quote. Heading text is blue. Code, link titles and character references such as `&amp;` are green. A URL and a link's reference label are teal. HTML keeps the `html` language's colours. Everything else is in the text colour. No range is bold, underlined or sized. The one italic range is an HTML comment, as in every other language.[^audit]

| Source | Before | After |
|---|---|---|
| `[Markdown][commonmark]` | all underlined; `[` `]` grey, `Markdown` and `[commonmark]` blue | `[` `]` grey, `Markdown` plain, `[commonmark]` teal |
| `[commonmark]: https://commonmark.org` | label plain, `:` grey, URL blue and underlined | label teal, `:` grey, URL teal |
| `[coloured]{color=#cc0000}` | `[` `]` grey and underlined, `coloured` blue and underlined | `[` `]` grey, `coloured` plain, `{color=#cc0000}` plain |
| `# MarkdownEditor` | `#` grey and bold, text blue and bold | `#` grey, text blue |
| `A **WYSIWYG** editor` | `**` grey and bold, `WYSIWYG` bold | `**` grey, `WYSIWYG` plain |
| `a *Markdown* string` | `*` grey and italic, `Markdown` italic | `*` grey, `Markdown` plain |

Consequences: a link reads as text with dimmed brackets, so link text can no longer be told from prose by colour. The URL and the label still stand out. Recommendation, recorded as decided: apply this rule to every Markdown construct; the full list of rows is in the Expected Behaviour section below.

### Restyle the shared style's Markdown rules in place

The Markdown rules of the shared `HighlightStyle` change where they are, in `theme.ts`. No Markdown-only second style is added. Among the seven built-in languages, only Markdown emits the tags these rules style (`heading`, `strong`, `emphasis`, `link`, `url`, `monospace`, `quote`, `contentSeparator`), and the theme's own comment says the rules exist for Markdown ([theme.ts:254-259](packages/lib/src/typescript/lib/component/editor/theme.ts#L254)).[^in-place]

- Before: `{ tag: tags.strong, fontWeight: "bold" }` styles `**b**` in Markdown, and in no built-in language other than Markdown.
- After: the rule is gone, and `**b**` shows `b` in the text colour.

Consequences: JavaScript, JSON, HTML, SQL, CSS and Python look exactly as before; three rows of the Expected Behaviour section pin JavaScript, HTML and CSS. A consumer's own registered grammar that emits `tags.strong`, `tags.emphasis`, `tags.link` or `tags.heading` also loses the bold, italic and underline, which is the same rule applied to its source. Recommendation, recorded as decided: restyle in place.

### Tag a link's reference label as a URL, in the Markdown grammar only

The `markdown` language tags the `LinkLabel` node `url` instead of `@lezer/markdown`'s `labelName`. A new `linkLabelTagExtension` in `languages.ts` does this through the parser's `props`. It follows `taskMarkerExtension` ([languages.ts:514-553](packages/lib/src/typescript/lib/component/editor/languages.ts#L514)), which retags `TaskMarker` so the shared theme mutes it.[^label-retag]

- Before: `[lab]: /u` shows `[lab]` plain, because the theme has no `labelName` rule.
- After: `[lab]` is teal, the colour of the URL it stands for.

Consequences: the label in `[text][label]`, in `[label][]` and in a definition is teal. JavaScript's statement labels and CSS's label names keep `labelName`, and keep their look. A fence's info string (the `js` of a fence opened with three backticks and `js`) also carries `labelName` and stays plain. Recommendation, recorded as decided: retag `LinkLabel` only.

### URLs and labels are teal

A URL and a reference label take `SYNTAX_TYPE` (`#0891b2`, teal), with no underline. The viewer draws a link in the accent blue `#2563eb` ([Markdown.ts:309-314](packages/lib/src/typescript/lib/component/display/Markdown.ts#L309)), the same value as `SYNTAX_KEYWORD`, so blue is ruled out. Teal has the best contrast of the palette in the weaker of the two themes.[^contrast]

| Colour | On the light editor background `#ffffff` | On the dark editor background `rgb(40, 40, 40)` |
|---|---|---|
| blue `#2563eb`, the URL before | 5.17 : 1 | 2.85 : 1 |
| teal `#0891b2`, the URL after | 3.68 : 1 | 4.00 : 1 |

Consequences: a URL is easier to read in the dark theme and a little harder in the light one. Recommendation, recorded as decided: teal.

### Headings keep their colour and lose their weight

Heading text stays blue (`SYNTAX_KEYWORD`), and the `fontWeight: "bold"` goes. The viewer draws a heading at weight 600 in the text colour ([Markdown.ts:316-322](packages/lib/src/typescript/lib/component/display/Markdown.ts#L316)), so the weight is the rendered look and the blue is not.[^heading-colour]

- Before: `# MarkdownEditor` — `#` grey and bold, `␠MarkdownEditor` blue and bold (`␠` is a space).
- After: `#` grey, `␠MarkdownEditor` blue.

Consequences: headings still stand out when scrolling. Their contrast in the dark theme stays at blue's 2.85 : 1, as today; see `## Non-Goals`. Recommendation, recorded as decided: keep the colour.

### Emphasis and strong emphasis lose their slant and weight

The `tags.strong` and `tags.emphasis` rules are removed. The `*`, `**` and `***` marks stay grey through the `processingInstruction` rule, and the text between them is in the text colour.

- Before: `***bi***` — marks grey, bold and italic; `bi` bold and italic.
- After: `***` grey, `bi` plain, `***` grey.

Consequences: the grey marks are the only hint. Recommendation, recorded as decided: remove both rules.

### A styled span gets no parser extension of its own

`[text]{…}` stays a `Link` node in the source grammar. With the link look gone, a span already shows as text with grey brackets, which is what a span written with its own nodes would show.[^span-no-parser]

- Before: `[sized]{size=1.3em}` — `[` `]` grey and underlined, `sized` blue and underlined.
- After: `[` grey, `sized` plain, `]` grey, `{size=1.3em}` plain.

Consequences: the source tree still calls the span a link. Nothing in the library reads inline nodes of that tree, so the name has no effect beyond the look. Recommendation, recorded as decided: no extension.

### Six looks stay as they are

Six looks are colour hints that the viewer never draws, so they stay:[^kept]

| Construct | Source mode look (unchanged) | Viewer's look |
|---|---|---|
| quote | the whole quote grey, everything in it included | a left bar and an indent, text colour |
| inline code, fenced and indented code | code green, backticks and fences grey | monospace on a shaded box |
| HTML comment | grey italic, the `comment` rule shared by every language | not shown |
| inline and block HTML | as in the `html` language: tag names blue, attributes pink, values green | the rendered element |
| task marker `[x]`, list marker `-`, `1.` | grey | a checkbox, a bullet, a number |
| thematic break `---` | grey | a line |

Consequences: a link, heading or code span inside a quote is grey with the rest of the quote, as today. Recommendation, recorded as decided: keep all six.

### The look of a range is read offline from the style's own rules

`theme.ts` exports the rule list as `SYNTAX_STYLES` and the seven palette constants. The new test runs `@lezer/highlight`'s `highlightTree` over the `markdown` language's tree with a highlighter built from `SYNTAX_STYLES`, one class per rule, and folds each range's rules into a look such as `grey` or `grey italic`.[^test-seam] The tree is built the way `buildSqlState` builds one ([code-editor.test.ts:3250-3257](packages/lib/tests/component/code-editor.test.ts#L3250)).

- Before: no test reads a look. The `TaskMarker` rows read node names only ([code-editor.test.ts:3956-3964](packages/lib/tests/component/code-editor.test.ts#L3956)).
- After: `sourceLooks('[s]')` returns `[['[', 'grey'], ['s', 'plain'], [']', 'grey']]`.

Consequences: every row runs offline and fast. A colour mistake in a rule shows as a changed row. Recommendation, recorded as decided: this seam.

---

## Internal Structure

### `theme.ts`

Add `export` to the seven `SYNTAX_*` constants at [theme.ts:14-20](packages/lib/src/typescript/lib/component/editor/theme.ts#L14). Add `import type { TagStyle } from "@codemirror/language";` beside the existing `@codemirror/language` import. Place this list after the palette constants, before `REVEAL_CLASS`:

```ts
/**
 * The syntax-highlighting rules every `CodeEditor` language shares: each maps
 * lezer tags to a look. A range takes every rule its tags match, and a later
 * rule wins where two set the same property.
 */
export const SYNTAX_STYLES: readonly TagStyle[] = [
    { tag: tags.keyword,                                                    color: SYNTAX_KEYWORD },
    { tag: [tags.string, tags.special(tags.string)],                        color: SYNTAX_STRING },
    { tag: tags.comment,                                                    color: SYNTAX_COMMENT, fontStyle: "italic" },
    { tag: [tags.number, tags.bool, tags.null],                             color: SYNTAX_LITERAL },
    { tag: [tags.definition(tags.variableName), tags.function(tags.variableName)], color: SYNTAX_FUNCTION },
    { tag: tags.typeName,                                                   color: SYNTAX_TYPE },
    { tag: [tags.propertyName, tags.attributeName],                        color: SYNTAX_PROPERTY },
    { tag: tags.tagName,                                                    color: SYNTAX_KEYWORD },
    // Markdown constructs (the `markdown` language, e.g. the MarkdownEditor
    // source surface). Source mode shows Markdown as source text: colour hints
    // at the syntax, and nothing is drawn as the Markdown viewer draws it, so
    // no rule here sets a weight, a slant, an underline or a size. Heading text
    // takes the accent hue so the outline stands out; code is green, as a
    // string is; a URL and a link's reference label (which the markdown
    // language tags `url`) are teal, not the accent hue the viewer draws a link
    // in; the markup marks (`#`, `**`, `` ` ``, `>`, `-`, `[`, `](`) and quotes
    // are muted so the content reads over the syntax. The url rule follows the
    // heading rule, so a URL in a heading is teal, and precedes the muted
    // rules, so a quote stays muted throughout.
    { tag: [tags.heading, tags.heading1, tags.heading2, tags.heading3,
            tags.heading4, tags.heading5, tags.heading6],                   color: SYNTAX_KEYWORD },
    { tag: tags.monospace,                                                  color: SYNTAX_STRING },
    { tag: tags.url,                                                        color: SYNTAX_TYPE },
    { tag: [tags.quote, tags.contentSeparator],                             color: SYNTAX_COMMENT },
    { tag: tags.processingInstruction,                                      color: SYNTAX_COMMENT },
];
```

The first eight rules are today's, unchanged and in today's order. Inside `codeEditorTheme`, the `HighlightStyle.define([...])` call at [theme.ts:245](packages/lib/src/typescript/lib/component/editor/theme.ts#L245) becomes `HighlightStyle.define(SYNTAX_STYLES)`. The call stays inside `codeEditorTheme`, after the cache check, so a style is still built once per `dark` value.

### `languages.ts`

Widen the type import at [languages.ts:14](packages/lib/src/typescript/lib/component/editor/languages.ts#L14) to `import type { styleTags as highlightStyleTags, tags as highlightTags } from "@lezer/highlight";`. Add this function directly after `taskMarkerExtension` (which ends at line 553):

```ts
/**
 * Tags a link's reference label — `[label]` in `[text][label]`, in `[label][]`
 * and in a link reference definition — `url`, the tag of the URL it stands
 * for, in place of lezer's `labelName`, so the editor theme colours the label
 * as it colours a URL. `labelName` itself stays unstyled, because JavaScript's
 * statement labels and CSS's label names carry it too. Built from the
 * caller's imports, so this module still loads no grammar package.
 *
 * @param tags - The `tags` of `@lezer/highlight`.
 * @param styleTags - The `styleTags` of `@lezer/highlight`.
 * @returns The extension.
 */
function linkLabelTagExtension(tags: typeof highlightTags, styleTags: typeof highlightStyleTags): MarkdownConfig {
    return { props: [styleTags({ LinkLabel: tags.url })] };
}
```

In the `"markdown"` `loadExtension`, change [languages.ts:586](packages/lib/src/typescript/lib/component/editor/languages.ts#L586) to `const { styleTags, tags } = await import("@lezer/highlight");` and the `extensions` list at line 588 to `[MARKDOWN_TAB_STOPS, taskMarkerExtension(tags), linkLabelTagExtension(tags, styleTags)]`.

### The test helper

The new test file holds one helper, `sourceLooks(doc, languageId = 'markdown')`, which returns `[text, look][]`:

1. Load the language with `getLanguage(languageId)!.loadExtension()`, create an `EditorState`, run `ensureSyntaxTree(state, state.doc.length, Infinity)`, and take `state.update({}).state`, as `buildSqlState` does.
2. Build, once at module level, `tagHighlighter(SYNTAX_STYLES.map((rule, index) => ({ tag: rule.tag, class: String(index) })))`.
3. Call `highlightTree(syntaxTree(state), highlighter, put)`. In `put(from, to, classes)`, merge the CSS properties of the named rules in ascending index order, a later rule overwriting an earlier one, and skip the `tag` key.
4. Write each merged look as words. The colour comes first, named by palette constant: `SYNTAX_KEYWORD` is `blue`, `SYNTAX_STRING` `green`, `SYNTAX_COMMENT` `grey`, `SYNTAX_LITERAL` `amber`, `SYNTAX_FUNCTION` `violet`, `SYNTAX_TYPE` `teal`, `SYNTAX_PROPERTY` `pink`. Then `fontWeight` adds `bold`, `fontStyle` adds `italic`, `textDecoration` adds `underline` and `fontSize` adds `sized`.
5. Fill every gap `highlightTree` skips, and the text after its last range, as `plain`. Then join neighbouring ranges that have the same look, and slice each range's text from `doc`.

---

## Ordered Implementation Steps

1. **Create `packages/lib/tests/component/markdown-source-look.test.ts`.** Write the helper from `## Internal Structure`. Import `SYNTAX_STYLES` and the seven `SYNTAX_*` constants from `~/component/editor/theme`, `getLanguage` from `~/component/editor/LanguageRegistry`, the side-effect module `~/component/editor/languages`, `CORPUS` from `./markdown-roundtrip/corpus`, and `readDemoEditorSample` from `../helpers/readDemoSample.mjs`. Add every row of the Expected Behaviour section as an `it` or `it.each` row whose title says what the row shows; the code-block rows there are ready to paste. Use no row codes. Check: `npx vitest run tests/component/markdown-source-look.test.ts` from `packages/lib` fails, because `theme.ts` exports none of the names yet.

2. **Edit `packages/lib/src/typescript/lib/component/editor/theme.ts`** as `## Internal Structure` gives. Check: `grep -n 'fontWeight\|textDecoration\|tags.link\|tags.strong\|tags.emphasis' packages/lib/src/typescript/lib/component/editor/theme.ts` lists only the `fontWeight: "bold"` and `textDecoration: "none"` of `.cm-completionMatchedText` and the `textDecoration` of `.cm-lintRange-error`, all in the chrome theme.

3. **Edit `packages/lib/src/typescript/lib/component/editor/languages.ts`** as `## Internal Structure` gives. Check: `grep -n 'linkLabelTagExtension' packages/lib/src/typescript/lib/component/editor/languages.ts` shows the definition and one call.

4. **Run the editor suites.** From `packages/lib`: `npx vitest run tests/component/markdown-source-look.test.ts tests/component/code-editor.test.ts tests/component/code-editor-theme.test.ts tests/component/markdown-editor-source-mode-mounted.test.ts`. Check: all green. `code-editor-theme.test.ts` still counts two `HighlightStyle.define` calls.

5. **Document the look in `packages/lib/docs/components/CodeEditor.md`.** After the tab paragraph at line 66 ("The `markdown` language reads a tab as Markdown does…"), add one paragraph:

   > The `markdown` language is highlighted as source text: colour hints at the syntax, and nothing is drawn as the [`Markdown`](/components/Markdown) viewer draws it — no bold, italic, underline or size. Markup marks are grey: `#`, `*` and `**`, backticks, list and task markers, `>`, `---`, and a link's `[`, `](`, `)`, `<`, `>` and `:`. Heading text is blue and code green. A link's URL and its reference label are teal, in `[text](https://…)`, `![alt](https://…)`, `<https://…>`, `[text][label]` and `[label]: https://…`; a link title is green. Link text, emphasised text and what the grammar does not read — `++underline++`, `[text]{color=…}` spans, `{…}` attribute groups, tables and `:::` fences — are in the text colour. A quote is grey throughout. HTML is highlighted as in the `html` language, and an HTML comment is grey italic, as a comment is in every language.

6. **Point to it from `packages/lib/docs/components/MarkdownEditor.md`.** In the *Source / WYSIWYG mode* section, append to the paragraph at line 302 (it ends "…see [CodeEditor's built-in languages](/components/CodeEditor#built-in-languages).") the sentence: `The source surface shows the Markdown as text, with colours that hint at its syntax and no bold, italic or underline; the same section lists the colours.`

7. **Add the changelog entry to `packages/lib/docs/reference/changelog/next.md`.** Insert it as the first bullet under `## Changed` → `### Components` (line 291):

   ```markdown
   - **`MarkdownEditor`'s source mode, and `CodeEditor`'s `markdown`
     language, show Markdown as text.** A link no longer looks like a
     hyperlink: its text is in the text colour, its brackets grey and its URL
     teal, with no underline — in an inline link, an image, an autolink, a
     reference link and a link reference definition, whose `[label]` is teal
     too. Headings and `**bold**` are no longer bold, and `*italic*` is no
     longer italic: their marks stay grey, and heading text stays blue. A
     styled span such as `[coloured]{color=#cc0000}` no longer looks like a
     link. A `markdown` fenced code block in the `Markdown` viewer changes the
     same way. Every other language is highlighted as before.
   ```

8. **Do the manual browser checks** listed in the Verification section. They cover what the offline rows cannot: the real colours on the page in both themes.

9. **Run the full checks** in the Verification section, ending with plain `npm test`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/tests/component/markdown-source-look.test.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/theme.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/languages.ts` |
| Modify | `packages/lib/docs/components/CodeEditor.md` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Every row below is unit-testable through `sourceLooks` and was measured on a prototype of this change. A row lists the ranges of one source in order. `·` separates ranges, `⏎` is a line end, and `␠` is a space at either end of a range. Sources holding backticks, pipes or backslashes are given as test data in the code block at the end of this section, where the strings are exact.

### Headings and emphasis

| Source | Ranges |
|---|---|
| `# MarkdownEditor` | `#` grey · `␠MarkdownEditor` blue |
| `## Try it` | `##` grey · `␠Try it` blue |
| `Setext⏎===` | `Setext⏎` blue · `===` grey |
| `# A [l](u) **b**` | `#` grey · `␠A␠` blue · `[` grey · `l` blue · `](` grey · `u` teal · `)` grey · `␠` blue · `**` grey · `b` blue · `**` grey |
| `A **WYSIWYG** editor` | `A␠` plain · `**` grey · `WYSIWYG` plain · `**` grey · `␠editor` plain |
| `a *Markdown* string` | `a␠` plain · `*` grey · `Markdown` plain · `*` grey · `␠string` plain |
| `***bi***` | `***` grey · `bi` plain · `***` grey |

### Links, images and references

| Source | Ranges |
|---|---|
| `[Markdown][commonmark]` | `[` grey · `Markdown` plain · `]` grey · `[commonmark]` teal |
| `[a](http://x "t")` | `[` grey · `a` plain · `](` grey · `http://x` teal · `␠` plain · `"t"` green · `)` grey |
| `![Diagram](https://placehold.co/240x120){width=240 height=120}` | `![` grey · `Diagram` plain · `](` grey · `https://placehold.co/240x120` teal · `)` grey · `{width=240 height=120}` plain |
| `<http://auto>` | `<` grey · `http://auto` teal · `>` grey |
| `[s][]` | `[` grey · `s` plain · `]` grey · `[]` teal |
| `[s]` | `[` grey · `s` plain · `]` grey |
| `[commonmark]: https://commonmark.org` | `[commonmark]` teal · `:` grey · `␠` plain · `https://commonmark.org` teal |
| `[lab]: /u "T"` | `[lab]` teal · `:` grey · `␠` plain · `/u` teal · `␠` plain · `"T"` green |

### Dialect constructs

| Source | Ranges |
|---|---|
| `[coloured]{color=#cc0000}` | `[` grey · `coloured` plain · `]` grey · `{color=#cc0000}` plain |
| `[sized]{size=1.3em}` | `[` grey · `sized` plain · `]` grey · `{size=1.3em}` plain |
| `[sp *em*]{color=red}` | `[` grey · `sp␠` plain · `*` grey · `em` plain · `*]` grey · `{color=red}` plain |
| `[a][b]{c}` | `[` grey · `a` plain · `]` grey · `[b]` teal · `{c}` plain |
| `++underline++` | the whole source plain |
| `~~strike~~` | the whole source plain |
| `::: {align=center}⏎A⏎:::` | the whole source plain |

`[a][b]{c}` is the one row where the source surface and the viewer disagree: the viewer reads `[b]{c}` as a span. The row pins the grammar's reading.

### Blocks, markers and HTML

| Source | Ranges |
|---|---|
| `- item` | `-` grey · `␠item` plain |
| `1. one` | `1.` grey · `␠one` plain |
| `- [x] t` | `-` grey · `␠` plain · `[x]` grey · `␠t` plain |
| `> Edit on the left` | the whole source grey |
| `> q *e* [l](u)` | the whole source grey |
| `a⏎⏎---⏎⏎b` | `a⏎⏎` plain · `---` grey · `⏎⏎b` plain |
| `***` | the whole source grey |
| `<!-- c -->` | the whole source grey italic |
| `x <span>h</span>` | `x␠<` plain · `span` blue · `>h</` plain · `span` blue · `>` plain |
| `<div class="x">⏎</div>` | `<` plain · `div` blue · `␠` plain · `class` pink · `=` plain · `"x"` green · `>⏎</` plain · `div` blue · `>` plain |

### Code, tables and escapes, as test data

```ts
const EXACT_ROWS: ReadonlyArray<[name: string, source: string, looks: Array<[string, string]>]> = [
    ['inline code is green between grey backticks', '`**bold**`',
        [['`', 'grey'], ['**bold**', 'green'], ['`', 'grey']]],
    ['a double-backtick code span keeps its inner backticks green', '`` `code` ``',
        [['``', 'grey'], [' `code` ', 'green'], ['``', 'grey']]],
    ['a fenced code block is green between grey fences', '```\ncode\n```',
        [['```', 'grey'], ['\n', 'plain'], ['code', 'green'], ['\n', 'plain'], ['```', 'grey']]],
    ['an indented code block is green', '    indented',
        [['    ', 'plain'], ['indented', 'green']]],
    ['code as link text is green, the link marks grey', '[`code`](u)',
        [['[`', 'grey'], ['code', 'green'], ['`](', 'grey'], ['u', 'teal'], [')', 'grey']]],
    ['a table is plain text', '| a | b |\n| --- | --- |\n| c | d |',
        [['| a | b |\n| --- | --- |\n| c | d |', 'plain']]],
    ['an escape is plain and a character reference green', '\\* &amp;',
        [['\\* ', 'plain'], ['&amp;', 'green']]],
];
```

### Whole documents

- **The demo sample, read whole** (`readDemoEditorSample()`): its ranges include `[commonmark]` teal twice, `https://commonmark.org` teal, `https://placehold.co/240x120` teal, and `Markdown`, `coloured`, `sized` and `Diagram` plain.
- **No rendered look anywhere:** across every `CORPUS` case and the demo sample, no range's look contains `bold`, `underline` or `sized`, and every look that contains `italic` is exactly `grey italic`, the comment rule's.

### Other languages keep their look

| Language | Source | Ranges |
|---|---|---|
| `javascript` | `const a = "s"; // c` | `const` blue · `␠` plain · `a` violet · `␠=␠` plain · `"s"` green · `;␠` plain · `// c` grey italic |
| `html` | `<a href="u">t</a><!-- c -->` | `<` plain · `a` blue · `␠` plain · `href` pink · `=` plain · `"u"` green · `>t</` plain · `a` blue · `>` plain · `<!-- c -->` grey italic |
| `css` | `a { color: red; }` | `a` blue · `␠{␠` plain · `color` pink · `:␠` plain · `red` blue · `;␠}` plain |

### Manual only

The colours on a real page, in the light and the dark theme. See `## Verification`.

---

## Verification

From `packages/lib` unless noted:

- `npm run typecheck` — no errors.
- `npm run lint` — no new findings.
- `npm run docs:api` — zero warnings.
- `npx vitest run tests/component/markdown-source-look.test.ts` — every row of `## Expected Behaviour` green.
- **Manual browser checks.** Run `npm run dev` from the repository root and open the demo.
  1. Open **MD Editor**, press the **Edit Markdown source** toggle at the toolbar's right end, and check the sample against the look rule: `[Markdown][commonmark]` shows grey brackets, plain `Markdown` and a teal `[commonmark]`; the last line's label and URL are teal; nothing is underlined; `**WYSIWYG**`, `*Markdown*` and the two headings are not bold or italic; the headings are blue; `[coloured]{color=#cc0000}` and `[sized]{size=1.3em}` show grey brackets and plain text.
  2. Open **Misc.** and press the theme button until it reads "Switch to modern theme", which means the dark theme is on. Return to **MD Editor** in source mode, repeat check 1, and confirm the teal URLs and labels, the grey marks and the blue headings are readable on the dark background.
  3. Open **CodeEditor** in both themes. JavaScript and the other languages look as before.
- **Full suite, last:** plain `npm test` from `packages/lib`, the whole suite with no filter and nothing else running beside it. It must pass.

---

## Documentation Impact

No exported symbol changes: `theme.ts` is not re-exported from any package entry point, so `SYNTAX_STYLES` and the palette constants stay internal. The docs change is a look description: the new paragraph in `docs/components/CodeEditor.md`, the pointer in `docs/components/MarkdownEditor.md`, and the changelog entry, all given in `## Ordered Implementation Steps` steps 5 to 7.

---

## Potential Challenges

- **Rule order decides overlaps.** A URL in a heading carries both tags, and a URL in a quote carries `quote` too. Keep the order of `## Internal Structure`; the `# A [l](u) **b**` and `> q *e* [l](u)` rows fail if it changes.
- **`styleTags` replaces lezer's label rule only while both rules are plain.** Lezer's `"CodeInfo LinkLabel": tags.labelName` and the new `LinkLabel: tags.url` have no `/...` and no parent path, so the later one replaces the earlier for `LinkLabel`. Write the new rule as given, with no `/...`; the `[s][]` and definition rows fail otherwise.
- **The theme test counts `HighlightStyle.define` calls.** Keep the call inside `codeEditorTheme`, after the cache check; hoisting only the rule list keeps `code-editor-theme.test.ts` at two calls.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/editor/theme.ts`](packages/lib/src/typescript/lib/component/editor/theme.ts) — the shared style; read the palette comment (lines 9-20) and the whole `codeEditorTheme`.
- [`packages/lib/src/typescript/lib/component/editor/languages.ts`](packages/lib/src/typescript/lib/component/editor/languages.ts) — `taskMarkerExtension` (lines 514-553), the precedent for retagging a Markdown node, and the `"markdown"` registration (lines 555-609).
- [`packages/lib/tests/component/code-editor-theme.test.ts`](packages/lib/tests/component/code-editor-theme.test.ts) — the memo test the change must keep green.
- [`packages/lib/tests/component/code-editor.test.ts`](packages/lib/tests/component/code-editor.test.ts) — `buildSqlState` (line 3250), the tree-building idiom the helper copies, and the `TaskMarker` rows (line 3956).
- `node_modules/@lezer/markdown/dist/index.js`, the `markdownHighlighting` table (line 1957) — the tags each Markdown node carries.
- [`packages/lib/src/typescript/lib/component/display/markdownExtensions.ts`](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts) — the viewer's `++underline++` and `[text]{…}` tokenizers (lines 54-107), which the source grammar does not know.
- [`packages/lib/tests/component/markdown-roundtrip/corpus/index.ts`](packages/lib/tests/component/markdown-roundtrip/corpus/index.ts) and [`packages/lib/tests/helpers/readDemoSample.mjs`](packages/lib/tests/helpers/readDemoSample.mjs) — the documents of the whole-document rows.

---

## Non-Goals

- **The palette's dark-theme contrast.** Blue (2.85 : 1), violet (2.59 : 1) and pink (2.44 : 1) are weak on the dark editor background in every language, and grey (3.05 : 1) is close. The palette is shared by every language and uses the same colours in both themes, so tuning it per theme is a change of its own.
- **Colour hints for the dialect's own syntax.** `{…}` attribute groups, `:::` and `|||` fences, `++underline++`, `^^` and `<<` cells, and tables need parser extensions to be coloured. They are text today, which is what this plan asks for.
- **GitHub Flavored Markdown in the source grammar.** The `markdown` language parses CommonMark without the GitHub extensions, so `~~strike~~` and tables are plain text. Turning those extensions on would add new looks to audit.
- **The WYSIWYG surface and the viewer's rendering.** Both draw rendered Markdown by design.

---

## Notes

[^audit]: Measured on `feature/markdown-commonmark-images` (`52473a27d`), with `@lezer/markdown` 1.7.2 and `@codemirror/lang-markdown` 6.5.2. `markdown()` builds on `commonmarkLanguage`, so the grammar has no strikethrough, table, subscript, superscript or emoji nodes. The audit read the tags of every range of the demo sample, the 635 corpus cases and a set of construct samples. Before the change, the rendered looks were: bold on headings, on `**…**` and on their marks; italic on `*…*` and its marks; blue and underlined on every part of a link, image and reference link, and on the URL of an autolink and a definition. No rule sets a size. `++underline++` is never underlined and `~~strike~~` is never struck, because the grammar reads both as text. No decoration, mark or widget draws anything in source mode: the only `Decoration` in the editor is the reveal highlight ([CodeEditor.ts:514](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L514)). The `markdown-source-mode-styled-spans` plan only adds commands that write `[text]{…}`; it draws nothing. Escapes (`\*`) carry `escape`, which no rule styles, and entities (`&amp;`) carry `character`, a sub-tag of `string`, so they are green — a hint, unchanged.

[^in-place]: A Markdown-only style was considered in two forms, and both were rejected. A second `syntaxHighlighting(...)` returned from the `"markdown"` `loadExtension` cannot remove a look: CodeMirror applies every registered highlighter and joins their classes, so the shared `tags.link` underline would stay. A `HighlightStyle` scoped to the Markdown language (the `scope` option) works only if the shared rules move out of `theme.ts` — which changes custom grammars just as restyling in place does — and it adds a second `style-mod` module, which `code-editor-theme.test.ts` documents as a stylesheet that grows unless the module is built once. Restyling in place keeps one style and one memo. Which tags each built-in grammar emits was read from the `styleTags` tables of `@lezer/html`, `@lezer/css`, `@lezer/javascript`, `@lezer/json`, `@lezer/python` and `@codemirror/lang-sql`. None emits `heading`, `strong`, `emphasis`, `link`, `url`, `monospace`, `quote` or `contentSeparator`. HTML emits `processingInstruction` (for `<?…?>`), whose rule does not change.

[^label-retag]: `@lezer/markdown` tags `"CodeInfo LinkLabel": tags.labelName`, and `theme.ts` has no `labelName` rule. Adding one would colour JavaScript's `outer:` labels and CSS's label names, which `@lezer/javascript` and `@lezer/css` both tag `labelName`. The parser's own `props` change only this language's parser, the same reach `markdownTabStops.ts` and `taskMarkerExtension` rely on. `NodeSet.extend` merges the new rule with lezer's through the `combine` of `@lezer/highlight`'s rule property: for two plain rules of the same depth the later one is kept and the earlier dropped. The `url` tag was chosen over a new tag, or `tags.special(tags.labelName)`, because the label's job in the source is to name a URL, and reusing `url` needs no new theme rule.

[^contrast]: Ratios use the WCAG relative-luminance formula. The light editor background is `--ts-ui-input-bg` from `ModernTheme` and `ClassicTheme`, `rgb(255, 255, 255)`; the dark one is `DarkTheme`'s `rgb(40, 40, 40)` ([DarkTheme.ts:57-58](packages/lib/src/typescript/lib/core/themes/DarkTheme.ts#L57)). The whole palette, light then dark: blue 5.17 / 2.85, green 3.30 / 4.47, grey 4.83 / 3.05, amber 3.19 / 4.63, violet 5.70 / 2.59, teal 3.68 / 4.00, pink 6.04 / 2.44. No palette colour reaches 4.5 : 1 on both backgrounds; teal has the highest of the lower two numbers. Text in the text colour, which link text and emphasised text now use, is 21 : 1 in the light theme and 10.75 : 1 in the dark, so those ranges gain contrast. Green, the title's colour, was the other candidate for URLs; it was passed over for its 3.30 : 1 on white and because code is already green.

[^heading-colour]: Removing the colour too would leave a heading told from prose only by its grey `#` run, a weak hint when scrolling a long document. Moving the colour onto the `#` run instead would need a retag of `HeaderMark`, which today takes the grey of every mark; it was not worth a second retag. Blue on a heading does not copy the viewer, which draws headings in the text colour.

[^span-no-parser]: An inline parser for `[text]{…}`, run before lezer's `Link` parser with the viewer's test `/^\[([^[\]]+)\]\{([^{}]*)\}/` ([markdownExtensions.ts:83-107](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L83)), was considered. With its brackets muted and its `{…}` group in the text colour — as the image's `{width=…}` group, the table's and the fence's stay, since no grammar knows them — it shows exactly what the `Link` reading now shows. Muting its `{…}` group alone would make it the only attribute group with a hint. A search of `component/editor` for readers of inline nodes (`Link`, `LinkMark`, `Image`, `URL`) found none: the library's tree readers in `languages.ts` and `markdownTabStopCommands.ts` read block nodes only. `@codemirror/lang-markdown` reads `Link` in two places: it offers no HTML tag completion inside a link, and it does not wrap a pasted URL around a selection that crosses a node. Both are negligible for a span.

[^kept]: The quote wash greys everything inside a quote, links and code included, because the `quote` rule is inherited by every node in the quote and follows the other colour rules. It stays because it is a hint the viewer does not draw: the viewer draws a bar and an indent ([Markdown.ts:226-236](packages/lib/src/typescript/lib/component/display/Markdown.ts#L226)) with text in the text colour. Narrowing it to the `>` marks is a separate change. Code in green is the string convention of the palette; the viewer's look is a shaded monospace box, and the source surface is monospace throughout. The italic of a comment comes from the shared `comment` rule, which JavaScript, CSS, HTML, SQL and Python comments use too; the viewer does not show comments at all, so the slant copies nothing. HTML keeps the `html` language's highlighting because source mode shows it as code. Grey task markers, list markers and thematic breaks are the "muted marks" the theme already gives every Markdown mark.

[^test-seam]: `HighlightStyle.define` builds its own highlighter as `tagHighlighter` over its rules, each rule's class standing for its CSS properties, and its rules are emitted in list order. A `tagHighlighter` over `SYNTAX_STYLES` with one class per rule index therefore matches exactly the rules the editor applies, and merging their properties in index order gives the CSS that wins. The colour names are a reading aid: rows say `teal`, not `#0891b2`, and each name is tied to a palette constant, so a palette change shows as a changed name rather than a silent pass. Reading the CSS text of the built style's module was rejected: class names are generated, and parsing CSS in a test is brittle. A live `EditorView` is not needed: `highlightTree` reads the same tree and the same rules the view does.
