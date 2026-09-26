// qa-price.py, the platform-call price analyser, offline over the fixtures in
// fixtures/price/: one census report, and one pricing cell of eleven reports —
// three plain arms around two dose ladders, `plat.intl` and `plat.collate`
// (see plans/implemented/platform-call-cost-sweep.md, *Expected Behaviour*).
// Runs the script as the orchestrator does, with python3, and reads its
// printed lines. Nothing here opens a window.
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, '../bin/qa-price.py');
const FIXTURES = path.join(HERE, 'fixtures');
const PRICE = path.join(FIXTURES, 'price');

/** The census prefix: one plain run of one panel, as batch `p00` writes. */
const CENSUS = 'plats0-p00-fx-';

/** The pricing cell's prefix. */
const CELL = 'plats0-p02-fx-';

/** The date formatter the cases price; `plat.intl`'s counter. */
const DATE = 'date.toLocaleDateString';

/** The collation the cases price; `plat.collate`'s counter. */
const COLLATE = 'string.localeCompare';

/** Temporary directories a case made, removed after it. */
const tempDirs: string[] = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
});

/**
 * Runs qa-price.py with `args`.
 *
 * @param args - The script's arguments.
 * @returns Its exit status and its printed lines.
 */
function qaPrice(args: string[]): { status: number | null; stdout: string; lines: string[] } {
    const result = spawnSync('python3', ['-B', SCRIPT, ...args], { encoding: 'utf8' });

    return { status: result.status, stdout: result.stdout, lines: result.stdout.trimEnd().split('\n') };
}

/** A fixture report, as far as these cases change it. */
interface FixtureReport {
    phases: Array<{
        driver: string;
        work: Record<string, number>;
        plat: Record<string, number>;
        timing: { avgMs: number };
    }>;
}

/**
 * Copies a fixture prefix into a temporary directory, letting `change` edit
 * each report on the way.
 *
 * @param prefix - The run-name prefix to copy.
 * @param change - Edits one report, given its file name.
 * @returns The directory.
 */
function cellCopy(prefix: string, change: (report: FixtureReport, file: string) => void): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-price-'));

    tempDirs.push(dir);

    for (const file of fs.readdirSync(PRICE).filter((name) => name.startsWith(prefix))) {
        const report = JSON.parse(fs.readFileSync(path.join(PRICE, file), 'utf8')) as FixtureReport;

        change(report, file);
        fs.writeFileSync(path.join(dir, file), JSON.stringify(report));
    }

    return dir;
}

/**
 * The line of one ladder rung or summary: the lines are keyed by the name in
 * their first column, so a rung reads `plat.intl-d1 …` and its ladder's
 * summary lines read `plat.intl …`.
 *
 * @param lines - The script's lines.
 * @param label - The rung's or the ladder's name.
 * @param what - Text the wanted line holds, for a ladder's two summary lines.
 * @returns The line.
 */
function labelled(lines: string[], label: string, what: string = ''): string {
    return lines.find((line) => line.trimStart().startsWith(`${label} `) && line.includes(what))!;
}

/**
 * A copy of the pricing cell whose `plat.collate` ladder is flat: both rungs
 * inside the plain bracket, and one collation and one extra operation a unit,
 * so Gate 3 has no ceiling to read and the drop row decides.
 *
 * @returns The directory.
 */
function flatCollateCell(): string {
    return cellCopy(CELL, (report, file) => {
        const [phase] = report.phases;

        // One collation a unit on every report, plain ones included: the count
        // Gate 3's drop row reads comes from the plain arms.
        phase.plat[COLLATE] = 1.0;

        if (!file.includes('plat.collate-')) {
            return;
        }

        phase.timing.avgMs = 101.0;

        for (const key of Object.keys(phase.work).filter((k) => k.startsWith('dose.'))) {
            phase.work[key] = 1.0;
        }
    });
}

describe('P1 census mode', () => {
    it('prints one line per non-zero counter, with the Gate 1 arithmetic', () => {
        const { status, lines } = qaPrice([PRICE, CENSUS, '--census']);

        expect(status).toBe(0);
        expect(lines).toHaveLength(2);
        expect(lines[0]).toBe(`plats0-p00-fx-plain-a  table-rows  0 click ×150  avg 100.00  ${DATE}  10.00/u  0.10/ms  prior 90µs → 0.90 ms/u (0.9%)  → price`);
        expect(lines[1]).toMatch(new RegExp(`${COLLATE.replace('.', '\\.')} {2}50\\.00/u .*prior 5µs .*→ skip$`));
    });

    it('prints nothing for a phase with no platform counters, and still exits 0', () => {
        const dir = cellCopy(CENSUS, (report) => {
            delete (report.phases[0] as { plat?: unknown }).plat;
        });

        const { status, stdout } = qaPrice([dir, CENSUS, '--census']);

        expect(status).toBe(0);
        expect(stdout).toBe('');
    });
});

describe('P2 pricing mode', () => {
    it('prices the plat.intl ladder and plans it', () => {
        const { status, lines } = qaPrice([PRICE, CELL, '--call', DATE, '--ladder', 'plat.intl']);

        expect(status).toBe(0);
        expect(lines[0]).toBe(`phase 0  click ×150  call ${DATE}`);
        expect(labelled(lines, 'plain')).toMatch(/3 reps {2}mean 101\.00 {2}bracket 2\.00 {2}count 100\.00\/u$/);
        expect(labelled(lines, 'plat.intl-d1')).toMatch(/2 reps {2}mean 112\.00 {2}Δms \+11\.00 outside {2}extra 100\.00\/u {2}price 110\.0 µs$/);
        expect(labelled(lines, 'plat.intl-d4')).toMatch(/2 reps {2}mean 144\.00 {2}Δms \+43\.00 outside {2}extra 400\.00\/u {2}price 107\.5 µs {2}fidelity 4\.00x$/);
        expect(labelled(lines, 'plat.intl', 'linearity')).toMatch(/linearity 2\.3% {2}ok$/);
        expect(labelled(lines, 'plat.intl', 'ceiling')).toMatch(/ceiling 11\.00 ms\/u {2}share 10\.9% {2}→ plan it$/);
    });

    it('reads the plat.collate ladder off its upper rung and asks for a removal arm', () => {
        const { lines } = qaPrice([PRICE, CELL, '--call', COLLATE, '--ladder', 'plat.collate']);

        expect(labelled(lines, 'plat.collate-d1')).toMatch(/Δms \+1\.00 inside {2}extra 100\.00\/u$/);
        expect(labelled(lines, 'plat.collate-d4')).toMatch(/Δms \+8\.00 outside {2}extra 400\.00\/u {2}price 20\.0 µs {2}fidelity 4\.00x$/);
        expect(labelled(lines, 'plat.collate', 'ceiling')).toMatch(/ceiling 2\.00 ms\/u {2}share 2\.0% {2}→ needs a removal arm$/);

        // Only one rung cleared the bracket, so there are no two prices to
        // compare and no linearity to read.
        expect(labelled(lines, 'plat.collate', 'linearity')).toBeUndefined();
    });

    it('drops a call too rare to reach a millisecond a unit at any price', () => {
        const { lines } = qaPrice([flatCollateCell(), CELL, '--call', COLLATE, '--ladder', 'plat.collate']);

        expect(labelled(lines, 'plain')).toMatch(/count 1\.00\/u$/);
        expect(labelled(lines, 'plat.collate', 'ceiling')).toMatch(/no ceiling {2}→ drop it$/);
    });

    it('flags a rung that did not reach every call site the first one did', () => {
        const dir = cellCopy(CELL, (report, file) => {
            if (file.includes('plat.collate-d4-')) {
                report.phases[0].work['dose.plat.collate-d4.extraCall'] = 300.0;
            }
        });

        expect(labelled(qaPrice([dir, CELL, '--call', COLLATE, '--ladder', 'plat.collate']).lines, 'plat.collate-d4')).toMatch(/fidelity FIDELITY$/);
    });

    it('sums the counts of every --call key and names them all', () => {
        const { lines } = qaPrice([PRICE, CELL, '--call', `${DATE}+${COLLATE}`, '--ladder', 'plat.intl']);

        expect(lines[0]).toBe(`phase 0  click ×150  call ${DATE}+${COLLATE}`);
        expect(labelled(lines, 'plain')).toMatch(/count 200\.00\/u$/);
    });

    it('counts a key no report carries as zero rather than failing', () => {
        const { status, lines } = qaPrice([flatCollateCell(), CELL, '--call', 'canvas.measureText', '--ladder', 'plat.collate']);

        expect(status).toBe(0);
        expect(labelled(lines, 'plain')).toMatch(/count 0\.00\/u$/);
        expect(labelled(lines, 'plat.collate', 'ceiling')).toMatch(/no ceiling {2}→ drop it$/);
    });
});

describe('P3 failures', () => {
    it('exits 1 for a cell with one plain report', () => {
        const dir = cellCopy(CELL, () => {});

        for (const file of fs.readdirSync(dir).filter((name) => name.includes('plain-b') || name.includes('plain-c'))) {
            fs.rmSync(path.join(dir, file));
        }

        const { status, lines } = qaPrice([dir, CELL, '--call', DATE, '--ladder', 'plat.intl']);

        expect(status).toBe(1);
        expect(lines[0]).toMatch(/^ERROR fewer than two plain reports$/);
    });

    it('exits 1 for an unreadable report and for one carrying an error', () => {
        const dir = cellCopy(CELL, () => {});

        fs.writeFileSync(path.join(dir, `${CELL}plain-b-1005.json`), 'not json');

        expect(qaPrice([dir, CELL, '--call', DATE, '--ladder', 'plat.intl']).status).toBe(1);
        expect(qaPrice([FIXTURES, 'report-error', '--call', DATE, '--ladder', 'plat.intl']).status).toBe(1);
    });

    it('exits 1 when the reports\' phases differ', () => {
        const dir = cellCopy(CELL, (report, file) => {
            if (file.includes('plain-c')) {
                report.phases[0].driver = 'key';
            }
        });

        const { status, lines } = qaPrice([dir, CELL, '--call', DATE, '--ladder', 'plat.intl']);

        expect(status).toBe(1);
        expect(lines[0]).toMatch(/^ERROR the reports' phases differ: /);
    });

    it('exits 2 for a bad mode or a bad --call', () => {
        expect(qaPrice([PRICE, CELL]).status).toBe(2);
        expect(qaPrice([PRICE, CELL, '--census', '--call', DATE]).status).toBe(2);
        expect(qaPrice([PRICE, CELL, '--call', `${DATE}+`, '--ladder', 'plat.intl']).status).toBe(2);
        expect(qaPrice([PRICE, CELL, '--call', '', '--ladder', 'plat.intl']).status).toBe(2);
    });

    it('exits 2 rather than judge every ladder of a cell against one call\'s count', () => {
        // Gate 3's count is the --call count, which belongs to one call, so a
        // two-ladder cell has to name the ladder being priced.
        expect(qaPrice([PRICE, CELL, '--call', DATE]).status).toBe(2);
        expect(qaPrice([PRICE, CELL, '--call', DATE, '--ladder', 'plat.nosuch']).status).toBe(2);
        expect(qaPrice([PRICE, CELL, '--call', DATE, '--ladder', 'plat.intl']).status).toBe(0);
    });
});
