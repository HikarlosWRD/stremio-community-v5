# Prévia de mangás no Windows

O leitor consulta todas as fontes ativadas em **Fontes**. Os parsers Kotatsu vêm do
projeto Kotatsu Parsers. As extensões Mihon são executadas pelo Suwayomi. Para
adicionar uma extensão, informe a URL HTTPS de um repositório de sua confiança,
carregue o catálogo, instale a extensão e marque a fonte e o idioma desejados.

Os resultados identificam o motor e a fonte. Ao abrir um título, escolha um
capítulo. O leitor faz carregamento sob demanda durante a rolagem vertical.
O botão **Anime4K 2×** aplica o shader original
`Anime4K_Upscale_CNN_x2_S.glsl` do Community às páginas próximas à área visível.
Páginas que excedem o limite de tamanho da GPU são exibidas na resolução original.

A compatibilidade depende de cada fonte e do site. A ponte Kotatsu desta prévia
não implementa páginas que exigem WebView, resolução de CAPTCHA ou remontagem de
imagens embaralhadas. Um erro de fonte aparece junto dos demais resultados.

## Empacotamento

1. Com Java 21 e Gradle 9, execute `gradle -p utils/manga/kotatsu-bridge installDist`.
2. Prepare uma pasta fora do repositório com o Java 21 para Windows x64 em
   `runtime/`, o JAR do [Suwayomi v2.4.2366](https://github.com/Suwayomi/Suwayomi-Server/releases/tag/v2.4.2366)
   em `suwayomi.jar` e o conteúdo de
   `utils/manga/kotatsu-bridge/build/install/kotatsu-bridge/lib/` em `kotatsu/lib/`.
3. Com as dependências da compilação Windows instaladas, execute
   `node build/deploy_windows.js --portable --manga-runtime=C:\caminho\manga-runtime`.

O programa inicia os dois motores sob demanda. O leitor escuta apenas em
`127.0.0.1:11680` com um caminho de sessão aleatório. O Suwayomi usa uma porta
local separada com autenticação. As fontes selecionadas e as extensões instaladas
ficam em `portable_config/manga/`.
