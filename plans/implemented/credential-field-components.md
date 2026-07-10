# Credential Field Components — Implementation Plan

## Overview

Add two thin field presets that bake in the browser-credential-manager wiring (`autocomplete` + `name`) so login screens stop repeating that boilerplate: a **new** `UsernameField` and a **modified** `PasswordField`. Both follow the exact preset shape of [`TextField`](src/typescript/lib/component/input/TextField.ts#L36) — a subclass of [`TextInput`](src/typescript/lib/component/input/TextInput.ts#L88) with a `_defaultXFieldOptions` visual-defaults bag, `callable()` wrapping, and the `_X` / `X` export pair.

`TextInput` already owns the machinery: [`setAutoComplete`](src/typescript/lib/component/input/TextInput.ts#L374), [`setName`](src/typescript/lib/component/input/TextInput.ts#L277) (mirrors the intrinsic name to the DOM `name` attribute), [`setType`](src/typescript/lib/component/input/TextInput.ts#L257), and the option fields `autoComplete` / `name` are first-class on [`TextInputOptions`](src/typescript/lib/component/input/TextInput.ts#L45). These presets only seed sensible credential defaults and let any caller-supplied value win.

This is **not** a login form / flow component. No `<form>` composite, no dialog, no submit handling — the semantic `<form>` element and its submit stay the consumer's responsibility. The gallery example demonstrates the intended login wiring by dropping the two fields into a plain container constructed with `{ tag: "form" }`.

---

## Architecture Decisions

### Field presets, not a form/flow component

Per ARCHITECTURE.md *Compose before specializing*: a login form is *mostly arrangement* (two fields + a button in a container), so it must be composed at the call site, not specialized into a new class. What genuinely can't be composed away is the fiddly per-field `autocomplete`/`name` token wiring — that is real, reusable configuration, and a two-field preset deletes that boilerplate from every login screen without adding a coordinator. So the earned surface is exactly two presets and nothing more.

### The credential defaults must be applied via constructor-body setters, NOT the `_defaultXFieldOptions` bag

This is the load-bearing correctness point. A value seeded in a `_default*Options` bag is a **pure fallback** — never dispatched into `_options` at construction (see [`Component.applyOptions`](src/typescript/lib/core/Component.ts#L477) which dispatches *only* caller options, and ARCHITECTURE.md *Class-level defaults must survive the getter*). It only takes effect if the field's getter folds `_defaultOptions`. But `getAutoComplete()` returns `this._options.autoComplete ?? null` and `getName()` returns `this._options.name ?? null` — **neither folds the default bag**, and `init()` replays the DOM attribute from `_options.autoComplete` / `_options.name`. So seeding `autoComplete` / `name` into `_defaultPasswordFieldOptions` would render **no attribute at all**.

Therefore the credential defaults are applied the same way `TextField`/`PasswordField` already apply `type` — by calling the setter in the constructor body (`this.setType("password")`). We call `setName(...)` and `setAutoComplete(...)` explicitly, each gated on the caller not having supplied that field, so the caller still wins:

```ts
if (this._options.name === undefined) {
    this.setName("password");
}

if (this._options.autoComplete === undefined) {
    this.setAutoComplete(options?.newPassword ? "new-password" : "current-password");
}
```

After `super()` returns, `this._options.autoComplete` holds the caller's value iff they passed one (dispatched by `applyOptions` during the cascade), so `=== undefined` is a precise "caller didn't supply" test — the same idiom [`DateField`](src/typescript/lib/component/input/DateField.ts#L54) uses for its late-built `value`.

The **visual** defaults (`padding`, `cursor`, `backgroundColor`, `foregroundColor`) stay in the `_defaultXFieldOptions` bag unchanged — those are Component-level fields whose getters *do* fold the default bag, so the pure-fallback mechanism works for them.

### The `newPassword` flag (PasswordField) — semantics and tokens

`newPassword?: boolean` picks the `autocomplete` credential-intent token:

- `false` (default) → `autocomplete="current-password"` — a login screen; the browser offers the saved password.
- `true` → `autocomplete="new-password"` — signup / change-password; the browser offers a generated password and does not autofill the old one.

`name` defaults to `"password"` regardless.

### The `email` flag (UsernameField)

`email?: boolean` picks the identifier token:

- `false` (default) → `autocomplete="username"`.
- `true` → `autocomplete="email"` — email-based logins, so password managers key off the email.

`type` is always `"text"` (mirroring `TextField`; not `type="email"`, which would add native email validation the login flow does not want). `name` defaults to `"username"`.

### `newPassword` / `email` are construction-only intent, not cached state

They carry no setter, no getter, and are not stored on `_options` — they exist only to resolve the `autocomplete` token at construction. The resolved token *is* the observable state, readable via `getAutoComplete()`. This keeps them off the "three rules for every DOM write" surface (they are not DOM-writing options) and avoids a redundant second source of truth.

### Defaults are overridable via the cascade

Because each credential setter is gated on `this._options.X === undefined`, any caller value wins — a caller value dispatched during `super()` suppresses the default entirely. A non-credential secret (an API token in a masked field that must never trigger the password manager) opts out with `new PasswordField({ autoComplete: "off" })`; likewise `{ name: "…" }` overrides the default name.

### The PasswordField default change is a behaviour change (minor-version-bump-worthy)

Today `new PasswordField()` writes **no** `autocomplete` and **no** `name`. After this change a bare `new PasswordField()` advertises `autocomplete="current-password"` and `name="password"` — i.e. it now participates in credential autofill and form submission by that name. Blast radius is tiny and verified: the only in-repo call site is [`src/typescript/LayoutTestPanel.ts:47`](src/typescript/LayoutTestPanel.ts#L47) (`new PasswordField()`, a demo field), and the consuming sqladmin app has zero uses. It is fully overridable (`autoComplete: "off"`, `name: …`). Treat as a minor version bump; call it out in the changelog / release notes.

---

## Public API

```ts
// src/typescript/lib/component/input/UsernameField.ts  (NEW)
export interface UsernameFieldOptions extends TextInputOptions {
    /** When true, seed autocomplete="email" instead of "username" (email-based logins). */
    email?: boolean;
}

class UsernameField extends TextInput<UsernameFieldOptions> { /* … */ }
// bare-construction defaults: type="text", autocomplete="username", name="username"
export { UsernameField as _UsernameField, UsernameFieldCallable as UsernameField };
```

```ts
// src/typescript/lib/component/input/PasswordField.ts  (MODIFIED)
export interface PasswordFieldOptions extends TextInputOptions {
    /**
     * false (default) → autocomplete="current-password" (login);
     * true            → autocomplete="new-password" (signup / change-password).
     */
    newPassword?: boolean;
}
// new bare-construction defaults: autocomplete="current-password", name="password"
```

No new setters/getters: `email` / `newPassword` are construction-only. All state routes through the inherited `setAutoComplete` / `setName` / `setType`.

---

## Ordered Implementation Steps

1. **Create `src/typescript/lib/component/input/UsernameField.ts`.** Copy `TextField.ts` verbatim (imports, `_defaultTextFieldOptions` → rename to `_defaultUsernameFieldOptions` with the same four visual defaults, the `updateHeight()` method, the `ThemeManager.onThemeChange` wiring, the `callable()` block), then:
   - Rename the interface to `UsernameFieldOptions` and add `email?: boolean;` with a JSDoc line.
   - In the constructor, after `this.setType("text");`, add the two gated setter blocks:
     ```ts
     if (this._options.name === undefined) {
         this.setName("username");
     }

     if (this._options.autoComplete === undefined) {
         this.setAutoComplete(options?.email ? "email" : "username");
     }
     ```
   - Update the class JSDoc lead sentence (first paragraph is what the llms generator's `summarize()` extracts) to something like: *"A username / login-identifier field — a `TextField` preset that defaults `autocomplete=\"username\"` and `name=\"username\"` for browser credential managers."*
   - Export names: `UsernameField as _UsernameField`, `UsernameFieldCallable as UsernameField`.

2. **Modify `src/typescript/lib/component/input/PasswordField.ts`.**
   - Add `newPassword?: boolean;` (with JSDoc) to `PasswordFieldOptions` (currently empty).
   - In the constructor, after `this.setType("password");`, add:
     ```ts
     if (this._options.name === undefined) {
         this.setName("password");
     }

     if (this._options.autoComplete === undefined) {
         this.setAutoComplete(options?.newPassword ? "new-password" : "current-password");
     }
     ```
   - Do **not** add `autoComplete` / `name` to `_defaultPasswordFieldOptions` (see Architecture Decision — they would not render).
   - Optionally extend the class JSDoc lead to mention credential autofill; keep it one paragraph.

3. **Update the barrel `src/typescript/lib/component/input/index.ts`.** After the `PasswordField` export lines (32–33), mirror the `TextField` pair:
   ```ts
   export { UsernameField } from '~/component/input/UsernameField.js';
   export type { UsernameFieldOptions } from '~/component/input/UsernameField.js';
   ```
   Check: `grep -n "UsernameField" src/typescript/lib/component/input/index.ts` — expect 2 matches. No parent barrel re-exports the input index (verified: `@jimka/typescript-ui/component/input` maps straight to this file in `package.json`), so no other barrel edit is needed.

4. **Add the gallery example** (see *Gallery / demo example* below).

5. **Add the test file** `tests/component/input/CredentialFields.test.ts` (see *Expected Behaviour* + *Verification*).

6. **Add docs:** `docs/components/UsernameField.md`, a sidebar row in `docs/.vitepress/config.mts`, and a manifest entry in `scripts/llms/manifest.data.mjs` (see *Documentation Impact*).

7. **Typecheck + test + docs build** (see *Verification*).

---

## Gallery / demo example

The gallery registers panels in [`src/typescript/main.ts`](src/typescript/main.ts#L44) via `layoutManager.addLazyTab(() => new XPanel(), "Label")`. Input components are demoed in existing panels like `MiscPanel.ts` / `LayoutTestPanel.ts`.

Keep it minimal: add a small credential block to an **existing** panel rather than a whole new tab. `LayoutTestPanel.ts` already imports `PasswordField` and constructs one at line 47 — the natural home. Add a `UsernameField` + `PasswordField` pair inside a container built with the `tag: "form"` option to show the intended login usage. `Component` accepts a `tag` option ([`Component.ts:446`](src/typescript/lib/core/Component.ts#L446) applies it directly; no setter), so a `Panel`/`Component` constructed with `{ tag: "form" }` renders a `<form>`:

```ts
import { UsernameField } from '@jimka/typescript-ui/component/input';   // add to the existing input import

// A <form> container demonstrating the credential presets. No submit
// handler — the presets only wire autocomplete/name; the form semantics
// stay the consumer's job.
let loginForm = new Component({ tag: "form" });
loginForm.setLayoutManager(new VBox());          // VBox already imported in LayoutTestPanel? add if not
loginForm.addComponent(new UsernameField());
loginForm.addComponent(new PasswordField());     // login default: current-password
this.addComponent(loginForm);
```

Match the panel's existing construction style (it uses `new Button(...)` / post-construction `setLayoutManager` already). Confirm `VBox` (or reuse the existing `HBox` import in that file) is imported; add the minimal import if missing. Leave the existing standalone `passwordField` at line 47 in place — do not disturb unrelated demo code.

---

## Expected Behaviour

All unit-testable via the offline recording-sink harness (mount with `field.getElement(true)`, then read the rendered attribute with a `lastSetAttr` helper mirroring [`tests/component/input/Label.test.ts:24`](tests/component/input/Label.test.ts#L24), and/or assert the cached value via `getAutoComplete()` / `getName()`):

| # | Case | Expectation |
|---|------|-------------|
| 1 | `new UsernameField()` | `getAutoComplete() === "username"`; rendered `autocomplete="username"` |
| 2 | `new UsernameField()` | `getName() === "username"`; rendered `name="username"` |
| 3 | `new UsernameField()` | rendered `type="text"` |
| 4 | `new UsernameField({ email: true })` | `getAutoComplete() === "email"`; rendered `autocomplete="email"` |
| 5 | `new UsernameField({ autoComplete: "off" })` | `getAutoComplete() === "off"` — caller value overrides the default (cascade) |
| 6 | `new UsernameField({ name: "user" })` | `getName() === "user"` — caller value overrides the default |
| 7 | `new PasswordField()` | `getAutoComplete() === "current-password"`; rendered `autocomplete="current-password"` |
| 8 | `new PasswordField()` | `getName() === "password"`; rendered `name="password"` |
| 9 | `new PasswordField({ newPassword: true })` | `getAutoComplete() === "new-password"` |
| 10 | `new PasswordField({ autoComplete: "off" })` | `getAutoComplete() === "off"` — caller value overrides (non-credential secret opt-out) |
| 11 | `new PasswordField({ newPassword: true, autoComplete: "off" })` | `getAutoComplete() === "off"` — explicit `autoComplete` wins over `newPassword` |

**Manual / browser only** (the recording sink cannot exercise it): actual password-manager behaviour — that Chrome offers a saved credential on a `current-password` field, offers a generated password on `new-password`, and keys the username off `email` — must be verified by hand in a real browser against the gallery `<form>`. Note this in the demo step; do not attempt to automate it.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/component/input/UsernameField.ts` |
| Modify | `src/typescript/lib/component/input/PasswordField.ts` |
| Modify | `src/typescript/lib/component/input/index.ts` (barrel) |
| Modify | `src/typescript/LayoutTestPanel.ts` (gallery `<form>` example) |
| Create | `tests/component/input/CredentialFields.test.ts` |
| Create | `docs/components/UsernameField.md` |
| Modify | `docs/.vitepress/config.mts` (sidebar Inputs section) |
| Modify | `scripts/llms/manifest.data.mjs` (Inputs / Forms catalog) |

---

## Verification

- **Typecheck / lint:** `npm run build` (or the repo's typecheck script) — no errors. The `local/no-raw-dom` and typed-setter ESLint rules must stay green; all attribute writes route through the existing `setAutoComplete` / `setName` / `setType` setters, so no new raw-DOM sites.
- **Unit tests:** `npx vitest run tests/component/input/CredentialFields.test.ts` — the 11 cases above pass.
- **Full suite:** `npx vitest run` — existing `tests/component/input/TextInput.test.ts` (which constructs a bare `PasswordField`) still passes; it asserts only listener wiring, unaffected by the new attribute writes.
- **Barrel check:** `grep -n "UsernameField" src/typescript/lib/component/input/index.ts` — expect 2 matches.
- **Docs build:** `npm run docs:build` (TypeDoc) — zero warnings; confirms the new `UsernameField` JSDoc has no `{@link}` to excluded symbols and that `docs/components/UsernameField.md` resolves.
- **llms generation:** `npm run` the llms generate script (or `npx vitest run tests/unit/llms-generate.test.ts` for the pure helpers) — the new manifest entry must resolve to `UsernameField` in `component/input` with a doc page, so `resolveDoc` emits no warning.
- **Manual browser smoke:** run the gallery (`npm run dev`), open the `LayoutTestPanel` tab, and confirm the `<form>` renders and Chrome's password manager engages on the fields (the un-automatable rows above).

---

## Documentation Impact

- **Export surface.** New public symbols `UsernameField` (value) + `UsernameFieldOptions` (type) exported from the `@jimka/typescript-ui/component/input` barrel (step 3). `PasswordFieldOptions` gains a `newPassword` field — same barrel, no new export.
- **Component doc page.** Create `docs/components/UsernameField.md` mirroring [`docs/components/PasswordField.md`](docs/components/PasswordField.md): a lead line linking `[/api/component/input/classes/UsernameField]`, a `## Usage` code block, a `## Notes` bullet explaining the `email` flag and the `autocomplete="username"` default, and a `## See also` linking `TextField` / `PasswordField`. Consider adding a line to `PasswordField.md`'s Notes noting the new `newPassword` flag and the `current-password`/`name="password"` defaults.
- **Sidebar.** Add `{ text: 'UsernameField', link: '/components/UsernameField' },` to the `Inputs` items array in [`docs/.vitepress/config.mts`](docs/.vitepress/config.mts#L88) (near the `TextField` / `PasswordField` rows).
- **llms catalog.** Add one entry to the `Inputs / Forms` section of [`scripts/llms/manifest.data.mjs`](scripts/llms/manifest.data.mjs#L51), e.g. `{ task: "Username / login-identifier field", symbol: "UsernameField" },` (place it near the `TextField` / `PasswordField` rows). The generator derives the row's summary from the class JSDoc lead sentence and the doc link from the doc page — both provided above. `llms.txt` is generated, not hand-edited.
- No renames/removals, so no `grep` sweep for an old name is required.

---

## Critical Files

- [`src/typescript/lib/component/input/TextField.ts`](src/typescript/lib/component/input/TextField.ts) — **the file `UsernameField` mirrors.** Copy its structure exactly.
- [`src/typescript/lib/component/input/PasswordField.ts`](src/typescript/lib/component/input/PasswordField.ts) — the file to modify; same preset shape.
- [`src/typescript/lib/component/input/TextInput.ts`](src/typescript/lib/component/input/TextInput.ts) — the base: `setAutoComplete` (L374), `setName` (L277), `setType` (L257), `init()` attribute replay (L651), and `TextInputOptions` (L45).
- [`src/typescript/lib/core/Component.ts`](src/typescript/lib/core/Component.ts) — `applyOptions` dispatches only caller options (L477); `tag` option applied at L446; `getName` non-folding (L1295). Read to understand why the credential defaults must be constructor-body setters, not bag entries.
- [`tests/component/input/Label.test.ts`](tests/component/input/Label.test.ts) — the `lastSetAttr` recording-sink helper + `installTestDOM` harness to mirror in the new test.
- [`tests/component/input/TextInput.test.ts`](tests/component/input/TextInput.test.ts) — harness config (`CONFIG`, `beforeEach`/`afterEach`) to copy.
- [`src/typescript/LayoutTestPanel.ts`](src/typescript/LayoutTestPanel.ts) — existing `PasswordField` demo site (L47) where the `<form>` example lands.

---

## Non-Goals

- **No login form / flow / dialog composite.** Arrangement composes at the call site (Architecture Decision 1); the semantic `<form>` and submit handling stay the consumer's responsibility.
- **No `type="email"` on UsernameField.** The `email` flag switches only the `autocomplete` token; the input stays `type="text"` to avoid native email validation on a login identifier.
- **No new setters/getters for `email` / `newPassword`.** They are construction-only intent that resolves into the inherited `autoComplete` state.
- **No change to `TextField` / `TextInput`.** The presets only consume the existing base surface.
</content>
</invoke>
