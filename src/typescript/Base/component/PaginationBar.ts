// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../Component.js";
import { AbstractStore } from "../data/AbstractStore.js";
import { HBox } from "../layout/HBox.js";
import { Button } from "./Button.js";
import { Text } from "./Text.js";

/**
 * A horizontal navigation bar for stepping through pages of a paginated
 * {@link AbstractStore}.
 *
 * @remarks
 * The bar displays first / previous / next / last buttons and a `Page X of Y`
 * label, all driven by the store's pagination state. It subscribes to the
 * store's `'pagechanged'` and `'load'` events and updates button-enabled
 * state automatically. The bar can be embedded anywhere — {@link TablePanel}'s
 * `setPaginationBar()` is one consumer, but it is not required.
 *
 * @example
 * ```typescript
 * import { AjaxProxy, PaginationBar, Store, TablePanel } from '@jimka/typescript-ui';
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
export class PaginationBar extends Component {

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
    constructor(store: AbstractStore) {
        super();

        this.store = store;

        const layout = new HBox();
        layout.setComponentSpacing(4);
        this.setLayoutManager(layout);

        this.firstBtn = new Button("<<");
        this.prevBtn  = new Button("<");
        this.pageText = new Text("");
        this.nextBtn  = new Button(">");
        this.lastBtn  = new Button(">>");

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
    }

    /**
     * Detaches the store listeners installed by this bar.
     *
     * @remarks
     * Call this when permanently removing the bar (e.g. before discarding it,
     * or when replacing it via {@link TablePanel.setPaginationBar}). After
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
