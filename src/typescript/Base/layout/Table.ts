// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager } from "./LayoutManager.js";
import { Table as TableComponent } from "../component/table/Table.js";
import { Component } from "../Component.js";
import { Util } from "../Util.js";

/**
 * A layout manager dedicated to the `Table` component.
 * Positions the header, body, and footer sections within the container and
 * triggers virtual-scroll rendering on the body after each layout pass.
 */
export class Table extends LayoutManager {

    constructor() {
        super();
    }

    /**
     * Attaches to a container, throwing if it is not a `Table` component.
     *
     * @param container - The container component to attach to.
     *
     * @remarks This layout manager is only valid for containers whose class name is `"Table"`.
     */
    attach(container: Component) {
        if (container.getClassName() != "Table") {
            throw new Error("Container must be a Table.");
        }

        super.attach(container);
    }

    /**
     * Positions the header, body, and footer sections and triggers body virtual scroll rendering.
     *
     * @remarks Column width is calculated by dividing the available width (minus the scrollbar)
     * evenly across all model fields. The footer is pinned to the bottom of the container.
     */
    doLayout() {
        let container = <TableComponent>this.getContainer();
        if (!container) {
            return;
        }

        let containerSize = container.getInnerSize();
        if (!containerSize) {
            return;
        }

        let containerInsets = container.getInsets();

        let model = container.getModel();
        let columnCount = model.getFields().length;

        let header = container.getHeader();
        let body = container.getBody();
        let footer = container.getFooter();

        let columnWidth = (containerSize.width - Util.getScrollBarWidth()) / columnCount;

        if (container.isHeaderVisible() && header) {
            let headerColumns = header.getColumns();
            let columnHeight = 20;

            header.setAutoCommitStyle(false);
            header.setX(containerInsets.getLeft());
            header.setY(containerInsets.getTop());
            header.setWidth(containerSize.width);
            header.setHeight(columnHeight);
            header.setAutoCommitStyle(true);

            let x = 0;
            let y = 0;

            for (let idx in headerColumns) {
                let column = headerColumns[idx];

                column.setAutoCommitStyle(false);
                column.setX(x);
                column.setY(y);
                column.setWidth(columnWidth);
                column.setHeight(columnHeight);
                column.setAutoCommitStyle(true);

                column.doLayout();

                x += columnWidth;
            }
        }


        if (container.isFooterVisible() && footer) {
            let footerColumns = footer.getColumns();
            let columnHeight = 20;

            footer.setAutoCommitStyle(false);
            footer.setX(containerInsets.getLeft());
            footer.setY(containerInsets.getTop() + containerSize.height - columnHeight);
            footer.setWidth(containerSize.width);
            footer.setHeight(columnHeight);
            footer.setAutoCommitStyle(true);

            let x = 0;
            let y = 0;

            for (let idx in footerColumns) {
                let column = footerColumns[idx];

                column.setAutoCommitStyle(false);
                column.setX(x);
                column.setY(y);
                column.setWidth(columnWidth);
                column.setHeight(columnHeight);
                column.setAutoCommitStyle(true);

                column.doLayout();

                x += columnWidth;
            }
        }

        if (container.isBodyVisible() && body) {
            body.setAutoCommitStyle(false);
            body.setX(containerInsets.getLeft());
            body.setY(containerInsets.getTop() + (header ? header.getHeight() : 0));
            body.setWidth(containerSize.width);
            body.setHeight(containerSize.height - (header ? header.getHeight() : 0) - (footer ? footer.getHeight() : 0));
            body.setAutoCommitStyle(true);

            body.renderWindow(containerSize.width - Util.getScrollBarWidth(), columnWidth);
        }
    }
}
