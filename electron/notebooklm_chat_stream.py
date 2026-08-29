"""FlowDesk's JSONL bridge for NotebookLM's *existing* streamed chat API.

This deliberately does not read, copy, or print the profile's cookies.  It
uses ``NotebookLMClient.chat.ask`` for the authenticated request lifecycle and
temporarily instruments the upstream streaming transport to forward the same
wire response through the upstream parser as bytes arrive.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from pathlib import Path
from typing import Any

import httpx

from notebooklm import NotebookLMClient
from notebooklm._chat.wire import parse_streaming_chat_response
from notebooklm._kernel import Kernel
from notebooklm._streaming_post import MAX_RPC_RESPONSE_BYTES
from notebooklm.exceptions import RPCResponseTooLargeError


def emit(event: dict[str, Any]) -> None:
    # JSONL is the only stdout protocol.  The Electron parent owns all logs.
    sys.stdout.write(json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def reference_payload(reference: Any) -> dict[str, Any]:
    return {
        "sourceId": getattr(reference, "source_id", None),
        "text": getattr(reference, "cited_text", None),
        "start": getattr(reference, "start_char", None),
        "end": getattr(reference, "end_char", None),
        "number": getattr(reference, "citation_number", None),
    }


async def run(profile: str, notebook_id: str, question: str) -> None:
    storage = Path.home() / ".notebooklm" / "profiles" / profile / "storage_state.json"
    if not storage.exists():
        raise RuntimeError("NotebookLM is not connected for this selected account.")

    # The package's normal transport buffers the body after reading it.  Patch
    # only this process' Kernel symbol so public ChatAPI.ask keeps its upstream
    # auth refresh/retry/conversation behaviour while we observe chunks.
    original_post = Kernel.post
    last_answer = ""

    async def streamed_post(self: Kernel, url: str, headers: Any, body: Any, *, read_timeout: float | None = None, max_response_bytes: int | None = None):
        nonlocal last_answer
        client = self.get_http_client()
        timeout: httpx.Timeout | None = None
        if read_timeout is not None:
            timeout = httpx.Timeout(connect=self._connect_timeout, read=read_timeout, write=self._timeout, pool=self._timeout)
        async with client.stream("POST", url, content=body, headers=dict(headers) if headers else None, timeout=timeout) as response:
            response.raise_for_status()
            buffer = bytearray()
            limit = MAX_RPC_RESPONSE_BYTES if max_response_bytes is None else max_response_bytes
            async for chunk in response.aiter_bytes():
                buffer.extend(chunk)
                if len(buffer) > limit:
                    raise RPCResponseTooLargeError("NotebookLM chat response exceeded the configured size limit.", limit_bytes=limit, bytes_read=len(buffer))
                # The library's canonical parser accepts the partial accumulated
                # batchexecute stream. A partial trailing envelope simply does
                # not yield an answer yet; it is not treated as an error.
                try:
                    parsed = parse_streaming_chat_response(buffer.decode("utf-8"))
                    answer = parsed.answer
                    if answer and answer != last_answer:
                        delta = answer[len(last_answer):] if answer.startswith(last_answer) else answer
                        last_answer = answer
                        if delta:
                            emit({"type": "delta", "text": delta})
                except Exception:
                    pass
            cleaned_headers = {k: v for k, v in response.headers.items() if k.lower() not in {"content-encoding", "content-length"}}
            return httpx.Response(status_code=response.status_code, headers=cleaned_headers, content=bytes(buffer), request=response.request)

    Kernel.post = streamed_post
    try:
        emit({"type": "started"})
        async with NotebookLMClient.from_storage(path=str(storage)) as client:
            result = await client.chat.ask(notebook_id, question)
        # Some upstream responses emit their entire answer in one final frame;
        # make sure it is represented even if partial parsing saw no delta.
        if result.answer != last_answer:
            delta = result.answer[len(last_answer):] if result.answer.startswith(last_answer) else result.answer
            if delta:
                emit({"type": "delta", "text": delta})
        emit({"type": "done", "answer": result.answer, "citations": [reference_payload(item) for item in result.references], "conversationId": result.conversation_id})
    finally:
        Kernel.post = original_post


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", required=True)
    parser.add_argument("--notebook", required=True)
    parser.add_argument("--question", required=True)
    args = parser.parse_args()
    logging.disable(logging.CRITICAL)
    try:
        asyncio.run(run(args.profile, args.notebook, args.question))
    except KeyboardInterrupt:
        emit({"type": "cancelled"})
    except Exception as exc:
        # Never include repr/traceback: those may contain request URLs.
        emit({"type": "error", "message": str(exc)[:300] or "NotebookLM chat failed."})
        raise SystemExit(1)


if __name__ == "__main__":
    main()
