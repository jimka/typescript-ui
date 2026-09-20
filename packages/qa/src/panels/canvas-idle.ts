import { DOM, Panel } from '@jimka/typescript-ui/core';
import { Canvas, WebGLCanvas } from '@jimka/typescript-ui/component/display';
import { HBox, VBox } from '@jimka/typescript-ui/layout';
import type { PanelBuild } from '../panels.js';

/** Each surface's preferred size: small, since the surfaces draw nothing; only their loops are measured. */
const SURFACE_SIZE = { width: 160, height: 120 };

/** The gap between the two groups: structure only, so the shown group is not flush with the hidden one's slot. */
const GROUP_SPACING_PX = 8;

export const description = 'Two groups of n surfaces (default 4): WebGLCanvases whose 2D context is taken first, so the engine refuses them a WebGL2 one, and 2D Canvases started while shown and then moved under an already-hidden panel; none of them drawing anything. Regression check for slice 26 F26.7 (a WebGLCanvas with no GL context ran its animation loop forever) and F26.8 (a canvas moved under an already-hidden ancestor kept animating), both now fixed: every animating counter, and requestAnimationFrame per idle frame, should read zero.';

/** Four surfaces per group. */
export const defaultScale = 4;

/** Idle frames: the loops are what runs. */
export const defaultDrive = 'idle';

/** A WebGL frame callback that draws nothing: the loop, not the drawing, is measured. */
function drawNoGlFrame(): void {}

/** A 2D draw callback that draws nothing: the loop, not the drawing, is measured. */
function drawNoCanvasFrame(): void {}

/**
 * Takes each surface's 2D context before the component asks for its WebGL2
 * one, which the engine then refuses: a canvas element keeps the context it
 * first handed out, and `getContext` returns null for every other type. That
 * is C35's precondition, and the only way to reach it here.
 *
 * The first authorised sweep (`val-canvas`, 2026-09-20, MiniBrowser under
 * WSLg) recorded `webglContexts` 4 of 4 surfaces: this engine does have
 * WebGL2, so F26.7's impact claim — that a context-less `WebGLCanvas` is the
 * normal case in software-rendered WebKitGTK — does not hold here, and the
 * loops it measured were legitimate. The re-run against the pre-fix code
 * measured `webglContexts` 0 with `webglAnimating` 4, so the engine does
 * refuse the second context type. The loop is now gated on a rendering
 * context as well as on effective visibility, so with the precondition still
 * forced this panel's animating counters should read zero.
 *
 * @param surfaces - The WebGL surfaces to refuse a context.
 */
function takeTwoDimensionalContexts(surfaces: WebGLCanvas[]): void {
    for (const surface of surfaces) {
        // `getElement(true)` renders the element before mounting, exactly as
        // the parent's own `insertComponent` would; the context is claimed on
        // it before first layout, where `WebGLCanvas` caches its own.
        DOM.sink.getContext(surface.getElement(true)!, '2d');
    }
}

/**
 * Builds a shown group of `n` WebGL canvases with no GL context, and a hidden
 * group filled after mounting by moving animating 2D canvases into it.
 *
 * @param n - Surfaces per group.
 * @returns The two groups as root; `afterMount` starts the 2D canvases while they are still shown, then moves them under the hidden panel. `idle` comes from the page-wide targets.
 */
export function build(n: number): PanelBuild {
    const webgl = Array.from({ length: n }, () => WebGLCanvas({ preferredSize: SURFACE_SIZE, onFrame: drawNoGlFrame }));
    const canvases = Array.from({ length: n }, () => Canvas({ preferredSize: SURFACE_SIZE, onDraw: drawNoCanvasFrame }));

    takeTwoDimensionalContexts(webgl);

    const shown = Panel({ layoutManager: HBox(), components: [...webgl, ...canvases] });
    const hidden = Panel({ layoutManager: HBox(), displayed: false });
    const root = Panel({ layoutManager: VBox({ spacing: GROUP_SPACING_PX }), components: [shown, hidden] });

    let hiddenStarted = 0;

    return {
        root,
        targets: {},
        afterMount: (): Record<string, unknown> => {
            for (const surface of canvases) {
                surface.startAnimation();
            }

            hiddenStarted = canvases.filter((surface) => surface.isAnimating()).length;

            // C36's shape: each canvas is animating on screen, and is then
            // reparented under a panel that is already hidden. A reparent is
            // no `setVisible`/`setDisplayed` edge, so nothing used to
            // reconcile the loop and it kept running; the attach itself now
            // queues the moved child, so it pauses. Starting them after the
            // move instead would prove nothing: `startAnimation` reads
            // effective visibility itself and would refuse to schedule a frame.
            for (const surface of canvases) {
                hidden.moveComponent(surface);
            }

            return {};
        },
        geometry: { shown },
        describe: () => ({
            surfaces: n,
            webglContexts: webgl.filter((surface) => surface.getContext() !== null).length,
            webglAnimating: webgl.filter((surface) => surface.isAnimating()).length,
            hiddenStarted,
            hiddenAnimating: canvases.filter((surface) => surface.isAnimating()).length,
        }),
    };
}
