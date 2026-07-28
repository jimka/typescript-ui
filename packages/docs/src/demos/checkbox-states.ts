import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { HBox } from '@jimka/typescript-ui/layout';
import { Checkbox } from '@jimka/typescript-ui/component/input';
import { Button } from '@jimka/typescript-ui/component/button';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 64 is one row of default-height controls plus room around the frame for
 * the stage's border.
 */
export const height: number = 64;

/**
 * An unchecked, a checked, and a cycling `Checkbox`; the button steps the
 * third through unchecked, checked, and indeterminate.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const uncheckedBox = Checkbox({ label: 'Unchecked' });

    const checkedBox = Checkbox({ label: 'Checked', value: true });

    const cyclingBox = Checkbox({ label: 'Cycling' });

    const cycleButton = Button({ text: 'Cycle state', listeners: { action: handleCycle } });

    let cycleState: 'unchecked' | 'checked' | 'indeterminate' = 'unchecked';

    function handleCycle(): void {
        if (cycleState === 'unchecked') {
            cyclingBox.setSelected(true);
            cycleState = 'checked';
        } else if (cycleState === 'checked') {
            cyclingBox.setIndeterminate(true);
            cycleState = 'indeterminate';
        } else {
            cyclingBox.setIndeterminate(false);
            cyclingBox.setSelected(false);
            cycleState = 'unchecked';
        }
    }

    return Panel({
        layoutManager: HBox({ spacing: 8 }),
        components:    [uncheckedBox, checkedBox, cyclingBox, cycleButton],
    });
}
