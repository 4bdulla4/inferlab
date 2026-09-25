/**
 * A small arithmetic evaluator with its own tokenizer and parser, so the
 * calculator tool never touches eval(). Supports + - * / % ^, parentheses,
 * unary minus, a handful of functions and the constants pi and e.
 */

type Token = { kind: "num"; value: number } | { kind: "id"; name: string } | { kind: "op"; op: string } | { kind: "lparen" } | { kind: "rparen" } | { kind: "comma" };

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  round: (x, digits = 0) => {
    const f = 10 ** digits;
    return Math.round(x * f) / f;
  },
  floor: Math.floor,
  ceil: Math.ceil,
  min: (...a) => Math.min(...a),
  max: (...a) => Math.max(...a),
  pow: Math.pow,
  log: Math.log10,
  ln: Math.log,
  exp: Math.exp,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
};

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

export function tokenizeExpression(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const s = input.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/,(?=\d{3}\b)/g, "");
  while (i < s.length) {
    const c = s[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[\d.]/.test(c)) {
      const m = /^\d*\.?\d+(?:e[+-]?\d+)?|^\d+\.?/i.exec(s.slice(i));
      if (!m) throw new Error(`Unexpected character "${c}" at position ${i + 1}.`);
      tokens.push({ kind: "num", value: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[a-z_]/i.test(c)) {
      const m = /^[a-z_]\w*/i.exec(s.slice(i))!;
      tokens.push({ kind: "id", name: m[0].toLowerCase() });
      i += m[0].length;
      continue;
    }
    if ("+-*/%^".includes(c)) {
      tokens.push({ kind: "op", op: c });
      i++;
      continue;
    }
    if (c === "(") tokens.push({ kind: "lparen" });
    else if (c === ")") tokens.push({ kind: "rparen" });
    else if (c === ",") tokens.push({ kind: "comma" });
    else throw new Error(`Unexpected character "${c}" at position ${i + 1}.`);
    i++;
  }
  return tokens;
}

/** Evaluates an arithmetic expression, throwing a readable error on bad input. */
export function evaluateExpression(input: string): number {
  const expr = input.trim();
  if (!expr) throw new Error("The expression is empty.");
  if (expr.length > 400) throw new Error("Expressions are limited to 400 characters.");
  const tokens = tokenizeExpression(expr);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseExpr(): number {
    let value = parseTerm();
    while (peek()?.kind === "op" && ((peek() as { op: string }).op === "+" || (peek() as { op: string }).op === "-")) {
      const op = (next() as { op: string }).op;
      const rhs = parseTerm();
      value = op === "+" ? value + rhs : value - rhs;
    }
    return value;
  }
  function parseTerm(): number {
    let value = parseFactor();
    while (peek()?.kind === "op" && ["*", "/", "%"].includes((peek() as { op: string }).op)) {
      const op = (next() as { op: string }).op;
      const rhs = parseFactor();
      if (op === "*") value *= rhs;
      else if (op === "/") {
        if (rhs === 0) throw new Error("Division by zero.");
        value /= rhs;
      } else value %= rhs;
    }
    return value;
  }
  // Unary minus binds looser than ^ so that -3^2 is -(3^2), as in mathematics.
  function parseFactor(): number {
    const t = peek();
    if (t?.kind === "op" && t.op === "-") {
      next();
      return -parseFactor();
    }
    if (t?.kind === "op" && t.op === "+") {
      next();
      return parseFactor();
    }
    const base = parsePrimary();
    if (peek()?.kind === "op" && (peek() as { op: string }).op === "^") {
      next();
      return base ** parseFactor();
    }
    return base;
  }
  function parsePrimary(): number {
    const t = next();
    if (!t) throw new Error("The expression ends unexpectedly.");
    if (t.kind === "num") return t.value;
    if (t.kind === "lparen") {
      const v = parseExpr();
      if (next()?.kind !== "rparen") throw new Error("Missing closing parenthesis.");
      return v;
    }
    if (t.kind === "id") {
      if (peek()?.kind === "lparen") {
        next();
        const args: number[] = [];
        if (peek()?.kind !== "rparen") {
          args.push(parseExpr());
          while (peek()?.kind === "comma") {
            next();
            args.push(parseExpr());
          }
        }
        if (next()?.kind !== "rparen") throw new Error(`Missing closing parenthesis after ${t.name}(.`);
        const fn = FUNCTIONS[t.name];
        if (!fn) throw new Error(`Unknown function "${t.name}".`);
        return fn(...args);
      }
      const c = CONSTANTS[t.name];
      if (c === undefined) throw new Error(`Unknown identifier "${t.name}".`);
      return c;
    }
    throw new Error("Unexpected token in expression.");
  }

  const value = parseExpr();
  if (pos < tokens.length) throw new Error("Unexpected trailing input in expression.");
  if (!Number.isFinite(value)) throw new Error("The result is not a finite number.");
  return value;
}
