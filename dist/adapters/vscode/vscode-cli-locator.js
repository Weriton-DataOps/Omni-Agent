import { posix, win32 } from 'node:path';
const MAX_WINDOWS_WRAPPER_BYTES = 16 * 1_024;
export class VscodeCliLocator {
    fileSystem;
    environment;
    platform;
    constructor(fileSystem, environment, platform) {
        this.fileSystem = fileSystem;
        this.environment = environment;
        this.platform = platform;
    }
    resolve() {
        const api = this.platform === 'win32' ? win32 : posix;
        const executable = this.platform === 'win32' ? 'code.cmd' : 'code';
        const pathEntries = String(this.environment.PATH ?? this.environment.Path ?? '')
            .split(api.delimiter)
            .map((entry) => entry.trim())
            .filter(Boolean)
            .map((entry) => api.join(entry, executable));
        const known = this.platform === 'win32'
            ? [
                this.environment.LOCALAPPDATA && api.join(this.environment.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'),
                this.environment.ProgramFiles && api.join(this.environment.ProgramFiles, 'Microsoft VS Code', 'bin', 'code.cmd')
            ].filter((item) => typeof item === 'string' && Boolean(item))
            : [];
        const candidates = [this.environment.OMNI_VSCODE_CLI, ...pathEntries, ...known]
            .filter((item) => typeof item === 'string' && Boolean(item));
        const found = candidates.find((candidate) => api.isAbsolute(candidate) && this.fileSystem.exists(candidate));
        if (!found) {
            throw new Error(`${executable} nao foi encontrado no PATH nem nas instalacoes conhecidas.`);
        }
        const resolved = api.resolve(found);
        return this.platform === 'win32'
            ? this.resolveWindowsWrapper(resolved)
            : {
                executable: resolved,
                prefixArgs: [],
                environment: {},
                source: 'native-cli'
            };
    }
    resolveWindowsWrapper(wrapperPath) {
        if (win32.extname(wrapperPath).toLowerCase() !== '.cmd') {
            throw new Error('CLI do VS Code no Windows deve apontar para o wrapper code.cmd verificavel.');
        }
        const content = this.fileSystem.readText(wrapperPath, MAX_WINDOWS_WRAPPER_BYTES);
        const invocation = content.split(/\r?\n/gu)
            .map((line) => line.trim())
            .map((line) => /^"%~dp0([^"%!]*)"\s+"%~dp0([^"%!]*)"\s+%\*$/iu.exec(line))
            .find((match) => match !== null);
        const executableRelative = invocation?.[1];
        const cliRelative = invocation?.[2];
        if (!executableRelative || !cliRelative) {
            throw new Error('Wrapper code.cmd nao contem uma invocacao nativa reconhecida e segura.');
        }
        const wrapperDirectory = win32.dirname(wrapperPath);
        const installationRoot = win32.resolve(wrapperDirectory, '..');
        const executable = win32.resolve(wrapperDirectory, executableRelative);
        const cli = win32.resolve(wrapperDirectory, cliRelative);
        const normalizedRoot = `${installationRoot.replace(/[\\/]+$/gu, '').toLowerCase()}\\`;
        const normalizedExecutable = executable.toLowerCase();
        const normalizedCli = cli.toLowerCase();
        if (normalizedExecutable !== win32.join(installationRoot, 'Code.exe').toLowerCase() ||
            !normalizedCli.startsWith(normalizedRoot) ||
            !normalizedCli.endsWith('\\resources\\app\\out\\cli.js')) {
            throw new Error('Wrapper code.cmd tenta sair da instalacao esperada do VS Code.');
        }
        if (!this.fileSystem.exists(executable) || !this.fileSystem.exists(cli)) {
            throw new Error('Wrapper code.cmd referencia Code.exe ou cli.js inexistente.');
        }
        return {
            executable,
            prefixArgs: [cli],
            environment: { VSCODE_DEV: '', ELECTRON_RUN_AS_NODE: '1' },
            source: 'windows-cmd-wrapper'
        };
    }
}
