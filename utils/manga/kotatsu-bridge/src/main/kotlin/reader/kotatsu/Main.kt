package reader.kotatsu

import kotlinx.coroutines.*
import okhttp3.*
import org.json.JSONArray
import org.json.JSONObject
import org.koitharu.kotatsu.parsers.MangaLoaderContext
import org.koitharu.kotatsu.parsers.MangaParser
import org.koitharu.kotatsu.parsers.bitmap.Bitmap
import org.koitharu.kotatsu.parsers.config.ConfigKey
import org.koitharu.kotatsu.parsers.config.MangaSourceConfig
import org.koitharu.kotatsu.parsers.model.*
import java.net.IDN
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

private class SourceContext : MangaLoaderContext() {
    private val cookies = mutableListOf<Cookie>()
    override val cookieJar = object : CookieJar {
        override fun saveFromResponse(url: HttpUrl, items: List<Cookie>) {
            synchronized(cookies) {
                cookies.removeAll { old -> old.expiresAt < System.currentTimeMillis() || items.any {
                    it.name == old.name && it.domain == old.domain && it.path == old.path
                } }
                cookies.addAll(items)
            }
        }
        override fun loadForRequest(url: HttpUrl): List<Cookie> = synchronized(cookies) {
            cookies.filter { it.expiresAt > System.currentTimeMillis() && it.matches(url) }
        }
    }
    private val parsers = ConcurrentHashMap<MangaParserSource, MangaParser>()
    fun parser(source: MangaParserSource): MangaParser = parsers.computeIfAbsent(source, ::newParserInstance)

    override val httpClient = OkHttpClient.Builder().cookieJar(cookieJar)
        .callTimeout(20, TimeUnit.SECONDS)
        .addInterceptor { chain ->
            val original = chain.request()
            val parser = (original.tag(MangaSource::class.java) as? MangaParserSource)?.let(::parser)
            val request = original.newBuilder()
            val headers = parser?.getRequestHeaders()
            headers?.forEach { (name, value) ->
                if (original.header(name) == null) request.header(name, value)
            }
            if (original.header("User-Agent") == null && headers?.get("User-Agent") == null)
                request.header("User-Agent", getDefaultUserAgent())
            if (original.header("Referer") == null && headers?.get("Referer") == null && parser != null)
                request.header("Referer", "https://" + IDN.toASCII(parser.domain) + "/")
            val prepared = request.build()
            if (parser == null) chain.proceed(prepared) else parser.intercept(object : Interceptor.Chain by chain {
                override fun request(): Request = prepared
            })
        }.build()

    override fun getConfig(source: MangaSource) = object : MangaSourceConfig {
        override fun <T> get(key: ConfigKey<T>): T = key.defaultValue
    }
    override fun getDefaultUserAgent() = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0"
    @Suppress("OVERRIDE_DEPRECATION")
    override suspend fun evaluateJs(script: String): String? = error("Esta fonte requer JavaScript em navegador.")
    override suspend fun evaluateJs(baseUrl: String, script: String): String? = evaluateJs(script)
    override fun redrawImageResponse(response: Response, redraw: (Bitmap) -> Bitmap): Response =
        error("Esta fonte usa páginas embaralhadas.")
    override fun createBitmap(width: Int, height: Int): Bitmap = error("Esta fonte usa páginas embaralhadas.")
}

private class Entries<T>(private val limit: Int) {
    private val items = LinkedHashMap<String, T>(16, 0.75f, true)
    @Synchronized fun put(id: String, value: T) {
        items[id] = value
        if (items.size > limit) items.remove(items.keys.first())
    }
    @Synchronized fun get(id: String): T = items[id] ?: error("Item expirado. Abra a busca ou o capítulo novamente.")
    @Synchronized fun find(id: String): T? = items[id]
}

private val ctx = SourceContext()
private val manga = Entries<Manga>(12000)
private val chapters = Entries<MangaChapter>(6000)
private val pages = Entries<MangaPage>(3000)
private val sources = MangaParserSource.entries.filterNot { it.isBroken }.associateBy { it.name }

private fun info(source: MangaParserSource) = JSONObject().put("id", source.name)
    .put("name", source.title).put("lang", source.locale).put("kind", source.contentType.toString())

private fun result(item: Manga): JSONObject {
    val id = item.source.name + "/" + item.id
    manga.put(id, item)
    return JSONObject().put("id", id).put("title", item.title)
        .put("aliases", JSONArray(item.altTitles))
        .put("adult", item.contentRating == ContentRating.ADULT)
        .put("hasCover", !item.coverUrl.isNullOrBlank())
}

private fun image(url: String, source: MangaSource): JSONObject {
    val request = Request.Builder().url(url).tag(MangaSource::class.java, source).build()
    return ctx.httpClient.newCall(request).execute().use { response ->
        check(response.isSuccessful) { "Imagem indisponível (HTTP " + response.code + ")." }
        val body = response.body ?: error("Imagem vazia.")
        val type = body.contentType()?.toString()?.substringBefore(';') ?: error("Imagem sem formato.")
        check(type in setOf("image/jpeg", "image/png", "image/webp", "image/gif", "image/avif")) {
            "Formato de imagem não suportado."
        }
        val data = body.byteStream().readNBytes(16 * 1024 * 1024 + 1)
        check(data.size <= 16 * 1024 * 1024) { "Imagem excede o limite de 16 MiB." }
        JSONObject().put("type", type).put("bytes", Base64.getEncoder().encodeToString(data))
    }
}

private suspend fun savedManga(input: JSONObject): Manga {
    val id = input.getString("id")
    manga.find(id)?.let { return it }
    val source = sources[id.substringBefore('/')] ?: error("Fonte desconhecida.")
    val title = input.optString("title").takeIf { it.isNotBlank() } ?: return manga.get(id)
    val parser = ctx.parser(source)
    val order = SortOrder.RELEVANCE.takeIf { it in parser.availableSortOrders } ?: parser.availableSortOrders.first()
    val results = parser.getList(0, order, MangaListFilter(query = title))
    val item = results.firstOrNull { source.name + "/" + it.id == id }
        ?: error("Obra não encontrada nesta fonte.")
    manga.put(id, item)
    return item
}

private suspend fun handle(input: JSONObject): Any = when (input.getString("op")) {
    "sources" -> JSONArray(sources.values.map(::info))
    "search" -> {
        val source = sources[input.getString("source")] ?: error("Fonte desconhecida.")
        val parser = ctx.parser(source)
        val query = input.getString("query")
        val preferred = if (query.isBlank()) SortOrder.POPULARITY else SortOrder.RELEVANCE
        val order = preferred.takeIf { it in parser.availableSortOrders } ?: parser.availableSortOrders.first()
        val filter = if (query.isBlank()) MangaListFilter.EMPTY else MangaListFilter(query = query)
        val offset = input.optInt("offset")
        val items = if (input.optBoolean("fast")) {
            withTimeout(10_000) { parser.getList(offset, order, filter) }
        } else {
            parser.getList(offset, order, filter)
        }
        JSONArray(items.map(::result))
    }
    "chapters", "work" -> {
        val item = savedManga(input)
        val details = ctx.parser(item.source as MangaParserSource).getDetails(item)
        val rows = JSONArray(details.chapters.orEmpty().asReversed().map { chapter ->
            val id = item.source.name + "/" + chapter.id
            chapters.put(id, chapter)
            JSONObject().put("id", id).put("name", chapter.name).put("number", chapter.number)
        })
        if (input.getString("op") == "chapters") rows
        else JSONObject().put("chapters", rows).put("description", details.description)
            .put("author", details.authors.joinToString(", "))
            .put("genres", JSONArray(details.tags.map { it.title }))
    }
    "pages" -> {
        val chapter = chapters.get(input.getString("id"))
        val source = chapter.source as MangaParserSource
        JSONArray(ctx.parser(source).getPages(chapter).map { page ->
            val id = source.name + "/" + chapter.id + "/" + page.id
            pages.put(id, page)
            id
        })
    }
    "cover" -> {
        val item = savedManga(input)
        image(item.coverUrl ?: error("Capa indisponível."), item.source)
    }
    "image" -> {
        val page = pages.get(input.getString("id"))
        image(ctx.parser(page.source as MangaParserSource).getPageUrl(page), page.source)
    }
    else -> error("Operação desconhecida.")
}

fun main() = runBlocking {
    val output = System.out.bufferedWriter(Charsets.UTF_8)
    System.setOut(System.err)
    val workers = Dispatchers.IO.limitedParallelism(20)
    System.`in`.bufferedReader(Charsets.UTF_8).useLines { lines ->
        lines.forEach { line ->
            launch(workers) {
                val request = runCatching { JSONObject(line) }.getOrNull() ?: return@launch
                val reply = JSONObject().put("request", request.optString("request"))
                try {
                    reply.put("data", handle(request))
                } catch (e: Exception) {
                    reply.put("error", e.message ?: "A fonte não respondeu.")
                }
                synchronized(output) {
                    output.write(reply.toString())
                    output.newLine()
                    output.flush()
                }
            }
        }
    }
}
