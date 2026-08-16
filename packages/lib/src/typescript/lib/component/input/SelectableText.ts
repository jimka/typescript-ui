// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Text, TextOptions } from "~/component/input/Text.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link SelectableText}.
 *
 * @category Components
 */
export interface SelectableTextOptions extends TextOptions {
}

// Class-level defaults, resolved once per class by `resolveClassDefaults` and
// read back through the folding `getUserSelect()` / `getCursor()` getters —
// never dispatched into `_options`, so they land on the shared
// `.SelectableText` rule instead of each instance's `#id` rule.
const _defaultSelectableTextOptions: Partial<SelectableTextOptions> = {
    userSelect: "text",
    cursor:     "text",
};

/**
 * Text the reader can select and copy, with a matching text cursor.
 *
 * Framework {@link Text} is unselectable by default, because most text in a UI
 * is chrome — a button label, a menu title. Use `SelectableText` for content
 * the reader is meant to be able to select: a dialog or notification message,
 * a data cell's value.
 *
 * @category Components
 */
class SelectableText extends Text<SelectableTextOptions> {

    constructor(
        text?: String,
        options?: SelectableTextOptions,
        subclassDefaults?: Partial<SelectableTextOptions>,
    ) {
        super(text, options, { ..._defaultSelectableTextOptions, ...(subclassDefaults ?? {}) });
    }
}

const SelectableTextCallable = callable(SelectableText);
type SelectableTextCallable = SelectableText;
export {
    SelectableText         as _SelectableText,
    SelectableTextCallable as SelectableText,
};
