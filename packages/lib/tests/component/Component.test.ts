import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Component } from '~/core/Component';
import { Insets } from '~/primitive/Insets';
import { UNBOUNDED } from '~/primitive/Size';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink, ruleStyleWrites } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { _ruleCacheHas, _ruleCacheKeys } from '~/core/StyleTarget';
import { Button } from '~/component/button/Button';
import { ThemeManager } from '~/core/Theme';
import { TextField } from '~/component/input/TextField';

const DOM_CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** Reads a component's two private size-change hook slots via a cast. */
function sizeHooks(component: Component): { _onPreferredSizeChange: unknown; _onConstraintSizeChange: unknown } {
    return component as unknown as { _onPreferredSizeChange: unknown; _onConstraintSizeChange: unknown };
}

describe('Component', () => {
    it('assigns a unique, non-empty id', () => {
        const a = new Component({});
        const b = new Component({});
        expect(a.getId()).toBeTruthy();
        expect(a.getId()).not.toBe(b.getId());
    });
    it('has an unset (NaN) width before sizing', () => {
        expect(Number.isNaN(new Component({}).getWidth())).toBe(true);
    });
    it('stores an explicit width', () => {
        const c = new Component({});
        c.setWidth(100);
        expect(c.getWidth()).toBe(100);
    });
    it('defaults insets to zero on every edge', () => {
        const insets = new Component({}).getInsets();
        expect(insets.getTop()).toBe(0);
        expect(insets.getRight()).toBe(0);
        expect(insets.getBottom()).toBe(0);
        expect(insets.getLeft()).toBe(0);
    });
    it('updates stored insets', () => {
        const c = new Component({});
        c.setInsets(new Insets(1, 2, 3, 4));
        expect(c.getInsets().getTop()).toBe(1);
    });
    it('stores and returns the background color', () => {
        const c = new Component({});
        c.setBackgroundColor('red');
        expect(c.getBackgroundColor()).toBe('red');
    });
    it('defaults visibility to null and reflects setVisible', () => {
        const c = new Component({});
        expect(c.isVisible()).toBe(null);
        c.setVisible(false);
        expect(c.isVisible()).toBe(false);
        c.setVisible(true);
        expect(c.isVisible()).toBe(true);
    });
    it('throws when setVisible receives a non-boolean truthy value', () => {
        const c = new Component({});
        expect(() => (c.setVisible as (v: unknown) => unknown)('foo')).toThrow('not a boolean');
    });
    it('registers a child via addComponent', () => {
        const parent = new Component({});
        const child  = new Component({});
        parent.addComponent(child);
        expect(child.getParentComponent()).toBe(parent);
    });
    it('throws when adding a child that already has a parent', () => {
        const child = new Component({});
        new Component({}).addComponent(child);
        expect(() => new Component({}).addComponent(child)).toThrow('already has a parent');
    });
    it('removes a child via removeComponent', () => {
        const parent = new Component({});
        const child  = new Component({});
        parent.addComponent(child);
        parent.removeComponent(child);
        expect(child.getParentComponent()).toBeFalsy();
    });
    it('setVisible(null) resets to inherit', () => {
        const c = new Component({});
        c.setVisible(false);
        c.setVisible(null);
        expect(c.isVisible()).toBeNull();
    });
});

describe('Component data-* size serialisation', () => {
    it('reflects the height term from h, not w (setMinSize)', () => {
        const c = new Component({});
        c.setMinSize({ width: 10, height: 20 });
        expect(c.getDataAttribute('minSize')).toBe('10px 20px');
    });
    it('reflects both terms for setMaxSize', () => {
        const c = new Component({});
        c.setMaxSize({ width: 10, height: 20 });
        expect(c.getDataAttribute('maxSize')).toBe('10px 20px');
    });
    it('reflects both terms for setPreferredSize', () => {
        const c = new Component({});
        c.setPreferredSize({ width: 10, height: 20 });
        expect(c.getDataAttribute('preferredSize')).toBe('10px 20px');
    });
    it('serialises an unbounded width term independently of the height', () => {
        const c = new Component({});
        c.setMaxSize({ width: UNBOUNDED, height: 20 });
        expect(c.getDataAttribute('maxSize')).toBe('inf 20px');
    });
    it('serialises an unbounded height term independently of the width', () => {
        const c = new Component({});
        c.setMaxSize({ width: 20, height: UNBOUNDED });
        expect(c.getDataAttribute('maxSize')).toBe('20px inf');
    });
    it('rounds fractional terms per axis', () => {
        const c = new Component({});
        c.setMinSize({ width: 10.4, height: 20.6 });
        expect(c.getDataAttribute('minSize')).toBe('10px 21px');
    });
});

describe('Component applyStyle data-maxSize serialisation', () => {
    beforeEach(() => installTestDOM(DOM_CONFIG));
    afterEach(() => { vi.restoreAllMocks(); DOM.reset(); });

    it('reflects data-maxSize per-axis when applyStyle runs on render', () => {
        const c = new Component({ maxSize: { width: 20, height: UNBOUNDED } });
        c.getElement(true);
        expect(c.getDataAttribute('maxSize')).toBe('20px inf');
    });
});

describe('Component size setters take a Size (size-setter-interface plan)', () => {
    beforeEach(() => installTestDOM(DOM_CONFIG));
    afterEach(() => { vi.restoreAllMocks(); DOM.reset(); });

    it('case 1: setPreferredSize(size) is reflected by getPreferredSize', () => {
        const c = new Component({});
        c.setPreferredSize({ width: 120, height: 32 });
        expect(c.getPreferredSize()).toEqual({ width: 120, height: 32 });
    });

    it('case 2: setMinSize(size) writes minWidth/minHeight and the data-minSize attribute', () => {
        const c = new Component({});
        c.getElement(true);
        c.setMinSize({ width: 180, height: 0 });

        const rows = ruleStyleWrites(DOM.sink as RecordingDOMSink);
        expect(rows.some((w) => w.key === 'minWidth' && w.value === '180px')).toBe(true);
        expect(rows.some((w) => w.key === 'minHeight' && w.value === '0px')).toBe(true);
        expect(c.getDataAttribute('minSize')).toBe('180px 0px');
    });

    it('case 3: setMaxSize(size) writes maxWidth "none" for UNBOUNDED and a px maxHeight', () => {
        const c = new Component({});
        c.getElement(true);
        c.setMaxSize({ width: UNBOUNDED, height: 24 });

        const rows = ruleStyleWrites(DOM.sink as RecordingDOMSink);
        expect(rows.some((w) => w.key === 'maxWidth' && w.value === 'none')).toBe(true);
        expect(rows.some((w) => w.key === 'maxHeight' && w.value === '24px')).toBe(true);
    });

    it('case 4: two value-equal but distinct Size objects fire onPreferredSizeChange once, not twice', () => {
        const c = new Component({});
        const onChange = vi.fn();
        sizeHooks(c)._onPreferredSizeChange = onChange;

        c.setPreferredSize({ width: 10, height: 10 });
        c.setPreferredSize({ width: 10, height: 10 });

        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('case 5: the stored preferred size is a copy, not an alias of the caller\'s object', () => {
        const c = new Component({});
        const s = { width: 10, height: 10 };
        c.setPreferredSize(s);
        s.width = 999;

        expect(c.getPreferredSize()!.width).toBe(10);
    });

    it('case 6: the options bag and the setter agree for preferredSize/minSize/maxSize', () => {
        const viaBag = new Component({
            preferredSize: { width: 200, height: 100 },
            minSize:       { width: 50,  height: 20 },
            maxSize:       { width: 300, height: 150 },
        });
        const viaSetter = new Component({})
            .setPreferredSize({ width: 200, height: 100 })
            .setMinSize({ width: 50, height: 20 })
            .setMaxSize({ width: 300, height: 150 });

        expect(viaBag.getPreferredSize()).toEqual(viaSetter.getPreferredSize());
        expect(viaBag.getMinSizeConstraint()).toEqual(viaSetter.getMinSizeConstraint());
        expect(viaBag.getMaxSizeConstraint()).toEqual(viaSetter.getMaxSizeConstraint());
    });

    it('case 7: all three setters return this, so calls chain', () => {
        const c = new Component({});
        const result = c.setMinSize({ width: 10, height: 10 }).setMaxSize({ width: 20, height: 20 });
        expect(result).toBe(c);
    });
});

describe('Component getMinSize / getMaxSize unification', () => {
    it('takes the tighter (larger) minimum per axis', () => {
        const c = new Component({});
        c.setMinSize({ width: 40, height: 40 });
        vi.spyOn(c.getLayoutManager(), 'getMinSize').mockReturnValue({ width: 30, height: 50 });
        expect(c.getMinSize()).toEqual({ width: 40, height: 50 });
    });
    it('takes the tighter (smaller) maximum per axis', () => {
        const c = new Component({});
        c.setMaxSize({ width: 100, height: 100 });
        vi.spyOn(c.getLayoutManager(), 'getMaxSize').mockReturnValue({ width: 120, height: 80 });
        expect(c.getMaxSize()).toEqual({ width: 100, height: 80 });
    });
    it('falls back to {0,0} when neither constraint nor manager reports a minimum', () => {
        const c = new Component({});
        vi.spyOn(c as unknown as { getMinSizeConstraint(): unknown }, 'getMinSizeConstraint').mockReturnValue(null);
        vi.spyOn(c.getLayoutManager(), 'getMinSize').mockReturnValue(null);
        expect(c.getMinSize()).toEqual({ width: 0, height: 0 });
    });
    it('falls back to {UNBOUNDED,UNBOUNDED} when neither constraint nor manager reports a maximum', () => {
        const c = new Component({});
        vi.spyOn(c as unknown as { getMaxSizeConstraint(): unknown }, 'getMaxSizeConstraint').mockReturnValue(null);
        vi.spyOn(c.getLayoutManager(), 'getMaxSize').mockReturnValue(null);
        expect(c.getMaxSize()).toEqual({ width: UNBOUNDED, height: UNBOUNDED });
    });
    it('returns a fresh object that does not alias the stored constraint', () => {
        const c = new Component({});
        c.setMinSize({ width: 40, height: 40 });
        vi.spyOn(c.getLayoutManager(), 'getMinSize').mockReturnValue(null);

        const min = c.getMinSize()!;
        min.width = 999;

        expect(c.getMinSizeConstraint()!.width).toBe(40);
    });
    it('returns the manager minimum as a fresh object when no constraint is set', () => {
        const c = new Component({});
        const managerMin = { width: 30, height: 50 };
        vi.spyOn(c as unknown as { getMinSizeConstraint(): unknown }, 'getMinSizeConstraint').mockReturnValue(null);
        vi.spyOn(c.getLayoutManager(), 'getMinSize').mockReturnValue(managerMin);

        const min = c.getMinSize()!;
        expect(min).toEqual({ width: 30, height: 50 });

        min.width = 999;
        expect(managerMin.width).toBe(30);
    });
});

describe('Component child lifecycle — wiring & teardown', () => {
    it('addComponent appends in order and returns this', () => {
        const parent = new Component({});
        const a = new Component({});
        const b = new Component({});
        expect(parent.addComponent(a)).toBe(parent);
        parent.addComponent(b);
        expect(parent.getComponents()).toEqual([a, b]);
    });
    it('re-adding a child already parented here is a no-op returning this', () => {
        const parent = new Component({});
        const a = new Component({});
        parent.addComponent(a);
        expect(parent.addComponent(a)).toBe(parent);
        expect(parent.getComponents()).toEqual([a]);
    });
    it('adding a child owned by another parent throws', () => {
        const a = new Component({});
        new Component({}).addComponent(a);
        expect(() => new Component({}).addComponent(a)).toThrow('already has a parent');
    });
    it('wires _parent even on an unrendered container', () => {
        const parent = new Component({});
        const a = new Component({});
        parent.addComponent(a);
        expect(a.getParentComponent()).toBe(parent);
    });
    it('fully unwires a removed child', () => {
        const parent = new Component({});
        const child  = new Component({});
        parent.addComponent(child);
        parent.removeComponent(child);

        const hooks = sizeHooks(child);
        expect(child.getParentComponent()).toBeNull();
        expect(hooks._onPreferredSizeChange).toBeNull();
        expect(hooks._onConstraintSizeChange).toBeNull();
        expect(parent.getComponents()).toEqual([]);
    });
    it('returns the registered constraints on remove and releases them', () => {
        const parent = new Component({});
        const child  = new Component({});
        const constraints = new LayoutConstraints();
        parent.addComponent(child, constraints);

        expect(parent.removeComponent(child)).toBe(constraints);
        expect(parent.getLayoutConstraints(child)).toBeUndefined();
    });
    it('does not re-enter the ex-parent when a removed child changes its constraints', () => {
        const parent = new Component({});
        const child  = new Component({});
        parent.addComponent(child);
        parent.removeComponent(child);

        const schedule = vi.spyOn(parent, 'scheduleLayout');
        child.setMinSize({ width: 5, height: 5 });
        child.setMaxSize({ width: 5, height: 5 });

        expect(schedule).not.toHaveBeenCalled();
    });
    it('fully unwires every child on removeAllComponents', () => {
        const parent = new Component({});
        const a = new Component({});
        const b = new Component({});
        parent.addComponent(a);
        parent.addComponent(b);
        parent.removeAllComponents();

        expect(parent.getComponents()).toEqual([]);

        for (const child of [a, b]) {
            const hooks = sizeHooks(child);
            expect(child.getParentComponent()).toBeNull();
            expect(hooks._onPreferredSizeChange).toBeNull();
            expect(hooks._onConstraintSizeChange).toBeNull();
        }
    });
    it('does not schedule a layout on removeAllComponents', () => {
        const parent = new Component({});
        parent.addComponent(new Component({}));

        const schedule = vi.spyOn(parent, 'scheduleLayout');
        parent.removeAllComponents();

        expect(schedule).not.toHaveBeenCalled();
    });
    it('does not re-enter the ex-parent when a removeAll-ed child changes its constraints', () => {
        const parent = new Component({});
        const child  = new Component({});
        parent.addComponent(child);
        parent.removeAllComponents();

        const schedule = vi.spyOn(parent, 'scheduleLayout');
        child.setMinSize({ width: 7, height: 7 });

        expect(schedule).not.toHaveBeenCalled();
    });
});

// Regression: destructor() must remove a component's per-instance stylesheet
// rule(s), or the shared `Base` sheet grows unbounded across a render/discard
// cycle (see plans/implemented/component-style-rule-disposal.md). Its own
// describe block with explicit install/reset hooks — does not rely on the
// nested-block hooks above.
describe('Component — destructor disposes style rules', () => {
    beforeEach(() => installTestDOM(DOM_CONFIG));
    afterEach(() => DOM.reset());

    it('evicts the component-scope rule from the style-rule cache and deletes it from the sink', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const c    = new Component({});
        c.getElement(true);   // render -> materialises _styleRule
        const id = c.getId();

        expect(_ruleCacheHas('#' + id)).toBe(true);

        (c as unknown as { destructor(): void }).destructor();

        expect(_ruleCacheHas('#' + id)).toBe(false);
        expect(_ruleCacheKeys().some((key) => key.startsWith('#' + id))).toBe(false);
        expect(sink.writes).toContainEqual({ op: 'deleteStyleRule', args: ['#' + id] });
    });

    it('evicts a rendered Button\'s deferred :hover/:active rules too', () => {
        const button = new Button({});
        button.getElement(true);   // render -> materialises _styleRule + deferred rules
        const id = button.getId();

        (button as unknown as { destructor(): void }).destructor();

        expect(_ruleCacheKeys().some((key) => key.startsWith('#' + id))).toBe(false);
    });
});

// Regression: a discarded onThemeChange disposer leaks the whole subtree it
// belongs to (see plans/implemented/theme-listener-teardown-leak.md). Proves
// the base `subscribeTheme` bag is populated and flushed by `destructor()`,
// that `setBorder` subscribes only once across repeated calls, and that
// `destructor()` recurses into `_components` so a discarded container's
// subscribing descendants are released too.
describe('Component — theme listener teardown', () => {
    beforeEach(() => installTestDOM(DOM_CONFIG));
    afterEach(() => DOM.reset());

    it('flushes a bordered component\'s theme subscription on destructor', () => {
        const base = ThemeManager._themeListenerCount();

        const c = new Component({ border: '1px solid red' });
        expect(ThemeManager._themeListenerCount()).toBe(base + 1);

        (c as unknown as { destructor(): void }).destructor();
        expect(ThemeManager._themeListenerCount()).toBe(base);
    });

    it('subscribes only once across repeated setBorder calls', () => {
        const c = new Component({});
        const b0 = ThemeManager._themeListenerCount();

        c.setBorder('1px solid red');
        c.setBorder('2px solid blue');

        expect(ThemeManager._themeListenerCount()).toBe(b0 + 1);
    });

    it('recurses into children so a discarded container releases their subscriptions too', () => {
        const base = ThemeManager._themeListenerCount();

        const parent = new Component({});
        parent.addComponent(new Component({ border: '1px solid red' }));
        expect(ThemeManager._themeListenerCount()).toBe(base + 1);

        (parent as unknown as { destructor(): void }).destructor();
        expect(ThemeManager._themeListenerCount()).toBe(base);
    });

    it('releases a surface component\'s (TextField) theme subscriptions on destructor', () => {
        const base = ThemeManager._themeListenerCount();

        // +2, not +1: TextInput's default `border` option (TextInput.ts:72)
        // dispatches setBorder during construction (Component's applyOptions
        // always-dispatches a class-default border), which folds its own
        // subscription into the bag, on top of TextField's own unconditional
        // updateHeight subscription.
        const t = new TextField({});
        expect(ThemeManager._themeListenerCount()).toBe(base + 2);

        (t as unknown as { destructor(): void }).destructor();
        expect(ThemeManager._themeListenerCount()).toBe(base);
    });
});
