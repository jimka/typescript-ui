// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Border } from "~/layout/Border.js";
import { BorderStyle } from "~/primitive/BorderStyle.js";
import { WindowHeader } from "~/component/container/WindowHeader.js";
import { WindowBorder, Direction } from "~/component/container/WindowBorder.js";
import { Event } from "~/core/Event.js";
import { Animation } from "~/core/Animation.js";
import { Placement } from "~/primitive/Placement.js";
import { Panel, PanelOptions } from "~/core/Panel.js";
import { callable } from "~/core/Callable.js";

const WINDOW_ANIM_DURATION_MS: number = 150;

/**
 * Construction-time options for {@link Window}.
 *
 * @category Core
 */
export interface WindowOptions extends PanelOptions {
    headerText?: string;
    glyph?:      string | null;
}

/**
 * A floating, resizable, and draggable window component.
 *
 * Renders a titled panel with eight border-handle strips that the user can
 * drag to resize the window from any edge or corner.
 *
 * @category Core
 */
class Window extends Panel {

    private static zIndexCounter: number = 9000;
    private static activeWindow: Window | null = null;
    private static openWindows: Set<Window> = new Set<Window>();

    private static readonly deactivateIfOutside: (e: MouseEvent) => void = (evnt: MouseEvent) => {
        for (const win of Window.openWindows) {
            const el = win.getElement();
            if (el && el.contains(evnt.target as Node)) {
                return;
            }
        }

        if (Window.activeWindow) {
            Window.activeWindow.header.setActive(false);
            Window.activeWindow = null;
        }
    };

    private header: WindowHeader;
    private borderComponents: {
        west: WindowBorder,
        northwest: WindowBorder,
        north: WindowBorder,
        northeast: WindowBorder,
        east: WindowBorder,
        southeast: WindowBorder,
        south: WindowBorder,
        southwest: WindowBorder,
    };

    private animationFrameId: number | null = null;
    private pendingMouseDX: number = 0;
    private pendingMouseDY: number = 0;
    private pendingBorder: WindowBorder | null = null;
    private resizeFps: number = 60;
    private lastFlushTime: number = 0;
    private _dragStartLeft: number = 0;
    private _dragStartTop: number = 0;
    private _dragDX: number = 0;
    private _dragDY: number = 0;
    private readonly boundOnDrag: (e: MouseEvent) => void = (e: MouseEvent) => this.onDrag(e);
    private readonly boundOnMouseUp: () => void = () => this.onMouseUp();

    constructor(headerText: string, options?: WindowOptions) {
        super();

        this.setLayoutManager(new Border());

        this.borderComponents = {
            west: new WindowBorder(Direction.WEST),
            northwest: new WindowBorder(Direction.NORTHWEST),
            north: new WindowBorder(Direction.NORTH),
            northeast: new WindowBorder(Direction.NORTHEAST),
            east: new WindowBorder(Direction.EAST),
            southeast: new WindowBorder(Direction.SOUTHEAST),
            south: new WindowBorder(Direction.SOUTH),
            southwest: new WindowBorder(Direction.SOUTHWEST),
        };

        this.borderComponents.west.addDragListener((border: WindowBorder, e: MouseEvent) => this.onResize(border, e));
        this.borderComponents.northwest.addDragListener((border: WindowBorder, e: MouseEvent) => this.onResize(border, e));
        this.borderComponents.north.addDragListener((border: WindowBorder, e: MouseEvent) => this.onResize(border, e));
        this.borderComponents.northeast.addDragListener((border: WindowBorder, e: MouseEvent) => this.onResize(border, e));
        this.borderComponents.east.addDragListener((border: WindowBorder, e: MouseEvent) => this.onResize(border, e));
        this.borderComponents.southeast.addDragListener((border: WindowBorder, e: MouseEvent) => this.onResize(border, e));
        this.borderComponents.south.addDragListener((border: WindowBorder, e: MouseEvent) => this.onResize(border, e));
        this.borderComponents.southwest.addDragListener((border: WindowBorder, e: MouseEvent) => this.onResize(border, e));

        this.header = new WindowHeader(headerText || "Window");
        this.addComponent(this.header, {
            placement: Placement.NORTH,
            ignoreParentInsets: true
        });
        this.header.addExitButtonListener(() => this.onExitAction());

        this.setVisible(false);
        this.setBorder({ style: BorderStyle.SOLID, width: 1, color: "var(--ts-ui-border-color, black)" });
        this.setBorderRadius("var(--ts-ui-border-radius, 4px)");
        // Resizable — size containment unsafe; layout containment scopes reflow to the window subtree.
        this.setElementCSSRule("contain", "layout");
        this.setShadow("var(--ts-ui-window-shadow, 3px 3px 2px rgba(0, 0, 0, 0.4))");
        this.setBackgroundColor("var(--ts-ui-body-bg, rgb(241, 241, 241))");

        Event.addListener(this.header, "mousedown", () => this.onMouseDown());
        Event.addSubtreeListener(this, "mousedown", () => this.bringToFront());

        if (this.constructor === Window && options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link WindowOptions} bag, dispatching the header text and
     * title-icon glyph after inherited Panel fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: WindowOptions): this {
        super.applyOptions(options);

        if (options.headerText !== undefined) {
            this.setHeaderText(options.headerText);
        }

        if (options.glyph !== undefined) {
            this.header.setGlyph(options.glyph);
        }

        return this;
    }

    /**
     * Returns the window's title-bar component.
     *
     * @returns The internal {@link WindowHeader} instance, exposing the close
     *          button, title text, and optional title-icon slot.
     */
    getHeader(): WindowHeader {
        return this.header;
    }

    /**
     * Appends the window element to the document root, triggers layout, and makes it visible.
     */
    show(): this {
        const el = this.getElement(true);

        this.doLayout();
        this.bringToFront();

        if (Window.openWindows.size === 0) {
            window.addEventListener('mousedown', Window.deactivateIfOutside, true);
        }

        Window.openWindows.add(this);

        document.documentElement.appendChild(el);

        this.setVisible(true);

        Animation.play(el, {
            from:       { opacity: "0", transform: "scale(0.97)" },
            to:         { opacity: "1", transform: "scale(1)"    },
            durationMs: WINDOW_ANIM_DURATION_MS,
            properties: ["opacity", "transform"],
        });

        return this;
    }

    /**
     * Raises this window above all other windows by assigning it the highest z-index,
     * and marks it as the active window, updating the title bar appearance on both
     * the previously active window and this one.
     */
    bringToFront(): void {
        const prev = Window.activeWindow;

        if (prev && prev !== this) {
            prev.header.setActive(false);
        }

        Window.activeWindow = this;
        this.setZIndex(++Window.zIndexCounter);
        this.header.setActive(true);
    }

    /**
     * Hides the window and destroys its DOM element when the close button is clicked.
     */
    onExitAction(): void {
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        if (Window.activeWindow === this) {
            Window.activeWindow = null;
        }

        Window.openWindows.delete(this);

        if (Window.openWindows.size === 0) {
            window.removeEventListener('mousedown', Window.deactivateIfOutside, true);
        }

        const el = this.getElement();
        const finalize = (): void => {
            this.setVisible(false);
            this.destructor();
        };

        if (!el) {
            finalize();
            return;
        }

        Animation.play(el, {
            to:         { opacity: "0", transform: "scale(0.97)" },
            durationMs: WINDOW_ANIM_DURATION_MS,
            properties: ["opacity", "transform"],
            onComplete: finalize,
        });
    }

    /**
     * Updates the text shown in the window's title bar.
     *
     * @param text - The new header label text.
     */
    setHeaderText(text: string) : this {
        if (!this.header) {
            throw new Error("Window does not have a header.");
        }

        this.header.getText().setText(text);

        return this;
    }

    /**
     * Attaches document-level move and mouseup listeners to begin dragging the window.
     */
    onMouseDown() {
        // Snapshot the current position so onDrag's accumulator runs from a fixed origin
        // and onMouseUp can commit (origin + accumulated delta) back to left/top.
        this._dragStartLeft = this.getX();
        this._dragStartTop  = this.getY();
        this._dragDX = 0;
        this._dragDY = 0;

        // Viewport listeners are required (rather than direct document listeners) because
        // Event.baseViewportListener stops mouseup propagation at window capture phase
        // whenever any viewport listener for the type exists (e.g. SpinButton registers
        // one at construction), which would prevent document-level handlers from firing.
        Event.addViewportListener(this, 'mouseup', this.boundOnMouseUp);
        Event.addViewportListener(this, 'mousemove', this.boundOnDrag);
    }

    /**
     * Adjusts the window's position and size based on the dragged border direction.
     *
     * @param border - The border handle that triggered the resize.
     * @param e - The mouse event carrying the movement delta.
     */
    onResize(border: WindowBorder, e: MouseEvent) {
        e.preventDefault();

        this.pendingMouseDX += e.movementX;
        this.pendingMouseDY += e.movementY;
        this.pendingBorder = border;

        if (this.animationFrameId === null) {
            this.animationFrameId = requestAnimationFrame((ts) => this.flushResize(ts));
        }
    }

    /**
     * Sets the maximum number of layout passes per second during a resize drag.
     *
     * @param fps - Frames per second cap (e.g. 30 or 20). Defaults to 60.
     */
    setResizeFps(fps: number) : this {
        this.resizeFps = fps;

        return this;
    }

    private flushResize(timestamp: number) {
        if (timestamp - this.lastFlushTime < 1000 / this.resizeFps) {
            this.animationFrameId = requestAnimationFrame((ts) => this.flushResize(ts));
            return;
        }

        this.lastFlushTime = timestamp;
        this.animationFrameId = null;

        const dx = this.pendingMouseDX;
        const dy = this.pendingMouseDY;
        const border = this.pendingBorder;

        this.pendingMouseDX = 0;
        this.pendingMouseDY = 0;
        this.pendingBorder = null;

        if (!border) {
            return;
        }

        this.setAutoCommitStyle(false);
        switch (border.getDirection()) {
            case Direction.NORTHWEST:
                this.setX(this.getX() + dx);
                this.setY(this.getY() + dy);
                this.setWidth(this.getWidth() - dx);
                this.setHeight(this.getHeight() - dy);

                break;
            case Direction.NORTH:
                this.setY(this.getY() + dy);
                this.setHeight(this.getHeight() - dy);

                break;
            case Direction.NORTHEAST:
                this.setY(this.getY() + dy);
                this.setWidth(this.getWidth() + dx);
                this.setHeight(this.getHeight() - dy);

                break;
            case Direction.EAST:
                this.setWidth(this.getWidth() + dx);

                break;
            case Direction.SOUTHEAST:
                this.setWidth(this.getWidth() + dx);
                this.setHeight(this.getHeight() + dy);

                break;
            case Direction.SOUTH:
                this.setHeight(this.getHeight() + dy);

                break;
            case Direction.SOUTHWEST:
                this.setX(this.getX() + dx);
                this.setWidth(this.getWidth() - dx);
                this.setHeight(this.getHeight() + dy);

                break;
            case Direction.WEST:
                this.setX(this.getX() + dx);
                this.setWidth(this.getWidth() - dx);

                break;
        }

        this.doLayout();
        this.setAutoCommitStyle(true);
    }

    /**
     * Moves the window by the mouse movement delta while dragging.
     *
     * @param e - The mouse event carrying the movement delta.
     */
    onDrag(e: MouseEvent) {
        e.preventDefault();

        this._dragDX += e.movementX;
        this._dragDY += e.movementY;

        // Compositor-only translate during drag; the cached left/top stay at the start
        // position so the field-DOM invariant holds (left === style.left throughout).
        this.setTranslate(this._dragDX, this._dragDY);
    }

    /**
     * Detaches the document-level drag listeners when the mouse button is released.
     */
    onMouseUp() {
        // Commit the in-progress translate back to left/top so subsequent layout passes
        // operate from the new position. setTranslate(0, 0) frees the compositor layer.
        this.setX(this._dragStartLeft + this._dragDX);
        this.setY(this._dragStartTop  + this._dragDY);
        this.setTranslate(0, 0);

        Event.removeViewportListener(this, 'mouseup', this.boundOnMouseUp);
        Event.removeViewportListener(this, 'mousemove', this.boundOnDrag);
    }

    /**
     * Runs the border layout and positions all eight resize-handle strips around the window.
     *
     * @returns This component, for method chaining.
     */
    doLayout(): this {
        super.doLayout();

        let borderSize = this.getBorderSize();
        let insets = this.getInsets();
        let horisontallBorderWidth = (Number(borderSize.left) || 0) + (Number(borderSize.right) || 0) + insets.getLeft();
        let verticalBorderWidth = (Number(borderSize.top) || 0) + (Number(borderSize.bottom) || 0) + insets.getTop();
        let size = this.getSize();
        if (!size) {
            throw new Error("Component doesn't seem to be rendered.");
        }

        let innerSize = this.getInnerSize();
        if (!innerSize) {
            throw new Error("Component doesn't seem to be rendered.");
        }

        this.borderComponents.west.setAutoCommitStyle(false);
        this.borderComponents.northwest.setAutoCommitStyle(false);
        this.borderComponents.north.setAutoCommitStyle(false);
        this.borderComponents.northeast.setAutoCommitStyle(false);
        this.borderComponents.east.setAutoCommitStyle(false);
        this.borderComponents.southeast.setAutoCommitStyle(false);
        this.borderComponents.south.setAutoCommitStyle(false);
        this.borderComponents.southwest.setAutoCommitStyle(false);

        this.borderComponents.west.setX(0);
        this.borderComponents.west.setY(insets.getTop());
        this.borderComponents.west.setWidth(insets.getLeft());
        this.borderComponents.west.setHeight(innerSize.height);

        this.borderComponents.northwest.setX(0);
        this.borderComponents.northwest.setY(0);
        this.borderComponents.northwest.setWidth(insets.getLeft());
        this.borderComponents.northwest.setHeight(insets.getTop());

        this.borderComponents.north.setX(insets.getLeft());
        this.borderComponents.north.setY(0);
        this.borderComponents.north.setWidth(innerSize.width);
        this.borderComponents.north.setHeight(insets.getTop());

        this.borderComponents.northeast.setX(size.width - horisontallBorderWidth);
        this.borderComponents.northeast.setY(0);
        this.borderComponents.northeast.setWidth(insets.getRight());
        this.borderComponents.northeast.setHeight(insets.getTop());

        this.borderComponents.east.setX(size.width - horisontallBorderWidth);
        this.borderComponents.east.setY(insets.getTop());
        this.borderComponents.east.setWidth(insets.getRight());
        this.borderComponents.east.setHeight(innerSize.height);

        this.borderComponents.southeast.setX(size.width - horisontallBorderWidth);
        this.borderComponents.southeast.setY(size.height - verticalBorderWidth);
        this.borderComponents.southeast.setWidth(insets.getRight());
        this.borderComponents.southeast.setHeight(insets.getBottom());

        this.borderComponents.south.setX(insets.getLeft());
        this.borderComponents.south.setY(size.height - verticalBorderWidth);
        this.borderComponents.south.setWidth(innerSize.width);
        this.borderComponents.south.setHeight(insets.getRight());

        this.borderComponents.southwest.setX(0);
        this.borderComponents.southwest.setY(size.height - verticalBorderWidth);
        this.borderComponents.southwest.setWidth(insets.getLeft());
        this.borderComponents.southwest.setHeight(insets.getBottom());

        this.borderComponents.west.setAutoCommitStyle(true);
        this.borderComponents.northwest.setAutoCommitStyle(true);
        this.borderComponents.north.setAutoCommitStyle(true);
        this.borderComponents.northeast.setAutoCommitStyle(true);
        this.borderComponents.east.setAutoCommitStyle(true);
        this.borderComponents.southeast.setAutoCommitStyle(true);
        this.borderComponents.south.setAutoCommitStyle(true);
        this.borderComponents.southwest.setAutoCommitStyle(true);

        return this;
    }

    /**
     * Creates the window element and appends all eight resize-handle border elements.
     *
     * @returns The root HTMLElement for this window.
     */
    render() {
        let element = super.render();

        element.appendChild(this.borderComponents.west.getElement(true));
        element.appendChild(this.borderComponents.northwest.getElement(true));
        element.appendChild(this.borderComponents.north.getElement(true));
        element.appendChild(this.borderComponents.northeast.getElement(true));
        element.appendChild(this.borderComponents.east.getElement(true));
        element.appendChild(this.borderComponents.southeast.getElement(true));
        element.appendChild(this.borderComponents.south.getElement(true));
        element.appendChild(this.borderComponents.southwest.getElement(true));

        return element;
    }
}

const WindowCallable = callable(Window);
type WindowCallable = Window;
export {
    Window         as _Window,
    WindowCallable as Window
};
