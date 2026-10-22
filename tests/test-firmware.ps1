param(
  [string]$Compiler = 'g++',
  [string]$ArduinoCli = 'arduino-cli',
  [switch]$HostOnly
)
$ErrorActionPreference = 'Stop'
$taskSource = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\firmware\smart_irrigation'))
$taskBuild = Join-Path $PSScriptRoot '.build'
New-Item -ItemType Directory -Path $taskBuild -Force | Out-Null
Push-Location $PSScriptRoot
try {
  # Some MinGW linkers cannot create executables using absolute non-ASCII paths.
  & $Compiler -std=c++11 -Wall -Wextra -Werror -O2 -static '-I' '../firmware/smart_irrigation' 'controller_test.cpp' '../firmware/smart_irrigation/Controller.cpp' '../firmware/smart_irrigation/Sensors.cpp' '../firmware/smart_irrigation/Protocol.cpp' -o '.build/controller_test.exe'
  if ($LASTEXITCODE -ne 0) { throw 'C++ tests could not compile' }
  & '.\.build\controller_test.exe'
  if ($LASTEXITCODE -ne 0) { throw 'C++ tests failed' }
  & $Compiler -std=c++11 -Wall -Wextra -Werror -O2 -static '-I' 'stubs' '-I' '../firmware/smart_irrigation' 'serial_loop_test.cpp' '../firmware/smart_irrigation/Controller.cpp' '../firmware/smart_irrigation/Sensors.cpp' '../firmware/smart_irrigation/Protocol.cpp' -o '.build/serial_loop_test.exe'
  if ($LASTEXITCODE -ne 0) { throw 'Sketch serial-loop tests could not compile' }
  & '.\.build\serial_loop_test.exe'
  if ($LASTEXITCODE -ne 0) { throw 'Sketch serial-loop tests failed' }
} finally { Pop-Location }
if ($HostOnly) {
  Write-Host 'Host firmware tests passed. Nano compilation was not requested.'
  return
}
& $ArduinoCli compile --fqbn 'arduino:avr:nano:cpu=atmega328' --warnings all $taskSource
if ($LASTEXITCODE -ne 0) { throw 'Nano firmware could not compile' }

$taskConfigured = Join-Path $taskBuild 'configured\smart_irrigation'
New-Item -ItemType Directory -Path $taskConfigured -Force | Out-Null
Get-ChildItem -LiteralPath $taskSource -File | Where-Object { $_.Extension -in '.h', '.cpp', '.ino' } | Copy-Item -Destination $taskConfigured -Force
$taskConfigPath = Join-Path $taskConfigured 'Config.h'
$taskConfigText = Get-Content -LiteralPath $taskConfigPath -Raw
foreach ($taskGate in 'ACTUATOR_VERIFIED', 'SOIL_CALIBRATED', 'LIGHT_CALIBRATED', 'RAIN_CONFIGURED') {
  $taskConfigText = $taskConfigText -replace "constexpr bool $taskGate = false;", "constexpr bool $taskGate = true;"
}
Set-Content -LiteralPath $taskConfigPath -Value $taskConfigText -Encoding utf8
Write-Host 'Compiling temporary configured variant. Delivered Config.h remains unchanged.'
& $ArduinoCli compile --fqbn 'arduino:avr:nano:cpu=atmega328' --warnings all $taskConfigured
if ($LASTEXITCODE -ne 0) { throw 'Configured Nano firmware could not compile' }
