import * as vscode from 'vscode';

interface BngMenuItem extends vscode.QuickPickItem {
    cmd: string;
}

export async function menuCommandHandler() {
    const editor = vscode.window.activeTextEditor;
    const ext = editor?.document.fileName.split('.').pop()?.toLowerCase();

    const items: BngMenuItem[] = [];
    if (ext === 'bngl') {
        items.push(
            { label: '$(play) Simulate', description: 'Run the current BNGL model', cmd: 'bng.run_bngl' },
            { label: '$(graph) Contact Map', description: 'Generate only the contact map GraphML', cmd: 'bng.run_contactmap' },
            { label: '$(type-hierarchy) All Graphs', description: 'Generate contact map, rule visualization, and regulatory GraphML outputs', cmd: 'bng.run_viz' },
            { label: '$(folder) Results Folder...', description: 'Choose where generated results are written', cmd: 'bng.results_folder' },
        );
    }
    if (['gdat', 'cdat', 'scan'].includes(ext || '')) {
        items.push(
            { label: '$(pulse) Plot', description: 'Open built-in plot viewer', cmd: 'bng.webview' },
        );
    }
    if (ext === 'graphml') {
        items.push(
            { label: '$(type-hierarchy) View', description: 'Open network graph viewer', cmd: 'bng.webview' },
        );
    }
    items.push(
        { label: '$(tools) Install', description: 'Check and install PyBioNetGen', cmd: 'bng.setup' },
        { label: '$(cloud-upload) Upgrade', description: 'Upgrade PyBioNetGen to latest version', cmd: 'bng.upgrade' },
    );

    const pick = await vscode.window.showQuickPick(items, { placeHolder: 'BioNetGen: Select an action' });
    if (pick) {
        vscode.commands.executeCommand(pick.cmd);
    }
}
