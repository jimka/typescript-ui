// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Shared base for a deferred-write style buffer. Either flushes into a
 * [`CSSStyleRule`](https://developer.mozilla.org/en-US/docs/Web/API/CSSStyleRule)
 * (see {@link StyleRule}) or an
 * [`HTMLElement`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement)
 * (see {@link InlineStyle}).
 *
 * @remarks Before the target exists, writes accumulate in `dirty`. Once
 * `materialize` runs, queued entries flush onto the target's
 * `style` declaration and subsequent {@link StyleTarget.set} calls write
 * through directly. {@link StyleTarget.queue} is a write-to-dirty-only path
 * used by callers that need to batch their own commits (see Component's
 * `autoCommitStyle` switch).
 *
 * @category Core
 */
abstract class StyleTarget<T extends { style: CSSStyleDeclaration }> {
    protected target: T | null = null;
    protected dirty:  Record<string, string | null> = {};

    /**
     * Writes a single style property. Flushes immediately when the target is
     * attached; otherwise queues the entry into the dirty bag.
     *
     * @param key - The CSS property name (camelCase).
     * @param value - The value to set, or null to remove the property.
     */
    set(key: string, value: string | null): void {
        if (this.target) {
            this.write(this.target.style, key, value);
        } else {
            this.dirty[key] = value;
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
        this.dirty[key] = value;
    }

    /**
     * Bulk variant of {@link StyleTarget.queue}.
     *
     * @param values - Camel-cased property keys mapped to string values (or null to clear).
     */
    queueMany(values: Record<string, string | null>): void {
        Object.assign(this.dirty, values);
    }

    /**
     * Drains the dirty bag onto the live target. No-op when the target is
     * not yet attached — the dirty entries stay queued for the next flush
     * after `materialize`.
     */
    flush(): void {
        if (!this.target) return;
        for (const key of Object.keys(this.dirty)) {
            this.write(this.target.style, key, this.dirty[key]);
        }
        this.dirty = {};
    }

    /**
     * Returns whether the underlying target has been materialised.
     */
    isMaterialized(): boolean {
        return this.target !== null;
    }

    protected materialize(target: T): void {
        this.target = target;
        for (const key of Object.keys(this.dirty)) {
            this.write(target.style, key, this.dirty[key]);
        }
        this.dirty = {};
    }

    private write(style: CSSStyleDeclaration, key: string, value: string | null): void {
        // Properties are stored camelCase. Assignment form (`style.X = value`)
        // preserves the pre-existing Component behaviour which used
        // `Object.assign(target.style, dirty)` on flush and direct
        // `style.X = ...` writes elsewhere.
        if (value === null) {
            (style as any)[key] = "";
        } else {
            (style as any)[key] = value;
        }
    }
}

/**
 * Deferred-write buffer that materialises into a per-component
 * [`CSSStyleRule`](https://developer.mozilla.org/en-US/docs/Web/API/CSSStyleRule)
 * the first time {@link StyleRule.ensure} is called.
 *
 * @remarks The rule factory is invoked lazily so detached construction
 * incurs no stylesheet insertion. Once materialised, the rule object is
 * stable for the lifetime of this `StyleRule`.
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
    private factory: () => CSSStyleRule;

    constructor(factory: () => CSSStyleRule) {
        super();
        this.factory = factory;
    }

    /**
     * Materialises the underlying `CSSStyleRule` on first access and returns
     * it. Pending dirty entries are flushed in the same call.
     */
    ensure(): CSSStyleRule {
        if (!this.target) {
            this.materialize(this.factory());
        }
        return this.target!;
    }
}

/**
 * Deferred-write buffer for inline `element.style` writes. Stays detached
 * until {@link InlineStyle.attach} runs — typically from `Component.init`
 * once the root element exists.
 *
 * @category Core
 */
class InlineStyle extends StyleTarget<HTMLElement> {
    /**
     * Binds this buffer to a live element and flushes any queued writes.
     */
    attach(element: HTMLElement): void {
        this.materialize(element);
    }
}

export { StyleTarget, StyleRule, InlineStyle };
