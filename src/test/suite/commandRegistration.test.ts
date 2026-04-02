import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

suite('Command Registration', () => {

    const EXPECTED_COMMANDS = [
        'bng.run_bngl',
        'bng.run_viz',
        'bng.webview',
        'bng.setup',
        'bng.upgrade',
        'bng.menu',
        'bng.process_cleanup',
        'bng.kill_process',
    ];

    let registeredCommands: string[];

    suiteSetup(async function () {
        this.timeout(30_000);

        // Trigger extension activation by opening a .bngl file
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bngl-cmd-test-'));
        const tmpFile = path.join(tmpDir, 'activate.bngl');
        fs.writeFileSync(tmpFile, 'begin model\nend model\n');

        const doc = await vscode.workspace.openTextDocument(tmpFile);
        await vscode.window.showTextDocument(doc);

        // Give the extension time to activate
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Also try explicit activation
        const ext = vscode.extensions.getExtension('als251.bngl');
        if (ext && !ext.isActive) {
            try {
                await ext.activate();
            } catch {
                // may fail due to missing dependencies in test env
            }
        }

        registeredCommands = await vscode.commands.getCommands(false);

        // Clean up
        fs.unlinkSync(tmpFile);
        fs.rmdirSync(tmpDir);
    });

    for (const cmd of EXPECTED_COMMANDS) {
        test(`command "${cmd}" is registered`, () => {
            assert.ok(
                registeredCommands.includes(cmd),
                `Expected command "${cmd}" to be registered. ` +
                `Found ${registeredCommands.filter(c => c.startsWith('bng.')).length} bng.* commands: ` +
                `${registeredCommands.filter(c => c.startsWith('bng.')).join(', ')}`
            );
        });
    }
});
