{{#IF_POSTGRES}}
package com.blissful.repository

import com.blissful.entity.Product
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Repository

@Repository
interface ProductRepository : JpaRepository<Product, Long> {
    fun findByCategory(category: String): List<Product>
    fun findByInStock(inStock: Boolean): List<Product>
}
{{/IF_POSTGRES}}
