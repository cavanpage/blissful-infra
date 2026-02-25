"""
Suggestion tools — allow the agent to record proposed file changes in memory
without writing to disk. The human reviews via `agent review` before anything
is applied.
"""
from contextvars import ContextVar
from langchain_core.tools import tool

# Per-task accumulators using ContextVar so concurrent tasks don't interfere
_proposed_changes: ContextVar[list] = ContextVar("proposed_changes", default=[])
_plan: ContextVar[str] = ContextVar("plan", default="")


def reset_suggestion() -> tuple:
    """Reset accumulators and return tokens for cleanup."""
    changes_token = _proposed_changes.set([])
    plan_token = _plan.set("")
    return changes_token, plan_token


def restore_suggestion(tokens: tuple) -> None:
    """Restore previous accumulator state (call in finally block)."""
    _proposed_changes.reset(tokens[0])
    _plan.reset(tokens[1])


def get_suggestion() -> dict:
    """Return the accumulated suggestion (plan + changes)."""
    return {
        "plan": _plan.get(""),
        "changes": _proposed_changes.get([]),
    }


@tool
def propose_file_change(path: str, content: str, description: str = "") -> str:
    """
    Record a proposed file change without writing it to disk.
    Call this for every file you want to create or modify.
    The human will review all proposed changes before anything is applied.

    Args:
        path: Relative path from project root (e.g. backend/src/main/kotlin/.../UserController.kt)
        content: Full proposed file content
        description: Brief description of what this change does
    """
    changes = list(_proposed_changes.get([]))
    # Replace if same path proposed more than once (agent revised it)
    changes = [c for c in changes if c["path"] != path]
    changes.append({"path": path, "content": content, "description": description})
    _proposed_changes.set(changes)
    return f"Proposed change recorded for {path} ({len(content)} chars)"


@tool
def finalize_suggestion(plan: str) -> str:
    """
    Finalize the suggestion with an overall plan summary.
    Call this once you have proposed all file changes.
    The human will then see the plan + all proposed changes for review.

    Args:
        plan: Clear explanation of what you built, why, and what files were changed
    """
    _plan.set(plan)
    return "Suggestion finalized. Waiting for human review."
