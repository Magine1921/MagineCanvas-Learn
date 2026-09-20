export const IS_LEARNING_EDITION =
  process.env.NEXT_PUBLIC_MAGINE_LEARNING_EDITION === '1';
export const IS_CLEAN_EDITION =
  process.env.NEXT_PUBLIC_MAGINE_CLEAN_EDITION === '1';

const LEARNING_NODE_TYPES = new Set([
  'prompt',
  'image',
  'video',
  'agent',
  'material',
  'region',
  'storyboard',
  'panorama',
  'topazEnhance',
  'music',
  'faceCompliance',
  'browser',
]);
const CLEAN_DISABLED_NODE_TYPES = new Set(['browser']);

export function isEditionNodeTypeDisabled(type: unknown): boolean {
  if (typeof type !== 'string') return false;
  if (IS_CLEAN_EDITION) return CLEAN_DISABLED_NODE_TYPES.has(type);
  return IS_LEARNING_EDITION && !LEARNING_NODE_TYPES.has(type);
}
