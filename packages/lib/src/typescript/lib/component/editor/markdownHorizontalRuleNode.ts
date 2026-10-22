// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { $createNodeSelection, $getState, $setSelection, $setState, DecoratorNode } from "lexical";
import type { DOMConversionMap, DOMExportOutput, EditorConfig, LexicalEditor, LexicalNode, NodeKey, SerializedLexicalNode } from "lexical";
import { DOM } from "~/core/DOM.js";
import { horizontalRuleMarkerState } from "~/component/editor/markdownNodeState.js";

/** The line a horizontal rule made in the editor is written as. */
export const STANDARD_HORIZONTAL_RULE = "---";

/**
 * Identity factory for the seam's element mint. Generic rather than
 * annotated with a concrete DOM type, so no DOM type is named here — see
 * `DOM.sink.createViewElement`.
 */
function keepElement<T>(element: T): T {
    return element;
}

/**
 * `---`, `***` or `___` — a thematic break, shown as a horizontal rule and
 * selected and deleted as one unit.
 *
 * A `DecoratorNode`, as {@link MarkdownImageNode} is, since a rule holds no
 * text a selection can enter: Lexical's own handlers then give it node
 * selection, Backspace and Delete beside it, the arrow keys across it and
 * Enter on a selected rule. Unlike the image it is a block
 * (`isInline()` is `false`). `decorate()` returns `null`: `createDOM`'s
 * `<hr>`, minted through the DOM seam's `createViewElement`, is the node's
 * entire visual representation. The line the rule was written with is node
 * state ({@link horizontalRuleMarkerState}).
 */
export class MarkdownHorizontalRuleNode extends DecoratorNode<null> {
    static getType(): string {
        return "markdown-horizontal-rule";
    }

    static clone(node: MarkdownHorizontalRuleNode): MarkdownHorizontalRuleNode {
        return new MarkdownHorizontalRuleNode(node.__key);
    }

    static importJSON(json: SerializedLexicalNode): MarkdownHorizontalRuleNode {
        // `updateFromJSON` restores the node's state (the line it was written with), as Lexical's own nodes do.
        return new MarkdownHorizontalRuleNode().updateFromJSON(json);
    }

    /**
     * Reads an `<hr>`, as a paste of HTML brings one. Lexical's own conversion
     * of `<hr>` asks for its `HorizontalRuleNode`, which is not registered, so
     * the element is passed on to this one.
     *
     * @returns The conversion map.
     */
    static importDOM(): DOMConversionMap | null {
        return {
            hr: () => ({ conversion: () => ({ node: $createMarkdownHorizontalRuleNode() }), priority: 0 }),
        };
    }

    constructor(key?: NodeKey) {
        super(key);
    }

    exportJSON(): SerializedLexicalNode {
        return { ...super.exportJSON(), type: "markdown-horizontal-rule", version: 1 };
    }

    isInline(): false {
        return false;
    }

    decorate(): null {
        return null;
    }

    /**
     * Shows a line end where the rule stood, as Lexical's own rule does, so a
     * copied range's plain text keeps a line there.
     *
     * @returns A line end.
     */
    getTextContent(): string {
        return "\n";
    }

    createDOM(config: EditorConfig) {
        const addClass: string[] = [];

        if (config.theme.mdHorizontalRule) {
            addClass.push(config.theme.mdHorizontalRule);
        }

        if (this.isSelected() && config.theme.mdHorizontalRuleSelected) {
            addClass.push(config.theme.mdHorizontalRuleSelected);
        }

        const element = DOM.sink.createViewElement("hr", { addClass }, keepElement);

        if (element === null) {
            throw new Error("MarkdownHorizontalRuleNode.createDOM requires a mounted view");
        }

        return element;
    }

    /**
     * Writes a plain `<hr>` for copied HTML: no editor class and not the
     * selected look, which a copy of a selected rule would otherwise carry out
     * of the editor.
     *
     * @param _editor - The editor.
     * @returns The plain element.
     */
    exportDOM(_editor: LexicalEditor): DOMExportOutput {
        const element = DOM.sink.createViewElement("hr", {}, keepElement);

        if (element === null) {
            throw new Error("MarkdownHorizontalRuleNode.exportDOM requires a mounted view");
        }

        return { element };
    }

    updateDOM(): true {
        // Always true: the node has no way to touch an existing element under the seam rule, so Lexical must
        // rebuild it whenever it is marked dirty — which is how a rule is drawn selected or not.
        return true;
    }
}

/**
 * Creates a horizontal rule.
 *
 * @param marker - The line the rule was written with; omitted, or `""`, for a rule made in the editor.
 * @returns The node.
 */
export function $createMarkdownHorizontalRuleNode(marker: string = ""): MarkdownHorizontalRuleNode {
    const node = new MarkdownHorizontalRuleNode();

    if (marker !== "") {
        $setState(node, horizontalRuleMarkerState, marker);
    }

    return node;
}

/**
 * Whether a node is a horizontal rule.
 *
 * @param node - The node.
 * @returns `true` for a {@link MarkdownHorizontalRuleNode}.
 */
export function $isMarkdownHorizontalRuleNode(node: LexicalNode | null | undefined): node is MarkdownHorizontalRuleNode {
    return node instanceof MarkdownHorizontalRuleNode;
}

/**
 * Makes a node selection of one node, as a click on it does.
 *
 * @param node - The node.
 */
export function $selectNodeAlone(node: LexicalNode): void {
    const selection = $createNodeSelection();

    selection.add(node.getKey());
    $setSelection(selection);
}

/**
 * The line a save writes for a rule.
 *
 * @param node - The rule.
 * @returns The line it was written with, or {@link STANDARD_HORIZONTAL_RULE} for a rule made in the editor.
 */
export function $horizontalRuleMarkdown(node: MarkdownHorizontalRuleNode): string {
    const kept = $getState(node, horizontalRuleMarkerState);

    return kept === "" ? STANDARD_HORIZONTAL_RULE : kept;
}
