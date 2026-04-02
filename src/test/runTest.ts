import * as path from 'path';
import * as cp from 'child_process';
import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath, runTests } from '@vscode/test-electron';

async function main() {
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');
    const extensionTestsPath = path.resolve(__dirname, './suite/index');

    // Download VS Code and install extension dependencies
    const vscodeExecutablePath = await downloadAndUnzipVSCode('stable');
    const [cliPath, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);

    // Install ms-python.python (required extensionDependency)
    cp.spawnSync(cliPath, [...cliArgs, '--install-extension', 'ms-python.python'], {
        encoding: 'utf-8',
        stdio: 'inherit',
    });

    await runTests({
        vscodeExecutablePath,
        extensionDevelopmentPath,
        extensionTestsPath,
        launchArgs: ['--disable-gpu'],
    });
}

main().catch(err => {
    console.error('Failed to run tests:', err);
    process.exit(1);
});
