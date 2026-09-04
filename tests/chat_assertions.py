"""Shared groundedness / anti-hallucination assertions for chat responses."""

from typing import Iterable, Optional

FORBIDDEN_SUBSTRINGS = (
    "[current date]",
    "TODO",
    "Mock reply",
    "mock_fallback",
    "Investment Swarm Consensus: Bullish",
)


def assert_no_forbidden_placeholders(text: str) -> None:
    """Fail if response contains known mock / placeholder leakage."""
    lowered = text.lower()
    for needle in FORBIDDEN_SUBSTRINGS:
        assert needle.lower() not in lowered, f"Forbidden placeholder/mock content found: {needle!r}"


def assert_mentions_ticker(text: str, ticker: str) -> None:
    """Require ticker symbol (case-insensitive) in successful investment swarm text."""
    assert ticker.lower() in text.lower(), f"Expected ticker {ticker!r} in response"


def assert_must_mention(text: str, phrases: Iterable[str]) -> None:
    lowered = text.lower()
    for phrase in phrases:
        assert phrase.lower() in lowered, f"Expected to mention {phrase!r}"


def assert_must_not_mention(text: str, phrases: Iterable[str]) -> None:
    lowered = text.lower()
    for phrase in phrases:
        if not phrase:
            continue
        assert phrase.lower() not in lowered, f"Must not mention {phrase!r}"


def assert_swarm_model_used(model_used: str, team: Optional[str] = None) -> None:
    assert model_used.startswith("vibe-swarm-"), f"Expected swarm model_used, got {model_used!r}"
    if team:
        assert model_used == f"vibe-swarm-{team}", f"Expected vibe-swarm-{team}, got {model_used!r}"


def assert_grounded_response(
    *,
    response_text: str,
    model_used: str,
    must_mention: Optional[Iterable[str]] = None,
    must_not_mention: Optional[Iterable[str]] = None,
    forbid_placeholders: bool = True,
    expect_swarm: Optional[bool] = None,
    team: Optional[str] = None,
) -> None:
    """Composite groundedness check used by offline helpers and live eval."""
    if forbid_placeholders:
        assert_no_forbidden_placeholders(response_text)

    if must_mention:
        assert_must_mention(response_text, must_mention)

    if must_not_mention:
        assert_must_not_mention(response_text, must_not_mention)

    if expect_swarm is True:
        assert_swarm_model_used(model_used, team=team)
    elif expect_swarm is False:
        assert not model_used.startswith("vibe-swarm-"), (
            f"Expected direct LLM path, got swarm model {model_used!r}"
        )
