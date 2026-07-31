// ARCHITECTURE.md "Constructors forward `subclassDefaults`": a constructor
// that hands its own `_default<Name>Options` constant straight to super() is a
// dead end — nothing below it in the hierarchy can seed a class default, and
// the only remaining route is editing the parent's own constant.
//
// Scope is deliberately narrow, because a second super() argument is only
// sometimes a defaults bag: `super("td", renderer)` and `super("ul", style,
// options)` are unrelated signatures, and an inline bag (`super(options, {
// zIndex: 10050, … })`) carries no class-defaults constant to forward. The
// rule therefore fires on the two shapes that unambiguously name one: the
// second argument *is* a `_default<Name>Options` constant, optionally cast,
// or it is a literal spreading that constant to add keys (`super(options, {
// ..._defaultGlyphOptions, tag: "span" })`) — an equal dead end, since the
// spread still leaves nowhere for a subclass bag to enter. Either way a
// second argument that references a constructor parameter is the compliant
// forwarding shape and is never reported.
const CLASS_DEFAULTS_RE = /^_default[A-Za-z0-9_]*Options$/;

function paramName(p) {
    if (!p) {
        return null;
    }

    if (p.type === "Identifier") {
        return p.name;
    }

    if (p.type === "AssignmentPattern" && p.left.type === "Identifier") {
        return p.left.name;
    }

    if (p.type === "TSParameterProperty" && p.parameter.type === "Identifier") {
        return p.parameter.name;
    }

    return null;
}

/** Strips casts and parentheses, so `_defaultXOptions as Partial<T>` reads as the identifier. */
function unwrap(node) {
    while (
        node
        && (node.type === "TSAsExpression"
            || node.type === "TSSatisfiesExpression"
            || node.type === "TSNonNullExpression"
            || node.type === "TSTypeAssertion")
    ) {
        node = node.expression;
    }

    return node;
}

/**
 * The `_default<Name>Options` constant a second super() argument names, either
 * directly or through a spread inside a literal, plus which of the two shapes
 * it was. Null when the argument names no such constant.
 */
function classDefaults(node) {
    const arg = unwrap(node);

    if (arg?.type === "Identifier" && CLASS_DEFAULTS_RE.test(arg.name)) {
        return { name: arg.name, spread: false };
    }

    if (arg?.type === "ObjectExpression") {
        for (const prop of arg.properties) {
            const inner = prop.type === "SpreadElement" ? unwrap(prop.argument) : null;

            if (inner?.type === "Identifier" && CLASS_DEFAULTS_RE.test(inner.name)) {
                return { name: inner.name, spread: true };
            }
        }
    }

    return null;
}

/**
 * True when any identifier inside `node` names one of the constructor's
 * parameters — the signal that the argument already forwards something the
 * caller supplied, whatever that parameter is named. Non-computed property
 * keys are skipped so a literal key colliding with a parameter name (`{ text:
 * "x" }` in a constructor taking `text`) does not read as a forward.
 */
/**
 * Whether `node` actually *forwards* a constructor parameter as defaults —
 * either the parameter passed straight through, or spread into the bag
 * (`{ ...defaults, ...(subclassDefaults ?? {}) }`). Deliberately narrower than
 * {@link referencesParam}: a parameter used as a property *value*
 * (`{ ...defaults, glyph: symbol === "\u25b2" ? "up" : "down" }`) configures the
 * bag, it does not forward a subclass's defaults, and treating it as compliant
 * would hide a real dead end.
 */
function forwardsParam(node, paramNames) {
    if (!node || typeof node.type !== "string") {
        return false;
    }

    if (node.type === "Identifier") {
        return paramNames.has(node.name);
    }

    if (node.type === "ObjectExpression") {
        return node.properties.some(
            (prop) => prop.type === "SpreadElement"
                && referencesParam(unwrap(prop.argument), paramNames),
        );
    }

    return false;
}

function referencesParam(node, paramNames) {
    if (!node || typeof node.type !== "string") {
        return false;
    }

    if (node.type === "Identifier") {
        return paramNames.has(node.name);
    }

    if (node.type === "Property" && !node.computed) {
        return referencesParam(node.value, paramNames);
    }

    for (const key of Object.keys(node)) {
        if (key === "parent") {
            continue;
        }

        const child = node[key];
        const hit   = Array.isArray(child)
            ? child.some((c) => referencesParam(c, paramNames))
            : referencesParam(child, paramNames);

        if (hit) {
            return true;
        }
    }

    return false;
}

export default {
    meta: {
        type: "problem",
        docs: {
            description:
                "A constructor passing its class-defaults constant to super() must instead " +
                "accept a subclassDefaults parameter and spread it over that constant, so a " +
                "subclass can seed a default without editing its parent.",
        },
        schema: [],
        messages: {
            deadEnd:
                "super() passes the \"{{name}}\" constant straight through, so no subclass " +
                "can seed a default — accept a \"subclassDefaults\" parameter and spread it: " +
                "super(options, {{spread}}).",
            deadEndSpread:
                "super() spreads the \"{{name}}\" constant into a fixed literal, so no " +
                "subclass can seed a default — accept a \"subclassDefaults\" parameter and " +
                "spread it last, after the literal's own keys: \"...(subclassDefaults ?? {})\".",
        },
    },
    create(context) {
        return {
            'MethodDefinition[kind="constructor"]'(ctor) {
                const klass = ctor.parent.parent;

                if (!klass.superClass) {
                    return;
                }

                const params = ctor.value.params;

                // A constructor taking nothing (PickerInput) is a fixed-configuration
                // leaf: it has no options bag to widen, so forwarding would mean
                // inventing a public parameter rather than plumbing one that already
                // exists. Out of scope — deliberately not reported.
                if (params.length === 0) {
                    return;
                }

                for (const stmt of ctor.value.body?.body ?? []) {
                    if (stmt.type !== "ExpressionStatement") {
                        continue;
                    }

                    const call = stmt.expression;

                    if (call.type !== "CallExpression" || call.callee.type !== "Super") {
                        continue;
                    }

                    // A one-argument super(options) forwards no defaults at all —
                    // that is `forward-super-options`' concern, not this rule's.
                    //
                    // The defaults bag is not always argument two: a Button
                    // subclass calls super(text, options, defaults), so every
                    // argument past the first is searched for the constant
                    // rather than only position one. The `_default<Name>Options`
                    // naming convention is specific enough to keep that from
                    // matching unrelated arguments.
                    const paramNames = new Set(
                        params.map(paramName).filter((n) => n !== null),
                    );

                    for (let i = 1; i < call.arguments.length; i++) {
                        const arg      = call.arguments[i];
                        const defaults = classDefaults(arg);

                        if (!defaults) {
                            continue;
                        }

                        // A constructor parameter reaching super() is already the
                        // forwarding shape, whatever it is named; only a bag built
                        // purely from module-level constants is a dead end.
                        if (forwardsParam(unwrap(arg), paramNames)) {
                            break;
                        }

                        context.report({
                            node:      call,
                            messageId: defaults.spread ? "deadEndSpread" : "deadEnd",
                            data:      {
                                name:   defaults.name,
                                spread: `{ ...${defaults.name}, ...(subclassDefaults ?? {}) }`,
                            },
                        });
                        break;
                    }

                    return;
                }
            },
        };
    },
};
