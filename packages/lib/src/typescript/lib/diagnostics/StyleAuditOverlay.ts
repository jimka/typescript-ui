// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Window } from "~/overlay/Window.js";
import { VBox } from "~/layout/VBox.js";
import { Placement } from "~/primitive/Placement.js";
import { StyleAuditView } from "~/diagnostics/StyleAuditView.js";
import { Container } from "../core";

/** Overlay window size and starting position — see `## Internal Structure`. */
const WINDOW_X      = 360;
const WINDOW_Y      = 24;
const WINDOW_WIDTH  = 800;
const WINDOW_HEIGHT = 520;

/**
 * A floating window showing the stylesheet-dedup audit — the same view
 * embedded in the demo app's own "Style Audit" tab, opened alongside
 * {@link DiagnosticsOverlay}. Its `WINDOW_X` sits to the right of
 * `DiagnosticsOverlay`'s own window, so the two do not fully overlap when
 * both are open.
 *
 * Opened and closed only through the static surface — there is no public
 * constructor.
 *
 * @example
 * ```typescript
 * StyleAuditOverlay.open();
 * ```
 *
 * @category Core
 */
// Intentional exception to the `callable()`-wrap rule, mirroring
// DiagnosticsOverlay: `StyleAuditOverlay` has a private constructor and is
// used only through its static methods (`open` / `close` / `toggle` /
// `isOpen`), so there is no public `new StyleAuditOverlay()` /
// `StyleAuditOverlay(...)` surface to wrap.
export class StyleAuditOverlay extends Window {

    private static instance: StyleAuditOverlay | null = null;

    /** Private — use the static methods; only one instance is ever created. */
    private constructor() {
        super("Style Audit");

        this.setX(WINDOW_X);
        this.setY(WINDOW_Y);
        this.setWidth(WINDOW_WIDTH);
        this.setHeight(WINDOW_HEIGHT);

        const body = new Container({
            autoScroll:    "y",
            layoutManager: new VBox({ stretching: true }),
        });
        body.addComponent(new StyleAuditView(), { weight: 1 });

        this.addComponent(body, { placement: Placement.CENTER });
    }

    /**
     * Opens the overlay, creating it on first call. Idempotent — a second
     * call raises the existing window instead of building another.
     */
    static open(): void {
        if (StyleAuditOverlay.instance === null) {
            const instance = new StyleAuditOverlay();

            StyleAuditOverlay.instance = instance;

            instance.show();
        }

        StyleAuditOverlay.instance.bringToFront();
    }

    /**
     * Closes the overlay. A no-op while already closed.
     */
    static close(): void {
        if (StyleAuditOverlay.instance !== null) {
            const instance = StyleAuditOverlay.instance;

            instance.onExitAction();
        }
    }

    /**
     * Opens the overlay when closed, closes it when open.
     */
    static toggle(): void {
        if (StyleAuditOverlay.isOpen()) {
            StyleAuditOverlay.close();
        } else {
            StyleAuditOverlay.open();
        }
    }

    /**
     * Whether the overlay is currently open.
     *
     * @returns `true` between an `open()` and its matching `close()` —
     *   `false` immediately on `close()`, not only once the close animation
     *   finishes.
     */
    static isOpen(): boolean {
        return StyleAuditOverlay.instance !== null;
    }

    /**
     * Clears the static instance slot. Idempotent, and safe to call from both
     * the animated close path ({@link onExitAction}) and a direct
     * {@link destructor} (a `dispose()` that bypassed it). Unlike
     * `DiagnosticsOverlay`, there is no sampler to stop.
     */
    private teardown(): void {
        if (StyleAuditOverlay.instance === this) {
            StyleAuditOverlay.instance = null;
        }
    }

    /**
     * Runs teardown before the inherited close animation starts, so
     * {@link isOpen} already reads `false` while it plays out.
     */
    override onExitAction(): void {
        this.teardown();
        super.onExitAction();
    }

    /**
     * The safety net for a direct `dispose()` that bypassed {@link onExitAction}.
     */
    protected destructor(): void {
        this.teardown();
        super.destructor();
    }
}
