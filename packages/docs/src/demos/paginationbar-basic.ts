import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { VBox } from '@jimka/typescript-ui/layout';
import { MemoryStore, Model } from '@jimka/typescript-ui/data';
import { Table } from '@jimka/typescript-ui/component/table';
import { PaginationBar } from '@jimka/typescript-ui/component/display';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 200 is the table's rows at a page size of 3 plus the pagination bar below
 * it.
 */
export const height: number = 200;

/**
 * A `PaginationBar` over the PEOPLE store at `setPageSize(3)`, paging a
 * plain `Table` through two pages.
 *
 * `MemoryProxy` has no pagination logic of its own — `setPageSize` and
 * `nextPage()` only track page state and drive `PaginationBar`'s button
 * enablement; `AbstractStore.buildReadParams` forwards `{ page, pageSize }`
 * to the proxy, but a pagination-unaware proxy (every `MemoryStore`) just
 * ignores them and `load()` still returns every record. So the `Table`
 * cannot bind to the paginated store directly and show only one page's rows
 * — it binds to a second, small store instead, re-populated with the
 * current page's slice on every `'pagechange'`. Both stores share the same
 * in-memory PEOPLE array; nothing here reaches the network.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const pageSize = 3;

    const model = new Model([
        { name: 'id',   type: 'number' },
        { name: 'name', type: 'string' },
        { name: 'role', type: 'string' },
        { name: 'age',  type: 'number' },
    ]);

    const people = [
        { id: 1, name: 'Alice', role: 'Engineer', age: 30 },
        { id: 2, name: 'Bob',   role: 'Designer', age: 25 },
        { id: 3, name: 'Carol', role: 'Engineer', age: 41 },
        { id: 4, name: 'Dan',   role: 'Analyst',  age: 38 },
        { id: 5, name: 'Erin',  role: 'Designer', age: 29 },
    ];

    const pagingStore = new MemoryStore(model, people);
    pagingStore.setPageSize(pageSize);

    const tableStore = new MemoryStore(model, people.slice(0, pageSize));
    const table = Table(tableStore);

    pagingStore.on('pagechange', handlePageChange);

    function handlePageChange(): void {
        const start = (pagingStore.getPage() - 1) * pageSize;

        tableStore.proxy.setData(people.slice(start, start + pageSize));
        void tableStore.load();
    }

    const pagination = PaginationBar(pagingStore);

    void pagingStore.load();
    void tableStore.load();

    return Panel({
        layoutManager: VBox({ spacing: 4, stretching: true }),
        components:    [table, pagination],
    });
}
