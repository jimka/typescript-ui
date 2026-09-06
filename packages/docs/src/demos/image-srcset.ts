import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { VBox } from '@jimka/typescript-ui/layout';
import { Image } from '@jimka/typescript-ui/component/display';
import { Text } from '@jimka/typescript-ui/component/input';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 200 leaves room for the largest candidate (160px tall), the status line,
 * and the frame's own border.
 */
export const height: number = 200;

/**
 * A single `Image` with a width-descriptor `srcset` (a 150-pixel "S"
 * candidate and a 480-pixel "L" candidate) and a `sizes` hint that crosses a
 * breakpoint at 600px viewport width: `100px` below it, `480px` at or above
 * it. No explicit `preferredSize` is set, so `handleLoad()`'s auto-publish
 * path runs on every settle — the status line reports the published natural
 * size live via `on('load', ...)`. Reload this page with the browser window
 * narrower than 600px, then again at 600px or wider, to see the browser
 * resolve a different candidate and the reported size change to match —
 * confirmed against a real Chrome instance to correctly swap candidates and
 * republish on a fresh load at each width. A *live* resize across the
 * breakpoint updates `naturalWidth`/`naturalHeight` on the underlying
 * `<img>` (confirmed the same way) but does not reliably re-fire the native
 * `load` event in every browser, so the status line here is not guaranteed
 * to update without a reload — a platform limit of relying on `load`, not a
 * gap in `handleLoad()`'s own same-size-guard logic, which behaves
 * correctly whenever `load` does fire (see `Image.test.ts`'s offline
 * coverage for that guard).
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const smallSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="50"'
        + ' viewBox="0 0 150 50"><rect width="150" height="50" rx="8"/>'
        + '<text x="55" y="34" font-size="24">S</text></svg>';
    const largeSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="160"'
        + ' viewBox="0 0 480 160"><rect width="480" height="160" rx="24"/>'
        + '<text x="180" y="108" font-size="76">L</text></svg>';

    const smallUri = `data:image/svg+xml,${encodeURIComponent(smallSvg)}`;
    const largeUri = `data:image/svg+xml,${encodeURIComponent(largeSvg)}`;

    const responsiveImage = Image(smallUri, {
        alt:    'A responsive image resolved from a breakpoint-based sizes hint',
        srcset: `${smallUri} 150w, ${largeUri} 480w`,
        sizes:  '(min-width: 600px) 480px, 100px',
    });

    const status = Text('natural size: (decoding…)');

    function reportNaturalSize(): void {
        const size = responsiveImage.getPreferredSize();

        if (size) {
            status.setText(`natural size: ${size.width}x${size.height}`);
        }
    }

    responsiveImage.on('load', reportNaturalSize);

    return Panel({
        layoutManager: VBox({ spacing: 8 }),
        components:    [responsiveImage, status],
    });
}
