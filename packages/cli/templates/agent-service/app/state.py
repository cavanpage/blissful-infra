import json
import os
from app.config import STATE_DIR

STATE_FILE = os.path.join(STATE_DIR, "agents.json")


def load_agents() -> dict[str, dict]:
    os.makedirs(STATE_DIR, exist_ok=True)
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return json.load(f)
    return {}


def save_agents(agents: dict[str, dict]) -> None:
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(STATE_FILE, "w") as f:
        json.dump(agents, f, indent=2)
