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
