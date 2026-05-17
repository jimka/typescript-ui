import tseslint from "typescript-eslint";
import forwardSuperOptions from "./scripts/eslint/forward-super-options.js";

// typescript-eslint's `recommended` config surfaces ~860 pre-existing
// stylistic issues (prefer-const, no-explicit-any, …) across the 172-file
// lib. Per plan Step 4 / Potential Challenges, run with just the targeted
// custom rule until a separate cleanup pass adopts the broader preset.
export default tseslint.config(
    { ignores: ["dist/**", "node_modules/**", "docs/.vitepress/cache/**"] },
    {
        files: ["src/**/*.ts"],
        languageOptions: {
            parser: tseslint.parser,
        },
        plugins: {
            local: { rules: { "forward-super-options": forwardSuperOptions } },
        },
        rules: {
            "local/forward-super-options": "error",
        },
    },
    {
        // Naming-convention guard scoped to the library only — demo apps
        // under src/typescript/* are out of the rename's scope (plan Non-Goals).
        files: ["src/typescript/lib/**/*.ts"],
        languageOptions: {
            parser: tseslint.parser,
        },
        plugins: {
            "@typescript-eslint": tseslint.plugin,
        },
        rules: {
            "@typescript-eslint/naming-convention": [
                "error",
                // Static private/protected properties are out of scope —
                // the more-specific selector with `format: null` exempts
                // them from the instance-field rules below.
                {
                    selector: "classProperty",
                    modifiers: ["private", "static"],
                    format: null,
                },
                {
                    selector: "classProperty",
                    modifiers: ["protected", "static"],
                    format: null,
                },
                {
                    selector: "classProperty",
                    modifiers: ["private"],
                    format: ["camelCase"],
                    leadingUnderscore: "require",
                },
                {
                    selector: "classProperty",
                    modifiers: ["protected"],
                    format: ["camelCase"],
                    leadingUnderscore: "require",
                },
            ],
        },
    },
);
