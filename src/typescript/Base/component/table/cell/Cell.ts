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

            Event.addListener(editor, 'blur', this.commitEdit.bind(this));
            Event.addListener(editor, 'keydown', this.onKeyDown.bind(this));
        }

        Event.addListener(renderer, 'dblclick', this.startEdit.bind(this));
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

    getRenderer() {
        return this.renderer;
    }

    getEditor() {
        return this.editor;
    }
}