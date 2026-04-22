// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0


export namespace CSS {
    const ruleCache = new Map<string, CSSStyleRule>();

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

    function getMainStyle(): CSSStyleSheet {
        return getStyle("Base");
    }

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

    export function getClassRule(name: string): CSSStyleRule | null {
        return getRule("." + name);
    }

    export function getComponentRule(name: string): CSSStyleRule | null {
        return getRule("#" + name);
    }

    export function createRule(name: string): CSSStyleRule | null {
        if (ruleCache.has(name)) {
            return null;
        }

        let sheet = getMainStyle();
        sheet.insertRule(name + "{}");

        const rule = sheet.cssRules[0] as CSSStyleRule;
        ruleCache.set(name, rule);
        return rule;
    }

    export function createClassRule(name: string): CSSStyleRule | null {
        return createRule("." + name);
    }

    export function createComponentRule(name: string): CSSStyleRule | null {
        return createRule("#" + name);
    }
}