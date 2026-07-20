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
| `linkResolver` | `(href: string) => { href: string; external: boolean }` | resolves every href as external, unchanged | Maps an authored link href to its rendered form — see [Link resolution](#link-resolution). |

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
| pipe table | `<table>` with `<thead>`/`<tbody>` |

A delimiter row's alignment markers (`:---`, `:---:`, `---:`) apply as a CSS class to every cell in that column, header and body alike.

Every rendered heading carries a slugified `id` (lowercase, non-alphanumerics collapsed to single hyphens, ends trimmed), so a `#fragment` link can target it — `## Some Heading` renders `<h2 id="some-heading">`. Two headings with identical text get `-N` suffixes (`id="dup"`, `id="dup-1"`, …) so ids stay unique within one render; the counter resets on every `setMarkdown` re-render.

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

### Fallback for unsupported tokens

Any token type not in the v1 set — images, raw HTML, and the remaining GFM extensions (task lists, strikethrough) — falls through to a **defined fallback** that renders the token's plain text. It never crashes and never emits the corresponding element (no `<img>`). Support for a new token type is added by extending the internal token switch, with no structural rewrite.

### Sizing

The prose **wraps** to whatever width its parent assigns — paragraphs reflow at word boundaries and overlong unbreakable tokens (URLs) break rather than spill sideways, so the content never overflows horizontally. Fenced code blocks are the exception: they preserve their formatting and scroll **inside their own frame** when a line is too wide, leaving the surrounding layout stable. A table is the same way: its columns cannot reflow below their content width, so a wide table scrolls horizontally inside its own frame rather than widening the component.

Because prose reflows, `Markdown` measures its rendered content **height** at the width it is assigned and reports it as its minimum and preferred height. Dropping one in a vertically-scrolling [`Panel`](/api/component/container/classes/Panel) (via `setAutoScroll("y")`) is all it takes — the panel grows to the full prose height and scrolls when the document is taller than the viewport. The height is re-measured on content, width, and theme change. Only the **height** axis is derived; the width stays freely assignable. The measured height is reported as a **minimum**, so an explicit `preferredSize` or `setMinSize` *taller* than the content still wins — to cap the component *below* its content, place it in a bounded scroll host rather than setting a smaller `preferredSize`.

## Common methods

| Method | Purpose |
| --- | --- |
| `getMarkdown()` | Return the current Markdown source (`""` when unset). |
| `setMarkdown(markdown)` | Replace the source, re-lexing and rebuilding the rendered subtree. |
| `getLinkResolver()` | Return the current link resolver — the default resolver when unset, never `null`. |
| `setLinkResolver(resolver)` | Replace the link resolver used to render links. Does not re-render already-built content. |
| `dispose()` | Detach the theme-change listener — call this before removing a dynamically-built `Markdown` from the page so the listener doesn't leak. |

## See also

- [API: Markdown](/api/component/display/classes/Markdown)
- [`Text`](/components/Text) — for a single non-Markdown string.
