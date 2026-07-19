# FileField

[`FileField`](/api/component/input/classes/FileField) is a file-selection control: a styled trigger [`Button`](/api/component/button/classes/Button) that opens the OS file picker, plus a label showing the chosen filename(s). It wraps a hidden native `<input type="file">` and implements [`Bindable<File[]>`](/api/core/interfaces/Bindable), so it can participate in a [`Binding`](/data/binding).

## Usage

```typescript
import { FileField } from '@jimka/typescript-ui/component/input';
const attachment = FileField({ accept: '.csv,.json', multiple: true });

attachment.on("change", files => {
    console.log('selected', files.length, 'file(s)');
});

panel.addComponent(attachment);
```

## Common methods

| Method | Purpose |
| --- | --- |
| `getValue()` | The live `File[]` — the picked native `FileList`, or files handed in by a [`FileDropZone`](/components/FileDropZone). |
| `setValue(File[])` | **Clear-only.** `setValue([])` clears; a non-empty array is a no-op plus one `console.warn` (see below). |
| `clearValue()` | Convenience reset to no selection. |
| `isMultiple()` / `setMultiple(boolean)` | Read / write the native `multiple` attribute. |
| `getAccept()` / `setAccept(string)` | Read / write the native `accept` filter (e.g. `".csv,image/*"`). |
| `isEnabled()` / `setEnabled(boolean)` | Toggle interactivity. |
| `isReadOnly()` / `setReadOnly(boolean)` | Disables the trigger; the field stays mounted but won't open the picker. |
| `on("change", fn)` / `off("change", fn)` | Subscribe to value changes. |
| `on("binding", fn)` | Used by [`Binding`](/data/binding). |

## The `setValue` security-model limitation

Browsers forbid programmatically assigning a non-empty `FileList` to `<input type="file">.files` — only a real user gesture may populate it. `FileField` therefore honours its `Bindable` write contract only for the empty case:

- `setValue([])` (or any empty array) clears the native input and resets the label. Fully supported.
- `setValue([...files])` with a non-empty array **cannot** push those files into the native control. It is a no-op plus a single `console.warn`, and it never throws — so a record load through [`Binding`](/api/core/classes/Binding) stays side-effect-tolerant.

`getValue()` always returns the live selection, so the *read* side of the binding contract is complete. A bound `FileField` round-trips reads (user picks files → record updated) but cannot be re-populated from a stored value. This matches how every web file input behaves and suits upload-style fields rather than persisted file blobs.

## Notes

- The filename label shows the empty-state text, the single file name, the joined names, or a `"N files"` summary once more than three files are selected.
- The trigger label defaults to "Choose file…" / "Choose files…" per `multiple`; override it with `buttonText`.

## See also

- [API: FileField](/api/component/input/classes/FileField)
- [`FileDropZone`](/components/FileDropZone) — drag-and-drop surface that composes a `FileField`
- [Data binding](/data/binding)
