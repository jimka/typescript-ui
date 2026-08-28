import { describe, it, expect, afterEach, vi, type Mock } from 'vitest';
import { LayerManager, DismissableLayer, LayerDismissMode } from '~/core/LayerManager';
import { DOM, type Handle } from '~/core/DOM';
import { installTestDOM, makeEvent } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// A `DismissableLayer` stub: plain functions so the manager's tree / stack /
// z-stamp / activation logic is exercised without dragging in a concrete
// overlay. `getLayerElement` returns a freshly minted handle (or null) and the
// optional hooks are `vi.fn()`s so callback invocation can be asserted.
interface FakeLayer extends DismissableLayer {
    onActivate:      Mock<(active: boolean) => void>;
    onZIndexChanged: Mock<(zIndex: number) => void>;
    requestClose:    Mock<() => void>;
}

interface FakeLayerOpts {
    dismissMode?: LayerDismissMode;
    band?:        number;
    isRoot?:      boolean;
    withElement?: boolean;
    anchor?:      Handle | null;
}

// Tracks every layer registered so the draining afterEach can unregister them —
// LayerManager is a module singleton and leaks state between tests otherwise.
const registered: DismissableLayer[] = [];

function fakeLayer(opts: FakeLayerOpts = {}): FakeLayer {
    const el: Handle | null = opts.withElement === false
        ? null
        : DOM.sink.createElement('div');

    const layer: FakeLayer = {
        getLayerElement: () => el,
        getDismissMode:  () => opts.dismissMode ?? 'click-outside',
        requestClose:    vi.fn<() => void>(),
        onActivate:      vi.fn<(active: boolean) => void>(),
        onZIndexChanged: vi.fn<(zIndex: number) => void>(),
    };

    if (opts.band !== undefined) {
        layer.getBand = () => opts.band!;
    }

    if (opts.isRoot !== undefined) {
        layer.isLayerRoot = () => opts.isRoot!;
    }

    if (opts.anchor !== undefined) {
        layer.getAnchorElement = () => opts.anchor!;
    }

    return layer;
}

function register(layer: DismissableLayer): DismissableLayer {
    LayerManager.register(layer);
    registered.push(layer);

    return layer;
}

describe('LayerManager', () => {
    afterEach(() => {
        // Drain in reverse registration order; unregister is idempotent.
        for (let i = registered.length - 1; i >= 0; i--) {
            LayerManager.unregister(registered[i]);
        }

        registered.length = 0;

        DOM.reset();
    });

    describe('register / getTopLayer', () => {
        it('register pushes onto the stack and getTopLayer returns the last registered', () => {
            installTestDOM(CONFIG);

            const a = register(fakeLayer());
            const b = register(fakeLayer());

            expect(LayerManager.getTopLayer()).toBe(b);

            LayerManager.unregister(b);

            expect(LayerManager.getTopLayer()).toBe(a);
        });

        it('getTopLayer returns null when no layer is open', () => {
            installTestDOM(CONFIG);

            expect(LayerManager.getTopLayer()).toBeNull();
        });

        it('a duplicate register is a no-op: top is unchanged and z is not bumped', () => {
            installTestDOM(CONFIG);

            const a = register(fakeLayer());
            const b = register(fakeLayer());

            const bZ = LayerManager.getZIndex(b);

            // Re-register the already-topmost layer.
            LayerManager.register(b);

            expect(LayerManager.getTopLayer()).toBe(b);
            // No double-push: unregistering once fully removes it.
            expect(LayerManager.getZIndex(b)).toBe(bZ);

            LayerManager.unregister(b);

            expect(LayerManager.getTopLayer()).toBe(a);
        });
    });

    describe('z-stamp ordering', () => {
        it('two peers in the same band get ascending z in register order', () => {
            installTestDOM(CONFIG);

            const first  = register(fakeLayer({ band: LayerManager.Band.Dialog, isRoot: true }));
            const second = register(fakeLayer({ band: LayerManager.Band.Dialog, isRoot: true }));

            expect(LayerManager.getZIndex(second)).toBeGreaterThan(LayerManager.getZIndex(first));
        });

        it('a Window-band peer stamps below a Dialog-band peer', () => {
            installTestDOM(CONFIG);

            // Both register as roots so each keeps its own band (a non-root would
            // inherit the current topmost's band).
            const dialog = register(fakeLayer({ band: LayerManager.Band.Dialog, isRoot: true }));
            const window = register(fakeLayer({ band: LayerManager.Band.Window, isRoot: true }));

            expect(LayerManager.getZIndex(window)).toBeLessThan(LayerManager.getZIndex(dialog));
        });
    });

    describe('nested vs root parenting', () => {
        it('a non-root layer inherits the topmost layer band and lands above it', () => {
            installTestDOM(CONFIG);

            // Topmost is a Window-band root; the child omits isLayerRoot so it
            // registers under the window and inherits its band base.
            const opener = register(fakeLayer({ band: LayerManager.Band.Window, isRoot: true }));
            const child  = register(fakeLayer({ band: LayerManager.Band.Dialog }));

            const openerZ = LayerManager.getZIndex(opener);
            const childZ  = LayerManager.getZIndex(child);

            // Inherits the opener's Window band base (ignoring its own Dialog band)
            // and lands above it because it registered later.
            expect(Math.floor(openerZ / 1000)).toBe(Math.floor(childZ / 1000));
            expect(childZ).toBeGreaterThan(openerZ);
        });

        it('an isLayerRoot:true layer registers under its own band, not the topmost', () => {
            installTestDOM(CONFIG);

            register(fakeLayer({ band: LayerManager.Band.Window, isRoot: true }));
            const rootDialog = register(fakeLayer({ band: LayerManager.Band.Dialog, isRoot: true }));

            // Uses its own Dialog band rather than inheriting the Window band.
            expect(LayerManager.getZIndex(rootDialog)).toBeGreaterThanOrEqual(LayerManager.Band.Dialog);
        });
    });

    describe('bringToFront', () => {
        it('re-stamps the layer above its prior z and notifies via onZIndexChanged', () => {
            installTestDOM(CONFIG);

            const a = register(fakeLayer({ band: LayerManager.Band.Window, isRoot: true })) as FakeLayer;
            const b = register(fakeLayer({ band: LayerManager.Band.Window, isRoot: true }));

            const aOldZ = LayerManager.getZIndex(a);

            // b is currently on top (higher z); raise a above it.
            LayerManager.bringToFront(a);

            const aNewZ = LayerManager.getZIndex(a);

            expect(aNewZ).toBeGreaterThan(aOldZ);
            expect(aNewZ).toBeGreaterThan(LayerManager.getZIndex(b));
            expect(a.onZIndexChanged).toHaveBeenCalledWith(aNewZ);
        });

        it('marks the raised layer active and deactivates the previously active one', () => {
            installTestDOM(CONFIG);

            const a = register(fakeLayer({ band: LayerManager.Band.Window, isRoot: true })) as FakeLayer;
            const b = register(fakeLayer({ band: LayerManager.Band.Window, isRoot: true })) as FakeLayer;

            LayerManager.bringToFront(a);
            expect(a.onActivate).toHaveBeenLastCalledWith(true);

            LayerManager.bringToFront(b);
            expect(a.onActivate).toHaveBeenLastCalledWith(false);
            expect(b.onActivate).toHaveBeenLastCalledWith(true);
        });

        it('re-stamps a nested subtree together so the child stays above its opener', () => {
            installTestDOM(CONFIG);

            const opener = register(fakeLayer({ band: LayerManager.Band.Window, isRoot: true })) as FakeLayer;
            const child  = register(fakeLayer({})) as FakeLayer;
            const other  = register(fakeLayer({ band: LayerManager.Band.Window, isRoot: true }));

            // Raise the opener; its child must ascend with it and stay on top.
            LayerManager.bringToFront(opener);

            expect(child.onZIndexChanged).toHaveBeenCalled();
            expect(LayerManager.getZIndex(child)).toBeGreaterThan(LayerManager.getZIndex(opener));
            expect(LayerManager.getZIndex(opener)).toBeGreaterThan(LayerManager.getZIndex(other));
        });

        it('bringToFront on an unregistered layer is a no-op', () => {
            installTestDOM(CONFIG);

            const stray = fakeLayer({ isRoot: true }) as FakeLayer;

            expect(() => LayerManager.bringToFront(stray)).not.toThrow();
            expect(stray.onActivate).not.toHaveBeenCalled();
        });
    });

    describe('setBand', () => {
        it("moves a registered root's stamp into the new band and calls onZIndexChanged", () => {
            installTestDOM(CONFIG);

            const layer  = register(fakeLayer({ band: LayerManager.Band.Window, isRoot: true })) as FakeLayer;
            const before = LayerManager.getZIndex(layer);

            LayerManager.setBand(layer, LayerManager.Band.PinnedWindow);

            const after = LayerManager.getZIndex(layer);

            expect(after).toBeGreaterThanOrEqual(LayerManager.Band.PinnedWindow);
            expect(after).toBeGreaterThan(before);
            expect(layer.onZIndexChanged).toHaveBeenCalledWith(after);
        });

        it('is a no-op for an unregistered layer', () => {
            installTestDOM(CONFIG);

            const stray = fakeLayer({ isRoot: true }) as FakeLayer;

            expect(() => LayerManager.setBand(stray, LayerManager.Band.PinnedWindow)).not.toThrow();
            expect(stray.onZIndexChanged).not.toHaveBeenCalled();
        });

        it('is a no-op when the layer is already in the target band', () => {
            installTestDOM(CONFIG);

            const layer = register(fakeLayer({ band: LayerManager.Band.Window, isRoot: true })) as FakeLayer;

            LayerManager.setBand(layer, LayerManager.Band.Window);

            expect(layer.onZIndexChanged).not.toHaveBeenCalled();
        });

        it('moves a child layer registered under the root into the same new band', () => {
            installTestDOM(CONFIG);

            const root  = register(fakeLayer({ band: LayerManager.Band.Window, isRoot: true })) as FakeLayer;
            const child = register(fakeLayer({})) as FakeLayer;

            LayerManager.setBand(root, LayerManager.Band.PinnedWindow);

            expect(LayerManager.getZIndex(child)).toBeGreaterThanOrEqual(LayerManager.Band.PinnedWindow);
            expect(child.onZIndexChanged).toHaveBeenCalled();
        });

    });

    // A nested (non-root) layer's parent used to be "the layer painting in
    // front" (the highest current z-index), on the theory that a pinned
    // window sitting in front of a later-registered ordinary window should
    // still parent that ordinary window's own dropdowns correctly. That
    // theory was wrong: "paints in front" identifies no relationship at all
    // between a new layer and its actual opener once more than one root band
    // exists — a differently-banded, unrelated peer can paint in front of the
    // layer something was genuinely opened from. `register` instead resolves
    // the opener via the anchor element a dropdown / popover / rebuild-mode
    // menu already tracks for its own outside-click exclusion
    // (`getAnchorElement`), falling back to the last-registered layer — the
    // rule the tree used for every nested layer before `setBand` introduced a
    // second root band — only when there is no anchor to resolve.
    describe('register: nested-layer opener resolution', () => {
        it('a layer whose anchor lives inside a specific window links under that window, not a pinned peer that currently paints in front', () => {
            installTestDOM(CONFIG);

            // Window A is pinned into the higher PinnedWindow band, so it
            // paints in front of Window B even though B registered after it —
            // reproduces the regression: a dropdown opened from inside B must
            // not inherit A's band just because A is frontmost.
            const winA = register(fakeLayer({ band: LayerManager.Band.Window, isRoot: true })) as FakeLayer;
            LayerManager.setBand(winA, LayerManager.Band.PinnedWindow);
            const winB = register(fakeLayer({ band: LayerManager.Band.Window, isRoot: true })) as FakeLayer;

            expect(LayerManager.getZIndex(winA)).toBeGreaterThan(LayerManager.getZIndex(winB));

            // The dropdown's anchor (its opener button) lives inside window
            // B's DOM subtree — a real `appendChild` so `DOM.source.contains`
            // (which climbs recorded parents) finds it there for real; an
            // element created but never parented is where the harness's
            // `contains` genuinely has nothing to climb (see the
            // `containsAcrossLayers` tests above).
            const anchor = DOM.sink.createElement('div');
            const winBEl = winB.getLayerElement()!;
            DOM.sink.appendChild(winBEl, anchor);

            const dropdown = register(fakeLayer({ anchor })) as FakeLayer;

            expect(LayerManager.getZIndex(dropdown)).toBeGreaterThanOrEqual(LayerManager.Band.Window);
            expect(LayerManager.getZIndex(dropdown)).toBeLessThan(LayerManager.Band.PinnedWindow);
            expect(LayerManager.getZIndex(dropdown)).toBeGreaterThan(LayerManager.getZIndex(winB));

            // Direct proof of tree parentage (not just a band coincidence):
            // raising B drags the dropdown up with it; raising A does not.
            LayerManager.bringToFront(winB);
            expect(dropdown.onZIndexChanged).toHaveBeenCalled();

            dropdown.onZIndexChanged.mockClear();
            LayerManager.bringToFront(winA);
            expect(dropdown.onZIndexChanged).not.toHaveBeenCalled();
        });

        it('a layer whose anchor lives inside a window links under that window, not an unrelated root (a drawer) that currently paints in front', () => {
            installTestDOM(CONFIG);

            // The window registers first and is never raised, so a purely
            // frontmost-by-z rule would misidentify the drawer — which
            // declares no band of its own and so defaults to the Dropdown
            // band, above Window — as the dropdown's opener.
            const win    = register(fakeLayer({ band: LayerManager.Band.Window, isRoot: true })) as FakeLayer;
            const drawer = register(fakeLayer({ isRoot: true })) as FakeLayer;

            expect(LayerManager.getZIndex(drawer)).toBeGreaterThan(LayerManager.getZIndex(win));

            const anchor = DOM.sink.createElement('div');
            const winEl  = win.getLayerElement()!;
            DOM.sink.appendChild(winEl, anchor);

            const dropdown = register(fakeLayer({ anchor })) as FakeLayer;

            // Proof of correct parentage: raising the window drags the
            // dropdown up with it; raising the drawer does not.
            LayerManager.bringToFront(win);
            expect(dropdown.onZIndexChanged).toHaveBeenCalled();

            dropdown.onZIndexChanged.mockClear();
            LayerManager.bringToFront(drawer);
            expect(dropdown.onZIndexChanged).not.toHaveBeenCalled();
        });

        it('an anchor-less nested layer falls back to the last-registered layer, not whichever peer currently paints in front', () => {
            installTestDOM(CONFIG);

            // `a` is pinned into the higher PinnedWindow band via setBand, so
            // it outranks `b` (an ordinary Window-band peer registered
            // afterwards) — the frontmost-by-z layer is no longer the
            // last-registered one.
            const a = register(fakeLayer({ band: LayerManager.Band.Window, isRoot: true })) as FakeLayer;
            LayerManager.setBand(a, LayerManager.Band.PinnedWindow);
            const b = register(fakeLayer({ band: LayerManager.Band.Window, isRoot: true })) as FakeLayer;

            expect(LayerManager.getZIndex(a)).toBeGreaterThan(LayerManager.getZIndex(b));

            // A nested layer with no anchor to resolve (e.g. a Dialog)
            // registers next; it falls back to the last-registered layer's
            // (b's) band, not the frontmost layer's (a's).
            const nested = register(fakeLayer({})) as FakeLayer;

            expect(LayerManager.getZIndex(nested)).toBeGreaterThanOrEqual(LayerManager.Band.Window);
            expect(LayerManager.getZIndex(nested)).toBeLessThan(LayerManager.Band.PinnedWindow);
            expect(LayerManager.getZIndex(nested)).toBeGreaterThan(LayerManager.getZIndex(b));

            LayerManager.bringToFront(b);
            expect(nested.onZIndexChanged).toHaveBeenCalled();

            nested.onZIndexChanged.mockClear();
            LayerManager.bringToFront(a);
            expect(nested.onZIndexChanged).not.toHaveBeenCalled();
        });
    });

    describe('unregister', () => {
        it('pops the layer and clears it as active when it was active', () => {
            installTestDOM(CONFIG);

            const a = register(fakeLayer({ band: LayerManager.Band.Window, isRoot: true })) as FakeLayer;
            const b = register(fakeLayer({ band: LayerManager.Band.Window, isRoot: true })) as FakeLayer;

            LayerManager.bringToFront(b);
            expect(b.onActivate).toHaveBeenLastCalledWith(true);

            LayerManager.unregister(b);

            expect(LayerManager.getTopLayer()).toBe(a);
            // Raising a again must activate it (b is gone, not still active).
            LayerManager.bringToFront(a);
            expect(a.onActivate).toHaveBeenLastCalledWith(true);
        });

        it('unregister of an unregistered layer is a no-op', () => {
            installTestDOM(CONFIG);

            const stray = fakeLayer();

            expect(() => LayerManager.unregister(stray)).not.toThrow();
        });
    });

    describe('containsAcrossLayers', () => {
        it('returns false offline because the modelled source has no DOM tree', () => {
            installTestDOM(CONFIG);

            const a = register(fakeLayer());
            const probe = DOM.sink.createElement('span');

            // contains() is always false in the modelled source, so containment
            // across the portal tree is structurally false offline. This pins the
            // documented harness limit rather than a real geometry result.
            expect(LayerManager.containsAcrossLayers(a, probe)).toBe(false);
        });

        it('returns false for a null node', () => {
            installTestDOM(CONFIG);

            const a = register(fakeLayer());

            expect(LayerManager.containsAcrossLayers(a, null)).toBe(false);
        });
    });

    describe('Escape (viewport keydown)', () => {
        // LayerManager's private onKeyDown IS reachable offline, driven the same
        // way FocusHistory.test.ts drives its own combo: dispatching a keydown
        // through the window-registered viewport listener
        // (DOM.sink.dispatchEvent invokes it — see TestDOM.ts's dispatchEvent).

        // Registrar regression (viewport-event-propagation): Escape must consume
        // only when it actually closes a layer, not on every keydown — otherwise
        // LayerManager would silence keydown app-wide as soon as any dismissable
        // layer registers.
        it('consumes Escape only when it closes a dismissable layer', () => {
            installTestDOM(CONFIG);

            register(fakeLayer({ dismissMode: 'click-outside' }));

            const escape = makeEvent(0 as Handle, 'keydown', { key: 'Escape' }) as unknown as { stopPropagation: () => void };
            vi.spyOn(escape, 'stopPropagation');

            DOM.sink.dispatchEvent(DOM.source.getWindow(), escape as unknown as Event);

            expect(escape.stopPropagation).toHaveBeenCalledTimes(1);
        });

        it('does not consume Escape with an empty stack', () => {
            installTestDOM(CONFIG);

            const escape = makeEvent(0 as Handle, 'keydown', { key: 'Escape' }) as unknown as { stopPropagation: () => void };
            vi.spyOn(escape, 'stopPropagation');

            DOM.sink.dispatchEvent(DOM.source.getWindow(), escape as unknown as Event);

            expect(escape.stopPropagation).not.toHaveBeenCalled();
        });

        it('does not consume Escape when only "manual" layers are registered', () => {
            installTestDOM(CONFIG);

            register(fakeLayer({ dismissMode: 'manual' }));

            const escape = makeEvent(0 as Handle, 'keydown', { key: 'Escape' }) as unknown as { stopPropagation: () => void };
            vi.spyOn(escape, 'stopPropagation');

            DOM.sink.dispatchEvent(DOM.source.getWindow(), escape as unknown as Event);

            expect(escape.stopPropagation).not.toHaveBeenCalled();
        });
    });

    describe('isTopmostInputLayer', () => {
        it('is true for the only registered layer', () => {
            installTestDOM(CONFIG);

            const a = register(fakeLayer());

            expect(LayerManager.isTopmostInputLayer(a)).toBe(true);
        });

        it('is false for a layer with another registered on top of it', () => {
            installTestDOM(CONFIG);

            const a = register(fakeLayer());
            const b = register(fakeLayer());

            expect(LayerManager.isTopmostInputLayer(a)).toBe(false);
            expect(LayerManager.isTopmostInputLayer(b)).toBe(true);
        });

        it('reflects the new top once the layer above it unregisters', () => {
            installTestDOM(CONFIG);

            const a = register(fakeLayer());
            const b = register(fakeLayer());

            LayerManager.unregister(b);

            expect(LayerManager.isTopmostInputLayer(a)).toBe(true);
        });

        it('is false for every layer when the stack is empty', () => {
            installTestDOM(CONFIG);

            const a = fakeLayer();

            expect(LayerManager.isTopmostInputLayer(a)).toBe(false);
        });

        it('skips a "manual" layer stacked on top — it is decorative, not input-owning', () => {
            installTestDOM(CONFIG);

            const dialog = register(fakeLayer({ dismissMode: 'click-outside' }));
            const tooltip = register(fakeLayer({ dismissMode: 'manual' }));

            expect(LayerManager.isTopmostInputLayer(dialog)).toBe(true);
            expect(LayerManager.isTopmostInputLayer(tooltip)).toBe(false);
        });
    });

    // ----- Documented offline gap (Tier-3 dismiss dispatch) -----
    //
    // The rest of the dismiss-mode dispatch the plan names (`handleOutside`,
    // `onPointerDown`, `onWindowBlur`) lives in PRIVATE namespace functions that
    // are not exported from `LayerManager`, so they are unreachable even via
    // bracket-access — a TS namespace only exposes its `export`ed members on the
    // namespace object. `containsAcrossLayers` above pins the other half of the
    // gap: the modelled source has no DOM tree, so outside-click geometry is
    // always false offline. So the requestClose-on-outside / modal-shields-lower
    // behaviour is not assertable on the offline harness; it needs a real
    // jsdom-event or browser harness. See ## Non-Goals in the plan. No test is
    // authored for it rather than faking a green/red assertion against a seam
    // that does not exist.
});
