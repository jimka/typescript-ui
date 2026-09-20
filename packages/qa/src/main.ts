// The QA page. With `qa=<name>` it runs one measurement and reports it; with
// only `panel=<id>` it mounts that panel for a person to look at. See README.md.
import { Body, DOM } from '@jimka/typescript-ui/core';
import { createTools, runQa } from './harness/run.js';
import { getPanelIds } from './panels.js';
import { previewPanel, setupPanel } from './mount.js';

/** The library build under test, supplied by vite.config.ts's `define`. */
declare const __QA_LIB__: string;

const lib = { Body, DOM };
const params = new URLSearchParams(location.search);

if (params.has('qa')) {
    void runQa({ lib, build: __QA_LIB__, panels: { ids: getPanelIds, setup: setupPanel } });
} else if (params.has('panel')) {
    void previewPanel(params.get('panel')!, params, createTools(lib));
}
