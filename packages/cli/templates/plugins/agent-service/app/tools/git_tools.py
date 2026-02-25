import subprocess
from langchain_core.tools import tool
from app.config import WORKSPACE_DIR


def _run_git(*args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=WORKSPACE_DIR,
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        return f"Error: {result.stderr.strip()}"
    return result.stdout.strip()


@tool
def git_status() -> str:
    """Show the current git status."""
    return _run_git("status", "--short")


@tool
def git_diff() -> str:
    """Show current unstaged changes."""
    return _run_git("diff")


@tool
def git_create_branch(branch_name: str) -> str:
    """Create and checkout a new branch."""
    return _run_git("checkout", "-b", branch_name)


@tool
def git_add_and_commit(message: str) -> str:
    """Stage all changes and commit with a message."""
    _run_git("add", "-A")
    return _run_git("commit", "-m", message)
