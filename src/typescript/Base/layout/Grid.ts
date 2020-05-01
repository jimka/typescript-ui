import { LayoutManager } from "./LayoutManager.js";
import { FillType } from "./FillType.js";

export class Grid extends LayoutManager {

    private rows: number = 0;
    private columns: number = 0;

    constructor() {
        super();
    }

    getRows() {
        return this.rows;
    }

    setRows(rows: number) {
        this.rows = rows;
    }

    getColumns() {
        return this.columns;
    }

    setColumns(columns: number) {
        this.columns = columns;
    }

    getColRowCount() {
        let container = this.getContainer();
        if (!container) {
            return;
        }

        let components = container.getComponents();
        let componentCount = components.length;

        let rows = 0;
        let columns = 0;

        if (!this.rows && !this.columns) {
            columns = Math.floor(Math.sqrt(componentCount));
            rows = Math.ceil(componentCount / columns);
        } else if (this.rows && this.columns) {
            rows = this.rows;
            columns = Math.floor(Math.sqrt(componentCount / rows));
        } else if (this.columns) {
            columns = this.columns;
            rows = Math.ceil(componentCount / columns);
        }

        return {
            width: rows,
            height: columns
        };
    }

    getPreferredSize() {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();

        let outerWidth = perimiterSize.left + perimiterSize.right;
        let outerHeight = perimiterSize.top + perimiterSize.bottom;

        let components = container.getComponents();

        let innerWidth = 0;
        let innerHeight = 0;

        for (let idx in components) {
            let component = components[idx];
            let size = component.getPreferredSize();

            if (size) {
                innerWidth = Math.max(innerWidth, size.width);
                innerHeight = Math.max(innerHeight, size.height);
            }
        }

        let colRowCount = this.getColRowCount();

        if (colRowCount) {
            innerWidth = innerWidth * colRowCount.width;
            innerHeight = innerHeight * colRowCount.height;
        }

        return {
            width: innerWidth + outerWidth,
            height: innerHeight + outerHeight
        };
    }

    getMinSize() {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();

        let outerWidth = perimiterSize.left + perimiterSize.right;
        let outerHeight = perimiterSize.top + perimiterSize.bottom;

        let components = container.getComponents();

        let innerWidth = 0;
        let innerHeight = 0;

        for (let idx in components) {
            let component = components[idx];
            let size = component.getMinSize();

            if (size) {
                innerWidth = Math.max(innerWidth, size.width);
                innerHeight = Math.max(innerHeight, size.height);
            }
        }

        let colRowCount = this.getColRowCount();

        if (colRowCount) {
            innerWidth = innerWidth * colRowCount.width;
            innerHeight = innerHeight * colRowCount.height;
        }

        return {
            width: innerWidth + outerWidth,
            height: innerHeight + outerHeight
        };
    }

    getMaxSize() {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();

        let outerWidth = perimiterSize.left + perimiterSize.right;
        let outerHeight = perimiterSize.top + perimiterSize.bottom;

        let components = container.getComponents();

        let innerWidth = Number.MAX_SAFE_INTEGER;
        let innerHeight = Number.MAX_SAFE_INTEGER;

        for (let idx in components) {
            let component = components[idx];
            let size = component.getMaxSize();

            if (size) {
                innerWidth = Math.min(innerWidth, size.width);
                innerHeight = Math.min(innerHeight, size.height);
            }
        }

        let colRowCount = this.getColRowCount();

        if (colRowCount) {
            innerWidth = innerWidth * colRowCount.width;
            innerHeight = innerHeight * colRowCount.height;
        }

        return {
            width: innerWidth + outerWidth,
            height: innerHeight + outerHeight
        };
    }

    doLayout() {
        let container = this.getContainer();
        if (!container) {
            return;
        }

        let components = container.getComponents();
        let containerInsets = container.getInsets();
        let containerSize = container.getInnerSize();
        if (!containerSize) {
            return;
        }

        let columnWidth = containerSize.width;
        let columnHeight = containerSize.height;

        let colRowCount = this.getColRowCount();

        if (colRowCount) {
            columnWidth /= colRowCount.width;
            columnHeight /= colRowCount.height;
        }

        let colCount = colRowCount ? colRowCount.width : 1;

        //let rowIdx = 0;
        let colIdx = 0;
        let x = containerInsets.getLeft();
        let y = containerInsets.getTop();

        for (let idx in components) {
            let component = components[idx];

            this.placeComponent(
                component,
                x,
                y,
                columnWidth,
                columnHeight,
                FillType.BOTH
            );

            colIdx += 1;

            if (colIdx >= colCount) {
                //rowIdx += 1;
                colIdx = 0;

                x = containerInsets.getLeft();
                y += columnHeight;
            } else {
                x += columnWidth;
            }
        }
    }
}
