#!/usr/bin/env python3
"""Find the request that carried a piece of content.

This is the highest-value move in the whole method, and it is worth
understanding why it works rather than just running it.

When someone performs an action by hand — posts something, sends a message,
renames a file — the app has to transmit that content somewhere. If the request
that did it contains the content in readable form, then the request is DATA and
data can be replayed. If the content appears in no payload at all, the app is
driving its interface from the server and there is nothing to copy.

So: search the capture for the exact words that were just typed.

    python find_action.py capture.json --contains "the post I just wrote"

That one question separates "build an API call" from "drive the UI", and it is
answerable in seconds. On the project this came from, eight guessed endpoints
failed before this was tried; the ninth attempt was not a guess.

For actions with no text — a like, a delete, an invitation — there is nothing to
search for. Use `analyze_capture.py --writes` and read what changed instead.

Usage:
    python find_action.py <capture.json> --contains "<text>"
    python find_action.py <capture.json> --contains "<text>" --full
    python find_action.py <capture.json> --contains "<text>" --all   # include telemetry/URL-only hits
"""

import argparse
import re
import sys

from _capture import classify, load, payload_of, rank_key, show, is_noise


def normalise(text):
    """Compare on words, not whitespace.

    An editor may have collapsed newlines and the wire may have escaped them; a
    literal comparison then misses a request that plainly carries the content.
    """
    return re.sub(r"\s+", " ", str(text)).strip().lower()


def searchable(call):
    """Payload plus URL — plenty of apps put real arguments in the query string."""
    return payload_of(call) + "\n" + str(call.get("url", ""))


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("capture")
    parser.add_argument("--contains", required=True, help="text that was just typed into the app")
    parser.add_argument("--full", action="store_true", help="print whole payloads, not a slice")
    parser.add_argument("--all", action="store_true", help="include telemetry and URL-only matches")
    parser.add_argument("--since", type=float, help="only calls in the last N seconds of the capture")
    args = parser.parse_args()

    _, calls = load(args.capture)
    if not calls:
        print("No calls in that capture. Is the recorder running, and is this the right file?")
        return 1

    needle = normalise(args.contains)
    if len(needle) < 8:
        print(f"{args.contains!r} is short enough to match by accident. Use a longer, more distinctive fragment.")
        return 1
    if len(needle) > 60:
        # A long phrase can be reformatted in transit; a distinctive chunk
        # survives more reliably.
        needle = needle[:60]
        print(f"(searching on the first 60 characters: {needle!r})\n")

    if args.since:
        times = [c.get("t") for c in calls if isinstance(c.get("t"), (int, float))]
        if times:
            cutoff = max(times) - args.since
            calls = [c for c in calls if not isinstance(c.get("t"), (int, float)) or c["t"] >= cutoff]

    hits = [c for c in calls if needle in normalise(searchable(c))]

    if not hits:
        print(f"Nothing carried {args.contains!r}.\n")
        print("That is a real finding, not a dead end. It usually means one of:")
        print("  - The action went through a server-driven interface, so the content")
        print("    never travelled as data. Check: analyze_capture.py <capture> --writes")
        print("  - The capture missed it. Confirm the action happened while recording,")
        print("    and that the buffer did not roll over (compare the call count).")
        print("  - The content was transformed — encoded, chunked, or sent as a file.")
        print("    Try a shorter distinctive fragment, or search for a filename instead.")
        return 2

    # Separate the hits that are actually promising from the ones that merely
    # mention the word. Without this, a search for a person's name returns the
    # profile URL and a dozen interface calls, and the one real POST is buried.
    def is_substantive(call):
        if is_noise(call):
            return False
        if not payload_of(call):
            return False  # matched in the URL only
        return True

    strong = sorted([c for c in hits if is_substantive(c)], key=rank_key)
    weak = [c for c in hits if not is_substantive(c)]

    shown = strong if not args.all else sorted(hits, key=rank_key)

    print(f"{len(hits)} request(s) mentioned it; {len(strong)} carried it in a payload.\n")

    if not shown:
        print("All matches were URL-only or telemetry — the content itself was never sent")
        print("as data. Re-run with --all to see them, but this points at a server-driven")
        print("interface: see references/dom-driving.md\n")
        return 2

    for call in shown:
        show(call, full=args.full)

    if weak and not args.all:
        print(f"({len(weak)} further match(es) in URLs or telemetry — re-run with --all to see them.)\n")

    best = classify(shown[0])[0]
    print("=" * 70)
    if best == "likely-replayable":
        print("The first result is the one to build on. Copy its payload shape exactly —")
        print("including fields that look like settings — and find the id in the response.")
        print("That id is what proves a later send actually worked.")
    elif best == "mixed":
        print("This carries real data but is bound to the page that produced it.")
        print("Before building on it, check whether another surface in the same app does")
        print("the same thing — a profile page instead of a feed, a detail view instead of")
        print("a list. Those often post a clean API where the first one does not.")
    else:
        print("Nothing here looks cleanly replayable. Read references/dom-driving.md before")
        print("building anything, and say plainly that no API was found.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
