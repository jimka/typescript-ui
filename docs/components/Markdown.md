# Markdown

[`Markdown`](/api/component/display/classes/Markdown) renders a Markdown source string as a live DOM subtree.

Parsing uses the [`marked`](https://marked.js.org/) library's **lexer only** — `Markdown` walks the returned token AST and builds every prose element (`<h1>`–`<h6>`, `<p>`, `<ul>`/`<ol>`/`<li>`, `<blockquote>`, `<pre>`/`<code>`, `<strong>`, `<em>`, `<a>`) through the framework DOM sink. There is no HTML-string assignment path, so untrusted Markdown can never inject markup.

Use this to render authored copy (help text, release notes, a README-style panel) without hand-building the element tree.

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

Inherits the common [`ComponentOptions`](/api/core/interfaces/ComponentOptions) fields (preferred size, background, foreground, etc.).

## Supported syntax (v1)

| Markdown | Renders as |
| --- | --- |
| `#` … `######` | `<h1>` … `<h6>` |
| paragraph text | `<p>` |
| `**bold**`, `*italic*` | `<strong>`, `<em>` |
| `` `inline code` `` | `<code>` |
| fenced ```` ``` ```` block | `<pre>` › `<code>` (literal text, newlines preserved) |
| `-`/`*` and `1.` lists | `<ul>`/`<ol>` with `<li>` items |
| `> quote` | `<blockquote>` |
| `[text](url)` | `<a href target="_blank" rel="noopener noreferrer">` |

### Fallback for unsupported tokens

Any token type not in the v1 set — tables, images, raw HTML, and GFM extensions (task lists, strikethrough) — falls through to a **defined fallback** that renders the token's plain text. It never crashes and never emits the corresponding element (no `<table>`, no `<img>`). Support for a new token type is added by extending the internal token switch, with no structural rewrite.

### Sizing

The prose **wraps** to whatever width its parent assigns — paragraphs reflow at word boundaries and overlong unbreakable tokens (URLs) break rather than spill sideways, so the content never overflows horizontally. Fenced code blocks are the exception: they preserve their formatting and scroll **inside their own frame** when a line is too wide, leaving the surrounding layout stable.

Because prose reflows, `Markdown` measures its rendered content **height** at the width it is assigned and reports it as its minimum and preferred height. Dropping one in a vertically-scrolling [`Panel`](/api/component/container/classes/Panel) (via `setAutoScroll("y")`) is all it takes — the panel grows to the full prose height and scrolls when the document is taller than the viewport. The height is re-measured on content, width, and theme change. Only the **height** axis is derived; the width stays freely assignable. The measured height is reported as a **minimum**, so an explicit `preferredSize` or `setMinSize` *taller* than the content still wins — to cap the component *below* its content, place it in a bounded scroll host rather than setting a smaller `preferredSize`.

## Common methods

| Method | Purpose |
| --- | --- |
| `getMarkdown()` | Return the current Markdown source (`""` when unset). |
| `setMarkdown(markdown)` | Replace the source, re-lexing and rebuilding the rendered subtree. |
| `dispose()` | Detach the theme-change listener — call this before removing a dynamically-built `Markdown` from the page so the listener doesn't leak. |

## See also

- [API: Markdown](/api/component/display/classes/Markdown)
- [`Text`](/components/Text) — for a single non-Markdown string.
