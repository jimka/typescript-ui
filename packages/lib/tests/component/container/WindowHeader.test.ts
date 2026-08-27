import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WindowHeader } from '~/component/container/WindowHeader';
import { DOM } from '~/core/DOM';
import { Event } from '~/core/Event';
import { installTestDOM, makeEvent, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { _ruleCacheHas } from '~/core/StyleTarget';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

let sink: RecordingDOMSink;

beforeEach(() => {
    sink = installTestDOM(CONFIG);
});

afterEach(() => DOM.reset());

describe('WindowHeaderTitleGlyph style hoisting', () => {
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

    it("a rendered WindowHeader's default title glyph carries no min/max size declaration on its own #id rule, and the shared trait rule exists", () => {
        const header = new WindowHeader('Title');
        const glyph  = header.getGlyph()!;

        const declarations = declarationsDuring(sink, idSelector(glyph), () => header.getElement(true));

        // `?? null` treats an absent key the same as an explicit `null`
        // removal: the glyph is now clickable and carries its own `cursor`
        // instance override, which — being the first real declaration this
        // instance ever queues — materialises the id rule and flushes the
        // still-pending, always-null minWidth/minHeight/maxWidth/maxHeight
        // baseline keys alongside it (see `Component.flushStyleBag`'s
        // class-default-only comprehensive write). Either shape means no
        // real min/max size value is declared.
        expect(declarations.minWidth ?? null).toBeNull();
        expect(declarations.minHeight ?? null).toBeNull();
        expect(declarations.maxWidth ?? null).toBeNull();
        expect(declarations.maxHeight ?? null).toBeNull();
        expect(_ruleCacheHas('.WindowHeaderTitleGlyph')).toBe(false);
        expect(_ruleCacheHas('.ts-ui-component.ts-ui-trait-glyph-md-ink')).toBe(true);
    });
});

// Covers the window-context-menu plan's title-icon click plumbing
// (`addTitleGlyphClickListener` / `onHeaderClick`), added alongside the style-
// hoisting suite above but otherwise untested until now. Dispatches a real
// `click` through the header's rendered subtree via `DOM.sink.dispatchEvent`
// (the same pattern `TabBar.leadingWidgetChrome.test.ts` and
// `AbstractWindow.windowMenu.test.ts` use), rather than calling `onHeaderClick`
// directly, so the containment filter itself is exercised, not just the
// listener invocation.
describe('WindowHeader title-glyph click', () => {
    let header: WindowHeader | null = null;

    // Disposed in `afterEach` (not inline at the end of each `it`) so cleanup
    // still runs when an assertion throws mid-test: an undisposed subtree
    // listener leaves the "click" type marked installed against a discarded
    // sink, silently dropping dispatch for every later test's fresh window
    // (see WindowControlButton.classStyleHoisting.test.ts's identical
    // observation). Registered after the file-level `DOM.reset()` afterEach,
    // so it runs first (afterEach hooks run in reverse registration order —
    // see AbstractWindow.windowMenu.test.ts's identical comment).
    afterEach(() => {
        header?.dispose();
        header = null;
    });

    it('invokes the listener for a click on the title icon, but not one on the title text', () => {
        header = new WindowHeader('Title');
        header.getElement(true);

        const listener = vi.fn();
        header.addTitleGlyphClickListener(listener);

        const textEl  = header.getText().getElement(true)!;
        const glyphEl = header.getGlyph()!.getElement(true)!;

        DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(textEl, 'click'));
        expect(listener).not.toHaveBeenCalled();

        DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(glyphEl, 'click'));
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('does not stack a duplicate subtree listener on a second call: the underlying `Event.addSubtreeListener` wires only once', () => {
        // A dispatch-count assertion would not catch a missing guard here:
        // `Event.addSubtreeListener`'s own registry already dedupes an
        // identical listener reference (`_boundOnHeaderClick` is one stable
        // bound field, reused on every call), so a removed guard would still
        // fire the externally-visible listener once. The guard's own effect —
        // not calling `Event.addSubtreeListener` a second time at all — is
        // asserted directly instead, mirroring `TextInput.test.ts`'s "wires
        // exactly one native listener" convention.
        header = new WindowHeader('Title');
        header.getElement(true);

        const spy = vi.spyOn(Event, 'addSubtreeListener');

        header.addTitleGlyphClickListener(vi.fn());
        header.addTitleGlyphClickListener(vi.fn());

        const clickRegistrations = spy.mock.calls.filter(c => c[0] === header && c[1] === 'click').length;
        expect(clickRegistrations).toBe(1);
    });

    it("a second call's listener replaces the first", () => {
        header = new WindowHeader('Title');
        header.getElement(true);

        const first  = vi.fn();
        const second = vi.fn();
        header.addTitleGlyphClickListener(first);
        header.addTitleGlyphClickListener(second);

        const glyphEl = header.getGlyph()!.getElement(true)!;
        DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(glyphEl, 'click'));

        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
    });
});
