// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../../../Component.js";
import { Event } from "../../../Event.js";
import { Insets } from "../../../Insets.js";
import { Card } from "../../../layout/Card.js";
import { CellRenderer } from "./renderer/CellRenderer.js";
import { CellEditor } from "./editor/CellEditor.js";
import { LayoutConstraints } from "../../../layout/LayoutConstraints.js";

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

    setOnCommit(fn: (value: T) => void): void {
        this.onCommit = fn;
    }

    isReadOnly() {
        return !!this.readOnly;
    }

    onKeyDown(evnt: KeyboardEvent) {
        if (evnt.keyCode == 13) { // Enter
            this.commitEdit();
        } else if (evnt.keyCode == 27) { // Escape
            this.cancelEdit();
        }
    }

    isEditing() {
        return this.editor && this.getLayoutManager().getVisibleComponentId() === this.editor.getId();
    }

    getLayoutManager() {
        return <Card>super.getLayoutManager();
    }

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

    setValue(value: T) {
        this.renderer.setValue(value);
    }

    getRenderer() {
        return this.renderer;
    }

    getEditor() {
        return this.editor;
    }
}