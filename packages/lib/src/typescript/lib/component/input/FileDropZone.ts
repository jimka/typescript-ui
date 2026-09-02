// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractInput } from "~/component/input/AbstractInput.js";
import { Event } from "~/core/Event.js";
import { FileFieldOptions, _FileField } from "~/component/input/FileField.js";
import { Text } from "~/component/input/Text.js";
import { VBox } from "~/layout/VBox.js";
import { callable } from "~/core/Callable.js";

// Resting and active border / background, driven by the per-control
// `--ts-ui-filedropzone-*` tokens. Kept as module consts so `setActive` swaps
// the whole pair atomically rather than re-deriving strings per drag event.
const RESTING_BORDER = "var(--ts-ui-filedropzone-border, 2px dashed rgba(80, 140, 240, 0.40))";
const RESTING_BG     = "var(--ts-ui-filedropzone-bg, rgba(80, 140, 240, 0.06))";
const ACTIVE_BORDER  = "var(--ts-ui-filedropzone-active-border, 2px dashed rgba(80, 140, 240, 0.80))";
const ACTIVE_BG      = "var(--ts-ui-filedropzone-active-bg, rgba(80, 140, 240, 0.18))";

// Default instructional text shown inside the zone when the caller supplies none.
const DEFAULT_PROMPT = "Drop files here or click to browse";

/**
 * Construction-time options for {@link FileDropZone}.
 *
 * @category Components
 */
export interface FileDropZoneOptions extends FileFieldOptions {
    /** Instructional text shown inside the zone. Default "Drop files here or click to browse". */
    promptText?: string;
}

/**
 * A bordered drag-and-drop surface that *composes* a
 * [`FileField`](/api/component/input/classes/FileField) and additionally accepts
 * OS file drops through the HTML5 `DataTransfer.files` API. Implements
 * [`Bindable<File[]>`](/api/core/interfaces/Bindable) by delegating its value to
 * the inner field and re-emitting the field's `change` / `binding` events.
 *
 * @remarks OS file drops arrive as real HTML5 `dragover` / `drop` DOM events and
 * are wired through {@link Event.addSubtreeListener} — deliberately *not* the
 * framework's internal pointer-based component-drag system, which never sees a
 * `DataTransfer`. The native `accept` filter on the inner field constrains the
 * OS picker only; dropped files are not type-validated (out of scope). The same
 * clear-only write contract as `FileField` applies — see its remarks.
 *
 * @category Components
 */
class FileDropZone<TOptions extends FileDropZoneOptions = FileDropZoneOptions>
    extends AbstractInput<File[], TOptions>
{
    private _prompt: Text;
    private _field:  _FileField;

    // Nesting depth of active OS drags over this zone. `dragenter` / `dragleave`
    // fire per child element as the cursor crosses the composed field's button
    // and label, so a single boolean would strobe the highlight; counting
    // enter/leave pairs keeps the active state stable until the cursor truly
    // leaves the zone (depth returns to 0).
    private _dragDepth: number = 0;

    /**
     * Constructs a FileDropZone.
     *
     * @param options - Optional construction-time options.
     *
     * @remarks The parameter is typed as the concrete {@link FileDropZoneOptions}
     * rather than the class's `TOptions` parameter so that passing an options
     * literal (e.g. `new FileDropZone({ accept: ".png" })`) cannot narrow
     * `TOptions` to that literal — which would type the instance as
     * `FileDropZone<{ accept: ".png" }>` and fail the weak-type assignability
     * check when it is later used as a base `Component` (e.g.
     * `container.addComponent(zone)`). `TOptions` stays at its
     * `FileDropZoneOptions` default.
     */
    constructor(options?: FileDropZoneOptions) {
        super({ ...(options ?? {}) } as TOptions);

        this.setLayoutManager(new VBox());

        this._prompt = new Text(this._options.promptText ?? DEFAULT_PROMPT);
        this._prompt.setForegroundColor("var(--ts-ui-form-text, inherit)");

        this._field = new _FileField(this.fieldOptions());
        this._field.on("change", (value: File[]) => this.notifyChange(value));

        super.addComponent(this._prompt);
        super.addComponent(this._field);

        this.setActive(false);
        this.setBorderRadius("var(--ts-ui-border-radius, 4px)");

        Event.addSubtreeListener(this, "dragenter", { prevent: true, handler: this.onDragEnter });
        Event.addSubtreeListener(this, "dragover",  { prevent: true, handler: this.onDragOver });
        Event.addSubtreeListener(this, "dragleave", { prevent: true, handler: this.onDragLeave });
        Event.addSubtreeListener(this, "drop",      { prevent: true, handler: this.onDrop });

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
     * Caches the {@link FileDropZoneOptions} fields on `_options` so the
     * constructor body can read them after `super()`.
     *
     * @param options - The options bag carrying the values to apply.
     *
     * @returns This component, for method chaining.
     */
    protected applyOptions(options: TOptions): this {
        super.applyOptions(options);

        if (options.promptText !== undefined) this._options.promptText = options.promptText;

        return this;
    }

    /**
     * Builds the option bag forwarded to the composed inner field — the
     * file-selection fields (`multiple` / `accept` / `buttonText`) pass through;
     * the zone-only `promptText` does not.
     *
     * @returns The inner [`FileField`](/api/component/input/classes/FileField) options.
     */
    private fieldOptions(): FileFieldOptions {
        return {
            multiple:   this._options.multiple,
            accept:     this._options.accept,
            buttonText: this._options.buttonText,
        };
    }

    /**
     * Swaps the resting / active border + background pair. Active is the wash
     * shown while a valid OS file drag hovers.
     *
     * @param active - `true` for the hovering-drag state, `false` for resting.
     */
    private setActive(active: boolean): void {
        this.setBorder(active ? ACTIVE_BORDER : RESTING_BORDER);
        this.setBackgroundColor(active ? ACTIVE_BG : RESTING_BG);
    }

    /**
     * Increments the drag-depth counter and lights the zone on the first enter.
     * Bound as the subtree `dragenter` handler; `preventDefault` is applied by
     * the registration's `prevent: true` floor, not returned here.
     */
    private onDragEnter(_e: DragEvent): void {
        this._dragDepth++;

        if (this._dragDepth === 1) {
            this.setActive(true);
        }
    }

    /**
     * Signals a valid drop target. The `FileList` is only populated on
     * `drop`, so nothing is read here; `preventDefault` is applied by the
     * registration's `prevent: true` floor. Bound as the subtree `dragover`
     * handler.
     */
    private onDragOver(_e: DragEvent): void {
    }

    /**
     * Decrements the drag-depth counter and dims the zone once the cursor truly
     * leaves (depth back to 0). Bound as the subtree `dragleave` handler;
     * `preventDefault` is applied by the registration's `prevent: true` floor.
     */
    private onDragLeave(_e: DragEvent): void {
        this._dragDepth = Math.max(0, this._dragDepth - 1);

        if (this._dragDepth === 0) {
            this.setActive(false);
        }
    }

    /**
     * Accepts the dropped `FileList`, resets the highlight, and hands the files
     * to the inner field so one code path owns formatting + notify. Bound as the
     * subtree `drop` handler; `preventDefault` is applied by the registration's
     * `prevent: true` floor.
     */
    private onDrop(e: DragEvent): void {
        this._dragDepth = 0;
        this.setActive(false);

        if (!this.isEnabled() || this.isReadOnly()) {
            return;
        }

        const files = e.dataTransfer?.files;

        if (!files || files.length === 0) {
            return;
        }

        this._field.acceptDroppedFiles(files);
    }

    /**
     * Returns the selected files, delegating to the inner field.
     *
     * @returns The selected files (possibly empty).
     */
    getValue(): File[] {
        return this._field.getValue();
    }

    /**
     * Delegates to the inner field's clear-only {@link _FileField.setValue}.
     *
     * @param value - An empty array to clear; a non-empty array is rejected.
     *
     * @returns This component, for method chaining.
     */
    setValue(value: File[]): this {
        this._field.setValue(value);

        return this;
    }

    /**
     * Clears the selection, delegating to the inner field's `clearValue`.
     *
     * @returns This component, for method chaining.
     */
    clearValue(): this {
        this._field.clearValue();

        return this;
    }

    /**
     * Reflects the enabled flag on the inner field.
     */
    protected applyEnabled(value: boolean): void {
        this._field.setEnabled(value);
    }

    /**
     * Reflects the read-only flag on the inner field.
     */
    protected applyReadOnly(value: boolean): void {
        this._field.setReadOnly(value);
    }
}

const FileDropZoneCallable = callable(FileDropZone);
type FileDropZoneCallable<TOptions extends FileDropZoneOptions = FileDropZoneOptions> = FileDropZone<TOptions>;
export {
    FileDropZone         as _FileDropZone,
    FileDropZoneCallable as FileDropZone,
};
