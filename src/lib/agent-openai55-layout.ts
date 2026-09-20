export const OPENAI55_ARTIFACT_START = '<<<MAGINE_ARTIFACT';
export const OPENAI55_ARTIFACT_END = '<<<END_MAGINE_ARTIFACT>>>';

export const OPENAI55_ARTIFACT_SYSTEM_INSTRUCTION = `
当回复包含可复用的长篇方案、脚本、提示词或结构化正文时，先用一小段话说明关键结论，再严格使用下面的文档协议输出正文：
<<<MAGINE_ARTIFACT title="简短准确的文档标题">>>
正文使用 Markdown，可使用标题、粗体和列表。
<<<END_MAGINE_ARTIFACT>>>
短回答无需创建文档。不要把协议标记放进代码块。`.trim();

export type OpenAi55MessageLayout = {
  intro: string;
  artifact: {
    title: string;
    body: string;
    explicit: boolean;
  } | null;
};

export function isOpenAi55AgentModel(provider: string | undefined, model: string | undefined): boolean {
  return (provider || '').trim().toLowerCase() === 'openai'
    && (model || '').trim().toLowerCase() === 'gpt-5-5';
}

function cleanTitle(value: string): string {
  return value
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\*\*(.+)\*\*:?$/, '$1')
    .replace(/[：:]$/, '')
    .trim()
    .slice(0, 48) || 'OpenAI 输出';
}

function inferArtifactTitle(body: string): string {
  const firstMeaningfulLine = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !/^[-*+]\s/.test(line));
  return cleanTitle(firstMeaningfulLine || 'OpenAI 输出');
}

function fallbackArtifactStart(lines: string[]): number {
  let seenParagraph = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    if (/^(?:#{1,6}\s+|\*\*[^*]+\*\*:?$)/.test(line) && seenParagraph) return index;
    if (!/^(?:[-*+]\s+|\d+[.)]\s+)/.test(line)) seenParagraph = true;
  }
  return -1;
}

export function parseOpenAi55MessageLayout(content: string): OpenAi55MessageLayout {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  const markerPattern = /<<<MAGINE_ARTIFACT(?:\s+title=(?:"([^"]*)"|'([^']*)'))?\s*>>>/i;
  const startMatch = markerPattern.exec(normalized);

  if (startMatch) {
    const bodyStart = startMatch.index + startMatch[0].length;
    const endIndex = normalized.indexOf(OPENAI55_ARTIFACT_END, bodyStart);
    const bodyEnd = endIndex >= 0 ? endIndex : normalized.length;
    const body = normalized.slice(bodyStart, bodyEnd).trim();
    return {
      intro: normalized.slice(0, startMatch.index).trim(),
      artifact: {
        title: cleanTitle(startMatch[1] || startMatch[2] || inferArtifactTitle(body)),
        body,
        explicit: true,
      },
    };
  }

  const isLongStructuredReply = normalized.length >= 320
    && /(?:^|\n)(?:#{1,6}\s+|\*\*[^*]+\*\*:?\s*$|[-*+]\s+|\d+[.)]\s+)/m.test(normalized);
  if (!isLongStructuredReply) return { intro: normalized, artifact: null };

  const lines = normalized.split('\n');
  const artifactStart = fallbackArtifactStart(lines);
  const intro = artifactStart > 0 ? lines.slice(0, artifactStart).join('\n').trim() : '';
  const body = artifactStart > 0 ? lines.slice(artifactStart).join('\n').trim() : normalized;
  return {
    intro,
    artifact: {
      title: inferArtifactTitle(body),
      body,
      explicit: false,
    },
  };
}

export function replaceOpenAi55ArtifactBody(content: string, nextBody: string): string {
  const layout = parseOpenAi55MessageLayout(content);
  if (!layout.artifact) return nextBody.trim();
  const title = layout.artifact.title.replace(/"/g, '');
  return [
    layout.intro,
    `<<<MAGINE_ARTIFACT title="${title}">>>`,
    nextBody.trim(),
    OPENAI55_ARTIFACT_END,
  ].filter(Boolean).join('\n\n');
}
