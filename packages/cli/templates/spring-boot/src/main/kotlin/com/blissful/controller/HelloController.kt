package com.blissful.controller

import com.blissful.event.EventPublisher
import com.blissful.event.GreetingEvent
import com.blissful.websocket.EventWebSocketHandler
{{#IF_POSTGRES}}
import com.blissful.entity.Greeting
import com.blissful.repository.GreetingRepository
{{/IF_POSTGRES}}
import org.slf4j.LoggerFactory
import org.springframework.web.bind.annotation.*
import java.util.UUID

{{#IF_POSTGRES}}
data class HelloResponse(
    val message: String,
    val savedId: Long? = null,
    val totalGreetings: Long? = null
)
{{/IF_POSTGRES}}
{{#IF_NO_POSTGRES}}
data class HelloResponse(
    val message: String
)
{{/IF_NO_POSTGRES}}

data class EchoRequest(
    val data: Any?
)

data class EchoResponse(
    val echo: Any?
)

{{#IF_POSTGRES}}
data class GreetingHistoryResponse(
    val greetings: List<GreetingDto>
)

data class GreetingDto(
    val id: Long,
    val name: String,
    val message: String,
    val createdAt: String
)
{{/IF_POSTGRES}}

@RestController
class HelloController(
    private val eventPublisher: EventPublisher,
{{#IF_POSTGRES}}
    private val webSocketHandler: EventWebSocketHandler,
    private val greetingRepository: GreetingRepository
{{/IF_POSTGRES}}
{{#IF_NO_POSTGRES}}
    private val webSocketHandler: EventWebSocketHandler
{{/IF_NO_POSTGRES}}
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

{{#IF_POSTGRES}}
        // Save greeting to database
        val saved = greetingRepository.save(
            Greeting(name = "World", message = "Hello, World!")
        )
        val totalCount = greetingRepository.count()
{{/IF_POSTGRES}}

        // Notify WebSocket clients
        webSocketHandler.broadcast("greeting", mapOf("name" to "World", "message" to "Hello, World!"))

{{#IF_POSTGRES}}
        return HelloResponse(
            message = "Hello, World!",
            savedId = saved.id,
            totalGreetings = totalCount
        )
{{/IF_POSTGRES}}
{{#IF_NO_POSTGRES}}
        return HelloResponse(message = "Hello, World!")
{{/IF_NO_POSTGRES}}
    }

    @GetMapping("/hello/{name}")
    fun helloName(@PathVariable name: String): HelloResponse {
        logger.info("Received hello request for name: {}", name)

        val event = GreetingEvent(
            eventId = UUID.randomUUID().toString(),
            name = name
        )
        eventPublisher.publish(event)

{{#IF_POSTGRES}}
        // Save greeting to database
        val saved = greetingRepository.save(
            Greeting(name = name, message = "Hello, $name!")
        )
        val totalCount = greetingRepository.count()
{{/IF_POSTGRES}}

        // Notify WebSocket clients
        webSocketHandler.broadcast("greeting", mapOf("name" to name, "message" to "Hello, $name!"))

{{#IF_POSTGRES}}
        return HelloResponse(
            message = "Hello, $name!",
            savedId = saved.id,
            totalGreetings = totalCount
        )
{{/IF_POSTGRES}}
{{#IF_NO_POSTGRES}}
        return HelloResponse(message = "Hello, $name!")
{{/IF_NO_POSTGRES}}
    }

    @PostMapping("/echo")
    fun echo(@RequestBody request: EchoRequest): EchoResponse {
        logger.info("Received echo request")
        return EchoResponse(echo = request.data)
    }

{{#IF_POSTGRES}}
    @GetMapping("/greetings")
    fun getGreetings(): GreetingHistoryResponse {
        logger.info("Fetching recent greetings from database")
        val greetings = greetingRepository.findTop10ByOrderByCreatedAtDesc()
        return GreetingHistoryResponse(
            greetings = greetings.map { g ->
                GreetingDto(
                    id = g.id!!,
                    name = g.name,
                    message = g.message,
                    createdAt = g.createdAt.toString()
                )
            }
        )
    }

    @GetMapping("/greetings/{name}")
    fun getGreetingsByName(@PathVariable name: String): GreetingHistoryResponse {
        logger.info("Fetching greetings for name: {}", name)
        val greetings = greetingRepository.findByNameIgnoreCase(name)
        return GreetingHistoryResponse(
            greetings = greetings.map { g ->
                GreetingDto(
                    id = g.id!!,
                    name = g.name,
                    message = g.message,
                    createdAt = g.createdAt.toString()
                )
            }
        )
    }
{{/IF_POSTGRES}}
}
