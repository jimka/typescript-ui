# Markdown Display Component — Implementation Plan

## Overview

Add a `Markdown` display component that renders a Markdown source string as a
live DOM subtree. It lives in `src/typescript/lib/component/display/` alongside
the other display components ([Glyph](src/typescript/lib/component/display/Glyph.ts#L204),
[IconText](src/typescript/lib/component/display/IconText.ts#L52)), extends the
base [Component](src/typescript/lib/core/Component.ts#L747), and follows the
established conventions: options-bag construction, the `callable()` + dual-export
pattern, a `render()` override that builds DOM through the sink, and a `setX`
setter that defers DOM work.

Parsing uses the `marked` library, but **only its lexer** — `marked.lexer(src)`
returns a token AST. The component walks that AST and builds a structured DOM
tree through `DOM.sink` (`createElement` / `apply` / `appendChild`), exactly the
way [Glyph.createRootElement](src/typescript/lib/component/display/Glyph.ts#L634)
builds its `<svg><use>` subtree. There is **no** `innerHTML` /
`insertAdjacentHTML` / HTML-string path anywhere — the library has zero such
usage today and depends on the modelled `DOM.source`
([core/DOM.ts](src/typescript/lib/core/DOM.ts)) for offline testability.

`marked` is the library's **first real runtime code dependency** — `package.json`
currently lists only `@fontsource-variable/manrope`
([package.json](package.json)). This is the one notable tradeoff; it is addressed
in Architecture Decisions.

---

## Architecture Decisions

### Lexer-only use of `marked` — the first runtime code dependency

We consume `marked` solely through `marked.lexer(src)` to obtain a typed token
AST (`Tokens.*`), and never call `marked.parse` / the HTML renderer. This keeps
the security- and seam-critical rendering entirely inside the framework: every
element is minted via `DOM.sink.createElement` and populated via
`DOM.sink.apply({ text })`, so untrusted Markdown can never inject markup, and
the render path runs against the modelled `DOM.source` in tests. `marked` is
added to `package.json` `dependencies` (a real runtime dep, unlike the existing
font asset dep) and pinned to a single major version; the implementer must
confirm the installed major exports the named `lexer` function and the `Tokens`
type namespace (both present in marked v5+). The alternative — hand-writing a
Markdown parser — was rejected: correct Markdown tokenisation (nested emphasis,
fenced-code edge cases, link parsing) is a large surface that `marked`'s lexer
already covers, and we only take the AST, not its renderer.

### Bundler: `marked` is external, not inlined

`marked` is added to `rollupOptions.external` in
[vite.lib.config.ts](vite.lib.config.ts) so it is **not** bundled into the
`component/display.es.js` chunk. Consumers install `marked` transitively (it is a
`dependencies` entry) and the bundler resolves it from their `node_modules`,
avoiding a duplicated copy and keeping the display chunk lean. This differs from
`@fontsource-variable/manrope`, which is *inlined* because it contributes woff2
asset URLs, not importable code. tsconfig uses `moduleResolution: "bundler"`
([tsconfig.json](tsconfig.json)), which resolves `marked`'s shipped `.d.ts`
without a `paths` entry; no `paths` change is required.

### Raw prose children, not composed Components (Glyph precedent)

The rendered Markdown is a tree of non-interactive prose elements (`<h1>`–`<h6>`,
`<p>`, `<ul>`/`<ol>`/`<li>`, `<blockquote>`, `<pre>`/`<code>`, `<strong>`,
`<em>`, `<a>`). These are built as **raw child DOM nodes through the sink**, not
as framework `Component` instances. This is the same carve-out ARCHITECTURE.md's
*One DOM element per class* rule grants Glyph's `<use>` child ("trivial
non-interactive helpers … can stay as raw children") and is the pattern the user
has chosen. Wrapping every `<strong>` or `<li>` in a `Component` would add
hundreds of objects and event-surface machinery for statically-rendered text
that has no independent behaviour — composition here would *relocate* structure,
not reduce complexity, so it is the wrong call per *Compose before specializing*.
Links render as plain `<a href target="_blank" rel="noopener noreferrer">` with
native navigation; the component exposes no `on()` event surface in v1, so it
carries no `listeners` bag.

### Extensible AST dispatch with a defined fallback

The token walk dispatches on `token.type` through a `switch` split into a
block-level walker and an inline-level walker. Any token type not in the v1 set
(tables, images, HTML, `def`, `hr`, etc.) falls through to a single **fallback
branch** that renders the token's plain-text content (`token.raw` for block
tokens, `token.text`/`token.raw` for inline) into a text node — never a crash,
never markup. New token types are added later by extending the switch, with no
structural rewrite. This is the "put unsupported/unknown tokens into a defined
fallback" requirement.

### Styling via shared class rules, not inline or cosmetic insets

Base presentation for the prose elements (monospace + subtle background for
`code`/`pre`, a left border on `blockquote`, list indentation, heading weight)
is written as **module-level shared class rules** through
`new StyleRule({ scope: "class", name: "…" })` inside a singleton
`ensureMarkdownClassRules()` — the same deferred-write path as
[ensureGlyphKeyframes](src/typescript/lib/component/display/Glyph.ts#L53). Each
built element receives its class via `DOM.sink.apply(el, { addClass: […] })`.
Colours reference existing theme tokens (`var(--ts-ui-foreground, …)`,
`var(--ts-ui-accent, …)`) rather than hardcoded values, and every spacing
constant is a documented magic number. No inline styles, no cosmetic insets
(ARCHITECTURE.md *No cosmetic insets or padding*): list/blockquote indentation is
genuine structural spacing, documented at its constant.

### No prose auto-measurement in v1 (sizing deferral)

The rendered subtree is normal block flow inside the component's
absolutely-positioned root, so its rendered height depends on the width the
parent layout assigns. v1 does **not** implement `getPreferredSize` prose
measurement — pixel-accurate flowed-text height is offline-unmeasurable through
the modelled source and is out of scope. Consumers place `Markdown` in a
stretching cell or a scrolling `Panel` (or set an explicit `preferredSize`),
exactly as long-form content is handled elsewhere. This is called out in
Non-Goals; the component otherwise inherits Component's default sizing.

---

## Public API

New file `src/typescript/lib/component/display/Markdown.ts`.

```typescript
export interface MarkdownOptions extends ComponentOptions {
    /** The Markdown source string to render. */
    markdown?: string;
}

class Markdown extends Component<MarkdownOptions> {
    constructor(markdown?: string, options?: MarkdownOptions);

    /** Returns the current Markdown source (""" when unset). */
    getMarkdown(): string;

    /**
     * Sets the Markdown source, re-lexing and rebuilding the rendered subtree
     * when the element already exists (deferred to render() otherwise).
     */
    setMarkdown(markdown: string): this;

    protected applyOptions(options: MarkdownOptions): this;
    protected render(): Handle;
}

const MarkdownCallable = callable(Markdown);
type MarkdownCallable = Markdown;
export {
    Markdown         as _Markdown,
    MarkdownCallable as Markdown,
};
```

- Backing state: the `markdown` string is cached in `this._options.markdown`
  (options-bag-as-cache per ARCHITECTURE.md's three DOM-write rules); no separate
  backing field is needed since input equals stored form. `getMarkdown()` reads
  `this._options.markdown ?? ""`.
- Options field `markdown` ↔ setter `setMarkdown` ↔ constructor positional arg,
  routed 1:1 by `applyOptions`.
- Private tracked child handles: `private _contentHandles: Handle[] = []` — the
  raw nodes built into the root, removed/rebuilt on `setMarkdown`.

---

## Internal Structure

**Token walk.** Two private methods, both taking the parent `Handle` they append
into:

```
private appendBlockTokens(parent: Handle, tokens: Token[]): void
private appendInlineTokens(parent: Handle, tokens: Token[]): void
```

`appendBlockTokens` switches on `token.type`:

| Token type   | Element built                                  | Children |
|--------------|------------------------------------------------|----------|
| `heading`    | `<h1>`…`<h6>` (tag from `token.depth`)          | inline   |
| `paragraph`  | `<p>`                                           | inline   |
| `list`       | `<ol>` when `token.ordered` else `<ul>`         | items    |
| `list_item`  | `<li>` (walked from `list.items`)               | inline/block |
| `blockquote` | `<blockquote>`                                  | block (recurse) |
| `code`       | `<pre>` › `<code>`, text = `token.text`         | none (raw text) |
| `space`      | ignored                                         | —        |
| *default*    | text node of `token.raw`                        | —        |

`appendInlineTokens` switches on `token.type`:

| Token type | Element / effect                                       |
|------------|--------------------------------------------------------|
| `text`     | `apply({ text })` (or recurse if `token.tokens` present) |
| `strong`   | `<strong>` › inline                                    |
| `em`       | `<em>` › inline                                         |
| `codespan` | `<code>`, text = `token.text`                           |
| `link`     | `<a>` with `setAttr: { href, target, rel }` › inline   |
| *default*  | text node of `token.text ?? token.raw`                 |

Each created handle is `this.trackHandle(handle)`-ed (so it is released with the
component, mirroring [Glyph's `<use>` tracking](src/typescript/lib/component/display/Glyph.ts#L649))
and pushed to `_contentHandles`. Text is written with a single
`DOM.sink.apply(handle, { text })`; classes with `{ addClass: […] }`.

**Rebuild on setMarkdown.** A private `clearContent()` removes every
`_contentHandles` node (`DOM.sink.removeElement`), `untrackHandle`s it, and
empties the array; the render helper then rebuilds from the fresh token list.
`setMarkdown` caches into `_options.markdown`; if `getElement()` returns an
existing element it calls `clearContent()` + rebuild, otherwise it returns (the
pending source is picked up by `render()`).

**render().** Calls `super.render()` for the root element, then runs
`ensureMarkdownClassRules()` and `appendBlockTokens(root, lexer(this.getMarkdown()))`.
Empty/blank source lexes to an empty token list → an empty root (no children),
which is correct.

---

## Ordered Implementation Steps

1. **Add the dependency.** `npm install marked` (pins a major into
   `dependencies`). Confirm `import { lexer, type Tokens, type Token } from "marked"`
   type-checks. → verify: `npm run typecheck`.
2. **Externalise `marked`** in [vite.lib.config.ts](vite.lib.config.ts): add
   `rollupOptions.external: ["marked"]` (merge with the existing `output` block).
3. **Create `src/typescript/lib/component/display/Markdown.ts`** with the class,
   options interface, `callable()` dual export, `MarkdownOptions`, `setMarkdown` /
   `getMarkdown`, `applyOptions`, `render`, the two token-walk helpers,
   `clearContent`, and the module-level `ensureMarkdownClassRules()` singleton.
   Use only `DOM.sink.createElement` / `apply` / `appendChild` / `removeElement`.
4. **Export from the barrel** [component/display/index.ts](src/typescript/lib/component/display/index.ts):
   add `export { Markdown }` and `export type { MarkdownOptions }`.
5. **Grep invariant — zero HTML-string injection:**
   `grep -nE "innerHTML|insertAdjacentHTML|outerHTML" src/typescript/lib/component/display/Markdown.ts`
   → expect **zero** matches.
6. **Grep invariant — no raw DOM outside the seam:**
   `npm run lint` (the `local/no-raw-dom` rule must stay green with an empty
   baseline).
7. **Write unit tests** `tests/component/display/Markdown.test.ts` (see
   Verification) covering every v1 token type and the fallback, asserting the
   recorded modelled-DOM tree.
8. **Add the docs** (see Documentation Impact): guide page
   `docs/components/Markdown.md`, sidebar entry, and catalog row.
9. **Full gate:** `npm run typecheck && npm test && npm run lint && npm run docs:build`.
10. **Manual smoke** in the demo app (see Verification) for live styling/flow.

---

## Files to Create / Modify / Delete

| Action | File |
|--------|------|
| Create | `src/typescript/lib/component/display/Markdown.ts` |
| Create | `tests/component/display/Markdown.test.ts` |
| Create | `docs/components/Markdown.md` |
| Modify | `src/typescript/lib/component/display/index.ts` (barrel export) |
| Modify | `vite.lib.config.ts` (mark `marked` external) |
| Modify | `package.json` (add `marked` to `dependencies`) |
| Modify | `package-lock.json` (from `npm install`) |
| Modify | `docs/.vitepress/config.mts` (Display sidebar entry) |
| Modify | `docs/components/index.md` (catalog row under Display) |

---

## Expected Behaviour

All of these are **unit-testable offline** against the modelled DOM (assert on
the `RecordingDOMSink.writes` log — `createElement` tags in order, `appendChild`
parent/child nesting, and `apply` `{ text }` / `{ addClass }` / `{ setAttr }`
payloads), unless marked otherwise.

- **Headings** — `# H1` … `###### H6` build `<h1>`…`<h6>` respectively, with the
  heading text as a text node.
- **Paragraph** — `hello world` builds a `<p>` whose text content is `hello world`.
- **Bold / italic** — `**b**` builds `<strong>`; `*i*` builds `<em>`; the emphasis
  text sits inside the emphasis element, not the paragraph directly.
- **Inline code** — `` `x` `` builds a `<code>` with text `x`.
- **Fenced code block** — a ```` ```lang\ncode\n``` ```` block builds `<pre>` ›
  `<code>` with the literal code as text (language class optional but the code
  text is preserved verbatim, including newlines).
- **Links** — `[t](https://e.com)` builds `<a>` with `href="https://e.com"`,
  `target="_blank"`, `rel="noopener noreferrer"`, and inner text `t`.
- **Unordered list** — `- a\n- b` builds `<ul>` with two `<li>` children carrying
  `a` and `b`.
- **Ordered list** — `1. a\n2. b` builds `<ol>` with two `<li>` children.
- **Blockquote** — `> quote` builds `<blockquote>` containing the quoted content.
- **Nested inline in a heading/quote** — `## **bold** head` nests `<strong>`
  inside the `<h2>`.
- **Unknown/excluded token → fallback** — a Markdown table (or an image
  `![a](x)`) does **not** crash; it renders its text/raw content as a plain text
  node and no `<table>`/`<img>` element is created (assert no `createElement`
  with those tags).
- **Empty / whitespace source** — `""` or `"   "` renders a root with no prose
  children (empty `_contentHandles`).
- **`getMarkdown()`** returns the constructor/`setMarkdown` value, `""` when unset.
- **`setMarkdown` rebuild** — constructing with `# A`, then `setMarkdown("# B")`
  after the element exists, removes the old nodes and rebuilds; the final tree
  reflects only `# B` (assert `removeElement` writes precede the second build).
- **Options-bag construction** — `new Markdown(undefined, { markdown: "# A" })`
  and `new Markdown("# A")` produce the same tree; `callable` form
  `Markdown("# A")` works too.
- **No HTML-string path** — covered by the grep invariant, not a runtime test.

**Manual-verify only** (not offline-testable — needs a live browser):

- Live styling: `code`/`pre` monospace + background, `blockquote` left border,
  list indentation, heading sizes, link colour from the theme token.
- Prose flow/wrapping and height when placed in a width-assigning container;
  theme light/dark colour swap.

---

## Verification

- **Typecheck:** `npm run typecheck` (lib) and `npm run typecheck:test`.
- **Unit tests:** `npm test` runs `tests/component/display/Markdown.test.ts`.
  Harness: `installTestDOM(CONFIG)` in `beforeEach`, `DOM.reset()` in `afterEach`
  (the pattern in [Glyph.test.ts](tests/component/display/Glyph.test.ts#L21) and
  [Image.test.ts](tests/component/display/Image.test.ts)); assert against the
  returned `RecordingDOMSink.writes` array. `CONFIG` can reuse the display-test
  shape (rootMountOffset/viewport/scrollBarWidth/fontMetrics/themeVars); font
  metrics are irrelevant here because v1 does no text measurement.
- **Grep invariants:**
  `grep -nE "innerHTML|insertAdjacentHTML|outerHTML" src/typescript/lib/component/display/Markdown.ts`
  → zero; `grep -n "marked" src/typescript/lib/component/display/Markdown.ts`
  → only the `lexer` import and its call.
- **Lint:** `npm run lint` (the `local/no-raw-dom` rule confirms every DOM touch
  goes through the seam).
- **Docs build:** `npm run docs:build` must finish with **zero** warnings
  (public JSDoc may only `{@link}` other public symbols — CODE_CONVENTIONS.md).
- **Manual smoke:** add a `Markdown` instance to a demo panel under
  `src/typescript/` (e.g. alongside the display demos), run `npm run dev`
  (http://localhost:8015), and confirm headings/lists/code/links/blockquote
  render and flow correctly in both themes.

---

## Documentation Impact

`Markdown` is a new public exported symbol, so:

- **Barrel/entry:** exported from
  [component/display/index.ts](src/typescript/lib/component/display/index.ts),
  which is already a TypeDoc entry point ([typedoc.json](typedoc.json)) and a
  `package.json` `exports` subpath (`./component/display`). The API reference page
  `docs/api/component/display/classes/Markdown.md` (plus the `MarkdownOptions`
  interface page) is **generated** by `npm run docs:api` — do not hand-write it.
- **Guide page:** create `docs/components/Markdown.md` following the
  [IconText.md](docs/components/IconText.md) template (intro linking the generated
  API page, Usage, Construction options table, Common methods, See also). Document
  the v1 scope, the fallback behaviour, and the sizing deferral.
- **Sidebar:** add `{ text: 'Markdown', link: '/components/Markdown' }` to the
  **Display** group in [docs/.vitepress/config.mts](docs/.vitepress/config.mts#L104)
  (near `IconText`/`IconLabel`).
- **Catalog:** add a `Markdown` row to the **Display** section of
  [docs/components/index.md](docs/components/index.md).
- **JSDoc:** class + option + method JSDoc with an `@example`, `@category Components`
  (matching Glyph/IconText). Any `{@link}` must point at public symbols only.

---

## Potential Challenges

- **`marked` API surface across majors** — the `lexer` named export and `Tokens`
  types are stable in v5+, but the implementer must confirm against the installed
  version; pin the major in `dependencies`.
- **Token type unions** — marked's `Token` is a large discriminated union;
  narrow via `token.type` in the switch and lean on the fallback branch so an
  unhandled variant is a text node, not a type error or crash.
- **List item content shape** — `list.items[i].tokens` may hold block or inline
  tokens depending on `loose`/`task`; route list-item children through a helper
  that tries block first and falls back to inline so both loose and tight lists
  render.
- **Rebuild leak** — `setMarkdown` must `untrackHandle` every removed node, or
  `_ownedHandles` accumulates stale entries across edits (the reason
  `untrackHandle` exists — see its
  [doc](src/typescript/lib/core/Component.ts#L660)).
- **External dep resolution downstream** — if a consumer app forgets to install
  `marked`, the externalised import fails at their build; documenting it as a
  `dependencies` entry (not `peerDependencies`) makes npm install it transitively.

---

## Critical Files

- [src/typescript/lib/component/display/Glyph.ts](src/typescript/lib/component/display/Glyph.ts)
  — canonical sink-built subtree in `createRootElement`/`render`, `trackHandle`
  usage, `callable()` dual export, module-level `ensure…()` class/keyframe rules.
- [src/typescript/lib/component/input/Text.ts](src/typescript/lib/component/input/Text.ts)
  — text storage in `_options`, `setText`/`getText`, `applyOptions` cascade,
  `render()` writing text through the sink.
- [src/typescript/lib/core/Component.ts](src/typescript/lib/core/Component.ts)
  — `render()`/`getElement` (L747), `trackHandle`/`untrackHandle` (L643/L660),
  `applyOptions` merge, setter-defer conventions.
- [src/typescript/lib/core/DOM.ts](src/typescript/lib/core/DOM.ts) — the sink API
  (`createElement`, `apply` with `text`/`addClass`/`setAttr`, `appendChild`,
  `removeElement`) and `DOMSource.isModelled`.
- [src/typescript/lib/component/display/IconText.ts](src/typescript/lib/component/display/IconText.ts)
  — deferred child-build-from-`_options` pattern in the constructor body.
- [tests/dom/TestDOM.ts](tests/dom/TestDOM.ts) — `installTestDOM`,
  `RecordingDOMSink.writes`, `ModelledDOMSource`; the offline harness the tests
  assert against.
- [src/typescript/lib/component/display/index.ts](src/typescript/lib/component/display/index.ts),
  [vite.lib.config.ts](vite.lib.config.ts), [package.json](package.json),
  [tsconfig.json](tsconfig.json) — export surface and dependency/bundler wiring.

---

## Non-Goals

- **Tables** — no `<table>` rendering in v1; a table token hits the fallback.
- **Images** — no `<img>`; an image token renders its alt/raw text via the fallback.
- **Raw HTML passthrough** — HTML tokens are never injected as markup; they render
  as escaped text through the sink (no `innerHTML`, ever).
- **Prose auto-sizing** — no width-dependent flowed-height measurement; the
  component relies on the parent layout for width and a scroll host for overflow.
- **Custom event surface** — no `on()`/`listeners` bag; links use native `<a>`
  navigation. (Interactive link handling can be added later by widening the class.)
- **Syntax highlighting** — fenced code renders as plain text in `<pre><code>`;
  no tokenised/highlighted code.
- **GFM extensions** (task lists, strikethrough, autolinks beyond `link` tokens)
  — deferred; they degrade to the fallback until explicitly added to the switch.

---

## Implementation Notes (drift from plan)

Recorded during implementation; none changed the plan's core API or seam design:

- **Installed `marked` major is 18** (`^18.0.5`), not v5 — v18 exports the named
  `lexer` function and the `Tokens` namespace / `Token` type exactly as the plan
  assumed, so the "v5+" assertion holds.
- **Theme tokens.** The plan's illustrative `var(--ts-ui-foreground, …)` /
  `var(--ts-ui-accent, …)` tokens do not exist in the theme. The real tokens the
  rules use are `--ts-ui-font-mono` (code/pre font family), `--ts-ui-border-radius`
  (code/pre corners), `--ts-ui-border-color` (the blockquote bar), and the
  framework's single accent `--ts-ui-indicator-focus` (shared with focus/selection)
  for link colour — each with a light/dark-safe fallback. Code/pre backgrounds use
  a hardcoded translucent grey wash (no dedicated surface token exists), and no
  rule sets a `color`/`background` from `--ts-ui-text-color`/`--ts-ui-body-bg`.
- **Interleaved text runs are wrapped in a `<span>`.** The DOM sink has no
  raw-text-node primitive (only `apply({ text })`, which sets `textContent`), so
  a text run that is a *sibling* of an inline element cannot be a bare text node.
  A lone text child still writes straight onto its parent; only mixed inline
  content (and the unsupported-token fallback) wraps each text run in a `<span>`.
- **`clearContent` also releases handles.** Beyond the plan's `removeElement` +
  `untrackHandle`, each removed node's handle is `DOM.sink.release`d, matching the
  framework's established teardown (`Component.disposeFrame`) so the handle
  registry does not leak across `setMarkdown` rebuilds.
- **Demo host.** A dedicated `MarkdownPanel` demo tab was added (append-only
  `main.ts` edit) rather than editing a contended existing panel.
