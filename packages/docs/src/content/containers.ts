// VitePress `:::` container syntax (`::: tip Title` … `:::`) is not CommonMark
// and has no equivalent in the library's `Markdown` viewer — see the "VitePress
// `:::` containers are transformed in the app, not supported in the library"
// architecture decision in plans/implemented/packages-docs.md. This module
// pre-processes a container into a blockquote with a bold title line, which the
// viewer already renders, before the source reaches `Markdown`.
const CONTAINER_OPEN = /^:::\s*(\w+)\s*(.*)$/;

/**
 * Expands every `::: type Title` … `:::` block in `source` into a blockquote
 * whose first line is `**Title**` (or the capitalised type word when no title
 * was authored) and whose remaining lines are the container body, so the
 * result renders through the library `Markdown` viewer unchanged.
 *
 * @param source - The raw Markdown source, possibly containing containers.
 * @returns The source with every container replaced by a blockquote. Source
 *   with no `:::` marker is returned byte-identical.
 */
export function expandContainers(source: string): string {
    const lines = source.split('\n');
    const output: string[] = [];
    let i = 0;

    while (i < lines.length) {
        const open = CONTAINER_OPEN.exec(lines[i]);

        if (open === null) {
            output.push(lines[i]);
            i += 1;
            continue;
        }

        const [, type, rawTitle] = open;
        const title = rawTitle.trim() || (type.charAt(0).toUpperCase() + type.slice(1));

        i += 1;

        const body: string[] = [];

        while (i < lines.length && lines[i].trim() !== ':::') {
            body.push(lines[i]);
            i += 1;
        }

        i += 1;   // skip the closing ":::"

        output.push(`> **${title}**`);
        for (const line of body) {
            output.push(line.length > 0 ? `> ${line}` : '>');
        }
    }

    return output.join('\n');
}
