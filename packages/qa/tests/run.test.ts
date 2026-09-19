import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDrive, runQa } from '../src/harness/run.js';
import type { PanelHost, QaReport, Subject } from '../src/harness/types.js';

/** `frames=`'s default, which the `drive=` table's rows assume. */
const FRAMES = 150;

describe('E3 parseDrive', () => {
    it.each([
        [null, 'resize', [{ driver: 'resize', units: 150 }]],
        ['', 'resize', [{ driver: 'resize', units: 150 }]],
        [null, 'drag,wheel:120', [{ driver: 'drag', units: 150 }, { driver: 'wheel', units: 120 }]],
        [null, 'drag,resize:120,wheel:120', [{ driver: 'drag', units: 150 }, { driver: 'resize', units: 120 }, { driver: 'wheel', units: 120 }]],
        [null, '', []],
        ['passes:10', 'drag,wheel:120', [{ driver: 'passes', units: 10 }]],
        ['drag,wheel:120', 'resize', [{ driver: 'drag', units: 150 }, { driver: 'wheel', units: 120 }]],
        [' drag , wheel ', 'resize', [{ driver: 'drag', units: 150 }, { driver: 'wheel', units: 150 }]],
    ])('drive=%j with default %j', (value, fallback, phases) => {
        expect(parseDrive(value, fallback, FRAMES)).toEqual(phases);
    });

    it.each(['resize:0', 'resize:abc', 'resize:2.5'])('rejects the unit count in %s', (value) => {
        expect(() => parseDrive(value, 'drag', FRAMES)).toThrow(`drive: bad unit count in "${value}"`);
    });

    it('rejects a bad unit count in the default', () => {
        expect(() => parseDrive(null, 'resize:0', FRAMES)).toThrow('drive: bad unit count in "resize:0"');
    });
});

/** A fake library: the error paths under test never reach the tree or the seams. */
const LIB = {
    Body: { getInstance: (): object => ({}) },
    DOM: { sink: {}, source: {}, install: (): void => {} },
};

/**
 * A fake panel host.
 *
 * @param subjects - Id → what `setup` resolves to.
 * @returns The host, with `setup` as a spy.
 */
function fakePanels(subjects: Record<string, Subject>): PanelHost & { setup: ReturnType<typeof vi.fn> } {
    return {
        ids: (): string[] => Object.keys(subjects).sort(),
        setup: vi.fn(async (id: string): Promise<Subject> => subjects[id]),
    };
}

/**
 * Runs `runQa` with `search` as the page URL's query, `fetch` stubbed.
 *
 * @param search - The query string, with its `?`.
 * @param panels - The panel host.
 * @returns The stubbed `fetch`.
 */
async function runWith(search: string, panels: PanelHost): Promise<ReturnType<typeof vi.fn>> {
    const fetch = vi.fn(async (): Promise<Response> => new Response('ok'));

    vi.stubGlobal('location', { search, origin: 'http://localhost:5190' });
    vi.stubGlobal('fetch', fetch);
    await runQa({ lib: LIB, build: '/lib', panels });

    return fetch;
}

/**
 * The one report `fetch` was called with.
 *
 * @param fetch - The stubbed `fetch`.
 * @returns The request's URL and parsed body.
 */
function onlyReport(fetch: ReturnType<typeof vi.fn>): { url: string; body: QaReport } {
    expect(fetch).toHaveBeenCalledTimes(1);

    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];

    return { url, body: JSON.parse(init.body as string) as QaReport };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('runQa', () => {
    it('E6 does nothing without qa=', async () => {
        const panels = fakePanels({ a: { defaultDrive: '', targets: {} } });
        const fetch = await runWith('', panels);

        expect(fetch).not.toHaveBeenCalled();
        expect(panels.setup).not.toHaveBeenCalled();
    });

    it('E7 reports an unknown panel', async () => {
        const fetch = await runWith('?qa=t&panel=nope&host=minibrowser', fakePanels({ a: { defaultDrive: '', targets: {} } }));
        const { url, body } = onlyReport(fetch);

        expect(url).toBe('/__qa/report?name=t');
        expect(body.schema).toBe(1);
        expect(body.name).toBe('t');
        expect(body.host).toBe('minibrowser');
        expect(body.error).toBe('unknown panel "nope" (registered: a)');
        expect(body).not.toHaveProperty('phases');
    });

    it('E8 asks for panel= when several are registered', async () => {
        const subject: Subject = { defaultDrive: '', targets: {} };
        const fetch = await runWith('?qa=t', fakePanels({ a: subject, b: subject }));

        expect(onlyReport(fetch).body.error).toBe('several panels registered (a, b); name one with panel=');
    });

    it('E9 rejects an unknown driver', async () => {
        const fetch = await runWith('?qa=t&drive=nope', fakePanels({ a: { defaultDrive: 'passes', targets: {} } }));

        expect(onlyReport(fetch).body.error).toBe('unknown driver "nope"');
    });

    it('E9 rejects a driver the panel gives no target for', async () => {
        const fetch = await runWith('?qa=t', fakePanels({ a: { defaultDrive: 'passes', targets: {} } }));

        expect(onlyReport(fetch).body.error).toBe('panel "a" gives no target for driver "passes"');
    });
});
