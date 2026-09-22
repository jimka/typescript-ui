// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * `LayoutManager.resolveBounds`'s clamp-precedence bug: the two `if / else if`
 * ladders that clamp a child's requested extent to `[minSize, maxSize]` skip
 * the minimum branch whenever the maximum branch fires, so a child whose
 * minimum exceeds its maximum (a contradictory constraint pair) is placed at
 * its maximum instead of its minimum — the opposite of every other clamp in
 * the codebase (`HBox.resolveChildWidth`, `VBox.resolveChildHeight`,
 * `FlowLayout.clampedPreferredSize`, `Component.clampWidth`), which all cap
 * to the maximum first and then floor to the minimum.
 *
 * Modelled on `LayoutManager.commitBounds.test.ts`'s `CONFIG` bag and
 * `Container` host helper.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Fit } from '~/layout/Fit';
import { HFlow } from '~/layout/HFlow';
import { FillType } from '~/layout/FillType';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

function hostFit(width: number, height: number, fit: Fit): Container {
    const host = new Container({ layoutManager: fit });

    host.getElement(true);
    host.setWidth(width);
    host.setHeight(height);
    host.clearInsets();

    return host;
}

function hostHFlow(width: number, height: number, flow: HFlow): Container {
    const host = new Container({ layoutManager: flow });

    host.getElement(true);
    host.setWidth(width);
    host.setHeight(height);
    host.clearInsets();

    return host;
}

describe('LayoutManager.resolveBounds clamp precedence', () => {
    afterEach(() => DOM.reset());

    it('C1: a child whose minimum exceeds its maximum is placed at its minimum', () => {
        installTestDOM(CONFIG);

        const fit = new Fit({ fill: FillType.NONE });
        const host = hostFit(400, 200, fit);
        const child = new Component({
            preferredSize: { width: 100, height: 30 },
            minSize:       { width: 120, height: 120 },
            maxSize:       { width: 47, height: 47 },
        });

        host.addComponent(child);
        host.doLayout();

        // getWidth()/getHeight() read 120 either way (clampWidth/clampHeight
        // already floor to the minimum) and are not a valid assertion here —
        // it is the child's *position* the clamp bug moves, because the
        // anchor displacement is computed from the wrong width.
        expect(child.getX()).toBe(140);
        expect(child.getY()).toBe(40);
    });

    it('C2: an ordinary child is untouched (control)', () => {
        installTestDOM(CONFIG);

        const fit = new Fit({ fill: FillType.NONE });
        const host = hostFit(400, 200, fit);
        const child = new Component({
            preferredSize: { width: 100, height: 30 },
            minSize:       { width: 40, height: 20 },
            maxSize:       { width: 200, height: 60 },
        });

        host.addComponent(child);
        host.doLayout();

        expect(child.getX()).toBe(150);
        expect(child.getY()).toBe(85);
        expect(child.getWidth()).toBe(100);
        expect(child.getHeight()).toBe(30);
    });

    it('C3: the same fix reaches a flow cell', () => {
        installTestDOM(CONFIG);

        const flow = new HFlow({ spacing: 0 });
        const host = hostHFlow(400, 200, flow);
        const degenerate = new Component({
            preferredSize: { width: 100, height: 30 },
            minSize:       { width: 120, height: 120 },
            maxSize:       { width: 47, height: 47 },
        });
        const sibling = new Component({ preferredSize: { width: 50, height: 16 } });

        host.addComponent(degenerate);
        host.addComponent(sibling);
        host.doLayout();

        // The degenerate child's 120x120 cell exactly fits it; today it is
        // offset by 36.5px and overflows its own cell.
        expect(degenerate.getX()).toBe(0);
        expect(degenerate.getY()).toBe(0);
        expect(sibling.getX()).toBe(120);
    });
});

/**
 * E1's cell, in the host's coordinate space: wide and tall enough that the
 * probe child fits inside it on both axes, so every anchor displacement below
 * is a real number rather than a clamped zero.
 */
const CELL_X      = 10;
const CELL_Y      = 20;
const CELL_WIDTH  = 100;
const CELL_HEIGHT = 50;

/** E1's probe child: a preferred size smaller than the cell on both axes. */
const CHILD_WIDTH  = 40;
const CHILD_HEIGHT = 20;

/** E1's host box. Any box larger than the cell works; `resolveBounds` never reads it. */
const HOST_WIDTH  = 200;
const HOST_HEIGHT = 100;

/** E2's out-of-band box, committed with the setters because the bare child offers no preferred size. */
const BARE_WIDTH  = 30;
const BARE_HEIGHT = 12;

/** The four size-hint getters `resolveBounds` may reach, spied per case. */
interface HintSpies {
    preferred: ReturnType<typeof vi.spyOn>;
    min:       ReturnType<typeof vi.spyOn>;
    max:       ReturnType<typeof vi.spyOn>;
    size:      ReturnType<typeof vi.spyOn>;
}

/**
 * Spies on every size hint a child can be asked for, each calling through.
 *
 * @param child - The child to watch.
 * @returns The four spies.
 */
function spyHints(child: Component): HintSpies {
    return {
        preferred: vi.spyOn(child, 'getPreferredSize'),
        min:       vi.spyOn(child, 'getMinSize'),
        max:       vi.spyOn(child, 'getMaxSize'),
        size:      vi.spyOn(child, 'getSize'),
    };
}

/** One E1 row: the child's own constraint, the argument, and what the call must produce. */
interface LazyReadCase {
    name:       string;
    constraint: FillType | null;
    argument:   FillType;
    bounds:     { x: number; y: number; width: number; height: number };
    reads:      { preferred: number; min: number; max: number; size: number };
}

const LAZY_READ_CASES: LazyReadCase[] = [
    {
        name:       'E1a: an unset constraint with a BOTH argument reads nothing',
        constraint: null,
        argument:   FillType.BOTH,
        bounds:     { x: CELL_X, y: CELL_Y, width: CELL_WIDTH, height: CELL_HEIGHT },
        reads:      { preferred: 0, min: 0, max: 0, size: 0 },
    },
    {
        name:       'E1b: a BOTH constraint beats a NONE argument and reads nothing',
        constraint: FillType.BOTH,
        argument:   FillType.NONE,
        bounds:     { x: CELL_X, y: CELL_Y, width: CELL_WIDTH, height: CELL_HEIGHT },
        reads:      { preferred: 0, min: 0, max: 0, size: 0 },
    },
    {
        name:       'E1c: a NONE constraint beats a BOTH argument and reads the three hints',
        constraint: FillType.NONE,
        argument:   FillType.BOTH,
        bounds:     { x: 40, y: 35, width: CHILD_WIDTH, height: CHILD_HEIGHT },
        reads:      { preferred: 1, min: 1, max: 1, size: 0 },
    },
    {
        name:       'E1d: a HORIZONTAL argument reads the three hints for the free axis',
        constraint: null,
        argument:   FillType.HORIZONTAL,
        bounds:     { x: CELL_X, y: 35, width: CELL_WIDTH, height: CHILD_HEIGHT },
        reads:      { preferred: 1, min: 1, max: 1, size: 0 },
    },
    {
        name:       'E1e: a VERTICAL argument reads the three hints for the free axis',
        constraint: null,
        argument:   FillType.VERTICAL,
        bounds:     { x: 40, y: CELL_Y, width: CHILD_WIDTH, height: CELL_HEIGHT },
        reads:      { preferred: 1, min: 1, max: 1, size: 0 },
    },
];

describe('LayoutManager.resolveBounds reads only the hints its fill uses', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        DOM.reset();
    });

    for (const testCase of LAZY_READ_CASES) {
        it(testCase.name, () => {
            installTestDOM(CONFIG);

            const fit   = new Fit();
            const host  = hostFit(HOST_WIDTH, HOST_HEIGHT, fit);
            const child = new Component({ preferredSize: { width: CHILD_WIDTH, height: CHILD_HEIGHT } });

            if (testCase.constraint === null) {
                host.addComponent(child);
            } else {
                host.addComponent(child, { fill: testCase.constraint });
            }

            const hints = spyHints(child);
            const bounds = (fit as any).resolveBounds(child, CELL_X, CELL_Y, CELL_WIDTH, CELL_HEIGHT, testCase.argument);

            expect(bounds).toEqual(testCase.bounds);
            expect(hints.preferred).toHaveBeenCalledTimes(testCase.reads.preferred);
            expect(hints.min).toHaveBeenCalledTimes(testCase.reads.min);
            expect(hints.max).toHaveBeenCalledTimes(testCase.reads.max);
            expect(hints.size).toHaveBeenCalledTimes(testCase.reads.size);
        });
    }

    it('E2: a child with no preferred size still falls back to its current size', () => {
        installTestDOM(CONFIG);

        const fit  = new Fit();
        const host = hostFit(HOST_WIDTH, HOST_HEIGHT, fit);
        const bare = new Component();

        host.addComponent(bare);
        bare.setWidth(BARE_WIDTH);
        bare.setHeight(BARE_HEIGHT);

        const hints = spyHints(bare);
        const bounds = (fit as any).resolveBounds(bare, CELL_X, CELL_Y, CELL_WIDTH, CELL_HEIGHT, FillType.NONE);

        expect(bounds).toEqual({ x: 45, y: 39, width: BARE_WIDTH, height: BARE_HEIGHT });
        expect(hints.size).toHaveBeenCalledTimes(1);
    });
});
