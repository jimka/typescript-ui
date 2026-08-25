import { describe, it, expect, vi } from 'vitest';
import { Binding } from '~/core/Binding';
import { Model } from '~/data/Model';
import { ModelRecord } from '~/data/ModelRecord';
import type { BindingAccessors } from '~/core/Bindable';

/** Minimal stand-in for a bound widget: holds a value and notifies on change. */
class FakeWidget {
    private _value = '';
    private _listeners: Array<() => void> = [];

    getValue(): string {
        return this._value;
    }
    setValue(v: string): void {
        this._value = v;
    }
    /** Simulate a user edit that fires the registered change listener. */
    edit(v: string): void {
        this._value = v;
        this._listeners.forEach(fn => fn());
    }
    listen(fn: () => void): void {
        this._listeners.push(fn);
    }
}

const MODEL = new Model([{ name: 'name' }], 'name');

function accessors(w: FakeWidget): BindingAccessors<string> {
    return {
        get    : (): string => w.getValue(),
        set    : (v: string): void => w.setValue(v),
        listen : (fn: () => void): void => w.listen(fn),
    };
}

describe('Binding', () => {
    it('setRecord pushes field values into the bound accessor', () => {
        const w = new FakeWidget();
        const binding = new Binding().bind('name', w, accessors(w));
        binding.setRecord(new ModelRecord(MODEL, { name: 'Alice' }));
        expect(w.getValue()).toBe('Alice');
    });
    it('an accessor edit updates the record field', () => {
        const w = new FakeWidget();
        const record = new ModelRecord(MODEL, { name: 'Alice' });
        new Binding().bind('name', w, accessors(w)).setRecord(record);
        w.edit('Bob');
        expect(record.get('name')).toBe('Bob');
    });
    it('commit() commits the bound record', () => {
        const w = new FakeWidget();
        const record = new ModelRecord(MODEL, { name: 'Alice' });
        const binding = new Binding().bind('name', w, accessors(w));
        binding.setRecord(record);
        w.edit('Bob');
        binding.commit();
        expect(record.isDirty()).toBe(false);
        expect(record.get('name')).toBe('Bob');
    });
    it('reject() reverts field values', () => {
        const w = new FakeWidget();
        const record = new ModelRecord(MODEL, { name: 'Alice' });
        const binding = new Binding().bind('name', w, accessors(w));
        binding.setRecord(record);
        w.edit('Bob');
        binding.reject();
        expect(record.get('name')).toBe('Alice');
    });
    it('validate() returns true when no rules fail', () => {
        const w = new FakeWidget();
        const binding = new Binding().bind('name', w, accessors(w));
        binding.setRecord(new ModelRecord(MODEL, { name: 'Alice' }));
        expect(binding.validate()).toBe(true);
    });
    it('clearValidation() does not throw', () => {
        const binding = new Binding();
        expect(() => binding.clearValidation()).not.toThrow();
    });
});

describe('Binding.dispose()', () => {
    it('deactivates bound fields so a subsequent accessor edit is a no-op', () => {
        const w = new FakeWidget();
        const record = new ModelRecord(MODEL, { name: 'Alice' });
        const binding = new Binding().bind('name', w, accessors(w));
        binding.setRecord(record);

        binding.dispose();
        w.edit('Bob');

        expect(record.get('name')).toBe('Alice');
    });

    it('clears its own emitted-event bag so a subsequent commit() does not fire it', () => {
        const w = new FakeWidget();
        const record = new ModelRecord(MODEL, { name: 'Alice' });
        const binding = new Binding().bind('name', w, accessors(w));
        binding.setRecord(record);

        const onCommit = vi.fn();
        binding.on('commit', onCommit);

        binding.dispose();
        binding.commit();

        expect(onCommit).not.toHaveBeenCalled();
    });

    it('is idempotent, including with no bound fields and no listeners', () => {
        const binding = new Binding();

        binding.dispose();

        expect(() => binding.dispose()).not.toThrow();
    });
});
