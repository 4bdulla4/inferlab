import type { Language, ScheduledJob } from "@shared/repo";

export function detectJobs(path: string, content: string, lang: Language): ScheduledJob[] {
  const out: ScheduledJob[] = [];
  const push = (name: string, kind: ScheduledJob["kind"], library: string, index: number, schedule?: string) => {
    const line = lineOf(content, index);
    if (out.some((j) => j.name === name && j.line === line)) return;
    out.push({ name, kind, schedule, file: path, line, library, evidence: { kind: "verified", file: path, line, note: `${library} definition` } });
  };
  let m: RegExpExecArray | null;

  if (lang === "typescript" || lang === "javascript") {
    const cron = /\bcron\.schedule\(\s*['"`]([^'"`]+)['"`]/g;
    while ((m = cron.exec(content))) push(`cron ${m[1]}`, "cron", "node-cron", m.index, m[1]);
    const cronJob = /new\s+(?:CronJob|Cron)\(\s*['"`]([^'"`]+)['"`]/g;
    while ((m = cronJob.exec(content))) push(`cron ${m[1]}`, "cron", "cron", m.index, m[1]);
    const sched = /schedule\.scheduleJob\(\s*(?:['"`]([^'"`]+)['"`]\s*,\s*)?['"`]([^'"`]+)['"`]/g;
    while ((m = sched.exec(content))) push(m[1] ?? `job ${m[2]}`, "cron", "node-schedule", m.index, m[2]);
    const queue = /new\s+Queue(?:Scheduler)?\s*(?:<[^>]*>)?\(\s*['"`]([^'"`]+)['"`]/g;
    while ((m = queue.exec(content))) push(m[1]!, "queue", "bullmq", m.index);
    const worker = /new\s+Worker\s*(?:<[^>]*>)?\(\s*['"`]([^'"`]+)['"`]/g;
    while ((m = worker.exec(content))) push(m[1]!, "worker", "bullmq", m.index);
    const agendaDefine = /agenda\.define\(\s*['"`]([^'"`]+)['"`]/g;
    while ((m = agendaDefine.exec(content))) push(m[1]!, "task", "agenda", m.index);
    const agendaEvery = /agenda\.every\(\s*['"`]([^'"`]+)['"`]\s*,\s*['"`]([^'"`]+)['"`]/g;
    while ((m = agendaEvery.exec(content))) push(m[2]!, "cron", "agenda", m.index, m[1]);
    const inngest = /createFunction\(\s*\{[^}]*?\bid:\s*['"`]([^'"`]+)['"`][^}]*\}\s*,\s*\{\s*(?:cron:\s*['"`]([^'"`]+)['"`]|event:\s*['"`]([^'"`]+)['"`])/g;
    while ((m = inngest.exec(content))) push(m[1]!, m[2] ? "cron" : "task", "inngest", m.index, m[2]);
    const trigger = /(?:defineJob|task|schedules\.task)\(\s*\{[^}]*?\bid:\s*['"`]([^'"`]+)['"`]/g;
    while ((m = trigger.exec(content))) if (/@trigger\.dev/.test(content)) push(m[1]!, /schedules\.task/.test(m[0]) ? "cron" : "task", "trigger.dev", m.index);
    const temporal = /Worker\.create\(\s*\{[^}]*?taskQueue:\s*['"`]([^'"`]+)['"`]/g;
    while ((m = temporal.exec(content))) push(m[1]!, "worker", "temporal", m.index);
    const kafka = /\.consumer\(\s*\{[^}]*?groupId:\s*['"`]([^'"`]+)['"`]/g;
    while ((m = kafka.exec(content))) push(m[1]!, "worker", "kafkajs", m.index);
    const sqs = /Consumer\.create\(\s*\{[^}]*?queueUrl/g;
    while ((m = sqs.exec(content))) push("sqs consumer", "worker", "sqs-consumer", m.index);
  }
  if (lang === "python") {
    const celery = /@(?:[\w.]+\.)?(?:shared_task|task)\b[^\n]*\n\s*(?:async\s+)?def\s+(\w+)/g;
    while ((m = celery.exec(content))) push(m[1]!, "task", "celery", m.index);
    const beat = /['"]([\w.-]+)['"]\s*:\s*\{[^}]*?['"]schedule['"]\s*:\s*([^,}\n]+)/g;
    if (/beat_schedule|CELERYBEAT_SCHEDULE/.test(content)) while ((m = beat.exec(content))) push(m[1]!, "cron", "celery-beat", m.index, m[2]!.trim());
    const aps = /add_job\(\s*(\w+)[^)]*?(?:trigger\s*=\s*)?['"](cron|interval|date)['"]/g;
    while ((m = aps.exec(content))) push(m[1]!, "cron", "apscheduler", m.index, m[2]);
    const apsDec = /@\w+\.scheduled_job\(\s*['"](cron|interval)['"]([^)]*)\)\s*\n\s*(?:async\s+)?def\s+(\w+)/g;
    while ((m = apsDec.exec(content))) push(m[3]!, "cron", "apscheduler", m.index, `${m[1]}${m[2]}`.slice(0, 60));
    const schedule = /schedule\.every\(([^)]*)\)\.(\w+)(?:\.at\(['"]([^'"]+)['"]\))?\.do\(\s*(\w+)/g;
    while ((m = schedule.exec(content))) push(m[4]!, "cron", "schedule", m.index, `every ${m[1]} ${m[2]}${m[3] ? ` at ${m[3]}` : ""}`);
    const dramatiq = /@(?:dramatiq\.)?actor\b[^\n]*\n\s*def\s+(\w+)/g;
    while ((m = dramatiq.exec(content))) push(m[1]!, "task", "dramatiq", m.index);
    const rqJob = /@job\(\s*['"]([^'"]+)['"]/g;
    while ((m = rqJob.exec(content))) push(m[1]!, "task", "rq", m.index);
    const fastapiRepeat = /@repeat_every\(\s*seconds\s*=\s*([\d.]+)[^)]*\)\s*\n\s*(?:async\s+)?def\s+(\w+)/g;
    while ((m = fastapiRepeat.exec(content))) push(m[2]!, "cron", "fastapi-utils", m.index, `every ${m[1]}s`);
  }
  if (lang === "ruby") {
    const sidekiq = /class\s+(\w+)\s*(?:<\s*(?:ApplicationJob|ActiveJob::Base))?[\s\S]{0,200}?include\s+Sidekiq::(?:Worker|Job)/g;
    while ((m = sidekiq.exec(content))) push(m[1]!, "worker", "sidekiq", m.index);
    const job = /class\s+(\w+)\s*<\s*ApplicationJob/g;
    while ((m = job.exec(content))) push(m[1]!, "task", "activejob", m.index);
    const whenever = /^\s*every\s+([^\n]+?)\s+do\s*$/gm;
    while ((m = whenever.exec(content))) push(`every ${m[1]}`, "cron", "whenever", m.index, m[1]);
  }
  if (lang === "go") {
    const addFunc = /\.(?:AddFunc|AddJob|Cron|Every)\(\s*"([^"]+)"/g;
    while ((m = addFunc.exec(content))) push(`cron ${m[1]}`, "cron", "robfig/cron", m.index, m[1]);
    const asynq = /asynq\.NewServer\(/g;
    while ((m = asynq.exec(content))) push("asynq server", "worker", "asynq", m.index);
    const handleFunc = /mux\.HandleFunc\(\s*(\w+)\s*,/g;
    if (/asynq/.test(content)) while ((m = handleFunc.exec(content))) push(m[1]!, "task", "asynq", m.index);
    const kafka = /kafka\.NewReader\(/g;
    while ((m = kafka.exec(content))) push("kafka reader", "worker", "kafka-go", m.index);
  }
  if (lang === "java" || lang === "kotlin") {
    const scheduled = /@Scheduled\(\s*(?:cron\s*=\s*"([^"]+)"|fixedRate\s*=\s*(\d+)|fixedDelay\s*=\s*(\d+))[^)]*\)\s*\n\s*(?:public\s+)?(?:fun\s+)?[\w<>]*\s*(\w+)\s*\(/g;
    while ((m = scheduled.exec(content))) push(m[4]!, "cron", "spring-scheduling", m.index, m[1] ?? (m[2] ? `every ${m[2]}ms` : `delay ${m[3]}ms`));
    const listeners = /@(KafkaListener|RabbitListener|SqsListener|JmsListener)\(/g;
    while ((m = listeners.exec(content))) push(m[1]!, "worker", m[1]!.toLowerCase(), m.index);
  }
  if (lang === "php") {
    const artisan = /\$schedule->(?:command|job|call)\(\s*([^)]*)\)\s*->(\w+)\(/g;
    while ((m = artisan.exec(content))) push(m[1]!.replace(/['"]/g, "").slice(0, 60), "cron", "laravel-scheduler", m.index, m[2]);
    const jobClass = /class\s+(\w+)\s+implements\s+ShouldQueue/g;
    while ((m = jobClass.exec(content))) push(m[1]!, "task", "laravel-queue", m.index);
  }
  return out;
}

/** Call sites that push work onto a queue — used for verified "enqueues" edges. */
export function detectEnqueueSites(content: string): number[] {
  const out: number[] = [];
  const re = /\b\w*(?:queue|Queue)\w*\.(?:add|addBulk|enqueue|send|publish|push)\(|\.delay\(|\.apply_async\(|\.enqueue\(|perform_later|perform_async|inngest\.send\(|\.trigger\(|\.sendMessage\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) && out.length < 40) out.push(lineOf(content, m.index));
  return out;
}

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}
