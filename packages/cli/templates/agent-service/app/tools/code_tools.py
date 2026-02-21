import os
import glob as globmod
from langchain_core.tools import tool
from app.config import WORKSPACE_DIR


@tool
def read_file(path: str) -> str:
    """Read a file from the project workspace."""
    full_path = os.path.join(WORKSPACE_DIR, path)
    if not os.path.isfile(full_path):
        return f"Error: File not found: {path}"
    with open(full_path) as f:
        return f.read()


@tool
def write_file(path: str, content: str) -> str:
    """Write content to a file in the project workspace."""
    full_path = os.path.join(WORKSPACE_DIR, path)
    os.makedirs(os.path.dirname(full_path), exist_ok=True)
    with open(full_path, "w") as f:
        f.write(content)
    return f"Written {len(content)} bytes to {path}"


@tool
def list_files(directory: str = ".", pattern: str = "**/*") -> str:
    """List files in the project workspace matching a glob pattern."""
    full_path = os.path.join(WORKSPACE_DIR, directory)
    matches = globmod.glob(os.path.join(full_path, pattern), recursive=True)
    relative = [os.path.relpath(m, WORKSPACE_DIR) for m in matches if os.path.isfile(m)]
    return "\n".join(sorted(relative)[:100]) or "No files found"


@tool
def search_in_files(query: str, file_pattern: str = "**/*") -> str:
    """Search for a string across files in the workspace."""
    results = []
    for filepath in globmod.glob(os.path.join(WORKSPACE_DIR, file_pattern), recursive=True):
        if not os.path.isfile(filepath):
            continue
        try:
            with open(filepath) as f:
                for i, line in enumerate(f, 1):
                    if query.lower() in line.lower():
                        rel = os.path.relpath(filepath, WORKSPACE_DIR)
                        results.append(f"{rel}:{i}: {line.rstrip()}")
        except (UnicodeDecodeError, PermissionError):
            pass
    return "\n".join(results[:50]) or "No matches found"
