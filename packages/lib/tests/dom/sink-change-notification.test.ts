// Runs in the default `node` environment, like tests/dom/recorder.test.ts: the
// mechanism under test is a listener list on `DOM` plus the dispatch `install`
// and `reset` make after a swap, so nothing here needs a document.
//
// `DOM.onSinkChange` has no unregister — every real registrant is a
// module-scoped cache that outlives the process — so each case below registers
// its own fresh counter and asserts only that counter's runs. Listeners from
// earlier cases stay registered and keep counting for the rest of the file;
// nothing reads them again. The node setup file installs a fresh sink in its
// own `beforeEach`, so every registration below happens after that swap, not
// before it.
import { describe, it, expect, afterEach } from 'vitest';
import { DOM, ProductionDOMSink, type DOMSink } from '~/core/DOM';
import { RecordingDOMSink } from './TestDOM';

/**
 * A named sink-change listener plus a reader for how often it has run. The
 * count lives in the closure rather than on the listener, so a case asserts a
 * number without reaching into the function it registered.
 *
 * @returns The listener to register, and a reader for its run count.
 */
function counter(): { listener: () => void; runs: () => number } {
    let runs = 0;

    function countSinkChange(): void {
        runs += 1;
    }

    return { listener: countSinkChange, runs: () => runs };
}

/**
 * Never called. Present so `typecheck:test` fails if `DOMSeams` stops declaring
 * `sink` readonly: `install` and `reset` are the only swap routes that run the
 * sink-change listeners, and a direct assignment bypasses both.
 */
function readonlySinkGuard(): void {
    // @ts-expect-error — DOMSeams declares `sink` readonly.
    DOM.sink = new RecordingDOMSink();
}

describe('sink-change notification', () => {
    afterEach(() => {
        DOM.reset();
    });

    it('N1. runs every registered listener after a reset', () => {
        const first  = counter();
        const second = counter();

        DOM.onSinkChange(first.listener);
        DOM.onSinkChange(second.listener);

        DOM.reset();

        // The second count is also what catches a dispatch that stops after the
        // first listener.
        expect(first.runs()).toBe(1);
        expect(second.runs()).toBe(1);
    });

    it('N2. runs the listeners when install replaces the sink', () => {
        const swaps = counter();

        DOM.onSinkChange(swaps.listener);

        DOM.install({ sink: new RecordingDOMSink() });

        expect(swaps.runs()).toBe(1);
    });

    it('N3. stays quiet when install is handed the sink already installed', () => {
        const swaps = counter();

        DOM.onSinkChange(swaps.listener);

        DOM.install({ sink: new RecordingDOMSink() });

        expect(swaps.runs()).toBe(1);

        DOM.install({ sink: DOM.sink });

        // Still 1, not 2. The count is non-zero before the call under test, so
        // this draws a real distinction rather than comparing zero with zero.
        expect(swaps.runs()).toBe(1);
    });

    it('N4. stays quiet for a source-only install', () => {
        const swaps = counter();

        DOM.onSinkChange(swaps.listener);

        DOM.install({ sink: new RecordingDOMSink() });

        expect(swaps.runs()).toBe(1);

        DOM.install({ source: Object.create(DOM.source) as typeof DOM.source });

        // Still 1, not 2: a source spy leaves every handle the installed sink
        // minted valid, and six suites install one over a live sink.
        expect(swaps.runs()).toBe(1);
    });

    it('N5. hands a listener the sink that replaced the one it held', () => {
        const seen: DOMSink[] = [];
        const recorder        = new RecordingDOMSink();

        DOM.onSinkChange(() => {
            seen.push(DOM.sink);
        });

        DOM.install({ sink: recorder });

        // Not the outgoing sink: the dispatch is the last statement in
        // `install`, after every assignment.
        expect(seen[0]).toBe(recorder);
    });

    it('N6. hands a listener the production sink a reset installed', () => {
        const seen: DOMSink[] = [];
        const recorder        = new RecordingDOMSink();

        DOM.onSinkChange(() => {
            seen.push(DOM.sink);
        });

        DOM.install({ sink: recorder });
        DOM.reset();

        // Same ordering rule on `reset`'s side of the mechanism.
        expect(seen[1]).toBeInstanceOf(ProductionDOMSink);
        expect(seen[1]).not.toBe(recorder);
    });
});
