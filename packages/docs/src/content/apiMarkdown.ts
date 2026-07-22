// App-side shaping of generated Markdown: stripping typedoc-plugin-markdown's
// unsupported `***` separator, and synthesizing the module index pages the
// app renders instead of TypeDoc's own (see apiFileFor / fetchApiPage in
// api.ts, which pass these functions the data api.ts owns).

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

/** One `## `-headed link list on a synthesized module index page. */
export interface IndexSection {
    heading: string;
    links:   { text: string; href: string }[];
}

/**
 * Builds a synthesized module index page's Markdown: the breadcrumb and `# `
 * heading TypeDoc's own generated index carries, followed by `sections` as
 * one `## `-headed bulleted link list each. A section with an empty `links`
 * array still emits its heading, with no bullets after it; a module with no
 * `sections` emits breadcrumb and heading only.
 *
 * @param module - The module's directory path relative to the API tree root,
 *   e.g. `core` or `component/button`.
 * @param sections - The page's sections, in the order they should render.
 * @returns The page's Markdown source.
 */
export function moduleIndexSource(module: string, sections: IndexSection[]): string {
    const depth     = module.split('/').length;
    const rootLink  = '../'.repeat(depth) + 'index.md';

    const lines = [
        `[@jimka/typescript-ui](${rootLink}) / ${module}`,
        '',
        `# ${module}`,
    ];

    for (const section of sections) {
        lines.push('', `## ${section.heading}`);

        if (section.links.length > 0) {
            lines.push('', ...section.links.map((link) => `- [${link.text}](${link.href})`));
        }
    }

    return lines.join('\n') + '\n';
}

/**
 * Collapses each `group`'s run of `- [group/x](group/x/index.md)` lines on
 * the root API index into a single `- [group](group/index.md)` line, at the
 * position of the run's first line. A `source` with no matching line for a
 * given group is left unchanged for that group; a `source` matching no group
 * at all is returned byte-identical.
 *
 * @param source - The root API index page's Markdown source.
 * @param groups - The first-level module directories with no real `index.md`
 *   of their own, e.g. `['component']`.
 * @returns `source` with each group's line run collapsed.
 */
export function collapseModuleGroups(source: string, groups: string[]): string {
    const lines = source.split('\n');

    for (const group of groups) {
        const prefix = `- [${group}/`;
        const start  = lines.findIndex((line) => line.startsWith(prefix));

        if (start === -1) continue;

        let end = start;
        while (end < lines.length && lines[end].startsWith(prefix)) {
            end++;
        }

        lines.splice(start, end - start, `- [${group}](${group}/index.md)`);
    }

    return lines.join('\n');
}
