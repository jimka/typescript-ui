//
// Toggle on/off coverage. All cases run on a bare (unmounted) toggle: setValue
// flips through the framework ListenerBag (no DOM event loop), label is a pure
// option read. Also covers the AbstractInput notifyChange fan-out (change +
// binding) via two registered listeners.
import { describe, it, expect, afterEach } from 'vitest';
import { Toggle } from '~/component/input/Toggle';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import { _ruleCacheHas } from '~/core/StyleTarget';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

describe('Toggle value transitions', () => {
    it('defaults the value to false', () => {
        expect(new Toggle().getValue()).toBe(false);
    });

    it('flips to true via setValue and fires change once', () => {
        const t = new Toggle();

        let changes = 0;
        let last: boolean | null = null;
        t.on('change', (v: boolean) => {
            changes += 1;
            last = v;
        });

        t.setValue(true);

        expect(t.getValue()).toBe(true);
        expect(changes).toBe(1);
        expect(last).toBe(true);
    });

    it('treats a repeated setValue to the same state as a no-op', () => {
        const t = new Toggle({ value: true });

        let changes = 0;
        t.on('change', () => {
            changes += 1;
        });

        t.setValue(true);

        expect(changes).toBe(0);
    });

    it('returns to false via clearValue', () => {
        const t = new Toggle({ value: true });
        t.clearValue();

        expect(t.getValue()).toBe(false);
    });
});

describe('Toggle label round-trip', () => {
    it('reads back a label and clears it with null', () => {
        const t = new Toggle({ label: 'Wi-Fi' });
        expect(t.getLabel()).toBe('Wi-Fi');

        t.setLabel(null);
        expect(t.getLabel()).toBe(null);
    });
});

describe('Toggle notifyChange fan-out', () => {
    it('fires both change (with value) and binding (no args) on a transition', () => {
        const t = new Toggle();

        let changeValue: boolean | null = null;
        let bindings = 0;
        t.on('change', (v: boolean) => {
            changeValue = v;
        });
        t.on('binding', () => {
            bindings += 1;
        });

        t.setValue(true);

        expect(changeValue).toBe(true);
        expect(bindings).toBe(1);
    });
});

describe('Toggle AbstractInput enabled/readOnly surface', () => {
    it('defaults to enabled and not read-only', () => {
        const t = new Toggle();

        expect(t.isEnabled()).toBe(true);
        expect(t.isReadOnly()).toBe(false);
    });

    it('round-trips setEnabled / setReadOnly', () => {
        const t = new Toggle();
        t.setEnabled(false);
        t.setReadOnly(true);

        expect(t.isEnabled()).toBe(false);
        expect(t.isReadOnly()).toBe(true);
    });
});

describe('Toggle label nudge across repeated relayouts', () => {
    afterEach(() => DOM.reset());

    it('keeps the label at a stable static Y across no-op relayouts (unchanged geometry)', () => {
        installTestDOM(CONFIG);

        const toggle = new Toggle({ label: 'Wi-Fi' });
        toggle.getElement(true);
        toggle.setWidth(200);
        toggle.setHeight(40);
        toggle.doLayout();

        const label = (toggle as unknown as { _label: { getY(): number; getTranslateY(): number } })._label;

        // doLayout() re-nudges the label on every pass — a sibling/window
        // relayout that leaves Toggle's own geometry unchanged still triggers
        // it. `label`'s own size never changes across these passes, so
        // LayoutManager.commitBounds fast-paths its inner-HBox placement; the
        // nudge must fold the resulting translate back in rather than compound
        // it, or the static Y drifts further every pass.
        toggle.doLayout();
        const yAfterSecondPass = label.getY();

        toggle.doLayout();
        toggle.doLayout();
        const yAfterFourthPass = label.getY();

        expect(yAfterFourthPass).toBe(yAfterSecondPass);
        // True visual position (static + translate) stays at the nudged offset.
        expect(label.getY() + label.getTranslateY()).toBe(yAfterSecondPass);
    });
});

// The track and thumb are each a dedicated file-local subclass (ToggleTrack /
// ToggleThumb) rather than a bare `Component`, so their static chrome hoists
// into a shared `.ClassName` rule instead of repeating on every instance's
// own `#id` rule. Mirrors Scrollbar.test.ts's "Scrollbar thumb static style
// hoisting" and "ScrollbarThumb hover state-class hoisting" blocks.
describe('ToggleTrack/ToggleThumb class-rule hoisting', () => {
    afterEach(() => DOM.reset());

    /** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
    function idSelector(component: { getId(): string }): string {
        return '#' + DOM.source.escapeSelector(component.getId());
    }

    /**
     * Declarations written to `selector`'s stylesheet rule while `fn()` ran,
     * flattened into one key/value map. Copied from `Scrollbar.test.ts`.
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

    it('the track and thumb carry no static backgroundColor/borderRadius declaration on their own #id rules, and the shared class rules exist once rendered', () => {
        const sink = installTestDOM(CONFIG);

        const toggle = new Toggle() as any;
        const track  = toggle._track;
        const thumb  = toggle._thumb;

        const trackDeclarations = declarationsDuring(sink, idSelector(track), () => track.getElement(true));
        expect(trackDeclarations.backgroundColor).toBeUndefined();
        expect(trackDeclarations.borderRadius).toBeUndefined();

        const thumbDeclarations = declarationsDuring(sink, idSelector(thumb), () => thumb.getElement(true));
        expect(thumbDeclarations.backgroundColor).toBeUndefined();
        expect(thumbDeclarations.borderRadius).toBeUndefined();

        expect(_ruleCacheHas('.ToggleTrack')).toBe(true);
        expect(_ruleCacheHas('.ToggleThumb')).toBe(true);
    });

    it('a second, warmed Toggle switched on writes no backgroundColor to its own #id.selected rule', () => {
        const sink = installTestDOM(CONFIG);

        const warmup = new Toggle() as any;
        warmup.getElement(true);
        warmup.setValue(true); // warms .ToggleTrack.selected

        const toggle = new Toggle() as any;
        toggle.getElement(true);

        const track            = toggle._track;
        const restingSelector = idSelector(track) + '.selected';

        const declarations = declarationsDuring(sink, restingSelector, () => {
            toggle.setValue(true);
        });

        expect(declarations.backgroundColor).toBeUndefined();
        expect(_ruleCacheHas('.ToggleTrack.selected')).toBe(true);
    });

    it('a checked-then-unchecked cycle writes no backgroundColor to the resting #id:not(.selected) rule, and setValue(false) actually removes the selected class', () => {
        const sink = installTestDOM(CONFIG);

        const toggle = new Toggle() as any;
        toggle.getElement(true);

        const track           = toggle._track;
        const restingSelector = idSelector(track) + ':not(.selected)';

        toggle.setValue(true);

        const start = sink.writes.length;
        const declarations = declarationsDuring(sink, restingSelector, () => {
            toggle.setValue(false);
        });

        expect(declarations.backgroundColor).toBeUndefined();

        // The off-revert isn't just "writes nothing" — it must actually undo
        // the .selected token, or the track would stay stuck on the "on"
        // fill forever. Mirrors Checkbox.stateClassHoisting.test.ts's
        // removeClass assertion for setIndeterminate(true).
        const removedSelected = sink.writes.slice(start).some((w: any) =>
            w.op === 'apply' && (w.args[1] as { removeClass?: readonly string[] }).removeClass?.includes('selected')
        );
        expect(removedSelected).toBe(true);
    });

    it('a Toggle constructed with value: true shows the selected DOM class on its track immediately after first render', () => {
        const sink = installTestDOM(CONFIG);

        const toggle = new Toggle({ value: true }) as any;
        const track  = toggle._track;

        // Pre-mount: ToggleTrack.render()'s DOM.sink.apply call hasn't run
        // yet, so no toggleClass write for "selected" exists before render —
        // mirrors Checkbox.stateClassHoisting.test.ts's "row 5" assertion.
        expect(sink.writes.some((w: any) => w.op === 'apply' && JSON.stringify(w.args).includes('"selected":true'))).toBe(false);

        track.getElement(true);

        expect(sink.writes.some((w: any) => w.op === 'apply' && JSON.stringify(w.args).includes('"selected":true'))).toBe(true);
    });
});
