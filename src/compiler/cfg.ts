import type { IRBasicBlock, IRFunction, IRInstruction, IRModule, IROperand } from "./ir.js";

export interface CFGAnalysis {
  readonly predecessors: ReadonlyMap<string, ReadonlySet<string>>;
  readonly successors: ReadonlyMap<string, ReadonlySet<string>>;
  readonly reachable: ReadonlySet<string>;
  readonly dominators: ReadonlyMap<string, ReadonlySet<string>>;
  readonly immediateDominators: ReadonlyMap<string, string | null>;
  readonly dominanceFrontiers: ReadonlyMap<string, ReadonlySet<string>>;
}

export function analyzeCFG(fn: IRFunction): CFGAnalysis {
  const names = fn.blocks.map((b) => b.name);
  const predecessors = new Map(names.map((n) => [n, new Set<string>()]));
  const successors = new Map(names.map((n) => [n, new Set<string>()]));
  const byName = new Map(fn.blocks.map((b) => [b.name, b]));
  for (const block of fn.blocks) {
    const term = block.instructions.at(-1);
    const targets = term?.op === "jump" ? [term.target] : term?.op === "branch" ? [term.thenBlock, term.elseBlock] : [];
    for (const target of targets) {
      successors.get(block.name)?.add(target);
      predecessors.get(target)?.add(block.name);
    }
  }
  const reachable = new Set<string>();
  const work = fn.blocks[0] ? [fn.blocks[0].name] : [];
  while (work.length) {
    const current = work.pop()!;
    if (reachable.has(current)) continue;
    reachable.add(current);
    for (const next of successors.get(current) ?? []) work.push(next);
  }
  const all = new Set(reachable);
  const dominators = new Map<string, Set<string>>();
  for (const name of names) dominators.set(name, name === fn.blocks[0]?.name ? new Set([name]) : new Set(all));
  let changed = true;
  while (changed) {
    changed = false;
    for (const name of names) {
      if (name === fn.blocks[0]?.name || !reachable.has(name)) continue;
      const preds = [...(predecessors.get(name) ?? [])].filter((p) => reachable.has(p));
      let next = preds.length ? new Set(dominators.get(preds[0]!) ?? []) : new Set<string>();
      for (const pred of preds.slice(1)) next = intersection(next, dominators.get(pred) ?? new Set());
      next.add(name);
      if (!setEqual(next, dominators.get(name) ?? new Set())) { dominators.set(name, next); changed = true; }
    }
  }
  const immediateDominators = new Map<string, string | null>();
  for (const name of names) {
    if (name === fn.blocks[0]?.name || !reachable.has(name)) { immediateDominators.set(name, null); continue; }
    const strict = [...(dominators.get(name) ?? [])].filter((d) => d !== name);
    const idom = strict.find((candidate) => strict.every((other) => other === candidate || dominators.get(candidate)?.has(other)));
    immediateDominators.set(name, idom ?? null);
  }
  const dominanceFrontiers = new Map(names.map((n) => [n, new Set<string>()]));
  for (const block of fn.blocks) {
    const preds = [...(predecessors.get(block.name) ?? [])].filter((p) => reachable.has(p));
    if (preds.length < 2) continue;
    for (const pred of preds) {
      let runner: string | null | undefined = pred;
      while (runner && runner !== immediateDominators.get(block.name)) {
        dominanceFrontiers.get(runner)?.add(block.name);
        runner = immediateDominators.get(runner);
      }
    }
  }
  return { predecessors, successors, reachable, dominators, immediateDominators, dominanceFrontiers };
}

function intersection<T>(a: Set<T>, b: Set<T>): Set<T> { return new Set([...a].filter((x) => b.has(x))); }
function setEqual<T>(a: Set<T>, b: Set<T>): boolean { return a.size === b.size && [...a].every((x) => b.has(x)); }

export function validateSSA(module: IRModule): string[] {
  const errors: string[] = [];
  for (const fn of module.functions) {
    const cfg = analyzeCFG(fn);
    const definitions = new Map<number, { block: string; index: number }>();
    for (const parameter of fn.parameters) definitions.set(parameter.value.id, { block: fn.blocks[0]?.name ?? "", index: -1 });
    for (const block of fn.blocks) block.instructions.forEach((ins, index) => {
      if ("result" in ins && ins.result) {
        if (definitions.has(ins.result.id)) errors.push(`${fn.name}: value %${ins.result.id} is defined more than once`);
        definitions.set(ins.result.id, { block: block.name, index });
      }
    });
    for (const block of fn.blocks) block.instructions.forEach((ins, index) => {
      if (ins.op === "phi") {
        const expected = cfg.predecessors.get(block.name) ?? new Set<string>();
        const actual = ins.incoming.map((entry) => entry.block);
        if (new Set(actual).size !== actual.length) errors.push(`${fn.name}:${block.name}: phi has duplicate predecessor entries`);
        for (const predecessor of expected) if (!actual.includes(predecessor)) errors.push(`${fn.name}:${block.name}: phi is missing incoming value from ${predecessor}`);
        for (const predecessor of actual) if (!expected.has(predecessor)) errors.push(`${fn.name}:${block.name}: phi has incoming value from non-predecessor ${predecessor}`);
      }
      const check = (operand: IROperand, phiPred?: string) => {
        if (operand.kind !== "value") return;
        const def = definitions.get(operand.value.id);
        if (!def) { errors.push(`${fn.name}:${block.name}: use of undefined value %${operand.value.id}`); return; }
        const useBlock = phiPred ?? block.name;
        if (phiPred) {
          if (!cfg.dominators.get(phiPred)?.has(def.block)) errors.push(`${fn.name}:${block.name}: definition of %${operand.value.id} does not dominate phi predecessor ${phiPred}`);
        } else if (def.block === useBlock) {
          if (def.index >= index) errors.push(`${fn.name}:${block.name}: value %${operand.value.id} is used before its definition`);
        } else if (!cfg.dominators.get(useBlock)?.has(def.block)) errors.push(`${fn.name}:${block.name}: definition of %${operand.value.id} does not dominate its use`);
      };
      switch (ins.op) {
        case "const": check(ins.value); break;
        case "binary": check(ins.left); check(ins.right); break;
        case "unary": check(ins.operand); break;
        case "copy": check(ins.source); break;
        case "phi": for (const incoming of ins.incoming) check(incoming.value, incoming.block); break;
        case "call": ins.args.forEach((a) => check(a)); break;
        case "array": ins.elements.forEach((a) => check(a)); break;
        case "index": check(ins.array); check(ins.index); break;
        case "arraylen": check(ins.array); break;
        case "store": check(ins.source); break;
        case "print": check(ins.value); break;
        case "return": if (ins.value) check(ins.value); break;
        case "branch": check(ins.condition); break;
        case "alloca": case "load": case "jump": break;
      }
    });
  }
  return errors;
}

export function blockTerminator(block: IRBasicBlock): IRInstruction | undefined { return block.instructions.at(-1); }
