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
    const contactMapViewerPalettes = {
        [VIEW_MODE_LIGHT]: {
            background: '#faf8f2',
            moleculeFill: '#eee8d8',
            moleculeBorder: '#262b33',
            moleculeLabel: '#14181e',
            siteFill: '#d6e2ea',
            siteBorder: '#3d5669',
            siteLabel: '#14232d',
            stateFill: '#e8ddee',
            stateBorder: '#5b4370',
            stateLabel: '#281c37',
            edge: '#373b42',
            edgeHighlight: '#144c8e',
            arrow: '#191b20',
            activatedAccent: '#c4372d',
            modifiedAccent: '#daa62f',
            boundAccent: '#307659',
            inhibitedAccent: '#55585e',
            uncertainAccent: '#cd6f36',
            secondaryText: '#555a62',
            divider: '#9197a0'
        },
        [VIEW_MODE_DARK]: {
            background: '#12161e',
            moleculeFill: '#3b372f',
            moleculeBorder: '#c4baa0',
            moleculeLabel: '#efe9da',
            siteFill: '#253642',
            siteBorder: '#84a8be',
            siteLabel: '#dcebf2',
            stateFill: '#372d42',
            stateBorder: '#b194cb',
            stateLabel: '#ede2f6',
            edge: '#acb2bc',
            edgeHighlight: '#5a96da',
            arrow: '#dce0e6',
            activatedAccent: '#e85c4e',
            modifiedAccent: '#ecbe52',
            boundAccent: '#5bab84',
            inhibitedAccent: '#868b94',
            uncertainAccent: '#e58b4e',
            secondaryText: '#b0b7c2',
            divider: '#697380'
        }
    };

    let current_plot_data = [];
    let plotReady = false;
    let currentCy = null;
    let graphKind = 'other';
    let graphHasComponents = false;
    let graphHasInternalStates = false;
    let useContactMapViewerPalette = false;
    let showComponents = true;
    let showInternalStates = true;
    let currentGraphLayoutName = 'preset';
    let graphLayoutLocked = false;
    let hostViewMode = inferHostViewMode();
    let currentViewMode = resolveInitialViewMode();

    function isStandaloneContactMapViewer() {
        return graphKind === 'contactmap' && useContactMapViewerPalette;
    }

    function getContactMapViewerPalette() {
        return currentViewMode === VIEW_MODE_DARK
            ? contactMapViewerPalettes[VIEW_MODE_DARK]
            : contactMapViewerPalettes[VIEW_MODE_LIGHT];
    }

    function getGraphFitPadding() {
        return isStandaloneContactMapViewer() ? 28 : graphFitPadding;
    }

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

    function clampNumber(value, min, max) {
        return Math.max(min, Math.min(max, value));
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

    function getContrastRatio(colorA, colorB) {
        const parsedA = parseColor(colorA);
        const parsedB = parseColor(colorB);
        if (!parsedA || !parsedB) {
            return null;
        }

        const luminanceA = getRelativeLuminance(parsedA);
        const luminanceB = getRelativeLuminance(parsedB);
        const lighter = Math.max(luminanceA, luminanceB);
        const darker = Math.min(luminanceA, luminanceB);
        return (lighter + 0.05) / (darker + 0.05);
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

    function getHighestContrastColor(backgroundColor, candidates) {
        let bestColor = candidates[0];
        let bestContrast = -1;

        candidates.forEach((candidate) => {
            const contrast = getContrastRatio(candidate, backgroundColor);
            if (contrast !== null && contrast > bestContrast) {
                bestContrast = contrast;
                bestColor = candidate;
            }
        });

        return bestColor;
    }

    function ensureTextContrast(color, backgroundColor, minimumContrast) {
        const contrast = getContrastRatio(color, backgroundColor);
        if (contrast === null || contrast >= minimumContrast) {
            return color;
        }

        const palette = getContactMapViewerPalette();
        return getHighestContrastColor(backgroundColor, [
            palette.moleculeLabel,
            palette.siteLabel,
            palette.stateLabel,
            currentViewMode === VIEW_MODE_DARK ? '#f4f7fb' : '#101418'
        ]);
    }

    function inferHostViewMode() {
        const hostBackground = cssVar('--vscode-editor-background', window.getComputedStyle(document.body).backgroundColor);
        return isColorDark(hostBackground) ? VIEW_MODE_DARK : VIEW_MODE_LIGHT;
    }

    function getPersistedState() {
        return vscode.getState() || {};
    }

    function resolveInitialViewMode() {
        const state = getPersistedState();
        if (state.viewMode === VIEW_MODE_LIGHT || state.viewMode === VIEW_MODE_DARK) {
            return state.viewMode;
        }

        return inferHostViewMode();
    }

    function persistViewMode(mode) {
        const state = getPersistedState();
        vscode.setState({
            ...state,
            viewMode: mode
        });
    }

    function resolveInitialGraphViewState() {
        const state = getPersistedState();
        const graphView = state.graphView || {};

        return {
            layoutName: typeof graphView.layoutName === 'string' ? graphView.layoutName : undefined,
            layoutLocked: typeof graphView.layoutLocked === 'boolean' ? graphView.layoutLocked : false,
            showComponents: typeof graphView.showComponents === 'boolean' ? graphView.showComponents : true,
            showInternalStates: typeof graphView.showInternalStates === 'boolean' ? graphView.showInternalStates : true
        };
    }

    function persistGraphViewState() {
        const state = getPersistedState();
        vscode.setState({
            ...state,
            graphView: {
                layoutName: currentGraphLayoutName,
                layoutLocked: graphLayoutLocked,
                showComponents: showComponents,
                showInternalStates: showInternalStates
            }
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

        if (isStandaloneContactMapViewer()) {
            return color;
        }

        if (role === 'label') {
            return liftColorForDarkMode(color, 0.62);
        }

        return liftColorForDarkMode(color, 0.48);
    }

    function getContactMapNodeKind(sourceColor) {
        switch (normalizeColorKey(sourceColor)) {
            case '#d2d2d2':
                return 'molecule';
            case '#ffffff':
                return 'site';
            case '#ffcc00':
                return 'state';
            default:
                return 'other';
        }
    }

    function getContactMapBaseFillColor(nodeKind, sourceColor) {
        const palette = getContactMapViewerPalette();
        switch (nodeKind) {
            case 'molecule':
                return palette.moleculeFill;
            case 'site':
                return palette.siteFill;
            case 'state':
                return palette.stateFill;
            default:
                return sourceColor;
        }
    }

    function getContactMapBaseBorderColor(nodeKind, sourceColor) {
        const palette = getContactMapViewerPalette();
        switch (nodeKind) {
            case 'molecule':
                return palette.moleculeBorder;
            case 'site':
                return palette.siteBorder;
            case 'state':
                return palette.stateBorder;
            default:
                return sourceColor;
        }
    }

    function getContactMapBaseLabelColor(nodeKind, sourceColor) {
        const palette = getContactMapViewerPalette();
        switch (nodeKind) {
            case 'molecule':
                return palette.moleculeLabel;
            case 'site':
                return palette.siteLabel;
            case 'state':
                return palette.stateLabel;
            default:
                return sourceColor;
        }
    }

    function getCytoscapeShape(graphmlShape, kind) {
        switch ((graphmlShape || '').toLowerCase()) {
            case 'rectangle':
                return 'rectangle';
            case 'roundrectangle':
                return 'round-rectangle';
            case 'ellipse':
                return 'ellipse';
            case 'diamond':
                return 'diamond';
            case 'hexagon':
                return 'hexagon';
            case 'octagon':
                return 'octagon';
            case 'parallelogram':
                return 'parallelogram';
            case 'triangle':
                return 'triangle';
            case 'trapezoid':
                return 'trapezoid';
            default:
                return graphKind === 'contactmap' && kind !== 'other' ? 'round-rectangle' : 'ellipse';
        }
    }

    function getContactMapBorderWidth(nodeKind, sourceBorderWidth) {
        const parsedWidth = parseFloat(sourceBorderWidth);
        const baseWidth = Number.isFinite(parsedWidth) && parsedWidth > 0 ? parsedWidth : 1;

        switch (nodeKind) {
            case 'molecule':
                return Math.max(baseWidth, 3.2);
            case 'site':
                return Math.max(baseWidth, 1.8);
            case 'state':
                return Math.max(baseWidth, 1.5);
            default:
                return baseWidth;
        }
    }

    function getContactMapLabelFontSize(nodeKind, sourceFontSize, displayWidth, displayHeight, labelText, hasDirectChildren) {
        const textLength = Math.max((labelText || '').trim().length, 1);
        const widthBudget = Math.max(
            nodeKind === 'molecule' ? 68 : (nodeKind === 'site' ? 42 : 34),
            displayWidth - (nodeKind === 'molecule' ? 18 : 12)
        );
        const widthFactor = nodeKind === 'molecule' ? 0.58 : (nodeKind === 'state' ? 0.72 : 0.66);
        const widthDrivenSize = widthBudget / Math.max(textLength * widthFactor, 2.2);
        const heightFactor = nodeKind === 'molecule'
            ? (hasDirectChildren ? 0.32 : 0.42)
            : (nodeKind === 'state' ? 0.54 : 0.44);
        const heightDrivenSize = displayHeight * heightFactor;
        const adaptiveSize = Math.min(widthDrivenSize, heightDrivenSize);
        const minimumSize = nodeKind === 'molecule'
            ? 18
            : (nodeKind === 'state' ? 12 : 14);
        const maximumSize = nodeKind === 'molecule'
            ? (hasDirectChildren ? 26 : 28)
            : (nodeKind === 'state' ? 16 : 20);

        return Math.max(
            sourceFontSize,
            clampNumber(adaptiveSize, minimumSize, maximumSize)
        );
    }

    function getContactMapDefaultNodeDimensions(nodeKind, hasDirectChildren) {
        if (graphKind === 'regulatory') {
            return { width: 150, height: 48 };
        }

        if (!isStandaloneContactMapViewer()) {
            return { width: 80, height: 32 };
        }

        switch (nodeKind) {
            case 'molecule':
                return hasDirectChildren
                    ? { width: 140, height: 74 }
                    : { width: 104, height: 44 };
            case 'site':
                return hasDirectChildren
                    ? { width: 78, height: 34 }
                    : { width: 68, height: 30 };
            case 'state':
                return { width: 56, height: 28 };
            default:
                return { width: 90, height: 40 };
        }
    }

    function getContactMapMinimumNodeWidth(nodeKind, labelText, hasDirectChildren) {
        const textLength = Math.max((labelText || '').trim().length, 1);

        switch (nodeKind) {
            case 'molecule':
                return clampNumber(
                    (textLength * 10) + (hasDirectChildren ? 36 : 26),
                    hasDirectChildren ? 118 : 98,
                    hasDirectChildren ? 210 : 190
                );
            case 'site':
                return clampNumber(
                    (textLength * 7) + (hasDirectChildren ? 22 : 18),
                    hasDirectChildren ? 68 : 62,
                    150
                );
            case 'state':
                return clampNumber((textLength * 8) + 18, 56, 120);
            default:
                return clampNumber((textLength * 9) + 24, 92, 180);
        }
    }

    function getContactMapLabelMaxWidth(nodeKind, displayWidth, hasDirectChildren) {
        switch (nodeKind) {
            case 'molecule':
                return Math.max(72, displayWidth - 22);
            case 'site':
                return Math.max(44, displayWidth - 16);
            case 'state':
                return Math.max(32, displayWidth - 10);
            default:
                return Math.max(48, displayWidth - 16);
        }
    }

    function getContactMapLabelValign(nodeKind) {
        return nodeKind === 'state' ? 'center' : 'top';
    }

    function getContactMapLabelHalign(nodeKind) {
        return nodeKind === 'molecule' ? 'left' : 'center';
    }

    function getContactMapLabelJustification(nodeKind) {
        return nodeKind === 'molecule' ? 'left' : 'center';
    }

    function getContactMapLabelMarginX(nodeKind, displayWidth) {
        if (nodeKind !== 'molecule') {
            return 0;
        }

        return Math.round(clampNumber(displayWidth * 0.08, 8, 14));
    }

    function getContactMapLabelMarginY(nodeKind, displayHeight) {
        switch (nodeKind) {
            case 'molecule':
                return Math.round(clampNumber(displayHeight * 0.12, 8, 13));
            case 'site':
                return Math.round(clampNumber(displayHeight * 0.1, 4, 8));
            default:
                return 0;
        }
    }

    function getContactMapLabelBackgroundOpacity(nodeKind) {
        return nodeKind === 'molecule' || nodeKind === 'site' ? 0.95 : 0;
    }

    function getContactMapLabelBackgroundPadding(nodeKind) {
        switch (nodeKind) {
            case 'molecule':
                return 3;
            case 'site':
                return 2;
            default:
                return 0;
        }
    }

    function getContactMapMinZoomedFontSize(nodeKind) {
        switch (nodeKind) {
            case 'molecule':
                return 12;
            case 'site':
                return 11;
            case 'state':
                return 10;
            default:
                return 10;
        }
    }

    function getContactMapCompoundPadding(nodeKind, hasDirectChildren) {
        if (!hasDirectChildren) {
            return 18;
        }

        switch (nodeKind) {
            case 'molecule':
                return 28;
            case 'site':
                return 14;
            default:
                return 18;
        }
    }

    function getDirectChildNodeElements(node) {
        const directChildNodes = [];

        Array.from(node.children || []).forEach((child) => {
            if (child.tagName !== 'graph') {
                return;
            }

            Array.from(child.children || []).forEach((graphChild) => {
                if (graphChild.tagName === 'node') {
                    directChildNodes.push(graphChild);
                }
            });
        });

        return directChildNodes;
    }

    function updateComponentsButton() {
        const toggleComponentsButton = document.getElementById('toggle_components_button');
        if (!toggleComponentsButton) {
            return;
        }

        const isAvailable = graphKind === 'contactmap' && graphHasComponents;
        toggleComponentsButton.hidden = !isAvailable;
        toggleComponentsButton.disabled = !isAvailable;

        if (!isAvailable) {
            return;
        }

        const label = showComponents ? 'Hide Components' : 'Show Components';
        toggleComponentsButton.textContent = label;
        toggleComponentsButton.setAttribute('aria-label', label);
    }

    function updateInternalStatesButton() {
        const toggleInternalStatesButton = document.getElementById('toggle_internal_states_button');
        if (!toggleInternalStatesButton) {
            return;
        }

        const isAvailable = graphKind === 'contactmap' && graphHasInternalStates && showComponents;
        toggleInternalStatesButton.hidden = !isAvailable;
        toggleInternalStatesButton.disabled = !isAvailable;

        if (!isAvailable) {
            return;
        }

        const label = showInternalStates ? 'Hide Internal States' : 'Show Internal States';
        toggleInternalStatesButton.textContent = label;
        toggleInternalStatesButton.setAttribute('aria-label', label);
    }

    function updateLayoutLockButton(layoutSelect) {
        const layoutLockButton = document.getElementById('layout_lock_button');
        if (!layoutLockButton) {
            return;
        }

        const label = graphLayoutLocked ? 'Unlock Layout' : 'Lock Layout';
        layoutLockButton.textContent = label;
        layoutLockButton.setAttribute('aria-label', label);

        if (layoutSelect) {
            layoutSelect.disabled = graphLayoutLocked;
            layoutSelect.title = graphLayoutLocked
                ? 'Unlock layout to change the layout style.'
                : '';
        }
    }

    function normalizeLayoutSelection(layoutName, hasSpecifiedPositions, defaultLayoutName, layoutFactories) {
        if (!layoutName || !Object.prototype.hasOwnProperty.call(layoutFactories, layoutName)) {
            return defaultLayoutName;
        }

        if (layoutName === 'preset' && !hasSpecifiedPositions) {
            return defaultLayoutName;
        }

        return layoutName;
    }

    function getNodeBaseBackgroundColor(node) {
        const sourceColor = node.data('backgroundColor');
        return useContactMapViewerPalette
            ? getContactMapBaseFillColor(node.data('nodeKind'), sourceColor)
            : sourceColor;
    }

    function getNodeBaseBorderColor(node) {
        const sourceColor = node.data('borderColor');
        if (!useContactMapViewerPalette) {
            return sourceColor;
        }

        return getContactMapBaseBorderColor(node.data('nodeKind'), sourceColor);
    }

    function getNodeBaseLabelColor(node) {
        const sourceColor = node.data('labelColor');
        if (!useContactMapViewerPalette) {
            return sourceColor;
        }

        return getContactMapBaseLabelColor(node.data('nodeKind'), sourceColor);
    }

    function getEdgeBaseLineColor(edge) {
        const sourceColor = edge.data('lineColor');
        if (!useContactMapViewerPalette) {
            return sourceColor;
        }

        return getContactMapViewerPalette().edge;
    }

    function getEdgeBaseArrowColor(edge) {
        const sourceColor = edge.data('arrowColor');
        if (!useContactMapViewerPalette) {
            return sourceColor || edge.data('lineColor');
        }

        return getContactMapViewerPalette().arrow;
    }

    function getNodeDisplayLabelColor(node) {
        const backgroundColor = getNodeBaseBackgroundColor(node);
        let labelColor = getNodeBaseLabelColor(node);

        if (!isStandaloneContactMapViewer() && currentViewMode === VIEW_MODE_DARK && isColorDark(backgroundColor)) {
            labelColor = liftColorForDarkMode(labelColor, 0.62);
        }

        return ensureTextContrast(labelColor, backgroundColor, 4.5);
    }

    function getNodeDisplayLabelBackgroundColor(node) {
        if (!isStandaloneContactMapViewer()) {
            return 'transparent';
        }

        const nodeKind = node.data('nodeKind');
        if (nodeKind !== 'molecule' && nodeKind !== 'site') {
            return 'transparent';
        }

        return getNodeBaseBackgroundColor(node);
    }

    function applyStandaloneContactMapCanvasTheme() {
        const networkWrapper = document.getElementById('network_wrapper');

        if (!network || !networkWrapper) {
            return;
        }

        if (isStandaloneContactMapViewer()) {
            const palette = getContactMapViewerPalette();
            network.style.background = palette.background;
            network.style.backgroundColor = palette.background;
            networkWrapper.style.background = palette.background;
            return;
        }

        network.style.background = '';
        network.style.backgroundColor = '';
        networkWrapper.style.background = '';
    }

    function applyGraphTheme() {
        if (!currentCy) {
            applyStandaloneContactMapCanvasTheme();
            return;
        }

        currentCy.batch(() => {
            currentCy.nodes().forEach((node) => {
                node.data('displayBackgroundColor', getNodeBaseBackgroundColor(node));
                node.data('displayBorderColor', adaptGraphColor(getNodeBaseBorderColor(node), 'border'));
                node.data('displayLabelColor', getNodeDisplayLabelColor(node));
                node.data('displayLabelBackgroundColor', getNodeDisplayLabelBackgroundColor(node));
            });

            currentCy.edges().forEach((edge) => {
                edge.data('displayLineColor', adaptGraphColor(getEdgeBaseLineColor(edge), 'edge'));
                edge.data('displayArrowColor', adaptGraphColor(getEdgeBaseArrowColor(edge), 'edge'));
            });
        });

        currentCy.style().update();
        applyStandaloneContactMapCanvasTheme();
    }

    function applyContactMapStructureVisibility() {
        if (!currentCy) {
            return;
        }

        currentCy.batch(() => {
            currentCy.nodes().forEach((node) => {
                const nodeKind = node.data('nodeKind');
                const shouldHideComponents = graphKind === 'contactmap'
                    && graphHasComponents
                    && !showComponents
                    && (nodeKind === 'site' || nodeKind === 'state');
                const shouldHideStates = graphKind === 'contactmap'
                    && graphHasInternalStates
                    && showComponents
                    && !showInternalStates
                    && nodeKind === 'state';
                node.toggleClass('contact-map-structure-hidden', shouldHideComponents || shouldHideStates);
            });
        });

        syncContactMapPromotedEdges(currentCy);
        currentCy.style().update();
    }

    function compareNodeOrder(left, right) {
        const leftOrder = Number(left.data('nodeOrder')) || 0;
        const rightOrder = Number(right.data('nodeOrder')) || 0;

        if (leftOrder !== rightOrder) {
            return leftOrder - rightOrder;
        }

        return left.id().localeCompare(right.id());
    }

    function getStandaloneContactMapLayoutScratch(cy) {
        if (!cy) {
            return { prepared: false };
        }

        let scratch = cy.scratch('_standaloneContactMapLayout');
        if (!scratch) {
            scratch = { prepared: false };
            cy.scratch('_standaloneContactMapLayout', scratch);
        }

        return scratch;
    }

    function getTopLevelStandaloneContactMapMolecule(node) {
        if (!node || node.length === 0) {
            return null;
        }

        let currentNode = node;
        while (currentNode && currentNode.length !== 0) {
            if (currentNode.data('nodeKind') === 'molecule' && currentNode.parent().length === 0) {
                return currentNode;
            }

            currentNode = currentNode.parent();
        }

        return null;
    }

    function getTopLevelStandaloneContactMapMolecules(cy, options = {}) {
        const visibleOnly = options.visibleOnly !== false;
        const nodes = visibleOnly ? cy.nodes(':visible') : cy.nodes();

        return nodes.filter((node) => {
            return node.data('nodeKind') === 'molecule' && node.parent().length === 0;
        }).toArray();
    }

    function isContactMapNodeVisibleInCurrentStructure(node) {
        if (!node || node.length === 0 || graphKind !== 'contactmap') {
            return true;
        }

        const nodeKind = node.data('nodeKind');
        if (!showComponents && (nodeKind === 'site' || nodeKind === 'state')) {
            return false;
        }

        if (showComponents && !showInternalStates && nodeKind === 'state') {
            return false;
        }

        return true;
    }

    function getContactMapVisibleAnchor(node) {
        let currentNode = node;

        while (currentNode && currentNode.length !== 0) {
            if (isContactMapNodeVisibleInCurrentStructure(currentNode)) {
                return currentNode;
            }

            currentNode = currentNode.parent();
        }

        return null;
    }

    function getContactMapPromotedEdgeKey(sourceAnchor, targetAnchor, arrow) {
        const sourceId = sourceAnchor.id();
        const targetId = targetAnchor.id();

        if (arrow && arrow !== 'none') {
            return `directed::${sourceId}->${targetId}::${arrow}`;
        }

        return `undirected::${[sourceId, targetId].sort().join('::')}`;
    }

    function syncContactMapPromotedEdges(cy) {
        if (!cy) {
            return;
        }

        cy.batch(() => {
            const existingPromotedEdges = cy.edges().filter((edge) => Boolean(edge.data('isPromotedEdge')));
            if (existingPromotedEdges.length !== 0) {
                cy.remove(existingPromotedEdges);
            }

            const promotedEdges = [];
            const promotedEdgeDataByKey = new Map();

            cy.edges().filter((edge) => !edge.data('isPromotedEdge')).forEach((edge) => {
                const sourceNode = edge.source();
                const targetNode = edge.target();
                const sourceAnchor = getContactMapVisibleAnchor(sourceNode);
                const targetAnchor = getContactMapVisibleAnchor(targetNode);
                const shouldHideOriginal = !sourceAnchor
                    || !targetAnchor
                    || sourceAnchor.id() === targetAnchor.id();
                const shouldPromote = !shouldHideOriginal
                    && (sourceAnchor.id() !== sourceNode.id() || targetAnchor.id() !== targetNode.id());

                edge.toggleClass('contact-map-structure-hidden', shouldHideOriginal || shouldPromote);

                if (!shouldPromote) {
                    return;
                }

                const arrow = edge.data('arrow') || 'none';
                const promotedKey = getContactMapPromotedEdgeKey(sourceAnchor, targetAnchor, arrow);
                const parsedLineWidth = Number.parseFloat(edge.data('lineWidth'));

                if (promotedEdgeDataByKey.has(promotedKey)) {
                    const promotedEdge = promotedEdgeDataByKey.get(promotedKey);
                    if (Number.isFinite(parsedLineWidth)) {
                        promotedEdge.lineWidth = Math.max(Number.parseFloat(promotedEdge.lineWidth) || 1, parsedLineWidth).toString();
                    }
                    return;
                }

                const promotedEdge = {
                    id: `contact-map-promoted-edge-${promotedEdgeDataByKey.size}`,
                    source: sourceAnchor.id(),
                    target: targetAnchor.id(),
                    lineWidth: Number.isFinite(parsedLineWidth) ? parsedLineWidth.toString() : (edge.data('lineWidth') || '1'),
                    lineColor: edge.data('lineColor'),
                    displayLineColor: edge.data('displayLineColor') || edge.data('lineColor'),
                    arrowColor: edge.data('arrowColor') || edge.data('lineColor'),
                    displayArrowColor: edge.data('displayArrowColor') || edge.data('arrowColor') || edge.data('lineColor'),
                    arrow: arrow,
                    connectsState: false,
                    connectsComponent: false,
                    isPromotedEdge: true
                };

                promotedEdgeDataByKey.set(promotedKey, promotedEdge);
                promotedEdges.push({ data: promotedEdge });
            });

            if (promotedEdges.length !== 0) {
                cy.add(promotedEdges);
            }
        });
    }

    function getNodeLayoutSize(node) {
        const bounds = node.boundingBox({
            includeLabels: true,
            includeOverlays: false
        });
        const baseWidth = node.isParent()
            ? (Number(node.data('minCompoundWidth')) || Number(node.data('width')) || 0)
            : (Number(node.data('width')) || 0);
        const baseHeight = node.isParent()
            ? (Number(node.data('minCompoundHeight')) || Number(node.data('height')) || 0)
            : (Number(node.data('height')) || 0);

        return {
            width: Math.max(bounds.w, baseWidth),
            height: Math.max(bounds.h, baseHeight)
        };
    }

    function getStandaloneContactMapMoleculeLayoutSize(node) {
        const storedWidth = Number(node.data('layoutFootprintWidth')) || 0;
        const storedHeight = Number(node.data('layoutFootprintHeight')) || 0;

        if (storedWidth > 0 && storedHeight > 0) {
            return {
                width: storedWidth,
                height: storedHeight
            };
        }

        return getNodeLayoutSize(node);
    }

    function getContactMapPackingConfig(nodeKind, childCount) {
        switch (nodeKind) {
            case 'molecule':
                return {
                    gapX: 12,
                    gapY: 10,
                    targetAspect: childCount > 4 ? 1.2 : 1.4
                };
            case 'site':
                return {
                    gapX: 8,
                    gapY: 6,
                    targetAspect: childCount > 3 ? 1.25 : 1.6
                };
            default:
                return {
                    gapX: 14,
                    gapY: 10,
                    targetAspect: 1.4
                };
        }
    }

    function buildPackedPositions(items, config) {
        if (items.length === 0) {
            return [];
        }

        const maxItemWidth = items.reduce((maxWidth, item) => Math.max(maxWidth, item.width), 0);
        const estimatedArea = items.reduce((total, item) => {
            return total + ((item.width + config.gapX) * (item.height + config.gapY));
        }, 0);
        const targetRowWidth = Math.max(
            maxItemWidth,
            Math.sqrt(Math.max(estimatedArea, 1) * config.targetAspect)
        );
        const rows = [];
        let currentRow = [];
        let currentRowWidth = 0;
        let currentRowHeight = 0;

        items.forEach((item) => {
            const nextWidth = currentRow.length === 0
                ? item.width
                : currentRowWidth + config.gapX + item.width;

            if (currentRow.length > 0 && nextWidth > targetRowWidth) {
                rows.push({
                    items: currentRow,
                    width: currentRowWidth,
                    height: currentRowHeight
                });
                currentRow = [];
                currentRowWidth = 0;
                currentRowHeight = 0;
            }

            currentRow.push(item);
            currentRowWidth = currentRow.length === 1
                ? item.width
                : currentRowWidth + config.gapX + item.width;
            currentRowHeight = Math.max(currentRowHeight, item.height);
        });

        if (currentRow.length > 0) {
            rows.push({
                items: currentRow,
                width: currentRowWidth,
                height: currentRowHeight
            });
        }

        const totalHeight = rows.reduce((height, row, index) => {
            return height + row.height + (index > 0 ? config.gapY : 0);
        }, 0);
        let cursorY = -totalHeight / 2;
        const positions = [];

        rows.forEach((row) => {
            let cursorX = -row.width / 2;

            row.items.forEach((item) => {
                positions.push({
                    node: item.node,
                    x: cursorX + (item.width / 2),
                    y: cursorY + (row.height / 2)
                });
                cursorX += item.width + config.gapX;
            });

            cursorY += row.height + config.gapY;
        });

        return positions;
    }

    function packStandaloneContactMapChildren(parentNode) {
        if (!parentNode.isParent()) {
            return false;
        }

        const visibleChildren = parentNode.children(':visible').toArray().sort(compareNodeOrder);
        if (visibleChildren.length === 0) {
            return false;
        }

        const config = getContactMapPackingConfig(parentNode.data('nodeKind'), visibleChildren.length);
        const items = visibleChildren.map((childNode) => {
            const size = getNodeLayoutSize(childNode);
            return {
                node: childNode,
                width: size.width,
                height: size.height
            };
        });
        const positions = buildPackedPositions(items, config);
        let moved = false;

        positions.forEach((item) => {
            const currentPosition = item.node.position();
            if (Math.abs(currentPosition.x - item.x) > 0.5 || Math.abs(currentPosition.y - item.y) > 0.5) {
                item.node.position({
                    x: item.x,
                    y: item.y
                });
                moved = true;
            }
        });

        return moved;
    }

    function packStandaloneContactMapCompounds(cy) {
        if (!isStandaloneContactMapViewer()) {
            return false;
        }

        const topLevelMolecules = getTopLevelVisibleStandaloneContactMapMolecules(cy);
        const anchorPositions = new Map();
        topLevelMolecules.forEach((moleculeNode) => {
            anchorPositions.set(moleculeNode.id(), {
                x: moleculeNode.position('x'),
                y: moleculeNode.position('y')
            });
        });

        const compoundNodes = cy.nodes(':visible').filter((node) => node.isParent()).toArray().sort((left, right) => {
            const depthDifference = right.parents().length - left.parents().length;
            if (depthDifference !== 0) {
                return depthDifference;
            }

            return compareNodeOrder(left, right);
        });
        let moved = false;

        cy.batch(() => {
            compoundNodes.forEach((compoundNode) => {
                moved = packStandaloneContactMapChildren(compoundNode) || moved;
            });

            anchorPositions.forEach((anchorPosition, nodeId) => {
                const moleculeNode = cy.getElementById(nodeId);
                if (!moleculeNode || moleculeNode.length === 0 || !moleculeNode.visible()) {
                    return;
                }

                const currentPosition = moleculeNode.position();
                const deltaX = anchorPosition.x - currentPosition.x;
                const deltaY = anchorPosition.y - currentPosition.y;
                if (Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5) {
                    moleculeNode.shift({
                        x: deltaX,
                        y: deltaY
                    });
                    moved = true;
                }
            });
        });

        return moved;
    }

    function getTopLevelVisibleStandaloneContactMapMolecules(cy) {
        return getTopLevelStandaloneContactMapMolecules(cy, { visibleOnly: true });
    }

    function storeStandaloneContactMapCanonicalGeometry(cy) {
        if (!isStandaloneContactMapViewer()) {
            return;
        }

        cy.batch(() => {
            cy.nodes().forEach((node) => {
                const topLevelMolecule = getTopLevelStandaloneContactMapMolecule(node);
                if (!topLevelMolecule) {
                    return;
                }

                const moleculePosition = topLevelMolecule.position();
                const nodePosition = node.position();
                node.data('canonicalOffsetX', nodePosition.x - moleculePosition.x);
                node.data('canonicalOffsetY', nodePosition.y - moleculePosition.y);
            });
        });
    }

    function restoreStandaloneContactMapCanonicalGeometry(cy) {
        if (!isStandaloneContactMapViewer()) {
            return;
        }

        const molecules = getTopLevelStandaloneContactMapMolecules(cy, { visibleOnly: false });
        if (molecules.length === 0) {
            return;
        }

        cy.batch(() => {
            molecules.forEach((moleculeNode) => {
                const moleculePosition = moleculeNode.position();
                const descendants = moleculeNode.descendants().toArray().sort((left, right) => {
                    const depthDifference = left.parents().length - right.parents().length;
                    if (depthDifference !== 0) {
                        return depthDifference;
                    }

                    return compareNodeOrder(left, right);
                });

                descendants.forEach((node) => {
                    const offsetX = Number(node.data('canonicalOffsetX'));
                    const offsetY = Number(node.data('canonicalOffsetY'));
                    if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) {
                        return;
                    }

                    node.position({
                        x: moleculePosition.x + offsetX,
                        y: moleculePosition.y + offsetY
                    });
                });
            });
        });
    }

    function updateStandaloneContactMapLayoutFootprints(cy) {
        if (!isStandaloneContactMapViewer()) {
            return;
        }

        cy.batch(() => {
            getTopLevelStandaloneContactMapMolecules(cy, { visibleOnly: false }).forEach((moleculeNode) => {
                const size = getNodeLayoutSize(moleculeNode);
                const minWidth = Number(moleculeNode.data('minCompoundWidth')) || 0;
                const minHeight = Number(moleculeNode.data('minCompoundHeight')) || 0;
                const baseWidth = Number(moleculeNode.data('width')) || 0;
                const baseHeight = Number(moleculeNode.data('height')) || 0;

                moleculeNode.data('layoutFootprintWidth', Math.max(size.width, minWidth, baseWidth));
                moleculeNode.data('layoutFootprintHeight', Math.max(size.height, minHeight, baseHeight));
            });
        });
    }

    function ensureStandaloneContactMapPrepared(cy) {
        if (!isStandaloneContactMapViewer()) {
            return;
        }

        const scratch = getStandaloneContactMapLayoutScratch(cy);
        if (scratch.prepared) {
            return;
        }

        cy.resize();
        packStandaloneContactMapCompounds(cy);
        storeStandaloneContactMapCanonicalGeometry(cy);
        updateStandaloneContactMapLayoutFootprints(cy);
        scratch.prepared = true;
    }

    function getExpandedBoundingBox(node, padding, options = {}) {
        const useStoredFootprint = options.useStoredFootprint === true;
        if (useStoredFootprint) {
            const position = node.position();
            const size = getStandaloneContactMapMoleculeLayoutSize(node);

            return {
                x1: position.x - (size.width / 2) - padding,
                y1: position.y - (size.height / 2) - padding,
                x2: position.x + (size.width / 2) + padding,
                y2: position.y + (size.height / 2) + padding
            };
        }

        const bounds = node.boundingBox({
            includeLabels: true,
            includeOverlays: false
        });

        return {
            x1: bounds.x1 - padding,
            y1: bounds.y1 - padding,
            x2: bounds.x2 + padding,
            y2: bounds.y2 + padding
        };
    }

    function resolveStandaloneContactMapOverlaps(cy, options = {}) {
        if (!isStandaloneContactMapViewer()) {
            return false;
        }

        const molecules = getTopLevelVisibleStandaloneContactMapMolecules(cy);
        if (molecules.length < 2) {
            return false;
        }

        const useStoredFootprint = options.useStoredFootprint === true;
        const padding = currentGraphLayoutName === 'cose' ? 18 : 14;
        const maxPasses = 16;
        let moved = false;

        cy.batch(() => {
            for (let pass = 0; pass < maxPasses; pass += 1) {
                let passMoved = false;

                molecules.sort((left, right) => {
                    const leftPosition = left.position();
                    const rightPosition = right.position();

                    if (leftPosition.y !== rightPosition.y) {
                        return leftPosition.y - rightPosition.y;
                    }

                    if (leftPosition.x !== rightPosition.x) {
                        return leftPosition.x - rightPosition.x;
                    }

                    return left.id().localeCompare(right.id());
                });

                for (let i = 0; i < molecules.length; i += 1) {
                    for (let j = i + 1; j < molecules.length; j += 1) {
                        const left = molecules[i];
                        const right = molecules[j];
                        const leftBounds = getExpandedBoundingBox(left, padding, { useStoredFootprint: useStoredFootprint });
                        const rightBounds = getExpandedBoundingBox(right, padding, { useStoredFootprint: useStoredFootprint });
                        const overlapX = Math.min(leftBounds.x2, rightBounds.x2) - Math.max(leftBounds.x1, rightBounds.x1);
                        const overlapY = Math.min(leftBounds.y2, rightBounds.y2) - Math.max(leftBounds.y1, rightBounds.y1);

                        if (overlapX <= 0 || overlapY <= 0) {
                            continue;
                        }

                        const leftPosition = left.position();
                        const rightPosition = right.position();
                        let deltaLeft = { x: 0, y: 0 };
                        let deltaRight = { x: 0, y: 0 };

                        if (overlapX < overlapY) {
                            const direction = leftPosition.x === rightPosition.x
                                ? (left.id().localeCompare(right.id()) <= 0 ? -1 : 1)
                                : (leftPosition.x < rightPosition.x ? -1 : 1);
                            const shift = (overlapX / 2) + 2;
                            deltaLeft.x = direction * shift;
                            deltaRight.x = -direction * shift;
                        } else {
                            const direction = leftPosition.y === rightPosition.y
                                ? (left.id().localeCompare(right.id()) <= 0 ? -1 : 1)
                                : (leftPosition.y < rightPosition.y ? -1 : 1);
                            const shift = (overlapY / 2) + 2;
                            deltaLeft.y = direction * shift;
                            deltaRight.y = -direction * shift;
                        }

                        left.shift(deltaLeft);
                        right.shift(deltaRight);
                        passMoved = true;
                        moved = true;
                    }
                }

                if (!passMoved) {
                    break;
                }
            }
        });

        return moved;
    }

    function getStandaloneContactMapLayoutCenter(moleculeNodes) {
        if (!moleculeNodes || moleculeNodes.length === 0) {
            return { x: 0, y: 0 };
        }

        const center = moleculeNodes.reduce((accumulator, node) => {
            return {
                x: accumulator.x + node.position('x'),
                y: accumulator.y + node.position('y')
            };
        }, { x: 0, y: 0 });

        center.x /= moleculeNodes.length;
        center.y /= moleculeNodes.length;
        return center;
    }

    function getStandaloneContactMapRelativeLayoutBounds(positionsById, sizeById) {
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;

        positionsById.forEach((position, nodeId) => {
            const size = sizeById.get(nodeId);
            const width = size ? size.width : 0;
            const height = size ? size.height : 0;
            minX = Math.min(minX, position.x - (width / 2));
            maxX = Math.max(maxX, position.x + (width / 2));
            minY = Math.min(minY, position.y - (height / 2));
            maxY = Math.max(maxY, position.y + (height / 2));
        });

        if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
            return {
                minX: 0,
                maxX: 0,
                minY: 0,
                maxY: 0,
                width: 0,
                height: 0,
                centerX: 0,
                centerY: 0
            };
        }

        return {
            minX: minX,
            maxX: maxX,
            minY: minY,
            maxY: maxY,
            width: maxX - minX,
            height: maxY - minY,
            centerX: (minX + maxX) / 2,
            centerY: (minY + maxY) / 2
        };
    }

    function centerStandaloneContactMapRelativePositions(positionsById, sizeById) {
        const bounds = getStandaloneContactMapRelativeLayoutBounds(positionsById, sizeById);
        const centeredPositions = new Map();

        positionsById.forEach((position, nodeId) => {
            centeredPositions.set(nodeId, {
                x: position.x - bounds.centerX,
                y: position.y - bounds.centerY
            });
        });

        return {
            positionsById: centeredPositions,
            width: bounds.width,
            height: bounds.height
        };
    }

    function buildStandaloneContactMapGridPositions(cy) {
        const moleculeNodes = getTopLevelStandaloneContactMapMolecules(cy, { visibleOnly: false }).sort(compareNodeOrder);
        const positionsById = new Map();

        if (moleculeNodes.length === 0) {
            return positionsById;
        }

        const center = getStandaloneContactMapLayoutCenter(moleculeNodes);
        const sizeById = new Map();
        moleculeNodes.forEach((node) => {
            sizeById.set(node.id(), getStandaloneContactMapMoleculeLayoutSize(node));
        });

        const gapX = 58;
        const gapY = 56;
        const targetAspect = 1.45;
        let bestCandidate = null;

        for (let columnCount = 1; columnCount <= moleculeNodes.length; columnCount += 1) {
            const rowCount = Math.ceil(moleculeNodes.length / columnCount);
            const columnWidths = Array.from({ length: columnCount }, () => 0);
            const rowHeights = Array.from({ length: rowCount }, () => 0);

            moleculeNodes.forEach((node, index) => {
                const size = sizeById.get(node.id());
                const rowIndex = Math.floor(index / columnCount);
                const columnIndex = index % columnCount;
                columnWidths[columnIndex] = Math.max(columnWidths[columnIndex], size.width);
                rowHeights[rowIndex] = Math.max(rowHeights[rowIndex], size.height);
            });

            const totalWidth = columnWidths.reduce((sum, width) => sum + width, 0) + (Math.max(columnCount - 1, 0) * gapX);
            const totalHeight = rowHeights.reduce((sum, height) => sum + height, 0) + (Math.max(rowCount - 1, 0) * gapY);
            const aspect = totalWidth / Math.max(totalHeight, 1);
            const score = (totalWidth * totalHeight) * (1 + Math.abs(Math.log(aspect / targetAspect)));

            if (bestCandidate && score >= bestCandidate.score) {
                continue;
            }

            const candidatePositions = new Map();
            let rowStartY = -totalHeight / 2;
            for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
                const rowHeight = rowHeights[rowIndex];
                let columnStartX = -totalWidth / 2;

                for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
                    const nodeIndex = (rowIndex * columnCount) + columnIndex;
                    if (nodeIndex >= moleculeNodes.length) {
                        break;
                    }

                    const node = moleculeNodes[nodeIndex];
                    const columnWidth = columnWidths[columnIndex];
                    candidatePositions.set(node.id(), {
                        x: columnStartX + (columnWidth / 2),
                        y: rowStartY + (rowHeight / 2)
                    });
                    columnStartX += columnWidth + gapX;
                }

                rowStartY += rowHeight + gapY;
            }

            bestCandidate = {
                score: score,
                positionsById: candidatePositions
            };
        }

        if (!bestCandidate) {
            return positionsById;
        }

        bestCandidate.positionsById.forEach((position, nodeId) => {
            positionsById.set(nodeId, {
                x: center.x + position.x,
                y: center.y + position.y
            });
        });

        return positionsById;
    }

    function buildStandaloneContactMapCirclePositions(cy) {
        const moleculeNodes = getTopLevelStandaloneContactMapMolecules(cy, { visibleOnly: false }).sort(compareNodeOrder);
        const positionsById = new Map();

        if (moleculeNodes.length === 0) {
            return positionsById;
        }

        const center = getStandaloneContactMapLayoutCenter(moleculeNodes);

        if (moleculeNodes.length === 1) {
            positionsById.set(moleculeNodes[0].id(), center);
            return positionsById;
        }

        const gap = 42;
        const footprintSizes = moleculeNodes.map((node) => getStandaloneContactMapMoleculeLayoutSize(node));
        const totalArcLength = footprintSizes.reduce((sum, size) => {
            return sum + Math.max(size.width, size.height) + gap;
        }, 0);
        const maxDimension = footprintSizes.reduce((maximum, size) => {
            return Math.max(maximum, size.width, size.height);
        }, 0);
        const radius = Math.max(
            totalArcLength / (2 * Math.PI),
            maxDimension * 1.15,
            120
        );
        const startAngle = -Math.PI / 2;

        moleculeNodes.forEach((node, index) => {
            const angle = startAngle + ((2 * Math.PI * index) / moleculeNodes.length);
            positionsById.set(node.id(), {
                x: center.x + (Math.cos(angle) * radius),
                y: center.y + (Math.sin(angle) * radius)
            });
        });

        return positionsById;
    }

    function buildStandaloneContactMapConcentricPositions(cy) {
        const moleculeNodes = getTopLevelStandaloneContactMapMolecules(cy, { visibleOnly: false }).sort(compareNodeOrder);
        const positionsById = new Map();

        if (moleculeNodes.length === 0) {
            return positionsById;
        }

        const center = getStandaloneContactMapLayoutCenter(moleculeNodes);

        if (moleculeNodes.length === 1) {
            positionsById.set(moleculeNodes[0].id(), center);
            return positionsById;
        }

        const tempElements = getStandaloneContactMapMoleculeLayoutElements(cy);
        const degreeById = new Map();
        tempElements.nodes.forEach((node) => {
            degreeById.set(node.data.id, 0);
        });
        tempElements.edges.forEach((edge) => {
            degreeById.set(edge.data.source, (degreeById.get(edge.data.source) || 0) + 1);
            degreeById.set(edge.data.target, (degreeById.get(edge.data.target) || 0) + 1);
        });

        const groupsByDegree = new Map();
        moleculeNodes.forEach((node) => {
            const degree = degreeById.get(node.id()) || 0;
            if (!groupsByDegree.has(degree)) {
                groupsByDegree.set(degree, []);
            }

            groupsByDegree.get(degree).push(node);
        });

        const degrees = Array.from(groupsByDegree.keys()).sort((left, right) => right - left);
        let previousRingRadius = 0;
        let previousRingMaxDimension = 0;
        const gap = 42;

        degrees.forEach((degree, groupIndex) => {
            const groupNodes = groupsByDegree.get(degree).sort(compareNodeOrder);
            const groupSizes = groupNodes.map((node) => getStandaloneContactMapMoleculeLayoutSize(node));
            const groupMaxDimension = groupSizes.reduce((maximum, size) => {
                return Math.max(maximum, size.width, size.height);
            }, 0);

            if (groupIndex === 0 && groupNodes.length === 1) {
                positionsById.set(groupNodes[0].id(), center);
                previousRingMaxDimension = groupMaxDimension;
                return;
            }

            const groupArcLength = groupSizes.reduce((sum, size) => {
                return sum + Math.max(size.width, size.height) + gap;
            }, 0);
            const minimumRadius = groupIndex === 0
                ? Math.max(groupMaxDimension * 1.15, 110)
                : previousRingRadius + (previousRingMaxDimension / 2) + (groupMaxDimension / 2) + 56;
            const radius = Math.max(
                groupArcLength / (2 * Math.PI),
                minimumRadius
            );
            const startAngle = (-Math.PI / 2) + (groupIndex % 2 === 0 ? 0 : (Math.PI / Math.max(groupNodes.length, 2)));

            groupNodes.forEach((node, index) => {
                const angle = startAngle + ((2 * Math.PI * index) / groupNodes.length);
                positionsById.set(node.id(), {
                    x: center.x + (Math.cos(angle) * radius),
                    y: center.y + (Math.sin(angle) * radius)
                });
            });

            previousRingRadius = radius;
            previousRingMaxDimension = groupMaxDimension;
        });

        return positionsById;
    }

    function buildStandaloneContactMapBreadthfirstPositions(cy) {
        const moleculeNodes = getTopLevelStandaloneContactMapMolecules(cy, { visibleOnly: false }).sort(compareNodeOrder);
        const positionsById = new Map();

        if (moleculeNodes.length === 0) {
            return positionsById;
        }

        const tempElements = getStandaloneContactMapMoleculeLayoutElements(cy);
        if (tempElements.edges.length === 0) {
            return buildStandaloneContactMapGridPositions(cy);
        }

        const center = getStandaloneContactMapLayoutCenter(moleculeNodes);
        const nodeById = new Map();
        const sizeById = new Map();
        const adjacencyById = new Map();

        moleculeNodes.forEach((node) => {
            nodeById.set(node.id(), node);
            sizeById.set(node.id(), getStandaloneContactMapMoleculeLayoutSize(node));
            adjacencyById.set(node.id(), new Set());
        });

        tempElements.edges.forEach((edge) => {
            adjacencyById.get(edge.data.source).add(edge.data.target);
            adjacencyById.get(edge.data.target).add(edge.data.source);
        });

        const degreeById = new Map();
        moleculeNodes.forEach((node) => {
            degreeById.set(node.id(), adjacencyById.get(node.id()).size);
        });

        const preferredRoots = moleculeNodes.slice().sort((left, right) => {
            const degreeDifference = (degreeById.get(right.id()) || 0) - (degreeById.get(left.id()) || 0);
            if (degreeDifference !== 0) {
                return degreeDifference;
            }

            return compareNodeOrder(left, right);
        });

        const visitedIds = new Set();
        const componentLayouts = [];
        const layerGapX = 80;
        const nodeGapY = 44;
        const componentGapX = 120;

        preferredRoots.forEach((rootNode) => {
            if (visitedIds.has(rootNode.id())) {
                return;
            }

            const queue = [rootNode.id()];
            const depthById = new Map([[rootNode.id(), 0]]);
            const componentNodeIds = [];
            visitedIds.add(rootNode.id());

            while (queue.length !== 0) {
                const currentId = queue.shift();
                componentNodeIds.push(currentId);

                const neighborIds = Array.from(adjacencyById.get(currentId)).sort((leftId, rightId) => {
                    const degreeDifference = (degreeById.get(rightId) || 0) - (degreeById.get(leftId) || 0);
                    if (degreeDifference !== 0) {
                        return degreeDifference;
                    }

                    return compareNodeOrder(nodeById.get(leftId), nodeById.get(rightId));
                });

                neighborIds.forEach((neighborId) => {
                    if (visitedIds.has(neighborId)) {
                        return;
                    }

                    visitedIds.add(neighborId);
                    depthById.set(neighborId, (depthById.get(currentId) || 0) + 1);
                    queue.push(neighborId);
                });
            }

            const layers = new Map();
            componentNodeIds.forEach((nodeId) => {
                const depth = depthById.get(nodeId) || 0;
                if (!layers.has(depth)) {
                    layers.set(depth, []);
                }

                layers.get(depth).push(nodeId);
            });

            const layerDepths = Array.from(layers.keys()).sort((left, right) => left - right);
            const layerWidths = layerDepths.map((depth) => {
                return layers.get(depth).reduce((maximum, nodeId) => {
                    return Math.max(maximum, sizeById.get(nodeId).width);
                }, 0);
            });
            const relativePositions = new Map();
            let layerStartX = 0;

            layerDepths.forEach((depth, layerIndex) => {
                const layerNodeIds = layers.get(depth).slice().sort((leftId, rightId) => {
                    const leftDegree = degreeById.get(leftId) || 0;
                    const rightDegree = degreeById.get(rightId) || 0;
                    if (leftDegree !== rightDegree) {
                        return rightDegree - leftDegree;
                    }

                    return compareNodeOrder(nodeById.get(leftId), nodeById.get(rightId));
                });
                const layerWidth = layerWidths[layerIndex];
                const stackHeight = layerNodeIds.reduce((sum, nodeId) => {
                    return sum + sizeById.get(nodeId).height;
                }, 0) + (Math.max(layerNodeIds.length - 1, 0) * nodeGapY);
                let nodeStartY = -stackHeight / 2;

                layerNodeIds.forEach((nodeId) => {
                    const nodeSize = sizeById.get(nodeId);
                    relativePositions.set(nodeId, {
                        x: layerStartX + (layerWidth / 2),
                        y: nodeStartY + (nodeSize.height / 2)
                    });
                    nodeStartY += nodeSize.height + nodeGapY;
                });

                layerStartX += layerWidth + layerGapX;
            });

            const centeredComponent = centerStandaloneContactMapRelativePositions(relativePositions, sizeById);
            componentLayouts.push(centeredComponent);
        });

        const totalWidth = componentLayouts.reduce((sum, componentLayout) => {
            return sum + componentLayout.width;
        }, 0) + (Math.max(componentLayouts.length - 1, 0) * componentGapX);
        let componentStartX = -totalWidth / 2;

        componentLayouts.forEach((componentLayout) => {
            const componentCenterX = componentStartX + (componentLayout.width / 2);
            componentLayout.positionsById.forEach((position, nodeId) => {
                positionsById.set(nodeId, {
                    x: center.x + componentCenterX + position.x,
                    y: center.y + position.y
                });
            });
            componentStartX += componentLayout.width + componentGapX;
        });

        return positionsById;
    }

    function getStandaloneContactMapMoleculeLayoutElements(cy) {
        const moleculeNodes = getTopLevelStandaloneContactMapMolecules(cy, { visibleOnly: false }).sort(compareNodeOrder);
        const seenEdgeKeys = new Set();

        return {
            nodes: moleculeNodes.map((moleculeNode) => {
                const size = getStandaloneContactMapMoleculeLayoutSize(moleculeNode);
                return {
                    data: {
                        id: moleculeNode.id(),
                        width: size.width,
                        height: size.height
                    },
                    position: {
                        x: moleculeNode.position('x'),
                        y: moleculeNode.position('y')
                    }
                };
            }),
            edges: cy.edges().filter((edge) => !edge.data('isPromotedEdge')).toArray().reduce((layoutEdges, edge, index) => {
                const sourceMolecule = getTopLevelStandaloneContactMapMolecule(edge.source());
                const targetMolecule = getTopLevelStandaloneContactMapMolecule(edge.target());
                if (!sourceMolecule || !targetMolecule) {
                    return layoutEdges;
                }

                const sourceId = sourceMolecule.id();
                const targetId = targetMolecule.id();
                if (!sourceId || !targetId || sourceId === targetId) {
                    return layoutEdges;
                }

                const edgeKey = [sourceId, targetId].sort().join('::');
                if (seenEdgeKeys.has(edgeKey)) {
                    return layoutEdges;
                }

                seenEdgeKeys.add(edgeKey);
                layoutEdges.push({
                    data: {
                        id: `standalone-layout-edge-${index}`,
                        source: sourceId,
                        target: targetId
                    }
                });

                return layoutEdges;
            }, [])
        };
    }

    function createStandaloneContactMapMoleculeLayoutOptions(layoutName) {
        switch (layoutName) {
            case 'grid':
                return {
                    name: 'grid',
                    fit: false,
                    avoidOverlap: true,
                    avoidOverlapPadding: 28,
                    nodeDimensionsIncludeLabels: true,
                    animate: false
                };
            case 'circle':
                return {
                    name: 'circle',
                    fit: false,
                    avoidOverlap: true,
                    spacingFactor: 1.1,
                    nodeDimensionsIncludeLabels: true,
                    animate: false
                };
            case 'concentric':
                return {
                    name: 'concentric',
                    fit: false,
                    avoidOverlap: true,
                    minNodeSpacing: 42,
                    spacingFactor: 1.08,
                    nodeDimensionsIncludeLabels: true,
                    animate: false
                };
            case 'breadthfirst':
                return {
                    name: 'breadthfirst',
                    fit: false,
                    directed: false,
                    avoidOverlap: true,
                    spacingFactor: 1.18,
                    nodeDimensionsIncludeLabels: true,
                    animate: false
                };
            case 'cose':
            default:
                return {
                    name: 'cose',
                    fit: false,
                    animate: false,
                    randomize: false,
                    nodeDimensionsIncludeLabels: true,
                    componentSpacing: 96,
                    nodeOverlap: 24,
                    idealEdgeLength: 150,
                    edgeElasticity: 90,
                    gravity: 0.75,
                    numIter: 1800,
                    initialTemp: 140,
                    coolingFactor: 0.95,
                    minTemp: 1,
                    nodeRepulsion: function (node) {
                        const width = Number(node.data('width')) || 120;
                        const height = Number(node.data('height')) || 72;
                        return Math.max(9000, width * height * 16);
                    }
                };
        }
    }

    function applyStandaloneContactMapMoleculePositions(cy, positionsById) {
        const molecules = getTopLevelStandaloneContactMapMolecules(cy, { visibleOnly: false });
        if (molecules.length === 0) {
            return;
        }

        cy.batch(() => {
            molecules.forEach((moleculeNode) => {
                const nextPosition = positionsById.get(moleculeNode.id());
                if (!nextPosition) {
                    return;
                }

                const currentPosition = moleculeNode.position();
                const deltaX = nextPosition.x - currentPosition.x;
                const deltaY = nextPosition.y - currentPosition.y;
                if (Math.abs(deltaX) <= 0.5 && Math.abs(deltaY) <= 0.5) {
                    return;
                }

                moleculeNode.shift({
                    x: deltaX,
                    y: deltaY
                });
            });
        });
    }

    function applyStandaloneContactMapLayout(cy, layoutName, options = {}) {
        if (!isStandaloneContactMapViewer()) {
            if (options.fitViewport !== false && typeof options.onFit === 'function') {
                options.onFit({
                    animate: options.animateFit !== false
                });
            }

            return;
        }

        ensureStandaloneContactMapPrepared(cy);
        cy.resize();
        const topLevelMolecules = getTopLevelStandaloneContactMapMolecules(cy, { visibleOnly: false });
        if (topLevelMolecules.length === 0) {
            if (options.fitViewport !== false && typeof options.onFit === 'function') {
                options.onFit({
                    animate: options.animateFit !== false
                });
            }

            return;
        }

        if (layoutName === 'preset') {
            cy.batch(() => {
                topLevelMolecules.forEach((moleculeNode) => {
                    const specifiedPosition = moleculeNode.data('specifiedPosition');
                    if (!specifiedPosition) {
                        return;
                    }

                    const deltaX = specifiedPosition.x - moleculeNode.position('x');
                    const deltaY = specifiedPosition.y - moleculeNode.position('y');
                    if (Math.abs(deltaX) <= 0.5 && Math.abs(deltaY) <= 0.5) {
                        return;
                    }

                    moleculeNode.shift({
                        x: deltaX,
                        y: deltaY
                    });
                });
            });

            restoreStandaloneContactMapCanonicalGeometry(cy);
            resolveStandaloneContactMapOverlaps(cy, { useStoredFootprint: true });

            if (options.fitViewport !== false && typeof options.onFit === 'function') {
                options.onFit({
                    animate: options.animateFit !== false
                });
            }

            return;
        }

        if (layoutName === 'grid') {
            applyStandaloneContactMapMoleculePositions(cy, buildStandaloneContactMapGridPositions(cy));
            restoreStandaloneContactMapCanonicalGeometry(cy);
            resolveStandaloneContactMapOverlaps(cy, { useStoredFootprint: true });

            if (options.fitViewport !== false && typeof options.onFit === 'function') {
                options.onFit({
                    animate: options.animateFit !== false
                });
            }

            return;
        }

        if (layoutName === 'breadthfirst') {
            applyStandaloneContactMapMoleculePositions(cy, buildStandaloneContactMapBreadthfirstPositions(cy));
            restoreStandaloneContactMapCanonicalGeometry(cy);
            resolveStandaloneContactMapOverlaps(cy, { useStoredFootprint: true });

            if (options.fitViewport !== false && typeof options.onFit === 'function') {
                options.onFit({
                    animate: options.animateFit !== false
                });
            }

            return;
        }

        if (layoutName === 'circle') {
            applyStandaloneContactMapMoleculePositions(cy, buildStandaloneContactMapCirclePositions(cy));
            restoreStandaloneContactMapCanonicalGeometry(cy);
            resolveStandaloneContactMapOverlaps(cy, { useStoredFootprint: true });

            if (options.fitViewport !== false && typeof options.onFit === 'function') {
                options.onFit({
                    animate: options.animateFit !== false
                });
            }

            return;
        }

        if (layoutName === 'concentric') {
            applyStandaloneContactMapMoleculePositions(cy, buildStandaloneContactMapConcentricPositions(cy));
            restoreStandaloneContactMapCanonicalGeometry(cy);
            resolveStandaloneContactMapOverlaps(cy, { useStoredFootprint: true });

            if (options.fitViewport !== false && typeof options.onFit === 'function') {
                options.onFit({
                    animate: options.animateFit !== false
                });
            }

            return;
        }

        const tempElements = getStandaloneContactMapMoleculeLayoutElements(cy);
        const effectiveLayoutName = tempElements.edges.length === 0
            && (layoutName === 'breadthfirst' || layoutName === 'cose')
            ? 'grid'
            : layoutName;
        const tempCy = cytoscape({
            headless: true,
            elements: tempElements,
            style: [
                {
                    selector: 'node',
                    style: {
                        'width': 'data(width)',
                        'height': 'data(height)',
                        'shape': 'round-rectangle'
                    }
                },
                {
                    selector: 'edge',
                    style: {
                        'curve-style': 'bezier'
                    }
                }
            ],
            layout: {
                name: 'preset',
                fit: false
            }
        });

        tempCy.layout(createStandaloneContactMapMoleculeLayoutOptions(effectiveLayoutName)).run();
        const positionsById = new Map();
        tempCy.nodes().forEach((node) => {
            positionsById.set(node.id(), {
                x: node.position('x'),
                y: node.position('y')
            });
        });
        tempCy.destroy();

        applyStandaloneContactMapMoleculePositions(cy, positionsById);
        restoreStandaloneContactMapCanonicalGeometry(cy);
        resolveStandaloneContactMapOverlaps(cy, { useStoredFootprint: true });

        if (options.fitViewport !== false && typeof options.onFit === 'function') {
            options.onFit({
                animate: options.animateFit !== false
            });
        }
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
                const persistedGraphViewState = resolveInitialGraphViewState();
                graphKind = typeof message.graphKind === 'string' ? message.graphKind : 'other';
                graphHasComponents = false;
                graphHasInternalStates = false;
                useContactMapViewerPalette = Boolean(message.useContactMapViewerPalette);
                showComponents = persistedGraphViewState.showComponents;
                showInternalStates = persistedGraphViewState.showInternalStates;
                currentGraphLayoutName = persistedGraphViewState.layoutName || 'preset';
                graphLayoutLocked = persistedGraphViewState.layoutLocked;

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
                let nodeKindsById = {};
                let nodeOrderCounter = 0;

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
                    let shape = node.getElementsByTagName("y:Shape").item(0);
                    shape = (shape) ? shape.getAttribute("type") : null;
                    // label
                    let label = node.getElementsByTagName("y:NodeLabel").item(0);
                    let labelText = (label) ? label.textContent : "";
                    let labelColor = (label) ? label.getAttribute("textColor") : null;
                    let labelWeight = (label) ? label.getAttribute("fontStyle") : null;
                    labelColor = (labelColor) ? labelColor : "#000000";
                    labelWeight = (labelWeight && (labelWeight == "bold")) ? "bold" : "normal";
                    let labelFontSize = (label) ? parseFloat(label.getAttribute("fontSize")) : NaN;
                    labelFontSize = (Number.isFinite(labelFontSize) && labelFontSize > 0) ? labelFontSize : 12;
                    // layout
                    let layout = node.getElementsByTagName("y:Geometry").item(0);
                    // - specifiedPosition object stores node position specified by graphml (undefined if not specified)
                    let specifiedPosition = undefined;
                    let nodeWidth = NaN;
                    let nodeHeight = NaN;
                    const nodeKind = graphKind === 'contactmap' ? getContactMapNodeKind(backgroundColor) : 'other';
                    const hasDirectChildren = getDirectChildNodeElements(node).length > 0;
                    if (layout) {
                        specifiedPosition = {
                            x: parseFloat(layout.getAttribute("x")),
                            y: parseFloat(layout.getAttribute("y"))
                        };
                        nodeWidth = parseFloat(layout.getAttribute("width"));
                        nodeHeight = parseFloat(layout.getAttribute("height"));
                    }
                    const defaultNodeDimensions = getContactMapDefaultNodeDimensions(nodeKind, hasDirectChildren);
                    const defaultNodeWidth = defaultNodeDimensions.width;
                    const defaultNodeHeight = defaultNodeDimensions.height;
                    const isStandaloneContactMapStyling = isStandaloneContactMapViewer();
                    const minimumNodeWidth = isStandaloneContactMapStyling
                        ? getContactMapMinimumNodeWidth(nodeKind, labelText, hasDirectChildren)
                        : defaultNodeWidth;
                    const displayWidth = (Number.isFinite(nodeWidth) && nodeWidth > 0)
                        ? nodeWidth
                        : Math.max(defaultNodeWidth, minimumNodeWidth);
                    const displayHeight = (Number.isFinite(nodeHeight) && nodeHeight > 0) ? nodeHeight : defaultNodeHeight;
                    const labelMaxWidth = isStandaloneContactMapStyling
                        ? getContactMapLabelMaxWidth(nodeKind, displayWidth, hasDirectChildren)
                        : Math.max(48, displayWidth - 16);
                    const displayBorderWidth = isStandaloneContactMapStyling
                        ? getContactMapBorderWidth(nodeKind, borderWidth)
                        : (Number.isFinite(parseFloat(borderWidth)) ? parseFloat(borderWidth) : 1);
                    const nodeShape = getCytoscapeShape(shape, nodeKind);
                    const minZoomedFontSize = isStandaloneContactMapStyling
                        ? getContactMapMinZoomedFontSize(nodeKind)
                        : (graphKind === 'contactmap' ? 0 : 12);
                    if (isStandaloneContactMapStyling) {
                        labelFontSize = getContactMapLabelFontSize(
                            nodeKind,
                            labelFontSize,
                            displayWidth,
                            displayHeight,
                            labelText,
                            hasDirectChildren
                        );
                        if (nodeKind === 'molecule') {
                            labelWeight = 'bold';
                        }
                    }
                    const labelValign = graphKind === 'regulatory'
                        ? 'center'
                        : (isStandaloneContactMapStyling
                            ? getContactMapLabelValign(nodeKind)
                            : 'top');
                    const labelHalign = isStandaloneContactMapStyling
                        ? getContactMapLabelHalign(nodeKind)
                        : 'center';
                    const labelJustification = isStandaloneContactMapStyling
                        ? getContactMapLabelJustification(nodeKind)
                        : 'center';
                    const labelMarginX = isStandaloneContactMapStyling
                        ? getContactMapLabelMarginX(nodeKind, displayWidth)
                        : 0;
                    const labelMarginY = isStandaloneContactMapStyling
                        ? getContactMapLabelMarginY(nodeKind, displayHeight)
                        : 0;
                    const labelBackgroundOpacity = isStandaloneContactMapStyling
                        ? getContactMapLabelBackgroundOpacity(nodeKind)
                        : 0;
                    const labelBackgroundPadding = isStandaloneContactMapStyling
                        ? getContactMapLabelBackgroundPadding(nodeKind)
                        : 0;
                    const compoundPadding = isStandaloneContactMapStyling
                        ? getContactMapCompoundPadding(nodeKind, hasDirectChildren)
                        : 20;
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
                                displayBorderWidth: displayBorderWidth,
                                borderColor: borderColor,
                                displayBorderColor: borderColor,
                                nodeShape: nodeShape,
                                width: displayWidth,
                                height: displayHeight,
                                labelText: labelText,
                                labelColor: labelColor,
                                displayLabelColor: labelColor,
                                displayLabelBackgroundColor: isStandaloneContactMapStyling
                                    ? getContactMapBaseFillColor(nodeKind, backgroundColor)
                                    : 'transparent',
                                labelWeight: labelWeight,
                                labelFontSize: labelFontSize,
                                labelMaxWidth: labelMaxWidth,
                                labelValign: labelValign,
                                labelHalign: labelHalign,
                                labelJustification: labelJustification,
                                labelMarginX: labelMarginX,
                                labelMarginY: labelMarginY,
                                labelBackgroundOpacity: labelBackgroundOpacity,
                                labelBackgroundPadding: labelBackgroundPadding,
                                compoundPadding: compoundPadding,
                                minCompoundWidth: hasDirectChildren ? displayWidth : 0,
                                minCompoundHeight: hasDirectChildren ? displayHeight : 0,
                                minZoomedFontSize: minZoomedFontSize,
                                nodeKind: nodeKind,
                                nodeOrder: nodeOrderCounter,
                                specifiedPosition: specifiedPosition},
                        position: position}
                    );
                    nodeKindsById[node.id] = nodeKind;
                    nodeOrderCounter += 1;
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
                    const arrowColor = lineColor;
                    const sourceKind = nodeKindsById[source] || 'other';
                    const targetKind = nodeKindsById[target] || 'other';
                    cytoElements["edges"].push(
                        {data: {id: edge.id,
                                source: source,
                                target: target,
                                lineWidth: lineWidth,
                                lineColor: lineColor,
                                displayLineColor: lineColor,
                                arrowColor: arrowColor,
                                displayArrowColor: arrowColor,
                                connectsState: sourceKind === 'state' || targetKind === 'state',
                                connectsComponent: sourceKind !== 'molecule' || targetKind !== 'molecule',
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
                            'border-width': 'data(displayBorderWidth)',
                            'border-color': 'data(displayBorderColor)',
                            'shape': 'data(nodeShape)',
                            'width': 'data(width)',
                            'height': 'data(height)',
                            'label': 'data(labelText)',
                            'color': 'data(displayLabelColor)',
                            'font-weight': 'data(labelWeight)',
                            'font-size': 'data(labelFontSize)',
                            'text-valign': 'data(labelValign)',
                            'text-halign': 'data(labelHalign)',
                            'text-justification': 'data(labelJustification)',
                            'text-margin-x': 'data(labelMarginX)',
                            'text-margin-y': 'data(labelMarginY)',
                            'text-background-color': 'data(displayLabelBackgroundColor)',
                            'text-background-opacity': 'data(labelBackgroundOpacity)',
                            'text-background-padding': 'data(labelBackgroundPadding)',
                            'text-background-shape': 'round-rectangle',
                            'text-wrap': 'wrap',
                            'text-max-width': 'data(labelMaxWidth)',
                            'min-zoomed-font-size': 'data(minZoomedFontSize)'
                        }
                    },
                    {
                        selector: ':parent',
                        style: {
                            'padding': 'data(compoundPadding)',
                            'min-width': 'data(minCompoundWidth)',
                            'min-height': 'data(minCompoundHeight)'
                        }
                    },
                    {
                        selector: '.contact-map-structure-hidden',
                        style: {
                            'display': 'none'
                        }
                    },
                    {
                        selector: 'edge',
                        style: {
                            'width': 'data(lineWidth)',
                            'line-color': 'data(displayLineColor)',
                            'target-arrow-color': 'data(displayArrowColor)',
                            'target-arrow-shape': 'data(arrow)',
                            'curve-style': 'bezier'
                        }
                    }
                ];

                const hasSpecifiedPositions = cytoElements["nodes"].some((node) => {
                    return typeof node.data.specifiedPosition !== 'undefined';
                });
                graphHasComponents = graphKind === 'contactmap'
                    && cytoElements["nodes"].some((node) => node.data.nodeKind === 'site');
                graphHasInternalStates = graphKind === 'contactmap'
                    && cytoElements["nodes"].some((node) => node.data.nodeKind === 'state');
                const defaultLayoutName = hasSpecifiedPositions
                    ? 'preset'
                    : ((graphKind === 'contactmap' || graphKind === 'regulatory') ? 'cose' : 'breadthfirst');
                const layoutSelect = document.getElementById('layout_select');
                const layoutLockButton = document.getElementById('layout_lock_button');
                const fitButton = document.getElementById('fit_button');
                const exportPngButton = document.getElementById('png_button');
                const exportGraphmlButton = document.getElementById('graphml_button');
                const toggleComponentsButton = document.getElementById('toggle_components_button');
                const toggleInternalStatesButton = document.getElementById('toggle_internal_states_button');

                const layoutFactories = {
                    preset: function () {
                        return {
                            name: 'preset',
                            fit: true,
                            padding: getGraphFitPadding()
                        };
                    },
                    breadthfirst: function () {
                        return {
                            name: 'breadthfirst',
                            fit: true,
                            padding: getGraphFitPadding(),
                            directed: true,
                            animate: false,
                            avoidOverlap: true,
                            nodeDimensionsIncludeLabels: true,
                            spacingFactor: graphKind === 'regulatory'
                                ? 1.45
                                : (isStandaloneContactMapViewer() ? 1.4 : (graphKind === 'contactmap' ? 1.15 : 1.25))
                        };
                    },
                    grid: function () {
                        return {
                            name: 'grid',
                            fit: true,
                            padding: getGraphFitPadding(),
                            avoidOverlap: true,
                            avoidOverlapPadding: isStandaloneContactMapViewer() ? 24 : 20,
                            nodeDimensionsIncludeLabels: true,
                            animate: false
                        };
                    },
                    circle: function () {
                        return {
                            name: 'circle',
                            fit: true,
                            padding: getGraphFitPadding(),
                            avoidOverlap: true,
                            nodeDimensionsIncludeLabels: true,
                            spacingFactor: isStandaloneContactMapViewer() ? 1.25 : 1.15,
                            animate: false
                        };
                    },
                    concentric: function () {
                        return {
                            name: 'concentric',
                            fit: true,
                            padding: getGraphFitPadding(),
                            avoidOverlap: true,
                            nodeDimensionsIncludeLabels: true,
                            animate: false,
                            minNodeSpacing: graphKind === 'regulatory'
                                ? 60
                                : (isStandaloneContactMapViewer() ? 60 : 40),
                            spacingFactor: isStandaloneContactMapViewer() ? 1.25 : 1.15
                        };
                    },
                    cose: function () {
                        return {
                            name: 'cose',
                            fit: true,
                            padding: getGraphFitPadding(),
                            animate: false,
                            nodeDimensionsIncludeLabels: true,
                            componentSpacing: graphKind === 'regulatory'
                                ? 100
                                : (isStandaloneContactMapViewer() ? 96 : (graphKind === 'contactmap' ? 28 : 80)),
                            nodeOverlap: graphKind === 'contactmap' ? 10 : 32,
                            idealEdgeLength: graphKind === 'regulatory'
                                ? 180
                                : (isStandaloneContactMapViewer() ? 96 : (graphKind === 'contactmap' ? 72 : 150)),
                            edgeElasticity: isStandaloneContactMapViewer() ? 85 : (graphKind === 'contactmap' ? 90 : 120),
                            nestingFactor: isStandaloneContactMapViewer() ? 0.95 : (graphKind === 'contactmap' ? 0.9 : 1.2),
                            gravity: isStandaloneContactMapViewer() ? 0.95 : (graphKind === 'contactmap' ? 1.35 : 1),
                            numIter: isStandaloneContactMapViewer() ? 1800 : (graphKind === 'contactmap' ? 1400 : 2500),
                            initialTemp: isStandaloneContactMapViewer() ? 150 : (graphKind === 'contactmap' ? 120 : 200),
                            coolingFactor: isStandaloneContactMapViewer() ? 0.96 : (graphKind === 'contactmap' ? 0.97 : 0.95),
                            minTemp: 1
                        };
                    }
                };
                const initialLayoutName = normalizeLayoutSelection(
                    currentGraphLayoutName,
                    hasSpecifiedPositions,
                    defaultLayoutName,
                    layoutFactories
                );

                if (currentCy) {
                    currentCy.destroy();
                    currentCy = null;
                }

                // initialize graph
                const cy = cytoscape({
                    container: network,
                    elements: cytoElements,
                    style: style,
                    layout: {
                        name: 'preset',
                        fit: false
                    }
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
                    layoutSelect.value = initialLayoutName;
                }
                updateLayoutLockButton(layoutSelect);

                function fitGraph(options = {}) {
                    const animate = options.animate !== false;
                    const elementsToFit = cy.elements(':visible');
                    if (elementsToFit.length === 0) {
                        return;
                    }

                    const fitOptions = {
                        fit: {
                            eles: elementsToFit,
                            padding: getGraphFitPadding()
                        }
                    };

                    if (!animate) {
                        cy.fit(elementsToFit, getGraphFitPadding());
                        return;
                    }

                    cy.animate({
                        ...fitOptions,
                        duration: 250
                    });
                }

                function createLayoutOptions(layoutName) {
                    const createLayout = layoutFactories[layoutName] || layoutFactories.breadthfirst;
                    return createLayout();
                }

                function applyLayout(layoutName, options = {}) {
                    const normalizedLayoutName = normalizeLayoutSelection(
                        layoutName,
                        hasSpecifiedPositions,
                        defaultLayoutName,
                        layoutFactories
                    );
                    const animateFit = options.animateFit !== false;
                    currentGraphLayoutName = normalizedLayoutName;
                    persistGraphViewState();

                    if (layoutSelect) {
                        layoutSelect.value = normalizedLayoutName;
                    }

                    if (isStandaloneContactMapViewer()) {
                        applyStandaloneContactMapLayout(cy, normalizedLayoutName, {
                            animateFit: animateFit,
                            fitViewport: true,
                            onFit: fitGraph
                        });
                        return;
                    }

                    if (normalizedLayoutName === 'preset') {
                        cy.nodes().forEach(function(node) {
                            const specifiedPosition = node.data('specifiedPosition');
                            if (specifiedPosition) {
                                node.position({
                                    x: specifiedPosition.x,
                                    y: specifiedPosition.y
                                });
                            }
                        });
                        fitGraph({ animate: animateFit });
                        return;
                    }

                    cy.elements(':visible').layout(createLayoutOptions(normalizedLayoutName)).run();
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

                if (layoutLockButton) {
                    layoutLockButton.onclick = function () {
                        graphLayoutLocked = !graphLayoutLocked;
                        updateLayoutLockButton(layoutSelect);
                        persistGraphViewState();
                    };
                }

                if (layoutSelect) {
                    layoutSelect.onchange = function () {
                        applyLayout(layoutSelect.value, { animateFit: true });
                    };
                }

                if (fitButton) {
                    fitButton.onclick = function () {
                        fitGraph({ animate: true });
                    };
                }

                if (exportPngButton) {
                    exportPngButton.onclick = exportGraphPng;
                }

                if (exportGraphmlButton) {
                    exportGraphmlButton.onclick = exportGraphml;
                }

                if (toggleComponentsButton) {
                    toggleComponentsButton.onclick = function () {
                        showComponents = !showComponents;
                        updateComponentsButton();
                        updateInternalStatesButton();
                        applyContactMapStructureVisibility();
                        persistGraphViewState();
                    };
                }

                if (toggleInternalStatesButton) {
                    toggleInternalStatesButton.onclick = function () {
                        showInternalStates = !showInternalStates;
                        updateComponentsButton();
                        updateInternalStatesButton();
                        applyContactMapStructureVisibility();
                        persistGraphViewState();
                    };
                }

                updateComponentsButton();
                updateInternalStatesButton();

                if (isStandaloneContactMapViewer()) {
                    ensureStandaloneContactMapPrepared(cy);
                }

                applyContactMapStructureVisibility();

                if (isStandaloneContactMapViewer()) {
                    requestAnimationFrame(() => {
                        if (currentCy !== cy) {
                            return;
                        }

                        cy.resize();
                        applyLayout(initialLayoutName, { animateFit: false });
                    });
                } else {
                    applyLayout(initialLayoutName, { animateFit: false });
                }

                break;
        }
    });
    
    vscode.postMessage({
        command: 'ready',
    });
}());
