# CodeEditor

[`CodeEditor`](/api/component/editor/classes/CodeEditor) wraps [CodeMirror 6](https://codemirror.net/). Its scope is highlighting, formatting, folding, search, parser-level diagnostics (lint) and keyword/snippet completion — every one of them bounded to what a grammar's own parse tree already knows. Anything needing semantic understanding — cross-file symbols, type information, hovers, go-to-definition, a real language server — or collaborative editing is out of scope.

`CodeEditor` is a **live-only** component, the same category as [`Canvas`](/components/Canvas): CodeMirror's `EditorView` takes a real DOM element and mutates a whole region of it directly, so under the framework's offline test seam the editor mounts nothing and every operation (`format()`, `setLanguage()`, …) no-ops. In a real browser it mounts once the component is connected and sized, fills its assigned box, and scrolls internally.

Wheel scrolling inside the editor is driven by the framework's eased scroller, the same glide every other scrolling surface uses — `CodeEditor` points the framework's scroll plumbing at CodeMirror's own viewport rather than at its outer box. The scrollbars themselves are still the browser's native ones: the custom overlay [`Scrollbar`](/components/Scrollbar) is a [`Panel`](/api/core/classes/Panel) feature and does not reach a foreign widget's internal scroller. A wheel that lands on one of CodeMirror's own floating tooltips is left to the browser instead, as long as the tooltip still has room to move in that direction — the completion list, until the wheel direction reaches whichever end it's being scrolled toward. A tooltip with no further room in that direction (a hover or lint tooltip, which never scroll, or a completion list already scrolled as far as it goes that way) claims and eases the document underneath instead.

Highlighting grammars, formatters and lint sources load lazily, per language, through `import()` — the base editor stays small and Prettier's much larger standalone bundle is only ever fetched behind a `format()` call.

## Usage

```typescript
import { CodeEditor } from '@jimka/typescript-ui/component/editor';
import { Fit } from '@jimka/typescript-ui/layout';

const host = new Panel({ layoutManager: new Fit() });
const editor = new CodeEditor('const x = 1;', { language: 'javascript' });

host.addComponent(editor);
await editor.format();
```

`codemirror`, the `@codemirror/*` packages, `prettier`, and `sql-formatter` are runtime dependencies of the library, installed transitively when you install `@jimka/typescript-ui` — the same as `marked` for [`Markdown`](/components/Markdown).

Give the editor a sized host (a `Fit` panel, as above, or an explicit `preferredSize`) — it reports no content-derived size of its own and relies on its parent to size it, exactly like `Canvas`.

## Construction

`CodeEditor(value?, options?)` — the initial document `value` is an optional positional argument (equivalent to the `value` option).

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `value` | `string` | `""` | Initial document text. |
| `language` | `string` | unset | A registered language id (e.g. `"javascript"`, `"sql"`). Unset renders plain text with no grammar. |
| `readOnly` | `boolean` | `false` | Whether the editor rejects edits. |
| `autoHeightMaxRows` | `number` | unset | Row count the editor grows to fit before its own vertical scrollbar takes over. Unset: today's fixed-height, fill-parent behaviour, controlled via `setHeight`/`preferredSize`. |
| `lineWrap` | `boolean` | `false` | Whether long lines wrap instead of scrolling horizontally. |
| `placeholder` | `string` | unset | Text shown in an empty document. |
| `highlightWhitespace` | `boolean` | `false` | Whether spaces, tabs and trailing whitespace are rendered visibly. |
| `lint` | `boolean` | `false` | Whether parser-error diagnostics are shown. Inert for a language with no lint source. |
| `tabSize` | `number` | unset | Tab-stop width in columns — how wide a literal tab renders and how many columns Tab / auto-indent insert. Unset: CodeMirror's own defaults (4-column stops, 2-space indent unit). Distinct from `format()`'s `indentWidth` — see [Formatting options](#formatting-options). |
| `lineNumbers` | `boolean` | `true` | Whether the line-number gutter is shown. |
| `spellcheck` | `boolean` | `false` | Whether the browser's native spellcheck runs inside the editor. See [Spellcheck](#spellcheck). |
| `listeners` | `{ change?, readonlyedit?, heightchange?, cursorchange?, selectionchange? }` | — | Construction-time listener bag, one optional callback per event the editor exposes through `on()`. |

Inherits the common [`ComponentOptions`](/api/core/interfaces/ComponentOptions) fields (preferred size, background, foreground, etc.).

## Built-in languages

The library registers seven languages out of the box, each with a grammar and, where one exists, a formatter and a lint source:

| id | Grammar | Formatter | Lint source |
| --- | --- | --- | --- |
| `javascript` | `@codemirror/lang-javascript` (TypeScript-aware) | Prettier (`babel-ts` parser) | syntax-error diagnostics |
| `json` | `@codemirror/lang-json` | Prettier (`json` parser) | syntax-error diagnostics |
| `html` | `@codemirror/lang-html` | Prettier (`html` parser) | syntax-error diagnostics |
| `sql` | `@codemirror/lang-sql` | `sql-formatter` | syntax-error diagnostics |
| `markdown` | `@codemirror/lang-markdown` | Prettier (`markdown` parser) | none — the grammar never produces error nodes |
| `css` | `@codemirror/lang-css` | Prettier (`css` parser, via `prettier/plugins/postcss`) | syntax-error diagnostics |
| `python` | `@codemirror/lang-python` | none — `format()` falls back to re-indenting | syntax-error diagnostics |

Both the grammar and the formatter load through a dynamic `import()` the first time they're needed — selecting a language fetches only its grammar; calling `format()` additionally fetches that language's formatter (and, for the five Prettier-backed languages, the shared Prettier standalone bundle, fetched once and reused across them). A lint source loads the same way, the first time [`lint`](#construction) is turned on for that language.

### Registering a language

Register a new language with `registerLanguage` before constructing an editor that uses it:

```typescript
import { registerLanguage, collectSyntaxErrors } from '@jimka/typescript-ui/component/editor';

registerLanguage({
    id: 'yaml',
    label: 'YAML',
    loadExtension: async () => {
        const { yaml } = await import('@codemirror/lang-yaml');
        return yaml();
    },
    // loadFormatter is optional — omit it and format() falls back to re-indenting.
    // loadLintSource is optional too; collectSyntaxErrors works for any
    // grammar whose parse tree marks its own error nodes.
    loadLintSource: async () => collectSyntaxErrors,
});
```

`getLanguage(id)` looks up a registration; `listLanguages()` lists every registered definition.

A grammar that publishes its own completion source through CodeMirror's language-data facet (`<lang>Language.data.of({ autocomplete: … })`) needs no registration of its own — `autocompletion()` (always on; see [Autocompletion](#autocompletion) below) finds it automatically. Attach one to a grammar that doesn't publish one the same way the built-in `json` entry does, inside `loadExtension`:

```typescript
import { completeFromList } from '@codemirror/autocomplete';

loadExtension: async () => {
    const { yaml, yamlLanguage } = await import('@codemirror/lang-yaml');
    return [yaml(), yamlLanguage.data.of({ autocomplete: completeFromList(['true', 'false', 'null']) })];
},
```

## `format()` semantics

`editor.format(options?)` returns a `Promise<void>`:

- If the active language has a formatter, it is invoked with the current document text. On success, the whole document is replaced in one transaction and the cursor is preserved (mapped by Prettier's `formatWithCursor`, or clamped to the new document length for `sql-formatter`, which has no cursor map).
- If the formatter's result matches the document already held, it is left **completely untouched** — no transaction, so no re-render, no undo entry, and no `"change"` event for a save that had nothing to reformat.
- When the result does change the document, the editor's visible area no longer unconditionally jumps to the top. It stays exactly in place when nothing above it changed length, which is the common case for an incremental edit-then-save, and can otherwise shift — by roughly however much text the formatter added or removed above it, never all the way back to the top — when a reformat changes text throughout the document, e.g. a first-time format of a wholly unformatted file.
- If the formatter **throws** (invalid syntax, or an `options` value the engine rejects — e.g. a negative `indentWidth`), the promise **rejects** and the document is left **completely untouched** — formatting never loses content.
- If the active language has no formatter (or none is set), `format()` re-indents the whole document using CodeMirror's own indentation service instead, ignoring `options` entirely.

## Formatting options

`format(options?)` accepts a `FormatOptions` bag of style knobs, forwarded to the active language's formatter. Each field is optional, and an absent field leaves that engine's own default alone:

```typescript
await editor.format({ indentWidth: 4, singleQuote: true });
```

The options are a per-call argument — the editor stores none of them, so a caller that wants them applied on every format passes them on every call. No field is honoured by every built-in language:

| `FormatOptions` field | Engine option | `javascript` | `json` | `html` | `markdown` | `sql` |
|---|---|---|---|---|---|---|
| `indentWidth` | `tabWidth` (both engines) | ✔ | ✔ | ✔ | ✔ list nesting only | ✔ |
| `useTabs` | `useTabs` (both engines) | ✔ | ✔ | ✔ | — | ✔ |
| `lineWidth` | Prettier `printWidth` | ✔ | ✔ | ✔ | ✔ only with `proseWrap: "always"` | — |
| `singleQuote` | Prettier `singleQuote` | ✔ | — | — | — | — |
| `semicolons` | Prettier `semi` | ✔ | — | — | — | — |
| `trailingComma` | Prettier `trailingComma` | ✔ | — | — | — | — |
| `arrowParens` | Prettier `arrowParens` | ✔ | — | — | — | — |
| `bracketSpacing` | Prettier `bracketSpacing` | ✔ | ✔ | — | — | — |
| `proseWrap` | Prettier `proseWrap` | — | — | — | ✔ | — |
| `htmlWhitespaceSensitivity` | Prettier `htmlWhitespaceSensitivity` | — | — | ✔ | — | — |
| `keywordCase` | `sql-formatter` `keywordCase` | — | — | — | — | ✔ |

`FormatOptions.indentWidth` only shapes `format()`'s one-shot reformat output; it has no
effect on the live editor. The separate, always-in-effect `tabSize` construction option
controls live tab-stop rendering and Tab-key / auto-indent width — see
[Construction](#construction).

When a `format()` call omits `indentWidth` and this editor's `tabSize` is
set, `format()` defaults `indentWidth` to it, so a reformat's indent width
matches what the editor already renders — the one place the two options
interact. An explicit `indentWidth` always overrides this default:

| Caller's `options` | `tabSize` | Effective `indentWidth` |
| --- | --- | --- |
| `{ indentWidth: 2 }` | `8` | `2` — explicit wins |
| `{}` or omitted | `4` | `4` — defaulted from `tabSize` |
| `{}` or omitted | unset | unset — today's behaviour, unchanged |

This default reaches every built-in language that has a formatter
(`javascript`, `json`, `html`, `sql`, `markdown`, `css`) — each maps
`indentWidth` onto its own engine's `tabWidth`-equivalent option. `python`
has no formatter at all, so `format()` re-indents instead and `options`
(including this default) never reaches it.

## Dirty state

The editor reports itself dirty, via the framework's [`Component.isDirty()`](/api/core/classes/Component) mechanism, whenever its document differs from the text at the last clean point — the text it was constructed with, or the text `markClean()` last accepted. Typing, paste, `format()`, and `setValue()` all go through the same check, so an edit undone back to the clean text clears the flag on its own. `isDirty()` folds up into every ancestor container automatically. A host that loads a document with `setValue()` should follow it with `markClean()`, so the loaded text becomes the clean text.

## Cursor position

`getCursorPosition()` returns the primary caret's `{ line, column, offset }`,
and `on('cursorchange', fn)` fires whenever any of the three changes —
once per real move, not once per keystroke or transaction. The event does
not fire for the editor's initial position, so a status bar seeds itself
by calling `getCursorPosition()` once when it wires the listener.

`line` and `column` count from 1, rendering directly as "Ln 12, Col 5".
`offset` counts from 0, like a string or array index — it is CodeMirror's
own raw document position, the same value `format()` maps through a
reformat as `cursorOffset`, so it can be sliced or used as a selection
anchor with no adjustment. `column` and `offset` both count characters, so
a literal tab is one regardless of [`tabSize`](#construction), and an
emoji counts as two. With a selection active the moving end is reported;
with a multi-cursor selection, only the primary range, matching the
[right-click menu](#right-click-menu)'s own rule. Before the editor
mounts, `getCursorPosition()` reports the document start
(`{ line: 1, column: 1, offset: 0 }`) — where a freshly mounted editor's
caret sits.

## Selection

`getSelection()` returns the primary selection's
`{ characterCount, lineCount }`, and `on('selectionchange', fn)` fires
whenever either changes — once per real change, not once per keystroke or
transaction. Like `cursorchange`, the event does not fire for the
editor's initial position, so a status bar seeds itself by calling
`getSelection()` once when it wires the listener.

`characterCount` is 0 and `lineCount` is 1 for a collapsed selection (a
bare caret with nothing highlighted) — the same shape a freshly mounted
editor reports. Both are derived from the selection's normalized bounds,
so dragging backward (moving the caret before the anchor) reports the
same values as dragging forward. `characterCount` counts UTF-16 code
units, the same convention [`getCursorPosition()`](#cursor-position)'s
`offset` uses, so an emoji counts as two. With a multi-cursor selection,
only the primary range is measured, matching
[`getCursorPosition()`](#cursor-position)'s own rule.

`selectionchange` and `cursorchange` are independent: selecting all text
while the caret is already at the document's last position moves no
caret (so `cursorchange` does not fire) but still changes the
selection's extent (so `selectionchange` does).

## Keyboard

The editor uses CodeMirror's default keymap plus its history, fold, search,
close-brackets and autocompletion bindings, with one addition: **Tab
indents** and **Shift-Tab dedents**.

That binding traps Tab inside the editor, so Tab no longer moves focus to the
next control while the caret is in the document. To move focus out, press
**Ctrl-m** (**Alt-Shift-m** on macOS) to toggle CodeMirror's tab-focus mode;
Tab then moves focus again, and the same shortcut switches back to indenting.

| Keys | Action |
| --- | --- |
| `Mod-/` | Toggle line comment |
| `Alt-A` | Toggle block comment |
| `Ctrl-Shift-[` / `Ctrl-Shift-]` | Fold / unfold at the cursor |
| `Ctrl-F` (`Cmd-F` on macOS) | Open the floating search panel |
| `Escape` | Close the floating search panel |
| `Enter` (find field) | Find the next match |
| `Shift-Enter` (find field) | Find the previous match |
| `Enter` (replace field) | Replace the current match |
| `Ctrl-Space` | Open completions explicitly |
| `{` / `(` / `[` (typed) | Insert the matching closing bracket, caret between |
| `Backspace` (over a bracket pair) | Delete both brackets |

## Search and replace

`Ctrl-F` (`Cmd-F` on macOS) opens a rounded, shadowed card pinned to the editor's upper-right corner, overlaying the document instead of docking a strip that reserves space for it. Every match in the document stays tinted while the card is open, with the current match tinted more strongly. `Escape` — in the document or in either of the card's fields — closes it and returns focus to the document.

The card has nine controls, each a glyph-only button whose hover tooltip names its action:

| Control | Behaviour |
| --- | --- |
| Match case | Toggles case-sensitive matching |
| Whole word | Toggles whole-word matching |
| Regular expression | Reads the find field as a regular expression |
| Find previous / Find next | Moves the selection to the previous / next match, wrapping at the document ends |
| Select all matches | Creates one selection range per match |
| Replace | Replaces the current match and advances |
| Replace all | Replaces every match in one undo step |
| Close | Closes the card |

Replace and Replace all are inert while the editor is `readOnly: true`.

## Revealing a range

`revealRange({ line, column, length })` jumps the editor to a range a host
computed somewhere else — a project-wide search hit, a compiler diagnostic, a
stack frame. It selects the range, scrolls it into view, takes focus, and
paints an accent highlight over it. `line` and `column` count from 1, the
same convention [`getCursorPosition()`](#cursor-position) reports.

Pass `{ focus: false }` when the caller should keep focus — previewing hits
from a results list, say. That is why the highlight exists: an unfocused
selection is too faint to find. The highlight is drawn over the text
independently of the selection, and stays until another `revealRange` call
replaces it, the document changes, or the user moves the caret. Pass
`{ highlight: false }` for a silent jump, which also clears any highlight a
previous call left.

All three fields are clamped against the live document, so a position taken
from a copy of the text that has since changed lands at the nearest valid
range rather than throwing. A range that would run past its line's end is cut
off there — a revealed range never spans a line break. The highlight animates
in once; under `prefers-reduced-motion` it appears without the animation
rather than not at all.

## Right-click menu

Right-clicking anywhere in the editor opens a menu leading with **Cut / Copy / Paste**. Cut and Copy are dimmed when nothing is selected; a read-only editor (`readOnly: true`) shows only Copy. A browser that refuses the clipboard read shows a toast asking the user to press Ctrl/Cmd+V instead — Ctrl/Cmd+V itself still works either way. With a multi-cursor selection active, only the primary cursor's range is acted on.

## Common methods

| Method | Purpose |
| --- | --- |
| `getValue()` / `setValue(value)` | Read or replace the whole document. |
| `getLanguage()` / `setLanguage(id)` | Read or swap the active language (grammar loads lazily). |
| `getReadOnly()` / `setReadOnly(readOnly)` | Read or toggle whether the editor accepts edits. |
| `format(options?)` | Format the document (or re-indent, with no formatter). |
| `on('change', fn)` / `off('change', fn)` | Subscribe to document changes. |
| `getAutoHeightMaxRows()` | Read the configured `autoHeightMaxRows`, or `null` when unset. |
| `on('heightchange', fn)` / `off('heightchange', fn)` | Subscribe to the editor's own auto-height changes (only fires when `autoHeightMaxRows` is set). |
| `dispose()` | Detach the theme-change listener and destroy the live CodeMirror view — call before discarding a dynamically-built `CodeEditor`. |
| `markClean()` | Clear the dirty flag, accepting the current document as the clean baseline. |
| `getLineWrap()` / `setLineWrap(wrap)` | Read or toggle whether long lines wrap instead of scrolling horizontally. |
| `getPlaceholder()` / `setPlaceholder(text)` | Read, set, or (`null`) clear the text shown in an empty document. |
| `getHighlightWhitespace()` / `setHighlightWhitespace(highlight)` | Read or toggle visible whitespace rendering. |
| `getLint()` / `setLint(lint)` | Read or toggle parser-error diagnostics. |
| `getTabSize()` / `setTabSize(size)` | Read, set, or (`null`) clear the tab-stop width, in columns. |
| `getLineNumbers()` / `setLineNumbers(show)` | Read or toggle whether the line-number gutter is shown. |
| `getSpellcheck()` / `setSpellcheck(spellcheck)` | Read or toggle whether the browser's native spellcheck runs inside the editor. |
| `cut()` / `copy()` | Cut or copy the primary selection's text to the system clipboard. |
| `paste()` | Read the system clipboard and insert it at the primary selection, replacing any selected text. Async: resolves `true` when the clipboard was read, `false` when there is no mounted view or the browser refused the read. |
| `getCursorPosition()` | Read the primary caret's `{ line, column, offset }` — `line`/`column` 1-based, `offset` a 0-based raw document position. Returns the document start when the editor is not mounted. |
| `on('cursorchange', fn)` / `off('cursorchange', fn)` | Subscribe to caret moves — fires once per real move to a different line, column, or offset. |
| `getSelection()` | Read the primary selection's `{ characterCount, lineCount }`. `0`/`1` for a collapsed selection (a bare caret). Returns that same value when the editor is not mounted. |
| `on('selectionchange', fn)` / `off('selectionchange', fn)` | Subscribe to selection changes — fires once per real change to the character or line count. |
| `revealRange(at, options?)` | Select, scroll to and highlight a 1-based `{ line, column, length }` range. `options.focus` (default `true`) takes keyboard focus; `options.highlight` (default `true`) paints the highlight. No-op before the editor is mounted. |

## Theming

The editor's chrome (background, gutters, cursor, selection) reads the project's CSS custom-property tokens directly, so a [`ThemeManager.setTheme`](/api/core/classes/ThemeManager) toggle recolours it immediately with no rebuild. The floating search panel is built from ordinary framework components, so it follows the same tokens automatically, with no theming code of its own; the match highlighting it drives, the completion tooltip, the fold gutter, and the lint markers/tooltip are themed here from the same tokens. Syntax colours come from a fixed, IDE-conventional palette (there is no per-token-kind theme token in the framework).

## Linting

Turning on [`lint`](#construction) shows diagnostics from the active language's lint source, when it has one (see the [built-in languages table](#built-in-languages) above). The built-in sources are all syntax-only — `collectSyntaxErrors`, exported from `component/editor`, walks the grammar's own parse tree for error nodes and reports each as an `"error"` diagnostic; it knows nothing about names, types, or other files. Switching language while lint is on swaps the diagnostics along with the grammar. A custom language wires this up the same way any other `LanguageDefinition` field does — see [Registering a language](#registering-a-language).

## Spellcheck

Turning on [`spellcheck`](#construction) sets the browser's native `spellcheck` attribute
on the editor's content element, so the browser's own spellchecker underlines words it
doesn't recognize — the same behaviour a plain `<textarea spellcheck>` has. This is
unrelated to [`lint`](#linting): lint's squiggles come from the active language's own
parser, flagging syntax errors, while spellcheck's squiggles come from the browser,
flagging words outside its dictionary. Both can render as a similar-looking underline;
only one is CodeMirror's own feature.

## Autocompletion

Keyword and snippet completion is always on — there is no option to turn it off, since it costs nothing until a completion tooltip is actually shown. Every built-in grammar except `json` (which has no keywords of its own) publishes its own completion source through CodeMirror's language-data facet, which `autocompletion()` finds automatically; `json` gets a three-keyword list (`true`, `false`, `null`) attached the same way a consumer would for a custom grammar. Completions are bounded to what each grammar's own local/keyword tables know — no cross-file symbols, no type information. A completion list longer than its `10em` cap scrolls with the wheel as well as with the arrow keys.

## See also

- [API: CodeEditor](/api/component/editor/classes/CodeEditor)
- [`Markdown`](/components/Markdown) — another third-party-library-backed display component.
- [`Canvas`](/components/Canvas) — the live-only pattern `CodeEditor` follows.
