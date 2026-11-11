import type { SourceSpan } from "../diagnostics/source.js";
import type { CoveType, TypedProgram } from "./typed-ir.js";
import type { Expression, Statement, FunctionDeclaration } from "../parser/ast.js";

export type IRValue = { readonly id: number; readonly type: CoveType };
export type IROperand = { readonly kind: "value"; readonly value: IRValue } | { readonly kind: "int" | "float" | "string" | "bool" | "null"; readonly value: string | number | boolean | null; readonly type: CoveType };
export type IRInstruction =
  | { readonly op: "const"; readonly result: IRValue; readonly value: IROperand; readonly span: SourceSpan }
  | { readonly op: "binary"; readonly result: IRValue; readonly operator: string; readonly left: IROperand; readonly right: IROperand; readonly span: SourceSpan }
  | { readonly op: "unary"; readonly result: IRValue; readonly operator: string; readonly operand: IROperand; readonly span: SourceSpan }
  | { readonly op: "call"; readonly result?: IRValue; readonly callee: string; readonly args: readonly IROperand[]; readonly span: SourceSpan }
  | { readonly op: "array"; readonly result: IRValue; readonly elements: readonly IROperand[]; readonly span: SourceSpan }
  | { readonly op: "arrayview"; readonly result: IRValue; readonly elements: readonly IROperand[]; readonly span: SourceSpan }
  | { readonly op: "arrayset"; readonly slot: IRValue; readonly index: IROperand; readonly source: IROperand; readonly span: SourceSpan }
  | { readonly op: "arraypush"; readonly slot: IRValue; readonly source: IROperand; readonly span: SourceSpan }
  | { readonly op: "arrayreserve"; readonly slot: IRValue; readonly capacity: IROperand; readonly span: SourceSpan }
  | { readonly op: "arrayshrink"; readonly slot: IRValue; readonly span: SourceSpan }
  | { readonly op: "arrayclear"; readonly slot: IRValue; readonly span: SourceSpan }
  | { readonly op: "arraymove"; readonly result: IRValue; readonly slot: IRValue; readonly span: SourceSpan }
  | { readonly op: "arraydrop"; readonly slot: IRValue; readonly span: SourceSpan }
  | { readonly op: "index"; readonly result: IRValue; readonly array: IROperand; readonly index: IROperand; readonly boundsCheck: boolean; readonly span: SourceSpan }
  | { readonly op: "arraylen"; readonly result: IRValue; readonly array: IROperand; readonly span: SourceSpan }
  | { readonly op: "arraycap"; readonly result: IRValue; readonly array: IROperand; readonly span: SourceSpan }
  | { readonly op: "copy"; readonly result: IRValue; readonly source: IROperand; readonly span: SourceSpan }
  | { readonly op: "phi"; readonly result: IRValue; readonly incoming: readonly { readonly block: string; readonly value: IROperand }[]; readonly span: SourceSpan }
  | { readonly op: "alloca"; readonly result: IRValue; readonly span: SourceSpan }
  | { readonly op: "load"; readonly result: IRValue; readonly slot: IRValue; readonly span: SourceSpan }
  | { readonly op: "store"; readonly slot: IRValue; readonly source: IROperand; readonly span: SourceSpan }
  | { readonly op: "print"; readonly value: IROperand; readonly span: SourceSpan }
  | { readonly op: "return"; readonly value?: IROperand; readonly span: SourceSpan }
  | { readonly op: "branch"; readonly condition: IROperand; readonly thenBlock: string; readonly elseBlock: string; readonly span: SourceSpan }
  | { readonly op: "jump"; readonly target: string; readonly span: SourceSpan };
export interface IRBasicBlock { readonly name: string; readonly instructions: IRInstruction[]; }
export interface IRParameter { readonly name: string; readonly type: CoveType; readonly value: IRValue; readonly vararg?: boolean; }
export interface IRFunction { readonly name: string; readonly parameters: IRParameter[]; readonly returnType: CoveType; readonly blocks: IRBasicBlock[]; }
export interface IRModule { readonly kind: "IRModule"; readonly functions: IRFunction[]; }

/** Lowers the semantically checked AST into explicit values, instructions, and CFG blocks. */
export function lowerToIR(typed: TypedProgram): IRModule {
  const functions: IRFunction[] = [];
  for (const declaration of typed.ast.declarations) {
    if (declaration.kind !== "FunctionDeclaration") continue;
    const builder = new FunctionLowerer(typed, declaration);
    functions.push(builder.lower());
  }
  return { kind: "IRModule", functions };
}

class FunctionLowerer {
  private nextValue = 0;
  private nextBlock = 0;
  private readonly blocks: IRBasicBlock[] = [];
  private current!: IRBasicBlock;
  private readonly locals = new Map<string, IRValue>();
  private readonly localScopeChanges: { name: string; previous?: IRValue }[][] = [];
  private readonly arrayScopeSlots: IRValue[][] = [[]];
  private readonly directLocals = new Map<string, IRValue>();
  private readonly function: IRFunction;
  constructor(private readonly typed: TypedProgram, private readonly fn: FunctionDeclaration) {
    this.current = this.block("entry");
    const parameters = fn.parameters.map((p) => {
      const value = this.value(typed.parameterTypes.get(p) ?? "Unknown");
      const slot = this.value(value.type);
      this.locals.set(p.name, slot);
      if (/^Array<.+>$/.test(value.type)) this.arrayScopeSlots[0]!.push(slot);
      this.emit({ op: "alloca", result: slot, span: p.span });
      this.emit({ op: "store", slot, source: { kind: "value", value }, span: p.span });
      return { name: p.name, type: value.type, value, ...(p.vararg ? { vararg: true } : {}) };
    });
    this.function = { name: fn.name, parameters, returnType: typed.functionReturnTypes.get(fn) ?? "Unknown", blocks: this.blocks };
  }
  lower(): IRFunction {
    const statements = this.fn.body.statements;
    const last = statements.at(-1);
    const hasImplicitValue = this.fn.name !== "main" && this.function.returnType !== "Void" && last?.kind === "ExpressionStatement";
    this.lowerStatements(hasImplicitValue ? statements.slice(0, -1) : statements);
    if (!this.terminated()) {
      if (hasImplicitValue && last?.kind === "ExpressionStatement") {
        this.emit({ op: "return", value: this.expression(last.expression), span: last.span });
      } else if (this.fn.name === "main") this.emit({ op: "return", value: this.literal(0, "Int"), span: this.fn.span });
      else this.emit({ op: "return", span: this.fn.span });
    }
    return this.function;
  }
  private value(type: CoveType): IRValue { return { id: this.nextValue++, type }; }
  private block(prefix: string): IRBasicBlock { const b = { name: `${prefix.replace(/[^A-Za-z0-9_]/g, "_")}_${this.nextBlock++}`, instructions: [] as IRInstruction[] }; this.blocks.push(b); return b; }
  private emit(instruction: IRInstruction): void { this.current.instructions.push(instruction); }
  private terminated(): boolean { const op = this.current.instructions.at(-1)?.op; return op === "return" || op === "jump" || op === "branch"; }
  private literal(value: string | number | boolean | null, type: CoveType): IROperand { return { kind: value === null ? "null" : typeof value === "string" ? "string" : typeof value === "boolean" ? "bool" : Number.isInteger(value) ? "int" : "float", value, type }; }
  private lowerStatements(statements: readonly Statement[]): void { for (const statement of statements) { if (this.terminated()) break; this.lowerStatement(statement); } }
  private lowerStatement(s: Statement): void {
    switch (s.kind) {
      case "BlockStatement": {
        this.localScopeChanges.push([]);
        this.arrayScopeSlots.push([]);
        this.lowerStatements(s.statements);
        if (!this.terminated()) {
          for (const slot of this.arrayScopeSlots.at(-1)!) this.emit({ op: "arraydrop", slot, span: s.span });
        }
        const changes = this.localScopeChanges.pop()!;
        for (const change of changes.reverse()) {
          if (change.previous) this.locals.set(change.name, change.previous);
          else this.locals.delete(change.name);
        }
        this.arrayScopeSlots.pop();
        break;
      }
      case "VariableDeclaration": {
        const type = this.typed.variableTypes.get(s) ?? "Unknown";
        const slot = this.value(type);
        const previous = this.locals.get(s.name);
        this.localScopeChanges.at(-1)?.push({ name: s.name, ...(previous ? { previous } : {}) });
        this.locals.set(s.name, slot);
        if (/^Array<.+>$/.test(type)) this.arrayScopeSlots.at(-1)!.push(slot);
        this.emit({ op: "alloca", result: slot, span: s.span });
        if (s.initializer) this.emit({ op: "store", slot, source: this.expression(s.initializer), span: s.span });
        break;
      }
      case "ExpressionStatement": this.expression(s.expression); break;
      case "ReturnStatement": this.emit({ op: "return", ...(s.value ? { value: this.expression(s.value) } : {}), span: s.span }); break;
      case "IfStatement": {
        const condition = this.expression(s.condition); const thenB = this.block("if.then"); const elseB = this.block("if.else"); const mergeB = this.block("if.end");
        this.emit({ op: "branch", condition, thenBlock: thenB.name, elseBlock: elseB.name, span: s.span });
        this.current = thenB; this.lowerStatement(s.thenBranch); if (!this.terminated()) this.emit({ op: "jump", target: mergeB.name, span: s.span });
        this.current = elseB; if (s.elseBranch) this.lowerStatement(s.elseBranch); if (!this.terminated()) this.emit({ op: "jump", target: mergeB.name, span: s.span });
        this.current = mergeB; break;
      }
      case "WhileStatement": {
        const condB = this.block("while.cond"); const bodyB = this.block("while.body"); const endB = this.block("while.end");
        this.emit({ op: "jump", target: condB.name, span: s.span }); this.current = condB;
        const condition = this.expression(s.condition); this.emit({ op: "branch", condition, thenBlock: bodyB.name, elseBlock: endB.name, span: s.span });
        this.current = bodyB; this.lowerStatement(s.body); if (!this.terminated()) this.emit({ op: "jump", target: condB.name, span: s.span }); this.current = endB; break;
      }
      case "ForEachStatement": {
        const iterable = this.expression(s.iterable);
        const indexSlot = this.value("Int");
        this.emit({ op: "alloca", result: indexSlot, span: s.span });
        this.emit({ op: "store", slot: indexSlot, source: this.literal(0, "Int"), span: s.span });
        const condB = this.block("foreach.cond"), bodyB = this.block("foreach.body"), stepB = this.block("foreach.step"), endB = this.block("foreach.end");
        this.emit({ op: "jump", target: condB.name, span: s.span });
        this.current = condB;
        const indexValue = this.value("Int"); this.emit({ op: "load", result: indexValue, slot: indexSlot, span: s.span });
        const length = this.value("Int"); this.emit({ op: "arraylen", result: length, array: iterable, span: s.span });
        const condition = this.value("Bool"); this.emit({ op: "binary", result: condition, operator: "<", left: { kind: "value", value: indexValue }, right: { kind: "value", value: length }, span: s.span });
        this.emit({ op: "branch", condition: { kind: "value", value: condition }, thenBlock: bodyB.name, elseBlock: endB.name, span: s.span });
        this.current = bodyB;
        const elementType = this.typed.expressionTypes.get(s.iterable)?.match(/^Array<(.+)>$/)?.[1] ?? "Unknown";
        const element = this.value(elementType); this.emit({ op: "index", result: element, array: iterable, index: { kind: "value", value: indexValue }, boundsCheck: false, span: s.span });
        const previousIterator = this.directLocals.get(s.variable);
        this.directLocals.set(s.variable, element);
        this.lowerStatement(s.body);
        if (previousIterator) this.directLocals.set(s.variable, previousIterator); else this.directLocals.delete(s.variable);
        if (!this.terminated()) this.emit({ op: "jump", target: stepB.name, span: s.span });
        this.current = stepB;
        const oldIndex = this.value("Int"); this.emit({ op: "load", result: oldIndex, slot: indexSlot, span: s.span });
        const nextIndex = this.value("Int"); this.emit({ op: "binary", result: nextIndex, operator: "+", left: { kind: "value", value: oldIndex }, right: this.literal(1, "Int"), span: s.span });
        this.emit({ op: "store", slot: indexSlot, source: { kind: "value", value: nextIndex }, span: s.span }); this.emit({ op: "jump", target: condB.name, span: s.span });
        this.current = endB;
        break;
      }
    }
  }
  private expression(e: Expression): IROperand {
    const type = this.typed.expressionTypes.get(e) ?? "Unknown";
    switch (e.kind) {
      case "LiteralExpression": return this.literal(e.value, type);
      case "IdentifierExpression": {
        const direct = this.directLocals.get(e.name);
        if (direct) return { kind: "value", value: direct };
        const slot = this.locals.get(e.name);
        if (!slot) return { kind: "value", value: this.value(type) };
        const result = this.value(slot.type);
        this.emit({ op: "load", result, slot, span: e.span });
        return { kind: "value", value: result };
      }
      case "GroupExpression": return this.expression(e.expression);
      case "UnaryExpression": { const operand = this.expression(e.operand); if (e.operator === "&" || e.operator === "&mut") return operand; const result = this.value(type); this.emit({ op: "unary", result, operator: e.operator, operand, span: e.span }); return { kind: "value", value: result }; }
      case "BinaryExpression": { const left = this.expression(e.left); const right = this.expression(e.right); const result = this.value(type); this.emit({ op: "binary", result, operator: e.operator, left, right, span: e.span }); return { kind: "value", value: result }; }
      case "AssignmentExpression": {
        if (e.target.kind === "IndexExpression" && e.target.target.kind === "IdentifierExpression") {
          const slot = this.locals.get(e.target.target.name);
          const index = this.expression(e.target.index);
          let source = this.expression(e.value);
          if (slot && e.operator === "+=") {
            const array = this.value(slot.type);
            this.emit({ op: "load", result: array, slot, span: e.span });
            const elementType = this.typed.expressionTypes.get(e.target) ?? "Unknown";
            const previous = this.value(elementType);
            this.emit({ op: "index", result: previous, array: { kind: "value", value: array }, index, boundsCheck: true, span: e.span });
            const combined = this.value(elementType);
            this.emit({ op: "binary", result: combined, operator: "+", left: { kind: "value", value: previous }, right: source, span: e.span });
            source = { kind: "value", value: combined };
          }
          if (slot) this.emit({ op: "arrayset", slot, index, source, span: e.span });
          return source;
        }
        let source = this.expression(e.value);
        if (e.target.kind === "IdentifierExpression") {
          const slot = this.locals.get(e.target.name);
          if (slot) {
            if (e.operator === "+=") {
              const old = this.value(slot.type); this.emit({ op: "load", result: old, slot, span: e.span });
              const combined = this.value(slot.type); this.emit({ op: "binary", result: combined, operator: "+", left: { kind: "value", value: old }, right: source, span: e.span });
              source = { kind: "value", value: combined };
            }
            this.emit({ op: "store", slot, source, span: e.span });
          }
          return source;
        }
        return source;
      }
      case "ArrayLiteralExpression": {
        const elements = e.elements.map((element) => this.expression(element));
        const result = this.value(type); this.emit({ op: "array", result, elements, span: e.span });
        return { kind: "value", value: result };
      }
      case "IndexExpression": {
        const array = this.expression(e.target), index = this.expression(e.index);
        const result = this.value(type); this.emit({ op: "index", result, array, index, boundsCheck: true, span: e.span });
        return { kind: "value", value: result };
      }
      case "MemberAccessExpression": {
        const array = this.expression(e.target);
        const result = this.value(type);
        this.emit({ op: e.member === "capacity" ? "arraycap" : "arraylen", result, array, span: e.span });
        return { kind: "value", value: result };
      }
      case "CallExpression": {
        if (e.callee.kind === "MemberAccessExpression" && e.callee.target.kind === "IdentifierExpression") {
          const slot = this.locals.get(e.callee.target.name);
          if (slot && e.callee.member === "push") {
            const source = e.arguments[0] ? this.expression(e.arguments[0]) : this.literal(null, "Null");
            this.emit({ op: "arraypush", slot, source, span: e.span });
            return this.literal(null, "Void");
          }
          if (slot && e.callee.member === "reserve") {
            const capacity = e.arguments[0] ? this.expression(e.arguments[0]) : this.literal(0, "Int");
            this.emit({ op: "arrayreserve", slot, capacity, span: e.span });
            return this.literal(null, "Void");
          }
          if (slot && e.callee.member === "shrinkToFit") {
            this.emit({ op: "arrayshrink", slot, span: e.span });
            return this.literal(null, "Void");
          }
          if (slot && e.callee.member === "clear") {
            this.emit({ op: "arrayclear", slot, span: e.span });
            return this.literal(null, "Void");
          }
        }
        if (e.callee.kind === "IdentifierExpression" && e.callee.name === "move") {
          const argument = e.arguments[0];
          if (argument?.kind === "IdentifierExpression" && /^Array<.+>$/.test(this.typed.expressionTypes.get(argument) ?? "")) {
            const slot = this.locals.get(argument.name);
            if (slot) {
              const result = this.value(slot.type);
              this.emit({ op: "arraymove", result, slot, span: e.span });
              return { kind: "value", value: result };
            }
          }
          return argument ? this.expression(argument) : this.literal(null, "Null");
        }
        const callee = e.callee.kind === "IdentifierExpression" ? e.callee.name : "<indirect>";
        const target = this.typed.ast.declarations.find((d) => d.kind === "FunctionDeclaration" && d.name === callee);
        const varargIndex = target?.kind === "FunctionDeclaration" ? target.parameters.findIndex((p) => p.vararg) : -1;
        let args: IROperand[];
        if (varargIndex >= 0) {
          args = e.arguments.slice(0, varargIndex).map((a) => this.expression(a));
          const rest = e.arguments.slice(varargIndex).map((a) => this.expression(a));
          const elementType = target!.kind === "FunctionDeclaration" ? this.typed.parameterTypes.get(target!.parameters[varargIndex]!)?.match(/^Array<(.+)>$/)?.[1] ?? "Unknown" : "Unknown";
          const arrayType = `Array<${elementType}>`;
          const array = this.value(arrayType); this.emit({ op: "arrayview", result: array, elements: rest, span: e.span });
          args.push({ kind: "value", value: array });
        } else args = e.arguments.map((a, index) => {
          const expected = target?.kind === "FunctionDeclaration"
            ? this.typed.parameterTypes.get(target.parameters[index]!)
            : undefined;
          if (expected && /^Array<.+>$/.test(expected) && a.kind === "ArrayLiteralExpression") {
            const elements = a.elements.map((element) => this.expression(element));
            const view = this.value(expected);
            this.emit({ op: "arrayview", result: view, elements, span: a.span });
            return { kind: "value", value: view } as IROperand;
          }
          return this.expression(a);
        });
        if (callee === "print") { if (args[0]) this.emit({ op: "print", value: args[0], span: e.span }); return this.literal(null, "Void"); }
        const result = type === "Void" ? undefined : this.value(type); this.emit({ op: "call", ...(result ? { result } : {}), callee, args, span: e.span });
        return result ? { kind: "value", value: result } : this.literal(null, "Void");
      }
    }
  }
}

export function validateIR(module: IRModule): string[] {
  const errors: string[] = [];
  for (const fn of module.functions) {
    const names = new Set(fn.blocks.map((b) => b.name));
    if (!fn.blocks.length || fn.blocks[0]?.name !== "entry_0") errors.push(`${fn.name}: first block must be entry.0`);
    for (const block of fn.blocks) {
      const last = block.instructions.at(-1);
      if (!last || !["return", "jump", "branch"].includes(last.op)) errors.push(`${fn.name}:${block.name}: block has no terminator`);
      for (const instruction of block.instructions) {
        if (instruction.op === "jump" && !names.has(instruction.target)) errors.push(`${fn.name}:${block.name}: unknown jump target '${instruction.target}'`);
        if (instruction.op === "branch" && (!names.has(instruction.thenBlock) || !names.has(instruction.elseBlock))) errors.push(`${fn.name}:${block.name}: branch references an unknown block`);
        if (instruction.op === "phi") for (const incoming of instruction.incoming) if (!names.has(incoming.block)) errors.push(`${fn.name}:${block.name}: phi references unknown predecessor '${incoming.block}'`);
      }
    }
  }
  return errors;
}

export function formatIR(module: IRModule): string {
  const operand = (o: IROperand): string => o.kind === "value" ? `%${o.value.id}:${o.value.type}` : `${JSON.stringify(o.value)}:${o.type}`;
  const lines = ["IRModule"];
  for (const fn of module.functions) {
    lines.push(`  function @${fn.name}(${fn.parameters.map((p) => `%${p.value.id}:${p.type} ${p.name}`).join(", ")}) -> ${fn.returnType} {`);
    for (const b of fn.blocks) { lines.push(`  ${b.name}:`); for (const i of b.instructions) {
      const result = "result" in i && i.result ? `%${i.result.id}:${i.result.type} = ` : "";
      switch (i.op) {
        case "const": lines.push(`    ${result}const ${operand(i.value)}`); break;
        case "binary": lines.push(`    ${result}${i.operator} ${operand(i.left)}, ${operand(i.right)}`); break;
        case "unary": lines.push(`    ${result}${i.operator} ${operand(i.operand)}`); break;
        case "copy": lines.push(`    ${result}copy ${operand(i.source)}`); break;
        case "phi": lines.push(`    ${result}phi ${i.incoming.map((v) => `[${v.block}: ${operand(v.value)}]`).join(", ")}`); break;
        case "alloca": lines.push(`    ${result}alloca ${i.result.type}`); break;
        case "load": lines.push(`    ${result}load %${i.slot.id}`); break;
        case "store": lines.push(`    store %${i.slot.id}, ${operand(i.source)}`); break;
        case "call": lines.push(`    ${result}call @${i.callee}(${i.args.map(operand).join(", ")})`); break;
        case "array": lines.push(`    ${result}array [${i.elements.map(operand).join(", ")}]`); break;
        case "arrayview": lines.push(`    ${result}arrayview [${i.elements.map(operand).join(", ")}]`); break;
        case "arrayset": lines.push(`    arrayset %${i.slot.id}[${operand(i.index)}] = ${operand(i.source)}`); break;
        case "arraypush": lines.push(`    arraypush %${i.slot.id}, ${operand(i.source)}`); break;
        case "arrayreserve": lines.push(`    arrayreserve %${i.slot.id}, ${operand(i.capacity)}`); break;
        case "arrayshrink": lines.push(`    arrayshrink %${i.slot.id}`); break;
        case "arrayclear": lines.push(`    arrayclear %${i.slot.id}`); break;
        case "arraymove": lines.push(`    ${result}arraymove %${i.slot.id}`); break;
        case "arraydrop": lines.push(`    arraydrop %${i.slot.id}`); break;
        case "index": lines.push(`    ${result}index ${operand(i.array)}[${operand(i.index)}]`); break;
        case "arraylen": lines.push(`    ${result}length ${operand(i.array)}`); break;
        case "arraycap": lines.push(`    ${result}capacity ${operand(i.array)}`); break;
        case "print": lines.push(`    print ${operand(i.value)}`); break;
        case "return": lines.push(`    ret${i.value ? ` ${operand(i.value)}` : ""}`); break;
        case "branch": lines.push(`    br ${operand(i.condition)}, ${i.thenBlock}, ${i.elseBlock}`); break;
        case "jump": lines.push(`    jmp ${i.target}`); break;
      }
    } }
    lines.push("  }");
  }
  return `${lines.join("\n")}\n`;
}
