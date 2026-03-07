{{#IF_POSTGRES}}
package com.blissful.entity

import jakarta.persistence.*
import java.math.BigDecimal
import java.time.Instant

@Entity
@Table(name = "products")
data class Product(
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    val id: Long? = null,

    @Column(nullable = false, length = 100)
    val name: String,

    @Column(nullable = false, length = 50)
    val category: String,

    @Column(nullable = false, precision = 10, scale = 2)
    val price: BigDecimal,

    @Column(name = "in_stock", nullable = false)
    val inStock: Boolean = true,

    @Column(name = "created_at", nullable = false)
    val createdAt: Instant = Instant.now()
)
{{/IF_POSTGRES}}
