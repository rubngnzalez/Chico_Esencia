param([string]$Mensaje = "Publicacion del diario")
$ErrorActionPreference = 'Stop'
$raiz = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $raiz

try { taskkill /IM esbuild.exe /F 2>$null } catch {}

if (Test-Path 'news_src_tmp') { throw 'Queda news_src_tmp de una publicacion anterior: resuelvelo a mano' }
if (-not (Test-Path 'news\dist') -and -not (Test-Path 'shaddai-web\news\index.html')) { throw 'No hay build: ejecuta antes npm run build en news\' }

Rename-Item -LiteralPath 'news' -NewName 'news_src_tmp'
try {
  git checkout -B gh-pages origin/gh-pages
  if ($LASTEXITCODE -ne 0) { throw 'git checkout gh-pages fallo' }
  git restore --source=main -- shaddai-web
  tar -C shaddai-web -cf "$env:TEMP\sha_web.tar" .
  tar -C . -xf "$env:TEMP\sha_web.tar"
  Remove-Item "$env:TEMP\sha_web.tar"
  git add --ignore-removal CNAME carta.html concepto.html contacto.html index.html politica.html producto.html ritual.html css img js 404.html .nojekyll news
  git checkout origin/gh-pages -- CNAME
  git diff --cached --quiet
  if ($LASTEXITCODE -eq 0) {
    Write-Host 'Sin cambios que publicar.'
  } else {
    git commit -m $Mensaje
    git push origin gh-pages
    if ($LASTEXITCODE -ne 0) { throw 'git push fallo' }
    Write-Host 'Publicado en gh-pages. GitHub Pages tardara 1-2 minutos en servirlo.'
  }
} finally {
  Remove-Item -Recurse -Force -LiteralPath @('css','img','js','news','carta.html','concepto.html','contacto.html','index.html','politica.html','producto.html','ritual.html','CNAME','404.html','.nojekyll','shaddai-web') -ErrorAction SilentlyContinue
  if (Test-Path 'news_src_tmp') { Rename-Item -LiteralPath 'news_src_tmp' -NewName 'news' }
  git checkout main
}
