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
import { Event } from '~/core/Event';
import { Container } from '~/core/Container';
import { installTestDOM, makeEvent } from '../../../dom/TestDOM';
import fontMetrics from '../../../dom/font-metrics.test-font.json';
import { StringEditor } from '~/component/table/cell/editor/String';
import { NumberEditor } from '~/component/table/cell/editor/Number';
import { ComboEditor } from '~/component/table/cell/editor/Combo';
import { DateEditor } from '~/component/table/cell/editor/Date';
import { BooleanEditor } from '~/component/table/cell/editor/Boolean';
import { CellEditorPool } from '~/component/table/cell/editor/CellEditorPool';
import { Cell } from '~/component/table/cell/Cell';
import { StringRenderer } from '~/component/table/cell/renderer/String';
import { DefaultCell } from '~/component/table/cell/Default';
import type { ForwardedKeyDetail } from '~/component/table/cell/editor/CellEditor';
import { blurRelatedTargetHandle, forwardedKeyDetail } from '~/component/table/cell/editor/CellEditor';

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

describe('blurRelatedTargetHandle (blur relatedTarget normalization)', () => {
    // Regression: StringEditor / NumberEditor re-fire their inner field's blur
    // as a synthetic CustomEvent("blur"), whose `relatedTarget` is `undefined`
    // (not `null`). The old guard `relatedTarget === null ? null : intern(...)`
    // fed that `undefined` to DOM.source.intern — in production `new
    // WeakRef(undefined)` throws, so the pool's blur listener aborted BEFORE it
    // called commitEdit(): the string/number cell stuck in edit mode, never
    // returned to its renderer, and the un-released pooled editor locked every
    // other cell in the column. (Native-blur editors — Date/Time/DateTime —
    // carry a real `null`/node and were unaffected, which is why only "some
    // cell types" broke.) Both `null` and `undefined` must normalize to "focus
    // left the editor entirely" → `null`, the value retainsFocus expects.
    it('returns null when relatedTarget is undefined (synthetic blur)', () => {
        expect(blurRelatedTargetHandle({} as FocusEvent)).toBe(null);
    });

    it('returns null when relatedTarget is null (native blur to nothing)', () => {
        expect(blurRelatedTargetHandle({ relatedTarget: null } as FocusEvent)).toBe(null);
    });

    it('interns and returns the focus target when relatedTarget is a real node', () => {
        // Mint a bare handle (no component, so no listeners) — the window base
        // listener installs once per type and is not reset between tests, so
        // constructing a real editor here would pollute the keydown-forward test.
        const handle   = DOM.sink.createElement('input');
        const sentinel = (makeEvent(handle, 'blur') as unknown as { target: EventTarget }).target;

        expect(blurRelatedTargetHandle({ relatedTarget: sentinel } as unknown as FocusEvent)).toBe(handle);
    });
});

describe('forwardedKeyDetail (native vs synthetic keydown normalization)', () => {
    // Regression: DateEditor/TimeEditor/DateTimeEditor extend
    // TextInputCellEditor, whose own element IS the <input> — they never
    // re-fire a synthetic "keydown" CustomEvent like String/Number/Combo do,
    // so the listener that reaches Cell.onKeyDown receives the raw native
    // KeyboardEvent instead. Before this normalizer, `evnt.detail?.keyCode`
    // read `(0).keyCode` (a real KeyboardEvent's inherited `UIEvent.detail`
    // defaults to `0`, not nullish) -> `undefined`, silently no-opping
    // Enter/Escape/Tab for these three editors. See the "native-event-bug"
    // note in plans/implemented/cell-edit-keyboard-navigation.md.
    it('reads keyCode/shiftKey straight off a native KeyboardEvent', () => {
        const native = {
            key: 'Enter', code: 'Enter', keyCode: 13,
            shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
            detail: 0, // real UIEvent.detail — NOT the synthetic {keyCode} shape
        } as unknown as KeyboardEvent;

        expect(forwardedKeyDetail(native)).toEqual({
            key: 'Enter', code: 'Enter', keyCode: 13,
            shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
        });
    });

    it('still reads the synthetic CustomEvent<ForwardedKeyDetail> shape', () => {
        const detail: ForwardedKeyDetail = {
            key: 'Escape', code: 'Escape', keyCode: 27,
            shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
        };
        const synthetic = { detail } as CustomEvent<ForwardedKeyDetail>;

        expect(forwardedKeyDetail(synthetic)).toEqual(detail);
    });
});

describe('Editor keydown forward to the parent cell', () => {
    // The editor re-fires its inner field's keydown as a CustomEvent carrying the
    // key fields in `detail` (replacing the old `new KeyboardEvent` re-wrap), and
    // the parent cell's keydown listener reads `detail.keyCode`. This drives the
    // full path: a modelled keydown on the inner field -> the editor's forward
    // -> the modelled window base listener -> a cell-style listener on the editor.
    it('forwards a keydown as a custom event whose detail carries key and keyCode', () => {
        const host   = new Container({});
        const editor = new StringEditor();

        host.addComponent(editor);
        host.getElement(true);
        editor.getElement(true);

        const field = (editor as any)._textField;
        field.getElement(true);

        let seen: ForwardedKeyDetail | undefined;

        // Mirror CellEditorPool/Cell: listen for the forwarded "keydown" on the editor.
        Event.addListener(editor, 'keydown', (e: CustomEvent<ForwardedKeyDetail>) => {
            seen = e.detail;
        });

        // Drive the inner field's keydown through the modelled base listener; the
        // sentinel event carries `key`/`keyCode`, which the forward copies into detail.
        DOM.sink.dispatchEvent(field.getElement()!, makeEvent(field.getElement()!, 'keydown', { key: 'Enter', keyCode: 13 }));

        expect(seen).toBeDefined();
        expect(seen!.key).toBe('Enter');
        expect(seen!.keyCode).toBe(13);
    });
});

describe('Tab suppresses native focus-shift at the real keydown target', () => {
    // Architecture Decisions ("Suppressing Tab's native focus-shift"): the
    // listener sitting on the REAL native keydown target must return
    // { prevent: true } for Tab, since Cell's own navigate handler already
    // moves editing elsewhere and preventDefault() on a re-fired synthetic
    // event has no effect on the original native one. Each case below
    // captures the exact listener registered at the site the plan's own
    // table names (via a spy on Event.addListener, matching
    // ColumnFilterRow.test.ts's "a popover clause row carries the same
    // gate" precedent) and calls it directly with a plain keyCode payload,
    // asserting its returned disposition — rather than driving a full
    // DOM.sink.dispatchEvent, whose window-level base listener is a
    // process-wide singleton per event type (see Event.ts's
    // installBaseListener) and so only reliably reaches a fresh test's own
    // modelled sink for the FIRST "keydown" dispatch in a given file.
    // `.filter(...).pop()` rather than `.find(...)`: ComboBox registers its
    // own internal "keydown" listener on itself at construction (dropdown
    // keyboard nav) BEFORE ComboEditor adds its Tab-prevention listener on
    // that same `_combo` target — the LAST registration on (target, type)
    // is always the one this plan added.
    function findKeydownListener(spy: ReturnType<typeof vi.spyOn>, target: unknown): Event.Listener {
        const registrations = spy.mock.calls.filter((c: any[]) => c[0] === target && c[1] === 'keydown');

        expect(registrations.length).toBeGreaterThan(0);

        return registrations[registrations.length - 1][2] as unknown as Event.Listener;
    }

    it("StringEditor's inner TextField listener returns { prevent: true } on Tab/PageUp/PageDown, and no disposition on Enter", () => {
        const spy    = vi.spyOn(Event, 'addListener');
        const editor = new StringEditor();
        editor.getElement(true); // required: the listener re-fires "keydown" on `this`

        const listener = findKeydownListener(spy, (editor as any)._textField);
        spy.mockRestore();

        expect(listener({ keyCode: 9 } as KeyboardEvent)).toEqual({ prevent: true });
        expect(listener({ keyCode: 33 } as KeyboardEvent)).toEqual({ prevent: true });
        expect(listener({ keyCode: 34 } as KeyboardEvent)).toEqual({ prevent: true });
        expect(listener({ keyCode: 13 } as KeyboardEvent)).toBeUndefined();
    });

    it("NumberEditor's inner TextField listener returns { prevent: true } on Tab/PageUp/PageDown, and no disposition on Enter", () => {
        const spy    = vi.spyOn(Event, 'addListener');
        const editor = new NumberEditor();
        editor.getElement(true); // required: the listener re-fires "keydown" on `this`

        const listener = findKeydownListener(spy, (editor as any)._textField);
        spy.mockRestore();

        expect(listener({ keyCode: 9 } as KeyboardEvent)).toEqual({ prevent: true });
        expect(listener({ keyCode: 33 } as KeyboardEvent)).toEqual({ prevent: true });
        expect(listener({ keyCode: 34 } as KeyboardEvent)).toEqual({ prevent: true });
        expect(listener({ keyCode: 13 } as KeyboardEvent)).toBeUndefined();
    });

    it("ComboEditor's inner ComboBox listener returns { prevent: true } on Tab/PageUp/PageDown, and no disposition on Enter", () => {
        const spy    = vi.spyOn(Event, 'addListener');
        const editor = new ComboEditor(['a', 'b']);
        editor.getElement(true); // required: the listener re-fires "keydown" on `this`

        const listener = findKeydownListener(spy, (editor as any)._combo);
        spy.mockRestore();

        expect(listener({ keyCode: 9 } as KeyboardEvent)).toEqual({ prevent: true });
        expect(listener({ keyCode: 33 } as KeyboardEvent)).toEqual({ prevent: true });
        expect(listener({ keyCode: 34 } as KeyboardEvent)).toEqual({ prevent: true });
        expect(listener({ keyCode: 13 } as KeyboardEvent)).toBeUndefined();
    });

    it("CellEditorPool.wireListeners's shared keydown listener returns { prevent: true } on Tab/PageUp/PageDown for a native-input editor (DateEditor)", () => {
        const spy      = vi.spyOn(Event, 'addListener');
        const cellStub = { onKeyDown: vi.fn() } as unknown as Cell<any>;
        const pool     = new CellEditorPool();

        const editor   = pool.acquire('date', cellStub)!;
        const listener = findKeydownListener(spy, editor);
        spy.mockRestore();

        expect(listener({ keyCode: 9 } as KeyboardEvent)).toEqual({ prevent: true });
        expect(listener({ keyCode: 33 } as KeyboardEvent)).toEqual({ prevent: true });
        expect(listener({ keyCode: 34 } as KeyboardEvent)).toEqual({ prevent: true });
        expect(cellStub.onKeyDown).toHaveBeenCalled();
        expect(listener({ keyCode: 13 } as KeyboardEvent)).toBeUndefined();
    });

    it("Cell's own constructor keydown listener returns { prevent: true } on Tab/PageUp/PageDown for a legacy (non-pooled) native-input editor", () => {
        const spy    = vi.spyOn(Event, 'addListener');
        const editor = new DateEditor();
        new Cell<any>('td', new StringRenderer(), editor);

        const listener = findKeydownListener(spy, editor);
        spy.mockRestore();

        expect(listener({ keyCode: 9 } as KeyboardEvent)).toEqual({ prevent: true });
        expect(listener({ keyCode: 33 } as KeyboardEvent)).toEqual({ prevent: true });
        expect(listener({ keyCode: 34 } as KeyboardEvent)).toEqual({ prevent: true });
        expect(listener({ keyCode: 13 } as KeyboardEvent)).toBeUndefined();
    });
});

describe('Cell.onKeyDown commit / cancel contract', () => {
    // The reshaped forward delivers the key fields in `detail`, so Cell.onKeyDown
    // reads detail.keyCode: Enter (13) commits and emits editend, Escape (27)
    // cancels and emits editend, any other key is a no-op. These are the
    // behaviours the editor forward exists to drive.
    function keyEvent(keyCode: number): CustomEvent<ForwardedKeyDetail> {
        return { detail: { keyCode } } as CustomEvent<ForwardedKeyDetail>;
    }

    it('commits and emits editend on Enter (keyCode 13)', () => {
        const cell = new DefaultCell();
        const commit = vi.spyOn(cell, 'commitEdit').mockReturnValue(cell);
        const emit   = vi.spyOn(cell as any, 'emit').mockImplementation(() => {});

        cell.onKeyDown(keyEvent(13));

        expect(commit).toHaveBeenCalledTimes(1);
        expect(emit).toHaveBeenCalledWith('editend');
    });

    it('cancels and emits editend on Escape (keyCode 27)', () => {
        const cell = new DefaultCell();
        const cancel = vi.spyOn(cell as any, 'cancelEdit').mockImplementation(() => {});
        const emit   = vi.spyOn(cell as any, 'emit').mockImplementation(() => {});

        cell.onKeyDown(keyEvent(27));

        expect(cancel).toHaveBeenCalledTimes(1);
        expect(emit).toHaveBeenCalledWith('editend');
    });

    it('is a no-op for any other key', () => {
        const cell = new DefaultCell();
        const commit = vi.spyOn(cell, 'commitEdit').mockReturnValue(cell);
        const cancel = vi.spyOn(cell as any, 'cancelEdit').mockImplementation(() => {});
        const emit   = vi.spyOn(cell as any, 'emit').mockImplementation(() => {});

        cell.onKeyDown(keyEvent(65)); // 'A'

        expect(commit).not.toHaveBeenCalled();
        expect(cancel).not.toHaveBeenCalled();
        expect(emit).not.toHaveBeenCalled();
    });

    it('is a no-op for an arrow key — caret movement inside the editor is untouched', () => {
        const cell = new DefaultCell();
        const commit = vi.spyOn(cell, 'commitEdit').mockReturnValue(cell);
        const cancel = vi.spyOn(cell as any, 'cancelEdit').mockImplementation(() => {});
        const emit   = vi.spyOn(cell as any, 'emit').mockImplementation(() => {});

        cell.onKeyDown(keyEvent(37)); // ArrowLeft

        expect(commit).not.toHaveBeenCalled();
        expect(cancel).not.toHaveBeenCalled();
        expect(emit).not.toHaveBeenCalled();
    });

    it('commits and calls the navigate handler with "right" on Tab', () => {
        const cell = new DefaultCell();
        vi.spyOn(cell, 'commitEdit').mockReturnValue(cell);
        vi.spyOn(cell as any, 'emit').mockImplementation(() => {});
        const navigate = vi.fn();

        cell.setNavigateHandler(navigate);
        cell.onKeyDown({ detail: { keyCode: 9, shiftKey: false } } as CustomEvent<ForwardedKeyDetail>);

        expect(navigate).toHaveBeenCalledWith('right');
    });

    it('commits and calls the navigate handler with "left" on Shift+Tab', () => {
        const cell = new DefaultCell();
        vi.spyOn(cell, 'commitEdit').mockReturnValue(cell);
        vi.spyOn(cell as any, 'emit').mockImplementation(() => {});
        const navigate = vi.fn();

        cell.setNavigateHandler(navigate);
        cell.onKeyDown({ detail: { keyCode: 9, shiftKey: true } } as CustomEvent<ForwardedKeyDetail>);

        expect(navigate).toHaveBeenCalledWith('left');
    });

    it('commits and calls the navigate handler with "up" on Shift+Enter', () => {
        const cell = new DefaultCell();
        vi.spyOn(cell, 'commitEdit').mockReturnValue(cell);
        vi.spyOn(cell as any, 'emit').mockImplementation(() => {});
        const navigate = vi.fn();

        cell.setNavigateHandler(navigate);
        cell.onKeyDown({ detail: { keyCode: 13, shiftKey: true } } as CustomEvent<ForwardedKeyDetail>);

        expect(navigate).toHaveBeenCalledWith('up');
    });

    it('commits and calls the navigate handler with "down" on plain Enter', () => {
        const cell = new DefaultCell();
        vi.spyOn(cell, 'commitEdit').mockReturnValue(cell);
        vi.spyOn(cell as any, 'emit').mockImplementation(() => {});
        const navigate = vi.fn();

        cell.setNavigateHandler(navigate);
        cell.onKeyDown(keyEvent(13));

        expect(navigate).toHaveBeenCalledWith('down');
    });

    it('commits and calls the navigate handler with "pageup" on PageUp (keyCode 33)', () => {
        const cell = new DefaultCell();
        const commit = vi.spyOn(cell, 'commitEdit').mockReturnValue(cell);
        const emit   = vi.spyOn(cell as any, 'emit').mockImplementation(() => {});
        const navigate = vi.fn();

        cell.setNavigateHandler(navigate);
        cell.onKeyDown(keyEvent(33));

        expect(commit).toHaveBeenCalledTimes(1);
        expect(emit).toHaveBeenCalledWith('editend');
        expect(navigate).toHaveBeenCalledWith('pageup');
    });

    it('commits and calls the navigate handler with "pagedown" on PageDown (keyCode 34)', () => {
        const cell = new DefaultCell();
        const commit = vi.spyOn(cell, 'commitEdit').mockReturnValue(cell);
        const emit   = vi.spyOn(cell as any, 'emit').mockImplementation(() => {});
        const navigate = vi.fn();

        cell.setNavigateHandler(navigate);
        cell.onKeyDown(keyEvent(34));

        expect(commit).toHaveBeenCalledTimes(1);
        expect(emit).toHaveBeenCalledWith('editend');
        expect(navigate).toHaveBeenCalledWith('pagedown');
    });

    it('cancels and calls the edit-end handler on Escape', () => {
        const cell = new DefaultCell();
        vi.spyOn(cell as any, 'cancelEdit').mockImplementation(() => {});
        vi.spyOn(cell as any, 'emit').mockImplementation(() => {});
        const editEnd = vi.fn();

        cell.setEditEndHandler(editEnd);
        cell.onKeyDown(keyEvent(27));

        expect(editEnd).toHaveBeenCalledTimes(1);
    });

    // Regression: DateEditor/TimeEditor/DateTimeEditor's real native keydown
    // (never re-fired as a synthetic CustomEvent — see the
    // "forwardedKeyDetail" describe block above) reaches Cell.onKeyDown
    // through the widened `CustomEvent<ForwardedKeyDetail> | KeyboardEvent`
    // parameter. Before this plan, `evnt.detail?.keyCode` silently
    // no-opped for these three editors; both branches must actually work
    // when driven by that native shape.
    it('DateEditor/TimeEditor/DateTimeEditor regression: Enter commits given a raw native KeyboardEvent', () => {
        const cell = new DefaultCell();
        const commit = vi.spyOn(cell, 'commitEdit').mockReturnValue(cell);
        const emit   = vi.spyOn(cell as any, 'emit').mockImplementation(() => {});

        const native = { keyCode: 13, shiftKey: false, detail: 0 } as unknown as KeyboardEvent;
        cell.onKeyDown(native);

        expect(commit).toHaveBeenCalledTimes(1);
        expect(emit).toHaveBeenCalledWith('editend');
    });

    it('DateEditor/TimeEditor/DateTimeEditor regression: Escape cancels given a raw native KeyboardEvent', () => {
        const cell = new DefaultCell();
        const cancel = vi.spyOn(cell as any, 'cancelEdit').mockImplementation(() => {});
        const emit   = vi.spyOn(cell as any, 'emit').mockImplementation(() => {});

        const native = { keyCode: 27, shiftKey: false, detail: 0 } as unknown as KeyboardEvent;
        cell.onKeyDown(native);

        expect(cancel).toHaveBeenCalledTimes(1);
        expect(emit).toHaveBeenCalledWith('editend');
    });
});

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
