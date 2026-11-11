import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileToC } from "../src/compiler/compile.js";

const gcc = spawnSync("gcc", ["--version"], { encoding: "utf8" });
const hasGcc = !gcc.error && gcc.status === 0;

test("generated C runtime integration: minimal, print, bool, and concatenation", { skip: !hasGcc }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "cove-runtime-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));

  const cases = [
    {
      name: "arithmetic",
      source: `fun square(value: Int): Int { value * value }\nfun main(): Int { return square(12); }`,
      expectedOutput: "",
      expectedStatus: 144,
      includes: [],
      excludes: ["cove_runtime_alloc", "cove_concat", "<stdio.h>", "<stdlib.h>", "<string.h>"],
    },
    {
      name: "print",
      source: `fun main() { print("Hello from Cove!"); }`,
      expectedOutput: "Hello from Cove!\n",
      expectedStatus: 0,
      includes: ["<stdio.h>"],
      excludes: ["cove_runtime_alloc", "cove_concat", "<stdlib.h>", "<string.h>"],
    },
    {
      name: "bool",
      source: `fun is_ready(): Bool { true }\nfun main(): Int { if (is_ready()) { return 1; } return 0; }`,
      expectedOutput: "",
      expectedStatus: 1,
      includes: ["<stdbool.h>"],
      excludes: ["cove_runtime_alloc", "cove_concat", "<stdio.h>", "<stdlib.h>", "<string.h>"],
    },
    {
      name: "concat",
      source: `fun greet(name: String) { print("Hello, " + name); }\nfun main() { greet("Cove"); }`,
      expectedOutput: "Hello, Cove\n",
      expectedStatus: 0,
      includes: ["<stdio.h>", "<stdlib.h>", "<string.h>"],
      excludes: [],
    },
  ];

  for (const item of cases) {
    const compiled = compileToC({ path: `${item.name}.cove`, text: item.source });
    assert.equal(compiled.diagnostics.hasErrors, false, `${item.name}: ${compiled.diagnostics.items.map((d) => d.message).join("; ")}`);
    const cPath = join(directory, `${item.name}.c`);
    const executable = join(directory, item.name);
    await writeFile(cPath, compiled.cSource, "utf8");

    for (const include of item.includes) assert.ok(compiled.cSource.includes(`#include ${include}`), `${item.name} missing ${include}`);
    for (const excluded of item.excludes) assert.ok(!compiled.cSource.includes(excluded), `${item.name} unexpectedly contains ${excluded}`);

    const build = spawnSync("gcc", ["-std=c11", "-Wall", "-Wextra", "-Wpedantic", cPath, "-o", executable], { encoding: "utf8" });
    assert.equal(build.status, 0, `${item.name} GCC build failed:\n${build.stderr}`);
    const run = spawnSync(executable, [], { encoding: "utf8" });
    assert.equal(run.status, item.expectedStatus, `${item.name} returned unexpected status. stderr: ${run.stderr}`);
    assert.equal(run.stdout, item.expectedOutput, `${item.name} printed unexpected output`);

    if (item.name === "concat") {
      const generated = await readFile(cPath, "utf8");
      assert.equal((generated.match(/static void cove_runtime_cleanup\(void\)/g) ?? []).length, 1);
      assert.equal((generated.match(/static void \*cove_runtime_alloc\(size_t size\)/g) ?? []).length, 1);
      assert.equal((generated.match(/static inline char \*cove_concat/g) ?? []).length, 1);
      assert.match(generated, /atexit\(cove_runtime_cleanup\)/);
      assert.ok(generated.indexOf("typedef struct CoveAllocation") < generated.indexOf("static inline char *cove_concat"),
        "runtime dependencies must be emitted before their dependents");

      // If this GCC supports AddressSanitizer, also verify the atexit arena
      // cleanup releases every tracked allocation (including repeated joins).
      const sanitizerExecutable = join(directory, "concat-asan");
      const sanitizerBuild = spawnSync("gcc", ["-std=c11", "-Wall", "-Wextra", "-Wpedantic", "-fsanitize=address", "-fno-omit-frame-pointer", cPath, "-o", sanitizerExecutable], { encoding: "utf8" });
      if (sanitizerBuild.status === 0) {
        const sanitizedRun = spawnSync(sanitizerExecutable, [], {
          encoding: "utf8",
          env: { ...process.env, ASAN_OPTIONS: "detect_leaks=1:halt_on_error=1" },
        });
        assert.equal(sanitizedRun.status, 0, `AddressSanitizer reported a runtime issue:\n${sanitizedRun.stderr}`);
        assert.equal(sanitizedRun.stdout, item.expectedOutput);
      }
    }
  }
});


test("generated C integration: arrays, bounds checks, varargs, and postfix foreach", { skip: !hasGcc }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "cove-arrays-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const source = `fun sum(numbers: vararg<Int>): Int {
    let total = 0;
    total += number for number in numbers;
    total
}
fun main() {
    let numbers: Array<Int> = [10, 20, 30];
    print(numbers[0]);
    print(numbers[1]);
    print(numbers[2]);
    print(sum(1, 2, 3, 4, 5));
    print(sum());
}`;
  const compiled = compileToC({ path: "arrays-vararg.cove", text: source });
  assert.equal(compiled.diagnostics.hasErrors, false, compiled.diagnostics.items.map((d) => d.message).join("; "));
  assert.match(compiled.cSource, /typedef struct CoveIntArray/);
  assert.match(compiled.cSource, /cove_array_checked_index/);
  assert.match(compiled.cSource, /sum\(v\d+\)/);
  const cPath = join(directory, "arrays.c");
  const executable = join(directory, "arrays");
  await writeFile(cPath, compiled.cSource, "utf8");
  const build = spawnSync("gcc", ["-std=c11", "-Wall", "-Wextra", "-Wpedantic", cPath, "-o", executable], { encoding: "utf8" });
  assert.equal(build.status, 0, `GCC build failed:\n${build.stderr}`);
  const run = spawnSync(executable, [], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "10\n20\n30\n15\n0\n");

  const outOfBounds = compileToC({ path: "bounds.cove", text: `fun main() { let values: Array<Int> = [7]; print(values[1]); }` });
  assert.equal(outOfBounds.diagnostics.hasErrors, false, outOfBounds.diagnostics.items.map((d) => d.message).join("; "));
  const boundsC = join(directory, "bounds.c");
  const boundsExe = join(directory, "bounds");
  await writeFile(boundsC, outOfBounds.cSource, "utf8");
  const boundsBuild = spawnSync("gcc", ["-std=c11", "-Wall", "-Wextra", "-Wpedantic", boundsC, "-o", boundsExe], { encoding: "utf8" });
  assert.equal(boundsBuild.status, 0, boundsBuild.stderr);
  const boundsRun = spawnSync(boundsExe, [], { encoding: "utf8" });
  assert.notEqual(boundsRun.status, 0, "out-of-bounds access should terminate safely");
  assert.match(boundsRun.stderr, /out of bounds/);
});
