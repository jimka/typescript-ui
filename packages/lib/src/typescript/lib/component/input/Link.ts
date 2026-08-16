// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Text, TextOptions } from "~/component/input/Text.js";
import { Event } from "~/core/Event.js";
import { StyleRule } from "~/core/StyleTarget.js";
import { callable } from "~/core/Callable.js";
import type { ClickListener } from "~/component/button/Button.js";

/**
 * The link foreground colour. `--ts-ui-link-color` lets a theme retint every
 * link at once; the literal is the shipped fallback.
 */
const LINK_COLOR_CSS = "var(--ts-ui-link-color, rgb(21, 101, 192))";

/**
 * The link's two class-level rules.
 *
 * The underline is constant for every link and varies per instance for none, so
 * it is a rule on the class rather than per-instance state: it costs one CSS
 * rule for the whole page instead of one per link, and it is not an options
 * field, which would owe a typed setter, a getter and a cache it has no use
 * for. A caller who wants it gone passes a `styleRules` entry — those compile
 * to an `#<id>` selector, and an id outranks a class, so the caller's rule wins
 * on specificity without any ordering subtlety.
 *
 * The focus mark uses `:focus-visible` rather than the `:focus` the text inputs
 * use: a link is activated by clicking it, and `:focus` would leave the ring
 * painted after the click. A plain `outline` suffices — the `::after` ring in
 * `focusRing.ts` exists for composite inputs painting onto outer chrome,
 * whereas a link is a leaf element that focuses itself. Note `outlineOffset`
 * pushes the ring *outward*, so it does not protect against an ancestor's
 * `overflow: hidden`; if clipping ever shows up, that `::after` inset ring is
 * the fallback.
 *
 * Both rules key off `.Link`, which comes from the class name, so a subclass
 * would not inherit them — `Link` is not designed for extension.
 */
(() => {
    new StyleRule({
        scope:  "selector",
        name:   ".Link",
        styles: {
            textDecoration: "underline",
        },
    });

    new StyleRule({
        scope:  "selector",
        name:   ".Link:focus-visible",
        styles: {
            outline:       "2px solid var(--ts-ui-indicator-focus, rgb(30, 100, 200))",
            outlineOffset: "1px",
        },
    });
})();

/**
 * String-literal union of the events emitted by {@link Link}. A typed shorthand
 * over the `Event` API — the DOM `"click"` event is dispatched through the
 * framework's window-level capture handler.
 *
 * @category Components
 */
export type LinkEvent = "action";

/**
 * Construction-time options for {@link Link}.
 *
 * @category Components
 */
export interface LinkOptions extends TextOptions {

    /**
     * When `false`, the link is presentational: it claims no `role` and no
     * `tabindex`, and it does not activate on Enter. For a link inside a
     * container that owns its own keyboard navigation and click routing — a
     * table cell, say — where a focusable child would fight the host.
     * Defaults to `true`.
     *
     * This is not a disabled state: the link keeps its normal appearance, and
     * a host that routes its own clicks still acts on them.
     */
    interactive?: boolean;

    /**
     * Construction-time listener wiring — the declarative form of
     * {@link Link.on}. The `action` entry is wired as if `on("action", fn)`
     * had been called.
     */
    listeners?: { action?: ClickListener };
}

// Only getter-backed options belong here, which is what `_defaultOptions` is
// for: Component resolves `tag` from it, and `applyStyle` re-reads the two
// folding getters at render, so all three survive without an `applyOptions`
// dispatch — and `clearForegroundColor()` still suppresses the default.
// `interactive` is here so the always-dispatch `?? this.isInteractive()` in
// applyOptions resolves the class default.
//
// The underline is deliberately absent: it is constant styling, not per-instance
// state, so it is a class-level rule above rather than an option. (`applyOptions`
// reads `styleRules` only from the caller's bag, so a default here would be
// dropped silently anyway.)
const _defaultLinkOptions: Partial<LinkOptions> = {
    tag:             "a",
    foregroundColor: LINK_COLOR_CSS,
    cursor:          "pointer",
    interactive:     true,
};

/**
 * A text link: link-coloured, underlined, and activated by a click or the
 * Enter key. Its **hit area is exactly its text** — it is a {@link Text}
 * subclass rendering a real `<a>`, so the box is the glyph box, unlike a
 * chromeless [`Button`](/api/component/button/classes/Button) whose padding
 * overshoots its label.
 *
 * There is no `href`: a `Link` navigates nothing by itself and activation is
 * always `on("action", fn)`. Enter activates it; Space does not, because Space
 * is button semantics.
 *
 * The hit area only equals the text while the parent sizes the link to its
 * preferred width. A `Fit` parent, or an `HBox`/`VBox` with `stretching: true`,
 * widens the box and the hit area with it.
 *
 * `Link` inherits {@link Text}'s theme subscription, so a link created
 * dynamically and removed from the page must be `dispose()`d — which also
 * releases its keyboard listener.
 *
 * @example
 * ```typescript
 * import { Link } from '@jimka/typescript-ui/component/input';
 *
 * const link = new Link('Open the release notes', {
 *     listeners: { action: () => openReleaseNotes() },
 * });
 * panel.addComponent(link);
 * ```
 *
 * @category Components
 */
class Link extends Text<LinkOptions> {

    // No `_interactive` backing field: `_options` is the cache. A field
    // initializer here would run after super() and clobber the value the
    // applyOptions cascade wrote.

    constructor(text?: String, options?: LinkOptions, subclassDefaults?: Partial<LinkOptions>) {
        super(text, options, { ..._defaultLinkOptions, ...(subclassDefaults ?? {}) });

        // Wired once for the component's whole life, regardless of
        // `interactive`: handleKeyDown self-guards, so the flag needs no
        // listener churn — and a non-interactive link can never be a keydown
        // target anyway, since it is not focusable and Event dispatches by
        // event target. dispose() removes it.
        Event.addListener(this, "keydown", this.handleKeyDown);

        this.applyListeners(options?.listeners);
    }

    /**
     * Dispatches the `interactive` option to its setter.
     *
     * @param options - The caller's construction options.
     *
     * @returns This link, for method chaining.
     */
    protected applyOptions(options: LinkOptions): this {
        super.applyOptions(options);

        // Always-dispatch: the effect is construction-time with no render
        // re-read, so the class default must fire too. Gating this on
        // `options.interactive !== undefined` would leave a default link
        // without its role and tabindex.
        this.setInteractive(options.interactive ?? this.isInteractive());

        return this;
    }

    /**
     * Whether this link is focusable and keyboard-activatable.
     *
     * @returns `true` when the link claims its interactive affordance.
     */
    isInteractive(): boolean {
        return this._options.interactive ?? this._defaultOptions.interactive ?? true;
    }

    /**
     * Toggles the link's interactive affordance. `role` and `tabindex` move
     * together because both describe the one affordance.
     *
     * Does no listener work: the keyboard handler is wired once in the
     * constructor and reads this flag when it fires. No idempotence guard is
     * needed either — the ARIA setters are value-assignments, and the listener
     * is never re-registered.
     *
     * @param value - `true` to make the link focusable and keyboard-activatable.
     *
     * @returns This link, for method chaining.
     */
    setInteractive(value: boolean): this {
        this._options.interactive = value;

        if (value) {
            // An `<a>` with no href is neither focusable nor exposed as a link
            // (it maps to `generic`), so both are supplied explicitly.
            this.getAria().setRole("link").setTabIndex(0);
        } else {
            // A presentational link claims neither: it cannot be activated, and
            // its host already announces the text.
            this.getAria().clearRole().setTabIndex(null);
        }

        return this;
    }

    /**
     * Registers a listener for this link's `"action"` event — fired on click
     * and on Enter. A typed semantic shorthand over the `Event` API (the
     * underlying DOM event is `"click"`).
     *
     * @param event - The event name. Only `"action"` is accepted.
     * @param listener - The callback to invoke when the link is actioned.
     *
     * @returns This link, for method chaining.
     */
    on(event: "action", listener: ClickListener): this;
    on(_event: "action", listener: ClickListener): this {
        Event.addListener(this, "click", listener);

        return this;
    }

    /**
     * Removes a previously registered `"action"` listener. The exact callback
     * reference must match the one passed to {@link on}.
     *
     * @param event - The event the listener was registered for.
     * @param listener - The callback to remove.
     *
     * @returns This link, for method chaining.
     */
    off(event: "action", listener: ClickListener): this;
    off(_event: "action", listener: ClickListener): this {
        Event.removeListener(this, "click", listener);

        return this;
    }

    /**
     * Programmatically actions the link, as if the user had clicked it: fires
     * this link's own `"click"` event so every registered {@link on | `"action"`}
     * handler runs. With no handler registered this is a no-op — the link has
     * no click plumbing of its own.
     *
     * @returns This link, for method chaining.
     */
    click(): this {
        Event.fireEvent(this, "click");

        return this;
    }

    /**
     * Activates on Enter only — Space is button semantics, not link semantics.
     * A no-href `<a>` fires no native click on Enter, so it is synthesised
     * here; with no href it can never double-fire.
     *
     * The `isInteractive()` guard keeps the link locally correct rather than
     * resting on the browser never targeting a non-focusable element.
     *
     * A prototype method, not an arrow field: `Event` binds `this` by applying
     * the listener to the component, and the stable reference is what lets
     * `dispose()` unregister it.
     *
     * @param event - The keyboard event being handled.
     */
    private handleKeyDown(event: KeyboardEvent): Event.ListenerResult {
        if (!this.isInteractive()) {
            return;
        }

        if (event.key !== "Enter") {
            return;
        }

        this.click();

        return { prevent: true };
    }
}

const LinkCallable = callable(Link);
type LinkCallable = Link;
export {
    Link         as _Link,
    LinkCallable as Link
};
