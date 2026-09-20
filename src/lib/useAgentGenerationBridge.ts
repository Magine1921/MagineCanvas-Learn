'use client';

import { useEffect, useRef } from 'react';
import { registerCanvasGenerationHandler, waitForGenerationProgress } from '@/lib/canvas-generation-bridge';

type GenerationProgress = { status: string; message: string };

export function useAgentGenerationBridge(
  nodeId: string,
  runGenerate: () => Promise<void>,
  generationProgress: GenerationProgress
) {
  const runGenerateRef = useRef(runGenerate);
  const progressRef = useRef(generationProgress);

  runGenerateRef.current = runGenerate;
  progressRef.current = generationProgress;

  useEffect(() => {
    return registerCanvasGenerationHandler(nodeId, async () => {
      const waitPromise = waitForGenerationProgress(() => progressRef.current, 600_000);
      await runGenerateRef.current();
      return waitPromise;
    });
  }, [nodeId]);
}
