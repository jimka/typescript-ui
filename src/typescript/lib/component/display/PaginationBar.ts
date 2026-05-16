// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { AbstractStore } from "~/data/AbstractStore.js";
import { HBox } from "~/layout/HBox.js";
import { Button } from "~/component/button/Button.js";
import { Text } from "~/component/input/Text.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link PaginationBar}.
 *
 * @category Components
 */
export interface PaginationBarOptions extends ComponentOptions {
    pageSize?:   number;
    pageIndex?:  number;
    totalCount?: number;
}

/**
 * A horizontal navigation bar for stepping through pages of a paginated
 * {@link AbstractStore}.
 *
 * @remarks
 * The bar displays first / previous / next / last buttons and a `Page X of Y`
 * label, all driven by the store's pagination state. It subscribes to the
 * store's `'pagechanged'` and `'load'` events and updates button-enabled
 * state automatically. The bar can be embedded anywhere — [`TablePanel`](/api/component/table/classes/TablePanel)'s
 * `setPaginationBar()` is one consumer, but it is not required.
 *
 * @example
 * ```typescript
 * import { AjaxProxy, Store } from '@jimka/typescript-ui/data';
 * import { PaginationBar } from '@jimka/typescript-ui/component/display';
 * import { TablePanel } from '@jimka/typescript-ui/component/table';
 *
 * const store = new Store({ model, proxy: new AjaxProxy({ url: '/api/users' }) });
 * store.setPageSize(25);
 *
 * const panel = new TablePanel(store);
 * panel.setPaginationBar(new PaginationBar(store));
 *
 * void store.load();
 * ```
 *
 * @category Components
 */
class PaginationBar extends Component<PaginationBarOptions> {

    private store: AbstractStore;

    private firstBtn: Button;
    private prevBtn: Button;
    private nextBtn: Button;
    private lastBtn: Button;
    private pageText: Text;

    private readonly onStoreUpdate: () => void = () => this.refresh();

    /**
     * Constructs a pagination bar bound to the given store.
     *
     * @param store - The store whose pagination state drives the bar.
     */
    constructor(store: AbstractStore, options?: PaginationBarOptions) {
        super();

        this.store = store;

        const layout = new HBox();
        layout.setComponentSpacing(4);
        this.setLayoutManager(layout);

        this.firstBtn = new Button({ glyph: "angles-left"  });
        this.prevBtn  = new Button({ glyph: "angle-left"   });
        this.pageText = new Text("Page x of y");
        this.nextBtn  = new Button({ glyph: "angle-right"  });
        this.lastBtn  = new Button({ glyph: "angles-right" });

        this.firstBtn.setPreferredSize(28, 28);
        this.prevBtn.setPreferredSize(28, 28);
        this.nextBtn.setPreferredSize(28, 28);
        this.lastBtn.setPreferredSize(28, 28);

        // Match the buttons' 28px row height so the page label baseline lines up.
        this.pageText.centerInHeight(28);

        this.firstBtn.addActionListener(() => this.store.goToPage(1));
        this.prevBtn.addActionListener(() => this.store.prevPage());
        this.nextBtn.addActionListener(() => this.store.nextPage());
        this.lastBtn.addActionListener(() => {
            const total = this.store.getTotalPages();
            this.store.goToPage(total ?? this.store.getPage());
        });

        this.addComponent(this.firstBtn);
        this.addComponent(this.prevBtn);
        this.addComponent(this.pageText);
        this.addComponent(this.nextBtn);
        this.addComponent(this.lastBtn);

        this.store.on('pagechanged', this.onStoreUpdate);
        this.store.on('load', this.onStoreUpdate);
        this.store.on('datachanged', this.onStoreUpdate);
        this.store.on('add', this.onStoreUpdate);
        this.store.on('remove', this.onStoreUpdate);
        this.store.on('sync', this.onStoreUpdate);

        this.refresh();

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link PaginationBarOptions} bag, dispatching pagination
     * properties to the bound store after inherited Component fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: PaginationBarOptions): this {
        super.applyOptions(options);

        if (options.pageSize !== undefined) {
            this.store.setPageSize(options.pageSize);
        }

        if (options.pageIndex !== undefined) {
            this.store.goToPage(options.pageIndex);
        }

        return this;
    }

    /**
     * Detaches the store listeners installed by this bar.
     *
     * @remarks
     * Call this when permanently removing the bar (e.g. before discarding it,
     * or when replacing it via [`TablePanel.setPaginationBar`](/api/component/table/classes/TablePanel#setpaginationbar)). After
     * disposal the bar will no longer track the store.
     */
    dispose(): void {
        this.store.off('pagechanged', this.onStoreUpdate);
        this.store.off('load', this.onStoreUpdate);
        this.store.off('datachanged', this.onStoreUpdate);
        this.store.off('add', this.onStoreUpdate);
        this.store.off('remove', this.onStoreUpdate);
        this.store.off('sync', this.onStoreUpdate);
    }

    /**
     * Updates the page label and button-enabled states from the current store state.
     *
     * @remarks
     * When the store has pending unsynced changes, all four navigation buttons
     * are disabled — leaving the page would silently discard in-flight edits.
     * Buttons re-enable once the store is synced or rejected.
     */
    private refresh(): void {
        const page       = this.store.getPage();
        const totalPages = this.store.getTotalPages();
        const dirty      = this.store.hasPendingChanges();
        const text       = totalPages != null
            ? `Page ${page} of ${totalPages}`
            : `Page ${page}`;

        this.pageText.setText(text);
        this.firstBtn.setEnabled(!dirty && page > 1);
        this.prevBtn.setEnabled(!dirty && page > 1);
        this.nextBtn.setEnabled(!dirty && (totalPages == null || page < totalPages));
        this.lastBtn.setEnabled(!dirty && totalPages != null && page < totalPages);
    }
}

const PaginationBarCallable = callable(PaginationBar);
type PaginationBarCallable = PaginationBar;
export {
    PaginationBar         as _PaginationBar,
    PaginationBarCallable as PaginationBar
};
