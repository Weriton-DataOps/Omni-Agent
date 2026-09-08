import { closeSync, existsSync, fstatSync, lstatSync, openSync, readSync, statSync } from 'node:fs';
const defaultStat = (path) => statSync(path);
const defaultExists = (path) => existsSync(path);
const defaultReadText = (path, maximumBytes) => {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
        throw new Error('Limite de leitura do wrapper VS Code invalido.');
    }
    const before = lstatSync(path);
    if (!before.isFile() || before.isSymbolicLink() || before.size > maximumBytes) {
        throw new Error('Wrapper VS Code nao e arquivo regular pequeno.');
    }
    const descriptor = openSync(path, 'r');
    try {
        const current = fstatSync(descriptor);
        if (!current.isFile() || current.dev !== before.dev || current.ino !== before.ino ||
            current.size > maximumBytes) {
            throw new Error('Wrapper VS Code mudou durante a validacao.');
        }
        const buffer = Buffer.alloc(current.size);
        const bytesRead = readSync(descriptor, buffer, 0, current.size, 0);
        return buffer.subarray(0, bytesRead).toString('utf8');
    }
    finally {
        closeSync(descriptor);
    }
};
export class NodeWorkspaceFileSystem {
    statPath;
    pathExists;
    readPathText;
    constructor(statPath = defaultStat, pathExists = defaultExists, readPathText = defaultReadText) {
        this.statPath = statPath;
        this.pathExists = pathExists;
        this.readPathText = readPathText;
    }
    stat(path) {
        return this.statPath(path);
    }
    exists(path) {
        return this.pathExists(path);
    }
    readText(path, maximumBytes) {
        return this.readPathText(path, maximumBytes);
    }
}
