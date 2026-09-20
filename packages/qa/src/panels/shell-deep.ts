import { buildShell } from '../builders/shell.js';
import type { PanelBuild } from '../panels.js';

export const description = 'Application shell standing in for Loom\'s S1 scenario (mode=filetree&tabs=4&grid=2x2&gutter=dock-h): a menu bar, an explorer Accordion (open file tree, open outline, closed history) beside a 2×2 Dock grid of CodeEditors, n tabs per region, under a toolbar, and a status bar. Built from the library over generated content, so its numbers do not match Loom\'s history. Under park it reproduces slice 06 F06.3 (a gutter drag clamped at a pane\'s minimum still re-lays out both panes every frame); under drag with grip=sidebar, slice 08 F08.3 (a closed section is re-measured and re-laid out every pass); under theme, slice 23 F23.1 (51 CSS rules per editor per theme switch).';

/** One tab per dock region: S1's four editors. */
export const defaultScale = 1;

/** Loom's S1 phases: the dock gutter drag, then the file-tree wheel. */
export const defaultDrive = 'drag,wheel:120';

/**
 * Builds the deep shell.
 *
 * @param n - Tabs per dock region.
 * @param params - `grip=`, `hover=`, `wheel=` and `toggle=` choose targets.
 * @returns The shell.
 */
export function build(n: number, params: URLSearchParams): PanelBuild {
    return buildShell(n, 'deep', params, 'shell-deep');
}
