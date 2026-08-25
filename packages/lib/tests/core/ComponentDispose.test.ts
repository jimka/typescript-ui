// Coverage for the public Component.dispose() seam: an owner that holds a
// component outside `_components` (a privately-held child, a factory-built
// placeholder) previously had no way to reach the protected `destructor()`
// and TS2446 stopped it from calling one either. `dispose()` promotes the
// existing `WindowBorder`-style `dispose() { this.destructor(); }` pattern
// into the base class so every teardown path — in-tree or not — funnels
// through the same full-destroy contract.
//
// "New rule-cache keys" mirrors AbstractWindow.styleRuleDisposal.test.ts: the
// StyleTarget rule cache is module state that outlives DOM.reset(), so every
// assertion diffs against a snapshot taken immediately before the component
// under test was constructed rather than asserting an absolute count.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Component } from '~/core/Component';
import { Container } from '~/core/Container';
import { Tab } from '~/layout/Tab';
import { TabBar } from '~/component/container/TabBar';
import { ScrollStrip } from '~/component/container/ScrollStrip';
import { Button } from '~/component/button/Button';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
import { Animation } from '~/core/Animation';
import { createSpinnerWrap } from '~/component/display/SpinnerWrap';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { _ruleCacheKeys } from '~/core/StyleTarget';
import { ListenerBag } from '~/core/ListenerBag';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

/** Snapshots the module rule cache's current keys, for a before/after diff. */
function ruleSnapshot(): Set<string> {
    return new Set(_ruleCacheKeys());
}

// The framework-wide rule (plans/implemented/class-scoped-style-rules.md) is
// permanent, module-scoped state, created once per process and never
// disposed — so the first test in the whole run to render any `Component`
// legitimately sees it appear relative to its `before` snapshot. It is not a
// leak: excluded here the same way pre-existing module state is.
const FRAMEWORK_SELECTOR = ':where(.ts-ui-component)';

// `TabButton`'s busy overlay registers its `.TabBusyIndicator` geometry rule
// the same way (module-level, first-use, never disposed — see TabButton.ts's
// `ensureBusyIndicatorClassRule`). The "closes mid-build" test below is the
// first in this file to mark a tab busy, so it legitimately sees this appear
// too; not a per-instance leak, excluded for the same reason as the framework
// selector above.
const BUSY_INDICATOR_SELECTOR = '.TabBusyIndicator';

// `Component`'s own `.invisible` declared state (state-tier dedup plan,
// component-setvisible-state-tier-dedup.md) is resolved — and its shared
// `.ts-ui-component.invisible` class rule materialised — by `styleLayers()`
// on every render, regardless of whether the instance is ever hidden: the
// same eager, once-per-class, module-scoped creation every class-tier rule
// uses. Since `Component` is the root, whichever test in this file renders
// any `Component` first legitimately sees it appear; not a per-instance leak.
const INVISIBLE_STATE_SELECTOR = '.ts-ui-component.invisible';

// `ProgressSpinnerArc`'s ring geometry (border/borderRadius) is likewise a
// module-scoped, first-use, never-disposed class rule (misc-component-css-dedup.md)
// — the same shape as `.TabBusyIndicator` above. The spinner-disposal test
// below is this file's first render of a `ProgressSpinner`, so it legitimately
// sees this appear; not a per-instance leak.
const PROGRESS_SPINNER_ARC_SELECTOR = '.ProgressSpinnerArc';

/** Rule-cache keys present now that were absent from `before`, excluding permanent shared rules. */
function leakedKeys(before: Set<string>): string[] {
    return _ruleCacheKeys().filter((key) =>
        !before.has(key) && key !== FRAMEWORK_SELECTOR && key !== BUSY_INDICATOR_SELECTOR && key !== INVISIBLE_STATE_SELECTOR
        && key !== PROGRESS_SPINNER_ARC_SELECTOR);
}

/**
 * Recursively collects a component's own id plus every registered
 * descendant's id (via `getComponents()`), plus the ids of any extra
 * subtrees passed in — for components that raw-append pieces outside
 * `_components` (see the TabBar test below).
 */
function collectIds(c: Component, extraSubtrees: Component[] = []): string[] {
    const ids = [c.getId()];

    for (const child of c.getComponents()) {
        ids.push(...collectIds(child));
    }

    for (const extra of extraSubtrees) {
        ids.push(...collectIds(extra));
    }

    return ids;
}

describe('Component.dispose()', () => {

    it('tears a rendered component with children down completely', () => {
        const before = ruleSnapshot();

        const c = new Component({});
        c.addComponent(new Component({}));
        c.getElement(true);

        expect(_ruleCacheKeys().length).toBeGreaterThan(before.size);

        c.dispose();

        expect(leakedKeys(before)).toEqual([]);
    });

    it('is idempotent: a second call is a harmless no-op', () => {
        const before = ruleSnapshot();

        const c = new Component({});
        c.getElement(true);
        c.dispose();

        expect(() => c.dispose()).not.toThrow();
        expect(leakedKeys(before)).toEqual([]);
    });

    it('does not throw on a never-rendered component, and adds/removes no keys', () => {
        const before = ruleSnapshot();

        const c = new Component({});

        expect(() => c.dispose()).not.toThrow();
        expect(leakedKeys(before)).toEqual([]);
    });

    it('tears down a component held only in a private field, not registered as a child', () => {
        // The case `removeComponent` cannot reach: the owner never put this
        // component into its own `_components` list.
        class Owner extends Component {
            // `backgroundColor` is a conditional declaration, never hoisted onto
            // the class rule, so it is what gives this component a per-instance
            // `#id` rule to leak in the first place — a stock component now
            // materialises none at all.
            private readonly held: Component = new Component({ backgroundColor: '#fff' });

            renderHeld(): void {
                this.held.getElement(true);
            }

            disposeHeld(): void {
                this.held.dispose();
            }
        }

        const before = ruleSnapshot();

        const owner = new Owner({});
        owner.renderHeld();

        expect(_ruleCacheKeys().length).toBeGreaterThan(before.size);

        owner.disposeHeld();

        expect(leakedKeys(before)).toEqual([]);
    });

    it('reaches a registered child\'s destructor() override when the ancestor is disposed', () => {
        // The contract a review found broken: `Component.destructor()` recurses
        // into children via `child.destructor()`, not `child.dispose()`, so a
        // subclass's own teardown logic MUST live on `destructor()` — never
        // `dispose()` — to run when reached as a descendant of some ancestor's
        // own teardown, rather than only when `dispose()` is called on it
        // directly. `CleanupChild` models the correct (post-fix) pattern every
        // library `dispose()` override was moved onto.
        let childCleanupRan = false;

        class CleanupChild extends Component {
            protected destructor(): void {
                childCleanupRan = true;
                super.destructor();
            }
        }

        const parent = new Component({});
        const child = new CleanupChild({});

        parent.addComponent(child);
        parent.getElement(true);

        parent.dispose();

        expect(childCleanupRan).toBe(true);
    });

    it('runs an onDestroy callback when the component is disposed', () => {
        const c = new Component({});
        let ran = false;

        c.onDestroy(() => { ran = true; });
        c.dispose();

        expect(ran).toBe(true);
    });

    it('runs onDestroy callbacks in registration order, and only once even across a second dispose()', () => {
        const c = new Component({});
        const order: number[] = [];

        c.onDestroy(() => order.push(1));
        c.onDestroy(() => order.push(2));
        c.dispose();
        c.dispose();

        expect(order).toEqual([1, 2]);
    });

    it('reaches a descendant\'s onDestroy callback when an ancestor is disposed', () => {
        // Mirrors "reaches a registered child's destructor() override" below —
        // `onDestroy` is the public, module-external counterpart of the same
        // recursive teardown contract (e.g. Tooltip.attach's auto-detach).
        const parent = new Component({});
        const child = new Component({});
        let ran = false;

        parent.addComponent(child);
        child.onDestroy(() => { ran = true; });
        parent.getElement(true);

        parent.dispose();

        expect(ran).toBe(true);
    });

    it('registerListenerBag clears the bag on destroy, releasing every listener', () => {
        const c = new Component({});
        const bag = new ListenerBag<'a'>();
        let calls = 0;

        (c as unknown as { registerListenerBag<T extends string>(b: ListenerBag<T>): ListenerBag<T> })
            .registerListenerBag(bag);
        bag.add('a', () => { calls += 1; });

        c.dispose();

        bag.fire('a');
        expect(calls).toBe(0);
        expect(bag.get('a')).toEqual([]);
    });

    it('runs a registered child\'s destructor() override exactly once', () => {
        // Regression for the double-teardown class a review found in
        // AbstractChart / VideoPlayer / MarkdownEditor: each explicitly tore
        // down a field (`_legend.dispose()`, `_video.dispose()`,
        // `_codeEditor.dispose()`) that was ALSO registered via
        // `addComponent`, so the child's `destructor()` ran twice — once
        // from the explicit call, once from `super.destructor()`'s
        // recursion below it. The boolean flag the test above checks can't
        // catch a double run; this counts invocations instead.
        let destructorRunCount = 0;

        class CountingChild extends Component {
            protected destructor(): void {
                destructorRunCount++;
                super.destructor();
            }
        }

        const parent = new Component({});
        const child = new CountingChild({});

        parent.addComponent(child);
        parent.getElement(true);

        parent.dispose();

        expect(destructorRunCount).toBe(1);
    });
});

describe('Animation.materialize — spinner and stale-result disposal', () => {
    let rafQueue: FrameRequestCallback[] = [];

    beforeEach(() => {
        rafQueue = [];
        vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((cb) => {
            rafQueue.push(cb);
            return rafQueue.length;
        });
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    /** Drains every rAF callback queued so far, including ones queued by earlier callbacks. */
    function flushRaf(): void {
        while (rafQueue.length > 0) {
            const queued = rafQueue.splice(0);
            for (const cb of queued) {
                cb(0);
            }
        }
    }

    it('disposes the spinner wrap once the cross-fade completes', () => {
        const host = new Container();
        host.getElement(true);

        // Render the real spinner wrap standalone first so its own rule keys
        // (the wrap plus ProgressSpinner's own subtree — "three components")
        // can be isolated from the materialized content's keys, which are
        // *meant* to survive — only the spinner is torn down here.
        const spinnerBefore = ruleSnapshot();
        const spinner = createSpinnerWrap();
        spinner.getElement(true);
        const spinnerKeys = leakedKeys(spinnerBefore);

        expect(spinnerKeys.length).toBeGreaterThan(0);

        Animation.materialize({
            host,
            factory:          () => new Component(),
            spinnerComponent: spinner,
        });

        // materialize's own two-rAF yield, then play()'s two-rAF yield for its
        // `from` styles (play() is only reached once the factory has settled).
        flushRaf();
        flushRaf();

        // No transitionend fires offline; play()'s setTimeout fallback is what
        // guarantees onComplete runs (see Animation.play's fallback comment).
        vi.advanceTimersByTime(300);

        expect(host.getComponents()).not.toContain(spinner);

        const stillPresent = spinnerKeys.filter((key) => _ruleCacheKeys().includes(key));
        expect(stillPresent).toEqual([]);
    });

    it('disposes both the spinner and the built-but-discarded component when the caller went stale', () => {
        const host = new Container();
        host.getElement(true);

        const spinnerBefore = ruleSnapshot();
        const spinner = createSpinnerWrap();
        spinner.getElement(true);
        const spinnerKeys = leakedKeys(spinnerBefore);

        let builtKeys: string[] = [];

        Animation.materialize({
            host,
            factory: () => {
                // Force this component to materialise a rule before it is
                // discarded, mirroring the footnote case: a factory that
                // renders its own tree during construction.
                const builtBefore = ruleSnapshot();
                const built = new Component();
                built.getElement(true);
                builtKeys = leakedKeys(builtBefore);

                return built;
            },
            spinnerComponent: spinner,
            isStale:          () => true,
        });

        flushRaf();

        expect(host.getComponents()).toEqual([]);

        const stillPresent = [...spinnerKeys, ...builtKeys]
            .filter((key) => _ruleCacheKeys().includes(key));
        expect(stillPresent).toEqual([]);
    });
});

describe('Tab — spinner disposal when a lazy tab closes mid-build', () => {
    let rafQueue: FrameRequestCallback[] = [];

    beforeEach(() => {
        rafQueue = [];
        vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((cb) => {
            rafQueue.push(cb);
            return rafQueue.length;
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('leaves zero new rule-cache keys when the tab closes while its build is in flight', () => {
        const tab  = new Tab();
        const host = new Container({ layoutManager: tab });

        host.getElement(true);

        host.addComponent(
            () => new Promise<Component>(() => {}),   // never settles
            Object.assign(new LayoutConstraints(), { name: 'Heavy' }),
        );

        // Isolate the spinner's own keys from the strip's tab-button cell,
        // which `addComponent` above already minted — that cell's own
        // per-close teardown is a separate, out-of-scope leak class (see
        // plans/implemented/component-teardown-seam.md's dispose() scope for
        // this plan).
        const beforeSpinner = ruleSnapshot();

        tab.setActiveTabIndex(0);

        const spinnerKeys = leakedKeys(beforeSpinner);
        expect(spinnerKeys.length).toBeGreaterThan(0);

        // Past the two-frame yield the spinner is mounted; close before the
        // (never-settling) factory promise resolves.
        rafQueue.splice(0).forEach((cb) => cb(0));
        rafQueue.splice(0).forEach((cb) => cb(0));

        (tab as unknown as { closeEntry(id: string): void }).closeEntry('tab-0');

        const stillPresent = spinnerKeys.filter((key) => _ruleCacheKeys().includes(key));
        expect(stillPresent).toEqual([]);

        // The strip itself is appended straight to the host element rather
        // than registered as a child component (mirroring WindowBorder), so
        // it must be torn down explicitly — `Tab.detach()` is its one real
        // call site — or its cells' theme listeners outlive the test and can
        // throw against a since-reset handle on a later test's theme change.
        tab.detach();
    });
});

describe('TabBar.dispose()', () => {
    it('removes the element and disposes the raw-appended chrome overlays', () => {
        const before = ruleSnapshot();

        const bar = new TabBar();
        bar.getElement(true);

        // `_tabClip` / `_toolGroup` / `_leadGroup` / `_indicator` / `_dropTint`
        // / `_reorderBar` are appended straight to the strip element (see
        // `TabBar.init()`), so they are the ones the base class's recursive
        // teardown cannot reach on its own — this is what TabBar.dispose()'s
        // explicit disposal of each is for. Collected (with their own
        // descendants) before dispose(), while the tree still exists.
        const barInternals = bar as unknown as {
            _tabClip: Component; _toolGroup: Component; _leadGroup: Component;
            _indicator: Component; _dropTint: Component; _reorderBar: Component;
        };
        const ownIds = collectIds(bar, [
            barInternals._tabClip, barInternals._toolGroup, barInternals._leadGroup,
            barInternals._indicator, barInternals._dropTint, barInternals._reorderBar,
        ]);

        expect(_ruleCacheKeys().length).toBeGreaterThan(before.size);

        bar.dispose();

        // Scoped to TabBar's own known subtree rather than a blanket cache
        // diff: `Panel`'s `_scrollbarV` / `_scrollbarH` overlay-scrollbar
        // visuals are a separate, pre-existing, out-of-scope leak (same
        // raw-append shape, but in a class this plan's dispose() contract
        // does not cover) that a blanket diff cannot distinguish from a
        // regression here.
        const leaked = leakedKeys(before).filter((key) => ownIds.some((id) => key.includes(id)));
        expect(leaked).toEqual([]);
    });
});

describe('ScrollStrip.dispose()', () => {
    it('recurses into a still-attached item inside `_clip`, and into forced-open paging arrows', () => {
        const before = ruleSnapshot();

        const strip = new ScrollStrip();
        const item = new Button({ text: 'A' });
        strip.addItem(item);
        strip.getElement(true);

        // `layoutContent` is `layoutArrows`'s public entry point; calling it
        // directly with a nonzero reserve reaches the private `ensureArrows()`
        // (ScrollStrip.ts:556) without needing a real overflow-triggering
        // layout pass, so `_leadArrow` / `_trailArrow` exist for this test too.
        strip.layoutContent(24, 0);

        const stripInternals = strip as unknown as { _clip: Component; _leadArrow: Component; _trailArrow: Component };
        const ownIds = collectIds(strip, [stripInternals._clip, stripInternals._leadArrow, stripInternals._trailArrow]);

        // Confirms the item and arrows actually rendered a rule before the
        // assertion below, so a false negative can't hide behind "never had a key".
        expect(_ruleCacheKeys().length).toBeGreaterThan(before.size);
        expect(ownIds).toContain(item.getId());

        strip.dispose();

        // `_clip` (holding the item) and the two arrows are raw-appended
        // outside `_components` (see ScrollStrip.dispose) — a fix that only
        // released `_clip`'s own rule, without `_clip` recursing into the
        // item it holds, would still pass a `_clip`-only check. Assert the
        // full known subtree instead.
        const leaked = leakedKeys(before).filter((key) => ownIds.some((id) => key.includes(id)));
        expect(leaked).toEqual([]);
    });
});

describe('A container using a Tab layout manager disposes its strip on its own teardown', () => {
    it('disposes the TabBar / ScrollStrip / tab-cell subtree via the container\'s dispose(), without Tab.detach() or bar.dispose() called directly', () => {
        // This is the review-found gap itself: `Component.destructor()` never
        // detached the layout manager, and `Tab.attach()` raw-appends `_bar`
        // straight onto the container element instead of registering it as a
        // child — so the base class's recursive teardown could never reach it.
        // `Tab.detach()` (the strip's one real disposal path) was reachable
        // only from `setLayoutManager` replacing the manager, never from the
        // container itself being torn down.
        const before = ruleSnapshot();

        const tab     = new Tab();
        const host    = new Container({ layoutManager: tab });
        const content = new Component({});

        host.addComponent(content);
        tab.createTab(content);
        host.getElement(true);

        // Force a real layout pass so the strip lays out its clip and the tab
        // cell gets an actual element (and rule) — mirroring how
        // `ScrollStrip.dispose()`'s own test above forces its arrows open,
        // since nothing here flushes the rAF-scheduled layout a live app would.
        host.doLayout();

        const bar = (tab as unknown as { _bar: TabBar })._bar;
        const barInternals = bar as unknown as {
            _tabClip: ScrollStrip; _toolGroup: Component; _leadGroup: Component;
            _indicator: Component; _dropTint: Component; _reorderBar: Component;
        };
        const clipInternals = barInternals._tabClip as unknown as {
            _clip: Component; _leadArrow: Component | null; _trailArrow: Component | null;
        };

        const ownIds = collectIds(bar, [
            barInternals._tabClip, barInternals._toolGroup, barInternals._leadGroup,
            barInternals._indicator, barInternals._dropTint, barInternals._reorderBar,
            clipInternals._clip,
            ...(clipInternals._leadArrow  ? [clipInternals._leadArrow]  : []),
            ...(clipInternals._trailArrow ? [clipInternals._trailArrow] : []),
        ]);

        // Confirms the strip (and its tab cell) actually rendered rules before
        // the assertion below, so a false negative can't hide behind "never
        // had a key".
        expect(_ruleCacheKeys().length).toBeGreaterThan(before.size);

        host.dispose();

        const leaked = leakedKeys(before).filter((key) => ownIds.some((id) => key.includes(id)));
        expect(leaked).toEqual([]);
    });
});

// The Text-specific dispose/theme-subscription cases (Expected Behaviour rows
// 10-11) live in their own file, TextDispose.test.ts — see that file's header
// for why: they call `ThemeManager.setTheme`, which fires every live listener
// in the process, and this file's Tab/TabBar churn above leaves one behind
// that a shared file would expose them to.
