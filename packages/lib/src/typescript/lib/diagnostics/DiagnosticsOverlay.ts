// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Window } from "~/overlay/Window.js";
import { Panel } from "~/core/Panel.js";
import { VBox } from "~/layout/VBox.js";
import { LabeledGrid, type LabeledRowDescriptor } from "~/component/container/LabeledGrid.js";
import { Header } from "~/component/display/Header.js";
import { Text } from "~/component/input/Text.js";
import { Placement } from "~/primitive/Placement.js";
import { DiagnosticsSampler, type DiagnosticsSample } from "~/diagnostics/DiagnosticsSampler.js";

/** Overlay window size and starting position — see `## Internal Structure`. */
const OVERLAY_X      = 24;
const OVERLAY_Y      = 24;
const OVERLAY_WIDTH  = 320;
const OVERLAY_HEIGHT = 460;

/**
 * A floating window showing live runtime diagnostics: browser-level numbers
 * (FPS, JS heap, DOM node count, long tasks) beside framework-internal ones
 * (live `Component` count, layout passes and flush time, DOM/semantic
 * listener registrations, per-instance stylesheet rules). Each framework
 * number corresponds to a leak class this codebase has shipped and fixed —
 * open it against a running app to watch for one recurring.
 *
 * Opened and closed only through the static surface — there is no public
 * constructor.
 *
 * @example
 * ```typescript
 * DiagnosticsOverlay.open();
 * ```
 *
 * @category Core
 */
// Intentional exception to the `callable()`-wrap rule, mirroring Tooltip:
// `DiagnosticsOverlay` has a private constructor and is used only through its
// static methods (`open` / `close` / `toggle` / `isOpen`), so there is no
// public `new DiagnosticsOverlay()` / `DiagnosticsOverlay(...)` surface to wrap.
export class DiagnosticsOverlay extends Window {

    private static instance: DiagnosticsOverlay | null = null;

    private readonly _sampler: DiagnosticsSampler;

    private readonly _fps:                 Text = new Text();
    private readonly _frameTime:           Text = new Text();
    private readonly _heap:                Text = new Text();
    private readonly _domNodes:            Text = new Text();
    private readonly _longTasks:           Text = new Text();
    private readonly _componentsText:      Text = new Text();
    private readonly _constructedDisposed: Text = new Text();
    private readonly _layoutPasses:        Text = new Text();
    private readonly _layoutFlush:         Text = new Text();
    private readonly _domListeners:        Text = new Text();
    private readonly _semanticListeners:   Text = new Text();
    private readonly _styleRules:          Text = new Text();

    private readonly _boundOnSample: (sample: DiagnosticsSample) => void = (sample) => this.onSample(sample);

    /** Private — use the static methods; only one instance is ever created. */
    private constructor() {
        super("Diagnostics");

        this.setX(OVERLAY_X);
        this.setY(OVERLAY_Y);
        this.setWidth(OVERLAY_WIDTH);
        this.setHeight(OVERLAY_HEIGHT);

        const rows: LabeledRowDescriptor[] = [
            { component: new Header("Browser"), fullWidth: true },
            [{ title: "FPS",                    component: this._fps }],
            [{ title: "Frame time",             component: this._frameTime }],
            [{ title: "JS heap",                component: this._heap }],
            [{ title: "DOM nodes",              component: this._domNodes }],
            [{ title: "Long tasks",             component: this._longTasks }],
            { component: new Header("Framework"), fullWidth: true },
            [{ title: "Components",             component: this._componentsText }],
            [{ title: "Constructed / disposed", component: this._constructedDisposed }],
            [{ title: "Layout passes",          component: this._layoutPasses }],
            [{ title: "Layout flush",           component: this._layoutFlush }],
            [{ title: "DOM listeners",          component: this._domListeners }],
            [{ title: "Semantic listeners",     component: this._semanticListeners }],
            [{ title: "Stylesheet rules",       component: this._styleRules }],
        ];

        const body = new Panel({
            autoScroll:    "y",
            layoutManager: new VBox({ stretching: true }),
        });
        body.addComponent(new LabeledGrid({ columns: 1, rows }));

        this.addComponent(body, { placement: Placement.CENTER });

        this._sampler = new DiagnosticsSampler({ onSample: this._boundOnSample });
    }

    /**
     * Opens the overlay, creating it on first call. Idempotent — a second
     * call raises the existing window instead of building another.
     */
    static open(): void {
        if (DiagnosticsOverlay.instance === null) {
            const instance = new DiagnosticsOverlay();

            DiagnosticsOverlay.instance = instance;

            instance.show();
            instance._sampler.start();
        }

        DiagnosticsOverlay.instance.bringToFront();
    }

    /**
     * Closes the overlay. A no-op while already closed.
     */
    static close(): void {
        if (DiagnosticsOverlay.instance !== null) {
            const instance = DiagnosticsOverlay.instance;

            instance.onExitAction();
        }
    }

    /**
     * Opens the overlay when closed, closes it when open.
     */
    static toggle(): void {
        if (DiagnosticsOverlay.isOpen()) {
            DiagnosticsOverlay.close();
        } else {
            DiagnosticsOverlay.open();
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
        return DiagnosticsOverlay.instance !== null;
    }

    /**
     * Stops the sampler and clears the static instance slot. Idempotent, and
     * safe to call from both the animated close path ({@link onExitAction})
     * and a direct {@link destructor} (a `dispose()` that bypassed it).
     */
    private teardown(): void {
        this._sampler.stop();

        if (DiagnosticsOverlay.instance === this) {
            DiagnosticsOverlay.instance = null;
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
    protected override destructor(): void {
        this.teardown();
        super.destructor();
    }

    /**
     * Writes one sample's readings into the metric rows.
     *
     * @param sample - The latest {@link DiagnosticsSample}.
     */
    private onSample(sample: DiagnosticsSample): void {
        this._fps.setText(String(Math.round(sample.fps)));
        this._frameTime.setText(`${sample.frameTimeMs.toFixed(1)} ms (max ${sample.frameTimeMaxMs.toFixed(1)})`);
        this._heap.setText(
            sample.heapUsedMB !== null && sample.heapLimitMB !== null
                ? `${sample.heapUsedMB.toFixed(1)} / ${sample.heapLimitMB.toFixed(1)} MB`
                : "unavailable",
        );
        this._domNodes.setText(String(sample.domNodes));
        this._longTasks.setText(`${sample.longTasks} (+${sample.longTasksRecent})`);
        this._componentsText.setText(String(sample.components));
        this._constructedDisposed.setText(`${sample.componentsConstructed} / ${sample.componentsDestroyed}`);
        this._layoutPasses.setText(`${Math.round(sample.layoutPassesPerSec)} /s`);
        this._layoutFlush.setText(`${sample.layoutFlushAvgMs.toFixed(2)} ms (max ${sample.layoutFlushMaxMs.toFixed(2)})`);
        this._domListeners.setText(String(sample.domListeners));
        this._semanticListeners.setText(String(sample.semanticListeners));
        this._styleRules.setText(
            `${sample.styleRules.total} (${sample.styleRules.instance} inst / ${sample.styleRules.class} cls)`,
        );
    }
}
