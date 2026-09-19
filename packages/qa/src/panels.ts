// The panel contract and the lazy panel registry. A panel is registered by
// existing: its file in `src/panels/` is its registration, and its basename is
// its id.

import type { Component } from '@jimka/typescript-ui/core';
import type { AnyObj, GeometryTarget, HarnessTools } from './harness/types.js';

/** What a panel module's `build(n, params)` returns. */
export interface PanelBuild {
    /** Mounted alone at full viewport through `Body.init` + `Fit`. */
    root: Component;
    /** Driver name → target, for targets that exist before mounting. */
    targets: Record<string, unknown>;
    /** Called once after the root has painted and settled; `mountPanel` awaits it, so a panel that must wait — for a store's view, say — returns a promise. Its entries are merged over `targets`. */
    afterMount?(tools: HarnessTools): Record<string, unknown> | Promise<Record<string, unknown>>;
    /** Label → geometry probe target, sampled under `geom=1`. */
    geometry?: Record<string, GeometryTarget>;
    /** Host fields, stored under `before.host`. */
    describe?(): AnyObj;
    /** Extra work counters, installed under `work=1` after the harness's own; returns notes. */
    installWork?(tools: HarnessTools): string[];
}

/** The named exports of every `packages/qa/src/panels/<id>.ts`, and nothing else. */
export interface PanelModule {
    /** What the panel builds; for a rebuilt outside behaviour, the source and the symptom. */
    description: string;
    /** Positive integer used when the URL has no `n=`. */
    defaultScale: number;
    /** The `drive=` value used when the URL has none, e.g. `resize` or `drag,wheel:120`; `''` means no phases. */
    defaultDrive: string;
    /** `params` is the page's URL parameters, for choosing among targets; a module may declare `build(n)` alone. */
    build(n: number, params: URLSearchParams): PanelBuild;
}

// Lazy, unlike docs' eager demo glob: the page loads only the measured
// panel's modules, so adding a panel never changes the page another panel is
// measured on.
const LOADERS = import.meta.glob('./panels/*.ts') as Record<string, () => Promise<PanelModule>>;

/**
 * Maps a glob key to the panel id it's keyed under: the file's basename
 * without its `.ts` extension.
 *
 * @param globKey - The glob-relative path, e.g. `./panels/chart-line.ts`.
 * @returns The panel id, e.g. `chart-line`.
 */
function idFor(globKey: string): string {
    return globKey.replace(/^.*\//, '').replace(/\.ts$/, '');
}

const PANELS = new Map<string, () => Promise<PanelModule>>(
    Object.entries(LOADERS).map(([globKey, load]) => [idFor(globKey), load]),
);

/** A scale: a positive integer written in digits. */
const POSITIVE_INTEGER = /^[1-9]\d*$/;

/**
 * Every panel id, sorted.
 *
 * @returns The ids of every module in `src/panels/`.
 */
export function getPanelIds(): string[] {
    return [...PANELS.keys()].sort();
}

/**
 * Loads a panel's module.
 *
 * @param id - The panel id.
 * @returns The module, or `null` when no file has that id.
 */
export async function loadPanel(id: string): Promise<PanelModule | null> {
    const load = PANELS.get(id);

    return load ? load() : null;
}

/**
 * Reads the `n=` scale.
 *
 * @param raw - The URL's `n=` value, or `null`.
 * @param fallback - The panel's default scale.
 * @returns `raw` as a positive integer, or `fallback` when `raw` is null or empty.
 * @throws Error - `n: expected a positive integer, got "<raw>"` otherwise.
 */
export function parseScale(raw: string | null, fallback: number): number {
    if (raw === null || raw === '') {
        return fallback;
    }

    if (!POSITIVE_INTEGER.test(raw)) {
        throw new Error(`n: expected a positive integer, got "${raw}"`);
    }

    return Number(raw);
}
