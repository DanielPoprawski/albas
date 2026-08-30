"use client"

import * as React from "react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * A square 18px box with a 1px gray hairline, filling solid purple when
 * checked — the same mark the task rows, the category list and the habit week
 * all draw. The border is `line-strong` rather than `line`: at 18px an
 * unchecked box against a white card needs the extra contrast to read as a
 * control at all.
 */
function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer size-[18px] shrink-0 cursor-pointer border border-line-strong bg-surface",
        // No `outline-none`: this is the app's only checkbox, and stripping
        // the global focus-visible ring left it with no keyboard state at all.
        "text-white transition-colors duration-150",
        "hover:border-accent",
        "data-[state=checked]:border-accent data-[state=checked]:bg-accent",
        "data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent",
        "disabled:cursor-not-allowed",
        "aria-invalid:border-destructive",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none"
      >
        <Check size={12} strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
