from pydantic import BaseModel
from enum import Enum
from typing import Optional, List


class AgentRole(str, Enum):
    FEATURE_ENGINEER = "feature-engineer"


class AgentStatus(str, Enum):
    IDLE = "idle"
    WORKING = "working"
    AWAITING_REVIEW = "awaiting-review"
    ERROR = "error"


class TaskStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in-progress"
    COMPLETED = "completed"
    FAILED = "failed"


class StepStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in-progress"
    COMPLETED = "completed"
    FAILED = "failed"


class TaskStep(BaseModel):
    description: str
    status: StepStatus = StepStatus.PENDING
    output: Optional[str] = None
    timestamp: Optional[str] = None


class Task(BaseModel):
    id: str
    description: str
    status: TaskStatus = TaskStatus.PENDING
    steps: list[TaskStep] = []
    result: Optional[str] = None
    branch: Optional[str] = None
    suggestion: Optional[Suggestion] = None
    created_at: str
    started_at: Optional[str] = None
    completed_at: Optional[str] = None


class Agent(BaseModel):
    name: str
    role: AgentRole
    status: AgentStatus = AgentStatus.IDLE
    current_task: Optional[Task] = None
    task_history: list[str] = []
    created_at: str


class ProposedChange(BaseModel):
    path: str
    content: str
    description: str = ""
    diff: Optional[str] = None  # unified diff computed at review time


class Suggestion(BaseModel):
    plan: str
    changes: List[ProposedChange]
    revision: int = 1


class HireRequest(BaseModel):
    name: str
    role: AgentRole


class AssignRequest(BaseModel):
    description: str


class ReviseRequest(BaseModel):
    feedback: str
