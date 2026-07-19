export default {
    meta: {
        type: "problem",
        docs: {
            description:
                "Component code must not write inline styles via element.style — " +
                "use the Component setters (setCursor, setBackgroundColor, " +
                "setElementStyle, …) so cached state, applyStyle replay, and the " +
                "options bag stay in sync.",
        },
        schema: [],
        messages: {
            direct:
                "Direct `.style` access on an element — use a Component setter " +
                "(setCursor / setBackgroundColor / setElementStyle / …) instead. " +
                "If this site truly needs raw DOM access, silence with " +
                "`// eslint-disable-next-line local/no-element-style` and a reason.",
        },
    },
    create(context) {
        return {
            MemberExpression(node) {
                if (node.computed) {
                    return;
                }

                if (node.property.type !== "Identifier" || node.property.name !== "style") {
                    return;
                }

                // We only care about reads that chain into a write —
                // `el.style.setProperty(...)`, `el.style.cursor = "..."`, or
                // `el.style.removeProperty(...)`. A bare `obj.style` read on a
                // plain data object is almost always a false positive (options
                // bags, theme records), so skip it.
                const parent = node.parent;

                if (!parent || parent.type !== "MemberExpression" || parent.object !== node) {
                    return;
                }

                context.report({ node, messageId: "direct" });
            },
        };
    },
};
