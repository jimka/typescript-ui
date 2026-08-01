import { RuleTester } from "eslint";
import tsParser from "@typescript-eslint/parser";
import rule from "./require-content-bounds.js";

const tester = new RuleTester({ languageOptions: { parser: tsParser } });

tester.run("require-content-bounds", rule, {
    valid: [
        // The canonical shape: the origin comes from the content box, so a
        // border shrinks the rectangle instead of pushing the last child out.
        "class C extends B { doLayout() { const box = this.getContentBounds();"
            + " this._child.setX(box.x); this._child.setWidth(box.width); } }",
        // getContentInsets() + getInnerSize() is the same derivation spelled out
        // longhand — the form layout managers use.
        "class C extends B { doLayout() { const i = this.getContentInsets();"
            + " const s = this.getInnerSize(); this._child.setX(i.left);"
            + " this._child.setWidth(s.width); } }",
        // A layoutChildren implementation that takes the content box instead of
        // its arguments.
        "class C extends B { layoutChildren(width: number, height: number) {"
            + " const box = this.getContentBounds() ?? { x: 0, y: 0, width, height };"
            + " this._label.setX(box.x); this._label.setHeight(box.height); } }",
        // Reads the outer box but places no children — measuring, not placing.
        "class C extends B { getBaseline() { const h = this.getHeight(); return h / 2; } }",
        // Places children but never reads the outer box: the geometry comes from
        // elsewhere (a drag delta, a caller-supplied coordinate), so there is no
        // border-box confusion to make.
        "class C extends B { onDrag(dx: number) { this._handle.setX(this._startX + dx); } }",
        // Sets its OWN geometry, not a child's — that is the layout manager
        // writing to this component, and it is already in the parent's frame.
        "class C extends B { fit() { this.setWidth(this.getWidth()); } }",
        // A layout manager reads a CONTAINER it was handed, not its own box.
        // Deliberately no getContentInsets() call: the receiver is what makes
        // this valid, so exempting it any other way would leave that untested.
        "class M extends L { doLayout(container: Component) { const s = container.getSize();"
            + " child.setX(0); child.setWidth(s.width); } }",
        // A local holding some other component's box is not this component's
        // outer box either.
        "class C extends B { align(peer: Component) { const w = peer.getWidth();"
            + " this._marker.setWidth(w); } }",
        // `super.setWidth(w)` is this component's own setter chaining upward,
        // not a child placement — Text and Markdown both override setWidth to
        // re-measure and compare against this.getWidth().
        "class C extends B { setWidth(width: number) { const previous = this.getWidth();"
            + " super.setWidth(width); if (width !== previous) { this.measure(); } return this; } }",
        // A static method has no `this` component and therefore no children:
        // Notification.restack() positions sibling windows in the viewport
        // using the class's own WIDTH / HEIGHT constants.
        "class C extends B { static restack() { const x = vp.width - C.WIDTH;"
            + " for (const n of C.active) { n.setX(x); n.setY(y); y -= C.HEIGHT; } } }",
        // The fixed-size shape done right: the outer constants are still read,
        // but the placement comes off the content box.
        "class C extends B { doLayout() { const box = this.getContentBounds();"
            + " this._badge.setX(box.x); this._badge.setWidth(C.WIDTH - 8); } }",
        // Subtracting the border by hand is the longhand derivation, not
        // border-blindness — Popover.positionArrow deliberately centres its
        // arrow on the popover's OUTER edge and reads getBorderSize() to do it.
        "class C extends B { positionArrow() { const border = this.getBorderSize();"
            + " this._arrow.setX(this.getWidth() / 2 - border.left); } }",
        // Reading ANOTHER component's outer box to size THIS one is not a child
        // placement against this component's frame: ProgressSpinner covers an
        // overlay target by adopting its size, then places its arc separately.
        "class C extends B { doLayout() { this.setSize({ width: this._target.getWidth(),"
            + " height: this._target.getHeight() }); const box = this.getContentBounds();"
            + " this._arc.setX(box.x); } }",
        // A field receiver IS excused when the box came off that same field —
        // this is what VirtualScroller's fix will look like.
        "class C extends B { layoutScrollbars() { const box = this._owner.getContentBounds();"
            + " this._scrollbarV.setX(box.x + box.width - 12); } }",
        // A setWidth override that forwards nothing to a child only re-measures.
        "class C extends B { setWidth(width: number) { super.setWidth(width);"
            + " this.measureContentHeight(); return this; } }",
        // A sibling class's constant is not this component's outer box: only
        // the ENCLOSING class's WIDTH / HEIGHT are matched.
        "class C extends B { doLayout() { this._icon.setWidth(Other.WIDTH); } }",
        // Nor is one of this class's own constants that names a CHILD's extent
        // rather than its own box — Notification.BADGE_SIZE is 20, not 320.
        "class C extends B { doLayout() { this._badge.setWidth(C.BADGE_SIZE); } }",
        // KNOWN GAP, pinned so a change in it is deliberate: both escapes are
        // whole-method, so obtaining an origin excuses every child the method
        // places — including this one, still written against a literal 0. This
        // is what a half-finished conversion of ProgressBar or Slider looks
        // like, and the rule cannot tell it from a finished one.
        "class C extends B { doLayout() { const i = this.getContentInsets();"
            + " const s = this.getInnerSize(); this._child.setX(0);"
            + " this._child.setWidth(s.width); } }",
        // Nothing to do with layout at all.
        "class C extends B { setText(t: string) { this._text = t; } }",
    ],

    invalid: [
        {
            // The headline defect: children placed at the outer box's origin and
            // sized to its extent, so the last one overruns the border.
            code: "class C extends B { doLayout() { this._child.setX(0);"
                + " this._child.setWidth(this.getWidth()); } }",
            errors: [{ messageId: "outerBox" }],
        },
        {
            // getSize() is the same read in one call.
            code: "class C extends B { doLayout() { const s = this.getSize();"
                + " this._child.setWidth(s.width); this._child.setHeight(s.height); } }",
            errors: [{ messageId: "outerBox" }],
        },
        {
            // Not named doLayout — the method name is irrelevant, placing
            // children is what matters. This is the TreeRow shape.
            code: "class C extends B { layoutRow(indent: number) { this._toggle.setX(indent);"
                + " this._toggle.setHeight(this.getHeight()); } }",
            errors: [{ messageId: "outerBox" }],
        },
        {
            // A child placed inside a callback still counts.
            code: "class C extends B { doLayout() { const h = this.getHeight();"
                + " this._children.forEach((c) => c.setHeight(h)); } }",
            errors: [{ messageId: "outerBox" }],
        },
        {
            // layoutChildren's arguments ARE the outer box, so an implementation
            // that never consults the content box has the same defect even
            // though it reads no getter.
            code: "class C extends B { layoutChildren(width: number, height: number) {"
                + " this._label.setX(0); this._label.setWidth(width);"
                + " this._label.setHeight(height); } }",
            errors: [{ messageId: "boxArgument" }],
        },
        {
            // A fixed-size component lays out against its own WIDTH / HEIGHT
            // constants rather than a getter — the same border-box placement
            // written as a compile-time constant. This is Notification.doLayout.
            code: "class C extends B { doLayout() { const msgW = C.WIDTH - 48;"
                + " this._message.setX(8); this._message.setWidth(msgW);"
                + " this._message.setHeight(C.HEIGHT - 16); } }",
            errors: [{ messageId: "outerBox" }],
        },
        {
            // centerInHeight pins a child's height to the row height it is
            // handed, so passing the OUTER height is the same defect. This is
            // MenuItem, and it happens in the constructor.
            code: "class C extends B { constructor() { super();"
                + " this._title.centerInHeight(C.HEIGHT); } }",
            errors: [{ messageId: "outerBox" }],
        },
        {
            // A sibling class's constant is not this component's outer box, but
            // reading this.getHeight() still is.
            code: "class C extends B { doLayout() { this._icon.setWidth(Other.WIDTH);"
                + " this._icon.setHeight(this.getHeight()); } }",
            errors: [{ messageId: "outerBox" }],
        },
        {
            // setSize writes both axes at once, so it places a child exactly as
            // setWidth and setHeight do — ProgressBar, Slider and Toggle all
            // size their children this way.
            code: "class C extends B { doLayout() { const s = this.getSize();"
                + " this._track.setSize(s); } }",
            errors: [{ messageId: "outerBox" }],
        },
        {
            // The owner's box reached through a field is still this component's
            // frame to answer for: VirtualScroller places its scrollbars against
            // this._owner.getWidth(), and they are appended to the owner's
            // element, so the owner's border pushes them out just the same.
            code: "class C extends B { layoutScrollbars() { const outer = this._owner.getWidth();"
                + " this._scrollbarV.setX(outer - 12); } }",
            errors: [{ messageId: "outerBox" }],
        },
        {
            // A content-box read on an unrelated receiver says nothing about
            // this method's own arithmetic and must not silence it.
            code: "class C extends B { doLayout() { const other = peer.getContentBounds();"
                + " this._child.setWidth(this.getWidth() - other.x); } }",
            errors: [{ messageId: "outerBox" }],
        },
        {
            // getInnerSize() is the right EXTENT and the wrong ORIGIN: a child
            // at 0 sits at the inner edge of the border, ignoring the padding
            // the inner size already subtracted. ProgressBar and Slider both
            // place their children this way.
            code: "class C extends B { doLayout() { const inner = this.getInnerSize();"
                + " this._track.setX(0); this._track.setWidth(inner.width); } }",
            errors: [{ messageId: "innerOrigin" }],
        },
        {
            // A setWidth override hands its argument — this component's OUTER
            // width — straight to a child. Table's Footer and Header do this.
            code: "class C extends B { setWidth(width: number) { super.setWidth(width);"
                + " this.getComponents()[0].setWidth(width); return this; } }",
            errors: [{ messageId: "boxArgument" }],
        },
        {
            // A border-aware read on a DIFFERENT receiver than the one the outer
            // box came from says nothing about this method's arithmetic, whether
            // that receiver is a bare name or one of this component's fields.
            code: "class C extends B { doLayout() { const other = this._peer.getContentBounds();"
                + " this._child.setWidth(this.getWidth() - other.x); } }",
            errors: [{ messageId: "outerBox" }],
        },
        {
            // getContentInsets() fixes the ORIGIN — it deliberately excludes
            // the border, because a child's containing block is already the
            // padding box. So it excuses an origin taken from `0`, and does
            // NOT excuse an extent taken from the outer box.
            code: "class C extends B { doLayout() { const i = this.getContentInsets();"
                + " this._child.setX(i.left); this._child.setWidth(this.getWidth()); } }",
            errors: [{ messageId: "outerBox" }],
        },
        {
            // Only a call that writes this component's own geometry hides its
            // arguments from the rule. Any other `this.<method>(…)` — a batch,
            // a scheduler, a callback runner — still places children in the
            // ordinary way and must still be reported.
            code: "class C extends B { doLayout() { this.batch(() => {"
                + " this._child.setWidth(this.getWidth()); }); } }",
            errors: [{ messageId: "outerBox" }],
        },
        {
            // One report per method, not one per write.
            code: "class C extends B { doLayout() { const s = this.getSize();"
                + " this._a.setX(0); this._a.setWidth(s.width); this._b.setX(0);"
                + " this._b.setWidth(s.width); } }",
            errors: 1,
        },
    ],
});

console.log("require-content-bounds: all tests passed.");
