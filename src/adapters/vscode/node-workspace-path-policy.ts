import { posix, win32 } from 'node:path'

import type { WorkspacePathPolicy } from '../../ports/workspace-path-policy.js'

export class NodeWorkspacePathPolicy implements WorkspacePathPolicy {
  private readonly api: typeof posix | typeof win32

  constructor(private readonly platform: NodeJS.Platform = process.platform) {
    this.api = platform === 'win32' ? win32 : posix
  }

  isAbsolute(path: string): boolean {
    return this.api.isAbsolute(path)
  }

  resolve(path: string): string {
    return this.api.resolve(path)
  }

  equals(left: string, right: string): boolean {
    return this.normalize(left) === this.normalize(right)
  }

  statusContainsExactPath(statusOutput: unknown, canonicalPath: string): boolean {
    if (typeof statusOutput !== 'string' || !this.isAbsolute(canonicalPath)) return false
    const status = statusOutput.replace(/\\/gu, '/').normalize('NFC')
    const normalizedPath = this.normalizedStatusPath(canonicalPath)
    const escaped = normalizedPath.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    const flags = this.platform === 'win32' ? 'imu' : 'mu'
    return new RegExp(`(?:^|[\\s('"=])${escaped}/?(?=$|[\\s)'",;])`, flags).test(status)
  }

  private normalize(path: string): string {
    const resolved = this.api.resolve(path).normalize('NFC')
    const normalized = resolved.replace(/\\/gu, '/')
    const root = this.api.parse(resolved).root.replace(/\\/gu, '/')
    const withoutTrailingSlash = normalized === root ? normalized : normalized.replace(/\/+$/gu, '')
    return this.platform === 'win32' ? withoutTrailingSlash.toLowerCase() : withoutTrailingSlash
  }

  private normalizedStatusPath(path: string): string {
    const resolved = this.api.resolve(path).replace(/\\/gu, '/').normalize('NFC')
    const root = this.api.parse(this.api.resolve(path)).root.replace(/\\/gu, '/')
    return resolved === root ? resolved : resolved.replace(/\/+$/gu, '')
  }
}
