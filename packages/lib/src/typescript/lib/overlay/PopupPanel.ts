// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AnimatedDropdown, AnimatedDropdownOptions } from "~/core/AnimatedDropdown.js";
import { DOM } from "~/core/DOM.js";
import type { Handle, Rect } from "~/core/DOM.js";
import { positionAnchoredFlexible, AnchoredFlexiblePlacement } from "~/core/OverlayPosition.js";
import { Insets } from "~/primitive/Insets.js";
import type { Size } from "~/primitive/Size.js";
import { VBox } from "~/layout/VBox.js";
import { callable } from "~/core/Callable.js";
import type { StyleBag } from "~/core/ClassStyleRules.js";

/**
 * Construction-time options for {@link PopupPanel}. Adds no fields of its
 * own — content, layout, insets, and a pinned size all come from the
 * inherited {@link AnimatedDropdownOptions} / `ComponentOptions` fields
 * (`layoutManager`, `components`, `insets`, `preferredSize`).
 *
 * @category Components
 */
export interface PopupPanelOptions extends AnimatedDropdownOptions {}

/** Pixels kept between a clamped panel and the viewport edge so the panel
 *  border and shadow are never flush against the screen. Mirrors the small
 *  inset used by other floating panels (e.g. {@link Menu}); purely cosmetic
 *  breathing room. */
const VIEWPORT_MARGIN = 4;

/**
 * User-overridable visual defaults forwarded to `super` via the options bag.
 * Split out from the constructor's inline literal (which also carries
 * fresh-per-instance `layoutManager`/`insets` values) so the CSS-relevant
 * subset alone can double as this class's `ownClassStyleDefaults` — sharing
 * a `VBox` layout manager across every panel would be a real bug, so that
 * field (and `insets`) stays inline at the call site.
 */
const _defaultPopupPanelOptions: Partial<PopupPanelOptions> = {
    backgroundColor: "var(--ts-ui-autocomplete-bg, rgb(255, 255, 255))",
    border:          "var(--ts-ui-input-border)",
    borderRadius:    "var(--ts-ui-border-radius, 4px)",
    shadow:          "var(--ts-ui-autocomplete-shadow, 2px 4px 8px rgba(0,0,0,0.15))",
};

/**
 * A floating panel that sizes itself to its content, places itself against a
 * trigger rect, and caps its height to the room available there — the
 * building block for a custom popup with no overlay plumbing of its own.
 * Content, layout, insets, and a pinned size are supplied through the
 * inherited `ComponentOptions` fields; `PopupPanel` adds only measurement,
 * placement, and the height cap on top of what {@link AnimatedDropdown}
 * already provides (the fade, the portal mount, and the
 * [`DismissableLayer`](/api/core/interfaces/DismissableLayer) contract).
 *
 * Every {@link showAt} recomputes `maxSize` from the room at the anchor and
 * commits the measured content height, so an over-tall panel is capped and
 * scrolls (`overflow-y: auto`) instead of running off-screen. The native
 * scrollbar overlaps the trailing edge of scrolled content — `PopupPanel`
 * reserves no gutter for it, unlike {@link Menu}, because its insets belong
 * to the consumer. A consumer whose popup routinely overflows should wrap
 * its content in a `Panel({ autoScroll: "y" })` under a `Fit` layout, whose
 * own gutter machinery insets correctly.
 *
 * @example
 * ```typescript
 * import { PopupPanel } from '@jimka/typescript-ui/overlay';
 * import { VBox } from '@jimka/typescript-ui/layout';
 * import { Checkbox } from '@jimka/typescript-ui/component/input';
 *
 * const panel = new PopupPanel({
 *     layoutManager: new VBox({ spacing: 4, stretching: true }),
 *     components:    [ new Checkbox({ label: 'Show archived' }) ],
 * });
 *
 * panel.toggleFor(triggerEl, DOM.source.getViewportRect(trigger));
 * ```
 *
 * @category Components
 */
class PopupPanel<TOptions extends PopupPanelOptions = PopupPanelOptions> extends AnimatedDropdown<TOptions> {

    // Own contribution to the hierarchy-aware class tier — see
    // plans/implemented/class-hierarchy-cascade.md. `PopupPanel` deviates
    // from `AnimatedDropdown` on `backgroundColor`/`border`/`borderRadius`/
    // `shadow` (`AnimatedDropdown` itself declares none of these), so it
    // needs its own registration or the hierarchy walk would silently pass
    // through to `AnimatedDropdown`'s shared rule and lose its entire
    // visible chrome.
    protected static readonly ownClassStyleDefaults: StyleBag = _defaultPopupPanelOptions;

    // Opener currently driving the panel via toggleFor, or null when the panel
    // was opened some other way (a direct showAt) or is closed. A plain
    // initializer is correct here — no cascade-dispatched setter writes it.
    private _currentOpener: Handle | null = null;

    /**
     * @param options - Optional construction-time options.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults. Forwarded even though no subclass exists yet, per
     *   the framework's `subclassDefaults` convention.
     */
    constructor(options?: PopupPanelOptions, subclassDefaults?: Partial<PopupPanelOptions>) {
        super(
            options as TOptions,
            {
                // Constructed inline (never hoisted to a module constant) so
                // every panel gets its own layout manager instance.
                layoutManager: new VBox({ stretching: true }),
                insets:        new Insets(4, 4, 4, 4),
                ..._defaultPopupPanelOptions,
                ...(subclassDefaults ?? {}),
            } as Partial<TOptions>,
        );

        this.getAria().setRole("dialog");
        this.setContain("layout");

        // Native vertical scroll for over-tall content — the "y" case of
        // Panel.setAutoScroll, replicated here because PopupPanel is not a
        // Panel. Reading the manager back through getLayoutManager() (rather
        // than the local default above) is what makes the flag land on a
        // caller-supplied manager too.
        this.setOverflowX("hidden");
        this.setOverflowY("auto");
        this.getLayoutManager()?.setOverflowing(false, true);
    }

    /**
     * Measures the panel's content, places it against `anchorRect`, caps its
     * height to the room available there, mounts it, and plays the entrance
     * fade.
     *
     * @param anchorRect - The trigger's bounding rect to place against.
     * @returns This panel, for method chaining.
     */
    showAt(anchorRect: Rect): this {
        // Realise the element before any layout pass: getInnerSize() is null
        // while detached, so a Fit-style manager would size children to 0 on
        // first open.
        this.getElement(true);

        // A reused panel still carries the previous open's height cap; clear
        // it before measuring or the content is capped at the old room.
        this.setMaxSize({ width: Number.MAX_VALUE, height: Number.MAX_VALUE });

        const preferred = this.getPreferredSize();
        const width     = preferred?.width  ?? this.getWidth();
        const height    = preferred?.height ?? this.getHeight();
        const viewport  = DOM.source.getViewportSize();
        const placement = this.resolvePlacement(anchorRect, { width, height }, viewport);

        this.setWidth(width);
        this.setMaxSize({ width: Number.MAX_VALUE, height: Math.max(0, placement.available) });
        this.setHeight(height);
        this.setX(placement.x);
        this.setY(placement.y);

        this.showAnimated();
        this.doLayout();

        return this;
    }

    /**
     * Opens the panel anchored at `anchorRect` for `openerEl`, or closes it
     * when `openerEl` already opened it — the toggle-identity contract every
     * dropdown-style trigger uses (see {@link Menu.toggleFor}). Toggling for a
     * *different* opener while open re-shows the panel at the new rect rather
     * than closing it. `setAnchorElement` runs before {@link showAt} so the
     * layer manager excludes the trigger from its outside-pointerdown test.
     *
     * @param openerEl - The trigger element driving the toggle.
     * @param anchorRect - The trigger's bounding rect to place against.
     * @returns This panel, for method chaining.
     */
    toggleFor(openerEl: Handle, anchorRect: Rect): this {
        if (this.isOpen() && this._currentOpener === openerEl) {
            this.hideAnimated();

            return this;
        }

        this._currentOpener = openerEl;
        this.setAnchorElement(openerEl);

        const openerId = DOM.source.getId(openerEl);
        if (openerId !== "") {
            this.getAria().setLabelledBy(openerId);
        }

        return this.showAt(anchorRect);
    }

    /**
     * Clears the opener identity, then defers to
     * [`AnimatedDropdown.hideAnimated`](/api/core/classes/AnimatedDropdown#hideanimated)
     * for the exit fade and detach. Forgetting the opener here (rather than
     * only in {@link toggleFor}'s own toggle-shut branch) is what makes a
     * `hideAnimated` from any path — an outside dismissal via
     * [`AnimatedDropdown.requestClose`](/api/core/classes/AnimatedDropdown#requestclose),
     * or a direct call — read as a plain close rather than half of a toggle,
     * so the next `toggleFor` for the same opener opens instead of toggling
     * shut.
     *
     * @returns This panel, for method chaining.
     */
    hideAnimated(): this {
        this._currentOpener = null;

        return super.hideAnimated();
    }

    /**
     * Resolves the panel's placement against `anchorRect`. The override
     * point a subclass replaces for different geometry; defaults to
     * {@link positionAnchoredFlexible}.
     *
     * @param anchorRect - The trigger's bounding rect to place against.
     * @param size - The panel's measured (unclamped) preferred width/height.
     * @param viewport - The current viewport size.
     * @returns The resolved top-left coordinate and the room available there.
     */
    protected resolvePlacement(anchorRect: Rect, size: Size, viewport: Size): AnchoredFlexiblePlacement {
        return positionAnchoredFlexible(anchorRect, size, viewport, VIEWPORT_MARGIN);
    }
}

const PopupPanelCallable = callable(PopupPanel);
type  PopupPanelCallable<TOptions extends PopupPanelOptions = PopupPanelOptions> = PopupPanel<TOptions>;
export {
    PopupPanel         as _PopupPanel,
    PopupPanelCallable as PopupPanel,
};
