// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { AbstractStore } from "~/data/AbstractStore.js";
import { HBox } from "~/layout/HBox.js";
import { Button } from "~/component/button/Button.js";
import { Text } from "~/component/input/Text.js";
import { callable } from "~/core/Callable.js";
import { Glyph } from "~/component/display/Glyph.js";
import { angles_left }  from "~/glyphs/solid/angles_left.js";
import { angle_left }   from "~/glyphs/solid/angle_left.js";
import { angle_right }  from "~/glyphs/solid/angle_right.js";
import { angles_right } from "~/glyphs/solid/angles_right.js";

Glyph.register(angles_left, angle_left, angle_right, angles_right);

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

    private _store: AbstractStore;

    private _firstBtn: Button;
    private _prevBtn: Button;
    private _nextBtn: Button;
    private _lastBtn: Button;
    private _pageText: Text;

    private readonly _onStoreUpdate: () => void = () => this.refresh();

    /**
     * Constructs a pagination bar bound to the given store.
     *
     * @param store - The store whose pagination state drives the bar.
     */
    constructor(store: AbstractStore, options?: PaginationBarOptions) {
        // Child components are built first; options are applied via applyOptions at the constructor tail.
        // eslint-disable-next-line local/forward-super-options
        super();

        this._store = store;

        const layout = new HBox();
        layout.setComponentSpacing(4);
        this.setLayoutManager(layout);

        this._firstBtn = new Button({ glyph: "angles-left"  });
        this._prevBtn  = new Button({ glyph: "angle-left"   });
        this._pageText = new Text("Page x of y");
        this._nextBtn  = new Button({ glyph: "angle-right"  });
        this._lastBtn  = new Button({ glyph: "angles-right" });

        this._firstBtn.setPreferredSize(28, 28);
        this._prevBtn.setPreferredSize(28, 28);
        this._nextBtn.setPreferredSize(28, 28);
        this._lastBtn.setPreferredSize(28, 28);

        // Match the buttons' 28px row height so the page label baseline lines up.
        this._pageText.centerInHeight(28);

        this._firstBtn.on("action", () => this._store.goToPage(1));
        this._prevBtn.on("action", () => this._store.prevPage());
        this._nextBtn.on("action", () => this._store.nextPage());
        this._lastBtn.on("action", () => {
            const total = this._store.getTotalPages();
            this._store.goToPage(total ?? this._store.getPage());
        });

        this.addComponent(this._firstBtn);
        this.addComponent(this._prevBtn);
        this.addComponent(this._pageText);
        this.addComponent(this._nextBtn);
        this.addComponent(this._lastBtn);

        this._store.on('pagechanged', this._onStoreUpdate);
        this._store.on('load', this._onStoreUpdate);
        this._store.on('datachanged', this._onStoreUpdate);
        this._store.on('add', this._onStoreUpdate);
        this._store.on('remove', this._onStoreUpdate);
        this._store.on('sync', this._onStoreUpdate);

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
            this._store.setPageSize(options.pageSize);
        }

        if (options.pageIndex !== undefined) {
            this._store.goToPage(options.pageIndex);
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
        this._store.off('pagechanged', this._onStoreUpdate);
        this._store.off('load', this._onStoreUpdate);
        this._store.off('datachanged', this._onStoreUpdate);
        this._store.off('add', this._onStoreUpdate);
        this._store.off('remove', this._onStoreUpdate);
        this._store.off('sync', this._onStoreUpdate);
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
        const page       = this._store.getPage();
        const totalPages = this._store.getTotalPages();
        const dirty      = this._store.hasPendingChanges();
        const text       = totalPages != null
            ? `Page ${page} of ${totalPages}`
            : `Page ${page}`;

        this._pageText.setText(text);
        this._firstBtn.setEnabled(!dirty && page > 1);
        this._prevBtn.setEnabled(!dirty && page > 1);
        this._nextBtn.setEnabled(!dirty && (totalPages == null || page < totalPages));
        this._lastBtn.setEnabled(!dirty && totalPages != null && page < totalPages);
    }
}

const PaginationBarCallable = callable(PaginationBar);
type PaginationBarCallable = PaginationBar;
export {
    PaginationBar         as _PaginationBar,
    PaginationBarCallable as PaginationBar
};
