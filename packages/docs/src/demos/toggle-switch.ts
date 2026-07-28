import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { HBox } from '@jimka/typescript-ui/layout';
import { Toggle } from '@jimka/typescript-ui/component/input';

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
 * A Wi-Fi `Toggle` starting on and a Bluetooth `Toggle` starting off, so a
 * click shows the slide animation running in each direction.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const wifiToggle = Toggle({ label: 'Wi-Fi', value: true });

    const bluetoothToggle = Toggle({ label: 'Bluetooth', value: false });

    return Panel({
        layoutManager: HBox({ spacing: 16 }),
        components:    [wifiToggle, bluetoothToggle],
    });
}
