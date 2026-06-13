"""
Transcript adapter — subprocess bridge between Node and youtube-transcript-api.

Protocol:
  stdin:  one JSON object {protocolVersion, videoId, preferredLanguages}
  stdout: one JSON object {status: 'ok', ...} or {status: 'error', ...}
  stderr: human-readable diagnostics only
  exit 0: success (status: ok emitted)
  exit 1: structured error (status: error emitted)
  exit 2: invocation failure (cannot honor protocol, e.g. wrong CLI args)
"""

from __future__ import annotations

import json
import sys
import traceback
from typing import Any

PROTOCOL_VERSION = "1"
MAX_MESSAGE_LEN = 497

RETRYABLE_CODES: frozenset[str] = frozenset({"request_blocked", "provider_error"})
KNOWN_REQUEST_FIELDS: frozenset[str] = frozenset({"protocolVersion", "videoId", "preferredLanguages"})


class AdapterError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable: bool = code in RETRYABLE_CODES


class TranscriptAdapter:
    """Pure business logic: transcript selection and segment normalization.

    Never calls sys.exit(); raises AdapterError for all structured failures.
    """

    def get_transcript(self, video_id: str, preferred_languages: list[str]) -> dict[str, Any]:
        api, errors = self._import_dependencies()

        try:
            transcript_list = api.list_transcripts(video_id)
        except Exception as exc:
            self._classify_list_error(exc, errors)

        selected = self._select_transcript(transcript_list, preferred_languages)
        if selected is None:
            raise AdapterError(
                "no_requested_transcript",
                f"No transcript found for languages: {', '.join(preferred_languages)}",
            )

        try:
            raw_segments = selected.fetch()
        except Exception as exc:
            self._classify_fetch_error(exc, errors)

        segments = self._normalize_segments(raw_segments)
        if not segments:
            raise AdapterError("empty_transcript", "Transcript contains no usable text segments")

        return {
            "languageCode": selected.language_code,
            "languageName": selected.language,
            "isGenerated": selected.is_generated,
            "segments": segments,
        }

    def _classify_list_error(self, exc: Exception, errors: dict[str, type]) -> None:
        if _is_instance(exc, errors.get("TranscriptsDisabled")):
            raise AdapterError("transcripts_disabled", "Transcripts are disabled for this video")
        if _is_instance(exc, errors.get("VideoUnavailable")):
            raise AdapterError("video_unavailable", "Video is unavailable")
        if _is_instance(exc, errors.get("RequestBlocked")):
            raise AdapterError("request_blocked", "YouTube blocked the request")
        raise AdapterError("provider_error", _safe_message(str(exc)))

    def _classify_fetch_error(self, exc: Exception, errors: dict[str, type]) -> None:
        if _is_instance(exc, errors.get("RequestBlocked")):
            raise AdapterError("request_blocked", "YouTube blocked the fetch request")
        raise AdapterError("provider_error", _safe_message(str(exc)))

    def _select_transcript(self, transcript_list: Any, preferred_languages: list[str]) -> Any | None:
        by_code: dict[str, dict[str, Any]] = {}
        for transcript in transcript_list:
            code = transcript.language_code
            if code not in by_code:
                by_code[code] = {"manual": None, "generated": None}
            if transcript.is_generated:
                by_code[code]["generated"] = transcript
            else:
                by_code[code]["manual"] = transcript

        for lang in preferred_languages:
            if lang in by_code:
                if by_code[lang]["manual"] is not None:
                    return by_code[lang]["manual"]
                if by_code[lang]["generated"] is not None:
                    return by_code[lang]["generated"]

        return None

    def _normalize_segments(self, raw_segments: Any) -> list[dict[str, Any]]:
        segments: list[dict[str, Any]] = []
        for seg in raw_segments:
            if isinstance(seg, dict):
                text, start, duration = seg.get("text", ""), seg.get("start", 0.0), seg.get("duration", 0.0)
            else:
                text, start, duration = seg.text, seg.start, seg.duration

            if not text.strip():
                continue

            segments.append({
                "text": text,
                "startSeconds": float(start),
                "durationSeconds": float(duration),
            })

        return segments

    def _import_dependencies(self) -> tuple[Any, dict[str, type]]:
        try:
            from youtube_transcript_api import (  # type: ignore
                YouTubeTranscriptApi,
                TranscriptsDisabled,
                VideoUnavailable,
                NoTranscriptFound,
            )
        except ImportError as exc:
            raise AdapterError("dependency_error", f"youtube-transcript-api not installed: {_safe_message(str(exc))}")

        errors: dict[str, type] = {
            "TranscriptsDisabled": TranscriptsDisabled,
            "VideoUnavailable": VideoUnavailable,
            "NoTranscriptFound": NoTranscriptFound,
        }

        try:
            from youtube_transcript_api._errors import RequestBlocked  # type: ignore
            errors["RequestBlocked"] = RequestBlocked
        except (ImportError, AttributeError):
            pass

        return YouTubeTranscriptApi, errors


def _is_instance(exc: Exception, cls: type | None) -> bool:
    """Safe isinstance check that handles None/non-exception sentinels."""
    if cls is None:
        return False
    try:
        return isinstance(exc, cls)
    except TypeError:
        return False


# ---------------------------------------------------------------------------
# Request validation
# ---------------------------------------------------------------------------

def _validate_request(request: Any) -> str | None:
    if not isinstance(request, dict):
        return "Request must be a JSON object"

    unknown = set(request.keys()) - KNOWN_REQUEST_FIELDS
    if unknown:
        return f"Unknown request fields: {', '.join(sorted(unknown))}"

    if "protocolVersion" not in request:
        return "Missing required field: protocolVersion"
    if request["protocolVersion"] != "1":
        return f"Unsupported protocol version: {request['protocolVersion']!r}"

    if "videoId" not in request:
        return "Missing required field: videoId"
    if not isinstance(request["videoId"], str) or not request["videoId"]:
        return "videoId must be a non-empty string"

    if "preferredLanguages" not in request:
        return "Missing required field: preferredLanguages"
    langs = request["preferredLanguages"]
    if not isinstance(langs, list) or not langs:
        return "preferredLanguages must be a non-empty array"
    if not all(isinstance(lang, str) and lang for lang in langs):
        return "preferredLanguages entries must be non-empty strings"

    return None


# ---------------------------------------------------------------------------
# I/O helpers
# ---------------------------------------------------------------------------

def _safe_message(msg: str) -> str:
    if len(msg) > MAX_MESSAGE_LEN:
        return msg[:MAX_MESSAGE_LEN] + "..."
    return msg


def _write_response(response: dict[str, Any]) -> None:
    print(json.dumps(response), flush=True)


def _write_error(error_code: str, message: str) -> None:
    _write_response({
        "status": "error",
        "protocolVersion": PROTOCOL_VERSION,
        "errorCode": error_code,
        "retryable": error_code in RETRYABLE_CODES,
        "message": _safe_message(message),
    })


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main(adapter: TranscriptAdapter | None = None) -> None:
    if adapter is None:
        adapter = TranscriptAdapter()

    raw = sys.stdin.read()

    try:
        request = json.loads(raw)
    except json.JSONDecodeError as exc:
        _write_error("invalid_request", f"Request is not valid JSON: {exc}")
        sys.exit(1)

    error = _validate_request(request)
    if error:
        _write_error("invalid_request", error)
        sys.exit(1)

    video_id: str = request["videoId"]
    preferred_languages: list[str] = request["preferredLanguages"]

    try:
        result = adapter.get_transcript(video_id, preferred_languages)
        _write_response({
            "status": "ok",
            "protocolVersion": PROTOCOL_VERSION,
            "videoId": video_id,
            **result,
        })
        sys.exit(0)
    except AdapterError as exc:
        _write_error(exc.code, exc.message)
        sys.exit(1)
    except Exception as exc:
        print(traceback.format_exc(), file=sys.stderr)
        _write_error("runtime_error", _safe_message(f"Unexpected error: {exc}"))
        sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) != 1:
        print(f"Usage: {sys.argv[0]}", file=sys.stderr)
        sys.exit(2)
    main()
