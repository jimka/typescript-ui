// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * The unchanged-commit skip's text-metrics condition: a component last laid out
 * against other text metrics may not skip. A theme switch or a settled font
 * batch changes every measured text size while moving no rectangle, so without
 * this condition the text under a skipping container keeps the width it was
 * measured at. Cases E5 and E6 of
 * `plans/implemented/layout-size-read-economy.md`.
 *
 * `afterEach` restores `ModernTheme` before disposing the roots, because
 * `ThemeManager.setTheme` fires every listener still registered in the process
 * (see `UnchangedCommitOptIns.test.ts` for why that makes theme cases uniquely
 * sensitive to cross-test pollution), and it restores the mocks only after the
 * last flush: a frame requested once the `requestAnimationFrame` spy is gone
 * leaves the module's pending-frame handle set, and every later flush in the
 * file then silently does nothing.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Panel } from '~/core/Panel';
import { Fit } from '~/layout/Fit';
import { VBox } from '~/layout/VBox';
import { Text } from '~/component/input/Text';
import { DOM } from '~/core/DOM';
import { ThemeManager, ModernTheme } from '~/core/Theme';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

/** The host's box — large enough that no clamp in these scenes bites. */
const HOST_WIDTH  = 800;
const HOST_HEIGHT = 600;

/** Chars present in the baked test font, so the label measures a real advance. */
const LABEL = 'World';

/**
 * What {@link widenFont} multiplies every advance by, and so the factor the
 * label's committed width must grow by once the swap reaches it. The settled
 * width itself is not asserted as a literal: it is whatever the baked table
 * and the theme's font size make it, and the contract is the ratio.
 */
const WIDEN_FACTOR = 2;

/**
 * Builds a config whose baked font table is a private deep copy, so E6 can
 * widen the advances mid-run (modelling the real face swapping in) without
 * mutating the shared JSON module every other suite reads. Copied from
 * `tests/core/UnchangedCommitOptIns.test.ts`.
 *
 * @returns The modelled-DOM config.
 */
function makeConfig() {
    return {
        rootMountOffset: { x: 0, y: 0 },
        viewport:        { width: 1280, height: 800 },
        scrollBarWidth:  15,
        fontMetrics:     structuredClone(fontMetrics),
        themeVars:       {},
    };
}

/**
 * Doubles every per-character advance in the (cloned) baked font table, the
 * way a real face swapping in widens every measured label.
 *
 * @param config - The config whose cloned table to widen.
 */
function widenFont(config: ReturnType<typeof makeConfig>): void {
    for (const font of Object.values(config.fontMetrics.fonts) as Array<{ advance: Record<string, number> }>) {
        for (const ch of Object.keys(font.advance)) {
            font.advance[ch] *= WIDEN_FACTOR;
        }
    }
}

let frames: FrameRequestCallback[] = [];
let roots: Component[] = [];

/**
 * Installs the modelled DOM with a frame-capturing `requestAnimationFrame`.
 * The offline sink never runs a frame of its own, so every scheduled pass in
 * this file is driven explicitly through {@link flushFrame}.
 *
 * @param config - The config to install.
 */
function install(config: ReturnType<typeof makeConfig>): void {
    installTestDOM(config);

    frames = [];
    vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
        frames.push(cb);

        return frames.length;
    });
}

/** Runs every captured frame callback, including any a callback re-queues. */
function flushFrame(): void {
    for (let guard = 0; guard < 10 && frames.length > 0; guard += 1) {
        const pending = frames;

        frames = [];

        for (const cb of pending) {
            cb(0);
        }
    }
}

/** An opted-in container, as `UnchangedCommitSkip.test.ts` declares it. */
class SkippableContainer extends Container {
    /**
     * Opts in.
     *
     * @returns `true`.
     */
    protected canSkipUnchangedLayout(): boolean {
        return true;
    }
}

interface Scene {
    host: Container;
    box:  Container;
    text: Text;
}

/**
 * The shared scene: a `Fit` host filling an opted-in container that stacks one
 * `Text`, settled by two laid-out and flushed passes.
 *
 * @param box - The opted-in container to nest, so a case can swap in a plain
 *   `Panel`, which opts in through the stage-2 opt-ins.
 * @returns The host, the container and the text.
 */
function makeScene(box: Container): Scene {
    const host = new Container({ layoutManager: new Fit() });
    const text = new Text(LABEL);

    host.getElement(true);
    host.clearInsets();
    host.setWidth(HOST_WIDTH);
    host.setHeight(HOST_HEIGHT);

    box.addComponent(text);
    host.addComponent(box);

    roots.push(host);

    host.doLayout();
    flushFrame();
    host.doLayout();
    flushFrame();

    return { host, box, text };
}

/** A fresh opted-in container stacking its children. */
function makeSkippable(): SkippableContainer {
    return new SkippableContainer({ layoutManager: new VBox({ spacing: 0 }) });
}

afterEach(() => {
    // Theme state is module-level; restore it before the roots go, and while
    // the frame-capturing spy is still installed, so the restore's own pass
    // is captured rather than left pending on the real sink.
    ThemeManager.setTheme(ModernTheme);
    flushFrame();

    for (const root of roots) {
        root.dispose();
    }

    roots = [];
    vi.restoreAllMocks();
    DOM.reset();
});

describe('The unchanged-commit skip requires the current text metrics (E5)', () => {
    it('refuses a skip after a theme switch, and allows one again on the pass that follows', () => {
        install(makeConfig());

        const { host, box } = makeScene(makeSkippable());

        expect(box.canSkipUnchangedCommit()).toBe(true);

        ThemeManager.setTheme(ThemeManager.getTheme());

        expect(box.canSkipUnchangedCommit()).toBe(false);

        host.doLayout();
        flushFrame();

        expect(box.canSkipUnchangedCommit()).toBe(true);
    });

    it('withholds the pass on two settled passes with no theme change in between', () => {
        install(makeConfig());

        const { host, box } = makeScene(makeSkippable());
        const layout = vi.spyOn(box, 'doLayout');

        host.doLayout();
        host.doLayout();

        expect(layout).toHaveBeenCalledTimes(0);
        expect(box.canSkipUnchangedCommit()).toBe(true);
    });
});

describe('A font swap re-measures the text under a skipping container (E6)', () => {
    /**
     * Settles the scene, widens the font, and runs the reflow a swapped face
     * drives.
     *
     * @param box - The opted-in container to nest.
     * @returns The label's width before and after the swap.
     */
    const swapped = (box: Container): { before: number; after: number } => {
        const config = makeConfig();

        install(config);

        const scene  = makeScene(box);
        const before = scene.text.getWidth();

        widenFont(config);
        ThemeManager.setTheme(ThemeManager.getTheme());
        scene.host.doLayout();
        flushFrame();

        return { before, after: scene.text.getWidth() };
    };

    it('widens the label under an opted-in container', () => {
        const widths = swapped(makeSkippable());

        expect(widths.before).toBeGreaterThan(0);
        expect(widths.after).toBe(widths.before * WIDEN_FACTOR);
    });

    it('widens the label under a plain Panel, which opts in through the stage-2 opt-ins', () => {
        const widths = swapped(new Panel({ layoutManager: new VBox({ spacing: 0 }) }));

        expect(widths.before).toBeGreaterThan(0);
        expect(widths.after).toBe(widths.before * WIDEN_FACTOR);
    });
});
