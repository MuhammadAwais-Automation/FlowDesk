"""Shared reading and classification for network captures.

Forces stdout/stderr to UTF-8 on import. Windows' default console codepage
(cp1252) cannot print the box-drawing characters this module's callers use for
headers, and failing on that after 1500 calls have already been read wastes the
whole run. This runs before argparse or anything else touches the terminal.


Both scripts in this folder need the same three things: load a capture whatever
shape it is in, pull out what a request SENT, and judge whether that request
carries data or interface state. Keeping them here means the two tools can never
disagree about what "replayable" means — which matters, because that judgement
is the one the whole method turns on.
"""

import sys as _sys
for _stream in (_sys.stdout, _sys.stderr):
    if hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

import json
import re
from urllib.parse import unquote


# Requests that are always present and never the answer. Filtering is not
# cosmetic: a capture is mostly telemetry, and a real find gets lost in it.
NOISE = re.compile(
    r"/li/track|/realtime/|realtimeFrontendClientConnectivityTracking"
    r"|/litms/|/tscp-|/li/tscp|beacon|/collect|analytics\.|doubleclick|googletag"
    r"|/lix/treatments"
    r"|\.js$|\.css$|\.woff|\.png$|\.jpg$|\.svg$",
    re.I,
)

# Telemetry endpoints on obfuscated single-segment paths — several large sites
# rotate these deliberately so they cannot be blocked by name. Recognised by
# shape rather than by name: one path segment, mixed case, no vowirl-ish word
# structure, no extension. A heuristic, so it only ever DEMOTES a call; nothing
# is hidden outright on this basis alone.
OPAQUE_PATH = re.compile(r"^/[A-Za-z0-9_-]{6,20}$")

# Server-driven interface frameworks. A request to one of these carries what the
# INTERFACE needs, not what the action means — which is why it cannot be replayed
# from outside the page that produced it.
SERVER_DRIVEN = re.compile(r"rsc-action|server-request|server-stream|/_next/|\.rsc(\?|$)|flight", re.I)

# Fields that exist only to bind a request back to a rendered component. Their
# presence is the strongest signal that a payload is interface state.
UI_STATE_KEYS = re.compile(
    r'"(componentkey|componentId|requestedStateKeys|renderMode|isDisabled|parentSpanId'
    r'|sduiid|namespace|stateKey|clientContext|BindingImpl|knownTemplateIds)"',
    re.I,
)

# Fields that look like real content or real identity.
DATA_KEYS = re.compile(
    r'"(text|commentary|body|message|content|title|name|email|url|urn'
    r'|invitee|recipient|profile|memberProfile|filename|caption|mediaUrn)"',
    re.I,
)


def load(path):
    """Return (metadata, calls). Accepts the recorder's shape or a bare list."""
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    if isinstance(data, dict):
        return data, (data.get("calls") or data.get("records") or data.get("entries") or [])
    return {}, data


def payload_of(call):
    """Everything the request SENT, as one string."""
    for key in ("postData", "requestBody", "body", "post_data"):
        value = call.get(key)
        if value:
            return value if isinstance(value, str) else json.dumps(value)
    return ""


def is_noise(call):
    url = str(call.get("url", ""))
    if NOISE.search(url):
        return True
    path = re.sub(r"\?.*", "", re.sub(r"^https?://[^/]+", "", url))
    return bool(OPAQUE_PATH.match(path))


def endpoint_of(url):
    """A stable name for grouping: the path, or the GraphQL operation."""
    url = str(url)
    query_id = re.search(r"queryId=([A-Za-z]+)\.", url)
    if query_id:
        return query_id.group(1)
    action = re.search(r"[?&]action=([A-Za-z0-9_]+)", url)
    path = re.sub(r"\?.*", "", url)
    path = re.sub(r"^https?://[^/]+", "", path)
    path = re.sub(r"/[0-9]{6,}", "/<id>", path)
    path = re.sub(r"urn%3A[^/?&]+", "<urn>", path)
    return f"{path}?action={action.group(1)}" if action else path


def classify(call):
    """Rank one call as a replay candidate. Returns (verdict, reasons).

    This is a heuristic that ranks candidates for a human to read — it does not
    decide. When it says "likely-replayable", open the payload and check that
    the content you actually performed is in there.
    """
    url = str(call.get("url", ""))
    payload = payload_of(call)
    reasons = []

    if SERVER_DRIVEN.search(url):
        reasons.append("server-driven interface route")
        if UI_STATE_KEYS.search(payload):
            reasons.append("payload carries component/state keys")
        if DATA_KEYS.search(payload):
            # Some server-driven payloads DO carry real data alongside the state
            # keys. Replaying one means reconstructing another page's internal
            # state, which is why it ranks below a plain API — but it is not the
            # same as carrying nothing, and saying so keeps a real option open.
            reasons.append("payload also carries real data — replayable only by reconstructing page state")
            return "mixed", reasons
        return "ui-only", reasons

    if not payload:
        return "no-payload", ["nothing sent — a read, or the arguments are in the URL"]

    has_state = bool(UI_STATE_KEYS.search(payload))
    has_data = bool(DATA_KEYS.search(payload))

    if has_state and not has_data:
        return "ui-only", ["payload is component/state keys only"]

    if has_data:
        reasons.append("payload carries content or identity fields")
        if len(payload) < 400:
            reasons.append("small payload — usually a clean, replayable call")
        if has_state:
            reasons.append("also carries some state keys — check whether they are required")
        return "likely-replayable", reasons

    return "unclear", ["payload present but neither clearly data nor clearly state — read it"]


VERDICT_ORDER = ["likely-replayable", "mixed", "unclear", "ui-only", "no-payload"]


def rank_key(call):
    """Sort so the most promising candidate is read first."""
    verdict, _ = classify(call)
    method = str(call.get("method", "GET")).upper()
    return (
        VERDICT_ORDER.index(verdict) if verdict in VERDICT_ORDER else 99,
        0 if method not in ("GET", "HEAD", "OPTIONS") else 1,
        1 if is_noise(call) else 0,
    )


def show(call, full=False, response_chars=600):
    """Print one call the way a person needs to read it."""
    verdict, reasons = classify(call)
    url = unquote(str(call.get("url", "")))
    print("=" * 70)
    print(f"{call.get('method', '?')} {call.get('status', '?')}  [{verdict}]")
    print(url[:200])
    if is_noise(call):
        print("  (looks like telemetry — shown for completeness, probably not it)")
    for reason in reasons:
        print(f"  - {reason}")

    headers = call.get("reqHeaders") or call.get("requestHeaders") or {}
    interesting = {
        key: value for key, value in headers.items()
        if key.lower() in {
            "accept", "content-type", "x-restli-protocol-version",
            "x-li-deco-include-micro-schema", "x-http-method-override",
        }
    }
    if interesting:
        # `accept` in particular often decides the SHAPE of the response, not
        # just its encoding — a wrong one returns a form with the data missing.
        print("  headers that shape the request or response:")
        for key, value in interesting.items():
            print(f"    {key}: {value}")

    payload = payload_of(call)
    if payload:
        print("\n  PAYLOAD:")
        print("  " + (payload if full else payload[:1200]).replace("\n", "\n  "))

    preview = call.get("preview") or call.get("responseBody")
    if preview:
        print("\n  RESPONSE (the confirmation id lives here):")
        print("  " + str(preview)[:response_chars].replace("\n", "\n  "))
    print()
