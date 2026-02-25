import logging
from typing import Literal
from langgraph.graph import StateGraph, END, MessagesState
from langgraph.prebuilt import ToolNode
from app.tools.code_tools import read_file, list_files, search_in_files
from app.tools.git_tools import git_status, git_diff
from app.tools.suggestion_tools import propose_file_change, finalize_suggestion
from app.config import AI_PROVIDER, AI_MODEL, ANTHROPIC_API_KEY, OLLAMA_BASE_URL

logger = logging.getLogger(__name__)

# Read-only tools for analysis + suggestion tools for recording proposals.
# Write tools (write_file, git_create_branch, git_add_and_commit) are intentionally
# excluded — nothing touches disk until the human accepts via `agent accept`.
TOOLS = [
    read_file,
    list_files,
    search_in_files,
    git_status,
    git_diff,
    propose_file_change,
    finalize_suggestion,
]

SYSTEM_PROMPT = """You are a Feature Engineer virtual employee for a blissful-infra project.
Your job is to analyze the codebase and PROPOSE changes for human review — you do NOT write
files or commit anything directly. A human will review your suggestion and decide whether to apply it.

Process:
1. EXPLORE: Use list_files and read_file to understand the project structure and conventions
2. SEARCH: Use search_in_files to find relevant existing code (controllers, services, tests)
3. PLAN: Decide exactly which files to create or modify and how
4. PROPOSE: Call propose_file_change for each file you want to create or modify
   - For each file, provide the COMPLETE intended file content (not just a diff)
   - Follow existing code conventions exactly (same package structure, naming, style)
5. FINALIZE: Call finalize_suggestion with a clear plain-English summary of:
   - What you built and why
   - Which files are new vs modified
   - How to test the changes

Rules:
- Never call write_file or git tools — you only have read access to the filesystem
- Always read existing similar files before proposing new ones (follow the pattern)
- Propose complete, working file contents — not partial snippets
- Include tests when proposing new features, following existing test conventions
- Be thorough: read at least 3-5 existing files before proposing anything"""


def _get_llm():
    if AI_PROVIDER == "ollama":
        from langchain_ollama import ChatOllama
        return ChatOllama(model=AI_MODEL, base_url=OLLAMA_BASE_URL)
    else:
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(model=AI_MODEL, api_key=ANTHROPIC_API_KEY)


def _should_continue(state: MessagesState) -> Literal["tools", "__end__"]:
    last_msg = state["messages"][-1]
    if hasattr(last_msg, "tool_calls") and last_msg.tool_calls:
        return "tools"
    return "__end__"


def create_feature_engineer_graph():
    llm = _get_llm().bind_tools(TOOLS)
    tool_node = ToolNode(TOOLS)

    def agent_node(state: MessagesState):
        response = llm.invoke(state["messages"])
        return {"messages": [response]}

    graph = StateGraph(MessagesState)
    graph.add_node("agent", agent_node)
    graph.add_node("tools", tool_node)
    graph.set_entry_point("agent")
    graph.add_conditional_edges("agent", _should_continue, {"tools": "tools", "__end__": END})
    graph.add_edge("tools", "agent")

    return graph.compile()
