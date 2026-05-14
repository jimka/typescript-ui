# Binding Record-Change Veto — Implementation Plan

## Overview

[Binding.setRecord()](../src/typescript/lib/core/Binding.ts#L137) currently swaps the bound record unconditionally. There is no way for a caller to intercept a record switch and abort it — for example, when the current record is dirty or has live validation errors. The fix is a new listener channel, `addBeforeRecordListener(fn)`, where each registered listener receives the *next* record and returns a `boolean`: `false` vetoes the change, anything else allows it. If any listener vetoes, `setRecord()` returns the binding instance without touching state (it still returns `this` to preserve its chainable signature).

The change is contained to [Binding.ts](../src/typescript/lib/core/Binding.ts). It does not modify [ModelRecord](../src/typescript/lib/data/ModelRecord.ts), the [Bindable](../src/typescript/lib/core/Bindable.ts) interface, or any consuming panels. Existing callers ([BindingPanel.ts:197](../src/typescript/BindingPanel.ts#L197), [BindingPanel.ts:205](../src/typescript/BindingPanel.ts#L205), [MultiSelectListPanel.ts:158](../src/typescript/MultiSelectListPanel.ts#L158)) keep working unchanged because no listeners are registered by default.

---

## Architecture Decisions

### Synchronous, boolean-returning veto — not a Promise

`setRecord()` is and remains synchronous: bound components are populated in the same call, and field validation runs inline. A `Promise<boolean>` veto would force `setRecord()` to become async and ripple through every call site, while gaining nothing the caller can't already do externally.

If a caller needs an async confirmation (e.g. "Discard unsaved changes?" dialog), the right shape is: intercept the change *outside* `setRecord()`, await the dialog, and only call `setRecord()` once the user has decided. The veto API is for **synchronous, programmatic** guards — "if dirty, refuse" — not for UX flows.

### `false` cancels, anything else allows

Listeners return `boolean`. Returning `false` vetoes the change; returning `true` (or implicitly `undefined` if a stray listener forgets to return) allows it. This matches the convention in browser event handlers (`return false` cancels) and lets call sites write the natural shape:

```typescript
binding.addBeforeRecordListener(() => !binding.getRecord()?.isDirty());
```

A discriminated result object (`{ allow: boolean, reason?: string }`) was rejected as overkill: there is no UI surface that displays a veto reason today, and the caller already knows *why* it vetoed because it wrote the listener.

### Short-circuit on first veto

Iteration stops on the first `false` so later listeners cannot accidentally re-allow what an earlier one rejected. The result is "all listeners must consent". This mirrors how `Array.prototype.every` behaves and is the safer default — you cannot accidentally widen permission by adding a listener.

### Listeners run *before* any state mutation

The veto check is the first thing `setRecord()` does, before `clearValidation()`, before reassigning `this.record`, before pushing values into accessors. A vetoed call is a complete no-op — including no validation reset. This is critical: if validation were cleared and then the change vetoed, the user would see error decorations vanish for a record they're still editing.

### Naming: `BeforeRecord`, not `RecordChangeVeto`

The existing channels are `addChangeListener` / `addCommitListener` / `addRejectListener` — short, action-shaped names. `addBeforeRecordListener` follows that style and signals timing (*before* the change) rather than mechanism (*veto*). Callers reading the API surface immediately understand it pairs with `setRecord()`.

---

## Public API (TypeScript Signatures)

```typescript
export type BeforeRecordListener = (next: ModelRecord | null) => boolean;

export class Binding extends BaseObject {
    // ...existing API unchanged...

    /**
     * Registers a listener that is consulted before a record change takes effect.
     * Listeners receive the *next* record (or null) and return false to cancel
     * the change. Iteration stops on the first false; if any listener vetoes,
     * setRecord() returns without modifying any state.
     *
     * Async confirmation must be handled at the call site — setRecord() stays
     * synchronous.
     */
    addBeforeRecordListener(fn: BeforeRecordListener): void;
}
```

`setRecord()`'s public signature is unchanged (it still returns `this`); only its body grows the veto check.

---

## Implementation

### New private state

```typescript
private beforeRecordListeners: Array<BeforeRecordListener> = [];
```

Declared alongside the existing `changeListeners` / `commitListeners` / `rejectListeners` fields at the top of the class.

### `setRecord()` change

The current body at [Binding.ts:137-155](../src/typescript/lib/core/Binding.ts#L137-L155) gains a single guard at the top. Note that `setRecord` returns `this` (it is chainable), so the veto early-return must return `this` as well:

```typescript
setRecord(record: ModelRecord | null): this {
    for (const fn of this.beforeRecordListeners) {
        if (fn(record) === false) {
            return this;
        }
    }

    this.record = record;
    this.clearValidation();
    // ...rest unchanged...
}
```

Strict `=== false` comparison so a listener that forgets to return (returns `undefined`) is treated as consent — explicit veto only.

### `addBeforeRecordListener()`

Mirror the shape of [addCommitListener](../src/typescript/lib/core/Binding.ts#L215) and [addRejectListener](../src/typescript/lib/core/Binding.ts#L222):

```typescript
addBeforeRecordListener(fn: BeforeRecordListener): void {
    this.beforeRecordListeners.push(fn);
}
```

Placed in the `// ── Listeners ──` section immediately after `addRejectListener`.

---

## Ordered Implementation Steps

### Step 1 — Add the type and field

In [Binding.ts](../src/typescript/lib/core/Binding.ts):

1. Above the class (file-level), export `BeforeRecordListener` as shown in the API section.
2. Inside the class, add `private beforeRecordListeners: Array<BeforeRecordListener> = [];` next to the existing listener arrays at lines 51-53.

### Step 2 — Add the registration method

Add `addBeforeRecordListener(fn)` in the `// ── Listeners ──` section, after [addRejectListener](../src/typescript/lib/core/Binding.ts#L222).

### Step 3 — Insert the veto check in `setRecord()`

Prepend the veto loop to [setRecord()](../src/typescript/lib/core/Binding.ts#L137) — first statement in the method, before `this.record = record;`. Return `this` early on `=== false`.

### Step 4 — Re-export the type

In [lib/core/index.ts](../src/typescript/lib/core/index.ts) (next to the existing `export { Binding }` / `export type { Bindable, BindingAccessors }` lines at the bottom of the file), add a sibling re-export so the public type surface is importable for callers writing typed listeners:

```typescript
export type { BeforeRecordListener } from '~/core/Binding.js';
```

### Step 5 — Type-check

`npx tsc --noEmit` — must pass cleanly. The veto loop is the only behavioural change; the rest is additive.

### Step 6 — Manual smoke test

In [BindingPanel.ts](../src/typescript/BindingPanel.ts), temporarily wire a veto for verification (revert before commit):

```typescript
binding.addBeforeRecordListener((next) => {
    if (binding.getRecord()?.isDirty() && next !== binding.getRecord()) {
        Notification.show('Discard your changes first.', 'error');
        return false;
    }
    return true;
});
```

Edit a field on Alice, switch the record combo to Bob — the combo selection visually moves but the form stays on Alice and the notification fires. Commit Alice, switch to Bob — succeeds normally.

### Step 7 — Refresh graphify

Per [CLAUDE.md](../CLAUDE.md): `graphify update . --directed` after the change lands (the `--directed` flag preserves import-edge direction).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/Binding.ts` |
| Modify | `src/typescript/lib/core/index.ts` |

No new files. No deletions.

---

## Verification

1. **Type-check**: `npx tsc --noEmit` reports no new errors.
2. **No regression**: existing BindingPanel and MultiSelectListPanel work unchanged with no listeners registered (default behaviour identical).
3. **Veto path**: with the smoke-test listener from Step 6, the record combo *visually* selects Bob but [Binding.getRecord()](../src/typescript/lib/core/Binding.ts#L160) still returns Alice and the form fields show Alice's values.
4. **Allow path**: returning `true` (or omitting the listener) results in the existing behaviour byte-for-byte.
5. **Multi-listener short-circuit**: register two listeners where the first returns `false`; verify the second is *not* called (add a `console.log` inside the second listener for the test, then remove).
6. **Stray-return safety**: register a listener with no `return` statement (returns `undefined`); verify the change still happens.

---

## Potential Challenges

- **The caller must reconcile its UI after a veto.** The record combo in [BindingPanel.ts:202-207](../src/typescript/BindingPanel.ts#L202-L207) reads the combo value and calls `binding.setRecord(record)`. If the binding vetoes, the combo's selected value still points at the rejected record while the binding is on the previous one. The plan does **not** solve this — it is the call site's job to detect the veto (e.g. compare `binding.getRecord()` after the call) and reset the combo. Worth flagging in the JSDoc on `addBeforeRecordListener`.
- **Re-entrancy**: a listener that calls `binding.setRecord(...)` would trigger the loop recursively. The current implementation will handle this correctly (the inner call goes through the same veto check) but listeners should be discouraged from doing so. Note this in the JSDoc.
- **`null` is a valid `next`**: passing `null` to `setRecord()` clears the binding, and listeners must be free to veto a clear too. The signature `(next: ModelRecord | null)` makes this explicit; listeners that only want to guard *switches* (not clears) need their own `if (next === null) return true;` check.

---

## Critical Files

- [src/typescript/lib/core/Binding.ts](../src/typescript/lib/core/Binding.ts) — the file being modified
- [src/typescript/lib/data/ModelRecord.ts](../src/typescript/lib/data/ModelRecord.ts) — defines `isDirty()`, the most likely veto trigger
- [src/typescript/BindingPanel.ts](../src/typescript/BindingPanel.ts) — reference call site for the smoke test
- [src/typescript/MultiSelectListPanel.ts](../src/typescript/MultiSelectListPanel.ts) — second call site to confirm no regression
- [src/typescript/lib/core/index.ts](../src/typescript/lib/core/index.ts) — public export surface (subpath barrel for `core`)

---

## Non-Goals

- **Async / Promise-based veto.** Out of scope by user direction. Callers needing async confirmation must orchestrate the dialog before calling `setRecord()`.
- **Built-in dirty-guard.** The framework does not register a default listener that vetoes when the record is dirty — that policy is application-specific.
- **Combo / selector UI reset on veto.** Reconciling consumer UI when a veto fires is the call site's responsibility.
- **`removeBeforeRecordListener`.** Symmetric removal is not part of the existing listener APIs (`addChangeListener` etc. have no `remove` counterpart) and adding it here would be inconsistent. If a future need arises, it should be added across all four listener channels at once.
