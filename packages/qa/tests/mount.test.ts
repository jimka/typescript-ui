// @vitest-environment jsdom
//
// Mounts every panel through the real `mountPanel` — build, `Body.init`, the
// two waits, `afterMount` and the target merge — without opening a window.
// The panels import the built library, whose `core` entry point reads
// `document` at import time, so this file needs a real DOM. jsdom lays
// nothing out, so a driver cannot run on a mounted panel here; drivers.dom.test.ts
// checks the drivers' event sequences on stubbed rectangles instead.
import { afterEach, describe, expect, it } from 'vitest';
import { Body, DOM } from '@jimka/typescript-ui/core';
import type { Component } from '@jimka/typescript-ui/core';
import { createTools, parseDrive } from '../src/harness/run.js';
import type { HarnessTools } from '../src/harness/types.js';
import { mountPanel } from '../src/mount.js';
import type { MountedPanel, MountWaits } from '../src/mount.js';
import { getPanelIds } from '../src/panels.js';

/** The scale every panel is mounted at: small enough to be quick, and below `markdown-doc`'s first fence. */
const SMOKE_SCALE = 3;

/**
 * The harness tools, with `isPainted` standing in for layout: jsdom gives
 * every element an empty rectangle, so the real check is false everywhere
 * and a panel could not find the editor its `type` target needs. Here a
 * connected element counts as painted.
 */
const tools: HarnessTools = { ...createTools({ Body, DOM }), isPainted: (el: Element): boolean => el.isConnected };

/**
 * The paint wait: lays the page out once, so `afterMount` finds the elements
 * layout creates, such as gutters.
 */
async function flushOnPaint(): Promise<void> {
    Body.getInstance().flushLayout();
}

/** The settle wait: nothing to wait for without a frame loop. */
async function settleAtOnce(): Promise<void> {}

const SMOKE_WAITS: MountWaits = { painted: flushOnPaint, settled: settleAtOnce };

afterEach(() => {
    // Body is a page-level singleton that outlives each test; the root
    // Body.init appended must be detached before dispose, or the next mount
    // finds two children under a Fit() that accepts one. A mount whose
    // afterMount threw leaves its root there too.
    for (const root of [...Body.getInstance().getComponents()]) {
        unmount(root);
    }
});

/**
 * Detaches a panel's root from `Body` and disposes it, as the docs site's
 * DocsSidebar.test.ts does.
 *
 * @param root - The panel's root.
 */
function unmount(root: Component): void {
    Body.getInstance().removeComponent(root);
    root.dispose();
}

/**
 * The elements a target names: the target itself when it is an element, its
 * `element` field, and every entry of its `elements` field.
 *
 * @param target - A merged target.
 * @returns The elements it names.
 */
function elementsOf(target: unknown): unknown[] {
    if (target instanceof Element) {
        return [target];
    }

    const fields = (target ?? {}) as { element?: unknown; elements?: unknown };
    const elements: unknown[] = [];

    if ('element' in fields) {
        elements.push(fields.element);
    }

    if ('elements' in fields) {
        expect(Array.isArray(fields.elements) && fields.elements.length > 0, 'elements is a non-empty array').toBe(true);
        elements.push(...(fields.elements as unknown[]));
    }

    return elements;
}

/**
 * Checks a mounted panel's targets: every driver of its default drive, and
 * the page-wide `idle` and `theme`, have one; every value is defined; and
 * every element a target names is in the document.
 *
 * @param panel - The mounted panel.
 */
function expectTargetsReady(panel: MountedPanel): void {
    const drivers = parseDrive(null, panel.module.defaultDrive, 1).map(({ driver }) => driver);

    for (const driver of [...drivers, 'idle', 'theme']) {
        expect(panel.targets, `target for ${driver}`).toHaveProperty(driver);
    }

    for (const [driver, target] of Object.entries(panel.targets)) {
        expect(target, `target for ${driver}`).toBeDefined();

        for (const element of elementsOf(target)) {
            expect(element instanceof Element && element.isConnected, `${driver}: element in the document`).toBe(true);
        }
    }
}

/**
 * Panels P7 cannot mount under jsdom, each with the error it throws there.
 * Neither is a panel bug; the shakedown run mounts both in the engine.
 */
const JSDOM_GAPS: Record<string, string> = {
    // Its default `grip=dock-h` picks the Dock's gutter by shape, and jsdom
    // lays nothing out, so every gutter's rectangle is empty. P8 mounts it
    // with `grip=tab`, which needs no rectangle.
    'shell-deep': 'shell-deep: no dock-h gutter',
    // Its filter row's text fields measure font metrics through a canvas 2D
    // context, which jsdom does not implement, so `getContext("2d")` is null.
    'table-rows': 'Cannot set properties of null (setting \'font\')',
};

describe('P7 mount smoke', () => {
    it.each(getPanelIds().filter((id) => !Object.hasOwn(JSDOM_GAPS, id)))('%s mounts and resolves its targets', async (id) => {
        const mounted = await mountPanel(id, new URLSearchParams({ n: String(SMOKE_SCALE) }), tools, SMOKE_WAITS);

        expectTargetsReady(mounted);
    });

    it.each(Object.entries(JSDOM_GAPS))('%s fails under jsdom only for the gap it is excluded for', async (id, error) => {
        await expect(mountPanel(id, new URLSearchParams({ n: String(SMOKE_SCALE) }), tools, SMOKE_WAITS)).rejects.toThrow(error);
    });
});

describe('P8 panel parameters', () => {
    it('shell-shallow rejects a grip only the deep shell has, once mounted', async () => {
        await expect(mountPanel('shell-shallow', new URLSearchParams('n=3&grip=dock-h'), tools, SMOKE_WAITS))
            .rejects.toThrow('shell-shallow: unknown grip "dock-h" (expected sidebar, section)');
    });

    it('table-rows rejects an unknown update before any wait', async () => {
        const waited: string[] = [];

        const waits: MountWaits = {
            painted: async (): Promise<void> => {
                waited.push('painted');
            },
            settled: async (): Promise<void> => {
                waited.push('settled');
            },
        };

        await expect(mountPanel('table-rows', new URLSearchParams('n=3&update=nope'), tools, waits))
            .rejects.toThrow('table-rows: unknown update "nope" (expected record, filter)');
        expect(waited).toEqual([]);
    });

    it('shell-deep drags a tab button under grip=tab', async () => {
        const mounted = await mountPanel('shell-deep', new URLSearchParams('n=3&grip=tab'), tools, SMOKE_WAITS);

        const drag = mounted.targets.drag as { element: Element; axis: string };

        expect(drag.element.classList.contains('TabButton')).toBe(true);
        expect(drag.axis).toBe('x');
        expectTargetsReady(mounted);
    });
});

// The first authorised sweep measured `hiddenAnimating` 0: the panel added
// its 2D canvases to the hidden group and only then started them, and
// `startAnimation` reads effective visibility directly, so the loop never
// started. C36 is the reparent, and only a canvas already animating can show
// it. The order is what this pins; the visibility walk is component state, so
// jsdom exercises it. C35's half needs a real engine (see the panel).
describe('canvas-idle hidden group', () => {
    it('starts its 2D canvases while shown and leaves them animating under the hidden panel', async () => {
        const mounted = await mountPanel('canvas-idle', new URLSearchParams({ n: String(SMOKE_SCALE) }), tools, SMOKE_WAITS);

        const host = mounted.build.describe!() as { hiddenStarted: number; hiddenAnimating: number };

        expect(host.hiddenStarted, 'animating while still in the shown group').toBe(SMOKE_SCALE);
        expect(host.hiddenAnimating, 'still animating after the move under the hidden panel').toBe(SMOKE_SCALE);
    });
});
