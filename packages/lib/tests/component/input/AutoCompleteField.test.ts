//
// AutoCompleteField match-mode coverage. The core unit is the private
// `matches(candidate, query)` predicate across all four match modes; it is
// reached via an `any` cast confined to this file. getValue/setValue delegate
// to the inner TextField and round-trip on a bare (unmounted) field. The
// store-backed query path and timer teardown are covered by the two describe
// blocks below.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AutoCompleteField } from '~/component/input/AutoCompleteField';
import { DOM } from '~/core/DOM';
import { SpatialNavigation } from '~/core/SpatialNavigation';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// Mirrors ComboBox.test.ts's makeStore: a MemoryStore whose records are
// loaded synchronously via loadData, so a store-backed field's suggestions
// are available in the same tick as construction.
const MODEL = new Model([{ name: 'id' }, { name: 'name' }], 'id');
function makeStore(rows: any[]): MemoryStore {
    const store = new MemoryStore(MODEL, rows);
    store.loadData(rows);
    return store;
}

/**
 * Builds a field in the given match mode and returns its private `matches`.
 * Disposes the scratch field immediately — `matches` reads only its own
 * arguments, never `this` state, so disposal is safe, and it releases the
 * "input" listener `TextInput`'s constructor now registers unconditionally;
 * an undisposed field here would permanently pin that registration to
 * whichever DOM was active at collection time (this helper is called
 * directly inside several `describe` bodies below, not inside an `it`) and
 * break the "AutoCompleteField paste debounce" describe block further down
 * this file, which needs a real "input" dispatch to reach the debounce
 * trigger.
 */
function matcherFor(matchMode?: string): (candidate: string, query: string) => boolean {
    const field = new AutoCompleteField(matchMode ? { matchMode: matchMode as any } : undefined);
    field.dispose();

    // matches is the private unit under test; cast to reach it.
    return (candidate: string, query: string): boolean => (field as any).matches(candidate, query);
}

describe('AutoCompleteField matches: contains (default)', () => {
    const matches = matcherFor();

    it('matches a case-insensitive substring anywhere in the candidate', () => {
        expect(matches('apple', 'PL')).toBe(true);
        expect(matches('apple', 'app')).toBe(true);
        expect(matches('apple', 'le')).toBe(true);
    });

    it('rejects a substring not present in the candidate', () => {
        expect(matches('apple', 'xyz')).toBe(false);
    });

    // Prior-fix pin: the default mode lowercases both sides
    // (AutoCompleteField.ts:506-507). Locks the case-insensitive contract.
    it('matches case-insensitively regardless of either side casing', () => {
        expect(matches('Banana', 'BANANA')).toBe(true);
    });
});

describe('AutoCompleteField matches: startsWith', () => {
    const matches = matcherFor('startsWith');

    it('matches a case-insensitive prefix', () => {
        expect(matches('Apple', 'app')).toBe(true);
    });

    it('rejects a prefix that does not start the candidate', () => {
        expect(matches('apricot', 'app')).toBe(false);
    });
});

describe('AutoCompleteField matches: containsCaseSensitive', () => {
    const matches = matcherFor('containsCaseSensitive');

    it('matches a case-sensitive substring', () => {
        expect(matches('Apple', 'App')).toBe(true);
    });

    it('rejects when the casing differs', () => {
        expect(matches('Apple', 'app')).toBe(false);
    });
});

describe('AutoCompleteField matches: startsWithCaseSensitive', () => {
    const matches = matcherFor('startsWithCaseSensitive');

    it('matches a case-sensitive prefix', () => {
        expect(matches('Apple', 'App')).toBe(true);
    });

    it('rejects a prefix with mismatched casing', () => {
        expect(matches('Apple', 'app')).toBe(false);
    });

    it('rejects a case-sensitive substring that is not a prefix', () => {
        expect(matches('Pineapple', 'apple')).toBe(false);
    });
});

describe('AutoCompleteField value delegation', () => {
    it('round-trips getValue/setValue through the inner TextField', () => {
        const field = new AutoCompleteField({ suggestions: ['Apple', 'Banana'] });
        expect(field.getValue()).toBe('');

        field.setValue('Cherry');
        expect(field.getValue()).toBe('Cherry');

        // Releases the "input" listener TextInput's constructor now
        // registers unconditionally — see matcherFor()'s doc comment above
        // for why an undisposed field here would break a later real-dispatch
        // test in this file.
        field.dispose();
    });
});

describe('AutoCompleteField select event routing', () => {
    let field: AutoCompleteField | undefined;

    beforeEach(() => installTestDOM(CONFIG));
    afterEach(() => { field?.dispose(); field = undefined; DOM.reset(); });

    it('fires both on("select") and addSelectListener on a suggestion pick, and off("select") stops only the framework listener', () => {
        field = new AutoCompleteField({ suggestions: ['Apple'] });
        field.getElement(true);

        let viaOn     = 0;
        let viaLegacy = 0;
        let lastValue: string | null = null;

        const onSelect = (v: string): void => {
            viaOn += 1;
            lastValue = v;
        };

        field.on('select', onSelect);
        field.addSelectListener(() => { viaLegacy += 1; });

        (field as any).onSuggestionSelected('Apple');

        expect(viaOn).toBe(1);
        expect(viaLegacy).toBe(1);
        expect(lastValue).toBe('Apple');

        field.off('select', onSelect);

        (field as any).onSuggestionSelected('Apple');

        // The removed framework listener no longer fires; the legacy
        // addSelectListener (also routed through the bag) still does.
        expect(viaOn).toBe(1);
        expect(viaLegacy).toBe(2);
    });
});

// spatial-focus-navigation plan, Implementation Notes: AutoCompleteField's
// own ArrowDown open gesture (fire the query on a closed dropdown) must
// stand down while SpatialNavigation claims the key, or the query fires
// alongside/instead of focus moving.
describe('AutoCompleteField onKeyDown — stands down while SpatialNavigation claims the key', () => {
    let field: AutoCompleteField | undefined;

    beforeEach(() => installTestDOM(CONFIG));
    afterEach(() => { field?.dispose(); field = undefined; DOM.reset(); vi.restoreAllMocks(); });

    it('ArrowDown fires the query on a closed dropdown when the key is unclaimed', () => {
        field = new AutoCompleteField({ suggestions: ['Apple'] });
        const querySuggestions = vi.spyOn(field as any, 'querySuggestions');

        (field as any).onKeyDown({ key: 'ArrowDown' });

        expect(querySuggestions).toHaveBeenCalled();
    });

    it('a claimed ArrowDown does not call querySuggestions', () => {
        field = new AutoCompleteField({ suggestions: ['Apple'] });
        const querySuggestions = vi.spyOn(field as any, 'querySuggestions');

        vi.spyOn(SpatialNavigation, 'claimsKey').mockReturnValue(true);

        (field as any).onKeyDown({ key: 'ArrowDown' });

        expect(querySuggestions).not.toHaveBeenCalled();
    });
});

// Proves TextInput.paste()'s `Event.fireEvent(this, "input")` re-fire
// (plans/text-input-context-menu-clipboard.md) reaches AutoCompleteField's
// own debounce-triggering listener — a smaller-stake instance of the same
// gap DateField.test.ts's "inner-input clipboard re-fire" block proves for
// AbstractPickerField, since this field's on("change") bridge would have
// worked either way (it goes through AbstractInput's "change" event
// TextInput.notifyChange fires) but the suggestion refresh would not. No
// source changes to AutoCompleteField.ts back this: the mechanism is
// inherited, not duplicated. Disposed in `afterEach` (not a manual
// end-of-test call) so a thrown assertion still releases the "input"
// listener registration — see TextInput.test.ts's file-level note on why a
// skipped dispose would silently break a later real-dispatch test.
describe('AutoCompleteField paste debounce', () => {
    let field: AutoCompleteField | undefined;

    beforeEach(() => installTestDOM(CONFIG));
    afterEach(() => { field?.dispose(); field = undefined; DOM.reset(); vi.restoreAllMocks(); });

    it('pasting text matching a suggestion into _textField, then advancing the debounce timer, shows that suggestion', async () => {
        vi.useFakeTimers();

        field = new AutoCompleteField({ suggestions: ['Apple', 'Banana'], debounceMs: 50 });
        const textField = (field as any)._textField;
        textField.getElement(true);

        vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('Apple');

        const dropdown = (field as any)._dropdown;
        const showSpy = vi.spyOn(dropdown, 'show');

        const result = await textField.paste();
        expect(result).toBe(true);

        vi.advanceTimersByTime(50);

        expect(showSpy).toHaveBeenCalledTimes(1);
        expect(showSpy.mock.calls[0][1]).toEqual(['Apple']);

        vi.useRealTimers();
    });
});

// autocomplete-store-query plan: the store branch of querySuggestions used to
// rewrite the caller's store (clearFilter + filterBy) and read back
// getRecords(). It now matches in-process over store.getAll(), so the
// store's own filters/sort/view and event listeners are never touched.
describe('AutoCompleteField store-backed suggestions', () => {
    const DEFAULT_ROWS = [
        { id: '1', name: 'Apple' },
        { id: '2', name: 'Banana' },
        { id: '3', name: 'Cherry' },
    ];

    let field: AutoCompleteField | undefined;

    beforeEach(() => installTestDOM(CONFIG));
    afterEach(() => { field?.dispose(); field = undefined; DOM.reset(); vi.restoreAllMocks(); });

    it("leaves the store's active filters untouched", () => {
        const store = makeStore(DEFAULT_ROWS);
        store.filterBy({ type: 'neq', field: 'name', value: 'Cherry' });

        field = new AutoCompleteField({ store, displayField: 'name' });
        field.setValue('an');
        (field as any).querySuggestions('an');

        expect(store.getActiveFilters()).toEqual([{ type: 'neq', field: 'name', value: 'Cherry' }]);
    });

    it('emits no datachange or filterchange', async () => {
        const store = makeStore(DEFAULT_ROWS);

        let dataChanges   = 0;
        let filterChanges = 0;

        store.on('datachange',   () => { dataChanges += 1; });
        store.on('filterchange', () => { filterChanges += 1; });

        field = new AutoCompleteField({ store, displayField: 'name' });
        field.setValue('an');
        (field as any).querySuggestions('an');

        // A deferred emit (the store's view rebuild resolves through a
        // microtask) would still land within a few queued turns.
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(dataChanges).toBe(0);
        expect(filterChanges).toBe(0);
    });

    it("does not change the store's view", () => {
        const store = makeStore(DEFAULT_ROWS);
        const before = store.getRecords().map(r => r.get('name'));

        field = new AutoCompleteField({ store, displayField: 'name' });
        field.setValue('an');
        (field as any).querySuggestions('an');

        expect(store.getRecords().map(r => r.get('name'))).toEqual(before);
    });

    it('matches the typed query with the default contains mode', () => {
        const store = makeStore(DEFAULT_ROWS);
        field = new AutoCompleteField({ store, displayField: 'name' });

        const dropdown = (field as any)._dropdown;
        const showSpy  = vi.spyOn(dropdown, 'show');

        field.setValue('an');
        (field as any).querySuggestions('an');

        expect(showSpy).toHaveBeenCalledTimes(1);
        expect(showSpy.mock.calls[0][1]).toEqual(['Banana']);
    });

    it("ignores the application's own active filters", () => {
        const store = makeStore(DEFAULT_ROWS);
        store.filterBy({ type: 'neq', field: 'name', value: 'Banana' });

        field = new AutoCompleteField({ store, displayField: 'name' });

        const dropdown = (field as any)._dropdown;
        const showSpy  = vi.spyOn(dropdown, 'show');

        field.setValue('an');
        (field as any).querySuggestions('an');

        expect(showSpy.mock.calls[0][1]).toEqual(['Banana']);
    });

    // getAll() bypasses the store's active sorters exactly as it bypasses its
    // active filters (Architecture Decisions, [^why-getall]) — a Table sorted
    // elsewhere on screen must not silently reorder, or under maxSuggestions
    // reshuffle the composition of, this field's suggestions. Suggestions are
    // shown in the store's load order regardless of any active sort.
    it("ignores the store's active sorter", () => {
        const store = makeStore(DEFAULT_ROWS);
        store.sort('name', 'desc');

        field = new AutoCompleteField({ store, displayField: 'name' });

        const dropdown = (field as any)._dropdown;
        const showSpy  = vi.spyOn(dropdown, 'show');

        field.setValue('a');
        (field as any).querySuggestions('a');

        // Sorted desc, "Cherry" doesn't match; the remaining two would read
        // ['Banana', 'Apple'] under the store's sort, but ['Apple', 'Banana']
        // — insertion order — is what a load-order-only match produces.
        expect(showSpy.mock.calls[0][1]).toEqual(['Apple', 'Banana']);
    });

    it("matches 'startsWith' case-insensitively", () => {
        const store = makeStore([
            { id: '1', name: 'Apple' },
            { id: '2', name: 'Banana' },
            { id: '3', name: 'Ant' },
        ]);
        field = new AutoCompleteField({ store, displayField: 'name', matchMode: 'startsWith' });

        const dropdown = (field as any)._dropdown;
        const showSpy  = vi.spyOn(dropdown, 'show');
        const hideSpy  = vi.spyOn(dropdown, 'hide');

        field.setValue('An');
        (field as any).querySuggestions('An');
        expect(showSpy.mock.calls[0][1]).toEqual(['Ant']);

        field.setValue('nt');
        (field as any).querySuggestions('nt');
        expect(showSpy).toHaveBeenCalledTimes(1);
        expect(hideSpy).toHaveBeenCalledTimes(1);
    });

    it("matches 'containsCaseSensitive' honouring case", () => {
        const store = makeStore([
            { id: '1', name: 'Apple' },
            { id: '2', name: 'Banana' },
            { id: '3', name: 'Ant' },
        ]);
        field = new AutoCompleteField({ store, displayField: 'name', matchMode: 'containsCaseSensitive' });

        const dropdown = (field as any)._dropdown;
        const showSpy  = vi.spyOn(dropdown, 'show');

        field.setValue('An');
        (field as any).querySuggestions('An');
        expect(showSpy.mock.calls[0][1]).toEqual(['Ant']);

        field.setValue('an');
        (field as any).querySuggestions('an');
        expect(showSpy.mock.calls[1][1]).toEqual(['Banana']);
    });

    it('caps the suggestion list at maxSuggestions, in store order', () => {
        const rows  = Array.from({ length: 20 }, (_, i) => ({ id: String(i), name: `Apple ${i}` }));
        const store = makeStore(rows);
        field = new AutoCompleteField({ store, displayField: 'name', maxSuggestions: 3 });

        const dropdown = (field as any)._dropdown;
        const showSpy  = vi.spyOn(dropdown, 'show');

        field.setValue('a');
        (field as any).querySuggestions('a');

        expect(showSpy).toHaveBeenCalledTimes(1);
        expect(showSpy.mock.calls[0][1]).toEqual(['Apple 0', 'Apple 1', 'Apple 2']);
    });

    it('hides instead of showing when nothing matches', () => {
        const store = makeStore(DEFAULT_ROWS);
        field = new AutoCompleteField({ store, displayField: 'name' });

        const dropdown = (field as any)._dropdown;
        const showSpy  = vi.spyOn(dropdown, 'show');
        const hideSpy  = vi.spyOn(dropdown, 'hide');

        field.setValue('zzz');
        (field as any).querySuggestions('zzz');

        expect(hideSpy).toHaveBeenCalledTimes(1);
        expect(showSpy).not.toHaveBeenCalled();
    });

    it('never suggests a record whose display field is null', () => {
        const store = makeStore([
            { id: '1', name: 'Banana' },
            { id: '2', name: null },
        ]);
        field = new AutoCompleteField({ store, displayField: 'name' });

        const dropdown = (field as any)._dropdown;
        const showSpy  = vi.spyOn(dropdown, 'show');

        field.setValue('n');
        (field as any).querySuggestions('n');

        expect(showSpy.mock.calls[0][1]).toEqual(['Banana']);
        expect(showSpy.mock.calls[0][1]).not.toContain('null');
    });

    it('answers synchronously and correctly for a 1,500-record store', () => {
        const rows = Array.from({ length: 1500 }, (_, i) => ({ id: String(i), name: `Item ${i}` }));
        rows.push({ id: '1500', name: 'Banana' });

        const store = makeStore(rows);
        field = new AutoCompleteField({ store, displayField: 'name' });

        const dropdown = (field as any)._dropdown;
        const showSpy  = vi.spyOn(dropdown, 'show');

        field.setValue('anan');
        (field as any).querySuggestions('anan');

        // querySuggestions is entirely synchronous for a store-backed field —
        // no await needed to observe the call.
        expect(showSpy).toHaveBeenCalledTimes(1);
        expect(showSpy.mock.calls[0][1]).toEqual(['Banana']);
    });

    it('discards a stale query whose string no longer matches the current value', () => {
        const store = makeStore(DEFAULT_ROWS);
        field = new AutoCompleteField({ store, displayField: 'name' });

        const dropdown = (field as any)._dropdown;
        const showSpy  = vi.spyOn(dropdown, 'show');
        const hideSpy  = vi.spyOn(dropdown, 'hide');

        field.setValue('ab');
        (field as any).querySuggestions('an');

        expect(showSpy).not.toHaveBeenCalled();
        expect(hideSpy).not.toHaveBeenCalled();
    });

    it('prefers static suggestions over a configured store, and never touches the store', () => {
        const store = makeStore(DEFAULT_ROWS);
        field = new AutoCompleteField({ suggestions: ['Apricot'], store, displayField: 'name' });

        const dropdown = (field as any)._dropdown;
        const showSpy  = vi.spyOn(dropdown, 'show');

        field.setValue('ap');
        (field as any).querySuggestions('ap');

        expect(showSpy.mock.calls[0][1]).toEqual(['Apricot']);
        expect(store.getActiveFilters()).toEqual([]);
    });
});

// autocomplete-store-query plan: the 200ms debounce and 150ms blur timers
// used the bare global setTimeout and were never cleared by destructor, so a
// field disposed mid-typing or just after blur fired a callback against
// released DOM handles. Both timers now route through DOM.sink and are
// cleared in destructor.
describe('AutoCompleteField timer teardown', () => {
    let field: AutoCompleteField | undefined;

    beforeEach(() => installTestDOM(CONFIG));
    afterEach(() => {
        field?.dispose();
        field = undefined;
        DOM.reset();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('fires nothing and throws nothing when disposed mid-debounce', () => {
        vi.useFakeTimers();

        field = new AutoCompleteField({ suggestions: ['Apple'] });
        field.setValue('a');
        (field as any).onInput();

        const querySpy = vi.spyOn(field as any, 'querySuggestions');

        field.dispose();

        expect(() => vi.advanceTimersByTime(500)).not.toThrow();
        expect(querySpy).not.toHaveBeenCalled();
    });

    it('fires no hide when disposed just after a blur', () => {
        vi.useFakeTimers();

        field = new AutoCompleteField({ suggestions: ['Apple'] });

        const dropdown = (field as any)._dropdown;
        const hideSpy  = vi.spyOn(dropdown, 'hide');

        (field as any).onBlur();
        field.dispose();

        expect(() => vi.advanceTimersByTime(500)).not.toThrow();
        expect(hideSpy).not.toHaveBeenCalled();
    });

    it('leaves undisposed debounce/blur behaviour unchanged', () => {
        vi.useFakeTimers();

        field = new AutoCompleteField({ suggestions: ['Apple'] });
        const querySpy = vi.spyOn(field as any, 'querySuggestions');

        field.setValue('a');
        (field as any).onInput();
        vi.advanceTimersByTime(200);

        expect(querySpy).toHaveBeenCalledTimes(1);

        const dropdown = (field as any)._dropdown;
        const hideSpy  = vi.spyOn(dropdown, 'hide');

        (field as any).onBlur();
        vi.advanceTimersByTime(150);

        expect(hideSpy).toHaveBeenCalledTimes(1);
    });

    it('leaves exactly one pending timer when a second blur arrives before the first elapses', () => {
        vi.useFakeTimers();

        field = new AutoCompleteField({ suggestions: ['Apple'] });

        const dropdown = (field as any)._dropdown;
        const hideSpy  = vi.spyOn(dropdown, 'hide');

        (field as any).onBlur();
        (field as any).onBlur();
        vi.advanceTimersByTime(150);

        expect(hideSpy).toHaveBeenCalledTimes(1);
    });

    it('schedules both timers through the DOM seam', () => {
        const sink = installTestDOM(CONFIG) as RecordingDOMSink;
        vi.useFakeTimers();

        field = new AutoCompleteField({ suggestions: ['Apple'] });

        field.setValue('a');
        (field as any).onInput();
        (field as any).onBlur();

        const setTimeoutWrites = sink.writes.filter(w => w.op === 'setTimeout');

        expect(setTimeoutWrites.filter(w => w.args[0] === 200)).toHaveLength(1);
        expect(setTimeoutWrites.filter(w => w.args[0] === 150)).toHaveLength(1);
    });

    it('still drives the existing paste-debounce test through the seam', () => {
        // Regression pin: the recording sink's setTimeout delegates to the
        // real global timer, so vi.advanceTimersByTime keeps driving it once
        // onInput routes through DOM.sink instead of the bare global.
        vi.useFakeTimers();

        field = new AutoCompleteField({ suggestions: ['Apple', 'Banana'], debounceMs: 50 });
        const querySpy = vi.spyOn(field as any, 'querySuggestions');

        field.setValue('an');
        (field as any).onInput();
        vi.advanceTimersByTime(50);

        expect(querySpy).toHaveBeenCalledTimes(1);
    });
});
