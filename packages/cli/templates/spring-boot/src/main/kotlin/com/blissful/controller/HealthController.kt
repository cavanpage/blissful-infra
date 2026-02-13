package com.blissful.controller

import org.apache.kafka.clients.admin.AdminClient
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.context.event.ApplicationReadyEvent
import org.springframework.context.event.EventListener
import org.springframework.http.ResponseEntity
import org.springframework.kafka.core.KafkaAdmin
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController
import java.time.Duration
import java.time.Instant
{{#IF_REDIS}}
import org.springframework.data.redis.connection.RedisConnectionFactory
{{/IF_REDIS}}
import javax.sql.DataSource

data class HealthResponse(
    val status: String,
    val timestamp: String,
    val details: Map<String, Any> = emptyMap()
)

data class ReadyResponse(
    val ready: Boolean,
    val checks: Map<String, CheckResult> = emptyMap()
)

data class CheckResult(
    val status: String,
    val message: String? = null
)

data class LiveResponse(
    val live: Boolean
)

data class StartupInfo(
    val startedAt: String,
    val uptimeSeconds: Long
)

@RestController
class HealthController(
    @Autowired(required = false) private val dataSource: DataSource?,
{{#IF_REDIS}}
    @Autowired(required = false) private val kafkaAdmin: KafkaAdmin?,
    @Autowired(required = false) private val redisConnectionFactory: RedisConnectionFactory?
{{/IF_REDIS}}
{{#IF_NO_REDIS}}
    @Autowired(required = false) private val kafkaAdmin: KafkaAdmin?
{{/IF_NO_REDIS}}
) {
    private val logger = LoggerFactory.getLogger(javaClass)
    private var startupTime: Instant? = null

    @EventListener(ApplicationReadyEvent::class)
    fun onApplicationReady() {
        startupTime = Instant.now()
        logger.info("Application started at {}", startupTime)
    }

    @GetMapping("/health")
    fun health(): HealthResponse {
        val checks = mutableMapOf<String, Any>()

        // Add database status
        if (dataSource != null) {
            checks["database"] = checkDatabase().let {
                mapOf("status" to it.status, "message" to (it.message ?: ""))
            }
        }

        // Add kafka status
        if (kafkaAdmin != null) {
            checks["kafka"] = checkKafka().let {
                mapOf("status" to it.status, "message" to (it.message ?: ""))
            }
        }

{{#IF_REDIS}}
        // Add redis status
        if (redisConnectionFactory != null) {
            checks["redis"] = checkRedis().let {
                mapOf("status" to it.status, "message" to (it.message ?: ""))
            }
        }
{{/IF_REDIS}}

        // Add startup info
        startupTime?.let { start ->
            checks["startup"] = mapOf(
                "startedAt" to start.toString(),
                "uptimeSeconds" to Duration.between(start, Instant.now()).seconds
            )
        }

        val allHealthy = checks.values.all { check ->
            when (check) {
                is Map<*, *> -> !check.containsKey("status") || check["status"] == "UP"
                else -> true
            }
        }

        return HealthResponse(
            status = if (allHealthy) "healthy" else "unhealthy",
            timestamp = Instant.now().toString(),
            details = checks
        )
    }

    @GetMapping("/ready")
    fun ready(): ResponseEntity<ReadyResponse> {
        val checks = mutableMapOf<String, CheckResult>()

        // Check database connectivity
        if (dataSource != null) {
            checks["database"] = checkDatabase()
        }

        // Check Kafka connectivity
        if (kafkaAdmin != null) {
            checks["kafka"] = checkKafka()
        }

{{#IF_REDIS}}
        // Check Redis connectivity
        if (redisConnectionFactory != null) {
            checks["redis"] = checkRedis()
        }
{{/IF_REDIS}}

        val allReady = checks.values.all { it.status == "UP" }

        val response = ReadyResponse(
            ready = allReady,
            checks = checks
        )

        return if (allReady) {
            ResponseEntity.ok(response)
        } else {
            ResponseEntity.status(503).body(response)
        }
    }

    @GetMapping("/live")
    fun live(): LiveResponse {
        return LiveResponse(live = true)
    }

    @GetMapping("/startup")
    fun startup(): StartupInfo {
        val start = startupTime ?: Instant.now()
        return StartupInfo(
            startedAt = start.toString(),
            uptimeSeconds = Duration.between(start, Instant.now()).seconds
        )
    }

    private fun checkDatabase(): CheckResult {
        return try {
            dataSource?.connection?.use { conn ->
                conn.isValid(5) // 5 second timeout
            }
            CheckResult(status = "UP", message = "Database connection successful")
        } catch (e: Exception) {
            logger.warn("Database health check failed: {}", e.message)
            CheckResult(status = "DOWN", message = e.message)
        }
    }

{{#IF_REDIS}}
    private fun checkRedis(): CheckResult {
        return try {
            redisConnectionFactory?.connection?.use { conn ->
                conn.ping()
            }
            CheckResult(status = "UP", message = "Redis connection successful")
        } catch (e: Exception) {
            logger.warn("Redis health check failed: {}", e.message)
            CheckResult(status = "DOWN", message = e.message)
        }
    }
{{/IF_REDIS}}

    private fun checkKafka(): CheckResult {
        return try {
            val props = kafkaAdmin?.configurationProperties ?: return CheckResult(
                status = "DOWN",
                message = "KafkaAdmin not configured"
            )

            AdminClient.create(props).use { client ->
                // Try to list topics with a timeout
                client.listTopics().names().get(java.util.concurrent.TimeUnit.SECONDS.toMillis(5),
                    java.util.concurrent.TimeUnit.MILLISECONDS)
            }
            CheckResult(status = "UP", message = "Kafka connection successful")
        } catch (e: Exception) {
            logger.warn("Kafka health check failed: {}", e.message)
            CheckResult(status = "DOWN", message = e.message)
        }
    }
}
