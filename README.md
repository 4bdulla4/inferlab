# inferLab

**Watch AI systems actually run.** LLM requests, RAG retrieval, agent loops and machine-learning
training, stage by stage, at a pace you control — with real computation clearly separated from
educational simulation.

Bring your own API key. Everything runs on your machine; nothing is hosted, and no key ever leaves
your backend.

```bash
git clone https://github.com/4bdulla4/inferlab.git
cd inferlab && npm install
cp .env.example .env      # add a key, or set LLM_MOCK_PROVIDER=on to run offline
npm run dev               # web on :5173, API on :8790
```

---

## The honesty contract

Most "how AI works" visualizers quietly make things up. Attention heatmaps that no API ever
returned, embedding plots invented for the animation, confident diagrams of internals that are
proprietary and unobservable.

inferLab does not do that. Every value on screen carries its provenance, and the two are never
blurred:

| Badge | Meaning |
|---|---|
| **● LIVE** | Really computed or really observed: the actual request and streamed response, real usage and latency, real parsed rows, real fitted weights, real gradients, real metrics, real tool executions. |
| **◇ SIMULATION** | A labelled stand-in for something the API does not expose, or a deliberate simplification — always marked, never presented as an internal. |

Concretely:

- Transformer internals (embeddings, positional information, attention, MLP) are **always**
  simulation. No provider exposes them.
- Candidate token probabilities are **live** only when the provider returns logprobs, otherwise
  labelled simulation with the genuinely selected token highlighted.
- Tokenization is exact for OpenAI (published BPE) and approximate-and-labelled for Claude, whose
  tokenizer is private. The real input token count comes live from Anthropic's counting endpoint.
- In the ML lab, every number is real computation on your rows. The only stand-in is a 2-D decision
  surface for a model with more than two features, which says so and explains that the other
  features are held at their mean.
- The agent lab never invents a model's private reasoning. It shows only observable states.

If something cannot be observed honestly, it is labelled or it is not shown.

---

## The labs

| Lab | What you watch |
|---|---|
| **LLM** | A request execute end to end: input → request preparation → tokenization → token ids → embeddings → positional information → transformer → logits → probabilities → token selection → the autoregressive loop → detokenization → response. |
| **RAG** | Documents become an index and a question finds its way through it: chunking, overlap, embedding, the vector store, search, top-K, the assembled context, the prompt, and an answer traced back to the passages it cited. |
| **Agents** | An agent loop turn by turn: goal, instructions, context, planning, tool selection, real tool execution, observation, state update, the next decision, retries, fallbacks, parallel calls, human approval gates, and termination. |
| **ML** | A model train for real: ingestion, inspection, cleaning, imputation, encoding, scaling, splitting, then the loop — forward, loss, gradient, backprop, update — epoch by epoch, then validation, testing, evaluation and inference on a row you type. Eight algorithms. |
| **GitHub Analyzer** | A public repository read and mapped: frontend, backend, routes, schema, auth, dependencies, integrations, jobs and deploy config, drawn as an architecture diagram with real files and line numbers attached, and the code path behind a question traced on it. |
| **Pipelines** | How the Claude, OpenAI and Gemini request paths genuinely differ, stage by stage. |
| **Dashboard** | Everything the platform has done: analyses, model calls, training runs, token usage over time. |

Every lab shares one engine: an append-only event log, a playback controller (0.25×–4×, pause,
single-step, replay), a pure reducer, and a provenance-tagged event envelope. Pausing the
visualization never blocks the real work, and a replay redraws the identical run.

---

## Where your keys go

This matters if you are going to paste a key into something you cloned off the internet, so it is
worth being precise:

- Provider SDKs are imported **only** under `server/`. The browser never talks to Anthropic, OpenAI
  or Google directly.
- A key you enter in the Settings drawer is held in that browser profile and sent to *your own*
  backend as a request header. It is never logged, echoed back, or written to the activity log.
- **Save to .env** writes the key to a gitignored `.env` on the machine running the server. That
  endpoint accepts requests only from localhost.
- Error messages are scrubbed of anything key-shaped before they reach the browser.
- `.env` and `.env.*` are gitignored (`.env.example` is the only exception, and it holds empty
  placeholders).
- Uploaded documents and datasets stay in memory on your machine and expire two hours after you
  stop.

No key? Set `LLM_MOCK_PROVIDER=on` in `.env` for an offline provider that streams a canned answer
with no network calls. It is banner-labelled as a simulation and never appears unless you set that
flag. The ML lab needs no key at all — it computes everything locally.

---

## Installation

### Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| **Node.js** | 22.12+, 24.x, or 26+ | Vite needs 22.12 or newer; Vitest supports only the even-numbered LTS lines, so Node 23 and 25 will not work. Check with `node -v`. |
| **npm** | 10+ | Ships with Node. Yarn and pnpm work too. |
| **git** | any | Only to clone. |

No database, no Docker, no cloud account. An API key is optional — see step 3.

### 1. Clone

```bash
git clone https://github.com/4bdulla4/inferlab.git
cd inferlab
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure

```bash
cp .env.example .env
```

Open `.env` and either add a provider key, or add neither and run offline:

- **With a key** — set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GEMINI_API_KEY`. Any one is enough;
  the app enables the labs it can serve and tells you what is missing. You can also paste a key into
  the in-app Settings drawer later instead of editing this file.
- **Without a key** — set `LLM_MOCK_PROVIDER=on`. You get an offline provider that streams a canned
  answer, clearly labelled as a simulation. The **ML lab needs no key at all**, because it computes
  everything locally, so it is a good place to start.

Every variable is documented under [Configuration](#configuration).

### 4. Run

```bash
npm run dev
```

This starts both processes: the web app on **http://localhost:5173** and the API on **:8790**.
Open the web address; the API is proxied under `/api` and you do not visit it directly.

### 5. Verify

Open http://localhost:5173, choose **ML** in the top navigation, keep the pre-selected flower
dataset and press **RUN**. A model trains end to end with no key and no network, which confirms the
install is sound. To check a provider key instead, use the **LLM** lab and press **RUN** there.

### Running in production

```bash
npm run build      # typechecks all three projects, then bundles the client
npm start          # one Node process serves dist/ and the API
```

`npm start` honours `API_PORT` and serves the built client from the same origin, so no proxy is
needed.

### Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `EADDRINUSE` on 5173 or 8790 | Something else holds the port. Set `API_PORT` in `.env` for the API; pass `--port` to Vite for the web app. |
| The dataset panel is stuck on "connecting" | The API is not up yet or restarted. It retries for about 25 seconds, then shows a **Try again** button. |
| Vitest refuses to start | You are on an odd-numbered Node release (23 or 25). Switch to 22, 24 or 26. |
| A provider says the key is missing | `.env` is read at server start; restart `npm run dev` after editing it. Values in `.env` deliberately override any stale key exported in your shell. |
| Rate limits in the GitHub Analyzer | Unauthenticated GitHub allows 60 requests/hour. Add `GITHUB_TOKEN` to raise it to 5,000. |

---

## Configuration

Copy `.env.example` to `.env` and fill in what you need. Every value is optional; the app tells you
what is missing.

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude. Also powers optional AI summaries in the analyzer. |
| `OPENAI_API_KEY` | OpenAI. Returns real logprobs, so the probability stage is live. |
| `GEMINI_API_KEY` | Gemini. |
| `GITHUB_TOKEN` | Private repositories, and raises the analyzer's rate limit from 60 to 5,000 req/hour. |
| `ANTHROPIC_WORKSPACE_ID` | Needed for org-level Anthropic keys not scoped to a workspace. |
| `API_PORT` | API port, default `8790`. |
| `LLM_MOCK_PROVIDER` | `on` to add the offline demo provider. |

`.env` takes precedence over variables already exported in your shell, so a stale key in your
profile cannot shadow the one you configure.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server + API server with an `/api` proxy |
| `npm run build` | Typecheck all three projects, then build the client bundle |
| `npm start` | Serve `dist/` and the API from one Node process |
| `npm test` | The full Vitest suite |
| `npm run typecheck` | `tsc -b` across client, server and tooling configs |
| `npm run analyze -- <url>` | Analyze a repository from the terminal |

---

## Architecture

```
browser                                  node backend
──────────────────────────────────────   ───────────────────────────────────
  RUN ─▶ runtime.start()                 POST /api/{llm,rag,ml,agent}/…  (SSE)
           │                                 │
           ▼                                 ▼
    EventBus ◀──────── SSE ──────────── provider adapters / engines
           │  server events                  ├─ Claude · OpenAI · Gemini · Mock
           ▼                                 ├─ RAG: chunk · embed · index · search
    Sequencer                                ├─ ML: 8 algorithms, real training
    live + simulation events                 └─ Agents: tool runner, approval gates
           │
           ▼
    execution log ──▶ PlaybackController ──▶ pure reducer ──▶ visual state
                      speed · pause · step · replay              │
                                                                 ▼
                                             pipeline graph · timeline · inspector
```

Design decisions worth knowing:

- **Two systems, not one.** The engine fills an append-only log as fast as the server streams. The
  playback controller applies events to the visual state at a controllable pace. These are
  independent, which is why pausing never blocks the network and replay is exact.
- **Events carry provenance.** Every event has `source: "live" | "simulation"`. The reducer records
  it per node, so badges, edges and particles are colored by provenance rather than by guesswork.
- **Deterministic simulation.** Anything simulated is generated from a seeded PRNG, so replays are
  identical and tests are stable.
- **Pure reducers.** Visual state is rebuilt from the log by a function with no timers and no side
  effects, which is what makes replay and single-stepping trustworthy.
- **Real computation server-side.** The ML lab genuinely trains: mini-batch gradient descent with
  SGD/momentum/Adam, CART trees, random forests with out-of-bag scoring, KNN, Gaussian Naive Bayes
  and a neural network with backpropagation. Nothing is faked to make a nicer curve.

### Directory map

```
shared/            contracts shared by server and client (llm, rag, ml, agent, repo, history)
server/
  index.ts         Express app; serves dist/ in production
  providers/       LLMProvider interface + Claude / OpenAI / Gemini / Mock adapters
  rag/             extraction, chunking, embeddings, vector store, retrieval
  ml/              parsing, preprocessing, metrics, 8 algorithms, training orchestrator
  agent/           agent runner, tool implementations, model adapters, blueprint analyzer
  analyzer/        GitHub client, file selection, detectors, graph builder, tracer
  routes/          one SSE route per lab
src/
  engine/          EventBus · PlaybackController · per-lab runtimes · seeded simulation
  labs/            per lab: stages, layout, events, sequencer, reducer, state, dashboard
  components/      per-lab panels, graphs, inspectors + shared layout and UI primitives
  store/           zustand stores, one per lab plus UI preferences
```

---

## Accessibility

Node states use an icon and a label, never color alone. Pipeline nodes are buttons with roving
arrow-key navigation. `Space` plays and pauses, `→` steps, `R` replays, `Esc` unpins the inspector.
A reduced-motion preference, system or manual, disables particles and pulse animations.

---

## Contributing

Issues and pull requests are welcome. Two rules that are not negotiable, because they are the point
of the project:

1. **Never present a simulated value as a real one.** If an API does not expose it, label it.
2. **Ship a test with behavior.** New behavior gets at least one regression test in the same PR.

```bash
npm run typecheck && npm test && npm run build
```

## License

MIT — see [LICENSE](LICENSE).
