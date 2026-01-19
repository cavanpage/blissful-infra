package com.blissful.controller

import com.blissful.event.EventPublisher
import com.blissful.event.GreetingEvent
import com.blissful.websocket.EventWebSocketHandler
import org.slf4j.LoggerFactory
import org.springframework.web.bind.annotation.*
import java.util.UUID

data class HelloResponse(
    val message: String
)

data class EchoRequest(
    val data: Any?
)

data class EchoResponse(
    val echo: Any?
)

@RestController
class HelloController(
    private val eventPublisher: EventPublisher,
    private val webSocketHandler: EventWebSocketHandler
) {
    private val logger = LoggerFactory.getLogger(javaClass)

    @GetMapping("/hello")
    fun hello(): HelloResponse {
        logger.info("Received hello request")

        val event = GreetingEvent(
            eventId = UUID.randomUUID().toString(),
            name = "World"
        )
        eventPublisher.publish(event)

        // Notify WebSocket clients
        webSocketHandler.broadcast("greeting", mapOf("name" to "World", "message" to "Hello, World!"))

        return HelloResponse(message = "Hello, World!")
    }

    @GetMapping("/hello/{name}")
    fun helloName(@PathVariable name: String): HelloResponse {
        logger.info("Received hello request for name: {}", name)

        val event = GreetingEvent(
            eventId = UUID.randomUUID().toString(),
            name = name
        )
        eventPublisher.publish(event)

        // Notify WebSocket clients
        webSocketHandler.broadcast("greeting", mapOf("name" to name, "message" to "Hello, $name!"))

        return HelloResponse(message = "Hello, $name!")
    }

    @PostMapping("/echo")
    fun echo(@RequestBody request: EchoRequest): EchoResponse {
        logger.info("Received echo request")
        return EchoResponse(echo = request.data)
    }
}
