import type { Token, Tokens } from 'marked';
import { $getRoot, $getState, $isElementNode, $isLineBreakNode, $isParagraphNode, $isTextNode } from 'lexical';
import type { LexicalEditor, LexicalNode, TextFormatType } from 'lexical';
import { $isHeadingNode, $isQuoteNode } from '@lexical/rich-text';
import { $isListNode, $isListItemNode } from '@lexical/list';
import type { ListNode } from '@lexical/list';
import { $isCodeNode } from '@lexical/code';
import { $isTableNode, $isTableCellNode, $isTableRowNode } from '@lexical/table';
import type { TableCellNode, TableNode } from '@lexical/table';
import { $isLinkNode } from '@lexical/link';
import { lexMarkdown } from '~/component/display/markdownExtensions';
import type { MdBlockToken } from '~/component/display/markdownExtensions';
import type { MdTableBodyCell, MdTableHeaderCell, MdTableToken } from '~/component/display/markdownTableExtension';
import { extractMarkdownHeadings } from '~/component/display/Markdown';
import {
    cssTextToAttributes, resolveBlockStyle, resolveImageSpec, resolveSpanStyle,
} from '~/component/display/markdownAttributes';
import type { MarkdownSpanStyle } from '~/component/display/markdownAttributes';
import { $isMarkdownBlockNode, $isMarkdownColumnNode } from '~/component/editor/markdownBlockNode';
import { $isMarkdownImageNode } from '~/component/editor/markdownImageNode';
import { listLooseState } from '~/component/editor/markdownNodeState';
import { $isMarkdownRawBlockNode } from '~/component/editor/markdownSourceNodes';
import type { MarkdownEditor } from '~/component/editor/MarkdownEditor';

/** An inline format a text run carries. */
export type Mark = 'bold' | 'italic' | 'strike' | 'code' | 'underline';

/** Where a run links to. */
export interface LinkTarget { href: string; title: string | null }

/** One inline piece of a block: formatted text, an image, or a line break. */
export type Run =
    | { kind: 'text'; text: string; marks: Mark[]; link: LinkTarget | null; style: MarkdownSpanStyle | null }
    | { kind: 'image'; src: string; alt: string; width: number | null; height: number | null; link: LinkTarget | null }
    | { kind: 'break' };

/** One table cell: alignment, merge span and inline content. */
export interface Cell { align: string | null; colSpan: number; rowSpan: number; runs: Run[] }

/** One block of the view model. */
export type Block =
    | { kind: 'heading'; depth: number; runs: Run[] }
    | { kind: 'paragraph'; runs: Run[] }
    | { kind: 'quote'; blocks: Block[] }
    | { kind: 'list'; ordered: boolean; loose: boolean; items: Block[][] }
    | { kind: 'code'; lang: string | null; text: string }
    | { kind: 'table'; widths: (number | null)[]; header: Cell[]; rows: Cell[][] }
    | { kind: 'fence'; textAlign: string | null; columnGap: string | null; columns: Block[][] }
    | { kind: 'raw'; text: string };

/** What the viewer shows for a document: its blocks and the ids its headings get. */
export interface ViewModel { blocks: Block[]; headingIds: string[] }

/** The formatting an inline walk carries down to the runs it emits. */
interface RunContext {
    readonly marks:  Mark[];
    readonly link:   LinkTarget | null;
    readonly style:  MarkdownSpanStyle | null;
    readonly inCell: boolean;
}

/** The fixed order marks are listed in, so two runs with the same formats compare equal. */
const MARK_ORDER: readonly Mark[] = ['bold', 'italic', 'strike', 'code', 'underline'];

/** Each inline token type that adds a mark, and the mark it adds. */
const TOKEN_MARKS: Readonly<Record<string, Mark>> = { strong: 'bold', em: 'italic', del: 'strike', underline: 'underline' };

/** Each Lexical text format the projection reads, and the mark it becomes. */
const FORMAT_MARKS: ReadonlyArray<readonly [TextFormatType, Mark]> = [
    ['bold', 'bold'], ['italic', 'italic'], ['strikethrough', 'strike'], ['code', 'code'], ['underline', 'underline'],
];

/**
 * The four characters `\n\n` (backslash, `n`, backslash, `n`) that separate a table cell's paragraphs in saved
 * Markdown. Mirrors `CELL_PARAGRAPH_BREAK` in `Markdown.ts`, which the viewer does not export.
 */
const CELL_PARAGRAPH_BREAK = '\\n\\n';

/** The shallowest and deepest heading level; mirrors the viewer's own clamp in `Markdown.ts`, which it does not export. */
const HEADING_MIN_DEPTH = 1;
const HEADING_MAX_DEPTH = 6;

/** The context an inline walk starts from: no marks, no link, no style. */
const PLAIN: RunContext = { marks: [], link: null, style: null, inCell: false };

// ---------------------------------------------------------------- run assembly

/**
 * Replaces every whitespace run with one space, as HTML's `white-space: normal` does.
 *
 * @param text - The text to collapse.
 * @returns The collapsed text.
 */
function collapseWhitespace(text: string): string {
    return text.replace(/\s+/g, ' ');
}

/**
 * Tells whether a text run carries exactly the marks, link and style of `context`.
 *
 * @param run - The text run.
 * @param context - The formatting to compare with: a context, or another text run.
 * @returns `true` when all three are equal.
 */
function sameFormatting(run: Extract<Run, { kind: 'text' }>, context: Pick<RunContext, 'marks' | 'link' | 'style'>): boolean {
    return JSON.stringify([run.marks, run.link, run.style]) === JSON.stringify([context.marks, context.link, context.style]);
}

/**
 * Appends text, merging into the previous text run when its marks, link and style are identical.
 *
 * @param runs - The runs list to append to.
 * @param text - The text to append.
 * @param context - The text's formatting.
 */
function pushText(runs: Run[], text: string, context: RunContext): void {
    const last = runs[runs.length - 1];

    // Empty text shows nothing, so it neither starts a run nor ends the one before (an empty link between two runs).
    if (text === '') {
        return;
    }

    if (last?.kind === 'text' && sameFormatting(last, context)) {
        last.text = collapseWhitespace(last.text + text);

        return;
    }

    runs.push({ kind: 'text', text: collapseWhitespace(text), marks: context.marks, link: context.link, style: context.style });
}

/** The marks a space cannot show: they change a glyph's weight or slant, and a space has no glyph. */
const GLYPH_MARKS: readonly Mark[] = ['bold', 'italic'];

/**
 * Finishes the runs of one heading, paragraph or cell as HTML's `white-space: normal` lays them out. Whitespace is
 * one space, and a space right after another one is dropped, across run boundaries too; the spaces at the block's
 * edges and next to a break are dropped, through any run that dropping empties. A space shows no bold or italic, so it
 * takes those from the text on both sides of it: a space between two bold words is bold, one at a bold run's edge is
 * not, whatever it carried.
 *
 * @param runs - The assembled runs of one heading, paragraph or cell.
 * @returns The finished runs.
 */
function finishRuns(runs: Run[]): Run[] {
    const pieces = laidOutPieces(runs);

    pieces.forEach((piece, index) => {
        if (piece.kind === 'text' && piece.text === ' ') {
            pieces[index] = { ...piece, marks: spaceMarks(piece, pieces[index - 1], pieces[index + 1]) };
        }
    });

    return pieces.reduce<Run[]>((merged, piece) => {
        const last = merged[merged.length - 1];

        if (last?.kind === 'text' && piece.kind === 'text' && sameFormatting(last, piece)) {
            last.text += piece.text;
        } else {
            merged.push(piece.kind === 'text' ? { ...piece } : piece);
        }

        return merged;
    }, []);
}

/**
 * Splits runs into pieces of whitespace and of other text, and lays out the whitespace: one space per stretch,
 * none after another space or at a line edge (the block's start or end, or next to a break).
 *
 * @param runs - The assembled runs.
 * @returns The pieces: breaks, images, single spaces and whitespace-free text.
 */
function laidOutPieces(runs: Run[]): Run[] {
    const pieces: Run[] = [];
    const isSpace = (run: Run | undefined): boolean => run?.kind === 'text' && run.text === ' ';

    for (const run of runs) {
        if (run.kind !== 'text') {
            if (run.kind === 'break' && isSpace(pieces[pieces.length - 1])) {
                pieces.pop();
            }

            pieces.push(run);

            continue;
        }

        for (const text of run.text.match(/\s+|\S+/g) ?? []) {
            const space = /^\s/.test(text);
            const previous = pieces[pieces.length - 1];

            if (space && (previous === undefined || previous.kind === 'break' || isSpace(previous))) {
                continue;
            }

            pieces.push({ ...run, text: space ? ' ' : text });
        }
    }

    if (isSpace(pieces[pieces.length - 1])) {
        pieces.pop();
    }

    return pieces;
}

/**
 * The marks a laid-out space shows: its own, but bold and italic only where the text on both sides of it carries them.
 *
 * @param space - The space piece.
 * @param before - The piece before it.
 * @param after - The piece after it.
 * @returns The space's marks, in the fixed order.
 */
function spaceMarks(space: Extract<Run, { kind: 'text' }>, before: Run | undefined, after: Run | undefined): Mark[] {
    const carried = (mark: Mark): boolean => before?.kind === 'text' && before.marks.includes(mark) && after?.kind === 'text' && after.marks.includes(mark);

    return MARK_ORDER.filter((mark) => (GLYPH_MARKS.includes(mark) ? carried(mark) : space.marks.includes(mark)));
}

/**
 * Returns `context` with `mark` added, keeping the marks in their fixed order.
 *
 * @param context - The current formatting.
 * @param mark - The mark to add.
 * @returns The extended formatting.
 */
function withMark(context: RunContext, mark: Mark): RunContext {
    const marks = MARK_ORDER.filter((candidate) => candidate === mark || context.marks.includes(candidate));

    return { ...context, marks };
}

/**
 * Resolves a span style, or `null` when it sets nothing.
 *
 * @param attributes - The span's `{key=value}` attributes.
 * @returns The resolved style, or `null` when every field is `null`.
 */
function spanStyleOf(attributes: Record<string, string>): MarkdownSpanStyle | null {
    const style = resolveSpanStyle(attributes);

    return style.color === null && style.fontFamily === null && style.fontSize === null ? null : style;
}

/**
 * Drops the blocks that show nothing: a paragraph with no runs and a raw block with empty text.
 *
 * @param blocks - The blocks of one container.
 * @returns The visible blocks.
 */
function visibleBlocks(blocks: Block[]): Block[] {
    return blocks.filter((block) => !(block.kind === 'paragraph' && block.runs.length === 0) && !(block.kind === 'raw' && block.text === ''));
}

/**
 * Builds the raw block the viewer's text fallback shows for `text`.
 *
 * @param text - The fallback's text.
 * @returns The raw block, with whitespace collapsed and trimmed.
 */
function rawBlock(text: string): Block {
    return { kind: 'raw', text: collapseWhitespace(text).trim() };
}

/**
 * Removes one trailing newline, which adds no visible line inside a `pre`.
 *
 * @param text - A code block's text.
 * @returns The text without its final newline.
 */
function withoutFinalNewline(text: string): string {
    return text.endsWith('\n') ? text.slice(0, -1) : text;
}

// ---------------------------------------------------------------- viewer side

/**
 * Projects the document the viewer renders for `source`.
 *
 * @param source - The Markdown source.
 * @returns Its blocks and heading ids.
 */
export function viewerModel(source: string): ViewModel {
    return {
        blocks:     viewerBlocks(lexMarkdown(source)),
        headingIds: extractMarkdownHeadings(source).map((heading) => heading.id),
    };
}

/**
 * Projects a list of block tokens, following `Markdown.appendBlockToken`.
 *
 * @param tokens - The block tokens.
 * @returns The visible blocks.
 */
function viewerBlocks(tokens: Token[]): Block[] {
    return visibleBlocks(tokens.flatMap((token) => viewerBlock(token)));
}

/**
 * Projects one block token.
 *
 * @param token - The block token.
 * @returns The token's block, or none for a token the viewer renders nothing for.
 */
function viewerBlock(token: Token): Block[] {
    switch (token.type) {
        case 'space':
        case 'def':
            return [];
        case 'heading': {
            const heading = token as Tokens.Heading;

            return [{ kind: 'heading', depth: Math.min(Math.max(heading.depth, HEADING_MIN_DEPTH), HEADING_MAX_DEPTH), runs: viewerRuns(heading.tokens, PLAIN) }];
        }
        case 'paragraph':
            return [{ kind: 'paragraph', runs: viewerRuns((token as Tokens.Paragraph).tokens, PLAIN) }];
        case 'blockquote':
            return [{ kind: 'quote', blocks: viewerBlocks((token as Tokens.Blockquote).tokens) }];
        case 'code':
            return [viewerCode(token as Tokens.Code)];
        case 'list':
            return [viewerList(token as Tokens.List)];
        case 'mdtable':
            return [viewerTable(token as unknown as MdTableToken)];
        case 'mdblock':
            return [viewerFence(token as unknown as MdBlockToken)];
        default:
            return [rawBlock(token.raw ?? '')];
    }
}

/**
 * Projects a code token: the first word of its info string and its text.
 *
 * @param token - The code token.
 * @returns The code block.
 */
function viewerCode(token: Tokens.Code): Block {
    const lang = (token.lang ?? '').trim().split(/\s+/)[0] ?? '';

    return { kind: 'code', lang: lang === '' ? null : lang, text: withoutFinalNewline(token.text) };
}

/**
 * Projects a list token, following `Markdown.appendListItem` for each item.
 *
 * @param token - The list token.
 * @returns The list block.
 */
function viewerList(token: Tokens.List): Block {
    return { kind: 'list', ordered: token.ordered, loose: token.loose, items: token.items.map((item) => viewerListItem(item)) };
}

/**
 * Projects one list item, following `Markdown.appendListItem`: a `text` token becomes a paragraph and any other token
 * a block; a task item's checkbox token becomes the first text of the next paragraph when that is a `text` token or —
 * in an item `marked` made loose after lexing it — a `paragraph` token, as the viewer prints its marker inline. Before
 * any other token the viewer prints the marker as a text node of its own, so it projects as the raw fallback block.
 *
 * @param item - The list-item token.
 * @returns The item's visible blocks.
 */
function viewerListItem(item: Tokens.ListItem): Block[] {
    const blocks: Block[] = [];
    let checkbox: Token | null = null;

    for (const token of item.tokens) {
        if (token.type === 'checkbox') {
            checkbox = token;
            continue;
        }

        if (token.type === 'paragraph' && checkbox !== null) {
            const paragraph = token as Tokens.Paragraph;

            blocks.push(...viewerBlock({ ...paragraph, tokens: [checkbox, ...paragraph.tokens] }));
            checkbox = null;
            continue;
        }

        if (token.type !== 'text') {
            blocks.push(...(checkbox === null ? [] : viewerBlock(checkbox)), ...viewerBlock(token));
            checkbox = null;
            continue;
        }

        const text = token as Tokens.Text;
        const inline = text.tokens && text.tokens.length > 0 ? text.tokens : [text];
        const marker = checkbox === null ? [] : [{ type: 'text', raw: checkbox.raw, text: checkbox.raw } as Tokens.Text];

        blocks.push({ kind: 'paragraph', runs: viewerRuns([...marker, ...inline], PLAIN) });
        checkbox = null;
    }

    return visibleBlocks(blocks);
}

/**
 * Projects a table token, following `Markdown.appendTable`.
 *
 * @param token - The `mdtable` token.
 * @returns The table block.
 */
function viewerTable(token: MdTableToken): Block {
    return {
        kind:   'table',
        widths: [...token.widths],
        header: token.header.map((cell) => viewerCell(cell, 1, 1)),
        rows:   token.rows.map((row) => row.map((cell: MdTableBodyCell) => viewerCell(cell, cell.colSpan, cell.rowSpan))),
    };
}

/**
 * Projects one table cell.
 *
 * @param cell - The header or body cell.
 * @param colSpan - The cell's column span (always 1 in the header).
 * @param rowSpan - The cell's row span (always 1 in the header).
 * @returns The cell.
 */
function viewerCell(cell: MdTableHeaderCell | MdTableBodyCell, colSpan: number, rowSpan: number): Cell {
    return { align: cell.align, colSpan, rowSpan, runs: viewerRuns(cell.tokens, { ...PLAIN, inCell: true }) };
}

/**
 * Projects a `:::` fence token, following `Markdown.appendBlock`.
 *
 * @param token - The `mdblock` token.
 * @returns The fence block.
 */
function viewerFence(token: MdBlockToken): Block {
    const style = resolveBlockStyle(token.attributes);

    return {
        kind:      'fence',
        textAlign: style.textAlign,
        columnGap: style.columnGap,
        columns:   token.columns.map((column) => viewerBlocks(column)),
    };
}

/**
 * Projects a list of inline tokens onto finished runs.
 *
 * @param tokens - The inline tokens.
 * @param context - The formatting they start from.
 * @returns The finished runs.
 */
function viewerRuns(tokens: Token[], context: RunContext): Run[] {
    const runs: Run[] = [];

    viewerInline(runs, tokens, context);

    return finishRuns(runs);
}

/**
 * Appends the runs of a list of inline tokens, following `Markdown.appendInlineToken`.
 *
 * @param runs - The runs list to append to.
 * @param tokens - The inline tokens.
 * @param context - The formatting they inherit.
 */
function viewerInline(runs: Run[], tokens: Token[], context: RunContext): void {
    for (const token of tokens) {
        viewerInlineToken(runs, token, context);
    }
}

/**
 * Appends the runs of one inline token.
 *
 * @param runs - The runs list to append to.
 * @param token - The inline token.
 * @param context - The formatting it inherits.
 */
function viewerInlineToken(runs: Run[], token: Token, context: RunContext): void {
    const mark = TOKEN_MARKS[token.type];

    if (mark !== undefined) {
        viewerInline(runs, (token as Tokens.Generic).tokens ?? [], withMark(context, mark));

        return;
    }

    switch (token.type) {
        case 'text':
            viewerText(runs, token as Tokens.Text, context);
            break;
        case 'codespan':
            pushText(runs, (token as Tokens.Codespan).text, withMark(context, 'code'));
            break;
        case 'link': {
            const link = token as Tokens.Link;

            viewerInline(runs, link.tokens, { ...context, link: { href: link.href, title: link.title ?? null } });
            break;
        }
        case 'styledspan': {
            const span = token as Tokens.Generic;

            viewerInline(runs, span.tokens ?? [], { ...context, style: spanStyleOf(span.attributes as Record<string, string>) });
            break;
        }
        case 'mdimage':
            viewerImage(runs, token as Tokens.Generic, context);
            break;
        case 'br':
            runs.push({ kind: 'break' });
            break;
        default:
            pushText(runs, (token as Tokens.Generic).text ?? token.raw ?? '', context);
    }
}

/**
 * Appends a `text` token: its children when it has any, its cell-paragraph pieces joined by breaks inside a table
 * cell, else its text.
 *
 * @param runs - The runs list to append to.
 * @param token - The `text` token.
 * @param context - The formatting it inherits.
 */
function viewerText(runs: Run[], token: Tokens.Text, context: RunContext): void {
    if (token.tokens && token.tokens.length > 0) {
        viewerInline(runs, token.tokens, context);

        return;
    }

    if (!context.inCell || !token.text.includes(CELL_PARAGRAPH_BREAK)) {
        pushText(runs, token.text, context);

        return;
    }

    token.text.split(CELL_PARAGRAPH_BREAK).forEach((piece, index) => {
        if (index > 0) {
            runs.push({ kind: 'break' });
        }

        pushText(runs, piece, context);
    });
}

/**
 * Appends an `mdimage` token's image run, or nothing when the viewer rejects its source.
 *
 * @param runs - The runs list to append to.
 * @param token - The `mdimage` token.
 * @param context - The formatting it inherits; only its link applies.
 */
function viewerImage(runs: Run[], token: Tokens.Generic, context: RunContext): void {
    const spec = resolveImageSpec(token.src as string, token.alt as string, token.attributes as Record<string, string>);

    if (spec === null) {
        return;
    }

    runs.push({ kind: 'image', src: spec.src, alt: spec.alt, width: spec.width, height: spec.height, link: context.link });
}

// ---------------------------------------------------------------- editor side

/**
 * Projects the structure the editor's WYSIWYG surface holds.
 *
 * @param editor - A `MarkdownEditor` whose content has been set.
 * @returns The surface's blocks.
 * @throws Error - When the editor has not built its Lexical editor yet.
 */
export function editorSurfaceModel(editor: MarkdownEditor): Block[] {
    const lexicalEditor = (editor as unknown as { _editor: LexicalEditor | null })._editor;

    if (lexicalEditor === null) {
        throw new Error('The MarkdownEditor has no Lexical editor yet; call setValue first.');
    }

    return lexicalEditor.read(() => editorBlocks($getRoot().getChildren()));
}

/**
 * Projects a list of block nodes, dropping the raw blocks that hold only link reference definitions.
 *
 * @param nodes - The block nodes.
 * @returns The visible blocks.
 */
function editorBlocks(nodes: LexicalNode[]): Block[] {
    return visibleBlocks(nodes.filter((node) => !holdsOnlyDefinitions(node)).map((node) => editorBlock(node)));
}

/**
 * Tells whether a node is a raw block whose text lexes to link reference definitions alone, which the viewer renders
 * nothing for. Decided from the current text, so a definition rewritten into prose shows, as it does in the viewer.
 *
 * @param node - A block node.
 * @returns `true` for a definitions-only raw block.
 */
function holdsOnlyDefinitions(node: LexicalNode): boolean {
    return $isMarkdownRawBlockNode(node)
        && lexMarkdown(node.getTextContent()).every((token) => token.type === 'def' || token.type === 'space');
}

/**
 * Projects one block node.
 *
 * @param node - The block node.
 * @returns Its block.
 */
function editorBlock(node: LexicalNode): Block {
    if ($isParagraphNode(node)) {
        return { kind: 'paragraph', runs: editorRuns(node.getChildren()) };
    }

    if ($isHeadingNode(node)) {
        return { kind: 'heading', depth: Number(node.getTag().slice(1)), runs: editorRuns(node.getChildren()) };
    }

    if ($isQuoteNode(node)) {
        return { kind: 'quote', blocks: visibleBlocks([{ kind: 'paragraph', runs: editorRuns(node.getChildren()) }]) };
    }

    if ($isCodeNode(node)) {
        return { kind: 'code', lang: node.getLanguage() ?? null, text: withoutFinalNewline(node.getTextContent()) };
    }

    if ($isListNode(node)) {
        return { kind: 'list', ordered: node.getListType() === 'number', loose: $getState(node, listLooseState), items: editorListItems(node) };
    }

    if ($isTableNode(node)) {
        return editorTable(node);
    }

    if ($isMarkdownBlockNode(node)) {
        const columns = node.getChildren().filter($isMarkdownColumnNode);

        return { kind: 'fence', textAlign: node.getAlign(), columnGap: node.getColumnGap(), columns: columns.map((column) => editorBlocks(column.getChildren())) };
    }

    return rawBlock(node.getTextContent());
}

/**
 * Projects a list's items: each item's children are its blocks, in order — its text, a paragraph of the model, and
 * every block after it, a nested list among them.
 *
 * @param list - The list node.
 * @returns One block list per item.
 */
function editorListItems(list: ListNode): Block[][] {
    return list.getChildren().filter($isListItemNode).map((item) => editorBlocks(item.getChildren()));
}

/**
 * Projects a table node: widths, header row and body rows.
 *
 * @param table - The table node.
 * @returns The table block.
 */
function editorTable(table: TableNode): Block {
    const rows = table.getChildren().filter($isTableRowNode).map((row) => row.getChildren().filter($isTableCellNode));
    const [headerRow = [], ...bodyRows] = rows;
    const colWidths = table.getColWidths();
    const widths = headerRow.map((_cell, index) => colWidths?.[index] || null);

    return {
        kind:   'table',
        widths,
        header: headerRow.map((cell) => ({ ...editorCell(cell), colSpan: 1, rowSpan: 1 })),
        rows:   bodyRows.map((row) => row.map((cell) => editorCell(cell))),
    };
}

/**
 * Projects one table cell; its paragraphs join with break runs.
 *
 * @param cell - The table-cell node.
 * @returns The cell.
 */
function editorCell(cell: TableCellNode): Cell {
    const runs: Run[] = [];

    cell.getChildren().forEach((paragraph, index) => {
        if (index > 0) {
            runs.push({ kind: 'break' });
        }

        editorInline(runs, $isElementNode(paragraph) ? paragraph.getChildren() : [paragraph], PLAIN);
    });

    return { align: cell.getFormatType() || null, colSpan: cell.getColSpan(), rowSpan: cell.getRowSpan(), runs: finishRuns(runs) };
}

/**
 * Projects a list of inline nodes onto finished runs.
 *
 * @param nodes - The inline nodes.
 * @returns The finished runs.
 */
function editorRuns(nodes: LexicalNode[]): Run[] {
    const runs: Run[] = [];

    editorInline(runs, nodes, PLAIN);

    return finishRuns(runs);
}

/**
 * Appends the runs of a list of inline nodes.
 *
 * @param runs - The runs list to append to.
 * @param nodes - The inline nodes.
 * @param context - The formatting they inherit (a link only; text nodes carry their own marks and style).
 */
function editorInline(runs: Run[], nodes: LexicalNode[], context: RunContext): void {
    for (const node of nodes) {
        editorInlineNode(runs, node, context);
    }
}

/**
 * Appends the runs of one inline node. A newline inside a text node is a break run: the editor's surface is
 * `white-space: pre-wrap`, so it shows the newline as a line break, and the save writes it as a hard break.
 *
 * @param runs - The runs list to append to.
 * @param node - The inline node.
 * @param context - The formatting it inherits.
 */
function editorInlineNode(runs: Run[], node: LexicalNode, context: RunContext): void {
    if ($isTextNode(node)) {
        const marks = FORMAT_MARKS.filter(([format]) => node.hasFormat(format)).map(([, mark]) => mark);
        const style = node.getStyle() === '' ? null : spanStyleOf(cssTextToAttributes(node.getStyle()));

        node.getTextContent().split('\n').forEach((line, index) => {
            if (index > 0) {
                runs.push({ kind: 'break' });
            }

            pushText(runs, line, { ...context, marks, style });
        });
    } else if ($isLineBreakNode(node)) {
        runs.push({ kind: 'break' });
    } else if ($isLinkNode(node)) {
        editorInline(runs, node.getChildren(), { ...context, link: { href: node.getURL(), title: node.getTitle() ?? null } });
    } else if ($isMarkdownImageNode(node)) {
        runs.push({
            kind:   'image',
            src:    node.getSrc(),
            alt:    node.getAlt(),
            width:  node.getImageWidth(),
            height: node.getImageHeight(),
            link:   context.link,
        });
    } else if ($isElementNode(node)) {
        editorInline(runs, node.getChildren(), context);
    } else {
        pushText(runs, node.getTextContent(), context);
    }
}

// ---------------------------------------------------------------- link witness

/**
 * Lists the link targets a reader meets in document order, counting a link split over several runs once.
 *
 * @param model - The view model to walk.
 * @returns Each link's href, once per link.
 */
export function linkTargets(model: ViewModel): string[] {
    const targets: string[] = [];

    collectBlockLinks(model.blocks, targets);

    return targets;
}

/**
 * Collects the link targets of a list of blocks, recursing into quotes, list items, table cells and fence columns.
 *
 * @param blocks - The blocks to walk.
 * @param targets - The list the targets are appended to.
 */
function collectBlockLinks(blocks: Block[], targets: string[]): void {
    for (const block of blocks) {
        switch (block.kind) {
            case 'heading':
            case 'paragraph':
                collectRunLinks(block.runs, targets);
                break;
            case 'quote':
                collectBlockLinks(block.blocks, targets);
                break;
            case 'list':
                block.items.forEach((item) => collectBlockLinks(item, targets));
                break;
            case 'table':
                [block.header, ...block.rows].forEach((row) => row.forEach((cell) => collectRunLinks(cell.runs, targets)));
                break;
            case 'fence':
                block.columns.forEach((column) => collectBlockLinks(column, targets));
                break;
            default:
                break;
        }
    }
}

/**
 * Collects the link targets of one runs list: a run's link counts when it differs from the previous run's.
 *
 * @param runs - The runs to walk.
 * @param targets - The list the targets are appended to.
 */
function collectRunLinks(runs: Run[], targets: string[]): void {
    let previous: LinkTarget | null = null;

    for (const run of runs) {
        const link = run.kind === 'break' ? null : run.link;

        if (link !== null && JSON.stringify(link) !== JSON.stringify(previous)) {
            targets.push(link.href);
        }

        previous = link;
    }
}
