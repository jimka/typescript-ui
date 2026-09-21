// @vitest-environment jsdom
//
// The W3.0 ablations whose panels, or whose own patch, need a canvas 2D
// context: A14 (`g18.canvas-width` measures through one), A18 and A19
// (`table-rows`' filter row measures its fields' baselines through one). jsdom
// implements none, so every case here stubs it, as formCallTarget.test.ts
// does, with a `measureText` 7 px wide per character. They live apart from
// ablations.test.ts because the stub outlives them: the library keeps the
// first 2D context it is given as long as its module lives, and ablations.test.ts
// checks the note `g18.canvas-width` gives without one.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Body, DOM } from '@jimka/typescript-ui/core';
import { AbstractWindow, Tooltip } from '@jimka/typescript-ui/overlay';
import { ABLATIONS } from '../src/harness/ablations.js';
import { bumpWork, startCounting, stopCounting } from '../src/harness/counters.js';
import { createTools } from '../src/harness/run.js';
import type { AnyObj, HarnessLibrary, HarnessTools } from '../src/harness/types.js';
import { mountPanel } from '../src/mount.js';
import type { MountWaits } from '../src/mount.js';
import { patchablesOf, restorePatchables, snapshotPatchables } from './patchGuard.js';
import type { PatchSnapshot } from './patchGuard.js';

// The library applies its default theme at the first `Body` touch; see
// mount.test.ts for why that must happen before any tree is built.
Body.getInstance();

/** The stub context's advance per character: any fixed width makes a canvas width predictable. */
const STUB_CHAR_WIDTH_PX = 7;

/** `table-rows`' scale here: enough rows to fill a pool, and below the store's worker threshold. */
const TABLE_SCALE = 20;

/** The panels' default scale in the other cases: mount.test.ts's smoke scale. */
const SMOKE_SCALE = 3;

/** How often `g23.write-economy` checks a cached format against the engine: its `INTL_CHECK_EVERY`. */
const INTL_CHECK_EVERY = 100;

/** The library objects the page passes the harness. */
const LIB: HarnessLibrary = { Body, DOM, Tooltip, AbstractWindow };

/** `Date.prototype.toLocaleTimeString` as the engine ships it, to check `g23.write-economy`'s patch is undone. */
const NATIVE_TO_LOCALE_TIME_STRING = Date.prototype.toLocaleTimeString;

/** Every work key an ablation bumped, by the ablation that bumped it; A28 reads them. */
const bumped = new Map<string, Set<string>>();

/** The ablation the running case applied, under which `tools.bumpWork` files its keys. */
let applied = '';

/** What each case's mount patched objects looked like before it; restored after the case. */
const snapshots: PatchSnapshot[] = [];

/**
 * Records `kind` under the ablation the running case applied, for A28.
 *
 * @param kind - The work counter's key.
 */
function recordBump(kind: string): void {
    if (applied === '') {
        return;
    }

    const keys = bumped.get(applied) ?? new Set<string>();

    keys.add(kind);
    bumped.set(applied, keys);
}

/** The harness tools, as in ablations.test.ts. */
const tools: HarnessTools = {
    ...createTools(LIB),
    isPainted: (el: Element): boolean => el.isConnected,
    bumpWork: (kind: string): void => {
        recordBump(kind);
        bumpWork(kind);
    },
};

/** The paint wait: lays the page out once. */
async function flushOnPaint(): Promise<void> {
    Body.getInstance().flushLayout();
}

/** The settle wait: nothing to wait for without a frame loop. */
async function settleAtOnce(): Promise<void> {}

const SMOKE_WAITS: MountWaits = { painted: flushOnPaint, settled: settleAtOnce };

beforeEach(() => {
    vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext')
        .mockImplementation(((id: string) => (id === '2d'
            ? {
                font: '',
                clearRect() {},
                save() {},
                restore() {},
                setTransform() {},
                measureText: (text: string) => ({ width: STUB_CHAR_WIDTH_PX * text.length }),
            }
            : null) as unknown as RenderingContext) as typeof window.HTMLCanvasElement.prototype.getContext);
});

afterEach(() => {
    for (const root of [...Body.getInstance().getComponents()]) {
        Body.getInstance().removeComponent(root);
        root.dispose();
    }

    while (snapshots.length > 0) {
        restorePatchables(snapshots.pop()!);
    }

    vi.restoreAllMocks();
    applied = '';
});

/**
 * Mounts panel `id` at scale `n` and snapshots everything an ablation may patch on it.
 *
 * @param id - The panel id.
 * @param n - The scale.
 */
async function mount(id: string, n: number): Promise<void> {
    await mountPanel(id, new URLSearchParams({ n: String(n) }), tools, SMOKE_WAITS);
    snapshots.push(snapshotPatchables(patchablesOf(tools, LIB)));
}

/**
 * Applies ablation `name`, filing its bumps under its name.
 *
 * @param name - The ablation's `abl=` name.
 * @returns Its note.
 */
function apply(name: string): string {
    applied = name;

    return ABLATIONS[name](tools, LIB);
}

/**
 * The work counters of one counting window of one unit around `work`.
 *
 * @param work - The work to count.
 * @returns The work counters; empty when nothing tallied.
 */
function counted(work: () => void): Record<string, number> {
    let counts: Record<string, number> = {};

    startCounting();

    // Closed even when `work` throws, so no later case counts into it.
    try {
        work();
    } finally {
        counts = stopCounting(1).work ?? {};
    }

    return counts;
}

/**
 * Calls `obj[method](...args)`, for reaching the library's protected and private members.
 *
 * @param obj - The receiver.
 * @param method - The method's name.
 * @param args - Its arguments.
 * @returns What it returns.
 */
function invoke<T = unknown>(obj: unknown, method: string, ...args: unknown[]): T {
    return ((obj as AnyObj)[method] as (...a: unknown[]) => T).apply(obj, args);
}

/** What `measureText` returns. */
interface Metrics {
    width: number;
    height: number;
    baseline: number;
}

describe('A14 g18.canvas-width', () => {
    it('measures a known font on the canvas, and delegates a wrap width or an unresolvable size', async () => {
        await mount('chart-line', SMOKE_SCALE);

        const source = DOM.source as unknown as AnyObj;
        // Spied before the ablation installs, so the ablation delegates to it.
        const original = vi.spyOn(source as unknown as { measureText(text: string, options?: object): Metrics }, 'measureText');

        expect(apply('g18.canvas-width')).not.toMatch(/^no /);

        let first: Metrics | undefined;
        let second: Metrics | undefined;
        const counts = counted(() => {
            first = invoke<Metrics>(source, 'measureText', 'abcd');
            second = invoke<Metrics>(source, 'measureText', 'abcdef');
        });

        expect(original).toHaveBeenCalledTimes(1);
        expect(first).toEqual(original.mock.results[0].value);
        expect(second).toEqual({ width: 'abcdef'.length * STUB_CHAR_WIDTH_PX, height: first!.height, baseline: first!.baseline });
        expect(counts['memo.g18.canvas-width.canvas']).toBe(1);

        original.mockClear();
        invoke(source, 'measureText', 'abcdef', { maxWidth: 10 });

        expect(original).toHaveBeenCalledTimes(1);

        const calc = counted(() => invoke(source, 'measureText', 'abcdef', { fontSize: 'calc(1px + 1em)' }));

        expect(original).toHaveBeenCalledTimes(2);
        expect(calc['memo.g18.canvas-width.fallbackMiss']).toBe(1);
    });
});

describe('A18 g22.settle-relay', () => {
    it('lays the cells out on a burst\'s first width change and defers them on the next', async () => {
        await mount('table-rows', TABLE_SCALE);

        const body = tools.findComponent('TableBody')!;
        const bodyWidth = body._lastBodyWidth as number;
        const columnWidths = body._lastColumnWidths as number[];

        apply('g22.settle-relay');

        const first = counted(() => invoke(body, 'renderWindow', bodyWidth + 5, columnWidths.map((w) => w + 5)));

        expect(first['skipped.g22.settle-relay.cellBounds']).toBeUndefined();

        const second = counted(() => invoke(body, 'renderWindow', bodyWidth + 10, columnWidths.map((w) => w + 10)));

        expect(second['skipped.g22.settle-relay.cellBounds']).toBeGreaterThanOrEqual(1);
    });
});

describe('A19 g23.write-economy', () => {
    it('formats dates through a cached formatter and skips re-offering the same operators', async () => {
        await mount('table-rows', TABLE_SCALE);

        const options: Intl.DateTimeFormatOptions = { hour: '2-digit' };
        const expected = new Date(0).toLocaleTimeString(undefined, options);

        apply('g23.write-economy');

        const texts: string[] = [];
        const formatted = counted(() => {
            texts.push(new Date(0).toLocaleTimeString(undefined, options));
            texts.push(new Date(0).toLocaleTimeString(undefined, options));
        });

        expect(texts).toEqual([expected, expected]);
        expect(formatted['memo.g23.write-economy.intlHit']).toBe(1);

        const cell = tools.walkComponents().find((c) => tools.isA(c, 'FilterCell') && (c._operators as unknown[]).length > 0)!;
        const [op] = cell._operators as unknown[];

        expect(counted(() => invoke(cell, 'setOperators', cell._operators))['skipped.g23.write-economy.operators']).toBe(1);

        // The first call shows the face and records it; the second has nothing to change.
        expect(counted(() => {
            invoke(cell, 'applyOperatorFace', op);
            invoke(cell, 'applyOperatorFace', op);
        })['skipped.g23.write-economy.operatorFace']).toBe(1);
    });

    it('checks every hundredth cached format against the engine, and counts a difference', async () => {
        await mount('table-rows', TABLE_SCALE);

        const options: Intl.DateTimeFormatOptions = { hour: '2-digit' };

        apply('g23.write-economy');
        // The miss that builds the cached format.
        new Date(0).toLocaleTimeString(undefined, options);

        const format = (): string => new Date(0).toLocaleTimeString(undefined, options);
        const matching = counted(() => Array.from({ length: INTL_CHECK_EVERY }, format));

        expect(matching['memo.g23.write-economy.intlHit']).toBe(INTL_CHECK_EVERY);
        expect(matching['memo.g23.write-economy.intlMismatch']).toBeUndefined();

        // A cached format that drifts from the engine's string shows on the next check.
        // `format` is an accessor returning a bound function; typed here as a plain property so its getter can be spied.
        vi.spyOn(Intl.DateTimeFormat.prototype as unknown as { format: object }, 'format', 'get').mockReturnValue(() => 'drifted');

        expect(counted(() => Array.from({ length: INTL_CHECK_EVERY }, format))['memo.g23.write-economy.intlMismatch']).toBe(1);
    });

    it('leaves Date.prototype as the engine ships it once the case above is over', () => {
        expect(Date.prototype.toLocaleTimeString).toBe(NATIVE_TO_LOCALE_TIME_STRING);
    });
});

/**
 * Whether `key` is one of ablation `name`'s own counters, as in ablations.test.ts.
 *
 * @param name - The ablation's `abl=` name.
 * @param key - A work key it bumped.
 * @returns `true` when the key follows the scheme.
 */
function isOwnCounter(name: string, key: string): boolean {
    return ['skipped', 'memo', 'dose'].some((prefix) => {
        const head = `${prefix}.${name}.`;

        return key.startsWith(head) && /^[a-z][A-Za-z0-9]*$/.test(key.slice(head.length));
    });
}

// Last in the file: it reads the keys every case above bumped.
describe('A28 counter names', () => {
    it('files every key an ablation bumps under its own name', () => {
        expect(bumped.size).toBeGreaterThan(0);

        for (const [name, keys] of bumped) {
            for (const key of keys) {
                expect(isOwnCounter(name, key), `${name} bumped ${key}`).toBe(true);
            }
        }
    });
});
