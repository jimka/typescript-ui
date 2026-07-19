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

// Install at setup-file top level too, not only per-test: a handful of component
// modules run a `StyleRule.ensureKeyframes` / `ensureStyleRule` side effect at
// import time (e.g. ProgressSpinner), which reaches the seam before any
// `beforeEach` fires. Setup files evaluate before the test file's module graph
// imports, so this makes the modelled DOM live for those import-time writes.
if (isNodeEnv) {
    installTestDOM(BASELINE_CONFIG);
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
