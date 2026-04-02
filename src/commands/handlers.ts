import * as vscode from 'vscode';
import * as path from 'path';
import { spawnAsync } from '../utils/spawnAsync';
import { getPythonPath } from '../utils/getPythonPath';
import { ProcessManager } from '../utils/processManagement';
import { PlotPanel } from '../plotting/PlotPanel';

export interface CommandContext {
    processManager: ProcessManager;
    channel: vscode.OutputChannel;
    pybngVersion: string;
    extensionContext: vscode.ExtensionContext;
}

function getTimestampedFolderName(): string {
    const d = new Date();
    return `${d.getFullYear()}_${(d.getMonth() + 1).toString().padStart(2, '0')}_${d.getDate().toString().padStart(2, '0')}__${d.getHours().toString().padStart(2, '0')}_${d.getMinutes().toString().padStart(2, '0')}_${d.getSeconds().toString().padStart(2, '0')}`;
}

function getOutputFolderUri(config: vscode.WorkspaceConfiguration, docUri: vscode.Uri): vscode.Uri {
    const def_folder = config.get<string | null>('general.result_folder');
    if (def_folder) {
        return vscode.Uri.file(def_folder);
    }
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        return vscode.workspace.workspaceFolders[0].uri;
    }
    return vscode.Uri.file(path.dirname(docUri.fsPath));
}

async function checkGdat(outDir: string, timeout: number): Promise<void> {
    const dirUri = vscode.Uri.file(outDir);
    try {
        const entries = await vscode.workspace.fs.readDirectory(dirUri);
        if (entries.some(([name]) => name.endsWith('.gdat'))) {
            return;
        }
    } catch {
        // directory may not exist yet — fall through to watcher
    }

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            watcher.dispose();
            reject(new Error('Timeout waiting for GDAT'));
        }, timeout);

        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(outDir, '*.gdat'));
        watcher.onDidCreate(() => {
            clearTimeout(timer);
            watcher.dispose();
            resolve();
        });
    });
}

async function openGdat(folderUri: vscode.Uri, fnameNoext: string, extensionContext: vscode.ExtensionContext) {
    const files = await vscode.workspace.fs.readDirectory(folderUri);
    let outGdatUri: vscode.Uri | undefined;

    for (const [name, type] of files) {
        if (type !== vscode.FileType.File) continue;
        const ext = path.extname(name).substring(1);
        const base = path.basename(name, path.extname(name));

        if (base === fnameNoext && ext === 'gdat') {
            outGdatUri = vscode.Uri.joinPath(folderUri, name);
            break;
        }
        if (!outGdatUri && ext === 'gdat') {
            outGdatUri = vscode.Uri.joinPath(folderUri, name);
        }
    }

    if (outGdatUri) {
        await vscode.commands.executeCommand('vscode.open', outGdatUri);
        PlotPanel.create(extensionContext.extensionUri);
    }
}

export function createRunHandler(ctx: CommandContext) {
    return async function runCommandHandler() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        const docUri = editor.document.uri;
        const fname = path.basename(docUri.fsPath);

        const config = vscode.workspace.getConfiguration('bngl');
        const curr_workspace_uri = getOutputFolderUri(config, docUri);

        const fname_noext = fname.endsWith('.bngl') ? fname.slice(0, -5) : fname;
        const fold_name = getTimestampedFolderName();
        const new_fold_uri = vscode.Uri.joinPath(curr_workspace_uri, fname_noext, fold_name);
        const copy_path = vscode.Uri.joinPath(new_fold_uri, fname);

        await vscode.workspace.fs.createDirectory(new_fold_uri);
        await vscode.workspace.fs.copy(editor.document.uri, copy_path);

        const term_cmd = `bionetgen -req "${ctx.pybngVersion}" run -i "${copy_path.fsPath}" -o "${new_fold_uri.fsPath}" -l "${new_fold_uri.fsPath}"`;
        vscode.window.showInformationMessage(`Started running ${fname} in folder ${fname_noext}/${fold_name}`);

        if (config.get<boolean>('general.enable_terminal_runner')) {
            let term = vscode.window.terminals.find(i => i.name === 'bngl_term');
            if (!term) {
                term = vscode.window.createTerminal('bngl_term');
            }
            term.show();
            term.sendText(term_cmd);

            if (config.get<boolean>('general.auto_open')) {
                checkGdat(new_fold_uri.fsPath, 120000).then(() => {
                    openGdat(new_fold_uri, fname_noext, ctx.extensionContext);
                }).catch((err) => {
                    ctx.channel.appendLine(`Error auto-opening GDAT: ${err}`);
                });
            }
        } else {
            ctx.channel.appendLine(term_cmd);
            const process = spawnAsync('bionetgen', ['-req', ctx.pybngVersion, 'run', '-i', copy_path.fsPath, '-o', new_fold_uri.fsPath, '-l', new_fold_uri.fsPath], ctx.channel, ctx.processManager);
            process.then((exitCode) => {
                if (exitCode) {
                    vscode.window.showInformationMessage('Something went wrong, see BNGL output channel for details.');
                    ctx.channel.show();
                } else {
                    vscode.window.showInformationMessage('Finished running successfully.');
                    if (config.get<boolean>('general.auto_open')) {
                        openGdat(new_fold_uri, fname_noext, ctx.extensionContext).catch(err => {
                            ctx.channel.appendLine(`Error auto-opening GDAT: ${err}`);
                        });
                    }
                }
            }).catch((err) => {
                ctx.channel.appendLine(`Process execution error: ${err}`);
            });
        }
    };
}

export function createVizHandler(ctx: CommandContext) {
    return async function vizCommandHandler() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        const docUri = editor.document.uri;
        const fname = path.basename(docUri.fsPath);

        const config = vscode.workspace.getConfiguration('bngl');
        const curr_workspace_uri = getOutputFolderUri(config, docUri);

        const fname_noext = fname.endsWith('.bngl') ? fname.slice(0, -5) : fname;
        const fold_name = getTimestampedFolderName();
        const new_fold_uri = vscode.Uri.joinPath(curr_workspace_uri, fname_noext, fold_name);
        const copy_path = vscode.Uri.joinPath(new_fold_uri, fname);

        await vscode.workspace.fs.createDirectory(new_fold_uri);
        await vscode.workspace.fs.copy(editor.document.uri, copy_path);

        const term_cmd = `bionetgen -req "${ctx.pybngVersion}" visualize -i "${copy_path.fsPath}" -o "${new_fold_uri.fsPath}" -t "all"`;
        vscode.window.showInformationMessage(`Started visualizing ${fname} in folder ${fname_noext}/${fold_name}`);

        if (config.get<boolean>('general.enable_terminal_runner')) {
            let term = vscode.window.terminals.find(i => i.name === 'bngl_term');
            if (!term) {
                term = vscode.window.createTerminal('bngl_term');
            }
            term.show();
            term.sendText(term_cmd);
        } else {
            ctx.channel.appendLine(term_cmd);
            const exitCode = await spawnAsync('bionetgen', ['-req', ctx.pybngVersion, 'visualize', '-i', copy_path.fsPath, '-o', new_fold_uri.fsPath, '-t', 'all'], ctx.channel, ctx.processManager);
            if (exitCode) {
                vscode.window.showInformationMessage('Something went wrong, see BNGL output channel for details.');
                ctx.channel.show();
            } else {
                vscode.window.showInformationMessage('Finished visualizing successfully.');
                try {
                    const files = await vscode.workspace.fs.readDirectory(new_fold_uri);
                    for (const [name] of files) {
                        if (name.endsWith('.graphml')) {
                            const graphmlUri = vscode.Uri.joinPath(new_fold_uri, name);
                            await vscode.commands.executeCommand('vscode.open', graphmlUri);
                            PlotPanel.create(ctx.extensionContext.extensionUri);
                        }
                    }
                } catch (err) {
                    ctx.channel.appendLine(`Could not open visualization files: ${err}`);
                }
            }
        }
    };
}

export function createSetupHandler(ctx: CommandContext) {
    return async function setupCommandHandler() {
        ctx.channel.appendLine('Checking for perl.');
        const perlCheckExitCode = await spawnAsync('perl', ['-v'], ctx.channel, ctx.processManager);

        if (perlCheckExitCode) {
            ctx.channel.appendLine('Could not find perl.');
            vscode.window.showInformationMessage('You must install Perl (https://www.perl.org/get.html). We recommend Strawberry Perl for Windows.');
            ctx.channel.show();
        } else {
            ctx.channel.appendLine('Found perl.');
        }

        ctx.channel.appendLine('Getting python path.');
        const pythonPath = await getPythonPath(ctx.channel);
        ctx.channel.appendLine('Found python path: ' + pythonPath);

        ctx.channel.appendLine('Checking for bionetgen.');
        const bngCheckExitCode = await spawnAsync(pythonPath, ['-m', 'pip', 'show', 'bionetgen'], ctx.channel, ctx.processManager);

        if (bngCheckExitCode) {
            ctx.channel.appendLine('Installing PyBNG for python: ' + pythonPath);
            vscode.window.showInformationMessage('Setting up BNG for the following Python: ' + pythonPath);
            const installExitCode = await spawnAsync(pythonPath, ['-m', 'pip', 'install', 'bionetgen', '--upgrade'], ctx.channel, ctx.processManager);
            if (installExitCode) {
                ctx.channel.appendLine('pip install failed for python: ' + pythonPath);
                vscode.window.showInformationMessage('BNG setup failed, see BNGL output channel for details.');
                ctx.channel.show();
            } else {
                ctx.channel.appendLine('pip install succeeded for python: ' + pythonPath);
                vscode.window.showInformationMessage('BNG setup complete.');
            }
        } else {
            ctx.channel.appendLine('Found bionetgen.');
        }
    };
}

export function createUpgradeHandler(ctx: CommandContext) {
    return async function upgradeCommandHandler() {
        ctx.channel.appendLine('Running BNG upgrade ...');
        const pythonPath = await getPythonPath(ctx.channel);
        ctx.channel.appendLine('Found python path: ' + pythonPath);
        vscode.window.showInformationMessage('Upgrading BNG for the following Python: ' + pythonPath);
        const upgradeExitCode = await spawnAsync(pythonPath, ['-m', 'pip', 'install', 'bionetgen', '--upgrade'], ctx.channel, ctx.processManager);
        if (upgradeExitCode) {
            ctx.channel.appendLine('pip upgrade failed for python: ' + pythonPath);
            vscode.window.showInformationMessage('BNG upgrade failed, see BNGL output channel for details.');
            ctx.channel.show();
        } else {
            ctx.channel.appendLine('pip upgrade successful for python: ' + pythonPath);
            vscode.window.showInformationMessage('BNG upgrade complete.');
        }
    };
}
