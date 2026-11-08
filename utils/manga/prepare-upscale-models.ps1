param(
    [Parameter(Mandatory)]
    [string] $MangaRuntime,
    [string] $CacheDirectory = (Join-Path ([IO.Path]::GetTempPath()) 'stremio-manga-models')
)

$ErrorActionPreference = 'Stop'
$packages = @(
    @{
        Name = 'realcugan'
        Archive = 'cugan.zip'
        Uri = 'https://github.com/nihui/realcugan-ncnn-vulkan/releases/download/20220728/realcugan-ncnn-vulkan-20220728-windows.zip'
        Hash = 'C6E08D46C11704B1E3A1ADA9DDD591CB5005F52F132136C8633BA25DEF400E01'
        Weights = 'models-se/up2x-denoise1x'
    },
    @{
        Name = 'realesrgan'
        Archive = 'esrgan-bundle.zip'
        Uri = 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-windows.zip'
        Hash = 'ABC02804E17982A3BE33675E4D471E91EA374E65B70167ABC09E31ACB412802D'
        Weights = 'models/realesrgan-x4plus-anime'
    }
)

New-Item -ItemType Directory -Force -Path $CacheDirectory | Out-Null
foreach ($package in $packages) {
    $archive = Join-Path $CacheDirectory $package.Archive
    if (!(Test-Path -LiteralPath $archive)) {
        Invoke-WebRequest -UseBasicParsing -Uri $package.Uri -OutFile $archive
    }
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $package.Hash) {
        throw "SHA-256 mismatch for $archive"
    }
    $extracted = Join-Path $CacheDirectory ('verified-' + $package.Name)
    Expand-Archive -LiteralPath $archive -DestinationPath $extracted -Force
    $executableName = $package.Name + '-ncnn-vulkan.exe'
    $executable = Get-ChildItem -LiteralPath $extracted -Recurse -File -Filter $executableName |
        Select-Object -First 1
    if (!$executable) { throw "Missing $executableName in $archive" }
    $source = $executable.Directory.FullName
    $destination = Join-Path $MangaRuntime ('models/' + $package.Name)
    $weights = Join-Path $destination (Split-Path -Parent $package.Weights)
    New-Item -ItemType Directory -Force -Path $destination, $weights | Out-Null
    Copy-Item -LiteralPath $executable.FullName, (Join-Path $source 'vcomp140.dll') -Destination $destination -Force
    foreach ($extension in '.param', '.bin') {
        Copy-Item -LiteralPath (Join-Path $source ($package.Weights + $extension)) -Destination $weights -Force
    }
    $license = Join-Path $source 'LICENSE'
    if (Test-Path -LiteralPath $license) {
        Copy-Item -LiteralPath $license -Destination $destination -Force
    } else {
        $licenseUrl = 'https://raw.githubusercontent.com/xinntao/Real-ESRGAN-ncnn-vulkan/v0.2.0/LICENSE'
        Invoke-WebRequest -UseBasicParsing -Uri $licenseUrl -OutFile (Join-Path $destination 'LICENSE')
    }
    Write-Output "Prepared $($package.Name)"
}
