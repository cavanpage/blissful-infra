"""
Content Recommender — AI Pipeline Service

Extends the base blissful-infra ai-pipeline template with:
  - Real-time engagement event ingestion (POST /events)
  - Personalized recommendations (GET /recommendations/{user_id})
  - Global trending (GET /trending)
  - Full content catalog (GET /catalog)
  - Automatic model retraining triggered by event volume threshold

Data flow:
  Frontend → Spring Boot → Kafka(content-events) → this service
  this service → ClickHouse(user_events) → retrain trigger
  this service → ClickHouse(recommendations) → Spring Boot → Frontend
"""

import asyncio
import logging
import threading
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from . import config
from .data.catalog import CATALOG, CATALOG_BY_ID
from .model.recommender import Recommender
from .store import recommendations as store

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

# ------------------------------------------------------------------ #
# Global state                                                         #
# ------------------------------------------------------------------ #

recommender: Optional[Recommender] = None
_in_memory_events: list[tuple] = []  # fallback when ClickHouse is unavailable
_event_count_since_retrain = 0
_retrain_lock = threading.Lock()
_mlflow_connected = False


# ------------------------------------------------------------------ #
# MLflow helpers (best-effort)                                         #
# ------------------------------------------------------------------ #

def _setup_mlflow() -> bool:
    try:
        import mlflow
        mlflow.set_tracking_uri(config.MLFLOW_TRACKING_URI)
        mlflow.set_experiment(config.MLFLOW_EXPERIMENT)
        logger.info("MLflow connected: %s", config.MLFLOW_TRACKING_URI)
        return True
    except Exception as e:
        logger.warning("MLflow not available: %s", e)
        return False


def _log_training_to_mlflow(metadata: dict) -> None:
    if not _mlflow_connected:
        return
    try:
        import mlflow
        with mlflow.start_run(run_name=f"retrain-v{metadata['model_version']}"):
            mlflow.log_params({
                "algorithm": metadata["algorithm"],
                "als_factors": metadata["als_factors"],
                "als_iterations": metadata["als_iterations"],
                "collab_weight": metadata["collab_weight"],
                "min_interactions_for_collab": metadata["min_interactions_for_collab"],
            })
            mlflow.log_metrics({
                "n_users": metadata["n_users"],
                "n_items": metadata["n_items"],
                "n_interactions": metadata["n_interactions"],
            })
    except Exception as e:
        logger.debug("MLflow logging failed: %s", e)


# ------------------------------------------------------------------ #
# Retraining                                                           #
# ------------------------------------------------------------------ #

def _retrain_background() -> None:
    """Load all events from ClickHouse (or in-memory) and retrain."""
    global recommender, _event_count_since_retrain

    logger.info("Retraining recommender...")
    events = store.get_all_events(config.CLICKHOUSE_DB) or _in_memory_events

    if recommender is not None:
        recommender.train(events)
        metadata = recommender.get_training_metadata()
        _log_training_to_mlflow(metadata)
        logger.info(
            "Retrain complete: %d users, %d interactions, algorithm=%s",
            metadata["n_users"], metadata["n_interactions"], metadata["algorithm"],
        )

    with _retrain_lock:
        _event_count_since_retrain = 0


def _maybe_trigger_retrain() -> None:
    global _event_count_since_retrain
    with _retrain_lock:
        _event_count_since_retrain += 1
        should_retrain = _event_count_since_retrain >= config.RETRAIN_THRESHOLD

    if should_retrain:
        thread = threading.Thread(target=_retrain_background, daemon=True)
        thread.start()


# ------------------------------------------------------------------ #
# Lifespan                                                             #
# ------------------------------------------------------------------ #

@asynccontextmanager
async def lifespan(app: FastAPI):
    global recommender, _mlflow_connected

    # Initialize ClickHouse tables
    store.init_tables(config.CLICKHOUSE_HOST, config.CLICKHOUSE_PORT, config.CLICKHOUSE_DB)

    # Connect MLflow
    _mlflow_connected = _setup_mlflow()

    # Build the recommender (trains on SEED_INTERACTIONS internally)
    recommender = Recommender(
        collab_weight=config.COLLAB_WEIGHT,
        min_interactions_for_collab=config.MIN_INTERACTIONS_FOR_COLLAB,
    )

    # Log initial training state
    metadata = recommender.get_training_metadata()
    _log_training_to_mlflow(metadata)
    logger.info(
        "Recommender ready: %s — %d items, %d seed interactions",
        metadata["algorithm"], metadata["n_items"], metadata["n_interactions"],
    )

    yield


# ------------------------------------------------------------------ #
# App                                                                  #
# ------------------------------------------------------------------ #

app = FastAPI(
    title="Content Recommender",
    description="Real-time personalized content recommendations powered by collaborative filtering.",
    version="1.0.0",
    lifespan=lifespan,
)


# ------------------------------------------------------------------ #
# Request / Response models                                            #
# ------------------------------------------------------------------ #

class EngagementEvent(BaseModel):
    user_id: str
    item_id: str
    event_type: str = "view_complete"  # view_start | view_complete | rating | search
    value: float = 1.0                 # watch % (0-1), star rating (1-5), or 1.0 for binary


class RecommendationItem(BaseModel):
    id: str
    title: str
    genres: list[str]
    score: float
    source: str


class RecommendationResponse(BaseModel):
    user_id: str
    recommendations: list[RecommendationItem]
    model_version: str
    from_cache: bool


# ------------------------------------------------------------------ #
# Endpoints                                                            #
# ------------------------------------------------------------------ #

@app.get("/health")
def health():
    meta = recommender.get_training_metadata() if recommender else {}
    return {
        "status": "ok",
        "project": config.PROJECT_NAME,
        "model": {
            "algorithm": meta.get("algorithm", "not_ready"),
            "n_users": meta.get("n_users", 0),
            "n_interactions": meta.get("n_interactions", 0),
            "trained_at": meta.get("trained_at"),
        },
        "storage": {
            "clickhouse": store._client is not None,
            "mlflow": _mlflow_connected,
        },
    }


@app.post("/events", status_code=202)
def ingest_event(event: EngagementEvent):
    """
    Record a user engagement event (view, rating, search).
    Persists to ClickHouse and triggers model retraining when the
    accumulated event count crosses RETRAIN_THRESHOLD.
    """
    if event.item_id not in CATALOG_BY_ID:
        raise HTTPException(status_code=404, detail=f"Item '{event.item_id}' not in catalog")

    allowed_types = {"view_start", "view_complete", "rating", "search"}
    if event.event_type not in allowed_types:
        raise HTTPException(
            status_code=422,
            detail=f"event_type must be one of {sorted(allowed_types)}",
        )

    # Persist and cache in memory (fallback if ClickHouse is down)
    store.store_event(event.user_id, event.item_id, event.event_type, event.value)
    _in_memory_events.append((event.user_id, event.item_id, event.event_type, event.value))

    _maybe_trigger_retrain()

    return {"accepted": True, "item": CATALOG_BY_ID[event.item_id]["title"]}


@app.get("/recommendations/{user_id}", response_model=RecommendationResponse)
def get_recommendations(user_id: str, top_k: int = None):
    """
    Return personalized recommendations for a user.

    Serving path:
    1. Try ClickHouse (fast, persisted across restarts)
    2. Fall back to in-memory model inference if ClickHouse is empty
    3. Return trending if the user has no history at all
    """
    k = top_k or config.TOP_K
    meta = recommender.get_training_metadata() if recommender else {}

    # Try ClickHouse first (cheapest path)
    cached = store.get_recommendations(user_id, k)
    if cached:
        return RecommendationResponse(
            user_id=user_id,
            recommendations=[RecommendationItem(**r) for r in cached],
            model_version=meta.get("model_version", config.MODEL_VERSION),
            from_cache=True,
        )

    # Fall back to live model inference
    if recommender is None:
        raise HTTPException(status_code=503, detail="Model not yet initialized")

    recs = recommender.recommend(user_id, k)

    # Persist for future requests
    store.store_recommendations(user_id, recs, meta.get("model_version", config.MODEL_VERSION))

    return RecommendationResponse(
        user_id=user_id,
        recommendations=[RecommendationItem(**r) for r in recs],
        model_version=meta.get("model_version", config.MODEL_VERSION),
        from_cache=False,
    )


@app.get("/trending")
def get_trending(top_k: int = None):
    """
    Global trending: items with the highest weighted engagement across all users.
    Useful for new users and the home feed before personalization kicks in.
    """
    k = top_k or config.TOP_K
    if recommender is None:
        raise HTTPException(status_code=503, detail="Model not yet initialized")
    return {"trending": recommender.trending(k)}


@app.get("/catalog")
def get_catalog():
    """Full content catalog — used by the frontend to render the browse page."""
    return {"items": CATALOG, "count": len(CATALOG)}


@app.get("/catalog/{item_id}")
def get_catalog_item(item_id: str):
    item = CATALOG_BY_ID.get(item_id)
    if not item:
        raise HTTPException(status_code=404, detail=f"Item '{item_id}' not found")
    return item


@app.get("/model/status")
def model_status():
    """Detailed model metadata — useful for monitoring and MLflow comparison."""
    if recommender is None:
        return {"status": "not_ready"}
    meta = recommender.get_training_metadata()
    return {
        "status": "ready",
        **meta,
        "retrain_threshold": config.RETRAIN_THRESHOLD,
        "events_since_last_retrain": _event_count_since_retrain,
    }
