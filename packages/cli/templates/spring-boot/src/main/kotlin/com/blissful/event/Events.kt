package com.blissful.event

import java.time.Instant

interface DomainEvent {
    val eventId: String
    val eventType: String
    val occurredAt: Instant
}

data class GreetingEvent(
    override val eventId: String,
    val name: String,
    override val eventType: String = "greeting.created",
    override val occurredAt: Instant = Instant.now()
) : DomainEvent
