package com.blissful.event

import org.slf4j.LoggerFactory
import org.springframework.kafka.annotation.KafkaListener
import org.springframework.messaging.simp.SimpMessagingTemplate
import org.springframework.stereotype.Component

@Component
class EventConsumer(
    private val messagingTemplate: SimpMessagingTemplate
) {
    private val logger = LoggerFactory.getLogger(javaClass)

    @KafkaListener(topics = ["events"], groupId = "my-idea-consumer")
    fun consume(message: String) {
        logger.info("Received event from Kafka: {}", message)

        // Forward to WebSocket clients
        messagingTemplate.convertAndSend("/topic/events", message)
    }
}
