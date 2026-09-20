const TEXT_INPUT_TYPES = new Set([
  '',
  'text',
  'search',
  'email',
  'url',
  'tel',
  'password',
  'number',
]);

export function isNativeTextUndoTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const editable = target.closest('textarea, input, [contenteditable]');
  if (!editable) return false;

  if (editable.tagName === 'TEXTAREA') {
    return !editable.hasAttribute('readonly') && !editable.hasAttribute('disabled');
  }
  if (editable.tagName === 'INPUT') {
    if (editable.hasAttribute('readonly') || editable.hasAttribute('disabled')) return false;
    return TEXT_INPUT_TYPES.has((editable.getAttribute('type') || '').toLowerCase());
  }
  return editable.getAttribute('contenteditable') !== 'false';
}
