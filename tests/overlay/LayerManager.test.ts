import { describe, it, expect, afterEach, vi, type Mock } from 'vitest';
import { LayerManager, DismissableLayer, LayerDismissMode } from '~/core/LayerManager';
import { DOM, type Handle } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
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

    // ----- Documented offline gap (Tier-3 dismiss dispatch) -----
    //
    // The dismiss-mode dispatch the plan names (`handleOutside`, `onPointerDown`,
    // `onKeyDown`, `onWindowBlur`) lives in PRIVATE namespace functions that are
    // NOT exported from `LayerManager`, so they are unreachable even via
    // bracket-access — a TS namespace only exposes its `export`ed members on the
    // namespace object. The only seam that could drive them is the real
    // document-level `pointerdown` / `keydown` listeners, and the recording sink
    // records `dispatchEvent` without invoking listeners (TestDOM.ts:217). So the
    // requestClose-on-outside / Escape-skips-manual / modal-shields-lower
    // behaviour is not assertable on the offline harness; it needs a real
    // jsdom-event or browser harness. See ## Non-Goals in the plan. No test is
    // authored for it rather than faking a green/red assertion against a seam
    // that does not exist.
});
