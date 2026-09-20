export type AgentUploadKind = 'image' | 'audio' | 'video' | 'file';

export interface AgentUploadDescriptor {
  name: string;
  kind: AgentUploadKind;
  mimeType?: string;
}

export type AgentAttachmentVisualTone =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'document'
  | 'sheet'
  | 'slides'
  | 'archive'
  | 'code'
  | 'text'
  | 'file';

export interface AgentAttachmentVisual {
  label: string;
  tone: AgentAttachmentVisualTone;
}

const READABLE_TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'csv',
  'tsv',
  'json',
  'yaml',
  'yml',
  'xml',
  'html',
  'htm',
  'log',
  'srt',
  'vtt',
  'js',
  'jsx',
  'ts',
  'tsx',
  'css',
  'py',
]);

function attachmentExtension(name: string): string {
  return name.trim().toLowerCase().match(/\.([^.]+)$/)?.[1] || '';
}

export function resolveAgentAttachmentVisual(
  name: string,
  kind: AgentUploadKind,
  mimeType = '',
): AgentAttachmentVisual {
  const extension = attachmentExtension(name);
  const normalizedMime = mimeType.trim().toLowerCase();
  if (kind === 'image') return { label: 'IMG', tone: 'image' };
  if (kind === 'video') return { label: 'VID', tone: 'video' };
  if (kind === 'audio') {
    return { label: extension ? extension.slice(0, 4).toUpperCase() : 'AUD', tone: 'audio' };
  }
  if (extension === 'pdf' || normalizedMime === 'application/pdf') {
    return { label: 'PDF', tone: 'pdf' };
  }
  if (['doc', 'docx', 'rtf', 'odt'].includes(extension) || normalizedMime.includes('word')) {
    return { label: 'DOC', tone: 'document' };
  }
  if (['xls', 'xlsx', 'ods', 'csv', 'tsv'].includes(extension) || normalizedMime.includes('sheet')) {
    return { label: extension === 'csv' ? 'CSV' : 'XLS', tone: 'sheet' };
  }
  if (['ppt', 'pptx', 'odp', 'key'].includes(extension) || normalizedMime.includes('presentation')) {
    return { label: 'PPT', tone: 'slides' };
  }
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(extension)) {
    return { label: extension.slice(0, 3).toUpperCase(), tone: 'archive' };
  }
  if (['json', 'yaml', 'yml', 'xml', 'html', 'htm', 'js', 'jsx', 'ts', 'tsx', 'css', 'py'].includes(extension)) {
    return { label: extension.slice(0, 4).toUpperCase(), tone: 'code' };
  }
  if (READABLE_TEXT_EXTENSIONS.has(extension) || normalizedMime.startsWith('text/')) {
    return { label: extension ? extension.slice(0, 4).toUpperCase() : 'TXT', tone: 'text' };
  }
  return { label: extension ? extension.slice(0, 4).toUpperCase() : 'FILE', tone: 'file' };
}

export function isReadableAgentTextAttachment(name: string, mimeType = ''): boolean {
  const normalizedMime = mimeType.trim().toLowerCase();
  if (
    normalizedMime.startsWith('text/')
    || normalizedMime === 'application/json'
    || normalizedMime === 'application/ld+json'
    || normalizedMime === 'application/xml'
    || normalizedMime === 'application/x-yaml'
  ) {
    return true;
  }
  const extension = attachmentExtension(name);
  return READABLE_TEXT_EXTENSIONS.has(extension);
}

export function isSendableAgentDocumentAttachment(name: string, mimeType = ''): boolean {
  return Boolean(resolveSendableAgentDocumentMimeType(name, mimeType));
}

export function resolveSendableAgentDocumentMimeType(name: string, mimeType = ''): string {
  const extension = attachmentExtension(name);
  const normalizedMime = mimeType.trim().toLowerCase();
  if (extension === 'pdf' || normalizedMime === 'application/pdf') return 'application/pdf';
  if (
    extension === 'docx'
    || normalizedMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  return '';
}

function mediaKindLabel(kind: Exclude<AgentUploadKind, 'file'>): string {
  if (kind === 'image') return '图片';
  if (kind === 'video') return '视频';
  return '音频';
}

function attachmentNames(items: AgentUploadDescriptor[]): string {
  return items.map((item) => `“${item.name}”`).join('、');
}

export function buildUnsupportedAgentAttachmentReply(args: {
  provider: string;
  model: string;
  attachments: AgentUploadDescriptor[];
}): string {
  const modelLabel = args.model.trim() || args.provider.trim() || '当前模型';
  const unsupportedMedia = args.provider === 'gemini'
    ? []
    : args.attachments.filter(
        (item): item is AgentUploadDescriptor & { kind: Exclude<AgentUploadKind, 'file'> } =>
          item.kind !== 'file',
      );
  const unsupportedDocuments = args.attachments.filter(
    (item) => {
      if (item.kind !== 'file' || isReadableAgentTextAttachment(item.name, item.mimeType)) return false;
      const mimeType = resolveSendableAgentDocumentMimeType(item.name, item.mimeType);
      if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return false;
      return !(args.provider === 'gemini' && mimeType === 'application/pdf');
    },
  );
  const replies: string[] = [];

  if (unsupportedMedia.length > 0) {
    const typeLabels = Array.from(new Set(unsupportedMedia.map((item) => mediaKindLabel(item.kind))));
    replies.push(
      `当前模型“${modelLabel}”不支持${typeLabels.join('、')}理解，无法分析附件：${attachmentNames(unsupportedMedia)}。`
      + '请切换到具备对应能力的 Gemini 多模态模型，或移除这些附件后重试。',
    );
  }

  if (unsupportedDocuments.length > 0) {
    replies.push(
      `当前模型“${modelLabel}”暂不支持直接分析这些文档：${attachmentNames(unsupportedDocuments)}。`
      + '请转换为 TXT、Markdown、CSV、JSON 等文本文件，或粘贴关键内容后重试。',
    );
  }

  return replies.join('\n\n');
}
