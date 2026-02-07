package com.blissful.config

import io.micrometer.core.instrument.Counter
import io.micrometer.core.instrument.MeterRegistry
import io.micrometer.core.instrument.Timer
import jakarta.servlet.Filter
import jakarta.servlet.FilterChain
import jakarta.servlet.ServletRequest
import jakarta.servlet.ServletResponse
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.boot.web.servlet.FilterRegistrationBean
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import java.util.concurrent.TimeUnit

@Configuration
class MetricsConfig(private val meterRegistry: MeterRegistry) {

    @Bean
    fun requestMetricsFilter(): FilterRegistrationBean<RequestMetricsFilter> {
        val registrationBean = FilterRegistrationBean<RequestMetricsFilter>()
        registrationBean.filter = RequestMetricsFilter(meterRegistry)
        registrationBean.addUrlPatterns("/*")
        registrationBean.order = 1
        return registrationBean
    }
}

class RequestMetricsFilter(private val meterRegistry: MeterRegistry) : Filter {

    override fun doFilter(request: ServletRequest, response: ServletResponse, chain: FilterChain) {
        val httpRequest = request as HttpServletRequest
        val httpResponse = response as HttpServletResponse

        // Skip actuator endpoints
        if (httpRequest.requestURI.startsWith("/actuator")) {
            chain.doFilter(request, response)
            return
        }

        val startTime = System.nanoTime()

        try {
            chain.doFilter(request, response)
        } finally {
            val duration = System.nanoTime() - startTime
            val statusCode = httpResponse.status
            val statusClass = getStatusClass(statusCode)
            val method = httpRequest.method
            val uri = normalizeUri(httpRequest.requestURI)

            // Record request duration histogram
            Timer.builder("http_request_duration_seconds")
                .description("HTTP request duration in seconds")
                .tag("method", method)
                .tag("uri", uri)
                .tag("status", statusCode.toString())
                .tag("status_class", statusClass)
                .publishPercentileHistogram()
                .register(meterRegistry)
                .record(duration, TimeUnit.NANOSECONDS)

            // Record request counter
            Counter.builder("http_requests_total")
                .description("Total HTTP requests")
                .tag("method", method)
                .tag("uri", uri)
                .tag("status", statusCode.toString())
                .tag("status_class", statusClass)
                .register(meterRegistry)
                .increment()
        }
    }

    private fun getStatusClass(statusCode: Int): String {
        return when (statusCode) {
            in 100..199 -> "1xx"
            in 200..299 -> "2xx"
            in 300..399 -> "3xx"
            in 400..499 -> "4xx"
            in 500..599 -> "5xx"
            else -> "unknown"
        }
    }

    private fun normalizeUri(uri: String): String {
        // Normalize URIs with path variables to avoid cardinality explosion
        // e.g., /hello/john -> /hello/{name}
        return uri
            .replace(Regex("/hello/[^/]+"), "/hello/{name}")
            .replace(Regex("/users/[^/]+"), "/users/{id}")
            .replace(Regex("/\\d+"), "/{id}")
    }
}
