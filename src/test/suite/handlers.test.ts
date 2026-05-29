import * as assert from 'assert';
import { createStandaloneRegulatoryInputText, createStandaloneRulevizInputText, createStandaloneRulevizOperationInputText } from '../../commands/handlers';

suite('Visualization Handlers', () => {
    test('replaces top-level actions with a standalone regulatory ruleNames action', () => {
        const source = [
            'begin model',
            'begin parameters',
            '  k 1',
            'end parameters',
            'end model',
            '',
            'simulate({method=>"ssa"})',
            'visualize({type=>"contactmap"})',
            ''
        ].join('\n');

        const result = createStandaloneRegulatoryInputText(source);

        assert.strictEqual(result.includes('simulate({method=>"ssa"})'), false);
        assert.strictEqual(result.includes('visualize({type=>"contactmap"})'), false);
        assert.match(result, /visualize\(\{type=>"regulatory",ruleNames=>1\}\)\n$/);
    });

    test('removes actions blocks before appending the standalone regulatory action', () => {
        const source = [
            'begin model',
            'begin parameters',
            '  k 1',
            'end parameters',
            'end model',
            '',
            'begin actions',
            '  simulate({method=>"ode"})',
            '  visualize({type=>"contactmap"})',
            'end actions',
            ''
        ].join('\n');

        const result = createStandaloneRegulatoryInputText(source);

        assert.strictEqual(result.includes('begin actions'), false);
        assert.strictEqual(result.includes('simulate({method=>"ode"})'), false);
        assert.strictEqual(result.includes('visualize({type=>"contactmap"})'), false);
        assert.match(result, /end model\n\nvisualize\(\{type=>"regulatory",ruleNames=>1\}\)\n$/);
    });

    test('replaces top-level actions with a standalone RuleViz each=>1 action', () => {
        const source = [
            'begin model',
            'begin parameters',
            '  k 1',
            'end parameters',
            'end model',
            '',
            'simulate({method=>"ssa"})',
            'visualize({type=>"ruleviz_operation"})',
            ''
        ].join('\n');

        const result = createStandaloneRulevizOperationInputText(source);

        assert.strictEqual(result.includes('simulate({method=>"ssa"})'), false);
        assert.strictEqual(result.includes('visualize({type=>"ruleviz_operation"})'), false);
        assert.match(result, /visualize\(\{type=>"ruleviz_operation",each=>1\}\)\n$/);
    });

    test('appends both standalone RuleViz views for the unified RuleViz feature', () => {
        const source = [
            'begin model',
            'begin parameters',
            '  k 1',
            'end parameters',
            'end model',
            '',
            'simulate({method=>"ssa"})',
            'visualize({type=>"ruleviz_operation"})',
            ''
        ].join('\n');

        const result = createStandaloneRulevizInputText(source);

        assert.strictEqual(result.includes('simulate({method=>"ssa"})'), false);
        assert.strictEqual(result.includes('visualize({type=>"ruleviz_operation"})'), false);
        assert.match(
            result,
            /visualize\(\{type=>"ruleviz_pattern",each=>1\}\)\nvisualize\(\{type=>"ruleviz_operation",each=>1\}\)\n$/
        );
    });
});
