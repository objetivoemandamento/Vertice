package com.vertice.launcher

enum class GestureOutcome {
    DISPATCH_REJECTED,
    DISPATCHED_PENDING,
    COMPLETED,
    CANCELLED
}

object GestureOutcomeResolver {
    fun initial(dispatched: Boolean): GestureOutcome =
        if (dispatched) GestureOutcome.DISPATCHED_PENDING else GestureOutcome.DISPATCH_REJECTED

    fun callback(completed: Boolean): GestureOutcome =
        if (completed) GestureOutcome.COMPLETED else GestureOutcome.CANCELLED
}
