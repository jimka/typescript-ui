
export namespace CSS {
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
        let sheet = getMainStyle();

        for (let idx in sheet.cssRules) {
            let rule = sheet.cssRules[idx] as CSSStyleRule;

            if (rule.selectorText === name) {
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
        let rule = getClassRule(name);
        if (rule) {
            return null;
        }

        let sheet = getMainStyle();
        sheet.insertRule(name + "{}");

        return getRule(name);
    }

    export function createClassRule(name: string): CSSStyleRule | null {
        return createRule("." + name);
    }

    export function createComponentRule(name: string): CSSStyleRule | null {
        return createRule("#" + name);
    }
}