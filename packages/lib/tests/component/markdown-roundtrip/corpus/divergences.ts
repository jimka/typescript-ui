/** Which root cause a known divergence belongs to — the editor-conversion plan works through them by cause. */
export type DivergenceCause =
    | 'unmodelled'     // the editor has no node or transformer for a construct the viewer renders
    | 'block-rules'    // a line/regex block transformer disagrees with marked's CommonMark block rules
    | 'inline-rules'   // a text-format/text-match transformer disagrees with marked's inline rules
    | 'escaping';      // Lexical's import unescaping or export escaping changes the text

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
    referenceLinks: { cause: 'unmodelled', reason: 'The editor has no reference-link or definition node: [text][ref], [ref][] and [ref] show as literal text, and each definition shows as a paragraph the viewer does not render.' },
    autolinks:      { cause: 'unmodelled', reason: 'The editor has no autolink support: <scheme:…>, <name@host> and bare https:// URLs show as plain text where the viewer links them.' },
    lineBreaks:     { cause: 'unmodelled', reason: 'The editor shows each line break inside a paragraph as a line break (a LineBreakNode); the viewer flows the lines into one, rendering neither a soft break nor marked\'s br token as a break (a backslash hard break shows its backslash).' },
    thematicBreak:  { cause: 'unmodelled', reason: 'The editor has no thematic-break node: ---, ***, ___ and - - - import as paragraph or list text (*** and ___ save escaped), while the viewer prints the break\'s source as a raw text block.' },
    quoteBlocks:    { cause: 'unmodelled', reason: 'QuoteNode holds inline content only: a heading, list, code fence, nested quote or second paragraph inside a blockquote imports as text, and a blank > line saves as > >.' },
    listItemBlocks: { cause: 'unmodelled', reason: 'ListItemNode holds inline content and nested lists only, with no loose/tight flag: a second paragraph or a heading inside an item leaves the item or shows as text, and a loose list saves tight.' },
    rawHtml:        { cause: 'unmodelled', reason: 'Raw HTML is text to both, but the viewer prints an HTML block as one raw text block while the editor shows a paragraph with line breaks.' },
    taskListMarker: { cause: 'unmodelled', reason: 'marked lexes [ ] as a checkbox token; the viewer prints it as raw text and then overwrites it with the item\'s plain text, so it shows only the text, while the editor keeps [ ] inside the item\'s text.' },
    // block-rules
    setextHeading:      { cause: 'block-rules', reason: 'HEADING reads only ATX # headings; a setext === or --- underline stays paragraph text in the editor.' },
    atxHeadingRules:    { cause: 'block-rules', reason: 'HEADING differs from CommonMark ATX rules: it keeps a closing # sequence as heading text, rejects 1-3 spaces of indentation, and does not read a bare # as an empty heading.' },
    indentedCode:       { cause: 'block-rules', reason: 'The editor has no indented-code rule: lines indented four spaces or a tab import as paragraph text.' },
    tildeFence:         { cause: 'block-rules', reason: 'CODE recognises only backtick fences: a ~~~ fence imports as paragraph text and saves escaped.' },
    fenceInfoString:    { cause: 'block-rules', reason: 'CODE keeps only the first word of the info string and moves the rest into the code body, and reads a ``` aa ``` line as a fence opener where marked reads a code span.' },
    pipelessTable:      { cause: 'block-rules', reason: 'The viewer\'s table extension reads a text line followed by a --- line as a one-column table even without pipes; the editor\'s TABLE transformer requires a pipe, so it keeps the lines as the paragraph, quote or list text they would otherwise be.' },
    quoteContinuation:  { cause: 'block-rules', reason: 'The editor folds a lazy continuation line into the blockquote and saves it with a > prefix, which changes how marked reads that line.' },
    listNesting:        { cause: 'block-rules', reason: 'The list transformers nest by four-space steps: a list indented two or three spaces flattens into its parent.' },
    listMarkers:        { cause: 'block-rules', reason: 'The list transformers differ from CommonMark list-item rules: 1) is not a list, a ten-digit number is, a bullet-character change does not start a new list, and an empty - item or - - foo is text.' },
    styleLessFence:     { cause: 'block-rules', reason: 'BLOCK unwraps a one-column ::: fence with no valid attribute (::: x, the legacy {columns=2}) into plain paragraphs, by design, while the viewer still renders the fence\'s empty wrapper.' },
    // inline-rules
    underscoreEmphasis: { cause: 'inline-rules', reason: 'The editor imports only * and ** emphasis (ITALIC_STAR, BOLD_STAR): _x_ and __x__ stay text and save escaped.' },
    singleTildeStrike:  { cause: 'inline-rules', reason: 'marked reads ~x~ as strikethrough; STRIKETHROUGH needs ~~, so the text stays plain and saves escaped.' },
    lineSpanningInline: { cause: 'inline-rules', reason: 'The inline transformers match within one line: emphasis or a code span that crosses a line break stays text and saves escaped.' },
    linkDestinations:   { cause: 'inline-rules', reason: 'LINK accepts only a destination with no spaces, angle brackets or nested parentheses, and not an empty ().' },
    linkPrecedence:     { cause: 'inline-rules', reason: 'LINK decides where link text ends differently from marked: a code span or an escaped bracket inside the text, or a link nested in link text, changes the link, and LINK accepts brackets nested two deep that marked prints as literal text.' },
    plainImage:         { cause: 'inline-rules', reason: 'An image that is not exactly ![alt](src){…} imports through LINK as ! plus a link, or as text; the saved text is unchanged, but the editor shows a link or text where the viewer shows an image, its alt text, or nothing for a source it rejects.' },
    underlineRule:      { cause: 'inline-rules', reason: 'UNDERLINE, a Lexical text-format transformer, accepts + inside ++…++; the viewer\'s underline extension does not.' },
    styledSpanInStrong: { cause: 'inline-rules', reason: 'A styled span wrapped in **…** loses its bold on import.' },
    // escaping
    unescapedPunctuation: { cause: 'escaping', reason: 'Lexical\'s import drops a backslash escape (even inside a code span, where CommonMark keeps it) and the export does not restore it, so the escaped character becomes live Markdown on save.' },
    decodedEntities:      { cause: 'escaping', reason: 'Lexical\'s import decodes numeric character references such as &#35; and the export writes the decoded character, while the viewer shows the reference text.' },
    backslashAccumulates: { cause: 'escaping', reason: 'The export escapes a literal backslash the import kept, so every save adds another backslash.' },
    formatNesting:        { cause: 'escaping', reason: 'The export writes overlapping formats (italic around bold and a code span) as marker runs its own import reads back differently, so a second save changes the text again.' },
} as const satisfies Record<string, DivergenceReason>;

/** The id a corpus case's `known` entry names. */
export type DivergenceId = keyof typeof DIVERGENCES;
