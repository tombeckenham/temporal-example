import { ulid } from 'ulid'

/** Crockford Base32 ULID (26 chars, time-sortable). Used for all app primary keys. */
export function newId(): string {
  return ulid()
}
