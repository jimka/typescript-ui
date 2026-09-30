// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager, LayoutManagerOptions } from "~/layout/LayoutManager.js"
import { FillType } from "~/layout/FillType.js";
import { Size } from "~/primitive/Size.js";
import { Component } from "~/core/Component.js";
import type { ComponentFactory } from "~/core/Component.js";
import type { LayoutConstraints } from "~/layout/LayoutConstraints.js";
import { callable } from "~/core/Callable.js";

/**
 * An unbuilt keyed child: the factory, plus the constraints the caller
 * registered it with, which are handed to `addComponent` when it is built so a
 * deferred child ends up with exactly the constraints an eager one would have.
 *
 * @remarks The caller's own constraints instance is held, not a copy — the same
 * as the eager path, where `setLayoutConstraints` stores what it was given. A
 * caller that mutates one constraints object between registrations therefore
 * changes what its already-registered slots will be built with. The registry
 * key is a string captured at registration and is unaffected.
 */
interface DeferredCardChild {
    factory:     ComponentFactory;
    constraints: LayoutConstraints;
}

/**
 * Construction-time options for {@link Card}.
 *
 * @category Layouts
 */
export interface CardOptions extends LayoutManagerOptions {
    visibleComponentId?: string;
    /** Selects the visible child by its `key` constraint. Clears any `visibleComponentId`. */
    visibleKey?: string;
}

/**
 * A layout manager that shows exactly one child component at a time,
 * sizing it to fill the container's inner bounds.
 * The visible child is selected by component ID; all others are undisplayed
 * (`display: none`), dropping them out of the render tree entirely.
 *
 * A child can equally be selected by a caller-supplied **key**, carried in its
 * layout constraints and chosen with `setVisibleKey`. Unlike a component id, a
 * key can name a child that has not been built yet: passing a factory to
 * `Component.addComponent` with a `key` constraint registers a page that is
 * constructed the first time that key is selected — or, when the key was
 * selected before the registration arrived, on the first layout pass of a
 * rendered container. The build is synchronous, so a factory returning a
 * promise throws; an asynchronous factory needs a
 * [`Tab`](/api/layout/classes/Tab)-managed container instead.
 *
 * @category Layouts
 */
class Card extends LayoutManager {

    private _visibleComponentId: string | null = null;
    private _visibleKey: string | null = null;
    private _currentVisible: Component | null = null;

    // Unbuilt keyed slots, registered by `addDeferredComponent` and consumed by
    // `buildDeferredChild`. An entry leaves the map the moment its factory is
    // about to run, so a slot is pending or built and never both — which is why
    // no per-slot status field is needed: the map is the status.
    private _deferred: Map<string, DeferredCardChild> = new Map();

    // Framework bookkeeping, not consumer configuration — see the
    // undisplay-inactive-tab-pages plan's `## Public API` for why this stays
    // off `CardOptions`. `syncVisible` flips a child's display outside of any
    // layout pass (reachable from `setVisibleComponentId` and `setVisibleKey`),
    // so the component owed a scroll restore is parked here and consumed by the
    // next `doLayout`, once `placeComponent` has relaid it out.
    private _pendingScrollRestore: Component | null = null;

    constructor(options?: CardOptions) {
        // LayoutManager's constructor takes no options; applied via applyOptions below.
        // eslint-disable-next-line local/forward-super-options
        super();

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link CardOptions} bag, dispatching the initial visible
     * component id or key after the inherited LayoutManager defaults.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: CardOptions): void {
        super.applyOptions(options);

        if (options.visibleComponentId !== undefined) {
            this.setVisibleComponentId(options.visibleComponentId);
        }

        if (options.visibleKey !== undefined) {
            this.setVisibleKey(options.visibleKey);
        }
    }

    /**
     * Returns the configured visible-component id.
     *
     * @returns The configured visible-component id, or `null` when the card is
     *   selecting by key or falling back to its first child — the two readings
     *   `getVisibleKey` answers for.
     */
    getVisibleComponentId(): string | null {
        return this._visibleComponentId;
    }

    /**
     * Returns the preferred size of the visible child plus the container perimeter.
     *
     * @returns The preferred `{width, height}`, or `null` if there is no container or no visible component.
     */
    getPreferredSize(): Size | null {
        return this.computeSize(component => component.getPreferredSize());
    }

    /**
     * Returns the minimum size of the visible child plus the container perimeter.
     *
     * @returns The minimum `{width, height}`, or `null` if there is no container or no visible component.
     */
    getMinSize(): Size | null {
        return this.computeSize(component => component.getMinSize());
    }

    /**
     * Returns the maximum size of the visible child plus the container perimeter.
     *
     * @returns The maximum `{width, height}`, or `null` if there is no container or no visible component.
     */
    getMaxSize(): Size | null {
        return this.computeSize(component => component.getMaxSize());
    }

    /**
     * Shared core of {@link getPreferredSize} / {@link getMinSize} /
     * {@link getMaxSize}: adds the visible child's size (selected by `sizeOf`)
     * to the container perimeter.
     *
     * @param sizeOf - Selects the child's preferred, minimum, or maximum size.
     * @returns The composed `{width, height}`, or `null` if there is no
     *   container, no visible component, or the child reports no size.
     */
    private computeSize(sizeOf: (component: Component) => Size | null): Size | null {
        const container = this.getContainer();
        if (!container) {
            return null;
        }

        const perimeterSize = container.getPerimeterSize();
        if (!perimeterSize) {
            return null;
        }

        const outerWidth = perimeterSize.left + perimeterSize.right;
        const outerHeight = perimeterSize.top + perimeterSize.bottom;

        const visibleComponent = this.getVisibleComponent();
        if (!visibleComponent) {
            return null;
        }

        const size = sizeOf(visibleComponent);
        if (!size) {
            return null;
        }

        return {
            width: size.width + outerWidth,
            height: size.height + outerHeight
        };
    }

    /**
     * Selects which child component is visible. Undisplays the
     * previously-visible child (if different) and displays the new one.
     * Subsequent `doLayout` calls only re-size the visible child; display
     * writes happen here, not on every layout pass.
     *
     * Retires any visible key, so the card carries one selection however it was
     * named.
     *
     * @param id - The ID of the child component to make visible.
     * @returns This layout manager, for method chaining.
     */
    setVisibleComponentId(id: string): this {
        if (this._visibleComponentId === id) {
            return this;
        }

        // One selection slot, two spellings: storing an id retires any
        // configured key, which is also what keeps `setVisibleKey`'s own
        // same-value early return correct after an id has been selected.
        this._visibleKey = null;
        this._visibleComponentId = id;
        this.syncVisible();

        // Schedule a layout so a child first shown here gets sized: doLayout only
        // ever lays out the visible child, so a sibling that was hidden during
        // the initial pass has never been laid out and would render blank until
        // an unrelated relayout. No-op before the manager is attached.
        this.getContainer()?.scheduleLayout();

        return this;
    }

    /**
     * The live child carrying `key` as its layout constraint, or `null` when
     * none does. The **first** match in `getComponents()` order wins.
     *
     * @param key - The key to look for.
     * @returns The child carrying `key`, or `null`.
     *
     * @remarks One definition of "which child owns this key", read by the
     * resolver, by `hasKey`, and by the collision check that runs before a
     * deferred factory. They must agree on *which* child wins for the collision
     * check to protect the page the resolver would otherwise hide, so they share
     * this one lookup rather than each carrying a loop.
     */
    private liveChildForKey(key: string): Component | null {
        const container = this.getContainer();

        if (!container) {
            return null;
        }

        for (const c of container.getComponents()) {
            if (this.getLayoutConstraints(c)?.key === key) {
                return c;
            }
        }

        return null;
    }

    /**
     * Reports whether `key` names a slot on this card: either a registered
     * factory that has not run yet, or a live child carrying that `key`
     * constraint.
     *
     * @param key - The key to look for.
     * @returns `true` when a pending slot or a live child answers to `key`.
     *
     * @remarks The pre-flight for a caller that may hold a key this card does
     * not have — a router reading a URL segment, say. Selecting an unknown key
     * reports it and leaves the card on its first child, the same fallback an
     * unknown component id gets, so asking first is what avoids that path.
     */
    hasKey(key: string): boolean {
        // Pending first, because that is the cheap answer and the common one at
        // startup. A slot that has been built is no longer in `_deferred`, so
        // the live-child lookup is what keeps the answer stable across the first
        // selection — a caller asking a second time must still be told yes.
        return this._deferred.has(key) || this.liveChildForKey(key) !== null;
    }

    /**
     * Returns the key selecting the visible child.
     *
     * @returns The visible key, or `null` when the card is selecting by
     *   component id or falling back to its first child.
     */
    getVisibleKey(): string | null {
        return this._visibleKey;
    }

    /**
     * Claims an unbuilt child offered by `Component.addComponent`, registering
     * it under the `key` its constraints carry so a later `setVisibleKey` can
     * build and show it. A factory with no key, or one declining deferral with
     * `lazy: false`, is handed back for the container to build immediately.
     *
     * @param factory - Produces the child on its key's first selection — or,
     *   when the key was already selected before this registration, on the
     *   first layout pass of a rendered container.
     * @param constraints - The constraints the caller passed: the source of
     *   `key` and `lazy`, and stored so the built child is added with exactly
     *   the constraints an eager one would have carried.
     * @returns `true` when this manager has taken the factory over — registered
     *   under its key, or discarded because that key already names a slot — and
     *   `false` when the container should build it immediately.
     */
    override addDeferredComponent(factory: ComponentFactory, constraints?: LayoutConstraints): boolean {
        const key = constraints?.key ?? null;

        // A factory with no key could never be selected afterwards, so there is
        // nothing to defer it for: declining hands it back to the container,
        // which builds it immediately — what every manager but Tab did before
        // this change. An explicit `lazy: true` asked for a deferral this card
        // cannot give, so that one case is reported instead of silently
        // absorbed. The combined test also narrows `constraints` and `key` for
        // everything below.
        if (!constraints || !key) {
            if (constraints?.lazy === true) {
                console.warn("Card: a deferred child needs a `key` constraint to be selectable; building it immediately.");
            }

            return false;
        }

        // Claimed and dropped rather than declined: declining would hand the
        // factory back to the container, which would build it and leave a second
        // slot answering to `key`. The first registration keeps the key.
        // Claiming in order to discard is within `addDeferredComponent`'s own
        // contract, which gives a claiming manager ownership of when *and
        // whether* the factory runs.
        if (this.hasKey(key)) {
            console.warn(`Card: key "${key}" already names a slot on this card; this registration is discarded.`);

            return true;
        }

        // `lazy: false` declines the deferral, with the same spelling and the
        // same meaning it has on a Tab.
        if (constraints.lazy === false) {
            return false;
        }

        this._deferred.set(key, { factory, constraints });

        // A key selected before this registration is resolved by the pass this
        // schedules — `doLayout` builds the pending slot.
        this.getContainer()?.scheduleLayout();

        return true;
    }

    /**
     * Runs the pending factory for `key` and adds the result to the container.
     *
     * @param key - The slot to build.
     * @returns `true` when a factory ran; `false` when `key` has no pending
     *   slot, when this manager is not attached yet, or when a live child has
     *   taken the key and the slot was therefore discarded.
     * @throws Error - when the factory returns a promise, which a synchronous
     *   build has nothing to host. The slot has already been dropped by then,
     *   so the failure is reported once rather than on every later selection.
     */
    private buildDeferredChild(key: string): boolean {
        const container = this.getContainer();
        const pending   = this._deferred.get(key);

        if (!container || !pending) {
            return false;
        }

        // The registration-time collision guard cannot see this case: a live
        // child reaches the container without passing `addDeferredComponent` at
        // all, and `moveComponent` can bring this key in on a child nobody keyed
        // here. If one now carries the key, building would append the new panel
        // behind it and the resolver would go on showing the older child — so
        // the slot is dropped unbuilt and the live child keeps the key.
        //
        // What the card then shows depends on which caller got here.
        // `setVisibleKey` re-resolves in its `finally`, so it switches to the
        // live child holding the key. A `doLayout` catch-up does not: it syncs
        // only on a successful build, and the pass re-resolves only when nothing
        // is currently visible. That is the same rule any live child added after
        // the first sync already follows, so a key whose child arrived that way
        // is picked up by the next selection rather than by the next pass.
        if (this.liveChildForKey(key)) {
            console.warn(`Card: key "${key}" is carried by a live child of this container; `
                       + `the factory registered under it is discarded unbuilt.`);

            this._deferred.delete(key);

            return false;
        }

        // Dropped before the factory runs, so a factory that throws — or returns
        // a promise, or a component that already has a parent — is never run a
        // second time by a later selection or a later layout pass. "Built at
        // most once" then holds for the failure paths as well as the happy one.
        this._deferred.delete(key);

        const built = pending.factory();

        // The message names the key rather than a caller: this method is reached
        // from `setVisibleKey` *and* from `doLayout`'s catch-up, so naming
        // either one would be wrong on the other path.
        if (built instanceof Promise) {
            throw new Error(`Card: the deferred child for key "${key}" returned a promise. `
                          + "A Card builds a deferred child synchronously, so there is nothing to host "
                          + "the wait — an asynchronous factory needs a Tab-managed container.");
        }

        container.addComponent(built, pending.constraints);

        return true;
    }

    /**
     * Selects the visible child by its `key` constraint, building it first when
     * the key names a factory that has not run yet. Clears any configured
     * visible component id, so the card carries one selection however it was
     * named.
     *
     * @param key - The key of the child to make visible.
     * @returns This layout manager, for method chaining.
     * @throws Error - when the key's deferred factory returns a promise. A Card
     *   builds a deferred child synchronously, so there is nothing to host the
     *   wait; an asynchronous factory needs a Tab-managed container. The same
     *   failure can surface from a layout pass instead, when the key was
     *   selected before its factory was registered, so the message names the key
     *   and not this method.
     *
     * @remarks A key no slot answers to is reported and leaves the card on its
     * first child — the same fallback an unknown component id gets. Call
     * `hasKey` first when the key may not be one this card has.
     */
    setVisibleKey(key: string): this {
        if (this._visibleKey === key) {
            return this;
        }

        // One selection slot, two spellings: storing a key retires any
        // configured id, which is also what keeps `setVisibleComponentId`'s own
        // same-value early return correct after a key has been selected.
        this._visibleComponentId = null;
        this._visibleKey         = key;

        // The sync runs even when the factory throws. The selection has already
        // been stored by then, so returning without it would leave the card
        // showing the outgoing page while reporting the new key as its
        // selection — and `doLayout` re-resolves only when nothing is currently
        // visible, so no later pass would correct it. Resolving instead makes a
        // key whose slot has just failed behave like any other key no slot
        // answers to: reported, then the card's first live child.
        try {
            this.buildDeferredChild(key);
        } finally {
            this.syncVisible();

            // Same reason as `setVisibleComponentId`: `doLayout` only ever lays
            // out the visible child, so one first shown here has never been
            // sized.
            this.getContainer()?.scheduleLayout();
        }

        return this;
    }

    /**
     * Returns the child component carrying the visible key, else the one whose
     * id matches the visible component id, else the first child. Result is
     * cached; the cache is refreshed when `setVisibleComponentId` or
     * `setVisibleKey` is called, or when `doLayout` runs without a resolved
     * component.
     *
     * Never runs a deferred factory: the size getters reach this method, and
     * building a page to answer a measurement is what the manager deliberately
     * does not do. A key whose slot is still pending resolves to the first child
     * until a selection or a layout pass builds it.
     *
     * @returns The resolved visible component, or `null` if the container is empty.
     */
    getVisibleComponent(): Component | null {
        if (!this._currentVisible) {
            this.syncVisible();
        }

        return this._currentVisible;
    }

    /**
     * Reads a component's live native scroll offset (if it still has boxes)
     * then undisplays it — the capture must run first, since a `display: none`
     * element reports every scroll offset as zero. Mirrors `Tab.doLayout`'s
     * own capture-then-undisplay pairing.
     *
     * @remarks The capture guard is effective visibility, not just the
     * component's own displayed flag: an ancestor entirely outside this
     * Card's own management can be what actually leaves it with no boxes,
     * and a live read against a boxless element would clobber its cache.
     *
     * @param component - The child to drop out of the render tree.
     */
    private undisplayChild(component: Component): void {
        if (component.isEffectivelyVisible()) {
            component.captureSubtreeScroll();
        }

        component.setDisplayed(false);
    }

    /**
     * Resolves the visible component — the child carrying the visible key, else
     * the one whose id matches `visibleComponentId`, else the first child — and
     * transitions display: undisplays the previous one if different, displays
     * the new one. No-op when the resolved component is the same as the
     * currently-shown one.
     *
     * Never runs a deferred factory. The size getters reach this method through
     * `getVisibleComponent`, so building here would have a parent measuring its
     * child construct every registered page.
     */
    private syncVisible(): void {
        const container = this.getContainer();
        if (!container) {
            return;
        }

        const components = container.getComponents();
        let resolved: Component | null = null;

        if (this._visibleKey !== null) {
            resolved = this.liveChildForKey(this._visibleKey);

            // A key whose factory has not run yet is "not built", not "not
            // found" — the next `doLayout` builds it. Only a key that no slot
            // carries at all is worth reporting.
            if (!resolved && !this._deferred.has(this._visibleKey)) {
                console.warn("Visible key is specified but no matching component was found.");
            }
        } else if (this._visibleComponentId) {
            for (const c of components) {
                if (c.getId() == this._visibleComponentId) {
                    resolved = c;
                    break;
                }
            }

            if (!resolved) {
                console.warn("Visible component id is specified but no matching component was found.");
            }
        }

        if (!resolved && components.length > 0) {
            resolved = components[0];
        }

        if (resolved === this._currentVisible) {
            return;
        }

        if (this._currentVisible === null) {
            // First sync: components default to displayed, so any sibling
            // that isn't the resolved child needs to be dropped out of the
            // render tree explicitly. Without this, e.g. a Cell's editor
            // (sibling of its renderer) renders on top of the renderer
            // because its setDisplayed was never called.
            for (const c of components) {
                if (c !== resolved) {
                    this.undisplayChild(c);
                }
            }
        } else {
            this.undisplayChild(this._currentVisible);
        }

        if (resolved) {
            const wasUndisplayed = !resolved.isDisplayed();

            resolved.setDisplayed(true);

            // syncVisible runs outside of any layout pass (reachable from
            // setVisibleComponentId and setVisibleKey), so the restore itself is
            // deferred to the doLayout that follows — see `_pendingScrollRestore`'s own
            // doc. Overwriting a still-pending record from an earlier switch
            // this same tick is correct: every non-current child stays
            // undisplayed by construction, so `resolved` is the only target
            // whose offset still needs restoring.
            if (wasUndisplayed) {
                this._pendingScrollRestore = resolved;
            }
        }

        this._currentVisible = resolved;
    }

    /**
     * Drops the parked visible child once it has left the container, so a
     * removed child can never stay resolved and leave the card permanently
     * blank.
     *
     * The card re-resolves on the next read or layout pass rather than here:
     * losing the visible child promotes the first of those remaining — or
     * leaves the card with nothing visible when it was the only one. The
     * configured visible-component id is deliberately left alone, so re-adding
     * a child carrying that id resolves it again. Losing any other child
     * changes nothing and writes no display state.
     *
     * @param component - The child that has left the container.
     */
    componentRemoved(component: Component): void {
        // A test cannot distinguish this clear: `doLayout`'s
        // `restore === this._currentVisible` guard already discards a record
        // for a component that is no longer the visible one. It is about not
        // retaining a component the card has lost.
        if (this._pendingScrollRestore === component) {
            this._pendingScrollRestore = null;
        }

        if (this._currentVisible !== component) {
            return;
        }

        // Invalidate only — no display writes from here. `removeComponent` is
        // the primitive `moveComponent` and `replaceComponent` are built on, so
        // this fires mid-move, while the child list is one insert short of
        // settled; syncing now would promote a sibling the re-insert then
        // leaves displayed alongside it. `getVisibleComponent` and `doLayout`
        // both re-sync on a null resolution, and `removeComponent` schedules a
        // layout, so the transition lands once the mutation has completed.
        // Nulling is also what keeps the removed child from being undisplayed:
        // it is no longer in `getComponents()`, so `syncVisible`'s first-sync
        // loop cannot reach it.
        this._currentVisible = null;
    }

    /**
     * Computes the children's combined minSize along this manager's geometry:
     * the currently-visible child's minSize. Used by `doLayout` to inflate
     * the working size when the host has opted into `setOverflowing`.
     *
     * @returns The visible child's min-size; `{ width: 0, height: 0 }` when
     *   no child is visible.
     */
    protected computeTotalMinSize(): Size {
        if (!this._currentVisible) {
            return { width: 0, height: 0 };
        }

        const min = this._currentVisible.getMinSize();

        return min ?? { width: 0, height: 0 };
    }

    /**
     * Sizes the visible component to fill the container's inner bounds.
     *
     * Display transitions still belong to the two setters rather than to this
     * pass. What this pass does additionally is build and show a key whose slot
     * did not exist when it was selected — from `CardOptions.visibleKey`, or
     * from a `setVisibleKey` call that landed before the factory was registered.
     *
     * @throws Error - when that catch-up build's factory returns a promise,
     *   which a synchronous build has nothing to host. The throw leaves the pass
     *   aborted before `placeComponent`, so the visible child is not re-placed
     *   this pass and the parked scroll restore is not consumed — it survives
     *   for the next successful pass. The slot has already left the registry, so
     *   the next pass does not throw again.
     */
    doLayout(): void {
        const container = this.getContainer();
        if (!container) {
            return;
        }

        // A key selected before its slot existed is built here, on the first
        // pass that can both see the registration and place what it builds.
        // Building stays out of `syncVisible`, which the size getters reach, and
        // out of a pass on an unrendered container: `getElement()` is the
        // framework's own test for "too early to lay anything out", and this
        // pass returns on the matching `getInnerSize()` null further down
        // anyway.
        if (container.getElement() && this._visibleKey !== null && this.buildDeferredChild(this._visibleKey)) {
            this.syncVisible();
        }

        if (!this._currentVisible) {
            this.syncVisible();
        }

        if (!this._currentVisible) {
            return;
        }

        let containerSize = container.getInnerSize();
        if (!containerSize) {
            return;
        }

        const containerInsets = container.getContentInsets();

        // Universal scroll: see HBox.doLayout for the rationale. When the
        // host has marked the corresponding axis as overflowing, grow the
        // working size past the host's inner rect to the visible child's
        // minSize so the host's CSS `overflow: auto` produces a scrollbar.
        containerSize = this.inflateForOverflow(containerSize);

        this.placeComponent(
            this._currentVisible,
            containerInsets.getLeft(),
            containerInsets.getTop(),
            containerSize.width,
            containerSize.height,
            FillType.BOTH
        );

        // Consumes the restore `syncVisible` deferred here — safe now rather
        // than at the switch itself, because placeComponent -> commitBounds
        // just ran the visible child's own doLayout() synchronously, so its
        // subtree already carries its final geometry. The `=== _currentVisible`
        // guard discards a stale record from a component that was switched
        // away from again before this pass ever ran.
        const restore = this._pendingScrollRestore;

        this._pendingScrollRestore = null;

        if (restore === this._currentVisible) {
            restore.restoreSubtreeScroll();
        }
    }
}

const CardCallable = callable(Card);
type CardCallable = Card;
export {
    Card         as _Card,
    CardCallable as Card
};
