import { RuleTester } from "eslint";
import tsParser from "@typescript-eslint/parser";
import rule from "./no-element-style.js";

const tester = new RuleTester({ languageOptions: { parser: tsParser } });

tester.run("no-element-style", rule, {
    valid: [
        // Component setter — the prescribed path.
        'this.setCursor("default");',
        'this.setBackgroundColor("transparent");',
        // Bare read of a `.style` property on a data object — false-positive
        // territory we deliberately skip (no chained member access).
        "const s = config.style;",
        // Computed access — different shape; not the target of this rule.
        'el["style"].cursor = "default";',
    ],
    invalid: [
        {
            code: 'el.style.setProperty("cursor", "default");',
            errors: [{ messageId: "direct" }],
        },
        {
            code: 'el.style.removeProperty("cursor");',
            errors: [{ messageId: "direct" }],
        },
        {
            code: 'el.style.cursor = "default";',
            errors: [{ messageId: "direct" }],
        },
        {
            code: 'this.getElement()?.style.setProperty("cursor", "default");',
            errors: [{ messageId: "direct" }],
        },
    ],
});

console.log("no-element-style: all tests passed.");
