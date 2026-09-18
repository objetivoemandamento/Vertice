package com.vertice.launcher

/**
 * Mercados prioritários do VÉRTICE.
 *
 * Esta configuração deixa o produto preparado para divulgação internacional.
 * A publicação efetiva nas lojas, campanhas e pagamentos de cada país também
 * precisa ser configurada nos respectivos serviços externos.
 */
data class VerticeMarket(
    val countryCode: String,
    val countryName: String,
    val locale: String,
    val languageName: String,
    val currencyCode: String,
    val currencySymbol: String,
    val marketingEnabled: Boolean = true
)

object VerticeMarkets {
    val supported = listOf(
        VerticeMarket("BR", "Brasil", "pt-BR", "Português (Brasil)", "BRL", "R$"),
        VerticeMarket("US", "Estados Unidos", "en-US", "English (US)", "USD", "$"),
        VerticeMarket("PT", "Portugal", "pt-PT", "Português (Portugal)", "EUR", "€"),
        VerticeMarket("ES", "Espanha", "es-ES", "Español (España)", "EUR", "€"),
        VerticeMarket("MX", "México", "es-MX", "Español (México)", "MXN", "MX$")
    )

    val countryCodes: Set<String> = supported.map { it.countryCode }.toSet()
    val locales: Set<String> = supported.map { it.locale }.toSet()

    fun byCountry(code: String): VerticeMarket? =
        supported.firstOrNull { it.countryCode.equals(code, ignoreCase = true) }

    fun byLocale(locale: String): VerticeMarket? =
        supported.firstOrNull { it.locale.equals(locale, ignoreCase = true) }
}
