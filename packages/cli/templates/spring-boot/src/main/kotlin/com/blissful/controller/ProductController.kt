{{#IF_POSTGRES}}
package com.blissful.controller

import com.blissful.repository.ProductRepository
import org.slf4j.LoggerFactory
import org.springframework.web.bind.annotation.*
import java.math.BigDecimal

data class ProductDto(
    val id: Long,
    val name: String,
    val category: String,
    val price: BigDecimal,
    val inStock: Boolean,
    val createdAt: String
)

data class ProductsResponse(
    val products: List<ProductDto>,
    val total: Long
)

@RestController
@RequestMapping("/products")
class ProductController(private val productRepository: ProductRepository) {

    private val logger = LoggerFactory.getLogger(javaClass)

    @GetMapping
    fun list(
        @RequestParam(required = false) category: String?,
        @RequestParam(required = false) inStock: Boolean?
    ): ProductsResponse {
        logger.info("Fetching products, category={}, inStock={}", category, inStock)

        val products = when {
            category != null -> productRepository.findByCategory(category)
            inStock != null  -> productRepository.findByInStock(inStock)
            else             -> productRepository.findAll()
        }

        return ProductsResponse(
            products = products.map { p ->
                ProductDto(
                    id       = p.id!!,
                    name     = p.name,
                    category = p.category,
                    price    = p.price,
                    inStock  = p.inStock,
                    createdAt = p.createdAt.toString()
                )
            },
            total = products.size.toLong()
        )
    }

    @GetMapping("/{id}")
    fun get(@PathVariable id: Long): ProductDto {
        logger.info("Fetching product id={}", id)
        val p = productRepository.findById(id)
            .orElseThrow { NoSuchElementException("Product $id not found") }
        return ProductDto(
            id        = p.id!!,
            name      = p.name,
            category  = p.category,
            price     = p.price,
            inStock   = p.inStock,
            createdAt = p.createdAt.toString()
        )
    }
}
{{/IF_POSTGRES}}
