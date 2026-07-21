// typedoc-plugin-markdown separates each member with a `***` line — CommonMark
// `hr` syntax the library's `Markdown` viewer has no case for (see the block-
// token default branch at Markdown.ts:648), so it would render as the literal
// text `***` instead of a rule. This module strips those lines before the
// source reaches the viewer, mirroring containers.ts's app-level transform of
// a dialect the viewer doesn't support.
const HR_LINE = /^\*\*\*$/gm;

/**
 * Blanks out every line that is exactly `***` in `source`, so the generated
 * member separators typedoc-plugin-markdown emits never reach the viewer. The
 * line's surrounding newlines are left in place — only the `***` content is
 * removed, so a line of prose becomes an empty line rather than disappearing
 * and merging its neighbours. A source with no `***` line is returned
 * byte-identical.
 *
 * @param source - The generated API page's Markdown source.
 * @returns `source` with every `***` separator line blanked.
 */
export function normalizeApiMarkdown(source: string): string {
    return source.replace(HR_LINE, '');
}
