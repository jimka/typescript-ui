// A live demo is marked in a page's Markdown source by a pair of HTML
// comments wrapping a fallback region:
//
//   <!-- demo: button-basic -->
//   > **Live demo** — two `Button`s side by side, interactive in the
//   > documentation app.
//   > [Open the Button page](https://jimka.github.io/typescript-ui/components/Button)
//   <!-- /demo -->
//
// Both marker lines must start at column 0 and be the whole line. The
// delimiters are HTML comments — CommonMark-standard and hidden by every
// renderer (GitHub, npm, VS Code's preview) — so the fallback between them
// is what those renderers show, while the docs app drops it and substitutes
// the live demo the id resolves to. The fallback is required, not
// decorative: without it, a demo living under its own heading would leave
// that heading with nothing beneath it outside the app, which reads as a
// broken page rather than as one missing an optional extra.
//
// Two constraints on a fallback's contents, both forced by the corpus guard
// in `content-constructs.test.ts`: it must contain no heading (a heading
// inside a dropped region would satisfy a `](#anchor)` link check while the
// app never renders that heading), and every link inside it must be an
// absolute `https://` URL (a root-relative docs route is dead exactly where
// the fallback is read).

/** Matches a demo's open marker line, capturing its id. */
export const DEMO_OPEN = /^<!--\s*demo:\s*([a-z0-9-]+)\s*-->$/;

/** Matches a demo's close marker line, which ends its fallback region. */
export const DEMO_CLOSE = /^<!--\s*\/demo\s*-->$/;

/** One piece of a documentation page: a run of prose, or a live demo. */
export type DocBlock =
    | { kind: 'markdown'; source: string }
    | { kind: 'demo';     id: string };

/**
 * Splits a page's Markdown source into its ordered blocks. The fallback
 * region between a demo's open and close marker is dropped: it exists for
 * renderers that cannot run the demo, and the app renders the demo instead.
 *
 * An unterminated open marker consumes the rest of the source — the demo
 * block is emitted and no prose block follows it. This is documented, not
 * desirable; the corpus guard in `demos.test.ts` forbids it.
 *
 * @param source - A page's Markdown source, with `:::` containers already
 *   expanded.
 * @returns The page's blocks in document order. Source with no marker
 *   yields exactly one `markdown` block whose `source` is byte-identical to
 *   the input.
 */
export function splitBlocks(source: string): DocBlock[] {
    const lines  = source.split('\n');
    const blocks: DocBlock[] = [];
    let   prose: string[] = [];
    let   i = 0;

    const flushProse = (): void => {
        if (prose.length > 0 && prose.some((line) => line.trim() !== '')) {
            blocks.push({ kind: 'markdown', source: prose.join('\n') });
        }
        prose = [];
    };

    while (i < lines.length) {
        const open = DEMO_OPEN.exec(lines[i]);

        if (open === null) {
            prose.push(lines[i]);
            i += 1;
            continue;
        }

        flushProse();
        blocks.push({ kind: 'demo', id: open[1] });
        i += 1;

        while (i < lines.length && !DEMO_CLOSE.test(lines[i])) {
            i += 1;
        }

        i += 1;   // skip the closing marker (or step past end of source)
    }

    flushProse();

    return blocks;
}
