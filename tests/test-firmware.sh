#!/usr/bin/env bash
set -euo pipefail

host_only=false
if [[ $# -gt 1 || ( $# -eq 1 && $1 != --host-only ) ]]; then
  printf 'Usage: bash tests/test-firmware.sh [--host-only]\n' >&2
  exit 2
fi
if [[ $# -eq 1 ]]; then
  host_only=true
fi

test_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source_dir="$test_dir/../firmware/smart_irrigation"
build_dir="$test_dir/.build"
compiler=${CXX:-g++}
arduino_cli=${ARDUINO_CLI:-arduino-cli}
mkdir -p "$build_dir"
cd "$test_dir"

sources=(../firmware/smart_irrigation/Controller.cpp ../firmware/smart_irrigation/Sensors.cpp ../firmware/smart_irrigation/Protocol.cpp)
flags=(-std=c++11 -Wall -Wextra -Werror -O2 -I ../firmware/smart_irrigation)
"$compiler" "${flags[@]}" controller_test.cpp "${sources[@]}" -o .build/controller_test
./.build/controller_test
"$compiler" "${flags[@]}" -I stubs serial_loop_test.cpp "${sources[@]}" -o .build/serial_loop_test
./.build/serial_loop_test

if "$host_only"; then
  printf 'Host firmware tests passed. Nano compilation was not requested.\n'
  exit 0
fi

"$arduino_cli" compile --fqbn arduino:avr:nano:cpu=atmega328 --warnings all "$source_dir"
configured="$build_dir/configured/smart_irrigation"
mkdir -p "$configured"
cp "$source_dir"/*.h "$source_dir"/*.cpp "$source_dir"/*.ino "$configured/"
for gate in ACTUATOR_VERIFIED SOIL_CALIBRATED LIGHT_CALIBRATED RAIN_CONFIGURED; do
  sed "s/constexpr bool $gate = false;/constexpr bool $gate = true;/" "$configured/Config.h" > "$configured/Config.h.tmp"
  mv "$configured/Config.h.tmp" "$configured/Config.h"
done
printf 'Compiling temporary configured variant. Delivered Config.h remains unchanged.\n'
"$arduino_cli" compile --fqbn arduino:avr:nano:cpu=atmega328 --warnings all "$configured"
