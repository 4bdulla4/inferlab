import { Router, type Request, type Response } from "express";
import type { HistoryStore } from "../lib/history";

export function createHistoryRouter(store: HistoryStore): Router {
  const router = Router();

  router.get("/", (req: Request, res: Response) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 200) || 200));
    res.json(store.response(limit));
  });

  router.delete("/", (_req: Request, res: Response) => {
    store.clear();
    console.log("[api] history cleared");
    res.json(store.response(1));
  });

  return router;
}
