// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Same-value early returns on `Component`'s typed setters. Each case calls a
 * setter once to establish the value, clears the recorded writes, then calls
 * it again with an equal value and asserts the second call reached the DOM
 * sink not at all — the setter's side effects (the style write, a cache
 * invalidation, an attribute write, a `scheduleLayout()`) skipped along with
 * the assignment. The complementary half of every case asserts a genuinely
 * changed value still writes, because a guard that swallows a real change is
 * the only way this optimisation can go wrong.
 *
 * See plans/implemented/component-setter-guards.md.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Component } from '~/core/Component';
import { Insets } from '~/primitive/Insets';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { FieldDecorator } from '~/validation/FieldDecorator';
import { installTestDOM, RecordingDOMSink, ruleStyleWrites } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import type { StyleBag } from '~/core/ClassStyleRules';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

let sink: RecordingDOMSink;

beforeEach(() => { sink = installTestDOM(CONFIG); });
afterEach(() => { vi.restoreAllMocks(); DOM.reset(); });

/**
 * Exposes the two protected seams these cases drive directly: the value-class
 * tier (behaviour 15), the cached-border-spec escape hatch the two-cache
 * `setBorder` guard exists for (behaviour 9), and `render()`, which is how a
 * re-render is provoked offline (see tests/component/element-release.test.ts).
 */
class GuardProbe extends Component {
    cacheSpec(options: Parameters<Component['setBorder']>[0]): void {
        this.cacheBorderSpec(options);
    }

    valueState(prefix: string, cssValue: string, patch: StyleBag): void {
        this.setValueStyleState(prefix, cssValue, patch);
    }

    rerender(): Handle {
        return this.render();
    }
}

/** A materialised probe with its recorded writes already cleared. */
function probe(): GuardProbe {
    const component = new GuardProbe({});

    component.getElement(true);
    sink.writes.length = 0;

    return component;
}

/** Every inline-style key the sink recorded on an `apply` patch. */
function inlineStyleKeys(recorder: RecordingDOMSink): string[] {
    const keys: string[] = [];

    for (const write of recorder.writes) {
        if (write.op !== 'apply') {
            continue;
        }

        const style = (write.args[1] as { style?: Record<string, string | null> }).style;

        if (style) {
            keys.push(...Object.keys(style));
        }
    }

    return keys;
}

/** Every value the sink recorded for attribute `name` on an `apply` patch. */
function attributeWrites(recorder: RecordingDOMSink, name: string): string[] {
    const values: string[] = [];

    for (const write of recorder.writes) {
        if (write.op !== 'apply') {
            continue;
        }

        const setAttr = (write.args[1] as { setAttr?: Record<string, string> }).setAttr;

        if (setAttr && name in setAttr) {
            values.push(setAttr[name]);
        }
    }

    return values;
}

/** Every class token the sink recorded as added on an `apply` patch. */
function addedClasses(recorder: RecordingDOMSink): string[] {
    const tokens: string[] = [];

    for (const write of recorder.writes) {
        if (write.op !== 'apply') {
            continue;
        }

        const patch = write.args[1] as { addClass?: string[] };

        tokens.push(...(patch.addClass ?? []));
    }

    return tokens;
}

/** The recorded rule declarations whose key starts with `prefix`, selector dropped. */
function ruleWritesFor(recorder: RecordingDOMSink, prefix: string): Array<{ key: string; value: string | null }> {
    return ruleStyleWrites(recorder)
        .filter(row => row.key.startsWith(prefix))
        .map(row => ({ key: row.key, value: row.value }));
}

describe('Component.setTransform — same-value guard', () => {
    it('writes nothing on a repeat of the transform it already holds', () => {
        const component = probe();

        component.setTransform('translateY(-1px)');
        sink.writes.length = 0;

        component.setTransform('translateY(-1px)');

        expect(ruleStyleWrites(sink)).toHaveLength(0);
    });

    it('still writes a genuinely different transform', () => {
        const component = probe();

        component.setTransform('translateY(-1px)');
        sink.writes.length = 0;

        component.setTransform('translateY(-2px)');

        expect(ruleWritesFor(sink, 'transform')).toEqual([{ key: 'transform', value: 'translateY(-2px)' }]);
        expect(component.getTransform()).toBe('translateY(-2px)');
    });
});

describe('Component.setClipPath — cache and guard', () => {
    it('reports null before any call, and the last value set afterwards', () => {
        const component = probe();

        expect(component.getClipPath()).toBeNull();

        component.setClipPath('inset(0 100% 0 0)');

        expect(component.getClipPath()).toBe('inset(0 100% 0 0)');

        component.setClipPath(null);

        expect(component.getClipPath()).toBeNull();
    });

    it('writes nothing on a repeat of the clip path it already holds', () => {
        const component = probe();

        component.setClipPath('inset(0 100% 0 0)');
        sink.writes.length = 0;

        component.setClipPath('inset(0 100% 0 0)');

        expect(ruleStyleWrites(sink)).toHaveLength(0);
    });

    it('writes nothing when clearing a clip path that was never set', () => {
        const component = probe();

        component.setClipPath(null);

        expect(ruleStyleWrites(sink)).toHaveLength(0);
    });

    it('still writes a genuinely different clip path', () => {
        const component = probe();

        component.setClipPath('inset(0 100% 0 0)');
        sink.writes.length = 0;

        component.setClipPath('inset(0 50% 0 0)');

        expect(ruleWritesFor(sink, 'clipPath')).toEqual([{ key: 'clipPath', value: 'inset(0 50% 0 0)' }]);
    });
});

describe('Component.setOpacity — same-value guard', () => {
    it('writes nothing on a repeat of the opacity it already holds', () => {
        const component = probe();

        component.setOpacity(0.5);
        sink.writes.length = 0;

        component.setOpacity(0.5);

        expect(inlineStyleKeys(sink)).toHaveLength(0);
    });

    it('still writes a fully transparent opacity after a fully opaque one', () => {
        const component = probe();

        component.setOpacity(1);
        sink.writes.length = 0;

        component.setOpacity(0);

        expect(inlineStyleKeys(sink)).toContain('opacity');
        expect(component.getOpacity()).toBe(0);
    });

    it('replays the guarded opacity onto a re-rendered element', () => {
        const component = probe();

        component.setOpacity(0.5);
        component.setOpacity(0.5);
        sink.writes.length = 0;

        component.rerender();

        expect(inlineStyleKeys(sink)).toContain('opacity');
    });
});

describe('Component.setWritingMode — same-value guard', () => {
    it('writes nothing on a repeat of the writing mode it already holds', () => {
        const component = probe();

        component.setWritingMode('sideways-rl');
        sink.writes.length = 0;

        component.setWritingMode('sideways-rl');

        expect(inlineStyleKeys(sink)).toHaveLength(0);
    });

    it('still removes the property when cleared after a guarded repeat', () => {
        const component = probe();

        component.setWritingMode('sideways-rl');
        component.setWritingMode('sideways-rl');
        sink.writes.length = 0;

        component.clearWritingMode();

        expect(inlineStyleKeys(sink)).toContain('writingMode');
        expect(component.getWritingMode()).toBeNull();
    });
});

describe('Component.setBackgroundImage — same-value guard', () => {
    it('writes nothing on a repeat of the background image it already holds', () => {
        const component = probe();

        component.setBackgroundImage('url(a.png)');
        sink.writes.length = 0;

        component.setBackgroundImage('url(a.png)');

        expect(ruleStyleWrites(sink)).toHaveLength(0);
    });

    it('still writes a genuinely different background image', () => {
        const component = probe();

        component.setBackgroundImage('url(a.png)');
        sink.writes.length = 0;

        component.setBackgroundImage('url(b.png)');

        expect(ruleWritesFor(sink, 'backgroundImage')).toEqual([{ key: 'backgroundImage', value: 'url(b.png)' }]);
    });
});

describe('Component outline guards', () => {
    it('writes nothing across ten clears on a component that has no outline', () => {
        const component = probe();

        // Ten, matching the review's own proof target: ten error-free
        // `clearError()` calls must reach the stylesheet zero times.
        for (let call = 0; call < 10; call++) {
            component.clearOutline();
        }

        expect(ruleStyleWrites(sink)).toHaveLength(0);
    });

    it('writes nothing on a repeat of the outline it already holds', () => {
        const component = probe();

        component.setOutline('2px solid blue');
        sink.writes.length = 0;

        component.setOutline('2px solid blue');

        expect(ruleStyleWrites(sink)).toHaveLength(0);
    });

    it('still paints and removes the outline across a FieldDecorator error round trip', () => {
        const parent = new Component({});
        const field  = new Component({});

        parent.addComponent(field);
        parent.getElement(true);

        const decorator = new FieldDecorator(field, parent);
        decorator.getElement(true);
        sink.writes.length = 0;

        decorator.showError('required');

        expect(ruleWritesFor(sink, 'outline').map(row => row.value)).toEqual([
            '2px solid var(--ts-ui-validation-error-border)'
        ]);

        sink.writes.length = 0;

        decorator.clearError();

        expect(ruleWritesFor(sink, 'outline').map(row => row.value)).toEqual([null]);

        sink.writes.length = 0;

        decorator.clearError();

        expect(ruleWritesFor(sink, 'outline')).toHaveLength(0);
    });
});

describe('Component.setBorder — two-cache guard', () => {
    it('writes the four longhands once across two equal-valued calls', () => {
        const component = probe();

        component.setBorder({ border: '1px solid red' });

        expect(ruleWritesFor(sink, 'border')).toHaveLength(4);

        sink.writes.length = 0;

        component.setBorder({ border: '1px solid red' });

        expect(ruleStyleWrites(sink)).toHaveLength(0);
    });

    it('writes nothing for a different spec object that resolves to the same four sides', () => {
        const component = probe();

        component.setBorder({ border: '1px solid red' });
        sink.writes.length = 0;

        component.setBorder({
            border:       '1px solid red',
            borderTop:    '1px solid red',
            borderRight:  '1px solid red',
            borderBottom: '1px solid red',
            borderLeft:   '1px solid red',
        });

        expect(ruleStyleWrites(sink)).toHaveLength(0);
    });

    it('still writes the CSS when only the cached spec already matches', () => {
        const component = probe();

        component.setBorder('1px solid red');
        sink.writes.length = 0;

        // `cacheBorderSpec` moves `_border` without writing CSS, so the two
        // caches disagree and the guard must not fire.
        component.cacheSpec('2px solid blue');
        component.setBorder('2px solid blue');

        expect(ruleWritesFor(sink, 'border')).toHaveLength(4);
    });

    it('leaves the cached border widths intact across a guarded repeat', () => {
        const component = probe();

        component.setBorder('3px solid red');

        const widths = { ...component.getBorderSize() };

        component.setBorder({ border: '3px solid red' });

        expect(component.getBorderSize()).toEqual(widths);
    });
});

describe('Component.setSize — same-value guard', () => {
    it('writes no geometry and schedules no layout at the size it already holds', () => {
        const component = probe();

        component.setSize({ width: 200, height: 100 });

        const scheduled = vi.spyOn(component, 'scheduleLayout');
        sink.writes.length = 0;

        component.setSize({ width: 200, height: 100 });

        expect(inlineStyleKeys(sink)).toHaveLength(0);
        expect(scheduled).not.toHaveBeenCalled();
    });

    it('writes geometry, schedules a layout and fires sizechange once on a real change', () => {
        const component = probe();

        component.setSize({ width: 200, height: 100 });

        const fired: Array<[number, number]> = [];
        component.onSizeChange((width, height) => fired.push([width, height]));

        const scheduled = vi.spyOn(component, 'scheduleLayout');
        sink.writes.length = 0;

        component.setSize({ width: 220, height: 120 });

        expect(inlineStyleKeys(sink)).toEqual(expect.arrayContaining(['width', 'height']));
        expect(scheduled).toHaveBeenCalled();
        expect(fired).toEqual([[220, 120]]);
    });

    it('never skips the first size, which is committed over NaN', () => {
        const component = probe();

        expect(Number.isNaN(component.getWidth())).toBe(true);

        component.setSize({ width: 1280, height: 800 });

        expect(component.getWidth()).toBe(1280);
        expect(component.getHeight()).toBe(800);
        expect(inlineStyleKeys(sink)).toEqual(expect.arrayContaining(['width', 'height']));
    });
});

describe('Component insets guards', () => {
    it('writes no data-insets attribute for an equal-valued Insets', () => {
        const component = probe();

        component.setInsets(new Insets(4, 8, 4, 8));
        sink.writes.length = 0;

        component.setInsets(new Insets(4, 8, 4, 8));

        expect(attributeWrites(sink, 'data-insets')).toHaveLength(0);
        expect(component.getInsets().render()).toBe(new Insets(4, 8, 4, 8).render());
    });

    it('still writes the attribute when a side changes', () => {
        const component = probe();

        component.setInsets(new Insets(4, 8, 4, 8));
        sink.writes.length = 0;

        component.setInsets(new Insets(4, 8, 6, 8));

        expect(attributeWrites(sink, 'data-insets')).toHaveLength(1);
        expect(component.getInsets().getBottom()).toBe(6);
    });

    it('writes nothing when clearing insets that are already zero', () => {
        const component = probe();

        component.clearInsets();
        sink.writes.length = 0;

        component.clearInsets();

        expect(attributeWrites(sink, 'data-insets')).toHaveLength(0);
    });
});

describe('Component.setValueStyleState — same-token guard', () => {
    it('writes no class patch when the token is already applied', () => {
        const component = probe();

        component.valueState('bg', 'red', { backgroundColor: 'red' });
        sink.writes.length = 0;

        component.valueState('bg', 'red', { backgroundColor: 'red' });

        expect(sink.writes.filter(write => write.op === 'apply')).toHaveLength(0);
    });

    it('still swaps the token when the value changes', () => {
        const component = probe();

        component.valueState('bg', 'red', { backgroundColor: 'red' });
        sink.writes.length = 0;

        component.valueState('bg', 'blue', { backgroundColor: 'blue' });

        expect(addedClasses(sink)).toContain('bgblue');
    });

    it('replays a token recorded before the element existed at first render', () => {
        const component = new GuardProbe({});

        component.valueState('bg', 'red', { backgroundColor: 'red' });
        component.valueState('bg', 'red', { backgroundColor: 'red' });
        sink.writes.length = 0;

        component.getElement(true);

        expect(addedClasses(sink)).toContain('bgred');
    });
});
