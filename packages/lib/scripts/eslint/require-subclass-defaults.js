// ARCHITECTURE.md "Constructors forward `subclassDefaults`": a constructor
// that hands its own `_default<Name>Options` constant straight to super() is a
// dead end — nothing below it in the hierarchy can seed a class default, and
// the only remaining route is editing the parent's own constant.
//
// Scope is deliberately narrow, because a second super() argument is only
// sometimes a defaults bag: `super("td", renderer)` and `super("ul", style,
// options)` are unrelated signatures, and an inline bag (`super(options, {
// zIndex: 10050, … })`) carries no class-defaults constant to forward. The
// rule therefore fires only on the unambiguous shape — the second argument
// *is* a `_default<Name>Options` constant, optionally cast. Known false
// negative, in exchange: a constant spread into a literal that adds keys
// (`super(options, { ..._defaultGlyphOptions, tag: "span" })`) is an equal
// dead end but is not reported. Widening means accepting a spread of the
// constant here as well.
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
                    if (call.arguments.length >= 2) {
                        const defaults = unwrap(call.arguments[1]);
                        const name     = defaults?.type === "Identifier" ? defaults.name : null;

                        // A constructor parameter reaching super() is already the
                        // forwarding shape, whatever it is named; only a module-level
                        // constant is a dead end.
                        const forwarded = params.some((p) => paramName(p) === name);

                        if (name && CLASS_DEFAULTS_RE.test(name) && !forwarded) {
                            context.report({
                                node:      call,
                                messageId: "deadEnd",
                                data:      {
                                    name,
                                    spread: `{ ...${name}, ...(subclassDefaults ?? {}) }`,
                                },
                            });
                        }
                    }

                    return;
                }
            },
        };
    },
};
