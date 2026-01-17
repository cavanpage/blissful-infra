package com.blissful.event

import com.fasterxml.jackson.databind.ObjectMapper
import org.slf4j.LoggerFactory
import org.springframework.kafka.core.KafkaTemplate
import org.springframework.stereotype.Component

@Component
class EventPublisher(
    private val kafkaTemplate: KafkaTemplate<String, String>,
    private val objectMapper: ObjectMapper
) {
    private val logger = LoggerFactory.getLogger(javaClass)

    fun publish(event: DomainEvent) {
        try {
            val payload = objectMapper.writeValueAsString(event)
            kafkaTemplate.send("events", event.eventId, payload)
            logger.info("Published event: type={}, id={}", event.eventType, event.eventId)
        } catch (e: Exception) {
            logger.error("Failed to publish event: type={}, id={}", event.eventType, event.eventId, e)
        }
    }
}
