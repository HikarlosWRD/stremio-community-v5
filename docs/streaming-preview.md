# Stremio Community Streaming Preview 0.2

Build portátil Windows x64 baseada no Stremio Community 5.0.22. Requer o Microsoft Edge WebView2 do sistema.

1. Encerre as outras versões do Stremio pelo ícone da bandeja. Isso libera o serviço local para o perfil de streaming da prévia.
2. Extraia o ZIP em uma pasta nova e execute **Stremio-Streaming.exe**.
3. Abra um torrent direto ou cole um link magnet na busca. Para comparar, teste o mesmo torrent com a versão anterior e use o mesmo trecho.

Se o título mostrar **servidor compartilhado**, a prévia está usando a instância que já ocupava a porta 11470. O buffer do player funciona nesse modo e o serviço externo segue com o próprio perfil. Para usar o perfil completo, feche o aplicativo que está mantendo o serviço aberto e reabra a prévia.

## Reprodução direta

- O serviço próprio tem cache em disco de até 10 GiB, 100 conexões por torrent e parâmetros de descoberta e velocidade de 20 e 64 MiB/s.
- Para torrents servidos pelo Stremio local, o mpv reserva até 768 MiB para até 50 s de buffer, retém até 96 MiB do trecho anterior e pede 5 s de vídeo pronto ao iniciar ou retomar após falta de dados. O tempo de buffer real depende da taxa do vídeo e do que os peers entregam.
- Anime4K, FSR e os atalhos do Community vêm da configuração original. A qualidade da conexão e os seeds disponíveis ainda determinam a velocidade de torrents públicos.

O cache e as configurações próprias do serviço ficam em `portable_config/streaming-server`. O atualizador upstream e Discord RPC ficam desativados nesta build portátil.

## Build

Com Visual Studio, Ninja e vcpkg x64, inicialize o submódulo `deps/libmpv` e extraia o DLL x64 do arquivo RAR nele. Instale `openssl`, `curl`, `nlohmann-json` e `webview2` no triplet `x64-windows-static`.

    cmake -S . -B out -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_TOOLCHAIN_FILE=C:/vcpkg/scripts/buildsystems/vcpkg.cmake -DVCPKG_TARGET_TRIPLET=x64-windows-static
    cmake --build out

Distribua `out/stremio.exe` como `Stremio-Streaming.exe`, junto com `libmpv-2.dll`, o serviço em `utils/windows`, o `server.js` de `version/version-details.json` e as dependências FFmpeg da base. Extraia a pasta `portable_config/shaders` de `utils/mpv/Default Portable Config.7z` para a distribuição. Copie a configuração de `utils/mpv/anime4k/portable_config` e adicione `utils/stremio/stremio-settings.ini` à pasta `portable_config`.

[Fork e código da prévia](https://github.com/HikarlosWRD/stremio-community-v5/tree/streaming-preview) · [Stremio Community](https://github.com/Zaarrg/stremio-community-v5/tree/webview-windows) · [libmpv](https://github.com/Zaarrg/libmpv/tree/d57999b78b2d7b22f32f3a827a44903fdaa59e62) · [Anime4K](https://github.com/bloc97/Anime4K)
