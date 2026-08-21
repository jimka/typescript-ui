import { describe, it, expect, afterEach } from 'vitest';
import { Scrollbar } from '~/component/container/Scrollbar';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { installTestDOM, makeEvent, RecordingDOMSink } from '../../dom/TestDOM';
import { _ruleCacheHas } from '~/core/StyleTarget';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// Real-event delivery lives in its OWN file on purpose. The Event namespace
// installs its base window listener once per type, guarded by a module-scoped
// Set that survives `DOM.reset()`; reset installs a fresh sink whose window
// listeners start empty but leaves that guard set — so a second test in the same
// file that constructs a Scrollbar never re-installs the `mousedown` base
// listener into the fresh sink, and a dispatch reaches nothing. Vitest isolates
// module state per file, so a single delivery test here always runs against a
// freshly-installed base listener. (events.test.ts sidesteps the same limitation
// by minting a unique event type per test.)
describe('Scrollbar arrow mousedown drives a scroll step', () => {
    afterEach(() => DOM.reset());

    // Regression guard on the delivery chain
    // (_onMouseDown → emit("tick") → onArrowTick → emit("scroll")). The offline
    // harness has no pointer-events hit-testing, so this dispatches straight to
    // the arrow element — it passes with or without the glyph pointer-events fix
    // (the retargeting itself is manual-verify). It pins that an enabled arrow
    // steps the scroll and a disabled (at-edge) arrow does not.
    it('steps on an enabled arrow and ignores a disabled (at-edge) arrow', () => {
        installTestDOM(CONFIG);

        const bar = new Scrollbar('vertical', { arrowsEnabled: true, arrowStep: 40 });

        bar.setHeight(400);
        bar.setMetrics(200, 1000, 0); // at top: start arrow disabled, end arrow enabled

        const [, arrowStart, arrowEnd] = bar.getComponents();

        const positions: number[] = [];
        bar.on('scroll', (p: number) => positions.push(p));

        // Enabled end arrow: a mousedown steps down one arrowStep (clamped). The
        // trailing mouseup cancels the accelerating hold-repeat schedule so no
        // stray timer leaks past the test.
        const endEl = arrowEnd.getElement(true)!;
        DOM.sink.dispatchEvent(endEl, makeEvent(endEl, 'mousedown'));
        DOM.sink.dispatchEvent(endEl, makeEvent(endEl, 'mouseup'));

        expect(positions).toEqual([40]);

        // Disabled start arrow (already at the top): a mousedown emits nothing.
        const startEl = arrowStart.getElement(true)!;
        DOM.sink.dispatchEvent(startEl, makeEvent(startEl, 'mousedown'));
        DOM.sink.dispatchEvent(startEl, makeEvent(startEl, 'mouseup'));

        expect(positions).toEqual([40]);
    });
});

/**
 * The most recently recorded `toggleClass[key]` value applied to `handle`, or
 * `undefined` if `key` was never toggled on it. `setDisabledState` now drives
 * the disabled visual through a CSS state-class rather than a plain
 * `setForegroundColor` call (see `plans/implemented/state-tier-rule-dedup-followups.md`),
 * so the toggled class — not `getForegroundColor()` — is the only
 * offline-observable signal of the arrow's current disabled state.
 */
function lastToggleClassValue(sink: RecordingDOMSink, handle: Handle, key: string): boolean | undefined {
    for (let i = sink.writes.length - 1; i >= 0; i--) {
        const w = sink.writes[i];
        if (w.op !== 'apply' || w.args[0] !== handle) {
            continue;
        }

        const patch = w.args[1] as { toggleClass?: Record<string, boolean> };
        if (patch.toggleClass && key in patch.toggleClass) {
            return patch.toggleClass[key];
        }
    }

    return undefined;
}

// Pins the enabled↔disabled colour crossfade added on top of the instant
// `_disabled` gating covered above: both arrows declare the fade transition
// at construction, the disabled colour still lands at each extreme, and a
// no-op `setMetrics` call doesn't redundantly rewrite the colour.
describe('Scrollbar arrow enabled/disabled colour fade', () => {
    afterEach(() => DOM.reset());

    it('applies the disabled colour to the start arrow at the top extreme', () => {
        const sink = installTestDOM(CONFIG);

        const bar = new Scrollbar('vertical', { arrowsEnabled: true });
        const [, arrowStart, arrowEnd] = bar.getComponents();
        bar.getElement(true);

        bar.setHeight(400);
        bar.setMetrics(200, 1000, 0); // scrolled to top

        expect(lastToggleClassValue(sink, arrowStart.getElement()!, 'disabled')).toBe(true);
        expect(lastToggleClassValue(sink, arrowEnd.getElement()!, 'disabled')).toBe(false);
    });

    it('flips the disabled colour to the end arrow at the bottom extreme', () => {
        const sink = installTestDOM(CONFIG);

        const bar = new Scrollbar('vertical', { arrowsEnabled: true });
        const [, arrowStart, arrowEnd] = bar.getComponents();
        bar.getElement(true);

        bar.setHeight(400);
        bar.setMetrics(200, 1000, 0);   // top: start disabled
        bar.setMetrics(200, 1000, 800); // bottom (maxScroll = 600): end disabled

        expect(lastToggleClassValue(sink, arrowStart.getElement()!, 'disabled')).toBe(false);
        expect(lastToggleClassValue(sink, arrowEnd.getElement()!, 'disabled')).toBe(true);
    });

    it('declares the 120ms colour crossfade transition on both arrows', () => {
        installTestDOM(CONFIG);

        const bar = new Scrollbar('vertical', { arrowsEnabled: true });
        const [, arrowStart, arrowEnd] = bar.getComponents();

        expect(arrowStart.getTransition()).toBe('color 120ms ease-out');
        expect(arrowEnd.getTransition()).toBe('color 120ms ease-out');
    });

    it('is idempotent: a repeated no-op setMetrics leaves the disabled state unchanged and emits no scroll', () => {
        const sink = installTestDOM(CONFIG);

        const bar = new Scrollbar('vertical', { arrowsEnabled: true });
        const [, arrowStart, arrowEnd] = bar.getComponents();
        bar.getElement(true);

        bar.setHeight(400);
        bar.setMetrics(200, 1000, 0);

        const positions: number[] = [];
        bar.on('scroll', (p: number) => positions.push(p));

        bar.setMetrics(200, 1000, 0); // same metrics again

        expect(lastToggleClassValue(sink, arrowStart.getElement()!, 'disabled')).toBe(true);
        expect(lastToggleClassValue(sink, arrowEnd.getElement()!, 'disabled')).toBe(false);
        expect(positions).toEqual([]);
    });
});

describe('ScrollArrowButton static style hoisting', () => {
    afterEach(() => DOM.reset());

    /** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
    function idSelector(component: { getId(): string }): string {
        return '#' + DOM.source.escapeSelector(component.getId());
    }

    /**
     * Declarations written to `selector`'s stylesheet rule while `fn()` ran,
     * flattened into one key/value map. Copied from `ClassChromeRules.test.ts`.
     */
    function declarationsDuring(
        sink: RecordingDOMSink,
        selector: string,
        fn: () => void,
    ): Record<string, string | null> {
        const start = sink.writes.length;
        fn();

        const out: Record<string, string | null> = {};
        for (const w of sink.writes.slice(start)) {
            if (w.op !== 'setRuleStyles' || w.args[0] !== selector) {
                continue;
            }

            const styles = w.args[1] as Record<string, string | null>;
            for (const key of Object.keys(styles)) {
                out[key] = styles[key];
            }
        }

        return out;
    }

    it('row 1: neither arrow carries a static backgroundColor on its own #id rule, and the shared .ScrollArrowButton class rule exists once rendered', () => {
        const sink = installTestDOM(CONFIG);

        const bar = new Scrollbar('vertical', { arrowsEnabled: true });
        const [, arrowStart, arrowEnd] = bar.getComponents();

        let endDeclarations: Record<string, string | null> = {};
        const startDeclarations = declarationsDuring(sink, idSelector(arrowStart), () => {
            endDeclarations = declarationsDuring(sink, idSelector(arrowEnd), () => bar.getElement(true));
        });

        // `foregroundColor` is now a registered class default too (see
        // `plans/implemented/state-tier-rule-dedup-followups.md`), so nothing
        // else forces the arrow's own `#id` rule to materialise, and
        // backgroundColor's matching value is skipped in silence rather than
        // surfacing as an explicit removal — the net rendered CSS (no
        // declaration on #id, `.ScrollArrowButton` supplies the value) is
        // unchanged.
        expect(startDeclarations.backgroundColor).toBeUndefined();
        expect(endDeclarations.backgroundColor).toBeUndefined();
        expect(_ruleCacheHas('.ScrollArrowButton')).toBe(true);
    });

    it('row 2: a rendered arrow glyph writes no min/max declaration to its own #id rule, but keeps its real font-size/line-height/text-align', () => {
        const sink = installTestDOM(CONFIG);

        const bar = new Scrollbar('vertical', { arrowsEnabled: true });
        const [, arrowStart] = bar.getComponents();
        const glyph = arrowStart.getComponents()[0];

        const declarations = declarationsDuring(sink, idSelector(glyph), () => bar.getElement(true));

        // The four size keys are present but every one is an explicit null
        // removal — the rule still materialises because fontSize/lineHeight/
        // textAlign (below) are always real, non-reconciled writes that force
        // it; the size keys ride along in the same flush. Mirrors the
        // corrected `unicode-arrow-up` case in
        // plans/implemented/glyph-preferredsize-reconciled-write-path.md's
        // Implementation Notes.
        expect(declarations.minWidth).toBeNull();
        expect(declarations.minHeight).toBeNull();
        expect(declarations.maxWidth).toBeNull();
        expect(declarations.maxHeight).toBeNull();
        expect(declarations.fontSize).toBe('10px');
        expect(declarations.lineHeight).toBe('1');
        expect(declarations.textAlign).toBe('center');
        expect(_ruleCacheHas('.ScrollArrowGlyph')).toBe(true);
    });
});

// ScrollArrowButton-specific coverage for the state-tier dedup introduced by
// plans/implemented/state-tier-rule-dedup-followups.md: the `.disabled` color
// now writes through `createStateStyleRule`. No `getRestingExclusionSuffixes()`
// override exists for this class: `color` (the CSS key `setForegroundColor`
// writes under) is not a `RESTING_ISOLATION_KEYS` member, so a resting `color`
// write always lands on the bare `#id` rule regardless of any override — see
// the comment at Scrollbar.ts's `getDisabledClassDeclarations` for the detail.
describe('ScrollArrowButton disabled state-class hoisting', () => {
    afterEach(() => DOM.reset());

    /** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
    function idSelector(component: { getId(): string }): string {
        return '#' + DOM.source.escapeSelector(component.getId());
    }

    /**
     * Declarations written to `selector`'s stylesheet rule while `fn()` ran,
     * flattened into one key/value map. Copied from `ClassChromeRules.test.ts`.
     */
    function declarationsDuring(
        sink: RecordingDOMSink,
        selector: string,
        fn: () => void,
    ): Record<string, string | null> {
        const start = sink.writes.length;
        fn();

        const out: Record<string, string | null> = {};
        for (const w of sink.writes.slice(start)) {
            if (w.op !== 'setRuleStyles' || w.args[0] !== selector) {
                continue;
            }

            const styles = w.args[1] as Record<string, string | null>;
            for (const key of Object.keys(styles)) {
                out[key] = styles[key];
            }
        }

        return out;
    }

    it('row 3: a second, warmed Scrollbar disables an arrow writing no color to its own #id.disabled rule', () => {
        const sink = installTestDOM(CONFIG);

        const warmup = new Scrollbar('vertical', { arrowsEnabled: true });
        warmup.getElement(true);
        warmup.setHeight(400);
        warmup.setMetrics(200, 1000, 0); // disables the start arrow, warming .ScrollArrowButton.disabled

        const bar = new Scrollbar('vertical', { arrowsEnabled: true });
        const [, arrowStart] = bar.getComponents();
        bar.getElement(true);

        const declarations = declarationsDuring(sink, idSelector(arrowStart) + '.disabled', () => {
            bar.setHeight(400);
            bar.setMetrics(200, 1000, 0); // disables the start arrow
        });

        expect(declarations.color).toBeUndefined();
        expect(_ruleCacheHas('.ScrollArrowButton.disabled')).toBe(true);
    });

    it('row 4: a disabled-then-re-enabled arrow never writes color to its own resting #id rule', () => {
        const sink = installTestDOM(CONFIG);

        const bar = new Scrollbar('vertical', { arrowsEnabled: true });
        const [, arrowStart] = bar.getComponents();
        bar.getElement(true);
        bar.setHeight(400);

        // No `getRestingExclusionSuffixes()` override on `ScrollArrowButton`
        // (see Scrollbar.ts's comment where the override used to be): `color`
        // is not a `RESTING_ISOLATION_KEYS` member, so a resting `color` write
        // — if `setDisabledState`'s enable branch ever regained one — would
        // land on the bare `#id` rule, not a `:not(.disabled)` one. That bare
        // rule is what this test must watch to catch it.
        const declarations = declarationsDuring(sink, idSelector(arrowStart), () => {
            bar.setMetrics(200, 1000, 0);   // disables the start arrow (at top)
            bar.setMetrics(200, 1000, 500); // re-enables it (scrolled away from top)
        });

        expect(declarations.color).toBeUndefined();
    });

    it('row 5: the pre-set disabled start arrow carries .disabled on its element once rendered', () => {
        const sink = installTestDOM(CONFIG);

        // Scrollbar.buildArrows() calls `_arrowStart.setDisabledState(true)`
        // synchronously in the Scrollbar constructor, before the arrow's own
        // element exists — the toggleClass write is a no-op at that point, so
        // ScrollArrowButton.render() must re-assert the class once it mounts.
        const bar = new Scrollbar('vertical', { arrowsEnabled: true });
        const [, arrowStart] = bar.getComponents();

        bar.getElement(true);

        expect(lastToggleClassValue(sink, arrowStart.getElement()!, 'disabled')).toBe(true);
    });
});
