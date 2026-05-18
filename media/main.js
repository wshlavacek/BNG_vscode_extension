// This script will be run within the webview itself
// It cannot access the main VS Code APIs directly.
(function () {
    const vscode = acquireVsCodeApi();

    const network = document.getElementById('network');
    const plotElement = document.getElementById('plot');
    const viewModeButton = document.getElementById('view_mode_button');

    const page_title = document.getElementById('page_title').innerText;
    const page_folder = document.getElementById('folder').innerText;

    // Accessible qualitative palette based on seaborn's colorblind cycle.
    const plotSeriesColors = [
        "#0173B2",
        "#DE8F05",
        "#029E73",
        "#D55E00",
        "#CC78BC",
        "#56B4E9",
        "#CA9161",
        "#949494",
        "#FBAFE4",
        "#ECE133"
    ];
    const plotSeriesColorCount = plotSeriesColors.length;
    const plotPngExportScale = 2;
    const graphPngExportScale = 4;
    const graphFitPadding = 40;
    const VIEW_MODE_LIGHT = 'light';
    const VIEW_MODE_DARK = 'dark';
    const contactMapViewerPalette = {
        moleculeFill: '#c8d5e6',
        nestedFill: '#f4f7fb',
        siteFill: '#97d6c9',
        border: '#5f7083',
        edge: '#66798d',
        label: '#24313d'
    };

    let current_plot_data = [];
    let plotReady = false;
    let currentCy = null;
    let useContactMapViewerPalette = false;
    let hostViewMode = inferHostViewMode();
    let currentViewMode = resolveInitialViewMode();

    function cssVar(name, fallback = '') {
        const value = window.getComputedStyle(document.body).getPropertyValue(name).trim();
        return value || fallback;
    }

    function clampChannel(value) {
        return Math.max(0, Math.min(255, Math.round(value)));
    }

    function clampOpacity(value) {
        return Math.max(0, Math.min(1, value));
    }

    function parseColor(color) {
        if (!color) {
            return null;
        }

        const value = color.trim();
        if (!value || value === 'none' || value === 'transparent') {
            return null;
        }

        const hexMatch = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
        if (hexMatch) {
            let digits = hexMatch[1];
            if (digits.length === 3) {
                digits = digits.split('').map((digit) => digit + digit).join('');
            }

            if (digits.length === 6) {
                digits += 'ff';
            }

            return {
                r: parseInt(digits.slice(0, 2), 16),
                g: parseInt(digits.slice(2, 4), 16),
                b: parseInt(digits.slice(4, 6), 16),
                a: parseInt(digits.slice(6, 8), 16) / 255
            };
        }

        const rgbMatch = value.match(/^rgba?\(([^)]+)\)$/i);
        if (rgbMatch) {
            const parts = rgbMatch[1].split(',').map((part) => part.trim());
            if (parts.length < 3) {
                return null;
            }

            const r = Number(parts[0]);
            const g = Number(parts[1]);
            const b = Number(parts[2]);
            const a = parts.length > 3 ? Number(parts[3]) : 1;

            if ([r, g, b, a].some((part) => Number.isNaN(part))) {
                return null;
            }

            return { r, g, b, a };
        }

        return null;
    }

    function toCssColor(color) {
        const r = clampChannel(color.r);
        const g = clampChannel(color.g);
        const b = clampChannel(color.b);
        const a = typeof color.a === 'number' ? clampOpacity(color.a) : 1;

        if (a < 1) {
            return `rgba(${r}, ${g}, ${b}, ${a})`;
        }

        return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
    }

    function normalizeColorKey(color) {
        const parsed = parseColor(color);
        if (!parsed) {
            return (color || '').trim().toLowerCase();
        }

        return toCssColor({
            r: parsed.r,
            g: parsed.g,
            b: parsed.b,
            a: 1
        }).toLowerCase();
    }

    function mixColors(base, mixin, ratio) {
        const clampedRatio = Math.max(0, Math.min(1, ratio));
        return {
            r: base.r + (mixin.r - base.r) * clampedRatio,
            g: base.g + (mixin.g - base.g) * clampedRatio,
            b: base.b + (mixin.b - base.b) * clampedRatio,
            a: typeof base.a === 'number' ? base.a : 1
        };
    }

    function channelToLinear(channel) {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    }

    function getRelativeLuminance(color) {
        return (0.2126 * channelToLinear(color.r))
            + (0.7152 * channelToLinear(color.g))
            + (0.0722 * channelToLinear(color.b));
    }

    function isColorDark(color) {
        const parsed = parseColor(color);
        if (!parsed) {
            return false;
        }

        return getRelativeLuminance(parsed) < 0.45;
    }

    function liftColorForDarkMode(color, minimumLuminance) {
        const parsed = parseColor(color);
        if (!parsed) {
            return color;
        }

        if (getRelativeLuminance(parsed) >= minimumLuminance) {
            return color;
        }

        let ratio = 0;
        let candidate = parsed;
        while (getRelativeLuminance(candidate) < minimumLuminance && ratio < 1) {
            ratio += 0.08;
            candidate = mixColors(parsed, { r: 255, g: 255, b: 255, a: parsed.a }, ratio);
        }

        return toCssColor(candidate);
    }

    function inferHostViewMode() {
        const hostBackground = cssVar('--vscode-editor-background', window.getComputedStyle(document.body).backgroundColor);
        return isColorDark(hostBackground) ? VIEW_MODE_DARK : VIEW_MODE_LIGHT;
    }

    function resolveInitialViewMode() {
        const state = vscode.getState() || {};
        if (state.viewMode === VIEW_MODE_LIGHT || state.viewMode === VIEW_MODE_DARK) {
            return state.viewMode;
        }

        return inferHostViewMode();
    }

    function persistViewMode(mode) {
        const state = vscode.getState() || {};
        vscode.setState({
            ...state,
            viewMode: mode
        });
    }

    function getPlotTheme() {
        return {
            foreground: cssVar('--viewer-foreground', '#1f2328'),
            border: cssVar('--viewer-border', '#c5ccd6'),
            grid: cssVar('--viewer-plot-grid', '#dbe2eb'),
            zeroLine: cssVar('--viewer-plot-zeroline', '#c7d0db'),
            paperBackground: cssVar('--viewer-plot-paper-background', cssVar('--viewer-background', '#ffffff')),
            plotBackground: cssVar('--viewer-plot-background', '#ffffff'),
            legendBackground: cssVar('--viewer-legend-background', 'rgba(255, 255, 255, 0.92)')
        };
    }

    function applyPlotTheme() {
        if (!plotElement || !plotReady) {
            return;
        }

        const theme = getPlotTheme();
        Plotly.relayout(plotElement, {
            paper_bgcolor: theme.paperBackground,
            plot_bgcolor: theme.plotBackground,
            'font.color': theme.foreground,
            'xaxis.color': theme.foreground,
            'xaxis.gridcolor': theme.grid,
            'xaxis.zerolinecolor': theme.zeroLine,
            'xaxis.title.font.color': theme.foreground,
            'yaxis.color': theme.foreground,
            'yaxis.gridcolor': theme.grid,
            'yaxis.zerolinecolor': theme.zeroLine,
            'yaxis.title.font.color': theme.foreground,
            'legend.bgcolor': theme.legendBackground,
            'legend.bordercolor': theme.border,
            'legend.font.color': theme.foreground
        });
    }

    function adaptGraphColor(color, role) {
        if (currentViewMode !== VIEW_MODE_DARK) {
            return color;
        }

        if (role === 'label') {
            return liftColorForDarkMode(color, 0.62);
        }

        return liftColorForDarkMode(color, 0.48);
    }

    function getContactMapBaseFillColor(sourceColor) {
        switch (normalizeColorKey(sourceColor)) {
            case '#d2d2d2':
                return contactMapViewerPalette.moleculeFill;
            case '#ffffff':
                return contactMapViewerPalette.nestedFill;
            case '#ffcc00':
                return contactMapViewerPalette.siteFill;
            default:
                return sourceColor;
        }
    }

    function getContactMapBaseStrokeColor(sourceColor, fallbackColor) {
        return normalizeColorKey(sourceColor) === '#000000' ? fallbackColor : sourceColor;
    }

    function getNodeBaseBackgroundColor(node) {
        const sourceColor = node.data('backgroundColor');
        return useContactMapViewerPalette ? getContactMapBaseFillColor(sourceColor) : sourceColor;
    }

    function getNodeBaseBorderColor(node) {
        const sourceColor = node.data('borderColor');
        if (!useContactMapViewerPalette) {
            return sourceColor;
        }

        return getContactMapBaseStrokeColor(sourceColor, contactMapViewerPalette.border);
    }

    function getNodeBaseLabelColor(node) {
        const sourceColor = node.data('labelColor');
        if (!useContactMapViewerPalette) {
            return sourceColor;
        }

        return getContactMapBaseStrokeColor(sourceColor, contactMapViewerPalette.label);
    }

    function getEdgeBaseLineColor(edge) {
        const sourceColor = edge.data('lineColor');
        if (!useContactMapViewerPalette) {
            return sourceColor;
        }

        return getContactMapBaseStrokeColor(sourceColor, contactMapViewerPalette.edge);
    }

    function applyGraphTheme() {
        if (!currentCy) {
            return;
        }

        currentCy.batch(() => {
            currentCy.nodes().forEach((node) => {
                node.data('displayBackgroundColor', getNodeBaseBackgroundColor(node));
                node.data('displayBorderColor', adaptGraphColor(getNodeBaseBorderColor(node), 'border'));
                node.data('displayLabelColor', adaptGraphColor(getNodeBaseLabelColor(node), 'label'));
            });

            currentCy.edges().forEach((edge) => {
                edge.data('displayLineColor', adaptGraphColor(getEdgeBaseLineColor(edge), 'edge'));
            });
        });

        currentCy.style().update();
    }

    function updateViewModeButton() {
        if (!viewModeButton) {
            return;
        }

        const buttonLabel = currentViewMode === VIEW_MODE_DARK ? 'Day View' : 'Night View';
        viewModeButton.textContent = buttonLabel;
        viewModeButton.setAttribute('aria-label', buttonLabel);
    }

    function applyBodyViewMode() {
        const useOverridePalette = currentViewMode !== hostViewMode;

        if (useOverridePalette) {
            document.body.dataset.viewMode = currentViewMode;
        } else {
            delete document.body.dataset.viewMode;
        }
    }

    function setViewMode(mode, persist) {
        currentViewMode = mode === VIEW_MODE_LIGHT ? VIEW_MODE_LIGHT : VIEW_MODE_DARK;
        applyBodyViewMode();
        updateViewModeButton();

        if (persist) {
            persistViewMode(currentViewMode);
        }

        applyPlotTheme();
        applyGraphTheme();
    }

    if (viewModeButton) {
        viewModeButton.onclick = function () {
            setViewMode(currentViewMode === VIEW_MODE_DARK ? VIEW_MODE_LIGHT : VIEW_MODE_DARK, true);
        };
    }

    setViewMode(currentViewMode, false);

    // Handle messages sent from the extension to the webview
    window.addEventListener('message', event => {
        const message = event.data; // The json data that the extension sent
        switch (message.command) {
            case 'plot':
                current_plot_data = [];

                const varList = document.getElementById('var-list');
                varList.innerHTML = '';

                for (let i = 0; i < message.names.length; i++) {
                    // names[0] is the x-axis label (e.g. "time"), data series start at index 1
                    if (i === 0) continue;

                    let seriesIndex = i - 1;
                    let color = plotSeriesColors[seriesIndex % plotSeriesColorCount];

                    let is_visible = seriesIndex < message.max_series;

                    let this_data = {
                        x: message.data[0],
                        y: message.data[i],
                        name: message.names[i],
                        visible: is_visible,
                        line: { color: color }
                    };
                    current_plot_data.push(this_data);

                    // Add to sidebar
                    const item = document.createElement('div');
                    item.className = 'var-item';
                    item.innerHTML = `
                        <input type="checkbox" id="var-${i}" ${is_visible ? 'checked' : ''}>
                        <span style="color: ${color}; font-weight: bold;">—</span>
                        <label for="var-${i}">${message.names[i]}</label>
                    `;
                    item.onclick = (e) => {
                        if (e.target.tagName !== 'INPUT') {
                            const cb = item.querySelector('input');
                            cb.checked = !cb.checked;
                            updateVisibility(seriesIndex, cb.checked);
                        }
                    };
                    item.querySelector('input').onchange = (e) => {
                        updateVisibility(seriesIndex, e.target.checked);
                    };
                    varList.appendChild(item);
                }

                function updateVisibility(index, visible) {
                    current_plot_data[index].visible = visible;
                    Plotly.restyle('plot', { visible: visible }, [index]);
                }

                // Sidebar Filter
                document.getElementById('var-filter').oninput = (e) => {
                    const filter = e.target.value.toLowerCase();
                    document.querySelectorAll('.var-item').forEach(item => {
                        const label = item.querySelector('label').innerText.toLowerCase();
                        item.style.display = label.includes(filter) ? 'flex' : 'none';
                    });
                };

                // Show All / None
                document.getElementById('show-all').onclick = () => {
                    const indices = current_plot_data.map((_, i) => i);
                    Plotly.restyle('plot', { visible: true }, indices);
                    document.querySelectorAll('.var-item input').forEach(cb => cb.checked = true);
                };
                document.getElementById('show-none').onclick = () => {
                    const indices = current_plot_data.map((_, i) => i);
                    Plotly.restyle('plot', { visible: false }, indices);
                    document.querySelectorAll('.var-item input').forEach(cb => cb.checked = false);
                };

                // Axis scale controls
                function setAxisType(axis, type) {
                    let update = {};
                    update[axis + '.type'] = type;
                    Plotly.relayout('plot', update);
                }

                document.getElementById('xaxis-linear').onclick = function() {
                    setAxisType('xaxis', 'linear');
                    document.getElementById('xaxis-linear').classList.add('active');
                    document.getElementById('xaxis-log').classList.remove('active');
                };
                document.getElementById('xaxis-log').onclick = function() {
                    setAxisType('xaxis', 'log');
                    document.getElementById('xaxis-log').classList.add('active');
                    document.getElementById('xaxis-linear').classList.remove('active');
                };
                document.getElementById('yaxis-linear').onclick = function() {
                    setAxisType('yaxis', 'linear');
                    document.getElementById('yaxis-linear').classList.add('active');
                    document.getElementById('yaxis-log').classList.remove('active');
                };
                document.getElementById('yaxis-log').onclick = function() {
                    setAxisType('yaxis', 'log');
                    document.getElementById('yaxis-log').classList.add('active');
                    document.getElementById('yaxis-linear').classList.remove('active');
                };

                // Legend toggle
                document.getElementById('legend-on').onclick = function() {
                    Plotly.relayout('plot', { showlegend: true });
                    this.classList.add('active');
                    document.getElementById('legend-off').classList.remove('active');
                };
                document.getElementById('legend-off').onclick = function() {
                    Plotly.relayout('plot', { showlegend: false });
                    this.classList.add('active');
                    document.getElementById('legend-on').classList.remove('active');
                };

                // Line style controls
                document.getElementById('style-lines').onclick = function() {
                    Plotly.restyle('plot', { mode: 'lines' });
                    document.querySelectorAll('.control-group:last-child .control-btn').forEach(b => b.classList.remove('active'));
                    this.classList.add('active');
                };
                document.getElementById('style-markers').onclick = function() {
                    Plotly.restyle('plot', { mode: 'markers' });
                    document.querySelectorAll('.control-group:last-child .control-btn').forEach(b => b.classList.remove('active'));
                    this.classList.add('active');
                };
                document.getElementById('style-both').onclick = function() {
                    Plotly.restyle('plot', { mode: 'lines+markers' });
                    document.querySelectorAll('.control-group:last-child .control-btn').forEach(b => b.classList.remove('active'));
                    this.classList.add('active');
                };

                // Export buttons
                document.getElementById('export-png').onclick = () => exportImage('png');
                document.getElementById('export-svg').onclick = () => exportImage('svg');

                function getPlotExportSize(gd) {
                    const rect = gd.getBoundingClientRect();
                    const layout = gd._fullLayout || {};

                    return {
                        width: Math.max(1, Math.round(layout.width || rect.width || 1200)),
                        height: Math.max(1, Math.round(layout.height || rect.height || 800))
                    };
                }

                function exportImage(format) {
                    const gd = plotElement;
                    const size = getPlotExportSize(gd);
                    const exportOptions = {
                        format: format,
                        width: size.width,
                        height: size.height
                    };

                    if (format === 'png') {
                        exportOptions.scale = plotPngExportScale;
                    }

                    Plotly.toImage(gd, {
                        ...exportOptions
                    }).then(url => {
                        vscode.postMessage({
                            command: 'image',
                            type: format,
                            title: page_title,
                            folder: page_folder,
                            text: url
                        });
                    });
                }

                const plotTheme = getPlotTheme();
                let plot_options = {
                    showlegend: message.legend,
                    hovermode: 'closest',
                    margin: { t: 30, r: 30, b: 50, l: 60 },
                    autosize: true,
                    paper_bgcolor: plotTheme.paperBackground,
                    plot_bgcolor: plotTheme.plotBackground,
                    font: {
                        color: plotTheme.foreground
                    },
                    xaxis: {
                        title: {
                            text: message.names[0],
                            font: {
                                color: plotTheme.foreground
                            }
                        },
                        color: plotTheme.foreground,
                        gridcolor: plotTheme.grid,
                        zerolinecolor: plotTheme.zeroLine
                    },
                    yaxis: {
                        title: {
                            text: 'Concentration',
                            font: {
                                color: plotTheme.foreground
                            }
                        },
                        color: plotTheme.foreground,
                        gridcolor: plotTheme.grid,
                        zerolinecolor: plotTheme.zeroLine
                    },
                    legend: {
                        orientation: 'h',
                        y: -0.2,
                        bgcolor: plotTheme.legendBackground,
                        bordercolor: plotTheme.border,
                        borderwidth: 1,
                        font: {
                            color: plotTheme.foreground
                        }
                    }
                };

                let config = {
                    responsive: true,
                    displaylogo: false,
                    modeBarButtonsToRemove: ['toImage'],
                    modeBarButtonsToAdd: ['select2d', 'lasso2d']
                };

                plotReady = false;
                Plotly.newPlot('plot', current_plot_data, plot_options, config).then(() => {
                    plotReady = true;
                    applyPlotTheme();
                });

                // Lasso/box selection to filter visible series
                if (!plotElement.dataset.selectionHandlerBound) {
                    plotElement.on('plotly_selected', function(eventData) {
                        if (!eventData || !eventData.points || eventData.points.length === 0) {
                            // Empty selection — restore all series to their checkbox state
                            const checkboxes = document.querySelectorAll('.var-item input');
                            checkboxes.forEach((cb, idx) => {
                                current_plot_data[idx].visible = cb.checked;
                            });
                            Plotly.restyle('plot', { visible: current_plot_data.map(d => d.visible) });
                            return;
                        }
                        // Find which series have points in the selection
                        const selectedTraces = new Set(eventData.points.map(p => p.curveNumber));
                        current_plot_data.forEach((trace, idx) => {
                            trace.visible = selectedTraces.has(idx);
                        });
                        Plotly.restyle('plot', { visible: current_plot_data.map(d => d.visible) });
                        // Sync sidebar checkboxes
                        document.querySelectorAll('.var-item input').forEach((cb, idx) => {
                            cb.checked = current_plot_data[idx].visible;
                        });
                    });
                    plotElement.dataset.selectionHandlerBound = 'true';
                }

                break;
            case 'network':
                // parse GraphML & render with cytoscape.js
                useContactMapViewerPalette = Boolean(message.useContactMapViewerPalette);

                // --- assumptions about structure of GraphML ---
                //
                // features of nodes:
                // - each node has XML-attribute "id"
                // - each node contains a <data> element, which contains the following elements:
                // -- <y:Fill> w/ XML-attribute "color"
                // -- <y:BorderStyle> w/ XML-attributes "width", "color"
                // -- <y:Shape> (not currently used)
                // -- <y:NodeLabel> w/ text content & XML-attributes "textColor", "fontStyle"
                // -- <y:Geometry> w/ XML-attributes "x", "y"
                // - when retrieving features of group nodes, note that they contain multiple
                //   instances of these elements (corresponding to each of the nested nodes
                //   in the group); assume that the elements describing the group node occur first
                //
                // hierarchy of nodes:
                // - group nodes are denoted by XML-attribute yfiles.foldertype="group"
                // - group nodes can contain regular nodes & graphs
                // - graphs can contain group nodes & regular nodes
                // - graphs are used in conjunction with group nodes;
                //   a graph is either at the top level or is the child of a group node
                //
                // features of edges:
                // - each edge has XML-attributes "id", "source", "target"
                // - each edge contains a <data> element, which contains the following elements:
                // -- <y:LineStyle> w/ XML-attributes "width", "color"
                // -- <y:Arrows> w/ XML-attribute "target"
                // -- <y:BendStyle> (not currently used)

                // get XML document corresponding to GraphML text
                const graphmlText = message.data;
                const xmlParser = new DOMParser();
                const xmlDoc = xmlParser.parseFromString(graphmlText, 'text/xml');
                
                // initialize collection of elements to be used for cytoscape rendering
                let cytoElements = {
                    nodes: [],
                    edges: []
                };

                // --- add nodes from the XML document to the cytoscape collection ---

                // function to add a node (w/ features) to the cytoscape collection
                // node: element (with tag "node") from XML document
                // parentId: id of parent of node, null if none (ie. node is at top level)
                function addNode (node, parentId) {
                    // --- get features of the node, check that they exist, use defaults if not found ---
                    // background color
                    let backgroundColor = node.getElementsByTagName("y:Fill").item(0);
                    backgroundColor = (backgroundColor) ? backgroundColor.getAttribute("color") : null;
                    backgroundColor = (backgroundColor) ? backgroundColor : "#999999";
                    // border
                    let border = node.getElementsByTagName("y:BorderStyle").item(0);
                    let borderWidth = (border) ? border.getAttribute("width") : null;
                    let borderColor = (border) ? border.getAttribute("color") : null;
                    borderWidth = (borderWidth) ? borderWidth : "1";
                    borderColor = (borderColor) ? borderColor : "#000000";
                    // label
                    let label = node.getElementsByTagName("y:NodeLabel").item(0);
                    let labelText = (label) ? label.textContent : "";
                    let labelColor = (label) ? label.getAttribute("textColor") : null;
                    let labelWeight = (label) ? label.getAttribute("fontStyle") : null;
                    labelColor = (labelColor) ? labelColor : "#000000";
                    labelWeight = (labelWeight && (labelWeight == "bold")) ? "bold" : "normal";
                    // layout
                    let layout = node.getElementsByTagName("y:Geometry").item(0);
                    // - specifiedPosition object stores node position specified by graphml (undefined if not specified)
                    let specifiedPosition = undefined;
                    if (layout) {
                        specifiedPosition = {
                            x: parseFloat(layout.getAttribute("x")),
                            y: parseFloat(layout.getAttribute("y"))
                        };
                    }
                    // - graph will be rendered with preset positions upon initialization
                    // - if node position is specified by graphml, use that, otherwise default to (0,0)
                    // - note: after initialization, a layout will be applied to nodes which do not have specified positions
                    // - position object stores current model position of node;
                    //   this is used for rendering and is updated by cytoscape to reflect current layout
                    let position = {
                        x: (specifiedPosition) ? specifiedPosition["x"] : 0,
                        y: (specifiedPosition) ? specifiedPosition["y"] : 0
                    };

                    // add the node to the collection
                    cytoElements["nodes"].push(
                        {data: {id: node.id,
                                parent: parentId,
                                backgroundColor: backgroundColor,
                                displayBackgroundColor: backgroundColor,
                                borderWidth: borderWidth,
                                borderColor: borderColor,
                                displayBorderColor: borderColor,
                                labelText: labelText,
                                labelColor: labelColor,
                                displayLabelColor: labelColor,
                                labelWeight: labelWeight,
                                specifiedPosition: specifiedPosition},
                        position: position}
                    );
                }

                // TEMPORARY, for testing purposes:
                //
                // choose grouped or flat node hierarchy
                let mode = "grouped";
                // let mode = "flat";
                //
                // for grouped mode, choose method of obtaining hierarchy information
                let method = "recursive";
                // let method = "property";

                if (mode == "grouped" && method == "recursive") {
                    let parentStack = []; // empty at top level
                    let graphmlRoot = xmlDoc.getElementsByTagName("graphml").item(0);

                    // recursive function to add child nodes of root to the
                    // cytoscape collection, preserving grouping/hierarchy
                    // root: element from XML document
                    function addChildNodes (root) {
                        let children = root.children;
                        for (const element of children) {
                            if (element.tagName == "graph") {
                                addChildNodes(element);
                            }
                            else if (element.tagName == "node") {
                                let parentId = null;
                                // if parentStack is not empty, use the last parentId added
                                if (parentStack.length != 0) {
                                    parentId = parentStack[parentStack.length - 1];
                                }

                                // if element is a group node,
                                // add it to the cytoscape collection and also add its children
                                if (element.getAttribute("yfiles.foldertype") == "group") {
                                    addNode(element, parentId);

                                    parentStack.push(element.id); // this group node is now the last on stack
                                    addChildNodes(element);
                                    parentStack.pop(); // after adding all nodes in the group, remove it from stack
                                }

                                // if element is a regular node,
                                // simply add it to the cytoscape collection
                                else {
                                    addNode(element, parentId);
                                }
                            }
                        }
                    }

                    addChildNodes(graphmlRoot);
                }

                if (mode == "grouped" && method == "property") {
                    let graphmlNodes = xmlDoc.getElementsByTagName("node");
                    for (const node of graphmlNodes) {
                        let parent = node.parentElement.parentElement; // node is inside graph is inside group node
                        let parentId = parent.id;
                        // check if node is at top level
                        if (parent.tagName == "graphml") {
                            parentId = null;
                        }
                        addNode(node, parentId);
                    }
                }

                if (mode == "flat") {
                    let graphmlNodes = xmlDoc.getElementsByTagName("node");
                    for (const node of graphmlNodes) {
                        addNode(node, null);
                    }
                }

                // --- add edges from the XML document to the cytoscape collection ---

                // function to add an edge (w/ features) to the cytoscape collection
                // edge: element (with tag "edge") from XML document
                function addEdge (edge) {
                    // --- get features of the edge, check that they exist, use defaults if not found ---
                    let source = edge.getAttribute("source");
                    let target = edge.getAttribute("target");
                    // line
                    let line = edge.getElementsByTagName("y:LineStyle").item(0);
                    let lineWidth = (line) ? line.getAttribute("width") : null;
                    let lineColor = (line) ? line.getAttribute("color") : null;
                    lineWidth = (lineWidth) ? lineWidth : "1";
                    lineColor = (lineColor) ? lineColor : "#000000";
                    // arrow
                    // - this will recognize only the "standard" arrow type as indicating a directed edge,
                    //   and set "none" (indicating an undirected edge) otherwise; adjust this if needed
                    let arrow = edge.getElementsByTagName("y:Arrows").item(0);
                    arrow = (arrow) ? arrow.getAttribute("target") : null;
                    arrow = (arrow && (arrow == "standard")) ? "triangle" : "none";
                    
                    // add the edge to the collection
                    cytoElements["edges"].push(
                        {data: {id: edge.id,
                                source: source,
                                target: target,
                                lineWidth: lineWidth,
                                lineColor: lineColor,
                                displayLineColor: lineColor,
                                arrow: arrow}}
                    );
                }

                let graphmlEdges = xmlDoc.getElementsByTagName("edge");
                for (const edge of graphmlEdges) {
                    addEdge(edge);
                }

                // --- set up graph ---

                // stylesheet
                const style = [
                    {
                        selector: 'node',
                        style: {
                            'background-color': 'data(displayBackgroundColor)',
                            'border-width': 'data(borderWidth)',
                            'border-color': 'data(displayBorderColor)',
                            'label': 'data(labelText)',
                            'color': 'data(displayLabelColor)',
                            'font-weight': 'data(labelWeight)',
                            'text-valign': 'top',
                            'text-halign': 'center',
                            'text-wrap': 'wrap',
                            'text-max-width': '160px',
                            'min-zoomed-font-size': '12'
                        }
                    },
                    {
                        selector: ':parent',
                        style: {
                            'padding': '20px'
                        }
                    },
                    {
                        selector: 'edge',
                        style: {
                            'width': 'data(lineWidth)',
                            'line-color': 'data(displayLineColor)',
                            'target-arrow-color': 'data(displayLineColor)',
                            'target-arrow-shape': 'data(arrow)',
                            'curve-style': 'bezier'
                        }
                    }
                ];

                const hasSpecifiedPositions = cytoElements["nodes"].some((node) => {
                    return typeof node.data.specifiedPosition !== 'undefined';
                });
                const defaultLayoutName = hasSpecifiedPositions ? 'preset' : 'breadthfirst';
                const layoutSelect = document.getElementById('layout_select');
                const applyLayoutButton = document.getElementById('apply_layout_button');
                const fitButton = document.getElementById('fit_button');
                const exportPngButton = document.getElementById('png_button');
                const exportGraphmlButton = document.getElementById('graphml_button');

                const layoutFactories = {
                    preset: function () {
                        return {
                            name: 'preset',
                            fit: true,
                            padding: graphFitPadding
                        };
                    },
                    breadthfirst: function () {
                        return {
                            name: 'breadthfirst',
                            fit: true,
                            padding: graphFitPadding,
                            directed: true,
                            animate: false,
                            spacingFactor: 1.1
                        };
                    },
                    grid: function () {
                        return {
                            name: 'grid',
                            fit: true,
                            padding: graphFitPadding,
                            avoidOverlap: true,
                            animate: false
                        };
                    },
                    circle: function () {
                        return {
                            name: 'circle',
                            fit: true,
                            padding: graphFitPadding,
                            avoidOverlap: true,
                            animate: false
                        };
                    },
                    concentric: function () {
                        return {
                            name: 'concentric',
                            fit: true,
                            padding: graphFitPadding,
                            avoidOverlap: true,
                            animate: false,
                            minNodeSpacing: 30
                        };
                    },
                    cose: function () {
                        return {
                            name: 'cose',
                            fit: true,
                            padding: graphFitPadding,
                            animate: false,
                            nodeOverlap: 20,
                            idealEdgeLength: 120,
                            nestingFactor: 1.1
                        };
                    }
                };

                if (currentCy) {
                    currentCy.destroy();
                    currentCy = null;
                }

                // initialize graph
                const cy = cytoscape({
                    container: network,
                    elements: cytoElements,
                    style: style,
                    layout: layoutFactories[defaultLayoutName]()
                });
                currentCy = cy;
                applyGraphTheme();

                if (!hasSpecifiedPositions && layoutSelect) {
                    const presetOption = layoutSelect.querySelector('option[value="preset"]');
                    if (presetOption) {
                        presetOption.disabled = true;
                        presetOption.hidden = true;
                    }
                }

                if (layoutSelect) {
                    layoutSelect.value = defaultLayoutName;
                }

                function fitGraph() {
                    cy.animate({
                        fit: {
                            eles: cy.elements(),
                            padding: graphFitPadding
                        },
                        duration: 250
                    });
                }

                function applyLayout(layoutName) {
                    if (layoutName === 'preset') {
                        cy.nodes().forEach(function(node) {
                            const specifiedPosition = node.data('specifiedPosition');
                            if (specifiedPosition) {
                                node.position({
                                    x: specifiedPosition.x,
                                    y: specifiedPosition.y
                                });
                            }
                        });
                        fitGraph();
                        return;
                    }

                    const createLayout = layoutFactories[layoutName] || layoutFactories.breadthfirst;
                    cy.layout(createLayout()).run();
                }

                function exportGraphPng() {
                    const graphBackground = window.getComputedStyle(network).backgroundColor || '#ffffff';
                    const uri = cy.png({
                        output: 'base64uri',
                        bg: graphBackground,
                        full: true,
                        scale: graphPngExportScale
                    });

                    vscode.postMessage({
                        command: 'image',
                        type: 'png',
                        title: page_title,
                        folder: page_folder,
                        text: uri
                    });
                }

                function exportGraphml() {
                    vscode.postMessage({
                        command: 'graphml-copy',
                        title: page_title + '_copy',
                        folder: page_folder,
                        text: graphmlText
                    });
                }

                if (applyLayoutButton) {
                    applyLayoutButton.onclick = function () {
                        applyLayout(layoutSelect ? layoutSelect.value : defaultLayoutName);
                    };
                }

                if (fitButton) {
                    fitButton.onclick = fitGraph;
                }

                if (exportPngButton) {
                    exportPngButton.onclick = exportGraphPng;
                }

                if (exportGraphmlButton) {
                    exportGraphmlButton.onclick = exportGraphml;
                }

                break;
        }
    });
    
    vscode.postMessage({
        command: 'ready',
    });
}());
