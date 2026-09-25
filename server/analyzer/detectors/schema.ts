import type { Language, SchemaModel } from "@shared/repo";

export function detectSchema(path: string, content: string, lang: Language): SchemaModel[] {
  const out: SchemaModel[] = [];
  const lines = content.split("\n");
  const fieldsAfter = (start: number, fieldRe: RegExp, stop: RegExp, max = 80): string[] => {
    const fields: string[] = [];
    for (let i = start + 1; i < Math.min(lines.length, start + 1 + max); i++) {
      const l = lines[i]!;
      if (stop.test(l)) break;
      const m = fieldRe.exec(l);
      if (m && m[1] && !fields.includes(m[1])) fields.push(m[1]);
    }
    return fields;
  };

  if (lang === "prisma") {
    lines.forEach((line, i) => {
      const m = /^model\s+(\w+)\s*\{/.exec(line);
      if (m) out.push({ name: m[1]!, file: path, line: i + 1, kind: "prisma", fields: fieldsAfter(i, /^\s+(\w+)\s+[\w\[\]?]+/, /^\}/) });
    });
    return out;
  }
  if (lang === "sql") {
    lines.forEach((line, i) => {
      const m = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?(?:\w+\.)?[`"']?(\w+)[`"']?\s*\(/i.exec(line);
      if (m) out.push({ name: m[1]!, file: path, line: i + 1, kind: "sql", fields: fieldsAfter(i, /^\s*[`"']?(\w+)[`"']?\s+(?!PRIMARY|CONSTRAINT|FOREIGN|UNIQUE|INDEX|KEY|CHECK)\w+/i, /^\s*\)/) });
    });
    return out;
  }
  if (lang === "typescript" || lang === "javascript") {
    const usesMongoose = /from\s+['"]mongoose['"]|require\(\s*['"]mongoose['"]\s*\)/.test(content);
    lines.forEach((line, i) => {
      let m = /(?:const|let|var)\s+(\w+)\s*=\s*new\s+(?:mongoose\.)?Schema\s*(?:<[^>]*>)?\s*\(\s*\{?/.exec(line);
      if (m && usesMongoose) out.push({ name: m[1]!.replace(/Schema$/, ""), file: path, line: i + 1, kind: "mongoose", fields: fieldsAfter(i, /^\s+(\w+)\s*:/, /^\s*\}\s*[,)]/) });
      m = /(?:export\s+)?const\s+(\w+)\s*=\s*(pgTable|mysqlTable|sqliteTable|pgSchema\.table)\s*\(\s*['"](\w+)['"]/.exec(line);
      if (m) out.push({ name: m[3]!, file: path, line: i + 1, kind: "drizzle", fields: fieldsAfter(i, /^\s+(\w+)\s*:/, /^\s*\}\s*[,)]/) });
      m = /sequelize\.define\(\s*['"](\w+)['"]/.exec(line);
      if (m) out.push({ name: m[1]!, file: path, line: i + 1, kind: "sequelize", fields: fieldsAfter(i, /^\s+(\w+)\s*:/, /^\s*\}\s*[,)]/) });
      if (/@Entity\(/.test(line)) {
        for (let j = i; j < Math.min(lines.length, i + 4); j++) {
          const c = /class\s+(\w+)/.exec(lines[j]!);
          if (c) { out.push({ name: c[1]!, file: path, line: j + 1, kind: "typeorm", fields: fieldsAfter(j, /^\s+(\w+)\s*[!?]?:/, /^\}/) }); break; }
        }
      }
    });
  }
  if (lang === "python") {
    lines.forEach((line, i) => {
      let m = /^class\s+(\w+)\((?:[\w.]*(?:Base|DeclarativeBase)|db\.Model|SQLModel)[^)]*\):/.exec(line);
      if (m) out.push({ name: m[1]!, file: path, line: i + 1, kind: "sqlalchemy", fields: fieldsAfter(i, /^\s+(\w+)\s*(?::\s*[^=]+)?=\s*(?:mapped_column|Column|relationship|Field)\(|^\s+(\w+)\s*:\s*Mapped\[/, /^(?:class|def)\s/) });
      m = /^class\s+(\w+)\((?:models\.Model|[\w.]*AbstractUser|[\w.]*AbstractBaseUser)\):/.exec(line);
      if (m) out.push({ name: m[1]!, file: path, line: i + 1, kind: "django", fields: fieldsAfter(i, /^\s+(\w+)\s*=\s*models\.\w+\(/, /^(?:class|def)\s/) });
    });
  }
  if (lang === "go") {
    lines.forEach((line, i) => {
      const m = /^type\s+(\w+)\s+struct\s*\{/.exec(line);
      if (m && /gorm:"|db:"|bson:"|json:"/.test(lines.slice(i, i + 15).join("\n"))) out.push({ name: m[1]!, file: path, line: i + 1, kind: "other", fields: fieldsAfter(i, /^\s+(\w+)\s+[\w.*\[\]]+/, /^\}/) });
    });
  }
  if (lang === "ruby") {
    lines.forEach((line, i) => {
      const m = /^\s*create_table\s+['":](\w+)['"]?/.exec(line);
      if (m) out.push({ name: m[1]!, file: path, line: i + 1, kind: "sql", fields: fieldsAfter(i, /^\s+t\.\w+\s+['":](\w+)/, /^\s*end/) });
    });
  }
  return out;
}
