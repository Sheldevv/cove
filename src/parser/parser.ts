import type { DiagnosticBag } from "../diagnostics/diagnostic.js";
import type { SourceFile, SourceSpan } from "../diagnostics/source.js";
import { spanFromOffsets } from "../diagnostics/source.js";
import { TokenKind } from "../lexer/token-kind.js";
import type { Token } from "../lexer/token.js";
import type { AssignmentExpression, ArrayLiteralExpression, BinaryExpression, BlockStatement, CallExpression, Declaration, Expression, FunctionDeclaration, IfStatement, IndexExpression, Parameter, Program, ReturnStatement, Statement, TypeNode, UnaryExpression, VariableDeclaration, WhileStatement, ForEachStatement } from "./ast.js";

export class Parser {
  private current = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly file: SourceFile,
    private readonly diagnostics: DiagnosticBag,
  ) {}

  parse(): Program {
    const declarations: Declaration[] = [];
    while (!this.check(TokenKind.EOF)) {
      const before = this.current;
      declarations.push(this.declaration());
      if (this.current === before) this.advance();
    }
    return { kind: "Program", declarations, span: spanFromOffsets(this.file.text, 0, this.file.text.length) };
  }

  private declaration(): Declaration {
    if (this.match(TokenKind.Fun)) return this.functionDeclaration(this.previous());
    // C-style function definition: `int main(void) { ... }` or `void greet(int value) { ... }`.
    if (this.check(TokenKind.Identifier) && this.checkAt(1, TokenKind.Identifier) && this.checkAt(2, TokenKind.LeftParen)) {
      const returnType = this.advance();
      return this.cFunctionDeclaration(returnType);
    }
    return this.statement();
  }

  private functionDeclaration(start: Token): FunctionDeclaration {
    const name = this.consume(TokenKind.Identifier, "expected function name");
    this.consume(TokenKind.LeftParen, "expected '(' after function name");
    const parameters: Parameter[] = [];
    if (!this.check(TokenKind.RightParen)) {
      do {
        const first = this.consume(TokenKind.Identifier, "expected parameter name or type");
        let parameterName = first;
        let type: TypeNode | undefined;
        if (this.match(TokenKind.Colon)) type = this.typeNode();
        else if (this.check(TokenKind.Identifier)) {
          // Also accept C-style parameter declarations inside `fun` functions.
          type = { name: first.lexeme, span: first.span };
          parameterName = this.advance();
        }
        parameters.push({ name: parameterName.lexeme, ...(type ? { type } : {}), ...(type?.name === "vararg" ? { vararg: true } : {}), span: parameterName.span });
      } while (this.match(TokenKind.Comma));
    }
    this.consume(TokenKind.RightParen, "expected ')' after parameters");
    const returnType = this.match(TokenKind.Colon) ? this.typeNode() : undefined;
    const body = this.block();
    return { kind: "FunctionDeclaration", name: name.lexeme, parameters, ...(returnType ? { returnType } : {}), body, span: this.join(start.span, body.span) };
  }

  private cFunctionDeclaration(returnTypeToken: Token): FunctionDeclaration {
    const name = this.consume(TokenKind.Identifier, "expected function name after return type");
    this.consume(TokenKind.LeftParen, "expected '(' after function name");
    const parameters: Parameter[] = [];
    if (!this.check(TokenKind.RightParen) && !(this.check(TokenKind.Identifier) && this.peek().lexeme === "void" && this.checkAt(1, TokenKind.RightParen))) {
      do {
        const typeToken = this.consume(TokenKind.Identifier, "expected parameter type");
        const parameterName = this.consume(TokenKind.Identifier, "expected parameter name after type");
        parameters.push({ name: parameterName.lexeme, type: { name: typeToken.lexeme, span: typeToken.span }, span: parameterName.span });
      } while (this.match(TokenKind.Comma));
    } else if (this.check(TokenKind.Identifier) && this.peek().lexeme === "void") {
      this.advance(); // C's `(void)` means no parameters.
    }
    this.consume(TokenKind.RightParen, "expected ')' after parameters");
    const body = this.block();
    return {
      kind: "FunctionDeclaration", name: name.lexeme, parameters,
      returnType: { name: returnTypeToken.lexeme, span: returnTypeToken.span },
      body, span: this.join(returnTypeToken.span, body.span),
    };
  }

  private statement(): Statement {
    if (this.match(TokenKind.Let)) return this.variableDeclaration(this.previous());
    if (this.match(TokenKind.Return)) return this.returnStatement(this.previous());
    if (this.match(TokenKind.If)) return this.ifStatement(this.previous());
    if (this.match(TokenKind.While)) return this.whileStatement(this.previous());
    if (this.check(TokenKind.LeftBrace)) return this.block();
    const expression = this.expression();
    if (this.match(TokenKind.For)) {
      const variable = this.consume(TokenKind.Identifier, "expected iteration variable after 'for'");
      this.consume(TokenKind.In, "expected 'in' after iteration variable");
      const iterable = this.expression();
      this.match(TokenKind.Semicolon);
      const body: Statement = { kind: "ExpressionStatement", expression, span: expression.span };
      const node: ForEachStatement = { kind: "ForEachStatement", variable: variable.lexeme, iterable, body, span: this.join(expression.span, iterable.span) };
      return node;
    }
    this.match(TokenKind.Semicolon);
    return { kind: "ExpressionStatement", expression, span: expression.span };
  }

  private variableDeclaration(start: Token): VariableDeclaration {
    const name = this.consume(TokenKind.Identifier, "expected variable name after 'let'");
    const type = this.match(TokenKind.Colon) ? this.typeNode() : undefined;
    const initializer = this.match(TokenKind.Equal) ? this.expression() : undefined;
    this.match(TokenKind.Semicolon);
    return { kind: "VariableDeclaration", name: name.lexeme, ...(type ? { type } : {}), ...(initializer ? { initializer } : {}), span: this.join(start.span, initializer?.span ?? type?.span ?? name.span) };
  }

  private returnStatement(start: Token): ReturnStatement {
    const value = this.check(TokenKind.Semicolon) || this.check(TokenKind.RightBrace) ? undefined : this.expression();
    this.match(TokenKind.Semicolon);
    return { kind: "ReturnStatement", ...(value ? { value } : {}), span: this.join(start.span, value?.span ?? start.span) };
  }

  private ifStatement(start: Token): IfStatement {
    const condition = this.conditionExpression();
    const thenBranch = this.statement();
    const elseBranch = this.match(TokenKind.Else) ? this.statement() : undefined;
    return { kind: "IfStatement", condition, thenBranch, ...(elseBranch ? { elseBranch } : {}), span: this.join(start.span, (elseBranch ?? thenBranch).span) };
  }

  private whileStatement(start: Token): WhileStatement {
    const condition = this.conditionExpression();
    const body = this.statement();
    return { kind: "WhileStatement", condition, body, span: this.join(start.span, body.span) };
  }

  private conditionExpression(): Expression {
    if (this.match(TokenKind.LeftParen)) {
      const condition = this.expression();
      this.consume(TokenKind.RightParen, "expected ')' after condition");
      return condition;
    }
    return this.expression();
  }

  private block(): BlockStatement {
    const start = this.consume(TokenKind.LeftBrace, "expected '{'");
    const statements: Statement[] = [];
    while (!this.check(TokenKind.RightBrace) && !this.check(TokenKind.EOF)) {
      const before = this.current;
      statements.push(this.statement());
      if (before === this.current) this.advance();
    }
    const end = this.consume(TokenKind.RightBrace, "expected '}' after block");
    return { kind: "BlockStatement", statements, span: this.join(start.span, end.span) };
  }

  private typeNode(): TypeNode {
    const token = this.consume(TokenKind.Identifier, "expected type name");
    const args: TypeNode[] = [];
    let end = token.span;
    if (this.match(TokenKind.Less)) {
      do { args.push(this.typeNode()); } while (this.match(TokenKind.Comma));
      end = this.consume(TokenKind.Greater, "expected '>' after generic type arguments").span;
    }
    let arrayDepth = 0;
    while (this.match(TokenKind.LeftBracket)) {
      end = this.consume(TokenKind.RightBracket, "expected ']' in array type").span;
      arrayDepth++;
    }
    return { name: token.lexeme, ...(args.length ? { arguments: args } : {}), ...(arrayDepth ? { arrayDepth } : {}), span: this.join(token.span, end) };
  }

  private expression(): Expression { return this.assignment(); }

  private assignment(): Expression {
    const left = this.or();
    if (this.match(TokenKind.Equal, TokenKind.PlusEqual)) {
      const equals = this.previous();
      const value = this.assignment();
      if (left.kind === "IdentifierExpression") {
        const node: AssignmentExpression = { kind: "AssignmentExpression", target: left, value, ...(equals.kind === TokenKind.PlusEqual ? { operator: "+=" } : {}), span: this.join(left.span, value.span) };
        return node;
      }
      this.error(equals, "invalid assignment target");
    }
    return left;
  }

  private or(): Expression { return this.binary(() => this.and(), [TokenKind.OrOr]); }
  private and(): Expression { return this.binary(() => this.equality(), [TokenKind.AndAnd]); }
  private equality(): Expression { return this.binary(() => this.comparison(), [TokenKind.EqualEqual, TokenKind.BangEqual]); }
  private comparison(): Expression { return this.binary(() => this.term(), [TokenKind.Less, TokenKind.LessEqual, TokenKind.Greater, TokenKind.GreaterEqual]); }
  private term(): Expression { return this.binary(() => this.factor(), [TokenKind.Plus, TokenKind.Minus]); }
  private factor(): Expression { return this.binary(() => this.unary(), [TokenKind.Star, TokenKind.Slash, TokenKind.Percent]); }

  private binary(next: () => Expression, operators: TokenKind[]): Expression {
    let expression = next();
    while (operators.some((operator) => this.check(operator))) {
      const operator = this.advance();
      const right = next();
      const node: BinaryExpression = { kind: "BinaryExpression", left: expression, operator: operator.lexeme, right, span: this.join(expression.span, right.span) };
      expression = node;
    }
    return expression;
  }

  private unary(): Expression {
    if (this.match(TokenKind.Bang, TokenKind.Minus, TokenKind.Plus, TokenKind.Ampersand)) {
      const operator = this.previous();
      const op = operator.kind === TokenKind.Ampersand && this.check(TokenKind.Identifier) && this.peek().lexeme === "mut" ? (this.advance(), "&mut") : operator.lexeme;
      const operand = this.unary();
      const node: UnaryExpression = { kind: "UnaryExpression", operator: op, operand, span: this.join(operator.span, operand.span) };
      return node;
    }
    return this.call();
  }

  private call(): Expression {
    let expression = this.primary();
    while (true) {
      if (this.match(TokenKind.LeftParen)) {
        const args: Expression[] = [];
        if (!this.check(TokenKind.RightParen)) {
          do { args.push(this.expression()); } while (this.match(TokenKind.Comma));
        }
        const close = this.consume(TokenKind.RightParen, "expected ')' after arguments");
        const node: CallExpression = { kind: "CallExpression", callee: expression, arguments: args, span: this.join(expression.span, close.span) };
        expression = node;
      } else if (this.match(TokenKind.LeftBracket)) {
        const index = this.expression();
        const close = this.consume(TokenKind.RightBracket, "expected ']' after index");
        const node: IndexExpression = { kind: "IndexExpression", target: expression, index, span: this.join(expression.span, close.span) };
        expression = node;
      } else break;
    }
    return expression;
  }

  private primary(): Expression {
    if (this.match(TokenKind.True)) return { kind: "LiteralExpression", value: true, span: this.previous().span };
    if (this.match(TokenKind.False)) return { kind: "LiteralExpression", value: false, span: this.previous().span };
    if (this.match(TokenKind.Null)) return { kind: "LiteralExpression", value: null, span: this.previous().span };
    if (this.match(TokenKind.Integer, TokenKind.Float, TokenKind.String)) {
      const token = this.previous();
      const literalType = token.numericSuffix?.toLowerCase() === "f" ? "Float" : token.kind === TokenKind.Float ? "Double" : undefined;
      return { kind: "LiteralExpression", value: token.value as string | number, ...(literalType ? { literalType } : {}), span: token.span };
    }
    if (this.match(TokenKind.LeftBracket)) {
      const start = this.previous();
      const elements: Expression[] = [];
      if (!this.check(TokenKind.RightBracket)) {
        do { elements.push(this.expression()); } while (this.match(TokenKind.Comma));
      }
      const close = this.consume(TokenKind.RightBracket, "expected ']' after array literal");
      const node: ArrayLiteralExpression = { kind: "ArrayLiteralExpression", elements, span: this.join(start.span, close.span) };
      return node;
    }
    if (this.match(TokenKind.Identifier)) {
      const token = this.previous();
      return { kind: "IdentifierExpression", name: token.lexeme, span: token.span };
    }
    if (this.match(TokenKind.LeftParen)) {
      const start = this.previous();
      const expression = this.expression();
      const end = this.consume(TokenKind.RightParen, "expected ')' after expression");
      return { kind: "GroupExpression", expression, span: this.join(start.span, end.span) };
    }
    const token = this.peek();
    this.error(token, "expected expression");
    if (!this.check(TokenKind.EOF)) this.advance();
    return { kind: "LiteralExpression", value: null, span: token.span };
  }

  private consume(kind: TokenKind, message: string): Token {
    if (this.check(kind)) return this.advance();
    const token = this.peek();
    this.error(token, message);
    return { kind, lexeme: "", span: token.span };
  }

  private match(...kinds: TokenKind[]): boolean {
    if (kinds.some((kind) => this.check(kind))) { this.advance(); return true; }
    return false;
  }
  private check(kind: TokenKind): boolean { return this.peek().kind === kind; }
  private checkAt(distance: number, kind: TokenKind): boolean { return (this.tokens[this.current + distance] ?? this.tokens[this.tokens.length - 1]!).kind === kind; }
  private advance(): Token { if (!this.check(TokenKind.EOF)) this.current += 1; return this.previous(); }
  private peek(): Token { return this.tokens[this.current] ?? this.tokens[this.tokens.length - 1]!; }
  private previous(): Token { return this.tokens[Math.max(0, this.current - 1)]!; }
  private error(token: Token, message: string): void { this.diagnostics.error("COV2001", message, this.file, token.span); }
  private join(first: SourceSpan, last: SourceSpan): SourceSpan { return { start: first.start, end: last.end }; }
}
