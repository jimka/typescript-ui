//
// TreeCellRenderer arithmetic + delegation coverage. The renderer wraps a real
// delegate renderer and (for branches) builds a caret Glyph through DOM.sink, so
// the offline harness is installed. TreeCell.ts registers the "caret-down" /
// "caret-right" glyphs at import time, so branch toggles construct without
// throwing. getContentX is the load-bearing arithmetic contract; the rest is
// delegation + idempotence.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../../dom/TestDOM';
import fontMetrics from '../../../dom/font-metrics.test-font.json';
import { TreeCellRenderer } from '~/component/table/cell/renderer/TreeCell';
import { StringRenderer } from '~/component/table/cell/renderer/String';
import { Insets } from '~/primitive/Insets';
import { Diagnostics } from '~/core/Diagnostics';
import { _ruleCacheKeys } from '~/core/StyleTarget';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

describe('TreeCellRenderer.getContentX (= depth * indentPx + TOGGLE_WIDTH)', () => {
    it('depth 0 with default indent (16) reserves just the 20px toggle width', () => {
        // CONTRACT: TOGGLE_WIDTH = 20, DEFAULT_INDENT_PX = 16.
        const r = new TreeCellRenderer(new StringRenderer());

        r.setTreeState(0, false, false);
        expect(r.getContentX()).toBe(20);
    });

    it('depth 2 with default indent: 2*16 + 20 = 52', () => {
        const r = new TreeCellRenderer(new StringRenderer());

        r.setTreeState(2, true, false);
        expect(r.getContentX()).toBe(52);
    });

    it('a custom indentPx flows through the arithmetic', () => {
        const r = new TreeCellRenderer(new StringRenderer(), 10);

        r.setTreeState(3, false, false);
        // 3 * 10 + 20 = 50.
        expect(r.getContentX()).toBe(50);
    });
});

describe('TreeCellRenderer delegation', () => {
    it('getValue/setValue delegate to the wrapped renderer', () => {
        const delegate = new StringRenderer();
        const r        = new TreeCellRenderer(delegate);

        r.setValue('hi');
        expect(delegate.getValue()).toBe('hi');
        expect(r.getValue()).toBe('hi');

        delegate.setValue('bye');
        expect(r.getValue()).toBe('bye');
    });

    it('getDelegate returns the wrapped renderer', () => {
        const delegate = new StringRenderer();

        expect(new TreeCellRenderer(delegate).getDelegate()).toBe(delegate);
    });

    it('setInsets forwards to the delegate and leaves the wrapper at zero insets', () => {
        const delegate = new StringRenderer();
        const r        = new TreeCellRenderer(delegate);

        const insets = new Insets(0, 9, 0, 9);
        r.setInsets(insets);

        expect(delegate.getInsets().getLeft()).toBe(9);
        // The wrapper's own insets were zeroed in the constructor and not
        // changed by the forwarded setInsets.
        expect(r.getInsets().getLeft()).toBe(0);
    });
});

describe('TreeCellRenderer tree state', () => {
    it('getDepth round-trips the depth from setTreeState', () => {
        const r = new TreeCellRenderer(new StringRenderer());

        r.setTreeState(4, true, true);
        expect(r.getDepth()).toBe(4);
    });

    it('a leaf (hasChildren:false) has a null toggle; a branch has a non-null toggle', () => {
        const leaf   = new TreeCellRenderer(new StringRenderer());
        const branch = new TreeCellRenderer(new StringRenderer());

        leaf.setTreeState(0, false, false);
        expect(leaf.getToggle()).toBe(null);

        branch.setTreeState(0, true, false);
        expect(branch.getToggle()).not.toBe(null);
    });

    it('setTreeState with the same triple is a no-op (toggle instance unchanged)', () => {
        // CONTRACT (JSDoc): "Idempotent — a call with the same triple is a no-op".
        const r = new TreeCellRenderer(new StringRenderer());

        r.setTreeState(1, true, true);
        const toggle = r.getToggle();

        r.setTreeState(1, true, true);
        expect(r.getToggle()).toBe(toggle);
    });
});

// Mirrors tests/component/button/Button.test.ts's "strands neither a component
// nor a stylesheet rule" case — the landed fix for the same "dispose the
// outgoing instance" shape — reading the same two exact, deterministic
// quantities: the construct/destroy balance and the rule-cache key count.
describe('TreeCellRenderer toggle swap', () => {

    /** Live `Component` instances, as the diagnostics counters see them. */
    function liveComponents(): number {
        const counters = Diagnostics.counters();

        return counters.componentsConstructed - counters.componentsDestroyed;
    }

    /**
     * Builds a rendered branch renderer, drives one `setTreeState` per entry
     * in `expansions` — each flip building a fresh toggle glyph — and disposes
     * it.
     */
    function driveToggles(expansions: boolean[]): void {
        const r = new TreeCellRenderer(new StringRenderer());

        r.getElement(true);

        for (const expanded of expansions) {
            r.setTreeState(0, true, expanded);
        }

        r.dispose();
    }

    /**
     * Asserts that a whole build → flip → dispose round trip leaves the live
     * component count and the rule-cache key count exactly where it found
     * them. The round trip is run twice: the first pass is a warm-up, since
     * the first renderer of the process materialises shared class-tier rules
     * that no instance's dispose() is meant to reclaim.
     */
    function expectRoundTripStrandsNothing(expansions: boolean[]): void {
        driveToggles(expansions);

        const components = liveComponents();
        const rules      = _ruleCacheKeys().length;

        driveToggles(expansions);

        expect(liveComponents()).toBe(components);
        expect(_ruleCacheKeys().length).toBe(rules);
    }

    // The control case. One glyph is built and is still the current toggle at
    // dispose(), so nothing is ever swapped out and nothing can leak from the
    // swap path. It passes before the swap-path fix as well as after, which is
    // what makes the three-swap case below evidence: the N−1 gap between them
    // is the proof that the *current* toggle is already reclaimed by the base
    // destructor's recursion over `_components` (the toggle is added with
    // `addComponent`), and therefore that this renderer needs a disposal in
    // the swap and no `destructor()` of its own.
    it('strands neither a component nor a stylesheet rule when the toggle is never swapped', () => {
        expectRoundTripStrandsNothing([false]);
    });

    // Three glyphs are built; the first two are swapped out by the calls that
    // follow them and the third is still current at dispose(). Before the fix
    // this stranded exactly two — one per swap.
    it('strands neither a component nor a stylesheet rule across three toggle swaps', () => {
        expectRoundTripStrandsNothing([false, true, false]);
    });
});
