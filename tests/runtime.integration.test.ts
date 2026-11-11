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


test("generated C integration: owned dynamic arrays grow, mutate, and clean up", { skip: !hasGcc }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "cove-dynamic-arrays-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const source = `fun editCopy(values: Array<Int>): Int {
    values.push(99);
    values[0] = 77;
    values.length
}
fun main(): Int {
    let values: Array<Int> = [];
    values.push(10);
    values.push(20);
    values.push(30);
    values.push(40);
    values.push(50);
    values[0] = 42;
    values[1] += 5;
    print(values.length);
    print(values[0]);
    print(values[1]);
    print(editCopy(values));
    print(values[0]);
    return 0;
}`;
  const compiled = compileToC({ path: "dynamic-arrays.cove", text: source });
  assert.equal(compiled.diagnostics.hasErrors, false, compiled.diagnostics.items.map((d) => d.message).join("; "));
  assert.match(compiled.cSource, /size_t capacity;/);
  assert.match(compiled.cSource, /realloc\(/);
  const cPath = join(directory, "dynamic-arrays.c");
  const executable = join(directory, "dynamic-arrays");
  await writeFile(cPath, compiled.cSource, "utf8");
  const build = spawnSync("gcc", ["-std=c11", "-Wall", "-Wextra", "-Wpedantic", cPath, "-o", executable], { encoding: "utf8" });
  assert.equal(build.status, 0, `GCC build failed:\\n${build.stderr}`);
  const run = spawnSync(executable, [], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "5\n42\n25\n6\n42\n");

  const sanitizerExecutable = join(directory, "dynamic-arrays-asan");
  const sanitizerBuild = spawnSync("gcc", ["-std=c11", "-Wall", "-Wextra", "-Wpedantic", "-fsanitize=address,undefined", "-fno-omit-frame-pointer", cPath, "-o", sanitizerExecutable], { encoding: "utf8" });
  if (sanitizerBuild.status === 0) {
    const sanitizedRun = spawnSync(sanitizerExecutable, [], {
      encoding: "utf8",
      env: { ...process.env, ASAN_OPTIONS: "detect_leaks=1:halt_on_error=1" },
    });
    assert.equal(sanitizedRun.status, 0, `ASan/UBSan reported a runtime issue:\n${sanitizedRun.stderr}`);
    assert.equal(sanitizedRun.stdout, run.stdout);
  }
});


test("generated C integration: moving an array transfers its allocation exactly once", { skip: !hasGcc }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "cove-array-move-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const source = `fun main(): Int {
    let original: Array<Int> = [11, 22, 33];
    let transferred: Array<Int> = move(original);
    print(transferred.length);
    print(transferred[1]);
    return 0;
}`;
  const compiled = compileToC({ path: "array-move.cove", text: source });
  assert.equal(compiled.diagnostics.hasErrors, false, compiled.diagnostics.items.map((d) => d.message).join("; "));
  const cPath = join(directory, "array-move.c");
  const executable = join(directory, "array-move");
  await writeFile(cPath, compiled.cSource, "utf8");
  const build = spawnSync("gcc", ["-std=c11", "-Wall", "-Wextra", "-Wpedantic", cPath, "-o", executable], { encoding: "utf8" });
  assert.equal(build.status, 0, `GCC build failed:\\n${build.stderr}`);
  const run = spawnSync(executable, [], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "3\n22\n");
});


test("generated C integration: returned arrays transfer ownership and literal arguments borrow", { skip: !hasGcc }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "cove-array-return-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const source = `fun makeValues(): Array<Int> {
    let values: Array<Int> = [4, 5, 6];
    move(values)
}
fun sum(values: Array<Int>): Int {
    let total = 0;
    total += value for value in values;
    total
}
fun main(): Int {
    let values: Array<Int> = makeValues();
    print(sum([1, 2, 3]));
    print(values.length);
    return 0;
}`;
  const compiled = compileToC({ path: "array-return.cove", text: source });
  assert.equal(compiled.diagnostics.hasErrors, false, compiled.diagnostics.items.map((d) => d.message).join("; "));
  const cPath = join(directory, "array-return.c");
  const executable = join(directory, "array-return");
  await writeFile(cPath, compiled.cSource, "utf8");
  const build = spawnSync("gcc", ["-std=c11", "-Wall", "-Wextra", "-Wpedantic", cPath, "-o", executable], { encoding: "utf8" });
  assert.equal(build.status, 0, `GCC build failed:\\n${build.stderr}`);
  const run = spawnSync(executable, [], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "6\n3\n");
});


test("generated C integration: arrays declared in loop scopes are dropped each iteration", { skip: !hasGcc }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "cove-array-scope-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const source = `fun main() {
    let index = 0;
    while (index < 3) {
        let values: Array<Int> = [];
        values.push(index);
        print(values[0]);
        index += 1;
    }
}`;
  const compiled = compileToC({ path: "array-scope.cove", text: source });
  assert.equal(compiled.diagnostics.hasErrors, false, compiled.diagnostics.items.map((d) => d.message).join("; "));
  assert.match(compiled.cSource, /owns_data\) free\(slot/);
  const cPath = join(directory, "array-scope.c");
  const executable = join(directory, "array-scope");
  await writeFile(cPath, compiled.cSource, "utf8");
  const build = spawnSync("gcc", ["-std=c11", "-Wall", "-Wextra", "-Wpedantic", cPath, "-o", executable], { encoding: "utf8" });
  assert.equal(build.status, 0, `GCC build failed:\\n${build.stderr}`);
  const run = spawnSync(executable, [], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "0\n1\n2\n");

  const sanitizerExecutable = join(directory, "array-scope-asan");
  const sanitizerBuild = spawnSync("gcc", ["-std=c11", "-Wall", "-Wextra", "-Wpedantic", "-fsanitize=address,undefined", "-fno-omit-frame-pointer", cPath, "-o", sanitizerExecutable], { encoding: "utf8" });
  if (sanitizerBuild.status === 0) {
    const sanitizedRun = spawnSync(sanitizerExecutable, [], {
      encoding: "utf8",
      env: { ...process.env, ASAN_OPTIONS: "detect_leaks=1:halt_on_error=1" },
    });
    assert.equal(sanitizedRun.status, 0, `ASan/UBSan reported a runtime issue:\n${sanitizedRun.stderr}`);
    assert.equal(sanitizedRun.stdout, run.stdout);
  }
});


test("generated C integration: indexed writes are bounds checked and early returns clean arrays", { skip: !hasGcc }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "cove-array-early-return-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const source = `fun first(): Int {
    let values: Array<Int> = [31, 32];
    return values[0];
}
fun main(): Int {
    print(first());
    return 0;
}`;
  const compiled = compileToC({ path: "array-early-return.cove", text: source });
  assert.equal(compiled.diagnostics.hasErrors, false, compiled.diagnostics.items.map((d) => d.message).join("; "));
  const cPath = join(directory, "array-early-return.c");
  const executable = join(directory, "array-early-return");
  await writeFile(cPath, compiled.cSource, "utf8");
  const build = spawnSync("gcc", ["-std=c11", "-Wall", "-Wextra", "-Wpedantic", cPath, "-o", executable], { encoding: "utf8" });
  assert.equal(build.status, 0, `GCC build failed:\\n${build.stderr}`);
  const run = spawnSync(executable, [], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "31\n");

  const outOfBoundsSource = `fun main() { let values: Array<Int> = [1]; values[1] = 2; }`;
  const outOfBounds = compileToC({ path: "array-write-bounds.cove", text: outOfBoundsSource });
  assert.equal(outOfBounds.diagnostics.hasErrors, false, outOfBounds.diagnostics.items.map((d) => d.message).join("; "));
  const boundsPath = join(directory, "array-write-bounds.c");
  const boundsExecutable = join(directory, "array-write-bounds");
  await writeFile(boundsPath, outOfBounds.cSource, "utf8");
  const boundsBuild = spawnSync("gcc", ["-std=c11", "-Wall", "-Wextra", "-Wpedantic", boundsPath, "-o", boundsExecutable], { encoding: "utf8" });
  assert.equal(boundsBuild.status, 0, boundsBuild.stderr);
  const boundsRun = spawnSync(boundsExecutable, [], { encoding: "utf8" });
  assert.notEqual(boundsRun.status, 0, "out-of-bounds indexed writes must terminate safely");
});

test("generated C integration: reserve, shrinkToFit, and clear preserve array semantics", { skip: !hasGcc }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "cove-array-capacity-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const source = `fun mutateBorrowed(values: Array<Int>) {
    print(values.capacity);
    values.reserve(32);
    values.push(777);
    values.shrinkToFit();
    values.clear();
    print(values.length);
    print(values.capacity);
}
fun main(): Int {
    let values: Array<Int> = [10, 20, 30];
    values.reserve(64);
    print(values.capacity);
    print(values.length);
    values.push(40);
    values.shrinkToFit();
    print(values.capacity);
    print(values.length);
    print(values[3]);
    values.clear();
    print(values.length);
    print(values.capacity);
    values.push(99);
    print(values.capacity);
    print(values.length);
    print(values[0]);
    mutateBorrowed(values);
    print(values.length);
    print(values[0]);
    return 0;
}`;
  const compiled = compileToC({ path: "array-capacity.cove", text: source });
  assert.equal(compiled.diagnostics.hasErrors, false, compiled.diagnostics.items.map((d) => d.message).join("; "));
  assert.match(compiled.cSource, /cove_array_reserve_Int/);
  assert.match(compiled.cSource, /cove_array_shrink_to_fit_Int/);
  assert.match(compiled.cSource, /cove_array_clear_Int/);
  const cPath = join(directory, "array-capacity.c");
  const executable = join(directory, "array-capacity");
  await writeFile(cPath, compiled.cSource, "utf8");
  const build = spawnSync("gcc", ["-std=c11", "-Wall", "-Wextra", "-Wpedantic", cPath, "-o", executable], { encoding: "utf8" });
  assert.equal(build.status, 0, `GCC build failed:\\n${build.stderr}`);
  const run = spawnSync(executable, [], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "64\n3\n4\n4\n40\n0\n4\n4\n1\n99\n1\n0\n2\n1\n99\n");

  const sanitizerExecutable = join(directory, "array-capacity-asan");
  const sanitizerBuild = spawnSync("gcc", ["-std=c11", "-Wall", "-Wextra", "-Wpedantic", "-fsanitize=address,undefined", "-fno-omit-frame-pointer", cPath, "-o", sanitizerExecutable], { encoding: "utf8" });
  if (sanitizerBuild.status === 0) {
    const sanitizedRun = spawnSync(sanitizerExecutable, [], { encoding: "utf8", env: { ...process.env, ASAN_OPTIONS: "detect_leaks=1:halt_on_error=1" } });
    assert.equal(sanitizedRun.status, 0, `ASan/UBSan reported an array ownership issue:\n${sanitizedRun.stderr}`);
    assert.equal(sanitizedRun.stdout, run.stdout);
  }

  const negativeCapacity = compileToC({ path: "array-reserve-negative.cove", text: `fun main() { let values: Array<Int> = []; values.reserve(-1); }` });
  assert.equal(negativeCapacity.diagnostics.hasErrors, false, negativeCapacity.diagnostics.items.map((d) => d.message).join("; "));
  const negativeC = join(directory, "array-reserve-negative.c");
  const negativeExe = join(directory, "array-reserve-negative");
  await writeFile(negativeC, negativeCapacity.cSource, "utf8");
  const negativeBuild = spawnSync("gcc", ["-std=c11", "-Wall", "-Wextra", "-Wpedantic", negativeC, "-o", negativeExe], { encoding: "utf8" });
  assert.equal(negativeBuild.status, 0, negativeBuild.stderr);
  const negativeRun = spawnSync(negativeExe, [], { encoding: "utf8" });
  assert.notEqual(negativeRun.status, 0, "negative reserve capacity must fail safely");
});
