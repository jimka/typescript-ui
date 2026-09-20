#!/usr/bin/env python3
"""
Print forced-layout reads, attributed DOM toggles, mutations and stack samples: qa-forced.py <results-dir> <name-prefix>.

Reads <results-dir>/<name-prefix>*.json, oldest first, and prints each phase's
`count=1` counters. Forced reads under-count reads dirtied by inline-style
writes; they corroborate a finding, never lead it.
"""
import argparse
import glob
import json
import os
import sys

# The report format this script reads; `QaReport.schema` in the harness.
SCHEMA: int = 1

# Loom's truncations, which keep each item to one terminal line: the notes in
# a phase header, the attributed toggles and mutations listed, and a stack.
NOTES_WIDTH: int = 160
TOP_TOGGLES: int = 12
TOP_MUTATIONS: int = 8
STACK_WIDTH: int = 600


def run_name(path: str) -> str:
    """
    The run's name: the file name without its `-<epoch ms>.json` suffix.

    Args:
        path: a result file.

    Returns:
        The run name.
    """
    return os.path.basename(path).rsplit('-', 1)[0]


def largest_first(counts: dict, limit: int | None = None) -> list[tuple[str, float]]:
    """
    Order counters by value, largest first.

    Args:
        counts: counter name → per-unit value.
        limit: how many to keep; all when None.

    Returns:
        The (name, value) pairs.
    """
    return sorted(counts.items(), key=lambda kv: -kv[1])[:limit]


def print_phase(name: str, index: int, phase: dict, notes: str) -> None:
    """
    Print one phase's forced reads, attributed toggles, mutations and stacks.

    Args:
        name: the run name.
        index: the phase's index.
        phase: the phase.
        notes: the report's notes, joined.
    """
    timing = phase.get('timing') or {}
    writes = phase.get('writes') or {}
    forced = {k[len('forced.'):]: v for k, v in writes.items() if k.startswith('forced.')}
    toggles = {k: v for k, v in writes.items() if '@' in k}
    muts = {k[len('mut.'):]: v for k, v in writes.items() if k.startswith('mut.')}

    print(f"=== {name}  phase {index} {phase.get('driver')}  avg {timing.get('avgMs')} ms/unit  ({notes[:NOTES_WIDTH]})")
    print('  forced reads/unit:', ', '.join(f'{k}={v}' for k, v in largest_first(forced)) or 'none')
    print('  attributed toggles/unit:', ', '.join(f'{k}={v}' for k, v in largest_first(toggles, TOP_TOGGLES)) or 'none')
    print('  mutations/unit:', ', '.join(f'{k}={v}' for k, v in largest_first(muts, TOP_MUTATIONS)) or 'none')

    for api, stacks in (phase.get('forcedStacks') or {}).items():
        print(f'  --- first forced {api} stacks ({len(stacks)}):')

        for stack in stacks:
            print('     ', stack[:STACK_WIDTH])

    print()


def print_file(path: str) -> None:
    """
    Print every phase of one result file, or say why it has none.

    Args:
        path: the result file.
    """
    name = run_name(path)

    try:
        with open(path, encoding='utf-8') as handle:
            report = json.load(handle)
    except (OSError, ValueError):
        report = None

    if not isinstance(report, dict) or report.get('schema') != SCHEMA:
        print(f'{name} old format, skipped')

        return

    notes = '; '.join(report.get('notes') or [])

    if 'error' in report:
        print(f"{name} ERROR {report['error']}  {notes}")

        return

    for index, phase in enumerate(report.get('phases') or []):
        print_phase(name, index, phase, notes)


def main() -> int:
    """
    Print the forced-layout report for the files the arguments select.

    Returns:
        The exit code.
    """
    parser = argparse.ArgumentParser(description='Print forced-layout reads and their stacks by name prefix.')
    parser.add_argument('results_dir', help='the results directory')
    parser.add_argument('prefix', help='the run-name prefix to select')
    args = parser.parse_args()

    for path in sorted(glob.glob(os.path.join(args.results_dir, args.prefix + '*.json')), key=os.path.getmtime):
        print_file(path)

    return 0


if __name__ == '__main__':
    sys.exit(main())
