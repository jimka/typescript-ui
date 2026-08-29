import { DOM } from '@jimka/typescript-ui/core';

/**
 * Resolves the current reading measure — Markdown's own
 * `--ts-ui-md-max-measure` theme token — to a real pixel width via an
 * off-screen probe, since the JS layout engine's `setMaxSize`/preferred-size
 * machinery needs a plain number and can't consume a CSS var directly. `ch`
 * is font-relative, so the probe (not a hand-parsed `ch` value) picks up
 * whatever font the active theme has applied to `<html>`, the same font
 * Markdown's own prose measures against.
 *
 * Used by `DocsDemo` so a demo block's right edge lines up with the prose
 * column around it.
 *
 * @returns The resolved max width in pixels, rounded up.
 */
export function resolveProseMeasureWidth(): number {
    const body  = DOM.source.getBody();
    const probe = DOM.sink.createElement('div');

    DOM.sink.apply(probe, {
        style: {
            position:   'fixed',
            visibility: 'hidden',
            width:      'var(--ts-ui-md-max-measure, 70ch)',
        },
    });

    DOM.sink.appendChild(body, probe);

    const width = DOM.source.getElementRect(probe).width;

    DOM.sink.removeChild(body, probe);
    DOM.sink.release(probe);

    return Math.ceil(width);
}
