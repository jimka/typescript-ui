// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";

/**
 * Shared base for a deferred-write style buffer. Either flushes into a
 * [`CSSStyleRule`](https://developer.mozilla.org/en-US/docs/Web/API/CSSStyleRule)
 * (see {@link StyleRule}) or an element behind a {@link Handle}
 * (see {@link InlineStyle}).
 *
 * @remarks Before the target exists, writes accumulate in `dirty`. Once
 * `materialize` runs, queued entries flush onto the target's
 * `style` declaration and subsequent {@link StyleTarget.set} calls write
 * through directly. {@link StyleTarget.queue} is a write-to-dirty-only path
 * used by callers that need to batch their own commits (see Component's
 * `autoCommitStyle` switch).
 *
 * @typeParam T - The materialised target kind: a `CSSStyleRule` for
 *   {@link StyleRule}, or a {@link Handle} for {@link InlineStyle}.
 *
 * @category Core
 */
abstract class StyleTarget<T> {
    protected _target: T | null = null;
    protected _dirty:  Record<string, string | null> = {};

    /**
     * Writes a single style property. Flushes immediately when the target is
     * attached; otherwise queues the entry into the dirty bag.
     *
     * @param key - The CSS property name (camelCase).
     * @param value - The value to set, or null to remove the property.
     */
    set(key: string, value: string | null): void {
        if (this._target) {
            this.writeStyle(key, value);
        } else {
            this._dirty[key] = value;
        }
    }

    /**
     * Bulk variant of {@link StyleTarget.set}.
     *
     * @param values - Camel-cased property keys mapped to string values (or null to clear).
     */
    setMany(values: Record<string, string | null>): void {
        for (const key of Object.keys(values)) this.set(key, values[key]);
    }

    /**
     * Writes a single style property into the dirty bag without flushing,
     * even when the target is already attached. Callers that own their own
     * batching gate (e.g. `autoCommitStyle = false`) use this to accumulate
     * writes that {@link StyleTarget.flush} will drain later.
     *
     * @param key - The CSS property name (camelCase).
     * @param value - The value to set, or null to remove the property.
     */
    queue(key: string, value: string | null): void {
        this._dirty[key] = value;
    }

    /**
     * Bulk variant of {@link StyleTarget.queue}.
     *
     * @param values - Camel-cased property keys mapped to string values (or null to clear).
     */
    queueMany(values: Record<string, string | null>): void {
        Object.assign(this._dirty, values);
    }

    /**
     * Drains the dirty bag onto the live target. No-op when the target is
     * not yet attached — the dirty entries stay queued for the next flush
     * after `materialize`.
     */
    flush(): void {
        if (!this._target) return;
        this.flushDirty(this._dirty);
        this._dirty = {};
    }

    /**
     * Returns whether the underlying target has been materialised.
     */
    isMaterialized(): boolean {
        return this._target !== null;
    }

    protected materialize(target: T): void {
        this._target = target;
        this.flushDirty(this._dirty);
        this._dirty = {};
    }

    /**
     * Terminal write for a single property onto the now-attached target. Each
     * subclass resolves its own target kind through the seam — an element via
     * {@link DOMSink.apply}, a rule via {@link DOMSink.setRuleStyle} — so the
     * base never touches a `.style` declaration directly.
     *
     * @param key - The CSS property name (camelCase, or `--custom-property`).
     * @param value - The value to set, or null to remove the property.
     */
    protected abstract writeStyle(key: string, value: string | null): void;

    /**
     * Drains a bag of accumulated writes onto the now-attached target. The
     * inline-style subclass batches the whole bag into one seam write; the rule
     * subclass writes each property individually.
     *
     * @param dirty - The accumulated property writes to flush.
     */
    protected abstract flushDirty(dirty: Record<string, string | null>): void;
}

/**
 * Scope discriminator for the {@link StyleRule} constructor.
 *
 * - `class` — leading `.` is prepended; `name: "Foo"` selects `.Foo`.
 * - `component` — leading `#` is prepended; `name: "id"` selects `#id`.
 * - `selector` — verbatim selector text; the escape hatch for pseudo-classes
 *   (`":hover"`), compound selectors (`".A.B"`), pseudo-elements
 *   (`".X::-webkit-scrollbar"`), and any other shape outside the first two.
 *
 * @category Core
 */
export type StyleRuleScope =
    | { scope: "class";     name: string }
    | { scope: "component"; name: string }
    | { scope: "selector";  name: string };

/**
 * Construction config for a {@link StyleRule}. Combines a {@link StyleRuleScope}
 * (selector shape) with optional initial CSS body and an optional defer-flush
 * flag.
 *
 * - `styles` — initial style body, applied via `setMany` from the constructor.
 *   Omit for imperative builders that write later via `set`.
 * - `materialize` — defaults to `true`. Set to `false` to skip the auto
 *   `ensure()` call. Used by `Component`'s internal `_styleRule` and
 *   `createStyleRule` allocations to keep construction JS-only and let the
 *   render pipeline materialise the stylesheet entry on first `applyStyle`.
 *
 * @category Core
 */
export type StyleRuleSpec = StyleRuleScope & {
    styles?:      Record<string, string | null>;
    materialize?: boolean;
};

// Module-level cache of materialised `CSSStyleRule`s keyed by selector text.
// Two `StyleRule` instances constructed with the same scope+name share the
// underlying `CSSStyleRule`. Survives across hot reloads because the module
// reference is the single source of truth.
const _ruleCache: Map<string, CSSStyleRule> = new Map();

/**
 * Translates a {@link StyleRuleScope} into its CSS selector string.
 */
function _selectorOf(spec: StyleRuleScope): string {
    switch (spec.scope) {
        case "class":     return "." + spec.name;
        case "component": return "#" + spec.name;
        case "selector":  return spec.name;
    }
}

/**
 * Returns the shared-stylesheet `CSSStyleRule` for the selector, warming the
 * module cache. The `cssRules` scan and `insertRule` live behind the seam
 * ({@link DOMSink.ensureStyleRule}); the cache here spares repeat lookups when
 * two `StyleRule` instances share a selector.
 */
function _ruleFor(selector: string): CSSStyleRule {
    const cached = _ruleCache.get(selector);

    if (cached) {
        return cached;
    }

    const rule = DOM.sink.ensureStyleRule(selector);
    _ruleCache.set(selector, rule);

    return rule;
}

/**
 * Deferred-write buffer that materialises into a
 * [`CSSStyleRule`](https://developer.mozilla.org/en-US/docs/Web/API/CSSStyleRule)
 * on the framework's shared `<style id="Base">` stylesheet the first time
 * {@link StyleRule.ensure} is called.
 *
 * @remarks Construction is cheap — no stylesheet insertion happens until
 * `ensure()` runs, so detached construction stays JS-only. Once materialised,
 * the rule object is stable for the lifetime of this `StyleRule`. Two
 * `StyleRule` instances constructed with the same scope+name share the
 * underlying `CSSStyleRule` via the module-level cache.
 *
 * Inherited {@link StyleTarget.set} queues writes into a dirty bag while the
 * target is null and writes through once `ensure()` has materialised the rule.
 * Owners that need the rule on the stylesheet at first render (rather than at
 * first write) register the rule via Component's `registerStyleRule`, which
 * calls `ensure()` from `applyStyle` and flushes the dirty bag onto the live
 * `CSSStyleRule`.
 *
 * @category Core
 */
class StyleRule extends StyleTarget<CSSStyleRule> {
    private _factory: () => CSSStyleRule;

    /**
     * Constructs a `StyleRule` for the given scoped selector and, optionally,
     * an initial style body.
     *
     * @param spec - The {@link StyleRuleSpec} describing the rule's selector,
     *   optional initial styles, and optional `materialize` flag.
     *
     * @remarks When `spec.styles` is present, the styles are queued via
     * `setMany` before any materialisation runs (the target is still null at
     * that point, so the writes land in `_dirty`). When `spec.materialize`
     * is not explicitly `false`, the constructor calls `ensure()` so the
     * underlying `CSSStyleRule` is created and the queued styles flush onto
     * it in one step. Internal callers that need to keep construction
     * JS-only — e.g. `Component`'s per-id `_styleRule` and `createStyleRule`
     * allocations — pass `materialize: false` and rely on the render
     * pipeline to call `ensure()` later.
     */
    constructor(spec: StyleRuleSpec) {
        super();
        const selector = _selectorOf(spec);
        this._factory  = () => _ruleFor(selector);

        if (spec.styles) {
            this.setMany(spec.styles);
        }

        if (spec.materialize !== false) {
            this.ensure();
        }
    }

    /**
     * Materialises the underlying `CSSStyleRule` on first access and returns
     * it. Pending dirty entries are flushed in the same call.
     */
    ensure(): CSSStyleRule {
        if (!this._target) {
            this.materialize(this._factory());
        }
        return this._target!;
    }

    /** @inheritDoc */
    protected writeStyle(key: string, value: string | null): void {
        DOM.sink.setRuleStyle(this._target!, key, value);
    }

    /** @inheritDoc */
    protected flushDirty(dirty: Record<string, string | null>): void {
        for (const key of Object.keys(dirty)) {
            DOM.sink.setRuleStyle(this._target!, key, dirty[key]);
        }
    }

    /**
     * Inserts a `@keyframes` block into the framework's shared `<style id="Base">`
     * stylesheet if no rule with the given name already exists.
     *
     * @param name - The keyframe animation name (no `@keyframes` prefix).
     * @param body - The keyframe body, e.g. `"from { transform: rotate(0deg) } to { transform: rotate(360deg) }"`.
     *
     * @remarks Idempotent: safe to call from module-level initialisers across
     * hot reloads. `@keyframes` rules are not selector-keyed `CSSStyleRule`s
     * and so do not flow through the `StyleRule` instance cache.
     */
    static ensureKeyframes(name: string, body: string): void {
        DOM.sink.ensureKeyframes(name, body);
    }
}

/**
 * Deferred-write buffer for inline `element.style` writes. Stays detached
 * until {@link InlineStyle.attach} runs — typically from `Component.init`
 * once the root element exists.
 *
 * @category Core
 */
class InlineStyle extends StyleTarget<Handle> {
    /**
     * Binds this buffer to a live element handle and flushes any queued writes.
     *
     * @param handle - The element handle to attach to.
     */
    attach(handle: Handle): void {
        this.materialize(handle);
    }

    /** @inheritDoc */
    protected writeStyle(key: string, value: string | null): void {
        DOM.sink.apply(this._target!, { style: { [key]: value } });
    }

    /**
     * Flushes the whole dirty bag as one batched {@link DOMSink.apply} — the
     * per-frame layout-commit hot path, where one handle resolve covers every
     * queued style write.
     *
     * @param dirty - The accumulated style writes to flush.
     */
    protected flushDirty(dirty: Record<string, string | null>): void {
        DOM.sink.apply(this._target!, { style: dirty });
    }
}

export { StyleTarget, StyleRule, InlineStyle };
