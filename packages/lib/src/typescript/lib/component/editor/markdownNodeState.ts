// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { createState } from "lexical";
import type { StateConfig } from "lexical";

/**
 * The authored marker of a hard line break, kept on its `LineBreakNode`: `\`
 * or a run of two or more spaces, written back before the break's newline.
 * A break with no state (one made by Shift+Enter) reads as `\`, the visible
 * marker — trailing spaces are invisible and are stripped by many editors.
 *
 * The same mechanism `@lexical/markdown` uses for its own `hardLineBreakState`
 * (`mdHardLineBreak`), under this dialect's own key and default.
 */
export const hardBreakMarkerState: StateConfig<"mdBreakMarker", string> = createState("mdBreakMarker", {
    parse: (value) => (typeof value === "string" && /^(\\| {2,})$/.test(value) ? value : "\\"),
});

/**
 * Whether a `LinkNode` was loaded from a GFM bare autolink — a URL, a `www.`
 * address or an email address written as plain text — so a save writes it
 * back bare where `marked` still reads it as that link, instead of in
 * `<…>` or `[…](…)` form: the source text, and with it a heading's id, stays
 * unchanged. A link with no state (one made in the editor) is written in
 * `<…>` or `[…](…)` form.
 */
export const bareAutolinkState: StateConfig<"mdBareAutolink", boolean> = createState("mdBareAutolink", {
    parse: (value) => value === true,
});

/**
 * The attribute text of the styled span a text node was loaded from, as it
 * was written between the braces (`size=2em bogus=1 color=red`), so a save
 * keeps the attributes' order and the ones the editor does not model. The
 * serializer writes it only while it still resolves to the node's style;
 * `""` (the default) writes the style's normalized attributes.
 */
export const spanAttributesState: StateConfig<"mdSpanAttributes", string> = createState("mdSpanAttributes", {
    parse: (value) => (typeof value === "string" ? value : ""),
});

/**
 * The attribute text a `:::` fence was loaded with, as it was written between
 * the braces on its opening line (`gap=2rem bogus=1 align=right`), so a save
 * keeps the attributes' order and the ones the editor does not model. The
 * serializer writes it only while it still resolves to the fence's alignment
 * and column gap; `""` (the default) writes those as normalized attributes.
 */
export const fenceAttributesState: StateConfig<"mdFenceAttributes", string> = createState("mdFenceAttributes", {
    parse: (value) => (typeof value === "string" ? value : ""),
});

/**
 * The attribute text an image was loaded with, as it was written between the
 * braces after it (`height=40 width=120`, `bogus=1`), so a save keeps the
 * attributes' order and the ones the editor does not model. The serializer
 * writes it only while it still resolves to the node's size; `""` (the
 * default) writes the size's attributes.
 */
export const imageAttributesState: StateConfig<"mdImageAttributes", string> = createState("mdImageAttributes", {
    parse: (value) => (typeof value === "string" ? value : ""),
});

/**
 * The info string a fenced code block was loaded with, as it was written
 * after the opening fence (`ts title="a.ts"`), so a save keeps the words
 * after the language, which the editor does not model, and their escapes.
 * The serializer writes it only while its first word is still the block's
 * language; `""` (the default) writes the language alone.
 */
export const codeInfoState: StateConfig<"mdCodeInfo", string> = createState("mdCodeInfo", {
    parse: (value) => (typeof value === "string" ? value : ""),
});

/**
 * The {@link nestedLinkState} flag telling that a styled span inside the
 * outer link sets the run's style, so its source writes it (above any
 * Lexical text format bit).
 */
export const NESTED_LINK_WRITES_STYLE = 1 << 24;

/**
 * Marks a source node holding a link whose text all sits in links nested in
 * it (`[[a](/in)](/out)`, `[~~<https://a>~~](/p)`; Lexical's links do not
 * nest): the node shows the nested link's text inside a link node with the
 * nested link's target, as the viewer shows the inner link, and with the
 * formats and style written inside the outer link — whose format bits this
 * holds, plus {@link NESTED_LINK_WRITES_STYLE} when a styled span there sets
 * the style — and its source writes the whole link, so the serializer writes
 * it outside the link node it sits in, with only the formatting outside it
 * around it. `-1` (the default) is any other node.
 */
export const nestedLinkState: StateConfig<"mdNestedLink", number> = createState("mdNestedLink", {
    parse: (value) => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : -1),
});

/**
 * The link a {@link nestedLinkState} run belongs to: an id its runs share
 * (the first run's key at load) and the outer link's syntax after its text
 * (`](/out)`), so a save can rewrap what is left of the runs in that link
 * when an edit breaks them. `null` (the default) is any other node.
 */
export const nestedLinkGroupState: StateConfig<"mdNestedLinkGroup", { readonly id: string; readonly close: string } | null> =
    createState("mdNestedLinkGroup", {
        parse: (value) => {
            const group = value as { id?: unknown; close?: unknown } | null;

            return typeof group?.id === "string" && typeof group.close === "string" ? { id: group.id, close: group.close } : null;
        },
    });

/**
 * The {@link KeptSource.writes} flag telling that a styled span inside the
 * kept construct sets the run's style, so its source writes it (above any
 * Lexical text format bit).
 */
export const KEPT_SOURCE_WRITES_STYLE = 1 << 24;

/**
 * The {@link KeptSource.writes} flag telling that the link the run sits in
 * is the kept construct's own (a link inside it, or the construct itself),
 * so its source writes it.
 */
export const KEPT_SOURCE_WRITES_LINK = 1 << 25;

/** One run of an inline construct kept as written ({@link keptSourceState}). */
export interface KeptSource {
    /** An id the construct's runs share: its first run's key at load. */
    readonly group:  string;
    /** The run's place among the construct's runs, from 0. */
    readonly index:  number;
    /** How many runs the construct has. */
    readonly size:   number;
    /**
     * The format bits the construct's own source writes for the run, plus
     * {@link KEPT_SOURCE_WRITES_STYLE} and {@link KEPT_SOURCE_WRITES_LINK}.
     */
    readonly writes: number;
    /** The Markdown an image or line break run writes; `""` for a source run, which holds its own. */
    readonly source: string;
    /** For an image run, what it showed at load (its source, alt text and size); `""` otherwise. */
    readonly shown:  string;
}

/**
 * Marks a run of an inline construct kept as written: a loaded construct
 * (an emphasis, link, span, autolink, …) whose standard form — what a save
 * writes for a block once it is edited — would read differently from what
 * the viewer shows for it, or change a heading's id. Its text runs are
 * source nodes showing what the viewer shows; an image or hard break in it
 * keeps its own node. While all of a construct's runs stand together, as
 * loaded, the serializer writes their sources joined, byte for byte, with
 * only the formatting outside the construct around them; once an edit
 * takes some away, what is left shows and saves as ordinary content.
 * `null` (the default) is any other node.
 */
export const keptSourceState: StateConfig<"mdKeptSource", KeptSource | null> = createState("mdKeptSource", {
    parse: (value) => {
        const kept = value as Partial<Record<keyof KeptSource, unknown>> | null;
        const valid = kept !== null && typeof kept === "object" && typeof kept.group === "string"
            && [kept.index, kept.size, kept.writes].every((field) => typeof field === "number" && Number.isInteger(field))
            && typeof kept.source === "string" && typeof kept.shown === "string";

        return valid ? kept as KeptSource : null;
    },
});

/**
 * Whether a list is loose — its items separated by blank lines — kept on its
 * `ListNode` so it saves the way it was written. A list made by typing or a
 * command has no state and saves tight.
 *
 * The same mechanism `@lexical/markdown` uses for its `codeFenceState` on
 * `CodeNode`.
 */
export const listLooseState: StateConfig<"mdLoose", boolean> = createState("mdLoose", {
    parse: (value) => value === true,
});

/**
 * The authored marker of a list, kept on its `ListNode`: the bullet
 * character (`-`, `*` or `+`) of a bullet list, or the delimiter (`.` or
 * `)`) after an ordered list's numbers. `""` — no state — is a list made in
 * the editor, which saves with `-` or `.`.
 *
 * Its own key, not `@lexical/markdown`'s `mdListMarker`, which that
 * package's typing shortcuts set and which holds bullets only.
 */
export const listMarkerState: StateConfig<"mdItemMarker", string> = createState("mdItemMarker", {
    parse: (value) => (typeof value === "string" && /^[-*+.)]$/.test(value) ? value : ""),
});
