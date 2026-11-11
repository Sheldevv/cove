import test from "node:test";
import assert from "node:assert/strict";
import { compileFrontend } from "../src/compiler/compile.js";

 
test("accepts C-style function definitions and void parameter lists", () => {
  const result = compileFrontend({
    path: "c-style.cove",
    text: `int add(int left, int right) { left + right }\nvoid reportScore(int score) { if (score >= 100) { print("high"); } }\nint main(void) { reportScore(add(20, 22)); return 0; }`,
  });
  assert.equal(result.diagnostics.hasErrors, false, result.diagnostics.items.map((item) => item.message).join("\n"));
  assert.equal(result.program.declarations.filter((item) => item.kind === "FunctionDeclaration").length, 3);
});

test("uses the C float suffix to infer Cove Float literals", () => {
  const result = compileFrontend({
    path: "float-suffix.cove",
    text: `int main(void) { let ratio: Float = 3.5f; print(ratio); return 0; }`,
  });
  assert.equal(result.diagnostics.hasErrors, false, result.diagnostics.items.map((item) => item.message).join("\n"));
  assert.match(result.tokens.find((token) => token.lexeme === "3.5f")?.numericSuffix ?? "", /f/i);
  const main = result.program.declarations.find((item) => item.kind === "FunctionDeclaration" && item.name === "main");
  assert.ok(main && main.kind === "FunctionDeclaration");
  const ratio = main.body.statements.find((item) => item.kind === "VariableDeclaration" && item.name === "ratio");
  assert.ok(ratio && ratio.kind === "VariableDeclaration" && ratio.initializer);
  assert.equal(result.typedProgram?.expressionTypes.get(ratio.initializer), "Float");
});


test("emits C-style function definitions and float-suffixed literals", async () => {
  const { compileToC } = await import("../src/compiler/compile.js");
  const result = compileToC({
    path: "c-compatibility.cove",
    text: `int add(int left, int right) { left + right }\nvoid reportScore(int score) { if (score >= 100) { print("high"); } }\nint main(void) { let ratio: Float = 3.5f; print(ratio); reportScore(add(20, 22)); return 0; }`,
  });
  assert.equal(result.diagnostics.hasErrors, false, result.diagnostics.items.map((item) => item.message).join("\n"));
  assert.match(result.cSource, /long long add\(/);
  assert.match(result.cSource, /3\.5f/);
  assert.match(result.cSource, /int main\(void\)/);
});

test("lexes and parses a basic Cove program", () => {
  const source = `fun add(a: Int, b: Int): Int {\n  a + b\n}\nfun main() { let result = add(2, 3); }`;
  const result = compileFrontend({ path: "test.cove", text: source });
  assert.equal(result.diagnostics.hasErrors, false);
  assert.equal(result.program.declarations.length, 2);
});

test("reports unterminated strings", () => {
  const result = compileFrontend({ path: "broken.cove", text: `fun main() { print("oops); }` });
  assert.equal(result.diagnostics.hasErrors, true);
  assert.equal(result.diagnostics.items[0]?.code, "COV1002");
});

test("recognizes exclusive and inclusive range tokens", () => {
  const result = compileFrontend({ path: "ranges.cove", text: `let a = 0..10; let b = 0..=10;` });
  assert.equal(result.tokens.some((token) => token.lexeme === ".."), true);
  assert.equal(result.tokens.some((token) => token.lexeme === "..="), true);
});

test("emits readable C and prototypes for forward function calls", async () => {
  const { compileToC } = await import("../src/compiler/compile.js");
  const result = compileToC({
    path: "emit.cove",
    text: `fun main() { greet("Cove"); }\nfun greet(name: String) { print("Hello, " + name); }`,
  });
  assert.equal(result.diagnostics.hasErrors, false, result.diagnostics.items.map((item) => item.message).join("\n"));
  assert.match(result.cSource, /void greet\(const char \* v0\);/);
  assert.match(result.cSource, /int main\(void\)/);
  assert.match(result.cSource, /cove_concat\("Hello, ", v\d+\)/);
  assert.match(result.cSource, /printf\("%s\\n",/);
});

test("requires a main function for native executable output", async () => {
  const { compileToC } = await import("../src/compiler/compile.js");
  const result = compileToC({ path: "library.cove", text: `fun greet() { print("hello"); }` });
  assert.equal(result.diagnostics.hasErrors, true);
  assert.equal(result.diagnostics.items.some((item) => item.code === "COV4003"), true);
});


test("lowers a final expression to an implicit return", async () => {
  const { compileToC } = await import("../src/compiler/compile.js");
  const result = compileToC({ path: "return.cove", text: `fun add(a: Int, b: Int): Int { a + b }\nfun main() { print(add(2, 3)); }` });
  assert.equal(result.diagnostics.hasErrors, false);
  assert.match(result.cSource, /return v\d+;/);
});

test("infers the type of a function-call initializer from its signature", async () => {
  const { compileToC } = await import("../src/compiler/compile.js");
  const result = compileToC({
    path: "call-infer.cove",
    text: `fun main() { let name = getName(); print(name); }\nfun getName() { "Cove" }`,
  });
  assert.equal(result.diagnostics.hasErrors, false, result.diagnostics.items.map((item) => item.message).join("\n"));
  assert.match(result.cSource, /v\d+ = getName\(\);/);
});

test("emits C before reporting an unavailable native compiler", async () => {
  const { buildNative } = await import("../src/compiler/native.js");
  const result = await buildNative(
    { path: "examples/hello.cove", text: `fun main() { print("hello"); }` },
    { compiler: "cove-compiler-that-does-not-exist" },
  );
  assert.equal(result.success, false);
  assert.equal(result.compiler, null);
  assert.match(result.diagnostics.join("\n"), /no working C compiler found/);
});

test("semantic analysis rejects undefined variables", async () => {
  const { compileFrontend } = await import("../src/compiler/compile.js");
  const result = compileFrontend({ path: "undefined.cove", text: `fun main() { print(missing); }` });
  assert.equal(result.diagnostics.items.some((item) => item.code === "COV4012"), true);
});

test("semantic analysis rejects undefined functions", async () => {
  const { compileFrontend } = await import("../src/compiler/compile.js");
  const result = compileFrontend({ path: "undefined-call.cove", text: `fun main() { nope(); }` });
  assert.equal(result.diagnostics.items.some((item) => item.code === "COV4023"), true);
});

test("semantic analysis checks function argument counts and types", async () => {
  const { compileFrontend } = await import("../src/compiler/compile.js");
  const result = compileFrontend({
    path: "arguments.cove",
    text: `fun greet(name: String) { print(name); }\nfun main() { greet(42); greet("ok", "extra"); }`,
  });
  assert.equal(result.diagnostics.items.some((item) => item.code === "COV4026"), true);
  assert.equal(result.diagnostics.items.some((item) => item.code === "COV4024"), true);
});

test("semantic analysis rejects duplicate variables in one scope", async () => {
  const { compileFrontend } = await import("../src/compiler/compile.js");
  const result = compileFrontend({ path: "duplicate.cove", text: `fun main() { let x = 1; let x = 2; }` });
  assert.equal(result.diagnostics.items.some((item) => item.code === "COV4010"), true);
});

test("semantic analysis checks return types", async () => {
  const { compileFrontend } = await import("../src/compiler/compile.js");
  const result = compileFrontend({ path: "return-type.cove", text: `fun getNumber(): Int { "not a number" }\nfun main() {}` });
  assert.equal(result.diagnostics.items.some((item) => item.code === "COV4026"), true);
});

test("semantic analysis supports nested scopes and inferred function returns", async () => {
  const { compileFrontend } = await import("../src/compiler/compile.js");
  const result = compileFrontend({
    path: "scopes.cove",
    text: `fun answer() { 42 }\nfun main() { { let local = answer(); print(local); } }`,
  });
  assert.equal(result.diagnostics.hasErrors, false, result.diagnostics.items.map((item) => item.message).join("\\n"));
});


test("semantic analysis requires main to use the native Int return type", async () => {
  const { compileFrontend } = await import("../src/compiler/compile.js");
  const result = compileFrontend({ path: "bad-main.cove", text: `fun main(): String { "nope" }` });
  assert.equal(result.diagnostics.items.some((item) => item.code === "COV4028"), true);
});

test("semantic analysis produces a typed IR with resolved declarations and expressions", () => {
  const result = compileFrontend({
    path: "typed-ir.cove",
    text: `fun twice(value: Int): Int { value * 2 }\nfun main() { let total = twice(21); print(total); }`,
  });
  assert.equal(result.diagnostics.hasErrors, false, result.diagnostics.items.map((item) => item.message).join("\\n"));
  assert.ok(result.typedProgram);
  const twice = result.program.declarations.find((item) => item.kind === "FunctionDeclaration" && item.name === "twice");
  const main = result.program.declarations.find((item) => item.kind === "FunctionDeclaration" && item.name === "main");
  assert.ok(twice && twice.kind === "FunctionDeclaration");
  assert.ok(main && main.kind === "FunctionDeclaration");
  assert.equal(result.typedProgram.functionReturnTypes.get(twice), "Int");
  assert.equal(result.typedProgram.parameterTypes.get(twice.parameters[0]!), "Int");
  const total = main.body.statements.find((item) => item.kind === "VariableDeclaration");
  assert.ok(total && total.kind === "VariableDeclaration");
  assert.equal(result.typedProgram.variableTypes.get(total), "Int");
  assert.equal(result.typedProgram.expressionTypes.get(total.initializer!), "Int");
});

test("C emission uses typed IR instead of re-inferring local and function types", async () => {
  const { compileToC } = await import("../src/compiler/compile.js");
  const result = compileToC({
    path: "typed-emission.cove",
    text: `fun getCount(): Int { 42 }\nfun main() { let count = getCount(); print(count); }`,
  });
  assert.equal(result.diagnostics.hasErrors, false, result.diagnostics.items.map((item) => item.message).join("\\n"));
  assert.match(result.cSource, /long long getCount\(void\);/);
  assert.match(result.cSource, /v\d+ = getCount\(\);/);
});

test("typed IR formatter displays inferred types", async () => {
  const { formatTypedProgram } = await import("../src/compiler/typed-ir.js");
  const result = compileFrontend({ path: "ir-dump.cove", text: `fun main() { let answer = 42; print(answer); }` });
  assert.ok(result.typedProgram);
  const dump = formatTypedProgram(result.typedProgram);
  assert.match(dump, /Function main\(\) -> Int/);
  assert.match(dump, /Variable<Int> answer = Literal<Int>\(42\)/);
  assert.match(dump, /Call<Void>\(BuiltinFunction\(print\), Local<Int>\(answer\)\)/);
});


test("lowers typed AST into explicit IR basic blocks and instructions", async () => {
  const { compileToC } = await import("../src/compiler/compile.js");
  const { formatIR, validateIR } = await import("../src/compiler/ir.js");
  const result = compileToC({
    path: "explicit-ir.cove",
    text: `fun ready(): Bool { true }\nfun main() { if (ready()) { print("yes"); } else { print("no"); } }`,
  });
  assert.equal(result.diagnostics.hasErrors, false, result.diagnostics.items.map((item) => item.message).join("\n"));
  assert.ok(result.irModule);
  assert.deepEqual(validateIR(result.irModule), []);
  const dump = formatIR(result.irModule);
  assert.match(dump, /IRModule/);
  assert.match(dump, /if_then/);
  assert.match(dump, /br /);
  assert.match(dump, /ret /);
  assert.doesNotMatch(dump, /TypedProgram|Literal</);
});

test("C backend emits code from explicit IR control flow", async () => {
  const { compileToC } = await import("../src/compiler/compile.js");
  const result = compileToC({
    path: "ir-control-flow.cove",
    text: `fun ready(): Bool { true }\nfun main() { if (ready()) { print("yes"); } else { print("no"); } }`,
  });
  assert.equal(result.diagnostics.hasErrors, false, result.diagnostics.items.map((item) => item.message).join("\n"));
  assert.match(result.cSource, /goto if_then/);
  assert.match(result.cSource, /if_then/);
  assert.match(result.cSource, /if_else/);
});

test("optimizer folds numeric and boolean constant expressions", async () => {
  const { compileFrontend } = await import("../src/compiler/compile.js");
  const { lowerToIR } = await import("../src/compiler/ir.js");
  const { optimizeIR } = await import("../src/compiler/optimize.js");
  const result = compileFrontend({ path: "optimize.cove", text: `fun main() { if (1 + 1 == 2) { print("yes"); } else { print("no"); } }` });
  assert.equal(result.diagnostics.hasErrors, false, result.diagnostics.items.map((d) => d.message).join("\\n"));
  const optimized = optimizeIR(lowerToIR(result.typedProgram!));
  assert.ok(optimized.stats.constantsFolded >= 2);
  assert.equal(optimized.stats.branchesSimplified, 1);
  assert.ok(optimized.stats.blocksRemoved >= 1);
});

test("optimizer does not fold division by zero", async () => {
  const { compileFrontend } = await import("../src/compiler/compile.js");
  const { lowerToIR } = await import("../src/compiler/ir.js");
  const { optimizeIR } = await import("../src/compiler/optimize.js");
  const result = compileFrontend({ path: "zero.cove", text: `fun main() { let value = 10 / 0; print(value); }` });
  assert.equal(result.diagnostics.hasErrors, false);
  const optimized = optimizeIR(lowerToIR(result.typedProgram!));
  assert.equal(optimized.stats.constantsFolded, 0);
});

test("optimizer keeps side-effecting calls and prints", async () => {
  const { compileFrontend } = await import("../src/compiler/compile.js");
  const { lowerToIR, formatIR } = await import("../src/compiler/ir.js");
  const { optimizeIR } = await import("../src/compiler/optimize.js");
  const result = compileFrontend({ path: "effects.cove", text: `fun main() { print(1 + 2); }` });
  assert.equal(result.diagnostics.hasErrors, false);
  const optimized = optimizeIR(lowerToIR(result.typedProgram!));
  const dump = formatIR(optimized.module);
  assert.match(dump, /print 3:Int/);
});


test("SSA phi nodes preserve mutable local updates across loop iterations", async () => {
  const { compileToC } = await import("../src/compiler/compile.js");
  const result = compileToC({ path: "mutable-loop.cove", text: `fun main() { let i = 0; while (i < 3) { print(i); i = i + 1; } }` });
  assert.equal(result.diagnostics.hasErrors, false, result.diagnostics.items.map((d) => d.message).join("\n"));
  assert.match(result.cSource, /phi|__cove_pred/);
  assert.match(result.cSource, /v\d+ = v\d+;/);
});

test("CFG analysis computes predecessors, dominators, and dominance frontiers", async () => {
  const { compileFrontend } = await import("../src/compiler/compile.js");
  const { lowerToIR } = await import("../src/compiler/ir.js");
  const { analyzeCFG } = await import("../src/compiler/cfg.js");
  const result = compileFrontend({ path: "cfg.cove", text: `fun main() { if (true) { print(1); } else { print(2); } }` });
  assert.ok(result.typedProgram);
  const fn = lowerToIR(result.typedProgram).functions[0]!;
  const cfg = analyzeCFG(fn);
  assert.equal(cfg.reachable.has("entry_0"), true);
  assert.ok([...cfg.successors.get("entry_0") ?? []].length > 0);
  assert.ok(cfg.dominators.get("entry_0")?.has("entry_0"));
});

test("optimizer forwards values through local stack slots", async () => {
  const { compileFrontend } = await import("../src/compiler/compile.js");
  const { lowerToIR, formatIR } = await import("../src/compiler/ir.js");
  const { optimizeIR } = await import("../src/compiler/optimize.js");
  const result = compileFrontend({ path: "memory-forward.cove", text: `fun main() { let value = 40 + 2; print(value); }` });
  assert.ok(result.typedProgram);
  const optimized = optimizeIR(lowerToIR(result.typedProgram));
  assert.ok(optimized.stats.loadsForwarded >= 1);
  assert.doesNotMatch(formatIR(optimized.module), /load %/);
});

test("SSA validator rejects uses of undefined values", async () => {
  const { validateSSA } = await import("../src/compiler/cfg.js");
  const { lowerToIR } = await import("../src/compiler/ir.js");
  const { compileFrontend } = await import("../src/compiler/compile.js");
  const result = compileFrontend({ path: "ssa-check.cove", text: `fun main() { print(1); }` });
  assert.ok(result.typedProgram);
  const module = lowerToIR(result.typedProgram);
  const fn = module.functions[0]!;
  fn.blocks[0]!.instructions.splice(0, 0, { op: "print", value: { kind: "value", value: { id: 999, type: "Int" } }, span: fn.blocks[0]!.instructions[0]!.span });
  assert.ok(validateSSA(module).some((error) => error.includes("undefined value")));
});

test("SSA inserts phi nodes when control-flow paths merge", async () => {
  const { compileFrontend } = await import("../src/compiler/compile.js");
  const { lowerToIR, formatIR } = await import("../src/compiler/ir.js");
  const { optimizeIR } = await import("../src/compiler/optimize.js");
  const { constructSSA } = await import("../src/compiler/ssa.js");
  const { validateSSA } = await import("../src/compiler/cfg.js");
  const result = compileFrontend({ path: "phi-merge.cove", text: `fun choose(flag: Bool): Int { let result = 0; if (flag) { result = 1; } else { result = 2; } result }\nfun main() { print(choose(true)); }` });
  assert.ok(result.typedProgram, result.diagnostics.items.map((d) => d.message).join("\\n"));
  const optimized = optimizeIR(lowerToIR(result.typedProgram));
  const ssa = constructSSA(optimized.module);
  assert.ok(ssa.insertedPhis >= 1);
  assert.match(formatIR(ssa.module), /phi \[/);
  assert.deepEqual(validateSSA(ssa.module), []);
});

test("CSE reuses an equivalent expression from a dominating block", async () => {
  const { compileFrontend } = await import("../src/compiler/compile.js");
  const { lowerToIR } = await import("../src/compiler/ir.js");
  const { optimizeIR } = await import("../src/compiler/optimize.js");
  const { constructSSA, eliminateCommonSubexpressions } = await import("../src/compiler/ssa.js");
  const result = compileFrontend({ path: "cse.cove", text: `fun calculate(x: Int): Int { let a = x + 2; let b = x + 2; a + b }\nfun main() { print(calculate(10)); }` });
  assert.ok(result.typedProgram);
  const optimized = optimizeIR(lowerToIR(result.typedProgram));
  const ssa = constructSSA(optimized.module);
  const cse = eliminateCommonSubexpressions(ssa.module);
  assert.ok(cse.eliminated >= 1);
});

test("ownership checker accepts an explicit String move", async () => {
  const { compileFrontend } = await import("../src/compiler/compile.js");
  const result = compileFrontend({ path: "move-ok.cove", text: `fun main() { let source: String = "hello"; let destination: String = move(source); print(destination); }` });
  assert.equal(result.diagnostics.hasErrors, false, result.diagnostics.items.map((d) => d.message).join("\\n"));
});

test("ownership checker rejects reading a moved String", async () => {
  const { compileFrontend } = await import("../src/compiler/compile.js");
  const result = compileFrontend({ path: "move-error.cove", text: `fun main() { let source: String = "hello"; let destination: String = move(source); print(source); }` });
  assert.ok(result.diagnostics.items.some((d) => d.code === "COV6001"));
});

test("ownership checker allows reinitializing a moved String", async () => {
  const { compileFrontend } = await import("../src/compiler/compile.js");
  const result = compileFrontend({ path: "move-reinit.cove", text: `fun main() { let source: String = "hello"; let destination: String = move(source); source = "again"; print(source); }` });
  assert.equal(result.diagnostics.hasErrors, false, result.diagnostics.items.map((d) => d.message).join("\\n"));
});

test("ownership checker merges moved state across branches conservatively", async () => {
  const { compileFrontend } = await import("../src/compiler/compile.js");
  const result = compileFrontend({ path: "move-branch.cove", text: `fun main() { let source: String = "hello"; if (true) { let destination: String = move(source); } print(source); }` });
  assert.ok(result.diagnostics.items.some((d) => d.code === "COV6001"));
});

test("ownership checker rejects implicit String copies", async () => {
  const { compileFrontend } = await import("../src/compiler/compile.js");
  const result = compileFrontend({ path: "string-copy.cove", text: `fun main() { let source: String = "hello"; let alias: String = source; }` });
  assert.ok(result.diagnostics.items.some((d) => d.code === "COV6004"));
});

test("ownership checker treats String parameters as borrowed", async () => {
  const { compileFrontend } = await import("../src/compiler/compile.js");
  const result = compileFrontend({ path: "borrowed-param.cove", text: `fun consume(value: String) { let moved: String = move(value); }\nfun main() { consume("hello"); }` });
  assert.ok(result.diagnostics.items.some((d) => d.code === "COV6003"));
});

test("ownership checker rejects move nested inside a borrowing call", async () => {
  const { compileFrontend } = await import("../src/compiler/compile.js");
  const result = compileFrontend({ path: "nested-move.cove", text: `fun main() { let source: String = "hello"; print(move(source)); }` });
  assert.ok(result.diagnostics.items.some((d) => d.code === "COV6005"));
});

test("borrow checker accepts repeated shared borrows", async () => {
  const { compileFrontend } = await import("../src/compiler/compile.js");
  const result = compileFrontend({ path: "borrow.cove", text: `fun read(x: String) { print(x); } fun main() { let value: String = "ok"; read(&value); read(&value); print(value); }` });
  assert.equal(result.diagnostics.hasErrors, false, result.diagnostics.items.map((d) => d.message).join("; "));
});

test("borrow checker rejects shared and exclusive borrows in one call", async () => {
  const { compileFrontend } = await import("../src/compiler/compile.js");
  const result = compileFrontend({ path: "borrow-conflict.cove", text: `fun both(a: String, b: String) {} fun main() { let value: String = "x"; both(&value, &mut value); }` });
  assert.ok(result.diagnostics.items.some((d) => d.code === "COV7001"));
});

test("borrow checker rejects moving a value in a call that also borrows it", async () => {
  const { compileFrontend } = await import("../src/compiler/compile.js");
  const result = compileFrontend({ path: "borrow-move.cove", text: `fun both(a: String, b: String) {} fun main() { let value: String = "x"; both(&value, move(value)); }` });
  assert.ok(result.diagnostics.items.some((d) => d.code === "COV7002"));
});


test("C backend emits no Cove runtime components for arithmetic-only programs", async () => {
  const { compileToC } = await import("../src/compiler/compile.js");
  const result = compileToC({ path: "minimal.cove", text: "fun main() { let value = 20 + 22; }" });
  assert.equal(result.diagnostics.hasErrors, false);
  assert.doesNotMatch(result.cSource, /#include <stdio\.h>/);
  assert.doesNotMatch(result.cSource, /#include <stdlib\.h>/);
  assert.doesNotMatch(result.cSource, /#include <string\.h>/);
  assert.doesNotMatch(result.cSource, /cove_concat/);
});

test("C backend includes only the C header required by print", async () => {
  const { compileToC } = await import("../src/compiler/compile.js");
  const result = compileToC({ path: "print.cove", text: 'fun main() { print("hello"); }' });
  assert.equal(result.diagnostics.hasErrors, false);
  assert.match(result.cSource, /#include <stdio\.h>/);
  assert.doesNotMatch(result.cSource, /#include <stdlib\.h>/);
  assert.doesNotMatch(result.cSource, /#include <string\.h>/);
  assert.doesNotMatch(result.cSource, /static inline char \*cove_concat/);
});

test("C backend emits string concatenation runtime only when String addition is used", async () => {
  const { compileToC } = await import("../src/compiler/compile.js");
  const result = compileToC({ path: "concat.cove", text: 'fun join(a: String, b: String): String { a + b }\nfun main() { print(join("hello", " world")); }' });
  assert.equal(result.diagnostics.hasErrors, false, result.diagnostics.items.map((d) => d.message).join("\\n"));
  assert.match(result.cSource, /#include <stdlib\.h>/);
  assert.match(result.cSource, /#include <string\.h>/);
  assert.match(result.cSource, /static void cove_runtime_cleanup\(void\)/);
  assert.match(result.cSource, /static void \*cove_runtime_alloc\(size_t size\)/);
  assert.match(result.cSource, /static inline char \*cove_concat/);
  assert.match(result.cSource, /cove_runtime_alloc\(x \+ y \+ 1\)/);
  assert.equal((result.cSource.match(/static void cove_runtime_cleanup/g) ?? []).length, 1);
});

test("parses generic arrays, array indexing, vararg types, and postfix foreach accumulation", () => {
  const result = compileFrontend({
    path: "arrays-vararg.cove",
    text: `fun sum(numbers: vararg<Int>): Int { let total = 0; total += number for number in numbers; total }\nfun main() { let numbers: Array<Int> = [10, 20, 30]; print(numbers[0]); print(sum(1, 2, 3)); }`,
  });
  assert.equal(result.diagnostics.hasErrors, false, result.diagnostics.items.map((item) => item.message).join("\n"));
  const sum = result.program.declarations.find((item) => item.kind === "FunctionDeclaration" && item.name === "sum");
  assert.ok(sum && sum.kind === "FunctionDeclaration");
  assert.equal(sum.parameters[0]?.vararg, true);
  assert.equal(result.typedProgram?.parameterTypes.get(sum.parameters[0]!), "Array<Int>");
});

test("rejects non-array foreach sources and mismatched vararg element types", () => {
  const result = compileFrontend({
    path: "bad-array-vararg.cove",
    text: `fun sum(numbers: vararg<Int>): Int { let total = 0; total += number for number in numbers; total }\nfun main() { let notArray = 1; print(sum(1, 2.5)); total += x for x in notArray; }`,
  });
  assert.equal(result.diagnostics.items.some((item) => item.code === "COV4026"), true);
  assert.equal(result.diagnostics.items.some((item) => item.code === "COV4033"), true);
});


test("accepts the equivalent postfix array type spelling", () => {
  const result = compileFrontend({ path: "array-suffix.cove", text: `fun main() { let numbers: Int[] = [4, 5]; print(numbers[1]); }` });
  assert.equal(result.diagnostics.hasErrors, false, result.diagnostics.items.map((item) => item.message).join("\n"));
  const main = result.program.declarations.find((item) => item.kind === "FunctionDeclaration" && item.name === "main");
  assert.ok(main && main.kind === "FunctionDeclaration");
  const numbers = main.body.statements.find((item) => item.kind === "VariableDeclaration");
  assert.ok(numbers && numbers.kind === "VariableDeclaration");
  assert.equal(result.typedProgram?.variableTypes.get(numbers), "Array<Int>");
});


test("parses array member access and indexed assignment", () => {
  const result = compileFrontend({
    path: "array-members.cove",
    text: `fun main() { let values: Array<Int> = [1, 2]; values[0] = 42; values.push(3); print(values.length); }`,
  });
  assert.equal(result.diagnostics.hasErrors, false, result.diagnostics.items.map((item) => item.message).join("\\n"));
  const main = result.program.declarations.find((item) => item.kind === "FunctionDeclaration" && item.name === "main");
  assert.ok(main && main.kind === "FunctionDeclaration");
  assert.equal(main.body.statements.length, 4);
});


test("owned arrays cannot be copied implicitly", () => {
  const result = compileFrontend({
    path: "array-copy.cove",
    text: `fun main() { let source: Array<Int> = [1, 2]; let alias: Array<Int> = source; }`,
  });
  assert.ok(result.diagnostics.items.some((item) => item.code === "COV6004"));
});

test("owned arrays can be transferred with move()", () => {
  const result = compileFrontend({
    path: "array-move.cove",
    text: `fun main() { let source: Array<Int> = [1, 2]; let destination: Array<Int> = move(source); print(destination.length); }`,
  });
  assert.equal(result.diagnostics.hasErrors, false, result.diagnostics.items.map((item) => item.message).join("\\n"));
});

test("reading an array after moving it is rejected", () => {
  const result = compileFrontend({
    path: "array-move-read.cove",
    text: `fun main() { let source: Array<Int> = [1, 2]; let destination: Array<Int> = move(source); print(source.length); }`,
  });
  assert.ok(result.diagnostics.items.some((item) => item.code === "COV6001"));
});


test("implicit return cannot copy an owned array", () => {
  const result = compileFrontend({
    path: "array-implicit-copy.cove",
    text: `fun make(): Array<Int> { let values: Array<Int> = [1, 2]; values } fun main() {}`,
  });
  assert.ok(result.diagnostics.items.some((item) => item.code === "COV6004"));
});


test("empty array literals require an explicit element type", () => {
  const result = compileFrontend({ path: "empty-array.cove", text: `fun main() { let values = []; }` });
  assert.ok(result.diagnostics.items.some((item) => item.code === "COV4044"));
});

test("type-checks Array reserve, shrinkToFit, and clear methods", () => {
  const valid = compileFrontend({
    path: "array-capacity-methods.cove",
    text: `fun main() { let values: Array<Int> = [1, 2]; values.reserve(64); values.shrinkToFit(); values.clear(); }`,
  });
  assert.equal(valid.diagnostics.hasErrors, false, valid.diagnostics.items.map((item) => item.message).join("\\n"));

  const invalidCapacity = compileFrontend({
    path: "array-reserve-type.cove",
    text: `fun main() { let values: Array<Int> = []; values.reserve("large"); }`,
  });
  assert.equal(invalidCapacity.diagnostics.items.some((item) => item.code === "COV4046"), true);

  const invalidArity = compileFrontend({
    path: "array-clear-arity.cove",
    text: `fun main() { let values: Array<Int> = []; values.clear(1); }`,
  });
  assert.equal(invalidArity.diagnostics.items.some((item) => item.code === "COV4047"), true);
});
