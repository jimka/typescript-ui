// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import {
    $createRangeSelectionFromDom, $findMatchingParent, $getNearestNodeFromDOMNode, isDOMNode,
    isExactShortcutMatch, IS_APPLE,
    BEFORE_INPUT_COMMAND, CLEAR_EDITOR_COMMAND, CLEAR_HISTORY_COMMAND, CLICK_COMMAND, COMMAND_PRIORITY_BEFORE_CRITICAL,
    COMPOSITION_END_COMMAND, COMPOSITION_START_COMMAND, CONTROLLED_TEXT_INSERTION_COMMAND, COPY_COMMAND, CUT_COMMAND,
    DELETE_CHARACTER_COMMAND, DELETE_LINE_COMMAND, DELETE_WORD_COMMAND, DRAGOVER_COMMAND, DRAGSTART_COMMAND, DROP_COMMAND,
    FOCUS_COMMAND, FORMAT_ELEMENT_COMMAND, FORMAT_TEXT_COMMAND, INDENT_CONTENT_COMMAND, INPUT_COMMAND, INSERT_LINE_BREAK_COMMAND,
    INSERT_PARAGRAPH_COMMAND, INSERT_TAB_COMMAND, KEY_ARROW_DOWN_COMMAND, KEY_ARROW_LEFT_COMMAND, KEY_ARROW_RIGHT_COMMAND,
    KEY_ARROW_UP_COMMAND, KEY_BACKSPACE_COMMAND, KEY_DELETE_COMMAND, KEY_DOWN_COMMAND, KEY_ENTER_COMMAND, KEY_ESCAPE_COMMAND,
    KEY_SPACE_COMMAND, KEY_TAB_COMMAND, MOVE_TO_END, MOVE_TO_START, OUTDENT_CONTENT_COMMAND, PASTE_COMMAND, REDO_COMMAND,
    REMOVE_TEXT_COMMAND, SELECT_ALL_COMMAND, SELECTION_CHANGE_COMMAND, SELECTION_INSERT_CLIPBOARD_NODES_COMMAND,
    SET_TEXT_FORMAT_COMMAND, UNDO_COMMAND,
} from "lexical";
import type { AnyLexicalCommand, LexicalEditor, LexicalNode, RangeSelection } from "lexical";
import { $isLinkNode } from "@lexical/link";
import type { LinkNode } from "@lexical/link";
import { INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND, REMOVE_LIST_COMMAND, UPDATE_LIST_START_COMMAND } from "@lexical/list";
import { INSERT_TABLE_COMMAND } from "@lexical/table";
import { mergeRegister } from "@lexical/utils";
import { DOM } from "~/core/DOM.js";

/**
 * The Lexical commands a read-only `MarkdownEditor` lets through to their
 * handlers. Read-only needs each one, and none of their handlers edits the
 * document: `COPY_COMMAND` copies, `CLICK_COMMAND` and
 * `SELECTION_CHANGE_COMMAND` follow the browser's selection (Lexical
 * dispatches both whether it is editable or not), and `FOCUS_COMMAND` only
 * answers a question for the table plugin.
 *
 * Together with {@link READ_ONLY_REFUSED_COMMANDS} this classifies every
 * command a built and mounted editor has a handler for. A test holds the two
 * lists to the commands actually registered, so a command a later change or
 * a Lexical upgrade registers fails that test until it is classified here.
 */
export const READ_ONLY_ALLOWED_COMMANDS: readonly AnyLexicalCommand[] = [
    COPY_COMMAND, CLICK_COMMAND, SELECTION_CHANGE_COMMAND, FOCUS_COMMAND,
];

/**
 * Every other command a built and mounted `MarkdownEditor` has a handler
 * for, which a read-only editor refuses ({@link registerReadOnlyGuard}).
 *
 * @remarks
 * The rule is an allow-list, so this list also holds commands whose handlers
 * only move the selection, such as `KEY_ARROW_LEFT_COMMAND`: nothing
 * dispatches them while Lexical is not editable, the browser moving the
 * caret itself, and refusing what read-only does not need is the rule that
 * cannot go stale.
 */
export const READ_ONLY_REFUSED_COMMANDS: readonly AnyLexicalCommand[] = [
    // lexical: the gateways Lexical routes DOM events through
    KEY_DOWN_COMMAND, BEFORE_INPUT_COMMAND, INPUT_COMMAND, COMPOSITION_START_COMMAND, COMPOSITION_END_COMMAND,
    // lexical: keys
    KEY_ENTER_COMMAND, KEY_BACKSPACE_COMMAND, KEY_DELETE_COMMAND, KEY_SPACE_COMMAND, KEY_TAB_COMMAND, KEY_ESCAPE_COMMAND,
    KEY_ARROW_UP_COMMAND, KEY_ARROW_DOWN_COMMAND, KEY_ARROW_LEFT_COMMAND, KEY_ARROW_RIGHT_COMMAND,
    MOVE_TO_START, MOVE_TO_END, SELECT_ALL_COMMAND,
    // lexical: text and blocks
    CONTROLLED_TEXT_INSERTION_COMMAND, INSERT_PARAGRAPH_COMMAND, INSERT_LINE_BREAK_COMMAND, INSERT_TAB_COMMAND,
    DELETE_CHARACTER_COMMAND, DELETE_WORD_COMMAND, DELETE_LINE_COMMAND, REMOVE_TEXT_COMMAND,
    FORMAT_TEXT_COMMAND, SET_TEXT_FORMAT_COMMAND, FORMAT_ELEMENT_COMMAND, INDENT_CONTENT_COMMAND, OUTDENT_CONTENT_COMMAND,
    // lexical: clipboard, drag, history
    CUT_COMMAND, PASTE_COMMAND, SELECTION_INSERT_CLIPBOARD_NODES_COMMAND,
    DRAGSTART_COMMAND, DRAGOVER_COMMAND, DROP_COMMAND,
    UNDO_COMMAND, REDO_COMMAND, CLEAR_HISTORY_COMMAND, CLEAR_EDITOR_COMMAND,
    // @lexical/list, @lexical/table
    INSERT_UNORDERED_LIST_COMMAND, INSERT_ORDERED_LIST_COMMAND, REMOVE_LIST_COMMAND, UPDATE_LIST_START_COMMAND,
    INSERT_TABLE_COMMAND,
];

/**
 * Registers the read-only guard: one listener at the head of each command in
 * {@link READ_ONLY_REFUSED_COMMANDS}, which takes the command while the
 * editor is read-only, so that none of its handlers runs.
 *
 * @remarks
 * Lexical's own switch, `setEditable(false)`, stops Lexical acting on the
 * root element's events. It does not stop a command: a plugin that
 * dispatches from a listener of its own does so whether the editor is
 * editable or not. `@lexical/table`'s selection observer forwards a paste
 * it hears on the document, with table cells selected and the root focused,
 * to `PASTE_COMMAND` in just that way. The guard refuses by command, not by
 * route, so it also covers a dispatcher added later. It mirrors
 * `registerRangeGuards` in `MarkdownEditor.ts`, which guards a list of
 * commands ahead of their handlers the same way.
 *
 * `COMMAND_PRIORITY_BEFORE_CRITICAL` puts each listener at the front of the
 * critical queue, which Lexical runs first. A listener registered later at
 * the same priority goes in front of it, so call this after every other
 * registration. Nothing this editor registers uses that priority: not its
 * own handlers, and not the Lexical plugins it sets up. One installed
 * package does, `@lexical/extension`, in its triple-click extension, which
 * this editor does not register.
 *
 * @param editor - The editor.
 * @param isReadOnly - Whether the editor is read-only now, asked on each command.
 * @param onRefused - Called once for each command the guard refuses.
 * @returns The unregister function.
 */
export function registerReadOnlyGuard(editor: LexicalEditor, isReadOnly: () => boolean, onRefused: () => void): () => void {
    const refuse = (): boolean => {
        const readOnly = isReadOnly();

        if (!readOnly) {
            return false;
        }

        onRefused();

        return true;
    };

    return mergeRegister(
        ...READ_ONLY_REFUSED_COMMANDS.map((command) => editor.registerCommand(command, refuse, COMMAND_PRIORITY_BEFORE_CRITICAL)),
    );
}

/**
 * Whether a key press is the undo key or a redo key. Two sets of keys
 * count:
 *
 * - The ones Lexical reads on an editable editor: Ctrl+Z, and Ctrl+Y or
 *   Ctrl+Shift+Z, with Cmd in place of Ctrl on an Apple keyboard, which has
 *   no Cmd+Y.
 * - The older pair a browser on Windows still gives its own undo and redo:
 *   Alt+Backspace and Alt+Shift+Backspace. They are counted on every
 *   keyboard but an Apple one, where Option+Backspace deletes a word, an
 *   edit the browser announces and the surface refuses like any other.
 *
 * @param event - The `keydown` event.
 * @returns Whether the key asks for an undo or a redo.
 */
export function isUndoOrRedoKey(event: KeyboardEvent): boolean {
    const undo = isExactShortcutMatch(event, "z", { ctrlKey: !IS_APPLE, metaKey: IS_APPLE });
    const redoWithShift = isExactShortcutMatch(event, "z", { ctrlKey: !IS_APPLE, metaKey: IS_APPLE, shiftKey: true });
    const redoWithY = !IS_APPLE && isExactShortcutMatch(event, "y", { ctrlKey: true });
    const undoWithAlt = !IS_APPLE && isExactShortcutMatch(event, "Backspace", { altKey: true });
    const redoWithAlt = !IS_APPLE && isExactShortcutMatch(event, "Backspace", { altKey: true, shiftKey: true });

    return undo || redoWithShift || redoWithY || undoWithAlt || redoWithAlt;
}

/** The `detail` of a click no pointer made: a key's, or a script's. A pointer's clicks count up from 1. */
const DETAIL_OF_NO_POINTER = 0;

/** The `detail` of the first click of a run: a single click, and the first of a double click, a triple click and so on. */
const DETAIL_OF_FIRST_CLICK = 1;

/** The {@link $selectionMark} of no selection in the editor. */
const NO_SELECTION_MARK = "";

/**
 * The schemes of an address a read-only editor opens, beside a relative
 * address, which has none: the web, mail and phone schemes, which are the
 * ones Lexical's own link node lets through to a link's element. A link
 * can be written with any other scheme (`ftp:` in an autolink, say, or
 * `javascript:`, `data:`, `file:`); such an address is not opened from a
 * document.
 */
const FOLLOWABLE_SCHEMES: readonly string[] = ["http:", "https:", "mailto:", "tel:", "sms:"];

/**
 * Whether `address` is one a read-only editor opens: a relative address, or
 * one that starts with a scheme in {@link FOLLOWABLE_SCHEMES}.
 *
 * @remarks
 * The test is on the address as written, and it is strict where a browser is
 * lenient: an address that holds a `:` anywhere must start with an allowed
 * scheme, letter for letter. A browser drops tabs and line breaks from an
 * address before it reads the scheme, so `java<tab>script:` is a script
 * address to it; such an address holds a `:` and starts with no allowed
 * scheme, and is refused here. A relative address that holds a `:` is
 * refused with it, as `resolveImageSpec` refuses an image's.
 *
 * An address with nothing in it but white space leads nowhere: `[here]()`
 * is a link, and a browser would resolve its empty address to the page the
 * editor is on. It is not opened.
 *
 * @param address - The address as the link holds it.
 * @returns Whether to open it.
 */
function isFollowableAddress(address: string): boolean {
    const isEmpty = address.trim() === "";
    const isRelative = !address.includes(":");
    const lowerCased = address.toLowerCase();

    return !isEmpty && (isRelative || FOLLOWABLE_SCHEMES.some((scheme) => lowerCased.startsWith(scheme)));
}

/**
 * The link that holds `node`, if there is one: `node` itself, or the
 * nearest link above it. The same search as `$findEnclosingLinkNode` in
 * `MarkdownEditor.ts`, which this module cannot import: that file imports
 * this one.
 *
 * @param node - A node of the document.
 * @returns The enclosing link, of any form, or `null`.
 */
function $linkHolding(node: LexicalNode): LinkNode | null {
    return $findMatchingParent(node, $isLinkNode);
}

/**
 * The browser's selection as a selection of the editor's document, for a
 * click. It is read from the browser, not taken from Lexical's own
 * selection, which follows the browser's a moment later: a click arrives
 * before Lexical has heard of what the press and the drag before it
 * selected. The live selection is read through the seam's named escape, and
 * Lexical keeps none of it.
 *
 * @param editor - The editor, whose document the browser's selection is read in.
 * @returns The selection, or `null`: offline, and where the browser has no
 *   selection in the editor.
 */
function $browserSelection(editor: LexicalEditor): RangeSelection | null {
    return DOM.source.readDocumentSelection((domSelection) => $createRangeSelectionFromDom(domSelection, editor));
}

/**
 * The address a read-only editor opens for a link, given the address the
 * link was written with: that address, which is what
 * `getSelectionState().linkUrl` reports and what the `Markdown` viewer
 * opens. It is not the `href` of the link's element, which Lexical rewrites
 * (`other.md` there is `https://other.md`).
 *
 * @param address - The address as the link holds it, or `null` for no link.
 * @returns The address, or `null` for no link and for an address that is
 *   not opened from a document ({@link isFollowableAddress}).
 */
export function addressToFollow(address: string | null): string | null {
    const followable = address !== null && isFollowableAddress(address);

    return followable ? address : null;
}

/**
 * A mark of the browser's selection in the editor's document, to tell
 * whether a click changed it: two selections with the same ends have the
 * same mark. A read-only editor takes it when the pointer is pressed, which
 * is before the browser changes the selection for that press, and hands it
 * to {@link $takeLinkClick} with the click that follows.
 *
 * @param editor - The editor.
 * @returns The mark; {@link NO_SELECTION_MARK} where the browser has no
 *   selection in the editor, and offline.
 */
export function $selectionMark(editor: LexicalEditor): string {
    const selection = $browserSelection(editor);

    if (selection === null) {
        return NO_SELECTION_MARK;
    }

    return [selection.anchor, selection.focus].map((point) => `${point.key}:${point.offset}:${point.type}`).join(">");
}

/**
 * Whether a click on a link asks for the link to be followed.
 *
 * @remarks
 * One rule: a run of clicks follows its link at most once, and that is on
 * its first click. The clicks of a run are counted by the browser in
 * `detail`: 1 for a single click and for the first click of a double click,
 * a triple click and every longer run, then 2, 3 and so on, and 0 for a
 * click no pointer made.
 *
 * - **A later click of a run never follows**, whatever is selected and
 *   however long the run. It is on its way to selecting a word, a block, or
 *   the same block again, and nothing about the selection tells the fourth
 *   click of a run from a first one: from the fourth click on, the selection
 *   is the same before the press and after it.
 * - **The first click follows, unless it selected text itself**: unless it
 *   left text selected that was not selected before the press, which is the
 *   end of a drag over text, or a Shift+click. Text that was selected before
 *   the press and still is was not selected by the click: a browser leaves
 *   a selection standing until a click inside it is over, so a click on a
 *   link in a document selected with Ctrl+A, or on a link's own word
 *   selected earlier, finds that text still selected, and is followed.
 * - **A click no pointer made follows**: it selected nothing. It is the key
 *   Enter on a focused link, where the surface is not an editing host, or a
 *   script's `click()`.
 *
 * It is the first click that follows, and not the last, because a click is
 * reported when it happens: whether another follows is known only once the
 * double-click interval has passed, and a link that opened that much later
 * on every click would be the worse of the two.
 *
 * Where no press was seen for a first click, the selection before it is not
 * known, and any text selected counts as selected by the click: the choice
 * that never opens a link twice.
 *
 * @param editor - The editor.
 * @param event - The native `click` or `auxclick` event.
 * @param markBeforePress - The {@link $selectionMark} taken when the
 *   pointer was pressed, or `null` where no press was seen.
 * @returns Whether to follow the link the click was on.
 */
function $clickAsksToFollow(editor: LexicalEditor, event: MouseEvent, markBeforePress: string | null): boolean {
    const selection = $browserSelection(editor);
    const holdsText = selection !== null && !selection.isCollapsed();
    const mark = $selectionMark(editor);
    const selectedText = holdsText && mark !== markBeforePress;
    const madeByPointer = event.detail !== DETAIL_OF_NO_POINTER;
    const isFirstOfRun = event.detail === DETAIL_OF_FIRST_CLICK;

    return !madeByPointer || (isFirstOfRun && !selectedText);
}

/**
 * Takes a click on a link of a read-only editor, and says where it leads.
 * Call it for a click and for a middle click on the read-only surface,
 * inside a read of the editor.
 *
 * @remarks
 * One rule: in a read-only editor a click on a link is the editor's alone.
 * The click's default is cancelled, so the browser never follows the link
 * by itself, which it would where the surface is not an editing host
 * (`setContentEditable(false)`): in the same tab for a click, and to the
 * address Lexical rewrites on the link's element. The editor then follows
 * the link where the click asks for that ({@link $clickAsksToFollow}) and
 * the link's address is one to open. A run of clicks on a link, of any
 * length, therefore opens it once, on its first click. A click beside a
 * link is not on it and is left alone.
 *
 * @param editor - The editor.
 * @param event - The native `click` or `auxclick` event.
 * @param markBeforePress - The {@link $selectionMark} taken when the
 *   pointer was pressed for this click, or `null` where no press was seen.
 * @returns The address to open, or `null`: the click was on no link, or on
 *   a link that is not followed.
 */
export function $takeLinkClick(editor: LexicalEditor, event: MouseEvent, markBeforePress: string | null): string | null {
    const target = event.target;
    const clicked = isDOMNode(target) ? $getNearestNodeFromDOMNode(target) : null;
    const link = clicked === null ? null : $linkHolding(clicked);

    if (link === null) {
        return null;
    }

    event.preventDefault();

    const asksToFollow = $clickAsksToFollow(editor, event, markBeforePress);

    return asksToFollow ? addressToFollow(link.getURL()) : null;
}
