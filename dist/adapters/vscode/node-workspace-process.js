import { spawnSync } from 'node:child_process';
const defaultSpawn = (executable, args, options) => {
    const result = spawnSync(executable, [...args], options);
    return {
        status: result.status,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? ''
    };
};
export class NodeWorkspaceProcess {
    spawn;
    baseEnvironment;
    constructor(spawn = defaultSpawn, baseEnvironment = process.env) {
        this.spawn = spawn;
        this.baseEnvironment = baseEnvironment;
    }
    run(executable, args, environment = {}) {
        return this.spawn(executable, [...args], {
            encoding: 'utf8',
            windowsHide: true,
            shell: false,
            env: { ...this.baseEnvironment, ...environment },
            timeout: 15_000,
            maxBuffer: 2_097_152
        });
    }
}
