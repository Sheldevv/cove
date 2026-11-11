import type { SourceSpan } from "../diagnostics/source.js";

export interface Program { readonly kind: "Program"; readonly declarations: Declaration[]; readonly span: SourceSpan; }
export type Declaration = FunctionDeclaration | Statement;
export interface FunctionDeclaration { readonly kind: "FunctionDeclaration"; readonly name: string; readonly parameters: Parameter[]; readonly returnType?: TypeNode; readonly body: BlockStatement; readonly span: SourceSpan; }
export interface Parameter { readonly name: string; readonly type?: TypeNode; readonly vararg?: boolean; readonly span: SourceSpan; }
export interface TypeNode { readonly name: string; readonly arguments?: TypeNode[]; readonly arrayDepth?: number; readonly span: SourceSpan; }
export type Statement = VariableDeclaration | ReturnStatement | ExpressionStatement | BlockStatement | IfStatement | WhileStatement | ForEachStatement;
export interface VariableDeclaration { readonly kind: "VariableDeclaration"; readonly name: string; readonly type?: TypeNode; readonly initializer?: Expression; readonly span: SourceSpan; }
export interface ReturnStatement { readonly kind: "ReturnStatement"; readonly value?: Expression; readonly span: SourceSpan; }
export interface ExpressionStatement { readonly kind: "ExpressionStatement"; readonly expression: Expression; readonly span: SourceSpan; }
export interface BlockStatement { readonly kind: "BlockStatement"; readonly statements: Statement[]; readonly span: SourceSpan; }
export interface IfStatement { readonly kind: "IfStatement"; readonly condition: Expression; readonly thenBranch: Statement; readonly elseBranch?: Statement; readonly span: SourceSpan; }
export interface WhileStatement { readonly kind: "WhileStatement"; readonly condition: Expression; readonly body: Statement; readonly span: SourceSpan; }
export interface ForEachStatement { readonly kind: "ForEachStatement"; readonly variable: string; readonly iterable: Expression; readonly body: Statement; readonly span: SourceSpan; }
export type Expression = LiteralExpression | IdentifierExpression | UnaryExpression | BinaryExpression | CallExpression | GroupExpression | AssignmentExpression | ArrayLiteralExpression | IndexExpression;
export interface LiteralExpression { readonly kind: "LiteralExpression"; readonly value: string | number | boolean | null; readonly literalType?: "Float" | "Double"; readonly span: SourceSpan; }
export interface IdentifierExpression { readonly kind: "IdentifierExpression"; readonly name: string; readonly span: SourceSpan; }
export interface UnaryExpression { readonly kind: "UnaryExpression"; readonly operator: string; readonly operand: Expression; readonly span: SourceSpan; }
export interface BinaryExpression { readonly kind: "BinaryExpression"; readonly left: Expression; readonly operator: string; readonly right: Expression; readonly span: SourceSpan; }
export interface CallExpression { readonly kind: "CallExpression"; readonly callee: Expression; readonly arguments: Expression[]; readonly span: SourceSpan; }
export interface GroupExpression { readonly kind: "GroupExpression"; readonly expression: Expression; readonly span: SourceSpan; }
export interface AssignmentExpression { readonly kind: "AssignmentExpression"; readonly target: Expression; readonly value: Expression; readonly operator?: string; readonly span: SourceSpan; }
export interface ArrayLiteralExpression { readonly kind: "ArrayLiteralExpression"; readonly elements: Expression[]; readonly span: SourceSpan; }
export interface IndexExpression { readonly kind: "IndexExpression"; readonly target: Expression; readonly index: Expression; readonly span: SourceSpan; }
