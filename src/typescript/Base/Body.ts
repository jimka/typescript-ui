import { Component } from "./Component.js";
import { Util } from "./Util.js";
import { Event } from "./Event.js";
import { Size } from "./Size.js";

/**
 * A [[Component]] used to access the page main body element.
 * For example:
 * ```
 * let body = Body.getInstance();
 * body.addComponent(....);
 * ```
 */
export class Body extends Component {

    private static readonly INSTANCE: Body = new Body();
    private canvas: CanvasRenderingContext2D | null = null;

    static getInstance() {
        return this.INSTANCE;
    }

    private constructor() {
        super("body");

        this.init();

        this.setBackgroundColor("rgb(241, 241, 241)");
    }

    getElement() {
        return Util.select("body");
    }

    getCanvas() {
        return this.canvas as CanvasRenderingContext2D;
    }

    private initCanvas() {
        let canvas = document.createElement("canvas") as HTMLCanvasElement
        canvas.style.display = "none";

        this.getElement().appendChild(canvas);

        this.canvas = canvas.getContext("2d");
    }

    protected init() {
        super.init();

        let viewportSize = Util.getViewportSize();

        let me = this;
        this.setSize(viewportSize);

        Event.addViewportResizeListener(function (size: Size) {
            me.setSize(size);
        });

        this.initCanvas();
    }
}