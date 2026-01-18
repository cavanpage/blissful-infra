package com.blissful.controller

import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController
import java.time.Instant

data class HealthResponse(
    val status: String,
    val timestamp: String
)

data class ReadyResponse(
    val ready: Boolean
)

data class LiveResponse(
    val live: Boolean
)

data class CPU {
    val speed: Long,
    val temperature: Float
}

data class GPU {
    val speed: Long,
    val temperature: Float,
    val memory: Long
}

@RestController
class HealthController {

    @GetMapping("/health")
    fun health(): HealthResponse {
        return HealthResponse(
            status = "healthy",
            timestamp = Instant.now().toString()
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

    @GetMapping("/cpu")
    fun live(): CPU {
        return CPU(speed = 123, temperature = 56.3)
    }
}
