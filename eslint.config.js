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
);
