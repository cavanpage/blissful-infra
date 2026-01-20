{{#IF_POSTGRES}}
package com.blissful.entity

import jakarta.persistence.*
import java.time.Instant

@Entity
@Table(name = "greetings")
data class Greeting(
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    val id: Long? = null,

    @Column(nullable = false)
    val name: String,

    @Column(nullable = false)
    val message: String,

    @Column(name = "created_at", nullable = false)
    val createdAt: Instant = Instant.now()
)
{{/IF_POSTGRES}}
