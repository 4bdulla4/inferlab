import type { DatasetSummary } from "@shared/ml";
import { summarizeTable, type RawTable } from "./data";
import { SAMPLES } from "./samples";
import type { SavedModel } from "./trainer";

const TTL_MS = 2 * 60 * 60 * 1000;

interface StoredDataset {
  table: RawTable;
  summary: DatasetSummary;
  touchedAt: number;
}

/** Datasets and trained models held in memory for a couple of hours; nothing is written to disk. */
export class MLStore {
  private datasets = new Map<string, StoredDataset>();
  private models = new Map<string, { saved: SavedModel; touchedAt: number }>();
  private counter = 0;

  constructor() {
    for (const s of SAMPLES) {
      const table = s.build();
      this.datasets.set(s.id, { table, summary: summarizeTable(table, { id: s.id, name: s.name, origin: "sample", format: "csv", bytes: Buffer.byteLength(table.rows.map((r) => r.join(",")).join("\n")), synthetic: s.synthetic, note: s.note }), touchedAt: Infinity });
    }
  }

  addDataset(table: RawTable, name: string, format: "csv" | "json", bytes: number): DatasetSummary {
    this.sweep();
    const id = `ds-${++this.counter}-${Date.now().toString(36)}`;
    const summary = summarizeTable(table, { id, name, origin: "upload", format, bytes, note: `Uploaded ${format.toUpperCase()}: ${table.rows.length.toLocaleString()} rows × ${table.columns.length} columns. Held in the server's memory for this session only.` });
    this.datasets.set(id, { table, summary, touchedAt: Date.now() });
    return summary;
  }

  dataset(id: string): StoredDataset | undefined {
    const d = this.datasets.get(id);
    if (d && d.touchedAt !== Infinity) d.touchedAt = Date.now();
    return d;
  }

  listDatasets(): DatasetSummary[] {
    this.sweep();
    return [...this.datasets.values()].map((d) => d.summary);
  }

  saveModel(saved: SavedModel): void {
    this.models.set(saved.info.modelId, { saved, touchedAt: Date.now() });
    if (this.models.size > 40) this.models.delete([...this.models.keys()][0]!);
  }

  model(id: string): SavedModel | undefined {
    const m = this.models.get(id);
    if (m) m.touchedAt = Date.now();
    return m?.saved;
  }

  private sweep(): void {
    const cutoff = Date.now() - TTL_MS;
    for (const [id, d] of this.datasets) if (d.touchedAt < cutoff) this.datasets.delete(id);
    for (const [id, m] of this.models) if (m.touchedAt < cutoff) this.models.delete(id);
  }
}
