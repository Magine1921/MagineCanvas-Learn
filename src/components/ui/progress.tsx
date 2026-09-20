import type { ComponentProps } from "react"
import { Progress as ProgressPrimitive } from "@base-ui/react/progress"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { useSmoothedProgress } from "@/lib/use-smoothed-progress"

type ProgressRootProps = ComponentProps<typeof ProgressPrimitive.Root>

const progressVariants = cva(
  "relative w-full overflow-hidden rounded-full bg-white/[0.06]",
  {
    variants: {
      size: {
        default: "h-2",
        sm: "h-1.5",
        lg: "h-3",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

const progressIndicatorVariants = cva(
  "h-full w-full flex-1 transition-all",
  {
    variants: {
      variant: {
        default: "bg-primary shadow-[0_0_16px_rgba(255,255,255,0.2)]",
        success: "bg-zinc-100 shadow-[0_0_18px_rgba(255,255,255,0.32)]",
        warning: "bg-zinc-200/90 shadow-[0_0_14px_rgba(255,255,255,0.22)]",
        error: "bg-red-500 shadow-[0_0_14px_rgba(248,113,113,0.45)]",
        cyan: "bg-zinc-100/95 shadow-[0_0_18px_rgba(255,255,255,0.32)]",
        violet: "bg-zinc-100/95 shadow-[0_0_18px_rgba(255,255,255,0.32)]",
        amber: "bg-zinc-100/95 shadow-[0_0_18px_rgba(255,255,255,0.32)]",
        pink: "bg-zinc-100/95 shadow-[0_0_18px_rgba(255,255,255,0.28)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Progress({
  className,
  value = 0,
  size = "default",
  variant = "default",
  showValue = false,
  ...props
}: ProgressRootProps & VariantProps<typeof progressVariants> & VariantProps<typeof progressIndicatorVariants> & {
  showValue?: boolean
  variant?: "default" | "success" | "warning" | "error" | "cyan" | "violet" | "amber" | "pink"
}) {
  const smoothValue = useSmoothedProgress(value)

  return (
    <div className="flex flex-col gap-1 w-full">
      <ProgressPrimitive.Root
        data-slot="progress"
        className={cn(progressVariants({ size, className }))}
        value={smoothValue}
        {...props}
      >
        <ProgressPrimitive.Indicator
          className={cn(progressIndicatorVariants({ variant }))}
          style={{ transform: `translateX(-${100 - smoothValue}%)` }}
        />
      </ProgressPrimitive.Root>
      {showValue && (
        <div className="text-xs text-muted-foreground text-right">
          {Math.round(smoothValue)}%
        </div>
      )}
    </div>
  )
}

export { Progress }
