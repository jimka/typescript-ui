// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { $getNodeByKey, $getSelection, $isRangeSelection } from "lexical";
import type { BaseSelection, EditorState, LexicalEditor, NodeKey, UpdateListener, UpdateListenerPayload } from "lexical";
import { registerHistory, createEmptyHistoryState } from "@lexical/history";

/**
 * The coalescing window (ms) for the undo/redo history: edits within this gap
 * merge into a single undo step, matching Lexical's own recommended default.
 */
const HISTORY_DELAY_MS = 300;

/**
 * A key no node has: Lexical's node keys are `"root"` and decimal numbers.
 * {@link historyPayloadFor} adds it to the dirty leaves the history is
 * handed, which makes them two. The history looks every dirty key up before
 * it uses the node, so a key with no node changes nothing else.
 */
const NO_NODE_KEY: NodeKey = "markdown-history-own-step";

/**
 * Whether `after` selects what `before` selects: the same kind of selection
 * at the same points. Lexical's own `is` also compares the text format and
 * style a range carries for the text typed next; a range that differs in
 * those alone still selects the same text, and an undo back to it would show
 * nothing.
 *
 * @param before - A selection.
 * @param after - The selection it is compared with, or `null` for none.
 * @returns Whether both select the same.
 */
function selectsTheSame(before: BaseSelection, after: BaseSelection | null): boolean {
    const bothRanges = $isRangeSelection(before) && $isRangeSelection(after);

    return bothRanges ? before.anchor.is(after.anchor) && before.focus.is(after.focus) : before.is(after);
}

/**
 * Whether Lexical's history would merge `payload`'s update into the undo step
 * before it although it is a step of its own: exactly one leaf is dirty, its
 * text reads as before, and the update either replaced a selection (a range
 * before it, and after it a selection of something else:
 * {@link selectsTheSame}) or changed the document.
 *
 * @param payload - The update, as an update listener receives it.
 * @returns Whether the update must be its own undo step.
 */
function isOwnUndoStep({ dirtyLeaves, prevEditorState, editorState }: UpdateListenerPayload): boolean {
    const [key] = dirtyLeaves;

    if (dirtyLeaves.size !== 1 || key === undefined) {
        return false;
    }

    const textIn = (state: EditorState): string | undefined => state.read(() => $getNodeByKey(key)?.getTextContent());
    const textBefore = textIn(prevEditorState);
    const textAfter = textIn(editorState);

    // Lexical pushes a leaf whose text changed by itself. Every typed character ends here, before anything costly runs.
    if (textBefore !== textAfter) {
        return false;
    }

    const before = prevEditorState.read($getSelection);
    const after = editorState.read($getSelection);
    const replacedSelection = before !== null && !before.isCollapsed() && !selectsTheSame(before, after);

    return replacedSelection || JSON.stringify(prevEditorState.toJSON()) !== JSON.stringify(editorState.toJSON());
}

/**
 * The update the history is told about: `payload` itself, or — for an update
 * that is its own undo step ({@link isOwnUndoStep}) — a copy whose dirty
 * leaves hold one more key, so the history's one-leaf rule does not apply.
 *
 * @param payload - The update, as an update listener receives it.
 * @returns The payload to hand the history's listener.
 */
function historyPayloadFor(payload: UpdateListenerPayload): UpdateListenerPayload {
    const ownStep = isOwnUndoStep(payload);

    return ownStep ? { ...payload, dirtyLeaves: new Set([...payload.dirtyLeaves, NO_NODE_KEY]) } : payload;
}

/**
 * Registers the undo/redo history so that no edit is merged into the undo
 * step before it by mistake: one undo after a paste, a cut or a drop puts
 * the document and the selection back as they were just before it, and takes
 * back nothing else.
 *
 * @remarks
 * Works around `@lexical/history`'s merge rules (0.49.0–0.52.0). Their last
 * rule merges an update into the current undo step when exactly one leaf is
 * dirty and that leaf is a text node reading as before. The rule counts
 * dirty leaves only, so it also merges an update that added or removed
 * blocks, or replaced a selection with the same text. A paste over the range
 * it was copied from is such an update: one undo then took back the edit
 * before the paste with it, or did nothing when there was none.
 * `registerHistory` hard-codes its rules and offers no hook, so it is handed
 * the editor through a proxy whose `registerUpdateListener` wraps the
 * history's listener ({@link historyPayloadFor}); every other member is the
 * editor's own, bound to it. `registerMarkdownShortcutsOutsideRawBlocks` in
 * `MarkdownEditor.ts` wraps `registerMarkdownShortcuts` the same way, and
 * its remark on WebKitGTK and `Proxy` holds here too. Remove the proxy when
 * the canary in `markdown-editor-history.test.ts` fails.
 *
 * @param editor - The editor.
 * @returns The unregister function.
 */
export function registerMarkdownHistory(editor: LexicalEditor): () => void {
    const registerUpdateListener = (listener: UpdateListener): (() => void) =>
        editor.registerUpdateListener((payload) => {
            listener(historyPayloadFor(payload));
        });

    const guarded = new Proxy(editor, {
        get: (target, property) => {
            if (property === "registerUpdateListener") {
                return registerUpdateListener;
            }

            const value: unknown = Reflect.get(target, property, target);

            return typeof value === "function" ? value.bind(target) : value;
        },
    });

    return registerHistory(guarded, createEmptyHistoryState(), HISTORY_DELAY_MS);
}
