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
    quoteBlocks:    { cause: 'unmodelled', reason: 'A blockquote one of whose lines without `>` (a lazy line) falls in a block other than a paragraph — an HTML block, a list — is kept as a raw Markdown block: such a quote reads by what follows it. Saved unchanged, but shown as source where the viewer renders a quote.' },
    listItemBlocks: { cause: 'unmodelled', reason: 'A list one of whose items holds — in a tight list — a block right under another with no blank line between them, other than a nested list under the text of its item (which a save cannot write without making the list loose), or a quote that ends on a line without `>`, indented no deeper than the quote, starting an HTML block (which reads as part of the quote or as a block after it, by what follows the item), is kept as a raw Markdown block (of its item, when it is a nested list): saved unchanged, but shown as source where the viewer renders a list.' },
    // block-rules
    definitionTitleIndent: { cause: 'block-rules', reason: 'A link reference definition that is indented in the source — by spaces, by a tab in a list item, or deeper than its list item — and whose title has a second line loads without that indentation on any line, where the viewer keeps it on the title\'s later lines: the editor reads another title than the viewer. A reference link to the definition is then saved inline once its paragraph is edited.' },
    // inline-rules
} as const satisfies Record<string, DivergenceReason>;

/** The id a corpus case's `known` entry names. */
export type DivergenceId = keyof typeof DIVERGENCES;
