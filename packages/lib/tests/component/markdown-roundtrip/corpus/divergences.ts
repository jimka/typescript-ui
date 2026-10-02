/** Which root cause a known divergence belongs to — the editor-conversion plan works through them by cause. */
export type DivergenceCause =
    | 'unmodelled'     // the editor has no node that holds a construct the viewer renders
    | 'block-rules'    // the editor's block structure disagrees with marked's CommonMark block rules
    | 'inline-rules'   // the editor's inline handling disagrees with what the viewer shows
    | 'escaping';      // import unescaping or export escaping changes the text

/** One reviewed reason a corpus check fails on the current editor. */
export interface DivergenceReason {
    /** The root cause the divergence is grouped under. */
    readonly cause:  DivergenceCause;
    /** What the editor does differently from the viewer, in reviewable prose. */
    readonly reason: string;
}

/** Every known divergence of the current editor, keyed by the id a corpus case's `known` entry names. */
export const DIVERGENCES = {
    // unmodelled
    quoteBlocks:    { cause: 'unmodelled', reason: 'A blockquote holding more than one paragraph, or any other block (a link reference definition included, which the viewer renders as an empty quote), is kept as a raw Markdown block: saved unchanged, but shown as source where the viewer renders a quote.' },
    listItemBlocks: { cause: 'unmodelled', reason: 'A list whose item holds more than one paragraph, or any other block (a link reference definition included, which the viewer renders as an empty item), is kept as a raw Markdown block: saved unchanged, but shown as source where the viewer renders a list.' },
    taskListMarker: { cause: 'unmodelled', reason: 'marked lexes [ ] as a checkbox token; the viewer prints it as raw text and then overwrites it with the item\'s plain text only when that text is a single plain run, so it shows only the text, while the editor keeps [ ] inside the item\'s text. When the item\'s text is written in the standard form with an escape (\\[docs\\], 2 \\* 3) — once the list is edited — it is no longer a single run, so the viewer shows [ ] after the save where it did not before: a viewer defect, for a later viewer plan.' },
    // inline-rules
} as const satisfies Record<string, DivergenceReason>;

/** The id a corpus case's `known` entry names. */
export type DivergenceId = keyof typeof DIVERGENCES;
