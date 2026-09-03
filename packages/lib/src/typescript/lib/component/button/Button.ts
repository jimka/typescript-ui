// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM, type Handle } from "~/core/DOM.js";
import { Event } from "~/core/Event.js";
import { Fit } from "~/layout/Fit.js";
import { HBox } from "~/layout/HBox.js";
import { VBox } from "~/layout/VBox.js";
import { Text, TextOptions } from "~/component/input/Text.js";
import { Tooltip } from "~/overlay/Tooltip.js";
import { Glyph, GlyphOptions } from "~/component/display/Glyph.js";
import { FillType } from "~/layout/FillType.js";
import { AnchorType } from "~/layout/AnchorType.js";
import { resolvePartialDeclarations, type StyleBag, type StyleStateSpec } from "~/core/ClassStyleRules.js";
import { BorderOptions } from "~/primitive/Border.js";
import { Insets } from "~/primitive/Insets.js";
import { Size } from "~/primitive/Size.js";
import { callable } from "~/core/Callable.js";
import { Util } from "~/core/Util.js";

/**
 * String-literal union of the events emitted by {@link Button}. A typed
 * shorthand over [`Event.addListener`](/api/core/classes/Component) /
 * [`Event.removeListener`](/api/core/classes/Component) — Button does not
 * own a [`ListenerBag`](/api/core/classes/ListenerBag); the DOM `"click"`
 * event is dispatched through the framework's window-level capture handler.
 *
 * @category Components
 */
export type ButtonEvent = "action";

/**
 * The handler shape consumers register for the `"click"` button event.
 *
 * @category Components
 */
export type ClickListener = (event: MouseEvent) => Event.ListenerResult;

/**
 * Construction-time options for {@link Button}.
 *
 * @category Components
 */
export interface ButtonOptions extends ComponentOptions {
    text?:                   string;

    /**
     * Optional subtitle rendered on a second line *below* the title, in a
     * smaller, dimmer style. Dispatched late (mirroring `text`) so it lands
     * once the content row's children exist. Drives the hover tooltip
     * alongside `text` — see [`setDescription`](/api/component/button/classes/Button#setdescription).
     */
    description?:            string;

    /**
     * When a leading glyph *and* a description are both present, controls
     * where the description aligns. `true` (default) spans the description
     * full-width *below* the glyph+title row, its left edge under the glyph.
     * `false` indents it under the title text, beside the glyph. No visible
     * effect without both a glyph and a description, or when `showDescription`
     * is `false`. Runtime counterpart: `setDescriptionUnderGlyph`.
     */
    descriptionUnderGlyph?:  boolean;

    /**
     * When `false`, the description is *not* rendered on the button face — the
     * button shows only its glyph and title — but it still appears in the
     * hover tooltip (`{title}\n\n{description}`). Default `true`. The text is
     * always stored; only its on-button render is suppressed. No effect
     * without a description. Runtime counterpart: `setShowDescription`.
     */
    showDescription?:        boolean;

    /**
     * When `false`, the title is *not* rendered on the button face — the
     * button shows only its glyph — but the title still drives the hover
     * tooltip (`{title}\n\n{description}`) and is reflected into `aria-label`
     * as the accessible name. Default `true`. The title is always stored; only
     * its on-button render is suppressed. Pairs with `showDescription` to give
     * a glyph-only button a tooltip + accessible name without an on-face label.
     * Runtime counterpart: `setShowText`.
     */
    showText?:               boolean;
    glyph?:                  string;

    /**
     * Tints the leading glyph independently of the button's `foregroundColor`,
     * which colours the whole face (title *and* glyph). Sets the glyph
     * element's own `color`, picked up by its `currentColor` SVG fill — so a
     * button can render, say, a green glyph beside default-coloured text.
     * Survives a later `setGlyph`. Runtime counterpart: `setGlyphColor`.
     */
    glyphColor?:             string;

    /**
     * Tints the description subtitle independently of the button's
     * `foregroundColor`, overriding the default dim description colour.
     * Runtime counterpart: `setDescriptionColor`.
     */
    descriptionColor?:       string;

    enabled?:                boolean;
    pressedBackgroundColor?: string;
    pressedBackgroundImage?: string;
    pressedForegroundColor?: string;
    pressedBorder?:          BorderOptions | string;
    pressedBorderRadius?:    string;
    pressedShadow?:          string;
    hoverBackgroundColor?:   string;
    hoverBackgroundImage?:   string;
    hoverForegroundColor?:   string;
    hoverBorder?:            BorderOptions | string;
    hoverBorderRadius?:      string;
    hoverShadow?:            string;

    /**
     * Suppresses the framework's visual-chrome defaults — `border`,
     * `borderRadius`, `shadow`, `backgroundImage`, the twelve `pressedX` /
     * `hoverX` fields, and the UA `<button>` background. Use for buttons
     * that want only the cursor, color, and inset behaviour of `Button`
     * without the ridge border, drop shadow, and gradient background.
     * Runtime-toggle counterpart is `setChromeless`; read with
     * `isChromeless`.
     *
     * `applyOptions({ chromeless: true })` on a previously-chromeful button
     * writes the flag pure into `_options` and gates future chrome
     * dispatches, but does not clear the chrome already on the element —
     * callers wanting a runtime flip should call `setChromeless(true)`
     * directly.
     */
    chromeless?:             boolean;

    /**
     * Classical "flat" appearance: no resting border/shadow/gradient; a light
     * frame + fill on `:hover:not(.pressed)` and a sunken inset frame on
     * `.pressed`. Mutually exclusive with `chromeless` (chromeless wins).
     * Runtime counterpart `setFlat`; read with `isFlat`.
     */
    flat?:                   boolean;

    /**
     * Compact rendering: tighter symmetric insets so the button reads denser
     * (e.g. packed into a [`ToolBar`](/api/component/menubar/classes/ToolBar)).
     * Text buttons go `(5,10,5,10)` →
     * `(2,6,2,6)`; glyph-only buttons collapse to a `(2,2,2,2)` square.
     * Defaults to `false`. Runtime counterpart `setCompact`; read with
     * `isCompact`.
     */
    compact?:                boolean;

    /**
     * Anchor for the inner content row (glyph + label) within Button's outer
     * `Fit` layout. Defaults to {@link AnchorType.CENTER}. Pass
     * {@link AnchorType.WEST} for left-anchored menubar-style buttons.
     */
    anchor?:                 AnchorType;

    /**
     * Fill mode for the inner content row within Button's outer `Fit`
     * layout. Defaults to {@link FillType.NONE} (content sits at preferred
     * size, anchor decides displacement). `BOTH` stretches it to fill.
     */
    fill?:                   FillType;

    /**
     * Construction-time listener bag — the declarative form of `on()`. The
     * `action` entry is wired as if `on("action", fn)` had been called (it
     * fires on the underlying DOM `click`).
     */
    listeners?:              { action?: ClickListener };
}

/**
 * Default button inset perimeter — generous `5/10` (vertical/horizontal) so a
 * raised button reads as a comfortable click target. The asymmetric horizontal
 * padding gives the label breathing room either side of its centred glyph.
 */
const BUTTON_DEFAULT_INSETS: Insets = new Insets(5, 10, 5, 10);

/**
 * Compact inset perimeter for a text-bearing button — `2/6`. Tightens the
 * generous default so the button reads denser (e.g. packed into a `ToolBar`)
 * while keeping enough horizontal padding that the label doesn't touch the
 * frame. Driven by {@link Button.setCompact}.
 */
const BUTTON_COMPACT_INSETS_TEXT: Insets = new Insets(2, 6, 2, 6);

/**
 * Compact inset perimeter for a glyph-only button — a tight `2/2` square so a
 * toolbar icon collapses to its glyph with minimal margin. Driven by
 * {@link Button.setCompact}; supersedes the non-compact flat square below.
 */
const BUTTON_COMPACT_INSETS_GLYPH: Insets = new Insets(2, 2, 2, 2);

/**
 * Flat glyph-only square inset — `4/4`. A non-compact flat glyph button (a
 * toolbar icon on a non-compact bar) collapses its asymmetric `5/10` default
 * to this square so it reads as a tight icon without the full compact tightening.
 */
const BUTTON_FLAT_GLYPH_INSETS: Insets = new Insets(4, 4, 4, 4);

/**
 * Resting background colour (mirroring the `--ts-ui-button-bg` image
 * `super.applyChromeOptions` paints). Seeds `_defaultButtonOptions.backgroundColor`
 * below, so `getBackgroundColor()` / `applyStyle` resolve it without an
 * imperative repaint. `BUTTON_RESTING_BACKGROUND` is compared by identity in
 * the chromeless branch of `applyChromeOptions` only, which uses this constant
 * (rather than `_defaultOptions.backgroundColor`) to tell "nobody painted over
 * the UA face" apart from a subclass's own themed fill — see that branch's
 * comment.
 */
const BUTTON_RESTING_BACKGROUND: string = "var(--ts-ui-button-bg, transparent)";

/**
 * User-overridable visual defaults forwarded to `super` via the options bag.
 * The cascade in `Component`'s constructor dispatches each setter once with
 * the final value, so any field the caller supplied wins. Includes the
 * `pressedX` and `hoverX` defaults because their setters route through
 * `writeStateStyle`, which — like `writeStyle` — is safe to fire during the
 * super cascade and queues its write until an element exists.
 */
const _defaultButtonOptions: Partial<ButtonOptions> = {
    tag:                    "button",
    cursor:                 "pointer",
    foregroundColor:        "var(--ts-ui-text-color, black)",
    border:                 "2px ridge var(--ts-ui-button-border, rgb(200, 200, 200))",
    borderRadius:           "var(--ts-ui-border-radius, 4px)",
    shadow:                 "var(--ts-ui-button-shadow, 1px 2px 5px 0 rgba(0, 0, 0, 0.2))",
    backgroundColor:        BUTTON_RESTING_BACKGROUND,
    backgroundImage:        "var(--ts-ui-button-bg, linear-gradient(rgb(241, 241, 241), rgb(200, 200, 200)))",
    insets:                 BUTTON_DEFAULT_INSETS,
    anchor:                 AnchorType.CENTER,
    fill:                   FillType.NONE,
    pressedForegroundColor: "var(--ts-ui-button-pressed-fg, rgb(150, 150, 150))",
    pressedBackgroundColor: "var(--ts-ui-button-pressed-bg, rgb(200, 200, 200))",
    pressedBackgroundImage: "var(--ts-ui-button-pressed-bg, none)",
    pressedShadow:          "var(--ts-ui-button-pressed-shadow, 1px 2px 5px 0 rgba(0, 0, 0, 0.2) inset)",
    hoverBackgroundColor:   "var(--ts-ui-button-hover-bg, rgb(252, 252, 252))",
    hoverBackgroundImage:   "var(--ts-ui-button-hover-bg, none)",
    hoverShadow:            "var(--ts-ui-button-hover-shadow, 1px 3px 6px 0 rgba(0, 0, 0, 0.25))",
};

/**
 * Shared `.flat.pressed` declarations, published once via `ensureSharedStateRule`
 * from `_applyFlatChrome` — see `## Architecture Decisions` in
 * plans/implemented/button-meta-class-dedup.md. Every literal value here is
 * the same token `_applyFlatChrome` used to write per-instance before this
 * plan.
 */
const BUTTON_FLAT_PRESSED_DECLARATIONS: StyleBag = {
    backgroundColor: "var(--ts-ui-button-flat-pressed-bg, rgba(0, 0, 0, 0.10))",
    backgroundImage: "none",
    shadow:          "var(--ts-ui-button-flat-pressed-shadow, inset 1px 1px 3px rgba(0, 0, 0, 0.25))",
    border:          "var(--ts-ui-button-flat-pressed-border, 1px solid rgb(180, 180, 180))",
};

/** Shared `.flat:hover:not(.pressed)` declarations — see {@link BUTTON_FLAT_PRESSED_DECLARATIONS}. */
const BUTTON_FLAT_HOVER_DECLARATIONS: StyleBag = {
    backgroundColor: "var(--ts-ui-button-flat-hover-bg, rgba(0, 0, 0, 0.06))",
    backgroundImage: "none",
    shadow:          "none",
    border:          "var(--ts-ui-button-flat-hover-border, 1px solid rgb(200, 200, 200))",
};

/**
 * Shared `.flat` resting declarations, published once via `ensureSharedStateRule`
 * from `_applyFlatChrome` — the resting-tier twin of
 * `BUTTON_FLAT_PRESSED_DECLARATIONS`/`BUTTON_FLAT_HOVER_DECLARATIONS` above.
 * `borderRadius` is deliberately absent — see
 * plans/button-flat-chrome-dedup.md's Architecture Decisions for why.
 */
const BUTTON_FLAT_RESTING_DECLARATIONS: StyleBag = {
    border:          "1px solid transparent",
    shadow:          "none",
    backgroundImage: "none",
    backgroundColor: "transparent",
};

const BUTTON_LABEL_FONT_SIZE_VAR = "--ts-ui-button-font-size";

// The CSS-ready form of BUTTON_LABEL_FONT_SIZE_VAR — its "14px" fallback is
// Text's own base font-size default (unmodified here), matching exactly
// what Text.setFontSize resolves the constructor's call below to.
const BUTTON_LABEL_FONT_SIZE_RULE = `var(${BUTTON_LABEL_FONT_SIZE_VAR}, 14px)`;

const _defaultButtonLabelTextOptions: Partial<TextOptions> = {
    textAlign:  "center",
    fontWeight: "bold",
};

/**
 * `Button`'s own title label. `textAlign`/`fontWeight` are class defaults,
 * resolved via the folding getter with no imperative dispatch needed.
 * `fontSize` still needs the explicit `setFontSize` call below — see
 * `## Architecture Decisions`. `Button.setTextAlign` can still change
 * `textAlign` at runtime (a genuine per-instance deviation, unaffected by
 * this class default); `fontWeight`/`fontSize` have no such runtime path
 * and stay fixed for the lifetime of the instance.
 */
class ButtonLabelText extends Text {
    protected static readonly ownClassStyleDefaults: StyleBag = {
        font: {
            ...Text.ownClassStyleDefaults.font,
            textAlign:  "center",
            fontWeight: "bold",
            fontSize:   BUTTON_LABEL_FONT_SIZE_RULE,
        },
    };

    constructor() {
        super(undefined, undefined, _defaultButtonLabelTextOptions);
        this.setFontSize(BUTTON_LABEL_FONT_SIZE_VAR);
    }
}

// The square size Button._syncGlyphSize's line-height auto-track resolves to
// under the shipped default theme (root font.size 14px, button.font.size
// -2px -> 12px, font.linePadding 2px -> 14px). A pinned icon, or an instance
// under a theme that resolves a different line height, still writes its own
// real per-instance size — this default is a hint the render-time
// reconciliation checks against, not a hard override.
const BUTTON_ICON_GLYPH_SIZE = { width: 14, height: 14 };

const _defaultButtonIconGlyphOptions: Partial<GlyphOptions> = {
    minSize: BUTTON_ICON_GLYPH_SIZE,
    maxSize: BUTTON_ICON_GLYPH_SIZE,
};

/**
 * The leading glyph inside a {@link Button}'s content row. `minSize`/
 * `maxSize` are a class default matching the size `_syncGlyphSize`'s
 * line-height auto-track resolves to under the shipped theme, so every
 * unpinned Button icon shares one `.ButtonIconGlyph` CSS rule instead of
 * repeating it. A pinned icon (`pinGlyphSize`) still writes its own real
 * size, which reconciles against this default the same way any per-instance
 * deviation does.
 */
class ButtonIconGlyph extends Glyph {
    /**
     * @param name - The glyph to render.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; forwarded so a subclass can seed a default without
     *   editing this constant.
     */
    constructor(name: string, subclassDefaults?: Partial<GlyphOptions>) {
        super(name, undefined, { ..._defaultButtonIconGlyphOptions, ...(subclassDefaults ?? {}) });
    }
}

/**
 * A push button component with a text label and configurable pressed-state appearance.
 *
 * Maintains separate CSS rules for the normal and `.pressed` states, allowing
 * independent control of border, shadow, background, and foreground color when pressed.
 *
 * @example
 * ```typescript
 * import { Event } from '@jimka/typescript-ui/core';
 * import { Button } from '@jimka/typescript-ui/component/button';
 *
 * const button = new Button('Save');
 * Event.addListener(button, 'click', () => save());
 * panel.addComponent(button);
 * ```
 *
 * @category Components
 */
class Button<TOptions extends ButtonOptions = ButtonOptions> extends Component<TOptions> {

    // Opts the resting tier into the hierarchy-aware class cascade — see
    // plans/implemented/class-hierarchy-cascade.md. The same constant this
    // class's own defaults resolve from, exposed at the class level so
    // `ToggleButton`/`SpinButton`/… that add nothing of their own share
    // `.Button`'s rule instead of each repeating it.
    protected static readonly ownClassStyleDefaults: StyleBag = _defaultButtonOptions;

    // Declares the two states `styleLayers()` / `restingGuardSuffix` know
    // about — pressed beats hover (see the plan's `[^toggle-cycle]` note).
    // Both extracts close over `_defaultButtonOptions` directly rather than
    // reading the `defaults` parameter `resolveStyleStates` passes: Button's
    // chrome fields live in that module constant, not in a static
    // `ownClassStyleDefaults`-reachable per-level bag the way a
    // hierarchy-cascade-participating class's own extract would need — see
    // this plan's Implementation Notes for why a chromeless *instance* of a
    // chromeful class, and a chromeless-by-*default* subclass like
    // `MenuBarButton`, both still rely on `suppressIsolation` rather than an
    // empty state layer. `:hover` now mirrors `.pressed`'s shape exactly —
    // `flushStateStyleBag` queues an explicit `null` (a CSSOM removal, not
    // merely a lower-priority value) whenever a per-instance write matches
    // the class-tier bag, so a class-tier hover rule dedupes the same way
    // the pressed one does (see plans/implemented/button-meta-class-dedup.md).
    // This still widens the *resting* guard to `:not(.pressed):not(:hover)`,
    // which is the actual fix `ownStyleStates` contributes for hover.
    protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
        {
            selector: ".pressed",
            extract: (): StyleBag => {
                const d = _defaultButtonOptions;
                if (d.chromeless) {
                    return {};
                }

                const out: StyleBag = {};
                if (d.pressedForegroundColor !== undefined) out.foregroundColor = d.pressedForegroundColor;
                if (d.pressedBackgroundColor !== undefined) out.backgroundColor = d.pressedBackgroundColor;
                if (d.pressedBackgroundImage !== undefined) out.backgroundImage = d.pressedBackgroundImage;
                if (d.pressedShadow          !== undefined) out.shadow          = d.pressedShadow;

                return out;
            },
        },
        {
            selector: ":hover",
            extract: (): StyleBag => {
                const d = _defaultButtonOptions;
                if (d.chromeless) {
                    return {};
                }

                const out: StyleBag = {};
                if (d.hoverForegroundColor !== undefined) out.foregroundColor = d.hoverForegroundColor;
                if (d.hoverBackgroundColor !== undefined) out.backgroundColor = d.hoverBackgroundColor;
                if (d.hoverBackgroundImage !== undefined) out.backgroundImage = d.hoverBackgroundImage;
                if (d.hoverShadow          !== undefined) out.shadow          = d.hoverShadow;

                return out;
            },
        },
    ];

    private _text!:    Text;
    /**
     * The button's content-row container. Holds the optional leading
     * [`Glyph`](/api/component/display/classes/Glyph) plus the `_text` label,
     * laid out by an `HBox`. Exposed as `protected` so subclasses can
     * re-anchor (`removeComponent` + `addComponent`) or rebuild the row
     * without having to opt into `customLayout: true`. Treat as part of the
     * subclass contract — future restructuring of Button's content row
     * needs to keep this field's identity and shape stable.
     */
    protected _content!: Component;

    /**
     * The vertical title/subtitle stack nested inside `_content`'s HBox. Holds
     * `[_text, _description?]` laid out by a `VBox`, so the optional
     * description renders on a line below the title while the leading glyph
     * stays beside the whole stack. Private — unlike `_content` this is an
     * internal detail of how the label row stacks and is not part of the
     * subclass re-anchor contract.
     */
    private _titleColumn!: Component;

    /**
     * The subtitle label, created lazily on the first {@link setDescription}
     * call (mirroring `_glyph`'s lazy creation) so a button with no
     * description never reserves a second line. `null` until then. Stays
     * alive (detached, not nulled) when `showDescription` is `false` so the
     * tooltip can still read its text.
     */
    private _description: Text | null = null;

    /**
     * When `true`, {@link _rebuildTooltip} detaches the hover tooltip instead of
     * attaching it, regardless of the title/description text. Lets a subclass
     * silence the tooltip while the button is showing its own popup — e.g. a
     * [`MenuBarButton`](/api/component/menubar/classes/MenuBarButton) whose
     * dropdown is open, where the tooltip would otherwise float over the menu.
     * Toggled via {@link setTooltipSuppressed}.
     */
    private _tooltipSuppressed: boolean = false;

    /**
     * Lazy containers used only by the "under glyph" (full-width) description
     * topology: `_outerColumn` (VBox) holds `[_innerRow, _description]` and
     * `_innerRow` (HBox) holds `[glyph?, _text]`. Created on first entry into
     * that mode so a button with no description (or in under-title mode) never
     * allocates them — keeping the minimal tree the subclasses depend on.
     * Private; not part of the subclass re-anchor contract.
     */
    private _outerColumn: Component | null = null;
    private _innerRow:    Component | null = null;

    private _glyph: Glyph | null = null;

    /**
     * The square pixel size {@link _syncGlyphSize} last wrote to `_glyph`'s
     * preferred size. Acts as the per-glyph opt-out guard: on a re-sync (e.g.
     * theme toggle) the glyph is only re-matched to the title line height when
     * its current preferred size still equals this value — so a subclass /
     * consumer that pinned its own glyph size (SpinButton, Tab close-glyph)
     * is left untouched. `null` until the framework first sizes the glyph.
     *
     * This size-difference guard is unreliable on its own: a consumer that
     * pins the glyph *before* the first successful sync (while this is still
     * `null` — e.g. before the button is attached and the line height
     * resolves) is not protected, so the first post-attach re-sync clobbers
     * the pin. {@link _glyphSizePinned} is the authoritative opt-out.
     */
    private _glyphSyncedSize: number | null = null;

    /**
     * Set by {@link pinGlyphSize} when a consumer fixes the leading glyph to a
     * specific size. While `true`, {@link _syncGlyphSize} skips the glyph
     * entirely, so a theme change never re-tracks it to the title line height.
     * This is the reliable opt-out (the {@link _glyphSyncedSize} size-diff guard
     * has a null-window hole — see there).
     */
    private _glyphSizePinned: boolean = false;

    /**
     * Flipped to `true` the first time a consumer calls `setPreferredSize`
     * (directly or via the options bag). When set, the native auto-sizing
     * pipeline (see `recomputePreferredSize`) no-ops so the consumer's
     * explicit intent wins permanently. There's no public surface to
     * re-enable auto-sizing — a future plan can add a `clearPreferredSize`
     * method that resets this flag and re-fires the recompute.
     *
     * `declare` rather than `= false` so the class-field super-cascade trap
     * doesn't clobber the value when `Component.applyOptions` dispatches
     * `setPreferredSize` during the super-time cascade (an `= false`
     * initializer runs *after* super returns and would silently revert the
     * setter's `_consumerSetPreferredSize = true` write — letting the
     * end-of-constructor `recomputePreferredSize` overwrite the consumer's
     * preferred size with the content-derived value). The early-return
     * check at the top of `recomputePreferredSize` treats `undefined` as
     * falsy, so the no-cascade-write case still auto-sizes correctly.
     */
    private declare _consumerSetPreferredSize?: boolean;

    /**
     * Bound theme-change handler. The auto-sizing pipeline reads font-size
     * and glyph metrics that can shift with the active theme, so the recompute
     * re-fires whenever the theme cascade flips. `_rebuildContentRow` runs
     * first so the single-line optical inset re-reads the freshly-invalidated
     * `Util.opticalCenterOffset()` — `recomputePreferredSize` alone does not
     * touch the content row. Held on the instance so a future `dispose` path
     * can unregister it.
     */
    private readonly _onThemeChange: () => void = () => {
        this._rebuildContentRow();
        this.recomputePreferredSize();
    };

    // The pressed treatment is driven entirely by this `.pressed` class
    // rather than the native `:active` pseudo-class. Browsers match `:active`
    // on whichever element received a `mousedown` regardless of which mouse
    // button was pressed, and — worse — its clear timing relative to
    // `pointerup`/`pointercancel` isn't something JS can reliably race
    // (an attempt to veto it with a same-tick `:not()` class produced a
    // one-frame flash of the pressed treatment on non-primary release). Fully
    // owning the class instead sidesteps that: it is added/removed only by
    // this component, only for a primary-button press or a held Space key —
    // the same two gestures native `:active` covers for a `<button>` — so a
    // right-/middle-click never shows it at all, with no timing dependency
    // on the browser's own state.
    //
    // Tracking owns two axes: which pointer (if any) is holding the button
    // down, and whether that pointer currently sits over the button —
    // `.pressed` reads true only while both hold, or while Space is held,
    // mirroring what native `:active` shows for a `<button>`. No pointer
    // capture is acquired: capture would retarget `click` to this element
    // regardless of where the pointer actually released, breaking
    // drag-away-to-cancel. Release is instead tracked with a viewport
    // `pointerup` / `pointercancel` pair installed only while a press is in
    // progress (mirrors Scrollbar._onDragStart / _onDragEnd's own
    // press-scoped viewport listeners).
    private _pressedPointerId:     number | null = null;
    private _pressedPointerInside: boolean = false;
    private _spaceHeld:            boolean = false;

    private _updatePressedClass(): void {
        if (!this.getElement()) {
            return;
        }

        const pressed = (this._pressedPointerId !== null && this._pressedPointerInside) || this._spaceHeld;
        this.setStyleState(".pressed", pressed);
    }

    /**
     * True when `related` (an event's `relatedTarget`) is inside this
     * button's own element — an internal move between descendants, not a
     * real boundary crossing. Mirrors `Notification.acquireHoverHold` /
     * `releaseHoverHold`'s inline `relatedTarget`-inside guard.
     */
    private _isInsideTarget(related: unknown): boolean {
        const element = this.getElement();

        return element !== undefined && DOM.source.isNode(related) && DOM.source.contains(element, DOM.source.intern(related));
    }

    private readonly _onPointerDown: (e: PointerEvent) => void = (e) => {
        // Already tracking a press (a second finger, e.g.) — first one wins.
        if (this._pressedPointerId !== null) {
            return;
        }

        this._pressedPointerId     = e.pointerId;
        this._pressedPointerInside = true;

        Event.addViewportListener(this, "pointerup",     this._onPointerRelease);
        Event.addViewportListener(this, "pointercancel", this._onPointerRelease);

        this._updatePressedClass();
    };

    private readonly _onPointerOver: (e: PointerEvent) => void = (e) => {
        if (e.pointerId !== this._pressedPointerId) {
            return;
        }

        // The primary button is no longer held — it was released outside the
        // browser window, so no pointerup ever reached the viewport listener
        // below. Heal here, the next time the pointer crosses back onto the
        // button (mirrors DiagramView._handlePointerMove's buttons-bit
        // recheck, though for a narrower case — Button's own pointerup is
        // viewport-scoped and already catches a release anywhere else in the
        // document; this only covers the pointer leaving the window itself).
        if ((e.buttons & 1) === 0) {
            this._onPointerRelease(e);
            return;
        }

        this._pressedPointerInside = true;
        this._updatePressedClass();
    };

    private readonly _onPointerOut: (e: PointerEvent) => void = (e) => {
        if (e.pointerId !== this._pressedPointerId || this._isInsideTarget(e.relatedTarget)) {
            return;
        }

        this._pressedPointerInside = false;
        this._updatePressedClass();
    };

    /**
     * Suppresses the middle button's autoscroll-icon default. Registered on
     * `mousedown`, not `pointerdown`: preventing a `pointerdown` suppresses
     * its synthesized `mousedown` compatibility event entirely, which
     * `Tooltip.hide()` and `AbstractWindow`'s bring-to-front both depend on
     * to see a press landing on a descendant Button — `mousedown`'s own
     * `preventDefault()` carries no such side effect, so this can suppress
     * the autoscroll default without eating the event for anything else
     * still listening on the same `mousedown`.
     *
     * @param e - The mousedown event.
     */
    private readonly _onAuxMouseDown: (e: MouseEvent) => Event.ListenerResult = (e) => {
        return e.button === 1 ? { prevent: true } : undefined;
    };

    private readonly _onPointerRelease: (e: PointerEvent) => void = (e) => {
        if (this._pressedPointerId !== e.pointerId) {
            return;
        }

        Event.removeViewportListener(this, "pointerup",     this._onPointerRelease);
        Event.removeViewportListener(this, "pointercancel", this._onPointerRelease);

        this._pressedPointerId     = null;
        this._pressedPointerInside = false;

        this._updatePressedClass();
    };

    private readonly _onSpaceDown: (e: KeyboardEvent) => void = (e) => {
        if (e.key !== " " || e.repeat) {
            return;
        }

        this._spaceHeld = true;
        this._updatePressedClass();
    };

    private readonly _onSpaceUp: (e: KeyboardEvent) => void = (e) => {
        if (e.key !== " ") {
            return;
        }

        this._spaceHeld = false;
        this._updatePressedClass();
    };

    /**
     * Clears the Space-held pressed state on blur. Without this, focus
     * leaving mid-hold (Tab, alt-tab, a programmatic focus move) would never
     * fire the matching `keyup` and `.pressed` would stay on indefinitely —
     * `:active`, which this class replaces, clears on blur natively.
     */
    private readonly _onBlur: () => void = () => {
        if (!this._spaceHeld) {
            return;
        }

        this._spaceHeld = false;
        this._updatePressedClass();
    };

    /**
     * Cached `flat` appearance flag. `declare` rather than initialized because
     * `setFlat` can fire during the super-time cascade via `applyChromeOptions`
     * (the flat branch installs hover/pressed treatments through the lazy
     * style-rule getters), and an `= false` initializer would run after super
     * returns and silently clobber the cascaded value.
     */
    private declare _flat?: boolean;

    /**
     * Cached `compact` flag. `declare` rather than initialized because
     * `setCompact` can fire during the super-time cascade via `applyOptions`,
     * and an `= false` initializer would run after super returns and silently
     * clobber the cascaded value (same trap as `_flat` above). The inset
     * resolution it drives is deferred to `_resolveInsets`, which guards on the
     * content row existing.
     */
    private declare _compact?: boolean;

    private _enabledCursor: string = "pointer";

    /**
     * Constructs a Button. `text` (positional or via options) and `glyph` are
     * both optional — an empty Button renders as a chrome-shaped placeholder
     * whose label / glyph can be filled in later via `setText` / `setGlyph`.
     *
     * @example
     * ```typescript
     * new Button('Save');
     * new Button({ glyph: 'times' });
     * new Button('Save', { glyph: 'check-circle' });
     * ```
     */
    constructor(text?: string, options?: ButtonOptions, subclassDefaults?: Partial<ButtonOptions>);
    constructor(options: ButtonOptions);
    constructor(
        textOrOptions?:    string | ButtonOptions,
        options?:          ButtonOptions,
        subclassDefaults?: Partial<ButtonOptions>,
    ) {
        // Normalise the overload: a non-string first argument is the options bag.
        let text: string | undefined;
        if (typeof textOrOptions === "string") {
            text = textOrOptions;
        } else if (textOrOptions !== undefined) {
            options = textOrOptions;
        }

        // Hand defaults to Component via the second super arg so they land in
        // `_defaultOptions` and survive subsequent `applyOptions` re-merges.
        // Subclass defaults (forwarded by callers via the third constructor
        // arg) layer on top so the deepest class's overrides win.
        super(
            options as TOptions,
            { ..._defaultButtonOptions, ...(subclassDefaults ?? {}) } as Partial<TOptions>,
        );

        // Structural state — can't go through the bag because consumers must
        // not be able to override it.
        this.setLayoutManager(new Fit());

        // Build the text/glyph content row. The title (and optional subtitle)
        // live in a vertical `_titleColumn` so the description stacks below the
        // title; the glyph sits beside the whole column in the outer HBox.
        this._text        = new ButtonLabelText();
        this._titleColumn = new Component();
        this._titleColumn.setLayoutManager(new VBox({ spacing: 0 }));
        this._titleColumn.setInsets(new Insets(0, 0, 0, 0));
        this._titleColumn.setPointerEvents("none");
        this._titleColumn.addComponent(this._text);

        this._content = new Component();
        this._content.setLayoutManager(new HBox({ spacing: 2 }));
        this._content.setInsets(new Insets(0, 0, 0, 0));
        this._content.setPointerEvents("none");
        this._content.addComponent(this._titleColumn);

        this._text.setPointerEvents("none");

        this.addComponent(this._content, {
            fill:   this.getFill(),
            anchor: this.getAnchor(),
        });

        // Late-built state: applyOptions wrote any caller `text`/`glyph`/
        // `description` into `_options` pure (no setter dispatch) because
        // `this.text`/`_content` didn't exist yet. Dispatch the effective value
        // now that children are wired up, folding a class default (e.g.
        // TabCloseButton's `glyph: "xmark"`) that raw dispatch left in
        // `_defaultOptions` rather than `_options`.
        const effectiveText = this._options.text ?? this._defaultOptions.text ?? text;
        if (effectiveText !== undefined) {
            this.setText(effectiveText);
        }
        const effectiveGlyph = this._options.glyph ?? this._defaultOptions.glyph;
        if (effectiveGlyph !== undefined) {
            this.setGlyph(effectiveGlyph);
        }
        const effectiveDescription = this._options.description ?? this._defaultOptions.description;
        if (effectiveDescription !== undefined) {
            this.setDescription(effectiveDescription);
        }

        // Construction-time flat / compact: the flat and compact setters ran
        // during the super cascade before `_glyph` / `_text` existed, so
        // `_resolveInsets` no-op'd. Re-evaluate now the content row is built so
        // the icon-square / compact insets land.
        if (this._flat || this._compact) {
            this._resolveInsets();
        }

        // Initial auto-sized preferred-size pass. No-ops when the consumer
        // already supplied `preferredSize` (the override of `setPreferredSize`
        // below flips `_consumerSetPreferredSize`).
        this.recomputePreferredSize();

        // Re-fire the auto-sized recompute on theme changes so any
        // font-size / glyph-metric shifts cascade into the button's preferred
        // size without explicit consumer prodding.
        this.subscribeTheme(this._onThemeChange);

        // Subtree, not exact-target: a press on a pointer-opaque descendant
        // (e.g. SplitButton's chevron, or a TabCloseButton overlaid on a
        // TabButton) must still show this button pressed, the way `:active`
        // bubbles through one. This is safe now that no pointer capture is
        // acquired — each Button instance tracks its own boundary state
        // independently, with no shared OS-level resource for two instances
        // to conflict over.
        Event.addSubtreeListener(this, "pointerdown", this._onPointerDown);
        Event.addSubtreeListener(this, "pointerover", this._onPointerOver);
        Event.addSubtreeListener(this, "pointerout",  this._onPointerOut);
        Event.addListener(this, "mousedown",   { button: "aux", handler: this._onAuxMouseDown });
        Event.addListener(this, "keydown",       this._onSpaceDown);
        Event.addListener(this, "keyup",         this._onSpaceUp);
        // Native `:active` clears on blur; `_onSpaceUp` alone does not — a
        // Tab or alt-tab away while Space is held would otherwise leave
        // `.pressed` stuck on indefinitely.
        Event.addListener(this, "blur",          this._onBlur);

        // Wire the listener bag — but only when this IS a plain Button.
        // Subclasses wire their own bag from their constructor body after their
        // `super()` returns, because a subclass event (e.g. SpinButton's
        // `tick`) may live in a `ListenerBag` that does not exist yet during
        // this base constructor. The check is instance-identity, not
        // `new.target`: construction routes through the `callable()` Proxy,
        // which has no `construct` trap, so `new.target` is the proxy rather
        // than this class — but the instance's prototype still resolves to the
        // raw class prototype, so a plain Button matches and any subclass does not.
        if (Object.getPrototypeOf(this) === Button.prototype) {
            this.applyListeners(options?.listeners);
        }
    }

    /**
     * `_titleColumn`, `_innerRow`, `_outerColumn`, and `_description` are only
     * *sometimes* registered children of `_content` — {@link _rebuildContentRow}
     * empties and selectively re-populates `_content`'s tree on every rebuild,
     * so whichever of these currently sits outside that tree (e.g.
     * `_titleColumn` for any button that never shows a description, which is
     * the common case) is unreachable by the base class's recursive `destructor()`
     * teardown. Dispose each explicitly; `dispose()` is idempotent, so this is a
     * harmless no-op for whichever one happens to be currently attached (and
     * therefore already reached by the recursion below via `super.destructor()`).
     */
    protected destructor(): void {
        this._titleColumn.dispose();
        this._innerRow?.dispose();
        this._outerColumn?.dispose();
        this._description?.dispose();

        super.destructor();
    }

    /**
     * Returns the content anchor used inside the button's `Fit` layout — the
     * caller value, else the class default ({@link AnchorType.CENTER}).
     *
     * @returns The resolved anchor.
     */
    getAnchor(): AnchorType {
        return (this._options.anchor ?? this._defaultOptions.anchor) as AnchorType;
    }

    /**
     * Returns the content fill used inside the button's `Fit` layout — the
     * caller value, else the class default ({@link FillType.NONE}).
     *
     * @returns The resolved fill.
     */
    getFill(): FillType {
        return (this._options.fill ?? this._defaultOptions.fill) as FillType;
    }

    /**
     * Applies a {@link ButtonOptions} bag. Inherited Component fields cascade
     * through `super.applyOptions`; pressed-state, hover-state, and `enabled`
     * fields cascade through their own setters (the lazy `pressedStyleRule`
     * and `hoverStyleRule` getters make them safe to fire during the
     * super-time cascade). `text`, `description`, and `glyph` are written pure
     * into `_options` during the super-time cascade (before the content row
     * exists) and dispatched from the constructor body once children exist —
     * but a *post-construction* call (a subclass's tail `applyOptions`, or a
     * runtime re-apply) dispatches the setters directly, so an option supplied
     * after the constructor's late dispatch still renders. The
     * `descriptionUnderGlyph` / `showDescription` flags are always pure-written
     * and consumed live by the content-row rebuild those dispatches trigger.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: TOptions): this {
        // Button structurally owns a per-instance Fit layout, installed
        // imperatively in the constructor because a fresh manager can't live in
        // the shared `_defaultOptions` bag. `super.applyOptions` re-dispatches
        // `_defaultOptions.layoutManager` (always an `Absolute`) on every call,
        // so a subclass that hands its consumer options to a tail `applyOptions`
        // (ToggleButton / TabButton: `if (options) this.applyOptions(options)`)
        // would clobber that Fit — and an Absolute layout never positions the
        // content row, collapsing the label into a corner. Capture the manager
        // and restore it when the cascade re-defaulted it away and the consumer
        // did not explicitly request a different one (ButtonOptions omits
        // `layoutManager`, so that override path is intentionally unreachable).
        const structuralLayout = this.getLayoutManager();

        super.applyOptions(options);

        if (options.layoutManager === undefined && this.getLayoutManager() !== structuralLayout) {
            this.setLayoutManager(structuralLayout);
        }

        // Content-row flags first (pure writes): a dispatched
        // setText/setGlyph/setDescription below reads them (via `_isShowText()`
        // and the content-row rebuild). They ride the options bag, not a class
        // field, so the super-cascade class-field trap does not apply.
        if (options.descriptionUnderGlyph !== undefined) this._options.descriptionUnderGlyph = options.descriptionUnderGlyph;
        if (options.showDescription       !== undefined) this._options.showDescription       = options.showDescription;
        if (options.showText              !== undefined) this._options.showText              = options.showText;

        // text / glyph / description. Before the content row exists — the
        // super-time cascade, where `_text` is unassigned — write pure and let
        // the constructor body dispatch the setters once children are wired.
        // After construction the row is built, so dispatch the setters to
        // rebuild the content: a subclass that forwards only `text` to super and
        // hands its bag to a tail `applyOptions` (ToggleButton / TabButton) has
        // already missed the constructor dispatch, so a pure write would record
        // the glyph/description but never render it. Instance-identity guard
        // (`_text`), so raw dispatch loses no `_defaultOptions` default (folded
        // by the constructor's own late dispatch for the cascade path).
        const contentBuilt = this._text !== undefined;

        // `showText` alone has no setter of its own to dispatch below — it
        // only takes effect through `setText`'s `_isShowText()` read. A call
        // that changes `showText` without also supplying `text` in the same
        // options bag falls through every branch below with `_text` never
        // re-synced: the concrete case is a subclass whose positional-text
        // constructor forwards only `text` to super (`ToggleButton` /
        // `TabButton`), so a tail `applyOptions({ showText: false, glyph })`
        // carries no `text` key to trigger the resync the comment above
        // describes for glyph/description. Re-dispatch through `setShowText`,
        // which blanks/restores `_text` from the already-current
        // `_options.text` and rebuilds the row itself, so the flag change
        // alone still lands correctly.
        if (contentBuilt && options.showText !== undefined && options.text === undefined) {
            this.setShowText(options.showText);
        }

        // Glyph / description tints are stored before the glyph / description
        // dispatch below, so a `setGlyph` / `setDescription` fired here (or by the
        // constructor's late dispatch) re-reads and re-applies them to the fresh
        // element. A post-construction call with only the colour (the element
        // already built) tints it directly via the setter.
        if (options.glyphColor !== undefined) {
            if (contentBuilt) this.setGlyphColor(options.glyphColor); else this._options.glyphColor = options.glyphColor;
        }

        if (options.descriptionColor !== undefined) {
            if (contentBuilt) this.setDescriptionColor(options.descriptionColor); else this._options.descriptionColor = options.descriptionColor;
        }

        if (options.text !== undefined) {
            if (contentBuilt) this.setText(options.text); else this._options.text = options.text;
        }

        if (options.description !== undefined) {
            if (contentBuilt) this.setDescription(options.description); else this._options.description = options.description;
        }

        if (options.glyph !== undefined) {
            if (contentBuilt) this.setGlyph(options.glyph); else this._options.glyph = options.glyph;
        }

        if (options.enabled      !== undefined) this.setEnabled(options.enabled);

        // chromeless / anchor / fill are pure writes — no setter dispatch.
        // Runtime flag flips for chromeless go through setChromeless(), which
        // also reconciles the DOM via clearChrome / restoreChrome. anchor and
        // fill are consumed by the constructor body when adding `_content` to
        // the outer Fit layout; later applyOptions calls don't reanchor.
        if (options.chromeless   !== undefined) this._options.chromeless   = options.chromeless;
        if (options.flat         !== undefined) this._options.flat          = options.flat;
        // Dispatched (not pure-written like `flat`) because it must resolve the
        // inset perimeter; `_resolveInsets` guards on the content row so the
        // cascade-time call before `_text` exists is a safe no-op.
        if (options.compact      !== undefined) this.setCompact(options.compact);
        if (options.anchor       !== undefined) this._options.anchor       = options.anchor;
        if (options.fill         !== undefined) this._options.fill         = options.fill;

        return this;
    }

    /**
     * Gates Component's chrome dispatch on the `chromeless` flag and, when
     * the flag is off, extends it with Button's twelve `pressedX` / `hoverX`
     * chrome fields. Reads the flag from the runtime cache first so a flag
     * previously written (by an earlier `applyOptions` or `setChromeless`)
     * keeps gating future re-applies that omit `chromeless`.
     *
     * @param options - The raw caller options bag passed by {@link applyOptions}.
     */
    protected override applyChromeOptions(options: TOptions): void {
        const chromeless = (options.chromeless ?? this.isChromeless()) === true;
        if (chromeless) {
            // A chromeless button is not isolated: its resting chrome stays
            // on the bare `#id` rule, at (1,0,0), which is what makes it
            // outrank the shared `.ClassName.pressed` rule — `chromeless`'s
            // documented contract. Clear whatever the earlier `setBackgroundColor`
            // / `setBackground` dispatch (Component's `applyOptions`, before
            // `applyChromeOptions` runs) may already have queued onto the
            // isolated rule while isolation was still the default — read the
            // backing slot directly (not the lazy getter) so a button that
            // never allocated the rule does not allocate one here.
            this.suppressIsolation(true);

            if (this._restingStyleRule !== undefined) {
                this._restingStyleRule.setMany({ background: null, backgroundColor: null, backgroundImage: null, boxShadow: null });
            }

            // The chrome group's class defaults are dispatched only by
            // `super.applyChromeOptions` (skipped here for chromeless), so a
            // fresh chromeless button never receives them.
            //
            // `borderRadius` isn't hoisted onto `.Button`'s class rule, so the
            // explicit `undefined` write still works the old way on a
            // re-apply (e.g. `setChromeless` after a chromeful pass): it
            // clears a previously-written value so `getBorderRadius` reports
            // `null` and `applyStyle` skips the property. `shadow` and
            // `backgroundImage` are hoisted now, so the same option-only
            // clear would no longer suppress them — a skipped `#id` write
            // just hands the property to `.Button`'s own class-tier
            // declaration instead of painting nothing. `setShadow("none")`
            // / `setBackgroundImage("none")` assert the real neutral value
            // instead, the same way `clearBorder()` does for the border below.
            //
            // Border goes through the private `_border` field, so `clearBorder`
            // clears it to a `none` border that overrides the UA `<button>` ridge.
            //
            // Finally, the UA `<button>` element has a non-transparent
            // background-color; set transparent unless the caller specified
            // their own backgroundColor. Once Button seeds `backgroundColor`
            // in `_defaultButtonOptions`, a plain Button's resting colour can
            // never be `null` any more, so the framework token joins `null` as
            // the second "nobody pinned one" answer; a subclass fill
            // (`MenuBarButton`, `TabButton`) matches neither and survives.
            this.clearBorder();
            this.cacheStyleValue("borderRadius", null);
            this.setShadow("none");
            this.setBackgroundImage("none");

            const resting = this.getBackgroundColor();

            if (resting === null || resting === BUTTON_RESTING_BACKGROUND) {
                this.cacheStyleValue("backgroundColor", "transparent");
            }

            // A chromeless button never reaches the pressed/hover dispatch
            // below, so it never writes anything to its own `#id.pressed`
            // rule — but `.Button.pressed`'s shared class rule (materialised
            // by any *other*, chromeful Button in the same process) still
            // matches this element's `Button`/`pressed` CSS classes
            // regardless. With no instance-level declaration to outrank it,
            // that shared rule's four pressed declarations would silently
            // leak onto a chromeless button on press, contradicting
            // `chromeless`'s own contract ("suppresses… the twelve
            // pressedX/hoverX fields"). Pin every declaration the shared bag
            // carries to this instance's current resting values explicitly —
            // each reliably differs from the class bag's token (a different
            // `var()` expression), so each writes for real and reliably
            // outranks the shared rule via `#id.pressed`'s higher specificity.
            this.pinPressedToResting();

            return;
        }

        super.applyChromeOptions(options);

        // Chromeful resting background: `super` applies the `--ts-ui-button-bg`
        // token as a background *image* (for gradient tokens) via the chrome
        // group's dispatch; the same token is also applied as a background
        // *colour* so a flat-colour token (e.g. the Modern theme) renders too —
        // whichever channel is valid paints, the other is dropped. Without the
        // colour channel a flat-colour token was invalid as an image and the
        // button fell back to the UA `<button>` background. The colour channel
        // is now a class default (`_defaultButtonOptions.backgroundColor`)
        // resolved by `getBackgroundColor()` / `applyStyle` rather than an
        // imperative repaint here, so a caller-supplied `backgroundColor` (or a
        // subclass default) wins without this method needing to check for it.

        // The pressed/hover colour + shadow + image fields carry class defaults,
        // so dispatch the caller value or the class default. The pressed/hover
        // border fields are not defaulted, so they stay caller-gated.
        this.setPressedForegroundColor(options.pressedForegroundColor ?? this.getPressedForegroundColor()!);
        this.setPressedBackgroundColor(options.pressedBackgroundColor ?? this.getPressedBackgroundColor()!);
        this.setPressedBackgroundImage(options.pressedBackgroundImage ?? this.getPressedBackgroundImage()!);
        this.setPressedShadow         (options.pressedShadow ?? this.getPressedShadow()!);
        if (options.pressedBorder       !== undefined) this.setPressedBorder      (options.pressedBorder);
        if (options.pressedBorderRadius !== undefined) this.setPressedBorderRadius(options.pressedBorderRadius);

        if (options.hoverForegroundColor !== undefined) this.setHoverForegroundColor(options.hoverForegroundColor);
        this.setHoverBackgroundColor(options.hoverBackgroundColor ?? this.getHoverBackgroundColor()!);
        this.setHoverBackgroundImage(options.hoverBackgroundImage ?? this.getHoverBackgroundImage()!);
        this.setHoverShadow         (options.hoverShadow ?? this.getHoverShadow()!);
        if (options.hoverBorder         !== undefined) this.setHoverBorder      (options.hoverBorder);
        if (options.hoverBorderRadius   !== undefined) this.setHoverBorderRadius(options.hoverBorderRadius);

        // Flat is the third appearance mode: it runs in the chromeful `else`
        // path (chromeless already returned above) and re-points the resting
        // chrome + the raised `pressedX`/`hoverX` treatments just dispatched to
        // the flat tokens. Reading the runtime cache first keeps a previously
        // written flag gating future re-applies that omit `flat`.
        if ((this._options.flat ?? options.flat) === true) {
            this._flat = true;
            this._applyFlatChrome();
        }
    }

    /**
     * Sets the button's title text. The single entry point for mutating the
     * title — there is no public accessor for the inner label, so every title
     * change routes through here, keeping the auto-sized preferred size and
     * the hover tooltip (composed from title + description) in sync.
     *
     * @param text - The new title string.
     *
     * @returns This component, for method chaining.
     */
    setText(text: string): this {
        this._options.text = text;

        // `_text` is the on-face renderer. The title string lives in
        // `_options.text`; `_text` shows it only when `showText` is true, and
        // renders blank when hidden so the button stays metrically a glyph-only
        // button while the tooltip and accessible name still carry the title.
        this._text.setText(this._isShowText() ? text : "");
        this.recomputePreferredSize();
        this._rebuildTooltip();
        this._reflectAccessibleName();

        return this;
    }

    /**
     * Returns the button's current title text, or `""` when no label is set.
     * A read-only companion to {@link setText} — the inner label has no other
     * public accessor; the [`ToolBar`](/api/component/menubar/classes/ToolBar)
     * overflow menu reads it to label each dropdown row.
     *
     * @returns The current title string, or `""` if none is set.
     */
    getText(): string {
        return this._options.text ?? "";
    }

    /**
     * Applies a writing mode to the button and propagates it to the inner label
     * (and description) so their measured preferred size reflects the rotated
     * text run — a label-only `getWritingMode` would otherwise stay horizontal
     * even while inheriting the vertical mode through CSS, and report the wrong
     * extents. Re-syncs the auto-sized preferred size after the labels swap.
     *
     * @param value - A CSS `writing-mode` value (e.g. `vertical-rl`).
     *
     * @returns This component, for method chaining.
     */
    setWritingMode(value: string): this {
        const previousOrientation = this._contentOrientation();

        super.setWritingMode(value);

        // `writingMode` is a Component option, so this can fire from
        // `applyOptions` during `super()` — before the constructor assigns
        // `_text`. Forward (and resize) only once the labels exist; the Tab sets
        // the mode post-construction, so its labels are always present.
        if (this._text) {
            this._text.setWritingMode(value);
            this._description?.setWritingMode(value);

            // Re-lay the content row when the reading direction flips, but only
            // when a glyph or description is present — a lone label is a single
            // child whose container axis is irrelevant, so plain-text tabs keep
            // their exact prior layout.
            if (this._contentOrientation() !== previousOrientation && (this._glyph || this._description)) {
                this._rebuildContentRow();
            }

            this.recomputePreferredSize();
        }

        return this;
    }

    /**
     * Justifies the button's title (and leading glyph) within a button wider
     * than its content. Forwards the value to the inner
     * [`Text`](/api/component/input/classes/Text)'s CSS `text-align` and
     * re-anchors the whole content row in the Fit layout — `"left"` / `"right"`
     * track the start / end of the label's reading direction, so they map to the
     * vertical edges on a rotated (west/east) label. `"center"` is the default.
     *
     * @param align - A CSS `text-align` value (`"left"`, `"center"`, `"right"`).
     *
     * @returns This component, for method chaining.
     */
    setTextAlign(align: string): this {
        // `setTextAlign` can be driven post-construction (the Tab strip sets it
        // each layout pass), but a future option-bag dispatch could fire from
        // `applyOptions` during `super()` — before the constructor assigns
        // `_text`. Guard like `setWritingMode` does.
        if (this._text) {
            this._text.setTextAlign(align);

            // CSS text-align only nudges glyphs inside the label's own
            // content-hugging box; to justify the whole glyph+label block
            // within a button wider than its content, re-anchor the content row
            // in the Fit layout along the (possibly rotated) reading axis.
            const constraints = this.getLayoutConstraints(this._content);

            if (constraints) {
                constraints.anchor = this._anchorForTextAlign(align);
                this.scheduleLayout();
            }
        }

        return this;
    }

    /**
     * Maps a `text-align` value to the {@link AnchorType} that positions the
     * content row at the matching edge of a button wider than its content.
     * Accepts both physical (`"left"` / `"right"`) and flow-relative (`"start"`
     * / `"end"`) values; either way they track the start / end of the label's
     * reading direction, so on a rotated label they map to the vertical edges
     * (`NORTH` / `SOUTH`) — reversed between clockwise and counter-clockwise.
     *
     * @param align - A `text-align` value (`"left"`/`"start"`, `"center"`, `"right"`/`"end"`).
     *
     * @returns The anchor that justifies the content row accordingly.
     */
    private _anchorForTextAlign(align: string): AnchorType {
        const leading  = align === "left"  || align === "start";
        const trailing = align === "right" || align === "end";
        const orient   = this._contentOrientation();

        if (orient === "cw") {
            // Reads top→bottom: leading is the top edge, trailing the bottom.
            return leading ? AnchorType.NORTH : trailing ? AnchorType.SOUTH : AnchorType.CENTER;
        }

        if (orient === "ccw") {
            // Reads bottom→top: leading is the bottom edge, trailing the top.
            return leading ? AnchorType.SOUTH : trailing ? AnchorType.NORTH : AnchorType.CENTER;
        }

        return leading ? AnchorType.WEST : trailing ? AnchorType.EAST : AnchorType.CENTER;
    }

    /**
     * Clears the writing mode from the button and its inner label (and
     * description), restoring horizontal text measurement.
     *
     * @returns This component, for method chaining.
     */
    clearWritingMode(): this {
        const previousOrientation = this._contentOrientation();

        super.clearWritingMode();

        if (this._text) {
            this._text.clearWritingMode();
            this._description?.clearWritingMode();

            // Restoring horizontal flow flips the reading direction back; re-lay
            // the content row for glyph/description buttons (see setWritingMode).
            if (this._contentOrientation() !== previousOrientation && (this._glyph || this._description)) {
                this._rebuildContentRow();
            }

            this.recomputePreferredSize();
        }

        return this;
    }

    /**
     * Sets the button's subtitle, shown on a line below the title in a
     * smaller, dimmer style. The subtitle label is created lazily on the
     * first call (mirroring {@link setGlyph}) so a button with no description
     * never reserves a second line. Re-syncs the auto-sized preferred size
     * and the hover tooltip.
     *
     * @param text - The subtitle string.
     *
     * @returns This component, for method chaining.
     */
    setDescription(text: string): this {
        if (!this._description) {
            this._description = new Text();
            this._description.setPointerEvents("none");
            this._description.setTextAlign("center");
            this._description.setFontSize("--ts-ui-button-description-font-size");
            this._description.setFontWeight("var(--ts-ui-button-description-weight, normal)");
            this._description.setForegroundColor(
                this._options.descriptionColor ?? "var(--ts-ui-button-description-fg, rgb(110, 110, 110))"
            );
        }

        // The instance is created above unconditionally so `_rebuildTooltip`
        // can always read it; `_rebuildContentRow` decides whether it is
        // actually parented onto the button face (gated by `showDescription`)
        // and in which topology (gated by `descriptionUnderGlyph`).
        this._description.setText(text);
        this._rebuildContentRow();
        this._rebuildTooltip();
        this.recomputePreferredSize();

        return this;
    }

    /**
     * Returns the subtitle Text child, or `null` when no description has been
     * set (mirroring {@link getGlyph}). Read-only access — the only way to
     * change the subtitle string is {@link setDescription}, so the tooltip
     * stays authoritative.
     *
     * @returns The description [`Text`](/api/component/input/classes/Text) instance, or null.
     */
    getDescription(): Text | null {
        return this._description;
    }

    /**
     * Removes the subtitle line, if one is present, and re-syncs the
     * auto-sized preferred size and the hover tooltip.
     *
     * @returns This component, for method chaining.
     */
    clearDescription(): this {
        this._description = null;

        this._rebuildContentRow();
        this._rebuildTooltip();
        this.recomputePreferredSize();

        return this;
    }

    /**
     * Recomposes the hover tooltip from the current title and description and
     * (re)attaches it. The tooltip body is `{title}\n\n{description}` when a
     * description exists, the title alone when it doesn't, and the description
     * alone when there is no title. Detaches entirely when both are empty.
     * Routed through [`Tooltip`](/api/overlay/classes/Tooltip), which renders the
     * `\n` breaks across multiple lines.
     */
    private _rebuildTooltip(): void {
        // A suppressed tooltip stays detached whatever the text — the button is
        // showing its own popup and a hover hint would occlude it.
        if (this._tooltipSuppressed) {
            Tooltip.detach(this);

            return;
        }

        const title = this._options.text ?? "";
        const desc  = this._description?.getText().valueOf() ?? "";

        let str: string;
        if (title && desc) {
            str = `${title}\n\n${desc}`;
        } else {
            str = title || desc;
        }

        if (str) {
            Tooltip.attach(this, str);
        } else {
            Tooltip.detach(this);
        }
    }

    /**
     * Suppresses or restores this button's hover tooltip. While suppressed the
     * tooltip is detached (and any visible/pending one dismissed) and stays off
     * across `setText`/`setDescription` rebuilds; restoring re-composes it from
     * the current title and description. Intended for a subclass that opens its
     * own popup — see {@link _tooltipSuppressed}.
     *
     * @param value - `true` to detach the tooltip, `false` to restore it.
     *
     * @returns This button, for method chaining.
     */
    protected setTooltipSuppressed(value: boolean): this {
        if (value === this._tooltipSuppressed) {
            return this;
        }

        this._tooltipSuppressed = value;

        this._rebuildTooltip();

        return this;
    }

    /**
     * Reflects the title into the accessible name exactly when it is hidden from
     * the button face (`showText:false`). A glyph-only face renders the title
     * blank, so without this the button would have no accessible name; the
     * stored title (`_options.text`) is mirrored into `aria-label`. When the
     * title is visible the rendered text already supplies the accessible name,
     * so any previously reflected label is cleared (e.g. after `setShowText(true)`).
     */
    private _reflectAccessibleName(): void {
        const title = this._options.text ?? "";

        if (!this._isShowText() && title !== "") {
            this.getAria().setLabel(title);
        } else {
            this.getAria().clearLabel();
        }
    }

    /**
     * Resolves the `descriptionUnderGlyph` flag with its `true` default — the
     * single place the default lives, read by {@link _rebuildContentRow}.
     *
     * @returns Whether the description aligns full-width under the glyph.
     */
    private _isDescriptionUnderGlyph(): boolean {
        return this._options.descriptionUnderGlyph ?? true;
    }

    /**
     * Resolves the `showDescription` flag with its `true` default.
     *
     * @returns Whether the description is rendered on the button face.
     */
    private _isShowDescription(): boolean {
        return this._options.showDescription ?? true;
    }

    /**
     * Resolves the `showText` flag with its `true` default.
     *
     * @returns Whether the title is rendered on the button face.
     */
    private _isShowText(): boolean {
        return this._options.showText ?? true;
    }

    /**
     * Classifies the active writing mode into the orientation the content row
     * must follow. The Tab strip rotates west/east labels with `sideways-rl`
     * (clockwise, reads top→bottom) and `sideways-lr` (counter-clockwise, reads
     * bottom→top); every other value — including none — lays out horizontally.
     *
     * @returns `"cw"`, `"ccw"`, or `"horizontal"`.
     */
    private _contentOrientation(): "horizontal" | "cw" | "ccw" {
        const wm = this.getWritingMode();

        if (wm === "sideways-rl") {
            return "cw";
        }

        if (wm === "sideways-lr") {
            return "ccw";
        }

        return "horizontal";
    }

    /**
     * Swaps `container`'s box layout to the given axis and spacing so a content
     * row follows the label's reading direction (`"h"` → `HBox`, `"v"` → `VBox`).
     *
     * @param container - The content container to re-lay out.
     * @param axis - `"h"` for a horizontal row, `"v"` for a vertical stack.
     * @param spacing - Inter-child spacing in px.
     */
    private _orientBox(container: Component, axis: "h" | "v", spacing: number): void {
        container.setLayoutManager(axis === "v" ? new VBox({ spacing }) : new HBox({ spacing }));
    }

    /**
     * Adds `children` to `container` in reading order, reversing when the axis
     * runs against the document order (a counter-clockwise inline run or a
     * clockwise block run), so the leading glyph / title stays first in the
     * rotated flow.
     *
     * @param container - The container to populate.
     * @param children - The children in their logical (unrotated) order.
     * @param reversed - Whether to add them in reverse.
     */
    private _addContentChildren(container: Component, children: Component[], reversed: boolean): void {
        const ordered = reversed ? [...children].reverse() : children;

        for (const child of ordered) {
            container.addComponent(child);
        }
    }

    /**
     * Rebuilds `_content`'s child tree from the current `_glyph` / `_text` /
     * `_description` instances and the `descriptionUnderGlyph` /
     * `showDescription` flags. The single point that (re)parents those shared
     * children, so the topology stays consistent across every glyph /
     * description / flag mutation. Never recreates `_content` itself, so its
     * identity and HBox layout — the documented subclass re-anchor seam — are
     * preserved.
     *
     * Idempotent: it empties every content container up front
     * ({@link Component.removeAllComponents} fully detaches each child), then
     * re-adds from the current field state, so it is safe to call any number
     * of times and after a field has been nulled.
     *
     * Two topologies:
     * - **under glyph** (`descriptionUnderGlyph` true, glyph + visible
     *   description): `_content[ _outerColumn( _innerRow[glyph, _text], _description ) ]`
     *   — the description spans full width below the glyph+title row.
     * - **under title** (the default fallback, also used whenever there is no
     *   glyph, no description, or `showDescription` is false):
     *   `_content[ glyph?, _titleColumn[ _text, _description? ] ]`.
     *
     * When `showDescription` is false the description is treated as absent for
     * layout — the minimal `[glyph?, _titleColumn[_text]]` tree is built and
     * `_description` is left detached but alive (so {@link _rebuildTooltip}
     * can still read it).
     */
    private _rebuildContentRow(): void {
        // Disassemble: empty every container so all shared children are
        // parentless and re-addable (add/insertComponent throw on a child that
        // still has a parent). Emptying wholesale also drops any outgoing glyph
        // / description whose field was reassigned or nulled by the caller.
        this._content.removeAllComponents();
        this._titleColumn.removeAllComponents();
        this._innerRow?.removeAllComponents();
        this._outerColumn?.removeAllComponents();

        // A hidden description is treated as absent for rendering; the instance
        // stays alive for the tooltip.
        const renderDesc = this._description !== null && this._isShowDescription();

        // A hidden title (`showText:false`) is rendered blank rather than
        // unparented: `_text` keeps its place in the no-description topology so
        // its line box still drives the button height (exactly like a genuinely
        // empty label), and the title string lives in `_options.text` to feed
        // the tooltip and the reflected `aria-label`. In the description
        // topologies the description drives the height, so a hidden title is
        // dropped outright to avoid reserving a blank title line.
        const renderText = this._isShowText();

        // The label's writing mode rotates both the inline (glyph→text) and the
        // block (title→description) reading directions; the content boxes have
        // to follow it, or a leading glyph lands beside vertical text instead of
        // before it. The inline run becomes a VBox and the block stack an HBox.
        // `sideways-rl` (cw) reads top→bottom with blocks running right→left;
        // `sideways-lr` (ccw) reads bottom→top with blocks running left→right —
        // hence the opposite reversals on the two axes.
        const orient   = this._contentOrientation();
        const vertical = orient !== "horizontal";

        const inlineAxis: "h" | "v" = vertical ? "v" : "h";
        const blockAxis:  "h" | "v" = vertical ? "h" : "v";
        const inlineReversed = orient === "ccw";
        const blockReversed  = orient === "cw";

        if (renderDesc && this._glyph && this._isDescriptionUnderGlyph()) {
            if (!this._innerRow) {
                this._innerRow = new Component();
                this._innerRow.setInsets(new Insets(0, 0, 0, 0));
                this._innerRow.setPointerEvents("none");
            }
            if (!this._outerColumn) {
                this._outerColumn = new Component();
                this._outerColumn.setInsets(new Insets(0, 0, 0, 0));
                this._outerColumn.setPointerEvents("none");
            }

            this._orientBox(this._content,     inlineAxis, 2);
            this._orientBox(this._innerRow,    inlineAxis, 2);
            this._orientBox(this._outerColumn, blockAxis,  0);

            this._addContentChildren(this._innerRow,    renderText ? [this._glyph, this._text] : [this._glyph], inlineReversed);
            this._addContentChildren(this._outerColumn, [this._innerRow, this._description!], blockReversed);
            this._content.addComponent(this._outerColumn);
        } else if (renderDesc) {
            // Title + description stack in the column so the description trails
            // the title; the glyph (if any) leads the whole stack on the inline
            // axis.
            this._orientBox(this._content,     inlineAxis, 2);
            this._orientBox(this._titleColumn, blockAxis,  0);

            this._addContentChildren(this._titleColumn, renderText ? [this._text, this._description!] : [this._description!], blockReversed);

            const inlineChildren = this._glyph ? [this._glyph, this._titleColumn] : [this._titleColumn];
            this._addContentChildren(this._content, inlineChildren, inlineReversed);
        } else {
            // No description: place the title directly beside (or before) the
            // glyph rather than wrapping it in `_titleColumn`. The column reports
            // a null baseline (a plain VBox-backed Component), which would hide
            // the title's baseline from `_content` and leave the glyph centred;
            // added directly, the title's baseline is visible so the glyph drops
            // onto the text baseline — matching the description topology.
            // A glyph-only button (empty label) drops the inline spacing to 0 so
            // the glyph sits flush at the box centre: the default spacing between
            // the glyph and a zero-width label pads one side and pushes the glyph
            // off centre (the visible "hugs the left edge" on icon buttons). The
            // empty `_text` stays in the row so its line box still drives the
            // button height — dropping it shrinks the button vertically. A hidden
            // title renders blank (`_text.getText() === ""`), so it takes this
            // same glyph-only path: still parented to drive the height, spacing
            // collapsed, no title shown.
            const hasText = this._text.getText().valueOf() !== "";
            this._orientBox(this._content, inlineAxis, this._glyph && !hasText ? 0 : 2);

            const inlineChildren = this._glyph ? [this._glyph, this._text] : [this._text];
            this._addContentChildren(this._content, inlineChildren, inlineReversed);
        }

        // Optically centre a single line of label text. The Fit/anchor centring
        // centres the line box geometrically, but a label's ink occupies only
        // cap-top→baseline, so the empty descender band makes the text read as
        // too high. A top inset of `Util.opticalCenterOffset()` nudges it down
        // onto its optical centre. Applies only to a non-empty single-line
        // horizontal label: a two-line title+description block centres as a
        // block (offset 0), a glyph-only button (empty `_text`) is already
        // box-centred, and a rotated label has no horizontal descender band.
        const opticalOffset = (!vertical && !renderDesc && this._text.getText().valueOf() !== "") ? Util.opticalCenterOffset() : 0;

        this._content.setInsets(new Insets(opticalOffset, 0, 0, 0));

        this._reflectAccessibleName();

        this._afterRebuildContentRow();
    }

    /**
     * Hook invoked at the end of {@link _rebuildContentRow}, after the glyph /
     * title / description children have been re-parented onto the content row.
     * The base implementation does nothing; subclasses that attach their own
     * persistent child to `_content` (e.g. [`SplitButton`](/api/component/button/classes/SplitButton)'s
     * trailing chevron) override it to re-append that child, since the rebuild
     * empties the row wholesale via `removeAllComponents` and would otherwise
     * orphan it on a `setGlyph` / `setDescription` / writing-mode change.
     */
    protected _afterRebuildContentRow(): void {
    }

    /**
     * Sizes the leading glyph's box so its height matches the title's rendered
     * line-box height (the line of text it sits beside), instead of the
     * un-synced 16×16 `Glyph` default — `ButtonIconGlyph`'s own 14×14 is a
     * class-rule default the rendered value reconciles against, not this
     * instance's own pre-sync size (`Glyph.applyOptions` re-pins an unset
     * `minSize`/`maxSize` to `Glyph`'s base `preferredSize`, not to a
     * `subclassDefaults` bag). The lever is `setPreferredSize`, not
     * `setFontSize` — a font-size token does not resize an SVG glyph's box.
     *
     * Theme-reactive: it reads `_text.getLineHeight()` (the button title's
     * additive line box, button font-size + `--ts-ui-line-padding`) and runs
     * from {@link recomputePreferredSize},
     * which already re-fires on every theme change — so the glyph re-tracks the
     * title line height without an extra listener. Bails when the line height
     * isn't resolved yet (pre-measure) so it never writes a 0/NaN size.
     *
     * Opt-out guard: it only overwrites a glyph size it itself last wrote
     * (tracked in `_glyphSyncedSize`). A subclass / consumer that pinned its
     * own glyph size (SpinButton's chevron, Tab's close ✕) leaves the current
     * size different from `_glyphSyncedSize`, so this method skips it and the
     * explicit size survives later re-syncs.
     */
    private _syncGlyphSize(): void {
        const glyph = this._glyph;
        if (!glyph) {
            return;
        }

        // A consumer-pinned glyph keeps its fixed size across theme changes.
        if (this._glyphSizePinned) {
            return;
        }

        const lineHeight = this._text.getLineHeight();
        if (lineHeight === null) {
            return;
        }

        const px = Math.round(lineHeight);

        const current = glyph.getPreferredSize();
        const ours    = this._glyphSyncedSize;
        if (current && ours !== null && (current.width !== ours || current.height !== ours)) {
            return;
        }

        glyph.setPreferredSize({ width: px, height: px });
        this._glyphSyncedSize = px;
    }

    /**
     * Sets or clears an optional leading [`Glyph`](/api/component/display/classes/Glyph) shown alongside the button's text.
     *
     * @param name - Registry glyph name to display, or `null` to clear an existing glyph.
     *
     * @returns This component, for method chaining.
     *
     * @remarks
     * The glyph leads the content row. Its box is auto-sized to match the
     * title's line height; a consumer can override by sizing the returned glyph
     * explicitly via `getGlyph().setPreferredSize(...)`. Empty text combined
     * with `setGlyph(name)` therefore renders as a glyph-only button with no
     * visual artifacts at the default 0px spacing. The glyph is a dedicated
     * `ButtonIconGlyph` (not a bare `Glyph`), so every unpinned icon's
     * `minSize`/`maxSize` shares one `.ButtonIconGlyph` CSS rule instead of
     * each carrying its own. The replaced glyph is destroyed, so a caller
     * holding a reference from an earlier {@link getGlyph} must not reuse it
     * across a `setGlyph` call.
     */
    setGlyph(name: string): this {
        const outgoing = this._glyph;
        const glyph    = new ButtonIconGlyph(name);
        glyph.setPointerEvents("none");

        // Reassign before the rebuild; the rebuild empties the content
        // containers, detaching any previous glyph so it is dropped cleanly.
        this._glyph           = glyph;
        // A fresh glyph hasn't been line-height-synced yet — clear the guard
        // so `_syncGlyphSize` (via recomputePreferredSize) sizes it.
        this._glyphSyncedSize = null;

        // Re-apply an instance glyph tint so it survives a glyph swap.
        if (this._options.glyphColor !== undefined) {
            glyph.setForegroundColor(this._options.glyphColor);
        }

        this._rebuildContentRow();

        // The rebuild only detaches the replaced glyph (removeAllComponents is
        // detach-only), so discard it here or every swap strands its element
        // and its per-instance stylesheet rule.
        outgoing?.dispose();

        // The content row's preferred size shifted — re-sync the button's
        // auto-derived preferred size (also sizes the glyph) unless the
        // consumer has pinned it.
        this.recomputePreferredSize();

        return this;
    }

    /**
     * Removes the leading glyph from the button, if one is present. The
     * removed glyph is destroyed, so a caller holding a reference from an
     * earlier {@link getGlyph} must not reuse it across a `clearGlyph` call.
     *
     * @returns This component, for method chaining.
     */
    clearGlyph(): this {
        const outgoing = this._glyph;

        this._glyph           = null;
        this._glyphSyncedSize = null;

        this._rebuildContentRow();

        // See setGlyph: the rebuild only detaches, so dispose explicitly.
        outgoing?.dispose();

        this.recomputePreferredSize();

        return this;
    }

    /**
     * Returns the current leading glyph component, or null if none is set.
     *
     * @returns The [`Glyph`](/api/component/display/classes/Glyph) instance, or null.
     */
    getGlyph(): Glyph | null {
        return this._glyph;
    }

    /**
     * Tints the leading glyph independently of the button's `foregroundColor`.
     * `foregroundColor` sets `color` on the whole button, which both the title
     * and the glyph (via its `currentColor` SVG fill) inherit; this sets `color`
     * on the glyph element alone, so the glyph can be tinted while the title
     * keeps the button's own colour. Stored so a later {@link setGlyph} re-applies
     * it. A no-op on the element until a glyph exists; the colour still takes
     * effect once one is set.
     *
     * @param color - A CSS color string.
     *
     * @returns This component, for method chaining.
     */
    setGlyphColor(color: string): this {
        this._options.glyphColor = color;
        this._glyph?.setForegroundColor(color);

        return this;
    }

    /**
     * Tints the description subtitle independently of the button's
     * `foregroundColor`, overriding the default dim description colour. Stored so
     * a lazily-created description ({@link setDescription}) picks it up. A no-op on
     * the element until a description exists.
     *
     * @param color - A CSS color string.
     *
     * @returns This component, for method chaining.
     */
    setDescriptionColor(color: string): this {
        this._options.descriptionColor = color;
        this._description?.setForegroundColor(color);

        return this;
    }

    /**
     * Pins the leading glyph to a fixed square size and opts it out of the
     * theme-reactive line-height sync. Use for compact icon buttons whose glyph
     * must stay a constant size regardless of the active theme's font metrics —
     * a tab's close ✕, a spinner chevron. A plain
     * `getGlyph().setPreferredSize(...)` is unreliable here: if it runs before
     * the button is attached (line height unresolved), the first theme change
     * re-tracks the glyph to the title line height and grows it. This sets the
     * authoritative `_glyphSizePinned` opt-out so the sync skips the glyph.
     *
     * @param px - The square glyph size in pixels.
     *
     * @returns This button, for chaining.
     */
    pinGlyphSize(px: number): this {
        this._glyphSizePinned = true;

        this._glyph?.setPreferredSize({ width: px, height: px });

        return this;
    }

    /**
     * Returns the offset from the top of the button to the label's text baseline.
     *
     * @returns The baseline offset in pixels, or `null` when the label has no baseline.
     */
    getBaseline(): number | null {
        return this.wrapInnerBaseline(this._text.getBaseline());
    }

    /**
     * Registers a listener for this button's `"action"` event — fired on
     * click. A typed semantic shorthand over {@link Event.addListener}
     * (the underlying DOM event is `"click"`); `"action"` is currently the
     * only allowed event name.
     *
     * @param event - The event name. Only `"action"` is accepted.
     * @param listener - The callback to invoke when the button is actioned.
     *
     * @returns This button, for method chaining.
     */
    on(event: "action", listener: ClickListener): this;
    on(_event: "action", listener: ClickListener): this {
        Event.addListener(this, "click", listener);

        return this;
    }

    /**
     * Removes a previously registered `"action"` listener. A typed shorthand
     * over {@link Event.removeListener}; the exact callback reference must
     * match the one passed to {@link on}.
     *
     * @param event - The event the listener was registered for.
     * @param listener - The callback to remove.
     *
     * @returns This button, for method chaining.
     */
    off(event: "action", listener: ClickListener): this;
    off(_event: "action", listener: ClickListener): this {
        Event.removeListener(this, "click", listener);

        return this;
    }

    /**
     * Programmatically actions the button, as if the user had clicked it:
     * fires this button's own `"click"` event so every registered
     * {@link on | `"action"`} handler runs. Provided so other components can
     * drive a button through its named surface rather than synthesising its
     * DOM event from the outside — e.g. [`ToolBar`](/api/component/menubar/classes/ToolBar)
     * replays an overflowed button's action from its dropdown. A
     * [`ToggleButton`](/api/component/button/classes/ToggleButton)
     * inherits this and toggles, because its internal toggle is wired to the
     * same `"click"`.
     *
     * @returns This button, for method chaining.
     */
    click(): this {
        Event.fireEvent(this, "click");

        return this;
    }

    /**
     * Registers a `pointerdown` event listener on this button. The named
     * surface lets external consumers (e.g.
     * [`AbstractPickerField`](/api/component/input/classes/AbstractPickerField))
     * route through the component rather than reaching for
     * `Event.addListener(button, "pointerdown", ...)` directly, preserving
     * the framework's named-listener contract.
     *
     * @param listener - Called with the originating PointerEvent. Fires for
     * every button — this public surface has no documented button
     * restriction, so it opts out of `Event.addListener`'s primary-only
     * default to preserve that.
     *
     * @returns This component, for method chaining.
     */
    addPointerDownListener(listener: Event.Listener): this {
        Event.addListener(this, "pointerdown", { button: "any", handler: listener });

        return this;
    }

    /**
     * Returns whether this button is currently in `chromeless` mode (no
     * border / shadow / gradient / pressed-hover treatments).
     *
     * @returns True when chrome dispatches are gated off.
     */
    isChromeless(): boolean {
        return this._options.chromeless ?? this._defaultOptions.chromeless ?? false;
    }

    /**
     * Toggles the `chromeless` flag and reconciles the DOM. When flipping
     * to `true`, clears every chrome property currently on the element
     * before recording the flag. When flipping to `false`, restores the
     * chromeful defaults from `_defaultOptions` (which retains both
     * Button's base defaults and any subclass chrome layered in at
     * construction, so the round-trip is loss-free for both sources).
     *
     * @param value - The new chromeless state.
     *
     * @returns This component, for method chaining.
     *
     * @remarks Consumer-supplied chrome that came in via the caller's
     * `options` bag (rather than the subclass's `_defaultOptions`) is not
     * recovered by `setChromeless(false)` — only the defaults round-trip.
     */
    setChromeless(value: boolean): this {
        if (this.isChromeless() === value) {
            return this;
        }

        if (value) {
            // Clear the DOM before flipping the flag. The clear* setters
            // are not gated today, but the ordering keeps the intent
            // self-evident if a future change does gate them.
            this._clearChrome();
            this._options.chromeless = true;

            // Chromeless wins over flat: `_clearChrome` already stripped the
            // flat hover/pressed treatments, so drop the flat flag too to keep
            // `isFlat()` honest.
            this._flat = false;
            this._options.flat = false;
        } else {
            // Flip the flag first so the clear/set side-effects on the
            // restore path are not intercepted by anything that might
            // later gate them.
            this._options.chromeless = false;
            this._restoreChrome();
        }

        return this;
    }

    /**
     * Clears every chrome property the framework defaults touch. Pressed
     * and hover rules are only touched when their lazy backing slots have
     * already been allocated — calling the `clearX` setters when nothing
     * was ever installed would touch the lazy getters and acquire empty
     * orphan rules.
     */
    private _clearChrome(): void {
        this.setStyleState(".flat", false);

        this.clearBorder();
        this.clearBorderRadius();
        this.clearShadow();
        this.clearBackgroundImage();

        if (this.instanceStateLayer(".pressed") !== null) {
            this.clearPressedBackgroundColor();
            this.clearPressedBackgroundImage();
            // Pin, don't clear: `clearPressedForegroundColor()` writes `null`
            // (a CSSOM `removeProperty`), which can never win the cascade
            // against `.Button.pressed`'s shared, non-null `color` token —
            // see `applyChromeOptions`'s chromeless branch and this plan's
            // Implementation Notes for the full explanation. This instance
            // is going chromeless via `setChromeless(true)` here (the other
            // runtime path into the same leak, alongside construction-time
            // `{ chromeless: true }`), so it needs the same explicit pin.
            this.setPressedForegroundColor(this.getForegroundColor() ?? "inherit");
            this.clearPressedShadow();
            this.clearPressedBorderRadius();
            this.clearPressedBorder();
        }

        if (this.instanceStateLayer(":hover") !== null) {
            this.clearHoverBackgroundColor();
            this.clearHoverBackgroundImage();
            this.clearHoverForegroundColor();
            this.clearHoverShadow();
            this.clearHoverBorderRadius();
            this.clearHoverBorder();
        }
    }

    /**
     * Re-applies chrome from `_defaultOptions`, which carries both Button's
     * base defaults and any subclass chrome layered in at construction via
     * the third constructor arg. Consumer-supplied chrome (from the
     * caller's options bag, not `_defaultOptions`) is not recovered here.
     */
    private _restoreChrome(): void {
        const d = this._defaultOptions as ButtonOptions;

        this.setStyleState(".flat", false);

        // Re-apply the chromeful resting background `_applyFlatChrome` cleared.
        // This is `_applyFlatChrome`'s inverse: flat (or chromeless) wrote the
        // "transparent" sentinel only when the painted colour was the class
        // default, so restoring that default here is exactly right. The
        // `d.backgroundColor !== undefined` arm covers a subclass that
        // suppresses Button's default with an explicit `backgroundColor:
        // undefined` key — nothing to restore, so the sentinel stays.
        if (this.getBackgroundColor() === "transparent" && d.backgroundColor !== undefined) {
            this.setBackgroundColor(d.backgroundColor);
        }

        if (d.border                 !== undefined) this.setBorder(d.border);
        if (d.borderRadius           !== undefined) this.setBorderRadius(d.borderRadius);
        if (d.shadow                 !== undefined) this.setShadow(d.shadow);
        if (d.backgroundImage        !== undefined) this.setBackgroundImage(d.backgroundImage);

        if (d.pressedForegroundColor !== undefined) this.setPressedForegroundColor(d.pressedForegroundColor);
        if (d.pressedBackgroundColor !== undefined) this.setPressedBackgroundColor(d.pressedBackgroundColor);
        if (d.pressedBackgroundImage !== undefined) this.setPressedBackgroundImage(d.pressedBackgroundImage);
        if (d.pressedShadow          !== undefined) this.setPressedShadow         (d.pressedShadow);
        if (d.pressedBorder          !== undefined) this.setPressedBorder         (d.pressedBorder);
        else                                        this.clearPressedBorder      ();
        if (d.pressedBorderRadius    !== undefined) this.setPressedBorderRadius   (d.pressedBorderRadius);

        if (d.hoverForegroundColor   !== undefined) this.setHoverForegroundColor  (d.hoverForegroundColor);
        if (d.hoverBackgroundColor   !== undefined) this.setHoverBackgroundColor  (d.hoverBackgroundColor);
        if (d.hoverBackgroundImage   !== undefined) this.setHoverBackgroundImage  (d.hoverBackgroundImage);
        if (d.hoverShadow            !== undefined) this.setHoverShadow           (d.hoverShadow);
        if (d.hoverBorder            !== undefined) this.setHoverBorder           (d.hoverBorder);
        else                                        this.clearHoverBorder         ();
        if (d.hoverBorderRadius      !== undefined) this.setHoverBorderRadius     (d.hoverBorderRadius);
    }

    /**
     * Writes every declaration the shared `.ClassName.pressed` rule carries onto
     * this instance's own `#id.pressed` rule, at this instance's resting value.
     * A chromeless button never dispatches pressed chrome, so without this the
     * shared rule — materialised by any chromeful sibling of the same class —
     * would show through on press. Goes through `pinStateStyle`, not
     * `writeStateStyle`, because the point is to outrank the class rule even
     * when the two values coincide.
     */
    private pinPressedToResting(): void {
        const bag = this.classStateLayer(".pressed")?.resolved;

        if (!bag) {
            return;
        }

        const patch: StyleBag = {};

        if ("color"           in bag) patch.foregroundColor = this.getForegroundColor() ?? "inherit";
        if ("backgroundColor" in bag) patch.backgroundColor = this.getBackgroundColor() ?? "transparent";
        if ("backgroundImage" in bag) patch.backgroundImage = this.getBackgroundImage() ?? "none";
        if ("boxShadow"       in bag) patch.shadow          = this.getShadow()          ?? "none";

        this.pinStateStyle(".pressed", patch);
    }

    /**
     * Returns whether this button is currently in `flat` mode (no resting
     * border / shadow / gradient; a light frame on hover and a sunken inset
     * frame on press).
     *
     * @returns True when the flat appearance is applied.
     */
    isFlat(): boolean {
        return this._flat ?? false;
    }

    /**
     * Toggles the classical `flat` appearance and reconciles the DOM. When
     * flipping to `true`, suppresses the resting frame and installs the flat
     * hover / pressed treatments from the `--ts-ui-button-flat-*` tokens; when
     * flipping to `false`, restores the raised chrome from `_defaultOptions`
     * via the same round-trip `setChromeless(false)` uses. Mutually exclusive
     * with `chromeless` (chromeless wins): `setFlat(true)` no-ops with a
     * dev-time warning when the button is chromeless.
     *
     * @param value - The new flat state.
     *
     * @returns This component, for method chaining.
     *
     * @remarks Consumer-supplied chrome that came in via the caller's
     * `options` bag (rather than the subclass's `_defaultOptions`) is not
     * recovered by `setFlat(false)` — only the defaults round-trip, matching
     * the documented `setChromeless(false)` tradeoff.
     */
    setFlat(value: boolean): this {
        if (value && this.isChromeless()) {
            console.warn("Button #" + this.getId() + ": setFlat(true) ignored — flat and chromeless are mutually exclusive, chromeless wins.");

            return this;
        }

        if ((this._flat ?? false) === value) {
            return this;
        }

        if (value) {
            this._flat = true;
            this._options.flat = true;
            this._applyFlatChrome();
        } else {
            this._flat = false;
            this._options.flat = false;
            this._restoreChrome();
            // `_restoreChrome` recovers borders/shadows but not insets, so a
            // flat glyph-only button un-flattened here would keep its tight
            // square. Re-resolve so it falls back to the default (or compact)
            // perimeter for its new state.
            this._resolveInsets();
        }

        return this;
    }

    /**
     * Returns whether this button is currently in `compact` mode (tighter
     * symmetric insets).
     *
     * @returns True when compact rendering is applied.
     */
    isCompact(): boolean {
        return this._compact ?? false;
    }

    /**
     * Toggles compact rendering. When `true`, the button's inset perimeter
     * tightens — text buttons to `(2,6,2,6)`, glyph-only buttons to a
     * `(2,2,2,2)` square — so the button reads denser (e.g. packed into a
     * [`ToolBar`](/api/component/menubar/classes/ToolBar)); `false` restores the
     * default `(5,10,5,10)` (or the flat glyph square, if flat). Orthogonal to
     * `flat`: a button can be compact, flat, both, or neither, and compact
     * insets win over the flat square when both apply.
     *
     * @param value - The new compact state.
     *
     * @returns This component, for method chaining.
     */
    setCompact(value: boolean): this {
        if ((this._compact ?? false) === value) {
            return this;
        }

        this._compact = value;
        this._options.compact = value;
        this._resolveInsets();

        return this;
    }

    /**
     * Publishes flat's resting chrome (border / shadow / background) and its
     * hover / sunken-pressed treatments as shared `.flat` / `.flat.pressed` /
     * `.flat:hover:not(.pressed)` class rules instead of writing any of them
     * through per-instance setters — flat's resting chrome never varies per
     * instance, so it is the resting-tier twin of the already-shared
     * pressed/hover rules below. See `## Architecture Decisions` in
     * plans/button-flat-chrome-dedup.md. Glyph-only buttons (a glyph with an
     * empty label) tighten to a compact square inset so they read as toolbar
     * icon buttons.
     */
    private _applyFlatChrome(): void {
        // The border is painted entirely by the shared `.flat` rule below, but
        // `getBorderSize()`'s layout math reads the component's own cached
        // border spec, which a shared class rule can't update — sync it
        // without writing CSS (a real `setBorder` write here would defeat the
        // hoisting by duplicating the value onto every instance's own rule).
        this.cacheBorderSpec(BUTTON_FLAT_RESTING_DECLARATIONS.border!);

        // `.flat` adds one more chained class than `.Button` alone, so
        // `.Button.flat` (and `.Button.flat.pressed` / `.Button.flat:hover:not(.pressed)`
        // below) sit at strictly higher specificity than `.Button` / `.Button.pressed`
        // regardless of insertion order.
        this.setStyleState(".flat", true);
        this.ensureSharedStateRule(".flat",                     resolvePartialDeclarations(BUTTON_FLAT_RESTING_DECLARATIONS));
        this.ensureSharedStateRule(".flat.pressed",             resolvePartialDeclarations(BUTTON_FLAT_PRESSED_DECLARATIONS));
        this.ensureSharedStateRule(".flat:hover:not(.pressed)", resolvePartialDeclarations(BUTTON_FLAT_HOVER_DECLARATIONS));

        // Re-resolve the inset perimeter for the new flat state. Runs through
        // the shared resolver so the construction-time flat path — where
        // `_glyph` / `_text` don't yet exist during the super cascade — can
        // re-apply it from the constructor body once the content row is built.
        this._resolveInsets();
    }

    /**
     * Resolves and applies the button's inset perimeter from the three live
     * inputs — `_compact`, `_flat`, and whether the button is glyph-only (a
     * glyph with an empty label). Compact wins over the flat square so a compact
     * flat icon tightens to `(2,2,2,2)` rather than the non-compact flat
     * `(4,4,4,4)`. The resolver computes an absolute target each call (never a
     * delta), so the construction-time double-invocation (the cascade's
     * `_applyFlatChrome` before the content row exists, then the constructor's
     * re-evaluation) and later `setCompact` / `setFlat` flips all converge on
     * the same answer without drift.
     *
     * No-ops until the content row is built — `_text` is assigned in the
     * constructor body, after the super cascade that first fires the flat /
     * compact setters; the constructor re-invokes this once the row exists.
     */
    private _resolveInsets(): void {
        if (this._text === undefined) {
            return;
        }

        const glyphOnly = this._glyph !== null && this._text.getText().valueOf() === "";

        let insets: Insets;

        if (this._compact && glyphOnly) {
            insets = BUTTON_COMPACT_INSETS_GLYPH;
        } else if (this._compact) {
            insets = BUTTON_COMPACT_INSETS_TEXT;
        } else if (this._flat && glyphOnly) {
            insets = BUTTON_FLAT_GLYPH_INSETS;
        } else {
            insets = BUTTON_DEFAULT_INSETS;
        }

        this.setInsets(insets);
    }

    /**
     * Updates the button's insets. Overrides Component's setter so the
     * auto-sized preferred size re-syncs to the new inset perimeter
     * without explicit consumer prodding (subclasses like `MenuBarButton`
     * change insets in their constructor body).
     *
     * @param insets - The new perimeter insets.
     * @returns This component, for method chaining.
     */
    setInsets(insets: Insets): this {
        super.setInsets(insets);
        this.recomputePreferredSize();

        return this;
    }

    /**
     * Records a consumer-supplied preferred size. Flips
     * `_consumerSetPreferredSize` so future auto-fires from
     * `recomputePreferredSize` no-op — the consumer's explicit intent
     * wins permanently for the lifetime of this instance.
     *
     * @param size - The preferred size in pixels.
     * @returns This component, for method chaining.
     */
    setPreferredSize(size: Size): this {
        this._consumerSetPreferredSize = true;
        super.setPreferredSize(size);

        return this;
    }

    /**
     * Returns the preferred size, derived live from the content row +
     * perimeter while the consumer hasn't pinned one. Deriving live (rather
     * than reading a cached value) means
     * the button always tracks its current label / glyph: a {@link setText}
     * that grows or shrinks the label is reflected the next time the parent
     * layout queries this button, with no manual recompute call needed at the
     * mutation site.
     *
     * When the consumer has supplied an explicit `preferredSize`, that pinned
     * value (recorded by {@link setPreferredSize}) wins via `super`.
     *
     * @returns The preferred `{width, height}`.
     */
    getPreferredSize(): Size | null {
        // A consumer-pinned size or a class-level `preferredSize` default both
        // pin the button rather than deriving from content. The default now
        // lives in `_defaultOptions` (it is no longer dispatched through
        // `setPreferredSize`, so it never flips `_consumerSetPreferredSize`);
        // honour it here so subclasses like TabCloseButton keep their fixed size.
        if (this._consumerSetPreferredSize || this._defaultOptions.preferredSize) {
            return super.getPreferredSize();
        }

        return this.computePreferredSize();
    }

    /**
     * Notifies the parent layout that this button's content-derived size may
     * have changed, so it re-queries {@link getPreferredSize} (which derives
     * live). Pushes the freshly computed size through Component's setter both
     * to fire the parent-relayout notification and to dedupe (the setter
     * no-ops when the size is unchanged). Auto-fires from the end of the
     * constructor, `setGlyph`, `clearGlyph`, `setInsets`, and the registered
     * `ThemeManager.onThemeChange` handler — the content mutations that do
     * not bubble a preferred-size change on their own (a label `setText`
     * already bubbles via its own measurement).
     *
     * No-ops when the consumer has supplied an explicit `preferredSize`
     * (Button's `setPreferredSize` override records that intent).
     *
     * Subclasses customise the size by overriding {@link computePreferredSize}
     * rather than touching this method — the consumer-flag and auto-fire
     * wiring stays here.
     */
    protected recomputePreferredSize(): void {
        // Size the glyph to the title line box first, above the consumer-pinned
        // early-return, so the glyph still line-height-matches even when the
        // button's own size is frozen. Subclasses that pin their glyph size opt
        // out via _syncGlyphSize's per-glyph guard, not this early-return.
        this._syncGlyphSize();

        if (this._consumerSetPreferredSize || this._defaultOptions.preferredSize) {
            return;
        }

        const size = this.computePreferredSize();

        // Bypass our own override of setPreferredSize so the consumer flag
        // doesn't flip on an auto-fire. `super` is `Component`. The written
        // value isn't read back for sizing (getPreferredSize derives live);
        // the call stands in for the parent-relayout notification + dedupe.
        super.setPreferredSize({ width: size.width, height: size.height });
    }

    /**
     * Computes the auto-sized preferred size from the content row's
     * preferred size plus this button's perimeter (insets + border).
     * Mirrors `Fit.getPreferredSize`'s use of `getPerimeterSize` so the
     * border width isn't truncated off the text. Subclasses override to
     * alter — the typical case is replacing the derived height with a
     * fixed token (see `MenuBarButton`).
     *
     * @returns The `{ width, height }` Button reports as its preferred size
     *   while the consumer hasn't pinned one.
     */
    protected computePreferredSize(): { width: number; height: number } {
        const content = this._content?.getPreferredSize() ?? { width: 0, height: 0 };
        const perim   = this.getPerimeterSize();

        return {
            width:  content.width  + perim.left + perim.right,
            height: content.height + perim.top  + perim.bottom,
        };
    }

    /**
     * Returns the background color applied when the button is in the `.pressed` state.
     *
     * @returns The CSS color string, or null if not set.
     */
    getPressedBackgroundColor(): string | null {
        return this.resolveStateStyleValue(".pressed", "backgroundColor")
            ?? this._defaultOptions.pressedBackgroundColor ?? null;
    }

    /**
     * Sets the background color for the `.pressed` CSS rule.
     *
     * @param backgroundColor - A CSS color string, or null to clear the property.
     *
     * @returns This component, for method chaining.
     */
    setPressedBackgroundColor(backgroundColor: string): this {
        this.writeStateStyle(".pressed", { backgroundColor });

        return this;
    }

    /**
     * Pins the `.pressed` background-color to this button's current resting
     * background-color (or `"transparent"`), instead of removing the property.
     *
     * @returns This component, for method chaining.
     */
    clearPressedBackgroundColor(): this {
        this.writeStateStyle(".pressed", { backgroundColor: this.getBackgroundColor() ?? "transparent" });

        return this;
    }

    /**
     * Returns the background image applied when the button is in the `.pressed` state.
     *
     * @returns The CSS background-image string, or null if not set.
     */
    getPressedBackgroundImage(): string | null {
        return this.resolveStateStyleValue(".pressed", "backgroundImage")
            ?? this._defaultOptions.pressedBackgroundImage ?? null;
    }

    /**
     * Sets the background image for the `.pressed` CSS rule.
     *
     * @param backgroundImage - Optional. A CSS background-image string, or null to clear the property.
     *
     * @returns This component, for method chaining.
     */
    setPressedBackgroundImage(backgroundImage: string): this {
        this.writeStateStyle(".pressed", { backgroundImage });

        return this;
    }

    /**
     * Pins the `.pressed` background-image to this button's current resting
     * background-image (or `"none"`), instead of removing the property.
     *
     * @returns This component, for method chaining.
     */
    clearPressedBackgroundImage(): this {
        this.writeStateStyle(".pressed", { backgroundImage: this.getBackgroundImage() ?? "none" });

        return this;
    }

    /**
     * Returns the text color applied when the button is in the `.pressed` state.
     *
     * @returns The CSS color string, or null if not set.
     */
    getPressedForegroundColor(): string | null {
        return this.resolveStateStyleValue(".pressed", "foregroundColor")
            ?? this._defaultOptions.pressedForegroundColor ?? null;
    }

    /**
     * Sets the text color for the `.pressed` CSS rule.
     *
     * @param foregroundColor - A CSS color string, or null to clear the property.
     *
     * @returns This component, for method chaining.
     */
    setPressedForegroundColor(foregroundColor: string): this {
        this.writeStateStyle(".pressed", { foregroundColor });

        return this;
    }

    /**
     * Removes the color (foreground) from the `.pressed` CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearPressedForegroundColor(): this {
        this.writeStateStyle(".pressed", { foregroundColor: null });

        return this;
    }

    /**
     * Returns the border applied when the button is in the `.pressed` state.
     *
     * @returns The {@link BorderOptions} for the `.pressed` state, or null if not set.
     */
    getPressedBorder(): BorderOptions | null {
        return this.resolveStateStyleValue(".pressed", "border") as BorderOptions | null;
    }

    /**
     * Sets the border for the `.pressed` CSS rule. Accepts either a {@link BorderOptions}
     * bag or a CSS `border` shorthand string (sugar for `{ border: <string> }`).
     *
     * @param options - Border configuration, a CSS `border` shorthand string, or omitted for a `none` border.
     *
     * @returns This component, for method chaining.
     */
    setPressedBorder(options?: BorderOptions | string): this {
        this.writeStateStyle(".pressed", { border: typeof options === "string" ? { border: options } : (options ?? {}) });

        return this;
    }

    /**
     * Removes the border from the `.pressed` CSS rule, reverting the pressed
     * state to no explicit border. Lets the un-flatten / un-chromeless round
     * trip strip a flat pressed border that has no raised default to restore.
     *
     * @returns This component, for method chaining.
     */
    clearPressedBorder(): this {
        this.writeStateStyle(".pressed", { border: null });

        return this;
    }

    /**
     * Returns the border radius applied when the button is in the `.pressed` state.
     *
     * @returns The CSS border-radius string, or null if not set.
     */
    getPressedBorderRadius(): string | null {
        return this.resolveStateStyleValue(".pressed", "borderRadius")
            ?? this._defaultOptions.pressedBorderRadius ?? null;
    }

    /**
     * Sets the border radius for the `.pressed` CSS rule.
     *
     * @param borderRadius - Optional. A CSS border-radius string, or null to clear the property.
     *
     * @returns This component, for method chaining.
     */
    setPressedBorderRadius(borderRadius: string): this {
        this.writeStateStyle(".pressed", { borderRadius });

        return this;
    }

    /**
     * Removes the border-radius from the `.pressed` CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearPressedBorderRadius(): this {
        this.writeStateStyle(".pressed", { borderRadius: null });

        return this;
    }

    /**
     * Returns the box shadow applied when the button is in the `.pressed` state.
     *
     * @returns The CSS box-shadow string, or null if not set.
     */
    getPressedShadow(): string | null {
        return this.resolveStateStyleValue(".pressed", "shadow")
            ?? this._defaultOptions.pressedShadow ?? null;
    }

    /**
     * Sets the box shadow for the `.pressed` CSS rule.
     *
     * @param shadow - A CSS box-shadow string, or null to set the shadow to "none".
     *
     * @returns This component, for method chaining.
     */
    setPressedShadow(shadow: string): this {
        this.writeStateStyle(".pressed", { shadow });

        return this;
    }

    /**
     * Pins the `.pressed` box-shadow to this button's current resting box-shadow
     * (or `"none"`), instead of removing the property.
     *
     * @returns This component, for method chaining.
     */
    clearPressedShadow(): this {
        this.writeStateStyle(".pressed", { shadow: this.getShadow() ?? "none" });

        return this;
    }

    /**
     * Returns the background color applied when the pointer is over the button (but not pressed).
     *
     * @returns The CSS color string, or null if not set.
     */
    getHoverBackgroundColor(): string | null {
        return this.resolveStateStyleValue(":hover", "backgroundColor")
            ?? this._defaultOptions.hoverBackgroundColor ?? null;
    }

    /**
     * Sets the background color for the `:hover:not(.pressed)` CSS rule.
     *
     * @param backgroundColor - A CSS color string, or null to clear the property.
     *
     * @returns This component, for method chaining.
     */
    setHoverBackgroundColor(backgroundColor: string): this {
        this.writeStateStyle(":hover", { backgroundColor });

        return this;
    }

    /**
     * Removes the background-color from the `:hover:not(.pressed)` CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearHoverBackgroundColor(): this {
        this.writeStateStyle(":hover", { backgroundColor: null });

        return this;
    }

    /**
     * Returns the background image applied when the pointer is over the button (but not pressed).
     *
     * @returns The CSS background-image string, or null if not set.
     */
    getHoverBackgroundImage(): string | null {
        return this.resolveStateStyleValue(":hover", "backgroundImage")
            ?? this._defaultOptions.hoverBackgroundImage ?? null;
    }

    /**
     * Sets the background image for the `:hover:not(.pressed)` CSS rule.
     *
     * @param backgroundImage - A CSS background-image string, or null to clear the property.
     *
     * @returns This component, for method chaining.
     */
    setHoverBackgroundImage(backgroundImage: string): this {
        this.writeStateStyle(":hover", { backgroundImage });

        return this;
    }

    /**
     * Removes the background-image from the `:hover:not(.pressed)` CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearHoverBackgroundImage(): this {
        this.writeStateStyle(":hover", { backgroundImage: null });

        return this;
    }

    /**
     * Returns the text color applied when the pointer is over the button (but not pressed).
     *
     * @returns The CSS color string, or null if not set.
     */
    getHoverForegroundColor(): string | null {
        return this.resolveStateStyleValue(":hover", "foregroundColor")
            ?? this._defaultOptions.hoverForegroundColor ?? null;
    }

    /**
     * Sets the text color for the `:hover:not(.pressed)` CSS rule.
     *
     * @param foregroundColor - A CSS color string, or null to clear the property.
     *
     * @returns This component, for method chaining.
     */
    setHoverForegroundColor(foregroundColor: string): this {
        this.writeStateStyle(":hover", { foregroundColor });

        return this;
    }

    /**
     * Removes the color (foreground) from the `:hover:not(.pressed)` CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearHoverForegroundColor(): this {
        this.writeStateStyle(":hover", { foregroundColor: null });

        return this;
    }

    /**
     * Returns the border applied when the pointer is over the button (but not pressed).
     *
     * @returns The {@link BorderOptions} for the hover state, or null if not set.
     */
    getHoverBorder(): BorderOptions | null {
        return this.resolveStateStyleValue(":hover", "border") as BorderOptions | null;
    }

    /**
     * Sets the border for the `:hover:not(.pressed)` CSS rule. Accepts either a
     * {@link BorderOptions} bag or a CSS `border` shorthand string (sugar for
     * `{ border: <string> }`, e.g. `"1px solid rgb(...)"` or `"none"`). The four
     * CSS longhands are written so a per-side hover border survives.
     *
     * @param options - Border configuration, a CSS `border` shorthand string, or omitted for a `none` border.
     *
     * @returns This component, for method chaining.
     */
    setHoverBorder(options?: BorderOptions | string): this {
        this.writeStateStyle(":hover", { border: typeof options === "string" ? { border: options } : (options ?? {}) });

        return this;
    }

    /**
     * Removes the border from the :hover CSS rule, reverting the hover state
     * to no explicit border. Lets the un-flatten / un-chromeless round trip
     * strip a flat hover border that has no raised default to restore.
     *
     * @returns This component, for method chaining.
     */
    clearHoverBorder(): this {
        this.writeStateStyle(":hover", { border: null });

        return this;
    }

    /**
     * Returns the border radius applied when the pointer is over the button (but not pressed).
     *
     * @returns The CSS border-radius string, or null if not set.
     */
    getHoverBorderRadius(): string | null {
        return this.resolveStateStyleValue(":hover", "borderRadius")
            ?? this._defaultOptions.hoverBorderRadius ?? null;
    }

    /**
     * Sets the border radius for the `:hover:not(.pressed)` CSS rule.
     *
     * @param borderRadius - A CSS border-radius string, or null to clear the property.
     *
     * @returns This component, for method chaining.
     */
    setHoverBorderRadius(borderRadius: string): this {
        this.writeStateStyle(":hover", { borderRadius });

        return this;
    }

    /**
     * Removes the border-radius from the `:hover:not(.pressed)` CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearHoverBorderRadius(): this {
        this.writeStateStyle(":hover", { borderRadius: null });

        return this;
    }

    /**
     * Returns the box shadow applied when the pointer is over the button (but not pressed).
     *
     * @returns The CSS box-shadow string, or null if not set.
     */
    getHoverShadow(): string | null {
        return this.resolveStateStyleValue(":hover", "shadow")
            ?? this._defaultOptions.hoverShadow ?? null;
    }

    /**
     * Sets the box shadow for the `:hover:not(.pressed)` CSS rule.
     *
     * @param shadow - A CSS box-shadow string, or null to set the shadow to "none".
     *
     * @returns This component, for method chaining.
     */
    setHoverShadow(shadow: string): this {
        this.writeStateStyle(":hover", { shadow });

        return this;
    }

    /**
     * Removes the box-shadow from the `:hover:not(.pressed)` CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearHoverShadow(): this {
        this.writeStateStyle(":hover", { shadow: null });

        return this;
    }

    /**
     * Enables or disables the button.
     *
     * @param enabled - True to enable, false to disable.
     *
     * @remarks
     * When disabled, sets the native `disabled` attribute on the underlying
     * `<button>` element (which suppresses pointer events and `:active`),
     * dims the button to 0.5 opacity, and switches the cursor to `not-allowed`.
     * Re-enabling restores the previous cursor and clears the opacity override.
     */
    setEnabled(enabled: boolean): this {
        if ((this._options.enabled ?? true) === enabled) {
            return this;
        }

        this._options.enabled = enabled;

        if (enabled) {
            this.setDisabledAttribute(false);
            this.clearOpacity();
            this.setCursor(this._enabledCursor);
        } else {
            this._enabledCursor = this.getCursor() ?? "pointer";
            this.setDisabledAttribute(true);
            this.setOpacity(0.5);
            this.setCursor("not-allowed");
        }

        return this;
    }

    /**
     * Returns whether the button is currently enabled.
     *
     * @returns True if the button accepts user interaction.
     */
    isEnabled(): boolean {
        return this._options.enabled ?? true;
    }

    /**
     * Sets whether a description aligns full-width below the glyph (`true`,
     * default) or indented under the title text beside the glyph (`false`).
     * Only has a visible effect when the button has both a leading glyph and a
     * visible description; otherwise both modes resolve to the same minimal
     * row. Restructures the content row live.
     *
     * @param value - `true` for under-glyph (full width), `false` for under-title.
     *
     * @returns This component, for method chaining.
     */
    setDescriptionUnderGlyph(value: boolean): this {
        this._options.descriptionUnderGlyph = value;

        this._rebuildContentRow();
        this.recomputePreferredSize();

        return this;
    }

    /**
     * Returns whether the description aligns full-width under the glyph.
     *
     * @returns `true` for under-glyph (the default), `false` for under-title.
     */
    isDescriptionUnderGlyph(): boolean {
        return this._isDescriptionUnderGlyph();
    }

    /**
     * Sets whether the description is rendered on the button face. When
     * `false`, the button shows only its glyph and title, but the description
     * still appears in the hover tooltip — the text is stored either way. Does
     * not touch the tooltip (which is unaffected by this flag).
     *
     * @param value - `true` (default) to show the description on the button, `false` to hide it.
     *
     * @returns This component, for method chaining.
     */
    setShowDescription(value: boolean): this {
        this._options.showDescription = value;

        this._rebuildContentRow();
        this.recomputePreferredSize();

        return this;
    }

    /**
     * Returns whether the description is rendered on the button face.
     *
     * @returns `true` when the description shows on the button (the default), `false` when it is tooltip-only.
     */
    isShowDescription(): boolean {
        return this._isShowDescription();
    }

    /**
     * Sets whether the title is rendered on the button face. When `false`, the
     * button shows only its glyph, but the title still drives the hover tooltip
     * and is reflected into `aria-label` as the accessible name — the title is
     * stored either way. Toggling back to `true` restores the on-face label and
     * clears the reflected `aria-label`.
     *
     * @param value - `true` (default) to show the title on the button, `false` to hide it.
     *
     * @returns This component, for method chaining.
     */
    setShowText(value: boolean): this {
        this._options.showText = value;

        // Re-render `_text` to the title or blank, then rebuild the row and
        // re-resolve insets — hiding the title flips the button to glyph-only,
        // which changes both the inset perimeter and the glyph-only spacing.
        this._text.setText(value ? (this._options.text ?? "") : "");
        this._rebuildContentRow();
        this._resolveInsets();
        this.recomputePreferredSize();

        return this;
    }

    /**
     * Returns whether the title is rendered on the button face.
     *
     * @returns `true` when the title shows on the button (the default), `false` when it is tooltip-only.
     */
    isShowText(): boolean {
        return this._isShowText();
    }

    /**
     * Replays the `flat` DOM class token onto a freshly rendered element.
     * `_applyFlatChrome`'s `setStyleState(".flat", true)` call can fire
     * during construction, before any element exists (`setStyleState`'s own
     * DOM write is element-gated) — this catch-up mirrors
     * `ToggleButton.render()`'s own replay of `.selected` so a
     * construction-time `{ flat: true }` still carries the class after first
     * render.
     */
    protected render(): Handle {
        const element = super.render();
        DOM.sink.apply(element, { toggleClass: { flat: this.isFlat() } });
        return element;
    }
}

const ButtonCallable = callable(Button);
type ButtonCallable<TOptions extends ButtonOptions = ButtonOptions> = Button<TOptions>;
export {
    Button         as _Button,
    ButtonCallable as Button
};
