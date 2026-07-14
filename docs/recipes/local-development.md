# Local development against a linked library checkout

## When you need this

You are developing your app against a local checkout of `@jimka/typescript-ui` — not the npm release — linked via a `file:` dependency, to test unreleased library changes before they are published.

## Link the checkout

In the consuming app's `package.json`:

```json
{ "dependencies": { "@jimka/typescript-ui": "file:../typescript-ui" } }
```

The package's `exports` map points at **built** artifacts (`./dist/lib/*.es.js`), so the linked checkout must be built before the app resolves it — run `npm run build:lib` in the library, and **re-run it after every library source edit**. A plain `npm run build` builds the demo app, not the lib bundles. See [Installation → Build commands](/guide/installation#build-commands) for the full command list.

## Vite config recipe

```typescript
import { defineConfig } from "vite";

export default defineConfig({
    esbuild: { keepNames: true },
    server: { fs: { strict: false } },
    resolve: { dedupe: ["@jimka/typescript-ui"] },
    optimizeDeps: { exclude: ["@jimka/typescript-ui"] },
});
```

| Setting | Why | Symptom without it |
| --- | --- | --- |
| `server.fs.strict: false` | the linked package lives outside the app's project root | Vite refuses to serve files "outside of the workspace root" |
| `resolve.dedupe: ["@jimka/typescript-ui"]` | force a single instance of the linked ESM package | duplicate instances → `instanceof` checks fail, theme/singletons split |
| `optimizeDeps.exclude: ["@jimka/typescript-ui"]` | skip dep pre-bundling for the linked source | stale pre-bundle ignores live library edits; double-bundling |
| `esbuild.keepNames: true` | the library derives CSS classes and Dock serialization keys from `constructor.name`; the minifier must not mangle class names | app renders unstyled / layout save-restore breaks (mirrors the library's own build `keepNames`) |

`keepNames` matters only for the **production** build (`vite build`); the other three are dev-server settings — but all four are safe to set unconditionally.

## App-specific extras (not part of the recipe)

A consuming app's own config commonly adds unrelated request routing next to these settings — for example a `server.proxy` entry forwarding `/api` calls to a backend. That is app-specific and unrelated to linking the library; recognise it as separate when you see it in a reference config.

## See also

- [Installation](/guide/installation)
- [Theming](/concepts/theming) — why `constructor.name` / CSS scoping matters
