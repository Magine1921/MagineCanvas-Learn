'use client';

import { GEMINI_MODEL_OPTIONS } from '@/lib/llm-text-provider';
import { Select, SelectItem } from '@/components/ui/select';

const LABEL_BY_ID = Object.fromEntries(GEMINI_MODEL_OPTIONS.map((o) => [o.value, o.label]));

export interface GeminiModelSelectProps {
  modelIds: string[];
  value: string;
  onValueChange: (next: string) => void;
  className?: string;
  disabled?: boolean;
}

export function GeminiModelSelect({
  modelIds,
  value,
  onValueChange,
  className,
  disabled,
}: GeminiModelSelectProps) {
  const ids = modelIds.length ? modelIds : GEMINI_MODEL_OPTIONS.map((o) => o.value);
  const safeValue = value && ids.includes(value) ? value : ids[0] || 'gemini-2.5-flash';

  return (
    <Select
      value={safeValue}
      onValueChange={(v) => {
        if (v) onValueChange(v);
      }}
      className={className}
      disabled={disabled}
    >
      {ids.map((id) => (
        <SelectItem key={id} value={id}>
          {LABEL_BY_ID[id] || id}
        </SelectItem>
      ))}
    </Select>
  );
}
