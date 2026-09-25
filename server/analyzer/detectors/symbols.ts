import type { CodeSymbol, Language, SymbolKind } from "@shared/repo";

const MAX_SYMBOLS = 90;
const JS_KEYWORDS = new Set(["if", "for", "while", "switch", "return", "catch", "function", "constructor", "super", "new", "typeof", "await", "else", "do", "try", "import", "export", "default", "case", "throw", "delete", "void", "yield", "get", "set", "static", "async"]);

export function detectSymbols(path: string, content: string, lang: Language): CodeSymbol[] {
  const out: CodeSymbol[] = [];
  const lines = content.split("\n");
  const isJsx = /\.(tsx|jsx)$/.test(path) || /<[A-Z][A-Za-z]*[\s/>]/.test(content);

  const add = (s: CodeSymbol) => {
    if (out.length < MAX_SYMBOLS && !out.some((o) => o.name === s.name && o.line === s.line)) out.push(s);
  };

  if (lang === "typescript" || lang === "javascript") {
    let classIndent: number | null = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const indent = line.length - line.trimStart().length;
      if (classIndent !== null && indent <= classIndent && line.trim().startsWith("}")) classIndent = null;

      let m = /^\s*(export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*(<[^>]*>)?\s*\(([^)]*)\)/.exec(line);
      if (m) {
        add({ name: m[2]!, kind: jsKind(m[2]!, isJsx), line: i + 1, exported: Boolean(m[1]), signature: `(${m[4]!.trim().slice(0, 80)})` });
        continue;
      }
      m = /^\s*(export\s+(?:default\s+)?)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+?)?=\s*(?:React\.)?(?:memo|forwardRef|observer)?\(?\s*(?:async\s+)?(?:\(([^)]*)\)|[A-Za-z_$][\w$]*)\s*(?::\s*[^=]+?)?=>/.exec(line);
      if (m) {
        add({ name: m[2]!, kind: jsKind(m[2]!, isJsx), line: i + 1, exported: Boolean(m[1]), signature: m[3] !== undefined ? `(${m[3].trim().slice(0, 80)})` : undefined });
        continue;
      }
      m = /^\s*(export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)(?:\s+extends\s+([\w$.]+))?/.exec(line);
      if (m) {
        add({ name: m[2]!, kind: "class", line: i + 1, exported: Boolean(m[1]), signature: m[3] ? `extends ${m[3]}` : undefined });
        classIndent = indent;
        continue;
      }
      m = /^\s*export\s+(?:type|interface|enum)\s+([A-Za-z_$][\w$]*)/.exec(line);
      if (m) {
        add({ name: m[1]!, kind: "type", line: i + 1, exported: true });
        continue;
      }
      if (classIndent !== null && indent > classIndent) {
        m = /^\s*(?:public|private|protected|static|readonly|async|override|\s)*\s*(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*(<[^>]*>)?\s*\(([^)]*)\)\s*(?::\s*[^{]+)?\{/.exec(line);
        if (m && !JS_KEYWORDS.has(m[1]!) && m[1] !== "constructor") add({ name: m[1]!, kind: "method", line: i + 1, exported: false, signature: `(${m[3]!.trim().slice(0, 80)})` });
      }
      m = /^\s*export\s+(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?!.*=>)/.exec(line);
      if (m && !out.some((o) => o.name === m![1])) add({ name: m[1]!, kind: "const", line: i + 1, exported: true });
    }
  } else if (lang === "python") {
    let classIndent: number | null = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const indent = line.length - line.trimStart().length;
      if (classIndent !== null && line.trim() && indent <= classIndent) classIndent = null;
      let m = /^(\s*)class\s+([A-Za-z_]\w*)\s*(\([^)]*\))?\s*:/.exec(line);
      if (m) {
        add({ name: m[2]!, kind: "class", line: i + 1, exported: !m[2]!.startsWith("_"), signature: m[3]?.slice(0, 80) });
        classIndent = m[1]!.length;
        continue;
      }
      m = /^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/.exec(line);
      if (m) {
        const inClass = classIndent !== null && m[1]!.length > classIndent;
        add({ name: m[2]!, kind: inClass ? "method" : "function", line: i + 1, exported: !m[2]!.startsWith("_"), signature: `(${m[3]!.trim().slice(0, 80)})` });
      }
    }
  } else if (lang === "go") {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      let m = /^func\s+(\([^)]*\)\s+)?([A-Za-z_]\w*)\s*\(([^)]*)\)/.exec(line);
      if (m) {
        add({ name: m[2]!, kind: m[1] ? "method" : "function", line: i + 1, exported: /^[A-Z]/.test(m[2]!), signature: `(${m[3]!.trim().slice(0, 80)})` });
        continue;
      }
      m = /^type\s+([A-Za-z_]\w*)\s+(struct|interface)\b/.exec(line);
      if (m) add({ name: m[1]!, kind: m[2] === "struct" ? "class" : "type", line: i + 1, exported: /^[A-Z]/.test(m[1]!) });
    }
  } else if (lang === "rust") {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      let m = /^\s*(pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/.exec(line);
      if (m) {
        add({ name: m[2]!, kind: "function", line: i + 1, exported: Boolean(m[1]) });
        continue;
      }
      m = /^\s*(pub(?:\([^)]*\))?\s+)?(struct|enum|trait)\s+([A-Za-z_]\w*)/.exec(line);
      if (m) add({ name: m[3]!, kind: m[2] === "trait" ? "type" : "class", line: i + 1, exported: Boolean(m[1]) });
    }
  } else if (lang === "java" || lang === "kotlin" || lang === "csharp") {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      let m = /^\s*(?:(public|private|protected|internal)\s+)?(?:static\s+|final\s+|abstract\s+|sealed\s+|data\s+|open\s+|partial\s+)*(?:class|interface|record|object|enum)\s+([A-Za-z_]\w*)/.exec(line);
      if (m) {
        add({ name: m[2]!, kind: "class", line: i + 1, exported: m[1] !== "private" });
        continue;
      }
      m = /^\s*(?:(public|private|protected|internal)\s+)?(?:static\s+|final\s+|async\s+|override\s+|suspend\s+|virtual\s+)*(?:fun\s+([A-Za-z_]\w*)|[\w<>\[\],.?\s]+?\s+([A-Za-z_]\w*))\s*\(([^)]*)\)\s*(?::\s*[\w<>?]+)?\s*(?:throws\s+[\w,\s]+)?\s*\{?/.exec(line);
      if (m && !/^\s*(return|new|if|else|for|while|switch|catch|throw)\b/.test(line) && !/[;=]\s*$/.test(line.trim())) {
        const name = m[2] ?? m[3];
        if (name && !["if", "for", "while", "switch", "catch", "return"].includes(name)) add({ name, kind: "method", line: i + 1, exported: m[1] === "public" || m[1] === undefined, signature: `(${m[4]!.trim().slice(0, 80)})` });
      }
    }
  } else if (lang === "ruby") {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      let m = /^\s*(?:class|module)\s+([A-Z]\w*(?:::\w+)*)/.exec(line);
      if (m) {
        add({ name: m[1]!, kind: "class", line: i + 1, exported: true });
        continue;
      }
      m = /^\s*def\s+(?:self\.)?([a-z_]\w*[?!=]?)/.exec(line);
      if (m) add({ name: m[1]!, kind: "method", line: i + 1, exported: true });
    }
  } else if (lang === "php") {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      let m = /^\s*(?:abstract\s+|final\s+)?(?:class|interface|trait)\s+([A-Za-z_]\w*)/.exec(line);
      if (m) {
        add({ name: m[1]!, kind: "class", line: i + 1, exported: true });
        continue;
      }
      m = /^\s*(?:(public|private|protected)\s+)?(?:static\s+)?function\s+([A-Za-z_]\w*)\s*\(/.exec(line);
      if (m) add({ name: m[2]!, kind: "method", line: i + 1, exported: m[1] !== "private" });
    }
  }
  return out;
}

function jsKind(name: string, isJsx: boolean): SymbolKind {
  if (/^use[A-Z]/.test(name)) return "hook";
  if (isJsx && /^[A-Z]/.test(name)) return "component";
  return "function";
}
