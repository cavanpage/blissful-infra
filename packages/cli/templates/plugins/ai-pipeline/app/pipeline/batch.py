import json
import logging
from pyspark.sql import SparkSession
from pyspark.sql.functions import col, udf, from_json, to_json, struct
from pyspark.sql.types import StructType, StructField, StringType, FloatType
from app.config import KAFKA_BOOTSTRAP_SERVERS, EVENTS_TOPIC, PREDICTIONS_TOPIC, SPARK_MASTER, PROJECT_NAME
from app.model.classifier import EventClassifier

logger = logging.getLogger(__name__)

EVENT_SCHEMA = StructType([
    StructField("eventId", StringType(), True),
    StructField("eventType", StringType(), True),
    StructField("occurredAt", StringType(), True),
    StructField("name", StringType(), True),
])

PREDICTION_SCHEMA = StructType([
    StructField("eventId", StringType(), True),
    StructField("category", StringType(), True),
    StructField("confidence", FloatType(), True),
    StructField("sentiment", StringType(), True),
])


def run_batch_pipeline(status_holder: dict) -> int:
    """Run PySpark batch pipeline that reads all Kafka events and classifies them.

    Returns the number of events processed.
    """
    classifier = EventClassifier()

    def classify_event(event_json: str) -> str:
        result = classifier.predict(event_json)
        return json.dumps(result)

    spark = (
        SparkSession.builder
        .appName(f"{PROJECT_NAME}-ai-pipeline-batch")
        .master(SPARK_MASTER)
        .config("spark.jars.packages", "org.apache.spark:spark-sql-kafka-0-10_2.12:3.5.1")
        .getOrCreate()
    )

    spark.sparkContext.setLogLevel("WARN")

    classify_udf = udf(classify_event, StringType())

    status_holder["running"] = True
    status_holder["mode"] = "batch"
    logger.info("Starting batch pipeline: %s -> %s", EVENTS_TOPIC, PREDICTIONS_TOPIC)

    try:
        kafka_df = (
            spark.read
            .format("kafka")
            .option("kafka.bootstrap.servers", KAFKA_BOOTSTRAP_SERVERS)
            .option("subscribe", EVENTS_TOPIC)
            .option("startingOffsets", "earliest")
            .option("endingOffsets", "latest")
            .load()
        )

        events_df = (
            kafka_df
            .selectExpr("CAST(value AS STRING) as raw_event")
            .withColumn("event", from_json(col("raw_event"), EVENT_SCHEMA))
            .filter(col("event").isNotNull())
        )

        count = events_df.count()

        if count > 0:
            predictions_df = (
                events_df
                .withColumn("prediction_json", classify_udf(col("raw_event")))
                .withColumn("prediction", from_json(col("prediction_json"), PREDICTION_SCHEMA))
                .select(
                    col("prediction.eventId").alias("key"),
                    to_json(struct(
                        col("prediction.eventId"),
                        col("prediction.category"),
                        col("prediction.confidence"),
                        col("prediction.sentiment"),
                    )).alias("value"),
                )
            )

            predictions_df.write \
                .format("kafka") \
                .option("kafka.bootstrap.servers", KAFKA_BOOTSTRAP_SERVERS) \
                .option("topic", PREDICTIONS_TOPIC) \
                .save()

            logger.info("Batch pipeline processed %d events", count)
        else:
            logger.info("No events found in topic %s", EVENTS_TOPIC)

        status_holder["processed"] = status_holder.get("processed", 0) + count
        status_holder["running"] = False
        return count

    except Exception as e:
        logger.error("Batch pipeline error: %s", e)
        status_holder["running"] = False
        raise
    finally:
        spark.stop()
