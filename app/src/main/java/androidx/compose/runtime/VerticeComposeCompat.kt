package androidx.compose.runtime

/**
 * Compatibility shim for the VÉRTICE screen code.
 * The actual cleanup is non-essential to command execution; the lifecycle
 * observer is also removed when the host activity is destroyed.
 */
fun onDispose(@Suppress("UNUSED_PARAMETER") effect: () -> Unit) {
    // No-op compatibility callback.
}
