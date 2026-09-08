import { posix, win32 } from 'node:path';
export class NodeWorkspacePathPolicy {
    platform;
    api;
    constructor(platform = process.platform) {
        this.platform = platform;
        this.api = platform === 'win32' ? win32 : posix;
    }
    isAbsolute(path) {
        return this.api.isAbsolute(path);
    }
    resolve(path) {
        return this.api.resolve(path);
    }
    equals(left, right) {
        return this.normalize(left) === this.normalize(right);
    }
    statusContainsExactPath(statusOutput, canonicalPath) {
        if (typeof statusOutput !== 'string' || !this.isAbsolute(canonicalPath))
            return false;
        const status = statusOutput.replace(/\\/gu, '/').normalize('NFC');
        const normalizedPath = this.normalizedStatusPath(canonicalPath);
        const escaped = normalizedPath.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
        const flags = this.platform === 'win32' ? 'imu' : 'mu';
        return new RegExp(`(?:^|[\\s('"=])${escaped}/?(?=$|[\\s)'",;])`, flags).test(status);
    }
    normalize(path) {
        const resolved = this.api.resolve(path).normalize('NFC');
        const normalized = resolved.replace(/\\/gu, '/');
        const root = this.api.parse(resolved).root.replace(/\\/gu, '/');
        const withoutTrailingSlash = normalized === root ? normalized : normalized.replace(/\/+$/gu, '');
        return this.platform === 'win32' ? withoutTrailingSlash.toLowerCase() : withoutTrailingSlash;
    }
    normalizedStatusPath(path) {
        const resolved = this.api.resolve(path).replace(/\\/gu, '/').normalize('NFC');
        const root = this.api.parse(this.api.resolve(path)).root.replace(/\\/gu, '/');
        return resolved === root ? resolved : resolved.replace(/\/+$/gu, '');
    }
}
