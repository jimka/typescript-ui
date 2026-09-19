// Mounting a panel: load its module, build it, mount the root alone at full
// viewport, wait for it to paint and settle, then collect its targets. One
// sequence serves the harness, the preview page and the tests; only the two
// waits differ.

import { Body } from '@jimka/typescript-ui/core';
import type { Component } from '@jimka/typescript-ui/core';
import { Fit } from '@jimka/typescript-ui/layout';
import type { HarnessTools, SetupContext, Subject } from './harness/types.js';
import { pageTargets } from './pageTargets.js';
import { loadPanel, parseScale } from './panels.js';
import type { PanelBuild, PanelModule } from './panels.js';

/**
 * How long `painted` waits for the root to paint. Generous for a cold
 * dev-server module graph; the wait ends as soon as the root paints.
 */
const MOUNT_TIMEOUT_MS = 10_000;

/** Loom's post-setup settle: lets the first layout flushes finish before anything is measured. */
const PANEL_SETTLE_MS = 1000;

/** The two waits in the mount sequence. */
export interface MountWaits {
    /** Resolves once `root` has painted. */
    painted(root: Component, id: string): Promise<void>;
    /** Resolves once a change to the tree has settled. */
    settled(): Promise<void>;
}

/** A mounted panel: its module, scale, build and merged targets. */
export interface MountedPanel {
    module: PanelModule;
    n: number;
    build: PanelBuild;
    targets: Record<string, unknown>;
}

/**
 * The real waits: `painted` polls until the root's element exists and is
 * painted, `settled` sleeps.
 *
 * @param tools - The harness tools.
 * @returns The waits.
 */
export function defaultMountWaits(tools: HarnessTools): MountWaits {
    return {
        painted: async (root: Component, id: string): Promise<void> => {
            await tools.waitFor(() => {
                const el = tools.elementOf(root);

                return el !== null && tools.isPainted(el);
            }, MOUNT_TIMEOUT_MS, `panel ${id}`);
        },
        settled: (): Promise<void> => tools.sleep(PANEL_SETTLE_MS),
    };
}

/**
 * Loads, builds and mounts panel `id`, runs its `afterMount`, and merges the
 * targets — `afterMount`'s entries over `build.targets`, over the page-wide
 * `idle` and `theme` targets.
 *
 * @param id - The panel id.
 * @param params - The page's URL parameters; `n=` sets the scale.
 * @param tools - The harness tools, for `afterMount`.
 * @param waits - The two waits; the real ones by default.
 * @returns The mounted panel.
 * @throws Error - `panel module <id> not found`, before any wait, when no file has that id.
 */
export async function mountPanel(id: string, params: URLSearchParams, tools: HarnessTools, waits: MountWaits = defaultMountWaits(tools)): Promise<MountedPanel> {
    const module = await loadPanel(id);

    if (!module) {
        throw new Error(`panel module ${id} not found`);
    }

    const n = parseScale(params.get('n'), module.defaultScale);
    const build = module.build(n, params);

    Body.init({ layoutManager: Fit(), components: [build.root] });
    await waits.painted(build.root, id);
    await waits.settled();

    // Awaited: a panel whose data arrives after the mount — a store that built
    // its view on a worker — waits for it in `afterMount` and returns a promise.
    const mounted = (await build.afterMount?.(tools)) ?? {};

    // `afterMount` may have changed the tree.
    if (build.afterMount) {
        await waits.settled();
    }

    return { module, n, build, targets: { ...pageTargets(build.root), ...build.targets, ...mounted } };
}

/**
 * Mounts panel `id` with the default waits, as the harness's `PanelHost.setup`.
 *
 * @param id - The panel id.
 * @param ctx - The run's setup context; a `panel <id> n=<n>` note is added.
 * @returns What the harness measures.
 */
export async function setupPanel(id: string, ctx: SetupContext): Promise<Subject> {
    const { module, n, build, targets } = await mountPanel(id, ctx.params, ctx.tools);

    ctx.notes.push(`panel ${id} n=${n}`);

    return {
        defaultDrive: module.defaultDrive,
        targets,
        geometry: build.geometry,
        describe: build.describe,
        installWork: build.installWork,
    };
}

/**
 * Mounts panel `id` with the default waits, for a person to look at; nothing
 * is measured, and an error goes to `console.error`.
 *
 * @param id - The panel id.
 * @param params - The page's URL parameters.
 * @param tools - The harness tools.
 */
export async function previewPanel(id: string, params: URLSearchParams, tools: HarnessTools): Promise<void> {
    try {
        await mountPanel(id, params, tools);
    } catch (error) {
        console.error(error);
    }
}
