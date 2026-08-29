// App-side shaping of generated Markdown: stripping typedoc-plugin-markdown's
// unsupported `***` separator, and synthesizing the module index pages the
// app renders instead of TypeDoc's own (see apiFileFor / fetchApiPage in
// api.ts, which pass these functions the data api.ts owns).

// typedoc-plugin-markdown separates each member with a `***` line — CommonMark
// `hr` syntax the library's `Markdown` viewer has no case for (see the block-
// token default branch at Markdown.ts:1448), so it would render as the literal
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

/** The exact heading line marking a member as inherited from a base class. */
const INHERITED_FROM_HEADING = '#### Inherited from';

/** A `[start, end)` line-index range in a Markdown source, to drop verbatim. */
interface LineRange {
    start: number;
    end:   number;
}

/**
 * Removes every inherited member from a generated class/interface page's
 * Markdown, so the reader sees only what the type declares itself. A
 * generated page groups members under `## `-level headings (`## Methods`,
 * `## Properties`, …), each member its own `### ` heading; a member
 * inherited from a base class carries an {@link INHERITED_FROM_HEADING}
 * sub-heading somewhere in its block, a member the type declares itself does
 * not. A section left with no surviving members has its now-empty `## `
 * heading dropped too, so a fully-inherited class doesn't leave a dangling
 * heading with nothing under it — a section with no `### ` children at all
 * (`## Extends`, `## Extended by`) is never a candidate for that cleanup,
 * since it starts with zero members. A source with no
 * {@link INHERITED_FROM_HEADING} line anywhere is returned byte-identical.
 *
 * @param source - The generated API page's Markdown source.
 * @returns `source` with every inherited member, and any section left empty
 *   by that removal, dropped.
 */
export function filterInheritedMembers(source: string): string {
    if (!source.includes(INHERITED_FROM_HEADING)) {
        return source;
    }

    const lines = source.split('\n');

    const sectionStarts: number[] = [];

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('## ')) {
            sectionStarts.push(i);
        }
    }

    const removedRanges = sectionStarts.flatMap((sectionStart, s) =>
        sectionRangesToRemove(lines, sectionStart, sectionStarts[s + 1] ?? lines.length));

    const isRemoved = (index: number): boolean =>
        removedRanges.some(({ start, end }) => index >= start && index < end);

    return lines.filter((_, i) => !isRemoved(i)).join('\n');
}

/**
 * Computes the ranges to remove from one `## `-headed section: every
 * inherited member's own range when the section keeps at least one member of
 * its own, or the whole section (heading included) when every member in it
 * is inherited.
 *
 * @param lines - The full source, split into lines.
 * @param sectionStart - The section's `## ` heading line index.
 * @param sectionEnd - The index one past the section's last line — the next
 *   `## ` heading's index, or `lines.length` for the last section.
 * @returns The ranges to remove for this section, possibly empty.
 */
function sectionRangesToRemove(lines: string[], sectionStart: number, sectionEnd: number): LineRange[] {
    const memberStarts: number[] = [];

    for (let i = sectionStart + 1; i < sectionEnd; i++) {
        if (lines[i].startsWith('### ')) {
            memberStarts.push(i);
        }
    }

    if (memberStarts.length === 0) {
        return [];
    }

    const members = memberStarts.map((start, m) => ({ start, end: memberStarts[m + 1] ?? sectionEnd }));
    const inherited = members.filter(({ start, end }) => lines.slice(start, end).includes(INHERITED_FROM_HEADING));

    return inherited.length === members.length ? [{ start: sectionStart, end: sectionEnd }] : inherited;
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

const CRUMB_LINK = /^\[([^\]]+)\]\(([^)]+)\)$/;
const ROOT_CRUMB = /^\[[^\]]+\]\(((?:\.\.\/)*)index\.md\)$/;

/**
 * Splits a compound module crumb like `[component/button](../index.md)` in a
 * generated page's breadcrumb line into one crumb per directory segment —
 * `[component](../../index.md) / [button](../index.md)` — so each ancestor
 * directory becomes its own entry instead of one opaque link. TypeDoc names
 * a module after its full relative directory path and links (or, on the
 * module's own index page, states) that whole path as a single crumb; this
 * expands it to match the app's own per-directory routing, under which every
 * ancestor directory (e.g. `component`) is independently addressable — see
 * `MODULE_INDEX_FILES` in `api.ts`. Each inserted ancestor link is computed
 * from the root crumb's own `../` depth, so it works whether the compound
 * crumb is itself a link (a symbol page) or plain text (the module's own,
 * unlinked index-page crumb) — only its last segment keeps the original
 * link/plain-text form. A crumb with no `/`, or a `source` with no
 * recognizable breadcrumb line, is returned unchanged.
 *
 * @param source - A generated API page's Markdown source.
 * @returns `source` with its breadcrumb line's compound crumb(s) expanded.
 */
export function expandModuleBreadcrumb(source: string): string {
    const newline = source.indexOf('\n');
    const line    = newline === -1 ? source : source.slice(0, newline);
    const rest    = newline === -1 ? '' : source.slice(newline);

    const crumbs    = line.split(' / ');
    const rootMatch = crumbs[0]?.match(ROOT_CRUMB);

    if (crumbs.length < 2 || !rootMatch) return source;

    const fileDepth = rootMatch[1].length / '../'.length;

    const expanded = crumbs.map((crumb, i) => {
        if (i === 0) return crumb;

        const linkMatch = crumb.match(CRUMB_LINK);
        const text       = linkMatch ? linkMatch[1] : crumb;
        const parts      = text.split('/');

        if (parts.length < 2) return crumb;

        const ancestorCrumbs = parts.slice(0, -1).map((part, depth) => {
            const ups = fileDepth - depth - 1;
            return `[${part}](${'../'.repeat(ups)}index.md)`;
        });

        const lastPart  = parts[parts.length - 1];
        const lastCrumb = linkMatch ? `[${lastPart}](${linkMatch[2]})` : lastPart;

        return [...ancestorCrumbs, lastCrumb].join(' / ');
    });

    return expanded.join(' / ') + rest;
}
