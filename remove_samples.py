#!/usr/bin/env python3
"""
remove_samples.py

Remove <SAMPLE>…<SOURCE> sections by index list, or by first N, or by a START–END range.
"""

import re
import sys
import io
import argparse

def find_sections(text):
    """
    Return a list of (start, end) spans for every <SAMPLE>…<SOURCE> block.
    """
    return [m.span() for m in re.finditer(r'<SAMPLE>.*?<SOURCE>', text, re.DOTALL)]

def remove_sections(text, indices):
    """
    Remove the blocks whose 1-based indices appear in 'indices'.
    """
    spans = find_sections(text)
    # convert to zero-based, filter invalids, sort descending
    to_del = sorted((i-1 for i in indices if 1 <= i <= len(spans)), reverse=True)
    for idx in to_del:
        start, end = spans[idx]
        text = text[:start] + text[end:]
    return text

def main():
    p = argparse.ArgumentParser(
        description="Remove <SAMPLE>…<SOURCE> sections by index list, first N, or range"
    )
    p.add_argument("infile",
                   help="Input file (or '-' for stdin)")
    p.add_argument("outfile",
                   help="Output file (or '-' for stdout)")
    grp = p.add_mutually_exclusive_group(required=True)
    grp.add_argument("-i", "--indices", type=int, nargs="+",
                     help="1-based list of sections to remove")
    grp.add_argument("-f", "--first", type=int,
                     help="Remove the first N sections")
    grp.add_argument("-r", "--range", nargs=2, type=int,
                     metavar=('START','END'),
                     help="Remove sections START through END (inclusive)")

    args = p.parse_args()

    # --- Read input as UTF-8 ---
    if args.infile == "-":
        sys.stdin = io.TextIOWrapper(sys.stdin.buffer,
                                     encoding="utf-8",
                                     errors="ignore")
        data = sys.stdin.read()
    else:
        with open(args.infile, "r", encoding="utf-8", errors="ignore") as f:
            data = f.read()

    # --- Build list of indices to remove ---
    if args.indices:
        to_remove = args.indices
    elif args.first:
        to_remove = list(range(1, args.first + 1))
    else:
        start, end = args.range
        if start > end:
            p.error("In --range START must be <= END")
        to_remove = list(range(start, end + 1))

    # --- Remove and write out ---
    result = remove_sections(data, to_remove)

    if args.outfile == "-":
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
        sys.stdout.write(result)
    else:
        with open(args.outfile, "w", encoding="utf-8") as f:
            f.write(result)

if __name__ == "__main__":
    main()