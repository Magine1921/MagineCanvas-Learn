import assert from 'node:assert/strict';
import test from 'node:test';

import {
  composePrompt,
  getIncomingPromptSources,
} from '../src/lib/prompt-flow.ts';

test('multiple text inputs follow edge connection order', () => {
  const nodes = [
    { id: 'text-a', type: 'prompt', data: { type: 'prompt', text: 'first' } },
    { id: 'text-b', type: 'prompt', data: { type: 'prompt', text: 'second' } },
    { id: 'image', type: 'image', data: { type: 'image' } },
  ];
  const edges = [
    { id: 'edge-b', source: 'text-b', target: 'image' },
    { id: 'edge-a', source: 'text-a', target: 'image' },
  ];

  const sources = getIncomingPromptSources('image', nodes, edges);

  assert.deepEqual(sources.map((source) => source.nodeId), ['text-b', 'text-a']);
  assert.equal(composePrompt(sources.map((source) => source.text)), 'second\n\nfirst');
});
