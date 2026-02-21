import os

PROJECT_NAME = os.getenv("PROJECT_NAME", "{{PROJECT_NAME}}")
INSTANCE_NAME = os.getenv("INSTANCE_NAME", "{{INSTANCE_NAME}}")
API_PORT = int(os.getenv("API_PORT", "{{API_PORT}}"))
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://host.docker.internal:11434")
AI_PROVIDER = os.getenv("AI_PROVIDER", "claude")  # "claude" or "ollama"
AI_MODEL = os.getenv("AI_MODEL", "claude-sonnet-4-20250514")
WORKSPACE_DIR = os.getenv("WORKSPACE_DIR", "/workspace")
STATE_DIR = os.getenv("STATE_DIR", "/data/agent-state")
