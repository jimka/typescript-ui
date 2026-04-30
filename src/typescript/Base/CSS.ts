// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0


/**
 * Utilities for programmatically creating and querying CSS rules in the document's
 * dynamically managed "Base" stylesheet.
 */
export namespace CSS {
    const ruleCache = new Map<string, CSSStyleRule>();

    /**
     * Returns the CSSStyleSheet for the named `<style>` element, creating it if absent.
     *
     * @param name - The `id` attribute to look for (or assign to) the `<style>` element.
     *
     * @returns The `CSSStyleSheet` associated with the matching style element.
     */
    function getStyle(name: String): CSSStyleSheet {
        let head = document.getElementsByTagName("head")[0] as HTMLHeadElement;
        if (!head) {
            head = new HTMLHeadElement();

            document.appendChild(head);
        }

        let style: HTMLStyleElement | null = null;
        let styles = head.getElementsByTagName("style");
        for (let idx in styles) {
            let s = styles[idx];
            if(s.id === name) {
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
     * Returns the shared "Base" stylesheet.
     *
     * @returns The `CSSStyleSheet` associated with the `<style id="Base">` element.
     */
    function getMainStyle(): CSSStyleSheet {
        return getStyle("Base");
    }

    /**
     * Looks up a CSS rule by its exact selector string, returning null if not found.
     *
     * @param name - The exact selector text to search for (e.g. `".my-class"` or `"#my-id"`).
     *
     * @returns The matching `CSSStyleRule`, or `null` if no rule with that selector exists.
     *
     * @remarks Results are cached in `ruleCache` after the first lookup to avoid repeated
     * iteration over the stylesheet's rule list.
     */
    export function getRule(name: string): CSSStyleRule | null {
        const cached = ruleCache.get(name);
        if (cached) {
            return cached;
        }

        let sheet = getMainStyle();

        for (let idx in sheet.cssRules) {
            let rule = sheet.cssRules[idx] as CSSStyleRule;

            if (rule.selectorText === name) {
                ruleCache.set(name, rule);
                return rule;
            }
        }

        return null;
    }

    /**
     * Returns the CSS rule for a class selector (`.name`).
     *
     * @param name - The class name without the leading dot.
     *
     * @returns The matching `CSSStyleRule`, or `null` if not found.
     */
    export function getClassRule(name: string): CSSStyleRule | null {
        return getRule("." + name);
    }

    /**
     * Returns the CSS rule for an ID selector (`#name`).
     *
     * @param name - The id value without the leading `#`.
     *
     * @returns The matching `CSSStyleRule`, or `null` if not found.
     */
    export function getComponentRule(name: string): CSSStyleRule | null {
        return getRule("#" + name);
    }

    /**
     * Inserts a new empty CSS rule with the given selector; returns null if a rule already exists.
     *
     * @param name - The full selector string (e.g. `".my-class"` or `"#my-id"`).
     *
     * @returns The newly created `CSSStyleRule`, or `null` if the rule was already cached.
     *
     * @remarks The rule is inserted at position 0 of the stylesheet and added to `ruleCache`.
     */
    export function createRule(name: string): CSSStyleRule | null {
        if (ruleCache.has(name)) {
            return null;
        }

        let sheet = getMainStyle();

        const idx = sheet.insertRule(name + "{}", sheet.cssRules.length);
        const rule = sheet.cssRules[idx] as CSSStyleRule;

        ruleCache.set(name, rule);

        return rule;
    }

    /**
     * Creates a new CSS rule for a class selector (`.name`).
     *
     * @param name - The class name without the leading dot.
     *
     * @returns The newly created `CSSStyleRule`, or `null` if the rule already exists.
     */
    export function createClassRule(name: string): CSSStyleRule | null {
        return createRule("." + name);
    }

    /**
     * Creates a new CSS rule for an ID selector (`#name`), used per-component.
     *
     * @param name - The id value without the leading `#`.
     *
     * @returns The newly created `CSSStyleRule`, or `null` if the rule already exists.
     */
    export function createComponentRule(name: string): CSSStyleRule | null {
        return createRule("#" + name);
    }

    /**
     * Writes a set of CSS custom properties onto the `:root` element.
     *
     * @param vars - A record mapping CSS custom property names (e.g. `"--my-color"`) to their values.
     */
    export function setRootVariables(vars: Record<string, string>) {
        const root = document.documentElement;
        for (const [name, value] of Object.entries(vars)) {
            root.style.setProperty(name, value);
        }
    }
}
