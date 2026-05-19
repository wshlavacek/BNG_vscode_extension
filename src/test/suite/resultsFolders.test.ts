import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    getGraphmlVisualizationKind,
    getResultsBaseFolderUri,
    getResultsRootFolderName,
    getResultsRunFolderUri,
    isGeneratedResultsRunFolderName,
    resolveResultsBaseFolderPath,
    shouldUseStandaloneContactMapPalette,
} from '../../resultsFolders';

suite('Results Folders', () => {
    test('uses results_<model> naming for managed results roots', () => {
        const filePath = path.join('/tmp', 'examples', 'nfkb.bngl');
        assert.strictEqual(getResultsRootFolderName(filePath), 'results_nfkb');
    });

    test('recognizes generated timestamp run folder names', () => {
        assert.strictEqual(isGeneratedResultsRunFolderName('2026_05_18__12_34_56'), true);
        assert.strictEqual(isGeneratedResultsRunFolderName('results_nfkb'), false);
        assert.strictEqual(isGeneratedResultsRunFolderName('2026-05-18'), false);
    });

    test('detects standalone contact maps only when no other graphml outputs are present', () => {
        const filePath = path.join('/tmp', 'results_nfkb', '2026_05_18__12_34_56', 'nfkb_contactmap.graphml');
        assert.strictEqual(
            shouldUseStandaloneContactMapPalette(filePath, ['nfkb.bngl', 'nfkb_contactmap.graphml']),
            true
        );
        assert.strictEqual(
            shouldUseStandaloneContactMapPalette(filePath, ['nfkb.bngl', 'nfkb_contactmap.graphml', 'nfkb_regulatory.graphml']),
            false
        );
    });

    test('classifies graphml visualization kinds from filenames', () => {
        assert.strictEqual(getGraphmlVisualizationKind('/tmp/nfkb_contactmap.graphml'), 'contactmap');
        assert.strictEqual(getGraphmlVisualizationKind('/tmp/nfkb_regulatory.graphml'), 'regulatory');
        assert.strictEqual(getGraphmlVisualizationKind('/tmp/nfkb_ruleviz_operation.graphml'), 'ruleviz');
        assert.strictEqual(getGraphmlVisualizationKind('/tmp/nfkb_notes.txt'), 'other');
    });

    test('uses the model folder when no custom results base is configured', () => {
        const modelPath = path.join('/tmp', 'examples', 'nfkb_test.bngl');
        const fakeConfig = {
            get: () => null
        } as unknown as vscode.WorkspaceConfiguration;

        const resultsBaseUri = getResultsBaseFolderUri(fakeConfig, vscode.Uri.file(modelPath));
        assert.strictEqual(resultsBaseUri.fsPath, path.dirname(modelPath));
    });

    test('uses the configured absolute results base folder', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bngl-results-test-'));
        const customBase = path.join(tmpDir, 'custom_out');
        const modelPath = path.join(tmpDir, 'nfkb_test.bngl');
        const fakeConfig = {
            get: (key: string) => key === 'general.result_folder' ? customBase : null
        } as unknown as vscode.WorkspaceConfiguration;

        try {
            const modelUri = vscode.Uri.file(modelPath);
            const runUri = getResultsRunFolderUri(fakeConfig, modelUri, '2026_05_19__01_02_03');
            assert.strictEqual(runUri.fsPath, path.join(customBase, 'results_nfkb_test', '2026_05_19__01_02_03'));
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('resolves relative custom results folders from the workspace folder', () => {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        assert.ok(workspaceRoot, 'expected an active workspace folder in the test environment');

        const modelDir = fs.mkdtempSync(path.join(workspaceRoot!, 'tmp-results-folder-test-'));
        const modelPath = path.join(modelDir, 'nfkb_test.bngl');

        try {
            fs.writeFileSync(modelPath, 'begin model\nend model\n', 'utf8');

            const resolvedPath = resolveResultsBaseFolderPath('custom-output', vscode.Uri.file(modelPath));
            assert.strictEqual(resolvedPath, path.join(workspaceRoot!, 'custom-output'));
        } finally {
            fs.rmSync(modelDir, { recursive: true, force: true });
        }
    });
});
