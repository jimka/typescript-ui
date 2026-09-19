import { describe, it, expect, vi } from 'vitest';
import { StyleRule, _ruleCacheHas, _ruleCacheKeys, styleRuleCounts, styleRuleEntries } from '~/core/StyleTarget';
import { DOM, ProductionDOMSink } from '~/core/DOM';
import type { RecordingDOMSink } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const DEFER_TEST_CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/**
 * Starts a fresh module graph and installs the modelled DOM before anything
 * else evaluates, so the fresh `~/core/StyleTarget` copy has made no
 * stylesheet write yet — the state {@link deferStyleSheetWrite}'s queue
 * starts in. `vi.resetModules()` clears the registry so the following
 * dynamic imports evaluate new copies rather than reusing this file's own
 * top-level import.
 *
 * @returns The fresh `~/core/StyleTarget` module and its installed recording sink.
 */
async function freshStyleTarget(): Promise<{
    styleTarget: typeof import('~/core/StyleTarget');
    sink: RecordingDOMSink;
}> {
    vi.resetModules();

    const { installTestDOM } = await import('../dom/TestDOM');
    const sink = installTestDOM(DEFER_TEST_CONFIG);
    const styleTarget = await import('~/core/StyleTarget');

    return { styleTarget, sink };
}

/** The sink's `ensureStyleRule` / `ensureKeyframes` ops, in recorded order, by their selector or keyframe name. */
function recordedOrder(sink: RecordingDOMSink): string[] {
    return sink.writes
        .filter((w) => w.op === 'ensureStyleRule' || w.op === 'ensureKeyframes')
        .map((w) => w.args[0] as string);
}

// Regression: a load-time stylesheet write (a module-level `new StyleRule(...)`
// or `StyleRule.ensureKeyframes(...)`) used to reach the DOM the instant the
// module was evaluated, which crashes an import with no DOM present (Loom's
// Vitest `node` suite, importing `@jimka/typescript-ui/component/editor`).
// `deferStyleSheetWrite` queues such a write until the library's first real
// stylesheet write, so importing a module that only calls it touches no DOM.
// Each case starts a fresh module graph (see `freshStyleTarget`), because the
// deferral state is a load-time flag that this file's own top-level import
// already flipped.
describe('deferStyleSheetWrite', () => {
    it('E1. nothing is written while nothing has been written', async () => {
        const { styleTarget, sink } = await freshStyleTarget();
        const { deferStyleSheetWrite, StyleRule: FreshStyleRule } = styleTarget;

        deferStyleSheetWrite(() => { new FreshStyleRule({ scope: 'selector', name: '.A' }); });
        deferStyleSheetWrite(() => { FreshStyleRule.ensureKeyframes('k', 'from {} to {}'); });

        expect(recordedOrder(sink)).toEqual([]);
    });

    it('E2. the first rule materialisation runs the whole queue first, in order', async () => {
        const { styleTarget, sink } = await freshStyleTarget();
        const { deferStyleSheetWrite, StyleRule: FreshStyleRule } = styleTarget;

        deferStyleSheetWrite(() => { new FreshStyleRule({ scope: 'selector', name: '.A' }); });
        deferStyleSheetWrite(() => { FreshStyleRule.ensureKeyframes('k', 'from {} to {}'); });
        deferStyleSheetWrite(() => { new FreshStyleRule({ scope: 'selector', name: '.B' }); });

        new FreshStyleRule({ scope: 'selector', name: '.Trigger', styles: { color: 'green' } });

        expect(recordedOrder(sink)).toEqual(['.A', 'k', '.B', '.Trigger']);
    });

    it('E3. StyleRule.ensureKeyframes also counts as the first real write', async () => {
        const { styleTarget, sink } = await freshStyleTarget();
        const { deferStyleSheetWrite, StyleRule: FreshStyleRule } = styleTarget;

        deferStyleSheetWrite(() => { new FreshStyleRule({ scope: 'selector', name: '.A' }); });

        FreshStyleRule.ensureKeyframes('k2', 'from {} to {}');

        expect(recordedOrder(sink)).toEqual(['.A', 'k2']);
    });

    it('E4. once the sheet is written, a further deferred write runs immediately', async () => {
        const { styleTarget, sink } = await freshStyleTarget();
        const { deferStyleSheetWrite, StyleRule: FreshStyleRule } = styleTarget;

        // A first real write with nothing queued ahead of it.
        new FreshStyleRule({ scope: 'selector', name: '.FirstReal' });

        deferStyleSheetWrite(() => { new FreshStyleRule({ scope: 'selector', name: '.C' }); });

        expect(recordedOrder(sink)).toEqual(['.FirstReal', '.C']);
    });

    it('E5. each queued write runs exactly once', async () => {
        const { styleTarget, sink } = await freshStyleTarget();
        const { deferStyleSheetWrite, StyleRule: FreshStyleRule } = styleTarget;

        deferStyleSheetWrite(() => { new FreshStyleRule({ scope: 'selector', name: '.A' }); });

        new FreshStyleRule({ scope: 'selector', name: '.Trigger', styles: { color: 'green' } });
        new FreshStyleRule({ scope: 'selector', name: '.Trigger2', styles: { color: 'blue' } });

        const aWrites = sink.writes.filter((w) => w.op === 'ensureStyleRule' && w.args[0] === '.A');
        expect(aWrites).toHaveLength(1);
    });

    it("E6. a queued write for the trigger's own selector writes its declarations first", async () => {
        const { styleTarget, sink } = await freshStyleTarget();
        const { deferStyleSheetWrite, StyleRule: FreshStyleRule } = styleTarget;

        deferStyleSheetWrite(() => {
            new FreshStyleRule({ scope: 'selector', name: '.Same', styles: { color: 'red' } });
        });

        new FreshStyleRule({ scope: 'selector', name: '.Same', styles: { backgroundColor: 'blue' } });

        const ensureWrites = sink.writes.filter((w) => w.op === 'ensureStyleRule' && w.args[0] === '.Same');
        expect(ensureWrites).toHaveLength(1);

        const styleKeys = sink.writes
            .filter((w) => w.op === 'setRuleStyles' && w.args[0] === '.Same')
            .flatMap((w) => Object.keys(w.args[1] as Record<string, string | null>));

        expect(styleKeys).toEqual(['color', 'backgroundColor']);
    });

    it('E7. a write queued from inside a queued write runs in place', async () => {
        const { styleTarget, sink } = await freshStyleTarget();
        const { deferStyleSheetWrite, StyleRule: FreshStyleRule } = styleTarget;

        deferStyleSheetWrite(() => {
            new FreshStyleRule({ scope: 'selector', name: '.Outer' });
            deferStyleSheetWrite(() => { new FreshStyleRule({ scope: 'selector', name: '.Inner' }); });
            new FreshStyleRule({ scope: 'selector', name: '.Outer2' });
        });

        new FreshStyleRule({ scope: 'selector', name: '.Trigger', styles: { color: 'green' } });

        expect(recordedOrder(sink)).toEqual(['.Outer', '.Inner', '.Outer2', '.Trigger']);
    });

    // E7 cannot tell whether the flush marks the stylesheet written before or
    // after running the queue: its `.Outer` materialises first and re-enters
    // the flush, which sets the flag either way. Here the nested deferral is
    // the queued write's only act, so if the flag were set after the loop the
    // inner write would be queued behind a flush that has already run, and
    // lost.
    it('E8. a write that only queues another write still gets it run', async () => {
        const { styleTarget, sink } = await freshStyleTarget();
        const { deferStyleSheetWrite, StyleRule: FreshStyleRule } = styleTarget;

        deferStyleSheetWrite(() => {
            deferStyleSheetWrite(() => { new FreshStyleRule({ scope: 'selector', name: '.Inner' }); });
        });

        new FreshStyleRule({ scope: 'selector', name: '.Trigger', styles: { color: 'green' } });

        expect(recordedOrder(sink)).toEqual(['.Inner', '.Trigger']);
    });

    // A queued write that throws must not take the writes queued after it down
    // with it: the queue is drained by then, so anything skipped would be lost
    // for the session. Eagerly, the same throw only broke its own module's
    // import, so the failure is reported rather than rethrown into whichever
    // unrelated render happened to trigger the flush.
    it('E9. a throwing queued write is reported and the rest still run', async () => {
        const { styleTarget, sink } = await freshStyleTarget();
        const { deferStyleSheetWrite, StyleRule: FreshStyleRule } = styleTarget;
        const failure = new Error('bad selector');
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        try {
            deferStyleSheetWrite(() => { new FreshStyleRule({ scope: 'selector', name: '.Before' }); });
            deferStyleSheetWrite(() => { throw failure; });
            deferStyleSheetWrite(() => { new FreshStyleRule({ scope: 'selector', name: '.After' }); });

            new FreshStyleRule({ scope: 'selector', name: '.Trigger', styles: { color: 'green' } });

            expect(recordedOrder(sink)).toEqual(['.Before', '.After', '.Trigger']);
            expect(consoleError).toHaveBeenCalledTimes(1);
            expect(consoleError.mock.calls[0][1]).toBe(failure);
        } finally {
            consoleError.mockRestore();
        }
    });
});

// Regression: a component-scoped style rule is keyed on the element's #id, and
// the id is consumer-supplied (e.g. a Dock panel id "public.customers"). The
// selector must CSS-escape the id, or a "." / ":" in it makes "#public.customers"
// parse as id="public" + class="customers" — the rule never matches the element,
// position:absolute is dropped, and the component collapses to position:static.
describe('StyleRule — component-scope selector escaping', () => {
    it('escapes CSS-special characters in a component id', () => {
        const rule = new StyleRule({ scope: 'component', name: 'public.customers', materialize: false });

        expect(rule.ensure().selectorText).toBe('#public\\.customers');
    });

    it('leaves a plain id unchanged', () => {
        const rule = new StyleRule({ scope: 'component', name: 'cmp-12', materialize: false });

        expect(rule.ensure().selectorText).toBe('#cmp-12');
    });

    it('escapes the id but keeps a live selector suffix unescaped', () => {
        const rule = new StyleRule({ scope: 'component', name: 'public.customers', suffix: ':hover', materialize: false });

        expect(rule.ensure().selectorText).toBe('#public\\.customers:hover');
    });
});

// Regression: teardown must remove a component's per-instance rule from the
// shared stylesheet, or the sheet grows unbounded as components are discarded
// (see plans/implemented/component-style-rule-disposal.md). Each case uses a
// unique selector name — `_ruleCache` is module state that survives
// `DOM.reset()`, so a shared name would let a leftover cache entry from a
// prior test mask an `ensureStyleRule` op (a cache hit skips the sink call).
describe('StyleRule — dispose', () => {
    it('deletes the materialised rule from the sink and evicts the cache', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const rule = new StyleRule({ scope: 'selector', name: '.dispose-test-materialised', materialize: false });

        rule.ensure();
        expect(_ruleCacheHas('.dispose-test-materialised')).toBe(true);

        rule.dispose();

        expect(_ruleCacheHas('.dispose-test-materialised')).toBe(false);
        expect(sink.writes).toContainEqual({ op: 'deleteStyleRule', args: ['.dispose-test-materialised'] });
    });

    it('is a no-op on a never-materialised rule', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const rule = new StyleRule({ scope: 'selector', name: '.dispose-test-unmaterialised', materialize: false });

        rule.dispose();

        expect(sink.writes.some((w) => w.op === 'deleteStyleRule')).toBe(false);
        expect(_ruleCacheHas('.dispose-test-unmaterialised')).toBe(false);
    });

    it('is idempotent — a second call records no further deleteStyleRule op', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const rule = new StyleRule({ scope: 'selector', name: '.dispose-test-idempotent', materialize: false });

        rule.ensure();
        rule.dispose();
        const deleteCount = sink.writes.filter((w) => w.op === 'deleteStyleRule').length;

        rule.dispose();

        expect(sink.writes.filter((w) => w.op === 'deleteStyleRule').length).toBe(deleteCount);
    });

    it('is not terminal — a later ensure() re-materialises', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const rule = new StyleRule({ scope: 'selector', name: '.dispose-test-rematerialise', materialize: false });

        rule.ensure();
        rule.dispose();
        rule.ensure();

        expect(_ruleCacheHas('.dispose-test-rematerialise')).toBe(true);
        expect(sink.writes.filter((w) => w.op === 'ensureStyleRule' && w.args[0] === '.dispose-test-rematerialise').length).toBe(2);
    });
});

// Regression: the component GC finalizer disposes a component's cached style-rule
// selectors decoupled from the DOM lifecycle — it fires at an unpredictable GC
// time, using whatever `DOM.sink` is then installed. In the node test env (no
// `document`), or after `DOM.reset()` restores the production sink, that sink is a
// `ProductionDOMSink`, so the finalizer's `deleteStyleRule` runs against it with no
// document present. Rule disposal is best-effort cleanup (nothing to delete when
// there is no shared sheet), so it must NOT throw a `ReferenceError: document is
// not defined` — an unhandled exception that escapes into whatever suite happens
// to be running when GC fires.
describe('ProductionDOMSink.deleteStyleRule — headless resilience', () => {
    it('does not throw when no document is present (GC-finalizer path)', () => {
        const sink = new ProductionDOMSink();

        expect(() => sink.deleteStyleRule('#some-component-id')).not.toThrow();
    });
});

// Diagnostics overlay support (plans/implemented/debug-diagnostics-overlay.md,
// Expected Behaviour rows 12-13). `_ruleCache` is module state that outlives
// every test in this file, so both cases diff against a before/after snapshot
// rather than asserting an absolute count.
describe('styleRuleCounts', () => {
    it('12. buckets a materialised rule by its selector shape', () => {
        const before = styleRuleCounts();

        const instanceRule = new StyleRule({ scope: 'component', name: 'diag-count-instance' });
        const classRule    = new StyleRule({ scope: 'class', name: 'DiagCountFoo', suffix: '.pressed' });
        const otherRule    = new StyleRule({ scope: 'selector', name: ':where(.diag-count-other)' });

        const after = styleRuleCounts();

        expect(after.instance - before.instance).toBe(1);
        expect(after.class - before.class).toBe(1);
        expect(after.other - before.other).toBe(1);
        expect(after.total - before.total).toBe(3);

        instanceRule.dispose();
        classRule.dispose();
        otherRule.dispose();
    });

    it('13. disposing a rule removes it from the counts', () => {
        const before = styleRuleCounts();
        const rule   = new StyleRule({ scope: 'selector', name: '.diag-count-dispose-test' });

        expect(styleRuleCounts().total).toBe(before.total + 1);

        rule.dispose();

        expect(styleRuleCounts()).toEqual(before);
    });
});

// Style-audit support (plans/in-progress/diagnostics-overlay-style-audit-window.md,
// Expected Behaviour rows 1-2). `_ruleCache` is module state that outlives every
// test in this file (see the `styleRuleCounts` describe above), so — same as
// those cases — this diffs against a before/after snapshot rather than
// asserting an absolute empty cache: "1." is the general invariant that
// `styleRuleEntries()` always has exactly one entry per cache key (which a
// literally-empty cache is just the zero case of), since no reset of the
// module-level cache exists to observe that zero case in isolation here.
describe('styleRuleEntries', () => {
    it('1. has exactly one entry per key currently in the cache', () => {
        expect(styleRuleEntries().length).toBe(_ruleCacheKeys().length);
    });

    it('2. materialising three distinct rules adds one entry per selector', () => {
        const before = styleRuleEntries().length;

        const a = new StyleRule({ scope: 'selector', name: '.entries-test-a' });
        const b = new StyleRule({ scope: 'selector', name: '.entries-test-b' });
        const c = new StyleRule({ scope: 'selector', name: '.entries-test-c' });

        a.ensure();
        b.ensure();
        c.ensure();

        const entries = styleRuleEntries();

        expect(entries.length - before).toBe(3);
        expect(entries.map((e) => e.selector)).toEqual(
            expect.arrayContaining(['.entries-test-a', '.entries-test-b', '.entries-test-c']),
        );

        a.dispose();
        b.dispose();
        c.dispose();
    });
});
