// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../../../Component.js";
import { Event } from "../../../Event.js";
import { Insets } from "../../../Insets.js";
import { Card } from "../../../layout/Card.js";
import { CellRenderer } from "./renderer/CellRenderer.js";
import { CellEditor } from "./editor/CellEditor.js";
import { LayoutConstraints } from "../../../layout/LayoutConstraints.js";

/**
 * Base class for table cells that support both a display renderer and an optional in-place editor.
 *
 * A {@link Card} layout toggles between the renderer and editor views. Double-clicking the
 * renderer starts an edit; blur or Enter commits it; Escape cancels it.
 */
export class Cell<T> extends Component {

    private readOnly: Boolean;
    private renderer: CellRenderer<T>;
    private editor: CellEditor<T> | undefined;
    private onCommit: ((value: T) => void) | undefined;

    constructor(tag: string, renderer: CellRenderer<T>, editor?: CellEditor<T>, rendererConstraints?: LayoutConstraints, editorContraints?: LayoutConstraints) {
        super(tag || "td");

        this.setLayoutManager(new Card());

        this.readOnly = false;
        this.renderer = renderer;
        this.editor = editor;
        this.setInsets(new Insets(0, 0, 0, 0));

        this.addComponent(renderer, rendererConstraints);

        if (editor) {
            this.addComponent(editor, editorContraints);

            Event.addListener(editor, 'blur', () => this.commitEdit());
            Event.addListener(editor, 'keydown', (e: KeyboardEvent) => this.onKeyDown(e));
        }

        Event.addListener(renderer, 'dblclick', () => this.startEdit());
    }

    /**
     * Registers a callback to invoke with the new value when an edit is committed.
     *
     * @param fn - The callback to fire on commit, receiving the committed value.
     */
    setOnCommit(fn: (value: T) => void): void {
        this.onCommit = fn;
    }

    /**
     * Returns true if the cell cannot be edited.
     *
     * @returns True if the cell is read-only.
     */
    isReadOnly() {
        return !!this.readOnly;
    }

    /**
     * Commits on Enter and cancels on Escape while editing.
     *
     * @param evnt - The keyboard event to handle.
     */
    onKeyDown(evnt: KeyboardEvent) {
        if (evnt.keyCode == 13) { // Enter
            this.commitEdit();
        } else if (evnt.keyCode == 27) { // Escape
            this.cancelEdit();
        }
    }

    /**
     * Returns true if the editor is currently the visible card layer.
     *
     * @returns True if the cell is in edit mode.
     */
    isEditing() {
        return this.editor && this.getLayoutManager().getVisibleComponentId() === this.editor.getId();
    }

    /**
     * Returns the Card layout manager used to toggle between renderer and editor.
     *
     * @returns The {@link Card} layout manager for this cell.
     */
    getLayoutManager() {
        return <Card>super.getLayoutManager();
    }

    /**
     * Switches to the editor view, copies the renderer's value, and focuses the editor.
     */
    startEdit() {
        console.log("START EDIT!");
        if (this.isReadOnly() || this.isEditing()) {
            return;
        }

        let editor = this.getEditor();
        if (!editor) {
            return;
        }

        let layoutManager = this.getLayoutManager();
        let renderer = this.getRenderer();

        editor.setValue(renderer.getValue());

        layoutManager.setVisibleComponentId(editor.getId());
        this.doLayout();
        editor.focus();
    }

    /**
     * Saves the editor value to the renderer, fires onCommit, and returns to renderer view.
     */
    commitEdit() {
        if (this.isReadOnly() || !this.isEditing()) {
            return;
        }

        let editor = this.getEditor();
        if (!editor) {
            return;
        }

        let layoutManager = this.getLayoutManager();
        let renderer = this.getRenderer();

        let text = editor.getValue();
        renderer.setValue(text);
        this.onCommit?.(text as T);

        layoutManager.setVisibleComponentId(renderer.getId());
        this.doLayout();
    }

    /**
     * Discards the editor value and returns to renderer view.
     */
    cancelEdit() {
        if (this.isReadOnly() || !this.isEditing()) {
            return;
        }

        let editor = this.getEditor();
        if (!editor) {
            return;
        }

        let layoutManager = this.getLayoutManager();
        let renderer = this.getRenderer();

        layoutManager.setVisibleComponentId(renderer.getId());
        this.doLayout();
    }

    /**
     * Sets the renderer's displayed value.
     *
     * @param value - The value to pass to the renderer.
     */
    setValue(value: T) {
        this.renderer.setValue(value);
    }

    /**
     * Returns the cell's renderer component.
     *
     * @returns The {@link CellRenderer} for this cell.
     */
    getRenderer() {
        return this.renderer;
    }

    /**
     * Returns the cell's editor component, or undefined if the cell is display-only.
     *
     * @returns The {@link CellEditor} for this cell, or undefined.
     */
    getEditor() {
        return this.editor;
    }
}