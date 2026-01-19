package com.blissful.websocket

import com.fasterxml.jackson.databind.ObjectMapper
import org.slf4j.LoggerFactory
import org.springframework.web.socket.CloseStatus
import org.springframework.web.socket.TextMessage
import org.springframework.web.socket.WebSocketSession
import org.springframework.web.socket.handler.TextWebSocketHandler
import java.util.concurrent.CopyOnWriteArraySet

data class WebSocketEvent(
    val type: String,
    val payload: Any?,
    val timestamp: Long = System.currentTimeMillis()
)

class EventWebSocketHandler : TextWebSocketHandler() {

    private val logger = LoggerFactory.getLogger(javaClass)
    private val sessions = CopyOnWriteArraySet<WebSocketSession>()
    private val objectMapper = ObjectMapper()

    override fun afterConnectionEstablished(session: WebSocketSession) {
        sessions.add(session)
        logger.info("WebSocket connected: ${session.id}, total connections: ${sessions.size}")

        // Send welcome message
        val welcome = WebSocketEvent(
            type = "connected",
            payload = mapOf("sessionId" to session.id, "message" to "Connected to {{PROJECT_NAME}} events")
        )
        session.sendMessage(TextMessage(objectMapper.writeValueAsString(welcome)))
    }

    override fun afterConnectionClosed(session: WebSocketSession, status: CloseStatus) {
        sessions.remove(session)
        logger.info("WebSocket disconnected: ${session.id}, total connections: ${sessions.size}")
    }

    override fun handleTextMessage(session: WebSocketSession, message: TextMessage) {
        logger.debug("Received message from ${session.id}: ${message.payload}")

        // Echo back with acknowledgment
        val ack = WebSocketEvent(
            type = "ack",
            payload = mapOf("received" to message.payload)
        )
        session.sendMessage(TextMessage(objectMapper.writeValueAsString(ack)))
    }

    override fun handleTransportError(session: WebSocketSession, exception: Throwable) {
        logger.error("WebSocket error for ${session.id}: ${exception.message}")
        sessions.remove(session)
    }

    fun broadcast(event: WebSocketEvent) {
        val message = TextMessage(objectMapper.writeValueAsString(event))
        sessions.forEach { session ->
            try {
                if (session.isOpen) {
                    session.sendMessage(message)
                }
            } catch (e: Exception) {
                logger.warn("Failed to send message to ${session.id}: ${e.message}")
            }
        }
    }

    fun broadcast(type: String, payload: Any?) {
        broadcast(WebSocketEvent(type = type, payload = payload))
    }
}
