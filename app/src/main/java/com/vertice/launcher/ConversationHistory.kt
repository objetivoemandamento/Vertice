package com.vertice.launcher

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class StoredChatLine(val fromUser: Boolean, val text: String, val timestamp: Long)

class ConversationHistory(context: Context, private val key: String) {
    private val prefs = context.getSharedPreferences("vertice_history", Context.MODE_PRIVATE)
    private val prefKey = "chat_${key.hashCode().toString(16)}"

    fun load(): List<StoredChatLine> = runCatching {
        val raw = prefs.getString(prefKey, "[]") ?: "[]"
        val array = JSONArray(raw)
        buildList {
            for (i in 0 until array.length()) {
                val item = array.getJSONObject(i)
                add(StoredChatLine(item.optBoolean("fromUser"), item.optString("text"), item.optLong("timestamp")))
            }
        }
    }.getOrDefault(emptyList())

    fun append(line: StoredChatLine) {
        val current = load().toMutableList()
        current.add(line)
        val trimmed = if (current.size > 500) current.takeLast(500) else current
        val array = JSONArray()
        trimmed.forEach {
            array.put(JSONObject().put("fromUser", it.fromUser).put("text", it.text).put("timestamp", it.timestamp))
        }
        prefs.edit().putString(prefKey, array.toString()).apply()
    }

    fun clear() = prefs.edit().remove(prefKey).apply()
}
