// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { $getNodeByKey, $getSelection, $isRangeSelection, $isTextNode, COMPOSITION_END_TAG, COMPOSITION_START_TAG, CUT_TAG, HISTORIC_TAG, HISTORY_MERGE_TAG, PASTE_TAG } from "lexical";
import type { BaseSelection, EditorState, LexicalEditor, NodeKey, UpdateListener, UpdateListenerPayload } from "lexical";
import { registerHistory, createEmptyHistoryState } from "@lexical/history";
import { WHITESPACE_DROPPED_TAG } from "~/component/editor/markdownWritable.js";

/**
 * The coalescing window (ms) for the undo/redo history: edits within this gap
 * merge into a single undo step, matching Lexical's own recommended default.
 */
const HISTORY_DELAY_MS = 300;

/** Whether an update that carries these tags typed text. */
export type TypedUpdateTest = (tags: ReadonlySet<string>) => boolean;

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
 * Whether an update is one character typed at the caret, as the history
 * counts it: a text leaf one character longer with the caret one on, or a
 * text node of one character the update made, the caret behind it (the first
 * character of an empty block) with a collapsed caret before it, so that
 * typing over a range is no typed character.
 *
 * @param payload - The update, as an update listener receives it.
 * @returns Whether it types one character.
 */
function typesOneCharacter({ dirtyLeaves, prevEditorState, editorState }: UpdateListenerPayload): boolean {
    const caretOf = (state: EditorState): { key: NodeKey; offset: number } | null => state.read(() => {
        const selection = $getSelection();
        const isCaret = $isRangeSelection(selection) && selection.isCollapsed() && selection.anchor.type === "text";

        return isCaret ? { key: selection.anchor.key, offset: selection.anchor.offset } : null;
    });
    const lengthIn = (state: EditorState, key: NodeKey): number | null => state.read(() => {
        const node = $getNodeByKey(key);

        return $isTextNode(node) ? node.getTextContentSize() : null;
    });
    const wasCollapsed = prevEditorState.read(() => {
        const selection = $getSelection();

        return $isRangeSelection(selection) && selection.isCollapsed();
    });
    const caretAfter = caretOf(editorState);
    const caretBefore = caretOf(prevEditorState);

    if (caretAfter === null || !dirtyLeaves.has(caretAfter.key)) {
        return false;
    }

    const lengthAfter = lengthIn(editorState, caretAfter.key);
    const lengthBefore = lengthIn(prevEditorState, caretAfter.key);
    const isNewNode = wasCollapsed && lengthBefore === null && lengthAfter === 1 && caretAfter.offset === 1;
    const isLongerNode = dirtyLeaves.size === 1 && caretBefore !== null && caretBefore.key === caretAfter.key
        && lengthBefore !== null && lengthAfter === lengthBefore + 1 && caretAfter.offset === caretBefore.offset + 1;

    return isNewNode || isLongerNode;
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
 * It also lets typing at a line's start merge as typing does. The update that
 * types a character after the whitespace a line starts with takes that
 * whitespace out in the same update ({@link WHITESPACE_DROPPED_TAG}), so the
 * history reads it as a change of another kind: it would not merge with the
 * space typed before it, and the character typed after it would start a step
 * of its own. The history's rule for single typed characters is that one
 * merges into the step before it when that was a typed character too and
 * came less than the delay before it (at exactly the delay there is no
 * merge); the update that drops the whitespace is held to the same rule,
 * and the typed character after it is merged as if the drop had not changed
 * the kind of change before it. Only updates the editor knows to be typed
 * ({@link TypedUpdateTest}, the precedent of the Markdown typing shortcuts)
 * take part, and only after a typed character in the update right before:
 * a caret move, a command, a paste, a cut, a drop, an undo or a load before
 * it ends the run, so nothing is merged into them or into the loaded state.
 * This follows the history's rule for single typed characters only: an input
 * method's commit of several characters, an emoji, a composition after the
 * drop, and an update that both deletes and drops (Backspace) can take
 * another number of steps than they do without the whitespace.
 *
 * @param editor - The editor.
 * @param isTypedUpdate - Whether an update that carries the given tags typed text.
 * @returns The unregister function.
 */
export function registerMarkdownHistory(editor: LexicalEditor, isTypedUpdate: TypedUpdateTest): () => void {
    // When the update before was a typed character, a typed drop of whitespace, or any update at all.
    let typedCharacterAt: number | null = null;
    let typedDropAt: number | null = null;
    let previousAt: number | null = null;
    // What stood at the start of the composition being typed, which its end continues from, as the history does.
    let atCompositionStart: { previousAt: number | null; typedCharacterAt: number | null } | null = null;

    const withMergeTag = (payload: UpdateListenerPayload): UpdateListenerPayload =>
        ({ ...payload, tags: new Set([...payload.tags, HISTORY_MERGE_TAG]) });

    const isWithinDelay = (since: number | null, now: number): boolean => since !== null && now - since < HISTORY_DELAY_MS;

    const mergedTypingOf = (payload: UpdateListenerPayload): UpdateListenerPayload => {
        const now = Date.now();
        const endsComposition = payload.tags.has(COMPOSITION_END_TAG) && atCompositionStart !== null;
        const before = endsComposition ? atCompositionStart! : { previousAt, typedCharacterAt };
        const isClipboard = payload.tags.has(PASTE_TAG) || payload.tags.has(CUT_TAG);
        const isTyped = !isClipboard && !payload.tags.has(HISTORIC_TAG) && isTypedUpdate(payload.tags);
        const dropsWhitespace = isTyped && payload.tags.has(WHITESPACE_DROPPED_TAG);
        const isWithinRun = isWithinDelay(before.previousAt, now);
        const followsCharacter = isWithinRun && isWithinDelay(before.typedCharacterAt, now);
        const followsDrop = isWithinRun && isWithinDelay(typedDropAt, now) && isTyped && typesOneCharacter(payload);
        const typesCharacter = isTyped && !dropsWhitespace && typesOneCharacter(payload);

        if (payload.tags.has(COMPOSITION_START_TAG)) {
            atCompositionStart = { previousAt, typedCharacterAt };
        } else if (endsComposition) {
            atCompositionStart = null;
        }

        typedCharacterAt = typesCharacter ? now : null;
        typedDropAt = dropsWhitespace ? now : null;
        previousAt = now;

        return (dropsWhitespace && followsCharacter) || followsDrop ? withMergeTag(payload) : payload;
    };

    const registerUpdateListener = (listener: UpdateListener): (() => void) =>
        editor.registerUpdateListener((payload) => {
            listener(historyPayloadFor(mergedTypingOf(payload)));
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
