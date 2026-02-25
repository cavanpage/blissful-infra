import logging
import threading
from collections import deque
from contextlib import asynccontextmanager
from fastapi import FastAPI
from pydantic import BaseModel
from app.config import PIPELINE_MODE, PROJECT_NAME
from app.kafka_utils import ensure_topics
from app.model.classifier import EventClassifier
from app.mlflow_utils import setup_mlflow, log_model_training
from app.clickhouse_utils import init_predictions_table, store_prediction

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
    # Connect to data platform services (best-effort — pipeline starts regardless)
    setup_mlflow()
    init_predictions_table()
    meta = classifier.get_training_metadata()
    log_model_training(meta["n_samples"], meta["n_classes"], meta["classes"])

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
    # Enrich with source name for storage and display
    result["name"] = req.name
    recent_predictions.appendleft(result)
    store_prediction(result)
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
