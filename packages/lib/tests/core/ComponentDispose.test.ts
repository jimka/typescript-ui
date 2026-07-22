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
import { LayoutConstraints } from '~/layout/LayoutConstraints';
import { Animation } from '~/core/Animation';
import { createSpinnerWrap } from '~/component/display/SpinnerWrap';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { _ruleCacheKeys } from '~/core/StyleTarget';

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

/** Rule-cache keys present now that were absent from `before`. */
function leakedKeys(before: Set<string>): string[] {
    return _ruleCacheKeys().filter((key) => !before.has(key));
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
            private readonly held: Component = new Component({});

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
        // ARCHITECTURE.md's dispose() scope for this plan).
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

// The Text-specific dispose/theme-subscription cases (Expected Behaviour rows
// 10-11) live in their own file, TextDispose.test.ts — see that file's header
// for why: they call `ThemeManager.setTheme`, which fires every live listener
// in the process, and this file's Tab/TabBar churn above leaves one behind
// that a shared file would expose them to.
