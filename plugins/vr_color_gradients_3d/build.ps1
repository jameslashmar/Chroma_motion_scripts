<#
    build.ps1 - build ChromaVRGradient3D.aex (After Effects effect plug-in, Win x64)

    Usage:
        .\build.ps1                 # build only
        .\build.ps1 -Install        # build, then copy into After Effects (needs admin)
        .\build.ps1 -Clean          # wipe intermediates first

    Deliberately drives cl / rc / link directly rather than MSBuild: the PiPL
    resource needs a three-stage preprocess that is far easier to read here
    than buried in a .vcxproj CustomBuild block.
#>
[CmdletBinding()]
param(
    [switch]$Install,
    [switch]$Clean,
    [string]$SdkRoot = 'H:\AE_SDK\ae25.6_61.64bit.AfterEffectsSDK\Examples',
    [string]$VsRoot  = 'G:\VSStudio\Community',
    [string]$AeRoot  = 'C:\Program Files\Adobe\Adobe After Effects 2026'
)

# cl.exe and rc.exe both chat on stderr even when they succeed, so native
# stderr must not be fatal here. Every step below is checked explicitly via
# $LASTEXITCODE or the existence of its output instead.
$ErrorActionPreference = 'Continue'
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -Scope Global -ErrorAction SilentlyContinue) {
    $Global:PSNativeCommandUseErrorActionPreference = $false
}

$Here    = $PSScriptRoot
$Name    = 'ChromaVRGradient3D'
$ObjDir  = Join-Path $Here 'obj'
$OutDir  = Join-Path $Here 'build'
$Target  = Join-Path $OutDir "$Name.aex"

function Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "!!! $msg" -ForegroundColor Red; exit 1 }

# --- sanity ------------------------------------------------------------
if (-not (Test-Path $SdkRoot)) { Fail "AE SDK not found at $SdkRoot" }
$PiPLTool = Join-Path $SdkRoot 'Resources\PiPLtool.exe'
if (-not (Test-Path $PiPLTool)) { Fail "PiPLtool.exe not found at $PiPLTool" }

if ($Clean -and (Test-Path $ObjDir)) { Remove-Item $ObjDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $ObjDir, $OutDir | Out-Null

# --- import the MSVC x64 environment -----------------------------------
Step 'Importing MSVC x64 environment'
$vcvars = Join-Path $VsRoot 'VC\Auxiliary\Build\vcvars64.bat'
if (-not (Test-Path $vcvars)) { Fail "vcvars64.bat not found at $vcvars" }

& cmd /c "`"$vcvars`" >nul 2>&1 && set" | ForEach-Object {
    if ($_ -match '^([^=]+)=(.*)$') {
        Set-Item -Path "env:$($matches[1])" -Value $matches[2] -ErrorAction SilentlyContinue
    }
}
if (-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) { Fail 'cl.exe still not on PATH after vcvars64' }

# --- includes ----------------------------------------------------------
$Includes = @(
    (Join-Path $SdkRoot 'Headers'),
    (Join-Path $SdkRoot 'Headers\SP'),
    (Join-Path $SdkRoot 'Headers\Win'),
    (Join-Path $SdkRoot 'Resources'),
    (Join-Path $SdkRoot 'Util')
)
# Emitted as separate "/I" + path tokens: embedding the path inside the switch
# makes PowerShell re-quote it and cl then never sees the directory.
$IncArgs = $Includes | ForEach-Object { '/I'; $_ }

# --- 1. PiPL resource (3-stage preprocess, as the SDK samples do) ------
Step 'Compiling the PiPL resource'
$rSrc = Join-Path $Here "$($Name)PiPL.r"
$rr   = Join-Path $ObjDir "$($Name)PiPL.rr"
$rrc  = Join-Path $ObjDir "$($Name)PiPL.rrc"
$rc   = Join-Path $ObjDir "$($Name)PiPL.rc"
$res  = Join-Path $ObjDir "$($Name)PiPL.res"

# cmd handles the redirection so we do not inherit PowerShell's text encoding.
& cmd /c "cl /nologo /I `"$($Includes[0])`" /EP `"$rSrc`" > `"$rr`" 2>nul"
if (-not (Test-Path $rr)) { Fail 'PiPL stage 1 (cl /EP on .r) produced no output' }

& $PiPLTool $rr $rrc
if (-not (Test-Path $rrc)) { Fail 'PiPL stage 2 (PiPLtool) produced no output' }

& cmd /c "cl /nologo /D MSWindows /EP `"$rrc`" > `"$rc`" 2>nul"
if (-not (Test-Path $rc)) { Fail 'PiPL stage 3 (cl /EP on .rrc) produced no output' }

& rc.exe /nologo /fo "$res" "$rc"
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $res)) { Fail 'rc.exe failed on the PiPL' }

# --- 2. compile --------------------------------------------------------
Step 'Compiling sources'
$Sources = @(
    (Join-Path $Here "$Name.cpp"),
    (Join-Path $SdkRoot 'Util\AEGP_SuiteHandler.cpp'),
    (Join-Path $SdkRoot 'Util\MissingSuiteError.cpp'),
    (Join-Path $SdkRoot 'Util\Smart_Utils.cpp')      # UnionLRect
)
foreach ($s in $Sources) { if (-not (Test-Path $s)) { Fail "missing source: $s" } }

$ClFlags = @(
    '/nologo', '/c', '/EHsc', '/MD', '/O2', '/W3', '/std:c++17',
    '/DMSWindows', '/DWIN32', '/D_WINDOWS', '/DNDEBUG', '/D_CRT_SECURE_NO_WARNINGS'
)
& cl.exe @ClFlags @IncArgs @Sources "/Fo:$ObjDir\"
if ($LASTEXITCODE -ne 0) { Fail 'compilation failed' }

# --- 3. link -----------------------------------------------------------
Step 'Linking'
$Objs = Get-ChildItem -Path $ObjDir -Filter '*.obj' | ForEach-Object { $_.FullName }
& link.exe /nologo /DLL "/OUT:$Target" "/IMPLIB:$ObjDir\$Name.lib" @Objs "$res"
if ($LASTEXITCODE -ne 0) { Fail 'link failed' }

Step "Built $Target"
Get-Item $Target | Select-Object Name, Length, LastWriteTime | Format-List

# --- 4. optional install ----------------------------------------------
if ($Install) {
    $dest = Join-Path $AeRoot 'Support Files\Plug-ins\Effects'
    if (-not (Test-Path $dest)) { Fail "AE plug-ins folder not found: $dest" }
    Step "Installing to $dest"
    try {
        Copy-Item $Target -Destination $dest -Force -ErrorAction Stop
        Write-Host "    installed. Restart After Effects." -ForegroundColor Green
    } catch {
        Write-Host "    plain copy denied - retrying elevated via sudo" -ForegroundColor Yellow
        & sudo cp "$Target" "$dest\"
        Start-Sleep -Seconds 2
        $landed = Join-Path $dest "$Name.aex"
        if (Test-Path $landed) {
            Write-Host "    installed. Restart After Effects." -ForegroundColor Green
        } else {
            Fail "could not install. Copy $Target to $dest by hand (admin)."
        }
    }
}
