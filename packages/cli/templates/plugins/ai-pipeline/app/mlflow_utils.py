"""
MLflow experiment tracking helpers.
All functions are best-effort — a missing or unreachable MLflow server
will log a warning and let the pipeline continue normally.
"""
import logging
from app.config import MLFLOW_TRACKING_URI, MLFLOW_EXPERIMENT

logger = logging.getLogger(__name__)

_mlflow_ready = False


def setup_mlflow() -> bool:
    """Connect to MLflow and ensure the experiment exists.

    Returns True if the connection succeeded, False otherwise.
    Called once at startup; failure does not prevent the pipeline from running.
    """
    global _mlflow_ready
    try:
        import mlflow
        mlflow.set_tracking_uri(MLFLOW_TRACKING_URI)
        mlflow.set_experiment(MLFLOW_EXPERIMENT)
        _mlflow_ready = True
        logger.info("MLflow connected: %s, experiment: %s", MLFLOW_TRACKING_URI, MLFLOW_EXPERIMENT)
        return True
    except Exception as exc:
        logger.warning("MLflow not available (pipeline will run without tracking): %s", exc)
        return False


def log_model_training(n_samples: int, n_classes: int, classes: list[str]) -> None:
    """Record a model-training event as an MLflow run.

    Logs algorithm name, training-set size, and class labels so every
    model version is reproducible from the MLflow UI.
    """
    if not _mlflow_ready:
        return
    try:
        import mlflow
        with mlflow.start_run(run_name="model-training"):
            mlflow.log_param("algorithm", "TF-IDF + MultinomialNB")
            mlflow.log_param("n_samples", n_samples)
            mlflow.log_param("n_classes", n_classes)
            mlflow.log_param("classes", ", ".join(classes))
        logger.info("Logged model training to MLflow (%d samples, %d classes)", n_samples, n_classes)
    except Exception as exc:
        logger.debug("MLflow logging skipped: %s", exc)
