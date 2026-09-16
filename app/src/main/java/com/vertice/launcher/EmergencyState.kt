package com.vertice.launcher

import android.content.Context

/** Local, user-controlled autonomy gate. The agent cannot enable autonomy by itself. */
object EmergencyState {
    private const val PREFS = "vertice_safety"
    private const val KEY_STOPPED = "emergency_stopped"

    fun isStopped(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean(KEY_STOPPED, false)

    fun setStopped(context: Context, stopped: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_STOPPED, stopped)
            .apply()
    }
}
