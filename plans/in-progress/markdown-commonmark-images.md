---
depends-on:
  - markdown-viewer-link-reference-definitions
  - markdown-editor-reference-links
  - markdown-editor-source-preservation
touches-shared:
  - packages/lib/src/typescript/lib/component/display/markdownExtensions.ts
  - packages/lib/src/typescript/lib/component/display/Markdown.ts
  - packages/lib/src/typescript/lib/component/editor/markdownImporter.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts
  - packages/lib/src/typescript/lib/component/editor/markdownWritable.ts
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/tests/component/markdown-editor.test.ts
  - packages/lib/tests/component/markdown-importer.test.ts
  - packages/lib/tests/component/markdown-reference-links.test.ts
  - packages/lib/tests/component/markdown-source-mode-through-model.test.ts
  - packages/lib/tests/component/markdown-roundtrip/viewModel.ts
  - packages/lib/tests/component/markdown-roundtrip/corpus/index.ts
  - packages/lib/docs/components/Markdown.md
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/docs/reference/migration/next.md
---

# Markdown CommonMark Images — Implementation Plan

## Overview

The `Markdown` viewer reads an image only in the exact shape `![alt](src)`, with
no brackets in the alt text and no space or parenthesis in the source. The
dialect's own image rule, `IMAGE_EXTENSION` in
[`markdownExtensions.ts:25`](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L25),
takes every image first. Any other CommonMark image form falls through to
`marked`'s own `image` token, which the viewer has no case for, so it renders the
alt text as plain text. On the CommonMark 0.31.2 spec this is 18 of the 19
examples where the viewer disagrees with the reference reading (633 of 652
agree):

| Form | Example | Shown today |
|---|---|---|
| image with a title | `![foo](/url "title")` (spec 572, 579) | the text `foo` |
| reference image: full, collapsed, shortcut, labels matched case-insensitively | `![foo][bar]`, `![foo][]`, `![foo]` with `[bar]: /url` (spec 573, 576, 577, 582–591) | the text `foo` |
| angle-bracket destination | `![foo](<url>)` (spec 580) | an image whose `src` is `<url>`, brackets kept |
| images or links in the alt text | `![foo ![bar](/url)](/url2)` (spec 574, 575, 520) | the text `foo ![bar](/url)` |

This plan makes the viewer read every one of these as CommonMark does, keeping
the dialect's `{width=… height=…}` group and the scheme allow-list. The
`MarkdownEditor` reads the same forms (the user's viewer/editor parity rule),
holds an image's title, keeps the form an image was written in while it still
reads as that image, and writes a new or changed image in one standard form. The
round-trip harness, the fuzz tests, a new CommonMark conformance test, the docs,
the changelog and a migration note follow. The measured target is 651 of 652
spec examples; the one left (spec 606) is an artefact of the reference side's
GFM email autolink.

The approach was built as a throwaway prototype on this chain's tip before
writing the plan. Its diff and the scratch files it used are kept under
`/home/jika/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans6/commonmark-images/`
(see [Addendum: Prototype results](#addendum-prototype-results)). The steps below
are complete without it.[^prototype]

---

## Architecture Decisions

Markdown in this section's tables is shown as it stands in a file; `\n` marks a
line feed inside a one-line example.

### Every image form is read by `marked`'s own link tokenizers

**Decision.** `IMAGE_EXTENSION` is removed. Two tokenizer overrides,
`DIALECT_IMAGE_TOKENIZERS`, are installed in `marked`'s `link` and `reflink`
slots. Each runs `marked`'s own method and, when the token it returns is an
image, turns it into the dialect's `mdimage` token with any `{…}` group that
follows. This mirrors the wrappers the file already installs in `marked`'s
slots: `fencesReadingReferences`
([:582](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L582))
running `marked`'s method and then reading more, and `dialectTable`
([:408](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L408))
returning the dialect's own token type from a `marked` slot.[^slot-not-extension]

| Source | Before | After |
|---|---|---|
| `![foo](/url "title")` | `marked` `image` token, shown as text | `mdimage`, `src: '/url'`, `title: 'title'` |
| `![foo][bar]` + `[bar]: /url` | `marked` `image` token, shown as text | `mdimage`, `src: '/url'` |
| `![foo](<url>)` | `mdimage`, `src: '<url>'` | `mdimage`, `src: 'url'` |
| `![d](/img/d.png){width=320}` | `mdimage` | `mdimage` (unchanged) |

**Consequences.** An image is read exactly where `marked` reads one, with
balanced parentheses in a destination (`/i(1).png`), escapes and character
references read in the destination, title and alt, and labels resolved through
the document's definitions after the block pass. A few strings the old rule
took as images and CommonMark does not are now text, such as `![a](<b)` (an
unclosed `<`). The existing link
reading is unchanged: the `link` slot's character-reference reading moves into
`linkReadingReferences` and the `link` override calls it.

### The `mdimage` token stays a leaf, with new fields

**Decision.** Every image arrives as one `mdimage` token with **no `tokens`
field**. It gains `title`, `imageRaw` (the image as written, without its
attribute group) and `attributeText` (the group's text between its braces), and
is typed by a new exported `MdImageToken`.[^leaf-token]

| | Fields of `![a](/i.png "t"){width=3}`'s token |
|---|---|
| Before | none: it was `marked`'s `image` token (`href`, `title`, `text`, `tokens`) |
| After | `type: 'mdimage'`, `raw: '![a](/i.png "t"){width=3}'`, `imageRaw: '![a](/i.png "t")'`, `alt: 'a'`, `src: '/i.png'`, `title: 't'`, `attributes: { width: '3' }`, `attributeText: 'width=3'` — and no `tokens` |

**Consequence.** Every walker that treats an image as one atom keeps doing so:
the viewer's renderer, the importer's run builders (`shownText`,
`holdsOwnLeaf`, `keptPieces`), the serializer's readings and source mode's
token analysis.

### An image's alt text is the plain text of its description

**Decision.** `alt` is the text of every token in the description without its
markup, as CommonMark specifies: emphasis, links and spans give their text, a
nested image gives its own alt text, a code span its code, a hard line break a
line feed (`imageAltText`).[^alt-plain]

| Source | `alt` before | `alt` after |
|---|---|---|
| `![foo *bar*][]` | (text `foo *bar*` shown) | `foo bar` |
| `![foo ![bar](/url)](/url2)` | (text shown) | `foo bar` |
| `![[[foo](uri1)](uri2)](uri3)` | (text shown) | `[foo](uri2)` |
| `![a &copy; \_b](/i.png)` | `a &copy; \_b` | `a © _b` |

**Consequence.** An `![alt](src)` image that was already an `<img>` can get a
different `alt` attribute when its alt text holds escapes, character references
or emphasis.

### The size group attaches after every image form

**Decision.** A `{…}` group written directly after an image, in any of its
forms, is that image's attribute group. A shortcut label that names no
definition is no image, so its brackets stay a styled span, as today.[^group-attach]

| Source | Reads as |
|---|---|
| `![a](/i.png "t"){width=10}` | image, width 10, title `t` |
| `![a][r]{width=10}` + `[r]: /i.png` | image, width 10 |
| `![a][]{height=5}` + `[a]: /i.png` | image, height 5 |
| `![a]{width=10}` + `[a]: /i.png` | image, width 10 |
| `![a]{width=10}`, no definition of `a` | the text `!` and a styled span `a` (unchanged) |

**Consequence.** No new syntax: the group's grammar is the existing
`parseAttributes`, read from the same place relative to the image's end.

### The title becomes the `<img>`'s `title` attribute

**Decision.** The viewer writes a non-empty title as the `title` attribute of
the `<img>`, through the same `DOM.sink.apply(img, { setAttr })` call that
writes `src` and `alt`. The editor's `MarkdownImageNode.createDOM` writes it
the same way, so both surfaces show the same tooltip.[^title-attr]

| Source | Viewer before | Viewer after |
|---|---|---|
| `![foo](/url "title")` | the text `foo` | `<img src="/url" alt="foo" title="title">` |
| `![foo](/url)` | `<img src="/url" alt="foo">` | unchanged — no `title` attribute |

**Consequence.** Link titles are untouched: the viewer still writes no `title`
on an `<a>` (a non-goal, as before).

### The scheme allow-list runs on the source as read

**Decision.** `resolveImageSpec` is unchanged and receives the destination
after `marked` has dropped its `<…>` brackets and the dialect has read its
escapes and character references, or the definition's destination for a
reference image.[^allow-list-read]

| Source | Before | After |
|---|---|---|
| `![a](<javascript:alert(1)>)` | nothing (src `<javascript:alert(1)>` refused) | nothing (src `javascript:alert(1)` refused) |
| `![a][r]` + `[r]: javascript:alert(1)` | the text `a` | nothing |
| `![a](javascript&#58;alert(1))` | the text `a` | nothing (src reads `javascript:alert(1)`) |
| `![a](data:image/png;base64,AAAA)` | `<img>` | `<img>` (unchanged) |

### A heading's plain text reads an image as its alt text

**Decision.** The viewer's `inlineText`
([Markdown.ts:2330](packages/lib/src/typescript/lib/component/display/Markdown.ts#L2330)),
which gives `extractMarkdownHeadings` its `text`, gains an `mdimage` case
returning the image's `alt`.[^heading-text]

| Heading | `text` before | `text` after |
|---|---|---|
| `# ![a](/i.png "t") x` | `a x` (from `marked`'s token) | `a x` |
| `# ![a](/i.png) x` | `![a](/i.png) x` | `a x` |

**Consequence.** Heading ids are made from the heading's source, not this text,
so no id changes.

### The editor's image node holds a title

**Decision.** `MarkdownImageNode` gains a `__title: string | null` field beside
`src`, `alt`, `width` and `height`, with `getTitle()` and `setTitle()`, its JSON
form and its DOM `title` attribute. An empty title is stored as `null`, as
`marked` reads an empty title as none.[^title-field]

**Consequence.** A loaded image shows and saves its title. Serialized nodes
written before this change have no `title` key and load with `null`.

### An image keeps the form it was written in while that form still reads as it

**Decision.** The importer stores each loaded image's `imageRaw` in a new node
state, `imageWrittenState`. A save writes that text (plus the attribute group,
as today) while it still reads as this image: lexed alone under the save's
definitions, it is one `mdimage` token whose `src`, `alt` and `title` equal the
node's. Otherwise the image is written in the standard form. This is the
"written while it still resolves" rule of `imageAttributesState`
([markdownNodeState.ts:62](packages/lib/src/typescript/lib/component/editor/markdownNodeState.ts#L62))
and its siblings, and it gives an image the reference-link rule: a save never
changes where it points.[^written-state]

| Loaded | Then | Saved once its block is edited |
|---|---|---|
| `![foo](/url "title")` | nothing | `![foo](/url "title")` |
| `![a](/i.png 't')` | nothing | `![a](/i.png 't')` |
| `![foo](<url>)` | nothing | `![foo](<url>)` |
| `![foo *bar*][]` + definition | nothing | `![foo *bar*][]` |
| `![foo][bar]` + `[bar]: /url` | definition removed | `![foo](/url)` |
| `![foo][bar]` + `[bar]: /url` | definition changed to `/other` | `![foo](/url)` |
| `![foo][bar]` + `[bar]: /url` | changed to `/other`, then back to `/url` | `![foo][bar]` |
| an image made by `insertImage` or an HTML paste | — | the standard form |

**Consequences.** A loaded image never needs the definition rule
(`registerDefinitionRules`, which shows a block anew when a changed definition
changes how it reads) to rebuild its block: like a `ReferenceLinkNode` it keeps
its own source and title. Four
existing tests that expected a reference image whose definition went away to
show as text now expect an inline image (step 22). The written form is lexed on
each save; a bounded cache keeps that cost off forms that cannot name a
definition.

### A new or changed image is written in one standard form

**Decision.** The standard form is `![alt](destination "title"){attributes}`:

- the alt text is written as link text is: through text pieces the line
  renderer escapes, with `protectLabelBrackets` over them, between a `![` and a
  `]` written as syntax pieces; a line feed in it is written `&#10;`, so the
  image stays on one line in every block;
- the destination and title go through the link writer's own code, extracted
  from `writeLinkDestination` as `writeDestination(url, title, context)`;
- the attribute group is `imageAttributeText`, unchanged.[^standard-form]

| Image | Written |
|---|---|
| source `/i.png`, alt `a [b] *c*`, title `T "q"` | `![a \\[b\\] \*c\*](/i.png "T \"q\"")` |
| source `/a b.png`, alt `x` | `![x](</a b.png>)` |
| source `/i.png`, alt `a\` (ending in a backslash), width 3 | `![a\\](/i.png){width=3}` |
| source `/i.png`, alt `a`, an empty title | `![a](/i.png)` |
| source `/i.png`, alt `a`, a line feed, `b` | `![a&#10;b](/i.png)` |

**Consequence.** Every alt text can be written. `insertImage` no longer refuses
an alt holding a bracket (see below).

### A shortcut reference image is written collapsed where the next character would join it

**Decision.** A written form that is a shortcut reference (`![foo]`) and has no
attribute group is pushed as the serializer's existing `reference` piece with
`shortcut: true`. `renderLine` then writes it `![foo][]` where `joinsShortcut`
says a following `(`, `{` or `[` would join it to another construct, exactly as
for a shortcut reference link.[^shortcut-collapse]

| Block | Saved |
|---|---|
| `![foo]` then a link `[x](/u)` | `![foo][][x](/u)` |
| `![foo]` then the text `(x) {y}` | `![foo][](x) {y}` |
| `![foo]{width=3}` then `(x)` | `![foo]{width=3}(x)` |

### A title ending in a backslash is written with a character reference

**Decision.** `writeDestination` writes the last backslash of a title that ends
in one as `&#92;`. This is shared with links.[^title-backslash]

| Title | Before | After |
|---|---|---|
| `x\` | `"x\\"` — `marked` reads the closing quote as escaped and loses the link or image | `"x&#92;"` — reads `x\` |
| `a\b` | `"a\\b"` | `"a\\b"` (unchanged) |

### Definitions see reference images

**Decision.** The editor's checks of "does this hold a reference?" learn about
images:

- `$referenceIn` and `$needsDefinitions` in the serializer count an image whose
  written form can name a definition: one that ends in `]` (a reference form)
  or holds a `[` after its `![` (its alt text may hold a reference)
  (`$imageNamesLabel`);
- `$showBlocksAsDefinitionsRead` in `markdownWritable.ts` runs
  `$adoptDefinitionTitles` and `$showRunsAsSaved` on a block holding such an
  image, as it does for a block holding a reference link;
- `$adoptDefinitionTitles` gives an image whose title holds a blank line the
  title its written form now reads with, when that form still reads as the
  image's `src` and `alt` — the reference-link rule for such titles;
- `$namesLabel` also reads the source of an image that is a run of a construct
  kept as written — a loaded construct saved byte for byte because its
  standard form would read differently (`keptSourceState`) — so that
  construct's block is shown anew when a definition it names changes.

`shownReading` stops hiding where an image points: the viewer now shows it.[^definition-rule]

| Document | Edit | Result |
|---|---|---|
| `~~5 [![a][r]]()~~ w` + `[r]: /g` | definition retyped `[r]: /h` | block shown anew; image `src` `/h`; save unchanged except the definition |
| `![foo][]` + `[foo]: /url "\n\ntitle"` | definition retyped `[foo]: /url "\n\ntitle2"` | save `![foo][]` + new definition; image title `\n\ntitle2` |

### `insertImage` takes a title and any alt text

**Decision.** `insertImage(src, options?)` gains `options.title`. The guard that
made the command a no-op for an alt text holding `[` or `]` is removed, since
the standard form writes any alt text.[^insert-brackets]

| Call | Before | After (the saved Markdown) |
|---|---|---|
| `insertImage('/i.png', { alt: 'a', title: 'T' })` | `title` not accepted | `![a](/i.png "T")` |
| `insertImage('/i.png', { alt: 'a[b]' })` | does nothing | `![a\\[b\\]](/i.png)` |

### HTML: an `<img>` pasted in is an image; a copied image carries its title

**Decision.** `MarkdownImageNode.importDOM` reads an `<img>`'s `src`, `alt`,
`title`, `width` and `height` attributes through `DOM.source`, validated by
`resolveImageSpec`; a refused source makes no node. This mirrors
`MarkdownHorizontalRuleNode.importDOM`
([markdownHorizontalRuleNode.ts:54](packages/lib/src/typescript/lib/component/editor/markdownHorizontalRuleNode.ts#L54))
and the attribute reads of `MarkdownTaskCheckboxNode.importDOM`
([markdownTaskCheckboxNode.ts:75](packages/lib/src/typescript/lib/component/editor/markdownTaskCheckboxNode.ts#L75)).
A copy leaves through Lexical's default export, which calls `createDOM`, so it
carries the new `title` attribute with no export code of its own.[^html-paste]

| Clipboard HTML | Before | After |
|---|---|---|
| `<p>a<img src="/i.png" alt="d" title="t" width="10">b</p>` | `ab` (image dropped) | `a![d](/i.png "t"){width=10}b` |
| `<img src="javascript:alert(1)">` | dropped | dropped |

### Source mode needs no change of its own

**Decision.** `markdownSourceModel.ts`, `markdownSourcePlaces.ts` and
`markdownSourceTokens.ts` are unchanged: they read images through the same
`mdimage` token, whose `raw` now covers every form. `IMAGE_TYPES` in
`markdownSourceEdits.ts`
([:58](packages/lib/src/typescript/lib/component/editor/markdownSourceEdits.ts#L58))
drops `"image"`, which no token carries any more.[^source-mode]

| | `IMAGE_TYPES` |
|---|---|
| Before | `new Set(["mdimage", "image"])` |
| After | `new Set(["mdimage"])` |

**Consequence.** A caret in a reference image's label or in a title stands
inside the image's atom, as a caret in a plain image's alt text does today.

### The conformance check carries the spec examples inline

**Decision.** A new committed test runs the CommonMark 0.31.2 examples of the
sections Link reference definitions, Links and Images (139 examples) through
the viewer's harness projection and compares each with the blocks the
CommonMark reference reading gives it. The examples and their expected blocks
are inlined in a data file, generated from the reference reading and already
written at
`scratch-keep/plans6/commonmark-images/commonmarkConformance.ts`. The library
takes no `commonmark-spec` dependency.[^conformance-inline]

| | Committed check of the spec |
|---|---|
| Before | the round-trip corpus holds 175 spec examples, each checked editor against viewer, none against the CommonMark reading |
| After | also 139 examples checked against the CommonMark reading, one test each, named `CommonMark 572 (Images)` and so on |

**Consequence.** A change that breaks the viewer's reading of a link, a
definition or an image fails a test named after the spec example.

### The new corpus cases come last

**Decision.** The image cases that join the round-trip corpus go into a new
`corpus/images.ts`, listed last in `CORPUS`. The source-mode differential test
lists them after all of its other documents.[^corpus-last]

| | The differential's document list |
|---|---|
| Before | `[...CORPUS, ...HAND_WRITTEN, ...EDGE_DOCUMENTS]` |
| After | `[...CORPUS without IMAGE_CASES, ...HAND_WRITTEN, ...EDGE_DOCUMENTS, ...IMAGE_CASES]` |

**Consequence.** Every document the differential checks today keeps the
commands it is checked with; the image cases get commands of their own.

### The harness projection carries an image's title

**Decision.** The harness model's image run gains `title: string | null`,
between `alt` and `width`, on the viewer side (`token.title`) and on the editor
side (`node.getTitle()`).[^harness-title]

| | Image run |
|---|---|
| Before | `{ kind: 'image', src, alt, width, height, link }` |
| After | `{ kind: 'image', src, alt, title, width, height, link }` |

**Consequence.** The parity, surface and canonical checks catch a lost or
changed title.

---

## Public API

```typescript
// component/editor/MarkdownEditor.ts — the one public change
insertImage(src: string, options?: { alt?: string; title?: string; width?: number; height?: number }): this;
```

Internal (no barrel export changes):

```typescript
// component/display/markdownExtensions.ts
export interface MdImageToken {
    type:          "mdimage";
    raw:           string;                  // the image and its attribute group, as written
    imageRaw:      string;                  // the image as written, without its attribute group
    alt:           string;                  // the description's plain text
    src:           string;                  // the destination as read: escapes and references read, `<…>` dropped
    title:         string | null;           // the title as read; null when none or empty
    attributes:    Record<string, string>;  // the attribute group, parsed
    attributeText: string;                  // the group's text between its braces; "" when there is none
}
export function lexMarkdownInline(source: string, definitions?: Links): Token[];   // gains `definitions`

// component/editor/markdownImageNode.ts
export type SerializedMarkdownImageNode = Spread<
    { src: string; alt: string; width: number | null; height: number | null; title?: string | null },
    SerializedLexicalNode
>;
export class MarkdownImageNode extends DecoratorNode<null> {
    __title: string | null;
    constructor(spec: MarkdownImageSpec, title?: string | null, key?: NodeKey);   // title defaults to null
    static importDOM(): DOMConversionMap | null;
    getTitle(): string | null;
    setTitle(title: string | null): this;   // "" stored as null
}
export function $createMarkdownImageNode(spec: MarkdownImageSpec, title?: string | null): MarkdownImageNode;

// component/editor/markdownNodeState.ts
export const imageWrittenState: StateConfig<"mdImageWritten", string>;   // "" = an image made in the editor

// component/editor/markdownSerializer.ts
export function readImageForm(written: string, definitions: Links | null): MdImageToken | null;
export function $imageNamesLabel(node: LexicalNode): boolean;
```

`MarkdownImageSpec` and `resolveImageSpec` are unchanged: the title is no part
of the validated spec.

---

## Implementation

### `markdownExtensions.ts`

Delete `IMAGE_EXTENSION` (lines 20–46); add `MdImageToken` (see `## Public API`,
documented field by field) after `MdBlockToken` (line 18); add the following
after `readEscapesAndReferences` (line 571), and move the body of
`CHARACTER_REFERENCE_TOKENIZERS.link` (lines 622–634) into
`linkReadingReferences`:

```typescript
/**
 * Runs `marked`'s link tokenizer and reads the character references and
 * backslash escapes of the destination and title, as CommonMark reads them.
 * {@link DIALECT_IMAGE_TOKENIZERS} wraps it in the `link` slot.
 */
function linkReadingReferences(this: Tokenizer, src: string): Tokens.Link | Tokens.Image | undefined {
    const token = Tokenizer.prototype.link.call(keepingEscapes(this), src);

    if (token !== undefined) {
        token.href = readEscapesAndReferences(token.href);

        if (token.title) {
            token.title = readEscapesAndReferences(token.title);
        }
    }

    return token;
}

/** An image's attribute group, read directly after the image: its text between the braces. */
const IMAGE_ATTRIBUTE_GROUP = /^\{([^{}]*)\}/;

function imageAltText(tokens: readonly Token[]): string {
    return tokens.map((token) => {
        const generic = token as Tokens.Generic;

        if (token.type === "mdimage") {
            return generic.alt as string;
        }

        if (token.type === "br") {
            return "\n";
        }

        const children = generic.tokens as Token[] | undefined;

        if (children !== undefined && children.length > 0) {
            return imageAltText(children);
        }

        return (generic.text as string | undefined) ?? token.raw;
    }).join("");
}

function dialectImage(image: Tokens.Image, src: string): MdImageToken {
    const group = IMAGE_ATTRIBUTE_GROUP.exec(src.slice(image.raw.length));

    return {
        type:          "mdimage",
        raw:           image.raw + (group?.[0] ?? ""),
        imageRaw:      image.raw,
        alt:           imageAltText(image.tokens),
        src:           image.href,
        title:         image.title ?? null,
        attributes:    parseAttributes(group?.[1] ?? ""),
        attributeText: group?.[1] ?? "",
    };
}

const DIALECT_IMAGE_TOKENIZERS: TokenizerObject = {
    link(src) {
        const token = linkReadingReferences.call(this, src);

        return token?.type === "image" ? dialectImage(token, src) as unknown as Tokens.Image : token;
    },
    reflink(src, links) {
        const token = Tokenizer.prototype.reflink.call(this, src, links);

        return token?.type === "image" ? dialectImage(token, src) as unknown as Tokens.Image : token;
    },
};
```

Both `Marked` instances spread it last:
`tokenizer: { ...BOUNDED_BLOCK_TOKENIZERS, ...CHARACTER_REFERENCE_TOKENIZERS, ...DIALECT_IMAGE_TOKENIZERS }`
at line 910, and the same with `DIALECT_BLOCK_TOKENIZERS` in
`lexMarkdownUnbounded` (line 931). `lexMarkdownInline` (line 1014) becomes:

```typescript
export function lexMarkdownInline(source: string, definitions?: Links): Token[] {
    const lexer = new _marked.Lexer(_marked.defaults);

    if (definitions !== undefined) {
        Object.assign(lexer.tokens.links, definitions);
    }

    return lexer.inlineTokens(source);
}
```

(`marked`'s `Lexer.lexInline(source, options)` is exactly `new Lexer(options).inlineTokens(source)`, so a call without
definitions reads as before; the definitions are filed the way `lexMarkdownWithDefinitions` files them.)

### `markdownSerializer.ts`: the image writer

`writeSegment` (line 5426) ends with:

```typescript
    syncMarks(writer, segment.kind === "image" ? imageMarks(writer, inherited, next) : [], "");

    if (segment.kind === "image") {
        writeImage(writer, segment.node);

        return;
    }

    writer.pieces.push(writeBreak(segment.marker, writer.context));
```

`writeImage` (line 6263) is replaced by:

```typescript
function writeImage(writer: InlineWriter, node: MarkdownImageNode): void {
    const attributeText = imageAttributeText(node);
    const attributes = attributeText === "" ? "" : `{${attributeText}}`;
    const written = $getState(node, imageWrittenState);

    if (writtenFormHolds(node, written, writer.context)) {
        const shortcut = attributes === "" && isShortcutImage(written);

        writer.pieces.push(shortcut ? { kind: "reference", text: written, shortcut: true } : { kind: "syntax", text: written + attributes });

        return;
    }

    writer.pieces.push({ kind: "syntax", text: "!" }, { kind: "syntax", text: "[" });

    const altStart = writer.pieces.length;

    node.getAlt().split("\n").forEach((line, index) => {
        if (index > 0) {
            writer.pieces.push({ kind: "syntax", text: "&#10;" });
        }

        if (line !== "") {
            writer.pieces.push({ kind: "text", text: line });
        }
    });
    protectLabelBrackets(writer.pieces, altStart);
    writer.pieces.push({ kind: "syntax", text: `]${writeDestination(node.getSrc(), node.getTitle(), writer.context)}${attributes}` });
}

/** The image forms {@link readImageForm} read that name no definition; cleared when it holds {@link RUNS_ON_CACHE_SIZE} entries. */
const IMAGE_FORMS_READ = new Map<string, MdImageToken | null>();

function imageFormNamesLabel(written: string): boolean {
    return written.endsWith("]") || written.includes(LABEL_OPEN, 2);
}

export function readImageForm(written: string, definitions: Links | null): MdImageToken | null {
    const namesLabel = imageFormNamesLabel(written);
    const known = namesLabel ? undefined : IMAGE_FORMS_READ.get(written);

    if (known !== undefined) {
        return known;
    }

    const tokens = lexMarkdownInline(written, definitions ?? undefined);
    const only = tokens.length === 1 && tokens[0]!.type === "mdimage" && tokens[0]!.raw === written
        ? tokens[0] as unknown as MdImageToken
        : null;

    if (!namesLabel) {
        if (IMAGE_FORMS_READ.size >= RUNS_ON_CACHE_SIZE) {
            IMAGE_FORMS_READ.clear();
        }

        IMAGE_FORMS_READ.set(written, only);
    }

    return only;
}

function writtenFormHolds(node: MarkdownImageNode, written: string, context: InlineContext): boolean {
    const fits = written !== "" && !(context.singleLine && written.includes("\n")) && !(context.inTableCell && written.includes("|"));

    if (!fits) {
        return false;
    }

    const image = readImageForm(written, context.definitions);
    const title = node.getTitle();

    return image !== null && image.src === node.getSrc() && image.alt === node.getAlt()
        && (image.title === title || BLANK_LINE_IN_TITLE.test(title ?? ""));
}

function isShortcutImage(written: string): boolean {
    return written.endsWith("]") && !written.endsWith("[]") && Lexer.rules.inline.gfm.reflink.exec(written)?.[0] !== written;
}

export function $imageNamesLabel(node: LexicalNode): boolean {
    return $isMarkdownImageNode(node) && imageFormNamesLabel($getState(node, imageWrittenState));
}
```

`writeLinkDestination` (line 6152) keeps its signature and JSDoc and becomes
`return writeDestination(link.getURL(), link.getTitle(), context);`. Its old
body moves into `writeDestination(url: string, title: string | null, context: InlineContext): string`,
where the title is written as:

```typescript
    const titleText = escapeCharacterReferences(lines.replace(/[\\"]/g, "\\$&")).replace(/\\\\$/, "&#92;");
    const written = `(${destination}${titled ? ` "${titleText}"` : ""})`;
```

The other serializer edits are one-liners (step 13): `keptImageShown` adds
`node.getTitle()` after `node.getAlt()`; `imageReading(src, alt, title, link)`
joins `["\u0002image", src, alt, title ?? "", link]`, called with the node's
fields in `segmentReading` and with the `MdImageToken`'s fields in
`pushTokenReading`; `$referenceIn` (line 1140) and `$needsDefinitions`
(line 1166) add `|| $imageNamesLabel(node)` to their tests.

### `markdownWritable.ts`

```typescript
// $showBlocksAsDefinitionsRead (line 1649): the reference-link condition
if ($isElementNode(block) && $dfs(block).some(({ node }) => $isReferenceLinkNode(node) || $imageNamesLabel(node))) {

// $adoptDefinitionTitles (line 1681): first in the loop body
if ($isMarkdownImageNode(node) && BLANK_LINE_IN_TITLE.test(node.getTitle() ?? "")) {
    const image = readImageForm($getState(node, imageWrittenState), definitions);

    if (image !== null && image.src === node.getSrc() && image.alt === node.getAlt() && image.title !== node.getTitle()) {
        node.setTitle(image.title);
    }

    continue;
}

// shownReading (line 1707): the replacer keeps only the empty-link case
if (token?.type === "link" && token.tokens?.length === 0) {

// $namesLabel (line 1735): an image run of a kept construct contributes its source
const sources = $dfs(block).map(({ node }) => ($isMarkdownSourceTextNode(node) ? node.getSource()
    : $isMarkdownImageNode(node) ? $getState(node, keptSourceState)?.source ?? "" : "")).join("");
```

### `MarkdownImageNode.importDOM`

```typescript
static importDOM(): DOMConversionMap | null {
    return {
        img: (node) => ({
            conversion: () => {
                const handle = DOM.source.intern(node);
                const attributes: Record<string, string> = {};

                for (const key of ["width", "height"]) {
                    const value = DOM.source.getAttribute(handle, key);

                    if (value !== null) {
                        attributes[key] = value;
                    }
                }

                const spec = resolveImageSpec(DOM.source.getAttribute(handle, "src") ?? "", DOM.source.getAttribute(handle, "alt") ?? "", attributes);

                return { node: spec === null ? null : $createMarkdownImageNode(spec, DOM.source.getAttribute(handle, "title")) };
            },
            priority: 0,
        }),
    };
}
```

---

## Ordered Implementation Steps

Paths are relative to `packages/lib/`. Work test-first: steps 1–5 add tests that
fail, steps 6–18 make them pass, steps 19–22 extend the corpus and the fuzz
tests and update the existing tests the change makes wrong, and steps 23–24
are the docs and the checks. Every new
`describe`/`it` title is plain words; a spec example is named by its number.
Document every new function, field and constant per
[CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) (the snippets above leave some JSDoc
out for length).

1. **`tests/component/markdown-roundtrip/commonmarkConformance.ts`** (new) —
   copy
   `/home/jika/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans6/commonmark-images/commonmarkConformance.ts`
   verbatim (139 rows, `ConformanceRow`, `COMMONMARK_CONFORMANCE`). Check:
   `grep -c "name: \"CommonMark" tests/component/markdown-roundtrip/commonmarkConformance.ts`
   prints `139`.
2. **`tests/component/markdown-roundtrip/markdown-commonmark-conformance.test.ts`**
   (new) — one `describe('the viewer reads the CommonMark link, link reference
   definition and image examples as CommonMark does', …)` with one
   `it(row.name, …)` per row asserting
   `expect(viewerModel(row.markdown).blocks).toEqual(row.blocks)`.
3. **`tests/component/markdown-roundtrip/viewModel.ts`** — the `Run` image
   member (line 37) gains `title: string | null` after `alt`; `viewerImage`
   (line 579) pushes `title: (token.title as string | null) ?? null` after
   `alt`; the editor branch (line 778) pushes `title: node.getTitle()` after
   `alt` (`getTitle` arrives in step 10; vitest does not type-check, so the
   file runs before then).
4. **Viewer and lexer tests** — in `tests/component/display/Markdown.test.ts`,
   extend `describe('Markdown images', …)` (line 1485) with the rows of
   *Viewer* in `## Expected Behaviour`, using the file's `attrWrites()`,
   `createdTags()` and `textWrites()`; and add a heading-text row to
   `describe('extractMarkdownHeadings', …)` (line 261). In
   `tests/component/display/markdownLexer.test.ts`, add
   `describe('every image form arrives as one mdimage token', …)` with the
   *Tokens* rows, each also asserting `lexMarkdown(source)` equals
   `lexMarkdownUnbounded(source)`.
5. **Editor tests** —
   - create `tests/component/markdown-images.test.ts` with the *Editor: forms
     and saves*, *Editor: insertImage* and *Editor: written forms in other
     places* rows. Set it up as `markdown-reference-links.test.ts` does
     (`CONFIG`, `installTestDOM` in `beforeEach`, `DOM.reset()` in `afterEach`,
     `lexicalOf`, `load`, `update`), without its `vi.mock`;
   - in `tests/component/markdown-reference-links.test.ts`, add
     `describe('reference images keep their own source and title when the
     definitions change', …)` at the end of the file with the *Editor:
     definitions* rows, using its `retypeRawBlock`, `expectShownAsSaved` and
     `$rawBlocks`;
   - create `tests/component/markdown-image-node-html.test.ts` with the *HTML*
     rows, copying the setup of `markdown-horizontal-rule-node-html.test.ts`
     (the `// @vitest-environment jsdom` pragma, `ruledEditor()`, no
     `installTestDOM`).

   Run `npx vitest run tests/component/markdown-roundtrip/markdown-commonmark-conformance.test.ts tests/component/display tests/component/markdown-images.test.ts tests/component/markdown-image-node-html.test.ts tests/component/markdown-reference-links.test.ts`
   — expect the new rows to fail.
6. **`src/typescript/lib/component/display/markdownExtensions.ts`** — per
   `### markdownExtensions.ts` above: add `MdImageToken`,
   `linkReadingReferences`, `IMAGE_ATTRIBUTE_GROUP`, `imageAltText`,
   `dialectImage` and `DIALECT_IMAGE_TOKENIZERS`; remove `IMAGE_EXTENSION` and
   its `MARKDOWN_EXTENSIONS` entry; remove `link` from
   `CHARACTER_REFERENCE_TOKENIZERS` and rewrite that object's JSDoc to say it
   holds `inlineText` and `def`, while a link's destination and title are read
   by `linkReadingReferences`, which `DIALECT_IMAGE_TOKENIZERS` wraps in the
   `link` slot (the way it already says this of fences); spread
   `DIALECT_IMAGE_TOKENIZERS` into both instances; give `lexMarkdownInline` its
   `definitions` parameter. Check:
   `grep -n "IMAGE_EXTENSION" src/typescript/lib/component/display/markdownExtensions.ts`
   — expect no match.
7. **`src/typescript/lib/component/display/Markdown.ts`** — in
   `appendInlineToken`'s `case "mdimage"` (line 2146) read the token as
   `const image = token as unknown as MdImageToken;`, and after the `height`
   write add `if (image.title !== null) { setAttr.title = image.title; }`
   (braced, per the conventions). Add
   `case "mdimage":  return (token as unknown as MdImageToken).alt;` to
   `inlineText` (line 2330), before `case "br"`. In the class `@remarks`
   (line 641), replace `and sized images validated against a scheme
   allow-list` with `and images — inline or reference-style, with a title
   and the dialect's size attributes — validated against a scheme
   allow-list`, re-wrapping the paragraph.
8. Run step 5's command for `tests/component/display` and the conformance
   test — green. Run the harness (see `## Verification`) — expect
   `651 / 652`, spec 606 alone different.
9. **`src/typescript/lib/component/editor/markdownNodeState.ts`** — after
   `imageAttributesState` (line 62) add `imageWrittenState`
   (`createState("mdImageWritten", { parse: (value) => (typeof value === "string" ? value : "") })`),
   documented like its neighbour: the Markdown an image was loaded with,
   without its attribute group, written back while it still reads as the
   image; `""` (the default) is an image made in the editor, written in the
   standard form.
10. **`src/typescript/lib/component/editor/markdownImageNode.ts`** — add
    `__title`, the `title` constructor parameter (`""` stored as `null`),
    `getTitle`, `setTitle` (through `getWritable()`, as
    `ReferenceLinkNode.setImportedContent` writes), `clone` passing
    `node.__title`, `importJSON` passing `json.title ?? null`, `exportJSON`
    writing `title`, `createDOM` adding `setAttr.title` when the title is not
    `null`, `importDOM` per `### MarkdownImageNode.importDOM`, and the
    `title` parameter of `$createMarkdownImageNode`. Update the class JSDoc
    (`![alt](src){width=… height=…}` becomes every CommonMark image form, with
    its title).
11. **`src/typescript/lib/component/editor/markdownImporter.ts`** — delete
    `IMAGE_ATTRIBUTES` (lines 277–278). In `$imageNode` (line 3146), create the
    node with `$createMarkdownImageNode(spec, (token.title as string | null) ?? null)`,
    set `imageAttributesState` from `token.attributeText as string` when it is
    not `""`, and always set `imageWrittenState` to `token.imageRaw as string`.
12. **`src/typescript/lib/component/editor/markdownSerializer.ts`** — the image
    writer per `### markdownSerializer.ts: the image writer`: import `Lexer`
    from `marked` and `MdImageToken` from `markdownExtensions.js`, and
    `imageWrittenState`; rewrite `writeSegment`'s end; replace `writeImage`;
    add `IMAGE_FORMS_READ`, `imageFormNamesLabel`, `readImageForm`,
    `writtenFormHolds`, `isShortcutImage` and `$imageNamesLabel`; extract
    `writeDestination` with the `&#92;` title ending.
13. **Same file** — `keptImageShown`, `imageReading` and its two callers,
    `$referenceIn`, `$needsDefinitions`, per the paragraph after the snippets.
    Update the `default:` comment in `pushTokenReading` (line 6485): no
    `marked` image token reaches it any more; it reads any other token as its
    text, else its source. Check:
    `grep -nE "writeImage\(segment\.node, |imageReading\([^,]*, [a-z.]*link\)" src/typescript/lib/component/editor/markdownSerializer.ts`
    — expect no match (no call of the old two-argument forms is left).
14. **`src/typescript/lib/component/editor/markdownWritable.ts`** — the four
    edits per `### markdownWritable.ts`, importing `$imageNamesLabel` and
    `readImageForm` from the serializer and `imageWrittenState` from
    `markdownNodeState.js`. Rewrite the JSDoc of `registerDefinitionRules`
    (line 1520 onwards) and `shownReading` (line 1695 onwards): a reference
    image is no longer a run kept as written that shows its alt text; it keeps
    its own source and title as a reference link keeps its URL, while an image
    inside a construct kept as written is shown anew with that construct.
15. **`src/typescript/lib/component/editor/MarkdownEditor.ts`** — in
    `insertImage` (line 11891): add `title?: string` to `options`, delete the
    `altHoldsBracket` guard and its comment, pass `options?.title ?? null` to
    both `$createMarkdownImageNode` calls, and rewrite the JSDoc: drop "when
    `alt` holds a `[` or `]`, which Markdown's image syntax cannot hold", and
    document `title`.
16. **`src/typescript/lib/component/editor/markdownSourceEdits.ts`** —
    `IMAGE_TYPES` (line 58) becomes `new Set(["mdimage"])`, its comment "The
    inline token type of an image: every form arrives as the dialect's
    `mdimage`."
17. **Comments that describe the old reading** — `markdownSourceNodes.ts`
    line 23 ("an image the viewer does not render as one") becomes "an image
    whose source the viewer refuses". Check:
    `grep -rn "image rule declined\|titled image\|shows its alt text" src/typescript/lib/component`
    — expect no match left.
18. Run `npm run typecheck` from the repo root, then step 5's command — the new
    editor rows pass.
19. **Corpus** — create `tests/component/markdown-roundtrip/corpus/images.ts`
    exporting `IMAGE_CASES` with the 33 cases of *Round-trip corpus* below
    (copy the file's hunk from `prototype.diff` in the scratch folder), and
    list it last in `corpus/index.ts`:
    `...TAB_CASES, ...IMAGE_CASES,`. Its JSDoc says why it is last (the
    source-mode differential picks a document's commands by its place).
20. **`tests/component/markdown-source-mode-through-model.test.ts`** — at
    line 1052, list the image cases after every other document:
    ```typescript
    // The image cases come last, so every other document keeps the place its commands are picked by.
    const documents = [...CORPUS.filter((entry) => !IMAGE_CASES.includes(entry)), ...HAND_WRITTEN, ...EDGE_DOCUMENTS, ...IMAGE_CASES]
        .map((entry, index) => ({ entry, index })).filter(({ index }) => index % DIFFERENTIAL_PARTS === part);
    ```
    importing `IMAGE_CASES` from `./markdown-roundtrip/corpus/images`.
21. **Fuzz and parity tests** —
    - `markdown-roundtrip/markdown-edit-fuzz.test.ts`, `checkNoWordLost`
      (line 307): `labels` also takes the words of every image's
      `imageWrittenState` that ends in `]` (a reference form, whose label an
      inline save drops), as it takes a reference link's label;[^word-loss]
    - `markdown-roundtrip/markdown-escape-fuzz.test.ts`: add a module-level
      `withImages` flag and a list
      `IMAGE_LABEL_ALTS = ['[a]', '[A]', 'x [b] y', '[a][b]', '[][a]', '[a]()', '![a]', '[x](u)', 'p\nq']`;
      in `text()` (line 122), when `withImages` is set, append to each line's
      nodes, with probability 0.7, an image built by a new `image(random)`:
      `src` picked from `['/i.png', '/a b.png', '/p(1).png', 'https://e.com/i.png?a=1&b=2', '/a<b>.png']`;
      `alt` a `line(random)`, prefixed half of the time by a pick of
      `IMAGE_LABEL_ALTS`; width 10 with probability 0.3; and a title of
      `line(random)` with probability 0.5. In `randomDocument`, append the
      definitions raw block when `withEmphasis || withImages` (today:
      `withEmphasis` alone). Add a third run after the two in `runs`
      (line 300), `` `${DOCUMENTS} seeded documents of images whose alt text and title hold Markdown punctuation, with link reference definitions` ``,
      seed `FUZZ_SEED + 2`, that sets `withImages` (and leaves `withEmphasis`
      off) around `checkDocuments`, restoring it in a `finally`;[^fuzz-no-emphasis]
    - `markdown-editor.test.ts` `CORPUS` (line 69): after `'sized image'` add
      `'titled image': '![d](/img/d.png "Diagram"){width=320}'` and
      `'reference image': '![d][img]\n\n[img]: /img/d.png "Diagram"'`;
    - `markdown-source-places.test.ts`: in the table of the test titled
      `SP5: an offset inside the source of one thing the block shows…`, after
      the `{width=10¦}` row, add the five *Source mode* rows below.
22. **Existing tests the change makes wrong** (the full prototype suite failed
    exactly these ten and no other):
    - `markdown-importer.test.ts` line 456, `I19: an image with a title is a
      source node showing its alt text` → retitle `I19: an image with a title
      is an image node holding its title`; expect one `MarkdownImageNode` with
      `getTitle()` `'t'` and `expectSurface(editor, '![a](/u "t")')`;
    - `markdown-importer.test.ts` lines 3444–3460, `an image whose alt text
      holds a bracket (…) is declined…` → `an image whose alt text holds a
      bracket (…) is inserted, its brackets escaped`, expecting an image node
      with that alt and a save that reloads to the same surface; keep the
      control row;
    - `markdown-importer.test.ts` line 4556, `a reference image kept as source,
      a link written right after it, is written so the two stay apart` →
      retitle `a shortcut reference image, a link written right after it, is
      written collapsed so the two stay apart`; its expectations stand;
    - `markdown-reference-links.test.ts` `DEF2` (line 516): retitle `DEF2: a
      reference image whose definition is removed keeps its source, saved
      inline`, expect `'![foo](/url) y'`; `DEF6` (line 569): expect
      `'>\n\n![a](/q) z'`; `DEF9` (line 608): expect
      `'![foo](/url) y and \\[\\]\\[bar\\]\n\n[bar]: /url'` and reword its
      comment — the image keeps its source while the label stops resolving,
      and its block is rebuilt from that save at the first step, so it stays
      inline; `DEF11` (line 633): final expectation
      `'a \\[\\]\\[ref\\] b ![i](https://e.com)'`;
    - `markdown-serializer.test.ts` line 1048 and
      `markdown-roundtrip/markdown-view-model.test.ts` line 326 (`S7`): add
      `title: null` to the expected image run.
23. **Docs, changelog, migration** per `## Documentation Impact`.
24. Run `## Verification`. Write the harness result, the timing check and the
    manual checks into an `## Implementation Notes` section of this plan.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/display/markdownExtensions.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/Markdown.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownNodeState.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownImageNode.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownImporter.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownWritable.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSourceEdits.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSourceNodes.ts` |
| Create | `packages/lib/tests/component/markdown-roundtrip/commonmarkConformance.ts` |
| Create | `packages/lib/tests/component/markdown-roundtrip/markdown-commonmark-conformance.test.ts` |
| Create | `packages/lib/tests/component/markdown-roundtrip/corpus/images.ts` |
| Create | `packages/lib/tests/component/markdown-images.test.ts` |
| Create | `packages/lib/tests/component/markdown-image-node-html.test.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/viewModel.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/index.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/markdown-edit-fuzz.test.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/markdown-escape-fuzz.test.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/markdown-view-model.test.ts` |
| Modify | `packages/lib/tests/component/display/Markdown.test.ts` |
| Modify | `packages/lib/tests/component/display/markdownLexer.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/tests/component/markdown-importer.test.ts` |
| Modify | `packages/lib/tests/component/markdown-reference-links.test.ts` |
| Modify | `packages/lib/tests/component/markdown-serializer.test.ts` |
| Modify | `packages/lib/tests/component/markdown-source-places.test.ts` |
| Modify | `packages/lib/tests/component/markdown-source-mode-through-model.test.ts` |
| Modify | `packages/lib/docs/components/Markdown.md` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/docs/reference/migration/next.md` |

---

## Expected Behaviour

Every case below is unit-testable under the modelled DOM, except *HTML* (jsdom)
and *Manual*. Every editor value was produced by the prototype.

Sources and saved values are written as the TypeScript string literal a test
writes, without its quotes: `\n` is a line feed and `\\` one backslash. Inside
a table, `\|` stands for a pipe.

### Tokens (`markdownLexer.test.ts`)

`lexMarkdown(source)[0].tokens[0]` matches, and `lexMarkdown` equals
`lexMarkdownUnbounded`:

| Source | Token |
|---|---|
| `![foo](/url "title")` | `{ type: 'mdimage', raw: '![foo](/url "title")', imageRaw: '![foo](/url "title")', alt: 'foo', src: '/url', title: 'title', attributeText: '' }` |
| `![a][r]{width=10}\n\n[r]: /i.png` | `{ type: 'mdimage', raw: '![a][r]{width=10}', imageRaw: '![a][r]', src: '/i.png', title: null, attributes: { width: '10' }, attributeText: 'width=10' }` |
| `![foo](<url>)` | `{ src: 'url' }` |
| `![[[foo](uri1)](uri2)](uri3)` | `{ alt: '[foo](uri2)', src: 'uri3' }`, and the token has no `tokens` key |
| `![a]{width=10}` (no definition) | first token `{ type: 'text', raw: '!' }`, second `{ type: 'styledspan' }` |

### Viewer (`Markdown.test.ts`)

`attrWrites()` holds exactly one image write equal to:

| Source | Image write |
|---|---|
| `![foo](/url "title")` (spec 572) | `{ src: '/url', alt: 'foo', title: 'title' }` |
| `My ![foo bar](/path/to/train.jpg  "title"   )` (spec 579) | `{ src: '/path/to/train.jpg', alt: 'foo bar', title: 'title' }` |
| `![foo](<url>)` (spec 580) | `{ src: 'url', alt: 'foo' }` |
| `![foo *bar*][foobar]\n\n[FOOBAR]: train.jpg "train & tracks"` (spec 577) | `{ src: 'train.jpg', alt: 'foo bar', title: 'train & tracks' }` |
| `![Foo][]\n\n[foo]: /url "title"` (spec 586) | `{ src: '/url', alt: 'Foo', title: 'title' }` |
| `![Foo]\n\n[foo]: /url "title"` (spec 591) | `{ src: '/url', alt: 'Foo', title: 'title' }` |
| `![foo ![bar](/url)](/url2)` (spec 574) | `{ src: '/url2', alt: 'foo bar' }`; `createdTags()` holds one `img` |
| `![a](/i.png "t"){width=10}` | `{ src: '/i.png', alt: 'a', width: '10', title: 't' }` |
| `![a][r]{width=10}\n\n[r]: /i.png` | `{ src: '/i.png', alt: 'a', width: '10' }` |
| `![a]{width=10}\n\n[a]: /i.png` | `{ src: '/i.png', alt: 'a', width: '10' }` |
| `![a &copy; \\_b](/a\\_b.png "&amp;")` | `{ src: '/a_b.png', alt: 'a © _b', title: '&' }` |

No `img` is created (`createdTags()` lacks `'img'`) for:
`![a](<javascript:alert(1)>)`, `![a][r]\n\n[r]: javascript:alert(1)`,
`![a](javascript&#58;alert(1))`, and `![a]{width=10}` with no definition (its
text writes hold `!`).

`extractMarkdownHeadings('# ![a](/i.png "t") x')` and
`extractMarkdownHeadings('# ![a](/i.png) x')` both give `text: 'a x'`.

### Editor: forms and saves (`markdown-images.test.ts`)

Each row loads the source, appends a text node `' x'` to the first block in one
update, and checks `getValue()`; the save also reloads to the same
`editorSurfaceModel` (`viewerModel(saved).blocks` equals it).

| Loaded | Saved after the edit |
|---|---|
| `![foo](/url "title")` | `![foo](/url "title") x` |
| `![a](/i.png 't')` | `![a](/i.png 't') x` |
| `![foo](<url>)` | `![foo](<url>) x` |
| `![foo ![bar](/url)](/url2)` | `![foo ![bar](/url)](/url2) x` |
| `![foo *bar*][]\n\n[foo *bar*]: train.jpg "train & tracks"` | `![foo *bar*][] x\n\n[foo *bar*]: train.jpg "train & tracks"` |
| `![a]{width=10}\n\n[a]: /i.png` | `![a]{width=10} x\n\n[a]: /i.png` |
| `![a][r]{height=5}\n\n[r]: /i.png "T"` | `![a][r]{height=5} x\n\n[r]: /i.png "T"` |
| `![foo] \n[]\n\n[foo]: /url "title"\n` (spec 587) | `![foo]\n\\[\\] x\n\n[foo]: /url "title"\n` |
| `![a\nb](/i.png)` | `![a\nb](/i.png) x`; the node's alt is `a\nb` |

Also: the image of `![foo](/url "title")` is a `MarkdownImageNode` with
`getTitle()` `'title'` and `$getState(node, imageWrittenState)`
`'![foo](/url "title")'`; an editor state's JSON keeps the state (copying the
node through `exportJSON`/`$parseSerializedNode` keeps
`imageWrittenState` and `getTitle()`).

Shortcut collapsing: `![foo]\n\n[foo]: /url` with a link `[x](/u)` appended
saves `![foo][][x](/u)\n\n[foo]: /url`; with the text `(x) {y}` appended,
`![foo][](x) {y}\n\n[foo]: /url`.

### Editor: insertImage (`markdown-images.test.ts`)

On an empty editor:

| Call | `getValue()` |
|---|---|
| `insertImage('/i.png', { alt: 'a [b] *c*', title: 'T "q"' })` | `![a \\\\[b\\\\] \\*c\\*](/i.png "T \\"q\\"")` |
| `insertImage('/a b.png', { alt: 'x' })` | `![x](</a b.png>)` |
| `insertImage('/i.png', { alt: 'a', title: 'x\\' })` | `![a](/i.png "x&#92;")` |
| `insertImage('/i.png', { alt: 'a', title: '' })` | `![a](/i.png)` |
| `insertImage('/i.png', { alt: 'a\\', width: 3 })` | `![a\\\\](/i.png){width=3}` |
| `insertImage('/i.png', { alt: 'a\nb' })` | `![a&#10;b](/i.png)` |
| `insertImage('javascript:alert(1)', { title: 't' })` | `''` (unchanged) |

Each save reloads to the same surface. A link whose title ends in a backslash
(`[a](/u "x&#92;")` loaded, its block edited) saves `[a](/u "x&#92;") x`.

### Editor: written forms in other places (`markdown-images.test.ts`)

- A paragraph `![a\nb](/i.png)` turned into a level 3 heading (caret in it,
  `setBlockType('h3')`) saves `### ![a&#10;b](/i.png)`, and the save reloads to
  the same surface: the written form holds a line break a one-line heading
  cannot, so the standard form is written. (`setBlockType('h2')` keeps it as a
  setext heading, `![a\nb](/i.png)` over `---`.)
- `| a |\n| --- |\n| ![i](/i.png "t") |` with ` x` appended to the cell's
  paragraph saves `| a |\n| --- |\n| ![i](/i.png "t") x |`.
- The image of `![a][r] y\n\n[r]: /i.png`, copied through `exportJSON` and
  `$parseSerializedNode` onto the end of the paragraph of a document `z`,
  keeps `imageWrittenState` `![a][r]` and saves `z![a](/i.png)`: no
  definition of `r` resolves it there.

### Editor: definitions (`markdown-reference-links.test.ts`)

Each row checks `expectShownAsSaved(editor)` too.

| Loaded | Edit | Saved |
|---|---|---|
| `![foo][bar] y\n\n[bar]: /url` | the definition's raw block removed | `![foo](/url) y` |
| same | `retypeRawBlock(editor, '[bar]: /other')` | `![foo](/url) y\n\n[bar]: /other` |
| `![foo][bar] y\n\n[bar]: /url "a"` | `retypeRawBlock(editor, '[bar]: /url "b"')` | `![foo](/url "a") y\n\n[bar]: /url "b"` |
| `![foo][bar] y\n\n[bar]: /url` | retyped `[bar]: /other`, then `[bar]: /url` | `![foo][bar] y\n\n[bar]: /url` |
| `![foo][]\n\n[foo]: /url "\n\ntitle"` | `retypeRawBlock(editor, '[foo]: /url "\n\ntitle2"')` | `![foo][]\n\n[foo]: /url "\n\ntitle2"`; the image's title is `\n\ntitle2` |
| `~~5 [![a][r]]()~~ w\n\n[r]: /g` | `retypeRawBlock(editor, '[r]: /h')` | `~~5 [![a][r]]()~~ w\n\n[r]: /h`; the image's `src` is `/h` |

### HTML (`markdown-image-node-html.test.ts`, jsdom)

- `<p>a<img src="/i.png" alt="d" title="t" width="10">b</p>` builds a
  paragraph holding `a`, an image (`src` `/i.png`, `alt` `d`, title `t`, width
  10, `imageWrittenState` `""`) and `b`; `$serializeMarkdown()` writes
  `a![d](/i.png "t"){width=10}b`. (Write no spaces next to the `<img>`:
  Lexical's HTML import trims them, as it does beside any element it does not
  count as inline.)
- `<p><img src="javascript:alert(1)" alt="x"></p>` builds no image node.
- A document loaded from `![a](/i.png "t")`, exported with
  `$generateHtmlFromNodes`, holds `title="t"`.

### Source mode (`markdown-source-places.test.ts`)

| Marked source (`¦` is the offset) | Place |
|---|---|
| `> a ![alt](u.png "ti¦tle") c` | `[[a ¦<markdown-image> c]]` |
| `> a ![alt](u.png "title")¦ c` | `[[a <markdown-image>¦ c]]` |
| `> a ![alt](<u¦.png>) c` | `[[a ¦<markdown-image> c]]` |
| `> a ![a *b¦*](u.png) c` | `[[a ¦<markdown-image> c]]` |
| `> a ![a ![b](v.png)¦](u.png) c` | `[[a ¦<markdown-image> c]]` |

### Round-trip corpus (`corpus/images.ts`, every harness check passes)

CommonMark examples, named `CommonMark <n> (<section>)` and copied verbatim
with their trailing newline: 520 (Links), 573, 574, 575, 576, 577, 579, 580,
583, 585, 586, 587, 589, 590, 591, 592 (Images). The existing rows for 572, 578,
581, 582, 584 and 588 stay in `corpus/commonmark.ts`.

Dialect and reference cases:

| Name | Source | `links` |
|---|---|---|
| titled sized image | `![a](/i.png "t"){width=10}` | — |
| image titles in single quotes and parentheses | `![a](/i.png 't') ![b](/j.png (u))` | — |
| angle-bracket image destination with a space | `![a](</my img.png> "t")` | — |
| image destination with balanced parentheses | `![a](/i(1).png)` | — |
| escapes and character references in an image | `![a\\_b &copy;](/a\\_b.png "&amp;")` | — |
| image alt text holding brackets | `![a \\[b\\] c](/i.png)` | — |
| image alt text holding emphasis, code and a line break | `` ![*a* `b`\nc](/i.png) `` | — |
| titled image in a heading | `# ![a](/i.png "t") x` | — |
| titled image in a table cell | `\| a \|\n\| --- \|\n\| ![i](/i.png "t") \|` | — |
| titled linked image | `[![img](/i.png "t")](https://e.com)` | — |
| sized reference images in every form | `![a][r]{width=10} ![r][]{height=5} ![r]{width=3}\n\n[r]: /i.png "T"` | `[]` |
| shortcut reference image before a link | `![r][] [x](/u)\n\n[r]: /i.png` | `['/u']` |
| reference image in a table cell | `\| a \|\n\| --- \|\n\| ![i][r] \|\n\n[r]: /i.png` | `[]` |
| linked reference image | `[![a][r]](https://e.com)\n\n[r]: /i.png` | `['https://e.com']` |
| reference image whose definition the scheme allow-list rejects | `![a][r] x\n\n[r]: javascript:alert(1)` | `[]` |
| reference image with an undefined label | `![a][nope] x` | `[]` |
| reference image alt text holding a reference link | `![a [b] c][r]\n\n[r]: /i.png\n[b]: /b` | `[]` |

The prototype's `corpus/images.ts` (in `prototype.diff`) holds exactly these 33
cases, ready to copy.

### Harness (manual, recorded in the implementation notes)

The scratch harness on the finished branch reports `spec same 651 / 652`, the
one difference being spec 606 (Autolinks).

### Manual (MD Editor demo)

- **Title tooltip.** `npm run dev` → **MD Editor**, **Edit Markdown source**
  on, document `![Logo](https://commonmark.org/help/images/favicon.png "CommonMark")`.
  Hovering the image in the live viewer and in the WYSIWYG surface shows the
  tooltip `CommonMark`.
- **Reference image.** Document `![Logo][l]` + blank line +
  `[l]: https://commonmark.org/help/images/favicon.png`. Both surfaces show the
  image. Typing ` x` after it in WYSIWYG keeps `![Logo][l] x` in source mode;
  changing the definition's URL leaves the WYSIWYG image as it was and source
  mode shows `![Logo](https://commonmark.org/help/images/favicon.png) x`.
- **Paste.** Copy an image from a web page (with its surrounding text) and
  paste it into the WYSIWYG surface: an image shows, and source mode shows
  `![alt](src "title")` for it.

---

## Verification

From the repo root:

- `npm run typecheck`
- `npm run lint`
- `npm run test` — includes every case above, the bounded/unbounded lexer
  parity suites, the round-trip corpus checks, the edit fuzz, the escape fuzz's
  new image run, the source-mode differential and the conformance test.
- `npm run docs:api` — zero warnings.
- `npm run docs:llms:check`
- **Harness:** from
  `/home/jika/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans6/commonmark-images/`,
  run
  `TREE=/home/jika/typescript/typescript-ui/.worktrees/markdown-commonmark-images/packages/lib ONLY=compare.test.ts npx vitest run --config vitest.review.config.mjs`;
  then count the spec rows of `out/compare.json` whose `same` is true. Use
  this folder's copy, not the research folder's: its `mdastModel.ts` projects
  an image's title, which the harness model now carries.[^harness-title]
- **Timing:** in a scratch test, `getValue()` on 300 paragraphs each holding
  `![a][r] and ![b](/i.png "t")` plus `[r]: /i.png`, against the same document
  with `![a](/i.png)` in place of the reference image; record both times in
  the implementation notes.
- Manual checks above.

---

## Documentation Impact

No barrel export changes.

- **`docs/components/Markdown.md`, *Supported syntax (v1)*:** replace the row
  `` | `![alt](src){width=... height=...}` | … | `` (line 71) with:
  ```markdown
  | `![alt](src "title")`, `![alt](<src>)` | `<img src alt title>` — the alt text is the description's plain text (`![*a* b](u)` gives `alt="a b"`), and a title, in `"…"`, `'…'` or `(…)`, becomes the `title` attribute; nothing at all when `src` fails the scheme allow-list — see [Extension syntax](#extension-syntax) |
  | `![alt][label]`, `![label][]`, `![label]` | `<img>` whose `src` and title are the matching reference definition's, labels matched as for reference links; an undefined label renders as literal text |
  | `{width=... height=...}` right after any image form | the `<img>`'s `width` / `height` — see [Extension syntax](#extension-syntax) |
  ```
  In the character-reference row (line 64), drop "an image," from the list of
  places shown as typed, and add "an image's destination, title and alt text"
  to the places they are read. In *Extension syntax* (line 159), "on top of
  CommonMark's own `![alt](src)` image syntax" becomes "after any CommonMark
  image form (`![alt](src "title")`, `![alt][label]`, `![label]`, …)".
- **`docs/components/MarkdownEditor.md`:**
  - the construct table's **Sized image** row (line 65) becomes **Image**:
    `` `![alt](src "title"){width=... height=...}`; a loaded image keeps the form it was written in — its title's quotes, a `<…>` destination, a reference's label and form, the syntax of its alt text — while that form still reads as the image, and its attribute group as written while its size is unchanged; a reference image whose definition no longer gives its source and title is written inline, so a save never changes where an image points ``;
  - after line 74's paragraph: "An `<img>` pasted from a web page is an
    image, its `title` kept."
  - *Reference links* (line 91): remove "a reference image (`![alt][label]`,
    which shows its alt text)," from the list of references kept as written,
    and add after the paragraph: "A reference image keeps its own source and
    title as a reference link keeps its URL: it is saved `![alt][label]` while
    its label's definition gives them, and inline otherwise."
  - *What Markdown cannot hold*: delete the bullet "**An image whose alt text
    holds a bracket.** `insertImage` does nothing." (line 106).
  - command table, `insertImage` row (line 150): "`options` may set `alt`,
    `title`, `width`, and `height`", and drop "or `alt` holds a `[` or `]`".
- **`docs/reference/changelog/next.md`:**
  - *Breaking changes › Components*, last entry before `### Core`:
    ```markdown
    - **`Markdown` and `MarkdownEditor` read every CommonMark image form.** An
      image with a title (`![a](/u "t")`), a reference image (`![a][ref]`,
      `![a][]`, `![a]`) and an image with images or links in its alt text
      rendered as its alt text; they now render as images, and the title is
      the `<img>`'s `title` attribute. An `<…>` destination loses its
      brackets, as CommonMark reads it, and the alt text is the description's
      plain text, its escapes and character references read. The
      `{width=… height=…}` group works after every form. `MarkdownEditor`
      shows these images, keeps the form each was written in, and writes a
      reference image whose definition changes inline with its own source.
      See [Migration](/reference/migration/next).
    ```
  - *Added › Components*:
    ```markdown
    - **`MarkdownEditor.insertImage()` takes a `title`, and pasted images stay
      images.** `insertImage(src, { title })` writes `![alt](src "title")`; an
      alt text holding `[` or `]` is inserted, escaped, where the command did
      nothing. An `<img>` pasted from another application becomes an image,
      with its alt text, title and size.
    ```
  - *Fixed › Components*:
    ```markdown
    - **`MarkdownEditor` saves a link title that ends in a backslash.** It was
      written `"…\\"`, which `marked` reads as an escaped quote, so the link
      fell apart on reload; the last backslash is now written `&#92;`.
    ```
- **`docs/reference/migration/next.md`:** append a section in the style of
  *`---` is a horizontal rule in `Markdown` and `MarkdownEditor`*:
  `## Markdown and MarkdownEditor read every CommonMark image form`, with
  **What changed and why** (the forms above; the old rule read only
  `![alt](src)`), a table:

  | Source | Before | Now |
  |---|---|---|
  | `![a](/u "t")` | the text `a` | `<img src="/u" alt="a" title="t">` |
  | `![a][r]` with `[r]: /i.png` | the text `a` | `<img src="/i.png" alt="a">` |
  | `![a](<b.png>)` | `<img src="<b.png>">` | `<img src="b.png">` |
  | `![a *b*](u.png)` | `alt="a *b*"` | `alt="a b"` |
  | `MarkdownEditor.insertImage(src, { alt: 'a[b]' })` | did nothing | inserts the image |

  **Who needs to act:** content that relied on a titled or reference image
  showing its alt text as text writes that text instead (or escapes the `!`:
  `\![a][r]`); code that read the editor's tree for a `MarkdownSourceTextNode`
  holding a titled or reference image reads the `markdown-image` node and its
  `getTitle()`; tests that asserted an `<img>`'s `alt` or `src` for alt text
  with escapes or a `<…>` destination expect the read values. A Markdown
  before/after block:
  ```markdown
  <!-- Before: showed the text "logo"; after: shows the image -->
  ![logo][l]

  [l]: /img/logo.png

  <!-- To keep the text -->
  \![logo][l]
  ```

---

## Potential Challenges

- **The source-mode differential picks commands by a document's place.** Any
  change to the number of corpus cases before `HAND_WRITTEN` moves other
  documents onto other commands and can surface unrelated mismatches (the
  prototype hit two). Step 20 keeps every existing document in its place; do
  not move the image cases into the other corpus files.
- **`marked`'s typing of the slots.** The `link` and `reflink` slots are typed
  to return `marked`'s own tokens; the `as unknown as Tokens.Image` cast is
  needed, as in `dialectTable`.
- **`mdimage` must not gain a `tokens` field.** `shownText`, `holdsOwnLeaf`,
  `keptPieces`, `pushTokenReading` and source mode's analysis would then read
  the alt text as visible text.
- **`$imageNamesLabel` and the definitions reader.** A written form that names
  a label is only checked correctly when `context.definitions` is not `null`,
  which `$referenceIn` and `$needsDefinitions` guarantee; forgetting either
  makes every reference image save inline.
- **`next.md` and the migration page are appended to by other branches.**
  Conflicts are append-only; keep both sides.
- **A worktree has no `node_modules`.** Symlink the main tree's root and
  `packages/lib` `node_modules` into the worktree before running checks.

---

## Critical Files

- [`component/display/markdownExtensions.ts`](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L582) — `fencesReadingReferences`, `dialectTable` (the slot-wrapper precedents), `CHARACTER_REFERENCE_TOKENIZERS`, `lexMarkdownWithDefinitions`.
- `node_modules/marked/lib/marked.esm.js` — `Tokenizer.link`, `Tokenizer.reflink` and the output function they share (an `image` token with `href`, `title`, `text`, `tokens`), and `Lexer.inlineTokens` (the order of the inline slots).
- [`component/display/Markdown.ts`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L2146) — `appendInlineToken`'s `mdimage` case, `inlineText`.
- [`component/editor/markdownNodeState.ts`](packages/lib/src/typescript/lib/component/editor/markdownNodeState.ts#L62) — `imageAttributesState`, the written-while-it-resolves precedent.
- [`component/editor/markdownReferenceLinkNode.ts`](packages/lib/src/typescript/lib/component/editor/markdownReferenceLinkNode.ts) and `resolvesToNode` in [`markdownSerializer.ts:5764`](packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L5764) — the reference rule mirrored.
- [`component/editor/markdownSerializer.ts`](packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L5722) — `writeBracketed` (link text pieces), `protectLabelBrackets`, `writeLinkDestination`, `renderLine` and `joinsShortcut` (the `reference` piece).
- [`component/editor/markdownWritable.ts`](packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L1552) — the definition rule.
- [`component/editor/markdownHorizontalRuleNode.ts`](packages/lib/src/typescript/lib/component/editor/markdownHorizontalRuleNode.ts#L54) and [`markdownTaskCheckboxNode.ts`](packages/lib/src/typescript/lib/component/editor/markdownTaskCheckboxNode.ts#L75) — `importDOM` precedents.
- `plans/implemented/markdown-editor-reference-links.md` — the reference-link decisions (a save never changes where a link points; blank-line titles).
- `scratch-keep/plans6/commonmark-images/prototype.diff` — the prototype.

---

## Non-Goals

- **Link titles in the viewer.** The viewer still writes no `title` on an
  `<a>`; only images gain one.
- **Spec 606.** `<foo\+@bar.example.com>` differs because the harness's
  reference side applies GFM's email autolink; the viewer is right.
- **A `commonmark-spec` dependency.** The examples are inlined.
- **Editing an image's alt text, source or title in the WYSIWYG surface, and a
  title field in `MarkdownDocumentPanel`'s **Image…** prompt.** No UI changes;
  `insertImage`'s option is the authoring route.
- **Emphasis next to a `<` that `marked` pairs with a later `>`.** `a <, **b** > c`
  loses its bold on reload today, in plain text; the escape fuzz finds it with
  images too once bold text is mixed in, so the new fuzz run keeps emphasis
  off. A separate fix.[^fuzz-no-emphasis]
- **The source-mode caret after a block command on a caret inside an image that
  ends its line before a trailing space** (`![foo](/url) \n[]`, quote command
  with the caret in the alt text: source mode puts the caret one character
  off). It exists today; spec 587 reaches it only at another document place,
  which step 20 avoids. A separate fix.
- **The demo's sample document.** Unchanged.

---

## Addendum: Prototype results

The prototype implemented steps 1–21 on `feature/markdown-test-timeouts-under-full-load`
(04562f085), without JSDoc, docs or the step 22 test updates:

- **Harness:** `spec same 651 / 652` (spec 606 alone), with the title projected
  on both sides; 633 before.
- **Full suite:** 26 244 tests, 10 failing — exactly the ten listed in step
  22, each failing for the reason given there. `npm run typecheck:test`
  flagged only `markdown-serializer.test.ts:1048`. Lint of the changed source
  files was clean.
- **Round trip:** every check of every new corpus case passed; the edit fuzz
  needed the word-loss exemption of step 21.
- **Escape fuzz, images:** 9 000 documents over three seeds, with no emphasis,
  passed. 6 000 more with label-like alt text (`[a]`, `[a][b]`, `[x](u)`) and
  definitions failed once, on a title ending in a backslash — the reason for
  the `&#92;` decision; the same document with a plain link fails today. With
  `&#92;` and `&#10;` in the writer, 12 000 documents of that kind, line feeds
  in the alt text included, passed over four seeds. With bold and struck text
  mixed in, 47 of 6 000 failed, all on the `<`…`>` gap in *Non-Goals*.
- **Editor values** in `## Expected Behaviour` are the prototype's outputs
  (`probe-images.json`, `verify.json` and `html.json` in the scratch folder).

---

## Notes

[^prototype]: The prototype was a separate worktree, removed afterwards; its
    diff is `prototype.diff`, its probes `probe-images.test.ts` and
    `probe-images.json`, and the harness copy with the title projection is the
    folder's `tests/` and `vitest.review.config.mjs`. Results are in the
    addendum. It was built to check three risky calls before writing them
    down: that `marked`'s own tokenizers give 651/652, that a lexed written
    form is a sound "still reads as the image" test, and that the existing
    serializer pieces (link text, `protectLabelBrackets`, the `reference`
    piece) can carry an image.

[^slot-not-extension]: The dialect's rule was written when the editor read
    Markdown through a Lexical text-match transformer with the same regex, so
    the viewer and editor had to share one narrow grammar
    (`plans/implemented/markdown-rich-formatting-extension.md`, steps 37–39).
    Since `markdown-editor-marked-import` the editor reads the viewer's
    tokens, so that reason is gone, and `marked`'s own tokenizers already read
    every CommonMark image (titles, `<…>`, balanced parentheses, references
    with case-folded labels, nested descriptions). An inline extension that
    calls them was tried first: it cannot reach the instance's tokenizer,
    because `Lexer.tokenizer` is private in `marked`'s types, and calling the
    prototype methods directly would skip the dialect's own `link` override
    (character references). The `link` and `reflink` slots are where `marked`
    produces images, so wrapping them is the smallest change, and it keeps
    the bounded and unbounded instances identical.

[^leaf-token]: `shownText` and `holdsOwnLeaf` in the importer, `keptPieces` and
    `nestedLinkPieces`, `pushTokenReading` in the serializer and
    `markdownSourceTokens.ts` all recurse into any token with a non-empty
    `tokens` array. Giving `mdimage` the description's tokens would make each
    of them read the alt text as shown text. The description's tokens are
    used only to compute `alt`, inside the tokenizer.

[^alt-plain]: CommonMark: "only the plain string content of the image
    description be used" for `alt`. Its reference implementation
    (commonmark.js) writes a hard line break in the description as a line
    feed; mdast's reading drops it. No spec example has one; the line feed is
    kept, and the editor writes it back as `&#10;`, which reads as a line
    feed in any block.

[^group-attach]: Before this plan a defined `![a]{width=10}` already read as
    `marked`'s image followed by the text `{width=10}`; attaching the group
    there gives every image form the same rule. A link is different: the
    styled-span extension runs before `marked`'s link slots, so `[ref]{…}` is a
    span even when `ref` is defined (the corpus case "inline link and styled
    span share a label"); no span starts with `!`, so an image cannot clash.
    The editor already escapes a `!` before a `[` that a span or link writes
    (`needsEscape`), so text `!` before a styled span never becomes an image.

[^title-attr]: The title is plain text in an attribute set through the DOM
    seam, so it cannot inject markup. Not rendering it would lose the one
    thing a titled image adds over an untitled one, and the editor's own
    links already show their titles (Lexical's `LinkNode` writes `title`),
    so a tooltip is the expected reading. Rendering link titles in the viewer
    is a separate change with its own parity question.

[^allow-list-read]: The allow-list must judge the URL the browser will load.
    Before, an escaped or referenced scheme could reach the `<img>` as
    written (`javascript&#58;…` stayed a harmless relative URL only because
    the old rule failed on its parentheses). Running it on the read value is
    the stricter reading and the one the viewer renders.

[^heading-text]: Before this plan a titled image in a heading was `marked`'s
    `image` token, whose `text` field `inlineText`'s default case returned
    (`a`); as an `mdimage` it has no `text`, so the default case would return
    its `raw`. The new case keeps titled images as they were and makes plain
    images agree with them.

[^title-field]: `src`, `alt`, `width` and `height` are fields because they are
    what the image shows; a title is shown too (a tooltip) and saved in the
    standard form, so it is a field. Node state holds how something was
    written, which the written form covers.

[^written-state]: A `ReferenceImageNode` subclass, mirroring
    `ReferenceLinkNode`, was considered. That subclass exists because
    `LinkNode` is Lexical's class and the link needed a label, a form and the
    text as loaded. An image is the library's own atomic node whose content
    cannot be edited, so the only question at save time is whether the text
    it was written as still reads as it — exactly the job of the node-state
    family (`spanAttributesState`, `fenceOpeningState`, `codeInfoState`,
    `imageAttributesState`). Lexing the written form answers it for every
    form at once: titles in any quotes, `<…>`, nested alt syntax, references
    with any label, and alt text that itself holds a reference whose
    definition changed. Comparing with `resolvesToNode`'s label lookup alone
    would miss the last. The test passes the node's title through a blank
    line exactly where `resolvesToNode` does.

[^standard-form]: Inline is the standard form for a new image: an image made
    in the editor has no label, and writing a reference would need a
    definition the user did not write. The alt text goes through the link text
    pipeline so it gets the same escapes and the same bracket protection as a
    link's text: `marked` unescapes `\[`/`\]` in a description before lexing
    it, exactly as for link text, and `protectLabelBrackets` is the
    reference-link plan's answer to that. Writing the alt as one escaped
    syntax string was the alternative; it would duplicate `escapeText`'s
    neighbour rules. A line feed is written `&#10;` rather than as a soft
    break: the prototype first wrote a soft break, and a paragraph image moved
    into a level 3 heading then saved its alt with a space while the node kept
    the line feed; the character reference reads as the line feed on one line
    in a heading, a table cell and a paragraph alike. The escape fuzz (21 000
    documents) found no alt text or title it could not write. The old writer
    deleted brackets from the alt text, which no longer happens.

[^shortcut-collapse]: `joinsShortcut` decides on the next written character,
    known only when a line is rendered; the `reference` piece already carries
    that decision for `[label]`, and its test does not depend on the text
    being a link. A shortcut with an attribute group ends in `}`, which joins
    nothing, so it stays a `syntax` piece.

[^title-backslash]: `marked`'s title pattern reads `\\` followed by `"` as a
    backslash and an escaped quote, so the title runs on to the next quote in
    the paragraph. Any writing of a trailing backslash inside quotes hits it;
    a character reference does not, and titles read character references.
    The fuzz found it on an image, and the same document with a link fails
    today; the shared writer fixes both.

[^definition-rule]: With images as nodes holding their own `src`, a removed or
    changed definition no longer changes what a reference image shows, the
    same as for a `ReferenceLinkNode` — so the rule that shows a block anew
    is not needed for them, and the four tests that expected the image to turn
    into text (`DEF2`, `DEF6`, `DEF9`, `DEF11`) now expect it inline with its
    own source. An image inside a construct kept as written is different: the
    construct writes its source byte for byte, so it must be shown anew like
    any kept reference, and `$namesLabel` has to see its source, which lives
    on the image node's `keptSourceState` rather than on a source text node.
    `shownReading` hid where an image pointed because the viewer showed only
    its alt text; it now shows the image.

[^insert-brackets]: The guard existed because the old image grammar could not
    hold a bracket and the old writer deleted them. The standard form writes
    them as link text writes them. Making the command insert where it did
    nothing is a visible change, listed in the changelog and migration note.

[^html-paste]: Before, an `<img>` in pasted HTML had no conversion and was
    dropped. A pasted image has no written form, so it is written in the
    standard form. A dedicated `exportDOM` (as the rule has, to drop its
    editor class) is not added: the image's class carries only a max-width
    rule, and the task asks only that the title leave with the copy.

[^source-mode]: Source mode reads positions from `mdimage` tokens and their
    `raw`; that `raw` now covers every form, so a caret in a reference image's
    label or a title is inside the image's atom. The five rows in
    `## Expected Behaviour` passed on the prototype with no source-mode code
    change.

[^conformance-inline]: `commonmark-spec` is not installed, the implementer
    cannot run `npm install`, and the expected values must be the reference
    reading in the harness's model, which no package provides. The rows were
    generated from the scratch harness's micromark reading (the same one
    behind the 651/652 figure) for every example of the three sections; all
    139 match the prototype's viewer. They pin both the image work and the
    link and definition reading the chain already fixed.

[^corpus-last]: The differential gives each document its commands by its index
    in `[...CORPUS, ...HAND_WRITTEN, ...EDGE_DOCUMENTS]`. Inserting the new
    cases among the CommonMark rows moved a dialect document onto the link
    command and surfaced an unrelated table-cell caret mismatch; appending
    them to the corpus moved the hand-written documents and surfaced an
    unrelated loose-list mismatch. Listing the image cases last in the
    differential leaves every existing document with the commands it has
    today. The other corpus users seed by case name or read every case alike.

[^word-loss]: The edit fuzz's word-loss check already exempts a reference
    link's label, which an inline save drops by design. A reference image
    saved inline drops its label the same way (spec 577 and 583 failed the
    check on the prototype until it was exempted).

[^fuzz-no-emphasis]: `marked` masks `<` … `>` stretches as possible HTML tags
    before pairing emphasis, so bold between a bare `<` and a later `>` is
    lost: `a <, **b** > c` reads as text today, with no image involved.
    Images bring more `<` into a paragraph (`</a b.png>` destinations,
    titles), so mixing bold text into the image fuzz reaches this gap (47 of
    6 000 documents). The run keeps emphasis off so it tests what this plan
    changes; it keeps titles ending in a backslash, which the `&#92;` fix
    writes correctly.

[^harness-title]: The scratch harness compares `viewerModel` with a micromark
    projection as JSON strings, so both sides must carry `title` in the same
    key order (`kind, src, alt, title, width, height, link`). The research
    folder's `mdastModel.ts` has no title; this plan's scratch copy adds
    `title: def.title || null` for `image` and `imageReference` nodes and is
    otherwise identical.
