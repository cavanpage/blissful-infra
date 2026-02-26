import os

PROJECT_NAME = os.getenv("PROJECT_NAME", "content-recommender")
INSTANCE_NAME = os.getenv("INSTANCE_NAME", "local")

# Service
API_PORT = int(os.getenv("API_PORT", "8090"))

# Kafka
KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "kafka:9094")
EVENTS_TOPIC = os.getenv("EVENTS_TOPIC", "content-events")
PREDICTIONS_TOPIC = os.getenv("PREDICTIONS_TOPIC", "recommendations")

# ClickHouse
CLICKHOUSE_HOST = os.getenv("CLICKHOUSE_HOST", "clickhouse")
CLICKHOUSE_PORT = int(os.getenv("CLICKHOUSE_PORT", "8123"))
CLICKHOUSE_DB = os.getenv("CLICKHOUSE_DB", "recommender_db")

# MLflow
MLFLOW_TRACKING_URI = os.getenv("MLFLOW_TRACKING_URI", "http://mlflow:5000")
MLFLOW_EXPERIMENT = os.getenv("MLFLOW_EXPERIMENT", f"{PROJECT_NAME}-recommender")

# Recommendation model
TOP_K = int(os.getenv("TOP_K", "10"))
RETRAIN_THRESHOLD = int(os.getenv("RETRAIN_THRESHOLD", "50"))
MIN_INTERACTIONS_FOR_COLLAB = int(os.getenv("MIN_INTERACTIONS_FOR_COLLAB", "5"))
COLLAB_WEIGHT = float(os.getenv("COLLAB_WEIGHT", "0.7"))
MODEL_VERSION = os.getenv("MODEL_VERSION", "1.0")
