import type { DiagnosticBag } from "../diagnostics/diagnostic.js";
import type { SourceFile } from "../diagnostics/source.js";
import { spanFromOffsets } from "../diagnostics/source.js";
import { TokenKind } from "./token-kind.js";
import type { Token } from "./token.js";

const keywords = new Map<string, TokenKind>([
  ["let", TokenKind.Let], ["fun", TokenKind.Fun], ["return", TokenKind.Return],
  ["if", TokenKind.If], ["else", TokenKind.Else], ["true", TokenKind.True],
  ["false", TokenKind.False], ["null", TokenKind.Null], ["while", TokenKind.While],
  ["until", TokenKind.Until], ["loop", TokenKind.Loop], ["for", TokenKind.For],
  ["foreach", TokenKind.Foreach], ["in", TokenKind.In], ["break", TokenKind.Break],
  ["continue", TokenKind.Continue], ["unsafe", TokenKind.Unsafe],
]);

export class Lexer {
  private offset = 0;
  private readonly tokens: Token[] = [];

  constructor(
    private readonly file: SourceFile,
    private readonly diagnostics: DiagnosticBag,
  ) {}

  scan(): Token[] {
    while (!this.isAtEnd()) {
      this.skipTrivia();
      if (this.isAtEnd()) break;
      this.scanToken();
    }

    const end = this.file.text.length;
    this.tokens.push({ kind: TokenKind.EOF, lexeme: "", span: spanFromOffsets(this.file.text, end, end) });
    return this.tokens;
  }

  private scanToken(): void {
    const start = this.offset;
    const char = this.advance();

    if (this.isAlpha(char) || char === "_") {
      while (this.isAlphaNumeric(this.peek()) || this.peek() === "_") this.advance();
      const lexeme = this.file.text.slice(start, this.offset);
      const kind = keywords.get(lexeme) ?? TokenKind.Identifier;
      const value = kind === TokenKind.True ? true : kind === TokenKind.False ? false : undefined;
      this.add(kind, start, value);
      return;
    }

    if (this.isDigit(char)) {
      while (this.isDigit(this.peek())) this.advance();
      let kind = TokenKind.Integer;
      if (this.peek() === "." && this.peekNext() !== "." && this.isDigit(this.peekNext())) {
        kind = TokenKind.Float;
        this.advance();
        while (this.isDigit(this.peek())) this.advance();
      }
      let numericSuffix: string | undefined;
      if (kind === TokenKind.Float && /[fF]/.test(this.peek())) numericSuffix = this.advance();
      const lexeme = this.file.text.slice(start, this.offset);
      this.add(kind, start, Number(lexeme.slice(0, numericSuffix ? -1 : undefined)), numericSuffix);
      return;
    }

    if (char === '"') {
      while (!this.isAtEnd() && this.peek() !== '"') {
        if (this.peek() === "\\" && !this.isAtEndAfterOne()) this.advance();
        this.advance();
      }
      if (this.isAtEnd()) {
        this.report("COV1002", "unterminated string literal", start, this.offset);
        return;
      }
      this.advance();
      const lexeme = this.file.text.slice(start, this.offset);
      this.add(TokenKind.String, start, this.decodeString(lexeme.slice(1, -1)));
      return;
    }

    if (char === "+" && this.peek() === "=") { this.advance(); this.add(TokenKind.PlusEqual, start); return; }

    const pairs: Record<string, TokenKind> = {
      "(": TokenKind.LeftParen, ")": TokenKind.RightParen,
      "{": TokenKind.LeftBrace, "}": TokenKind.RightBrace,
      "[": TokenKind.LeftBracket, "]": TokenKind.RightBracket,
      ",": TokenKind.Comma, ":": TokenKind.Colon, ";": TokenKind.Semicolon,
      "+": TokenKind.Plus, "*": TokenKind.Star, "/": TokenKind.Slash,
      "%": TokenKind.Percent,
    };
    const simple = pairs[char];
    if (simple !== undefined) { this.add(simple, start); return; }

    const next = this.peek();
    if (char === "." && next === ".") {
      this.advance();
      if (this.peek() === "=") { this.advance(); this.add(TokenKind.RangeInclusive, start); }
      else this.add(TokenKind.Range, start);
      return;
    }

    if (char === ".") { this.add(TokenKind.Dot, start); return; }

    const compound: Record<string, [string, TokenKind, TokenKind]> = {
      "!": ["=", TokenKind.BangEqual, TokenKind.Bang],
      "=": ["=", TokenKind.EqualEqual, TokenKind.Equal],
      "<": ["=", TokenKind.LessEqual, TokenKind.Less],
      ">": ["=", TokenKind.GreaterEqual, TokenKind.Greater],
      "&": ["&", TokenKind.AndAnd, TokenKind.Ampersand],
      "|": ["|", TokenKind.OrOr, TokenKind.EOF],
      "-": [">", TokenKind.Arrow, TokenKind.Minus],
    };
    const compoundEntry = compound[char];
    if (compoundEntry !== undefined) {
      if (next === compoundEntry[0]) { this.advance(); this.add(compoundEntry[1], start); }
      else if (compoundEntry[2] !== TokenKind.EOF) this.add(compoundEntry[2], start);
      else this.report("COV1003", `unexpected character '${char}'`, start, this.offset);
      return;
    }

    this.report("COV1003", `unexpected character '${char}'`, start, this.offset);
  }

  private skipTrivia(): void {
    while (!this.isAtEnd()) {
      const char = this.peek();
      if (char === " " || char === "\r" || char === "\t" || char === "\n") { this.advance(); continue; }
      if (char === "/" && this.peekNext() === "/") {
        while (!this.isAtEnd() && this.peek() !== "\n") this.advance();
        continue;
      }
      if (char === "/" && this.peekNext() === "*") {
        const start = this.offset;
        this.advance(); this.advance();
        while (!this.isAtEnd() && !(this.peek() === "*" && this.peekNext() === "/")) this.advance();
        if (this.isAtEnd()) this.report("COV1004", "unterminated block comment", start, this.offset);
        else { this.advance(); this.advance(); }
        continue;
      }
      break;
    }
  }

  private decodeString(value: string): string {
    return value.replace(/\\([\\"nrt0])/g, (_match, escaped: string) => {
      const escapes: Record<string, string> = { "\\": "\\", '"': '"', n: "\n", r: "\r", t: "\t", "0": "\0" };
      return escapes[escaped] ?? escaped;
    });
  }

  private add(kind: TokenKind, start: number, value?: string | number | boolean | null, numericSuffix?: string): void {
    const token = {
      kind,
      lexeme: this.file.text.slice(start, this.offset),
      span: spanFromOffsets(this.file.text, start, this.offset),
      ...(value === undefined ? {} : { value }),
      ...(numericSuffix === undefined ? {} : { numericSuffix }),
    };
    this.tokens.push(token);
  }

  private report(code: string, message: string, start: number, end: number): void {
    this.diagnostics.error(code, message, this.file, spanFromOffsets(this.file.text, start, end));
  }

  private isAtEnd(): boolean { return this.offset >= this.file.text.length; }
  private isAtEndAfterOne(): boolean { return this.offset + 1 >= this.file.text.length; }
  private advance(): string { return this.file.text[this.offset++] ?? "\0"; }
  private peek(): string { return this.file.text[this.offset] ?? "\0"; }
  private peekNext(): string { return this.file.text[this.offset + 1] ?? "\0"; }
  private isDigit(char: string): boolean { return char >= "0" && char <= "9"; }
  private isAlpha(char: string): boolean { return (char >= "a" && char <= "z") || (char >= "A" && char <= "Z"); }
  private isAlphaNumeric(char: string): boolean { return this.isAlpha(char) || this.isDigit(char); }
}
