import * as vscode from 'vscode';
import * as path from 'path';
import { parseDat } from '../parseDat';

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export class PlotPanel {
    public static currentPanels = new Map<string, PlotPanel>();
    public static readonly viewType = 'plot';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, private _fpath: string) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        this._setup();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'alert':
                    vscode.window.showInformationMessage(message.text);
                    return;
                case 'ready':
                    this._send_figure_data();
                    return;
                case 'image':
                    this._save_image(message);
                    return;
            }
        }, null, this._disposables);

        this._panel.onDidChangeViewState(() => {
            if (this._panel.visible) {
                this._send_figure_data();
            }
        }, null, this._disposables);
    }

    public static create(extensionUri: vscode.Uri) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const fpath = editor.document.fileName;
        const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

        if (PlotPanel.currentPanels.has(fpath)) {
            PlotPanel.currentPanels.get(fpath)?._panel.reveal(column);
            return;
        }

        const extension = path.extname(fpath).substring(1);
        let title = 'Unknown';
        if (extension === 'graphml') title = 'GraphML Viewer';
        else if (extension === 'gdat' || extension === 'cdat') title = 'Plot viewer';
        else if (extension === 'scan') title = 'Scan Plot';

        const panel = vscode.window.createWebviewPanel(
            PlotPanel.viewType,
            title,
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
                retainContextWhenHidden: true
            }
        );

        PlotPanel.currentPanels.set(fpath, new PlotPanel(panel, extensionUri, fpath));
    }

    private _setup() {
        const webview = this._panel.webview;
        const nonce = getNonce();
        const extension = path.extname(this._fpath).substring(1);
        const fname = path.basename(this._fpath, path.extname(this._fpath));

        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));
        const plotlyUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'plotly-latest.min.js'));
        const cytoUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'cytoscape.min.js'));
        const jqUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'jquery-3.5.1.min.js'));
        const stylesMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css'));

        const folder = path.dirname(this._fpath);

        webview.html = this._get_html(webview, nonce, fname, extension, folder, stylesMainUri, jqUri, cytoUri, plotlyUri, scriptUri);
    }

    private _get_html(webview: vscode.Webview, nonce: string, fname: string, ext: string, folder: string, stylesMainUri: vscode.Uri, jqUri: vscode.Uri, cytoUri: vscode.Uri, plotlyUri: vscode.Uri, scriptUri: vscode.Uri) {
        const safeFname = escapeHtml(fname);
        const safeExt = escapeHtml(ext);
        const safeFolder = escapeHtml(folder);
        let content = '';
        if (ext === 'graphml') {
            content = `
                <div id="network"></div>
                <div id="top_buttons">
                  <button id="layout_button" class="button" type="button">Redo Layout</button>
                  <button id="png_button" class="button" type="button">Save as PNG</button>
                </div>
                <script nonce="${nonce}" src="${jqUri}"></script>
                <script nonce="${nonce}" src="${cytoUri}"></script>
            `;
        } else {
            content = `
                <div id="sidebar">
                    <div class="sidebar-header">
                        <h3>Variables</h3>
                        <div class="sidebar-actions">
                            <button id="show-all" class="secondary">All</button>
                            <button id="show-none" class="secondary">None</button>
                        </div>
                        <input type="text" id="var-filter" placeholder="Filter variables...">
                    </div>
                    <div id="var-list"></div>
                    <div class="sidebar-controls">
                        <div class="control-group">
                            <label>X Axis</label>
                            <div class="control-buttons">
                                <button id="xaxis-linear" class="control-btn active">Linear</button>
                                <button id="xaxis-log" class="control-btn">Log</button>
                            </div>
                        </div>
                        <div class="control-group">
                            <label>Y Axis</label>
                            <div class="control-buttons">
                                <button id="yaxis-linear" class="control-btn active">Linear</button>
                                <button id="yaxis-log" class="control-btn">Log</button>
                            </div>
                        </div>
                        <div class="control-group">
                            <label>Legend</label>
                            <div class="control-buttons">
                                <button id="legend-on" class="control-btn active">On</button>
                                <button id="legend-off" class="control-btn">Off</button>
                            </div>
                        </div>
                        <div class="control-group">
                            <label>Style</label>
                            <div class="control-buttons">
                                <button id="style-lines" class="control-btn active">Lines</button>
                                <button id="style-markers" class="control-btn">Markers</button>
                                <button id="style-both" class="control-btn">Both</button>
                            </div>
                        </div>
                    </div>
                    <div class="sidebar-footer">
                        <button id="export-png">Export PNG</button>
                        <button id="export-svg" class="secondary">Export SVG</button>
                    </div>
                </div>
                <div id="plot-container">
                    <div id="plot"></div>
                </div>
                <script nonce="${nonce}" src="${plotlyUri}"></script>
            `;
        }

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data: blob:; script-src 'nonce-${nonce}' 'unsafe-eval';">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${stylesMainUri}" rel="stylesheet">
            </head>
            <body>
                <div id="page_title" style="display: none;">${safeFname}_${safeExt}</div>
                <div id="folder" style="display: none;">${safeFolder}</div>
                ${content}
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }

    private async _send_figure_data() {
        const ext = path.extname(this._fpath).substring(1);
        const fileUri = vscode.Uri.file(this._fpath);
        const rawBytes = await vscode.workspace.fs.readFile(fileUri);
        const text = Buffer.from(rawBytes).toString('utf8');
        const config = vscode.workspace.getConfiguration('bngl');

        if (ext === 'graphml') {
            this._panel.webview.postMessage({ command: 'network', context: 'data', data: text });
        } else {
            const data = parseDat(text);
            this._panel.webview.postMessage({
                command: 'plot',
                context: 'data',
                names: data[0],
                data: data[1],
                legend: config.get('plotting.legend'),
                max_series: config.get('plotting.max_series_count'),
            });
        }
    }

    private _save_image(message: any) {
        const folder = vscode.Uri.file(message.folder);
        const uri = vscode.Uri.joinPath(folder, `${message.title}_${message.type}.${message.type === 'png' ? 'png' : 'svg'}`);
        let data: Buffer;
        if (message.type === 'png') {
            const prefix = 'data:image/png;base64,';
            if (!message.text.startsWith(prefix)) {
                vscode.window.showErrorMessage('Invalid PNG data URI.');
                return;
            }
            data = Buffer.from(message.text.slice(prefix.length), 'base64');
        } else {
            const prefix = 'data:image/svg+xml,';
            const decoded = decodeURIComponent(message.text);
            if (!decoded.startsWith(prefix)) {
                vscode.window.showErrorMessage('Invalid SVG data URI.');
                return;
            }
            data = Buffer.from(decoded.slice(prefix.length));
        }
        vscode.workspace.fs.writeFile(uri, data).then(() => {
            vscode.window.showInformationMessage(`Image saved to ${uri.fsPath}`);
        }, (err) => {
            vscode.window.showErrorMessage(`Failed to save image: ${err.message}`);
        });
    }

    public dispose() {
        PlotPanel.currentPanels.delete(this._fpath);
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) x.dispose();
        }
    }
}
