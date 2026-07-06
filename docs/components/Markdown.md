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

v1 does not measure flowed-text height — pixel-accurate wrapped-text height depends on the assigned width and is out of scope. Place a `Markdown` in a width-assigning cell or a scrolling [`Panel`](/api/component/container/classes/Panel) (via `setAutoScroll`), or set an explicit `preferredSize`, exactly as with other long-form content.

## Common methods

| Method | Purpose |
| --- | --- |
| `getMarkdown()` | Return the current Markdown source (`""` when unset). |
| `setMarkdown(markdown)` | Replace the source, re-lexing and rebuilding the rendered subtree. |

## See also

- [API: Markdown](/api/component/display/classes/Markdown)
- [`Text`](/components/Text) — for a single non-Markdown string.
