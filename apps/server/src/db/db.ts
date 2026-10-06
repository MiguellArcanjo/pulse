/**
 * Acesso ao banco, independente de onde o Postgres roda: `pg` (Heroku) ou PGlite
 * (Postgres dentro do Node, para desenvolvimento e testes). O resto do servidor só
 * conhece esta interface.
 */
export interface Queryable {
  query<T extends object = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Queryable {
  /** Roda `fn` numa transação: confirma se terminar bem, desfaz se lançar erro. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  /** Executa um script SQL com vários comandos (migrations). */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}
