# Canvas

[`Canvas`](/api/component/display/classes/Canvas) is a raster drawing surface backed by a `<canvas>` element and a live `CanvasRenderingContext2D`. You draw through an `onDraw` hook (in CSS pixels — the device-pixel-ratio transform is applied for you), and the component re-emits your drawing after every resize or DPI change so it stays crisp.

## Usage

```typescript
import { Canvas } from '@jimka/typescript-ui/component/display';

const chart = Canvas({
    preferredSize: { width: 240, height: 120 },
    onDraw: (ctx, width, height) => {
        ctx.fillStyle = 'rgb(21, 101, 192)';
        ctx.beginPath();
        ctx.arc(width / 2, height / 2, 30, 0, Math.PI * 2);
        ctx.fill();
    },
});

panel.addComponent(chart);
```

For an ongoing animation, start a per-frame redraw loop:

```typescript
let phase = 0;

chart.setOnDraw((ctx, width, height) => {
    phase += 0.1;
    ctx.clearRect(0, 0, width, height);
    ctx.fillRect(width / 2 + Math.sin(phase) * 20, height / 2, 10, 10);
});
chart.startAnimation();
// …later
chart.stopAnimation();
```

## Common methods

| Method | Purpose |
| --- | --- |
| `setOnDraw(handler)` | Set (or clear with `null`) the draw hook, then redraw immediately. |
| `getOnDraw()` | The current draw hook, or `null`. |
| `redraw()` | Clear the surface (in CSS px) and re-invoke `onDraw` — force a repaint after mutating your own model. |
| `getContext()` | The `CanvasRenderingContext2D` for one-off imperative drawing, or `null` offline / before first render. |
| `startAnimation()` / `stopAnimation()` / `isAnimating()` | Drive (or halt) a per-frame redraw loop. |
| `setPreferredSize(w, h)` | Give the surface a size (inherited from `Component`). |

## Notes

- **Draw in CSS pixels.** The context is pre-scaled by the device-pixel ratio, so one unit is one CSS pixel and your drawing stays sharp on HiDPI displays with no manual scaling.
- **`onDraw` survives resizes.** Reassigning the backing store on a resize (or DPI change) wipes it, so the component re-runs `onDraw` on the freshly-sized surface. Anything that must survive a resize belongs in `onDraw`; content drawn directly through `getContext()` is your responsibility to re-emit.
- **Live-only.** A rendering context cannot be modelled offline or forwarded across a worker, so `getContext()` returns `null` and every draw path no-ops in a non-browser (SSR / test) environment. There is no offline raster output.
- **No intrinsic size.** Unlike [`Image`](/components/Image), a canvas reports no natural size — give it a `preferredSize` or a stretching parent, or it collapses to `0 × 0` and draws nothing.

## See also

- [API: Canvas](/api/component/display/classes/Canvas)
- [`Image`](/components/Image) — for a static bitmap from a URL
