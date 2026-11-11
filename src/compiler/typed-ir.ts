import type {
  Expression, FunctionDeclaration, Parameter, Program, VariableDeclaration,
} from "../parser/ast.js";

/** Canonical built-in types understood by the first Cove typed-IR backend. */
export type CoveType = string;

/**
 * TypedProgram is Cove's first typed intermediate representation.
 * It keeps source AST nodes as stable identities while attaching the results
 * of name resolution and type checking in side tables. Later IR milestones
 * can replace these source-node references with lowered, backend-neutral nodes.
 */
export interface TypedProgram {
  readonly kind: "TypedProgram";
  readonly ast: Program;
  readonly expressionTypes: ReadonlyMap<Expression, CoveType>;
  readonly variableTypes: ReadonlyMap<VariableDeclaration, CoveType>;
  readonly parameterTypes: ReadonlyMap<Parameter, CoveType>;
  readonly functionReturnTypes: ReadonlyMap<FunctionDeclaration, CoveType>;
}

export function isNumericType(type: CoveType): boolean {
  return type === "Int" || type === "Float" || type === "Double";
}

/** Produces a stable, human-readable dump of the current typed IR. */
export function formatTypedProgram(typed: TypedProgram): string {
  const lines = ["TypedProgram"];
  const typeOf = (expression: Expression): CoveType => typed.expressionTypes.get(expression) ?? "Unknown";
  const functionReturns = new Map(typed.ast.declarations
    .filter((declaration): declaration is FunctionDeclaration => declaration.kind === "FunctionDeclaration")
    .map((declaration) => [declaration.name, typed.functionReturnTypes.get(declaration) ?? "Unknown"]));
  const formatExpression = (expression: Expression): string => {
    switch (expression.kind) {
      case "LiteralExpression": return `Literal<${typeOf(expression)}>(${JSON.stringify(expression.value)})`;
      case "IdentifierExpression": {
        if (expression.name === "print") return "BuiltinFunction(print)";
        const functionType = functionReturns.get(expression.name);
        return functionType ? `FunctionRef<${functionType}>(${expression.name})` : `Local<${typeOf(expression)}>(${expression.name})`;
      }
      case "GroupExpression": return `Group<${typeOf(expression)}>(${formatExpression(expression.expression)})`;
      case "UnaryExpression": return `Unary<${typeOf(expression)}>(${expression.operator} ${formatExpression(expression.operand)})`;
      case "BinaryExpression": return `Binary<${typeOf(expression)}>(${formatExpression(expression.left)} ${expression.operator} ${formatExpression(expression.right)})`;
      case "AssignmentExpression": return `Assign<${typeOf(expression)}>(${formatExpression(expression.target)} ${expression.operator ?? "="} ${formatExpression(expression.value)})`;
      case "ArrayLiteralExpression": return `Array<${typeOf(expression.elements[0] ?? expression)}>(${expression.elements.map(formatExpression).join(", ")})`;
      case "IndexExpression": return `Index<${typeOf(expression)}>(${formatExpression(expression.target)}, ${formatExpression(expression.index)})`;
      case "CallExpression":
        return `Call<${typeOf(expression)}>(${formatExpression(expression.callee)}${expression.arguments.length ? `, ${expression.arguments.map(formatExpression).join(", ")}` : ""})`;
    }
  };
  const emitStatement = (statement: import("../parser/ast.js").Statement, depth: number): void => {
    const indent = "  ".repeat(depth);
    switch (statement.kind) {
      case "BlockStatement":
        lines.push(`${indent}Block`);
        for (const child of statement.statements) emitStatement(child, depth + 1);
        break;
      case "VariableDeclaration": {
        const type = typed.variableTypes.get(statement) ?? "Unknown";
        lines.push(`${indent}Variable<${type}> ${statement.name}${statement.initializer ? ` = ${formatExpression(statement.initializer)}` : ""}`);
        break;
      }
      case "ReturnStatement":
        lines.push(`${indent}Return${statement.value ? ` ${formatExpression(statement.value)}` : ""}`);
        break;
      case "ExpressionStatement": lines.push(`${indent}Evaluate ${formatExpression(statement.expression)}`); break;
      case "IfStatement":
        lines.push(`${indent}If ${formatExpression(statement.condition)}`);
        emitStatement(statement.thenBranch, depth + 1);
        if (statement.elseBranch) { lines.push(`${indent}Else`); emitStatement(statement.elseBranch, depth + 1); }
        break;
      case "WhileStatement":
        lines.push(`${indent}While ${formatExpression(statement.condition)}`);
        emitStatement(statement.body, depth + 1);
        break;
      case "ForEachStatement":
        lines.push(`${indent}ForEach ${statement.variable} in ${formatExpression(statement.iterable)}`);
        emitStatement(statement.body, depth + 1);
        break;
    }
  };

  for (const declaration of typed.ast.declarations) {
    if (declaration.kind !== "FunctionDeclaration") continue;
    const returnType = typed.functionReturnTypes.get(declaration) ?? "Unknown";
    const parameters = declaration.parameters.map((parameter) => `${parameter.name}: ${parameter.vararg ? "vararg<" : ""}${typed.parameterTypes.get(parameter) ?? "Unknown"}${parameter.vararg ? ">" : ""}`).join(", ");
    lines.push(`  Function ${declaration.name}(${parameters}) -> ${returnType}`);
    for (const statement of declaration.body.statements) emitStatement(statement, 2);
  }
  return `${lines.join("\n")}\n`;
}
