package com.vertice.launcher

import android.content.Context

/**
 * Local, user-controlled autonomy gate.
 *
 * Safety invariant: the agent can NEVER enable autonomy by itself. A stop is
 * persisted locally and survives app/service restarts. Each stop increments
 * a generation so running plans can detect that the user changed the safety
 * state while the plan was executing.
 */
object EmergencyState {
    private const val PREFS = "vertice_safety"
    private const val KEY_STOPPED = "emergency_stopped"
    private const val KEY_GENERATION = "emergency_generation"
    private const val KEY_STOPPED_AT = "emergency_stopped_at"

    fun isStopped(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean(KEY_STOPPED, false)

    /** Monotonically increasing safety generation for cancelling in-flight plans. */
    fun generation(context: Context): Long =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getLong(KEY_GENERATION, 0L)

    fun setStopped(context: Context, stopped: Boolean) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val nextGeneration = prefs.getLong(KEY_GENERATION, 0L) + 1L
        prefs.edit()
            .putBoolean(KEY_STOPPED, stopped)
            .putLong(KEY_GENERATION, nextGeneration)
            .putLong(KEY_STOPPED_AT, if (stopped) System.currentTimeMillis() else 0L)
            .commit()
    }

    /** Snapshot used by an execution plan to detect a user stop mid-plan. */
    data class Snapshot(val stopped: Boolean, val generation: Long)

    fun snapshot(context: Context): Snapshot = Snapshot(
        stopped = isStopped(context),
        generation = generation(context)
    )

    /** True when the same user-authorized autonomy session may continue. */
    fun canContinue(context: Context, expectedGeneration: Long): Boolean =
        !isStopped(context) && generation(context) == expectedGeneration
}
