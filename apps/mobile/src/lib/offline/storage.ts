/**
 * SQLite-backed durable storage for the outbound sync queue (the mobile equivalent of web's Dexie
 * tables in apps/web/src/lib/offline/db.ts). Finished paddles and quick-add POIs are written here
 * FIRST, before any network call, so a paddle recorded in a coverage-free canyon survives an app
 * kill, a crash, or a reboot and is replayed to the server later by the sync engine.
 *
 * The generic send state machine lives in `@paddle-prints/offline-core/sync`; this module only
 * implements its `QueueStore<PendingRow<T>>` seam over expo-sqlite. Both kinds (paddles, pois) share
 * one table keyed by (kind, id); `sqliteStore(kind)` returns a store scoped to one kind.
 *
 * SERIALIZATION -- why superjson, not JSON.stringify:
 *   A paddle input carries `startedAt: Date` (see record.tsx buildInput). `JSON.stringify(new Date())`
 *   emits an ISO string and `JSON.parse` gives it back as a `string`, NOT a `Date` -- so a plain-JSON
 *   round-trip would silently change the type of `startedAt`, and the replayed input would no longer
 *   match what tRPC validates (superjson is the transformer on both the vanilla client and the server,
 *   and it expects a real Date for that field). superjson.stringify captures the Date in its meta
 *   sidecar and superjson.parse reconstructs a real `Date`, so `store.get(id).input.startedAt`
 *   instanceof Date holds across an app restart. This is the correctness linchpin of the whole queue.
 *
 * expo-sqlite API used (verified against node_modules/expo-sqlite build types, v57):
 *   openDatabaseSync(name) -> SQLiteDatabase; db.execSync(sql); db.runSync(sql, params);
 *   db.getFirstSync<T>(sql, params); db.getAllSync<T>(sql, params). Named params bind as `$name` with
 *   an object `{ $name: value }`. The sync API is fine at this scale (a handful of small rows) and lets
 *   us present a clean async QueueStore without threading a DB-open promise through every call.
 */
import { openDatabaseSync, type SQLiteDatabase } from "expo-sqlite";
import superjson from "superjson";

import type { PendingRow, QueueStore } from "@paddle-prints/offline-core/sync";

export type { QueueStore, PendingRow } from "@paddle-prints/offline-core/sync";

/** The row shape as it lives in SQLite (snake_case columns, input as a superjson string). */
interface RawRow {
  kind: string;
  id: string;
  created_at: number;
  dead_letter: string | null;
  input: string;
}

let _db: SQLiteDatabase | null = null;

/**
 * The shared queue DB handle. Lazily opened + migrated (CREATE TABLE IF NOT EXISTS, so no versioned
 * migrations) on first use, so importing this module never touches the filesystem at import time --
 * matters for Metro's module graph and for any unit test that imports the sync surface.
 */
function db(): SQLiteDatabase {
  if (_db) return _db;
  const handle = openDatabaseSync("offline-queue.db");
  handle.execSync(
    `CREATE TABLE IF NOT EXISTS pending_rows (
      kind TEXT NOT NULL,
      id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      dead_letter TEXT,
      input TEXT NOT NULL,
      PRIMARY KEY (kind, id)
    );`,
  );
  _db = handle;
  return handle;
}

/** Rebuild a PendingRow from its stored row, reviving the Date-carrying input via superjson. */
function toPendingRow<TInput>(raw: RawRow): PendingRow<TInput> {
  const row: PendingRow<TInput> = {
    id: raw.id,
    input: superjson.parse<TInput>(raw.input),
    createdAt: raw.created_at,
  };
  // `deadLetter` is optional: keep it absent (not null) when unset so `if (row.deadLetter)` in the
  // core drain reads cleanly and the type stays `string | undefined`.
  if (raw.dead_letter != null) row.deadLetter = raw.dead_letter;
  return row;
}

/**
 * A QueueStore bound to one kind ("paddle" | "poi"), backed by the shared pending_rows table. Every
 * method is an async wrapper over a synchronous expo-sqlite call.
 */
export function sqliteStore<TInput extends { id: string }>(
  kind: string,
): QueueStore<PendingRow<TInput>> {
  return {
    /** INSERT OR REPLACE: idempotent on (kind, id) so a re-queue of the same client uuid overwrites. */
    async put(row: PendingRow<TInput>) {
      db().runSync(
        `INSERT OR REPLACE INTO pending_rows (kind, id, created_at, dead_letter, input)
         VALUES ($kind, $id, $created_at, $dead_letter, $input);`,
        {
          $kind: kind,
          $id: row.id,
          $created_at: row.createdAt,
          $dead_letter: row.deadLetter ?? null,
          $input: superjson.stringify(row.input),
        },
      );
    },

    async get(id: string) {
      const raw = db().getFirstSync<RawRow>(
        `SELECT kind, id, created_at, dead_letter, input FROM pending_rows
         WHERE kind = $kind AND id = $id;`,
        { $kind: kind, $id: id },
      );
      return raw ? toPendingRow<TInput>(raw) : undefined;
    },

    async delete(id: string) {
      db().runSync(`DELETE FROM pending_rows WHERE kind = $kind AND id = $id;`, {
        $kind: kind,
        $id: id,
      });
    },

    /** Only ever patches deadLetter (a permanent 4xx failure) -- a targeted single-column UPDATE. */
    async update(id: string, changes: { deadLetter: string }) {
      db().runSync(
        `UPDATE pending_rows SET dead_letter = $dead_letter WHERE kind = $kind AND id = $id;`,
        { $dead_letter: changes.deadLetter, $kind: kind, $id: id },
      );
    },

    /** Oldest-first: created_at ASC is the faithful equivalent of web's Dexie insertion order. */
    async toArray() {
      const rows = db().getAllSync<RawRow>(
        `SELECT kind, id, created_at, dead_letter, input FROM pending_rows
         WHERE kind = $kind ORDER BY created_at ASC;`,
        { $kind: kind },
      );
      return rows.map((r) => toPendingRow<TInput>(r));
    },
  };
}
