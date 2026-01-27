package com.blissful.controller

import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.actuate.health.Health
import org.springframework.boot.actuate.health.HealthIndicator
import org.springframework.boot.actuate.health.Status
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController
import java.time.Instant
import javax.sql.DataSource

data class HealthResponse(
    val status: String,
    val timestamp: String,
    val details: Map<String, Any> = emptyMap()
)

data class ReadyResponse(
    val ready: Boolean
)

data class LiveResponse(
    val live: Boolean
)

@RestController
class HealthController {

    @Autowired
    private lateinit var dataSource: DataSource

    @GetMapping("/health")
    fun health(): HealthResponse {
        val status = "healthy"
        return HealthResponse(
            status = status,
            timestamp = Instant.now().toString(),
            details = emptyMap()
        )
    }

    @GetMapping("/ready")
    fun ready(): ReadyResponse {
        return ReadyResponse(ready = true)
    }

    @GetMapping("/live")
    fun live(): LiveResponse {
        return LiveResponse(live = true)
    }
}
