<#
    build.ps1 - build ChromaVRGradient3D.aex (After Effects effect plug-in, Win x64)

    Usage:
        .\build.ps1                 # build only
        .\build.ps1 -Install        # build, then copy into After Effects (needs admin)
        .\build.ps1 -Clean          # wipe intermediates first
        .\build.ps1 -Test           # build, then build and run the tests
        .\build.ps1 -NoCuda         # leave CUDA out even if a toolkit is installed

    Deliberately drives cl / rc / link directly rather than MSBuild: the PiPL
    resource needs a three-stage preprocess that is far easier to read here
    than buried in a .vcxproj CustomBuild block.

    GPU paths on Windows:
        CUDA    built in when a CUDA toolkit (nvcc) is found - CUDA_PATH, or
                the newest under "C:\Program Files\NVIDIA GPU Computing Toolkit".
                Without one the build still succeeds and says so; the effect
                then has no CUDA kernel and After Effects renders it on the CPU
                (AE uses CUDA for every NVIDIA GPU, so on those machines this is
                the path that matters).
        OpenCL  always built in. Compiled by the driver at run time, no SDK
                needed here; OpenCL.dll is loaded on demand, so its absence
                only costs the GPU path, never the effect.
#>
[CmdletBinding()]
param(
    [switch]$Install,
    [switch]$Clean,
    [switch]$Test,
    [switch]$NoCuda,
    [string]$SdkRoot,
    [string]$VsRoot,
    [string]$AeRoot,
    [string]$CudaRoot
)

# These used to be hardcoded to one workstation. They are found at run time
# instead, because they do move: Visual Studio was on G: when this was written
# and is on H: on the next machine, and the script only mentioned it at the
# point of failure. Pass any of the parameters above to override.

function Resolve-VsRoot {
    # vswhere ships with every VS 2017+ installer and knows where VS actually
    # is, which a literal path does not.
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (Test-Path $vswhere) {
        $found = & $vswhere -latest -products * `
            -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
            -property installationPath 2>$null
        if ($found) { return ($found | Select-Object -First 1) }
        $any = & $vswhere -latest -products * -property installationPath 2>$null
        if ($any) { return ($any | Select-Object -First 1) }
    }
    foreach ($guess in @(
        'C:\Program Files\Microsoft Visual Studio\2022\Community',
        'C:\Program Files\Microsoft Visual Studio\2022\Professional')) {
        if (Test-Path (Join-Path $guess 'VC\Auxiliary\Build\vcvars64.bat')) { return $guess }
    }
    return $null
}

function Resolve-SdkRoot {
    # The Examples folder is the one with PiPLtool.exe under Resources.
    foreach ($drive in @('H:\', 'G:\', 'C:\', 'D:\')) {
        $base = Join-Path $drive 'AE_SDK'
        if (-not (Test-Path $base)) { continue }
        $hit = Get-ChildItem $base -Recurse -Filter 'PiPLtool.exe' -ErrorAction SilentlyContinue |
               Select-Object -First 1
        if ($hit) { return (Split-Path (Split-Path $hit.FullName -Parent) -Parent) }
    }
    return $null
}

function Resolve-AeRoot {
    $base = 'C:\Program Files\Adobe'
    if (Test-Path $base) {
        $hit = Get-ChildItem $base -Directory -Filter 'Adobe After Effects *' -ErrorAction SilentlyContinue |
               Sort-Object Name -Descending | Select-Object -First 1
        if ($hit) { return $hit.FullName }
    }
    return $null
}

function Resolve-CudaRoot {
    # CUDA_PATH is what the toolkit installer sets; fall back to the newest
    # versioned folder, which is where it puts them.
    if ($env:CUDA_PATH -and (Test-Path (Join-Path $env:CUDA_PATH 'bin\nvcc.exe'))) { return $env:CUDA_PATH }
    $base = 'C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA'
    if (Test-Path $base) {
        $hit = Get-ChildItem $base -Directory -Filter 'v*' -ErrorAction SilentlyContinue |
               Where-Object { Test-Path (Join-Path $_.FullName 'bin\nvcc.exe') } |
               Sort-Object { [version]($_.Name.TrimStart('v')) } -Descending |
               Select-Object -First 1
        if ($hit) { return $hit.FullName }
    }
    return $null
}

if (-not $SdkRoot)  { $SdkRoot  = Resolve-SdkRoot }
if (-not $VsRoot)   { $VsRoot   = Resolve-VsRoot }
if (-not $AeRoot)   { $AeRoot   = Resolve-AeRoot }
if (-not $CudaRoot -and -not $NoCuda) { $CudaRoot = Resolve-CudaRoot }
if ($NoCuda) { $CudaRoot = $null }

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
$TestDir = Join-Path $Here 'tests'
# The build lands on the committed .aex one level up rather than in a build/
# folder of its own. That is the copy people download, so a rebuild updates it
# in place and `git status` says when it has gone stale.
$OutDir  = Split-Path $Here -Parent
$Target  = Join-Path $OutDir "$Name.aex"

function Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Warn($msg) { Write-Host "    $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "!!! $msg" -ForegroundColor Red; exit 1 }

# --- sanity ------------------------------------------------------------
if (-not $SdkRoot) { Fail 'AE SDK not found. Pass -SdkRoot <path to the SDK Examples folder>.' }
if (-not $VsRoot)  { Fail 'Visual Studio with the C++ workload not found. Pass -VsRoot <VS install path>.' }
if (-not $AeRoot -and $Install) { Fail 'After Effects not found. Pass -AeRoot <AE install path>.' }
Write-Host "    SDK : $SdkRoot" -ForegroundColor DarkGray
Write-Host "    VS  : $VsRoot"  -ForegroundColor DarkGray
if ($AeRoot)   { Write-Host "    AE  : $AeRoot" -ForegroundColor DarkGray }
if ($CudaRoot) { Write-Host "    CUDA: $CudaRoot" -ForegroundColor DarkGray }
else           { Warn 'CUDA: no toolkit found - building without the CUDA kernel (OpenCL + CPU only)' }

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
    $Here,
    $ObjDir,                                       # the generated kernel-source header
    (Join-Path $SdkRoot 'Headers'),
    (Join-Path $SdkRoot 'Headers\SP'),
    (Join-Path $SdkRoot 'Headers\Win'),
    (Join-Path $SdkRoot 'Resources'),
    (Join-Path $SdkRoot 'Util')
)
# Emitted as separate "/I" + path tokens: embedding the path inside the switch
# makes PowerShell re-quote it and cl then never sees the directory.
$IncArgs = $Includes | ForEach-Object { '/I'; $_ }

$Defines = @('/DMSWindows', '/DWIN32', '/D_WINDOWS', '/DNDEBUG', '/D_CRT_SECURE_NO_WARNINGS', '/DCHROMA_HAS_OPENCL=1')
if ($CudaRoot) { $Defines += '/DCHROMA_HAS_CUDA=1' }

# --- 1. PiPL resource (3-stage preprocess, as the SDK samples do) ------
Step 'Compiling the PiPL resource'
$rSrc = Join-Path $Here "$($Name)PiPL.r"
$rr   = Join-Path $ObjDir "$($Name)PiPL.rr"
$rrc  = Join-Path $ObjDir "$($Name)PiPL.rrc"
$rc   = Join-Path $ObjDir "$($Name)PiPL.rc"
$res  = Join-Path $ObjDir "$($Name)PiPL.res"

# cmd handles the redirection so we do not inherit PowerShell's text encoding.
& cmd /c "cl /nologo /I `"$($Includes[2])`" /EP `"$rSrc`" > `"$rr`" 2>nul"
if (-not (Test-Path $rr)) { Fail 'PiPL stage 1 (cl /EP on .r) produced no output' }

& $PiPLTool $rr $rrc
if (-not (Test-Path $rrc)) { Fail 'PiPL stage 2 (PiPLtool) produced no output' }

& cmd /c "cl /nologo /D MSWindows /EP `"$rrc`" > `"$rc`" 2>nul"
if (-not (Test-Path $rc)) { Fail 'PiPL stage 3 (cl /EP on .rrc) produced no output' }

& rc.exe /nologo /fo "$res" "$rc"
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $res)) { Fail 'rc.exe failed on the PiPL' }

# --- 2. embed the GPU kernel source ------------------------------------
# OpenCL (and Metal, on the Mac) compile the kernel from text at run time, so
# the kernel header goes into the binary as a byte array. Written as numbers,
# not a string literal, because MSVC caps a single literal at 16 KB.
Step 'Embedding the kernel source'
$KernelSrc = Join-Path $Here   "$($Name)_Kernel.h"
$KernelHdr = Join-Path $ObjDir "$($Name)_KernelSource.h"
if (-not (Test-Path $KernelSrc)) { Fail "missing kernel source: $KernelSrc" }
$bytes = [System.IO.File]::ReadAllBytes($KernelSrc) | Where-Object { $_ -ne 13 }   # LF only, same text on every platform
$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine('/* Generated by build.ps1 from ChromaVRGradient3D_Kernel.h - do not edit, do not commit. */')
[void]$sb.AppendLine('static const char kChromaKernelBody[] = {')
for ($i = 0; $i -lt $bytes.Count; $i += 32) {
    $end = [Math]::Min($i + 31, $bytes.Count - 1)
    [void]$sb.AppendLine((($bytes[$i..$end]) -join ',') + ',')
}
[void]$sb.AppendLine('0};')
[System.IO.File]::WriteAllText($KernelHdr, $sb.ToString())

# --- 3. CUDA kernel (optional) -------------------------------------------
$CudaObj = $null
if ($CudaRoot) {
    Step 'Compiling the CUDA kernel (nvcc)'
    $nvcc = Join-Path $CudaRoot 'bin\nvcc.exe'
    $CudaObj = Join-Path $ObjDir "$($Name)_Kernel.obj"
    # SASS for Pascal through Blackwell plus PTX for anything newer. The
    # oldest of these is deprecated in CUDA 12 and gone in 13; the warning is
    # silenced rather than the target dropped, because GTX 10-series cards
    # are still in service.
    $NvccArgs = @(
        '-c', '-O2', '-m64', '-std=c++17',
        '-Wno-deprecated-gpu-targets',
        '-gencode', 'arch=compute_61,code=sm_61',
        '-gencode', 'arch=compute_75,code=sm_75',
        '-gencode', 'arch=compute_86,code=sm_86',
        '-gencode', 'arch=compute_89,code=sm_89',
        '-gencode', 'arch=compute_120,code=sm_120',
        '-gencode', 'arch=compute_75,code=compute_75',
        '-Xcompiler', '/MD,/EHsc,/W3,/nologo',
        '-I', $Here,
        '-o', $CudaObj,
        (Join-Path $Here "$($Name)_Kernel.cu")
    )
    if (Test-Path $CudaObj) { Remove-Item $CudaObj -Force }
    & $nvcc @NvccArgs
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $CudaObj)) {
        # A toolkit older than the installed MSVC refuses the host compiler
        # outright. The host side of this kernel is a few lines of launch
        # code, so overriding that check is safe; say so and try once more.
        Warn 'nvcc rejected the build - retrying with -allow-unsupported-compiler'
        & $nvcc @NvccArgs '-allow-unsupported-compiler'
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path $CudaObj)) { Fail 'nvcc failed on the CUDA kernel' }
    }
}

# --- 4. compile --------------------------------------------------------
Step 'Compiling sources'
$Sources = @(
    (Join-Path $Here "$Name.cpp"),
    (Join-Path $Here "$($Name)_OpenCL.cpp"),
    (Join-Path $SdkRoot 'Util\AEGP_SuiteHandler.cpp'),
    (Join-Path $SdkRoot 'Util\MissingSuiteError.cpp'),
    (Join-Path $SdkRoot 'Util\Smart_Utils.cpp')      # UnionLRect
)
foreach ($s in $Sources) { if (-not (Test-Path $s)) { Fail "missing source: $s" } }

$ClFlags = @('/nologo', '/c', '/EHsc', '/MD', '/O2', '/W3', '/std:c++17') + $Defines
& cl.exe @ClFlags @IncArgs @Sources "/Fo:$ObjDir\"
if ($LASTEXITCODE -ne 0) { Fail 'compilation failed' }

# --- 5. link -----------------------------------------------------------
Step 'Linking'
$Objs = Get-ChildItem -Path $ObjDir -Filter '*.obj' |
        Where-Object { $_.Name -notlike 'test_*' -and $_.Name -ne 'preview.obj' } |
        ForEach-Object { $_.FullName }
$LinkArgs = @('/nologo', '/DLL', "/OUT:$Target", "/IMPLIB:$ObjDir\$Name.lib") + $Objs + @("$res")
if ($CudaRoot) {
    $LinkArgs += @("/LIBPATH:$(Join-Path $CudaRoot 'lib\x64')", 'cudart_static.lib')
}
& link.exe @LinkArgs
if ($LASTEXITCODE -ne 0) { Fail 'link failed' }

Step "Built $Target"
Get-Item $Target | Select-Object Name, Length, LastWriteTime | Format-List
if ($CudaRoot) { Write-Host '    GPU: CUDA + OpenCL, CPU fallback' -ForegroundColor Green }
else           { Write-Host '    GPU: OpenCL only, CPU fallback (no CUDA toolkit on this machine)' -ForegroundColor Yellow }

# --- 6. optional tests ---------------------------------------------------
if ($Test) {
    Step 'Building and running the tests'
    $TestObj = Join-Path $ObjDir 'tests'
    New-Item -ItemType Directory -Force -Path $TestObj | Out-Null
    $TestFlags = @('/nologo', '/EHsc', '/MD', '/O2', '/W3', '/std:c++17', '/D_CRT_SECURE_NO_WARNINGS', '/DCHROMA_HAS_OPENCL=1', '/DCHROMA_TEST_OPENCL=1')
    $tests = @(
        @{ name = 'test_math';   src = @((Join-Path $TestDir 'test_math.cpp')) },
        @{ name = 'preview';     src = @((Join-Path $TestDir 'preview.cpp')) },
        @{ name = 'test_kernel'; src = @((Join-Path $TestDir 'test_kernel.cpp'), (Join-Path $Here "$($Name)_OpenCL.cpp")) }
    )
    $failed = 0
    foreach ($t in $tests) {
        $exe = Join-Path $TestObj "$($t.name).exe"
        & cl.exe @TestFlags @IncArgs @($t.src) "/Fo:$TestObj\" "/Fe:$exe"
        if ($LASTEXITCODE -ne 0) { Fail "could not build $($t.name)" }
        Push-Location $TestDir
        & $exe
        $code = $LASTEXITCODE
        Pop-Location
        if ($code -ne 0) { $failed++; Warn "$($t.name) FAILED (exit $code)" }
        else             { Write-Host "    $($t.name) passed" -ForegroundColor Green }
    }
    if ($failed) { Fail "$failed test program(s) failed" }
}

# --- 7. optional install ----------------------------------------------
if ($Install) {
    $dest = Join-Path $AeRoot 'Support Files\Plug-ins\Effects'
    if (-not (Test-Path $dest)) { Fail "AE plug-ins folder not found: $dest" }
    Step "Installing to $dest"
    try {
        Copy-Item $Target -Destination $dest -Force -ErrorAction Stop
        Write-Host "    installed. Restart After Effects." -ForegroundColor Green
    } catch {
        Write-Host "    plain copy denied - retrying elevated via sudo" -ForegroundColor Yellow
        # Not `sudo cp`: cp is a shell alias, and sudo starts a new process
        # where only real executables exist. It fails with "Command not found"
        # and, in Force New Window mode, does so out of sight.
        & sudo pwsh -NoProfile -Command "Copy-Item -LiteralPath '$Target' -Destination '$dest' -Force"
        Start-Sleep -Seconds 2
        $landed = Join-Path $dest "$Name.aex"
        if (Test-Path $landed) {
            Write-Host "    installed. Restart After Effects." -ForegroundColor Green
        } else {
            Fail "could not install. Copy $Target to $dest by hand (admin)."
        }
    }
}
