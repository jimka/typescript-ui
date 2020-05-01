/**
 * FastDom
 *
 * Eliminates layout thrashing
 * by batching DOM read/write
 * interactions.
 *
 * @author Wilson Page <wilsonpage@me.com>
 * @author Kornel Lesinski <kornel.lesinski@ft.com>
 */
export class FastDom {
    /**
     * Mini logger
     *
     * @return {Function}
     */
    private static readonly INFO = console.info.bind(console, '[fastdom]');
    private static readonly ERROR = console.error.bind(console, '[fastdom]');
    private static readonly INSTANCE = new FastDom();

    static measure(func: Function, ctx?: any) {
        return FastDom.INSTANCE.internalMeasure(func, ctx);
    }

    static mutate(func: Function, ctx?: any) {
        return FastDom.INSTANCE.internalMutate(func, ctx);
    }

    static mutateElementStyle(element: HTMLElement, style: string, value: string) {
        return FastDom.INSTANCE.internalMutateElementStyle(element, style, value);
    }

    static clear(task: Function) {
        return FastDom.INSTANCE.internalClear(task);
    }

    static setExceptionHandler(handler: Function) {
        FastDom.INSTANCE.exceptionHandler = handler;
    }

    static getExceptionHandler() {
        return FastDom.INSTANCE.exceptionHandler;
    }

    static clearExceptionHandler() {
        FastDom.INSTANCE.exceptionHandler = null;
    }

    // override this with a function
    // to prevent Errors in console
    // when tasks throw
    private exceptionHandler: Function | null = null;
    private reads: Array<Function> = [];
    private writes: Array<Function> = [];
    private scheduled: boolean = false;

    //private elementStyleReads: Map<HTMLElement, Map<string, string>> = new Map<HTMLElement, Map<string, string>>();
    private elementStyleWrites: Map<HTMLElement, Map<string, string>> = new Map<HTMLElement, Map<string, string>>();

    private constructor() {
        // Singleton class
    }

    /**
     * We run this inside a try catch
     * so that if any jobs error, we
     * are able to recover and continue
     * to flush the batch until it's empty.
     *
     * @param {Array} tasks
     */
    private runTasks(tasks: Array<Function>) {
        FastDom.INFO('run tasks');

        var task: Function | undefined;
        while (task = tasks.shift()) {
            task();
        }
    }

    private setStyles(styles: Map<HTMLElement, Map<string, string>>) {
        FastDom.INFO('set styles');

        styles.forEach((values: Map<string, string>, element: HTMLElement) => {
            values.forEach((value: string, style: string) => {
                element.style.setProperty(style, value);
            });
        });

        styles.clear();
    }

    /**
     * Adds a job to the read batch and
     * schedules a new frame if need be.
     *
     * @param  {Function} func
     * @param  {Object} ctx the context to be bound to `func` (optional).
     * @public
     */
    internalMeasure(func: Function, ctx?: any): Function {
        FastDom.INFO('measure');

        var task = !ctx ? func : func.bind(ctx);

        this.reads.push(task);
        this.scheduleFlush();

        return task;
    }


    /**
     * Adds a job to the
     * write batch and schedules
     * a new frame if need be.
     *
     * @param  {Function} func
     * @param  {Object} ctx the context to be bound to `func` (optional).
     * @public
     */
    private internalMutate(func: Function, ctx?: any): Function {
        FastDom.INFO('mutate');

        var task = !ctx ? func : func.bind(ctx);

        this.writes.push(task);
        this.scheduleFlush();

        return task;
    }

    private internalMutateElementStyle(element: HTMLElement, style: string, value: string) {
        FastDom.INFO('mutateElementStyle');

        let map = this.elementStyleWrites.get(element);
        if (!map) {
            map = new Map<string, string>();
            this.elementStyleWrites.set(element, map);
        }

        map.set(style, value);

        this.scheduleFlush();
    }

    /**
   * Clears a scheduled 'read' or 'write' task.
   *
   * @param {Object} task
   * @return {Boolean} success
   * @public
   */
    private internalClear(task: Function): boolean {
        FastDom.INFO('clear', task);

        return this.remove(this.reads, task) || this.remove(this.writes, task);
    }

    /**
     * Schedules a new read/write
     * batch if one isn't pending.
     *
     * @private
     */
    private scheduleFlush() {
        if (this.scheduled) {
            return;
        }

        this.scheduled = true;
        requestAnimationFrame(this.flush.bind(this));

        FastDom.INFO('flush scheduled');
    }

    /**
     * Remove an item from an Array.
     *
     * @param  {Array} array
     * @param  {*} item
     * @return {Boolean}
     */
    private remove(array: Array<Function>, item: Function): boolean {
        var index = array.indexOf(item);
        if (index == -1) {
            return false;
        }

        return !!array.splice(index, 1);
    }

    /**
     * Runs queued `read` and `write` tasks.
     *
     * Errors are caught and thrown by default.
     * If a `.catch` function has been defined
     * it is called instead.
     *
     * @private
     */
    private flush() {
        FastDom.INFO('flush');

        let writes = this.writes;
        let reads = this.reads;
        let elementStyleWrites = this.elementStyleWrites;
        let error;

        try {
            FastDom.INFO('flushing reads', reads.length);
            this.runTasks(reads);
            FastDom.INFO('flushing styles', elementStyleWrites.size);
            this.setStyles(elementStyleWrites);
            FastDom.INFO('flushing writes', writes.length);
            this.runTasks(writes);
        } catch (e) {
            error = e;
        }

        this.scheduled = false;

        // If the batch errored we may still have tasks queued
        if (reads.length || writes.length || elementStyleWrites.size) {
            this.scheduleFlush();
        }

        if (error) {
            FastDom.ERROR('task errored', error.message);
            if (this.exceptionHandler) {
                this.exceptionHandler(error);
            } else {
                throw error;
            }
        }
    }
}
