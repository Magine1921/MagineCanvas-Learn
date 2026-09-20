const AGENT_DOCX_TEXT_MAX_CHARS = 40_000;

export async function readAgentDocxArrayBuffer(
  arrayBuffer: ArrayBuffer,
): Promise<{ text: string; truncated: boolean } | null> {
  try {
    const mammoth = (await import('mammoth')).default;
    const input = typeof window === 'undefined'
      ? { buffer: Buffer.from(arrayBuffer) }
      : { arrayBuffer };
    const result = await mammoth.extractRawText(input);
    const text = result.value.replace(/\r\n?/g, '\n').trim();
    if (!text) return null;
    return {
      text: text.slice(0, AGENT_DOCX_TEXT_MAX_CHARS),
      truncated: text.length > AGENT_DOCX_TEXT_MAX_CHARS,
    };
  } catch {
    return null;
  }
}
