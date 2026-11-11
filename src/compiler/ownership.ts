import type { DiagnosticBag } from "../diagnostics/diagnostic.js";
import type { SourceFile } from "../diagnostics/source.js";
import type { Expression, FunctionDeclaration, Program, Statement } from "../parser/ast.js";
import type { CoveType, TypedProgram } from "./typed-ir.js";

interface Binding { readonly type: CoveType; moved: boolean; readonly borrowed: boolean; }
type Environment = Map<string, Binding>[];

/**
 * Initial ownership checker. String and owned Array values are non-Copy;
 * `move(name)` transfers a binding and makes subsequent reads illegal.
 * This is a static ownership foundation, not yet a complete borrow checker.
 */
export class OwnershipAnalyzer {
  constructor(private readonly file: SourceFile, private readonly diagnostics: DiagnosticBag) {}

  analyze(typed: TypedProgram): void {
    for (const declaration of typed.ast.declarations) {
      if (declaration.kind === "FunctionDeclaration") this.checkFunction(declaration, typed);
    }
  }

  private checkFunction(fn: FunctionDeclaration, typed: TypedProgram): void {
    const env: Environment = [new Map()];
    for (const parameter of fn.parameters) {
      env[0]!.set(parameter.name, { type: typed.parameterTypes.get(parameter) ?? "Unknown", moved: false, borrowed: true });
    }
    const last = fn.body.statements.at(-1);
    const hasImplicitReturn = fn.name !== "main" && (typed.functionReturnTypes.get(fn) ?? "Void") !== "Void"
      && last?.kind === "ExpressionStatement";
    this.checkStatements(hasImplicitReturn ? fn.body.statements.slice(0, -1) : fn.body.statements, env, typed);
    if (hasImplicitReturn && last?.kind === "ExpressionStatement") {
      this.checkTransferValue(last.expression, env, typed, "return");
    }
  }

  private checkStatements(statements: readonly Statement[], env: Environment, typed: TypedProgram): void {
    for (const statement of statements) this.checkStatement(statement, env, typed);
  }

  private checkStatement(statement: Statement, env: Environment, typed: TypedProgram): void {
    switch (statement.kind) {
      case "BlockStatement":
        env.push(new Map());
        this.checkStatements(statement.statements, env, typed);
        env.pop();
        break;
      case "VariableDeclaration": {
        if (statement.initializer) this.checkTransferValue(statement.initializer, env, typed, "initializer");
        env.at(-1)!.set(statement.name, { type: typed.variableTypes.get(statement) ?? "Unknown", moved: false, borrowed: false });
        break;
      }
      case "ExpressionStatement": this.checkExpression(statement.expression, env, typed); break;
      case "ReturnStatement": if (statement.value) this.checkTransferValue(statement.value, env, typed, "return"); break;
      case "IfStatement": {
        this.checkExpression(statement.condition, env, typed);
        const thenEnv = this.cloneEnvironment(env);
        this.checkStatement(statement.thenBranch, thenEnv, typed);
        const elseEnv = this.cloneEnvironment(env);
        if (statement.elseBranch) this.checkStatement(statement.elseBranch, elseEnv, typed);
        this.mergeMoved(env, thenEnv, elseEnv);
        break;
      }
      case "WhileStatement": {
        this.checkExpression(statement.condition, env, typed);
        const bodyEnv = this.cloneEnvironment(env);
        this.checkStatement(statement.body, bodyEnv, typed);
        this.mergeMoved(env, env, bodyEnv);
        break;
      }
      case "ForEachStatement": {
        this.checkExpression(statement.iterable, env, typed);
        const bodyEnv = this.cloneEnvironment(env);
        bodyEnv.push(new Map([[statement.variable, { type: "Unknown", moved: false, borrowed: true }]]));
        this.checkStatement(statement.body, bodyEnv, typed);
        break;
      }
    }
  }

  private checkTransferValue(expression: Expression, env: Environment, typed: TypedProgram, context: string): void {
    if (expression.kind === "IdentifierExpression") {
      const type = typed.expressionTypes.get(expression) ?? "Unknown";
      if (type === "String" || /^Array<.+>$/.test(type)) {
        this.diagnostics.error("COV6004", `cannot copy ${type} value '${expression.name}' into ${context}`, this.file, expression.span,
          `Use move(${expression.name}) to transfer ownership, or pass the value directly to a borrowing function parameter.`);
      }
    }
    this.checkExpression(expression, env, typed, expression.kind === "CallExpression" && expression.callee.kind === "IdentifierExpression" && expression.callee.name === "move");
  }

  private checkExpression(expression: Expression, env: Environment, typed: TypedProgram, allowMove = false): void {
    switch (expression.kind) {
      case "IdentifierExpression": this.checkRead(expression.name, expression.span, env); break;
      case "LiteralExpression": break;
      case "ArrayLiteralExpression": for (const element of expression.elements) this.checkExpression(element, env, typed); break;
      case "IndexExpression": this.checkExpression(expression.target, env, typed); this.checkExpression(expression.index, env, typed); break;
      case "MemberAccessExpression": this.checkExpression(expression.target, env, typed); break;
      case "GroupExpression": this.checkExpression(expression.expression, env, typed); break;
      case "UnaryExpression": this.checkExpression(expression.operand, env, typed); break;
      case "BinaryExpression":
        this.checkExpression(expression.left, env, typed);
        this.checkExpression(expression.right, env, typed);
        break;
      case "AssignmentExpression": {
        this.checkTransferValue(expression.value, env, typed, "assignment");
        if (expression.target.kind === "IdentifierExpression") {
          const binding = this.lookup(expression.target.name, env);
          if (binding) binding.moved = false; // Reinitialization restores an available owner.
        } else this.checkExpression(expression.target, env, typed);
        break;
      }
      case "CallExpression": {
        const borrows = new Map<string, { mutable: boolean; span: import("../diagnostics/source.js").SourceSpan }>();
        const moved = new Set<string>();
        for (const argument of expression.arguments) {
          if (argument.kind === "UnaryExpression" && (argument.operator === "&" || argument.operator === "&mut") && argument.operand.kind === "IdentifierExpression") {
            const name = argument.operand.name;
            const mutable = argument.operator === "&mut";
            const previous = borrows.get(name);
            if (previous && (previous.mutable || mutable)) this.diagnostics.error("COV7001", `conflicting borrow of '${name}'`, this.file, argument.span, "Multiple shared borrows are allowed, but an exclusive borrow must be the only active borrow.");
            else if (!previous) borrows.set(name, { mutable, span: argument.span });
          }
          if (argument.kind === "CallExpression" && argument.callee.kind === "IdentifierExpression" && argument.callee.name === "move" && argument.arguments[0]?.kind === "IdentifierExpression") moved.add(argument.arguments[0].name);
        }
        for (const [name, borrow] of borrows) if (moved.has(name)) this.diagnostics.error("COV7002", `cannot move '${name}' while it is borrowed`, this.file, borrow.span, "Do not borrow and move the same value in one call.");
        if (expression.callee.kind === "IdentifierExpression" && expression.callee.name === "move") {
          const argument = expression.arguments[0];
          if (!allowMove) {
            this.diagnostics.error("COV6005", "move() must be used as a direct initializer, assignment value, or return value", this.file, expression.span);
            for (const item of expression.arguments) this.checkExpression(item, env, typed);
            return;
          }
          if (argument?.kind !== "IdentifierExpression" || expression.arguments.length !== 1) {
            this.diagnostics.error("COV6002", "move() currently requires exactly one variable name", this.file, expression.span,
              "Use move(value) to transfer a named value into a new owner.");
            for (const item of expression.arguments) this.checkExpression(item, env, typed);
            return;
          }
          const binding = this.lookup(argument.name, env);
          this.checkRead(argument.name, argument.span, env);
          if (binding?.borrowed) {
            this.diagnostics.error("COV6003", `cannot move borrowed parameter '${argument.name}'`, this.file, argument.span,
              "String parameters are borrowed in this milestone. Ownership-taking parameter annotations will be added with the borrow checker.");
          } else if (binding?.type === "String" || /^Array<.+>$/.test(binding?.type ?? "")) binding!.moved = true;
          return;
        }
        this.checkExpression(expression.callee, env, typed);
        for (const argument of expression.arguments) this.checkExpression(argument, env, typed);
        break;
      }
    }
  }

  private checkRead(name: string, span: import("../diagnostics/source.js").SourceSpan, env: Environment): void {
    const binding = this.lookup(name, env);
    if (binding?.moved) {
      this.diagnostics.error("COV6001", `use of moved value '${name}'`, this.file, span,
        `The value '${name}' was moved. Assign a new value to '${name}' before using it again.`);
    }
  }

  private lookup(name: string, env: Environment): Binding | undefined {
    for (let i = env.length - 1; i >= 0; i--) {
      const binding = env[i]!.get(name);
      if (binding) return binding;
    }
    return undefined;
  }

  private cloneEnvironment(env: Environment): Environment {
    return env.map((scope) => new Map([...scope].map(([name, binding]) => [name, { ...binding }])));
  }

  private mergeMoved(target: Environment, left: Environment, right: Environment): void {
    for (let i = 0; i < target.length; i++) {
      const targetScope = target[i]!;
      for (const [name, binding] of targetScope) {
        const a = left[i]?.get(name);
        const b = right[i]?.get(name);
        binding.moved = Boolean(a?.moved || b?.moved);
      }
    }
  }

}
