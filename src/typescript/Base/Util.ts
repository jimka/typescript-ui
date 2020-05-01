export namespace Util {

    let scrollBarWidth: number = -1;

    export function generateUUID() {
        let uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            let r = Math.random() * 16 | 0,
                v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });

        let first = parseInt(uuid[0]);
        if (Util.isInteger(first)) {
            uuid = "a" + uuid.substring(1, uuid.length);
        }

        return uuid;
    }

    export function isInteger(value: Object) {
        return Number(value) != NaN;
    }

    export function select(selector: string): HTMLElement {
        return document.querySelector(selector) as HTMLElement;
    }

    export function getViewportSize() {
        var width = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
        var height = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);

        return {
            width: width,
            height: height
        };
    }

    export function calculateScrollBarWidth() {
        var scr = null;
        var inn = null;
        var wNoScroll = 0;
        var wScroll = 0;

        // Outer scrolling div
        scr = document.createElement('div');
        scr.style.position = 'absolute';
        scr.style.top = '-1000px';
        scr.style.left = '-1000px';
        scr.style.width = '100px';
        scr.style.height = '50px';

        // Start with no scrollbar
        scr.style.overflow = 'hidden';

        // Inner content div
        inn = document.createElement('div');
        inn.style.width = '100%';
        inn.style.height = '200px';

        // Put the inner div in the scrolling div
        scr.appendChild(inn);

        // Append the scrolling div to the doc
        document.body.appendChild(scr);

        // Width of the inner div sans scrollbar
        wNoScroll = inn.offsetWidth;

        // Add the scrollbar
        scr.style.overflow = 'auto';

        // Width of the inner div width scrollbar
        wScroll = inn.offsetWidth;

        // Remove the scrolling div from the doc
        document.body.removeChild(<Node>document.body.lastChild);

        // Pixel width of the scroller
        scrollBarWidth = (wNoScroll - wScroll);

        return scrollBarWidth;
    }

    export function getScrollBarWidth() {
        if (scrollBarWidth < 0) {
            calculateScrollBarWidth();
        }

        return scrollBarWidth;
    }
}
