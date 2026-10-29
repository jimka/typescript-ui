// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Runs a full garbage collection on demand, for a test that must watch a
// `FinalizationRegistry` callback happen inside the normal suite rather than
// only under a hand-run `node --expose-gc`. Lives in a plain-ESM module for
// the same reason as `readReadmes.mjs`: `tsconfig.test.json` builds a
// deliberately Node-types-free program, so the `node:` imports stay here,
// typed by the sibling `.d.mts`.
//
// `--expose-gc` set at runtime does not install the global `gc`, but a fresh
// context created afterwards sees the native function, so it is read from one.

import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

setFlagsFromString('--expose-gc');

const collect = runInNewContext('gc');

/** Runs one full, synchronous garbage collection. */
export function forceGc() {
    collect();
}
