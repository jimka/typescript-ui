import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { VBox } from '@jimka/typescript-ui/layout';
import { Image } from '@jimka/typescript-ui/component/display';
import { Text } from '@jimka/typescript-ui/component/input';
import { Button } from '@jimka/typescript-ui/component/button';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 200 leaves room for the fixed 140x100 image box, the status line, and the
 * cycle button, plus the frame's own border.
 */
export const height: number = 200;

/**
 * An `Image` pinned to a box (140x100) that doesn't match its natural aspect
 * ratio (a 2:1 rectangle), cycling through `objectFit`'s five values on each
 * button press: `"fill"` stretches to fill the box (the CSS default this
 * component had no way to override before this plan), `"contain"`
 * letterboxes instead, `"cover"` crops to fill without distortion, and so on.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const rectSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"'
        + ' viewBox="0 0 240 120"><rect width="240" height="120" rx="12"/></svg>';

    const fitValues: Array<'fill' | 'contain' | 'cover' | 'none' | 'scale-down'> =
        ['fill', 'contain', 'cover', 'none', 'scale-down'];
    let fitIndex = 0;

    const boxedImage = Image(
        `data:image/svg+xml,${encodeURIComponent(rectSvg)}`,
        {
            alt:           'A 2:1 rectangle, boxed at a mismatched aspect ratio',
            preferredSize: { width: 140, height: 100 },
            objectFit:     fitValues[fitIndex],
        },
    );

    const status = Text(`object-fit: ${fitValues[fitIndex]}`);

    const cycleButton = Button({ text: 'Cycle object-fit', listeners: { action: handleCycle } });

    function handleCycle(): void {
        fitIndex = (fitIndex + 1) % fitValues.length;
        boxedImage.setObjectFit(fitValues[fitIndex]);
        status.setText(`object-fit: ${fitValues[fitIndex]}`);
    }

    return Panel({
        layoutManager: VBox({ spacing: 8 }),
        components:    [boxedImage, status, cycleButton],
    });
}
