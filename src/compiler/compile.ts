import { DiagnosticBag } from "../diagnostics/diagnostic.js";
import type { SourceFile } from "../diagnostics/source.js";
import { Lexer } from "../lexer/lexer.js";
import { Parser } from "../parser/parser.js";
import type { Program } from "../parser/ast.js";
import { IRCEmitter } from "./ir-c-emitter.js";
import { lowerToIR, validateIR, type IRModule } from "./ir.js";
import { optimizeIR } from "./optimize.js";
import { validateSSA } from "./cfg.js";
import { constructSSA, eliminateCommonSubexpressions } from "./ssa.js";
import { SemanticAnalyzer } from "./semantic.js";
import { OwnershipAnalyzer } from "./ownership.js";
import type { TypedProgram } from "./typed-ir.js";

export interface FrontendResult {
  readonly program: Program;
  readonly diagnostics: DiagnosticBag;
  readonly tokens: ReturnType<Lexer["scan"]>;
  readonly typedProgram?: TypedProgram;
}

export interface CompileResult extends FrontendResult {
  readonly cSource: string;
  readonly irModule?: IRModule;
}

export function compileFrontend(file: SourceFile): FrontendResult {
  const diagnostics = new DiagnosticBag();
  const tokens = new Lexer(file, diagnostics).scan();
  const program = new Parser(tokens, file, diagnostics).parse();
  const typedProgram = !diagnostics.hasErrors ? new SemanticAnalyzer(file, diagnostics).analyze(program) : undefined;
  if (typedProgram && !diagnostics.hasErrors) new OwnershipAnalyzer(file, diagnostics).analyze(typedProgram);
  return { program, diagnostics, tokens, ...(typedProgram && !diagnostics.hasErrors ? { typedProgram } : {}) };
}

export function compileToC(file: SourceFile): CompileResult {
  const frontend = compileFrontend(file);
  if (frontend.diagnostics.hasErrors || !frontend.typedProgram) return { ...frontend, cSource: "" };
  const lowered = lowerToIR(frontend.typedProgram);
  const optimized = optimizeIR(lowered);
  const ssa = constructSSA(optimized.module);
  const irModule = eliminateCommonSubexpressions(ssa.module).module;
  for (const error of [...validateIR(irModule), ...validateSSA(irModule)]) {
    frontend.diagnostics.error("COV5001", `invalid generated IR: ${error}`, file, frontend.program.span);
  }
  const cSource = frontend.diagnostics.hasErrors ? "" : new IRCEmitter().emit(irModule);
  return { ...frontend, cSource, irModule };
}
