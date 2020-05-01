import { LayoutManager } from "./LayoutManager.js";
import { Table as TableComponent } from "../component/table/Table.js";
import { Component } from "../Component.js";
import { Util } from "../Util.js";

export class Table extends LayoutManager {

    constructor() {
        super();
    }

    attach(container: Component) {
        if (!(container instanceof TableComponent)) {
            throw new Error("Container must be a Table.");
        }

        super.attach(container);
    }

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
            let bodyComponents = body ? body.getComponents() : null;

            let columnHeight = 16;

            body.setAutoCommitStyle(false);
            body.setX(containerInsets.getLeft());
            body.setY(containerInsets.getTop() + (header ? header.getHeight() : 0));
            body.setWidth(containerSize.width);
            body.setHeight(containerSize.height - (header ? header.getHeight() : 0) - (footer ? footer.getHeight() : 0));
            body.setAutoCommitStyle(true);

            let x = 0;
            let y = 0;

            if (bodyComponents) {
                for (let row of bodyComponents) {
                    row.setAutoCommitStyle(false);
                    row.setX(0);
                    row.setY(y);
                    row.setWidth(containerSize.width - Util.getScrollBarWidth());
                    row.setHeight(columnHeight);
                    row.setAutoCommitStyle(true);

                    let columns = row.getComponents();

                    for (let jdx in columns) {
                        let column = columns[jdx];

                        column.setAutoCommitStyle(false);
                        column.setX(x);
                        column.setY(0);
                        column.setWidth(columnWidth);
                        column.setHeight(columnHeight);
                        column.setAutoCommitStyle(true);

                        column.doLayout();

                        x += columnWidth;
                    }

                    x = 0;
                    y += columnHeight;
                }
            }
        }
    }
}