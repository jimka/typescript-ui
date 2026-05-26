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
            this.write(this._target.style, key, value);
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
        for (const key of Object.keys(this._dirty)) {
            this.write(this._target.style, key, this._dirty[key]);
        }
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
        for (const key of Object.keys(this._dirty)) {
            this.write(target.style, key, this._dirty[key]);
        }
        this._dirty = {};
    }

    private write(style: CSSStyleDeclaration, key: string, value: string | null): void {
        // CSS custom properties (`--foo`) cannot be set via the indexed
        // accessor — `(style as any)["--foo"] = v` just stores a JS own-property
        // on the wrapper and never reaches the underlying declaration. Custom
        // properties must go through `style.setProperty` / `removeProperty`.
        // Regular camelCase keys keep the existing assignment form which
        // matches the pre-existing `Object.assign(target.style, dirty)` shape.
        if (key.startsWith("--")) {
            if (value === null) {
                style.removeProperty(key);
            } else {
                style.setProperty(key, value);
            }
        } else {
            if (value === null) {
                (style as any)[key] = "";
            } else {
                (style as any)[key] = value;
            }
        }
    }
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
 * Returns the framework's shared `<style id="Base">` stylesheet, creating
 * the `<style>` element on first call.
 */
function _getMainSheet(): CSSStyleSheet {
    let head = document.getElementsByTagName("head")[0] as HTMLHeadElement;
    if (!head) {
        head = document.createElement("head");
        document.appendChild(head);
    }

    let style: HTMLStyleElement | null = null;
    const styles = head.getElementsByTagName("style");
    for (let idx = 0; idx < styles.length; idx += 1) {
        const s = styles[idx];
        if (s.id === "Base") {
            style = s;
        }
    }

    if (!style) {
        style = document.createElement("style");
        style.id = "Base";
        head.appendChild(style);
    }

    return style.sheet as CSSStyleSheet;
}

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
 * Returns a cached `CSSStyleRule` for the given selector, scanning the shared
 * stylesheet on cache miss and warming the cache when a match is found.
 * Returns `null` when no rule with the selector exists.
 */
function _getCSSRule(selector: string): CSSStyleRule | null {
    const cached = _ruleCache.get(selector);
    if (cached) {
        return cached;
    }

    const sheet = _getMainSheet();

    for (let idx = 0; idx < sheet.cssRules.length; idx += 1) {
        const rule = sheet.cssRules[idx] as CSSStyleRule;

        if (rule.selectorText === selector) {
            _ruleCache.set(selector, rule);
            return rule;
        }
    }

    return null;
}

/**
 * Inserts a new empty rule for the given selector into the shared stylesheet
 * and caches it. Always returns a non-null rule because the constructor calls
 * `_getCSSRule` first; this helper is only invoked on cache miss.
 */
function _createCSSRule(selector: string): CSSStyleRule {
    const sheet = _getMainSheet();
    const idx   = sheet.insertRule(selector + "{}", sheet.cssRules.length);
    const rule  = sheet.cssRules[idx] as CSSStyleRule;

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
        this._factory  = () => _getCSSRule(selector) ?? _createCSSRule(selector);

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
        const sheet = _getMainSheet();

        for (let idx = 0; idx < sheet.cssRules.length; idx += 1) {
            const rule = sheet.cssRules[idx] as CSSKeyframesRule;
            if (rule.type === CSSRule.KEYFRAMES_RULE && rule.name === name) {
                return;
            }
        }

        sheet.insertRule('@keyframes ' + name + ' { ' + body + ' }', sheet.cssRules.length);
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
