from datetime import datetime, timezone
from app.models import Agent, AgentRole, AgentStatus, HireRequest
from app.state import load_agents, save_agents


def hire_agent(req: HireRequest) -> Agent:
    agents = load_agents()
    if req.name in agents:
        raise ValueError(f"Agent '{req.name}' already exists")
    agent = Agent(
        name=req.name,
        role=req.role,
        status=AgentStatus.IDLE,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    agents[req.name] = agent.model_dump(mode="json")
    save_agents(agents)
    return agent


def fire_agent(name: str) -> bool:
    agents = load_agents()
    if name not in agents:
        return False
    del agents[name]
    save_agents(agents)
    return True


def list_agents() -> list[Agent]:
    agents = load_agents()
    return [Agent(**data) for data in agents.values()]


def get_agent(name: str) -> Agent | None:
    agents = load_agents()
    if name in agents:
        return Agent(**agents[name])
    return None
