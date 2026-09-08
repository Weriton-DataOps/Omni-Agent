export interface WorkspaceFileInfo {
  isDirectory(): boolean
}

export interface WorkspaceFileSystem {
  stat(path: string): WorkspaceFileInfo
  exists(path: string): boolean
  readText(path: string, maximumBytes: number): string
}
