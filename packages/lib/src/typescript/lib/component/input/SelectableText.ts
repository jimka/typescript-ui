// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Text, TextOptions } from "~/component/input/Text.js";
import { Event } from "~/core/Event.js";
import { Menu } from "~/overlay/Menu.js";
import { buildSelectionCopyMenuItems } from "~/component/shared/buildSelectionCopyMenuItems.js";
import { callable } from "~/core/Callable.js";
import type { StyleBag } from "~/core/ClassStyleRules.js";

/**
 * Construction-time options for {@link SelectableText}.
 *
 * @category Components
 */
export interface SelectableTextOptions extends TextOptions {
    /**
     * Whether a right-click offers a Copy row for text selected inside this
     * component. Defaults to `false`.
     */
    copyMenu?: boolean;
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
 * a data cell's value. Setting {@link SelectableTextOptions.copyMenu} opts
 * into a right-click menu offering Copy for text selected inside it.
 *
 * @category Components
 */
class SelectableText extends Text<SelectableTextOptions> {

    // Own contribution to the hierarchy-aware class tier — see
    // plans/implemented/class-hierarchy-cascade.md. `SelectableText`
    // deviates from `Text` on `cursor`/`userSelect` (unlike `Label`/`Legend`,
    // which inherit `Text` untouched), so — like `Text` itself — it needs
    // its own registration for the hierarchy walk to see that deviation;
    // without it, `SelectableText` would silently pass through to `Text`'s
    // shared rule and lose it.
    protected static readonly ownClassStyleDefaults: StyleBag = _defaultSelectableTextOptions;

    // Self-wired Copy replacement for the browser's own right-click menu,
    // suppressed page-wide by Body.init (native-context-menu-suppression.md).
    // Created on first right-click, not here: a table body pools hundreds of
    // SelectableText instances that never open it. Never a registered child —
    // disposed explicitly in destructor().
    private _contextMenu: Menu | null = null;

    constructor(
        text?: String,
        options?: SelectableTextOptions,
        subclassDefaults?: Partial<SelectableTextOptions>,
    ) {
        super(text, options, { ..._defaultSelectableTextOptions, ...(subclassDefaults ?? {}) });

        // Wired once for the component's whole life, regardless of
        // `copyMenu`: handleContextMenu self-guards, so the flag needs no
        // listener churn. Mirrors Link's keydown registration.
        Event.addListener(this, "contextmenu", this.handleContextMenu);
    }

    /**
     * Dispatches the `copyMenu` option to its setter.
     *
     * @param options - The caller's construction options.
     *
     * @returns This component, for method chaining.
     */
    protected applyOptions(options: SelectableTextOptions): this {
        super.applyOptions(options);

        this.setCopyMenu(options.copyMenu ?? this.hasCopyMenu());

        return this;
    }

    /**
     * Turns the right-click Copy menu on or off.
     *
     * @param enabled - `true` to offer a Copy row for text selected inside
     *   this component on right-click.
     *
     * @returns This component, for method chaining.
     */
    setCopyMenu(enabled: boolean): this {
        this._options.copyMenu = enabled;

        return this;
    }

    /**
     * Whether the right-click Copy menu is on.
     *
     * @returns `true` when a right-click offers the Copy menu.
     */
    hasCopyMenu(): boolean {
        return this._options.copyMenu ?? this._defaultOptions.copyMenu ?? false;
    }

    /**
     * Opens the Copy menu for the text currently selected inside this
     * component. A no-op when {@link hasCopyMenu} is `false`, in which case
     * the event is left alone so an ancestor's own `contextmenu` handling
     * (e.g. a table's cell or column menu) still runs.
     *
     * @param event - The `contextmenu` event being handled.
     *
     * @returns A stop-and-prevent disposition when the menu opens; otherwise
     *   nothing, so the dispatcher's ancestor walk continues.
     */
    private handleContextMenu(event: MouseEvent): Event.ListenerResult {
        if (!this.hasCopyMenu()) {
            return;
        }

        const element = this.getElement();

        if (element) {
            this._contextMenu ??= new Menu();
            this._contextMenu.show(event.clientX, event.clientY, buildSelectionCopyMenuItems(element));
        }

        return { stop: true, prevent: true };
    }

    /**
     * Disposes the Copy menu, if one was ever opened, before the rest of
     * teardown runs.
     */
    protected destructor(): void {
        this._contextMenu?.dispose();
        this._contextMenu = null;

        super.destructor();
    }
}

const SelectableTextCallable = callable(SelectableText);
type SelectableTextCallable = SelectableText;
export {
    SelectableText         as _SelectableText,
    SelectableTextCallable as SelectableText,
};
