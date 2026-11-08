plugins { kotlin("jvm") version "2.2.10"; application }
repositories {
    mavenCentral()
    google()
    maven("https://jitpack.io") { content { includeGroup("com.github.KotatsuApp") } }
}
dependencies {
    implementation("com.github.KotatsuApp:kotatsu-parsers:14cff0d651")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")
    implementation("com.squareup.okhttp3:okhttp:5.1.0")
    implementation("org.json:json:20240303")
}
kotlin { jvmToolchain(21) }
application { mainClass.set("reader.kotatsu.MainKt") }
