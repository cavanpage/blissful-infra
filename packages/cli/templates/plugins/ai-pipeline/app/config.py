import os

PROJECT_NAME = os.getenv("PROJECT_NAME", "{{PROJECT_NAME}}")
INSTANCE_NAME = os.getenv("INSTANCE_NAME", "{{INSTANCE_NAME}}")
KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "kafka:9094")
EVENTS_TOPIC = os.getenv("EVENTS_TOPIC", "events")
PREDICTIONS_TOPIC = os.getenv("PREDICTIONS_TOPIC", "predictions")
PIPELINE_MODE = os.getenv("PIPELINE_MODE", "streaming")  # "batch" or "streaming"
API_PORT = int(os.getenv("API_PORT", "8090"))
SPARK_MASTER = os.getenv("SPARK_MASTER", "local[*]")

# MLflow experiment tracking
MLFLOW_TRACKING_URI = os.getenv("MLFLOW_TRACKING_URI", "http://mlflow:5000")
MLFLOW_EXPERIMENT = os.getenv("MLFLOW_EXPERIMENT", f"{PROJECT_NAME}-pipeline")

# ClickHouse columnar storage
CLICKHOUSE_HOST = os.getenv("CLICKHOUSE_HOST", "clickhouse")
CLICKHOUSE_PORT = int(os.getenv("CLICKHOUSE_PORT", "8123"))
CLICKHOUSE_DB = os.getenv("CLICKHOUSE_DB", "pipeline_db")
