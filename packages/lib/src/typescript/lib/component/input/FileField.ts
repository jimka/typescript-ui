// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractInput, AbstractInputOptions } from "~/component/input/AbstractInput.js";
import { Button } from "~/component/button/Button.js";
import { Component } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { Event } from "~/core/Event.js";
import { HBox } from "~/layout/HBox.js";
import { Text } from "~/component/input/Text.js";
import { callable } from "~/core/Callable.js";

// Above this many selected files the label collapses to a "N files" summary
// rather than joining every name. Empirically chosen: a handful of names still
// reads as a useful list, but a long comma-joined run just overflows the field
// and the count is the only legible signal past that point.
const FILENAME_JOIN_LIMIT = 3;

// The empty-state label, shown whenever no file is selected.
const NO_FILE_LABEL = "no file selected";

/**
 * Hidden native `<input type="file">` owned by {@link FileField}. The native
 * control is the single source of truth for a *picked* `FileList`; this small
 * `Component` subclass owns the behavioural HTML attributes (`type`, `multiple`,
 * `accept`) through typed setters per [ARCHITECTURE.md](/ARCHITECTURE.md) so the
 * raw `setElementAttribute` seam never leaks to a call site.
 *
 * Not exported — purely an internal detail of `FileField`.
 */
class HiddenFileInput extends Component {

    // Cached native attributes, so reads return the canonical value and `init()`
    // can replay them once the element exists — `setElementAttribute` is a no-op
    // before render, so the cache is the single source of truth (same recipe as
    // TextInput's `_options.type` / `init()` replay). These live in private
    // backing fields rather than an options bag because this internal control is
    // not consumer-configurable.
    private _type:     string | null  = null;
    private _multiple: boolean         = false;
    private _accept:   string | null  = null;

    constructor() {
        super({ tag: "input" }, { displayed: false });

        // `setDisplayed(false)`, not `setDisplay("none")`: both render the element
        // `display: none`, but only the former marks the component undisplayed so
        // it drops out of `getLaidOutComponents`. Left displayed, this zero-content
        // input still claimed a layout slot in the field's HBox — and with no
        // preferred width it contributed `_defaultComponentWidth`, inflating the
        // row past the container and shrinking the button + filename label until
        // their text clipped. The native control still opens via `click()` while
        // `display: none`.
        this.setDisplayed(false);
        this.setType("file");
    }

    /**
     * Returns the cached native `type`, or `null` before it is set.
     *
     * @returns The input type string, or `null`.
     */
    getType(): string | null {
        return this._type;
    }

    /**
     * Sets the native `type` attribute through the typed-setter seam, mirroring
     * [`TextInput.setType`](/api/component/input/classes/TextInput#settype) — the
     * value is cached and {@link init} replays it once the element exists.
     *
     * @param value - The input type (always `"file"` here).
     */
    setType(value: string): void {
        this._type = value;
        this.setElementAttribute("type", value);
    }

    /**
     * Sets or clears the native `multiple` attribute. Cached for replay at
     * render time.
     *
     * @param value - `true` to allow multi-file selection.
     */
    setMultipleAttribute(value: boolean): void {
        this._multiple = value;

        if (value) {
            this.setElementAttribute("multiple", "");
        } else {
            this.removeElementAttribute("multiple");
        }
    }

    /**
     * Sets the native `accept` attribute (the OS picker's type filter). Cached
     * for replay at render time.
     *
     * @param value - A comma-separated `accept` token list, e.g. `".csv,image/*"`.
     */
    setAcceptAttribute(value: string): void {
        this._accept = value;
        this.setElementAttribute("accept", value);
    }

    /**
     * Sets or clears the native `disabled` attribute.
     *
     * @param value - `true` to disable the control.
     */
    setDisabled(value: boolean): void {
        this.setDisabledAttribute(value);
    }

    /**
     * Opens the OS file picker by synthesising a click on the native input.
     */
    openPicker(): void {
        const el = this.getElement();

        if (el) {
            DOM.sink.click(el);
        }
    }

    /**
     * Returns the live `FileList` the native control currently holds, or `null`
     * before the element exists.
     *
     * @returns The native `FileList`, or `null`.
     */
    getFiles(): FileList | null {
        const el = this.getElement();

        return el ? DOM.source.getFiles(el) : null;
    }

    /**
     * Clears the native selection (`el.value = ""`). The browser only permits
     * programmatically *clearing* a file input, never populating it.
     */
    clearFiles(): void {
        const el = this.getElement();

        if (el) {
            DOM.sink.setValue(el, "");
        }
    }

    /**
     * Replays the cached behavioural attributes onto the freshly created element.
     * `setElementAttribute` now caches into the base class's `_elementAttributes`
     * map and replays it from `Component.init()`, so this replay is redundant —
     * kept anyway, matching the same replay TextInput's `init()` performs.
     *
     * @param element - The element being initialised, when provided by the caller.
     *
     * @returns This component, for method chaining.
     */
    protected init(element?: Handle): this {
        super.init(element);

        const el = element ?? this.getElement();

        if (!el) {
            return this;
        }

        if (this._type !== null) {
            DOM.sink.apply(el, { setAttr: { type: this._type } });
        }

        if (this._multiple) {
            DOM.sink.apply(el, { setAttr: { multiple: "" } });
        }

        if (this._accept !== null) {
            DOM.sink.apply(el, { setAttr: { accept: this._accept } });
        }

        return this;
    }
}

/**
 * Construction-time options for {@link FileField}.
 *
 * @category Components
 */
export interface FileFieldOptions extends AbstractInputOptions {
    /** Allow selecting more than one file. Maps to the native `multiple` attribute. Default false. */
    multiple?:   boolean;
    /** Native file-type filter, e.g. `".sql,.csv"` or `"image/*"`. Maps to the native `accept` attribute. */
    accept?:     string;
    /** Trigger button label. Defaults to "Choose file…" / "Choose files…" per `multiple`. */
    buttonText?: string;
}

/**
 * A styled file-selection control: a trigger [`Button`](/api/component/button/classes/Button)
 * that opens the OS file picker, plus a filename label. Wraps a hidden native
 * `<input type="file">` and implements [`Bindable<File[]>`](/api/core/interfaces/Bindable).
 *
 * The native input is the source of truth for a *picked* `FileList`; the field
 * reads it on the native `change` event and fans the new value out through
 * {@link AbstractInput}'s `change` / `binding` listeners. A separate cache holds
 * files handed in by a [`FileDropZone`](/api/component/input/classes/FileDropZone)
 * drop, which the browser cannot push back into the native control.
 *
 * @remarks **Write contract is clear-only.** The browser forbids assigning a
 * non-empty `FileList` to a file input outside a user gesture, so
 * {@link setValue} honours only the empty case (it clears the control). A
 * non-empty argument is a no-op plus one `console.warn`; it never throws, so a
 * record load through [`Binding`](/api/core/classes/Binding) stays
 * side-effect-tolerant. {@link getValue} always returns the live `File[]`, so
 * the read side of the binding contract is complete.
 *
 * @category Components
 */
class FileField<TOptions extends FileFieldOptions = FileFieldOptions>
    extends AbstractInput<File[], TOptions>
{
    private _button: Button;
    private _label:  Text;
    private _input:  HiddenFileInput;

    // Files supplied by a FileDropZone drop. The browser cannot push these into
    // the native `<input>`, so they live here and supersede the (empty) native
    // FileList in `getValue`. Cleared and superseded by the next native `change`.
    private _droppedFiles: File[] = [];

    /**
     * Constructs a FileField.
     *
     * @param options - Optional construction-time options.
     *
     * @remarks The parameter is typed as the concrete {@link FileFieldOptions}
     * rather than the class's `TOptions` parameter so that passing an options
     * literal (e.g. `new FileField({ accept: ".png" })`) cannot narrow `TOptions`
     * to that literal — which would type the instance as `FileField<{ accept:
     * ".png" }>` and fail the weak-type assignability check when it is later used
     * as a base `Component` (e.g. `container.addComponent(field)`). `TOptions`
     * stays at its `FileFieldOptions` default.
     */
    constructor(options?: FileFieldOptions) {
        super({ ...(options ?? {}) } as TOptions);

        this.setLayoutManager(new HBox());

        this._button = new Button(this.defaultButtonText());
        this._button.on("action", () => this.openPicker());

        this._label = new Text(NO_FILE_LABEL, { truncate: true });
        this._label.setForegroundColor("var(--ts-ui-form-text, inherit)");

        this._input = new HiddenFileInput();
        Event.addListener(this._input, "change", () => this.onNativeChange());

        super.addComponent(this._button);
        // The label is the flexible cell: the button keeps its preferred width
        // while the label absorbs the remaining row width and truncates a long
        // filename, instead of both shrinking proportionally and clipping the
        // button's own text.
        super.addComponent(this._label, { weight: 1 });
        super.addComponent(this._input);

        if (this._options.multiple !== undefined) {
            this.setMultiple(this._options.multiple);
        }

        if (this._options.accept !== undefined) {
            this.setAccept(this._options.accept);
        }

        if (this._options.buttonText !== undefined) {
            this._button.setText(this._options.buttonText);
        }

        if (this._options.enabled !== undefined) {
            this.applyEnabled(this._options.enabled);
        }

        if (this._options.readOnly !== undefined) {
            this.applyReadOnly(this._options.readOnly);
        }

        // Establishes the clean baseline for dirty-state tracking — see AbstractInput.markClean().
        this.markClean();
    }

    /**
     * Caches the {@link FileFieldOptions} fields on `_options` so the
     * constructor body can dispatch them once the children exist. The setters
     * are intentionally not dispatched here (the children aren't built yet
     * during `super()`), matching the [`AbstractInput`](/api/component/input/classes/AbstractInput)
     * cascade rule.
     *
     * @param options - The options bag carrying the values to apply.
     *
     * @returns This component, for method chaining.
     */
    protected applyOptions(options: TOptions): this {
        super.applyOptions(options);

        if (options.multiple   !== undefined) this._options.multiple   = options.multiple;
        if (options.accept     !== undefined) this._options.accept     = options.accept;
        if (options.buttonText !== undefined) this._options.buttonText = options.buttonText;

        return this;
    }

    /**
     * The trigger label used when the caller supplies none, pluralised per the
     * `multiple` flag.
     *
     * @returns "Choose files…" when multi-select is on, else "Choose file…".
     */
    private defaultButtonText(): string {
        return this.isMultiple() ? "Choose files…" : "Choose file…";
    }

    /**
     * Opens the OS file picker. Bound as the trigger button's `action` handler.
     */
    private openPicker(): void {
        if (!this.isEnabled() || this.isReadOnly()) {
            return;
        }

        this._input.openPicker();
    }

    /**
     * Reads the native `FileList` on every native `change`, supersedes any stale
     * drop cache, relabels, and fans the new value out. Bound as the hidden
     * input's `change` handler.
     */
    private onNativeChange(): void {
        this._droppedFiles = [];

        const files = this.getValue();

        this.updateLabel(files);
        this.notifyChange(files);
    }

    /**
     * Stores a `FileList` dropped onto a [`FileDropZone`](/api/component/input/classes/FileDropZone)
     * as this field's live value, relabels, and notifies. The browser cannot
     * push these into the hidden `<input>`, so they are held in the drop cache
     * and returned by {@link getValue} until the next native `change`.
     *
     * Package-internal: called only by `FileDropZone` via the `_FileField`
     * export. Not part of the public consumer surface.
     *
     * @param files - The dropped `FileList`.
     */
    acceptDroppedFiles(files: FileList): void {
        this._droppedFiles = Array.from(files);

        const value = this.getValue();

        this.updateLabel(value);
        this.notifyChange(value);
    }

    /**
     * Returns the currently selected files: the drop cache when populated,
     * otherwise the live native `FileList`. Satisfies
     * [`Bindable`](/api/core/interfaces/Bindable)'s read side.
     *
     * @returns The selected files (possibly empty).
     */
    getValue(): File[] {
        if (this._droppedFiles.length > 0) {
            return this._droppedFiles;
        }

        const files = this._input.getFiles();

        return files ? Array.from(files) : [];
    }

    /**
     * Clears the selection when given an empty array; otherwise a no-op plus one
     * `console.warn`. See the class remarks for why the write contract is
     * clear-only (the browser security model forbids populating a file input).
     *
     * @param value - An empty array to clear; a non-empty array is rejected.
     *
     * @returns This component, for method chaining.
     */
    setValue(value: File[]): this {
        if (value && value.length > 0) {
            console.warn(
                "FileField '" + this.getId() + "' setValue ignored a non-empty File[]: the browser "
                + "security model forbids programmatically populating a file input. Only setValue([]) "
                + "(clearing) is supported.",
            );

            return this;
        }

        return this.clearValue();
    }

    /**
     * Clears the native selection and the drop cache, relabels, and notifies.
     * Convenience alias matching the
     * [`Toggle.clearValue()`](/api/component/input/classes/Toggle#clearvalue)
     * convention.
     *
     * @returns This component, for method chaining.
     */
    clearValue(): this {
        this._droppedFiles = [];
        this._input.clearFiles();

        const value = this.getValue();

        this.updateLabel(value);
        this.notifyChange(value);

        return this;
    }

    /**
     * Returns whether multi-file selection is enabled.
     *
     * @returns `true` when the native `multiple` attribute is set.
     */
    isMultiple(): boolean {
        return this._options.multiple ?? false;
    }

    /**
     * Toggles multi-file selection (the native `multiple` attribute). When the
     * caller never set an explicit button label, the default label re-pluralises
     * to match.
     *
     * @param value - `true` to allow selecting more than one file.
     *
     * @returns This component, for method chaining.
     */
    setMultiple(value: boolean): this {
        this._options.multiple = !!value;
        this._input.setMultipleAttribute(this._options.multiple);

        if (this._options.buttonText === undefined) {
            this._button.setText(this.defaultButtonText());
        }

        return this;
    }

    /**
     * Returns the native `accept` filter, or `null` when unset.
     *
     * @returns The `accept` token list, or `null`.
     */
    getAccept(): string | null {
        return this._options.accept ?? null;
    }

    /**
     * Sets the native `accept` attribute — the OS picker's type filter (it does
     * not validate drag-dropped files).
     *
     * @param value - A comma-separated `accept` token list, e.g. `".csv,image/*"`.
     *
     * @returns This component, for method chaining.
     */
    setAccept(value: string): this {
        this._options.accept = value;
        this._input.setAcceptAttribute(value);

        return this;
    }

    /**
     * Reflects the filename label for the current selection: the empty-state
     * text, the single file name, the joined names, or a "N files" summary past
     * {@link FILENAME_JOIN_LIMIT}.
     */
    private updateLabel(files: File[]): void {
        if (files.length === 0) {
            this._label.setText(NO_FILE_LABEL);
        } else if (files.length === 1) {
            this._label.setText(files[0].name);
        } else if (files.length > FILENAME_JOIN_LIMIT) {
            this._label.setText(files.length + " files");
        } else {
            this._label.setText(files.map(f => f.name).join(", "));
        }
    }

    /**
     * Reflects the enabled flag on the trigger button and the hidden input.
     */
    protected applyEnabled(value: boolean): void {
        this._button.setEnabled(value);
        this._input.setDisabled(!value);
    }

    /**
     * Reflects the read-only flag. A read-only field stays mounted but refuses
     * to open the picker (guarded in {@link openPicker}); the trigger button is
     * disabled so it reads as inert.
     */
    protected applyReadOnly(value: boolean): void {
        this._button.setEnabled(!value && this.isEnabled());
        this.getAria().setReadOnly(value);
    }
}

const FileFieldCallable = callable(FileField);
type FileFieldCallable<TOptions extends FileFieldOptions = FileFieldOptions> = FileField<TOptions>;
export {
    FileField         as _FileField,
    FileFieldCallable as FileField,
};
