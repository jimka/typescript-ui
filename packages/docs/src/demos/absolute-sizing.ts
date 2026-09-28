import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { Absolute, Border, HBox } from '@jimka/typescript-ui/layout';
import { Placement } from '@jimka/typescript-ui/primitive';
import { Header } from '@jimka/typescript-ui/component/display';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 260 is the two captioned canvases plus the surrounding frame — the same
 * layout-manager height class every other demo on this page and its sibling
 * layout pages uses.
 */
export const height: number = 260;

/**
 * Two `Absolute` canvases over identically set-up children, differing only in
 * the container's `sizing` option. Each child is a plain grey `Panel` that sits
 * at `16,16`, already holds a 200x40 rectangle, and reports a 90x40 preferred
 * size — the mismatch the option exists for.
 *
 * Expected on the page: the left bar renders 90 wide, because `"preferred"`
 * re-sizes each child to the size it reports; the right bar renders 200 wide,
 * because `"committed"` keeps the rectangle the child already holds. Both bars
 * stay at `16,16` — neither mode touches the position.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    // Both children are built the same way, so the only thing that can explain
    // a difference on the page is the container's `sizing`: the held rectangle
    // (`setSize`) is what `"committed"` keeps, the reported one
    // (`setPreferredSize`) is what `"preferred"` re-sizes to.
    //
    // A plain `Panel` is the child rather than a `Header` or a `Button`,
    // because both of those re-derive their own preferred size on a theme
    // change (`Header.subscribeTheme` -> `updatePreferredSize`,
    // `Button._onThemeChange` -> `recomputePreferredSize`), which would
    // overwrite the 90x40 this demo sets and break the very comparison it
    // exists to show the moment someone toggles the theme. `Panel` subscribes
    // to no theme signal, so the reported size stays the one set here. It
    // paints nothing by default, hence the explicit fill. It is a theme token
    // rather than a literal, both because this package's demo hygiene test
    // forbids colour literals and because a token follows the active theme:
    // `chart.series` is emitted as `--ts-ui-chart-series-N` for every theme,
    // so its first entry is a colour that is always defined and always legible
    // against the stage.
    const preferredCell = Panel({ backgroundColor: 'var(--ts-ui-chart-series-1)' });
    preferredCell.setX(16).setY(16);
    preferredCell.setPreferredSize({ width: 90, height: 40 });
    preferredCell.setSize({ width: 200, height: 40 });

    const preferredCanvas = Panel({ layoutManager: Absolute({ sizing: 'preferred' }) });
    preferredCanvas.addComponent(preferredCell);

    const preferredCaption = Header('sizing: "preferred" — re-sized to 90x40');

    const preferredColumn = Panel({ layoutManager: Border({ spacing: 4 }) });
    preferredColumn.addComponent(preferredCaption, { placement: Placement.NORTH });
    preferredColumn.addComponent(preferredCanvas, { placement: Placement.CENTER });

    const committedCell = Panel({ backgroundColor: 'var(--ts-ui-chart-series-1)' });
    committedCell.setX(16).setY(16);
    committedCell.setPreferredSize({ width: 90, height: 40 });
    committedCell.setSize({ width: 200, height: 40 });

    const committedCanvas = Panel({ layoutManager: Absolute({ sizing: 'committed' }) });
    committedCanvas.addComponent(committedCell);

    const committedCaption = Header('sizing: "committed" — kept at 200x40');

    const committedColumn = Panel({ layoutManager: Border({ spacing: 4 }) });
    committedColumn.addComponent(committedCaption, { placement: Placement.NORTH });
    committedColumn.addComponent(committedCanvas, { placement: Placement.CENTER });

    return Panel({
        layoutManager: HBox({ mode: 'equal', itemAlign: 'stretch', spacing: 16 }),
        components:    [preferredColumn, committedColumn],
    });
}
