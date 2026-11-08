# Prévia de mangás no Windows

Em **Fontes → Instalar fontes**, adicione os parsers Kotatsu disponíveis ou
extensões Mihon de um repositório HTTPS de sua confiança. As fontes adicionadas
ficam em **Gerenciar instaladas**, onde é possível ativá-las para a busca ou
abrir o catálogo de uma fonte diretamente. Também é possível desinstalar uma ou
várias fontes. Remover uma extensão Mihon retira todos os idiomas dela. Os
filtros de nome, idioma, motor e
palavras excluídas também se aplicam à seleção em lote.

Os resultados aparecem por fonte conforme as consultas terminam. A busca
prioriza o menor capítulo com imagem verificada. O cartão mostra a faixa
listada pela fonte. A verificação amostra até quatro capítulos iniciais.
O botão **+18** fica vermelho quando desligado e verde quando ligado.
Use **Todas as instaladas** para consultar também as fontes desativadas.
A lista de capítulos exibe todas as entradas retornadas pela fonte e filtra por
número ou título. O leitor carrega páginas sob demanda durante a rolagem vertical.

Na página de uma obra, salve o título na **Biblioteca** e use o marcador ao lado
do capítulo para alternar o estado de leitura. Ao chegar ao fim do capítulo,
o leitor também o marca como lido. A **Home** mostra apenas títulos salvos e
oferece atalhos para o último capítulo aberto e até dois seguintes.
A biblioteca e o progresso ficam no perfil local do WebView em um formato
versionado, com identificadores por fonte para uma futura sincronização.

As barras laterais oferecem navegação, zoom que preserva toda a largura da página
e Anime4K do Community nos modelos
S, M e L. Uma passagem amplia a resolução em 2× e duas, em 4×. Se a segunda
passagem exceder o limite da página, o leitor aplica apenas a primeira. Se nem
a primeira couber, a imagem original é exibida. **Refinar cores** aplica
interpolação bicúbica aos canais RGB mantendo o realce do Anime4K.

O mesmo seletor oferece **Real-CUGAN 2×** (redução de ruído leve) e
**Real-ESRGAN Anime 4×** (Anime 6B) pelo runtime ncnn Vulkan. Cada um tem
escala fixa e processa a página original. O leitor prioriza páginas próximas,
mantém a imagem atual durante a troca e guarda os resultados recentes do
capítulo em memória. As opções Passagens e Refinar cores se aplicam ao Anime4K.

A compatibilidade depende de cada fonte e do site. A ponte Kotatsu desta prévia
não implementa páginas que exigem WebView, resolução de CAPTCHA ou remontagem de
imagens embaralhadas. As falhas de consulta são resumidas na interface e
registradas em `portable_config/manga/reader.log`.

## Empacotamento

Para incluir os dois modelos Vulkan, execute
`./utils/manga/prepare-upscale-models.ps1 -MangaRuntime CAMINHO_DO_RUNTIME`
antes de montar o pacote. O script confere o SHA-256 das duas releases e
prepara os arquivos em `models/` dentro do runtime.

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
