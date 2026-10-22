param([string]$Mensaje = "Publicacion del diario")
$ErrorActionPreference = 'Stop'
$raiz = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $raiz
$raizPadre = Split-Path -Parent $raiz
$wt = Join-Path $raizPadre 'Chico_ghp_tmp'

if (-not (Test-Path 'shaddai-web\news\index.html')) { throw 'No hay build: ejecuta antes npm run build en news\' }
git fetch origin gh-pages
if (Test-Path $wt) { git worktree remove --force $wt }
git worktree add $wt origin/gh-pages
if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear el worktree de gh-pages' }

try {
  tar -C shaddai-web -cf "$env:TEMP\sha_web.tar" .
  tar -C $wt -xf "$env:TEMP\sha_web.tar"
  Remove-Item "$env:TEMP\sha_web.tar"
  Push-Location $wt
  try {
    git add --ignore-removal CNAME carta.html concepto.html contacto.html index.html politica.html producto.html ritual.html tienda.html carrito.html pago.html pago-ok.html pago-ko.html usos.html css img js 404.html .nojekyll robots.txt news
    git checkout origin/gh-pages -- CNAME
    git diff --cached --quiet
    if ($LASTEXITCODE -eq 0) {
      Write-Host 'Sin cambios que publicar.'
    } else {
      git commit -m $Mensaje
      git push origin HEAD:gh-pages
      if ($LASTEXITCODE -ne 0) { throw 'git push fallo' }
      Write-Host 'Publicado en gh-pages. GitHub Pages tardara 1-2 minutos en servirlo.'
    }
  } finally {
    Pop-Location
  }
} finally {
  git worktree remove --force $wt
}
