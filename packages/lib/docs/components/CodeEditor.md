# CodeEditor

[`CodeEditor`](/api/component/editor/classes/CodeEditor) wraps [CodeMirror 6](https://codemirror.net/). Its scope is highlighting, formatting, folding, search, parser-level diagnostics (lint) and keyword/snippet completion — every one of them bounded to what a grammar's own parse tree already knows. Anything needing semantic understanding — cross-file symbols, type information, hovers, go-to-definition, a real language server — or collaborative editing is out of scope.

`CodeEditor` is a **live-only** component, the same category as [`Canvas`](/components/Canvas): CodeMirror's `EditorView` takes a real DOM element and mutates a whole region of it directly, so under the framework's offline test seam the editor mounts nothing and every operation (`format()`, `setLanguage()`, …) no-ops. In a real browser it mounts once the component is connected and sized, fills its assigned box, and scrolls internally.

Wheel scrolling inside the editor is driven by the framework's eased scroller, the same glide every other scrolling surface uses — `CodeEditor` points the framework's scroll plumbing at CodeMirror's own viewport rather than at its outer box. The scrollbars themselves are still the browser's native ones: the custom overlay [`Scrollbar`](/components/Scrollbar) is a [`Panel`](/api/core/classes/Panel) feature and does not reach a foreign widget's internal scroller.

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
| `listeners` | `{ change?: (payload) => void }` | — | Construction-time listener bag for the `"change"` event. |

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
| `Ctrl-F` (`Cmd-F` on macOS) | Open the search panel |
| `Escape` | Close the search panel |
| `Ctrl-Space` | Open completions explicitly |
| `{` / `(` / `[` (typed) | Insert the matching closing bracket, caret between |
| `Backspace` (over a bracket pair) | Delete both brackets |

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

## Theming

The editor's chrome (background, gutters, cursor, selection) reads the project's CSS custom-property tokens directly, so a [`ThemeManager.setTheme`](/api/core/classes/ThemeManager) toggle recolours it immediately with no rebuild. The search panel, the completion tooltip, the fold gutter and the lint markers/tooltip are themed from the same tokens. Syntax colours come from a fixed, IDE-conventional palette (there is no per-token-kind theme token in the framework).

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

Keyword and snippet completion is always on — there is no option to turn it off, since it costs nothing until a completion tooltip is actually shown. Every built-in grammar except `json` (which has no keywords of its own) publishes its own completion source through CodeMirror's language-data facet, which `autocompletion()` finds automatically; `json` gets a three-keyword list (`true`, `false`, `null`) attached the same way a consumer would for a custom grammar. Completions are bounded to what each grammar's own local/keyword tables know — no cross-file symbols, no type information.

## See also

- [API: CodeEditor](/api/component/editor/classes/CodeEditor)
- [`Markdown`](/components/Markdown) — another third-party-library-backed display component.
- [`Canvas`](/components/Canvas) — the live-only pattern `CodeEditor` follows.
