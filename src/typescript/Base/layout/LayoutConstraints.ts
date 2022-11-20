import { FillType } from "./FillType";
import { AnchorType } from "./AnchorType";
import { Placement } from "../Placement";

export class LayoutConstraints {
    name?: string | null = null;
    description?: string | null = null;
    fill?: FillType | null = null;
    anchor?: AnchorType | null = null;
    placement?: Placement;
    ignoreParentInsets?: boolean = false;
    data?: any;

    constructor() {
    }
}