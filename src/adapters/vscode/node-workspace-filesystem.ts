import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  statSync
} from 'node:fs'

import type { WorkspaceFileInfo, WorkspaceFileSystem } from '../../ports/workspace-filesystem.js'

export type WorkspaceStat = (path: string) => WorkspaceFileInfo
export type WorkspaceExists = (path: string) => boolean
export type WorkspaceReadText = (path: string, maximumBytes: number) => string

const defaultStat: WorkspaceStat = (path) => statSync(path)
const defaultExists: WorkspaceExists = (path) => existsSync(path)
const defaultReadText: WorkspaceReadText = (path, maximumBytes) => {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    throw new Error('Limite de leitura do wrapper VS Code invalido.')
  }
  const before = lstatSync(path)
  if (!before.isFile() || before.isSymbolicLink() || before.size > maximumBytes) {
    throw new Error('Wrapper VS Code nao e arquivo regular pequeno.')
  }
  const descriptor = openSync(path, 'r')
  try {
    const current = fstatSync(descriptor)
    if (
      !current.isFile() || current.dev !== before.dev || current.ino !== before.ino ||
      current.size > maximumBytes
    ) {
      throw new Error('Wrapper VS Code mudou durante a validacao.')
    }
    const buffer = Buffer.alloc(current.size)
    const bytesRead = readSync(descriptor, buffer, 0, current.size, 0)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    closeSync(descriptor)
  }
}

export class NodeWorkspaceFileSystem implements WorkspaceFileSystem {
  constructor(
    private readonly statPath: WorkspaceStat = defaultStat,
    private readonly pathExists: WorkspaceExists = defaultExists,
    private readonly readPathText: WorkspaceReadText = defaultReadText
  ) {}

  stat(path: string): WorkspaceFileInfo {
    return this.statPath(path)
  }

  exists(path: string): boolean {
    return this.pathExists(path)
  }

  readText(path: string, maximumBytes: number): string {
    return this.readPathText(path, maximumBytes)
  }
}
