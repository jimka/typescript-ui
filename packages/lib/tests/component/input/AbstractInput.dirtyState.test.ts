// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

//
// Coverage for AbstractInput's adoption of Component's generic dirty-state
// mechanism: `notifyChange` compares the committed value against a stored
// clean baseline via the overridable `valuesEqual` hook (default `Object.is`,
// overridable for a TValue whose `getValue()` returns a fresh reference), and
// `markClean()` establishes (or re-establishes) that baseline — recursing
// into every composed AbstractInput child so a composite control's own
// baseline and its inner children's stay in sync. See
// plans/in-progress/abstract-input-dirty-state-adoption.md.
//
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AbstractInput } from '~/component/input/AbstractInput';
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

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

/**
 * Minimal concrete `AbstractInput<string>` probe using the default
 * `Object.is` comparator. `commit` stands in for a real subclass's
 * user-driven commit path (write the storage, then call `notifyChange`).
 */
class StringProbe extends AbstractInput<string> {
    private _value = "";

    getValue(): string {
        return this._value;
    }

    setValue(value: string): this {
        this._value = value;

        return this;
    }

    protected applyEnabled(_value: boolean): void {}
    protected applyReadOnly(_value: boolean): void {}

    commit(value: string): void {
        this._value = value;
        this.notifyChange(value);
    }
}

/**
 * `AbstractInput<string[]>` probe with a content-based `valuesEqual`
 * override, mirroring `MultiSelectList`'s — proves the override runs rather
 * than the inherited reference-equality default.
 */
class ArrayProbe extends AbstractInput<string[]> {
    private _value: string[] = [];

    getValue(): string[] {
        return this._value;
    }

    setValue(value: string[]): this {
        this._value = value;

        return this;
    }

    protected applyEnabled(_value: boolean): void {}
    protected applyReadOnly(_value: boolean): void {}

    protected valuesEqual(a: string[], b: string[] | undefined): boolean {
        if (b === undefined || a.length !== b.length) {
            return false;
        }

        return a.every((v, i) => v === b[i]);
    }

    commit(value: string[]): void {
        this._value = value;
        this.notifyChange(value);
    }
}

describe('AbstractInput dirty state — generic mechanism', () => {
    it('a freshly constructed probe that never calls markClean() reports isDirty() false', () => {
        expect(new StringProbe().isDirty()).toBe(false);
    });

    it('markClean() on a fresh probe leaves isDirty() false', () => {
        const probe = new StringProbe();

        probe.markClean();
        expect(probe.isDirty()).toBe(false);
    });

    it('committing a value different from the clean baseline makes isDirty() true', () => {
        const probe = new StringProbe();

        probe.markClean(); // baseline: ""
        probe.commit("hello");
        expect(probe.isDirty()).toBe(true);
    });

    it('committing back to the original clean value makes isDirty() false again', () => {
        const probe = new StringProbe();

        probe.markClean(); // baseline: ""
        probe.commit("hello");
        probe.commit("");
        expect(probe.isDirty()).toBe(false);
    });

    it('markClean() re-baselines at the current value', () => {
        const probe = new StringProbe();

        probe.commit("hello");
        probe.markClean(); // new baseline: "hello"

        probe.commit("hello");
        expect(probe.isDirty()).toBe(false);

        probe.commit("world");
        expect(probe.isDirty()).toBe(true);
    });

    it('the array-valued probe compares by content, not reference', () => {
        const probe = new ArrayProbe();

        probe.commit(["a"]);
        probe.markClean(); // baseline: ["a"]

        probe.commit(["a", "b"]);
        expect(probe.isDirty()).toBe(true);

        probe.commit(["a"]); // freshly allocated array, same contents
        expect(probe.isDirty()).toBe(false);
    });

    it('markClean() on a host recurses into a composed AbstractInput child', () => {
        const a = new StringProbe();
        const b = new StringProbe();
        a.addComponent(b);

        // Establish each one's own baseline.
        a.markClean();
        b.markClean();

        b.commit("changed");
        expect(b.isDirty()).toBe(true);
        expect(a.isDirty()).toBe(true); // relayed via Component's parent-to-child wiring

        a.markClean(); // not b.markClean()
        expect(a.isDirty()).toBe(false);
        expect(b.isDirty()).toBe(false);
    });

    it('notifyChange still fires change/binding, with isDirty() settled by the time "change" fires', () => {
        const probe = new StringProbe();
        probe.markClean();

        const fired: string[] = [];
        let dirtyDuringChange: boolean | undefined;

        probe.on('change', () => {
            fired.push('change');
            dirtyDuringChange = probe.isDirty();
        });
        probe.on('binding', () => fired.push('binding'));

        probe.commit("hello");

        expect(fired).toEqual(['change', 'binding']);
        expect(dirtyDuringChange).toBe(true);
    });
});
