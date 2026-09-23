import { defineTheme, ModernTheme, Panel } from '@jimka/typescript-ui/core';
import type { Component } from '@jimka/typescript-ui/core';
import { Text } from '@jimka/typescript-ui/component/input';
import type { TextOptions } from '@jimka/typescript-ui/component/input';
import { HBox, VBox } from '@jimka/typescript-ui/layout';
import { themeTarget } from '../pageTargets.js';
import type { PanelBuild } from '../panels.js';

export const description = 'Text labels at their preferred sizes in nine fonts: a baseline row of one "Hxg" per font, over nine columns of n strings each (default 12), every label geometry-probed. Reproduces G18\'s canvas-versus-probe parity check (plans/implemented/text-measurement-without-reflow.md): every labelled width and height is a measured text size, so a one-pixel difference between the layout-free canvas measurement and the DOM probe is a geometry DIFF between the arms of an A/B; `update` re-texts every column with strings absent at mount, one measureTexts per unit on a probe-only build and none on a canvas build.';

/** Twelve strings per column: all of `MOUNT_STRINGS`. */
export const defaultScale = 12;

/** Every column's labels re-texted each unit, after one unchanged pass. */
export const defaultDrive = 'passes,update:24';

/**
 * The fonts, one per column and one per baseline label: the default, a
 * numeric and a keyword weight, italic, small caps, two px sizes, a
 * theme-bound `calc()` size token and another family.
 */
const FONTS: readonly TextOptions[] = [
    {},
    { fontWeight: '600' },
    { fontWeight: 'bold' },
    { fontStyle: 'italic' },
    { fontVariant: 'small-caps' },
    { fontSize: 12 },
    { fontSize: 20 },
    { fontSize: '--ts-ui-header-font-size' },
    { fontFamily: 'serif' },
];

/**
 * The strings the columns mount with, one per row. `Łódź` pulls in the lazy
 * Latin-Ext subset during mount, before anything is measured.
 */
const MOUNT_STRINGS: readonly string[] = [
    'Ready', 'File', 'Edit', 'Ln 1, Col 1', 'Command 12', 'Settings…',
    'Open Recent', '1,000', 'Jan 2026', 'Łódź', 'W', 'Save As…',
];

/**
 * The strings `update` cycles through. None appears at mount, so on a canvas
 * build every first measurement of one is a canvas measurement.
 */
const UPDATE_STRINGS: readonly string[] = [
    'Ln 128, Col 42', 'AVAWAY To Ty Yo', 'office affluent', '0123456789', 'Sphinx of black quartz', 'żółć ąę',
    '日本語テキスト', 'Q4: $12,345.67', 'getPreferredSize()', 'naïve café', 'P. T. Barnum', 'iiiWWW',
];

/** The text the baseline row measures: a cap, an x-height letter and a descender. */
const BASELINE_TEXT = 'Hxg';

// Gaps in px between the rows, the columns and the labels of a column: room
// to tell the labels apart in a screenshot, and fixed so both arms lay out
// the same tree.
const ROW_SPACING_PX = 8;
const COLUMN_SPACING_PX = 12;
const LABEL_SPACING_PX = 2;

/** A theme whose base font size differs from `ModernTheme`'s, so a theme switch changes every measured width. */
const LARGE_FONT_THEME = defineTheme(ModernTheme, { font: { size: '16px' } });

/**
 * Builds the baseline row and the columns of `n` labels per font.
 *
 * @param n - Strings per column, capped at `MOUNT_STRINGS.length`.
 * @returns The root panel, target of `passes`; `update`, which sets every column's row `r` to `UPDATE_STRINGS[(r + index) % 12]`; `theme`, a switch to a 16 px base font; a geometry label per Text; and the string and font counts.
 */
export function build(n: number): PanelBuild {
    const rows = Math.min(n, MOUNT_STRINGS.length);
    const baselineLabels = FONTS.map((font) => Text(BASELINE_TEXT, font));
    const columns = FONTS.map((font) => MOUNT_STRINGS.slice(0, rows).map((text) => Text(text, font)));

    const root = Panel({
        layoutManager: VBox({ spacing: ROW_SPACING_PX }),
        components: [
            Panel({ layoutManager: HBox({ spacing: COLUMN_SPACING_PX }), components: baselineLabels }),
            Panel({
                layoutManager: HBox({ spacing: COLUMN_SPACING_PX, itemAlign: 'start' }),
                components: columns.map((labels) => Panel({ layoutManager: VBox({ spacing: LABEL_SPACING_PX }), components: labels })),
            }),
        ],
    });

    const geometry: Record<string, Component> = {};

    baselineLabels.forEach((label, k) => {
        geometry[`b${k}`] = label;
    });

    columns.forEach((labels, k) => {
        labels.forEach((label, r) => {
            geometry[`t${k}r${r}`] = label;
        });
    });

    return {
        root,
        targets: {
            passes: root,
            update: (index: number): void => {
                for (const labels of columns) {
                    labels.forEach((label, r) => label.setText(UPDATE_STRINGS[(r + index) % UPDATE_STRINGS.length]));
                }
            },
            theme: themeTarget([LARGE_FONT_THEME]),
        },
        geometry,
        describe: () => ({ strings: rows, fonts: FONTS.length }),
    };
}
