plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.vertice.launcher"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.vertice.launcher"
        // GestureDescription/dispatchGesture exigem API 24+. Evita incompatibilidade real em Android 6.
        minSdk = 24
        targetSdk = 35
        versionCode = (System.getenv("VERTICE_BUILD_NUMBER") ?: "18").toInt()
        versionName = "1.5.0"
        buildConfigField("String", "VERTICE_API_URL", "\"https://vertice-backend-8gj5.onrender.com\"")
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    signingConfigs {
        create("release") {
            val keystorePath = System.getenv("VERTICE_KEYSTORE_PATH")
            val storePassword = System.getenv("VERTICE_STORE_PASSWORD")
            val keyPassword = System.getenv("VERTICE_KEY_PASSWORD")
            val keyAlias = System.getenv("VERTICE_KEY_ALIAS")
            if (!keystorePath.isNullOrBlank() && !storePassword.isNullOrBlank() && !keyPassword.isNullOrBlank() && !keyAlias.isNullOrBlank()) {
                storeFile = file(keystorePath)
                this.storePassword = storePassword
                this.keyAlias = keyAlias
                this.keyPassword = keyPassword
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            val signingReady = !System.getenv("VERTICE_KEYSTORE_PATH").isNullOrBlank() &&
                !System.getenv("VERTICE_STORE_PASSWORD").isNullOrBlank() &&
                !System.getenv("VERTICE_KEY_PASSWORD").isNullOrBlank() &&
                !System.getenv("VERTICE_KEY_ALIAS").isNullOrBlank()
            if (signingReady) signingConfig = signingConfigs.getByName("release")
        }
        debug {
            applicationIdSuffix = ".teste"
            versionNameSuffix = "-teste"
            buildConfigField("String", "VERTICE_API_URL", "\"https://vertice-backend-8gj5.onrender.com\"")
        }
    }
}

kotlin { jvmToolchain(17) }

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-compose:1.10.0")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3:1.3.1")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
}
