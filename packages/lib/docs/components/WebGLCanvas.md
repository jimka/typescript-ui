# WebGLCanvas

[`WebGLCanvas`](/api/component/display/classes/WebGLCanvas) is a GPU drawing surface backed by a `<canvas>` element and a live `WebGL2RenderingContext`. You build GPU resources in an `onContextInit` hook and draw each frame in an `onFrame` hook; the component owns the canvas, the context, the render loop, and context-loss recovery, keeping the backing store crisp on HiDPI and across resizes.

## Usage

```typescript
import { WebGLCanvas } from '@jimka/typescript-ui/component/display';

const surface = WebGLCanvas({
    preferredSize: { width: 240, height: 120 },
    onContextInit: (gl) => {
        // Build shaders, programs, buffers, VAOs, textures here.
        gl.clearColor(0.08, 0.4, 0.75, 1);
    },
    onFrame: (gl, width, height) => {
        gl.clear(gl.COLOR_BUFFER_BIT);
        // Issue draw calls; the viewport is already set in device pixels.
    },
});

panel.addComponent(surface);
```

The render loop starts automatically once the component is mounted and laid out, and pauses automatically while the surface is not effectively on-screen (e.g. on an inactive `Tab` panel) — resuming once it's shown again. Drive a static or on-demand surface explicitly:

```typescript
surface.stopAnimation();   // pause the per-frame loop
surface.startAnimation();  // resume it
```

## Common methods

| Method | Purpose |
| --- | --- |
| `setOnContextInit(handler)` | Set (or clear with `null`) the GL-resource build hook; it reruns on the next frame. |
| `getOnContextInit()` | The current context-init hook, or `null`. |
| `setOnFrame(handler)` | Set (or clear with `null`) the per-frame draw hook. |
| `getOnFrame()` | The current frame hook, or `null`. |
| `getContext()` | The `WebGL2RenderingContext` for direct access, or `null` offline / before first render. |
| `startAnimation()` / `stopAnimation()` / `isAnimating()` | Drive (or halt) the per-frame render loop. |
| `setAnimateWhenHidden(bool)` / `getAnimateWhenHidden()` | Keep the loop running while the surface is not effectively on-screen (default `false`). |
| `setPreferredSize(size)` | Give the surface a size (inherited from `Component`). |

## Notes

- **WebGL2 only.** The context is acquired as `"webgl2"`; there is no WebGL1 fallback.
- **Build GPU resources in `onContextInit`.** It runs once on first context acquisition and again after every context restore, so anything the GPU dropped (shaders, programs, buffers, textures) is rebuilt on recovery.
- **Draw in `onFrame`.** The drawing-buffer viewport is already set in device pixels; the hook receives the logical (CSS-px) size for projection math. Resizing the surface resizes the drawing buffer and refreshes the viewport, but does **not** rebuild GL resources.
- **Live-only.** A GL context cannot be modelled offline or forwarded across a worker, so `getContext()` returns `null` and every render path no-ops in a non-browser (SSR / test) environment.
- **No intrinsic size.** Like [`Canvas`](/components/Canvas), a WebGL surface reports no natural size — give it a `preferredSize` or a stretching parent, or it collapses to `0 × 0` and draws nothing.
- **The loop pauses while hidden.** By default, the render loop keeps running only while the surface is effectively on-screen — a surface hidden by an ancestor's `setVisible(false)` (e.g. on an inactive `Tab` panel) auto-pauses, and resumes once shown again. Pass `animateWhenHidden: true` to keep animating regardless.

## See also

- [API: WebGLCanvas](/api/component/display/classes/WebGLCanvas)
- [`Canvas`](/components/Canvas) — for a 2D raster surface
