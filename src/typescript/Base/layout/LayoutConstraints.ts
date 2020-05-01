import { FillType } from "./FillType";
import { AnchorType } from "./AnchorType";
import { Placement } from "../Placement";

export class LayoutConstraints {
    name?: String | null = null;
    description?: String | null = null;
    fill?: FillType | null = null;
    anchor?: AnchorType | null = null;
    placement?: Placement;
    ignoreParentInsets?: boolean = false;
    data?: any;

    constructor() {
    }
}