import * as path from 'path';
import * as vscode from 'vscode';

const GENERATED_RESULTS_RUN_PATTERN = /^\d{4}_\d{2}_\d{2}__\d{2}_\d{2}_\d{2}$/;

export type GraphmlVisualizationKind = 'contactmap' | 'regulatory' | 'ruleviz_pattern' | 'ruleviz_operation' | 'ruleviz' | 'other';
export type StandaloneGraphPaletteKind = Extract<GraphmlVisualizationKind, 'contactmap' | 'regulatory' | 'ruleviz_operation'>;

function isGraphmlFileName(name: string): boolean {
    return path.extname(name).toLowerCase() === '.graphml';
}

export function getModelBaseName(filePath: string): string {
    return path.basename(filePath, path.extname(filePath));
}

export function getResultsRootFolderName(filePath: string): string {
    return `results_${getModelBaseName(filePath)}`;
}

export function getConfiguredResultsBaseFolderPath(config: vscode.WorkspaceConfiguration): string | undefined {
    const configuredPath = config.get<string | null>('general.result_folder');
    return configuredPath && configuredPath.trim().length > 0 ? configuredPath.trim() : undefined;
}

export function getModelFolderUri(fileUri: vscode.Uri): vscode.Uri {
    return vscode.Uri.file(path.dirname(fileUri.fsPath));
}

export function resolveResultsBaseFolderPath(configuredPath: string, fileUri: vscode.Uri): string {
    if (path.isAbsolute(configuredPath)) {
        return path.normalize(configuredPath);
    }

    const workspaceFolderPath = vscode.workspace.getWorkspaceFolder(fileUri)?.uri.fsPath;
    const anchorPath = workspaceFolderPath ?? path.dirname(fileUri.fsPath);
    return path.resolve(anchorPath, configuredPath);
}

export function getResultsBaseFolderUri(config: vscode.WorkspaceConfiguration, fileUri: vscode.Uri): vscode.Uri {
    const configuredPath = getConfiguredResultsBaseFolderPath(config);
    return configuredPath
        ? vscode.Uri.file(resolveResultsBaseFolderPath(configuredPath, fileUri))
        : getModelFolderUri(fileUri);
}

export function getResultsRootUri(config: vscode.WorkspaceConfiguration, fileUri: vscode.Uri): vscode.Uri {
    return vscode.Uri.joinPath(getResultsBaseFolderUri(config, fileUri), getResultsRootFolderName(fileUri.fsPath));
}

export function getResultsRunFolderUri(config: vscode.WorkspaceConfiguration, fileUri: vscode.Uri, timestamp: string): vscode.Uri {
    return vscode.Uri.joinPath(getResultsRootUri(config, fileUri), timestamp);
}

export function getResultsFolderConfigurationTarget(fileUri: vscode.Uri): vscode.ConfigurationTarget {
    if (vscode.workspace.getWorkspaceFolder(fileUri)) {
        return vscode.ConfigurationTarget.WorkspaceFolder;
    }

    if (vscode.workspace.workspaceFile || (vscode.workspace.workspaceFolders?.length ?? 0) > 0) {
        return vscode.ConfigurationTarget.Workspace;
    }

    return vscode.ConfigurationTarget.Global;
}

export function isGeneratedResultsRunFolderName(name: string): boolean {
    return GENERATED_RESULTS_RUN_PATTERN.test(name);
}

export function getGraphmlVisualizationKind(filePath: string): GraphmlVisualizationKind {
    if (!isGraphmlFileName(filePath)) {
        return 'other';
    }

    const baseName = path.basename(filePath, path.extname(filePath)).toLowerCase();

    if (baseName.includes('contactmap')) {
        return 'contactmap';
    }

    if (baseName.includes('regulatory')) {
        return 'regulatory';
    }

    if (baseName.includes('ruleviz_operation')) {
        return 'ruleviz_operation';
    }

    if (baseName.includes('ruleviz_pattern')) {
        return 'ruleviz_pattern';
    }

    if (baseName.includes('ruleviz')) {
        return 'ruleviz';
    }

    return 'other';
}

export function isContactMapGraphmlFileName(name: string): boolean {
    return getGraphmlVisualizationKind(name) === 'contactmap';
}

export function isRegulatoryGraphmlFileName(name: string): boolean {
    return getGraphmlVisualizationKind(name) === 'regulatory';
}

export function getStandaloneGraphPaletteKind(filePath: string, siblingNames: readonly string[]): StandaloneGraphPaletteKind | null {
    const currentFileName = path.basename(filePath);
    const currentKind = getGraphmlVisualizationKind(currentFileName);

    if (currentKind !== 'contactmap' && currentKind !== 'regulatory' && currentKind !== 'ruleviz_operation') {
        return null;
    }

    const hasConflictingGraphmlSibling = siblingNames.some((name) => {
        if (name === currentFileName) {
            return false;
        }

        const siblingKind = getGraphmlVisualizationKind(name);
        return siblingKind !== 'other' && siblingKind !== currentKind;
    });

    return hasConflictingGraphmlSibling ? null : currentKind;
}

export function shouldUseStandaloneContactMapPalette(filePath: string, siblingNames: readonly string[]): boolean {
    return getStandaloneGraphPaletteKind(filePath, siblingNames) === 'contactmap';
}

export function shouldUseStandaloneRegulatoryPalette(filePath: string, siblingNames: readonly string[]): boolean {
    return getStandaloneGraphPaletteKind(filePath, siblingNames) === 'regulatory';
}

export function shouldUseStandaloneRulevizOperationLayout(filePath: string, siblingNames: readonly string[]): boolean {
    return getStandaloneGraphPaletteKind(filePath, siblingNames) === 'ruleviz_operation';
}
