[![Documentation Status](https://readthedocs.org/projects/bng-vs-code-extension/badge/?version=latest)](https://bng-vs-code-extension.readthedocs.io/en/latest/?badge=latest)

# BioNetGen VS Code extension

This is a [VS Code](https://code.visualstudio.com/) language extension for [BioNetGen modeling language](http://bionetgen.org/). Please read the [installation instructions](https://github.com/wshlavacek/BNG_vscode_extension#installation) and see [here](https://bng-vs-code-extension.readthedocs.io/en/latest/) for a starter guide.

<img src=https://raw.githubusercontent.com/wshlavacek/BNG_vscode_extension/main/assets/featured.gif title="Writing, running and plotting all done from within VS Code">


## Features

* **Syntax Highlighting:** Robust support for BioNetGen Language, including multi-line constructs.
* **Intelligent Folding:** Fold `begin/end` blocks and metadata sections for easy navigation.
* **Unified Workspace:** Run simulations, visualize networks, and plot data directly from the editor title bar.
* **Interactive Plotting:** Explore results with a built-in variable selector, search, and visibility toggles.
* **Professional UI:** Integrated with VS Code standard icons and themes.

## Requirements

To use the run and plot buttons the default VS Code terminal you are using needs to have access to
* [Perl](https://www.perl.org/)
* [Python3](https://www.python.org/), preferably [anaconda python](https://docs.anaconda.com/anaconda/)
* [BioNetGen commmand line interface](https://github.com/RuleWorld/PyBioNetGen)

Please note that this tool is in active early development and is subject to sweeping changes.

## Installation

The extension can be found in the [VS Code marketplace](https://marketplace.visualstudio.com/vscode) as [BioNetGen Language](https://marketplace.visualstudio.com/items?itemName=als251.bngl). See [here](https://code.visualstudio.com/docs/editor/extension-gallery#_browse-for-extensions) to learn how to browse and install extensions in VS Code.

For other ways to install, check out the [installation guide](docs/install.md).

## Snippets

Type a prefix and press `Tab` to expand. All snippets are available in `.bngl` files.

### Block Snippets

| Prefix | Description |
|--------|-------------|
| `begin model` | Full model skeleton with all standard blocks |
| `begin parameters` | Parameters block |
| `begin molecule types` | Molecule types block |
| `begin compartments` | Compartments block |
| `begin seed species` | Seed species block |
| `begin species` | Species block |
| `begin observables` | Observables block |
| `begin functions` | Functions block |
| `begin reaction rules` | Reaction rules block |
| `begin population maps` | Population maps block |
| `begin energy patterns` | Energy patterns block |

### Line Snippets

| Prefix | Description |
|--------|-------------|
| `Molecule` | Molecule with component and state |
| `MoleculeType` | Molecule type definition with two states |
| `Species` | Species pattern with bond |
| `CompartmentLine` | Compartment definition |
| `ParameterLine` | Parameter name/value pair |
| `SpeciesLine` | Species with amount |
| `ObservableLine` | Observable (Molecules or Species) |
| `FunctionLine` | Function definition |
| `RuleLine` | Reaction rule with rate |
| `EnergyPatternLine` | Energy pattern with expression |
| `PopulationMapLine` | Population map rule |

### Action Snippets

| Prefix | Description |
|--------|-------------|
| `generate_network` | Generate network action |
| `generate_hybrid_model` | Generate hybrid model action |
| `simulate` | Simulate with method, t_end, n_steps |
| `parameter_scan` | Parameter scan with all options |
| `bifurcate` | Bifurcation analysis |
| `readFile` | Read file action |
| `writeFile` | Write file (bngl/net/xml) |
| `writeModel` | Write model |
| `writeNetwork` | Write network |
| `writeXML` | Write XML |
| `writeSBML` | Write SBML |
| `writeMfile` | Write M-file |
| `writeMexfile` | Write MEX-file |
| `writeMDL` | Write MDL |
| `visualize` | Visualize action |
| `setConcentrations` | Set species concentration |
| `addConcentration` | Add to species concentration |
| `saveConcentrations` | Save current concentrations |
| `resetConcentrations` | Reset concentrations |
| `setParameter` | Set parameter value |
| `saveParameters` | Save current parameters |
| `resetParameters` | Reset parameters |
| `setModelName` | Set model name |
| `substanceUnits` | Set substance units |
| `version` | Set version |
| `setOption` | Set option |
| `quit` | Quit action |

### Math Functions

`abs`, `sin`, `cos`, `tan`, `exp`, `ln`, `log10`, `floor`, `ceil`, `sqrt`, `asin`, `acos`, `atan`, `sinh`, `cosh`, `tanh`, `asinh`, `acosh`, `atanh`

## Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `bngl.general.auto_install` | Automatically install PyBioNetGen on activation | `true` |
| `bngl.general.enable_terminal_runner` | Use the old terminal-based runner instead of spawning processes | `false` |
| `bngl.general.auto_open` | Automatically open result files (e.g. `.gdat`) after a simulation run | `true` |
| `bngl.general.result_folder` | Absolute path to a default results folder (used when no workspace is open) | `null` |
| `bngl.plotting.legend` | Show the plot legend by default | `true` |
| `bngl.plotting.max_series_count` | Maximum number of time series to display initially | `50` |

## Development

This extension uses TypeScript and esbuild. To develop locally:
1. `npm install`
2. `npm run watch` to start the build in watch mode.
3. Press `F5` to launch the Extension Development Host.

Please submit an issue [here](https://github.com/wshlavacek/BNG_vscode_extension) if you find one or have any feature requests. 

## Release Notes

This extension is still in alpha stage of development. 

-----------------------------------------------------------------------------------------------------------
