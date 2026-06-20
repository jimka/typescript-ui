// PROTOTYPE leak-safety proof. Run with:  node --expose-gc scripts/handle-seam-gc-proof.mjs
//
// Demonstrates that a WEAKLY-interned node (a browser-supplied element the
// framework never owns) is evicted from the registry once the live DOM drops
// it — so interning event targets / query results / activeElement can never
// leak, even if the handle is never released. Mirrors the HandleRegistry intern
// path; standalone (no jsdom) so it can drive real GC.

if (typeof globalThis.gc !== 'function') {
    console.error('Run with --expose-gc:  node --expose-gc scripts/handle-seam-gc-proof.mjs');
    process.exit(1);
}

const forward   = new Map();                 // handle -> WeakRef<node>
const reverse   = new WeakMap();             // node -> handle
let   next      = 1;
const finalizer = new FinalizationRegistry((handle) => forward.delete(handle));

function intern(node) {
    const existing = reverse.get(node);
    if (existing !== undefined) return existing;
    const handle = next++;
    forward.set(handle, new WeakRef(node));
    reverse.set(node, handle);
    finalizer.register(node, handle);
    return handle;
}

async function main() {
    // Intern 1000 "browser-supplied" nodes, then drop every strong reference to
    // them (as the live DOM would when a subtree is replaced).
    let nodes = [];
    for (let i = 0; i < 1000; i += 1) {
        nodes.push({ tag: 'div', i });       // plain objects stand in for Nodes
        intern(nodes[i]);
    }

    const afterIntern = forward.size;
    nodes = null;                            // drop the only strong refs

    // Give GC + the finalizer queue a few turns to run.
    for (let pass = 0; pass < 10; pass += 1) {
        globalThis.gc();
        await new Promise((r) => setTimeout(r, 0));
    }

    const afterGC = forward.size;

    console.log(`interned:        ${afterIntern}`);
    console.log(`after GC + drain: ${afterGC}`);

    if (afterGC === 0) {
        console.log('PASS — every weakly-interned handle was evicted; interning cannot leak.');
        process.exit(0);
    } else {
        console.log(`FAIL — ${afterGC} handles still pinned after GC.`);
        process.exit(1);
    }
}

main();
