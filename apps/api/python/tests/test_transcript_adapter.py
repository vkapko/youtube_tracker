"""Unit tests for TranscriptAdapter — behavior through public interface, no live YouTube requests."""

import pytest
from unittest.mock import MagicMock, patch

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from transcript_adapter import TranscriptAdapter, AdapterError, _validate_request


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_transcript(language_code, is_generated, segments=None):
    t = MagicMock()
    t.language_code = language_code
    t.is_generated = is_generated
    t.language = ("Auto-generated " if is_generated else "") + language_code.upper()
    if segments is None:
        segments = [{"text": "Hello world", "start": 0.0, "duration": 2.5}]
    t.fetch.return_value = segments
    return t


def make_transcript_list(*transcripts):
    tl = MagicMock()
    tl.__iter__ = MagicMock(return_value=iter(transcripts))
    return tl


def mock_import(adapter, api, errors):
    """Context-manager helper: patches _import_dependencies on adapter."""
    return patch.object(adapter, "_import_dependencies", return_value=(api, errors))


def stub_api(transcript_list=None, side_effect=None):
    api = MagicMock()
    if side_effect is not None:
        api.list_transcripts.side_effect = side_effect
    else:
        api.list_transcripts.return_value = transcript_list
    return api


def no_errors():
    return {"TranscriptsDisabled": type(None), "VideoUnavailable": type(None), "NoTranscriptFound": type(None)}


# ---------------------------------------------------------------------------
# Language selection
# ---------------------------------------------------------------------------

class TestLanguageSelection:
    def test_returns_manual_transcript_for_preferred_language(self):
        adapter = TranscriptAdapter()
        en_manual = make_transcript("en", False, [{"text": "Hello", "start": 0.0, "duration": 1.0}])
        api = stub_api(make_transcript_list(en_manual))
        with mock_import(adapter, api, no_errors()):
            result = adapter.get_transcript("vid", ["en"])
        assert result["languageCode"] == "en"
        assert result["isGenerated"] is False

    def test_prefers_manual_over_generated_for_same_language(self):
        adapter = TranscriptAdapter()
        en_gen = make_transcript("en", True)
        en_manual = make_transcript("en", False, [{"text": "Manual", "start": 0.0, "duration": 1.0}])
        api = stub_api(make_transcript_list(en_gen, en_manual))
        with mock_import(adapter, api, no_errors()):
            result = adapter.get_transcript("vid", ["en"])
        assert result["isGenerated"] is False
        assert result["segments"][0]["text"] == "Manual"

    def test_uses_generated_when_no_manual_for_language(self):
        adapter = TranscriptAdapter()
        en_gen = make_transcript("en", True, [{"text": "Auto", "start": 0.0, "duration": 1.0}])
        api = stub_api(make_transcript_list(en_gen))
        with mock_import(adapter, api, no_errors()):
            result = adapter.get_transcript("vid", ["en"])
        assert result["isGenerated"] is True

    def test_first_matching_preferred_language_wins(self):
        adapter = TranscriptAdapter()
        en_us = make_transcript("en-US", False, [{"text": "en-US text", "start": 0.0, "duration": 1.0}])
        en = make_transcript("en", False, [{"text": "en text", "start": 0.0, "duration": 1.0}])
        api = stub_api(make_transcript_list(en_us, en))
        with mock_import(adapter, api, no_errors()):
            result = adapter.get_transcript("vid", ["en-US", "en"])
        assert result["languageCode"] == "en-US"
        assert result["segments"][0]["text"] == "en-US text"

    def test_second_language_used_when_first_absent(self):
        adapter = TranscriptAdapter()
        en = make_transcript("en", False, [{"text": "en text", "start": 0.0, "duration": 1.0}])
        api = stub_api(make_transcript_list(en))
        with mock_import(adapter, api, no_errors()):
            result = adapter.get_transcript("vid", ["en-US", "en"])
        assert result["languageCode"] == "en"

    def test_exact_code_matching_does_not_expand_base_language(self):
        """Preference for 'en' must NOT match 'en-US'."""
        adapter = TranscriptAdapter()
        en_us = make_transcript("en-US", False)
        api = stub_api(make_transcript_list(en_us))
        with mock_import(adapter, api, no_errors()):
            with pytest.raises(AdapterError) as exc:
                adapter.get_transcript("vid", ["en"])
        assert exc.value.code == "no_requested_transcript"

    def test_raises_no_requested_transcript_when_no_match(self):
        adapter = TranscriptAdapter()
        de = make_transcript("de", False)
        api = stub_api(make_transcript_list(de))
        with mock_import(adapter, api, no_errors()):
            with pytest.raises(AdapterError) as exc:
                adapter.get_transcript("vid", ["en", "en-US"])
        assert exc.value.code == "no_requested_transcript"
        assert exc.value.retryable is False

    def test_includes_language_name_in_result(self):
        adapter = TranscriptAdapter()
        t = make_transcript("en", False)
        t.language = "English"
        api = stub_api(make_transcript_list(t))
        with mock_import(adapter, api, no_errors()):
            result = adapter.get_transcript("vid", ["en"])
        assert result["languageName"] == "English"


# ---------------------------------------------------------------------------
# Segment normalization
# ---------------------------------------------------------------------------

class TestSegmentNormalization:
    def _get_result(self, segments):
        adapter = TranscriptAdapter()
        t = make_transcript("en", False, segments)
        api = stub_api(make_transcript_list(t))
        with mock_import(adapter, api, no_errors()):
            return adapter.get_transcript("vid", ["en"])

    def test_converts_start_and_duration_to_seconds_keys(self):
        result = self._get_result([{"text": "Hi", "start": 1.5, "duration": 0.8}])
        seg = result["segments"][0]
        assert seg["startSeconds"] == 1.5
        assert seg["durationSeconds"] == 0.8

    def test_discards_whitespace_only_segments(self):
        result = self._get_result([
            {"text": "Hello", "start": 0.0, "duration": 1.0},
            {"text": "   ", "start": 1.0, "duration": 0.5},
            {"text": "\t\n", "start": 1.5, "duration": 0.5},
            {"text": "World", "start": 2.0, "duration": 1.0},
        ])
        assert len(result["segments"]) == 2
        assert result["segments"][0]["text"] == "Hello"
        assert result["segments"][1]["text"] == "World"

    def test_preserves_exact_text_of_retained_segments(self):
        result = self._get_result([{"text": " Hello world ", "start": 0.0, "duration": 1.0}])
        assert result["segments"][0]["text"] == " Hello world "

    def test_raises_empty_transcript_when_all_segments_whitespace(self):
        adapter = TranscriptAdapter()
        t = make_transcript("en", False, [{"text": "  ", "start": 0.0, "duration": 1.0}])
        api = stub_api(make_transcript_list(t))
        with mock_import(adapter, api, no_errors()):
            with pytest.raises(AdapterError) as exc:
                adapter.get_transcript("vid", ["en"])
        assert exc.value.code == "empty_transcript"
        assert exc.value.retryable is False

    def test_raises_empty_transcript_when_no_segments(self):
        adapter = TranscriptAdapter()
        t = make_transcript("en", False, [])
        api = stub_api(make_transcript_list(t))
        with mock_import(adapter, api, no_errors()):
            with pytest.raises(AdapterError) as exc:
                adapter.get_transcript("vid", ["en"])
        assert exc.value.code == "empty_transcript"

    def test_passes_through_decoded_text_without_additional_normalization(self):
        """Provider-decoded HTML entities and special chars are preserved exactly."""
        result = self._get_result([{"text": "it&#39;s &amp; that", "start": 0.0, "duration": 1.0}])
        assert result["segments"][0]["text"] == "it&#39;s &amp; that"

    def test_newlines_in_segment_text_replaced_with_space(self):
        """YouTube captions use \\n for display line-breaks; adapter normalises to space."""
        result = self._get_result([{"text": "You know the rules\nand so do I", "start": 0.0, "duration": 3.0}])
        assert result["segments"][0]["text"] == "You know the rules and so do I"

    def test_carriage_returns_in_segment_text_replaced_with_space(self):
        result = self._get_result([{"text": "line one\r\nline two", "start": 0.0, "duration": 3.0}])
        assert result["segments"][0]["text"] == "line one line two"

    def test_segment_with_only_newlines_after_normalization_is_discarded(self):
        result = self._get_result([
            {"text": "\n\n", "start": 0.0, "duration": 1.0},
            {"text": "Real text", "start": 1.0, "duration": 1.0},
        ])
        assert len(result["segments"]) == 1
        assert result["segments"][0]["text"] == "Real text"

    def test_multiple_segments_returned_in_order(self):
        result = self._get_result([
            {"text": "First", "start": 0.0, "duration": 1.0},
            {"text": "Second", "start": 1.0, "duration": 1.0},
            {"text": "Third", "start": 2.0, "duration": 1.0},
        ])
        assert len(result["segments"]) == 3
        assert [s["text"] for s in result["segments"]] == ["First", "Second", "Third"]
        assert [s["startSeconds"] for s in result["segments"]] == [0.0, 1.0, 2.0]


# ---------------------------------------------------------------------------
# Error classification
# ---------------------------------------------------------------------------

class TestErrorClassification:
    def _raise_with(self, exc_class, error_key):
        adapter = TranscriptAdapter()
        api = stub_api(side_effect=exc_class())
        errors = {**no_errors(), error_key: exc_class}
        with mock_import(adapter, api, errors):
            with pytest.raises(AdapterError) as exc:
                adapter.get_transcript("vid", ["en"])
        return exc.value

    def test_transcripts_disabled_is_non_retryable(self):
        class FakeDisabled(Exception): pass
        err = self._raise_with(FakeDisabled, "TranscriptsDisabled")
        assert err.code == "transcripts_disabled"
        assert err.retryable is False

    def test_video_unavailable_is_non_retryable(self):
        class FakeUnavailable(Exception): pass
        err = self._raise_with(FakeUnavailable, "VideoUnavailable")
        assert err.code == "video_unavailable"
        assert err.retryable is False

    def test_request_blocked_is_retryable(self):
        class FakeBlocked(Exception): pass
        err = self._raise_with(FakeBlocked, "RequestBlocked")
        assert err.code == "request_blocked"
        assert err.retryable is True

    def test_unexpected_exception_becomes_provider_error_retryable(self):
        adapter = TranscriptAdapter()
        api = stub_api(side_effect=RuntimeError("boom"))
        with mock_import(adapter, api, no_errors()):
            with pytest.raises(AdapterError) as exc:
                adapter.get_transcript("vid", ["en"])
        assert exc.value.code == "provider_error"
        assert exc.value.retryable is True

    def test_empty_unexpected_exception_message_gets_diagnostic_fallback(self):
        adapter = TranscriptAdapter()
        api = stub_api(side_effect=RuntimeError(""))
        with mock_import(adapter, api, no_errors()):
            with pytest.raises(AdapterError) as exc:
                adapter.get_transcript("vid", ["en"])
        assert exc.value.code == "provider_error"
        assert exc.value.message == "Provider returned an empty error message"

    def test_429_message_becomes_request_blocked(self):
        adapter = TranscriptAdapter()
        api = stub_api(side_effect=RuntimeError("429 Client Error: Too Many Requests for url"))
        with mock_import(adapter, api, no_errors()):
            with pytest.raises(AdapterError) as exc:
                adapter.get_transcript("vid", ["en"])
        assert exc.value.code == "request_blocked"
        assert exc.value.retryable is True

    def test_future_live_event_message_becomes_video_unavailable(self):
        adapter = TranscriptAdapter()
        api = stub_api(side_effect=RuntimeError("The video is unplayable: This live event will begin in 6 days."))
        with mock_import(adapter, api, no_errors()):
            with pytest.raises(AdapterError) as exc:
                adapter.get_transcript("vid", ["en"])
        assert exc.value.code == "video_unavailable"
        assert exc.value.retryable is False

    def test_dependency_error_is_non_retryable(self):
        adapter = TranscriptAdapter()
        with patch.object(adapter, "_import_dependencies",
                          side_effect=AdapterError("dependency_error", "not installed")):
            with pytest.raises(AdapterError) as exc:
                adapter.get_transcript("vid", ["en"])
        assert exc.value.code == "dependency_error"
        assert exc.value.retryable is False

    def test_request_blocked_during_fetch_is_retryable(self):
        """RequestBlocked raised during transcript.fetch() is also retryable."""
        class FakeBlocked(Exception): pass
        adapter = TranscriptAdapter()
        t = make_transcript("en", False)
        t.fetch.side_effect = FakeBlocked()
        api = stub_api(make_transcript_list(t))
        errors = {**no_errors(), "RequestBlocked": FakeBlocked}
        with mock_import(adapter, api, errors):
            with pytest.raises(AdapterError) as exc:
                adapter.get_transcript("vid", ["en"])
        assert exc.value.code == "request_blocked"
        assert exc.value.retryable is True

    def test_safe_message_truncated_to_500_chars(self):
        adapter = TranscriptAdapter()
        long_msg = "x" * 600
        api = stub_api(side_effect=RuntimeError(long_msg))
        with mock_import(adapter, api, no_errors()):
            with pytest.raises(AdapterError) as exc:
                adapter.get_transcript("vid", ["en"])
        assert len(exc.value.message) <= 500
        assert exc.value.message.endswith("...")


# ---------------------------------------------------------------------------
# Request validation
# ---------------------------------------------------------------------------

class TestRequestValidation:
    def test_valid_request_returns_none(self):
        assert _validate_request({"protocolVersion": "1", "videoId": "abc", "preferredLanguages": ["en"]}) is None

    def test_non_object_returns_error(self):
        assert _validate_request("string") is not None
        assert _validate_request(42) is not None
        assert _validate_request(None) is not None

    def test_unknown_field_returns_error(self):
        req = {"protocolVersion": "1", "videoId": "abc", "preferredLanguages": ["en"], "extra": 1}
        assert "extra" in (_validate_request(req) or "")

    def test_missing_protocol_version_returns_error(self):
        assert _validate_request({"videoId": "abc", "preferredLanguages": ["en"]}) is not None

    def test_unsupported_protocol_version_returns_error(self):
        err = _validate_request({"protocolVersion": "2", "videoId": "abc", "preferredLanguages": ["en"]})
        assert err is not None and "version" in err.lower()

    def test_missing_video_id_returns_error(self):
        assert _validate_request({"protocolVersion": "1", "preferredLanguages": ["en"]}) is not None

    def test_empty_video_id_returns_error(self):
        assert _validate_request({"protocolVersion": "1", "videoId": "", "preferredLanguages": ["en"]}) is not None

    def test_empty_preferred_languages_returns_error(self):
        assert _validate_request({"protocolVersion": "1", "videoId": "abc", "preferredLanguages": []}) is not None

    def test_preferred_languages_not_list_returns_error(self):
        assert _validate_request({"protocolVersion": "1", "videoId": "abc", "preferredLanguages": "en"}) is not None

    def test_empty_string_in_languages_returns_error(self):
        assert _validate_request({"protocolVersion": "1", "videoId": "abc", "preferredLanguages": ["en", ""]}) is not None
