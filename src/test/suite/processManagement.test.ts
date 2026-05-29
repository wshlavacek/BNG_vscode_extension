import * as assert from 'assert';
import { ProcessManager } from '../../utils/processManagement';

suite('Process Manager', () => {
    test('tracks simulation metadata and finds active runs by model path', () => {
        const processManager = new ProcessManager();

        processManager.add(101, '/usr/bin/python', {
            label: 'model_a.bngl',
            description: 'results_model_a/2026_05_29__09_00_00',
            kind: 'simulation',
            modelPath: '/tmp/model_a.bngl',
            resultsFolder: '/tmp/results_model_a/2026_05_29__09_00_00',
            startedAt: 1
        });
        processManager.add(202, '/usr/bin/python', {
            label: 'model_b.bngl',
            kind: 'visualization',
            modelPath: '/tmp/model_b.bngl'
        });

        assert.strictEqual(processManager.countTrackedProcesses(), 2);
        assert.strictEqual(processManager.countTrackedProcesses('simulation'), 1);
        assert.strictEqual(processManager.countTrackedProcesses('visualization'), 1);

        const activeRun = processManager.findTrackedProcessByModel('/tmp/model_a.bngl', 'simulation');
        assert.ok(activeRun);
        assert.strictEqual(activeRun?.label, 'model_a.bngl');
        assert.strictEqual(activeRun?.description, 'results_model_a/2026_05_29__09_00_00');
    });

    test('removes tracked processes when deleted', () => {
        const processManager = new ProcessManager();

        processManager.add(303, '/usr/bin/python', {
            label: 'model_c.bngl',
            kind: 'simulation',
            modelPath: '/tmp/model_c.bngl'
        });

        assert.ok(processManager.findTrackedProcessByModel('/tmp/model_c.bngl', 'simulation'));

        processManager.delete(303);

        assert.strictEqual(processManager.countTrackedProcesses(), 0);
        assert.strictEqual(processManager.findTrackedProcessByModel('/tmp/model_c.bngl', 'simulation'), undefined);
    });
});
