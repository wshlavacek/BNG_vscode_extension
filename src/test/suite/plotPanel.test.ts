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

const SAMPLE_REGULATORY_GRAPHML = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<graphml xmlns="http://graphml.graphdrawing.org/xmlns" xmlns:y="http://www.yworks.com/xml/graphml">
  <key id="d0" for="node" yfiles.type="nodegraphics"/>
  <graph edgedefault="directed" id="G">
    <node id="n0">
      <data key="d0">
        <y:ShapeNode>
          <y:Fill color="#FFE9C7"/>
          <y:BorderStyle color="#999999" type="line" width="1"/>
          <y:Shape type="roundrectangle"/>
          <y:NodeLabel textColor="#000000">A()</y:NodeLabel>
        </y:ShapeNode>
      </data>
    </node>
    <node id="n1">
      <data key="d0">
        <y:ShapeNode>
          <y:Fill color="#CC99FF"/>
          <y:BorderStyle color="#999999" type="line" width="1"/>
          <y:Shape type="ellipse"/>
          <y:NodeLabel textColor="#000000"></y:NodeLabel>
        </y:ShapeNode>
      </data>
    </node>
    <node id="n2">
      <data key="d0">
        <y:ShapeNode>
          <y:Fill color="#CC99FF"/>
          <y:BorderStyle color="#999999" type="line" width="1"/>
          <y:Shape type="ellipse"/>
          <y:NodeLabel textColor="#000000"></y:NodeLabel>
        </y:ShapeNode>
      </data>
    </node>
  </graph>
</graphml>
`;

const SAMPLE_MODEL_BNGL = [
    'begin model',
    'begin reaction rules',
    'A() <-> B() kf, kr',
    'namedRule: B() -> C() k2',
    'end reaction rules',
    'end model',
    ''
].join('\n');

suite('PlotPanel', () => {
    let tmpDir: string;
    let modelPath: string;
    let graphmlPath: string;
    let regulatoryGraphmlPath: string;
    let rulevizOperationGraphmlPath: string;
    let splitRulevizOperationGraphmlPath: string;

    suiteSetup(async function () {
        this.timeout(30_000);

        const ext = vscode.extensions.getExtension('als251.bngl');
        if (ext && !ext.isActive) {
            await ext.activate();
        }
    });

    setup(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bngl-plotpanel-test-'));
        const contactMapDir = path.join(tmpDir, 'contactmap');
        const regulatoryDir = path.join(tmpDir, 'regulatory');
        const rulevizDir = path.join(tmpDir, 'ruleviz');
        const splitRulevizDir = path.join(tmpDir, 'ruleviz_split');

        [contactMapDir, regulatoryDir, rulevizDir, splitRulevizDir].forEach((dir) => {
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'test_model.bngl'), SAMPLE_MODEL_BNGL, 'utf8');
        });

        modelPath = path.join(contactMapDir, 'test_model.bngl');
        graphmlPath = path.join(contactMapDir, 'test_contactmap.graphml');
        fs.writeFileSync(graphmlPath, SAMPLE_GRAPHML, 'utf8');
        regulatoryGraphmlPath = path.join(regulatoryDir, 'test_model_regulatory.graphml');
        fs.writeFileSync(regulatoryGraphmlPath, SAMPLE_REGULATORY_GRAPHML, 'utf8');
        rulevizOperationGraphmlPath = path.join(rulevizDir, 'test_model_ruleviz_operation.graphml');
        fs.writeFileSync(rulevizOperationGraphmlPath, SAMPLE_GRAPHML, 'utf8');
        splitRulevizOperationGraphmlPath = path.join(splitRulevizDir, 'test_model_ruleviz_operation__R1.graphml');
        fs.writeFileSync(splitRulevizOperationGraphmlPath, SAMPLE_GRAPHML, 'utf8');
        fs.writeFileSync(path.join(splitRulevizDir, 'test_model_ruleviz_operation__reverse__R1.graphml'), SAMPLE_GRAPHML, 'utf8');
        fs.writeFileSync(path.join(splitRulevizDir, 'test_model_ruleviz_operation_namedRule.graphml'), SAMPLE_GRAPHML, 'utf8');
    });

    teardown(async () => {
        Array.from(PlotPanel.currentPanels.values()).forEach((panel) => panel.dispose());
        PlotPanel.currentPanels.clear();

        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('uses graph-specific titles and exposes layout/save controls for GraphML', async function () {
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
        assert.match(html, /Lock Layout/);
        assert.match(html, /Scale to Fit/);
        assert.match(html, /Night View/);
        assert.match(html, /Hide Components/);
        assert.match(html, /Hide Internal States/);
        assert.match(html, /Save PNG/);
        assert.match(html, /Save GraphML/);
        assert.doesNotMatch(html, /Delete Results/);
        assert.doesNotMatch(html, /Apply Layout/);
        assert.doesNotMatch(html, /Reset View/);

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

    test('reports standalone regulatory graph metadata and BNGL rule text for regulatory GraphML', async function () {
        this.timeout(15_000);

        PlotPanel.create(
            vscode.extensions.getExtension('als251.bngl')!.extensionUri,
            vscode.Uri.file(regulatoryGraphmlPath),
            vscode.ViewColumn.One
        );

        const panelWrapper = PlotPanel.currentPanels.get(regulatoryGraphmlPath) as any;
        assert.ok(panelWrapper, 'expected a PlotPanel instance for the regulatory GraphML file');

        const panel = panelWrapper._panel as vscode.WebviewPanel;
        const postedMessages: any[] = [];
        const originalPostMessage = panel.webview.postMessage.bind(panel.webview);
        panel.webview.postMessage = ((message: any) => {
            postedMessages.push(message);
            return Promise.resolve(true);
        }) as typeof panel.webview.postMessage;

        try {
            await panelWrapper._send_figure_data();
        } finally {
            panel.webview.postMessage = originalPostMessage;
        }

        const networkMessage = postedMessages.find((message) => message.command === 'network');
        assert.ok(networkMessage, 'expected a network payload to be posted to the webview');
        assert.strictEqual(networkMessage.graphKind, 'regulatory');
        assert.strictEqual(networkMessage.standaloneGraphPaletteKind, 'regulatory');
        assert.strictEqual(networkMessage.regulatoryRuleBnglByLabel._R1, 'A() <-> B() kf, kr');
        assert.strictEqual(networkMessage.regulatoryRuleBnglByLabel._reverse__R1, 'A() <-> B() kf, kr');
        assert.strictEqual(networkMessage.regulatoryRuleBnglByLabel.namedRule, 'namedRule: B() -> C() k2');
    });

    test('reports standalone RuleViz (Operation) metadata for operation GraphML', async function () {
        this.timeout(15_000);

        PlotPanel.create(
            vscode.extensions.getExtension('als251.bngl')!.extensionUri,
            vscode.Uri.file(rulevizOperationGraphmlPath),
            vscode.ViewColumn.One
        );

        const panelWrapper = PlotPanel.currentPanels.get(rulevizOperationGraphmlPath) as any;
        assert.ok(panelWrapper, 'expected a PlotPanel instance for the RuleViz (Operation) GraphML file');

        const panel = panelWrapper._panel as vscode.WebviewPanel;
        const postedMessages: any[] = [];
        const originalPostMessage = panel.webview.postMessage.bind(panel.webview);
        panel.webview.postMessage = ((message: any) => {
            postedMessages.push(message);
            return Promise.resolve(true);
        }) as typeof panel.webview.postMessage;

        try {
            await panelWrapper._send_figure_data();
        } finally {
            panel.webview.postMessage = originalPostMessage;
        }

        const networkMessage = postedMessages.find((message) => message.command === 'network');
        assert.ok(networkMessage, 'expected a network payload to be posted to the webview');
        assert.strictEqual(networkMessage.graphKind, 'ruleviz_operation');
        assert.strictEqual(networkMessage.standaloneGraphPaletteKind, 'ruleviz_operation');
    });

    test('bundles standalone split RuleViz (Operation) outputs into an ordered browser payload', async function () {
        this.timeout(15_000);

        PlotPanel.create(
            vscode.extensions.getExtension('als251.bngl')!.extensionUri,
            vscode.Uri.file(splitRulevizOperationGraphmlPath),
            vscode.ViewColumn.One
        );

        const panelWrapper = Array.from(PlotPanel.currentPanels.values())[0] as any;
        assert.ok(panelWrapper, 'expected a PlotPanel instance for the split RuleViz (Operation) GraphML files');

        const panel = panelWrapper._panel as vscode.WebviewPanel;
        const postedMessages: any[] = [];
        const originalPostMessage = panel.webview.postMessage.bind(panel.webview);
        panel.webview.postMessage = ((message: any) => {
            postedMessages.push(message);
            return Promise.resolve(true);
        }) as typeof panel.webview.postMessage;

        try {
            await panelWrapper._send_figure_data();
        } finally {
            panel.webview.postMessage = originalPostMessage;
        }

        const browserMessage = postedMessages.find((message) => message.command === 'ruleviz-browser');
        assert.ok(browserMessage, 'expected a standalone RuleViz browser payload to be posted to the webview');
        assert.strictEqual(browserMessage.graphKind, 'ruleviz_operation');
        assert.strictEqual(browserMessage.standaloneGraphPaletteKind, 'ruleviz_operation');
        assert.strictEqual(browserMessage.rows.length, 3);
        assert.strictEqual(browserMessage.rows[0].displayLabel, '_R1');
        assert.strictEqual(browserMessage.rows[0].bnglText, 'A() <-> B() kf, kr');
        assert.strictEqual(browserMessage.rows[1].displayLabel, '_reverse__R1');
        assert.strictEqual(browserMessage.rows[1].bnglText, 'A() <-> B() kf, kr');
        assert.strictEqual(browserMessage.rows[2].displayLabel, 'namedRule');
        assert.strictEqual(browserMessage.rows[2].bnglText, 'namedRule: B() -> C() k2');
    });
});
