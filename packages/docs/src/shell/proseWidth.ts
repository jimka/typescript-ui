/**
 * Resolves the current reading measure — Markdown's own
 * `--ts-ui-md-max-measure` theme token — to a real pixel width via an
 * off-screen probe, since the JS layout engine's `setMaxSize`/preferred-size
 * machinery needs a plain number and can't consume a CSS var directly. `ch`
 * is font-relative, so the probe (not a hand-parsed `ch` value) picks up
 * whatever font the active theme has applied to `<html>`, the same font
 * Markdown's own prose measures against.
 *
 * Shared by {@link DocsDemo} (so a demo block's right edge lines up with the
 * prose column around it) and `DocsContent` (so its own width caps to the
 * reading measure instead of stretching to fill an `HBox` row, leaving no
 * room for a sibling like `MarkdownMinimap`).
 *
 * @returns The resolved max width in pixels, rounded up.
 */
export function resolveProseMeasureWidth(): number {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;visibility:hidden;width:var(--ts-ui-md-max-measure, 70ch);';
    document.body.appendChild(probe);
    const width = probe.getBoundingClientRect().width;
    document.body.removeChild(probe);

    return Math.ceil(width);
}
