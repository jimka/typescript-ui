import type { Component } from '@jimka/typescript-ui/core';

/** The shape every module in `src/demos/` must export. */
interface DemoModule {
    /**
     * Pixel height of the framed live area the demo is rendered into on its
     * docs page — the height of the bordered stage embedded in the Markdown,
     * applied by `DocsDemo` as both that stage's minimum and preferred height.
     * A floor rather than a cap: a demo whose own content minimum is taller
     * makes the stage grow.
     */
    height: number;
    /** Builds the demo's component tree. Called once per page render. */
    create(): Component;
}

/** A resolved demo: its factory module plus that module's own source text. */
export interface DemoEntry {
    module: DemoModule;
    source: string;
}

// Two eager globs over the same directory, mirroring pages.ts's eager `?raw`
// glob for the corpus: one resolves each module's exports, the other its
// raw source text, so the "show source" panel renders exactly the code that
// built the live demo. Both eager, so resolving a demo is synchronous — see
// "The source shown is the source executed" in
// plans/implemented/docs-inline-demos.md.
const MODULES = import.meta.glob('../demos/*.ts', { eager: true }) as Record<string, DemoModule>;
const SOURCES = import.meta.glob('../demos/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/**
 * Maps a glob key to the demo id it's keyed under: the file's basename
 * without its `.ts` extension.
 *
 * @param globKey - The glob-relative path, e.g. `../demos/button-basic.ts`.
 * @returns The demo id, e.g. `button-basic`.
 */
function idFor(globKey: string): string {
    return globKey.replace(/^.*\//, '').replace(/\.ts$/, '');
}

const DEMOS = new Map<string, DemoEntry>(
    Object.entries(MODULES).map(([globKey, module]) => [idFor(globKey), { module, source: SOURCES[globKey] }]),
);

/**
 * Resolves a marker id to its demo.
 *
 * @param id - The demo id from a page's `<!-- demo: id -->` marker.
 * @returns The matching {@link DemoEntry}, or `null` when no module matches.
 */
export function getDemo(id: string): DemoEntry | null {
    return DEMOS.get(id) ?? null;
}

/**
 * Every registered demo id, sorted. Exported so the demo-catalogue coverage
 * test can check every registered id against the page corpus's own
 * `<!-- demo: id -->` markers.
 *
 * @returns The sorted list of ids every module in `src/demos/` is keyed under.
 */
export function getDemoIds(): string[] {
    return [...DEMOS.keys()].sort();
}

/**
 * Markdown shown in place of a demo whose id resolves to no module — a
 * mismatch between a page's marker and the demo catalogue.
 *
 * @param id - The unresolved demo id.
 * @returns Markdown source naming the missing demo.
 */
export function missingDemoSource(id: string): string {
    return `> **Missing demo** — no demo module is registered for \`${id}\`.`;
}
