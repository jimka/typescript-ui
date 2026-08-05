import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { HBox } from '@jimka/typescript-ui/layout';
import { Canvas } from '@jimka/typescript-ui/component/display';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 120 is the drawing surface plus room around the frame for the stage's
 * border.
 */
export const height: number = 120;

/**
 * A `Canvas` drawing a circle, a square, and a triangle through its 2D
 * context once, at construction. `currentColor` inherits the surrounding
 * text colour, so the shapes stay themed without a colour literal.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const drawing = Canvas({
        preferredSize: { width: 260, height: 100 },
        onDraw:        (ctx, width, height) => {
            ctx.fillStyle = 'currentColor';

            ctx.beginPath();
            ctx.arc(40, height / 2, 24, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillRect(100, height / 2 - 24, 48, 48);

            ctx.beginPath();
            ctx.moveTo(width - 40, height / 2 - 24);
            ctx.lineTo(width - 16, height / 2 + 24);
            ctx.lineTo(width - 64, height / 2 + 24);
            ctx.closePath();
            ctx.fill();
        },
    });

    return Panel({
        layoutManager: HBox(),
        components:    [drawing],
    });
}
