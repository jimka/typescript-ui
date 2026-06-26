import { describe, it, expect } from 'vitest';
import { Component, ComponentOptions } from '~/core/Component';
import { Absolute } from '~/layout/Absolute';

// Subclass that seeds class-level defaults the way real subclasses do — through
// `subclassDefaults`, which land in `_defaultOptions`, never via a setter.
class Defaulted extends Component {
    constructor(options?: ComponentOptions) {
        super(options, {
            borderRadius: '4px',
            shadow:       '0 0 2px black',
            outline:      'none',
            border:       '2px solid red',
            overflow:     'auto',
        } as Partial<ComponentOptions>);
    }
}

describe('default options as pure fallback', () => {
    it('does not dispatch class defaults into the _options bag', () => {
        const c = new Component({}) as any;
        for (const key of ['cursor', 'padding', 'insets', 'maxSize', 'minSize',
                           'zIndex', 'borderRadius', 'shadow', 'pointerEvents',
                           'writingMode', 'layoutManager']) {
            expect(c._options[key], `_options.${key}`).toBeUndefined();
        }
        expect(c._border).toBeNull();
        expect(c._outline).toBeNull();
        expect(c._overflowX).toBeNull();
        expect(c._overflowY).toBeNull();
    });

    it('resolves base-class defaults through the getters', () => {
        const c = new Component({});
        expect(c.getCursor()).toBe('default');
        expect(c.getOverflowX()).toBe('hidden');
        expect(c.getOverflowY()).toBe('hidden');
        expect(c.isDisplayed()).toBe(true);
        const insets = c.getInsets();
        expect([insets.getTop(), insets.getRight(), insets.getBottom(), insets.getLeft()]).toEqual([0, 0, 0, 0]);
        // No base default for these — stay null until a subclass/caller supplies one.
        expect(c.getBorderRadius()).toBeNull();
        expect(c.getShadow()).toBeNull();
        expect(c.getPointerEvents()).toBeNull();
        expect(c.getWritingMode()).toBeNull();
        expect(c.getBorder()).toBeNull();
        expect(c.getOutline()).toBeNull();
    });

    it('resolves subclass defaults through the getters without a caller value', () => {
        const c = new Defaulted() as any;
        expect(c.getBorderRadius()).toBe('4px');
        expect(c.getShadow()).toBe('0 0 2px black');
        expect(c.getOutline()).toBe('none');
        expect(c.getOverflowX()).toBe('auto');
        // outline & overflow are pure fallbacks: the private field stays null,
        // the value comes from _defaultOptions.
        expect(c._outline).toBeNull();
        expect(c._overflowX).toBeNull();
        // Chrome fields (border/borderRadius/shadow) keep their default on the
        // dispatch path so clear*() can suppress an inherited default; they are
        // therefore present in _options / _border, not lazily resolved.
        expect(c._options.borderRadius).toBe('4px');
        expect(c._options.shadow).toBe('0 0 2px black');
        expect(c._border).not.toBeNull();
    });

    it('honors an explicit value equal to the default as explicit (key presence)', () => {
        const c = new Component({ cursor: 'default' }) as any;
        expect(c._options.cursor).toBe('default');
        expect(c.getCursor()).toBe('default');
    });

    it('keeps the bag free of default keys when only some fields are explicit', () => {
        const c = new Component({ cursor: 'pointer', zIndex: 5 }) as any;
        expect(c._options.cursor).toBe('pointer');
        expect(c._options.zIndex).toBe(5);
        expect(c._options.padding).toBeUndefined();
        expect(c._options.insets).toBeUndefined();
        expect(c._options.maxSize).toBeUndefined();
    });

    it('attaches the eased wheel scroller at render for a default-scrollable overflow', () => {
        const c = new Defaulted() as any;
        expect(c._wheelScroller).toBeFalsy();   // no setter fired
        c.getElement(true);                      // render -> applyStyle
        expect(c._wheelScroller).toBeTruthy();   // attached from the effective overflow
    });

    it('keeps the border default working (dispatched, layout sees its width)', () => {
        const c = new Defaulted() as any;
        // border stays dispatched, so the parsed border IS present and the
        // border-width path reports a non-zero pre-connect estimate.
        expect(c.getBorder()).not.toBeNull();
        const size = c.getBorderSize();
        expect(size.top).toBeGreaterThan(0);
    });

    it('lazily attaches the default layout manager exactly once', () => {
        const c = new Component({});
        const lm = c.getLayoutManager();
        expect(lm).toBeInstanceOf(Absolute);
        expect(lm.getContainer()).toBe(c);
        // Stable identity across repeated resolution — no re-detach/re-attach.
        expect(c.getLayoutManager()).toBe(lm);
        expect(c.getLayoutManager().getContainer()).toBe(c);
        expect(() => c.doLayout()).not.toThrow();
    });

    it('still honors an explicit layout manager', () => {
        const explicit = new Absolute();
        const c = new Component({ layoutManager: explicit });
        expect(c.getLayoutManager()).toBe(explicit);
        expect(explicit.getContainer()).toBe(c);
    });

    it('reads min/max as the raw author constraint, leaving the computed getter to fold layout', () => {
        const c = new Component({}) as any;
        // No author constraint supplied -> bag empty; computed getter still works.
        expect(c._options.minSize).toBeUndefined();
        expect(c._options.maxSize).toBeUndefined();
        expect(c.getMaxSize()).not.toBeUndefined();
    });
});
