import type { JsonValue } from '../core/shared/json.js'

export type LocalJsonUpdater = (current: unknown | null) => JsonValue | Promise<JsonValue>

export interface LocalJsonStore {
  read(path: string): Promise<unknown | null>
  write(path: string, value: JsonValue): Promise<void>
  update(path: string, updater: LocalJsonUpdater): Promise<JsonValue>
}
