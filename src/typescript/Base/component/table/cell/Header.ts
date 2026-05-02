// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DefaultCell } from "./Default.js";
import { Event } from "../../../Event.js";
import { Util } from "../../../Util.js";
import { CSS } from "../../../CSS.js";

/**
 * A non-editable header cell rendered as a `<th>` element.
 *
 * Extends {@link DefaultCell} with a sort state indicator (▲/▼ suffix on the label),
 * a click-to-sort callback, and a drag handle at the right edge for column resizing.
 *
 * The resize handle is a raw `<div>` (not a Component) appended in `init()`. Native
 * listeners are used on the div; `Event.addViewportListener` is used for the
 * mousemove/mouseup drag phase so they route through the framework's event system.
 */
export class HeaderCell extends DefaultCell {

    private text: String;
    private fieldName: string;
    private onSortClickCallback: ((fieldName: string) => void) | null = null;
    private resizeDragCallback: ((delta: number) => void) | null = null;
    private isDragging = false;

    /**
     * Creates a header cell with bold text and wires up the sort click listener.
     *
     * @param text - The column title to display.
     * @param fieldName - The model field name used when triggering sort callbacks.
     */
    constructor(text: String, fieldName: string) {
        super("th");

        this.text = text;
        this.fieldName = fieldName;

        let renderer = this.getRenderer();
        renderer.getLabel().setFontSize("--ts-ui-table-header-font-size");
        renderer.getLabel().setFontWeight("bold");
        renderer.getLabel().setText(text);

        const activeRule = CSS.createComponentRule(this.getId() + ':active');

        if (activeRule) {
            activeRule.style.setProperty('box-shadow', 'var(--ts-ui-button-pressed-shadow, 1px 2px 5px 0 rgba(0,0,0,0.2) inset)');
        }
    }

    /**
     * Appends the resize handle div to the rendered element.
     *
     * @param element - Optional element passed from the framework init chain.
     */
    protected init(element?: HTMLElement): void {
        super.init(element);

        const el = element || this.getElement();

        if (!el) {
            return;
        }

        // Native listener so clicks on any child element (e.g. the Label) bubble up here.
        el.addEventListener('click', () => this.onSortClick());

        const handle = document.createElement('div');

        // Thin vertical bar (right 2 px of the 5 px hit area) as visual drag indicator.
        handle.style.cssText = 'position:absolute;top:0;right:0;width:5px;height:100%;cursor:ew-resize;z-index:1;' +
                               'background:linear-gradient(to right,transparent 60%,rgba(0,0,0,0.2) 60%);';
        handle.addEventListener('mousedown', (e: MouseEvent) => this.onResizeDragStart(e));
        handle.addEventListener('click', (e: MouseEvent) => e.stopPropagation()); // never trigger sort

        el.appendChild(handle);
    }

    /**
     * Updates the label to show a sort direction arrow suffix, or removes it.
     *
     * @param state - 'asc', 'desc', or null to clear the indicator.
     */
    setSortState(state: 'asc' | 'desc' | null): void {
        const arrow = state === 'asc' ? ' ▲' : state === 'desc' ? ' ▼' : '';

        this.getRenderer().getLabel().setText(this.text + arrow);
    }

    /**
     * Registers the callback invoked when the user clicks to sort this column.
     *
     * @param fn - Receives the field name for this column.
     */
    setOnSortClick(fn: (fieldName: string) => void): void {
        this.onSortClickCallback = fn;
    }

    /**
     * Registers the callback invoked with the horizontal pixel delta on each drag move.
     *
     * @param fn - Receives movementX on each mousemove during a resize drag.
     */
    setOnResizeDrag(fn: (delta: number) => void): void {
        this.resizeDragCallback = fn;
    }

    private onSortClick(): void {
        if (this.isDragging) {
            this.isDragging = false;
            return;
        }

        this.onSortClickCallback?.(this.fieldName);
    }

    private onResizeDragStart(e: MouseEvent): void {
        e.stopPropagation();

        this.isDragging = true;

        Event.addViewportListener(this, 'mousemove', this.onResizeDrag);
        Event.addViewportListener(this, 'mouseup', this.onResizeDragStop);

        Util.select('body').style.pointerEvents = 'none';
    }

    private onResizeDrag(e: MouseEvent): void {
        this.resizeDragCallback?.(e.movementX);
    }

    private onResizeDragStop(): void {
        Event.removeViewportListener(this, 'mousemove', this.onResizeDrag);
        Event.removeViewportListener(this, 'mouseup', this.onResizeDragStop);

        Util.select('body').style.pointerEvents = '';

        // clear flag after synthesized click fires
        setTimeout(() => { this.isDragging = false; }, 0);
    }
}
