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
