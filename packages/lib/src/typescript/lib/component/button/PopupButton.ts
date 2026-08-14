// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Button, ButtonOptions } from "~/component/button/Button.js";
import { DOM } from "~/core/DOM.js";
import { PopupPanel } from "~/overlay/PopupPanel.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link PopupButton}.
 *
 * @category Components
 */
export interface PopupButtonOptions extends ButtonOptions {
    /** The popup to toggle: a built panel, or a factory called once on first open. */
    panel?: PopupPanel | (() => PopupPanel);
}

/**
 * A push button whose click toggles a {@link PopupPanel} anchored under its
 * bottom-left corner, mirroring [`MenuButton`](/api/component/button/classes/MenuButton)
 * with a `PopupPanel` in place of a `Menu`. The `panel` option accepts a
 * built panel or a factory invoked once on first open and reused across
 * opens — unlike a `Menu` provider, which rebuilds on every open, because a
 * panel is a live component with its own state.
 *
 * The button owns whichever panel it resolves: it installs itself as the
 * panel's close handler (so an outside dismissal returns `aria-expanded` to
 * `false`), and disposes the panel in its own destructor and whenever
 * {@link setPanel} replaces it. A panel shared between two buttons is
 * disposed by whichever button tears down first — the supported shape is one
 * panel per button.
 *
 * @example
 * ```typescript
 * import { PopupButton } from '@jimka/typescript-ui/component/button';
 * import { PopupPanel } from '@jimka/typescript-ui/overlay';
 * import { VBox } from '@jimka/typescript-ui/layout';
 * import { Checkbox } from '@jimka/typescript-ui/component/input';
 *
 * const filters = PopupButton('Filters', {
 *     panel: () => PopupPanel({
 *         layoutManager: VBox({ spacing: 4, stretching: true }),
 *         components:    [ Checkbox({ label: 'Show archived' }) ],
 *     }),
 * });
 *
 * toolbar.addComponent(filters);
 * ```
 *
 * @category Components
 */
class PopupButton<TOptions extends PopupButtonOptions = PopupButtonOptions> extends Button<TOptions> {

    // `setPanel` is dispatched from `applyOptions` during the `super()`
    // cascade and writes this field — a plain initializer would run
    // afterwards and wipe it, so it is declared bare and seeded below.
    declare private _resolvedPanel: PopupPanel | null;

    private readonly _boundTogglePopup: () => void = () => { this.togglePopup(); };
    private readonly _boundClosePopup:  () => void = () => { this.closePopup(); };

    /**
     * Constructs a PopupButton with an optional title and options bag (both
     * optional — an empty PopupButton renders as a chrome-shaped placeholder).
     *
     * @example
     * ```typescript
     * new PopupButton('Filters', { panel: () => new PopupPanel({ … }) });
     * PopupButton({ glyph: 'filter', panel: () => new PopupPanel({ … }) });
     * ```
     */
    constructor(text?: string, options?: TOptions, subclassDefaults?: Partial<TOptions>);
    constructor(options: TOptions);
    constructor(
        textOrOptions?:    string | TOptions,
        options?:          TOptions,
        subclassDefaults?: Partial<TOptions>,
    ) {
        // Normalise the overload: a non-string first argument is the options
        // bag. Copied from MenuButton.ts in shape.
        let text: string | undefined;

        if (typeof textOrOptions === "string") {
            text = textOrOptions;
        } else if (textOrOptions !== undefined) {
            options = textOrOptions;
        }

        super(text, options, subclassDefaults);

        this._resolvedPanel ??= null;

        this.on("action", this._boundTogglePopup);
        this.getAria().setHasPopup("dialog");
        this.getAria().setExpanded(false);

        // Button wires the listener bag only when it is the directly-
        // constructed class; mirror its instance-identity guard so a
        // PopupButton subclass wires its own bag once, from its own
        // constructor.
        if (Object.getPrototypeOf(this) === PopupButton.prototype) {
            this.applyListeners(options?.listeners);
        }
    }

    /**
     * Disposes the resolved panel, then runs the inherited teardown. The
     * panel is a `LayerManager`-mounted overlay, never a registered child
     * (see `Menu.ts`'s class comment for the same relationship), so
     * `super.destructor()`'s child recursion cannot reach it.
     */
    protected destructor(): void {
        this._resolvedPanel?.dispose();
        this._resolvedPanel = null;

        super.destructor();
    }

    /**
     * Replaces the configured popup — a built panel, or a factory invoked
     * once on first open. Disposes whichever panel was already resolved, so
     * the next open resolves the new configuration from scratch.
     *
     * @param panel - The new panel or panel factory.
     *
     * @returns This button, for method chaining.
     */
    setPanel(panel: PopupPanel | (() => PopupPanel)): this {
        this._resolvedPanel?.dispose();
        this._resolvedPanel = null;
        this._options.panel = panel;

        return this;
    }

    /**
     * Returns the configured panel or factory — the caller value, else the
     * class default, else `null` when neither is set.
     *
     * @returns The configured panel/factory, or `null`.
     */
    getPanel(): PopupPanel | (() => PopupPanel) | null {
        return this._options.panel ?? this._defaultOptions.panel ?? null;
    }

    /**
     * Applies a {@link PopupButtonOptions} bag, dispatching `panel` after the
     * inherited Button fields cascade.
     *
     * @param options - The options bag carrying the values to apply.
     *
     * @returns This button, for method chaining.
     */
    protected applyOptions(options: TOptions): this {
        super.applyOptions(options);

        if (options.panel !== undefined) {
            this.setPanel(options.panel);
        }

        return this;
    }

    /**
     * Resolves (and caches) the configured panel: the cached instance when
     * already resolved; otherwise invokes a configured factory exactly once
     * and caches its result, or uses a configured instance directly. Wires
     * this button as the panel's close handler and its id as the panel's
     * `aria-controls` target. Returns `null` when nothing is configured —
     * the caller stays a no-op beyond the `"action"` event.
     *
     * @returns The resolved panel, or `null` when none is configured.
     */
    protected ensurePanel(): PopupPanel | null {
        if (this._resolvedPanel) {
            return this._resolvedPanel;
        }

        const configured = this.getPanel();

        if (!configured) {
            return null;
        }

        const panel = typeof configured === "function" ? configured() : configured;

        this._resolvedPanel = panel;
        panel.setCloseHandler(this._boundClosePopup);
        this.getAria().setControls(panel.getId());

        return panel;
    }

    /**
     * Toggles the panel anchored under the button's bottom-left corner. A
     * no-op when the button is not yet attached (checked *before* resolving
     * the panel, so an unattached button constructs nothing — a factory is
     * not called) or when no panel is configured.
     */
    private togglePopup(): void {
        const el = this.getElement();

        if (!el) {
            return;
        }

        const panel = this.ensurePanel();

        if (!panel) {
            return;
        }

        panel.toggleFor(el, DOM.source.getViewportRect(this));
        this.getAria().setExpanded(panel.isOpen());
    }

    /**
     * The panel's close thunk, installed via {@link PopupPanel.setCloseHandler}
     * so an outside dismissal (or Escape) drives this button's own teardown
     * instead of only the panel's — `setCloseHandler` replaces the default
     * `hideAnimated`, it does not merely observe it.
     */
    private closePopup(): void {
        this._resolvedPanel?.hideAnimated();
        this.getAria().setExpanded(false);
    }
}

const PopupButtonCallable = callable(PopupButton);
type  PopupButtonCallable<TOptions extends PopupButtonOptions = PopupButtonOptions> = PopupButton<TOptions>;
export {
    PopupButton         as _PopupButton,
    PopupButtonCallable as PopupButton,
};
