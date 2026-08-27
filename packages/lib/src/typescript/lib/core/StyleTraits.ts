// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { StyleTrait } from "~/core/ClassStyleRules.js";

/**
 * The border/border-radius pair every standalone text-chrome input shares —
 * `TextInput` (and its `TextField`/`TextArea`/`PasswordField`/`UsernameField`/
 * `PickerInput` descendants), `AbstractPickerField` (and its `DateField`/
 * `TimeField`/`DateTimeField` descendants), `ComboBox`, and `FieldSet`. These
 * four classes have no useful common ancestor — three descend from
 * `AbstractInput`, but that base's other descendants (`Slider`,
 * `NumberSpinner`, the boolean-input family, `FileField`, `FileDropZone`,
 * `AutoCompleteField`, `AbstractSelectableList`) must not inherit the
 * chrome, and `FieldSet` extends `Component` directly with no shared
 * ancestor at all — so a trait, not a hierarchy hoist, is what dedups the
 * byte-identical pair across them. See plans/cross-class-style-groups.md.
 */
export const INPUT_CHROME_TRAIT: StyleTrait = {
    name: "input-chrome",
    declarations: {
        border:       "var(--ts-ui-input-border)",
        borderRadius: "var(--ts-ui-border-radius, 4px)",
    },
};

/**
 * The min/max square-size pair shared by every icon pinned to the theme's
 * compact-control `glyphXs` icon step — a `SpinButton`'s chevron and a
 * `TabButton`'s close-button (✕) chevron. Both are `ButtonIconGlyph`
 * instances (the same class `Button.setGlyph` constructs for every
 * Button-family leading icon), so a class-level opt-in on `ButtonIconGlyph`
 * would also hand this size to every other leading icon in the app — a
 * plain `Button`, `PickerButton`, `MenuButton`, none of which are
 * `glyphXs`-sized. Only these two specific instances opt in, via
 * `setStyleTrait`, replacing the two separate `styleGroup` tokens
 * (`"spin-glyph"`, `"tab-close-glyph"`) plans/implemented/glyph-icon-size-
 * dedup.md gave them back when their shared 8px size was still a
 * coincidence of two unrelated formulas. See plans/glyph-icon-trait-dedup.md.
 *
 * The `8` is the shipped default theme's `glyphXs` step
 * (`ThemeManager.getResolvedScale().glyphXs`), frozen as a literal rather
 * than read live: `StyleTrait.declarations` must be a plain object fixed at
 * the point it's written in source, so it cannot call `ThemeManager`. A
 * custom theme with a different `scale.base`, active before either
 * consumer's first construction, only degrades this dedup (both sites still
 * re-pin their own real instance value every render) — see
 * plans/glyph-icon-trait-dedup.md's `## Architecture Decisions`.
 */
export const GLYPH_XS_INK_TRAIT: StyleTrait = {
    name: "glyph-xs-ink",
    declarations: {
        minSize: { width: 8, height: 8 },
        maxSize: { width: 8, height: 8 },
    },
};

/**
 * The min/max square-size pair shared by every icon matched to the theme's
 * text-matched `glyphMd` icon step — `WindowHeaderTitleGlyph`'s title icon
 * and `ComboBoxCaretGlyph`'s chevron. The two have no useful common
 * ancestor beyond `Glyph` itself, which every other differently-sized
 * glyph in the framework also extends. See plans/glyph-icon-trait-dedup.md.
 *
 * The `14` is the shipped default theme's `glyphMd` step
 * (`ThemeManager.getResolvedScale().glyphMd`), frozen as a literal for the
 * same reason `GLYPH_XS_INK_TRAIT`'s `8` is — see that constant's own
 * comment.
 */
export const GLYPH_MD_INK_TRAIT: StyleTrait = {
    name: "glyph-md-ink",
    declarations: {
        minSize: { width: 14, height: 14 },
        maxSize: { width: 14, height: 14 },
    },
};
