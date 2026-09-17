package com.vertice.launcher

import android.view.accessibility.AccessibilityNodeInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ElementResolverTest {
    @Test fun emptyRequestIsRejected() {
        val result = ElementResolver.resolve(emptyList(), "")
        assertEquals(0, result.confidence)
        assertTrue(result.candidate == null)
    }

    @Test fun resolverRequiresConcreteNodeEvidence() {
        val result = ElementResolver.resolve(emptyList(), "Enviar")
        assertEquals(0, result.confidence)
        assertTrue(result.candidate == null)
    }
}