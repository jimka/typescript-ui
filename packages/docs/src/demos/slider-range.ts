import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { HBox } from '@jimka/typescript-ui/layout';
import { Slider, Text } from '@jimka/typescript-ui/component/input';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 120 is the slider's track plus its thumb travel and the surrounding frame.
 */
export const height: number = 120;

/**
 * A `Slider` over 0-100; the `Text` beside it updates live from the
 * slider's `action` event as the thumb is dragged.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const volumeSlider = Slider({
        min:           0,
        max:           100,
        step:          1,
        value:         50,
        preferredSize: { width: 200, height: 24 },
    });

    const valueText = Text('50');

    volumeSlider.on('action', handleSlide);

    function handleSlide(): void {
        valueText.setText(String(volumeSlider.getValue()));
    }

    return Panel({
        layoutManager: HBox({ spacing: 8 }),
        components:    [volumeSlider, valueText],
    });
}
