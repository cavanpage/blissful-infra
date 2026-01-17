package com.blissful.controller

import com.blissful.event.EventPublisher
import com.fasterxml.jackson.databind.ObjectMapper
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.annotation.Bean
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status

@WebMvcTest(HelloController::class)
class HelloControllerTest {

    @TestConfiguration
    class TestConfig {
        @Bean
        fun eventPublisher(): EventPublisher = mockk(relaxed = true)
    }

    @Autowired
    private lateinit var mockMvc: MockMvc

    @Autowired
    private lateinit var eventPublisher: EventPublisher

    @Autowired
    private lateinit var objectMapper: ObjectMapper

    @Test
    fun `GET hello returns Hello World`() {
        mockMvc.perform(get("/hello"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.message").value("Hello, World!"))

        verify { eventPublisher.publish(any()) }
    }

    @Test
    fun `GET hello with name returns personalized greeting`() {
        mockMvc.perform(get("/hello/Alice"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.message").value("Hello, Alice!"))

        verify { eventPublisher.publish(any()) }
    }

    @Test
    fun `POST echo returns same data`() {
        val request = EchoRequest(data = mapOf("key" to "value"))

        mockMvc.perform(
            post("/echo")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request))
        )
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.echo.key").value("value"))
    }
}
