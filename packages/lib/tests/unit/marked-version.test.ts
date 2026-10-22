// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { describe, it, expect } from 'vitest';
import installedMarked from 'marked/package.json';
import packageJson from '../../package.json';

// `marked` is pinned to one exact version, and this suite fails when the
// version in `node_modules` is any other. The Markdown viewer and the
// MarkdownEditor both read a document through `marked`, and its patch
// releases change that reading: when the pin was introduced, the library's
// Markdown tests passed on two of the eleven versions the old range,
// `^18.0.5`, admitted. The build leaves `marked` out of `dist/lib`, so the
// version declared in `package.json` is the one an application's install
// resolves.
//
// To move to another version, change `dependencies.marked` and the lockfile
// together and make the Markdown suites pass on it. Do not widen the range.

/** The `marked` entry of the library's `dependencies`, as written. */
const DECLARED: string = packageJson.dependencies.marked;

/** One exact version: digits and dots, with no `^`, `~`, comparator, range or tag. */
const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

describe('the marked version the Markdown suites run on', () => {
    it('MV1. package.json declares marked as one exact version', () => {
        expect(DECLARED, 'packages/lib/package.json must pin "marked" to one exact version, not a range').toMatch(EXACT_VERSION);
    });

    it('MV2. the installed marked is the declared version', () => {
        const message = `node_modules holds marked ${installedMarked.version} but packages/lib/package.json declares ${DECLARED}: `
            + 'the Markdown suites are verified on the declared version only';

        expect(installedMarked.version, message).toBe(DECLARED);
    });
});
