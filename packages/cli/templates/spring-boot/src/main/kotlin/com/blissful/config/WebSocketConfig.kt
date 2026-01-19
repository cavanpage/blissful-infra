package com.blissful.config

import com.blissful.websocket.EventWebSocketHandler
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.web.socket.config.annotation.EnableWebSocket
import org.springframework.web.socket.config.annotation.WebSocketConfigurer
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry

@Configuration
@EnableWebSocket
class WebSocketConfig : WebSocketConfigurer {

    @Bean
    fun eventWebSocketHandler(): EventWebSocketHandler {
        return EventWebSocketHandler()
    }

    override fun registerWebSocketHandlers(registry: WebSocketHandlerRegistry) {
        registry.addHandler(eventWebSocketHandler(), "/ws/events")
            .setAllowedOrigins("*")
    }
}
