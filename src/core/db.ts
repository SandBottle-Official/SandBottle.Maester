import type { DatabaseSync, SQLInputValue } from 'node:sqlite';

export class Db {
  readonly connection: DatabaseSync;

  constructor(connection: DatabaseSync) {
    this.connection = connection;
  }

  all<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.connection.prepare(sql).all(...params) as T[];
  }

  get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.connection.prepare(sql).get(...params) as T | undefined;
  }

  run(sql: string, ...params: SQLInputValue[]) {
    return this.connection.prepare(sql).run(...params);
  }

  insert(sql: string, ...params: SQLInputValue[]): number {
    return Number(this.run(sql, ...params).lastInsertRowid);
  }

  nextOrdinal(sql: string, ...params: SQLInputValue[]): number {
    return (this.get<{ m: number | null }>(sql, ...params)?.m ?? -1) + 1;
  }

  transaction<T>(work: () => T): T {
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.connection.exec('COMMIT');
      return result;
    } catch (error) {
      this.connection.exec('ROLLBACK');
      throw error;
    }
  }
}

export const now = () => new Date().toISOString();
export const flag = (value: boolean) => value ? 1 : 0;
