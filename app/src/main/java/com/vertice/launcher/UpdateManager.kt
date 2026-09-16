package com.vertice.launcher

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object UpdateManager {
    private const val MANIFEST_URL = "https://raw.githubusercontent.com/objetivoemandamento/Vertice/main/update.json"

    data class UpdateInfo(val versionCode: Int, val versionName: String, val apkUrl: String, val notes: String)

    suspend fun check(context: Context): UpdateInfo? = withContext(Dispatchers.IO) {
        runCatching {
            val conn = URL(MANIFEST_URL).openConnection() as HttpURLConnection
            conn.connectTimeout = 8000
            conn.readTimeout = 8000
            conn.requestMethod = "GET"
            if (conn.responseCode !in 200..299) return@runCatching null
            val json = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
            val info = UpdateInfo(
                json.getInt("versionCode"),
                json.optString("versionName", ""),
                json.getString("apkUrl"),
                json.optString("notes", "Nova versão do VÉRTICE.")
            )
            if (info.versionCode > currentVersionCode(context) && info.apkUrl.startsWith("https://")) info else null
        }.getOrNull()
    }

    fun downloadAndInstall(context: Context, info: UpdateInfo) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.packageManager.canRequestPackageInstalls()) {
            context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")))
            return
        }
        val request = DownloadManager.Request(Uri.parse(info.apkUrl))
            .setTitle("Atualizando VÉRTICE")
            .setDescription("Baixando a versão ${info.versionName}")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, "vertice-update-${info.versionCode}.apk")
            .setMimeType("application/vnd.android.package-archive")
        val manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val downloadId = manager.enqueue(request)
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(c: Context, intent: Intent) {
                if (intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L) != downloadId) return
                runCatching {
                    val apkUri = manager.getUriForDownloadedFile(downloadId) ?: return@runCatching
                    c.startActivity(Intent(Intent.ACTION_VIEW, apkUri).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    })
                }
                runCatching { c.unregisterReceiver(this) }
            }
        }
        val flags = if (Build.VERSION.SDK_INT >= 33) Context.RECEIVER_NOT_EXPORTED else 0
        context.registerReceiver(receiver, IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE), flags)
    }

    private fun currentVersionCode(context: Context): Int = try {
        if (Build.VERSION.SDK_INT >= 33) context.packageManager.getPackageInfo(context.packageName, PackageManager.PackageInfoFlags.of(0)).longVersionCode.toInt()
        else @Suppress("DEPRECATION") context.packageManager.getPackageInfo(context.packageName, 0).versionCode
    } catch (_: Exception) { 0 }
}
