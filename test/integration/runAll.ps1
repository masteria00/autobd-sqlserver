param()

$ErrorActionPreference = "Stop"
if ($env:DB_DATABASE -ne "tests") {
  throw "E2E tests require DB_DATABASE=tests (isolated SQL Server database)."
}

function Run-Checked {
  param([string]$Program, [string[]]$Arguments)
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Program failed with exit code $LASTEXITCODE"
  }
}

$packageRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$consumer = Join-Path $PSScriptRoot "consumer"
$tsc = Join-Path $packageRoot "node_modules/.bin/tsc.cmd"

Push-Location $packageRoot
try {
  Run-Checked node @("test/integration/setupTypeMatrix.js")
  Push-Location $consumer
  try {
    Run-Checked node @("../../../bin/autobd.js", "generate", "--config", "config.autobd.json", "--profile", "types")
    Run-Checked node @("runMatrix.js")
    Run-Checked node @("probeTVP.js")
  } finally {
    Pop-Location
  }
  Run-Checked node @("test/integration/contractMutation.js")
  Push-Location $consumer
  try {
    Run-Checked node @("../../../bin/autobd.js", "generate", "--config", "config.autobd.json", "--profile", "types")
  } finally {
    Pop-Location
  }
  $tsFlags = @("--strict", "--module", "commonjs", "--target", "ES2020", "--esModuleInterop", "--skipLibCheck", "--types", "node")
  Run-Checked $tsc (@("--noEmit") + $tsFlags + @("test/integration/consumer/typecheck.ts"))
  Run-Checked $tsc (@("--outDir", "test/integration/consumer/ts-dist", "--rootDir", "test/integration/consumer") + $tsFlags + @("test/integration/consumer/generated/index.ts", "test/integration/consumer/typecheck.ts"))
  Run-Checked node @("test/integration/consumer/prepareJsOnly.js")
  Run-Checked $tsc (@("--noEmit", "--allowJs", "--checkJs") + $tsFlags + @("test/integration/consumer/js-only/jsdoc-check.js"))
  Push-Location $consumer
  try {
    Run-Checked node @("runCompiledTs.js")
  } finally {
    Pop-Location
  }
  Run-Checked npm @("test")
} finally {
  Pop-Location
}
