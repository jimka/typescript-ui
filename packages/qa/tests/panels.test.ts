// @vitest-environment jsdom
//
// The panels import the built library, whose `core` entry point evaluates a
// top-level `Body` singleton that reads `document` at import time, and P3
// lays a chart out through the production DOM seam. So this file needs a real
// DOM; the harness tests beside it run in plain node. The library is the one
// the page would load — vite.config.ts aliases it to this checkout's build —
// so build the library first.
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Body, DOM, Panel } from '@jimka/typescript-ui/core';
import type { Component } from '@jimka/typescript-ui/core';
import type { ChartSeries } from '@jimka/typescript-ui/component/chart';
import { installSeamCounters, startCounting, stopCounting } from '../src/harness/counters.js';
import { DRIVERS } from '../src/harness/drivers.js';
import { createTools, parseDrive } from '../src/harness/run.js';
import { mountPanel } from '../src/mount.js';
import type { MountWaits } from '../src/mount.js';
import { getPanelIds, loadPanel, parseScale } from '../src/panels.js';
import type { PanelBuild } from '../src/panels.js';
import { pageTargets } from '../src/pageTargets.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(HERE, '../src');
const PANEL_DIR = path.join(SRC_DIR, 'panels');

// Read independently of panels.ts's own glob, so the import rule is checked
// against the authored files rather than anything panels.ts derives.
const RAW_PANELS = import.meta.glob('../src/panels/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** `chart-line`'s scale in the F26.1 record: 50 points per series. */
const RECORD_SCALE = 50;

/** SVG marks `chart-line` rebuilds per layout pass at the record's scale: 3 paths, 150 point circles, 57 axis marks. */
const RECORD_MARKS = 210;

/** The size `Chart.test.ts`'s `layout()` helper lays a chart out at; the census does not depend on it. */
const LAYOUT_WIDTH = 400;
const LAYOUT_HEIGHT = 300;

/**
 * The drivers of a default drive that a build leaves without a target: in
 * neither its own targets nor the page-wide ones `mountPanel` merges under
 * them.
 *
 * @param defaultDrive - The panel's default drive.
 * @param build - What the panel's `build` returned.
 * @returns The drivers with no target, in the drive's order.
 */
function untargetedDrivers(defaultDrive: string, build: PanelBuild): string[] {
    const pageWide = Object.keys(pageTargets(build.root));

    return parseDrive(null, defaultDrive, 1)
        .map(({ driver }) => driver)
        .filter((driver) => build.targets[driver] === undefined && !pageWide.includes(driver));
}

describe('P1 panel contract', () => {
    it.each(getPanelIds())('%s exports the contract and targets its default drive', async (id) => {
        const module = await loadPanel(id);

        expect(module).not.toBeNull();
        expect(Object.keys(module!).sort()).toEqual(['build', 'defaultDrive', 'defaultScale', 'description']);
        expect(typeof module!.description).toBe('string');
        expect(module!.description.length).toBeGreaterThan(0);
        expect(Number.isInteger(module!.defaultScale) && module!.defaultScale > 0).toBe(true);

        const phases = parseDrive(null, module!.defaultDrive, 1);
        const build = module!.build(module!.defaultScale, new URLSearchParams());

        if (!build.afterMount) {
            expect(untargetedDrivers(module!.defaultDrive, build), `${id} drivers without a target`).toEqual([]);

            for (const { driver } of phases) {
                expect(Object.keys(DRIVERS)).toContain(driver);
            }
        }
    });

    it('counts a page-wide target as present', () => {
        expect(untargetedDrivers('theme:4', { root: Panel(), targets: {} })).toEqual([]);
        expect(untargetedDrivers('idle,passes', { root: Panel(), targets: {} })).toEqual(['passes']);
    });

    it('loads nothing for an unknown id', async () => {
        expect(await loadPanel('nope')).toBeNull();
    });
});

describe('P2 chart-line fixture', () => {
    it('is registered', () => {
        expect(getPanelIds()).toContain('chart-line');
    });

    it('builds three series of n points with y in [0, 99] reaching 99', async () => {
        const module = await loadPanel('chart-line');
        const root = module!.build(RECORD_SCALE, new URLSearchParams()).root as unknown as { getSeries(): ChartSeries[] };
        const series = root.getSeries();
        const ys = series.flatMap((s) => s.data.map((p) => p.y));

        expect(series).toHaveLength(3);

        for (const s of series) {
            expect(s.data.map((p) => p.x)).toEqual(Array.from({ length: RECORD_SCALE }, (_, i) => i));
        }

        expect(ys.every((y) => Number.isInteger(y) && y >= 0 && y <= 99)).toBe(true);
        expect(Math.max(...ys)).toBe(99);
    });
});

describe('P3 first-pass census', () => {
    it('creates the record\'s marks in one layout pass', async () => {
        const module = await loadPanel('chart-line');
        const root = module!.build(RECORD_SCALE, new URLSearchParams()).root;
        const { sink, source } = DOM;

        try {
            root.getElement(true);
            root.setWidth(LAYOUT_WIDTH);
            root.setHeight(LAYOUT_HEIGHT);
            installSeamCounters(DOM);
            startCounting();
            root.doLayout();

            expect(stopCounting(1).seam?.sink.createElementNS).toBe(RECORD_MARKS);
        } finally {
            DOM.install({ sink, source });
        }
    });
});

describe('P4 parseScale', () => {
    it.each([
        [null, 50],
        ['', 50],
        ['200', 200],
    ])('reads %j as %i', (raw, expected) => {
        expect(parseScale(raw, 50)).toBe(expected);
    });

    it.each(['0', '-1', '2.5', 'x'])('rejects %j', (raw) => {
        expect(() => parseScale(raw, 50)).toThrow(`n: expected a positive integer, got "${raw}"`);
    });
});

/**
 * The import specifiers in `source` that break the panel import rule: each
 * must start with `@jimka/typescript-ui/`, or be relative and resolve, from
 * the panel's directory, to a path inside `packages/qa/src`.
 *
 * @param source - A panel's source text.
 * @returns The offending specifiers.
 */
function importViolations(source: string): string[] {
    const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);

    return specifiers.filter((specifier) => {
        if (specifier.startsWith('@jimka/typescript-ui/')) {
            return false;
        }

        if (!specifier.startsWith('.')) {
            return true;
        }

        return !path.resolve(PANEL_DIR, specifier).startsWith(SRC_DIR + path.sep);
    });
}

describe('P5 panel import rule', () => {
    it.each(Object.entries(RAW_PANELS))('%s imports only the library and the app', (_file, source) => {
        expect(importViolations(source)).toEqual([]);
    });

    it('rejects a docs demo import', () => {
        expect(importViolations("import { x } from '../../../docs/src/demos/foo.js';")).toEqual(['../../../docs/src/demos/foo.js']);
    });
});

/**
 * Mount waits that record each call and resolve at once — jsdom paints
 * nothing, so the real `painted` wait would run to its cap.
 *
 * @returns The waits and the calls they recorded.
 */
function recordingWaits(): { waits: MountWaits; calls: unknown[][] } {
    const calls: unknown[][] = [];

    const waits: MountWaits = {
        painted: async (root: Component, id: string): Promise<void> => {
            calls.push(['painted', root, id]);
        },
        settled: async (): Promise<void> => {
            calls.push(['settled']);
        },
    };

    return { waits, calls };
}

describe('P6 mount sequence', () => {
    const tools = createTools({ Body, DOM });

    it('mounts chart-line at the URL scale, settles again after afterMount, and merges the targets', async () => {
        const { waits, calls } = recordingWaits();
        const mounted = await mountPanel('chart-line', new URLSearchParams('n=20'), tools, waits);
        const root = mounted.build.root;

        expect(mounted.n).toBe(20);
        expect(mounted.targets.resize).toBe(root);
        expect(mounted.targets.passes).toBe(root);
        expect(mounted.targets.hover).toEqual({ element: tools.elementOf(root), axis: 'x' });
        expect(mounted.targets.idle).toBe(root);
        expect(mounted.targets.theme).toEqual({ cycle: expect.any(Function), restore: expect.any(Function) });
        expect(document.contains(tools.elementOf(root))).toBe(true);
        // Compared by name and reference: a deep comparison would walk the component graph.
        expect(calls.map((call) => call[0])).toEqual(['painted', 'settled', 'settled']);
        expect(calls[0][1]).toBe(root);
        expect(calls[0][2]).toBe('chart-line');
    });

    it('rejects an unknown panel before any wait', async () => {
        const { waits, calls } = recordingWaits();

        await expect(mountPanel('nope', new URLSearchParams(), tools, waits)).rejects.toThrow('panel module nope not found');
        expect(calls).toEqual([]);
    });
});
