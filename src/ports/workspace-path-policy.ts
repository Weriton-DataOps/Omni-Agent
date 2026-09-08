export interface WorkspacePathPolicy {
  isAbsolute(path: string): boolean
  resolve(path: string): string
  equals(left: string, right: string): boolean
  statusContainsExactPath(statusOutput: unknown, canonicalPath: string): boolean
}
