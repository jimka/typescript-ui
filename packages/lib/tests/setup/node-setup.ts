// Global Vitest setup for the node-environment suite. The framework's default
// seam is the production sink/source, which reads the live `document`; under the
// `node` environment there is no `document`, so any test that constructs a
// component without installing the modelled harness would crash on the first
// seam read. This installs the modelled DOM before every test as the baseline,
// so unmounted construction and pure-logic assertions route through the offline
// source. Tests that need their own viewport/font config call `installTestDOM`
// themselves, which overrides this baseline; their `afterEach(DOM.reset())`
// returns to the production default, and the next test's beforeEach below
// re-installs the modelled baseline.
import { beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import { _flushDeferredStyleSheetWrites } from '~/core/StyleTarget';
import fontMetrics from '../dom/font-metrics.test-font.json';

const BASELINE_CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// Self-guard: the two production-seam suites (handle-registry, handle-seam) keep
// the `jsdom` pragma and exercise the *production* sink/source against a real
// `document`. Installing the modelled baseline there would clobber the seam they
// test, so the hooks no-op whenever a real `document` is present.
const isNodeEnv = typeof document === 'undefined';

// Install at setup-file top level too, not only per-test: `core/Body.ts`
// renders its singleton `Body` at import, which reaches the seam before any
// `beforeEach` fires. Setup files evaluate before the test file's module graph
// imports, so this makes the modelled DOM live for that import-time render.
//
// The flush that follows runs anything this file's own imports queued and
// marks the stylesheet as written, so `deferStyleSheetWrite` writes at once
// from then on: each module's load-time stylesheet write runs as the test
// file's module graph imports it, into this baseline sink — where it landed
// before deferral — rather than in the recording sink of whichever test first
// renders. Each test file's own recording sink therefore starts clean of
// them, as it always did. The deferral itself (queuing until the first real
// write) is covered in fresh module graphs by `tests/core/StyleTarget.test.ts`
// (E1–E9), `tests/component/input/focusRing.test.ts` (F1–F2) and
// `tests/unit/import-without-dom.test.ts`.
if (isNodeEnv) {
    installTestDOM(BASELINE_CONFIG);
    _flushDeferredStyleSheetWrites();
}

beforeEach(() => {
    if (isNodeEnv) {
        installTestDOM(BASELINE_CONFIG);
    }
});

afterEach(() => {
    if (isNodeEnv) {
        DOM.reset();
    }
});
