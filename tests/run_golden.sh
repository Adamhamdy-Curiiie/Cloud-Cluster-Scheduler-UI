#!/usr/bin/env bash
set -eu

project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
build_dir="$project_root/bin/golden-sh"
mkdir -p "$build_dir/classes" "$build_dir/actual"
javac -d "$build_dir/classes" "$project_root"/*.java

failed=0
for input in "$project_root"/tests/inputs/*.txt; do
    name=$(basename -- "$input" .txt)
    actual="$build_dir/actual/$name.txt"
    expected="$project_root/tests/golden/$name.txt"

    if ! java -cp "$build_dir/classes" Main < "$input" > "$actual"; then
        echo "FAIL: $name (program failed)" >&2
        failed=1
        continue
    fi

    if diff -u "$expected" "$actual"; then
        echo "PASS: $name"
    else
        echo "FAIL: $name (console output differs)" >&2
        failed=1
    fi
done

if [ "$failed" -ne 0 ]; then
    exit 1
fi
echo "All golden tests passed."
