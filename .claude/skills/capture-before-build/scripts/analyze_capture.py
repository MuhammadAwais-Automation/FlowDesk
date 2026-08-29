#!/usr/bin/env python3
"""Read a network capture and say which calls are worth building on.

The problem this solves: a capture is thousands of requests, almost all of them
telemetry, and the interesting one is a single POST somewhere in the middle. Read
by hand, it is easy to conclude "there is no API here" when there plainly is —
which is the most expensive wrong conclusion in this whole method, because it
sends you off to build a fragile UI-driving tool instead.

So this sorts the noise out and, for each remaining call, answers the one
question that matters: does this request carry DATA, or does it carry interface
state?

    python analyze_capture.py capture.json              # overview
    python analyze_capture.py capture.json --writes     # only calls that changed something
    python analyze_capture.py capture.json --endpoint contentcreation   # one endpoint, in full

The classification is a heuristic and says so — it ranks candidates for a human
to read, it does not decide. When it marks something "likely replayable", open
the payload and check that the content you performed is actually in there.
"""

import argparse
import sys
from collections import Counter
from urllib.parse import unquote

from _capture import VERDICT_ORDER, classify, endpoint_of, is_noise, load, payload_of, show


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("capture")
    parser.add_argument("--writes", action="store_true", help="only non-GET calls")
    parser.add_argument("--endpoint", help="show every call whose endpoint contains this, in full")
    parser.add_argument("--keep-noise", action="store_true", help="do not filter telemetry and assets")
    args = parser.parse_args()

    meta, calls = load(args.capture)
    if not calls:
        print("No calls in that capture. Is the recorder running, and is this the right file?")
        return 1

    print(f"{len(calls)} calls captured" + (f" at {meta.get('capturedAt')}" if meta.get("capturedAt") else ""))

    if not args.keep_noise:
        calls = [c for c in calls if not is_noise(c)]
        print(f"{len(calls)} after dropping telemetry and static assets")

    if args.endpoint:
        matches = [c for c in calls if args.endpoint.lower() in endpoint_of(c.get("url", "")).lower()]
        print(f"\n{len(matches)} call(s) matching {args.endpoint!r}:\n")
        for call in matches:
            show(call, full=True, response_chars=800)
        return 0

    if args.writes:
        calls = [c for c in calls if c.get("method", "GET").upper() not in ("GET", "HEAD", "OPTIONS")]
        print(f"{len(calls)} of those changed something (non-GET)")

    ranked = {}
    for call in calls:
        verdict, reasons = classify(call)
        key = (verdict, call.get("method", "?"), endpoint_of(call.get("url", "")))
        entry = ranked.setdefault(key, {"count": 0, "reasons": reasons, "statuses": Counter(), "sample": call})
        entry["count"] += 1
        entry["statuses"][call.get("status")] += 1

    print()
    for verdict in VERDICT_ORDER:
        group = {k: v for k, v in ranked.items() if k[0] == verdict}
        if not group:
            continue
        print(f"── {verdict} ({len(group)} endpoint(s))")
        if verdict == "likely-replayable":
            print("   Build on these. Open one and confirm your content is really in the payload.")
        elif verdict == "mixed":
            print("   Carries data but is bound to a rendered page. Prefer another surface if one exists.")
        elif verdict == "ui-only":
            print("   Nothing to replay. If this is the only path, drive the UI — see references/dom-driving.md")
        for (_, method, endpoint), entry in sorted(group.items(), key=lambda kv: -kv[1]["count"]):
            statuses = ",".join(str(s) for s in entry["statuses"])
            print(f"   {entry['count']:>3}x  {method:<6} {endpoint[:90]}  [{statuses}]")
        print()

    print("Next steps:")
    print("  - Know what you typed?  find_action.py <capture> --contains \"...\"")
    print("  - Want one endpoint in full?  analyze_capture.py <capture> --endpoint <name>")
    return 0


if __name__ == "__main__":
    sys.exit(main())
