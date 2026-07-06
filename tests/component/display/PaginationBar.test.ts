import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PaginationBar } from '~/component/display/PaginationBar';
import { Store } from '~/data/Store';
import { Model } from '~/data/Model';
import { Proxy, ReadParams } from '~/data/proxy/Proxy';
import { ModelRecord } from '~/data/ModelRecord';
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

const MODEL = new Model([{ name: 'id' }, { name: 'name' }], 'id');

/**
 * A proxy that resolves `read()` with a fixed page of rows and reports a fixed
 * total count, so a paginated `load()` populates the store's `_totalCount`
 * (otherwise only set by the proxy round-trip).
 */
class FixedProxy extends Proxy {
    constructor(private readonly rows: any[], private readonly total: number) {
        super();
    }

    read(_params?: ReadParams): Promise<any[]> {
        return Promise.resolve(this.rows);
    }

    getLastTotalCount(): number | undefined {
        return this.total;
    }

    create(record: ModelRecord): Promise<Record<string, any>> { return Promise.resolve(record.getData()); }
    update(record: ModelRecord): Promise<Record<string, any>> { return Promise.resolve(record.getData()); }
    destroy(): Promise<void> { return Promise.resolve(); }
}

/**
 * Builds a paginated store with the given page size and total count, runs one
 * paginated load so `getTotalPages()` is derivable, and returns it.
 */
async function pagedStore(pageSize: number, total: number): Promise<Store> {
    const store = new Store({ model: MODEL, proxy: new FixedProxy([], total) });

    store.setPageSize(pageSize);

    await store.load();

    return store;
}

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

describe('Store page-count math (PaginationBar dependency)', () => {
    it('derives ceil(total / pageSize) pages — 95 / 25 → 4', async () => {
        const store = await pagedStore(25, 95);

        expect(store.getTotalPages()).toBe(4);
    });
    it('clamps an exact multiple — 100 / 25 → 4', async () => {
        const store = await pagedStore(25, 100);

        expect(store.getTotalPages()).toBe(4);
    });
    it('reports at least 1 page for 0 records', async () => {
        const store = await pagedStore(25, 0);

        expect(store.getTotalPages()).toBe(1);
    });
});

describe('Store page navigation clamping (PaginationBar dependency)', () => {
    it('goToPage(0) clamps to page 1', async () => {
        const store = await pagedStore(25, 95);

        store.goToPage(0);

        expect(store.getPage()).toBe(1);
    });
    it('goToPage(999) clamps to the last page', async () => {
        const store = await pagedStore(25, 95);

        store.goToPage(999);

        expect(store.getPage()).toBe(4);
    });
    it('nextPage no-ops at the last page', async () => {
        const store = await pagedStore(25, 95);

        store.goToPage(4);
        store.nextPage();

        expect(store.getPage()).toBe(4);
    });
    it('prevPage no-ops at the first page', async () => {
        const store = await pagedStore(25, 95);

        store.prevPage();

        expect(store.getPage()).toBe(1);
    });
});

describe('PaginationBar label', () => {
    /**
     * Reads the bar's page-label text through its public child tree. The label
     * is the third child (first/prev/text/next/last), a `Text`-derived control
     * exposing `getText()`.
     */
    function labelOf(bar: PaginationBar): string {
        const text = (bar as unknown as { getComponents(): { getText(): string }[] }).getComponents()[2];

        return text.getText();
    }

    it('reads "Page X of Y" when the total page count is known', async () => {
        const store = await pagedStore(25, 95);

        store.goToPage(2);

        const bar = new PaginationBar(store);

        expect(labelOf(bar)).toBe('Page 2 of 4');
    });
    it('reads "Page X" when the total page count is unknown', () => {
        // A fresh store with no paginated load has no totalCount, so totalPages
        // is undefined and the label omits the "of Y" suffix.
        const store = new Store({ model: MODEL });

        const bar = new PaginationBar(store);

        expect(labelOf(bar)).toBe('Page 1');
    });
});

describe('PaginationBar nav-button enabled state', () => {
    /**
     * Returns the four nav buttons (first/prev/next/last) by skipping the page
     * label child at index 2.
     */
    function navButtons(bar: PaginationBar): { isEnabled(): boolean }[] {
        const kids = (bar as unknown as { getComponents(): { isEnabled(): boolean }[] }).getComponents();

        return [kids[0], kids[1], kids[3], kids[4]];
    }

    it('disables first/prev on page 1 and enables next/last with more pages', async () => {
        const store = await pagedStore(25, 95);

        const bar = new PaginationBar(store);
        const [first, prev, next, last] = navButtons(bar);

        expect(first.isEnabled()).toBe(false);
        expect(prev.isEnabled()).toBe(false);
        expect(next.isEnabled()).toBe(true);
        expect(last.isEnabled()).toBe(true);
    });
    it('disables all four nav buttons while the store has pending changes', async () => {
        const store = await pagedStore(25, 95);

        store.goToPage(2);

        // A new unsynced record makes hasPendingChanges() true, which refresh()
        // reads to disable every nav button so in-flight edits aren't discarded.
        store.add({ id: 1, name: 'fresh' });

        const bar = new PaginationBar(store);

        for (const btn of navButtons(bar)) {
            expect(btn.isEnabled()).toBe(false);
        }
    });
});

describe('PaginationBar options wiring', () => {
    it('forwards { pageSize } to the store', () => {
        const store = new Store({ model: MODEL });

        new PaginationBar(store, { pageSize: 50 });

        expect(store.getPageSize()).toBe(50);
    });
    it('forwards { pageIndex } to store.goToPage', async () => {
        const store = await pagedStore(25, 95);

        new PaginationBar(store, { pageIndex: 3 });

        expect(store.getPage()).toBe(3);
    });
});

describe('PaginationBar dispose', () => {
    it('detaches the store listeners so a later pagechange emit does not refresh', async () => {
        const store = await pagedStore(25, 95);

        store.goToPage(2);

        const bar = new PaginationBar(store);

        const label = (): string =>
            (bar as unknown as { getComponents(): { getText(): string }[] }).getComponents()[2].getText();

        expect(label()).toBe('Page 2 of 4');

        bar.dispose();

        // After dispose the bar ignores store updates: a page change leaves the
        // last-rendered label in place rather than refreshing to "Page 3 of 4".
        store.goToPage(3);

        expect(label()).toBe('Page 2 of 4');
    });
});
