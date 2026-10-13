# Funções usadas por install.ps1 e init-workspace.ps1.
# Todas respeitam -WhatIf de quem chamou e podem rodar várias vezes sem efeito extra.

$script:Marcador = '<!-- gerado por gabrieldulolmarques/agents -->'
$script:Utf8SemBom = New-Object Text.UTF8Encoding $false
$script:Problemas = 0

function Write-Estado([string]$Estado, [string]$Caminho, [string]$Detalhe = '') {
    $cor = @{ 'ok' = 'DarkGray'; 'criado' = 'Green'; 'atualizado' = 'Yellow'; 'pulado' = 'Red'; 'falha' = 'Red' }[$Estado]
    if ($Estado -in 'pulado', 'falha') { $script:Problemas++ }
    $linha = '{0,-11} {1}' -f $Estado, $Caminho
    if ($Detalhe) { $linha += "  ($Detalhe)" }
    Write-Host $linha -ForegroundColor $cor
}

function Install-Juncao {
    [CmdletBinding(SupportsShouldProcess)]
    param([string]$Link, [string]$Alvo)

    if (Test-Path -LiteralPath $Link) {
        $item = Get-Item -LiteralPath $Link -Force
        if ($item.LinkType -eq 'Junction' -and @($item.Target) -contains $Alvo) {
            Write-Estado 'ok' $Link
            return
        }
        if (-not $item.LinkType) {
            Write-Estado 'pulado' $Link 'já existe uma pasta de verdade com esse nome'
            return
        }
        if ($PSCmdlet.ShouldProcess($Link, "apontar para $Alvo")) {
            $item.Delete()   # apaga só o link, não o conteúdo do alvo
            New-Item -ItemType Junction -Path $Link -Target $Alvo | Out-Null
            Write-Estado 'atualizado' $Link "-> $Alvo"
        }
        return
    }
    if ($PSCmdlet.ShouldProcess($Link, "criar junção para $Alvo")) {
        New-Item -ItemType Directory -Force (Split-Path $Link) | Out-Null
        New-Item -ItemType Junction -Path $Link -Target $Alvo | Out-Null
        Write-Estado 'criado' $Link "-> $Alvo"
    }
}

# Mantém $Destino igual a $Origem. Se o destino existe e é diferente, guarda um backup.
function Sync-Arquivo {
    [CmdletBinding(SupportsShouldProcess)]
    param([string]$Origem, [string]$Destino)

    if (Test-Path -LiteralPath $Destino) {
        if ((Get-FileHash -LiteralPath $Origem).Hash -eq (Get-FileHash -LiteralPath $Destino).Hash) {
            Write-Estado 'ok' $Destino
            return
        }
        $backup = '{0}.bak-{1}' -f $Destino, (Get-Date -Format 'yyyyMMdd-HHmmss')
        if ($PSCmdlet.ShouldProcess($Destino, "sobrescrever (backup em $backup)")) {
            Copy-Item -LiteralPath $Destino -Destination $backup
            Copy-Item -LiteralPath $Origem -Destination $Destino -Force
            Write-Estado 'atualizado' $Destino "backup: $(Split-Path -Leaf $backup)"
        }
        return
    }
    if ($PSCmdlet.ShouldProcess($Destino, 'criar')) {
        New-Item -ItemType Directory -Force (Split-Path $Destino) | Out-Null
        Copy-Item -LiteralPath $Origem -Destination $Destino
        Write-Estado 'criado' $Destino
    }
}

# Arquivo gerado (com o marcador): é recriado se mudar. Arquivo sem o marcador é do
# usuário e nunca é tocado.
function Set-ArquivoGerado {
    [CmdletBinding(SupportsShouldProcess)]
    param([string]$Destino, [string]$Conteudo, [string]$SeExistir = 'já existe e não foi gerado por este repositório')

    $Conteudo = "$script:Marcador`n$Conteudo"
    if (Test-Path -LiteralPath $Destino) {
        $atual = [IO.File]::ReadAllText($Destino)
        if ($atual -eq $Conteudo) { Write-Estado 'ok' $Destino; return }
        # Prefixo sem o "-->" para reconhecer também marcadores de versões antigas do script.
        if (-not $atual.StartsWith('<!-- gerado por gabrieldulolmarques/agents')) { Write-Estado 'pulado' $Destino $SeExistir; return }
    }
    if ($PSCmdlet.ShouldProcess($Destino, 'escrever arquivo gerado')) {
        New-Item -ItemType Directory -Force (Split-Path $Destino) | Out-Null
        $estado = if (Test-Path -LiteralPath $Destino) { 'atualizado' } else { 'criado' }
        [IO.File]::WriteAllText($Destino, $Conteudo, $script:Utf8SemBom)
        Write-Estado $estado $Destino
    }
}

# Cria a partir de um modelo só se ainda não existir. Depois disso o arquivo é do usuário.
function New-DeModelo {
    [CmdletBinding(SupportsShouldProcess)]
    param([string]$Modelo, [string]$Destino)

    if (Test-Path -LiteralPath $Destino) { Write-Estado 'ok' $Destino 'já existe, mantido'; return }
    if ($PSCmdlet.ShouldProcess($Destino, "criar a partir de $(Split-Path -Leaf $Modelo)")) {
        New-Item -ItemType Directory -Force (Split-Path $Destino) | Out-Null
        Copy-Item -LiteralPath $Modelo -Destination $Destino
        Write-Estado 'criado' $Destino 'modelo: edite o conteúdo'
    }
}

function New-Pasta {
    [CmdletBinding(SupportsShouldProcess)]
    param([string]$Caminho)

    if (Test-Path -LiteralPath $Caminho) { Write-Estado 'ok' $Caminho; return }
    if ($PSCmdlet.ShouldProcess($Caminho, 'criar pasta')) {
        New-Item -ItemType Directory -Force $Caminho | Out-Null
        Write-Estado 'criado' $Caminho
    }
}
