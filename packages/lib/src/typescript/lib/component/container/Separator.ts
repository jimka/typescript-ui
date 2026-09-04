// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import type { Handle } from "~/core/DOM.js";
import { callable } from "~/core/Callable.js";
import type { AxisOrientation } from "~/primitive/Axis.js";
import { UNBOUNDED } from "~/primitive/Size.js";
import { FillType } from "~/layout/FillType.js";
import { LayoutConstraints } from "~/layout/LayoutConstraints.js";

/**
 * Construction-time options for {@link Separator}.
 *
 * @category Components
 */
export interface SeparatorOptions extends ComponentOptions {
    /** Direction the rule runs. Defaults to `"horizontal"`. */
    orientation?: AxisOrientation;
}

/**
 * User-overridable default fill; a caller-supplied `backgroundColor` wins.
 */
const _defaultSeparatorOptions: Partial<SeparatorOptions> = {
    backgroundColor: "var(--ts-ui-border-color, rgba(127, 127, 127, 0.4))",
};

/**
 * A general-purpose divider rule usable in any container, in either direction —
 * the framework's `<hr>`. A leaf {@link Component} with no children whose own
 * element *is* the line: a one-pixel band filled with the theme's dividing-line
 * colour.
 *
 * `orientation` names the direction the rule runs and defaults to
 * `"horizontal"`, matching `<hr>`. It must be the *opposite* of the direction
 * the parent container stacks children, because the rule runs across the
 * stack: a horizontal separator belongs in a `VBox` (spans the column's
 * width), a vertical separator in an `HBox` (spans the row's height).
 * `Separator` does not read its parent and does not auto-flip.
 *
 * The separator spans its container by writing a cross-axis `fill` layout
 * constraint on the parent's layout manager, which
 * [`HBox`](/api/layout/classes/HBox) and [`VBox`](/api/layout/classes/VBox)
 * read as per-child align-self — a caller-supplied `fill` is left untouched.
 * Other layout managers that don't consult `fill` render the separator at its
 * preferred size, zero along its own axis.
 *
 * Separators report `role="separator"` with a matching `aria-orientation`, and
 * stay out of the keyboard tab order.
 *
 * @example
 * ```typescript
 * import { VBox } from '@jimka/typescript-ui/layout';
 * import { Separator } from '@jimka/typescript-ui/component/container';
 * const panel = new Panel({ layoutManager: new VBox() });
 * panel.addComponent(topText);
 * panel.addComponent(new Separator());
 * panel.addComponent(bottomText);
 * ```
 *
 * @category Components
 */
class Separator extends Component<SeparatorOptions> {

    /** Pixel thickness of the rendered rule — a 1-pixel hairline. */
    static readonly THICKNESS: number = 1;

    private readonly _orientation: AxisOrientation;

    /**
     * Constructs a `Separator`.
     *
     * @param options - Optional construction-time options. `options.orientation`
     *   selects the rule direction; defaults to `"horizontal"`.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(
        options?:          SeparatorOptions,
        subclassDefaults?: Partial<SeparatorOptions>,
    ) {
        super(options, { ..._defaultSeparatorOptions, ...(subclassDefaults ?? {}) });

        this._orientation = options?.orientation ?? "horizontal";

        if (this._orientation === "horizontal") {
            this.setPreferredSize({ width: 0, height: Separator.THICKNESS });
            this.setMinSize({ width: 0, height: Separator.THICKNESS });
            this.setMaxSize({ width: UNBOUNDED, height: Separator.THICKNESS });
        } else {
            this.setPreferredSize({ width: Separator.THICKNESS, height: 0 });
            this.setMinSize({ width: Separator.THICKNESS, height: 0 });
            this.setMaxSize({ width: Separator.THICKNESS, height: UNBOUNDED });
        }

        // The element IS the rule — a 1 px line filled with the theme colour.
        this.getAria().setRole("separator");
        this.getAria().setOrientation(this._orientation);
        this.getAria().setTabIndex(-1);
    }

    /**
     * Returns the orientation passed at construction time.
     *
     * @returns The `Separator` orientation — `"horizontal"` or `"vertical"`.
     */
    getOrientation(): AxisOrientation {
        return this._orientation;
    }

    /**
     * Writes the cross-axis `fill` constraint onto the parent's layout manager,
     * unless the child's stored constraints already carry one.
     *
     * @remarks Silently no-ops when no parent or no layout manager is
     * attached; `init()` re-runs the sync once the separator is rendered as a
     * child of a parent that owns a layout manager.
     */
    private syncFillConstraint(): void {
        const parent = this.getParentComponent();
        if (!parent) {
            return;
        }

        const lm = parent.getLayoutManager();
        if (!lm) {
            return;
        }

        const existing = lm.getLayoutConstraints(this);

        // An explicit caller fill wins; only an unset one is filled in.
        if (existing && existing.fill != null) {
            return;
        }

        const constraints = existing ?? new LayoutConstraints();
        constraints.fill = this._orientation === "horizontal" ? FillType.HORIZONTAL : FillType.VERTICAL;
        lm.setLayoutConstraints(this, constraints);
    }

    /**
     * Initialises the element. Overridden so the separator installs its
     * cross-axis `fill` constraint on the parent's layout manager the first
     * time it is realised in the DOM — the parent has set `_parent` and
     * rendered the child by this point, so the layout manager is reachable.
     *
     * @param element - Optional. The element being initialised.
     *
     * @returns This component, for method chaining.
     */
    protected init(element?: Handle): this {
        super.init(element);

        this.syncFillConstraint();

        return this;
    }
}

const SeparatorCallable = callable(Separator);
type SeparatorCallable = Separator;
export {
    Separator         as _Separator,
    SeparatorCallable as Separator
};
