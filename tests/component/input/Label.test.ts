// Label associates a `<label>` with a form control through the HTML `for`
// attribute. `forId` is now private (`_forId`); the only mutator is setForId,
// which must write the `for` attribute — the bug was that the old public
// mutable field bypassed the setter and never updated the DOM.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Label } from '~/component/input/Label';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

let sink: RecordingDOMSink;

beforeEach(() => { sink = installTestDOM(CONFIG); });
afterEach(() => DOM.reset());

/** Latest recorded `setAttr` value for `attr` on any handle, or undefined. */
function lastSetAttr(attr: string): unknown {
    let value: unknown;

    for (const w of sink.writes) {
        if (w.op !== 'apply') {
            continue;
        }

        const patch = w.args[1] as { setAttr?: Record<string, unknown> };

        if (patch?.setAttr && attr in patch.setAttr) {
            value = patch.setAttr[attr];
        }
    }

    return value;
}

describe('Label forId', () => {
    it('renders the constructor forId as the `for` attribute', () => {
        const label = new Label('Name:', 'field-1');

        label.getElement(true);

        expect(lastSetAttr('for')).toBe('field-1');
        expect(label.getForId()).toBe('field-1');
    });

    it('setForId on a mounted label writes the `for` attribute and round-trips through getForId', () => {
        const label = new Label('Name:', 'field-1');

        label.getElement(true);
        label.setForId('field-2');

        expect(lastSetAttr('for')).toBe('field-2');
        expect(label.getForId()).toBe('field-2');
    });

    it('rejects an empty forId', () => {
        const label = new Label('Name:', 'field-1');

        expect(() => label.setForId('')).toThrow();
    });
});
