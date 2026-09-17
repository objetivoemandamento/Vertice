package com.vertice.launcher

import android.view.accessibility.AccessibilityNodeInfo

data class ElementCandidate(val node: AccessibilityNodeInfo, val score: Int, val reason: String)

data class ElementResolution(val candidate: AccessibilityNodeInfo?, val confidence: Int, val ambiguous: Boolean, val reason: String)

object ElementResolver {
    fun resolve(nodes: List<AccessibilityNodeInfo>, requested: String): ElementResolution {
        val needle = normalize(requested)
        if (needle.isBlank()) return ElementResolution(null, 0, false, "Alvo vazio.")
        val candidates = nodes.mapNotNull { node ->
            if (!node.isEnabled) return@mapNotNull null
            val text = normalize(node.text?.toString().orEmpty())
            val desc = normalize(node.contentDescription?.toString().orEmpty())
            val id = normalize(node.viewIdResourceName?.substringAfterLast('/') ?: "")
            val score = when {
                id == needle -> 100
                desc == needle -> 95
                text == needle -> 90
                desc.contains(needle) -> 75
                text.contains(needle) -> 70
                id.contains(needle) -> 65
                else -> 0
            }
            if (score == 0) null else ElementCandidate(node, score, when (score) {
                100 -> "resource_id_exact"
                95 -> "content_description_exact"
                90 -> "text_exact"
                75 -> "content_description_contains"
                70 -> "text_contains"
                else -> "resource_id_contains"
            })
        }.sortedByDescending { it.score }
        if (candidates.isEmpty()) return ElementResolution(null, 0, false, "Nenhum alvo correspondente.")
        val top = candidates.first()
        val second = candidates.getOrNull(1)
        val ambiguous = second != null && top.score - second.score < 10
        if (ambiguous) return ElementResolution(null, top.score, true, "Alvo ambíguo; diferença de confiança insuficiente.")
        return ElementResolution(top.node, top.score, false, top.reason)
    }

    private fun normalize(value: String): String = value.trim().lowercase().replace(Regex("\\s+"), " ")
}