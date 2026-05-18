import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { PlotPanel } from '../../plotting/PlotPanel';

const SAMPLE_GRAPHML = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<graphml xmlns="http://graphml.graphdrawing.org/xmlns" xmlns:y="http://www.yworks.com/xml/graphml">
  <key id="d0" for="node" yfiles.type="nodegraphics"/>
  <key id="d1" for="edge" yfiles.type="edgegraphics"/>
  <graph edgedefault="directed" id="G">
    <node id="n0">
      <data key="d0">
        <y:ShapeNode>
          <y:Fill color="#FFE9C7"/>
          <y:BorderStyle color="#999999" type="line" width="1"/>
          <y:Shape type="roundrectangle"/>
          <y:NodeLabel textColor="#000000">A</y:NodeLabel>
        </y:ShapeNode>
      </data>
    </node>
    <node id="n1">
      <data key="d0">
        <y:ShapeNode>
          <y:Fill color="#FFE9C7"/>
          <y:BorderStyle color="#999999" type="line" width="1"/>
          <y:Shape type="roundrectangle"/>
          <y:NodeLabel textColor="#000000">B</y:NodeLabel>
        </y:ShapeNode>
      </data>
    </node>
    <edge id="e0" source="n0" target="n1">
      <data key="d1">
        <y:PolyLineEdge>
          <y:LineStyle color="#999999" type="line" width="1"/>
          <y:Arrows source="none" target="standard"/>
        </y:PolyLineEdge>
      </data>
    </edge>
  </graph>
</graphml>
`;

suite('PlotPanel', () => {
    let tmpDir: string;
    let modelPath: string;
    let graphmlPath: string;

    suiteSetup(async function () {
        this.timeout(30_000);

        const ext = vscode.extensions.getExtension('als251.bngl');
        if (ext && !ext.isActive) {
            await ext.activate();
        }
    });

    setup(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bngl-plotpanel-test-'));
        modelPath = path.join(tmpDir, 'test_model.bngl');
        fs.writeFileSync(modelPath, 'begin model\nend model\n', 'utf8');
        graphmlPath = path.join(tmpDir, 'test_contactmap.graphml');
        fs.writeFileSync(graphmlPath, SAMPLE_GRAPHML, 'utf8');
    });

    teardown(async () => {
        const plotPanel = PlotPanel.currentPanels.get(graphmlPath);
        plotPanel?.dispose();
        PlotPanel.currentPanels.clear();

        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('uses graph-specific titles and exposes layout/export controls for GraphML', async function () {
        this.timeout(15_000);

        PlotPanel.create(
            vscode.extensions.getExtension('als251.bngl')!.extensionUri,
            vscode.Uri.file(graphmlPath),
            vscode.ViewColumn.One
        );

        const panelWrapper = PlotPanel.currentPanels.get(graphmlPath) as any;
        assert.ok(panelWrapper, 'expected a PlotPanel instance for the explicit GraphML file');

        const panel = panelWrapper._panel as vscode.WebviewPanel;
        assert.strictEqual(panel.title, 'test_contactmap');

        const html = panel.webview.html;
        assert.match(html, /id="layout_select"/);
        assert.match(html, /Apply Layout/);
        assert.match(html, /Reset View/);
        assert.match(html, /Night View/);
        assert.match(html, /Export PNG/);
        assert.match(html, /Export GraphML/);
        assert.doesNotMatch(html, /Delete Results/);

        PlotPanel.create(
            vscode.extensions.getExtension('als251.bngl')!.extensionUri,
            vscode.Uri.file(graphmlPath),
            vscode.ViewColumn.One
        );
        assert.strictEqual(PlotPanel.currentPanels.size, 1, 'expected re-opening to reuse the existing panel');
    });

    test('can open a viewer for an explicit file without replacing the current model editor', async function () {
        this.timeout(15_000);

        const modelDoc = await vscode.workspace.openTextDocument(modelPath);
        const modelEditor = await vscode.window.showTextDocument(modelDoc, {
            preview: true,
            viewColumn: vscode.ViewColumn.One
        });

        PlotPanel.create(
            vscode.extensions.getExtension('als251.bngl')!.extensionUri,
            vscode.Uri.file(graphmlPath),
            modelEditor.viewColumn
        );

        const panelWrapper = PlotPanel.currentPanels.get(graphmlPath) as any;
        assert.ok(panelWrapper, 'expected a PlotPanel instance for the explicit GraphML file');
        assert.strictEqual(vscode.window.activeTextEditor?.document.fileName, modelPath);

        const openTextEditors = vscode.window.visibleTextEditors.map((editor) => editor.document.fileName);
        assert.ok(openTextEditors.includes(modelPath), 'expected the BNGL model editor to remain open');
        assert.ok(!openTextEditors.includes(graphmlPath), 'expected the raw GraphML text editor not to be opened');
    });
});
