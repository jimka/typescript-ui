// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Border } from "~/layout/Border.js";
import { Component } from "~/core/Component.js";
import { DOM, type Handle } from "~/core/DOM.js";
import { WindowHeader } from "~/component/container/WindowHeader.js";
import { Event } from "~/core/Event.js";
import { Placement } from "~/primitive/Placement.js";
import { callable } from "~/core/Callable.js";
import { DragManager, DragData, DragEventDetail, TabDragData, tabDragRegistry } from "~/overlay/DragManager.js";
import {
    AbstractWindow,
    WindowOptions,
    WindowState,
} from "~/overlay/AbstractWindow.js";

export type {
    WindowOptions,
    WindowState,
    WindowMaximizeBounds,
    WindowSnapModifier,
    WindowRect,
} from "~/overlay/AbstractWindow.js";

/**
 * A floating, resizable, and draggable window component.
 *
 * Renders a titled panel with eight border-handle strips that the user can
 * drag to resize the window from any edge or corner. Supports a three-state
 * lifecycle (`"normal"` / `"minimized"` / `"maximized"`) accessed through
 * {@link Window.setWindowState}, plus an opt-in Ctrl-snap resize affordance
 * that highlights the nearest border within a 12-pixel threshold so the
 * 4-pixel-wide grab strips are easier to land on.
 *
 * Extends {@link AbstractWindow}, which owns the header-agnostic window
 * machinery; `Window` adds the `Border` layout, a non-null
 * {@link WindowHeader} in NORTH, content in CENTER, and the Shift-drag re-dock
 * source. It implements the base's hooks via its header.
 *
 * @category Core
 */
class Window extends AbstractWindow {

    private _header: WindowHeader;

    // Shift-drag re-dock: a header press with Shift held starts a tab-dock drag
    // instead of a window move. Shift (not Ctrl) so it never collides with the
    // Ctrl snap-resize affordance. `_headerDragShift` captures the modifier at
    // press (the drag-source callbacks get no key state); `_headerDragComponentId`
    // stashes the registered content id so onDragEnd can clean the registry after
    // the dock already moved the content out.
    private _headerDragShift: boolean = false;
    private _headerDragComponentId: string = "";
    private readonly _boundCaptureHeaderShift: (e: MouseEvent) => void = (e: MouseEvent) => this.captureHeaderShift(e);
    private readonly _boundOnHeaderMouseDown: (e: MouseEvent) => void = (e: MouseEvent) => this.onHeaderMouseDown(e);
    private readonly _boundOnTitleGlyphClick: () => void = () => this.onTitleGlyphClick();

    /**
     * Builds a header window: a `Border` layout with a {@link WindowHeader} in
     * NORTH, wires the header buttons and the Shift-drag re-dock source, then
     * runs the base's late chrome setup via `initChrome`.
     *
     * @param headerText - The initial title-bar text (overridden by
     *   `options.headerText` when both are supplied).
     * @param options - Optional window configuration.
     */
    constructor(headerText: string, options?: WindowOptions) {
        super(options);

        this.setLayoutManager(new Border());

        // Build the header with the effective text up front (consumer's
        // `options.headerText` from the cascade-written `_options`, falling
        // back to the positional argument, falling back to "Window"). The
        // late-built dispatch below skips `setHeaderText` because the header
        // already carries the right text — re-setting it would write the
        // same value twice.
        const effectiveHeaderText = this._options.headerText ?? headerText ?? "Window";
        this._header = new WindowHeader(effectiveHeaderText);
        this.addComponent(this._header, {
            placement: Placement.NORTH,
            ignoreParentInsets: true
        });
        this._header.addExitButtonListener(() => this.onExitAction());
        this._header.addMinimizeButtonListener(() => this.toggleMinimize());
        this._header.addMaximizeButtonListener(() => this.toggleMaximize());
        this._header.addHeaderDoubleClickListener((e: MouseEvent) => this.onHeaderDoubleClick(e));
        this._header.addTitleGlyphClickListener(this._boundOnTitleGlyphClick);

        // Late-built state: the glyph field was written pure to `_options` by
        // the super-time cascade. Dispatch it now that `this._header` exists.
        // (The generic contentFactory / state dispatch runs in initChrome.)
        if (this._options.glyph !== undefined) {
            this._header.setGlyph(this._options.glyph);
        }

        this.initChrome(options);
    }

    /**
     * Returns the window's title-bar component.
     *
     * @returns The internal {@link WindowHeader} instance, exposing the close
     *          button, title text, and optional title-icon slot.
     */
    getHeader(): WindowHeader {
        return this._header;
    }

    /**
     * Updates the text shown in the window's title bar.
     *
     * @param text - The new header label text.
     *
     * @returns This window, for method chaining.
     */
    setHeaderText(text: string): this {
        if (!this._header) {
            throw new Error("Window does not have a header.");
        }

        this._header.getText().setText(text);

        return this;
    }

    /**
     * Sets the title-bar glyph (leading icon). Also caches it on the options bag
     * so {@link AbstractWindow.getGlyph} (read by a rail to label a minimized
     * window's handle) stays in sync with runtime changes.
     *
     * @param glyph - The glyph name to show before the title text.
     *
     * @returns This window, for method chaining.
     */
    setGlyph(glyph: string): this {
        this._options.glyph = glyph;
        this._header.setGlyph(glyph);

        return this;
    }

    // ----- AbstractWindow hook implementations -----

    /**
     * Wires the window-move gesture: a plain header `mousedown` starts a window
     * move, a Shift-held press is captured for the re-dock drag source, and the
     * header is registered as a tab-dock drag source.
     */
    protected wireMoveTrigger(): void {
        // Subtree listeners (not exact-target) because the header's title row sits
        // inside a Border clip-frame wrapper: a press on the title text or glyph
        // targets that wrapper, not the bare header element, so an exact-target
        // listener would miss it. Matches the drag source below, which already
        // observes the whole header subtree via addMouseDownSubtreeListener.
        // Vetoes a press on the trailing minimize/maximize/close buttons — those
        // own their own click handlers and must not also start a window move.
        Event.addSubtreeListener(this._header, "mousedown", this._boundOnHeaderMouseDown);

        // Shift-drag the header to re-dock the window's body content onto a Tab
        // strip. The capture listener records the modifier (registered before the
        // drag source so it runs first); the drag source vetoes a plain (no-Shift)
        // press so the normal window move runs.
        Event.addSubtreeListener(this._header, "mousedown", this._boundCaptureHeaderShift);
        DragManager.makeDragSource(this._header, {
            dragData: (): DragData => this.buildHeaderDragData(),
            onDragStart: (): boolean | void => this.onHeaderDragStart(),
            onDragEnd: (_detail: DragEventDetail, dropped: boolean): void => this.onHeaderDragEnd(dropped),
        });
    }

    /**
     * Reflects the closeable state onto the header close button.
     *
     * @param value - True to enable the close button.
     */
    protected reflectCloseable(value: boolean): void {
        this._header.setCloseable(value);
    }

    /**
     * Reflects the minimizable state onto the header minimize button.
     *
     * @param value - True to show the minimize button.
     */
    protected reflectMinimizable(value: boolean): void {
        this._header.setMinimizable(value);
    }

    /**
     * Reflects the maximizable state onto the header maximize button.
     *
     * @param value - True to show the maximize button.
     */
    protected reflectMaximizable(value: boolean): void {
        this._header.setMaximizable(value);
    }

    /**
     * Reflects the maximize-availability gate onto the header maximize
     * button's enabled state, without touching its visibility.
     *
     * @param value - True to enable the maximize button.
     */
    protected reflectMaximizeAvailability(value: boolean): void {
        this._header.setMaximizeButtonEnabled(value);
    }

    /**
     * Swaps the header control glyphs to match the window state: the maximize
     * button shows `window-restore` when maximized (else `window-maximize`), and
     * the minimize button shows `window-restore` when minimized (else
     * `window-minimize`). A minimized window stays docked at header height with
     * both buttons visible, so reflecting the minimized state onto the minimize
     * button keeps it symmetric with the maximize/restore swap.
     *
     * @param state - The window state being entered.
     */
    protected reflectMaximizeState(state: WindowState): void {
        this._header.setMaximizeButtonGlyph(state === "maximized" ? "window-restore" : "window-maximize");
        this._header.setMinimizeButtonGlyph(state === "minimized" ? "window-restore" : "window-minimize");
    }

    /**
     * Paints the active/inactive state onto the title bar.
     *
     * @param active - True when this window is the active layer.
     */
    protected paintActive(active: boolean): void {
        this._header.setActive(active);
    }

    /**
     * Returns the title-bar text for serialization.
     *
     * @returns The current header text.
     */
    getTitle(): string {
        return String(this._header.getText().getText());
    }

    /**
     * Returns the header's required width, seeded into the default min size.
     *
     * @returns The header min-content width in pixels.
     */
    protected minContentWidthSeed(): number {
        return this._header.getMinContentWidth();
    }

    /**
     * Returns the header's laid-out height — the window's title chrome height.
     *
     * @returns The header height in pixels.
     */
    protected chromeHeight(): number {
        return this._header.getHeight();
    }

    /**
     * Adds content to the window's CENTER region.
     *
     * @param content - The content component to add.
     */
    protected addContent(content: Component): void {
        this.addComponent(content, { placement: Placement.CENTER });
    }

    /**
     * Reports whether `child` is the window's chrome — true only for the header.
     *
     * @param child - The child component to classify.
     * @returns True when `child` is the header.
     */
    isChromeComponent(child: Component): boolean {
        return child === this._header;
    }

    // ----- header-specific gestures -----

    /**
     * Starts a window move from a header press, unless the press lands on one
     * of the trailing minimize/maximize/close buttons — those own their own
     * click handlers and must not also drag the window.
     *
     * @param e - The header `mousedown` event.
     */
    private onHeaderMouseDown(e: MouseEvent): void {
        const target = e.target === null ? null : DOM.source.intern(e.target);
        if (target && this.targetIsInHeaderControl(target)) {
            return;
        }

        this.onMouseDown(e);
    }

    /**
     * Handles `dblclick` on the header bar. When minimized, restores to the
     * pre-minimize state (`"normal"` or `"maximized"`); otherwise toggles
     * maximize. Clicks on the trailing buttons are ignored — they own their
     * own handlers.
     *
     * @param e - The header `dblclick` event.
     */
    private onHeaderDoubleClick(e: MouseEvent): void {
        const target = e.target === null ? null : DOM.source.intern(e.target);
        if (target && this.targetIsInHeaderControl(target)) {
            return;
        }

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
     * Returns whether `target` lies inside one of the header's own controls —
     * the trailing minimize / maximize / exit buttons, or the leading title
     * icon — each of which owns its own click handler and must not also
     * start a window move or trigger the header's double-click maximize.
     *
     * @param target - The event target handle to test.
     * @returns True when the target is inside a header control.
     */
    private targetIsInHeaderControl(target: Handle): boolean {
        const controls: Array<Handle | undefined> = [
            this._header.getMinimizeButtonElement(),
            this._header.getMaximizeButtonElement(),
            this._header.getExitButtonElement(),
            this._header.getGlyph()?.getElement(),
        ];
        for (const control of controls) {
            if (control && DOM.source.contains(control, target)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Opens the window menu anchored under the header's title icon, in
     * response to a click on it.
     */
    private onTitleGlyphClick(): void {
        const glyph = this._header.getGlyph();

        if (glyph) {
            this.openWindowMenu(glyph);
        }
    }

    /**
     * Records whether Shift was held at the header press, so the header drag
     * source — whose callbacks receive no key state — can tell a re-dock gesture
     * from a plain window move.
     *
     * @param e - The header `mousedown` event.
     */
    private captureHeaderShift(e: MouseEvent): void {
        this._headerDragShift = e.shiftKey;
    }

    /**
     * Builds the tab-dock payload for a Shift-drag of the header. `sourceTabId` is
     * the window's own id — never a strip's, so a drop target treats it as a
     * foreign dock rather than a same-strip reorder.
     *
     * @returns The {@link TabDragData} payload for the window's body content.
     */
    private buildHeaderDragData(): DragData {
        const content = this.findBodyHost();

        const data: TabDragData = {
            tabDrag:     true,
            sourceTabId: this.getId(),
            componentId: content ? content.getId() : "",
            label:       String(this._header.getText().getText()),
        };

        return { ...data };
    }

    /**
     * Vetoes the header drag unless Shift was held and the window has body
     * content. When it proceeds, it registers the live content so the
     * destination strip can resolve it from the id-only drag data.
     *
     * @returns `false` to veto (plain move / nothing to dock); otherwise `void`.
     */
    private onHeaderDragStart(): boolean | void {
        const shift = this._headerDragShift;
        this._headerDragShift = false;

        const content = this.findBodyHost();

        if (!shift || !content) {
            return false;
        }

        this._headerDragComponentId = content.getId();
        tabDragRegistry.set(content.getId(), content);
    }

    /**
     * Cleans up the registry entry once the gesture ends and, when the drop
     * docked the content elsewhere (so the window has emptied), closes the window.
     *
     * @param dropped - `true` when the release landed on a registered drop
     *   target (whether it accepted or refused the drop); `false` on a release
     *   over empty space. The window only closes when the content actually left.
     */
    private onHeaderDragEnd(dropped: boolean): void {
        tabDragRegistry.delete(this._headerDragComponentId);
        this._headerDragComponentId = "";

        if (dropped && this.findBodyHost() === null) {
            this.requestClose();
        }
    }
}

const WindowCallable = callable(Window);
type WindowCallable = Window;
export {
    Window         as _Window,
    WindowCallable as Window
};
