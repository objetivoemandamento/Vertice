package com.vertice.launcher

import android.content.Context
import java.util.UUID

/** Sessão persistente: armazena token, identidade, modo e estado de autonomia; nunca a senha. */
class VerticeSession(context: Context) {
    private val prefs = context.getSharedPreferences("vertice_session", Context.MODE_PRIVATE)
    val deviceId: String
        get() = prefs.getString("device_id", null) ?: UUID.randomUUID().toString().also { prefs.edit().putString("device_id", it).apply() }
    var sessionToken: String?
        get() = prefs.getString("session_token", null)
        set(value) { prefs.edit().putString("session_token", value).apply() }
    var role: String?
        get() = prefs.getString("role", null)
        set(value) { prefs.edit().putString("role", value).apply() }
    var mode: String?
        get() = prefs.getString("mode", null)
        set(value) { prefs.edit().putString("mode", value).apply() }
    var email: String
        get() = prefs.getString("email", "") ?: ""
        set(value) { prefs.edit().putString("email", value).apply() }
    var emergencyStop: Boolean
        get() = prefs.getBoolean("emergency_stop", false)
        set(value) { prefs.edit().putBoolean("emergency_stop", value).apply() }
    fun clearLogin() = prefs.edit().remove("session_token").remove("email").remove("role").remove("mode").apply()
}
