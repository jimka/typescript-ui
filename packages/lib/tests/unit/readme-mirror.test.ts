// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { describe, it, expect } from 'vitest';

// File reading lives in a plain-ESM helper: the test program is deliberately
// Node-types-free, so `node:fs` cannot be imported here. See the helper for why.
import { readReadmes } from '../helpers/readReadmes.mjs';

/**
 * The repo has two READMEs with different audiences: `packages/lib/README.md` is the
 * npm package page, the root `README.md` is the GitHub landing page. Most of their
 * content is deliberately duplicated, which means it silently drifts — the root copy
 * once carried stale license attribution and a glyph-migration table the package copy
 * had already dropped.
 *
 * This suite makes that drift a test failure. The package README is canonical; every
 * `##` section the two files share must match, except for the titles listed in
 * {@link DIVERGENT_SECTIONS}. Sections present in only one file are unchecked by
 * design (that is how the root keeps its contributor-facing content), so the
 * one-sided titles are pinned too — otherwise renaming a heading on one side would
 * quietly drop that section out of the comparison instead of failing.
 */

/** Key used for the content above the first `##` heading (title, lead, browser notice). */
const PREAMBLE = '(preamble)';

/**
 * Shared titles whose bodies are allowed to differ, with the reason. Entries are
 * verified to still be shared *and* still divergent, so an exemption cannot outlive
 * the divergence it covers.
 */
const DIVERGENT_SECTIONS = new Map([
    ['Quick install', 'the root README also documents the `npm create @jimka/tsui-app` scaffolder, which is not part of the published package'],
]);

/** Titles expected only in the root README — contributor-facing, not shipped to npm. */
const ROOT_ONLY_SECTIONS = ['Repository scripts'];

/** Titles expected only in the package README. */
const PACKAGE_ONLY_SECTIONS: string[] = [];

/**
 * Splits a README into `title -> body` keyed by `##` heading, with everything before
 * the first heading under {@link PREAMBLE}. Bodies are trimmed so heading-adjacent
 * blank lines do not count as differences.
 *
 * Only `##` is treated as a boundary; `###` subsections stay inside their parent body.
 * A `## ` line inside a fenced code block would be misread as a heading — neither
 * README contains one, and the failure mode is a false positive, not a missed drift.
 */
function splitSections(markdown: string): Map<string, string> {
    const sections = new Map<string, string>();
    let title = PREAMBLE;
    let body: string[] = [];

    for (const line of markdown.split('\n')) {
        const heading = /^## (.+)$/.exec(line);
        if (heading === null) {
            body.push(line);
            continue;
        }
        sections.set(title, body.join('\n').trim());
        title = heading[1];
        body = [];
    }
    sections.set(title, body.join('\n').trim());

    return sections;
}

/**
 * Relative markdown links resolve from the containing file's directory, so the root
 * README prefixes package-local targets with `packages/lib/` where the package README
 * does not. Strip that prefix so the two spellings of the same link compare equal.
 */
function normalizeLinks(body: string): string {
    return body.replace(/packages\/lib\//g, '');
}

describe('README mirror', () => {
    const readmes = readReadmes();

    const packageSections = splitSections(readmes.package);
    const rootSections    = splitSections(readmes.root);

    const sharedTitles = [...packageSections.keys()].filter(title => rootSections.has(title));
    const mirroredTitles = sharedTitles.filter(title => !DIVERGENT_SECTIONS.has(title));

    it.each(mirroredTitles)('root README mirrors the package README section "%s"', title => {
        // Compared as normalized strings rather than per-line so the diff vitest prints
        // on failure shows the whole section, which is what has to be reconciled.
        expect(normalizeLinks(rootSections.get(title)!))
            .toBe(normalizeLinks(packageSections.get(title)!));
    });

    it('checks a non-trivial number of shared sections', () => {
        // Guards the parser and the heading-shape assumption: if `splitSections` broke or
        // both files were restructured, every title would go one-sided and the mirror
        // assertions above would vacuously pass.
        expect(mirroredTitles.length).toBeGreaterThan(2);
    });

    it.each([...DIVERGENT_SECTIONS.entries()])('divergence exemption for "%s" is still needed', (title, reason) => {
        expect(sharedTitles, `"${title}" is exempt from mirroring (${reason}) but is no longer in both READMEs`)
            .toContain(title);
        expect(normalizeLinks(rootSections.get(title) ?? ''), `"${title}" no longer differs between the READMEs — drop it from DIVERGENT_SECTIONS so it is mirror-checked`)
            .not.toBe(normalizeLinks(packageSections.get(title) ?? ''));
    });

    it('pins the sections that exist in only one README', () => {
        // A renamed heading shows up here as an unexpected one-sided title, rather than
        // silently removing that section from the mirror comparison.
        const rootOnly    = [...rootSections.keys()].filter(title => !packageSections.has(title));
        const packageOnly = [...packageSections.keys()].filter(title => !rootSections.has(title));

        expect(rootOnly).toEqual(ROOT_ONLY_SECTIONS);
        expect(packageOnly).toEqual(PACKAGE_ONLY_SECTIONS);
    });
});
