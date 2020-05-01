import { BaseObject } from "./BaseObject.js";

export class Point extends BaseObject {
    private x: number;
    private y: number;

    constructor(x: number, y: number) {
        super();

        this.x = x || 0;
        this.y = y || 0;

    }

    getX() {
        return this.x || 0;
    }

    getY() {
        return this.y || 0;
    }

    render() {
        return this.getX() + " " + this.getY();
    }
}
