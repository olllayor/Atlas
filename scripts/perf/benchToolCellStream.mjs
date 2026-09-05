import { buildToolCells } from '../../src/shared/toolCellGrammar.js';

function runBenchmark() {
  console.log('--- Benchmarking toolCellGrammar under heavy streaming ---');
  const chunks = 50;
  const charsPerChunk = 5_000;
  let accumulatedText = '';

  if (global.gc) global.gc();
  const memBefore = process.memoryUsage();
  const t0 = performance.now();

  for (let i = 1; i <= chunks; i++) {
    // Add 5,000 characters of simulated command logs per chunk
    const linesToAdd = Array.from({ length: 80 }, (_, idx) => 
      `[step-${i}:${idx}] chunk payload output verifying line processing latency and buffer behavior`
    ).join('\n') + '\n';
    accumulatedText += linesToAdd;

    const part = {
      id: 'tool-stream-1',
      type: 'tool',
      toolCallId: 'call-stream-1',
      toolName: 'bash',
      toolType: 'command_execution',
      state: i === chunks ? 'output-available' : 'running',
      input: { command: 'heavy_command.sh' },
      output: accumulatedText,
    };

    const cells = buildToolCells([part]);
    if (i === chunks) {
      console.log(`Final output length: ${accumulatedText.length} chars, omitted lines: ${cells[0].detail.omitted}`);
    }
  }

  const durationMs = performance.now() - t0;
  const memAfter = process.memoryUsage();

  console.log(`Total streaming duration: ${durationMs.toFixed(2)}ms`);
  console.log(`Heap used delta: ${((memAfter.heapUsed - memBefore.heapUsed) / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`ArrayBuffers delta: ${((memAfter.arrayBuffers - memBefore.arrayBuffers) / (1024 * 1024)).toFixed(2)} MB`);
}

runBenchmark();
