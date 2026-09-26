#!/usr/bin/env python3
"""
Price one platform call: qa-price.py <results-dir> <prefix> (--census | --call KEY[+KEY...]) [--ladder NAME]

--census reads every <prefix>*.json and prints one line per run, phase and
non-zero `plat` counter, with the Gate 1 arithmetic that nominates a call for a
pricing cell. The default mode reads one pricing cell — plain arms around a
dose ladder — and prints the ladder's rungs, the call's ceiling in milliseconds
a unit and the Gate 3 verdict. Gate 3's count is the --call count, which belongs
to one call, so a cell holding more than one ladder must name the one being
priced with --ladder.

It owns no gate it shares with qa-ab.py: geometry, engagement and the `--same`
comparison stay there, and every pricing cell is read with both scripts. The
rules are plans/implemented/platform-call-cost-sweep.md's (*Architecture
Decisions*, Gates 1 to 3).

Exit 0 when every report was read; 1 for an unreadable or error report, a cell
with fewer than two plain reports, or reports whose phases differ; 2 for bad
arguments.
"""
import argparse
import glob
import json
import math
import os
import re
import sys
from dataclasses import dataclass

# The report format this script reads; `QaReport.schema` in the harness.
SCHEMA: int = 1

# The arm name the sweep gives a run with no ablation.
PLAIN: str = 'plain'

# A dose arm's name: its ladder, then the rung's dose factor. `plat.intl-d4` is
# the four-fold rung of ladder `plat.intl`.
DOSE_ARM = re.compile(r'^(?P<ladder>.+)-d(?P<factor>\d+)$')

# The work counter every dose arm keeps: one per extra priced operation.
EXTRA_CALL: str = 'dose.{arm}.extraCall'

# Microseconds in a millisecond; the priors are per call, the readings per unit.
US_PER_MS: float = 1000.0

# The prior per-call price of a date format, in microseconds: G23's own
# measurement, 29.04 ms over the 321 formats a unit of table-rows n=900.
DATE_PRIOR_US: float = 90.0

# The prior per-call price of any other counted platform call, in microseconds:
# G27's upper bound on one source read. No call below has a measurement of its
# own yet, so they are all nominated against that bound.
SOURCE_PRIOR_US: float = 5.0

# The calls with a measured prior; everything else takes SOURCE_PRIOR_US.
PRIOR_US: dict[str, float] = {
    'date.toLocaleDateString': DATE_PRIOR_US,
    'date.toLocaleTimeString': DATE_PRIOR_US,
    'date.toLocaleString': DATE_PRIOR_US,
}

# Gate 1's nomination floor, in microseconds a unit: half a millisecond, the
# floor of what any cell in this campaign has resolved. The tightest plain
# bracket recorded is 0.24 ms and the usual range is 1.4 to 3.8 ms, so a call
# that cannot reach this at its prior price cannot be read in a cell at all.
NOMINATION_FLOOR_US: float = 500.0

# Gate 3's row 1: a ceiling of at least this many milliseconds a unit, and at
# least this share of the phase's plain mean. Set from what the campaign could
# and could not resolve — G23's accepted win was 18.5% and 29 ms, while G21's
# rejected effect was 0.8% and 0.30 ms on a cell that resolves nothing below
# 2.5%. The absolute floor plays the part WORK_WIN_MIN_PER_UNIT plays in
# qa-ab.py: it stops a large share of a tiny absolute cost from passing.
PLAN_MIN_MS_PER_UNIT: float = 1.0
PLAN_MIN_SHARE: float = 0.05

# A rung's extra operations per unit, divided by the `-d1` rung's, must equal
# its dose factor within this share. Counts are deterministic, so 5% only
# absorbs the harness's rounding to hundredths; a ratio below the factor means
# the rung did not reach every call site the `-d1` rung did.
FIDELITY_TOLERANCE: float = 0.05

# The two rungs' implied per-operation prices may differ by at most this share
# of the `-d1` rung's reading before repeating the call is called non-linear.
# A failure is recorded beside the reading rather than voiding it, because the
# `-d1` rung stays the better estimate either way.
LINEARITY_TOLERANCE: float = 0.5

# Exit codes, as qa-ab.py's.
EXIT_OK: int = 0
EXIT_BAD_INPUT: int = 1
EXIT_BAD_ARGS: int = 2


@dataclass
class Run:
    """
    One successful report of the selected prefix.
    """

    name: str
    arm: str
    report: dict


@dataclass
class Rung:
    """
    One rung of one ladder in one phase.
    """

    arm: str
    factor: int
    reps: int
    mean: float
    delta_ms: float
    extra: float


def run_name(path: str) -> str:
    """
    The run's name: the file name without its `-<epoch ms>.json` suffix.

    Args:
        path: a result file.

    Returns:
        The run name.
    """
    return os.path.basename(path).rsplit('-', 1)[0]


def write_order(path: str) -> tuple[int, str]:
    """
    Sort key for a result file: its epoch-milliseconds suffix, which is the
    order the runs were written in and survives a checkout.

    Args:
        path: a result file.

    Returns:
        The epoch, or 0 when the suffix is not a number, then the name.
    """
    suffix = os.path.basename(path).rsplit('-', 1)[-1].removesuffix('.json')

    return (int(suffix) if suffix.isdigit() else 0, os.path.basename(path))


def load(path: str) -> dict | None:
    """
    Read one result file.

    Args:
        path: a result file.

    Returns:
        The report, or None when the file is not a readable JSON object.
    """
    try:
        with open(path, encoding='utf-8') as handle:
            report = json.load(handle)
    except (OSError, ValueError):
        return None

    return report if isinstance(report, dict) else None


def arm_of(name: str, prefix: str) -> str:
    """
    A run's arm: its name without the cell prefix and the trailing `-<rep>`.

    Args:
        name: the run name.
        prefix: the cell prefix.

    Returns:
        The arm name.
    """
    return name.removeprefix(prefix).rsplit('-', 1)[0]


def read_runs(results_dir: str, prefix: str) -> list[Run] | None:
    """
    Read the selected reports, printing an ERROR line for each that cannot be
    read.

    Args:
        results_dir: the results directory.
        prefix: the run-name prefix to select.

    Returns:
        The runs in write order, or None when any report could not be read.
    """
    files = sorted(glob.glob(os.path.join(results_dir, prefix + '*.json')), key=write_order)
    runs: list[Run] = []
    failed = False

    for path in files:
        name = run_name(path)
        report = load(path)

        if report is None or report.get('schema') != SCHEMA:
            print(f'ERROR {name} {"unreadable" if report is None else "old format"}')
            failed = True
        elif 'error' in report:
            print(f"ERROR {name} {report['error']}")
            failed = True
        else:
            runs.append(Run(name, arm_of(name, prefix), report))

    return None if failed else runs


def check_shape(runs: list[Run]) -> bool:
    """
    Check that the cell can be priced: at least two plain reports, and every
    report with the same phases, driver by driver.

    Args:
        runs: the cell's runs.

    Returns:
        True when it can; otherwise prints why and returns False.
    """
    if sum(1 for run in runs if run.arm == PLAIN) < 2:
        print(f'ERROR fewer than two {PLAIN} reports')

        return False

    drivers = {tuple(phase.get('driver') for phase in run.report.get('phases') or []) for run in runs}

    if len(drivers) != 1:
        print('ERROR the reports\' phases differ: ' + ' / '.join(','.join(map(str, d)) for d in sorted(drivers, key=str)))

        return False

    return True


def mean(values: list[float]) -> float:
    """
    The arithmetic mean. It sums with math.fsum, which rounds the same on every
    Python; sum() compensates from 3.12 on, so its last bits vary.

    Args:
        values: at least one value.

    Returns:
        Their mean.
    """
    return math.fsum(values) / len(values)


def signed(value: float, places: int) -> str:
    """
    A change, with its sign, to `places` decimals. One that rounds to zero
    prints as +0: the difference of two equal means can land a few ulps below
    zero, and would print as -0.

    Args:
        value: the change.
        places: the decimals to print.

    Returns:
        The printed change.
    """
    return f'{round(value, places) + 0.0:+.{places}f}'


def avg_ms(phase: dict) -> float:
    """
    A phase's average sample.

    Args:
        phase: one phase of a report.

    Returns:
        Its timing's avgMs.
    """
    return float((phase.get('timing') or {}).get('avgMs', 0.0))


def prior_us(key: str) -> float:
    """
    The prior per-call price a platform counter is nominated against.

    Args:
        key: a `plat` counter's key.

    Returns:
        Its prior price in microseconds.
    """
    return PRIOR_US.get(key, SOURCE_PRIOR_US)


def nomination_threshold(key: str) -> int:
    """
    Gate 1's threshold for one call: the calls a unit at which its prior price
    reaches the nomination floor.

    Args:
        key: a `plat` counter's key.

    Returns:
        The threshold, in calls per unit.
    """
    return math.ceil(NOMINATION_FLOOR_US / prior_us(key))


def drop_max_count() -> int:
    """
    Gate 3's drop row: the calls a unit below which a call cannot reach the
    planning floor even at the largest per-call price the campaign has
    measured.

    Returns:
        The threshold, in calls per unit.
    """
    return math.ceil(PLAN_MIN_MS_PER_UNIT * US_PER_MS / DATE_PRIOR_US)


def census_line(run: Run, index: int, phase: dict, key: str, count: float) -> str:
    """
    One census line: a counter's count per unit, per millisecond of the unit,
    what it would cost at its prior price, and whether Gate 1 nominates it.

    Args:
        run: the run the phase belongs to.
        index: the phase's index.
        phase: one phase of the report.
        key: the `plat` counter's key.
        count: its value per unit.

    Returns:
        The line.
    """
    avg = avg_ms(phase)
    prior = prior_us(key)
    estimate = count * prior / US_PER_MS
    verdict = 'price' if count >= nomination_threshold(key) else 'skip'

    return (f"{run.name}  {run.report.get('panel') or '-'}  {index} {phase.get('driver')} ×{phase.get('units')}"
            f'  avg {avg:.2f}  {key}  {count:.2f}/u  {count / avg if avg else 0.0:.2f}/ms'
            f'  prior {prior:.0f}µs → {estimate:.2f} ms/u ({estimate / avg * 100 if avg else 0.0:.1f}%)  → {verdict}')


def print_census(runs: list[Run]) -> None:
    """
    Print the census: one line per run, phase and non-zero platform counter.

    Args:
        runs: the runs, in write order.
    """
    for run in runs:
        for index, phase in enumerate(run.report.get('phases') or []):
            for key, count in (phase.get('plat') or {}).items():
                if count:
                    print(census_line(run, index, phase, key, count))


def call_count(phase: dict, keys: list[str]) -> float:
    """
    The counts of every `--call` key in one phase, summed. A key the phase does
    not carry counts 0: a count of zero is a real reading, not a missing one.

    Args:
        phase: one phase of a report.
        keys: the `--call` keys.

    Returns:
        Their sum per unit.
    """
    counters = phase.get('plat') or {}

    return math.fsum(float(counters.get(key, 0.0)) for key in keys)


def extra_calls(phase: dict, arm: str) -> float:
    """
    The extra priced operations one dose arm added in one phase.

    Args:
        phase: one phase of the arm's report.
        arm: the arm's name.

    Returns:
        Their count per unit; 0 when the arm counted none.
    """
    return float((phase.get('work') or {}).get(EXTRA_CALL.format(arm=arm), 0.0))


def read_rung(arm: str, phases: list[dict], plain_mean: float) -> Rung:
    """
    Read one rung: its mean, its change against the plain mean, and the extra
    operations it added.

    Args:
        arm: the rung's arm name.
        phases: this phase of each of the rung's reports.
        plain_mean: the plain arms' mean average.

    Returns:
        The rung.
    """
    arm_mean = mean([avg_ms(phase) for phase in phases])

    return Rung(
        arm=arm,
        factor=int(DOSE_ARM.match(arm)['factor']),
        reps=len(phases),
        mean=arm_mean,
        delta_ms=arm_mean - plain_mean,
        extra=mean([extra_calls(phase, arm) for phase in phases]),
    )


def ladders(runs: list[Run], index: int, plain_mean: float) -> dict[str, list[Rung]]:
    """
    The cell's dose ladders, in order of first appearance, each rung ascending
    by dose factor. An arm is paired into a ladder by stripping its trailing
    `-d<k>`; an arm without one is not a rung and is left out.

    Args:
        runs: the cell's runs.
        index: the phase's index.
        plain_mean: the plain arms' mean average.

    Returns:
        Ladder name → its rungs.
    """
    arms = list(dict.fromkeys(run.arm for run in runs if run.arm != PLAIN))
    out: dict[str, list[Rung]] = {}

    for arm in arms:
        match = DOSE_ARM.match(arm)

        if match is None:
            continue

        phases = [run.report['phases'][index] for run in runs if run.arm == arm]
        out.setdefault(match['ladder'], []).append(read_rung(arm, phases, plain_mean))

    for rungs in out.values():
        rungs.sort(key=lambda rung: rung.factor)

    return out


def rung_line(rung: Rung, base: Rung, bracket: float, width: int) -> str:
    """
    One rung's line: its mean and change, whether the change cleared the plain
    bracket, the extra operations it added, the price they imply, and — above
    the first rung — its dose fidelity.

    Args:
        rung: the rung.
        base: the ladder's lowest rung, whose extra operations fidelity is measured against.
        bracket: the plain arms' spread.
        width: the name column's width.

    Returns:
        The line.
    """
    outside = abs(rung.delta_ms) > bracket
    line = (f'  {rung.arm:{width}}  {rung.reps} reps  mean {rung.mean:.2f}'
            f'  Δms {signed(rung.delta_ms, 2)} {"outside" if outside else "inside"}  extra {rung.extra:.2f}/u')

    if outside and rung.extra:
        line += f'  price {rung.delta_ms * US_PER_MS / rung.extra:.1f} µs'

    if rung is not base:
        line += f'  fidelity {fidelity(rung, base)}'

    return line


def fidelity(rung: Rung, base: Rung) -> str:
    """
    A rung's dose fidelity: its extra operations per unit divided by the
    lowest rung's, which must equal its dose factor.

    Args:
        rung: the rung.
        base: the ladder's lowest rung.

    Returns:
        The ratio, or FIDELITY when it is outside the tolerance.
    """
    if not base.extra:
        return 'FIDELITY'

    ratio = rung.extra / base.extra
    expected = rung.factor / base.factor

    return f'{ratio:.2f}x' if abs(ratio - expected) <= expected * FIDELITY_TOLERANCE else 'FIDELITY'


def linearity_line(rungs: list[Rung], bracket: float, width: int, ladder: str) -> str | None:
    """
    The ladder's linearity line, when two rungs both cleared the plain bracket:
    a repeat the engine serves from a cache makes the upper rung's implied
    price fall short, and the reading a weaker lower bound than it looks.

    Args:
        rungs: the ladder's rungs, ascending.
        bracket: the plain arms' spread.
        width: the name column's width.
        ladder: the ladder's name.

    Returns:
        The line, or None when fewer than two rungs cleared the bracket.
    """
    cleared = [rung for rung in rungs if abs(rung.delta_ms) > bracket]

    if len(cleared) < 2 or not cleared[0].delta_ms:
        return None

    base, upper = cleared[0], cleared[-1]
    implied = upper.delta_ms * base.factor / upper.factor
    drift = abs(base.delta_ms - implied) / abs(base.delta_ms)

    return f'  {ladder:{width}}  linearity {drift * 100:.1f}%  {"ok" if drift <= LINEARITY_TOLERANCE else "NON-LINEAR"}'


def ceiling_of(rungs: list[Rung], bracket: float) -> float | None:
    """
    The call's ceiling: the lowest rung that cleared the plain bracket, divided
    by its dose factor. A dose measures the repeat of a call whose every cache
    is warm, so this is at most what removing the call would save.

    Args:
        rungs: the ladder's rungs, ascending.
        bracket: the plain arms' spread.

    Returns:
        The ceiling in milliseconds a unit, or None when no rung cleared it.
    """
    for rung in rungs:
        if abs(rung.delta_ms) > bracket:
            return rung.delta_ms / rung.factor

    return None


def verdict_of(ceiling: float | None, share: float, count: float) -> str:
    """
    Gate 3's verdict: the first row that applies.

    Args:
        ceiling: the call's ceiling, or None when no rung resolved one.
        share: the ceiling as a share of the phase's plain mean.
        count: the call's census count per unit.

    Returns:
        `plan it`, `drop it` or `needs a removal arm`.
    """
    if ceiling is not None and ceiling >= PLAN_MIN_MS_PER_UNIT and share >= PLAN_MIN_SHARE:
        return 'plan it'

    if count < drop_max_count():
        return 'drop it'

    return 'needs a removal arm'


def ceiling_line(rungs: list[Rung], bracket: float, plain_mean: float, count: float, width: int, ladder: str) -> str:
    """
    The ladder's verdict line: the ceiling, its share of the phase's plain
    mean, and Gate 3's verdict.

    Args:
        rungs: the ladder's rungs, ascending.
        bracket: the plain arms' spread.
        plain_mean: the plain arms' mean average.
        count: the `--call` count per unit.
        width: the name column's width.
        ladder: the ladder's name.

    Returns:
        The line.
    """
    ceiling = ceiling_of(rungs, bracket)
    share = ceiling / plain_mean if ceiling is not None and plain_mean else 0.0
    reading = 'no ceiling' if ceiling is None else f'ceiling {ceiling:.2f} ms/u  share {share * 100:.1f}%'

    return f'  {ladder:{width}}  {reading}  → {verdict_of(ceiling, share, count)}'


def print_pricing_phase(index: int, runs: list[Run], keys: list[str], ladder: str) -> None:
    """
    Print one phase's block: the header, the plain line, and the priced
    ladder's rungs, its linearity and its verdict.

    Args:
        index: the phase's index.
        runs: the cell's runs.
        keys: the `--call` keys.
        ladder: the ladder being priced.
    """
    plain_phases = [run.report['phases'][index] for run in runs if run.arm == PLAIN]
    reference = plain_phases[0]
    plain_avgs = [avg_ms(phase) for phase in plain_phases]
    plain_mean = mean(plain_avgs)
    bracket = max(plain_avgs) - min(plain_avgs)
    count = mean([call_count(phase, keys) for phase in plain_phases])
    rungs = ladders(runs, index, plain_mean)[ladder]
    width = max([len(PLAIN)] + [len(rung.arm) for rung in rungs])

    print(f"phase {index}  {reference.get('driver')} ×{reference.get('units')}  call {'+'.join(keys)}")
    print(f'  {PLAIN:{width}}  {len(plain_phases)} reps  mean {plain_mean:.2f}  bracket {bracket:.2f}  count {count:.2f}/u')

    for rung in rungs:
        print(rung_line(rung, rungs[0], bracket, width))

    linearity = linearity_line(rungs, bracket, width, ladder)

    if linearity is not None:
        print(linearity)

    print(ceiling_line(rungs, bracket, plain_mean, count, width, ladder))


def select_ladder(runs: list[Run], named: str | None) -> str | None:
    """
    The ladder to price. Gate 3's count comes from --call, which names one
    call, so a cell holding several ladders has to say which one is being
    priced: judging every ladder against one call's count would print a verdict
    Gate 3 does not define.

    Args:
        runs: the cell's runs.
        named: the --ladder value, or None.

    Returns:
        The ladder's name, or None after printing why the choice is not sound.
    """
    names = list(ladders(runs, 0, 0.0))

    if not names:
        print('the cell holds no dose ladder', file=sys.stderr)

        return None

    if named is None:
        if len(names) == 1:
            return names[0]

        print(f"the cell holds {len(names)} ladders; name the one being priced with --ladder ({', '.join(names)})", file=sys.stderr)

        return None

    if named not in names:
        print(f"bad --ladder: the cell's ladders are {', '.join(names)}", file=sys.stderr)

        return None

    return named


def parse_call(value: str) -> list[str] | None:
    """
    Parse the --call value: `plat` counter keys joined by `+`.

    Args:
        value: the --call value.

    Returns:
        The keys, or None when any term is empty.
    """
    keys = value.split('+')

    return keys if keys and all(keys) else None


def parse_args() -> argparse.Namespace:
    """
    Parse the command line. A mode is required and the two are exclusive, so
    argparse itself rejects neither and both, with exit code 2.

    Returns:
        The arguments.
    """
    parser = argparse.ArgumentParser(description='Price one platform call from a census or a dose ladder.')
    parser.add_argument('results_dir', help='the results directory')
    parser.add_argument('prefix', help='the run-name prefix, e.g. plats1-p00- or plats1-p02-t9c-')
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--census', action='store_true', help='print one line per run, phase and platform counter')
    mode.add_argument('--call', help='the platform counter keys to price, joined by +')
    parser.add_argument('--ladder', help='the dose ladder to price, e.g. plat.intl; needed when the cell holds several')

    return parser.parse_args()


def main() -> int:
    """
    Print the census or the pricing cell the arguments select.

    Returns:
        The exit code.
    """
    args = parse_args()
    keys = None if args.census else parse_call(args.call)

    if not args.census and keys is None:
        print('bad --call: every term must be a platform counter key', file=sys.stderr)

        return EXIT_BAD_ARGS

    runs = read_runs(args.results_dir, args.prefix)

    if runs is None:
        return EXIT_BAD_INPUT

    if args.census:
        print_census(runs)

        return EXIT_OK

    if not check_shape(runs):
        return EXIT_BAD_INPUT

    ladder = select_ladder(runs, args.ladder)

    if ladder is None:
        return EXIT_BAD_ARGS

    for index in range(len(runs[0].report.get('phases') or [])):
        print_pricing_phase(index, runs, keys or [], ladder)

    return EXIT_OK


if __name__ == '__main__':
    sys.exit(main())
