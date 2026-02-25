import logging
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException, BackgroundTasks
from langchain_core.messages import HumanMessage, SystemMessage
from app.config import PROJECT_NAME
from app.models import (
    Agent, AgentStatus, Task, TaskStatus, TaskStep, StepStatus,
    Suggestion, ProposedChange,
    HireRequest, AssignRequest,
)
from app.tools.suggestion_tools import reset_suggestion, restore_suggestion, get_suggestion
from app.agents.registry import hire_agent, fire_agent, list_agents, get_agent
from app.agents.feature_engineer import create_feature_engineer_graph, SYSTEM_PROMPT
from app.state import load_agents, save_agents

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Agent service starting for project %s", PROJECT_NAME)
    yield
    logger.info("Agent service shutting down")


app = FastAPI(title=f"{PROJECT_NAME} Agent Service", lifespan=lifespan)


@app.get("/health")
def health():
    agents = list_agents()
    return {"status": "UP", "project": PROJECT_NAME, "agents": len(agents)}


@app.post("/agents", response_model=Agent)
def api_hire_agent(req: HireRequest):
    try:
        return hire_agent(req)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.delete("/agents/{name}")
def api_fire_agent(name: str):
    if not fire_agent(name):
        raise HTTPException(404, f"Agent '{name}' not found")
    return {"message": f"Agent '{name}' terminated"}


@app.get("/agents", response_model=list[Agent])
def api_list_agents():
    return list_agents()


@app.get("/agents/{name}", response_model=Agent)
def api_get_agent(name: str):
    agent = get_agent(name)
    if not agent:
        raise HTTPException(404, f"Agent '{name}' not found")
    return agent


@app.get("/agents/{name}/suggestion", response_model=Suggestion)
def api_get_suggestion(name: str):
    agent = get_agent(name)
    if not agent:
        raise HTTPException(404, f"Agent '{name}' not found")
    if not agent.current_task or not agent.current_task.suggestion:
        raise HTTPException(404, f"No suggestion available for agent '{name}'. "
                                 f"Agent status: {agent.status.value}")
    return agent.current_task.suggestion


@app.post("/agents/{name}/assign")
async def api_assign_task(name: str, req: AssignRequest, bg: BackgroundTasks):
    agent = get_agent(name)
    if not agent:
        raise HTTPException(404, f"Agent '{name}' not found")
    if agent.status == AgentStatus.WORKING:
        raise HTTPException(409, f"Agent '{name}' is already working on a task")

    task = Task(
        id=f"task-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}",
        description=req.description,
        status=TaskStatus.PENDING,
        created_at=datetime.now(timezone.utc).isoformat(),
    )

    # Update agent state
    agents_data = load_agents()
    agents_data[name]["status"] = AgentStatus.WORKING.value
    agents_data[name]["current_task"] = task.model_dump(mode="json")
    save_agents(agents_data)

    bg.add_task(_run_agent_task, name, task)
    return {"message": f"Task assigned to {name}", "task_id": task.id}


async def _run_agent_task(agent_name: str, task: Task) -> None:
    """Execute the LangGraph agent for the assigned task."""
    tokens = reset_suggestion()
    try:
        graph = create_feature_engineer_graph()

        initial_state = {
            "messages": [
                SystemMessage(content=SYSTEM_PROMPT),
                HumanMessage(content=task.description),
            ],
        }

        result = await asyncio.to_thread(graph.invoke, initial_state)

        # Extract completed steps from tool calls in messages
        steps = []
        for msg in result.get("messages", []):
            if hasattr(msg, "tool_calls") and msg.tool_calls:
                for tc in msg.tool_calls:
                    steps.append(TaskStep(
                        description=f"{tc['name']}({', '.join(f'{k}={repr(v)[:50]}' for k, v in tc['args'].items())})",
                        status=StepStatus.COMPLETED,
                        timestamp=datetime.now(timezone.utc).isoformat(),
                    ))

        # Build suggestion from accumulated propose_file_change / finalize_suggestion calls
        raw = get_suggestion()
        suggestion = None
        if raw["changes"]:
            suggestion = Suggestion(
                plan=raw["plan"] or "No plan summary provided.",
                changes=[
                    ProposedChange(
                        path=c["path"],
                        content=c["content"],
                        description=c.get("description", ""),
                        diff=_compute_diff(c["path"], c["content"]),
                    )
                    for c in raw["changes"]
                ],
                revision=1,
            )

        agents_data = load_agents()
        if agent_name in agents_data:
            agents_data[agent_name]["status"] = AgentStatus.AWAITING_REVIEW.value
            agents_data[agent_name]["current_task"]["status"] = TaskStatus.COMPLETED.value
            agents_data[agent_name]["current_task"]["completed_at"] = datetime.now(timezone.utc).isoformat()
            agents_data[agent_name]["current_task"]["steps"] = [s.model_dump(mode="json") for s in steps]
            if suggestion:
                agents_data[agent_name]["current_task"]["suggestion"] = suggestion.model_dump(mode="json")
            save_agents(agents_data)

        logger.info("Agent %s completed task with %d steps, %d proposed changes",
                    agent_name, len(steps), len(raw["changes"]))

    except Exception as e:
        logger.error("Agent %s task failed: %s", agent_name, e)
        agents_data = load_agents()
        if agent_name in agents_data:
            agents_data[agent_name]["status"] = AgentStatus.ERROR.value
            agents_data[agent_name]["current_task"]["status"] = TaskStatus.FAILED.value
            agents_data[agent_name]["current_task"]["result"] = str(e)
            save_agents(agents_data)
    finally:
        restore_suggestion(tokens)


def _compute_diff(path: str, proposed_content: str) -> str:
    """Compute a unified diff between the current file and the proposed content.
    Returns the full proposed content as an addition if the file does not exist."""
    import difflib
    import os
    from app.config import WORKSPACE_DIR

    full_path = os.path.join(WORKSPACE_DIR, path)
    if os.path.isfile(full_path):
        with open(full_path) as f:
            original_lines = f.readlines()
    else:
        original_lines = []

    proposed_lines = [l if l.endswith("\n") else l + "\n" for l in proposed_content.splitlines()]

    diff = difflib.unified_diff(
        original_lines,
        proposed_lines,
        fromfile=f"a/{path}",
        tofile=f"b/{path}",
        lineterm="",
    )
    return "\n".join(diff)
