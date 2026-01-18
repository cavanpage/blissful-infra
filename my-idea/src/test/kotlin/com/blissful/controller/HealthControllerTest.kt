package com.blissful.controller

import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status

@WebMvcTest(HealthController::class)
class HealthControllerTest {

    @Autowired
    private lateinit var mockMvc: MockMvc

    @Test
    fun `GET health returns healthy status`() {
        mockMvc.perform(get("/health"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.status").value("healthy"))
            .andExpect(jsonPath("$.message").value("node is healthy"))
            .andExpect(jsonPath("$.timestamp").exists())
    }

    @Test
    fun `GET ready returns ready true`() {
        mockMvc.perform(get("/ready"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.ready").value(true))
    }

    @Test
    fun `GET live returns live true`() {
        mockMvc.perform(get("/live"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.live").value(true))
    }
}
