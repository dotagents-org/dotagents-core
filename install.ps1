<#
.SYNOPSIS
    Instala a configuração global deste repositório no Claude Code, no Codex e no OpenCode.

.DESCRIPTION
    - Instruções: ~/.claude/CLAUDE.md importa o AGENTS.md do repositório (vale na hora).
      O Codex e o OpenCode recebem uma cópia (rode de novo depois de editar).
    - Regras globais: ~/.claude/rules vira junção para rules/ (vale na hora). O Codex e o
      OpenCode chegam nelas pelo link no AGENTS.md.
    - Settings: copia claude/settings.json e opencode/opencode.json. Se o arquivo da
      máquina for diferente, guarda um backup (.bak-<data>) antes de sobrescrever.

    Skills não são globais: cada workspace liga as suas com init-workspace.ps1.
    O script pode ser rodado quantas vezes quiser: o que já está certo fica como está.

.EXAMPLE
    .\install.ps1 -WhatIf    # mostra o que seria feito, sem mudar nada
    .\install.ps1
#>
[CmdletBinding(SupportsShouldProcess)]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\common.ps1')
$Repo = $PSScriptRoot
$Casa = $env:USERPROFILE
$agentsMd = Join-Path $Repo 'AGENTS.md'

Write-Host "`nInstruções globais (AGENTS.md)" -ForegroundColor Cyan
$import = '@' + ($Repo -replace '\\', '/') + '/AGENTS.md'
Set-ArquivoGerado "$Casa\.claude\CLAUDE.md" "$import`n" "já existe e não foi gerado por este repositório; adicione a linha $import nele"
Sync-Arquivo $agentsMd "$Casa\.codex\AGENTS.md"
Sync-Arquivo $agentsMd "$Casa\.config\opencode\AGENTS.md"

Write-Host "`nRegras globais" -ForegroundColor Cyan
Install-Juncao "$Casa\.claude\rules" (Join-Path $Repo 'rules')

Write-Host "`nSettings" -ForegroundColor Cyan
Sync-Arquivo (Join-Path $Repo 'claude\settings.json') "$Casa\.claude\settings.json"
Sync-Arquivo (Join-Path $Repo 'opencode\opencode.json') "$Casa\.config\opencode\opencode.json"

Write-Host ''
if ($script:Problemas) { Write-Warning "$script:Problemas item(ns) pulado(s): veja as linhas em vermelho." }
