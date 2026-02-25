import logging
import time
from kafka import KafkaAdminClient
from kafka.admin import NewTopic
from kafka.errors import TopicAlreadyExistsError, NoBrokersAvailable
from app.config import KAFKA_BOOTSTRAP_SERVERS, PREDICTIONS_TOPIC

logger = logging.getLogger(__name__)


def ensure_topics(max_retries: int = 10, retry_delay: float = 3.0) -> None:
    """Create the predictions topic if it doesn't exist, with retry logic for Kafka startup."""
    for attempt in range(max_retries):
        try:
            admin = KafkaAdminClient(bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS)
            try:
                admin.create_topics([
                    NewTopic(name=PREDICTIONS_TOPIC, num_partitions=1, replication_factor=1),
                ])
                logger.info("Created topic: %s", PREDICTIONS_TOPIC)
            except TopicAlreadyExistsError:
                logger.info("Topic already exists: %s", PREDICTIONS_TOPIC)
            finally:
                admin.close()
            return
        except NoBrokersAvailable:
            if attempt < max_retries - 1:
                logger.info(
                    "Kafka not ready, retrying in %.0fs... (%d/%d)",
                    retry_delay, attempt + 1, max_retries,
                )
                time.sleep(retry_delay)
            else:
                logger.warning("Could not connect to Kafka after %d retries", max_retries)
