import logging
import threading
from collections import deque
from contextlib import asynccontextmanager
from fastapi import FastAPI
from pydantic import BaseModel
from app.config import PIPELINE_MODE, PROJECT_NAME
from app.kafka_utils import ensure_topics
from app.model.classifier import EventClassifier

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# Shared state
pipeline_status: dict = {"running": False, "mode": PIPELINE_MODE, "processed": 0}
recent_predictions: deque = deque(maxlen=100)
classifier = EventClassifier()


class PredictRequest(BaseModel):
    name: str
    eventId: str | None = None
    eventType: str | None = None


def _start_pipeline():
    """Start the configured pipeline in a background thread."""
    try:
        ensure_topics()

        if PIPELINE_MODE == "streaming":
            from app.pipeline.streaming import start_streaming_pipeline
            start_streaming_pipeline(pipeline_status)
        else:
            from app.pipeline.batch import run_batch_pipeline
            run_batch_pipeline(pipeline_status)
    except Exception as e:
        logger.error("Pipeline failed: %s", e)
        pipeline_status["running"] = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    thread = threading.Thread(target=_start_pipeline, daemon=True)
    thread.start()
    logger.info("Pipeline thread started in %s mode", PIPELINE_MODE)
    yield
    logger.info("Shutting down")


app = FastAPI(title=f"{PROJECT_NAME} AI Pipeline", lifespan=lifespan)


@app.get("/health")
def health():
    return {
        "status": "UP",
        "pipeline": {
            "mode": pipeline_status["mode"],
            "running": pipeline_status["running"],
            "processed": pipeline_status["processed"],
        },
        "project": PROJECT_NAME,
    }


@app.post("/predict")
def predict(req: PredictRequest):
    event = {"name": req.name, "eventId": req.eventId or "manual", "eventType": req.eventType or "manual"}
    result = classifier.predict(event)
    recent_predictions.appendleft(result)
    return result


@app.get("/predictions")
def predictions():
    return {"predictions": list(recent_predictions), "count": len(recent_predictions)}


@app.get("/pipeline/status")
def pipeline_status_endpoint():
    return {
        "mode": pipeline_status["mode"],
        "running": pipeline_status["running"],
        "processed": pipeline_status["processed"],
    }
