import { describe, it, expect, vi } from 'vitest';
import { Binding } from '~/core/Binding';
import { Model } from '~/data/Model';
import { ModelRecord } from '~/data/ModelRecord';
import type { BindingAccessors } from '~/core/Bindable';
import { TextField } from '~/component/input/TextField';
import { MultiSelectList } from '~/component/list/MultiSelectList';

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

describe('Binding — AbstractInput presentation-dirty integration', () => {
    it('commit() clears a short-form-bound TextField\'s dirty flag after a user edit', () => {
        const textField = new TextField();
        const binding = new Binding().bind('name', textField);
        const record = new ModelRecord(MODEL, { name: 'Alice' });
        binding.setRecord(record);

        textField.setText('Bob');
        (textField as any).notifyChange(textField.getValue());

        expect(textField.isDirty()).toBe(true);
        expect(record.get('name')).toBe('Bob');

        binding.commit();
        expect(textField.isDirty()).toBe(false);
    });

    it('reject() clears a short-form-bound TextField\'s dirty flag and reverts its value', () => {
        const textField = new TextField();
        const binding = new Binding().bind('name', textField);
        const record = new ModelRecord(MODEL, { name: 'Alice' });
        binding.setRecord(record);

        textField.setText('Bob');
        (textField as any).notifyChange(textField.getValue());

        binding.reject();

        expect(textField.isDirty()).toBe(false);
        expect(textField.getValue()).toBe('Alice');
    });

    it('the existing long-form FakeWidget cases are unaffected — markClean?.() is a no-op when absent', () => {
        const w = new FakeWidget();
        const record = new ModelRecord(MODEL, { name: 'Alice' });
        const binding = new Binding().bind('name', w, accessors(w));
        binding.setRecord(record);
        w.edit('Bob');

        expect(() => binding.commit()).not.toThrow();
        expect(() => binding.reject()).not.toThrow();
    });

    it('a long-form bind() whose component is an AbstractInput still gets auto-wired markClean', () => {
        const TAG_MODEL = new Model([{ name: 'tags' }], 'tags');
        const tagList = MultiSelectList({ items: ['urgent', 'review', 'docs'] });
        const binding = new Binding().bind('tags', tagList, {
            get:    () => tagList.getValue(),
            set:    (v: unknown) => tagList.setValues(v ? String(v).split(',').filter(Boolean) : []),
            listen: (fn) => tagList.on('binding', fn),
        });
        const record = new ModelRecord(TAG_MODEL, { tags: 'urgent,review' });
        binding.setRecord(record);

        tagList.setValues(['docs']);
        (tagList as any).notifyChange(tagList.getValue());

        expect(tagList.isDirty()).toBe(true);

        binding.commit();
        expect(tagList.isDirty()).toBe(false);
    });
});
