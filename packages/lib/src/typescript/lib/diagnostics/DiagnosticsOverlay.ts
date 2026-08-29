// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Window } from "~/overlay/Window.js";
import { VBox } from "~/layout/VBox.js";
import { LabeledGrid, type LabeledRowDescriptor } from "~/component/container/LabeledGrid.js";
import { Header } from "~/component/display/Header.js";
import { Text } from "~/component/input/Text.js";
import { Button } from "~/component/button/Button.js";
import { Tooltip } from "~/overlay/Tooltip.js";
import { Placement } from "~/primitive/Placement.js";
import { DiagnosticsSampler, type DiagnosticsSample } from "~/diagnostics/DiagnosticsSampler.js";
import { StyleAuditOverlay } from "~/diagnostics/StyleAuditOverlay.js";
import { Container } from "../core";

/** Overlay window size and starting position — see `## Internal Structure`. */
const OVERLAY_X      = 24;
const OVERLAY_Y      = 24;
const OVERLAY_WIDTH  = 320;
const OVERLAY_HEIGHT = 460;

/**
 * The in-app copy for each metric row, shown as a hover tooltip on both the
 * row's label and its value. A change here should be mirrored in
 * `docs/components/DiagnosticsOverlay.md`'s row-by-row table.
 */
const ROW_DESCRIPTIONS = {
    fps: "Frames per second\n\nFrames completed in the last half-second, expressed per second. The overlay asks the browser for a frame every frame, so an idle app reads at the display's refresh rate — a drop is the signal, the absolute number is not.",
    frameTime: "Average frame time\n\nAverage gap between frames over the last half-second, with the longest single gap in brackets. The average is just 1000 / FPS; the maximum is where a one-off stutter shows up.",
    heap: "Heap memory usage\n\nUsed JavaScript heap against the engine's limit, from performance.memory. Chromium-only and quantised — read the trend across an interaction, not the digits. Shows 'unavailable' on engines that do not expose it.",
    domNodes: "Elements in the document\n\nCounted with document.querySelectorAll('*'). Elements only — text and comment nodes are not counted. A count that does not return to its starting point after a repeated open/close means elements are outliving their components.",
    longTasks: "Main-thread tasks longer than 50 ms\n\nReported by PerformanceObserver: the total since the overlay opened, with the count from the last half-second in brackets. Stays at 0 on engines with no long-task reporting.",
    components: "Live Component count\n\nConstructed minus disposed. A component dropped without dispose() is still counted, on purpose: that is the leak this number exists to expose. It is not garbage-collection aware.",
    constructedDisposed: "The two running totals the Components figure is derived from. Both only ever rise. Rising together with a steady gap is ordinary churn; a gap that widens is a leak.",
    layoutPasses: "doLayout() calls per second\n\nA raw call count, not a measure of layout cost. A deep tree of cheap layouts scores higher than a shallow tree of expensive ones, so read Layout flush for cost. A rate that stays high while nothing is happening means something calls scheduleLayout() on every pass.",
    layoutFlush: "Layout flush times\n\nAverage and longest time one coalesced layout flush took, in milliseconds. Timed once per flush, never per component. Both figures reset each time the overlay opens: the average dilutes over a long session, the maximum only ever rises.",
    domListeners: "DOM-event listeners\n\nLive DOM-event registrations across the framework's exact-target, subtree and viewport maps. Destroying a component purges its registrations, so a count that does not come back down after a repeated open/close means components are not being destroyed.",
    semanticListeners: "Live ListenerBag registrations\n\nThe framework's own on() / off() subscriptions such as theme changes and model events, not DOM events. Added minus removed.",
    styleRules: "Style rules\n\nRules currently materialised on the framework's shared stylesheet, with the per-component (#id) and shared-class counts in brackets. The two bracketed figures do not add up to the total — verbatim selector rules make up the rest. Per-component rules should fall as their components are disposed.",
} as const;

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

    private readonly _styleAuditButton: Button = new Button("Show style audit");
    private readonly _boundOnOpenStyleAudit: () => void = () => StyleAuditOverlay.open();

    /** Private — use the static methods; only one instance is ever created. */
    private constructor() {
        super("Diagnostics", { resizable: false });

        this.setX(OVERLAY_X);
        this.setY(OVERLAY_Y);
        this.setWidth(OVERLAY_WIDTH);
        this.setHeight(OVERLAY_HEIGHT);

        const rows: LabeledRowDescriptor[] = [
            { component: new Header("Browser"), fullWidth: true },
            [{ title: "FPS",                    component: this._fps,                 description: ROW_DESCRIPTIONS.fps }],
            [{ title: "Frame time",             component: this._frameTime,           description: ROW_DESCRIPTIONS.frameTime }],
            [{ title: "JS heap",                component: this._heap,                description: ROW_DESCRIPTIONS.heap }],
            [{ title: "DOM nodes",              component: this._domNodes,            description: ROW_DESCRIPTIONS.domNodes }],
            [{ title: "Long tasks",             component: this._longTasks,           description: ROW_DESCRIPTIONS.longTasks }],
            { component: new Header("Framework"), fullWidth: true },
            [{ title: "Components",             component: this._componentsText,      description: ROW_DESCRIPTIONS.components }],
            [{ title: "Constructed / disposed", component: this._constructedDisposed, description: ROW_DESCRIPTIONS.constructedDisposed }],
            [{ title: "Layout passes",          component: this._layoutPasses,        description: ROW_DESCRIPTIONS.layoutPasses }],
            [{ title: "Layout flush",           component: this._layoutFlush,         description: ROW_DESCRIPTIONS.layoutFlush }],
            [{ title: "DOM listeners",          component: this._domListeners,        description: ROW_DESCRIPTIONS.domListeners }],
            [{ title: "Semantic listeners",     component: this._semanticListeners,   description: ROW_DESCRIPTIONS.semanticListeners }],
            [{ title: "Stylesheet rules",       component: this._styleRules,          description: ROW_DESCRIPTIONS.styleRules }],
        ];

        this._styleAuditButton.on("action", this._boundOnOpenStyleAudit);
        this._sampler = new DiagnosticsSampler({ onSample: this._boundOnSample });

        this.addComponent(Container({
            layoutManager: VBox({ stretching: true }),
            components: [
                { component: LabeledGrid({ columns: 1, rows }) },
                { component: Container(), constraints: { weight: 1.0 } },
                { component: this._styleAuditButton }
            ]
        }), { placement: Placement.CENTER });
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
     * Stops the sampler, detaches the style-audit button's own hover tooltip
     * (`Button` attaches one for any non-empty title but never detaches it
     * itself — the same reason `LabeledGrid.destructor` detaches the row
     * tooltips it owns), and clears the static instance slot. Idempotent, and
     * safe to call from both the animated close path ({@link onExitAction})
     * and a direct {@link destructor} (a `dispose()` that bypassed it).
     */
    private teardown(): void {
        this._sampler.stop();
        Tooltip.detach(this._styleAuditButton);

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
    protected destructor(): void {
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
