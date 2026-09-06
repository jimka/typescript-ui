import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { HBox, VBox } from '@jimka/typescript-ui/layout';
import { Image } from '@jimka/typescript-ui/component/display';
import { Text } from '@jimka/typescript-ui/component/input';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 200 leaves room for the 64x64 loaded image and the 48x48 broken-placeholder
 * image side by side, their status lines below, and the frame's own border.
 */
export const height: number = 200;

/**
 * Two `Image`s side by side, neither given an explicit `preferredSize`: one
 * with a valid inline SVG source (explicit `width`/`height="64"` on its root,
 * so its browser-reported natural size — not just its `viewBox` — actually is
 * 64x64, mirroring `image-auto-fit.ts`'s own SVG) that loads normally, and
 * one with a source that 404s, so it fires the native `error` event and
 * settles into the fixed 48x48 broken-placeholder box `handleError()`
 * publishes. A status line under each reports `isLoading()` / `isBroken()`,
 * updated from `on('load', ...)` / `on('error', ...)` listeners. Both
 * sources settle within a frame, so the `.loading` wash itself is not
 * something this demo can show lingering — see `Image.classStyleHoisting
 * .test.ts` for offline coverage of `.loading`'s own chrome, and the docs
 * page's Notes section for the theme variable that styles it. What this demo
 * does show: the plain appearance the left image settles into once loaded,
 * versus the permanent `.broken` wash on the right's now-visible placeholder
 * box.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"'
        + ' viewBox="0 0 64 64"><rect x="8" y="8" width="48" height="48" rx="8"/></svg>';

    const okImage = Image(
        `data:image/svg+xml,${encodeURIComponent(svg)}`,
        { alt: 'A source that loads' },
    );
    const brokenImage = Image('/no-such-image-404.png', { alt: 'A source that fails' });

    const okStatus = Text('loading…');
    const brokenStatus = Text('loading…');

    function reportOkLoaded(): void {
        okStatus.setText(okImage.isLoading() ? 'loading…' : 'loaded');
    }

    function reportBrokenFailed(): void {
        brokenStatus.setText(brokenImage.isBroken() ? 'broken' : 'loading…');
    }

    okImage.on('load', reportOkLoaded);
    brokenImage.on('error', reportBrokenFailed);

    const imagesRow = Panel({
        layoutManager: HBox({ spacing: 16 }),
        components:    [okImage, brokenImage],
    });
    const statusRow = Panel({
        layoutManager: HBox({ spacing: 16 }),
        components:    [okStatus, brokenStatus],
    });

    return Panel({
        layoutManager: VBox({ spacing: 8 }),
        components:    [imagesRow, statusRow],
    });
}
