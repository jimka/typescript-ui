# Markdown

[`Markdown`](/api/component/display/classes/Markdown) renders a Markdown source string as a live DOM subtree.

Parsing uses the [`marked`](https://marked.js.org/) library's **lexer only** — `Markdown` walks the returned token AST and builds every prose element (`<h1>`–`<h6>`, `<p>`, `<ul>`/`<ol>`/`<li>`, `<blockquote>`, `<pre>`/`<code>`, `<strong>`, `<em>`, `<a>`) through the framework DOM sink. There is no HTML-string assignment path, so untrusted Markdown can never inject markup. The dialect's extension syntax (see [Extension syntax](#extension-syntax) below) carries a handful of styling attributes — colour, font, size — plus an image's `src` scheme, and every value is checked against an allow-list before it reaches the DOM; a value that fails validation is silently dropped (or, for an image, renders nothing at all) rather than rendered, so the no-markup guarantee extends to these constructs too.

Use this to render authored copy (help text, release notes, a README-style panel) without hand-building the element tree.

Rendered prose is selectable and copyable, like any other read-only text a reader might want to quote.

<!-- demo: markdown-preview -->
> **Live demo** — a `TextArea` of Markdown source with a `Markdown` panel
> below it that re-renders live as you type.
> [Open the Markdown page](https://jimka.github.io/typescript-ui/components/Markdown)
<!-- /demo -->

## Usage

```typescript
import { Markdown } from '@jimka/typescript-ui/component/display';

panel.addComponent(Markdown('# Title\n\nSome **bold** text with a [link](https://example.com).'));
```

`marked` is a runtime dependency of the library, installed transitively when you install `@jimka/typescript-ui`.

## Construction

`Markdown(markdown?, options?)` — the `markdown` source is an optional positional argument (equivalent to the `markdown` option). An unset source renders an empty root.

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `markdown` | `string` | `""` | The Markdown source string to render. |
| `linkResolver` | `(href: string) => { href: string; external: boolean }` | resolves every href as external, unchanged | Maps an authored link href to its rendered form — see [Link resolution](#link-resolution). |
| `maxMeasure` | `string \| number \| null` | `null` (theme default) | Per-instance override of the prose column's max width — see [Reading width and font scale](#reading-width-and-font-scale). |
| `fontScale` | `number` | `1` | Multiplies the prose's base font size — see [Reading width and font scale](#reading-width-and-font-scale). |

Inherits the common [`ComponentOptions`](/api/core/interfaces/ComponentOptions) fields (preferred size, background, foreground, etc.).

## Selecting and copying

Rendered prose is selectable, and a right-click offers a Copy row for whatever is currently selected — dimmed when nothing is selected.

## Supported syntax (v1)

| Markdown | Renders as |
| --- | --- |
| `#` … `######` | `<h1>` … `<h6>` |
| paragraph text | `<p>` |
| `**bold**`, `*italic*` | `<strong>`, `<em>` |
| `~~struck~~` | `<del>` |
| `++underlined++` | `<u>` |
| `[text]{color=... font=... size=...}` | `<span>` with the resolved, validated style — see [Extension syntax](#extension-syntax) |
| `` `inline code` `` | `<code>` |
| fenced ```` ``` ```` block | `<pre>` › `<code>` (literal text, newlines preserved), or a syntax-highlighted `CodeEditor` for a supported language — see [Syntax highlighting](#syntax-highlighting-in-fenced-code-blocks) |
| `-`/`*` and `1.` lists | `<ul>`/`<ol>` with `<li>` items |
| `> quote` | `<blockquote>` |
| `[text](url)` | `<a href target="_blank" rel="noopener noreferrer">` |
| pipe table | `<table>` with `<thead>`/`<tbody>` |
| delimiter cell `{width=240}` | `<colgroup>` / `<col style="width:240px">` — see [Extension syntax](#extension-syntax) |
| body cell `<<` / `^^` | merges into the preceding cell as `colspan`/`rowspan` — see [Extension syntax](#extension-syntax) |
| `::: {align=... columns=... gap=...}` … `:::` | `<div>` with the resolved, validated alignment / multi-column style — see [Extension syntax](#extension-syntax) |
| `![alt](src){width=... height=...}` | `<img>`, or nothing at all when `src` fails the scheme allow-list — see [Extension syntax](#extension-syntax) |

A delimiter row's alignment markers (`:---`, `:---:`, `---:`) apply as a CSS class to every cell in that column, header and body alike. A delimiter cell's trailing `{width=240}` renders a `<colgroup>`/`<col style="width:240px">` for that column — the `<colgroup>` appears only when at least one column carries a width. A body cell's `<<` (covered from the left) or `^^` (covered from above) merges it into the preceding cell as a `colspan`/`rowspan`, rather than rendering its own `<td>`; a `<<`/`^^` with nothing to extend (column 0, or the table's first body row) renders as ordinary literal text instead, and a cell whose own text is literally `<<` or `^^` escapes to `\<<` / `\^^` to render as that literal text rather than being read as a marker.

Every rendered heading carries a slugified `id` (lowercase, non-alphanumerics collapsed to single hyphens, ends trimmed), so a `#fragment` link can target it — `## Some Heading` renders `<h2 id="some-heading">`. Two headings with identical text get `-N` suffixes (`id="dup"`, `id="dup-1"`, …) so ids stay unique within one render; the counter resets on every `setMarkdown` re-render. A heading nested inside a `:::` fence is still found, so it still appears in a heading outline built from [`extractMarkdownHeadings`](#extension-syntax).

A `::: {…}` fence opens on a line whose trimmed form starts with `:::` and has more after it, and closes on a line whose trimmed form is exactly `:::`; fences nest, tracked by depth. An unclosed fence (no matching `:::`) renders as ordinary paragraphs — no `<div>` at all.

### Link resolution

Every link's href passes through the `linkResolver` option before rendering, and the resolution decides both the rendered `href` and whether the anchor carries `target="_blank" rel="noopener noreferrer"`. The default resolver returns `{ href, external: true }` for every href — today's behaviour, unchanged for anyone not passing the option. A consumer embedding `Markdown` in an app with its own routing (e.g. a docs site) can rewrite in-site hrefs and mark them non-external so they navigate in place instead of opening a new tab, while external links stay external:

```typescript
import { Markdown } from '@jimka/typescript-ui/component/display';

Markdown(source, {
    linkResolver: (href) => href.startsWith('/')
        ? { href: '#' + href, external: false }
        : { href, external: true },
});
```

### Syntax highlighting in fenced code blocks

A fenced code block whose language maps to one of `CodeEditor`'s registered
grammars upgrades from a plain `<pre>` to a live, read-only
[`CodeEditor`](/components/CodeEditor), sized and positioned to exactly fill
the block's spot in the document — including nested inside a blockquote or
list item.

| Fence info string (first word, case-insensitive) | Renders as |
| --- | --- |
| `js`, `javascript`, `jsx`, `mjs`, `cjs` | JavaScript highlighting |
| `ts`, `typescript`, `tsx` | JavaScript highlighting (no separate TypeScript grammar; the JS grammar covers both) |
| `json` | JSON highlighting |
| `html`, `htm` | HTML highlighting |
| `sql` | SQL highlighting |
| `md`, `markdown` | Markdown highlighting |
| anything else, or no info string | plain `<pre>` (unchanged) |

The upgrade is lazy: `CodeMirror` — an order of magnitude heavier than
`marked`, `Markdown`'s only other runtime dependency — loads through a
dynamic import that fires only once a fenced block with a supported language
actually needs it, and only after `Markdown` completes its first connected,
displayed layout. A `Markdown` instance with no fenced code, or only
unsupported languages, triggers no import and pays no extra bundle cost. A
`Markdown` constructed with `displayed: false` (e.g. a collapsed "show
source" panel) defers the import until it is shown. Each block is further
deferred individually: it upgrades only once its wrapper comes within one
viewport-height of the visible area, so a long document — a generated API
page with hundreds of fenced blocks, for example — pays only for the blocks
the reader actually scrolls to.

### Extension syntax

CommonMark and GFM have no syntax for underline, colour, font, size, table column widths, merged table cells, block alignment, or multi-column layout, so the dialect adds a small extension syntax of its own — `++text++` for underline, `[text]{key=value ...}` for a coloured/sized/font-styled span, a delimiter cell's trailing `{width=240}` for a column width, a body cell's `<<` / `^^` for a merge continuation, and `::: {align=... columns=... gap=...}` … `:::` for a block-level fence wrapping one or more blocks. `MarkdownEditor` produces the same syntax when a document is edited, so a document round-trips between the two components unchanged.

Sized images reuse this same trailing `{key=value}` grammar on top of CommonMark's own `![alt](src)` image syntax, e.g. `![Diagram](/img/d.png){width=320 height=200}`; the `src` scheme is additionally checked against an allow-list (a relative path, `http:`, `https:`, or an allow-listed `data:image/…` base64 URI — `data:image/svg+xml` is refused since it can embed script), and an image whose `src` fails that check renders nothing at all rather than a broken or unsafe `<img>`.

A document using these constructs is **not portable**: a foreign Markdown renderer has no meaning for the non-standard markers and shows them as literal text (`++text++`, `[text]{...}`, `<<`, `^^`) rather than applying them; a delimiter cell carrying `{width=240}` fails a foreign GFM parser's stricter delimiter-row check entirely, turning that whole table into paragraphs; and a sized image's trailing `{width=...}` renders as visible text after an otherwise-ordinary image. This is a deliberate trade for a small, safe, in-house grammar over embedding raw HTML or switching the persisted format away from Markdown. It renders correctly only in this library's `Markdown` viewer and `MarkdownEditor`.

Every attribute value is validated against a per-key allow-list before it is applied; a value that fails validation is dropped and the construct renders with that property unset (e.g. `[x]{color=not-a-color}` renders as plain `x`).

### Fallback for unsupported tokens

Any token type not in the v1 set — raw HTML and the remaining GFM extensions (task lists) — falls through to a **defined fallback** that renders the token's plain text. It never crashes and never emits the corresponding element. Support for a new token type is added by extending the internal token switch, with no structural rewrite.

### Sizing

The prose **wraps** to whatever width its parent assigns — paragraphs reflow at word boundaries and overlong unbreakable tokens (URLs) break rather than spill sideways, so the content never overflows horizontally. Fenced code blocks are the exception: they preserve their formatting and scroll **inside their own frame** when a line is too wide, leaving the surrounding layout stable. A table is the same way: its columns cannot reflow below their content width, so a wide table scrolls horizontally inside its own frame rather than widening the component.

Because prose reflows, `Markdown` measures its rendered content **height** at the width it is assigned and reports it as its minimum and preferred height. Dropping one in a vertically-scrolling [`Panel`](/api/core/classes/Panel) (via `setAutoScroll("y")`) is all it takes — the panel grows to the full prose height and scrolls when the document is taller than the viewport. The height is re-measured on content, width, and theme change. Only the **height** axis is derived; the width stays freely assignable. The measured height is reported as a **minimum**, so an explicit `preferredSize` or `setMinSize` *taller* than the content still wins — to cap the component *below* its content, place it in a bounded scroll host rather than setting a smaller `preferredSize`.

### Reading width and font scale

`setMaxMeasure(value)` overrides the prose column's max width for this instance — a CSS width string (e.g. `"60ch"`), a bare number of `ch` units, or `null` to revert to the theme's `--ts-ui-md-max-measure` default (`70ch` unless the active theme overrides it). Passing `null` reverts to the **live** theme variable, not a value snapshotted at call time — a theme change afterward still takes effect.

`setFontScale(value)` multiplies the prose's base font size; headings and other relatively-sized elements scale with it via their own relative sizing. Pass `1` to clear the override — this writes a cleared inline style, not a literal `"100%"`, so the rendered result is identical to never having called it.

[`MarkdownViewer`](/components/MarkdownViewer)'s floating width/zoom control cluster is built on exactly these two setters, stepping through fixed presets rather than exposing continuous sliders.

## Common methods

| Method | Purpose |
| --- | --- |
| `getMarkdown()` | Return the current Markdown source (`""` when unset). |
| `setMarkdown(markdown)` | Replace the source, re-lexing and rebuilding the rendered subtree. |
| `getLinkResolver()` | Return the current link resolver — the default resolver when unset, never `null`. |
| `setLinkResolver(resolver)` | Replace the link resolver used to render links. Does not re-render already-built content. |
| `getMaxMeasure()` / `setMaxMeasure(value)` | Read or override the prose column's max width — see [Reading width and font scale](#reading-width-and-font-scale). |
| `getFontScale()` / `setFontScale(value)` | Read or override the prose's base font-size multiplier — see [Reading width and font scale](#reading-width-and-font-scale). |
| `dispose()` | Detach the theme-change listener — call this before removing a dynamically-built `Markdown` from the page so the listener doesn't leak. |

## See also

- [API: Markdown](/api/component/display/classes/Markdown)
- [`Text`](/components/Text) — for a single non-Markdown string.
- [`CodeEditor`](/components/CodeEditor) — the syntax-highlighting editor a supported-language fenced block upgrades to.
- [`MarkdownViewer`](/components/MarkdownViewer) — wraps a single `Markdown` instance with a floating heading-outline minimap and width/zoom controls.
