// Component "place children inside the content box" guard.
//
// A child's containing block is already its parent's *padding box*, so a child
// written to `(0, 0)` and sized to the parent's outer width/height starts
// inside the border and overruns the opposite edge by the border width, where
// the `overflow: hidden` every component carries clips it. Placing it at `0`
// and sizing it to the *inner* box gets the extent right and the origin wrong,
// ignoring the padding that inner size already subtracted. The rectangle a
// component may place children in is `getContentBounds()` —
// `getContentInsets()` for the origin, `getInnerSize()` for the extent. See
// docs/concepts/sizing.md "Inner size vs outer size".
//
// The defect is invisible until someone themes a border onto the component, so
// it accumulates silently: two sweeps and ten review cycles each produced an
// enumeration a later reader proved incomplete. This rule exists so that the
// common shapes stop depending on someone remembering to look.
//
// It is a guard, not a proof, and the baseline is what the rule reports today
// rather than the whole remainder. Known gaps, all deliberate: a method that
// places children from *delegated* arguments names no box the rule can see —
// `ScrollStrip.layoutArrows` is handed its rectangle by `layoutContent` and was
// never reported, so fixing `layoutContent` alone would have left the arrows
// against the outer box with a green build; a fixed-size component
// whose outer extent is spelled any way other than `Self.WIDTH` / `Self.HEIGHT`
// is invisible; only `MethodDefinition` is visited, so a class-field arrow
// function is not; and both escapes below are whole-method, so a single
// `getContentBounds()` / `getContentInsets()` anywhere in a method silences the
// rule for every child it places, including the ones still written against the
// old box. That last gap bites exactly where a fix is half finished, which is
// the likeliest state for a baselined site to be found in — converting some of
// a method's children is not a fix, and the green it produces means nothing.
//
// An instance method is reported when it places a child — writes setX / setY /
// setWidth / setHeight / setSize / centerInHeight on something other than
// `this` or `super` — while naming a box it must not place against, and does
// not read that same box's border. Naming the box is what makes the placement
// wrong; a method that positions a child from a drag delta or a caller-supplied
// coordinate makes no claim about any frame and is not reported. Layout
// managers read the CONTAINER they are handed rather than `this` or one of
// their own fields, so they are out of scope by construction — their own insets
// handling is `LayoutManager`'s concern — and static methods have no `this`
// component at all.
//
// Four shapes name a box, the first three on an own receiver (see
// {@link ownReceiver}):
//
//   this.getWidth() / getHeight() / getSize()   the OUTER box, on `this` or on
//                                               a field such as `this._owner`
//                                               (VirtualScroller)
//   this.getInnerSize()                         the right extent, but an origin
//                                               that ignores padding
//   Self.WIDTH / Self.HEIGHT                    a fixed-size component's own
//                                               class constants (Notification)
//   setWidth / setHeight / setSize /            methods whose ARGUMENT is this
//   layoutChildren                              component's outer box by
//                                               contract, so they need no read
//                                               at all (Table's Footer and
//                                               Header forward it to a child;
//                                               TreeNodeRenderer and
//                                               ListItemRenderer document
//                                               layoutChildren's arguments as
//                                               the renderer's outer box)
//
// Suppression: `require-content-bounds.baseline.json` grandfathers the sites
// still awaiting a fix, keyed "<relpath>:<Class>.<method>". Entries come out as
// each site is fixed and none should go in — a new violation is the rule doing
// its job. Run `REQUIRE_CONTENT_BOUNDS_IGNORE_BASELINE=1 npx eslint src` to see
// the unsuppressed set. Unlike `no-raw-dom`'s baseline this one is short and
// hand-maintained, so it needs no generator, and it is keyed by method rather
// than by line so an unrelated edit above a site cannot silently invalidate it.

import fs from "node:fs";
import path from "node:path";

const BASELINE_PATH = path.join(process.cwd(), "scripts/eslint/require-content-bounds.baseline.json");

/**
 * Geometry writes that place a component within its parent's frame.
 * `centerInHeight` is one: it takes the row height a child is to be centred in
 * and pins the child's height and line-height to it.
 */
const GEOMETRY_SETTERS = new Set([
    "setX", "setY", "setWidth", "setHeight", "setSize", "centerInHeight",
]);

/** Reads of a component's OUTER box — border and padding included. */
const OUTER_BOX_READS = new Set(["getWidth", "getHeight", "getSize"]);

/** Reads of the extent inside the border and padding, but not of the origin. */
const INNER_BOX_READS = new Set(["getInnerSize"]);

/**
 * Class constants that name the component's own outer extent. A fixed-size
 * component (`Notification`, `MenuItem`) lays out against `Self.WIDTH` /
 * `Self.HEIGHT` rather than a getter, which is the same border-box placement
 * written as a compile-time constant. Matched only against the *enclosing*
 * class's name, so a sibling's constant — or a child extent like
 * `Notification.BADGE_SIZE` — is not mistaken for the outer box.
 */
const OUTER_BOX_CONSTANTS = new Set(["WIDTH", "HEIGHT"]);

/**
 * Reads that prove the method knows a component has a perimeter, so any box it
 * names is excused. `getContentBounds()` is the rectangle children may occupy,
 * and `getBorderSize()` is the longhand — a method that subtracts the border by
 * hand (`Popover.positionArrow` centres its arrow on the popover's *outer* edge
 * and needs the border width to do it) is not blind to the border, whatever
 * else it may be. `getPerimeterSize()` joins them for the same reason: it is
 * defined as insets plus border plus padding per side, so a method that reads
 * it cannot be computed without the border either. Matched per receiver:
 * reading a *peer's* content box says nothing about this component's own.
 */
const BORDER_AWARE_READS = new Set(["getContentBounds", "getBorderSize", "getPerimeterSize"]);

/**
 * Reads that fix only the ORIGIN. `getContentInsets()` deliberately excludes
 * the border (`Component.getContentInsets`) because a child's containing block
 * is already the padding box, so it is exactly what an origin needs and says
 * nothing about the extent. It therefore excuses the origin-only defect and
 * not an extent taken from the outer box. Like the border-aware escape it is
 * whole-method: the rule sees that the method obtained an origin, not that it
 * used one for every child.
 */
const ORIGIN_AWARE_READS = new Set(["getContentInsets"]);

/**
 * Methods whose argument is the component's own outer box by contract, so an
 * implementation that hands that argument to a child is placing against the
 * outer box without reading anything.
 */
const BOX_ARGUMENT_METHODS = new Set(["setWidth", "setHeight", "setSize", "layoutChildren"]);

/**
 * A stable key for a call's receiver when it is this component or something it
 * owns — `"this"`, or `"this.<field>"` — and `null` for anything else. Both
 * own-receiver forms answer for the same frame: `VirtualScroller` places its
 * scrollbars against `this._owner.getWidth()` and appends them to the owner's
 * element, so the owner's border pushes them out exactly as its own would. A
 * receiver reached any other way — a parameter, a local, a peer — belongs to
 * some other component, which is what keeps every `LayoutManager` out of this
 * rule by construction. Keying rather than merely testing lets the border-aware
 * escape be matched to the receiver the box actually came from.
 */
function ownReceiver(node) {
    if (node.type === "ThisExpression") {
        return "this";
    }

    if (node.type === "MemberExpression"
        && !node.computed
        && node.object.type === "ThisExpression"
        && node.property.type === "Identifier") {
        return "this." + node.property.name;
    }

    return null;
}

/** The non-computed property name a call's callee names, or null. */
function calleeProperty(node) {
    if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression" || node.callee.computed) {
        return null;
    }

    return node.callee.property.type === "Identifier" ? node.callee.property.name : null;
}

/**
 * Walks every node under `root`, including nested arrow functions and
 * callbacks — a child placed inside a `forEach` is placed just the same.
 *
 * `selfWrite` tells the visitor it is inside the arguments of a call that writes
 * this component's OWN geometry — `this.setSize(…)` and friends. A box read
 * there feeds this component's own size rather than a child's position:
 * `ProgressSpinner.doLayout` adopts an overlay target's size with
 * `this.setSize({ width: this._target.getWidth(), … })`, which is not a
 * placement against any frame and must not be reported as one. Deliberately
 * narrow: the arguments of any *other* `this.<method>(…)` — a batch, a
 * scheduler, a callback runner — place children in the ordinary way.
 */
function walk(root, visit, selfWrite = false) {
    if (!root || typeof root.type !== "string") {
        return;
    }

    visit(root, selfWrite);

    const opensSelfWrite = root.type === "CallExpression"
        && root.callee.type === "MemberExpression"
        && root.callee.object.type === "ThisExpression"
        && root.callee.property.type === "Identifier"
        && GEOMETRY_SETTERS.has(root.callee.property.name);

    for (const key of Object.keys(root)) {
        if (key === "parent") {
            continue;
        }

        // Once inside a self-write's arguments every descendant stays inside;
        // the callee is not an argument, so a self-write's own receiver chain
        // stays visitable at the outer level.
        const nested = selfWrite || (opensSelfWrite && key === "arguments");
        const child  = root[key];

        if (Array.isArray(child)) {
            child.forEach((c) => walk(c, visit, nested));
        } else {
            walk(child, visit, nested);
        }
    }
}

export default {
    meta: {
        type: "problem",
        docs: {
            description:
                "A method that places its own children must take the rectangle from " +
                "getContentBounds(), not from the component's outer width and height — " +
                "otherwise a border pushes the last child past the edge, where " +
                "overflow: hidden clips it.",
        },
        schema: [],
        messages: {
            outerBox:
                "\"{{method}}\" places children against this component's OUTER box " +
                "({{read}}), so a border pushes the last child past the edge, where " +
                "overflow: hidden clips it — take the rectangle from getContentBounds() " +
                "instead and fall back to the outer size only when it returns null.",
            innerOrigin:
                "\"{{method}}\" sizes children from getInnerSize() but places them from an " +
                "origin of its own, so this component's padding is subtracted from the " +
                "extent and then ignored in the position — take both from " +
                "getContentBounds(), whose origin is getContentInsets().",
            boxArgument:
                "\"{{method}}\" receives this component's OUTER box as its argument, so " +
                "placing children against it starts them inside the border and overruns " +
                "the opposite edge — take the rectangle from getContentBounds() and fall " +
                "back to the argument only when it returns null.",
        },
    },
    create(context) {
        const ignoreBaseline = !!process.env.REQUIRE_CONTENT_BOUNDS_IGNORE_BASELINE;
        let   baseline       = new Set();

        if (!ignoreBaseline && fs.existsSync(BASELINE_PATH)) {
            try {
                baseline = new Set(JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")));
            } catch {
                baseline = new Set();
            }
        }

        const relPath = path.relative(process.cwd(), context.filename).split(path.sep).join("/");

        return {
            MethodDefinition(method) {
                if (method.computed || method.key.type !== "Identifier" || !method.value.body) {
                    return;
                }

                // A static method has no `this` component and so has no
                // children to contain: Notification.restack() reads the class's
                // WIDTH / HEIGHT to position sibling windows in the viewport.
                if (method.static) {
                    return;
                }

                const className = method.parent.parent.id?.name ?? null;
                const name      = method.key.name;

                const borderAware = new Set();
                const originAware = new Set();

                let placesChild = false;
                let outerRead   = null;
                let innerRead   = null;

                walk(method.value.body, (node, selfWrite) => {
                    if (!selfWrite
                        && outerRead === null
                        && node.type === "MemberExpression"
                        && !node.computed
                        && node.object.type === "Identifier"
                        && node.object.name === className
                        && node.property.type === "Identifier"
                        && OUTER_BOX_CONSTANTS.has(node.property.name)) {
                        outerRead = { label: className + "." + node.property.name, receiver: "this" };
                    }

                    const property = calleeProperty(node);

                    if (property === null) {
                        return;
                    }

                    const receiver = ownReceiver(node.callee.object);

                    if (BORDER_AWARE_READS.has(property) && receiver !== null) {
                        borderAware.add(receiver);

                        return;
                    }

                    if (ORIGIN_AWARE_READS.has(property) && receiver !== null) {
                        originAware.add(receiver);

                        return;
                    }

                    // `this.setWidth(…)` is the layout manager writing to this
                    // component — already expressed in the parent's frame, and
                    // not a child placement. `super.setWidth(…)` is the same
                    // write chaining upward through an override.
                    if (GEOMETRY_SETTERS.has(property)
                        && node.callee.object.type !== "ThisExpression"
                        && node.callee.object.type !== "Super") {
                        placesChild = true;

                        return;
                    }

                    if (selfWrite || receiver === null) {
                        return;
                    }

                    if (OUTER_BOX_READS.has(property) && outerRead === null) {
                        outerRead = { label: property + "()", receiver };
                    } else if (INNER_BOX_READS.has(property) && innerRead === null) {
                        innerRead = { label: property + "()", receiver };
                    }
                });

                if (!placesChild) {
                    return;
                }

                // An outer-box read is the worse defect and wins the message;
                // the argument shape is the fallback for a method that reads no
                // box at all because it was handed one.
                let messageId = "outerBox";
                let box       = outerRead;

                if (box === null && innerRead !== null && !originAware.has(innerRead.receiver)) {
                    messageId = "innerOrigin";
                    box       = innerRead;
                }

                if (box === null && BOX_ARGUMENT_METHODS.has(name)) {
                    messageId = "boxArgument";
                    box       = { label: name, receiver: "this" };
                }

                if (box === null || borderAware.has(box.receiver)) {
                    return;
                }

                const key = relPath + ":" + (className ?? "<anonymous>") + "." + name;

                if (baseline.has(key)) {
                    return;
                }

                context.report({
                    node:      method.key,
                    messageId: messageId,
                    data:      { method: name, read: box.label },
                });
            },
        };
    },
};
