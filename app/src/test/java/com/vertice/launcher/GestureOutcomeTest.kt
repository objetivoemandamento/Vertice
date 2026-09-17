package com.vertice.launcher

import org.junit.Assert.assertEquals
import org.junit.Test

class GestureOutcomeTest {
    @Test fun rejectedDispatchIsNotSuccess() {
        assertEquals(GestureOutcome.DISPATCH_REJECTED, GestureOutcomeResolver.initial(false))
    }

    @Test fun acceptedDispatchStartsPending() {
        assertEquals(GestureOutcome.DISPATCHED_PENDING, GestureOutcomeResolver.initial(true))
    }

    @Test fun callbackCompletesOnlyOnSuccess() {
        assertEquals(GestureOutcome.COMPLETED, GestureOutcomeResolver.callback(true))
        assertEquals(GestureOutcome.CANCELLED, GestureOutcomeResolver.callback(false))
    }
}
