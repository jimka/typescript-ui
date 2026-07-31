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
        // Known false negative, asserted so the narrowing stays deliberate: the
        // constant is spread into a literal that adds keys, which is an equal
        // dead end but outside this rule's unambiguous shape.
        'class C extends B { constructor(options?: X) {'
            + ' super(options, { ..._defaultXOptions, tag: "span" }); } }',
    ],
    invalid: [
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
    ],
});

console.log("require-subclass-defaults: all tests passed.");
