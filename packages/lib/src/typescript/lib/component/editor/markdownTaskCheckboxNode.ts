// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { $getState, $isElementNode, $isTextNode, $setState, DecoratorNode } from "lexical";
import type { DOMConversionMap, DOMExportOutput, EditorConfig, ElementNode, LexicalEditor, LexicalNode, NodeKey, SerializedLexicalNode, Spread } from "lexical";
import { DOM } from "~/core/DOM.js";
import { BLANK_REFERENCES, taskBlankTextState, taskMarkerState } from "~/component/editor/markdownNodeState.js";

/**
 * The priority of the checkbox input conversion: one above Lexical's default of
 * `0`, which no conversion of an `<input>` has, so this one is the one picked
 * for a checkbox that opens a list item's text.
 */
const INPUT_CONVERSION_PRIORITY = 1;

/**
 * The length of a task marker: `[`, the letter or space, and `]`, without the space a save writes after it. The same number as
 * `TASK_MARKER_LENGTH` in `languages.ts`, which cannot import this module without loading Lexical.
 */
export const TASK_MARKER_LENGTH = 3;

/** The JSON a {@link MarkdownTaskCheckboxNode} is stored as. */
export type SerializedMarkdownTaskCheckboxNode = Spread<{ checked: boolean }, SerializedLexicalNode>;

/**
 * Identity factory for the seam's element mint. Generic rather than
 * annotated with a concrete DOM type, so no DOM type is named here — see
 * `DOM.sink.createViewElement`.
 */
function keepElement<T>(element: T): T {
    return element;
}

/**
 * The checkbox of a GFM task item (`- [ ] todo`, `- [x] done`), standing first
 * in the item's text, where the marker's atomic run stood before.
 *
 * A `DecoratorNode`, as {@link MarkdownImageNode} is: `decorate()` returns
 * `null` and `createDOM`'s `<span role="checkbox">`, minted through the DOM
 * seam's `createViewElement`, is the node's entire visual representation. It
 * is inline, and not keyboard-selectable: the arrow keys pass over it as over
 * one character and no node selection of it is ever made. Its checked state is
 * a field; the marker it was written with (`[ ]`, `[x]` or `[X]`) is node
 * state ({@link taskMarkerState}). Its text content is the marker with its
 * space, so a plain-text copy of a task item reads `[x] done`.
 */
export class MarkdownTaskCheckboxNode extends DecoratorNode<null> {
    __checked: boolean;

    constructor(checked: boolean = false, key?: NodeKey) {
        super(key);

        this.__checked = checked;
    }

    static getType(): string {
        return "markdown-task-checkbox";
    }

    static clone(node: MarkdownTaskCheckboxNode): MarkdownTaskCheckboxNode {
        return new MarkdownTaskCheckboxNode(node.__checked, node.__key);
    }

    /**
     * Reads a checkbox input in a list item: the HTML this node writes
     * ({@link MarkdownTaskCheckboxNode.exportDOM}), which another editor's
     * paste gets as HTML because the clipboard's node format is tied to the
     * editor that wrote it, and the input of GitHub's loose task list item
     * (`<li class="task-list-item"><p><input> x</p></li>`), which Lexical's own
     * list conversion does not reach inside a paragraph. The checked state is
     * the input's `checked` attribute. An input outside a list item shows
     * nothing, as before, and one that does not open its item's text is dropped when the item is built.
     *
     * @returns The conversion map.
     */
    static importDOM(): DOMConversionMap | null {
        return {
            input: (node) => {
                const handle = DOM.source.intern(node);
                // Any checkbox input in a list item: whether it opens the item's text is settled once the item is built
                // (`$keepOnlyOpeningCheckbox`), when the text before it can be read.
                const isTaskInput = DOM.source.getAttribute(handle, "type") === "checkbox" && DOM.source.matches(handle, "li input");

                return isTaskInput
                    ? {
                        conversion: () => ({ node: $createMarkdownTaskCheckboxNode(DOM.source.hasAttribute(handle, "checked")) }),
                        priority:   INPUT_CONVERSION_PRIORITY,
                    }
                    : null;
            },
        };
    }

    static importJSON(json: SerializedMarkdownTaskCheckboxNode): MarkdownTaskCheckboxNode {
        // `updateFromJSON` restores the node's state (the marker it was written with), as Lexical's own nodes do.
        return new MarkdownTaskCheckboxNode(json.checked === true).updateFromJSON(json);
    }

    exportJSON(): SerializedMarkdownTaskCheckboxNode {
        return { ...super.exportJSON(), type: "markdown-task-checkbox", version: 1, checked: this.isChecked() };
    }

    /**
     * Whether the box is checked.
     *
     * @returns `true` for a checked box.
     */
    isChecked(): boolean {
        return this.getLatest().__checked;
    }

    /**
     * Checks or unchecks the box. The marker it was written with stops being
     * kept once it no longer says the box's state, so a box unchecked and
     * checked again is written `[x]`, not the `[X]` it was loaded with.
     *
     * @param checked - The new state.
     * @returns The writable node.
     */
    setChecked(checked: boolean): this {
        const writable = this.getWritable();

        writable.__checked = checked;

        const authored = $getState(writable, taskMarkerState);

        if (authored !== "" && (authored[1] !== " ") !== checked) {
            $setState(writable, taskMarkerState, "");
        }

        return writable;
    }

    isInline(): true {
        return true;
    }

    isKeyboardSelectable(): false {
        return false;
    }

    decorate(): null {
        return null;
    }

    /**
     * The marker the box saves as, with its space, so a plain-text copy of a
     * task item reads `[x] done` and code that measured the item's text sees
     * what it saw when the marker was a run of source.
     *
     * @returns `[x] ` or `[ ] `.
     */
    getTextContent(): string {
        return this.isChecked() ? "[x] " : "[ ] ";
    }

    createDOM(config: EditorConfig, editor: LexicalEditor) {
        const addClass: string[] = [];
        // A read-only editor refuses a click on the box: it says so to assistive technology and shows no pointer.
        const isReadOnly = !editor.isEditable();

        if (config.theme.mdTaskCheckbox) {
            addClass.push(config.theme.mdTaskCheckbox);
        }

        if (this.isChecked() && config.theme.mdTaskCheckboxChecked) {
            addClass.push(config.theme.mdTaskCheckboxChecked);
        }

        if (isReadOnly && config.theme.mdTaskCheckboxReadOnly) {
            addClass.push(config.theme.mdTaskCheckboxReadOnly);
        }

        const setAttr: Record<string, string> = { role: "checkbox", "aria-checked": this.isChecked() ? "true" : "false" };

        if (isReadOnly) {
            setAttr["aria-readonly"] = "true";
        }

        const element = DOM.sink.createViewElement("span", { addClass, setAttr }, keepElement);

        if (element === null) {
            throw new Error("MarkdownTaskCheckboxNode.createDOM requires a mounted view");
        }

        return element;
    }

    /**
     * Writes a disabled checkbox input for copied HTML, so a copy pasted into
     * another application shows a checkbox.
     *
     * @returns The plain element.
     */
    exportDOM(): DOMExportOutput {
        const setAttr: Record<string, string> = { type: "checkbox", disabled: "" };

        if (this.isChecked()) {
            setAttr.checked = "";
        }

        const element = DOM.sink.createViewElement("input", { setAttr }, keepElement);

        if (element === null) {
            throw new Error("MarkdownTaskCheckboxNode.exportDOM requires a mounted view");
        }

        return { element };
    }

    updateDOM(): true {
        // Always true: the node has no way to touch an existing element under the seam rule, so Lexical must
        // rebuild it whenever it is marked dirty — which is how a toggled box is redrawn.
        return true;
    }
}

/**
 * Creates a task checkbox.
 *
 * @param checked - Whether the box is checked.
 * @param marker - The marker it was written with (`[ ]`, `[x]` or `[X]`); omitted, or `""`, for a box made in the editor.
 * @returns The node.
 */
export function $createMarkdownTaskCheckboxNode(checked: boolean, marker: string = ""): MarkdownTaskCheckboxNode {
    const node = new MarkdownTaskCheckboxNode(checked);

    if (marker !== "") {
        $setState(node, taskMarkerState, marker);
    }

    return node;
}

/**
 * Whether a node is a task checkbox.
 *
 * @param node - The node.
 * @returns `true` for a task checkbox.
 */
export function $isMarkdownTaskCheckboxNode(node: LexicalNode | null | undefined): node is MarkdownTaskCheckboxNode {
    return node instanceof MarkdownTaskCheckboxNode;
}

/**
 * The checkbox a list item's text opens with.
 *
 * @param text - The node that may be an item's text.
 * @returns Its first child when that is a checkbox, else `null`.
 */
export function $openingCheckbox(text: LexicalNode | null): MarkdownTaskCheckboxNode | null {
    const first = $isElementNode(text) ? text.getFirstChild() : null;

    return $isMarkdownTaskCheckboxNode(first) ? first : null;
}

/**
 * The marker a save writes for a box, with its space: the marker it was
 * written with while that still says the box's state (its letter is a space
 * exactly when the box is unchecked), else `[ ] ` or `[x] `.
 *
 * @param node - The checkbox.
 * @returns The marker and a space.
 */
export function $taskMarkerMarkdown(node: MarkdownTaskCheckboxNode): string {
    const authored = $getState(node, taskMarkerState);
    const agrees = authored !== "" && (authored[1] !== " ") === node.isChecked();

    return (agrees ? authored : node.isChecked() ? "[x]" : "[ ]") + " ";
}

/**
 * An item's text that holds its checkbox alone, as the text Markdown reads it
 * as: Markdown has no empty task item, so `- [ ]` is an item holding `[ ]`.
 * A checked box has its brackets escaped, since `[x]` alone could be a
 * reference link; `[ ]` cannot, a label needing a non-blank character. A box
 * loaded with blank text after it that makes it a checkbox
 * ({@link taskBlankTextState}, `- [x] &#32;`) is written with that text, so
 * it is still a checkbox to the viewer.
 *
 * @param node - The checkbox.
 * @returns `[ ]`, the marker with its brackets escaped (`\[x\]`), or the marker and its blank text (`[ ] &#32;`).
 */
export function $emptyTaskItemMarkdown(node: MarkdownTaskCheckboxNode): string {
    const blank = $getState(node, taskBlankTextState);

    if (blank !== "") {
        return $taskMarkerMarkdown(node) + blank;
    }

    const marker = $taskMarkerMarkdown(node).trimEnd();

    return node.isChecked() ? marker.replace("[", "\\[").replace("]", "\\]") : marker;
}

/**
 * Tells whether a checkbox that is all its item's text holds is still a
 * checkbox to the viewer once saved: one loaded with the blank text that
 * makes it one ({@link taskBlankTextState}). Any other is written as the text
 * Markdown reads it as ({@link $emptyTaskItemMarkdown}).
 *
 * @param node - The checkbox.
 * @returns `true` when its save alone reads as a checkbox.
 */
export function $savesAsCheckboxAlone(node: MarkdownTaskCheckboxNode): boolean {
    return $getState(node, taskBlankTextState) !== "";
}

/**
 * A space that is no ASCII space and that JavaScript's `\s` matches (`U+2003`, `U+3000`, ...), after any ASCII spaces.
 * `marked` reads a task marker only when a `\S` character follows its spaces, so such a space right after the marker
 * would make the item text.
 */
const BLANK_AFTER_MARKER = /^( *)([^\S ])/;

/**
 * An item's written text, made to follow its task marker: a space that `marked`'s `\S` does not match (a wide space,
 * a no-break space is already written `&nbsp;`) first in the text would make the marker text, so it is written as a
 * numeric character reference, which reads back as the space it is. The text is otherwise as it was.
 *
 * @param written - The Markdown the item's text was written as.
 * @returns The text, safe to follow the marker.
 */
export function taskTextAfterMarker(written: string): string {
    return written.replace(BLANK_AFTER_MARKER, (_match, spaces: string, blank: string) => `${spaces}&#${blank.codePointAt(0)};`);
}

/**
 * Keeps, on a checkbox a load leaves alone in its item's text, the source of
 * the text after its marker when that is character references for blanks
 * ({@link BLANK_REFERENCES}): the text that makes it a checkbox to the viewer
 * though it shows nothing (`- [x] &#32;`).
 *
 * @param node - The checkbox.
 * @param source - The source of the item's text after the marker.
 */
export function $keepBlankTextOfCheckbox(node: MarkdownTaskCheckboxNode, source: string): void {
    const blank = source.trim();

    if (BLANK_REFERENCES.test(blank)) {
        $setState(node, taskBlankTextState, blank);
    }
}

/**
 * Keeps, in a list item built from HTML, only a checkbox that opens the item's text, and drops the others: an input
 * after other text (`Agree <input type="checkbox"> to terms`) is no task item's checkbox and shows nothing, as an
 * input outside a list item does. Whitespace-only text before the first checkbox is dropped with the others' text kept,
 * as the whitespace before an item's text means nothing.
 *
 * @param item - The list item, with its nested lists already built; its own inline content is read, not theirs.
 * @param isItemNode - Whether a node is a list item, which ends the item's own content.
 */
export function $keepOnlyOpeningCheckbox(item: ElementNode, isItemNode: (node: LexicalNode) => boolean): void {
    const leaves: LexicalNode[] = [];
    const collect = (node: LexicalNode): void => {
        if (!$isElementNode(node)) {
            leaves.push(node);

            return;
        }

        if (isItemNode(node)) {
            return;
        }

        node.getChildren().forEach(collect);
    };

    item.getChildren().forEach(collect);

    let opensText = true;

    for (const leaf of leaves) {
        const isBlank = $isTextNode(leaf) && leaf.getTextContent().trim() === "";

        if ($isMarkdownTaskCheckboxNode(leaf)) {
            if (!opensText) {
                leaf.remove();
            }

            opensText = false;
        } else if (isBlank && opensText) {
            leaf.remove();
        } else {
            opensText = false;
        }
    }
}
