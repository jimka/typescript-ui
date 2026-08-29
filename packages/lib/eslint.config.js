import tseslint from "typescript-eslint";
import forwardSuperOptions from "./scripts/eslint/forward-super-options.js";
import noElementStyle from "./scripts/eslint/no-element-style.js";
import noRawDom from "./scripts/eslint/no-raw-dom.js";
import requireContentBounds from "./scripts/eslint/require-content-bounds.js";
import requireSubclassDefaults from "./scripts/eslint/require-subclass-defaults.js";

// typescript-eslint's `recommended` config surfaces ~860 pre-existing
// stylistic issues (prefer-const, no-explicit-any, …) across the 172-file
// lib. Per plan Step 4 / Potential Challenges, run with just the targeted
// custom rule until a separate cleanup pass adopts the broader preset.
export default tseslint.config(
    { ignores: ["dist/**", "node_modules/**"] },
    {
        files: ["src/**/*.ts"],
        languageOptions: {
            parser: tseslint.parser,
        },
        plugins: {
            local: {
                rules: {
                    "forward-super-options"    : forwardSuperOptions,
                    "no-element-style"         : noElementStyle,
                    "no-raw-dom"               : noRawDom,
                    "require-content-bounds"   : requireContentBounds,
                    "require-subclass-defaults": requireSubclassDefaults,
                },
            },
        },
        rules: {
            "local/forward-super-options"    : "error",
            "local/require-subclass-defaults": "error",
        },
    },
    {
        // Component code must route style writes through Component setters.
        // Scoped to the component tree only: core/Component.ts and the
        // applyStyle plumbing legitimately touch element.style. Starts at
        // "warn" — there are ~38 pre-existing call sites under component/
        // that a follow-up pass will convert.
        files: ["src/typescript/lib/component/**/*.ts"],
        rules: {
            "local/no-element-style": "warn",
        },
    },
    {
        // Content-box containment, scoped to the published library: a component
        // that places its own children must take the rectangle from
        // getContentBounds(). Demo panels under src/typescript/*.ts are excluded
        // for the same reason the naming guard below excludes them — they are
        // not shipped, and a consumer never subclasses one.
        files: ["src/typescript/lib/**/*.ts"],
        rules: {
            "local/require-content-bounds": "error",
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
    {
        // Total DOM-seam coverage: every DOM read/write in the lib must funnel
        // through DOM.sink / DOM.source. Type-aware, so it needs type services —
        // a dedicated typed block scoped to the lib (the other blocks stay
        // untyped and pay nothing). core/DOM.ts is the sole exempt file.
        files: ["src/typescript/lib/**/*.ts"],
        ignores: ["src/typescript/lib/core/DOM.ts"],
        languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            "local/no-raw-dom": "error",
        },
    },
);
