import { RuleTester } from "eslint";
import tsParser from "@typescript-eslint/parser";
import rule from "./require-subclass-defaults.js";

const tester = new RuleTester({ languageOptions: { parser: tsParser } });

tester.run("require-subclass-defaults", rule, {
    valid: [
        // The canonical forwarding form from ARCHITECTURE.md.
        "class C extends B { constructor(options?: X, subclassDefaults?: Partial<X>) {"
            + " super(options, { ..._defaultXOptions, ...(subclassDefaults ?? {}) }); } }",
        // The generic / overload variant used by ComboBox and TextInput.
        "class C<T extends X = X> extends B<T> {"
            + " constructor(options?: X, subclassDefaults?: Partial<X>);"
            + " constructor(options?: T, subclassDefaults?: Partial<T>) {"
            + " super(options, { ..._defaultXOptions, ...(subclassDefaults ?? {}) } as Partial<T>); } }",
        // Unconventional parameter name — forwarding a parameter is what counts.
        "class C extends B { constructor(options?: X, extra?: Partial<X>) { super(options, extra); } }",
        // One-argument super() is forward-super-options' concern.
        "class C extends B { constructor(options?: X) { super(options); } }",
        // No superclass — nothing to forward to.
        "class C { constructor(options?: X) { super(options, _defaultXOptions); } }",
        // A second argument that is not a defaults bag at all (table cells:
        // `super(tag, renderer)`, lists: `super(tag, style, options)`).
        'class C extends B { constructor(tag: string) { const r = new R(); super(tag, r); } }',
        // Parameterless fixed-configuration leaf (PickerInput) — out of scope by design.
        "class C extends B { constructor() { super(undefined, _defaultXOptions); } }",
        // The compliant spread form: a literal adding keys is fine as long as
        // the subclass bag still gets the last word.
        'class C extends B { constructor(options?: X, subclassDefaults?: Partial<X>) {'
            + ' super(options, { ..._defaultXOptions, tag: "span", ...(subclassDefaults ?? {}) }); } }',
        // An inline bag naming no class-defaults constant (DiagramView) carries
        // nothing to forward — out of scope.
        "class C extends B { constructor(options?: X) { super(options, { zIndex: 10050 }); } }",
        // A Button subclass forwarding in the THIRD argument — the defaults bag
        // is not always argument two.
        'class C extends B { constructor(text?: string, options?: X, subclassDefaults?: Partial<X>) {'
            + ' super(text, options, { ..._defaultCOptions, ...(subclassDefaults ?? {}) }); } }',
    ],

    invalid: [
        {
            // Defaults in the third argument, no subclassDefaults parameter —
            // Button subclasses (TabCloseButton, MenuBarButton) look like this.
            code:   'class C extends B { constructor(options?: X) { super(undefined, options, { ..._defaultCOptions, glyph: "x" }); } }',
            errors: [{ messageId: "deadEndSpread" }],
        },
        {
            // A parameter used as a property VALUE configures the bag; it does
            // not forward a subclass's defaults, so this is still a dead end.
            // SpinButton is the real instance of this shape.
            code:   'class C extends B { constructor(symbol: string, options?: X) { super(undefined, options, { ..._defaultCOptions, glyph: symbol === "a" ? "up" : "down" }); } }',
            errors: [{ messageId: "deadEndSpread" }],
        },

        {
            code: "class C extends B { constructor(options?: X) { super(options, _defaultXOptions); } }",
            errors: [{ messageId: "deadEnd" }],
        },
        {
            // A cast around the constant is still a dead end (AbstractPickerField).
            code: "class C<T extends X = X> extends B<T> { constructor(options?: T) {"
                + " super(options, _defaultXOptions as Partial<T>); } }",
            errors: [{ messageId: "deadEnd" }],
        },
        {
            // Positional leading parameters don't change the verdict (Image, CodeEditor).
            code: "class C extends B { constructor(src: string, options?: X) {"
                + " super(options, _defaultXOptions); } }",
            errors: [{ messageId: "deadEnd" }],
        },
        {
            // The constant spread into a literal that adds keys (Glyph) — the
            // spread leaves nowhere for a subclass bag to enter either.
            code: 'class C extends B { constructor(options?: X) {'
                + ' super(options, { ..._defaultXOptions, tag: "span" }); } }',
            errors: [{ messageId: "deadEndSpread" }],
        },
        {
            // Cast around the literal, and the constant spread second (ListItem).
            code: "class C<T extends X = X> extends B<T> { constructor(options?: T) {"
                + " super(options, { selectable: true, ..._defaultXOptions } as Partial<T>); } }",
            errors: [{ messageId: "deadEndSpread" }],
        },
        {
            // A literal key colliding with a parameter name is not a forward.
            code: 'class C extends B { constructor(text: string, options?: X) {'
                + ' super(options, { ..._defaultXOptions, text: "" }); } }',
            errors: [{ messageId: "deadEndSpread" }],
        },
    ],
});

console.log("require-subclass-defaults: all tests passed.");
