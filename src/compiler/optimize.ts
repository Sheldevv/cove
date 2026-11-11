import type { CoveType } from "./typed-ir.js";
import type { IRBasicBlock, IRFunction, IRInstruction, IRModule, IROperand } from "./ir.js";

export interface OptimizationStats {
  readonly constantsFolded: number;
  readonly branchesSimplified: number;
  readonly blocksRemoved: number;
  readonly instructionsRemoved: number;
  readonly loadsForwarded: number;
}
export interface OptimizationResult { readonly module: IRModule; readonly stats: OptimizationStats; }

const pureResultOps = new Set(["const", "binary", "unary", "copy", "phi", "array", "index", "arraylen"]);
const valueKey = (value: { readonly id: number }): string => `v${value.id}`;
const literal = (value: string | number | boolean | null, type: CoveType): IROperand => ({
  kind: value === null ? "null" : typeof value === "string" ? "string" : typeof value === "boolean" ? "bool" : Number.isInteger(value) ? "int" : "float",
  value, type,
});

/** Performs conservative, local IR optimizations without changing observable behavior. */
export function optimizeIR(input: IRModule): OptimizationResult {
  let constantsFolded = 0, branchesSimplified = 0, blocksRemoved = 0, instructionsRemoved = 0, loadsForwarded = 0;
  const functions = input.functions.map((fn) => {
    const blocks: IRBasicBlock[] = fn.blocks.map((block) => {
      const constants = new Map<string, IROperand>();
      const memory = new Map<string, IROperand>();
      const replace = (operand: IROperand): IROperand => operand.kind === "value" ? constants.get(valueKey(operand.value)) ?? operand : operand;
      const instructions: IRInstruction[] = [];
      for (const original of block.instructions) {
        let instruction = rewriteOperands(original, replace);
        if (instruction.op === "store") {
          const source = replace(instruction.source);
          memory.set(valueKey(instruction.slot), source);
          instructions.push({ ...instruction, source });
          continue;
        }
        if (instruction.op === "load") {
          const known = memory.get(valueKey(instruction.slot));
          if (known) {
            const value = replace(known);
            if (value.kind === "value") instructions.push({ op: "copy", result: instruction.result, source: value, span: instruction.span });
            else instructions.push({ op: "const", result: instruction.result, value, span: instruction.span });
            constants.set(valueKey(instruction.result), value);
            loadsForwarded++;
            continue;
          }
        }
        if (instruction.op === "const") {
          constants.set(valueKey(instruction.result), instruction.value);
          instructions.push(instruction);
          continue;
        }
        if (instruction.op === "copy") {
          const source = replace(instruction.source);
          if (source.kind !== "value") {
            constants.set(valueKey(instruction.result), source);
            constantsFolded++;
          }
          instructions.push({ ...instruction, source });
          continue;
        }
        if (instruction.op === "unary") {
          const folded = foldUnary(instruction.operator, replace(instruction.operand), instruction.result.type);
          if (folded) {
            constants.set(valueKey(instruction.result), folded);
            instructions.push({ op: "const", result: instruction.result, value: folded, span: instruction.span });
            constantsFolded++;
            continue;
          }
        }
        if (instruction.op === "binary") {
          const left = replace(instruction.left), right = replace(instruction.right);
          instruction = { ...instruction, left, right };
          const folded = foldBinary(instruction.operator, left, right, instruction.result.type);
          if (folded) {
            constants.set(valueKey(instruction.result), folded);
            instructions.push({ op: "const", result: instruction.result, value: folded, span: instruction.span });
            constantsFolded++;
            continue;
          }
        }
        if (instruction.op === "branch") {
          const condition = replace(instruction.condition);
          if (condition.kind === "bool") {
            instruction = { op: "jump", target: condition.value ? instruction.thenBlock : instruction.elseBlock, span: instruction.span };
            branchesSimplified++;
          } else instruction = { ...instruction, condition };
        }
        instructions.push(instruction);
      }
      return { name: block.name, instructions };
    });

    const reachable = reachableBlocks(blocks);
    const kept = blocks.filter((block) => reachable.has(block.name));
    blocksRemoved += blocks.length - kept.length;
    const cleaned = eliminateDeadValues(kept);
    instructionsRemoved += cleaned.removed;
    return { ...fn, blocks: cleaned.blocks };
  });
  return { module: { ...input, functions }, stats: { constantsFolded, branchesSimplified, blocksRemoved, instructionsRemoved, loadsForwarded } };
}

function rewriteOperands(i: IRInstruction, replace: (o: IROperand) => IROperand): IRInstruction {
  switch (i.op) {
    case "const": return { ...i, value: replace(i.value) };
    case "binary": return { ...i, left: replace(i.left), right: replace(i.right) };
    case "unary": return { ...i, operand: replace(i.operand) };
    case "call": return { ...i, args: i.args.map(replace) };
    case "array": return { ...i, elements: i.elements.map(replace) };
    case "index": return { ...i, array: replace(i.array), index: replace(i.index) };
    case "arraylen": return { ...i, array: replace(i.array) };
    case "copy": return { ...i, source: replace(i.source) };
    case "phi": return { ...i, incoming: i.incoming.map((entry) => ({ ...entry, value: replace(entry.value) })) };
    case "store": return { ...i, source: replace(i.source) };
    case "alloca": case "load": return i;
    case "print": return { ...i, value: replace(i.value) };
    case "return": return i.value ? { ...i, value: replace(i.value) } : i;
    case "branch": return { ...i, condition: replace(i.condition) };
    case "jump": return i;
  }
}
function foldUnary(operator: string, operand: IROperand, type: CoveType): IROperand | undefined {
  if (operand.kind === "bool" && operator === "!") return literal(!operand.value, type);
  if ((operand.kind === "int" || operand.kind === "float") && typeof operand.value === "number") {
    if (operator === "-") return literal(-operand.value, type);
    if (operator === "+") return literal(operand.value, type);
  }
  return undefined;
}
function foldBinary(op: string, a: IROperand, b: IROperand, type: CoveType): IROperand | undefined {
  if (a.kind === "string" && b.kind === "string" && op === "+") return literal(String(a.value) + String(b.value), type);
  if (a.kind === "bool" && b.kind === "bool") {
    if (op === "&&") return literal(Boolean(a.value && b.value), type);
    if (op === "||") return literal(Boolean(a.value || b.value), type);
    if (op === "==") return literal(a.value === b.value, type);
    if (op === "!=") return literal(a.value !== b.value, type);
  }
  if ((a.kind === "int" || a.kind === "float") && (b.kind === "int" || b.kind === "float") && typeof a.value === "number" && typeof b.value === "number") {
    const x = a.value, y = b.value;
    let result: number | boolean;
    switch (op) {
      case "+": result = x + y; break; case "-": result = x - y; break; case "*": result = x * y; break;
      case "/": if (y === 0) return undefined; result = type === "Int" ? Math.trunc(x / y) : x / y; break;
      case "%": if (y === 0) return undefined; result = x % y; break;
      case "==": result = x === y; break; case "!=": result = x !== y; break;
      case "<": result = x < y; break; case "<=": result = x <= y; break; case ">": result = x > y; break; case ">=": result = x >= y; break;
      default: return undefined;
    }
    if (typeof result === "number" && (!Number.isFinite(result) || (type === "Int" && !Number.isSafeInteger(result)))) return undefined;
    return literal(result, type);
  }
  if (a.kind === "string" && b.kind === "string") {
    if (op === "==") return literal(a.value === b.value, type);
    if (op === "!=") return literal(a.value !== b.value, type);
  }
  return undefined;
}
function reachableBlocks(blocks: readonly IRBasicBlock[]): Set<string> {
  const byName = new Map(blocks.map((block) => [block.name, block]));
  const visited = new Set<string>(), pending = blocks[0] ? [blocks[0].name] : [];
  while (pending.length) {
    const name = pending.pop()!;
    if (visited.has(name)) continue;
    visited.add(name);
    const last = byName.get(name)?.instructions.at(-1);
    if (last?.op === "jump") pending.push(last.target);
    if (last?.op === "branch") pending.push(last.thenBlock, last.elseBlock);
  }
  return visited;
}
function eliminateDeadValues(blocks: readonly IRBasicBlock[]): { blocks: IRBasicBlock[]; removed: number } {
  let removed = 0;
  let result = blocks.map((block) => ({ ...block, instructions: [...block.instructions] }));
  let changed = true;
  while (changed) {
    changed = false;
    const live = new Set<string>();
    const markValue = (o: IROperand): void => { if (o.kind === "value") live.add(valueKey(o.value)); };
    for (const block of result) for (const i of block.instructions) {
      switch (i.op) {
        case "binary": markValue(i.left); markValue(i.right); break; case "unary": markValue(i.operand); break;
        case "call": i.args.forEach(markValue); break; case "array": i.elements.forEach(markValue); break; case "index": markValue(i.array); markValue(i.index); break; case "arraylen": markValue(i.array); break; case "copy": markValue(i.source); break;
        case "store": markValue(i.source); live.add(valueKey(i.slot)); break;
        case "load": live.add(valueKey(i.slot)); break;
        case "alloca": break;
        case "print": markValue(i.value); break; case "return": if (i.value) markValue(i.value); break;
        case "branch": markValue(i.condition); break; case "const": markValue(i.value); break; case "jump": break;
      }
    }
    result = result.map((block) => ({ ...block, instructions: block.instructions.filter((i) => {
      if ("result" in i && i.result && pureResultOps.has(i.op) && !live.has(valueKey(i.result))) { removed++; changed = true; return false; }
      return true;
    }) }));
  }
  return { blocks: result, removed };
}

export function formatOptimizationStats(stats: OptimizationStats): string {
  return `Optimizations: ${stats.constantsFolded} constant(s) folded, ${stats.loadsForwarded} load(s) forwarded, ${stats.branchesSimplified} branch(es) simplified, ${stats.blocksRemoved} block(s) removed, ${stats.instructionsRemoved} dead instruction(s) removed.`;
}
