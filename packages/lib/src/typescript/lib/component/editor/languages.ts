// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Registers the seven built-in language definitions as a side effect of
// importing this module (from the barrel `index.ts`). Every grammar and
// formatter loader is a dynamic `import()`, so — because the CodeMirror
// language packages and Prettier/sql-formatter are `external` in the lib
// build — none of them reach the base editor chunk; each loads only when a
// consumer actually selects that language or calls `format()`. The three
// external packages imported statically for their code,
// `@codemirror/language`, `@codemirror/state` and `@codemirror/view`, are
// ones `CodeEditor` itself imports, so they are in that chunk already; the
// other static imports are this library's own modules, or types.

import type { tags as highlightTags } from "@lezer/highlight";
import { syntaxTree } from "@codemirror/language";
import type { Language, TreeIndentContext } from "@codemirror/language";
import { countColumn, EditorSelection, Prec } from "@codemirror/state";
import type { ChangeSpec, EditorState, SelectionRange, StateCommand } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import type { SqlLanguage } from "sql-formatter";
import { MARKDOWN_TAB_STOP } from "~/component/display/markdownTabs.js";
import { registerLanguage } from "~/component/editor/LanguageRegistry.js";
import type { LanguageOptions } from "~/component/editor/LanguageRegistry.js";
import { formatWithPrettier } from "~/component/editor/formatters/prettier.js";
import { formatWithSql } from "~/component/editor/formatters/sql.js";
import { atMarkdownTabStops } from "~/component/editor/markdownTabStopCommands.js";
import type { SyntaxNode } from "~/component/editor/markdownTabStopCommands.js";
import { MARKDOWN_TAB_STOPS, readQuoteContinuationTabs } from "~/component/editor/markdownTabStops.js";
import type { BlockParser, MarkdownConfig } from "~/component/editor/markdownTabStops.js";
import { collectSyntaxErrors } from "~/component/editor/syntaxDiagnostics.js";

/** Loads the babel + estree plugins Prettier's `babel-ts` and `json` parsers need. */
async function loadBabelPlugins() {
    const [babel, estree] = await Promise.all([
        import("prettier/plugins/babel"),
        import("prettier/plugins/estree"),
    ]);

    return [babel, estree];
}

registerLanguage({
    id: "javascript",
    label: "JavaScript / TypeScript",
    loadExtension: async () => {
        const { javascript } = await import("@codemirror/lang-javascript");

        return javascript({ typescript: true });
    },
    loadFormatter: async () => formatWithPrettier("babel-ts", loadBabelPlugins),
    loadLintSource: async () => collectSyntaxErrors,
});

registerLanguage({
    id: "json",
    label: "JSON",
    loadExtension: async () => {
        // The only built-in grammar with no completion source of its own
        // (every other language publishes one through its own <lang>Language.data
        // facet, which autocompletion() reads without being told); attached here
        // using the same language-data idiom a consumer would use for a custom
        // grammar.
        const [{ json, jsonLanguage }, { completeFromList }] = await Promise.all([
            import("@codemirror/lang-json"),
            import("@codemirror/autocomplete"),
        ]);

        return [json(), jsonLanguage.data.of({ autocomplete: completeFromList(["true", "false", "null"]) })];
    },
    loadFormatter: async () => formatWithPrettier("json", loadBabelPlugins),
    loadLintSource: async () => collectSyntaxErrors,
});

registerLanguage({
    id: "html",
    label: "HTML",
    loadExtension: async () => {
        const { html } = await import("@codemirror/lang-html");

        return html();
    },
    loadFormatter: async () => formatWithPrettier("html", async () => [await import("prettier/plugins/html")]),
    loadLintSource: async () => collectSyntaxErrors,
});

/**
 * Options the built-in `"sql"` language reads. An unrecognised `dialect`
 * value falls back to `"standard"`.
 *
 * Declared with `type`, not `interface`, so a variable of this type is
 * assignable to `LanguageOptions` (an object-literal type alias gets an
 * implicit index signature; an interface does not).
 *
 * @category Components
 */
export type SqlLanguageOptions = {
    /** SQL dialect for highlighting, completion, lint and format(). Default `"standard"`. */
    dialect?: "standard" | "postgresql";
};

/** What one SQL dialect selects in each of the two engines. */
type SqlDialectEntry = {
    /** The `@codemirror/lang-sql` dialect export, by name. */
    grammar: "StandardSQL" | "PostgreSQL";
    /** The `sql-formatter` language. */
    formatter: SqlLanguage;
};

/**
 * What each SqlLanguageOptions dialect selects in the two engines: the
 * `@codemirror/lang-sql` export (a name, so the grammar package stays behind
 * the dynamic import) and the `sql-formatter` language.
 */
const SQL_DIALECTS: Record<NonNullable<SqlLanguageOptions["dialect"]>, SqlDialectEntry> = {
    standard:   { grammar: "StandardSQL", formatter: "sql" },
    postgresql: { grammar: "PostgreSQL",  formatter: "postgresql" },
};

/**
 * Resolves the "sql" loaders' options to a dialect entry. Anything other than
 * a recognised `dialect` string falls back to "standard"; `Object.hasOwn`
 * (not `in`) keeps inherited keys such as `"toString"` from matching.
 *
 * @param options - The options the "sql" loader received.
 * @returns The dialect entry to load.
 */
function resolveDialectEntry(options?: LanguageOptions): SqlDialectEntry {
    const dialect = options?.dialect;

    if (typeof dialect === "string" && Object.hasOwn(SQL_DIALECTS, dialect)) {
        return SQL_DIALECTS[dialect as keyof typeof SQL_DIALECTS];
    }

    return SQL_DIALECTS.standard;
}

registerLanguage({
    id: "sql",
    label: "SQL",
    loadExtension: async (options) => {
        const langSql = await import("@codemirror/lang-sql");

        return langSql.sql({ dialect: langSql[resolveDialectEntry(options).grammar] });
    },
    loadFormatter: async (options) => formatWithSql(resolveDialectEntry(options).formatter),
    loadLintSource: async () => collectSyntaxErrors,
});

/**
 * The indentation the built-in `"markdown"` language gives a line that Enter
 * starts inside HTML. `null` means "no opinion": Enter then copies the current
 * line's leading whitespace, as on any other Markdown line, and a line being
 * typed is left where it is.
 *
 * The one line with nothing to copy is a list item's marker line (`- <div>`):
 * its text starts after the marker, not after whitespace. There the new line
 * is indented to the item's content column, which keeps it in the item.
 * Inside a blockquote there is no opinion either way: spaces cannot continue
 * the quote, and deeper indentation outside it would read as a code block.
 *
 * Inside a blockquote or list item, insertNewlineKeepPrefix handles Enter
 * before this rule is asked. The rule still answers for HTML outside both,
 * and where that command passes the key on, as on an item's marker line
 * that an HTML block ends on.
 *
 * @param context - The indentation query, positioned on an HTML node.
 * @returns The column to indent to, or `null` to keep the current line's indentation.
 */
function indentInsideMarkdownHtml(context: TreeIndentContext): number | null {
    let item: SyntaxNode | null = null;

    // The HTML tree is mounted inside the Markdown one, so the ancestors of
    // an HTML node continue into the Markdown blocks that hold it.
    for (let node: SyntaxNode | null = context.node; node; node = node.parent) {
        if (node.name === "Blockquote") {
            return null;
        }

        if (node.name === "ListItem" && !item) {
            item = node;
        }
    }

    const line = context.state.doc.lineAt(context.pos);

    // Only the innermost item counts, and only on its marker line: every
    // later line of the item already carries the indentation to copy.
    if (!item || item.from < line.from) {
        return null;
    }

    const content = item.getChild("ListMark")?.nextSibling;

    // Markdown's column, not the editor's: a tab before the content counts
    // to the next of Markdown's stops, whatever `tabSize` the editor has.
    // CodeMirror's own column count, which its Markdown parser calls with the
    // same stop.
    return content ? countColumn(line.text, MARKDOWN_TAB_STOP, content.from - line.from) : null;
}

/**
 * The Markdown blocks around a caret that decide what Enter does there, read
 * from the ancestors of the syntax node in front of the caret.
 */
type CaretBlocks = {
    /** Inside a fenced or an indented code block. */
    code: boolean;
    /** Inside an HTML block or an HTML comment block. */
    htmlBlock: boolean;
    /** Inside a blockquote or a list item. */
    container: boolean;
};

/** The start of a line, as containerPrefixAt reads it. */
type LinePrefix = {
    /** The text that starts a new line in the same blockquotes and list item. */
    text: string;
    /** Whether the line carries a list item's marker. */
    hasListMark: boolean;
};

/** A line that holds spaces and tabs and nothing else, at least one of them. */
const BLANK_INDENTED_LINE = /^[ \t]+$/;

/** A line that holds nothing, or spaces and tabs only. */
const BLANK_LINE = /^[ \t]*$/;

/**
 * Finds the Markdown blocks that hold the character in front of a position.
 *
 * @param state - The editor state.
 * @param pos - The position to look in front of.
 * @returns Which kinds of block hold that character.
 */
function caretBlocksAt(state: EditorState, pos: number): CaretBlocks {
    const blocks: CaretBlocks = { code: false, htmlBlock: false, container: false };

    // The HTML tree is mounted inside the Markdown one, so the ancestors of
    // an HTML node continue into the Markdown blocks that hold it.
    for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent) {
        if (node.name === "FencedCode" || node.name === "CodeBlock") {
            blocks.code = true;
        } else if (node.name === "HTMLBlock" || node.name === "CommentBlock") {
            blocks.htmlBlock = true;
        } else if (node.name === "Blockquote" || node.name === "ListItem") {
            blocks.container = true;
        }
    }

    return blocks;
}

/**
 * The text that starts a new line in the same blockquotes and list item as
 * the caret's line: that line's own start, up to its content, with each list
 * marker replaced by spaces. `> - <div>` gives `>   `, and `  x` gives `  `.
 *
 * The characters are copied, not measured, so the new line's columns equal
 * the current line's whatever the editor's tab size is. Markdown counts a tab
 * as four columns; a copied tab is still that tab.
 *
 * Only the syntax tree says what is a marker: inside a `<pre>` block or a
 * code block a line may start with `>` or `-` as plain text.
 *
 * @param state - The editor state.
 * @param pos - The caret position.
 * @returns The line's prefix, or `null` when the caret is in front of a marker on its line.
 */
function containerPrefixAt(state: EditorState, pos: number): LinePrefix | null {
    const line      = state.doc.lineAt(pos);
    let text        = "";
    let markEnd     = 0;
    let hasListMark = false;

    syntaxTree(state).iterate({
        from:  line.from,
        to:    line.to,
        enter: (node) => {
            const isListMark = node.name === "ListMark";

            if (!isListMark && node.name !== "QuoteMark") {
                return;
            }

            const from = node.from - line.from;
            const to   = node.to - line.from;

            text += line.text.slice(markEnd, from) + (isListMark ? " ".repeat(to - from) : line.text.slice(from, to));
            markEnd     = to;
            hasListMark = hasListMark || isListMark;
        },
    });

    if (pos - line.from < markEnd) {
        return null;
    }

    const rest = line.text.slice(markEnd);

    return { text: text + rest.slice(0, rest.search(/[^ \t]|$/)), hasListMark };
}

/**
 * Whether the caret sits directly between a pair the editor's plain Enter
 * splits over three lines: an empty `()`, `[]` or `{}`, or an element's open
 * tag and its close tag, as in `<div>|</div>`.
 *
 * @param state - The editor state.
 * @param pos - The caret position.
 * @returns `true` when the character or tag before the caret is closed by the one after it.
 */
function isBetweenPair(state: EditorState, pos: number): boolean {
    const beside = state.sliceDoc(Math.max(0, pos - 1), pos + 1);

    if (beside === "()" || beside === "[]" || beside === "{}") {
        return true;
    }

    const around = syntaxTree(state).resolveInner(pos);
    const open   = around.childBefore(pos);
    const close  = around.childAfter(pos);

    return open?.name === "OpenTag" && close?.name === "CloseTag" && open.to === pos && close.from === pos;
}

/**
 * Decides whether insertNewlineKeepPrefix handles Enter for a selection
 * range, and with which prefix. It does in four places:
 *
 * 1. in a code block, fenced or indented, at any depth;
 * 2. inside HTML that sits in a blockquote or list item, with HTML on both
 *    sides of the range;
 * 3. at the end of an HTML block in a blockquote or list item, on a line
 *    that has text in front of the caret and no list marker;
 * 4. on a line of only spaces and tabs that no blockquote or list item holds.
 *
 * Everywhere else Markdown's own Enter command, or the editor's, does the
 * right thing already.
 *
 * @param state - The editor state.
 * @param markdownLanguage - The Markdown language the editor runs.
 * @param range - The selection range Enter was pressed on.
 * @returns The prefix for the new line, or `null` to pass Enter on.
 */
function prefixForNewLine(state: EditorState, markdownLanguage: Language, range: SelectionRange): string | null {
    const prefix = containerPrefixAt(state, range.from);

    if (prefix === null) {
        return null;
    }

    const blocks         = caretBlocksAt(state, range.from);
    const line           = state.doc.lineAt(range.from);
    const markdownBefore = markdownLanguage.isActiveAt(state, range.from, -1);
    const markdownAfter  = markdownLanguage.isActiveAt(state, range.to, 1);
    let handled: boolean;

    if (blocks.code) {
        handled = true;
    } else if (!blocks.container) {
        // At the end of the document the tree puts a trailing blank line
        // outside the list it continues, so Markdown's own command passes
        // it on.
        handled = markdownBefore && BLANK_INDENTED_LINE.test(line.text);
    } else if (markdownBefore) {
        handled = false;
    } else if (!markdownAfter) {
        handled = true;
    } else {
        // HTML ends at the caret. On an item's marker line Markdown's own
        // command continues the list, and on a line with no text it leaves
        // the blockquote; both stay with it.
        handled = blocks.htmlBlock && !prefix.hasListMark && range.from - line.from > prefix.text.length;
    }

    return handled ? prefix.text : null;
}

/**
 * Builds the change that replaces a selection range with a line break and a
 * prefix. Between a pair (see isBetweenPair) the closing half moves to a line
 * of its own, with the same prefix.
 *
 * @param state - The editor state.
 * @param range - The selection range Enter was pressed on.
 * @param prefix - The text the new line starts with.
 * @returns The change, and the caret after the prefix on the new line.
 */
function newLineWithPrefix(state: EditorState, range: SelectionRange, prefix: string): { changes: ChangeSpec; range: SelectionRange } {
    const first   = state.doc.lineAt(range.from);
    const last    = state.doc.lineAt(range.to);
    const after   = last.text.slice(range.to - last.from);
    const newLine = state.lineBreak + prefix;
    const split   = range.empty && isBetweenPair(state, range.from);
    // A line of only spaces and tabs is emptied, as the editor's plain Enter
    // empties it: its whitespace moves to the new line with the caret.
    const from    = BLANK_LINE.test(first.text) ? first.from : range.from;

    return {
        // Spaces and tabs after the caret are dropped, as the editor's
        // plain Enter drops them: the prefix replaces them.
        changes: { from, to: range.to + after.search(/[^ \t]|$/), insert: split ? newLine + newLine : newLine },
        // A line break is one document position, whatever the length of
        // the editor's line separator.
        range:   EditorSelection.cursor(from + 1 + prefix.length),
    };
}

/**
 * Builds the Enter command the built-in `"markdown"` language adds for the
 * places where a new line has to start with the caret line's own prefix to
 * stay where it is: in a code block, in HTML inside a blockquote or list
 * item, and on a blank indented line (see prefixForNewLine). Markdown's own
 * Enter command passes most of them on, and the editor's plain Enter can only
 * write whitespace, which it measures with the editor's tab size; so without
 * this command the new line loses its `>`, or lands at another column than
 * the one Markdown reads.
 *
 * The prefix is copied (see containerPrefixAt). The command never writes a
 * new list marker and never removes a prefix. A selection is replaced by the
 * line break.
 *
 * The command passes Enter on (returns `false`) in a read-only editor, for a
 * range outside those places, and for a caret in front of a marker on its
 * line. With several carets it acts only when it can act on all of them.
 *
 * @param markdownLanguage - The Markdown language the editor runs.
 * @returns The command, for an Enter key binding.
 */
function insertNewlineKeepPrefix(markdownLanguage: Language): StateCommand {
    return ({ state, dispatch }) => {
        if (state.readOnly) {
            return false;
        }

        let declined = false;

        const changes = state.changeByRange((range) => {
            const prefix = prefixForNewLine(state, markdownLanguage, range);

            if (prefix === null) {
                declined = true;

                return { range };
            }

            return newLineWithPrefix(state, range, prefix);
        });

        if (declined) {
            return false;
        }

        dispatch(state.update(changes, { scrollIntoView: true, userEvent: "input" }));

        return true;
    };
}

/** The parser of a leaf block (a paragraph's text) that a block parser's `leaf` hands out. */
type LeafParser = NonNullable<ReturnType<NonNullable<BlockParser["leaf"]>>>;

/** The parse state and the leaf block a leaf parser finishes. */
type LeafParserFinish = Parameters<LeafParser["finish"]>;

/**
 * A task item's marker, which a leaf block opening a list item's paragraph
 * begins with: `[ ]`, `[x]` or `[X]`, the blanks after it, and a character
 * that is not blank. The test the viewer's lexer (`marked`) makes; lezer's own
 * task parser takes any blank after the marker, a bare `- [ ]` and a marker
 * followed by a tab included, which `marked` reads differently.
 */
const TASK_MARKER_LEAF = /^\[[ xX]\][ \t]+\S/;

/** The parse state and the line a block parser's `parse` is given. */
type BlockParseArguments = Parameters<NonNullable<BlockParser["parse"]>>;

/**
 * What stands before the content of the line a block parser last read, per parse: the container markup and the list
 * marker of an item's first line, only the indentation and quote marks of a later paragraph's. A leaf parser is
 * given the leaf alone, so this is how it tells an item's first block from a later one.
 */
const LINE_HEADS = new WeakMap<BlockParseArguments[0], string>();

/** The end of an item's first line before its content: a list marker and the blanks after it. */
const ITEM_FIRST_LINE_HEAD = /(?:^|[\s>])(?:[-*+]|\d{1,9}[.)])[ \t]*$/;

/**
 * The length of a task marker: `[`, the letter or space, and `]`. The same number as `TASK_MARKER_LENGTH` in
 * `markdownTaskCheckboxNode.ts`, which this module does not import so as to load no Lexical module.
 */
const TASK_MARKER_LENGTH = 3;

/**
 * Parses a leaf block that begins with a task marker: a `Task` node holding a
 * `TaskMarker` and the inline content after it. Lezer's own `TaskParser`,
 * which `@lezer/markdown` does not export.
 */
class TaskLeafParser implements LeafParser {
    nextLine(): boolean {
        return false;
    }

    finish(...[cx, leaf]: LeafParserFinish): boolean {
        cx.addLeafElement(leaf, cx.elt("Task", leaf.start, leaf.start + leaf.content.length, [
            cx.elt("TaskMarker", leaf.start, leaf.start + TASK_MARKER_LENGTH),
            ...cx.parser.parseInline(leaf.content.slice(TASK_MARKER_LENGTH), leaf.start + TASK_MARKER_LENGTH),
        ]));

        return true;
    }
}

/**
 * Lezer's own `TaskList` extension with two changes: the leaf test is
 * {@link TASK_MARKER_LEAF}, the viewer's, and the `TaskMarker` node is styled
 * `processingInstruction`, the tag of a list's marker, so the editor theme
 * mutes `[ ]` and `[x]` as it mutes `-`. Built here, from the `tags` the
 * caller imports, so this module still loads no grammar package.
 *
 * @param tags - The `tags` of `@lezer/highlight`.
 * @returns The extension.
 */
function taskMarkerExtension(tags: typeof highlightTags): MarkdownConfig {
    return {
        defineNodes: [
            { name: "Task", block: true, style: tags.list },
            { name: "TaskMarker", style: tags.processingInstruction },
        ],
        parseBlock: [
            {
                // Reads no block: it notes what stands before the line's content, for the leaf test below.
                name: "TaskListLineHead",
                parse: (cx, line) => {
                    LINE_HEADS.set(cx, line.text.slice(0, line.pos));

                    return false;
                },
                before: "LinkReference",
            },
            {
                name: "TaskList",
                // The viewer reads a marker only at the start of an item's first block: later paragraphs of the item are text.
                leaf: (cx, leaf) => {
                    const startsItem = ITEM_FIRST_LINE_HEAD.test(LINE_HEADS.get(cx) ?? "");

                    return TASK_MARKER_LEAF.test(leaf.content) && cx.parentType().name === "ListItem" && startsItem ? new TaskLeafParser() : null;
                },
                after: "SetextHeading",
            },
        ],
    };
}

registerLanguage({
    id: "markdown",
    label: "Markdown",
    loadExtension: async () => {
        // Indentation in Markdown is meaningful (four spaces start an indented
        // code block; inside a list it picks the item a line belongs to), so
        // HTML inside Markdown is typed literally: no auto-inserted close tags,
        // and no HTML indentation rules. indentInsideMarkdownHtml replaces
        // them: Enter keeps the current line's indentation, as on any other
        // Markdown line.
        const [{ markdown, insertNewlineContinueMarkup, deleteMarkupBackward }, { html, htmlLanguage }, { indentNodeProp, LanguageSupport }] = await Promise.all([
            import("@codemirror/lang-markdown"),
            import("@codemirror/lang-html"),
            import("@codemirror/language"),
        ]);

        // dialect "noMatch" mirrors markdown()'s own default HTML language
        // (tag matching off); html({ autoCloseTags: false }).support keeps its
        // tag completion and the nested <script>/<style> support.
        const literalHtml = new LanguageSupport(
            htmlLanguage.configure({
                dialect: "noMatch",
                props:   [indentNodeProp.add({ "Document Element OpenTag CloseTag SelfClosingTag": indentInsideMarkdownHtml })],
            }),
            html({ autoCloseTags: false }).support,
        );

        // Markdown counts a tab after `#` or `>` to the next of its four-column
        // stops; the stock parser does not (see markdownTabStops.ts). The
        // parser markdown() configured here is this language's own, so the
        // second call changes no other language.
        const { tags } = await import("@lezer/highlight");
        const support = markdown({
            htmlTagLanguage: literalHtml, extensions: [MARKDOWN_TAB_STOPS, taskMarkerExtension(tags)], addKeymap: false,
        });

        readQuoteContinuationTabs(support.language.parser);

        // Markdown's own Enter and Backspace, bound here in place of
        // markdown()'s keymap (addKeymap: false) so they count a tab as
        // Markdown does (see atMarkdownTabStops). insertNewlineKeepPrefix is
        // tried first: in an indented code block and at the end of an HTML
        // block Markdown's own command takes the key and drops the line's
        // indentation. Prec.high puts all three ahead of the editor's
        // bindings, where markdown() puts its own keymap.
        const markdownKeys = keymap.of([
            { key: "Enter", run: insertNewlineKeepPrefix(support.language) },
            { key: "Enter", run: atMarkdownTabStops(insertNewlineContinueMarkup) },
            { key: "Backspace", run: atMarkdownTabStops(deleteMarkupBackward) },
        ]);

        return [Prec.high(markdownKeys), support];
    },
    loadFormatter: async () => formatWithPrettier("markdown", async () => [await import("prettier/plugins/markdown")]),
});

registerLanguage({
    id: "css",
    label: "CSS",
    loadExtension: async () => {
        const { css } = await import("@codemirror/lang-css");

        return css();
    },
    loadFormatter: async () => formatWithPrettier("css", async () => [await import("prettier/plugins/postcss")]),
    loadLintSource: async () => collectSyntaxErrors,
});

registerLanguage({
    id: "python",
    label: "Python",
    loadExtension: async () => {
        const { python } = await import("@codemirror/lang-python");

        return python();
    },
    // No formatter: format() falls back to CodeMirror's own re-indent.
    loadLintSource: async () => collectSyntaxErrors,
});
