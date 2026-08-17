//
// Toggle on/off coverage. All cases run on a bare (unmounted) toggle: setValue
// flips through the framework ListenerBag (no DOM event loop), label is a pure
// option read. Also covers the AbstractInput notifyChange fan-out (change +
// binding) via two registered listeners.
import { describe, it, expect, afterEach } from 'vitest';
import { Toggle } from '~/component/input/Toggle';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
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
