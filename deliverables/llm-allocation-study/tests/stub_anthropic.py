"""
A stub `anthropic` module for tests: lets the LLM policies run end to end
with no API key, no network, and no cost, while letting each test script
exactly what the "model" returns.

This is the mechanism that caught both real bugs in the LLM policies
before any money was spent (see README): the u_min enforcement gap and
the tool-name mismatch that silently disabled T2's revision round.
"""

from __future__ import annotations

import re
import sys
import types


class StubUsage:
    def __init__(self, input_tokens=200, output_tokens=80):
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens
        self.cache_read_input_tokens = 0
        self.cache_creation_input_tokens = 0

    def model_dump(self):
        return {"input_tokens": self.input_tokens, "output_tokens": self.output_tokens}


class StubToolUse:
    type = "tool_use"

    def __init__(self, name, input_):
        self.name = name
        self.input = input_


class StubResponse:
    def __init__(self, content, usage=None):
        self.content = content
        self.usage = usage or StubUsage()


def request_ids_in(kwargs) -> list[str]:
    """Pull request_ids out of whatever prompt the policy just built."""
    text = kwargs["messages"][-1]["content"]
    return list(dict.fromkeys(re.findall(r"request_id=(\S+)", text)))


def install(handler):
    """Install a stub `anthropic` module whose .messages.create calls `handler(kwargs)`.

    Returns a list that records every call's kwargs, for assertions about
    how many API calls a policy made and with what parameters.
    """
    calls = []

    class StubMessages:
        def create(self, **kwargs):
            calls.append(kwargs)
            return handler(kwargs)

    class StubAnthropic:
        def __init__(self, *a, **kw):
            self.messages = StubMessages()

    sys.modules["anthropic"] = types.SimpleNamespace(Anthropic=StubAnthropic)
    return calls


def allocation_handler(spot_chooser):
    """Build a handler that answers every tool with a well-formed payload.

    `spot_chooser(request_id, index) -> spot_id | None` decides what the
    "model" assigns, so a test can script hallucinations, legal picks, or
    abstentions.
    """
    def handler(kwargs):
        name = kwargs.get("tool_choice", {}).get("name")
        ids = request_ids_in(kwargs)

        if name == "submit_bid":
            return StubResponse([StubToolUse("submit_bid", {
                "spot_preferences": [], "willing_to_widen_walk_m": 25.0, "withdraw": False,
            })])
        if name == "submit_tentative_allocation":
            return StubResponse([StubToolUse("submit_tentative_allocation", {
                "assignments": [{"request_id": r, "spot_id": spot_chooser(r, i)}
                                 for i, r in enumerate(ids)],
                "revise_request_ids": ids[:1],
            })])
        if name == "submit_allocation":
            return StubResponse([StubToolUse("submit_allocation", {
                "assignments": [{"request_id": r, "spot_id": spot_chooser(r, i)}
                                 for i, r in enumerate(ids)],
            })])
        return StubResponse([])
    return handler
