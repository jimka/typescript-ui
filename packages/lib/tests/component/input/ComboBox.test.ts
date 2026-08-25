import { describe, it, expect, afterEach } from 'vitest';
import { ComboBox } from '~/component/input/ComboBox';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import { _ruleCacheHas } from '~/core/StyleTarget';
import { Util } from '~/core/Util';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// A minimal KeyboardEvent-shaped object for the reducer-forwarding test; the
// real window-capture keydown → onKeyDown route is manual-verify.
function key(name: string): KeyboardEvent {
    return { key: name, preventDefault() {}, stopPropagation() {} } as unknown as KeyboardEvent;
}

const MODEL = new Model([{ name: 'id' }, { name: 'name' }, { name: 'code' }, { name: 'icon' }], 'id');
function makeStore(rows: any[]): MemoryStore {
    const store = new MemoryStore(MODEL, rows);
    store.loadData(rows);
    return store;
}

afterEach(() => DOM.reset());

describe('ComboBox — items & selection', () => {
    it('setItems populates, returns a defensive copy, and auto-selects the first item', () => {
        installTestDOM(CONFIG);
        const combo = new ComboBox();
        combo.setItems(['a', 'b', 'c']);

        const items = combo.getItems();
        expect(items).toHaveLength(3);
        items.push({} as never);                       // mutating the copy…
        expect(combo.getItems()).toHaveLength(3);      // …must not affect the combo
        expect(combo.getSelectedIndex()).toBe(0);      // auto-select first
    });

    it('auto-keys a plain-string spec by its value, so getValue returns the string', () => {
        installTestDOM(CONFIG);
        const combo = new ComboBox();
        combo.setItems(['a', 'b', 'c']); // auto-selects the first item
        // Intended contract: a plain-string spec is keyed by its VALUE.
        // NB the setItems JSDoc still says "auto-keyed by its array position /
        // the positional index" — that wording is stale (the key=value behaviour
        // was a deliberate change); the doc should be corrected to "by value".
        expect(combo.getValue()).toBe('a');
    });

    it('keeps an explicit { key, label } key so getValue returns it', () => {
        installTestDOM(CONFIG);
        const combo = new ComboBox();
        combo.setItems([{ key: 'x', label: 'X' }, { key: 'y', label: 'Y' }]);
        expect(combo.getValue()).toBe('x');            // first item's explicit key
    });

    it('addItem appends while preserving the existing selection', () => {
        installTestDOM(CONFIG);
        const combo = new ComboBox();
        combo.setItems([{ key: 'x', label: 'X' }]);
        combo.setSelectedIndex(0, false);
        combo.addItem({ key: 'y', label: 'Y' });

        expect(combo.getItems()).toHaveLength(2);
        expect(combo.getSelectedIndex()).toBe(0);      // selection unchanged
        expect(combo.getValue()).toBe('x');
    });

    it('setSelectedIndex fires change and action bag listeners with the new value by default', () => {
        installTestDOM(CONFIG);
        const combo = new ComboBox();
        combo.setItems([{ key: 'x', label: 'X' }, { key: 'y', label: 'Y' }]);

        // Notification now routes directly through AbstractInput.notifyChange
        // (no self-consumed synthetic DOM `change`), so a real on("change") /
        // on("action") bag listener is delivered reliably offline. `action` is
        // an alias of `change` on ComboBox.
        let changeValue: string | null = null;
        let actionCount = 0;
        combo.on('change', v => { changeValue = v; });
        combo.on('action', () => { actionCount += 1; });

        combo.setSelectedIndex(1);

        expect(combo.getSelectedIndex()).toBe(1);
        expect(combo.getValue()).toBe('y');
        expect(changeValue).toBe('y');
        expect(actionCount).toBe(1);
    });

    it('setSelectedIndex with fireEvent=false fires neither change nor action', () => {
        installTestDOM(CONFIG);
        const combo = new ComboBox();
        combo.setItems([{ key: 'x', label: 'X' }, { key: 'y', label: 'Y' }]);

        let fired = 0;
        combo.on('change', () => { fired += 1; });
        combo.on('action', () => { fired += 1; });

        combo.setSelectedIndex(1, false);

        expect(combo.getSelectedIndex()).toBe(1);
        expect(fired).toBe(0);
    });
});

describe('ComboBox — pending value', () => {
    it('caches a pre-items setValue and surfaces it through getValue until items land', () => {
        installTestDOM(CONFIG);
        const combo = new ComboBox();
        combo.setValue('y');                           // before any items exist
        expect(combo.getValue()).toBe('y');            // pending value surfaced
    });

    it('resolves the pending value to a real selection once a matching item arrives', () => {
        installTestDOM(CONFIG);
        const combo = new ComboBox();
        combo.setValue('y');
        combo.setItems([{ key: 'x', label: 'X' }, { key: 'y', label: 'Y' }]);

        expect(combo.getValue()).toBe('y');
        expect(combo.getSelectedIndex()).toBe(1);      // resolved to y's row
    });

    it('keeps an unmatched pending value alive until a matching item is added later', () => {
        installTestDOM(CONFIG);
        const combo = new ComboBox();
        combo.setValue('z');                           // no such key yet
        combo.setItems([{ key: 'x', label: 'X' }, { key: 'y', label: 'Y' }]); // z absent
        // (auto-select masks getValue with the first item here — the contract under
        // test is that the pending 'z' survives the intermediate load, below.)
        combo.addItem({ key: 'z', label: 'Z' });

        expect(combo.getValue()).toBe('z');
        expect(combo.getSelectedIndex()).toBe(2);
    });
});

describe('ComboBox — store binding', () => {
    it('populates options from a bound store and exposes it via getStore', () => {
        installTestDOM(CONFIG);
        const store = makeStore([{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]);
        const combo = new ComboBox();
        combo.setStore(store, 'name');

        expect(combo.getStore()).toBe(store);
        expect(combo.getItems()).toHaveLength(2);
        expect(combo.getSelectedRecord()?.get('name')).toBe('Alice'); // auto-selected first record
    });

    it('getSelectedRecord is undefined when no store is bound', () => {
        installTestDOM(CONFIG);
        const combo = new ComboBox();
        combo.setItems(['a', 'b']);
        expect(combo.getSelectedRecord()).toBeUndefined();
    });

    it('rebinding detaches the previous store and attaches the new one', () => {
        installTestDOM(CONFIG);
        const first  = makeStore([{ id: 1, name: 'Alice' }]);
        const second = makeStore([{ id: 9, name: 'Zoe' }]);
        const combo  = new ComboBox();

        combo.setStore(first, 'name');
        combo.setStore(second, 'name');
        expect(combo.getStore()).toBe(second);
        expect(combo.getItems()).toHaveLength(1);
        expect(combo.getSelectedRecord()?.get('name')).toBe('Zoe');

        // A change on the *old* store must no longer refresh the combo's options.
        first.add({ id: 2, name: 'Bob' });
        expect(combo.getItems()).toHaveLength(1);       // still just the new store's row

        // A change on the *new* store does refresh.
        second.add({ id: 10, name: 'Xan' });
        expect(combo.getItems()).toHaveLength(2);
    });

    it('refreshes options when the bound store fires datachange (add)', () => {
        installTestDOM(CONFIG);
        const store = makeStore([{ id: 1, name: 'Alice' }]);
        const combo = new ComboBox();
        combo.setStore(store, 'name');

        store.add({ id: 2, name: 'Bob' });
        expect(combo.getItems()).toHaveLength(2);
    });

    it('forwards valueField and glyphField to the options', () => {
        installTestDOM(CONFIG);
        const store = makeStore([{ id: 1, name: 'Alice', code: 'A1', icon: 'star' }]);
        const combo = new ComboBox();
        combo.setStore(store, 'name', 'code', 'icon');

        // valueField drives the option key, so getValue returns the code, not the pk.
        expect(combo.getValue()).toBe('A1');
        // glyphField drives each option's glyph.
        expect((combo.getItems()[0] as { glyph?: string }).glyph).toBe('star');
    });

    it('re-applies a pending value when the store later gains the matching record', () => {
        installTestDOM(CONFIG);
        const store = makeStore([{ id: 1, name: 'Alice', code: 'A1' }]);
        const combo = new ComboBox();
        combo.setStore(store, 'name', 'code'); // keys are codes
        combo.setValue('Z9');                  // not present yet — cached pending

        store.add({ id: 2, name: 'Zoe', code: 'Z9' }); // datachange → onStoreRefresh → reapply

        expect(combo.getValue()).toBe('Z9');
        expect(combo.getSelectedRecord()?.get('name')).toBe('Zoe');
    });
});

describe('ComboBox — keyboard reducer forwarding', () => {
    it('forwards a key through the dropdown to the inner list, advancing its selection', () => {
        installTestDOM(CONFIG);
        const combo = new ComboBox();
        combo.setItems(['a', 'b', 'c']);               // auto-select index 0
        expect(combo.getSelectedIndex()).toBe(0);

        // onKeyDown forwards to the dropdown's handleKey; reach it via the
        // documented any-cast (no public list accessor on ComboBox itself).
        (combo as unknown as { _dropdown: { handleKey(e: KeyboardEvent): boolean } })
            ._dropdown.handleKey(key('ArrowDown'));

        expect(combo.getSelectedIndex()).toBe(1);      // observed through the public delegate
    });
});

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

describe('ComboBoxCaret static style hoisting', () => {
    it('row 4: a rendered caret carries no static min/max size declaration on its own #id rule, and the shared .ComboBoxCaret class rule exists once rendered', () => {
        const sink  = installTestDOM(CONFIG);
        const combo = new ComboBox() as any;
        const caret = combo._caret;

        const declarations = declarationsDuring(sink, idSelector(caret), () => combo.getElement(true));

        expect(declarations.minWidth).toBeUndefined();
        expect(declarations.minHeight).toBeUndefined();
        expect(declarations.maxWidth).toBeUndefined();
        expect(declarations.maxHeight).toBeUndefined();
        expect(_ruleCacheHas('.ComboBoxCaret')).toBe(true);
    });

    it("the caret's own chevron glyph carries no static min/max size declaration on its own #id rule, and the shared trait rule exists once rendered", () => {
        const sink  = installTestDOM(CONFIG);
        const combo = new ComboBox() as any;
        const glyph = combo._caret.getGlyph();

        const declarations = declarationsDuring(sink, idSelector(glyph), () => combo.getElement(true));

        expect(declarations.minWidth).toBeUndefined();
        expect(declarations.minHeight).toBeUndefined();
        expect(declarations.maxWidth).toBeUndefined();
        expect(declarations.maxHeight).toBeUndefined();
        expect(_ruleCacheHas('.ComboBoxCaretGlyph')).toBe(false);
        expect(_ruleCacheHas('.ts-ui-component.ts-ui-trait-glyph-md-ink')).toBe(true);
    });
});

describe('ComboBoxLabel line-height value-class sharing', () => {
    /**
     * Raw writes `fn()` produces, captured from `sink.writes`. Local to this
     * block (unlike `idSelector`/`declarationsDuring`, only these two were
     * hoisted per the plan) because rows here need both the `#id` rule
     * declarations and the class-toggle `apply` write from the same capture.
     */
    function writesDuring(sink: RecordingDOMSink, fn: () => void): RecordingDOMSink['writes'] {
        const start = sink.writes.length;
        fn();
        return sink.writes.slice(start);
    }

    /** `declarationsDuring`'s flattening, applied to an already-captured write list. */
    function declarationsIn(
        writes: RecordingDOMSink['writes'],
        selector: string,
    ): Record<string, string | null> {
        const out: Record<string, string | null> = {};
        for (const w of writes) {
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

    /** The `addClass`/`removeClass` patches from `apply` writes, matching `TextLineHeightValueClassSharing.test.ts`'s convention. */
    function classToggleWrites(
        writes: RecordingDOMSink['writes'],
    ): Array<{ removeClass?: string[]; addClass?: string[] }> {
        return writes
            .filter((w) => w.op === 'apply')
            .map((w) => w.args[1] as { removeClass?: string[]; addClass?: string[] })
            .filter((patch) => patch.addClass !== undefined || patch.removeClass !== undefined);
    }

    afterEach(() => Util.invalidateTextMetricsCache());

    it('row 1: two rendered ComboBoxes\' labels both call setLineHeight(31): neither #id rule carries lineHeight, both elements gain lh31px, and the shared rule exists', () => {
        const sink = installTestDOM(CONFIG);

        const a = new ComboBox() as any;
        a.getElement(true);
        const b = new ComboBox() as any;
        b.getElement(true);

        const writesA = writesDuring(sink, () => a._label.setLineHeight(31));
        expect(declarationsIn(writesA, idSelector(a._label)).lineHeight).toBeUndefined();
        expect(classToggleWrites(writesA)).toEqual([{ removeClass: [], addClass: ['lh31px'] }]);

        const writesB = writesDuring(sink, () => b._label.setLineHeight(31));
        expect(declarationsIn(writesB, idSelector(b._label)).lineHeight).toBeUndefined();
        expect(classToggleWrites(writesB)).toEqual([{ removeClass: [], addClass: ['lh31px'] }]);

        expect(_ruleCacheHas('.ComboBoxLabel.lh31px')).toBe(true);
    });

    it('row 2: setLineHeight(31) then setLineHeight(37) on a rendered label swaps the value-class token in one apply write; #id never carries lineHeight', () => {
        const sink  = installTestDOM(CONFIG);
        const combo = new ComboBox() as any;
        combo.getElement(true);
        const label = combo._label;

        const writes1 = writesDuring(sink, () => label.setLineHeight(31));
        expect(declarationsIn(writes1, idSelector(label)).lineHeight).toBeUndefined();

        const writes2 = writesDuring(sink, () => label.setLineHeight(37));
        expect(declarationsIn(writes2, idSelector(label)).lineHeight).toBeUndefined();
        expect(classToggleWrites(writes2)).toEqual([{ removeClass: ['lh31px'], addClass: ['lh37px'] }]);

        expect(_ruleCacheHas('.ComboBoxLabel.lh37px')).toBe(true);
    });

    it('row 3: setLineHeight(31) called twice on a rendered label — the second call is a no-op (unchanged value and mode)', () => {
        const sink  = installTestDOM(CONFIG);
        const combo = new ComboBox() as any;
        combo.getElement(true);
        const label = combo._label;

        label.setLineHeight(31);

        const writes2 = writesDuring(sink, () => label.setLineHeight(31));
        expect(writes2).toEqual([]);
    });

    it('row 4: setLineHeight(31) then setLineHeight("1.4em") clears the value class and writes a real lineHeight declaration to #id', () => {
        const sink  = installTestDOM(CONFIG);
        const combo = new ComboBox() as any;
        combo.getElement(true);
        const label = combo._label;

        label.setLineHeight(31);

        const writes = writesDuring(sink, () => label.setLineHeight('1.4em'));
        expect(classToggleWrites(writes)).toEqual([{ removeClass: ['lh31px'] }]);
        expect(declarationsIn(writes, idSelector(label)).lineHeight).toBe('1.4em');
        expect(label.getLineHeight()).toBe('1.4em');
    });

    it('row 5: setLineHeight("1.4em") then setLineHeight(31) writes lineHeight as null on #id and points the element at the shared rule', () => {
        const sink  = installTestDOM(CONFIG);
        const combo = new ComboBox() as any;
        combo.getElement(true);
        const label = combo._label;

        label.setLineHeight('1.4em');

        const writes = writesDuring(sink, () => label.setLineHeight(31));
        expect(declarationsIn(writes, idSelector(label)).lineHeight).toBeNull();
        expect(classToggleWrites(writes)).toEqual([{ removeClass: [], addClass: ['lh31px'] }]);

        expect(_ruleCacheHas('.ComboBoxLabel.lh31px')).toBe(true);
    });

    it('row 6: setLineHeight(31) before the label renders produces no apply write; the rendered element carries lh31px via the init() catch-up', () => {
        const sink  = installTestDOM(CONFIG);
        const combo = new ComboBox() as any;
        const label = combo._label;

        expect(label.getElement()).toBeFalsy();

        const writesBefore = writesDuring(sink, () => label.setLineHeight(31));
        expect(classToggleWrites(writesBefore)).toEqual([]);

        const writesAfter = writesDuring(sink, () => combo.getElement(true));
        expect(classToggleWrites(writesAfter)).toContainEqual({ addClass: ['lh31px'] });
    });

    it('row 7: two ComboBoxes laid out at their own preferred height under one theme resolve the same line-height token and share one rule', () => {
        installTestDOM(CONFIG);

        const a = new ComboBox() as any;
        a.getElement(true);
        a.setWidth(a.getPreferredSize()!.width);
        a.setHeight(a.getPreferredSize()!.height);
        a.doLayout();

        const b = new ComboBox() as any;
        b.getElement(true);
        b.setWidth(b.getPreferredSize()!.width);
        b.setHeight(b.getPreferredSize()!.height);
        b.doLayout();

        const lineHeight = a._label.getLineHeight();
        expect(b._label.getLineHeight()).toBe(lineHeight);

        const token = 'lh' + lineHeight.replace(/[^a-zA-Z0-9]/g, '_');
        expect(_ruleCacheHas('.ComboBoxLabel.' + token)).toBe(true);
    });

    it('row 8: the same laid-out ComboBox under a different theme font size resolves a different line-height token', () => {
        installTestDOM(CONFIG);

        const at14 = new ComboBox() as any;
        at14.getElement(true);
        at14.setWidth(at14.getPreferredSize()!.width);
        at14.setHeight(at14.getPreferredSize()!.height);
        at14.doLayout();
        const lineHeightAt14 = at14._label.getLineHeight();

        DOM.reset();
        Util.invalidateTextMetricsCache();
        installTestDOM({ ...CONFIG, themeVars: { '--ts-ui-font-size': '18px' } });

        const at18 = new ComboBox() as any;
        at18.getElement(true);
        at18.setWidth(at18.getPreferredSize()!.width);
        at18.setHeight(at18.getPreferredSize()!.height);
        at18.doLayout();
        const lineHeightAt18 = at18._label.getLineHeight();

        expect(lineHeightAt18).not.toBe(lineHeightAt14);

        const token = 'lh' + lineHeightAt18.replace(/[^a-zA-Z0-9]/g, '_');
        expect(_ruleCacheHas('.ComboBoxLabel.' + token)).toBe(true);
    });
});
