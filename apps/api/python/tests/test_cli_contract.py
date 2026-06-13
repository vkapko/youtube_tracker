"""CLI contract tests — verify stdin/stdout/exit-code protocol via subprocess."""

import json
import subprocess
import sys
import os
import pytest

ADAPTER_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "transcript_adapter.py")
PYTHON = sys.executable

VALID_REQUEST = {
    "protocolVersion": "1",
    "videoId": "dQw4w9WgXcQ",
    "preferredLanguages": ["en"],
}


def run_adapter(request_dict, timeout=10):
    return subprocess.run(
        [PYTHON, ADAPTER_PATH],
        input=json.dumps(request_dict),
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def run_raw(stdin_text, args=None, timeout=10):
    return subprocess.run(
        [PYTHON, ADAPTER_PATH] + (args or []),
        input=stdin_text,
        capture_output=True,
        text=True,
        timeout=timeout,
    )


# ---------------------------------------------------------------------------
# Exit codes
# ---------------------------------------------------------------------------

class TestExitCodes:
    def test_invalid_json_exits_1(self):
        result = run_raw("not valid json")
        assert result.returncode == 1

    def test_unsupported_version_exits_1(self):
        result = run_adapter({**VALID_REQUEST, "protocolVersion": "99"})
        assert result.returncode == 1

    def test_unknown_field_exits_1(self):
        result = run_adapter({**VALID_REQUEST, "extra": "bad"})
        assert result.returncode == 1

    def test_extra_cli_arg_exits_2(self):
        result = run_raw("{}", args=["unexpected_arg"])
        assert result.returncode == 2


# ---------------------------------------------------------------------------
# Response structure
# ---------------------------------------------------------------------------

class TestResponseStructure:
    def test_error_response_is_valid_json_on_stdout(self):
        result = run_adapter({**VALID_REQUEST, "protocolVersion": "99"})
        response = json.loads(result.stdout)
        assert isinstance(response, dict)

    def test_error_response_has_required_fields(self):
        result = run_adapter({**VALID_REQUEST, "protocolVersion": "99"})
        response = json.loads(result.stdout)
        assert response["status"] == "error"
        assert response["protocolVersion"] == "1"
        assert isinstance(response["errorCode"], str)
        assert isinstance(response["retryable"], bool)
        assert isinstance(response["message"], str)

    def test_invalid_json_produces_structured_error_not_traceback(self):
        result = run_raw("not json")
        # stdout must be parseable JSON
        response = json.loads(result.stdout)
        assert response["status"] == "error"
        assert response["errorCode"] == "invalid_request"

    def test_stdout_is_only_machine_readable_json(self):
        """All human-readable output must go to stderr, not stdout."""
        result = run_adapter({**VALID_REQUEST, "protocolVersion": "99"})
        # If stdout isn't parseable as JSON this will raise
        json.loads(result.stdout)

    def test_retryable_field_matches_error_code_matrix(self):
        """invalid_request must be non-retryable."""
        result = run_adapter({**VALID_REQUEST, "protocolVersion": "99"})
        response = json.loads(result.stdout)
        assert response["errorCode"] == "invalid_request"
        assert response["retryable"] is False

    def test_unknown_field_produces_invalid_request_error(self):
        result = run_adapter({**VALID_REQUEST, "extra": "oops"})
        response = json.loads(result.stdout)
        assert response["errorCode"] == "invalid_request"

    def test_missing_video_id_produces_invalid_request_error(self):
        req = {"protocolVersion": "1", "preferredLanguages": ["en"]}
        result = run_adapter(req)
        response = json.loads(result.stdout)
        assert response["errorCode"] == "invalid_request"
