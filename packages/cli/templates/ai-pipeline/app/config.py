import os

PROJECT_NAME = os.getenv("PROJECT_NAME", "{{PROJECT_NAME}}")
KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "kafka:9094")
EVENTS_TOPIC = os.getenv("EVENTS_TOPIC", "events")
PREDICTIONS_TOPIC = os.getenv("PREDICTIONS_TOPIC", "predictions")
PIPELINE_MODE = os.getenv("PIPELINE_MODE", "streaming")  # "batch" or "streaming"
API_PORT = int(os.getenv("API_PORT", "8090"))
SPARK_MASTER = os.getenv("SPARK_MASTER", "local[*]")
