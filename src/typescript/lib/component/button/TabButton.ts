// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DOM } from "~/core/DOM.js";
import { ThemeManager } from "~/core/Theme.js";
import { ToggleButton, ToggleButtonOptions } from "~/component/button/ToggleButton.js";
import { TabCloseButton } from "~/component/button/TabCloseButton.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link TabButton}.
 *
 * `text` (the label), `glyph`, and `selected` are inherited from
 * {@link ToggleButtonOptions}.
 *
 * @category Components
 */
export interface TabButtonOptions extends ToggleButtonOptions {
    /** When true, builds and overlays the close (✕) affordance. Default false. */
    closeable?: boolean;
}

/**
 * A tab-styled toggle button: a {@link ToggleButton} that paints its own
 * unselected/hover/selected fill from the `--ts-ui-tab-button-*` theme tokens
 * and optionally overlays a close (✕) affordance built from
 * {@link TabCloseButton}.
 *
 * `TabButton` is a [`TabBar`](/api/component/container/classes/TabBar)
 * collaborator, not a general-purpose button. It owns the per-tab styling and
 * close-button *construction* that the strip previously replayed inline for
 * every cell; the strip keeps every geometry concern — insets, writing mode,
 * min/max clamp, and the per-layout re-pin of the overlaid close button (which
 * is positioned via the exposed {@link getCloseButton}). It adds no selection
 * or roving-tab-index logic of its own — those slot through the inherited
 * `ToggleButton` surface.
 *
 * @category Components
 */
class TabButton extends ToggleButton {

    // Whether this tab carries a close affordance. Construction-time only (the
    // close button is built or not when the tab is created), so it is set once
    // in the constructor and never via an option-dispatched setter — hence a
    // plain field rather than a `declare`d cascade-written one.
    private _closeable: boolean = false;

    // The overlaid close button, or null when the tab is not closeable. Built
    // in the constructor and raw-appended onto this button's own element (the
    // standard overlay pattern); TabBar reads it to wire its "action" and to
    // position/re-pin it each layout.
    private _closeButton: TabCloseButton | null = null;

    /**
     * Builds a tab-styled toggle button with the given label, applying the
     * `--ts-ui-tab-button-*` fill/border/hover/selected styling and, when
     * `closeable` is set, building and overlaying the close affordance.
     *
     * @param text - The visible label for the tab.
     * @param options - Tab button options; `closeable` gates the close button.
     */
    constructor(text: string, options?: TabButtonOptions) {
        // ToggleButton (via Button) builds its inner text/HBox content row in
        // its constructor body, so forward the positional `text` to super
        // first; the styling setters below then fire on a fully-built button.
        super(text);

        this.applyTabStyling();

        this._closeable = options?.closeable ?? false;

        if (options) {
            this.applyOptions(options);
        }

        // Button's constructor late-dispatches `setGlyph` from the options bag
        // once, before this subclass's `applyOptions` runs; a glyph passed to a
        // ToggleButton subclass is therefore only pure-written to `_options` and
        // never rendered. Dispatch it explicitly here, mirroring how TabBar
        // called `setGlyph(constraints.glyph)` after construction.
        if (options?.glyph !== undefined) {
            this.setGlyph(options.glyph);
        }

        if (this._closeable) {
            this.buildCloseButton();
        }

        // ToggleButton's constructor wired the listener bag from the options it
        // received — but `super(text)` above passed none, so it wired nothing.
        // Wire the bag here, as the leaf, after super() and applyOptions, so a
        // `new TabButton(name, { listeners: { action } })` is not silently
        // dropped (ARCHITECTURE.md, Event handling).
        this.applyListeners(options?.listeners);
    }

    /**
     * Paints the tab's unselected, hover, and selected states from the
     * `--ts-ui-tab-button-*` theme tokens. The unselected fill routes the tab
     * token through both the background colour *and* image layer so Button's
     * inherited `--ts-ui-button-bg` gradient drops out (invalid as an image)
     * and the tab colour wins, killing the gradient bleed-through.
     */
    private applyTabStyling(): void {
        this.setBackgroundColor("var(--ts-ui-tab-button-bg, #b8b8c3)");
        this.setBackgroundImage("var(--ts-ui-tab-button-bg, #b8b8c3)");
        this.setBorder({
            borderTop:    "var(--ts-ui-tab-button-border-top,    var(--ts-ui-tab-button-border, none))",
            borderRight:  "var(--ts-ui-tab-button-border-right,  var(--ts-ui-tab-button-border, none))",
            borderBottom: "var(--ts-ui-tab-button-border-bottom, var(--ts-ui-tab-button-border, none))",
            borderLeft:   "var(--ts-ui-tab-button-border-left,   var(--ts-ui-tab-button-border, none))",
        });
        this.clearBorderRadius();
        this.clearShadow();

        // Hover state.
        this.setHoverBackgroundColor("var(--ts-ui-tab-button-hover-bg, #c4c4cf)");
        this.setHoverBackgroundImage("var(--ts-ui-tab-button-hover-bg, #c4c4cf)");
        this.setHoverShadow("none");
        this.setHoverBorder({
            borderTop:    "var(--ts-ui-tab-button-hover-border-top,    var(--ts-ui-tab-button-hover-border, none))",
            borderRight:  "var(--ts-ui-tab-button-hover-border-right,  var(--ts-ui-tab-button-hover-border, none))",
            borderBottom: "var(--ts-ui-tab-button-hover-border-bottom, var(--ts-ui-tab-button-hover-border, none))",
            borderLeft:   "var(--ts-ui-tab-button-hover-border-left,   var(--ts-ui-tab-button-hover-border, none))",
        });

        // Selected (active) state.
        this.setSelectedBackgroundColor("var(--ts-ui-tab-button-selected-bg, rgb(255, 255, 255))");
        this.setSelectedBackgroundImage("var(--ts-ui-tab-button-selected-bg, rgb(255, 255, 255))");
        this.setSelectedShadow("none");
        this.setSelectedBorder({
            borderTop:    "var(--ts-ui-tab-button-selected-border-top,    var(--ts-ui-tab-button-selected-border, none))",
            borderRight:  "var(--ts-ui-tab-button-selected-border-right,  var(--ts-ui-tab-button-selected-border, none))",
            borderBottom: "var(--ts-ui-tab-button-selected-border-bottom, var(--ts-ui-tab-button-selected-border, none))",
            borderLeft:   "var(--ts-ui-tab-button-selected-border-left,   var(--ts-ui-tab-button-selected-border, none))",
        });
    }

    /**
     * Builds the close (✕) affordance and overlays its element on this button's
     * own element. Transparent so the tab's background shows through, with a
     * faint rounded hover tint giving the ✕ its affordance. The ✕ is overlaid
     * (raw-appended) rather than enrolled in a layout so it floats at the corner
     * of the tab; TabBar pins its precise position each layout.
     */
    private buildCloseButton(): void {
        const closeButton = new TabCloseButton();

        // Transparent so the tab's own background shows through; a faint rounded
        // tint on hover gives the ✕ its affordance. `--ts-ui-tab-close-hover-bg`
        // has no themeToVars entry, so the inline rgba fallback is the actual
        // source of the value — keep it verbatim.
        closeButton.setBackgroundColor("transparent");
        closeButton.setBackgroundImage("none");
        closeButton.setHoverBackgroundColor("var(--ts-ui-tab-close-hover-bg, rgba(0, 0, 0, 0.12))");
        closeButton.setHoverBackgroundImage("none");
        closeButton.setHoverShadow("none");
        closeButton.setBorderRadius("3px");
        closeButton.clearBorder();
        closeButton.clearShadow();
        closeButton.setZIndex(1);

        // Shrink the ✕ glyph to roughly half the close-button hit box, centred —
        // the button stays the click target while the mark reads lighter. Pin it
        // (Glyph.setPreferredSize locks min/max too) so the line-height sync
        // never re-tracks the glyph to the title line height; TabBar's
        // per-layout re-pin keeps it at the base-scaled size.
        closeButton.pinGlyphSize(ThemeManager.getResolvedScale().tabCloseGlyph);

        // Overlay it on this button's own element rather than enrolling it in a
        // layout (which would stretch it over the whole tab); TabBar pins it to
        // the right edge each layout.
        DOM.sink.appendChild(this.getElement(true)!, closeButton.getElement(true)!);

        this._closeButton = closeButton;
    }

    /**
     * Returns the overlaid close button, or `null` when this tab is not
     * closeable. TabBar wires its `"action"` event and positions/re-pins it on
     * each layout pass.
     *
     * @returns The close button, or `null`.
     */
    getCloseButton(): TabCloseButton | null {
        return this._closeButton;
    }

    /**
     * Returns whether this tab carries a close affordance. Construction-time
     * only — there is no runtime toggle.
     *
     * @returns True when the tab was built closeable.
     */
    isCloseable(): boolean {
        return this._closeable;
    }
}

const TabButtonCallable = callable(TabButton);
type TabButtonCallable = TabButton;
export {
    TabButton         as _TabButton,
    TabButtonCallable as TabButton
};
