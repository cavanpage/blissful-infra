{{#IF_POSTGRES}}
package com.blissful.repository

import com.blissful.entity.Greeting
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Repository

@Repository
interface GreetingRepository : JpaRepository<Greeting, Long> {
    fun findByNameIgnoreCase(name: String): List<Greeting>
    fun findTop10ByOrderByCreatedAtDesc(): List<Greeting>
}
{{/IF_POSTGRES}}
