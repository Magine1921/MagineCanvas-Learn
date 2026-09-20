"use client"

import * as React from "react"
import { Select as SelectPrimitive } from "@base-ui/react/select"
import { cn } from "@/lib/utils"
import { CheckIcon, ChevronDownIcon } from "lucide-react"

// ── Select (Root) — Base UI 自定义列表，弹出层可做磨砂玻璃 ─────────────

export interface SelectProps {
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string | null) => void;
  className?: string;
  /** 追加到弹出层（如更长列表 max-height） */
  popupClassName?: string;
  disabled?: boolean;
  children?: React.ReactNode;
}

const triggerBaseClass =
  "nodrag nopan nowheel glass-input-surface flex w-full min-w-0 items-center justify-between gap-2 rounded-md border py-1.5 pl-2.5 pr-2 text-left text-sm text-slate-100 outline-none " +
  "focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50 " +
  "data-[popup-open]:border-white/22"

const selectPopupDefaultClass = cn(
  "nodrag nopan nowheel origin-[var(--transform-origin)] outline-none",
  "max-h-[min(280px,var(--available-height))] min-w-[var(--anchor-width)] overflow-y-auto rounded-lg border border-white/14 py-1 shadow-[0_24px_64px_rgba(0,0,0,0.42)]",
  "bg-[#080c10]/78 backdrop-blur-xl backdrop-saturate-[1.18] supports-[backdrop-filter]:bg-[#080c10]/62",
  "data-[starting-style]:scale-[0.985] data-[starting-style]:opacity-0",
  "data-[ending-style]:scale-[0.985] data-[ending-style]:opacity-0"
)

const itemClassName = cn(
  "nodrag nopan nowheel grid cursor-pointer grid-cols-[1rem_1fr] items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-100 outline-none select-none",
  "data-[highlighted]:bg-white/[0.08] data-[highlighted]:text-white",
  "data-[disabled]:pointer-events-none data-[disabled]:opacity-35"
)

function Select({
  defaultValue,
  value,
  onValueChange,
  className,
  popupClassName,
  disabled,
  children,
}: SelectProps) {
  const isControlled = value !== undefined

  return (
    <SelectPrimitive.Root
      {...(isControlled
        ? {
            value: value ?? null,
            onValueChange: (v: string | null) => onValueChange?.(v),
          }
        : {
            defaultValue: defaultValue ?? null,
            onValueChange: (v: string | null) => onValueChange?.(v),
          })}
      disabled={disabled}
      modal={false}
    >
      <div className="nodrag nopan nowheel relative inline-block w-full">
        <SelectPrimitive.Trigger className={cn(triggerBaseClass, className)}>
          <SelectPrimitive.Value
            placeholder="选择…"
            className="min-w-0 flex-1 truncate text-left"
          />
          <SelectPrimitive.Icon className="pointer-events-none shrink-0 text-muted-foreground">
            <ChevronDownIcon className="size-3.5 opacity-90" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>

        <SelectPrimitive.Portal>
          <SelectPrimitive.Positioner
            className="nodrag nopan nowheel z-[10080] outline-none"
            alignItemWithTrigger={false}
            sideOffset={6}
            align="start"
            collisionPadding={8}
            positionMethod="fixed"
            collisionBoundary={typeof document !== 'undefined' ? document.documentElement : undefined}
          >
            <SelectPrimitive.Popup className={cn(selectPopupDefaultClass, popupClassName)}>
              <SelectPrimitive.List className="outline-none">{children}</SelectPrimitive.List>
            </SelectPrimitive.Popup>
          </SelectPrimitive.Positioner>
        </SelectPrimitive.Portal>
      </div>
    </SelectPrimitive.Root>
  )
}

// ── SelectItem ───────────────────────────────────────────────────

export interface SelectItemProps {
  value: string;
  disabled?: boolean;
  children?: React.ReactNode;
}

function SelectItem({ value, disabled, children }: SelectItemProps) {
  return (
    <SelectPrimitive.Item value={value} disabled={disabled} className={itemClassName}>
      <span className="flex size-4 shrink-0 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-3 text-cyan-400/95" strokeWidth={2.5} />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText className="min-w-0 truncate">{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

// ── SelectGroup / SelectLabel / SelectSeparator ─────────────────

function SelectGroup({ label, children }: { label?: string; children?: React.ReactNode }) {
  return (
    <SelectPrimitive.Group className="py-0.5">
      {label ? (
        <SelectPrimitive.GroupLabel className="px-2.5 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
          {label}
        </SelectPrimitive.GroupLabel>
      ) : null}
      {children}
    </SelectPrimitive.Group>
  )
}

function SelectLabel({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("nodrag nopan nowheel px-2.5 py-1 text-xs text-zinc-500", className)}>
      {children}
    </div>
  );
}

function SelectSeparator({ className }: { className?: string }) {
  return (
    <SelectPrimitive.Separator
      className={cn("my-1 h-px border-0 bg-gradient-to-r from-transparent via-white/12 to-transparent", className)}
    />
  )
}

export {
  Select,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
};
