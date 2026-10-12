// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import {
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
import type { AnyLexicalCommand, LexicalEditor } from "lexical";
import { INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND, REMOVE_LIST_COMMAND, UPDATE_LIST_START_COMMAND } from "@lexical/list";
import { INSERT_TABLE_COMMAND } from "@lexical/table";
import { mergeRegister } from "@lexical/utils";

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
