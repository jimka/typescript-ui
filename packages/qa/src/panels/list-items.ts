import { List } from '@jimka/typescript-ui/component/list';
import { MemoryStore, Model } from '@jimka/typescript-ui/data';
import { listItems } from '../builders/data.js';
import { elementFor } from '../builders/dom.js';
import { awaitStoreView } from '../builders/store.js';
import type { HarnessTools } from '../harness/types.js';
import type { PanelBuild } from '../panels.js';

/** The panel's id, for errors. */
const PANEL = 'list-items';

/** The item selected before `key` runs: a few down, so both arrow keys move the selection. */
const LIST_START_INDEX = 5;

export const description = 'List of n items over a store (default 300). Reproduces slice 18 F18.2 (lists are not virtualised): 908 applies per unchanged pass in the engine, 906 of them the rows and 2 the overlay scroller a modelled DOM does not have; and F18.1 (a selection move rewrites every row\'s class attribute): 603 applies and 1 dispatchCustomEvent per arrow key.';

/** 300 items: slice 18's census. */
export const defaultScale = 300;

/** Moving the selection from the keyboard, the path F18.1 names. */
export const defaultDrive = 'key';

/**
 * Builds a `List` of `n` items.
 *
 * @param n - Items.
 * @returns The list as root, target of `passes` and `resize`; `afterMount` waits for the store's view, settles the selection and gives `key` the list's element.
 */
export function build(n: number): PanelBuild {
    const store = new MemoryStore(new Model([{ name: 'id', type: 'number' }, { name: 'name', type: 'string' }]));

    store.loadData(listItems(n));

    const selectedIndex = Math.min(LIST_START_INDEX, n - 1);
    const list = List({ store, displayField: 'name', valueField: 'id', selectedIndex });

    return {
        root: list,
        targets: { passes: list, resize: list },
        afterMount: async (tools: HarnessTools): Promise<Record<string, unknown>> => {
            // Above 1,000 items the store builds its view on a worker, so
            // `List`'s construction-time `selectedIndex` had nothing to
            // select; below that this re-selects the same item, harmlessly.
            // Silent, as the constructor's own call is: the initial pick is
            // not a selection the panel measures.
            await awaitStoreView(tools, store, PANEL);
            list.setSelectedIndex(selectedIndex, false);

            return { key: { element: elementFor(tools, list, PANEL), keys: ['ArrowDown', 'ArrowUp'] } };
        },
        geometry: { list },
        describe: () => ({ items: n }),
    };
}
