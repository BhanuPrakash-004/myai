import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-blue-600 text-white shadow hover:bg-blue-700",
        secondary: "border-transparent bg-zinc-800 text-zinc-300 hover:bg-zinc-700",
        destructive: "border-transparent bg-red-600/20 text-red-400 border border-red-500/30",
        outline: "text-zinc-300 border-zinc-700",
        success: "border-transparent bg-emerald-950 text-emerald-300 border border-emerald-800/50",
        warning: "border-transparent bg-amber-950 text-amber-300 border border-amber-800/50",
        purple: "border-transparent bg-purple-950 text-purple-300 border border-purple-800/50",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
