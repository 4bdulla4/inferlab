import type { Dependency, Integration, IntegrationCategory, RepoFile } from "@shared/repo";

interface CatalogEntry {
  id: string;
  name: string;
  category: IntegrationCategory;
  /** Exact dependency names, or prefixes ending in "*". Matched case-insensitively. */
  deps: string[];
  /** Env var names that indicate this integration. */
  env?: RegExp;
}

export const CATALOG: CatalogEntry[] = [
  // Frontend frameworks
  { id: "nextjs", name: "Next.js", category: "frontend-framework", deps: ["next"] },
  { id: "react", name: "React", category: "frontend-framework", deps: ["react", "react-dom"] },
  { id: "vue", name: "Vue", category: "frontend-framework", deps: ["vue"] },
  { id: "nuxt", name: "Nuxt", category: "frontend-framework", deps: ["nuxt"] },
  { id: "svelte", name: "Svelte / SvelteKit", category: "frontend-framework", deps: ["svelte", "@sveltejs/kit"] },
  { id: "angular", name: "Angular", category: "frontend-framework", deps: ["@angular/core"] },
  { id: "solid", name: "SolidJS", category: "frontend-framework", deps: ["solid-js"] },
  { id: "remix", name: "Remix", category: "frontend-framework", deps: ["@remix-run/react", "@remix-run/node"] },
  { id: "astro", name: "Astro", category: "frontend-framework", deps: ["astro"] },
  { id: "react-native", name: "React Native / Expo", category: "frontend-framework", deps: ["react-native", "expo"] },
  { id: "flutter", name: "Flutter", category: "frontend-framework", deps: ["flutter"] },
  // Backend frameworks
  { id: "express", name: "Express", category: "backend-framework", deps: ["express"] },
  { id: "fastify", name: "Fastify", category: "backend-framework", deps: ["fastify"] },
  { id: "koa", name: "Koa", category: "backend-framework", deps: ["koa"] },
  { id: "hono", name: "Hono", category: "backend-framework", deps: ["hono"] },
  { id: "nestjs", name: "NestJS", category: "backend-framework", deps: ["@nestjs/core"] },
  { id: "hapi", name: "hapi", category: "backend-framework", deps: ["@hapi/hapi"] },
  { id: "fastapi", name: "FastAPI", category: "backend-framework", deps: ["fastapi"] },
  { id: "flask", name: "Flask", category: "backend-framework", deps: ["flask"] },
  { id: "django", name: "Django", category: "backend-framework", deps: ["django"] },
  { id: "starlette", name: "Starlette", category: "backend-framework", deps: ["starlette"] },
  { id: "rails", name: "Ruby on Rails", category: "backend-framework", deps: ["rails", "railties"] },
  { id: "sinatra", name: "Sinatra", category: "backend-framework", deps: ["sinatra"] },
  { id: "gin", name: "Gin", category: "backend-framework", deps: ["github.com/gin-gonic/gin"] },
  { id: "echo", name: "Echo", category: "backend-framework", deps: ["github.com/labstack/echo*"] },
  { id: "fiber", name: "Fiber", category: "backend-framework", deps: ["github.com/gofiber/fiber*"] },
  { id: "chi", name: "chi", category: "backend-framework", deps: ["github.com/go-chi/chi*"] },
  { id: "spring", name: "Spring Boot", category: "backend-framework", deps: ["org.springframework.boot:*", "org.springframework:*"] },
  { id: "laravel", name: "Laravel", category: "backend-framework", deps: ["laravel/framework"] },
  { id: "actix", name: "Actix Web", category: "backend-framework", deps: ["actix-web"] },
  { id: "axum", name: "Axum", category: "backend-framework", deps: ["axum"] },
  { id: "rocket", name: "Rocket", category: "backend-framework", deps: ["rocket"] },
  { id: "aspnet", name: "ASP.NET", category: "backend-framework", deps: ["microsoft.aspnetcore*"] },
  // API style
  { id: "graphql", name: "GraphQL", category: "api-style", deps: ["graphql", "@apollo/server", "apollo-server", "graphql-yoga", "@graphql-tools/schema", "strawberry-graphql", "graphene", "ariadne"] },
  { id: "trpc", name: "tRPC", category: "api-style", deps: ["@trpc/server"] },
  { id: "grpc", name: "gRPC", category: "api-style", deps: ["@grpc/grpc-js", "grpcio", "google.golang.org/grpc"] },
  { id: "socketio", name: "Socket.IO", category: "realtime", deps: ["socket.io", "socket.io-client", "python-socketio"] },
  { id: "ws", name: "WebSockets (ws)", category: "realtime", deps: ["ws"] },
  { id: "pusher", name: "Pusher", category: "realtime", deps: ["pusher", "pusher-js"], env: /^PUSHER_/ },
  { id: "ably", name: "Ably", category: "realtime", deps: ["ably"], env: /^ABLY_/ },
  { id: "liveblocks", name: "Liveblocks", category: "realtime", deps: ["@liveblocks/*"], env: /^LIVEBLOCKS_/ },
  // Databases & ORMs
  { id: "prisma", name: "Prisma", category: "orm", deps: ["@prisma/client", "prisma"], env: /^DATABASE_URL$/ },
  { id: "drizzle", name: "Drizzle ORM", category: "orm", deps: ["drizzle-orm"] },
  { id: "typeorm", name: "TypeORM", category: "orm", deps: ["typeorm"] },
  { id: "sequelize", name: "Sequelize", category: "orm", deps: ["sequelize"] },
  { id: "knex", name: "Knex", category: "orm", deps: ["knex"] },
  { id: "kysely", name: "Kysely", category: "orm", deps: ["kysely"] },
  { id: "mongoose", name: "MongoDB · Mongoose", category: "database", deps: ["mongoose"], env: /MONGO/ },
  { id: "mongodb", name: "MongoDB", category: "database", deps: ["mongodb", "pymongo", "motor", "go.mongodb.org/mongo-driver"], env: /MONGO/ },
  { id: "postgres", name: "PostgreSQL", category: "database", deps: ["pg", "postgres", "psycopg2", "psycopg2-binary", "psycopg", "asyncpg", "github.com/lib/pq", "github.com/jackc/pgx*", "@vercel/postgres", "@neondatabase/serverless", "tokio-postgres", "sqlx"], env: /^(POSTGRES|PG|DATABASE_URL)/ },
  { id: "mysql", name: "MySQL", category: "database", deps: ["mysql", "mysql2", "pymysql", "mysqlclient", "github.com/go-sql-driver/mysql", "@planetscale/database"], env: /^MYSQL/ },
  { id: "sqlite", name: "SQLite", category: "database", deps: ["sqlite3", "better-sqlite3", "@libsql/client", "aiosqlite", "github.com/mattn/go-sqlite3", "rusqlite"] },
  { id: "sqlalchemy", name: "SQLAlchemy", category: "orm", deps: ["sqlalchemy", "sqlmodel"] },
  { id: "alembic", name: "Alembic migrations", category: "orm", deps: ["alembic"] },
  { id: "gorm", name: "GORM", category: "orm", deps: ["gorm.io/gorm"] },
  { id: "diesel", name: "Diesel", category: "orm", deps: ["diesel"] },
  { id: "supabase", name: "Supabase", category: "database", deps: ["@supabase/supabase-js", "@supabase/ssr", "@supabase/auth-helpers-nextjs", "supabase"], env: /SUPABASE/ },
  { id: "firebase", name: "Firebase", category: "database", deps: ["firebase", "firebase-admin", "@react-native-firebase/*"], env: /FIREBASE/ },
  { id: "convex", name: "Convex", category: "database", deps: ["convex"], env: /CONVEX/ },
  { id: "redis", name: "Redis", category: "cache", deps: ["redis", "ioredis", "@upstash/redis", "github.com/redis/go-redis*", "github.com/go-redis/redis*"], env: /REDIS|KV_URL|UPSTASH/ },
  { id: "memcached", name: "Memcached", category: "cache", deps: ["memcached", "pymemcache"] },
  { id: "dynamodb", name: "DynamoDB", category: "database", deps: ["@aws-sdk/client-dynamodb", "@aws-sdk/lib-dynamodb"] },
  // Vector databases
  { id: "pinecone", name: "Pinecone", category: "vector-db", deps: ["@pinecone-database/pinecone", "pinecone-client", "pinecone"], env: /PINECONE/ },
  { id: "weaviate", name: "Weaviate", category: "vector-db", deps: ["weaviate-ts-client", "weaviate-client"], env: /WEAVIATE/ },
  { id: "chroma", name: "Chroma", category: "vector-db", deps: ["chromadb"], env: /CHROMA/ },
  { id: "qdrant", name: "Qdrant", category: "vector-db", deps: ["@qdrant/js-client-rest", "qdrant-client"], env: /QDRANT/ },
  { id: "pgvector", name: "pgvector", category: "vector-db", deps: ["pgvector"] },
  // Auth
  { id: "nextauth", name: "NextAuth / Auth.js", category: "auth", deps: ["next-auth", "@auth/core", "@auth/*"], env: /^(NEXTAUTH_|AUTH_)/ },
  { id: "clerk", name: "Clerk", category: "auth", deps: ["@clerk/*"], env: /CLERK/ },
  { id: "auth0", name: "Auth0", category: "auth", deps: ["@auth0/*", "auth0", "express-openid-connect"], env: /AUTH0/ },
  { id: "passport", name: "Passport", category: "auth", deps: ["passport", "passport-*"] },
  { id: "jwt", name: "JSON Web Tokens", category: "auth", deps: ["jsonwebtoken", "jose", "pyjwt", "python-jose", "github.com/golang-jwt/jwt*", "jsonwebtoken"], env: /JWT/ },
  { id: "bcrypt", name: "Password hashing (bcrypt/argon2)", category: "auth", deps: ["bcrypt", "bcryptjs", "argon2", "passlib", "golang.org/x/crypto"] },
  { id: "lucia", name: "Lucia", category: "auth", deps: ["lucia"] },
  { id: "better-auth", name: "Better Auth", category: "auth", deps: ["better-auth"] },
  { id: "kinde", name: "Kinde", category: "auth", deps: ["@kinde-oss/*"], env: /KINDE/ },
  { id: "flask-login", name: "Flask-Login", category: "auth", deps: ["flask-login", "flask-jwt-extended"] },
  { id: "authlib", name: "Authlib / OAuth", category: "auth", deps: ["authlib", "oauthlib", "requests-oauthlib"] },
  { id: "django-auth", name: "Django auth (allauth / rest-framework)", category: "auth", deps: ["django-allauth", "djangorestframework-simplejwt", "dj-rest-auth"] },
  { id: "devise", name: "Devise", category: "auth", deps: ["devise"] },
  { id: "spring-security", name: "Spring Security", category: "auth", deps: ["org.springframework.boot:spring-boot-starter-security", "org.springframework.security:*"] },
  // AI
  { id: "anthropic", name: "Anthropic Claude API", category: "ai", deps: ["@anthropic-ai/sdk", "anthropic", "@anthropic-ai/*", "github.com/anthropics/anthropic-sdk-go"], env: /ANTHROPIC/ },
  { id: "openai", name: "OpenAI API", category: "ai", deps: ["openai", "github.com/sashabaranov/go-openai", "async-openai"], env: /OPENAI/ },
  { id: "vercel-ai", name: "Vercel AI SDK", category: "ai", deps: ["ai", "@ai-sdk/*"] },
  { id: "langchain", name: "LangChain", category: "ai", deps: ["langchain", "@langchain/*", "langchain-*", "langgraph", "@langchain/langgraph"] },
  { id: "llamaindex", name: "LlamaIndex", category: "ai", deps: ["llamaindex", "llama-index", "llama-index-*"] },
  { id: "gemini", name: "Google Gemini", category: "ai", deps: ["@google/generative-ai", "@google/genai", "google-generativeai", "google-genai"], env: /GEMINI|GOOGLE_API_KEY|GOOGLE_GENERATIVE/ },
  { id: "cohere", name: "Cohere", category: "ai", deps: ["cohere-ai", "cohere"], env: /COHERE/ },
  { id: "mistral", name: "Mistral", category: "ai", deps: ["@mistralai/mistralai", "mistralai"], env: /MISTRAL/ },
  { id: "groq", name: "Groq", category: "ai", deps: ["groq-sdk", "groq"], env: /GROQ/ },
  { id: "replicate", name: "Replicate", category: "ai", deps: ["replicate"], env: /REPLICATE/ },
  { id: "huggingface", name: "Hugging Face", category: "ai", deps: ["@huggingface/*", "transformers", "huggingface_hub", "sentence-transformers"], env: /HF_|HUGGINGFACE/ },
  { id: "ollama", name: "Ollama", category: "ai", deps: ["ollama", "ollama-ai-provider"], env: /OLLAMA/ },
  { id: "elevenlabs", name: "ElevenLabs", category: "ai", deps: ["elevenlabs", "@elevenlabs/*"], env: /ELEVENLABS/ },
  { id: "deepgram", name: "Deepgram", category: "ai", deps: ["@deepgram/sdk", "deepgram-sdk"], env: /DEEPGRAM/ },
  { id: "bedrock", name: "AWS Bedrock", category: "ai", deps: ["@aws-sdk/client-bedrock-runtime", "@ai-sdk/amazon-bedrock", "@anthropic-ai/bedrock-sdk"] },
  { id: "tiktoken", name: "Tokenizer (tiktoken)", category: "ai", deps: ["tiktoken", "js-tiktoken", "gpt-tokenizer", "@dqbd/tiktoken"] },
  // Queues, workers, cron
  { id: "bullmq", name: "BullMQ", category: "queue", deps: ["bullmq", "bull", "bee-queue"] },
  { id: "kafka", name: "Kafka", category: "queue", deps: ["kafkajs", "kafka-python", "confluent-kafka", "github.com/segmentio/kafka-go", "github.com/confluentinc/confluent-kafka-go*"], env: /KAFKA/ },
  { id: "rabbitmq", name: "RabbitMQ (AMQP)", category: "queue", deps: ["amqplib", "pika", "aio-pika", "github.com/rabbitmq/amqp091-go", "github.com/streadway/amqp"], env: /RABBIT|AMQP/ },
  { id: "sqs", name: "AWS SQS", category: "queue", deps: ["@aws-sdk/client-sqs", "sqs-consumer"], env: /SQS/ },
  { id: "celery", name: "Celery", category: "worker", deps: ["celery"], env: /CELERY/ },
  { id: "rq", name: "RQ / Dramatiq / Huey", category: "worker", deps: ["rq", "dramatiq", "huey"] },
  { id: "sidekiq", name: "Sidekiq", category: "worker", deps: ["sidekiq", "sidekiq-cron"] },
  { id: "asynq", name: "Asynq", category: "worker", deps: ["github.com/hibiken/asynq"] },
  { id: "temporal", name: "Temporal", category: "worker", deps: ["@temporalio/*", "temporalio", "go.temporal.io/sdk"] },
  { id: "inngest", name: "Inngest", category: "worker", deps: ["inngest"], env: /INNGEST/ },
  { id: "triggerdev", name: "Trigger.dev", category: "worker", deps: ["@trigger.dev/*"], env: /TRIGGER_/ },
  { id: "graphile", name: "Graphile Worker / pg-boss", category: "queue", deps: ["graphile-worker", "pg-boss"] },
  { id: "node-cron", name: "node-cron / cron", category: "cron", deps: ["node-cron", "cron", "croner", "node-schedule", "agenda"] },
  { id: "apscheduler", name: "APScheduler / schedule", category: "cron", deps: ["apscheduler", "schedule"] },
  { id: "robfig-cron", name: "robfig/cron", category: "cron", deps: ["github.com/robfig/cron*", "github.com/go-co-op/gocron*"] },
  // Payments
  { id: "stripe", name: "Stripe", category: "payments", deps: ["stripe", "@stripe/*", "github.com/stripe/stripe-go*"], env: /STRIPE/ },
  { id: "paypal", name: "PayPal", category: "payments", deps: ["@paypal/*", "paypal-rest-sdk", "paypalrestsdk"], env: /PAYPAL/ },
  { id: "lemonsqueezy", name: "Lemon Squeezy", category: "payments", deps: ["@lemonsqueezy/*"], env: /LEMON/ },
  { id: "paddle", name: "Paddle", category: "payments", deps: ["@paddle/*"], env: /PADDLE/ },
  { id: "razorpay", name: "Razorpay", category: "payments", deps: ["razorpay"], env: /RAZORPAY/ },
  // Email
  { id: "resend", name: "Resend", category: "email", deps: ["resend"], env: /RESEND/ },
  { id: "sendgrid", name: "SendGrid", category: "email", deps: ["@sendgrid/mail", "sendgrid"], env: /SENDGRID/ },
  { id: "nodemailer", name: "Nodemailer (SMTP)", category: "email", deps: ["nodemailer"], env: /SMTP|EMAIL_SERVER/ },
  { id: "postmark", name: "Postmark", category: "email", deps: ["postmark"], env: /POSTMARK/ },
  { id: "mailgun", name: "Mailgun", category: "email", deps: ["mailgun.js", "mailgun-js"], env: /MAILGUN/ },
  { id: "react-email", name: "React Email", category: "email", deps: ["@react-email/*", "react-email"] },
  // Storage
  { id: "s3", name: "AWS S3", category: "storage", deps: ["@aws-sdk/client-s3", "aws-sdk", "boto3", "github.com/aws/aws-sdk-go*", "@aws-sdk/s3-request-presigner"], env: /^(AWS_|S3_)/ },
  { id: "cloudinary", name: "Cloudinary", category: "storage", deps: ["cloudinary", "next-cloudinary"], env: /CLOUDINARY/ },
  { id: "vercel-blob", name: "Vercel Blob", category: "storage", deps: ["@vercel/blob"], env: /BLOB_READ_WRITE_TOKEN/ },
  { id: "gcs", name: "Google Cloud Storage", category: "storage", deps: ["@google-cloud/storage", "google-cloud-storage"] },
  { id: "uploadthing", name: "UploadThing", category: "storage", deps: ["uploadthing", "@uploadthing/*"], env: /UPLOADTHING/ },
  { id: "multer", name: "File uploads (multer)", category: "storage", deps: ["multer", "formidable", "busboy"] },
  // Analytics & monitoring
  { id: "sentry", name: "Sentry", category: "monitoring", deps: ["@sentry/*", "sentry-sdk", "github.com/getsentry/sentry-go"], env: /SENTRY/ },
  { id: "posthog", name: "PostHog", category: "analytics", deps: ["posthog-js", "posthog-node", "posthog"], env: /POSTHOG/ },
  { id: "mixpanel", name: "Mixpanel", category: "analytics", deps: ["mixpanel", "mixpanel-browser"], env: /MIXPANEL/ },
  { id: "segment", name: "Segment", category: "analytics", deps: ["@segment/*", "analytics-node"], env: /SEGMENT/ },
  { id: "vercel-analytics", name: "Vercel Analytics", category: "analytics", deps: ["@vercel/analytics", "@vercel/speed-insights"] },
  { id: "ga", name: "Google Analytics", category: "analytics", deps: ["react-ga4", "@next/third-parties"], env: /GA_|GOOGLE_ANALYTICS/ },
  { id: "datadog", name: "Datadog", category: "monitoring", deps: ["dd-trace", "@datadog/*", "ddtrace"], env: /DD_|DATADOG/ },
  { id: "otel", name: "OpenTelemetry", category: "monitoring", deps: ["@opentelemetry/*", "opentelemetry-*", "go.opentelemetry.io/*"] },
  { id: "langfuse", name: "Langfuse", category: "monitoring", deps: ["langfuse", "langfuse-*"], env: /LANGFUSE/ },
  { id: "langsmith", name: "LangSmith", category: "monitoring", deps: ["langsmith"], env: /LANGCHAIN_|LANGSMITH/ },
  { id: "logging", name: "Structured logging", category: "monitoring", deps: ["pino", "winston", "loguru", "structlog", "go.uber.org/zap", "github.com/sirupsen/logrus", "tracing"] },
  // Search
  { id: "algolia", name: "Algolia", category: "search", deps: ["algoliasearch", "react-instantsearch*"], env: /ALGOLIA/ },
  { id: "meilisearch", name: "Meilisearch", category: "search", deps: ["meilisearch"], env: /MEILI/ },
  { id: "elasticsearch", name: "Elasticsearch", category: "search", deps: ["@elastic/elasticsearch", "elasticsearch", "github.com/elastic/go-elasticsearch*"], env: /ELASTIC/ },
  { id: "typesense", name: "Typesense", category: "search", deps: ["typesense"], env: /TYPESENSE/ },
  // External services
  { id: "twilio", name: "Twilio", category: "external", deps: ["twilio"], env: /TWILIO/ },
  { id: "slack", name: "Slack API", category: "external", deps: ["@slack/*", "slack_sdk", "slack-sdk", "github.com/slack-go/slack"], env: /SLACK/ },
  { id: "discord", name: "Discord API", category: "external", deps: ["discord.js", "discord.py", "discord-interactions"], env: /DISCORD/ },
  { id: "github-api", name: "GitHub API", category: "external", deps: ["@octokit/*", "octokit", "pygithub", "github.com/google/go-github*"], env: /GITHUB_TOKEN|GH_TOKEN/ },
  { id: "google-apis", name: "Google APIs", category: "external", deps: ["googleapis", "google-api-python-client", "google-auth"], env: /GOOGLE_CLIENT/ },
  { id: "notion", name: "Notion API", category: "external", deps: ["@notionhq/client", "notion-client"], env: /NOTION/ },
  { id: "telegram", name: "Telegram Bot API", category: "external", deps: ["telegraf", "node-telegram-bot-api", "python-telegram-bot", "aiogram"], env: /TELEGRAM/ },
  { id: "maps", name: "Maps (Google/Mapbox)", category: "external", deps: ["@googlemaps/*", "mapbox-gl", "react-map-gl", "@react-google-maps/api"], env: /MAPBOX|GOOGLE_MAPS/ },
  { id: "puppeteer", name: "Browser automation", category: "external", deps: ["puppeteer", "puppeteer-core", "playwright-core"] },
  // Testing
  { id: "jest", name: "Jest / Vitest", category: "testing", deps: ["jest", "vitest", "@testing-library/*"] },
  { id: "pytest", name: "pytest", category: "testing", deps: ["pytest", "pytest-*"] },
  { id: "playwright", name: "Playwright / Cypress (e2e)", category: "testing", deps: ["@playwright/test", "cypress"] },
  // Build
  { id: "vite", name: "Vite", category: "build", deps: ["vite"] },
  { id: "webpack", name: "webpack", category: "build", deps: ["webpack"] },
  { id: "tailwind", name: "Tailwind CSS", category: "build", deps: ["tailwindcss"] },
  { id: "turborepo", name: "Turborepo", category: "build", deps: ["turbo"] },
  { id: "docker-sdk", name: "Docker SDK", category: "deployment", deps: ["dockerode", "docker"] },
];

function matches(pattern: string, dep: string): boolean {
  const p = pattern.toLowerCase();
  const d = dep.toLowerCase();
  if (p.endsWith("*")) return d.startsWith(p.slice(0, -1));
  return d === p;
}

/**
 * Detects integrations from dependencies, import specifiers and env var names.
 * Every detection carries verified evidence (manifest line or import site).
 */
export function detectIntegrations(dependencies: Dependency[], files: RepoFile[], envNames: string[]): Integration[] {
  const results = new Map<string, Integration>();

  const ensure = (entry: CatalogEntry): Integration => {
    let it = results.get(entry.id);
    if (!it) {
      it = { id: entry.id, name: entry.name, category: entry.category, evidence: [], dependencies: [], files: [], envVars: [] };
      results.set(entry.id, it);
    }
    return it;
  };

  for (const dep of dependencies) {
    for (const entry of CATALOG) {
      if (entry.deps.some((p) => matches(p, dep.name))) {
        const it = ensure(entry);
        if (!it.dependencies.includes(dep.name)) it.dependencies.push(dep.name);
        if (it.evidence.length < 6) it.evidence.push({ kind: "verified", file: dep.manifest, note: `dependency ${dep.name}${dep.version ? ` ${dep.version}` : ""}` });
      }
    }
  }

  for (const file of files) {
    for (const imp of file.imports) {
      if (!imp.external) continue;
      const spec = normalizeSpecifier(imp.source);
      for (const entry of CATALOG) {
        if (entry.deps.some((p) => matches(p, spec) || (p.endsWith("*") && spec.startsWith(p.slice(0, -1))))) {
          const it = ensure(entry);
          if (!it.files.includes(file.path)) it.files.push(file.path);
          if (!it.dependencies.includes(spec)) it.dependencies.push(spec);
          if (it.evidence.length < 6) it.evidence.push({ kind: "verified", file: file.path, line: imp.line, note: `imports ${imp.source}` });
        }
      }
    }
  }

  for (const name of envNames) {
    for (const entry of CATALOG) {
      if (entry.env?.test(name)) {
        const it = ensure(entry);
        if (!it.envVars.includes(name)) it.envVars.push(name);
        if (it.evidence.length < 6) it.evidence.push({ kind: "verified", note: `env var ${name}` });
      }
    }
  }

  // Skip env-only detections for generic integrations that need a dependency (e.g. "postgres" via DATABASE_URL alone is a guess).
  return [...results.values()].filter((it) => it.dependencies.length > 0 || it.files.length > 0 || ["stripe", "supabase", "clerk", "openai", "anthropic", "sentry", "posthog", "redis"].includes(it.id))
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

/** "@scope/pkg/sub/path" → "@scope/pkg"; "pkg/sub" → "pkg"; python "a.b.c" → "a". */
export function normalizeSpecifier(source: string): string {
  if (source.startsWith("@")) {
    const parts = source.split("/");
    return parts.slice(0, 2).join("/");
  }
  if (source.includes("/") && !source.startsWith("github.com") && !source.startsWith("go.") && !source.startsWith("golang.org")) return source.split("/")[0]!;
  if (source.startsWith("github.com") || source.startsWith("golang.org") || source.startsWith("go.")) return source.split("/").slice(0, 3).join("/");
  return source.split(".")[0]!.replace(/_/g, "-").toLowerCase() === source.toLowerCase() ? source : source.split(".")[0]!;
}

export const FRONTEND_FRAMEWORK_IDS = new Set(["nextjs", "react", "vue", "nuxt", "svelte", "angular", "solid", "remix", "astro", "react-native", "flutter"]);
export const BACKEND_FRAMEWORK_IDS = new Set(["express", "fastify", "koa", "hono", "nestjs", "hapi", "fastapi", "flask", "django", "starlette", "rails", "sinatra", "gin", "echo", "fiber", "chi", "spring", "laravel", "actix", "axum", "rocket", "aspnet"]);
