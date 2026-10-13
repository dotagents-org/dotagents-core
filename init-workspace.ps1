<#
.SYNOPSIS
    Aplica os padrões de .agents/ e .artifacts/ a um workspace, ou confere se ele segue.

.DESCRIPTION
    Cria o que falta e nunca sobrescreve conteúdo do usuário:
    - AGENTS.md, INDEX.md e .artifacts/coding/pendencias.md a partir de templates/workspace/
      (só se não existirem);
    - CLAUDE.md com @AGENTS.md;
    - .agents/README.md e .artifacts/README.md apontando para os padrões em standards/;
    - .artifacts/session-archives/;
    - .agents/skills/<nome> como junção para skills/<nome> deste repositório, para cada -Skills;
    - .claude/skills e .claude/rules como junções para .agents/, quando a pasta de origem existe.

    Com -Check, não muda nada: só roda a conferência dos dois padrões.

.EXAMPLE
    .\init-workspace.ps1 -Path D:\myWorkspace\Obsidian -Skills obsidian-docs, session-archive -WhatIf
    .\init-workspace.ps1 -Path D:\myWorkspace\Obsidian -Skills obsidian-docs, session-archive
    .\init-workspace.ps1 -Path D:\myWorkspace\Obsidian -Check
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Path = (Get-Location).Path,
    [string[]]$Skills = @(),
    [switch]$Check
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\common.ps1')
$Repo = $PSScriptRoot
$Ws = (Resolve-Path -LiteralPath $Path).Path.TrimEnd('\')
$RepoBarra = $Repo -replace '\\', '/'

if ($Ws -eq $Repo -or $Ws.StartsWith("$Repo\")) { throw 'O workspace não pode ser o próprio repositório agents.' }

function Test-Conferencia {
    Write-Host "`nConferência de $Ws" -ForegroundColor Cyan

    function Item([bool]$Passou, [string]$Texto, [string]$Detalhe = '') {
        if ($Passou) { Write-Estado 'ok' $Texto } else { Write-Estado 'falha' $Texto $Detalhe }
    }

    $agentsMd = Join-Path $Ws 'AGENTS.md'
    $textoAgents = if (Test-Path $agentsMd) { [IO.File]::ReadAllText($agentsMd) } else { '' }
    Item ($textoAgents -ne '') 'AGENTS.md existe'
    if ($textoAgents) {
        $kb = [math]::Round((Get-Item $agentsMd).Length / 1KB, 1)
        Item ($kb -le 8) "AGENTS.md com até ~8 KB" "$kb KB"
    }

    $claudeMd = Join-Path $Ws 'CLAUDE.md'
    if (Test-Path $claudeMd) {
        $primeira = Get-Content $claudeMd | Where-Object { $_ -and $_ -notmatch '^<!--' } | Select-Object -First 1
        Item ($primeira -eq '@AGENTS.md') 'CLAUDE.md começa com @AGENTS.md' "primeira linha: $primeira"
    } else {
        Item $false 'CLAUDE.md existe'
    }

    foreach ($proibida in '.agents\.agents', '.agents\commands', '.codex\skills') {
        Item (-not (Test-Path (Join-Path $Ws $proibida))) "não existe $proibida"
    }

    foreach ($nome in 'skills', 'rules') {
        $link = Join-Path $Ws ".claude\$nome"
        if (Test-Path $link) {
            $item = Get-Item $link -Force
            Item ($item.LinkType -eq 'Junction' -and @($item.Target) -contains (Join-Path $Ws ".agents\$nome")) ".claude\$nome é junção para .agents\$nome" "tipo: $(if ($item.LinkType) { $item.LinkType } else { 'pasta comum' })"
        }
    }

    $pastaSkills = Join-Path $Ws '.agents\skills'
    if (Test-Path $pastaSkills) {
        foreach ($skill in Get-ChildItem $pastaSkills -Force) {
            $rotulo = ".agents\skills\$($skill.Name)"
            if (-not $skill.PSIsContainer) { Item $false "$rotulo é pasta" 'arquivo solto em skills/'; continue }
            $skillMd = Join-Path $skill.FullName 'SKILL.md'
            if (-not (Test-Path $skillMd)) { Item $false "$rotulo tem SKILL.md" $(if ($skill.LinkType) { 'junção quebrada?' } else { '' }); continue }
            $linhas = Get-Content $skillMd
            $nome = ($linhas | Select-String '^name:\s*(.+)$' | Select-Object -First 1).Matches.Groups[1].Value.Trim()
            Item ($nome -eq $skill.Name) "$rotulo com name igual à pasta" "name: $nome"
            Item ($linhas.Count -lt 500) "$rotulo com menos de 500 linhas" "$($linhas.Count) linhas"
        }
    }

    $pastaRules = Join-Path $Ws '.agents\rules'
    if (Test-Path $pastaRules) {
        foreach ($regra in Get-ChildItem $pastaRules -File) {
            Item ($textoAgents.Contains($regra.Name)) ".agents\rules\$($regra.Name) tem link no AGENTS.md"
        }
    }

    Item (Test-Path (Join-Path $Ws '.artifacts\coding\pendencias.md')) '.artifacts\coding\pendencias.md existe'
    Item (Test-Path (Join-Path $Ws '.artifacts\session-archives')) '.artifacts\session-archives existe'

    $artifacts = Join-Path $Ws '.artifacts'
    if (Test-Path $artifacts) {
        $comData = Get-ChildItem $artifacts -Recurse -File |
            Where-Object { $_.FullName -notlike '*\session-archives\*' -and $_.Name -match '\d{4}-\d{2}-\d{2}' }
        Item (-not $comData) 'nenhum arquivo com data no nome fora de session-archives' (($comData | ForEach-Object Name) -join ', ')
    }

    Write-Host ''
    if ($script:Problemas) { Write-Warning "$script:Problemas item(ns) fora do padrão." } else { Write-Host 'Tudo dentro do padrão.' -ForegroundColor Green }
}

if ($Check) { Test-Conferencia; return }

foreach ($skill in $Skills) {
    if (-not (Test-Path (Join-Path $Repo "skills\$skill\SKILL.md"))) {
        $existentes = (Get-ChildItem (Join-Path $Repo 'skills') -Directory).Name -join ', '
        throw "Skill '$skill' não existe em $Repo\skills. Disponíveis: $existentes"
    }
}

Write-Host "`nArquivos da raiz" -ForegroundColor Cyan
New-DeModelo (Join-Path $Repo 'templates\workspace\AGENTS.md') (Join-Path $Ws 'AGENTS.md')
New-DeModelo (Join-Path $Repo 'templates\workspace\INDEX.md') (Join-Path $Ws 'INDEX.md')
Set-ArquivoGerado (Join-Path $Ws 'CLAUDE.md') "@AGENTS.md`n" 'já existe; confira se começa com @AGENTS.md'

Write-Host "`n.agents/" -ForegroundColor Cyan
Set-ArquivoGerado (Join-Path $Ws '.agents\README.md') @"
# Pasta ``.agents/``

Este workspace segue o padrão em ``$RepoBarra/standards/agents.md`` (repositório ``gabrieldulolmarques/agents``).
"@
foreach ($skill in $Skills) {
    Install-Juncao (Join-Path $Ws ".agents\skills\$skill") (Join-Path $Repo "skills\$skill")
}

Write-Host "`n.claude/" -ForegroundColor Cyan
foreach ($nome in 'skills', 'rules') {
    $origem = Join-Path $Ws ".agents\$nome"
    if ((Test-Path $origem) -or ($nome -eq 'skills' -and $Skills -and $WhatIfPreference)) {
        Install-Juncao (Join-Path $Ws ".claude\$nome") $origem
    }
}

Write-Host "`n.artifacts/" -ForegroundColor Cyan
Set-ArquivoGerado (Join-Path $Ws '.artifacts\README.md') @"
# Pasta ``.artifacts/``

Este workspace segue o padrão em ``$RepoBarra/standards/artifacts.md`` (repositório ``gabrieldulolmarques/agents``).
"@
New-DeModelo (Join-Path $Repo 'templates\workspace\pendencias.md') (Join-Path $Ws '.artifacts\coding\pendencias.md')
New-Pasta (Join-Path $Ws '.artifacts\session-archives')

Write-Host ''
if ($script:Problemas) { Write-Warning "$script:Problemas item(ns) pulado(s): veja as linhas em vermelho." }
Write-Host "Para conferir depois: .\init-workspace.ps1 -Path '$Ws' -Check"
