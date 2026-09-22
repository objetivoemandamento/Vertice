package com.vertice.launcher

import android.content.Context
import java.util.UUID

/** Sessão persistente: o access token é cifrado com uma chave não exportável do Android Keystore. */
class VerticeSession(context: Context) {
    private val appContext = context.applicationContext
    private val prefs = appContext.getSharedPreferences("vertice_session", Context.MODE_PRIVATE)
    private val safetyPrefs = appContext.getSharedPreferences("vertice_safety", Context.MODE_PRIVATE)
    private val secure = SecureSessionStore(appContext)

    val deviceId: String
        get() = prefs.getString("device_id", null)
            ?: UUID.randomUUID().toString().also { prefs.edit().putString("device_id", it).apply() }

    var sessionToken: String?
        get() = secure.get("session_token")
        set(value) = secure.put("session_token", value)

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
        get() = prefs.getBoolean("emergency_stop", safetyPrefs.getBoolean("emergency_stopped", false))
        set(value) {
            prefs.edit().putBoolean("emergency_stop", value).apply()
            safetyPrefs.edit().putBoolean("emergency_stopped", value).apply()
        }

    fun clearLogin() {
        secure.remove("session_token")
        prefs.edit().remove("email").remove("role").remove("mode").apply()
    }
}
