import { Pool, QueryResultRow } from "pg";
import { config } from "./config";

export const pool = new Pool({
  connectionString: config.databaseUrl || undefined
});

export async function query<T extends QueryResultRow = any>(
  text: string,
  params: any[] = []
) {
  return pool.query<T>(text, params);
}