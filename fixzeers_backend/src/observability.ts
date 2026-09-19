import { performance } from "node:perf_hooks";
import type { NextFunction, Request, Response } from "express";

type TimingRoute = "health" | "categories.list" | "professionals.list";

const routeLabels: Record<string, TimingRoute> = {
  "GET /api/health": "health",
  "GET /api/categories": "categories.list",
  "GET /api/professionals": "professionals.list"
};

function elapsedMs(startedAt: number) {
  return Number((performance.now() - startedAt).toFixed(2));
}

function emitTiming(event: string, fields: Record<string, unknown>) {
  try {
    console.info(`[fixzeers-timing] ${JSON.stringify({ event, ...fields })}`);
  } catch {
    // Observability must never change request behavior.
  }
}

export function requestTimingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const route = routeLabels[`${req.method} ${req.path}`];

  if (!route) {
    next();
    return;
  }

  const startedAt = performance.now();
  let responseFinished = false;

  emitTiming("request_start", { route });

  res.once("finish", () => {
    responseFinished = true;
    emitTiming("response_complete", {
      route,
      status_code: res.statusCode,
      total_ms: elapsedMs(startedAt)
    });
  });

  res.once("close", () => {
    if (!responseFinished) {
      emitTiming("response_aborted", {
        route,
        total_ms: elapsedMs(startedAt)
      });
    }
  });

  next();
}

export function startRouteTiming() {
  return performance.now();
}

export function completeRouteTiming(
  route: TimingRoute,
  startedAt: number,
  outcome = "completed"
) {
  emitTiming("route_complete", {
    route,
    outcome,
    route_ms: elapsedMs(startedAt)
  });
}

export function completeDatabaseTiming(
  label: string,
  poolWaitMs: number,
  sqlMs: number | null,
  outcome: "completed" | "pool_acquire_error" | "query_error"
) {
  emitTiming("database_query", {
    query: label,
    pool_wait_ms: Number(poolWaitMs.toFixed(2)),
    sql_ms: sqlMs === null ? null : Number(sqlMs.toFixed(2)),
    outcome
  });
}
