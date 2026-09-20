function appendAgentOutputs(
  existing: readonly string[],
  ...outputs: Array<string | undefined>
): string[] {
  const next = existing.map((item) => item.trim()).filter(Boolean);
  for (const output of outputs) {
    const normalized = output?.trim();
    if (!normalized || next[next.length - 1] === normalized) continue;
    next.push(normalized);
  }
  return next;
}

export function appendAgentThinkingOutputs(
  existing: readonly string[],
  ...outputs: Array<string | undefined>
): string[] {
  return appendAgentOutputs(existing, ...outputs);
}

export function joinAgentThinkingOutputs(outputs: readonly string[]): string | undefined {
  const joined = outputs.map((item) => item.trim()).filter(Boolean).join('\n\n');
  return joined || undefined;
}

export function appendAgentTextOutputs(
  existing: readonly string[],
  ...outputs: Array<string | undefined>
): string[] {
  return appendAgentOutputs(existing, ...outputs);
}

export function joinAgentTextOutputs(outputs: readonly string[]): string | undefined {
  const joined = outputs.map((item) => item.trim()).filter(Boolean).join('\n\n');
  return joined || undefined;
}
