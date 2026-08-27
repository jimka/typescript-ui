// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Button } from "~/component/button/Button.js";
import { Tab } from "~/layout/Tab.js";
import { callable } from "~/core/Callable.js";
import {
    createWindowControlButton,
    createWindowLeadGlyphButton,
    setWindowControlsActive,
} from "~/overlay/windowControls.js";
import {
    AbstractWindow,
    WindowOptions,
    WindowState,
} from "~/overlay/AbstractWindow.js";

// Height (px) of the window's tab-bar chrome, seeded into the generic
// viewport-clamp / dock-rect / minimized-stack geometry via `chromeHeight()`.
// Mirrors the `TabBar` default strip thickness (`STRIP_THICKNESS = 30`): the
// bar's real laid-out height is not exposed through `Tab`'s public surface
// (the strip is the manager's private `_bar`), so this fixed analog stands in
// for `Window`'s `_header.getHeight()`. The `|| 26` floor the call sites apply
// is moot once this constant is returned.
const TAB_CHROME_HEIGHT_PX: number = 30;

// Min content width (px) seeded into the default min size via
// `minContentWidthSeed()`. `TabBar` exposes no min-content-width accessor (the
// header analog `_header.getMinContentWidth()` has no public bar counterpart),
// so this documented constant reserves room for the three trailing control
// tools (minimize / maximize / close) plus a narrow tab. It mirrors the role
// of `Window`'s header min width without reaching into the private bar.
const TAB_MIN_CONTENT_WIDTH_PX: number = 120;

/**
 * A floating, resizable, draggable window whose interior *is* a
 * {@link Tab} layout — no separate title-bar header. The tab strip serves as
 * both the window's content switcher and its chrome: the active tab's label is
 * the window title, the strip's blank area is the move handle, and three
 * chromeless control buttons (minimize / maximize / close) are added to the
 * strip as trailing tools.
 *
 * Extends {@link AbstractWindow}, which owns the header-agnostic window
 * machinery (resize borders, move flow, three-state lifecycle, z-order,
 * show/hide). `TabWindow` implements the base's hooks via its `Tab`:
 *
 * - the move gesture is the strip's empty-area press
 *   ({@link Tab.installBarMoveTrigger});
 * - closeable / minimizable / maximizable reflect onto the control tools;
 * - the title reads the active tab's label live;
 * - content is added as a window child *and* a tab entry.
 *
 * Closeable is **pushed** by the owning `Tab` through
 * `Tab.syncHostWindowCloseable` → {@link AbstractWindow.setCloseable} →
 * `reflectCloseable`, so there is no tab-event subscription. The title is
 * never cached — {@link getTitle} re-reads the active label on demand.
 *
 * @category Core
 */
class TabWindow extends AbstractWindow {

    private _tab: Tab;
    private _closeTool: Button;
    private _minTool: Button;
    private _maxTool: Button;
    private _leadGlyphBtn: Button;

    private readonly _boundOnLeadGlyphAction: () => void = () => this.onLeadGlyphAction();

    /**
     * Builds a headerless tab window: a reorderable {@link Tab} as the window's
     * own layout manager (flagged to close the window when its last tab
     * leaves), three chromeless control tools added to the strip, then the
     * base's late chrome setup via `initChrome`.
     *
     * @param options - Optional window configuration.
     */
    constructor(options?: WindowOptions) {
        super(options);

        this._tab = new Tab({ reorderable: true, widthMode: "fixed", textAlign: "start", compact: true, barIgnoreParentInsets: true });

        // This strip is the window's body, so it closes the window when emptied
        // (the last tab dragged out or closed) — the same contract the legacy
        // auto-created tear-off strip carries.
        this._tab.setCloseHostWindowWhenEmpty(true);
        this.setLayoutManager(this._tab);

        // Chromeless control tools wired to the inherited public window-state
        // actions, built from the shared window-control factory so the trailing
        // controls match an ordinary Window's header controls exactly (same
        // `window.control` theme tokens, same box). The bar later re-sets their
        // insets to the compact tool inset (see `Tab`/`TabBar`), so the factory's
        // 2px insets are the standalone default, not the rendered box.
        this._minTool   = createWindowControlButton("window-minimize");
        this._maxTool   = createWindowControlButton("window-maximize");
        this._closeTool = createWindowControlButton("xmark");

        this._minTool.on("action",   () => this.toggleMinimize());
        this._maxTool.on("action",   () => this.toggleMaximize());
        this._closeTool.on("action", () => this.requestClose());

        this._tab.addTool(this._minTool);
        this._tab.addTool(this._maxTool);
        this._tab.addTool(this._closeTool);

        // Leading window icon at the start of the bar, mirroring the title glyph an
        // ordinary Window shows in its header: an explicit `glyph` option wins, else
        // the `window-maximize` default. Built from the shared leading-glyph factory
        // (transparent, clickable, control-peer box — it opens the window menu) so it
        // matches the header's title icon.
        this._leadGlyphBtn = createWindowLeadGlyphButton(this._options.glyph ?? "window-maximize");
        this._leadGlyphBtn.on("action", this._boundOnLeadGlyphAction);
        this._tab.setBarLeadingWidget(this._leadGlyphBtn);

        this.initChrome(options);
    }

    /**
     * Adds a content component as a new tab and shows it. Public entry point so
     * a tear-off caller can populate the window with `win.createTab(content)`.
     *
     * @param content - The content component to host in a new tab.
     *
     * @returns This window, for method chaining.
     */
    createTab(content: Component): this {
        this.addContent(content);

        return this;
    }

    /**
     * Sets the leading window glyph by swapping the glyph on the existing
     * leading control (the window-menu trigger, a peer of the trailing
     * min/max/close controls), mirroring {@link Window.setGlyph}.
     *
     * @param glyph - The glyph name to show at the start of the bar.
     *
     * @returns This window, for method chaining.
     */
    setGlyph(glyph: string): this {
        this._leadGlyphBtn.setGlyph(glyph);

        return this;
    }

    // ----- AbstractWindow hook implementations -----

    /**
     * Wires the window-move gesture to the strip's empty-area press via
     * {@link Tab.installBarMoveTrigger}, routing it to
     * {@link AbstractWindow.startMoveFrom}.
     */
    protected wireMoveTrigger(): void {
        this._tab.installBarMoveTrigger(
            (e: MouseEvent) => this.startMoveFrom(e),
            () => this.onBarDoubleClick(),
        );
    }

    /**
     * Handles a double-click on the strip's empty area, mirroring the header
     * double-click a {@link Window} provides: restores a minimized window to its
     * pre-minimize state, otherwise toggles maximize when the window is
     * maximizable. Presses on the tabs or control tools never reach here (the
     * move-trigger veto excludes them).
     */
    private onBarDoubleClick(): void {
        if (this.getWindowState() === "minimized") {
            this.setWindowState(this._preMinimizeState);

            return;
        }

        if (!this.canMaximize()) {
            return;
        }

        this.toggleMaximize();
    }

    /**
     * Opens the window menu anchored under the leading glyph, in response to
     * its `"action"` event.
     */
    private onLeadGlyphAction(): void {
        this.openWindowMenu(this._leadGlyphBtn);
    }

    /**
     * Reflects the closeable state onto the close control tool by enabling or
     * disabling it. Driven by the owning `Tab`'s closeable push.
     *
     * @param value - True to enable the close tool.
     */
    protected reflectCloseable(value: boolean): void {
        this._closeTool.setEnabled(value);
    }

    /**
     * Reflects the minimizable state onto the minimize control tool's visibility.
     *
     * @param value - True to show the minimize tool.
     */
    protected reflectMinimizable(value: boolean): void {
        this._minTool.setVisible(value);
    }

    /**
     * Reflects the maximizable state onto the maximize control tool's visibility.
     *
     * @param value - True to show the maximize tool.
     */
    protected reflectMaximizable(value: boolean): void {
        this._maxTool.setVisible(value);
    }

    /**
     * Reflects the maximize-availability gate onto the maximize tool's
     * enabled state, without touching its visibility.
     *
     * @param value - True to enable the maximize tool.
     */
    protected reflectMaximizeAvailability(value: boolean): void {
        this._maxTool.setEnabled(value);
    }

    /**
     * No-op: a `TabWindow` has no maximize/restore glyph to swap. The maximize
     * control tool keeps a single glyph; the window state is conveyed by the
     * window geometry, not a glyph change.
     *
     * @param _state - The window state being entered (unused).
     */
    protected reflectMaximizeState(_state: WindowState): void {
        // Intentionally empty — see method JSDoc.
    }

    /**
     * Swaps the tab bar between the focused themed toolbar fill and the flat
     * unfocused gutter fill, then neutralizes (or restores) the control buttons,
     * so a blurred `TabWindow` flattens like a standard {@link Window} header.
     * Both fills are passed as CSS-var strings so a live theme change tracks.
     *
     * @param active - True when this window is the active layer.
     */
    protected paintActive(active: boolean): void {
        this._tab.setBarBackgroundColor(
            active ? "var(--ts-ui-tab-toolbar-bg, #eee)" : "var(--ts-ui-gutter-bg, rgb(200, 200, 200))"
        );

        this.setControlsActive(active);
    }

    /**
     * Flattens (or restores) the three control buttons via the shared
     * {@link setWindowControlsActive} helper, so a blurred `TabWindow` and a
     * blurred header `Window` neutralize their controls identically.
     *
     * @param active - True to restore the control fill, false to flatten it.
     */
    private setControlsActive(active: boolean): void {
        setWindowControlsActive([this._minTool, this._maxTool, this._closeTool], active);
    }

    /**
     * Returns the active tab's label as the window title, or `""` when the strip
     * is empty. Read live — never cached.
     *
     * @returns The active tab label, or `""`.
     */
    getTitle(): string {
        return this._tab.getActiveTabLabel() ?? "";
    }

    /**
     * Returns the min-content-width seed for the default min size — a documented
     * constant ({@link TAB_MIN_CONTENT_WIDTH_PX}) reserving room for the three
     * control tools and a narrow tab, since the bar exposes no min-width
     * accessor.
     *
     * @returns The seed width in pixels.
     */
    protected minContentWidthSeed(): number {
        return TAB_MIN_CONTENT_WIDTH_PX;
    }

    /**
     * Returns the tab-bar chrome height — the documented
     * {@link TAB_CHROME_HEIGHT_PX} analog of the bar's strip thickness, since
     * the laid-out bar height is not exposed through `Tab`'s public surface.
     *
     * @returns The chrome height in pixels.
     */
    protected chromeHeight(): number {
        return TAB_CHROME_HEIGHT_PX;
    }

    /**
     * Adds content as both a layout/serialization child of the window and a tab
     * entry — the `moveComponent`-then-`createTab` order the strip path uses, so
     * the content lays out and is discoverable by serialization.
     *
     * @param content - The content component to add.
     */
    protected addContent(content: Component): void {
        this.moveComponent(content);
        this._tab.createTab(content);
    }

    /**
     * Reports whether `child` is chrome. Always `false`: a `TabWindow`'s bar
     * belongs to the `Tab` *layout manager*, not to any child component, so
     * every child is content.
     *
     * @param _child - The child component to classify (unused).
     * @returns Always `false`.
     */
    isChromeComponent(_child: Component): boolean {
        return false;
    }
}

const TabWindowCallable = callable(TabWindow);
type TabWindowCallable = TabWindow;
export {
    TabWindow         as _TabWindow,
    TabWindowCallable as TabWindow
};
