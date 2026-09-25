import type { InfraConfig, InfraKind, ScheduledJob } from "@shared/repo";

export interface InfraFacts {
  configs: InfraConfig[];
  /** Jobs derived from platform config (vercel crons, workflow schedules, k8s CronJobs, Procfile workers). */
  jobs: ScheduledJob[];
}

export function detectInfra(files: Map<string, string>): InfraFacts {
  const configs: InfraConfig[] = [];
  const jobs: ScheduledJob[] = [];

  for (const [path, content] of files) {
    const base = path.split("/").pop()!;
    const kind = infraKind(path, base, content);
    if (!kind) continue;
    try {
      switch (kind) {
        case "dockerfile": {
          const froms = [...content.matchAll(/^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/gim)].map((m) => m[1]!);
          const expose = [...content.matchAll(/^EXPOSE\s+(.+)$/gim)].map((m) => m[1]!.trim());
          const cmd = /^(?:CMD|ENTRYPOINT)\s+(.+)$/im.exec(content)?.[1]?.slice(0, 120);
          configs.push({ kind, file: path, summary: `Container image from ${froms.join(" → ") || "unknown base"}${expose.length ? ` · exposes ${expose.join(", ")}` : ""}`, details: { baseImages: froms, expose, command: cmd ?? "" } });
          break;
        }
        case "compose": {
          const services = parseComposeServices(content);
          configs.push({ kind, file: path, summary: `docker-compose with ${services.length} service${services.length === 1 ? "" : "s"}: ${services.map((s) => s.name).join(", ")}`, details: { services: services.map((s) => `${s.name}${s.image ? ` (${s.image})` : ""}`) } });
          for (const s of services) if (/worker|celery|sidekiq|cron|scheduler|consumer|beat/i.test(s.name)) jobs.push({ name: s.name, kind: /cron|beat|scheduler/i.test(s.name) ? "cron" : "worker", file: path, line: s.line, library: "docker-compose", evidence: { kind: "verified", file: path, line: s.line, note: `compose service ${s.name}` } });
          break;
        }
        case "vercel": {
          const json = JSON.parse(content) as { crons?: { path: string; schedule: string }[]; rewrites?: unknown[]; functions?: Record<string, unknown>; framework?: string; regions?: string[] };
          const crons = json.crons ?? [];
          configs.push({ kind, file: path, summary: `Vercel deployment${json.framework ? ` (${json.framework})` : ""}${crons.length ? ` · ${crons.length} cron${crons.length === 1 ? "" : "s"}` : ""}${json.rewrites?.length ? ` · ${json.rewrites.length} rewrites` : ""}`, details: { crons: crons.map((c) => `${c.schedule} → ${c.path}`), regions: json.regions ?? [], functions: Object.keys(json.functions ?? {}) } });
          crons.forEach((c, i) => jobs.push({ name: c.path, kind: "cron", schedule: c.schedule, file: path, line: 1 + i, library: "vercel-cron", evidence: { kind: "verified", file: path, note: `vercel.json cron ${c.schedule}` } }));
          break;
        }
        case "netlify": {
          const cmd = /^\s*command\s*=\s*"([^"]+)"/m.exec(content)?.[1];
          const publish = /^\s*publish\s*=\s*"([^"]+)"/m.exec(content)?.[1];
          const fns = /^\s*(?:directory|functions)\s*=\s*"([^"]+)"/m.exec(content)?.[1];
          configs.push({ kind, file: path, summary: `Netlify deployment${cmd ? ` · build: ${cmd}` : ""}${publish ? ` · publish: ${publish}` : ""}`, details: { command: cmd ?? "", publish: publish ?? "", functions: fns ?? "" } });
          break;
        }
        case "fly": {
          const app = /^app\s*=\s*['"]([^'"]+)['"]/m.exec(content)?.[1];
          const region = /^primary_region\s*=\s*['"]([^'"]+)['"]/m.exec(content)?.[1];
          const port = /internal_port\s*=\s*(\d+)/.exec(content)?.[1];
          const processes = [...content.matchAll(/^\s*(\w+)\s*=\s*['"]([^'"]+)['"]/gm)].filter((m) => /\[processes\]/.test(content.slice(0, m.index))).map((m) => m[1]!);
          configs.push({ kind, file: path, summary: `Fly.io app${app ? ` "${app}"` : ""}${region ? ` in ${region}` : ""}${port ? ` · port ${port}` : ""}`, details: { app: app ?? "", region: region ?? "", port: port ?? "", processes } });
          for (const p of processes) if (/worker|cron|scheduler/i.test(p)) jobs.push({ name: p, kind: /cron|scheduler/i.test(p) ? "cron" : "worker", file: path, line: 1, library: "fly-processes", evidence: { kind: "verified", file: path, note: `fly.toml process ${p}` } });
          break;
        }
        case "render": {
          const services = [...content.matchAll(/^\s*-\s*type:\s*(\w+)[\s\S]*?name:\s*([^\n]+)/gm)].map((m) => ({ type: m[1]!, name: m[2]!.trim(), line: lineOf(content, m.index) }));
          configs.push({ kind, file: path, summary: `Render blueprint with ${services.length} service${services.length === 1 ? "" : "s"}`, details: { services: services.map((s) => `${s.type}: ${s.name}`) } });
          for (const s of services) if (s.type === "worker" || s.type === "cron") jobs.push({ name: s.name, kind: s.type === "cron" ? "cron" : "worker", file: path, line: s.line, library: "render", evidence: { kind: "verified", file: path, line: s.line, note: `render.yaml ${s.type} service` } });
          break;
        }
        case "procfile": {
          const procs = [...content.matchAll(/^(\w+):\s*(.+)$/gm)].map((m) => ({ name: m[1]!, cmd: m[2]!.trim(), line: lineOf(content, m.index) }));
          configs.push({ kind, file: path, summary: `Procfile with processes: ${procs.map((p) => p.name).join(", ")}`, details: { processes: procs.map((p) => `${p.name}: ${p.cmd.slice(0, 80)}`) } });
          for (const p of procs) if (p.name !== "web" && p.name !== "release") jobs.push({ name: p.name, kind: /cron|clock|scheduler|beat/i.test(p.name + p.cmd) ? "cron" : "worker", file: path, line: p.line, library: "procfile", evidence: { kind: "verified", file: path, line: p.line, note: `Procfile process ${p.name}` } });
          break;
        }
        case "kubernetes": {
          const kinds = [...content.matchAll(/^kind:\s*(\w+)/gm)].map((m) => m[1]!);
          const names = [...content.matchAll(/^\s{2}name:\s*([\w.-]+)/gm)].map((m) => m[1]!);
          configs.push({ kind, file: path, summary: `Kubernetes manifests: ${[...new Set(kinds)].join(", ") || "unknown kinds"}`, details: { kinds, names: names.slice(0, 12) } });
          const cron = /kind:\s*CronJob[\s\S]*?schedule:\s*['"]?([^'"\n]+)['"]?/g;
          let m: RegExpExecArray | null;
          while ((m = cron.exec(content))) jobs.push({ name: names[0] ?? "cronjob", kind: "cron", schedule: m[1]!.trim(), file: path, line: lineOf(content, m.index), library: "k8s-cronjob", evidence: { kind: "verified", file: path, line: lineOf(content, m.index), note: "Kubernetes CronJob" } });
          break;
        }
        case "github-actions": {
          const name = /^name:\s*(.+)$/m.exec(content)?.[1]?.trim().replace(/^['"]|['"]$/g, "");
          const triggers = parseWorkflowTriggers(content);
          const jobNames = parseWorkflowJobs(content);
          const deployHints = [...content.matchAll(/uses:\s*([^\s@]+)/g)].map((m) => m[1]!).filter((u) => /deploy|vercel|netlify|aws|gcloud|azure|fly|heroku|docker\/build-push|ssh|kubectl|helm|terraform|pages|cloudflare|railway|render/i.test(u));
          const isDeploy = deployHints.length > 0 || /deploy|release|publish/i.test(name ?? "") || /\b(vercel|flyctl|kubectl|helm|terraform|gcloud|aws\s+(s3|ecs|lambda|cloudformation))\b/i.test(content);
          configs.push({ kind, file: path, summary: `${isDeploy ? "CI/CD" : "CI"} workflow "${name ?? base}" on ${triggers.join(", ") || "manual"}${jobNames.length ? ` · jobs: ${jobNames.join(", ")}` : ""}`, details: { name: name ?? "", triggers, jobs: jobNames, deploy: isDeploy, actions: [...new Set(deployHints)].slice(0, 8) } });
          const sched = /schedule:\s*\n(?:\s*-\s*cron:\s*['"]([^'"]+)['"]\s*\n?)+/g;
          let m: RegExpExecArray | null;
          while ((m = sched.exec(content))) {
            for (const c of m[0].matchAll(/cron:\s*['"]([^'"]+)['"]/g)) jobs.push({ name: name ?? base, kind: "cron", schedule: c[1]!, file: path, line: lineOf(content, m.index), library: "github-actions", evidence: { kind: "verified", file: path, line: lineOf(content, m.index), note: `workflow schedule ${c[1]}` } });
          }
          break;
        }
        case "serverless": {
          const service = /^service:\s*(.+)$/m.exec(content)?.[1]?.trim();
          const provider = /provider:\s*\n\s*name:\s*(\w+)/.exec(content)?.[1];
          const fns = [...content.matchAll(/^  (\w[\w-]*):\s*\n\s+handler:/gm)].map((m) => m[1]!);
          configs.push({ kind, file: path, summary: `Serverless Framework${service ? ` service "${service}"` : ""}${provider ? ` on ${provider}` : ""} · ${fns.length} function${fns.length === 1 ? "" : "s"}`, details: { service: service ?? "", provider: provider ?? "", functions: fns } });
          const sched = /-\s*schedule:\s*(?:rate\(|cron\()?([^)\n]+)\)?/g;
          let m: RegExpExecArray | null;
          while ((m = sched.exec(content))) jobs.push({ name: service ?? "serverless", kind: "cron", schedule: m[1]!.trim(), file: path, line: lineOf(content, m.index), library: "serverless-schedule", evidence: { kind: "verified", file: path, line: lineOf(content, m.index), note: "serverless schedule event" } });
          break;
        }
        case "terraform": {
          const resources = [...content.matchAll(/^resource\s+"([^"]+)"\s+"([^"]+)"/gm)].map((m) => `${m[1]}.${m[2]}`);
          configs.push({ kind, file: path, summary: `Terraform: ${resources.length} resource${resources.length === 1 ? "" : "s"}`, details: { resources: resources.slice(0, 20) } });
          break;
        }
        default:
          configs.push({ kind, file: path, summary: `${labelForKind(kind)} configuration`, details: {} });
      }
    } catch {
      configs.push({ kind, file: path, summary: `${labelForKind(kind)} configuration (could not parse)`, details: {} });
    }
  }
  return { configs, jobs };
}

export function infraKind(path: string, base: string, content: string): InfraKind | null {
  if (/^Dockerfile(\..*)?$/i.test(base) || /\.dockerfile$/i.test(base)) return "dockerfile";
  if (/^(docker-compose[^/]*|compose)\.ya?ml$/i.test(base)) return "compose";
  if (base === "vercel.json") return "vercel";
  if (base === "netlify.toml") return "netlify";
  if (base === "fly.toml") return "fly";
  if (base === "render.yaml") return "render";
  if (base === "Procfile") return "procfile";
  if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(path)) return "github-actions";
  if (/^serverless\.ya?ml$/.test(base)) return "serverless";
  if (/\.tf$/.test(base)) return "terraform";
  if (/^railway\.(json|toml)$/.test(base)) return "railway";
  if (base === "app.yaml" && /runtime:/.test(content)) return "app-engine";
  if (base === "heroku.yml") return "heroku";
  if (/\.ya?ml$/.test(base) && /^(apiVersion|kind):\s/m.test(content) && /^kind:\s*(Deployment|Service|Ingress|CronJob|Job|StatefulSet|ConfigMap|Pod|DaemonSet)/m.test(content)) return "kubernetes";
  if (/^(wrangler\.toml|firebase\.json|amplify\.yml|nixpacks\.toml|skaffold\.yaml|\.railway|now\.json)$/.test(base)) return "other";
  return null;
}

export function labelForKind(kind: InfraKind): string {
  const labels: Record<InfraKind, string> = {
    dockerfile: "Docker", compose: "Docker Compose", vercel: "Vercel", netlify: "Netlify", fly: "Fly.io", render: "Render", procfile: "Procfile (Heroku-style)",
    kubernetes: "Kubernetes", "github-actions": "GitHub Actions", serverless: "Serverless Framework", terraform: "Terraform", railway: "Railway", heroku: "Heroku", "app-engine": "Google App Engine", other: "Platform",
  };
  return labels[kind];
}

function parseComposeServices(content: string): { name: string; image?: string; line: number }[] {
  const lines = content.split("\n");
  const out: { name: string; image?: string; line: number }[] = [];
  let inServices = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^services:\s*$/.test(line)) { inServices = true; continue; }
    if (inServices && /^\S/.test(line) && !/^services:/.test(line)) inServices = false;
    if (inServices) {
      const m = /^  ([\w.-]+):\s*$/.exec(line);
      if (m) {
        let image: string | undefined;
        for (let j = i + 1; j < Math.min(lines.length, i + 30); j++) {
          if (/^  [\w.-]+:\s*$/.test(lines[j]!)) break;
          const im = /^\s+image:\s*(.+)$/.exec(lines[j]!);
          if (im) { image = im[1]!.trim().replace(/^['"]|['"]$/g, ""); break; }
        }
        out.push({ name: m[1]!, image, line: i + 1 });
      }
    }
  }
  return out;
}

function parseWorkflowTriggers(content: string): string[] {
  const m = /^(?:on|"on"):\s*(.*)$/m.exec(content);
  if (!m) return [];
  if (m[1]!.trim()) return m[1]!.replace(/[\[\]]/g, "").split(",").map((s) => s.trim()).filter(Boolean);
  const start = m.index + m[0].length;
  const rest = content.slice(start);
  const triggers: string[] = [];
  for (const line of rest.split("\n")) {
    if (/^\S/.test(line)) break;
    const t = /^  (\w+):/.exec(line);
    if (t) triggers.push(t[1]!);
  }
  return triggers;
}

function parseWorkflowJobs(content: string): string[] {
  const m = /^jobs:\s*$/m.exec(content);
  if (!m) return [];
  const rest = content.slice(m.index + m[0].length);
  const out: string[] = [];
  for (const line of rest.split("\n")) {
    if (/^\S/.test(line)) break;
    const j = /^  ([\w-]+):\s*$/.exec(line);
    if (j) out.push(j[1]!);
  }
  return out;
}

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}
