import { RuleTester } from "eslint";
import tsParser from "@typescript-eslint/parser";
import rule from "./forward-super-options.js";

const tester = new RuleTester({ languageOptions: { parser: tsParser } });

tester.run("forward-super-options", rule, {
    valid: [
        "class C extends B { constructor(options?: X) { super(options); } }",
        "class C extends B { constructor() { super(); } }",
        "class C { constructor(options?: X) { } }",
        'class C extends B { constructor(options?: X) { super({ ...options, tag: "div" }); } }',
        "class C extends Object { constructor(options?: X) { super(); } }",
        "class C extends CellRenderer { constructor(options?: X) { super(); } }",
    ],
    invalid: [
        {
            code: "class C extends B { constructor(options?: X) { super(); } }",
            errors: [{ messageId: "dropped" }],
        },
    ],
});

console.log("forward-super-options: all tests passed.");
