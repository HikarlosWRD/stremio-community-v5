# Stremio Community Upscale Preview 0.1

Build portátil Windows x64 baseada no Stremio Community 5.0.22. Requer o runtime Microsoft Edge WebView2 do sistema. Extraia o ZIP e execute **Stremio-Upscale.exe**.

## Como testar

1. Abra um vídeo local SDR de 720p ou 1080p, ou cole um magnet na busca do Stremio.
2. Coloque o vídeo em tela cheia. Pressione **Ctrl+Shift+U** e selecione um perfil. O menu também está em **Upscale...** no ícone da bandeja.
3. Para comparar, volte ao mesmo trecho e selecione **Desligado**. **Ver status** mostra o perfil e se a fonte permite aplicá-lo.

| Perfil | Uso |
| --- | --- |
| NVIDIA RTX VSR | Filmes, séries e animação em uma RTX com Super Resolution ativada no painel NVIDIA. |
| Intel VSR | Extensão do processador de vídeo D3D11 em GPUs Intel e drivers compatíveis. |
| Anime4K Performance / Qualidade | Cadeias leves ou completas para animação. Ctrl+1 a Ctrl+6 acessam também os perfis originais do Community. |
| FSRCNNX | Upscale neural por shader. Requer ampliação de pelo menos 1,3×. |
| AMD FSR 1 | Upscale espacial EASU + RCAS em GPUs compatíveis com o renderizador mpv. |
| EWA Lanczos | Reamostragem do mpv com custo menor. |

O seletor começa desligado e mantém a escolha durante a sessão. Os perfis ficam suspensos quando não há ampliação suficiente ou a fonte está em HDR PQ/HLG. NVIDIA VSR e Intel VSR usam D3D11 e fontes SDR de 360p a 1440p, com escala ajustada à área do vídeo. A ativação final depende do driver.

Esta prévia reutiliza a interface Web do Community e o Stremio Service. Se o serviço já estiver em execução no endereço local padrão, a prévia usa a instância existente. Magnet e .torrent continuam usando o mecanismo upstream. A interface Web tem um perfil local separado nesta pasta. Discord Rich Presence e o atualizador upstream ficam desativados na prévia. AnimeJaNai é uma integração separada do Community com VapourSynth, modelos e dependências próprias.

## Compilar e empacotar

Use um prompt x64 do Visual Studio com CMake, Ninja e vcpkg. Inicialize o submódulo com `git submodule update --init` e extraia `deps/libmpv/x86_64/libmpv-2.dll.rar` na mesma pasta.

    vcpkg install openssl curl nlohmann-json webview2 --triplet x64-windows-static
    cmake -S . -B out -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_TOOLCHAIN_FILE=C:/vcpkg/scripts/buildsystems/vcpkg.cmake -DVCPKG_TARGET_TRIPLET=x64-windows-static
    cmake --build out

Copie `out/stremio.exe` como `Stremio-Upscale.exe` para a pasta de distribuição, junto com `out/libmpv-2.dll`, `utils/windows/stremio-runtime.exe`, os arquivos de `utils/windows/ffmpeg` e o `server.js` listado em `version/version-details.json`. Extraia a pasta `shaders` de `utils/mpv/anime4k/anime4k-High-end.zip` para `portable_config`. Sobreponha os arquivos de `utils/mpv/anime4k/portable_config` e adicione `utils/stremio/stremio-settings.ini` a essa pasta.

## Código e créditos

- [Fork e alterações da prévia](https://github.com/HikarlosWRD/stremio-community-v5/tree/upscale-preview)
- [Stremio Community 5.0.22](https://github.com/Zaarrg/stremio-community-v5/releases/tag/5.0.0-beta.22)
- [libmpv usado pela base](https://github.com/Zaarrg/libmpv/tree/d57999b78b2d7b22f32f3a827a44903fdaa59e62)
- [Stremio streaming server](https://github.com/Stremio/stremio-streaming-server)
- [Anime4K](https://github.com/bloc97/Anime4K)
- [FSRCNNX por igv](https://github.com/igv/FSRCNN-TensorFlow/releases/tag/1.1)
- [Port de FSR 1 para mpv por agyild](https://gist.github.com/agyild/82219c545228d70c5604f865ce0b0ce5/f1794d720013ccd9c5c86a0f20fddd71e0375f94)
