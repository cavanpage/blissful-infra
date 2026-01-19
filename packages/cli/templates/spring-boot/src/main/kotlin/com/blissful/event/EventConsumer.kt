package com.blissful.event

import com.blissful.websocket.EventWebSocketHandler
import org.slf4j.LoggerFactory
import org.springframework.kafka.annotation.KafkaListener
import org.springframework.stereotype.Component

@Component
class EventConsumer(
    private val webSocketHandler: EventWebSocketHandler
) {
    private val logger = LoggerFactory.getLogger(javaClass)

    @KafkaListener(topics = ["events"], groupId = "{{PROJECT_NAME}}-consumer")
    fun consume(message: String) {
        logger.info("Received event from Kafka: {}", message)

        // Forward to WebSocket clients
        webSocketHandler.broadcast("kafka-event", message)
    }
}
