# ProgressBar

[`ProgressBar`](/api/classes/ProgressBar) is a horizontal progress indicator with two modes:

- **Determinate** — `value` in `[0, 100]` controls the fill width.
- **Indeterminate** — a sliding fill segment animates continuously, suitable for
  unknown-duration work.

## Usage

```typescript
import { ProgressBar } from '@jimka/typescript-ui';

const progress = new ProgressBar(0);
progress.setPreferredSize(300, 12);
panel.addComponent(progress);

let v = 0;
const handle = setInterval(() => {
    v += 5;
    progress.setValue(v);
    if (v >= 100) {
        clearInterval(handle);
    }
}, 100);
```

Switch to indeterminate mode for unknown-duration work:

```typescript
progress.setIndeterminate(true);
// later, when the work completes:
progress.setIndeterminate(false);
progress.setValue(100);
```

## Common methods

| Method | Purpose |
| --- | --- |
| `getValue()` / `setValue(n)` | Read / write the percentage (clamped to `[0, 100]`). |
| `isIndeterminate()` / `setIndeterminate(v)` | Toggle the animated mode. |

## Theming

| Token | Default | Dark |
| --- | --- | --- |
| `progressBar.track.background`  | `rgb(220, 220, 220)` | `rgb(55, 55, 55)`  |
| `progressBar.track.borderRadius`| `4px`                | `4px`              |
| `progressBar.fill.background`   | `rgb(30, 100, 200)`  | `rgb(60, 130, 220)`|
| `progressBar.indeterminate.background` | `rgb(30, 100, 200)` | `rgb(60, 130, 220)` |

## See also

- [API: ProgressBar](/api/classes/ProgressBar)
- [`ProgressSpinner`](/components/ProgressSpinner) — a circular alternative
- [Theming](/concepts/theming)
