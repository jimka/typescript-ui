import { BaseObject } from "./BaseObject.js";

export class Insets extends BaseObject {

    private top: number;
    private right: number;
    private bottom: number;
    private left: number;

    constructor(top: number, right: number, bottom: number, left: number) {
        super();

        this.top = top || 0;
        this.right = right || 0;
        this.bottom = bottom || 0;
        this.left = left || 0;
    }

    getTop() {
        return this.top || 0;
    }

    setTop(value: number) {
        this.top = value;
    }

    getRight() {
        return this.right || 0;
    }

    setRight(value: number) {
        this.right = value;
    }

    getBottom() {
        return this.bottom || 0;
    }

    setBottom(value: number) {
        this.bottom = value;
    }

    getLeft() {
        return this.left || 0;
    }

    setLeft(value: number) {
        this.left = value;
    }

    set(top: number, right: number, bottom: number, left: number) {
        this.top = top;
        this.right = right;
        this.bottom = bottom;
        this.left = left;
    }

    render() {
        return this.getTop() + " " + this.getRight() + " " + this.getBottom() + " " + this.getLeft();
    }
};