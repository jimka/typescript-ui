import { describe, it, expect } from 'vitest';

// Same glob pattern as pages.ts (see "Markdown content migrates as-is" in
// plans/implemented/packages-docs.md), read independently here so this guard
// exercises the actual authored corpus rather than anything pages.ts derives
// from it.
const RAW_SOURCES = import.meta.glob(
    '../../lib/docs/{guide,concepts,components,layouts,data,recipes,reference}/*.md',
    { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

const PAGES = Object.entries(RAW_SOURCES);

/**
 * Strips fenced code blocks (including list-indented ones) and inline code
 * spans from `source`, longest-first, so a construct quoted inside backticks
 * or a sample block is never mistaken for live syntax — see "The survey's
 * findings are frozen as a test over the corpus" in
 * plans/implemented/docs-content-migration.md.
 *
 * The inline-span pattern matches a backtick run of any length against a
 * same-length closing run (CommonMark's code-span rule), not just a single
 * backtick pair — `components/Markdown.md`'s own syntax-reference table uses
 * a 4-backtick delimiter (`` ```` ``` ```` ``) to show a literal triple
 * backtick inline, which a single-backtick-only pattern desyncs, leaking
 * `<pre>`/`<code>` as literal text and false-failing this guard.
 *
 * @param source - A page's raw Markdown source.
 * @returns `source` with all code content removed.
 */
function stripCode(source: string): string {
    // The lookarounds are load-bearing: without them a run of N backticks can
    // close against the first N backticks of a *longer* run, and the scan then
    // swallows everything up to the next accidental match. On
    // `components/MarkdownEditor.md:53` — `| Fenced code | ` ``` ` fence |` —
    // the 1-backtick opener closed against the first backtick of the ``` run
    // and ate 12 lines, hiding them from every assertion below. Requiring the
    // closing run to be a whole run (CommonMark's own rule) fixes it.
    return stripFences(source)
        .replace(/(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, '');   // inline code spans, any backtick run
}

/**
 * `source` with fenced blocks removed but inline code spans left intact.
 *
 * Heading ids must be derived from this rather than from {@link stripCode}:
 * the viewer slugifies `token.text`, which still contains the backticked
 * text (`appendHeading` at
 * `packages/lib/src/typescript/lib/component/display/Markdown.ts:667`), so
 * `## Drag-and-drop with \`DragManager\`` yields
 * `drag-and-drop-with-dragmanager` in the app. Deleting the inline span
 * first would yield `drag-and-drop-with` and make this guard disagree with
 * the viewer on 22 of the 154 pages — false-failing a correctly authored
 * anchor and passing a dead one.
 *
 * @param source - A page's raw Markdown source.
 * @returns `source` with fenced code blocks removed.
 */
function stripFences(source: string): string {
    return source.replace(/^([ \t]*)```[\s\S]*?^\1```[ \t]*$/gm, '');   // fenced blocks, incl. indented
}

/**
 * The same slug rule {@link Markdown}'s viewer applies (`slugify` at
 * `packages/lib/src/typescript/lib/component/display/Markdown.ts:209`):
 * lowercase, every run of non-alphanumerics collapsed to one hyphen, ends
 * trimmed. Duplicated here rather than imported because the library has no
 * public export for it — see "Markdown stays eagerly globbed" in
 * plans/implemented/docs-content-migration.md for why this test reads
 * Markdown source directly instead of through the viewer.
 *
 * @param text - The heading's plain text.
 * @returns The slug, with no leading, trailing, or doubled hyphens.
 */
function slugify(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * Every heading's id on the page, in document order, with the same `-N`
 * dedupe suffix the viewer applies on the Nth repeat of a slug.
 *
 * @param strippedSource - A page's source with {@link stripFences} applied.
 * Inline code must still be present — see that function's note.
 * @returns The set of heading ids present on the page.
 */
function headingIds(strippedSource: string): Set<string> {
    const seen = new Map<string, number>();
    const ids  = new Set<string>();

    for (const match of strippedSource.matchAll(/^#{1,6}[ \t]+(.+)$/gm)) {
        const slug  = slugify(match[1]);
        const count = seen.get(slug) ?? 0;

        seen.set(slug, count + 1);
        ids.add(count === 0 ? slug : `${slug}-${count}`);
    }

    return ids;
}

/**
 * Every bare `#anchor` link target on the page (excluding a `/path#fragment`
 * cross-page link, which this phase does not resolve — see `## Non-Goals` in
 * plans/implemented/docs-content-migration.md).
 *
 * @param strippedSource - A page's source with {@link stripCode} applied.
 * @returns The referenced anchor ids, in document order.
 */
function bareAnchorLinks(strippedSource: string): string[] {
    return [...strippedSource.matchAll(/\]\(#([a-zA-Z0-9-]+)\)/g)].map((match) => match[1]);
}

describe('content-constructs guard', () => {
    it.each(PAGES)('%s has no raw HTML tag', (path, raw) => {
        const matches = stripCode(raw).match(/<\/?[a-zA-Z][a-zA-Z0-9]*\b[^>]*>/g);

        expect(matches, `${path} contains raw HTML: ${JSON.stringify(matches)}`).toBeNull();
    });

    it.each(PAGES)('%s has no image, footnote, task list item, strikethrough, or ==highlight==', (path, raw) => {
        const stripped = stripCode(raw);

        expect(stripped.match(/!\[.*?\]\(.*?\)/), `${path} contains an image`).toBeNull();
        expect(stripped.match(/\[\^[^\]]+\]/), `${path} contains a footnote reference`).toBeNull();
        expect(stripped.match(/^[ \t]*-[ \t]\[[ xX]\]/m), `${path} contains a task list item`).toBeNull();
        expect(stripped.match(/~~/), `${path} contains strikethrough`).toBeNull();
        expect(stripped.match(/==[^=\n]+==/), `${path} contains ==highlight==`).toBeNull();
    });

    it.each(PAGES)('%s has no <script>, <Badge>, or {{ }} interpolation', (path, raw) => {
        const stripped = stripCode(raw);

        expect(stripped.includes('<script'), `${path} contains <script`).toBe(false);
        expect(stripped.includes('<Badge'), `${path} contains <Badge`).toBe(false);
        expect(stripped.match(/\{\{[\s\S]*?\}\}/), `${path} contains a {{ }} interpolation`).toBeNull();
    });

    it.each(PAGES)('%s only opens known ::: container types', (path, raw) => {
        // Tested line-by-line, not with a multiline regex over the whole
        // source: `\s` matches a newline, so a global match would let a bare
        // closing ":::" line's trailing "\s*" run onto the next paragraph
        // and mis-capture its first word as a container type.
        const offenders = stripCode(raw)
            .split('\n')
            .map((line) => /^:::\s*(\w+)/.exec(line)?.[1])
            .filter((type): type is string => type !== undefined && !['tip', 'warning', 'info'].includes(type));

        expect(offenders, `${path} opens an unsupported ::: container: ${offenders.join(', ')}`).toHaveLength(0);
    });

    it.each(PAGES)('%s has no frontmatter block', (path, raw) => {
        expect(raw.startsWith('---'), `${path} begins with a frontmatter block`).toBe(false);
    });

    it.each(PAGES)('%s resolves every bare #anchor link to a heading on the page', (path, raw) => {
        // Two different strips on purpose: ids come from fence-stripped source
        // so a backticked heading slugifies exactly as the viewer does, while
        // links come from fully-stripped source so a `](#example)` quoted in
        // prose is not mistaken for a real link.
        const ids      = headingIds(stripFences(raw));
        const dangling = bareAnchorLinks(stripCode(raw)).filter((anchor) => !ids.has(anchor));

        expect(dangling, `${path} links #anchor(s) with no matching heading: ${dangling.join(', ')}`).toHaveLength(0);
    });
});

describe('stripCode removes only the code it should', () => {
    // Without backtick-boundary assertions a short run closes against the head
    // of a longer one and the scan swallows the prose in between, silently
    // blinding every assertion above it.
    it('does not let a short run close against a longer one', () => {
        const source = '| Fenced code | ` ``` ` fence |\n\nkeep me\n\n## Formatting';
        const out    = stripCode(source);

        expect(out).toContain('keep me');
        expect(out).toContain('## Formatting');
    });

    it('removes spans of any backtick width', () => {
        expect(stripCode('a `one` b ``two`` c ```three``` d')).toBe('a  b  c  d');
    });

    it('removes fenced blocks but keeps surrounding prose', () => {
        expect(stripCode('before\n\n```ts\nconst x = 1;\n```\n\nafter')).toContain('before');
        expect(stripCode('before\n\n```ts\nconst x = 1;\n```\n\nafter')).toContain('after');
        expect(stripCode('before\n\n```ts\nconst x = 1;\n```\n\nafter')).not.toContain('const x');
    });
});

describe('the guard derives heading ids the way the viewer does', () => {
    // Regression cases for the slug rule itself. Without them the guard can
    // drift back to slugifying inline-code-stripped text, which disagrees with
    // Markdown.appendHeading on any heading containing a backticked span and
    // silently accepts dead anchors.
    it('keeps backticked heading text in the slug', () => {
        const ids = headingIds(stripFences('## Drag-and-drop with `DragManager`'));

        expect(ids.has('drag-and-drop-with-dragmanager')).toBe(true);
        expect(ids.has('drag-and-drop-with')).toBe(false);
    });

    it('suffixes a repeated slug the way the viewer does', () => {
        const ids = headingIds(stripFences('## Overview\n\n## Overview\n\n## Overview'));

        expect([...ids].sort()).toEqual(['overview', 'overview-1', 'overview-2']);
    });

    it('ignores headings inside a fenced block', () => {
        const ids = headingIds(stripFences('# Real\n\n```md\n# Fenced\n```'));

        expect(ids.has('real')).toBe(true);
        expect(ids.has('fenced')).toBe(false);
    });
});
