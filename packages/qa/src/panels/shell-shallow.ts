import { buildShell } from '../builders/shell.js';
import type { PanelBuild } from '../panels.js';

export const description = 'Application shell standing in for Loom\'s S3 scenario (mode=filetree&tabs=1&gutter=explorer): shell-deep\'s menu bar, explorer, toolbar and status bar around a Dock of a single region of CodeEditors, n tabs. Built from the library over generated content, so its numbers do not match Loom\'s history. Under park it reproduces slice 06 F06.3 (a gutter drag clamped at a pane\'s minimum still re-lays out both panes every frame); under drag with grip=sidebar, slice 08 F08.3 (a closed section is re-measured and re-laid out every pass); under theme, slice 23 F23.1 (51 CSS rules per editor per theme switch).';

/** One tab: S3's one editor. */
export const defaultScale = 1;

/** Loom's S3 phases: the explorer gutter drag, then the file-tree wheel. */
export const defaultDrive = 'drag,wheel:120';

/**
 * Builds the shallow shell.
 *
 * @param n - Tabs in the dock's region.
 * @param params - `grip=`, `hover=`, `wheel=` and `toggle=` choose targets.
 * @returns The shell.
 */
export function build(n: number, params: URLSearchParams): PanelBuild {
    return buildShell(n, 'shallow', params, 'shell-shallow');
}
