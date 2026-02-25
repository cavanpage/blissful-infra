"""
ClickHouse storage helpers for durable prediction persistence.
All functions are best-effort — a missing or unreachable ClickHouse server
will log a warning and let the pipeline continue with in-memory storage only.
"""
import logging
from datetime import datetime, timezone
from app.config import CLICKHOUSE_HOST, CLICKHOUSE_PORT, CLICKHOUSE_DB

logger = logging.getLogger(__name__)

_client = None
_table_ready = False


def _get_client():
    """Return a shared ClickHouse client, creating it on first call."""
    global _client
    if _client is None:
        import clickhouse_connect
        _client = clickhouse_connect.get_client(
            host=CLICKHOUSE_HOST,
            port=CLICKHOUSE_PORT,
            database=CLICKHOUSE_DB,
        )
    return _client


def init_predictions_table() -> bool:
    """Create the predictions table if it does not already exist.

    Uses a MergeTree engine ordered by (timestamp, event_id) for efficient
    time-range and point queries. Returns True if the table is ready.
    """
    global _table_ready
    try:
        client = _get_client()
        client.command("""
            CREATE TABLE IF NOT EXISTS predictions (
                timestamp  DateTime DEFAULT now(),
                event_id   String,
                name       String,
                category   String,
                confidence Float32,
                sentiment  String
            ) ENGINE = MergeTree()
            ORDER BY (timestamp, event_id)
        """)
        _table_ready = True
        logger.info("ClickHouse predictions table ready at %s:%d/%s", CLICKHOUSE_HOST, CLICKHOUSE_PORT, CLICKHOUSE_DB)
        return True
    except Exception as exc:
        logger.warning("ClickHouse not available (predictions will be in-memory only): %s", exc)
        return False


def store_prediction(prediction: dict) -> None:
    """Append a single prediction row to ClickHouse.

    Args:
        prediction: dict containing eventId, name, category, confidence, sentiment.
    """
    if not _table_ready:
        return
    try:
        client = _get_client()
        client.insert(
            "predictions",
            [[
                datetime.now(timezone.utc),
                prediction.get("eventId", ""),
                prediction.get("name", ""),
                prediction.get("category", ""),
                float(prediction.get("confidence", 0.0)),
                prediction.get("sentiment", ""),
            ]],
            column_names=["timestamp", "event_id", "name", "category", "confidence", "sentiment"],
        )
    except Exception as exc:
        logger.debug("ClickHouse insert skipped: %s", exc)
