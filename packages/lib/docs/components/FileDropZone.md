# FileDropZone

[`FileDropZone`](/api/component/input/classes/FileDropZone) is a bordered drag-and-drop surface that *composes* a [`FileField`](/components/FileField) and additionally accepts files dropped from the OS. It implements [`Bindable<File[]>`](/api/core/interfaces/Bindable) by delegating its value to the inner field and re-emitting that field's `change` / `binding` events, so a single `FileDropZone` is a drop-in form input.

## Usage

```typescript
import { FileDropZone } from '@jimka/typescript-ui/component/input';
const upload = FileDropZone({ accept: 'image/*', multiple: true, promptText: 'Drop images here' });

upload.on("change", files => {
    console.log('received', files.length, 'image(s)');
});

panel.addComponent(upload);
```

## Common methods

| Method | Purpose |
| --- | --- |
| `getValue()` | The selected `File[]`, delegated to the inner [`FileField`](/components/FileField). |
| `setValue(File[])` | **Clear-only** (delegates to the inner field) — see the limitation below. |
| `clearValue()` | Convenience reset to no selection. |
| `isEnabled()` / `setEnabled(boolean)` | Toggle interactivity. |
| `isReadOnly()` / `setReadOnly(boolean)` | Read-only refuses both picker clicks and drops. |
| `on("change", fn)` / `off("change", fn)` | Subscribe to value changes (picked or dropped). |
| `on("binding", fn)` | Used by [`Binding`](/data/binding). |

## How OS file drops work

Dropped files arrive as real HTML5 `dragover` / `drop` DOM events carrying a `DataTransfer.files` list — a different mechanism from the framework's internal pointer-based component drag-and-drop, which never sees a `DataTransfer`. The zone highlights on `dragover`, reverts on `dragleave`, and on `drop` hands the dropped `FileList` to the inner `FileField`. Because the browser cannot push dropped files into a native `<input type="file">`, the field holds them as its live value until the next pick.

## The `setValue` security-model limitation

Like [`FileField`](/components/FileField), the write side is **clear-only**: `setValue([])` clears, while a non-empty array is a no-op plus one `console.warn`. The browser forbids programmatically populating a file input outside a user gesture. `getValue()` always returns the live selection.

## Notes

- The `accept` filter constrains the OS *picker* only; it does **not** validate the type of drag-dropped files (out of scope for this control).
- Themed through the per-control `--ts-ui-filedropzone-bg`, `--ts-ui-filedropzone-border`, `--ts-ui-filedropzone-active-bg`, and `--ts-ui-filedropzone-active-border` tokens — deliberately separate from the internal-drag `--ts-ui-drag-dropzone-*` family.

## See also

- [API: FileDropZone](/api/component/input/classes/FileDropZone)
- [`FileField`](/components/FileField) — the composed trigger-button core
- [Data binding](/data/binding)
