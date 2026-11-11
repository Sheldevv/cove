import type { DiagnosticBag } from "../diagnostics/diagnostic.js";
import type { SourceFile, SourceSpan } from "../diagnostics/source.js";
import type {
  AssignmentExpression, BinaryExpression, BlockStatement, CallExpression, Expression, MemberAccessExpression,
  FunctionDeclaration, Parameter, Program, Statement, TypeNode, VariableDeclaration,
} from "../parser/ast.js";
import type { CoveType, TypedProgram } from "./typed-ir.js";

type TypeName = CoveType;
interface FunctionInfo { readonly declaration: FunctionDeclaration; readonly parameters: TypeName[]; readonly varargIndex: number; returnType: TypeName; }

const BUILTINS = new Map<string, TypeName>([
  ["int", "Int"], ["i8", "Int"], ["i16", "Int"], ["i32", "Int"], ["i64", "Int"],
  ["uint", "Int"], ["u8", "Int"], ["u16", "Int"], ["u32", "Int"], ["u64", "Int"],
  ["float", "Float"], ["double", "Double"], ["bool", "Bool"], ["boolean", "Bool"],
  ["string", "String"], ["void", "Void"],
]);

/** Performs name resolution and built-in type checking before C code generation. */
export class SemanticAnalyzer {
  private readonly functions = new Map<string, FunctionInfo>();
  private readonly scopes: Map<string, TypeName>[] = [];
  private readonly expressionTypes = new Map<Expression, CoveType>();
  private readonly variableTypes = new Map<VariableDeclaration, CoveType>();
  private readonly parameterTypes = new Map<Parameter, CoveType>();
  private readonly functionReturnTypes = new Map<FunctionDeclaration, CoveType>();
  private currentFunction: FunctionInfo | undefined;

  constructor(private readonly file: SourceFile, private readonly diagnostics: DiagnosticBag) {}

  analyze(program: Program): TypedProgram {
    this.collectFunctions(program);
    this.inferFunctionReturns();
    for (const declaration of program.declarations) {
      if (declaration.kind === "FunctionDeclaration") this.checkFunction(declaration);
      else this.error("COV4001", "top-level statements are not supported yet", declaration.span);
    }
    for (const info of this.functions.values()) this.functionReturnTypes.set(info.declaration, info.returnType);
    return {
      kind: "TypedProgram",
      ast: program,
      expressionTypes: this.expressionTypes,
      variableTypes: this.variableTypes,
      parameterTypes: this.parameterTypes,
      functionReturnTypes: this.functionReturnTypes,
    };
  }

  private collectFunctions(program: Program): void {
    for (const declaration of program.declarations) {
      if (declaration.kind !== "FunctionDeclaration") continue;
      if (this.functions.has(declaration.name)) {
        this.error("COV4002", `function '${declaration.name}' is already declared`, declaration.span);
        continue;
      }
      if (declaration.name === "print" || declaration.name === "move") this.error("COV4027", `function name '${declaration.name}' is reserved for a Cove built-in`, declaration.span);
      const parameterTypes = declaration.parameters.map((parameter) => this.resolveType(parameter.type, "Unknown"));
      const varargIndices = declaration.parameters.map((parameter, index) => parameter.vararg ? index : -1).filter((index) => index >= 0);
      if (varargIndices.length > 1) this.error("COV4031", `function '${declaration.name}' may declare only one vararg parameter`, declaration.span);
      if (varargIndices.length && varargIndices[0] !== declaration.parameters.length - 1) this.error("COV4032", "vararg parameter must be the final parameter", declaration.parameters[varargIndices[0]!]!.span);
      const info: FunctionInfo = {
        declaration,
        parameters: parameterTypes,
        varargIndex: varargIndices[0] ?? -1,
        returnType: declaration.name === "main" ? "Int" : declaration.returnType ? this.resolveType(declaration.returnType, "Unknown") : "Unknown",
      };
      this.functions.set(declaration.name, info);
    }
    if (!this.functions.has("main")) this.error("COV4003", "executable program must define fun main()", program.span);
    const main = this.functions.get("main");
    if (main && main.parameters.length !== 0) this.error("COV4004", "main() must not declare parameters in this backend", main.declaration.span);
    if (main?.declaration.returnType) {
      const declaredMainReturn = this.resolveType(main.declaration.returnType, "Unknown");
      if (declaredMainReturn !== "Int") this.error("COV4028", "main() must return Int when a return type is specified", main.declaration.returnType.span);
    }
  }

  private inferFunctionReturns(): void {
    // Iterate so simple inferred functions can call other inferred functions declared later.
    for (let pass = 0; pass < this.functions.size + 1; pass++) {
      let changed = false;
      for (const info of this.functions.values()) {
        if (info.returnType !== "Unknown") continue;
        const inferred = this.inferFinalReturn(info.declaration);
        if (inferred !== "Unknown") { info.returnType = inferred; changed = true; }
      }
      if (!changed) break;
    }
  }

  private inferFinalReturn(fn: FunctionDeclaration): TypeName {
    const last = fn.body.statements.at(-1);
    if (!last) return "Void";
    if (last.kind === "ReturnStatement") return last.value ? this.inferExpressionWithParameters(last.value, fn) : "Void";
    if (last.kind === "ExpressionStatement") return this.inferExpressionWithParameters(last.expression, fn);
    return "Void";
  }

  private inferExpressionWithParameters(expression: Expression, fn: FunctionDeclaration): TypeName {
    this.scopes.push(new Map());
    for (const parameter of fn.parameters) this.scopes[0]!.set(parameter.name, this.resolveType(parameter.type, "Unknown"));
    const result = this.expressionType(expression);
    this.scopes.pop();
    return result;
  }

  private checkFunction(fn: FunctionDeclaration): void {
    const info = this.functions.get(fn.name);
    if (!info) return;
    this.currentFunction = info;
    this.scopes.length = 0;
    this.scopes.push(new Map());
    for (let i = 0; i < fn.parameters.length; i++) {
      const parameter = fn.parameters[i]!;
      if (this.scopes[0]!.has(parameter.name)) this.error("COV4005", `duplicate parameter '${parameter.name}'`, parameter.span);
      this.scopes[0]!.set(parameter.name, info.parameters[i] ?? "Unknown");
      this.parameterTypes.set(parameter, info.parameters[i] ?? "Unknown");
      if (!parameter.type) this.error("COV4006", `parameter '${parameter.name}' needs an explicit type`, parameter.span);
    }
    this.checkBlockContents(fn.body, false);
    const last = fn.body.statements.at(-1);
    if (fn.name !== "main" && last?.kind === "ExpressionStatement" && info.returnType !== "Void") {
      const actual = this.expressionType(last.expression);
      this.requireAssignable(info.returnType, actual, last.expression.span, "function result");
    }
    this.scopes.length = 0;
    this.currentFunction = undefined;
  }

  private checkBlockContents(block: BlockStatement, createScope = true): void {
    if (createScope) this.scopes.push(new Map());
    for (const statement of block.statements) this.checkStatement(statement);
    if (createScope) this.scopes.pop();
  }

  private checkStatement(statement: Statement): void {
    switch (statement.kind) {
      case "BlockStatement": this.checkBlockContents(statement); break;
      case "VariableDeclaration": this.checkVariable(statement); break;
      case "ExpressionStatement": this.expressionType(statement.expression); break;
      case "ReturnStatement": {
        const expected = this.currentFunction?.returnType ?? "Unknown";
        const actual = statement.value ? this.expressionType(statement.value) : "Void";
        if (expected === "Void" && actual !== "Void") this.error("COV4007", "a void function cannot return a value", statement.span);
        else if (expected !== "Unknown") this.requireAssignable(expected, actual, statement.span, "return value");
        break;
      }
      case "IfStatement": {
        const condition = this.expressionType(statement.condition);
        if (condition !== "Bool" && condition !== "Unknown") this.error("COV4008", `if condition must be Bool, not ${condition}`, statement.condition.span);
        this.checkStatement(statement.thenBranch);
        if (statement.elseBranch) this.checkStatement(statement.elseBranch);
        break;
      }
      case "WhileStatement": {
        const condition = this.expressionType(statement.condition);
        if (condition !== "Bool" && condition !== "Unknown") this.error("COV4009", `while condition must be Bool, not ${condition}`, statement.condition.span);
        this.checkStatement(statement.body);
        break;
      }
      case "ForEachStatement": {
        const iterable = this.expressionType(statement.iterable);
        const element = this.arrayElementType(iterable);
        if (!element && iterable !== "Unknown") this.error("COV4033", `cannot iterate over ${iterable}; expected an Array<T>`, statement.iterable.span);
        this.scopes.push(new Map([[statement.variable, element ?? "Unknown"]]));
        this.checkStatement(statement.body);
        this.scopes.pop();
        break;
      }
    }
  }

  private checkVariable(node: VariableDeclaration): void {
    const scope = this.scopes.at(-1)!;
    if (scope.has(node.name)) this.error("COV4010", `variable '${node.name}' is already declared in this scope`, node.span);
    const declared = node.type ? this.resolveType(node.type, "Unknown") : "Unknown";
    let actual = node.initializer ? this.expressionType(node.initializer) : "Unknown";
    if (!node.type && node.initializer?.kind === "ArrayLiteralExpression" && node.initializer.elements.length === 0) {
      this.error("COV4044", "an empty array literal needs an explicit Array<T> type", node.initializer.span);
    }
    if (node.type && node.initializer?.kind === "ArrayLiteralExpression" && node.initializer.elements.length === 0) {
      const expectedElement = this.arrayElementType(declared);
      if (expectedElement) {
        actual = declared;
        this.expressionTypes.set(node.initializer, declared);
      }
    }
    if (!node.type && !node.initializer) this.error("COV4011", `variable '${node.name}' needs a type or an initializer`, node.span);
    if (node.type && node.initializer) this.requireAssignable(declared, actual, node.initializer.span, `initializer for '${node.name}'`);
    const resolved = node.type ? declared : actual;
    scope.set(node.name, resolved);
    this.variableTypes.set(node, resolved);
  }

  private expressionType(expression: Expression): TypeName {
    let result: TypeName;
    switch (expression.kind) {
      case "LiteralExpression":
        result = expression.literalType ?? (typeof expression.value === "string" ? "String"
          : typeof expression.value === "boolean" ? "Bool"
          : typeof expression.value === "number" ? (Number.isInteger(expression.value) ? "Int" : "Double")
          : "Null");
        break;
      case "IdentifierExpression": {
        let found: TypeName | undefined;
        for (let i = this.scopes.length - 1; i >= 0; i--) {
          found = this.scopes[i]!.get(expression.name);
          if (found) break;
        }
        if (!found) this.error("COV4012", `undefined variable '${expression.name}'`, expression.span);
        result = found ?? "Unknown";
        break;
      }
      case "GroupExpression": result = this.expressionType(expression.expression); break;
      case "UnaryExpression": {
        const operand = this.expressionType(expression.operand);
        if (expression.operator === "&" || expression.operator === "&mut") {
          result = operand; // References are statically checked and erased by the current C backend.
        } else if (expression.operator === "!") {
          if (operand !== "Bool" && operand !== "Unknown") this.error("COV4013", `operator '!' requires Bool, not ${operand}`, expression.span);
          result = "Bool";
        } else {
          if (!this.isNumeric(operand) && operand !== "Unknown") this.error("COV4014", `unary '${expression.operator}' requires a numeric value`, expression.span);
          result = operand;
        }
        break;
      }
      case "BinaryExpression": result = this.binaryType(expression); break;
      case "AssignmentExpression": result = this.assignmentType(expression); break;
      case "CallExpression": result = this.callType(expression); break;
      case "ArrayLiteralExpression": {
        const elementTypes = expression.elements.map((element) => this.expressionType(element));
        const elementType = elementTypes[0] ?? "Unknown";
        for (let i = 1; i < elementTypes.length; i++) this.requireAssignable(elementType, elementTypes[i]!, expression.elements[i]!.span, "array element");
        result = `Array<${elementType}>`;
        break;
      }
      case "MemberAccessExpression": {
        const target = this.expressionType(expression.target);
        if (expression.member === "length" && this.arrayElementType(target)) result = "Int";
        else {
          this.error("COV4040", `unknown member '${expression.member}' on ${target}`, expression.span);
          result = "Unknown";
        }
        break;
      }
      case "IndexExpression": {
        const target = this.expressionType(expression.target);
        const index = this.expressionType(expression.index);
        if (index !== "Int" && index !== "Unknown") this.error("COV4034", `array index must be Int, not ${index}`, expression.index.span);
        const element = this.arrayElementType(target);
        if (!element && target !== "Unknown") this.error("COV4035", `cannot index ${target}; expected an Array<T>`, expression.target.span);
        result = element ?? "Unknown";
        break;
      }
    }
    this.expressionTypes.set(expression, result);
    return result;
  }

  private binaryType(expression: BinaryExpression): TypeName {
    const left = this.expressionType(expression.left);
    const right = this.expressionType(expression.right);
    const op = expression.operator;
    if (["==", "!=", "<", "<=", ">", ">="].includes(op)) {
      if (!this.compatible(left, right) && left !== "Unknown" && right !== "Unknown") this.error("COV4015", `cannot compare ${left} with ${right}`, expression.span);
      return "Bool";
    }
    if (op === "&&" || op === "||") {
      if (left !== "Bool" && left !== "Unknown") this.error("COV4016", `left operand of '${op}' must be Bool`, expression.left.span);
      if (right !== "Bool" && right !== "Unknown") this.error("COV4017", `right operand of '${op}' must be Bool`, expression.right.span);
      return "Bool";
    }
    if (op === "+" && (left === "String" || right === "String")) {
      if (left !== "String" || right !== "String") this.error("COV4018", "string concatenation requires two String operands", expression.span);
      return "String";
    }
    if ((!this.isNumeric(left) || !this.isNumeric(right)) && left !== "Unknown" && right !== "Unknown") {
      this.error("COV4019", `operator '${op}' requires numeric operands`, expression.span);
      return "Unknown";
    }
    return this.numericResult(left, right);
  }

  private assignmentType(expression: AssignmentExpression): TypeName {
    const target = expression.target;
    const valueType = this.expressionType(expression.value);
    if (target.kind === "IndexExpression") {
      if (target.target.kind !== "IdentifierExpression") this.error("COV4043", "indexed assignment currently requires a named mutable array variable", target.target.span);
      const targetType = this.expressionType(target.target);
      const indexType = this.expressionType(target.index);
      if (indexType !== "Int" && indexType !== "Unknown") this.error("COV4034", `array index must be Int, not ${indexType}`, target.index.span);
      const elementType = this.arrayElementType(targetType);
      if (!elementType && targetType !== "Unknown") this.error("COV4035", `cannot index ${targetType}; expected an Array<T>`, target.target.span);
      if (elementType) this.requireAssignable(elementType, valueType, expression.value.span, "array element assignment");
      if (expression.operator === "+=" && elementType && (!this.isNumeric(elementType) || !this.isNumeric(valueType))) this.error("COV4036", "'+=' currently requires numeric operands", expression.span);
      return elementType ?? "Unknown";
    }
    if (target.kind !== "IdentifierExpression") return "Unknown";
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const scope = this.scopes[i]!;
      if (scope.has(target.name)) {
        const targetType = scope.get(target.name)!;
        this.requireAssignable(targetType, valueType, expression.value.span, `assignment to '${target.name}'`);
        if (expression.operator === "+=" && (!this.isNumeric(targetType) || !this.isNumeric(valueType))) this.error("COV4036", "'+=' currently requires numeric operands", expression.span);
        return targetType;
      }
    }
    this.error("COV4012", `undefined variable '${target.name}'`, target.span);
    return "Unknown";
  }

  private callType(expression: CallExpression): TypeName {
    if (expression.callee.kind === "MemberAccessExpression") {
      const member = expression.callee;
      const receiverType = this.expressionType(member.target);
      const elementType = this.arrayElementType(receiverType);
      if (member.member === "push" && elementType) {
        if (member.target.kind !== "IdentifierExpression") this.error("COV4042", "Array.push() currently requires a named mutable array variable", member.target.span);
        if (expression.arguments.length !== 1) this.error("COV4041", "Array.push() expects exactly one argument", expression.span);
        for (const argument of expression.arguments) this.requireAssignable(elementType, this.expressionType(argument), argument.span, "Array.push() value");
        return "Void";
      }
      this.error("COV4040", `unknown array method '${member.member}'`, member.span);
      for (const argument of expression.arguments) this.expressionType(argument);
      return "Unknown";
    }
    if (expression.callee.kind !== "IdentifierExpression") {
      this.error("COV4020", "only named functions can be called in this compiler milestone", expression.callee.span);
      for (const argument of expression.arguments) this.expressionType(argument);
      return "Unknown";
    }
    const name = expression.callee.name;
    if (name === "move") {
      if (expression.arguments.length !== 1) this.error("COV4029", "move() expects exactly one argument", expression.span);
      const argumentTypes = expression.arguments.map((argument) => this.expressionType(argument));
      if (expression.arguments[0]?.kind !== "IdentifierExpression") this.error("COV4030", "move() currently requires a variable name", expression.span);
      return argumentTypes[0] ?? "Unknown";
    }
    if (name === "print") {
      if (expression.arguments.length !== 1) this.error("COV4021", "print() expects exactly one argument", expression.span);
      for (const argument of expression.arguments) {
        const type = this.expressionType(argument);
        if (!["String", "Int", "Float", "Double", "Bool", "Unknown"].includes(type)) this.error("COV4022", `print() cannot print ${type}`, argument.span);
      }
      return "Void";
    }
    const fn = this.functions.get(name);
    if (!fn) {
      this.error("COV4023", `undefined function '${name}'`, expression.callee.span);
      for (const argument of expression.arguments) this.expressionType(argument);
      return "Unknown";
    }
    const fixedCount = fn.varargIndex >= 0 ? fn.varargIndex : fn.parameters.length;
    if (fn.varargIndex < 0 && expression.arguments.length !== fn.parameters.length) this.error("COV4024", `function '${name}' expects ${fn.parameters.length} argument(s), but got ${expression.arguments.length}`, expression.span);
    if (fn.varargIndex >= 0 && expression.arguments.length < fixedCount) this.error("COV4024", `function '${name}' expects at least ${fixedCount} argument(s), but got ${expression.arguments.length}`, expression.span);
    for (let i = 0; i < expression.arguments.length; i++) {
      const actual = this.expressionType(expression.arguments[i]!);
      const expected = i >= fixedCount && fn.varargIndex >= 0
        ? this.arrayElementType(fn.parameters[fn.varargIndex]!) ?? "Unknown"
        : fn.parameters[i];
      if (expected !== undefined) this.requireAssignable(expected, actual, expression.arguments[i]!.span, `argument ${i + 1} of '${name}'`);
    }
    return fn.returnType;
  }

  private resolveType(node: TypeNode | undefined, fallback: TypeName): TypeName {
    if (!node) return fallback;
    if (node.name === "vararg") {
      if (!node.arguments || node.arguments.length !== 1) {
        this.error("COV4037", "vararg type must have exactly one element type, e.g. vararg<Int>", node.span);
        return "Array<Unknown>";
      }
      return `Array<${this.resolveType(node.arguments[0], "Unknown")}>`;
    }
    if (node.name === "Array") {
      if (!node.arguments || node.arguments.length !== 1) {
        this.error("COV4038", "Array<T> requires exactly one type argument", node.span);
        return "Array<Unknown>";
      }
      return `Array<${this.resolveType(node.arguments[0], "Unknown")}>`;
    }
    const type = BUILTINS.get(node.name.toLowerCase());
    if (!type) {
      this.error("COV4025", `unknown type '${node.name}'`, node.span, "User-defined and C interop types will be added in a later milestone.");
      return "Unknown";
    }
    return node.arrayDepth ? `Array<${type}>` : type;
  }

  private arrayElementType(type: TypeName): TypeName | undefined {
    const match = /^Array<(.+)>$/.exec(type);
    return match?.[1];
  }

  private requireAssignable(expected: TypeName, actual: TypeName, span: SourceSpan, context: string): void {
    if (expected === "Unknown" || actual === "Unknown" || this.compatible(expected, actual)) return;
    this.error("COV4026", `${context} expects ${expected}, but got ${actual}`, span);
  }

  private compatible(expected: TypeName, actual: TypeName): boolean {
    if (expected === actual) return true;
    return (expected === "Double" || expected === "Float") && actual === "Int";
  }
  private isNumeric(type: TypeName): boolean { return ["Int", "Float", "Double"].includes(type); }
  private numericResult(left: TypeName, right: TypeName): TypeName {
    if (left === "Double" || right === "Double") return "Double";
    if (left === "Float" || right === "Float") return "Float";
    return left === "Unknown" || right === "Unknown" ? "Unknown" : "Int";
  }
  private error(code: string, message: string, span: SourceSpan, help?: string): void {
    this.diagnostics.error(code, message, this.file, span, help);
  }
}
