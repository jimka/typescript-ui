// Secondary check: prove the no-raw-dom rule has no false negatives. The corpus
// enumerates every *form* of DOM access (direct read/write, method call,
// computed, destructure, alias, helper-return, the receiver-less globals) and
// asserts each is reported; the `valid` cases prove the over-counted lookalikes
// (framework types with DOM-ish member names, CSS.escape, typeof guards) are NOT.
//
// Type-aware, so the tester runs the typescript-eslint parser with type services
// (projectService + a fixtures tsconfig pinned to lib "dom"). Run via test:lint.

import { RuleTester } from "eslint";
import tsParser from "@typescript-eslint/parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import rule from "./no-raw-dom.js";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

const tester = new RuleTester({
    languageOptions: {
        parser: tsParser,
        parserOptions: {
            projectService: { allowDefaultProject: ["*.ts"] },
            tsconfigRootDir: fixtures,
        },
    },
});

// A framework type whose members shadow DOM names — must never be flagged.
const FW = "interface FwNode { children: FwNode[]; matches(s: string): boolean; click(): void; } declare const fw: FwNode;";

tester.run("no-raw-dom", rule, {
    valid: [
        // CSSStyleDeclaration local — caught via the element receiver, not the type.
        "declare const cssDecl: CSSStyleDeclaration; const w = cssDecl.borderTopWidth;",
        // Data object with a `.style` field.
        "declare const config: { style: string }; const s = config.style;",
        // Framework type whose member names shadow DOM ones.
        FW + " const c = fw.children;",
        FW + " const m = fw.matches('x');",
        FW + " fw.click();",
        // A non-DOM Set's contains-like call.
        "declare const set: { contains(x: number): boolean }; const r = set.contains(1);",
        // typeof feature-detection guards touch no DOM.
        "const a = typeof window;",
        "const b = typeof window !== 'undefined' && typeof window.matchMedia === 'function';",
        // CSS.escape is a pure string utility, not DOM interaction.
        "const e = CSS.escape('a.b');",
    ],
    invalid: [
        // Direct property read.
        { code: "declare const el: HTMLElement; const c = el.style;", errors: [{ messageId: "style" }] },
        // Direct property write.
        { code: "declare const el: HTMLElement; el.id = 'x';", errors: [{ messageId: "dom" }] },
        // Method call (traversal).
        { code: "declare const el: HTMLElement; el.querySelector('.x');", errors: [{ messageId: "traversal" }] },
        // Event method.
        { code: "declare const el: HTMLElement; el.addEventListener('click', () => {});", errors: [{ messageId: "event" }] },
        // Computed member access.
        { code: "declare const el: HTMLElement; const n = el['scrollLeft'];", errors: [{ messageId: "dom" }] },
        // Destructuring a DOM receiver.
        { code: "declare const el: HTMLElement; const { scrollLeft } = el;", errors: [{ messageId: "dom" }] },
        // Aliased element.
        { code: "declare const el: HTMLElement; const a = el; const w = a.style;", errors: [{ messageId: "style" }] },
        // Element returned from a helper.
        { code: "declare function getEl(): HTMLElement; const t = getEl().scrollTop;", errors: [{ messageId: "dom" }] },
        // Subclass via base chain (HTMLInputElement -> HTMLElement -> Element).
        { code: "declare const inp: HTMLInputElement; const v = inp.value;", errors: [{ messageId: "dom" }] },
        // Stylesheet rule walk.
        { code: "declare const sheet: CSSStyleSheet; const r = sheet.cssRules;", errors: [{ messageId: "dom" }] },
        // document global as a member receiver.
        { code: "const ae = document.activeElement;", errors: [{ messageId: "event" }] },
        // window global as a member receiver.
        { code: "const iw = window.innerWidth;", errors: [{ messageId: "dom" }] },
        // Receiver-less global calls.
        { code: "declare const el: HTMLElement; const cs = getComputedStyle(el);", errors: [{ messageId: "global" }] },
        { code: "const h = requestAnimationFrame(() => {});", errors: [{ messageId: "global" }] },
    ],
});

console.log("no-raw-dom: all tests passed.");
