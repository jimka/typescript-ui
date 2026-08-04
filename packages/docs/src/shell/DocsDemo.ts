import { callable, Component, Container, Panel, ThemeManager } from '@jimka/typescript-ui/core';
import type { ContainerOptions } from '@jimka/typescript-ui/core';
import { Fit, VBox, AnchorType } from '@jimka/typescript-ui/layout';
import { ToggleButton } from '@jimka/typescript-ui/component/button';
import { Markdown } from '@jimka/typescript-ui/component/display';
import { UNBOUNDED } from '@jimka/typescript-ui/primitive';
import type { DemoEntry } from '../content/demos.js';

const SHOW_SOURCE_LABEL = "Show source";
const HIDE_SOURCE_LABEL = "Hide source";

/**
 * Widest a demo block is allowed to get, whatever the window, resolved from
 * Markdown's own `--ts-ui-md-max-measure` theme token so a demo block's right
 * edge lines up with the prose column around it instead of sticking out past
 * it. Resolved via an off-screen probe rather than parsed from the `ch`
 * value by hand — `ch` is font-relative, and the probe picks up whatever
 * font the active theme has applied to `<html>`, the same as Markdown's own
 * prose.
 *
 * It sits on the block rather than on the stage so the "Show source" toggle,
 * anchored to the block's east edge, stays against the stage's right edge
 * instead of drifting off to the far side of the pane.
 *
 * @returns The resolved max width in pixels, rounded up.
 */
function resolveBlockMaxWidth(): number {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;visibility:hidden;width:var(--ts-ui-md-max-measure, 70ch);';
    document.body.appendChild(probe);
    const width = probe.getBoundingClientRect().width;
    document.body.removeChild(probe);

    return Math.ceil(width);
}

/**
 * An inline live demo block: a bordered, scrollable stage holding the
 * demo's live component tree, a "Show source" toggle, and a collapsed
 * Markdown panel revealing the demo module's own TypeScript source. See
 * "A demo is a module in `packages/docs/src/demos/`" and "A demo block
 * stops the docs app's link interception at its own boundary" in
 * plans/implemented/docs-inline-demos.md.
 */
class DocsDemo extends Container {

    private readonly _stage:  Panel;
    private readonly _toggle: ToggleButton;
    private readonly _source: Markdown;

    // Component.afterNextLayout has no cancellation, so a queued
    // handleSourceMeasured callback outlives a dispose that lands between
    // the toggle click and the next animation frame; this flag lets that
    // callback recognise the block is gone and no-op instead of touching a
    // torn-down component.
    private _disposed = false;

    // Stable reference so the toggle's `listeners` bag always sees the same
    // function identity; delegates to the named handler below.
    private readonly handleToggleSource: () => void = () => this.onToggleSource();

    // Stable reference for Component.afterNextLayout, mirroring
    // handleToggleSource above — see onToggleSource for why a second relay
    // is needed after the first.
    private readonly handleSourceMeasured: () => void = () => {
        if (!this._disposed) {
            this.notifyIntrinsicSizeChanged();
        }
    };

    /**
     * Handle to detach the {@link ThemeManager.onThemeChange} listener on
     * {@link destructor}. That listener also fires once the web font
     * settles (see `Theme.ts`'s `scheduleFontReflow`), which is why it is
     * needed here at all: `resolveBlockMaxWidth`'s first call, made from the
     * constructor below, can race the font-display: swap fallback face and
     * cache a wrong (too-wide) measure — this re-resolves it once the real
     * face is active, mirroring `Markdown`'s own re-measure-on-theme-change.
     */
    private readonly _unsubscribeTheme: () => void;

    constructor(entry: DemoEntry, options?: ContainerOptions) {
        super(options, {
            layoutManager: VBox({ stretching: true }),
            maxSize:       { width: resolveBlockMaxWidth(), height: UNBOUNDED },
        });

        this._unsubscribeTheme = ThemeManager.onThemeChange(() => {
            this.setMaxSize({ width: resolveBlockMaxWidth(), height: UNBOUNDED });
        });

        this.setDataAttribute('docs-demo', 'true');

        this._stage = new Panel({
            layoutManager: Fit(),
            autoScroll:    'both',
            border:        '1px solid var(--ts-ui-border-color, #ccc)',
            minSize:       { width: 0, height: entry.module.height },
            preferredSize: { width: 0, height: entry.module.height },
            components:    [entry.module.create()],
        });

        this._toggle = new ToggleButton(SHOW_SOURCE_LABEL, {
            listeners: { action: this.handleToggleSource },
        });

        this._source = new Markdown('```typescript\n' + entry.source.trimEnd() + '\n```', {
            displayed: false,
        });

        this.addComponent(this._stage);
        this.addComponent(this._toggle, { anchor: AnchorType.EAST });
        this.addComponent(this._source);
    }

    /**
     * Toggles the source panel's visibility, relabels the toggle, and folds
     * the resulting height change into the pane's scroll extent.
     *
     * Two relays are needed. `setDisplayed` neither schedules a layout nor
     * tells the parent this block now wants a different height, so the
     * first `notifyIntrinsicSizeChanged` call starts the pass. But the
     * source view's prose height is only measured once it has actually laid
     * out, and that measurement schedules this block's own layout, not the
     * pane's — `handleSourceMeasured` runs after that flush and folds the
     * measured height into the pane's scroll extent.
     */
    private onToggleSource(): void {
        const shown = this._toggle.isSelected();

        this._source.setDisplayed(shown);
        this._toggle.setText(shown ? HIDE_SOURCE_LABEL : SHOW_SOURCE_LABEL);
        this.notifyIntrinsicSizeChanged();

        Component.afterNextLayout(this.handleSourceMeasured);
    }

    /**
     * Marks this block as torn down before the base teardown runs, so a
     * `handleSourceMeasured` callback still queued from a "Show source"
     * click that landed just before disposal finds `_disposed` and no-ops.
     */
    protected destructor(): void {
        this._disposed = true;
        this._unsubscribeTheme();

        super.destructor();
    }
}

const DocsDemoCallable = callable(DocsDemo);
type  DocsDemoCallable = DocsDemo;
export {
    DocsDemo         as _DocsDemo,
    DocsDemoCallable as DocsDemo,
};
