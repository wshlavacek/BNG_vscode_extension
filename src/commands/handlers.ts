import * as vscode from 'vscode';
import * as path from 'path';
import { spawnAsync } from '../utils/spawnAsync';
import { getPythonCommand } from '../utils/getPythonPath';
import { CommandSpec, appendCommandArgs, createCommandSpec, formatCommandSpec } from '../utils/commandSpec';
import { ProcessManager } from '../utils/processManagement';
import { PlotPanel } from '../plotting/PlotPanel';
import {
    getModelFolderUri,
    getResultsBaseFolderUri,
    getResultsFolderConfigurationTarget,
    getResultsRootFolderName,
    getResultsRootUri,
    getResultsRunFolderUri,
} from '../resultsFolders';

export interface CommandContext {
    processManager: ProcessManager;
    channel: vscode.OutputChannel;
    pybngVersion: string;
    extensionContext: vscode.ExtensionContext;
}

type VisualizationType = 'all' | 'contactmap';

interface ResultsFolderMenuItem extends vscode.QuickPickItem {
    action: 'default' | 'workspace' | 'choose';
}

const PYBIONETGEN_ENTRYPOINT = 'from bionetgen.main import main as _bng_main; raise SystemExit(_bng_main())';
const PYBIONETGEN_PACKAGE = 'bionetgen';
const PYBIONETGEN_SETUPTOOLS_COMPAT_SPEC = 'setuptools<82';
const PYBIONETGEN_COMPATIBILITY_CHECK = 'import pkg_resources; import bionetgen';

function getTimestampedFolderName(): string {
    const d = new Date();
    return `${d.getFullYear()}_${(d.getMonth() + 1).toString().padStart(2, '0')}_${d.getDate().toString().padStart(2, '0')}__${d.getHours().toString().padStart(2, '0')}_${d.getMinutes().toString().padStart(2, '0')}_${d.getSeconds().toString().padStart(2, '0')}`;
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

async function openGdat(folderUri: vscode.Uri, fnameNoext: string, extensionContext: vscode.ExtensionContext, targetColumn?: vscode.ViewColumn) {
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
        PlotPanel.create(extensionContext.extensionUri, outGdatUri, targetColumn);
    }
}

function createBionetgenCommand(pythonCommand: CommandSpec, pybngVersion: string, args: string[]): CommandSpec {
    return appendCommandArgs(pythonCommand, ['-c', PYBIONETGEN_ENTRYPOINT, '-req', pybngVersion, ...args]);
}

function createPipCommand(pythonCommand: CommandSpec, args: string[]): CommandSpec {
    return appendCommandArgs(pythonCommand, ['-m', 'pip', ...args]);
}

function createPyBioNetGenInstallCommand(pythonCommand: CommandSpec): CommandSpec {
    return createPipCommand(pythonCommand, ['install', '--upgrade', PYBIONETGEN_PACKAGE, PYBIONETGEN_SETUPTOOLS_COMPAT_SPEC]);
}

function createPyBioNetGenCompatibilityRepairCommand(pythonCommand: CommandSpec): CommandSpec {
    return createPipCommand(pythonCommand, ['install', '--upgrade', PYBIONETGEN_SETUPTOOLS_COMPAT_SPEC]);
}

function createPyBioNetGenCompatibilityCheckCommand(pythonCommand: CommandSpec): CommandSpec {
    return appendCommandArgs(pythonCommand, ['-c', PYBIONETGEN_COMPATIBILITY_CHECK]);
}

async function ensurePyBioNetGenCompatibility(ctx: CommandContext, pythonCommand: CommandSpec): Promise<boolean> {
    ctx.channel.appendLine('Checking PyBioNetGen compatibility.');
    const compatibilityCheckExitCode = await spawnAsync(
        createPyBioNetGenCompatibilityCheckCommand(pythonCommand),
        ctx.channel,
        ctx.processManager
    );

    if (compatibilityCheckExitCode === 0) {
        ctx.channel.appendLine('PyBioNetGen compatibility check passed.');
        return true;
    }

    ctx.channel.appendLine(`PyBioNetGen compatibility check failed; installing ${PYBIONETGEN_SETUPTOOLS_COMPAT_SPEC}.`);
    const repairExitCode = await spawnAsync(
        createPyBioNetGenCompatibilityRepairCommand(pythonCommand),
        ctx.channel,
        ctx.processManager
    );

    if (repairExitCode !== 0) {
        ctx.channel.appendLine(`Compatibility repair failed for python command: ${formatCommandSpec(pythonCommand)}`);
        return false;
    }

    ctx.channel.appendLine('Re-checking PyBioNetGen compatibility.');
    const finalCheckExitCode = await spawnAsync(
        createPyBioNetGenCompatibilityCheckCommand(pythonCommand),
        ctx.channel,
        ctx.processManager
    );

    if (finalCheckExitCode !== 0) {
        ctx.channel.appendLine(`PyBioNetGen compatibility is still broken after repair for python command: ${formatCommandSpec(pythonCommand)}`);
        return false;
    }

    ctx.channel.appendLine(`PyBioNetGen compatibility repaired for python command: ${formatCommandSpec(pythonCommand)}`);
    return true;
}

function getVisualizationCommandLabel(visualizationType: VisualizationType): string {
    return visualizationType === 'contactmap' ? 'contact map' : 'visualization graphs';
}

function getCommandTargetUri(target?: unknown): vscode.Uri | undefined {
    if (target instanceof vscode.Uri) {
        return target;
    }

    if (typeof target === 'string' && target.length > 0) {
        return vscode.Uri.file(target);
    }

    if (target && typeof target === 'object' && 'fsPath' in target) {
        const fsPath = (target as { fsPath?: unknown }).fsPath;
        if (typeof fsPath === 'string' && fsPath.length > 0) {
            return vscode.Uri.file(fsPath);
        }
    }

    return vscode.window.activeTextEditor?.document.uri;
}

function getBnglTargetUri(target?: unknown): vscode.Uri | undefined {
    const targetUri = getCommandTargetUri(target);
    if (!targetUri) {
        return undefined;
    }

    return path.extname(targetUri.fsPath).toLowerCase() === '.bngl' ? targetUri : undefined;
}

function getRunFolderLabel(runFolderUri: vscode.Uri): string {
    return `${path.basename(path.dirname(runFolderUri.fsPath))}/${path.basename(runFolderUri.fsPath)}`;
}

function describeRunFolder(runFolderUri: vscode.Uri): string {
    return `${getRunFolderLabel(runFolderUri)} (${runFolderUri.fsPath})`;
}

function isSamePath(leftPath: string, rightPath: string): boolean {
    return path.resolve(leftPath) === path.resolve(rightPath);
}

async function updateResultsFolderSetting(docUri: vscode.Uri, folderPath: string | null): Promise<vscode.WorkspaceConfiguration> {
    const config = vscode.workspace.getConfiguration('bngl', docUri);
    const target = getResultsFolderConfigurationTarget(docUri);
    await config.update('general.result_folder', folderPath, target);
    return vscode.workspace.getConfiguration('bngl', docUri);
}

async function chooseCustomResultsFolder(docUri: vscode.Uri): Promise<vscode.Uri | undefined> {
    const config = vscode.workspace.getConfiguration('bngl', docUri);
    const currentBaseFolderUri = getResultsBaseFolderUri(config, docUri);
    const selection = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        defaultUri: currentBaseFolderUri,
        openLabel: 'Use Results Folder'
    });

    return selection?.[0];
}

function getVisualizationOutputMatcher(visualizationType: VisualizationType) {
    if (visualizationType === 'contactmap') {
        return (name: string) => name.toLowerCase().endsWith('_contactmap.graphml') || name.toLowerCase().includes('contactmap');
    }

    return (name: string) => name.toLowerCase().endsWith('.graphml');
}

async function openVisualizationOutputs(
    folderUri: vscode.Uri,
    visualizationType: VisualizationType,
    extensionContext: vscode.ExtensionContext,
    channel: vscode.OutputChannel,
    targetColumn?: vscode.ViewColumn
) {
    const files = await vscode.workspace.fs.readDirectory(folderUri);
    const matches = files
        .map(([name]) => name)
        .filter(getVisualizationOutputMatcher(visualizationType))
        .sort((left, right) => left.localeCompare(right));

    if (matches.length === 0) {
        channel.appendLine(`No GraphML output matched visualization type "${visualizationType}" in ${folderUri.fsPath}`);
        return;
    }

    for (const name of matches) {
        const graphmlUri = vscode.Uri.joinPath(folderUri, name);
        PlotPanel.create(extensionContext.extensionUri, graphmlUri, targetColumn);
    }
}

function createVisualizationHandler(ctx: CommandContext, visualizationType: VisualizationType) {
    return async function vizCommandHandler() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        const docUri = editor.document.uri;
        const fname = path.basename(docUri.fsPath);
        const sourceColumn = editor.viewColumn;

        const config = vscode.workspace.getConfiguration('bngl', docUri);
        const fold_name = getTimestampedFolderName();
        const new_fold_uri = getResultsRunFolderUri(config, docUri, fold_name);
        const copy_path = vscode.Uri.joinPath(new_fold_uri, fname);

        await vscode.workspace.fs.createDirectory(new_fold_uri);
        await vscode.workspace.fs.copy(editor.document.uri, copy_path);

        const pythonCommand = await getPythonCommand(ctx.channel);
        const vizCommand = createBionetgenCommand(pythonCommand, ctx.pybngVersion, [
            'visualize',
            '-i',
            copy_path.fsPath,
            '-o',
            new_fold_uri.fsPath,
            '-t',
            visualizationType
        ]);
        const term_cmd = formatCommandSpec(vizCommand);
        const commandLabel = getVisualizationCommandLabel(visualizationType);
        ctx.channel.appendLine(`Visualization results folder: ${new_fold_uri.fsPath}`);
        vscode.window.showInformationMessage(`Started generating ${commandLabel} for ${fname} in ${describeRunFolder(new_fold_uri)}`);

        if (config.get<boolean>('general.enable_terminal_runner')) {
            let term = vscode.window.terminals.find(i => i.name === 'bngl_term');
            if (!term) {
                term = vscode.window.createTerminal('bngl_term');
            }
            term.show();
            term.sendText(term_cmd);
            return;
        }

        ctx.channel.appendLine(term_cmd);
        const exitCode = await spawnAsync(vizCommand, ctx.channel, ctx.processManager);
        if (exitCode !== 0) {
            vscode.window.showInformationMessage('Something went wrong, see BNGL output channel for details.');
            ctx.channel.show();
            return;
        }

        vscode.window.showInformationMessage(`Finished generating ${commandLabel}. Results are in ${describeRunFolder(new_fold_uri)}`);
        try {
            await openVisualizationOutputs(new_fold_uri, visualizationType, ctx.extensionContext, ctx.channel, sourceColumn);
        } catch (err) {
            ctx.channel.appendLine(`Could not open visualization files: ${err}`);
        }
    };
}

export function createRunHandler(ctx: CommandContext) {
    return async function runCommandHandler() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        const docUri = editor.document.uri;
        const fname = path.basename(docUri.fsPath);
        const sourceColumn = editor.viewColumn;

        const config = vscode.workspace.getConfiguration('bngl', docUri);
        const fname_noext = path.basename(docUri.fsPath, path.extname(docUri.fsPath));
        const fold_name = getTimestampedFolderName();
        const new_fold_uri = getResultsRunFolderUri(config, docUri, fold_name);
        const copy_path = vscode.Uri.joinPath(new_fold_uri, fname);

        await vscode.workspace.fs.createDirectory(new_fold_uri);
        await vscode.workspace.fs.copy(editor.document.uri, copy_path);

        const pythonCommand = await getPythonCommand(ctx.channel);
        const runCommand = createBionetgenCommand(pythonCommand, ctx.pybngVersion, ['run', '-i', copy_path.fsPath, '-o', new_fold_uri.fsPath, '-l', new_fold_uri.fsPath]);
        const term_cmd = formatCommandSpec(runCommand);
        ctx.channel.appendLine(`Simulation results folder: ${new_fold_uri.fsPath}`);
        vscode.window.showInformationMessage(`Started running ${fname} in ${describeRunFolder(new_fold_uri)}`);

        if (config.get<boolean>('general.enable_terminal_runner')) {
            let term = vscode.window.terminals.find(i => i.name === 'bngl_term');
            if (!term) {
                term = vscode.window.createTerminal('bngl_term');
            }
            term.show();
            term.sendText(term_cmd);

            if (config.get<boolean>('general.auto_open')) {
                checkGdat(new_fold_uri.fsPath, 120000).then(() => {
                    openGdat(new_fold_uri, fname_noext, ctx.extensionContext, sourceColumn);
                }).catch((err) => {
                    ctx.channel.appendLine(`Error auto-opening GDAT: ${err}`);
                });
            }
        } else {
            ctx.channel.appendLine(term_cmd);
            const process = spawnAsync(runCommand, ctx.channel, ctx.processManager);
            process.then((exitCode) => {
                if (exitCode !== 0) {
                    vscode.window.showInformationMessage('Something went wrong, see BNGL output channel for details.');
                    ctx.channel.show();
                } else {
                    vscode.window.showInformationMessage(`Finished running ${fname}. Results are in ${describeRunFolder(new_fold_uri)}`);
                    if (config.get<boolean>('general.auto_open')) {
                        openGdat(new_fold_uri, fname_noext, ctx.extensionContext, sourceColumn).catch(err => {
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
    return createVisualizationHandler(ctx, 'all');
}

export function createContactMapHandler(ctx: CommandContext) {
    return createVisualizationHandler(ctx, 'contactmap');
}

export function createResultsFolderHandler(ctx: CommandContext) {
    return async function resultsFolderCommandHandler() {
        const docUri = getBnglTargetUri();
        if (!docUri) {
            vscode.window.showInformationMessage('Open a BNGL model to manage its results folder.');
            return;
        }

        const config = vscode.workspace.getConfiguration('bngl', docUri);
        const modelFileName = path.basename(docUri.fsPath);
        const modelFolderUri = getModelFolderUri(docUri);
        const workspaceFolderUri = vscode.workspace.getWorkspaceFolder(docUri)?.uri;
        const currentRootUri = getResultsRootUri(config, docUri);
        const defaultRootUri = vscode.Uri.joinPath(modelFolderUri, getResultsRootFolderName(docUri.fsPath));

        const items: ResultsFolderMenuItem[] = [
            {
                label: 'Use model\'s folder (Default)',
                description: 'Write results beside the current model.',
                detail: `Results root: ${defaultRootUri.fsPath}`,
                action: 'default'
            }
        ];

        if (workspaceFolderUri) {
            const workspaceRootUri = vscode.Uri.joinPath(workspaceFolderUri, getResultsRootFolderName(docUri.fsPath));
            items.push({
                label: 'Use workspace\'s folder',
                description: 'Write results under the workspace folder.',
                detail: `Results root: ${workspaceRootUri.fsPath}`,
                action: 'workspace'
            });
        }

        items.push({
            label: 'Choose custom folder...',
            description: 'Select a different base folder for generated results.',
            detail: `Generated results will be written under <selected>/${getResultsRootFolderName(docUri.fsPath)}/<timestamp>/`,
            action: 'choose'
        });

        const pick = await vscode.window.showQuickPick(items, {
            title: `Current target: ${currentRootUri.fsPath}`,
            placeHolder: `Results Folder for ${modelFileName}`
        });

        if (!pick) {
            return;
        }

        if (pick.action === 'default') {
            await updateResultsFolderSetting(docUri, null);
            const resultsRootUri = getResultsRootUri(vscode.workspace.getConfiguration('bngl', docUri), docUri);
            vscode.window.showInformationMessage(`Generated results for ${modelFileName} will now be written to ${resultsRootUri.fsPath}.`);
            return;
        }

        if (pick.action === 'workspace') {
            if (!workspaceFolderUri) {
                return;
            }

            await updateResultsFolderSetting(docUri, workspaceFolderUri.fsPath);
            const workspaceRootUri = getResultsRootUri(vscode.workspace.getConfiguration('bngl', docUri), docUri);
            vscode.window.showInformationMessage(`Generated results for ${modelFileName} will now be written to ${workspaceRootUri.fsPath}.`);
            return;
        }

        if (pick.action === 'choose') {
            const selectedFolderUri = await chooseCustomResultsFolder(docUri);
            if (!selectedFolderUri) {
                return;
            }

            if (isSamePath(selectedFolderUri.fsPath, modelFolderUri.fsPath)) {
                await updateResultsFolderSetting(docUri, null);
                const defaultRootUri = getResultsRootUri(vscode.workspace.getConfiguration('bngl', docUri), docUri);
                vscode.window.showInformationMessage(`Generated results for ${modelFileName} will now be written to ${defaultRootUri.fsPath}.`);
                return;
            }

            await updateResultsFolderSetting(docUri, selectedFolderUri.fsPath);
            const customRootUri = getResultsRootUri(vscode.workspace.getConfiguration('bngl', docUri), docUri);
            vscode.window.showInformationMessage(`Generated results for ${modelFileName} will now be written to ${customRootUri.fsPath}.`);
            return;
        }
    };
}

export function createSetupHandler(ctx: CommandContext) {
    return async function setupCommandHandler() {
        ctx.channel.appendLine('Checking for perl.');
        const perlCheckExitCode = await spawnAsync(createCommandSpec('perl', ['-v']), ctx.channel, ctx.processManager);

        if (perlCheckExitCode !== 0) {
            ctx.channel.appendLine('Could not find perl.');
            vscode.window.showInformationMessage('You must install Perl (https://www.perl.org/get.html). We recommend Strawberry Perl for Windows.');
            ctx.channel.show();
        } else {
            ctx.channel.appendLine('Found perl.');
        }

        ctx.channel.appendLine('Getting python path.');
        const pythonCommand = await getPythonCommand(ctx.channel);
        ctx.channel.appendLine('Found python command: ' + formatCommandSpec(pythonCommand));

        ctx.channel.appendLine('Checking for bionetgen.');
        const bngCheckExitCode = await spawnAsync(createPipCommand(pythonCommand, ['show', PYBIONETGEN_PACKAGE]), ctx.channel, ctx.processManager);

        if (bngCheckExitCode !== 0) {
            ctx.channel.appendLine('Installing PyBNG for python command: ' + formatCommandSpec(pythonCommand));
            vscode.window.showInformationMessage(`Setting up BNG for Python: ${pythonCommand.command}`);
            const installExitCode = await spawnAsync(createPyBioNetGenInstallCommand(pythonCommand), ctx.channel, ctx.processManager);
            if (installExitCode !== 0) {
                ctx.channel.appendLine('pip install failed for python command: ' + formatCommandSpec(pythonCommand));
                vscode.window.showInformationMessage('BNG setup failed, see BNGL output channel for details.');
                ctx.channel.show();
            } else {
                const compatible = await ensurePyBioNetGenCompatibility(ctx, pythonCommand);
                if (!compatible) {
                    vscode.window.showInformationMessage('BNG setup failed, see BNGL output channel for details.');
                    ctx.channel.show();
                    return;
                }
                ctx.channel.appendLine('pip install succeeded for python command: ' + formatCommandSpec(pythonCommand));
                vscode.window.showInformationMessage('BNG setup complete.');
            }
        } else {
            ctx.channel.appendLine('Found bionetgen.');
            const compatible = await ensurePyBioNetGenCompatibility(ctx, pythonCommand);
            if (!compatible) {
                vscode.window.showInformationMessage('BNG setup failed, see BNGL output channel for details.');
                ctx.channel.show();
            }
        }
    };
}

export function createUpgradeHandler(ctx: CommandContext) {
    return async function upgradeCommandHandler() {
        ctx.channel.appendLine('Running BNG upgrade ...');
        const pythonCommand = await getPythonCommand(ctx.channel);
        ctx.channel.appendLine('Found python command: ' + formatCommandSpec(pythonCommand));
        vscode.window.showInformationMessage(`Upgrading BNG for Python: ${pythonCommand.command}`);
        const upgradeExitCode = await spawnAsync(createPyBioNetGenInstallCommand(pythonCommand), ctx.channel, ctx.processManager);
        if (upgradeExitCode !== 0) {
            ctx.channel.appendLine('pip upgrade failed for python command: ' + formatCommandSpec(pythonCommand));
            vscode.window.showInformationMessage('BNG upgrade failed, see BNGL output channel for details.');
            ctx.channel.show();
        } else {
            const compatible = await ensurePyBioNetGenCompatibility(ctx, pythonCommand);
            if (!compatible) {
                vscode.window.showInformationMessage('BNG upgrade failed, see BNGL output channel for details.');
                ctx.channel.show();
                return;
            }
            ctx.channel.appendLine('pip upgrade successful for python command: ' + formatCommandSpec(pythonCommand));
            vscode.window.showInformationMessage('BNG upgrade complete.');
        }
    };
}
