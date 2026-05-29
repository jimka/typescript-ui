// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager, LayoutManagerOptions } from "~/layout/LayoutManager.js";
import { LayoutConstraints } from "~/layout/LayoutConstraints.js";
import { Size } from "~/primitive/Size.js";
import { ToggleButton } from "~/component/button/ToggleButton.js";
import { Component } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { Animation } from "~/core/Animation.js";
import { Insets } from "~/primitive/Insets.js";
import { BorderStyle } from "~/primitive/BorderStyle.js";
import { FillType } from "~/layout/FillType.js";
import { ButtonGroup } from "~/core/ButtonGroup.js";
import { RovingTabIndex } from "~/core/RovingTabIndex.js";
import { Fit } from "~/layout/Fit.js";
import { HBox } from "~/layout/HBox.js";
import { TabCloseButton } from "~/component/button/TabCloseButton.js";
import { ProgressSpinner } from "~/component/display/ProgressSpinner.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { callable } from "~/core/Callable.js";

/**
 * String-literal union of the events emitted by {@link Tab}.
 *
 * @category Layouts
 */
export type TabEvent = "tabclose";

/** Duration (ms) of the cross-tab fade-in transition. */
const TAB_FADE_DURATION_MS = 120;

/**
 * Construction-time options for {@link Tab}.
 *
 * @category Layouts
 */
export interface TabOptions extends LayoutManagerOptions {
    /** @deprecated Use `listeners.tabclose`. */
    onTabClose?: (component: Component) => void;
    /**
     * Multi-event listener bag dispatched to {@link Tab.on} at construction
     * time.
     */
    listeners?: {
        tabclose?: (component: Component) => void;
    };
}

/**
 * Lifecycle state of a tab slot.
 *
 * - `"ready"` — `component` is built and attached. `getVisibleComponent`
 *   returns it directly.
 * - `"lazy"` — `factory` is registered but has not run. First activation
 *   transitions to `"building"`.
 * - `"building"` — the materialize helper has mounted `spinner` into the
 *   container and queued the factory behind a two-rAF yield. `onReady`
 *   moves the entry to `"ready"`. Re-entering this state is suppressed
 *   so spam-clicks during a build do not start a second factory run.
 */
type TabEntryState = "lazy" | "building" | "ready";

/**
 * Bookkeeping record for one tab slot.
 *
 * @remarks `component` is `null` for entries registered via `addLazyTab` until the
 * first activation; on materialization, the factory runs and the produced component
 * is cached here. Eager entries (created by `createTab`) populate `component`
 * immediately and leave `factory` null. The component reference is stored on the
 * entry rather than looked up by index in `container.getComponents()` because lazy
 * tabs may materialize out of order — `Component.addComponent` always appends, so
 * indices between `tabs[]` and the container's component list do not stay aligned.
 *
 * `spinner` carries the placeholder Component that `Animation.materialize`
 * mounts into the container during the factory's two-rAF yield, so the
 * layout pass can surface it as the visible child while the build is in
 * flight.
 */
interface TabEntry {
    wrapper: Component;
    button: ToggleButton;
    closeButton?: TabCloseButton;
    component: Component | null;
    factory: (() => Component) | null;
    constraints?: LayoutConstraints;
    spinner: Component | null;
    state: TabEntryState;
}

/**
 * A layout manager that renders a row of tab buttons above the container content area
 * and shows exactly one child component at a time based on the selected tab.
 * Tab button labels are taken from `LayoutConstraints.name` when available,
 * otherwise from the component's ID.
 *
 * @category Layouts
 */
class Tab extends LayoutManager {

    private _toolbar: Component = new Component();
    private _tabs: Array<TabEntry> = [];
    private _buttonGroup: ButtonGroup = new ButtonGroup();
    private _rovingTabIndex: RovingTabIndex = new RovingTabIndex();
    private _selectedTabIndex: number = 0;
    // Last tab index that was faded in during a doLayout pass. Compared
    // against `selectedTabIndex` so the cross-tab fade fires only on actual
    // selection changes (not on every relayout, e.g. window resize).
    private _lastFadedTabIndex: number = -1;
    private _listeners: ListenerBag<TabEvent> = new ListenerBag<TabEvent>();

    /**
     * Creates a Tab layout manager with an empty toolbar.
     *
     * @param options - Optional construction-time options.
     */
    constructor(options?: TabOptions) {
        super();

        this._toolbar.setLayoutManager(new HBox({ mode: "equal", spacing: 0 }));
        this._toolbar.setBackgroundColor("var(--ts-ui-tab-toolbar-bg, #eee)");
        this._toolbar.clearInsets();
        this._toolbar.setBorder({ style: BorderStyle.SOLID, width: 1, color: "var(--ts-ui-tab-toolbar-border, #e1e1e8)" });
        this._toolbar.setPreferredSize(0, 30);

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link TabOptions} bag, dispatching the close callback
     * after the inherited LayoutManager defaults.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: TabOptions): void {
        super.applyOptions(options);

        if (options.listeners?.tabclose !== undefined) {
            this.on("tabclose", options.listeners.tabclose);
        }

        if (options.onTabClose !== undefined) {
            this.setOnTabClose(options.onTabClose);
        }
    }

    /**
     * Updates the selected tab index, syncs the roving tabindex, and triggers a re-layout when a tab button is clicked.
     *
     * @param tab - The tab button component that was pressed.
     */
    onTabPressed(tab: Component): void {
        const idx = this._tabs.findIndex(entry => entry.button === tab);

        if (idx >= 0) {
            this._selectedTabIndex = idx;
            this._rovingTabIndex.moveTo(idx);

            const entry = this._tabs[idx];
            if (entry.state === "lazy") {
                this.materializeAsync(idx);
            }
        }

        this.getContainer()?.scheduleLayout();
    }

    /**
     * Attaches to a container and appends the tab toolbar element to it.
     *
     * @param container - The container component to attach to.
     */
    attach(container: Component): this {
        super.attach(container);

        let element = this._toolbar.getElement(true);
        container.getElement(true).appendChild(element);

        this._toolbar.getAria().setRole("tablist");

        Event.addSubtreeListener(this._toolbar, "keydown", (e: KeyboardEvent) => this.onToolbarKeyDown(e));

        return this;
    }

    /**
     * Detaches from the container and removes the tab toolbar element from the DOM.
     */
    detach(): this {
        super.detach();

        this._toolbar.getElement().remove();

        return this;
    }

    /**
     * Returns the child component at the currently selected tab index, materializing
     * a lazily-registered panel on first access.
     *
     * @returns The visible component, or `null` if no entry is registered at the selected index or the container is not attached.
     */
    getVisibleComponent(): Component | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        const entry = this._tabs[this._selectedTabIndex];
        if (entry) {
            if (entry.component) {
                return entry.component;
            }

            if (entry.state === "building" && entry.spinner) {
                return entry.spinner;
            }

            return null;
        }

        return container.getComponents()[this._selectedTabIndex] ?? null;
    }

    /**
     * Returns the preferred size: the visible component's preferred size plus the toolbar height.
     *
     * @returns The preferred `{width, height}`, or `null` if there is no container or visible component.
     */
    getPreferredSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();

        let outerWidth = perimiterSize.left + perimiterSize.right;
        let outerHeight = perimiterSize.top + perimiterSize.bottom;

        let visibleComponent = this.getVisibleComponent();
        if (!visibleComponent) {
            return null;
        }

        let size = visibleComponent.getPreferredSize();
        if (!size) {
            return null;
        }

        let toolbarSize = this._toolbar.getPreferredSize();
        if (!toolbarSize) {
            return null;
        }

        return {
            width: size.width + outerWidth,
            height: size.height + toolbarSize.height + outerHeight
        };
    }

    /**
     * Returns the minimum size: the visible component's minimum size plus the toolbar minimum height.
     *
     * @returns The minimum `{width, height}`, or `null` if there is no container or visible component.
     */
    getMinSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();

        let outerWidth = perimiterSize.left + perimiterSize.right;
        let outerHeight = perimiterSize.top + perimiterSize.bottom;

        let visibleComponent = this.getVisibleComponent();
        if (!visibleComponent) {
            return null;
        }

        let size = visibleComponent.getMinSize();
        if (!size) {
            return null;
        }

        let toolbarSize = this._toolbar.getMinSize();
        if (!toolbarSize) {
            return null;
        }

        return {
            width: size.width + outerWidth,
            height: size.height + toolbarSize.height + outerHeight
        };
    }

    /**
     * Returns the maximum size: the visible component's maximum size plus the toolbar maximum height.
     *
     * @returns The maximum `{width, height}`, or `null` if there is no container or visible component.
     */
    getMaxSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();

        let outerWidth = perimiterSize.left + perimiterSize.right;
        let outerHeight = perimiterSize.top + perimiterSize.bottom;

        let visibleComponent = this.getVisibleComponent();
        if (!visibleComponent) {
            return null;
        }

        let size = visibleComponent.getMaxSize();
        if (!size) {
            return null;
        }

        let toolbarSize = this._toolbar.getMaxSize();
        if (!toolbarSize) {
            return null;
        }

        return {
            width: size.width + outerWidth,
            height: size.height + toolbarSize.height + outerHeight
        };
    }

    /**
     * Builds the toolbar wrapper, toggle button, and optional close button for one
     * tab slot, registers them with the button group / roving tab index, and pushes
     * the entry onto `this.tabs`. The component-side ARIA wiring is left to the
     * caller because the content component may not exist yet (lazy entries).
     *
     * @param name - The visible label for the tab button.
     * @param constraints - Optional layout constraints; `constraints.closeable` adds a close button.
     * @returns The newly-registered tab entry with `component` and `factory` set to `null`.
     */
    private buildTabEntry(name: string, constraints?: LayoutConstraints): TabEntry {
        let tabButton = new ToggleButton(name);

        tabButton.setBackgroundColor("var(--ts-ui-tab-button-bg, #b8b8c3)");
        tabButton.clearBorder();
        tabButton.clearBorderRadius();
        tabButton.clearShadow();
        tabButton.setInsets(new Insets(0, 4, 0, 4));
        tabButton.getText().setInsets(new Insets(0, 4, 0, 4));

        tabButton.addActionListener(() => this.onTabPressed(tabButton));

        const wrapperHBox = new HBox();
        wrapperHBox.setComponentSpacing(0);
        wrapperHBox.setStretching(true);

        const wrapper = new Component();
        wrapper.setLayoutManager(wrapperHBox);
        wrapper.setBackgroundColor("transparent");
        wrapper.clearBorder();
        wrapper.clearShadow();
        wrapper.setInsets(new Insets(0, 0, 0, 0));

        wrapper.addComponent(tabButton, { weight: 1 });

        let closeButton: TabCloseButton | undefined;

        if (constraints?.closeable) {
            closeButton = new TabCloseButton();
            closeButton.clearBorder();
            closeButton.clearBorderRadius();
            closeButton.clearShadow();
            wrapper.addComponent(closeButton);
        }

        const entry: TabEntry = {
            wrapper,
            button: tabButton,
            closeButton,
            component: null,
            factory: null,
            constraints,
            spinner: null,
            state: "lazy"
        };

        if (closeButton) {
            closeButton.addActionListener(() => this.closeTab(entry));
        }

        this._tabs.push(entry);

        const isSelected = this._tabs.length - 1 === this._selectedTabIndex;

        if (isSelected) {
            tabButton.setSelected(true);
        }

        this._buttonGroup.addButton(tabButton);
        this._rovingTabIndex.add(tabButton);
        this._toolbar.addComponent(wrapper);

        tabButton.getAria().setRole("tab");
        tabButton.getAria().setSelected(isSelected);

        return entry;
    }

    /**
     * Wires the component-side ARIA so the panel is announced as the tabpanel
     * controlled by the tab button.
     *
     * @param entry - The tab entry whose button labels and controls the component.
     * @param component - The content component to attach ARIA roles to.
     */
    private wireComponentAria(entry: TabEntry, component: Component): void {
        entry.button.getAria().setControls(component.getId());

        component.getAria().setRole("tabpanel");
        component.getAria().setTabIndex(-1);
        component.getAria().setLabelledBy(entry.button.getId());
    }

    /**
     * Creates a tab entry for a component and adds it to the toolbar.
     *
     * @param component - The content component for which a tab entry should be created.
     *
     * @remarks The button label is taken from `LayoutConstraints.name` when available;
     * otherwise the component's ID is used. When `constraints.closeable` is true, a
     * [`TabCloseButton`](/api/component/button/classes/TabCloseButton) is appended to the wrapper after the toggle button.
     */
    createTab(component: Component): void {
        let constraints = this.getLayoutConstraints(component);
        let name: string;

        if (constraints && constraints.name) {
            name = constraints.name;
        } else {
            name = component.getId();
        }

        const entry = this.buildTabEntry(name, constraints);

        entry.component = component;
        entry.factory = null;
        entry.state = "ready";

        this.wireComponentAria(entry, component);
    }

    /**
     * Registers a tab whose content component is built on first activation rather
     * than at registration time. The tab button is created immediately so the tab
     * strip renders fully on first paint; the factory runs only when the tab is
     * first selected (or laid out as the initial tab).
     *
     * @param factory - A zero-argument function that produces the content component on first activation.
     * @param name - The visible label for the tab button.
     * @param constraints - Optional layout constraints; forwarded to `container.addComponent` when the component is materialized.
     *
     * @remarks Materialization is asynchronous: on first activation the tab
     * strip selects the new tab immediately, a centred `ProgressSpinner` is
     * mounted into the container, and the factory runs after a two-rAF yield
     * via [`Animation.materialize`](/api/core/namespaces/Animation/functions/materialize)
     * so the spinner reaches the screen before the main-thread build cost is
     * incurred. The materialized component fades in over the spinner.
     *
     * Layout-sizing queries (`getPreferredSize` / `getMinSize` / `getMaxSize`)
     * do not trigger factory invocations — they observe the spinner placeholder
     * until the build completes.
     *
     * Once a `Tab` contains any lazy entries, mixing direct
     * `container.addComponent(c, {...})` calls is not supported: `tabs.length`
     * may equal or exceed `componentCount`, which causes the auto-`createTab`
     * loop in `doLayout` to skip the eager component. Use `addLazyTab` for all
     * subsequent additions, or stay fully eager.
     *
     * @example
     * ```typescript
     * const layout = new Tab();
     * body.setLayoutManager(layout);
     * layout.addLazyTab(() => new HeavyPanel(), "Heavy");
     * ```
     */
    addLazyTab(factory: () => Component, name: string, constraints?: LayoutConstraints): void {
        const entry = this.buildTabEntry(name, constraints);

        entry.factory   = factory;
        entry.component = null;
        entry.state     = "lazy";
    }

    /**
     * Builds the spinner placeholder for a tab entry: a fixed-size
     * `ProgressSpinner` wrapped in a [`Fit`](/api/layout/classes/Fit) layout
     * configured with `FillType.NONE` so the spinner sits at its preferred
     * size in the geometric centre of the container's content area. The
     * diameter (24 px) matches `TablePanel`'s store-loading spinner so a
     * slow lazy panel and a slow data load look identical.
     *
     * @returns A Component owning a single `ProgressSpinner` child.
     */
    private createSpinnerWrap(): Component {
        const wrap = new Component();
        wrap.setLayoutManager(new Fit({ fill: FillType.NONE }));
        wrap.addComponent(new ProgressSpinner(24));

        return wrap;
    }

    /**
     * Mounts a spinner into the container, yields two animation frames so it
     * reaches the screen, then runs the entry's factory and fades the built
     * component in over the spinner. Re-entry while a build is in flight is
     * suppressed via the entry's `state` field.
     *
     * @param idx - Zero-based index into `this.tabs`.
     *
     * @remarks Replaces the previous synchronous `materialize` path. Layout-
     * sizing queries (`getPreferredSize` / `getMinSize` / `getMaxSize`) no
     * longer trigger factory invocations — they observe the spinner placeholder
     * until the build completes.
     */
    private materializeAsync(idx: number): void {
        const entry = this._tabs[idx];
        if (!entry || entry.state !== "lazy") {
            return;
        }

        const factory = entry.factory;
        if (!factory) {
            return;
        }

        const container = this.getContainer();
        if (!container) {
            return;
        }

        const spinner = this.createSpinnerWrap();
        entry.spinner = spinner;
        entry.state   = "building";

        Animation.materialize({
            host:             container,
            factory:          factory,
            spinnerComponent: spinner,
            onReady:          (component) => {
                entry.component = component;
                entry.factory   = null;
                entry.spinner   = null;
                entry.state     = "ready";

                this.wireComponentAria(entry, component);
                container.scheduleLayout();
            }
        });
    }

    /**
     * Computes the children's combined minSize along this manager's geometry:
     * width is `max(toolbar.preferredWidth, visibleChild.minWidth)`; height
     * is `toolbar.preferredHeight + visibleChild.minHeight`. Used by
     * `doLayout` to inflate the content area's working size when the host
     * has opted into `setOverflowing`; the toolbar's geometry is unaffected.
     *
     * @returns The total min-size; `{ width: 0, height: 0 }` when the
     *   container is absent.
     */
    protected computeTotalMinSize(): Size {
        const container = this.getContainer();
        if (!container) {
            return { width: 0, height: 0 };
        }

        const toolbarSize = this._toolbar.getPreferredSize();
        const toolbarW = toolbarSize ? toolbarSize.width  : 0;
        const toolbarH = toolbarSize ? toolbarSize.height : 0;

        const visible = this.getVisibleComponent() ?? container.getComponents()[0];
        const childMin = visible?.getMinSize();
        const childMinW = childMin ? childMin.width  : 0;
        const childMinH = childMin ? childMin.height : 0;

        return {
            width:  Math.max(toolbarW, childMinW),
            height: toolbarH + childMinH,
        };
    }

    /**
     * Creates tab buttons for new components, hides all but the selected child,
     * and positions the toolbar and the visible component.
     *
     * @remarks Tab buttons are created lazily: only components that do not yet have
     * a corresponding button receive one. The toolbar is positioned at the top of the
     * container and the visible component occupies the remaining space beneath it.
     */
    doLayout(): void {
        let container = this.getContainer();
        if (!container) {
            return;
        }

        let components = container.getComponents();
        let containerSize = container.getInnerSize();
        let containerInsets = container.getInsets();

        let componentCount = components.length;

        for (let i = this._tabs.length; i < componentCount; i += 1) {
            let component = components[i];
            this.createTab(component);
        }

        // The initial tab is never explicitly clicked, so its factory has to
        // be kicked off the first time we lay the container out. Subsequent
        // selections route through onTabPressed.
        const initialEntry = this._tabs[this._selectedTabIndex];
        if (initialEntry && initialEntry.state === "lazy") {
            this.materializeAsync(this._selectedTabIndex);
        }

        for (let idx in components) {
            let component = components[idx];
            component.setVisible(false);
            component.getAria().setHidden(true);
        }

        for (let i = 0; i < this._tabs.length; i++) {
            this._tabs[i].button.getAria().setSelected(i === this._selectedTabIndex);
        }

        let component = this.getVisibleComponent();

        if (!component && components.length > 0) {
            component = components[0];
        }

        let toolbarSize = this._toolbar.getPreferredSize();
        let toolbarHeight = toolbarSize ? toolbarSize.height : 0;

        this._toolbar.setX(containerInsets.getLeft());
        this._toolbar.setY(containerInsets.getTop());
        this._toolbar.setWidth(containerSize ? containerSize.width : 0);
        this._toolbar.setHeight(toolbarHeight);

        this._toolbar.doLayout();

        if (!component) {
            return;
        }

        component.setVisible(true);
        component.getAria().setHidden(false);

        // Universal scroll: only the content area honours the overflow flags;
        // the toolbar always renders at the container's original width so its
        // own internal `ToolBar` overflow mechanism stays in charge of long
        // tab lists (see plan's Non-Goals).
        let contentWidth  = containerSize ? containerSize.width                 : 0;
        let contentHeight = containerSize ? containerSize.height - toolbarHeight : 0;

        if (containerSize && (this.isOverflowingX() || this.isOverflowingY())) {
            const totalMin = this.computeTotalMinSize();
            if (this.isOverflowingX()) {
                contentWidth  = Math.max(contentWidth,  totalMin.width);
            }
            if (this.isOverflowingY()) {
                // totalMin.height already includes toolbarH; subtract it to
                // get the content-area's own minimum.
                contentHeight = Math.max(contentHeight, totalMin.height - toolbarHeight);
            }
        }

        this.placeComponent(
            component,
            containerInsets.getLeft(),
            containerInsets.getTop() + toolbarHeight,
            contentWidth,
            contentHeight,
            FillType.BOTH
        );

        // Fade the newly-visible child in only when the selection actually
        // changed since the last layout AND the entry is fully built — for a
        // lazy tab still mid-build, the spinner placeholder is what's on
        // screen and `Animation.materialize` runs the content fade itself.
        const selectedEntry = this._tabs[this._selectedTabIndex];
        const isReady       = selectedEntry?.state === "ready";

        if (isReady && this._lastFadedTabIndex !== this._selectedTabIndex) {
            this._lastFadedTabIndex = this._selectedTabIndex;

            const el = component.getElement();
            if (el) {
                Animation.play(el, {
                    from:       { opacity: "0" },
                    to:         { opacity: "1" },
                    durationMs: TAB_FADE_DURATION_MS,
                    properties: ["opacity"],
                });
            }
        }
    }

    /**
     * Registers a listener for one of this tab layout's events.
     *
     * @param event - `"tabclose"` fires after a tab is closed, receiving
     *   the content component that was removed.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This tab layout, for method chaining.
     */
    on(event: "tabclose", listener: (component: Component) => void): this;
    on(event: TabEvent,   listener: Function): this {
        this._listeners.add(event, listener);

        return this;
    }

    /**
     * Removes a previously registered listener. The exact callback reference
     * must match.
     *
     * @param event - The event the listener was registered for.
     * @param listener - The callback to remove.
     *
     * @returns This tab layout, for method chaining.
     */
    off(event: TabEvent, listener: Function): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fires every listener registered for `event` with `payload`, in
     * registration order.
     *
     * @param event - The event to emit.
     * @param payload - Forwarded to each listener.
     */
    protected emit(event: "tabclose", component: Component): void;
    protected emit(event: TabEvent,   ...payload: unknown[]): void {
        this._listeners.fire(event, ...payload);
    }

    /**
     * @deprecated Use `on("tabclose", fn)`.
     *
     * @param callback - Receives the content component that was removed.
     */
    setOnTabClose(callback: (component: Component) => void): void {
        this.on("tabclose", callback);
    }

    /**
     * Removes a tab entry and its associated content component, then selects the next tab.
     *
     * @param entry - The tab entry to close.
     */
    private closeTab(entry: TabEntry): void {
        const container = this.getContainer();
        if (!container) {
            return;
        }

        const entryIndex = this._tabs.indexOf(entry);
        if (entryIndex < 0) {
            return;
        }

        const contentComponent = entry.component;

        this._buttonGroup.removeButton(entry.button);
        this._rovingTabIndex.remove(entry.button);
        this._tabs.splice(entryIndex, 1);
        this._toolbar.removeComponent(entry.wrapper);

        if (contentComponent) {
            container.removeComponent(contentComponent);
        }

        if (contentComponent) {
            this.emit("tabclose", contentComponent);
        }

        this.selectNextTab(entryIndex);
        this.getContainer()?.scheduleLayout();
    }

    /**
     * Selects an appropriate tab after the tab at `closedIndex` has been removed.
     *
     * @param closedIndex - The index that was just spliced out.
     */
    private selectNextTab(closedIndex: number): void {
        const count = this._tabs.length;

        if (count === 0) {
            this._selectedTabIndex = 0;

            return;
        }

        const newIndex = closedIndex > 0 ? closedIndex - 1 : 0;
        this._selectedTabIndex = newIndex;

        this._tabs.forEach(e => e.button.setSelected(false));
        this._tabs[newIndex].button.setSelected(true);
    }

    /**
     * Handles ArrowLeft / ArrowRight to move tab focus and activate the adjacent tab.
     *
     * @param e - The keyboard event fired on the toolbar element.
     */
    private onToolbarKeyDown(e: KeyboardEvent): void {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') {
            return;
        }

        const tabCount = this._tabs.length;

        if (tabCount === 0) {
            return;
        }

        e.preventDefault();

        const newIdx = e.key === 'ArrowRight'
            ? (this._selectedTabIndex + 1) % tabCount
            : (this._selectedTabIndex - 1 + tabCount) % tabCount;

        const newTab = this._tabs[newIdx].button;

        this._tabs.forEach(entry => entry.button.setSelected(false));
        newTab.setSelected(true);

        this.onTabPressed(newTab);
    }
}

const TabCallable = callable(Tab);
type TabCallable = Tab;
export {
    Tab         as _Tab,
    TabCallable as Tab
};
