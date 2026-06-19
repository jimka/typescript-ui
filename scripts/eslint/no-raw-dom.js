// Type-aware lint rule: forbid raw DOM interaction outside the DOM seam.
//
// Every DOM read/write in the library must funnel through `DOM.sink` /
// `DOM.source` (core/DOM.ts). This rule flags any member access, call, or
// destructuring whose *receiver type* derives from a DOM-lib structural type
// (Element/Node/Document/Window/CSSStyleSheet/CSSStyleRule/…), plus the
// receiver-less DOM globals (`document`, `window`, `getComputedStyle`,
// `matchMedia`, `requestAnimationFrame`, `cancelAnimationFrame`). Type-awareness
// — not name matching — is what distinguishes `el.style` from a framework
// `node.children` or a `cssDecl` local, so the rule catches everything by
// construction without a hand-curated deny list.
//
// Exemptions: `core/DOM.ts` (the seam implementation itself). Suppression: an
// optional `no-raw-dom.baseline.json` (keys `"<relpath>:<line>:<messageId>"`)
// lets the existing violation set stay green while it is migrated to zero; set
// NO_RAW_DOM_IGNORE_BASELINE=1 to disable suppression (used to regenerate it).

import fs from "node:fs";
import path from "node:path";

const BASELINE_PATH = path.join(process.cwd(), "scripts/eslint/no-raw-dom.baseline.json");

// DOM-lib structural types whose receivers are seamed. A receiver is flagged
// when its type — or any type in its base-type chain — has one of these names
// AND is declared in a TypeScript `lib.dom.*` file (so a framework class named
// `Node` or a `Window` component is NOT confused with the DOM type).
// NOTE: `EventTarget` is deliberately NOT here. Many non-DOM Web Platform types
// extend it (Performance, Worker, MessagePort, AbortSignal, XMLHttpRequest), and
// flagging those over-scopes "DOM interaction". The real DOM event receivers —
// Element / Window / Document / MediaQueryList — are flagged on their own names,
// so `addEventListener` on them is still caught.
const DOM_TYPE_NAMES = new Set([
    "Node", "Element", "HTMLElement", "SVGElement", "MathMLElement",
    "Document", "DocumentFragment", "ShadowRoot", "Window",
    "DOMTokenList", "NamedNodeMap", "Attr",
    "HTMLCollection", "HTMLCollectionBase", "HTMLCollectionOf",
    "NodeList", "NodeListOf",
    "MediaQueryList",
    "StyleSheet", "CSSStyleSheet", "CSSRule", "CSSStyleRule", "CSSRuleList",
    "CSSStyleDeclaration",
]);

// CSSStyleDeclaration is intentionally NOT flagged as a receiver: `element.style`
// is already caught via its element receiver, and the only legitimate
// CSSStyleDeclaration locals after migration live inside the seam. Flagging the
// type too would contradict that. Kept out of the matched set below.
const FLAGGED_TYPE_NAMES = new Set(
    [...DOM_TYPE_NAMES].filter((n) => n !== "CSSStyleDeclaration")
);

// Receiver-less DOM globals flagged by identifier (with a lib-symbol confirmation).
const GLOBAL_IDENTIFIERS = new Set(["document", "window"]);
const GLOBAL_CALLS = new Set([
    "getComputedStyle", "matchMedia", "requestAnimationFrame", "cancelAnimationFrame",
]);

/** Whether a symbol is declared in a TypeScript `lib.dom.*` definition file. */
function isFromDomLib(symbol) {
    const decls = symbol && symbol.getDeclarations ? symbol.getDeclarations() : null;

    if (!decls) {
        return false;
    }

    return decls.some((d) => {
        const file = d.getSourceFile && d.getSourceFile();

        return !!file && file.fileName.includes("lib.dom");
    });
}

/** Whether a TS type — or any base type in its chain — is a flagged DOM-lib type. */
function typeIsDom(type, seen) {
    if (!type || seen.has(type)) {
        return false;
    }

    seen.add(type);

    if (type.isUnionOrIntersection && type.isUnionOrIntersection()) {
        return type.types.some((t) => typeIsDom(t, seen));
    }

    const symbol = type.aliasSymbol || (type.getSymbol && type.getSymbol());
    const name   = symbol && symbol.getName ? symbol.getName() : null;

    if (name && FLAGGED_TYPE_NAMES.has(name) && isFromDomLib(symbol)) {
        return true;
    }

    const bases = type.getBaseTypes ? type.getBaseTypes() : null;

    if (bases && bases.some((b) => typeIsDom(b, seen))) {
        return true;
    }

    return false;
}

/** Whether a node sits inside a `typeof …` operand (feature-detection, no DOM access). */
function isUnderTypeof(node) {
    let current = node;

    while (current && current.parent) {
        const parent = current.parent;

        if (parent.type === "UnaryExpression" && parent.operator === "typeof" && parent.argument === current) {
            return true;
        }

        if (parent.type === "MemberExpression" && parent.object === current) {
            current = parent;
            continue;
        }

        return false;
    }

    return false;
}

export default {
    meta: {
        type: "problem",
        docs: {
            description:
                "Forbid raw DOM interaction outside the DOM seam (core/DOM.ts). Every " +
                "DOM read/write must funnel through DOM.sink / DOM.source. Type-aware: " +
                "flags any receiver whose type derives from a DOM-lib structural type, " +
                "plus the receiver-less DOM globals.",
        },
        schema: [],
        messages: {
            event:        "Raw DOM event access — route through DOM.sink.addListener / removeListener / dispatchEvent or DOM.source.getActiveElement.",
            traversal:    "Raw DOM traversal — route through DOM.source (querySelector / closest / matches / contains / getParentElement / …).",
            computedStyle: "Raw computed-style read — route through DOM.source (getThemeVar / getBorderWidths / getComputedOverflow).",
            global:       "Raw DOM global — route through the DOM seam (DOM.source / DOM.sink); the global must not be touched directly.",
            style:        "Raw element.style access — route style writes through DOM.sink.setStyle / setRuleStyle.",
            dom:          "Raw DOM interaction — route through DOM.sink / DOM.source. Only core/DOM.ts may touch the DOM directly.",
        },
    },
    create(context) {
        const services = context.sourceCode.parserServices || context.parserServices;

        // Without type services the rule cannot run; stay silent rather than
        // produce false results.
        if (!services || !services.getTypeAtLocation || !services.program) {
            return {};
        }

        const checker = services.program.getTypeChecker();

        const ignoreBaseline = !!process.env.NO_RAW_DOM_IGNORE_BASELINE;
        let   baseline = new Set();

        if (!ignoreBaseline && fs.existsSync(BASELINE_PATH)) {
            try {
                baseline = new Set(JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")));
            } catch {
                baseline = new Set();
            }
        }

        const relPath = path.relative(process.cwd(), context.filename).split(path.sep).join("/");

        /** Reports unless the site is baselined. */
        function report(node, messageId) {
            const key = relPath + ":" + node.loc.start.line + ":" + messageId;

            if (baseline.has(key)) {
                return;
            }

            context.report({ node, messageId });
        }

        /** Picks the most specific message id for a flagged member access. */
        function classify(propertyName) {
            if (propertyName === "addEventListener" || propertyName === "removeEventListener" || propertyName === "dispatchEvent" || propertyName === "activeElement") {
                return "event";
            }

            if (propertyName === "querySelector" || propertyName === "querySelectorAll" || propertyName === "closest" || propertyName === "matches" || propertyName === "contains" || propertyName === "parentElement" || propertyName === "parentNode" || propertyName === "firstChild" || propertyName === "children") {
                return "traversal";
            }

            if (propertyName === "style") {
                return "style";
            }

            return "dom";
        }

        function typeOf(node) {
            try {
                return services.getTypeAtLocation(node);
            } catch {
                return null;
            }
        }

        return {
            MemberExpression(node) {
                if (isUnderTypeof(node)) {
                    return;
                }

                const objectType = typeOf(node.object);

                if (!typeIsDom(objectType, new Set())) {
                    return;
                }

                const propertyName = !node.computed && node.property.type === "Identifier" ? node.property.name : null;

                report(node.property, classify(propertyName));
            },

            VariableDeclarator(node) {
                if (!node.init || node.id.type !== "ObjectPattern") {
                    return;
                }

                const initType = typeOf(node.init);

                if (typeIsDom(initType, new Set())) {
                    report(node.id, "dom");
                }
            },

            CallExpression(node) {
                if (node.callee.type !== "Identifier" || !GLOBAL_CALLS.has(node.callee.name)) {
                    return;
                }

                if (isUnderTypeof(node.callee)) {
                    return;
                }

                const symbol = checker.getSymbolAtLocation(services.esTreeNodeToTSNodeMap.get(node.callee));

                if (symbol && isFromDomLib(symbol)) {
                    report(node.callee, "global");
                }
            },

            Identifier(node) {
                if (!GLOBAL_IDENTIFIERS.has(node.name)) {
                    return;
                }

                const parent = node.parent;

                // Skip when handled elsewhere: member-object (the MemberExpression
                // visitor reports), the typeof operand, property keys, declarations.
                if (parent.type === "MemberExpression" && parent.object === node) {
                    return;
                }

                if (isUnderTypeof(node)) {
                    return;
                }

                if (parent.type === "Property" && parent.key === node && !parent.computed) {
                    return;
                }

                if ((parent.type === "VariableDeclarator" && parent.id === node) || parent.type === "FunctionDeclaration" || parent.type === "Parameter") {
                    return;
                }

                const type = typeOf(node);

                if (typeIsDom(type, new Set())) {
                    report(node, "global");
                }
            },
        };
    },
};
