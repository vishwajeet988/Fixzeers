import { Pool, QueryResultRow } from "pg";
import { config } from "./config";
import { completeDatabaseTiming } from "./observability";
import { performance } from "node:perf_hooks";

export const pool = new Pool({
  connectionString: config.databaseUrl || undefined
});

export async function query<T extends QueryResultRow = any>(
  text: string,
  params: any[] = [],
  label = "unlabeled"
) {
  const acquireStartedAt = performance.now();
  const timingEnabled = label !== "unlabeled";
  let client;

  try {
    client = await pool.connect();
  } catch (error) {
    if (timingEnabled) {
      completeDatabaseTiming(
        label,
        performance.now() - acquireStartedAt,
        null,
        "pool_acquire_error"
      );
    }
    throw error;
  }

  const poolWaitMs = performance.now() - acquireStartedAt;
  const queryStartedAt = performance.now();

  try {
    const result = await client.query<T>(text, params);

    if (timingEnabled) {
      completeDatabaseTiming(
        label,
        poolWaitMs,
        performance.now() - queryStartedAt,
        "completed"
      );
    }

    return result;
  } catch (error) {
    if (timingEnabled) {
      completeDatabaseTiming(
        label,
        poolWaitMs,
        performance.now() - queryStartedAt,
        "query_error"
      );
    }
    throw error;
  } finally {
    client.release();
  }
}
