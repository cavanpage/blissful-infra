import logging
from typing import Literal
from langgraph.graph import StateGraph, END, MessagesState
from langgraph.prebuilt import ToolNode
from app.tools.code_tools import read_file, write_file, list_files, search_in_files
from app.tools.git_tools import git_status, git_diff, git_create_branch, git_add_and_commit
from app.config import AI_PROVIDER, AI_MODEL, ANTHROPIC_API_KEY, OLLAMA_BASE_URL

logger = logging.getLogger(__name__)

TOOLS = [
    read_file, write_file, list_files, search_in_files,
    git_status, git_diff, git_create_branch, git_add_and_commit,
]

SYSTEM_PROMPT = """You are a Feature Engineer virtual employee for a blissful-infra project.
You build features by reading the codebase, writing code, and committing changes.

Process:
1. EXPLORE: List files and read the codebase to understand existing patterns and structure
2. PLAN: Decide which files to create or modify
3. IMPLEMENT: Write the code files following existing conventions
4. VERIFY: Check git diff to review your changes
5. COMMIT: Create a feature branch and commit your changes

Rules:
- Always follow existing code conventions and patterns
- Write clean, well-structured code
- Create a descriptive branch name like feat/<feature-name>
- Write a clear commit message describing what you built
- Do not modify files unrelated to the task"""


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
