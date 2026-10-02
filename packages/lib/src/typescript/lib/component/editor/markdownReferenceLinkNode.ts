// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LinkNode } from "@lexical/link";
import type { LinkAttributes, SerializedLinkNode } from "@lexical/link";
import type { LexicalNode, NodeKey, Spread } from "lexical";

/** Which of CommonMark's three reference-link forms a link was written in. */
export type ReferenceLinkForm = "full" | "collapsed" | "shortcut";

/**
 * What a {@link ReferenceLinkNode} remembers about how it was written, so it
 * can be saved back in the same form.
 */
export interface ReferenceLinkReference {
    /** The bracket content naming the definition, exactly as authored. */
    label:           string;

    /** `[text][label]`, `[label][]` or `[label]`. */
    form:            ReferenceLinkForm;

    /** The definition's URL when the document was loaded. */
    definitionUrl:   string;

    /** The definition's title when the document was loaded, or `null` when it had none. */
    definitionTitle: string | null;

    /**
     * The link's text as the serializer wrote it right after the document was
     * loaded, so a save can tell whether the text has been edited or
     * formatted since.
     */
    importedContent: string;
}

/** The JSON shape a {@link ReferenceLinkNode} (de)serialises to/from. */
export type SerializedReferenceLinkNode = Spread<{ reference: ReferenceLinkReference }, SerializedLinkNode>;

/**
 * A reference-style link — `[text][label]`, `[label][]` or `[label]` —
 * resolved against the document's link reference definitions when the
 * Markdown was loaded.
 *
 * It stays a `LinkNode`, so selection state, **Edit link…**, **Remove link**,
 * `toggleLink` and `removeLink` all treat it as an ordinary link. On top of
 * that it remembers the label and form it was written in, the URL and title
 * its definition gave it, and its text as first written, so the serializer
 * can save it back in its reference form while the saved document's
 * definition for its label still gives exactly its URL and title. The same
 * shape as `@lexical/link`'s own `AutoLinkNode`: a `LinkNode` subclass with
 * one extra field.
 */
export class ReferenceLinkNode extends LinkNode {
    __reference: ReferenceLinkReference;

    /**
     * Creates a reference link.
     *
     * @param url - The link's URL.
     * @param attributes - The link's `target` / `rel` / `title`.
     * @param reference - How the link was written; defaults to a full-form
     *   reference with an empty label pointing at `url`.
     * @param key - The Lexical node key, when cloning.
     */
    constructor(url: string = "", attributes: LinkAttributes = {}, reference?: ReferenceLinkReference, key?: NodeKey) {
        super(url, attributes, key);

        this.__reference = reference ?? {
            label:           "",
            form:            "full",
            definitionUrl:   url,
            definitionTitle: attributes.title ?? null,
            importedContent: "",
        };
    }

    /**
     * The Lexical node type.
     *
     * @returns `"reference-link"`.
     */
    static getType(): string {
        return "reference-link";
    }

    /**
     * Copies a node, keeping its key, as Lexical's copy-on-write requires.
     *
     * @param node - The node to copy.
     * @returns The copy.
     */
    static clone(node: ReferenceLinkNode): ReferenceLinkNode {
        return new ReferenceLinkNode(
            node.__url,
            { rel: node.__rel, target: node.__target, title: node.__title },
            node.__reference,
            node.__key,
        );
    }

    /**
     * Rebuilds a node from its JSON form.
     *
     * @param json - The serialised node.
     * @returns The node.
     */
    static importJSON(json: SerializedReferenceLinkNode): ReferenceLinkNode {
        return new ReferenceLinkNode(json.url, { title: json.title ?? null }, json.reference).updateFromJSON(json);
    }

    /**
     * Copies the link fields, then the reference, from the node this one was
     * cloned from — as `AutoLinkNode` copies its own extra field.
     *
     * @param prevNode - The node cloned from.
     */
    afterCloneFrom(prevNode: this): void {
        super.afterCloneFrom(prevNode);

        this.__reference = prevNode.__reference;
    }

    /**
     * Serialises the node: the link's own JSON plus its reference.
     *
     * @returns The JSON form.
     */
    exportJSON(): SerializedReferenceLinkNode {
        return {
            ...super.exportJSON(),
            type:      "reference-link",
            reference: this.getReference(),
        };
    }

    /**
     * Returns how this link was written in the loaded Markdown.
     *
     * @returns The label, form, the definition's URL and title, and the text
     *   as written, all at load time.
     */
    getReference(): ReferenceLinkReference {
        return this.getLatest().__reference;
    }

    /**
     * Records the link's text as the serializer writes it, once the loaded
     * document is complete.
     *
     * @param content - The serializer's output for the link's text.
     * @returns The writable node, its reference a copy with `importedContent` set.
     */
    setImportedContent(content: string): this {
        const self = this.getWritable();

        self.__reference = { ...self.__reference, importedContent: content };

        return self;
    }
}

/**
 * Creates a {@link ReferenceLinkNode}.
 *
 * @param url - The link's URL.
 * @param title - The link's title, or `null`.
 * @param reference - How the link was written.
 * @returns The new node.
 */
export function $createReferenceLinkNode(
    url: string, title: string | null, reference: ReferenceLinkReference,
): ReferenceLinkNode {
    return new ReferenceLinkNode(url, { title }, reference);
}

/**
 * Whether a node is a {@link ReferenceLinkNode}.
 *
 * @param node - The node to test.
 * @returns Whether it is one.
 */
export function $isReferenceLinkNode(node: LexicalNode | null | undefined): node is ReferenceLinkNode {
    return node instanceof ReferenceLinkNode;
}
