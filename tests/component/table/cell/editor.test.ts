// @vitest-environment jsdom
//
// Parse/commit and tri-state coverage for the String / Number / Boolean cell
// editors. They wrap real input components built through DOM.sink, so the
// offline harness is installed.
//
// The String/Number parse path lives in the PRIVATE `onInput`, which reads the
// wrapped TextField's text. Under the recording sink a dispatched "input" event
// is recorded but NOT delivered to the editor's listener (the window-level base
// listener is never invoked offline), so the cleanest seam is to set the
// TextField text and invoke `onInput` directly via `(editor as any)`. This is a
// white-box dependency on the private name, exercising the real parse contract.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../../dom/TestDOM';
import fontMetrics from '../../../dom/font-metrics.test-font.json';
import { StringEditor } from '~/component/table/cell/editor/String';
import { NumberEditor } from '~/component/table/cell/editor/Number';
import { BooleanEditor } from '~/component/table/cell/editor/Boolean';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

/** Sets the wrapped TextField's text and fires the editor's parse path. */
function typeInto(editor: unknown, text: string): void {
    (editor as any)._textField.setText(text);
    (editor as any).onInput();
}

describe('StringEditor', () => {
    it('a fresh editor caches null', () => {
        expect(new StringEditor().getValue()).toBe(null);
    });

    it('setValue(null)/undefined cache null and leave an empty field', () => {
        const e = new StringEditor();

        e.setValue(null);
        expect(e.getValue()).toBe(null);
        expect((e as any)._textField.getText()).toBe('');

        e.setValue('x');
        e.setValue(undefined as any);
        expect(e.getValue()).toBe(null);
    });

    it('typing non-empty text caches that text', () => {
        const e = new StringEditor();

        typeInto(e, 'hello');
        expect(e.getValue()).toBe('hello');
    });

    it('clearing to "" caches null, not the empty string', () => {
        // CONTRACT (JSDoc): empty input is null, mirroring the cell-stack
        // "no value is null" convention.
        const e = new StringEditor();

        typeInto(e, 'hello');
        typeInto(e, '');
        expect(e.getValue()).toBe(null);
    });

    it('setValue round-trips the exact string', () => {
        const e = new StringEditor();

        e.setValue('world');
        expect(e.getValue()).toBe('world');
        expect((e as any)._textField.getText()).toBe('world');
    });
});

describe('NumberEditor parse contract', () => {
    it('a fresh editor caches null', () => {
        expect(new NumberEditor().getValue()).toBe(null);
    });

    it('an empty field parses to null, NOT 0', () => {
        // CONTRACT (JSDoc): "an empty field commits as null instead of 0".
        const e = new NumberEditor();

        typeInto(e, '');
        expect(e.getValue()).toBe(null);
    });

    it('unparseable text parses to null, NOT NaN', () => {
        // CONTRACT (JSDoc): "unparseable text commits as null instead of NaN".
        const e = new NumberEditor();

        typeInto(e, 'abc');
        expect(e.getValue()).toBe(null);
    });

    it('"0" parses to 0 (distinct from empty null)', () => {
        const e = new NumberEditor();

        typeInto(e, '0');
        expect(e.getValue()).toBe(0);
    });

    it('"-3.5" parses to -3.5', () => {
        const e = new NumberEditor();

        typeInto(e, '-3.5');
        expect(e.getValue()).toBe(-3.5);
    });

    it('setValue(null) leaves an empty field (no "null" text)', () => {
        const e = new NumberEditor();

        e.setValue(null);
        expect((e as any)._textField.getText()).toBe('');
    });

    it('setValue(7) round-trips to 7', () => {
        const e = new NumberEditor();

        e.setValue(7);
        expect(e.getValue()).toBe(7);
        expect((e as any)._textField.getText()).toBe('7');
    });
});

describe('BooleanEditor tri-state + suppress-commit', () => {
    it('a fresh editor is indeterminate (null)', () => {
        expect(new BooleanEditor().getValue()).toBe(null);
    });

    it('setValue(null) stays indeterminate and fires NO "change" event', () => {
        // CONTRACT: the `_suppressCommit` guard swallows the synthetic click
        // dispatched by setIndeterminate/setSelected. This is the core bug class
        // the guard exists for; a fired spy IS that bug.
        //
        // HARNESS LIMIT: offline the checkbox is never mounted, and
        // Checkbox.setSelected only dispatches the synthetic "click" the guard
        // suppresses when getElement() is truthy. So this asserts the correct
        // contract outcome (no "change") but does NOT exercise the guard itself
        // — it would pass even if `_suppressCommit` were removed. A live-DOM
        // test is the only way to truly cover the guard mechanism.
        const e   = new BooleanEditor();
        const spy = vi.fn();

        e.on('change', spy);
        e.setValue(null);

        expect(e.getValue()).toBe(null);
        expect(spy).not.toHaveBeenCalled();
    });

    it('setValue(true)/setValue(false) set a concrete value and fire NO "change"', () => {
        const e   = new BooleanEditor();
        const spy = vi.fn();

        e.on('change', spy);

        e.setValue(true);
        expect(e.getValue()).toBe(true);

        e.setValue(false);
        expect(e.getValue()).toBe(false);

        expect(spy).not.toHaveBeenCalled();
    });

    it('toggle() from indeterminate lands on true and DOES fire "change" with the boolean', () => {
        const e   = new BooleanEditor();
        const spy = vi.fn();

        e.on('change', spy);
        e.toggle();

        // Derived from `!isSelected()`: an unselected (indeterminate) checkbox
        // toggles to true.
        //
        // HARNESS NOTE: the call count is asserted offline, where
        // Checkbox.setSelected's synthetic "click" is skipped (unmounted), so
        // only toggle()'s own direct emit fires — count 1. In a live browser the
        // synthetic click would also reach the "action" listener and emit again.
        // toggle() bypasses `_suppressCommit`, so the intended contract is a
        // single concrete-boolean "change"; offline that happens to be exactly
        // what we observe.
        expect(e.getValue()).toBe(true);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith(true);
    });

    it('off() removes a listener by exact reference', () => {
        const e   = new BooleanEditor();
        const spy = vi.fn();

        e.on('change', spy);
        e.off('change', spy);
        e.toggle();

        expect(spy).not.toHaveBeenCalled();
    });
});
