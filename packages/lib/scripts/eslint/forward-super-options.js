const OPTIONS_NAME_RE = /^(opts?|options)$/i;

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

export default {
    meta: {
        type: "problem",
        docs: {
            description:
                "Subclass constructors must forward their options parameter to super(). " +
                "Recognised parameter names: options, opts, Options.",
        },
        schema: [],
        messages: {
            dropped:
                "super() drops the constructor's \"{{name}}\" parameter — pass it explicitly: super({{name}}).",
        },
    },
    create(context) {
        return {
            'MethodDefinition[kind="constructor"]'(ctor) {
                const klass = ctor.parent.parent;

                if (!klass.superClass) {
                    return;
                }

                // `extends Object` has no options bag; super(options) there would
                // actually be incorrect (Object's constructor returns its argument,
                // breaking `this`). Skip this single well-known case.
                if (klass.superClass.type === "Identifier" && klass.superClass.name === "Object") {
                    return;
                }

                const param = ctor.value.params.find(
                    (p) => OPTIONS_NAME_RE.test(paramName(p) ?? ""),
                );

                if (!param) {
                    return;
                }

                const name = paramName(param);
                const body = ctor.value.body?.body ?? [];

                for (const stmt of body) {
                    if (stmt.type !== "ExpressionStatement") {
                        continue;
                    }

                    const call = stmt.expression;

                    if (call.type !== "CallExpression" || call.callee.type !== "Super") {
                        continue;
                    }

                    if (call.arguments.length === 0) {
                        context.report({ node: call, messageId: "dropped", data: { name } });
                    }

                    return;
                }
            },
        };
    },
};
