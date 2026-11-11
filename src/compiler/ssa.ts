import type { IRBasicBlock, IRFunction, IRInstruction, IRModule, IROperand, IRValue } from "./ir.js";
import { analyzeCFG } from "./cfg.js";

export interface SSAConstructionResult {
  readonly module: IRModule;
  readonly promotedSlots: number;
  readonly insertedPhis: number;
}

/** Promote eligible local stack slots into SSA values, inserting phi nodes at dominance frontiers. */
export function constructSSA(module: IRModule): SSAConstructionResult {
  let promotedSlots = 0;
  let insertedPhis = 0;
  const functions = module.functions.map((fn) => {
    const result = promoteFunction(fn);
    promotedSlots += result.promotedSlots;
    insertedPhis += result.insertedPhis;
    return result.fn;
  });
  return { module: { ...module, functions }, promotedSlots, insertedPhis };
}

function promoteFunction(fn: IRFunction): { fn: IRFunction; promotedSlots: number; insertedPhis: number } {
  let blocks = fn.blocks.map((b) => ({ ...b, instructions: [...b.instructions] }));
  let promotedSlots = 0;
  let insertedPhis = 0;
  const cfg = analyzeCFG({ ...fn, blocks });
  const escapedSlots = new Set(blocks.flatMap((b) => b.instructions
    .filter((i) => i.op === "arraypush" || i.op === "arrayset" || i.op === "arraymove" || i.op === "arraydrop")
    .map((i) => i.slot.id)));
  const slotIds = blocks.flatMap((b) => b.instructions
    .filter((i): i is Extract<IRInstruction, { op: "alloca" }> =>
      i.op === "alloca" && !escapedSlots.has(i.result.id) && !/^Array<.+>$/.test(i.result.type))
    .map((i) => i.result.id));
  for (const slotId of slotIds) {
    const slotDef = blocks.flatMap((b) => b.instructions).find((i) => i.op === "alloca" && i.result.id === slotId);
    if (!slotDef || slotDef.op !== "alloca") continue;
    const definitions = new Set<string>();
    for (const block of blocks) if (block.instructions.some((i) => i.op === "store" && i.slot.id === slotId)) definitions.add(block.name);
    const phiBlocks = new Set<string>();
    const work = [...definitions];
    while (work.length) {
      const block = work.pop()!;
      for (const frontier of cfg.dominanceFrontiers.get(block) ?? []) {
        if (!phiBlocks.has(frontier)) { phiBlocks.add(frontier); if (!definitions.has(frontier)) work.push(frontier); }
      }
    }
    const nextId = Math.max(-1, ...blocks.flatMap((b) => b.instructions.flatMap((i) => "result" in i && i.result ? [i.result.id] : [])), ...fn.parameters.map((p) => p.value.id)) + 1;
    const phiValues = new Map<string, IRValue>();
    let id = nextId;
    for (const name of phiBlocks) phiValues.set(name, { id: id++, type: slotDef.result.type });
    const children = new Map<string, string[]>();
    for (const [child, parent] of cfg.immediateDominators) if (parent) { const list = children.get(parent) ?? []; list.push(child); children.set(parent, list); }
    const replacements = new Map<number, IROperand>();
    const phiIncoming = new Map<string, { block: string; value: IROperand }[]>();
    let failed = false;
    const renamed = new Map<string, IRInstruction[]>();
    const visit = (blockName: string, inherited: IROperand | undefined): void => {
      const block = blocks.find((b) => b.name === blockName)!;
      let current = inherited;
      const phi = phiValues.get(blockName);
      if (phi) current = { kind: "value", value: phi };
      const output: IRInstruction[] = [];
      for (const ins of block.instructions) {
        if (ins.op === "alloca" && ins.result.id === slotId) continue;
        if (ins.op === "store" && ins.slot.id === slotId) { current = replaceOperand(ins.source, replacements); continue; }
        if (ins.op === "load" && ins.slot.id === slotId) {
          if (!current) { failed = true; output.push(ins); }
          else replacements.set(ins.result.id, current);
          continue;
        }
        output.push(rewriteInstruction(ins, (operand) => replaceOperand(operand, replacements)));
      }
      renamed.set(blockName, output);
      for (const successor of cfg.successors.get(blockName) ?? []) {
        if (phiValues.has(successor)) {
          if (!current) failed = true;
          else {
            const incoming = phiIncoming.get(successor) ?? [];
            incoming.push({ block: blockName, value: current });
            phiIncoming.set(successor, incoming);
          }
        }
      }
      for (const child of children.get(blockName) ?? []) visit(child, current);
    };
    if (blocks[0]) visit(blocks[0].name, undefined);
    if (failed) continue;
    const newBlocks = blocks.map((block) => {
      const instructions = renamed.get(block.name) ?? block.instructions;
      const phi = phiValues.get(block.name);
      if (!phi) return { ...block, instructions: instructions.map((i) => rewriteInstruction(i, (o) => replaceOperand(o, replacements))) };
      const incoming = phiIncoming.get(block.name) ?? [];
      const phiInstruction: IRInstruction = { op: "phi", result: phi, incoming, span: slotDef.span };
      insertedPhis++;
      return { ...block, instructions: [phiInstruction, ...instructions.map((i) => rewriteInstruction(i, (o) => replaceOperand(o, replacements)))] };
    });
    blocks = newBlocks;
    promotedSlots++;
  }
  return { fn: { ...fn, blocks }, promotedSlots, insertedPhis };
}

function replaceOperand(operand: IROperand, replacements: ReadonlyMap<number, IROperand>): IROperand {
  let current = operand;
  const seen = new Set<number>();
  while (current.kind === "value" && replacements.has(current.value.id) && !seen.has(current.value.id)) {
    seen.add(current.value.id);
    current = replacements.get(current.value.id)!;
  }
  return current;
}

function rewriteInstruction(instruction: IRInstruction, replace: (operand: IROperand) => IROperand): IRInstruction {
  switch (instruction.op) {
    case "const": return { ...instruction, value: replace(instruction.value) };
    case "binary": return { ...instruction, left: replace(instruction.left), right: replace(instruction.right) };
    case "unary": return { ...instruction, operand: replace(instruction.operand) };
    case "copy": return { ...instruction, source: replace(instruction.source) };
    case "phi": return { ...instruction, incoming: instruction.incoming.map((v) => ({ ...v, value: replace(v.value) })) };
    case "call": return { ...instruction, args: instruction.args.map(replace) };
    case "array": case "arrayview": return { ...instruction, elements: instruction.elements.map(replace) };
    case "arrayset": return { ...instruction, index: replace(instruction.index), source: replace(instruction.source) };
    case "arraypush": return { ...instruction, source: replace(instruction.source) };
    case "arraymove": case "arraydrop": return instruction;
    case "index": return { ...instruction, array: replace(instruction.array), index: replace(instruction.index) };
    case "arraylen": return { ...instruction, array: replace(instruction.array) };
    case "store": return { ...instruction, source: replace(instruction.source) };
    case "print": return { ...instruction, value: replace(instruction.value) };
    case "return": return instruction.value ? { ...instruction, value: replace(instruction.value) } : instruction;
    case "branch": return { ...instruction, condition: replace(instruction.condition) };
    case "alloca": case "load": case "jump": return instruction;
  }
}

/** Eliminate identical pure expressions when an equivalent definition dominates the use. */
export function eliminateCommonSubexpressions(module: IRModule): { module: IRModule; eliminated: number } {
  let eliminated = 0;
  const functions = module.functions.map((fn) => {
    const cfg = analyzeCFG(fn);
    const children = new Map<string, string[]>();
    for (const [child, parent] of cfg.immediateDominators) if (parent) {
      const list = children.get(parent) ?? [];
      list.push(child);
      children.set(parent, list);
    }
    const replacements = new Map<number, IROperand>();
    const visit = (blockName: string, inherited: Map<string, IROperand>): void => {
      const available = new Map(inherited);
      const block = fn.blocks.find((b) => b.name === blockName);
      if (!block) return;
      for (const ins of block.instructions) {
        const rewritten = rewriteInstruction(ins, (operand) => replaceOperand(operand, replacements));
        if (!("result" in rewritten) || !rewritten.result) continue;
        const key = expressionKey(rewritten);
        if (!key) continue;
        const existing = available.get(key);
        if (existing) {
          replacements.set(rewritten.result.id, existing);
          eliminated++;
        } else available.set(key, { kind: "value", value: rewritten.result });
      }
      for (const child of children.get(blockName) ?? []) visit(child, available);
    };
    if (fn.blocks[0]) visit(fn.blocks[0].name, new Map());
    const blocks = fn.blocks.map((block) => ({
      ...block,
      instructions: block.instructions
        .filter((ins) => !("result" in ins && ins.result && replacements.has(ins.result.id)))
        .map((ins) => rewriteInstruction(ins, (operand) => replaceOperand(operand, replacements))),
    }));
    return { ...fn, blocks };
  });
  return { module: { ...module, functions }, eliminated };
}

function expressionKey(instruction: IRInstruction): string | undefined {
  const operand = (o: IROperand): string => o.kind === "value" ? `v${o.value.id}` : `${o.kind}:${JSON.stringify(o.value)}:${o.type}`;
  switch (instruction.op) {
    case "const": return `const:${instruction.result.type}:${operand(instruction.value)}`;
    case "copy": return `copy:${instruction.result.type}:${operand(instruction.source)}`;
    case "unary": return `unary:${instruction.result.type}:${instruction.operator}:${operand(instruction.operand)}`;
    case "binary": {
      let left = operand(instruction.left), right = operand(instruction.right);
      if (["+", "*", "==", "!=", "&&", "||", "&", "|", "^"].includes(instruction.operator) && right < left) [left, right] = [right, left];
      return `binary:${instruction.result.type}:${instruction.operator}:${left}:${right}`;
    }
    default: return undefined;
  }
}
