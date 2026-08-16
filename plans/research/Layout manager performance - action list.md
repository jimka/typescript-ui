# Layout manager performance — action list

## Do first: measure

Right now "UI stalls" can't distinguish four different problems. Two cheap ways to split it:

* *LoAF observer* in production — if 'script ≈ 0' and 'styleLayout' eats the frame, it's recalc/layout. If both are small on a long frame, it's paint/raster/composite by elimination.
* *DevTools → Rendering → Paint flashing + Layer borders*, then scroll. Whole body flashing = paint problem, scroller isn't compositing. Small regions = paint is fine, look at recalc.

One diagnostic that costs nothing: *scroll with the mouse stationary* (keyboard or programmatic). If it smooths out, you have hover invalidation on top of your scroll path — separate fix from everything below.

## Containment — the foundation

Your case is the rare one where the strongest form is safe, because the layout manager already knows every box.

'''
css
.panel { position: absolute; contain: strict; }
.row   { height: 30px; contain: strict; }
'''

* Panels become layout islands: teardown of one can't reflow the other eleven, and contents stop propagating overflow up.
* Rows: recycling one can't invalidate its siblings.
* Check that panel contents aren't escaping to an outer containing block — 'contain: layout' closes that unconditionally.
* Caveat: contained panels become containing blocks for fixed-position descendants and get their own stacking context. Tooltips and menus can no longer escape — use the Popover API or '<dialog>' to reach the top layer.

##Scrolling

In order of likely payoff:

1. *Don't drive scroll from JS*. A 'wheel/scroll' handler computing a translate means every frame is a main-thread round trip and you're a frame behind input. Native 'overflow: auto' scrolls on the compositor even when the main thread is busy.
2. *Keep the transformed element viewport-sized*. Translating a 3M-pixel-tall container forces tiled raster every frame. Translate a small live-row window by 'scrollTop - firstVisibleRowOffset' instead.
3. *Smooth the recycle bursts* — periodic rather than constant stalls means this. Skip DOM writes when values are unchanged, never touch className if the class set matches, recycle in smaller more frequent batches, and use a fixed node pool so computed styles are reused rather than resolved fresh.
4. *Round transforms to device pixels* (Math.round(x * dpr) / dpr) — fractional offsets re-rasterize text every frame.

## Recalc / paint
* *Kill per-cell hover and* ':nth-child'. A ':hover' rule in a 3,000-cell grid invalidates on every 'mousemove'; zebra striping via ':nth-child' makes recycling O(rows). Replace both with one absolutely-positioned overlay div for hover/selection/focus, and a 'repeating-linear-gradient' for stripes.
* *Shrink invalidation scope*. '.grid.dragging' '.cell' re-matches every descendant on one class toggle. Push state classes to the smallest element that needs them; same for custom properties on containers.
* *Shadow DOM per table panel* — this is where it genuinely pays. Thousands of live cells matched against your whole global stylesheet is exactly the case it was built for. Use 'adoptedStyleSheets', not inline '<style>'.
* *Paint complexity*: per-cell 'border'/'box-shadow'/'border-radius' are expensive at scale. One background gradient on the container draws all the grid rules in a single op.

## Teardown
* *Detach the root once*. 'root.remove()' is one mutation; walking children is N. Do it synchronously so the UI updates, then do bookkeeping on the detached tree where mutations are free.
* '*AbortController*' for all listeners — one 'abort()' instead of per-node removal.
* '*observer.disconnect()*' *up front*, before any removal. Unobserving during mutation can fire ResizeObserver callbacks mid-teardown that force sync layout.
* 'No geometry reads in destructors'. Every 'getBoundingClientRect' after a mutation is a forced sync layout, one per component. Your layout manager already knows the boxes — don't ask the DOM.
* 'Pool row elements' across panel lifetimes if you tear down many panels at once; the aggregate node count can trigger a major GC right after.

## Don't destroy when you can hide

For tabs and collapsed panels:

'''
css
.hidden-panel { content-visibility: hidden; }
'''

Zero style/layout/paint cost while hidden, but unlike 'display: none' it preserves the subtree's rendering state, so reshowing skips the rebuild. If your teardown stalls correlate with tab switching rather than real closes, this deletes the problem rather than optimizing it.

## Drag and resize

'transform' during the gesture, commit to 'top'/'left' on drop. Add 'will-change: transform' on gesture start and *remove it on end* — a permanent layer per panel costs width × height × 4 bytes of GPU memory, and a dozen full-size layers hurt more than the reflows you avoided.

## Suggested order

1. LoAF + paint flashing — 20 minutes, tells you which half of the list matters
2. 'contain: strict' on panels and rows — biggest structural win, low risk
3. 'content-visibility: hidden' for tabbed-out panels
4. Overlay div for hover/selection; gradient for stripes
5. Teardown: single detach + AbortController + no geometry reads
6. Verify the scroll container is viewport-sized, not full-height
7. Shadow roots on table panels with 'adoptedStyleSheets'

## The escape hatch

If you exhaust the DOM path, the endgame for large grids is rendering the table body to canvas and keeping DOM only for the focused cell and overlays — that's the Glide Data Grid approach. It sidesteps style, layout, and paint entirely, but it's substantial work and you lose accessibility unless you maintain a parallel a11y tree. Worth knowing it exists; not worth reaching for until items 1–7 are done.

