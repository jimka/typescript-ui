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
    return source
        .replace(/^([ \t]*)```[\s\S]*?^\1```[ \t]*$/gm, '')   // fenced blocks, incl. indented
        .replace(/(`+)[\s\S]*?\1/g, '');                       // inline code spans, any backtick run
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
 * @param strippedSource - A page's source with {@link stripCode} applied.
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
        const stripped = stripCode(raw);
        const ids       = headingIds(stripped);
        const dangling  = bareAnchorLinks(stripped).filter((anchor) => !ids.has(anchor));

        expect(dangling, `${path} links #anchor(s) with no matching heading: ${dangling.join(', ')}`).toHaveLength(0);
    });
});
