import * as vscode from 'vscode';
import { ProcessManager, ProcessManagerProvider } from './utils/processManagement';
import { PlotPanel } from './plotting/PlotPanel';
import { createRunHandler, createVizHandler, createSetupHandler, createUpgradeHandler, CommandContext } from './commands/handlers';
import { menuCommandHandler } from './commands/menu';
import { bnglFoldingProvider } from './folding/foldingProvider';

const PYBNG_VERSION = '0.5.0';

export function activate(context: vscode.ExtensionContext) {
	const processManager = new ProcessManager();
	const channel = vscode.window.createOutputChannel('BNGL');

	const ctx: CommandContext = {
		processManager,
		channel,
		pybngVersion: PYBNG_VERSION,
		extensionContext: context,
	};

	// Register commands
	context.subscriptions.push(
		vscode.commands.registerCommand('bng.run_bngl', createRunHandler(ctx)),
		vscode.commands.registerCommand('bng.run_viz', createVizHandler(ctx)),
		vscode.commands.registerCommand('bng.webview', () => PlotPanel.create(context.extensionUri)),
		vscode.commands.registerCommand('bng.setup', createSetupHandler(ctx)),
		vscode.commands.registerCommand('bng.upgrade', createUpgradeHandler(ctx)),
		vscode.commands.registerCommand('bng.process_cleanup', () => processManager.killAllProcesses()),
		vscode.commands.registerCommand('bng.kill_process', (processObject) => processManager.killProcess(processObject)),
		vscode.commands.registerCommand('bng.menu', menuCommandHandler),
	);

	// Process manager tree view
	const treeView = vscode.window.createTreeView('processManagerTreeView', {
		treeDataProvider: new ProcessManagerProvider(processManager),
	});
	context.subscriptions.push(treeView);
	vscode.commands.executeCommand('setContext', 'bng.processManagerActive', true);

	// Auto-install check (runs after commands are registered)
	const config = vscode.workspace.getConfiguration('bngl');
	if (config.get<boolean>('general.auto_install')) {
		channel.appendLine('Checking PyBioNetGen installation ...');
		vscode.commands.executeCommand('bng.setup');
	}

	// Folding provider
	context.subscriptions.push(
		vscode.languages.registerFoldingRangeProvider({ language: 'bngl' }, bnglFoldingProvider),
	);
}

export function deactivate() {
	vscode.commands.executeCommand('bng.process_cleanup');
}
