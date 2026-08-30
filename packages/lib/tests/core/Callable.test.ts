// Pins callable()'s documented contract — call without `new`, `new` still
// works, `instanceof` holds, and the wrapper works as an `extends` target —
// plus a `super.<method>()` call through a two-level stacked callable chain
// (Base -> callable -> Mid -> callable -> Leaf), the exact shape
// packages/lib/src/typescript/lib/component/container/Scrollbar.ts uses when
// it calls `super.addComponent(...)`.
//
// This suite runs under Vitest/Node (V8), which does not reproduce the bug
// callable()'s Proxy-based implementation had under WebKitGTK/JavaScriptCore
// (Tauri's Linux webview engine): there, `super.<method>()` resolved to
// `undefined` whenever a `callable()`-wrapped class sat anywhere in the
// prototype chain above the method doing the `super` call — confirmed with a
// minimal reproduction run directly against WebKitGTK's own `MiniBrowser`
// (see plans/implemented/code-editor-desktop-app.md's Implementation Notes).
// V8 never exhibited the bug, so this suite cannot turn red against the old
// implementation; it instead pins the contract callable()'s JSDoc already
// promises, so a future change that breaks `instanceof`, `constructor.name`,
// or the bare-call/`new` forms is still caught here.
import { describe, it, expect } from 'vitest';
import { callable } from '~/core/Callable';

describe('callable', () => {
    it('constructs via both the bare call and `new`', () => {
        class Foo {
            constructor(public x: number) {}
        }
        const FooCallable = callable(Foo);

        expect(FooCallable(1).x).toBe(1);
        expect(new FooCallable(2).x).toBe(2);
    });

    it('reports `instanceof` true against both the wrapper and the raw class', () => {
        class Foo {}
        const FooCallable = callable(Foo);
        const a = FooCallable();

        expect(a instanceof FooCallable).toBe(true);
        expect(a instanceof Foo).toBe(true);
    });

    it('preserves `constructor.name` through a callable-wrapped subclass', () => {
        class Base {}
        const BaseCallable = callable(Base);

        class Widget extends BaseCallable {}
        const WidgetCallable = callable(Widget);

        expect(new WidgetCallable().constructor.name).toBe('Widget');
    });

    it('resolves `super.<method>()` through a two-level stacked callable chain', () => {
        class Base {
            addComponent(x: string): string {
                return x;
            }
        }
        const BaseCallable = callable(Base);

        class Mid extends BaseCallable {}
        const MidCallable = callable(Mid);

        class Leaf extends MidCallable {
            result: string;

            constructor() {
                super();
                this.result = super.addComponent('thumb');
            }
        }

        const leaf = new Leaf();

        expect(leaf.result).toBe('thumb');
        expect(leaf instanceof Mid).toBe(true);
        expect(leaf instanceof Base).toBe(true);
    });
});
