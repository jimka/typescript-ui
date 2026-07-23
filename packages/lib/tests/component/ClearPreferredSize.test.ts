// A class default for `preferredSize` must be escapable by the consumer.
//
// A class that defaults a fixed preferred size (FieldSet's 200x200) otherwise
// forces every instance to that box: `applyOptions` skips an `undefined` option,
// so `preferredSize: undefined` in the options bag never lands in `_options` and
// the default keeps winning. Short content then trails dead space with no
// supported way out. `clearPreferredSize` is that way out, and follows the
// key-presence rule in ARCHITECTURE.md ("Class-level defaults must survive the
// getter") that `clearPadding` / `clearBackgroundColor` already use.
import { describe, it, expect, afterEach } from 'vitest';
import { Component } from '~/core/Component';
import { FieldSet } from '~/component/container/FieldSet';
import { Button } from '~/component/button/Button';
import { HBox } from '~/layout/HBox';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

describe('clearPreferredSize', () => {
    afterEach(() => DOM.reset());

    it('reports the explicit size a consumer set', () => {
        installTestDOM(CONFIG);

        const c = new Component({ preferredSize: { width: 120, height: 40 } });

        expect(c.getPreferredSizeConstraint()).toEqual({ width: 120, height: 40 });
    });

    it('reports the class default when the consumer set nothing', () => {
        installTestDOM(CONFIG);

        // FieldSet defaults to a fixed 200x200 square.
        expect(FieldSet('Title').getPreferredSizeConstraint()).toEqual({ width: 200, height: 200 });
    });

    it('suppresses the class default once cleared, rather than re-resolving it', () => {
        installTestDOM(CONFIG);

        const fieldSet = FieldSet('Title');

        fieldSet.clearPreferredSize();

        expect(fieldSet.getPreferredSizeConstraint()).toBeNull();
    });

    it('clears an explicitly set size too', () => {
        installTestDOM(CONFIG);

        const c = new Component({ preferredSize: { width: 120, height: 40 } });

        c.clearPreferredSize();

        expect(c.getPreferredSizeConstraint()).toBeNull();
    });

    it('is idempotent', () => {
        installTestDOM(CONFIG);

        const fieldSet = FieldSet('Title');

        fieldSet.clearPreferredSize();
        fieldSet.clearPreferredSize();

        expect(fieldSet.getPreferredSizeConstraint()).toBeNull();
    });

    it('lets a cleared FieldSet shrink to its content instead of the 200px default', () => {
        installTestDOM(CONFIG);

        const row = FieldSet('justify', {
            layoutManager: HBox(),
            components:    [Button({ text: 'One' }), Button({ text: 'Two' })],
        });

        row.getElement(true);

        const before = row.getPreferredSize();

        row.clearPreferredSize();

        const after = row.getPreferredSize();

        // The default box is 200 tall; the content row is a single button line,
        // so clearing must report something materially shorter.
        expect(before?.height).toBe(200);
        expect(after!.height).toBeLessThan(200);
    });
});
