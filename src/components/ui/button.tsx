import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:pointer-events-none disabled:opacity-50 cursor-pointer select-none active:translate-y-px",
  {
    variants: {
      variant: {
        // signature: warm paper button, not generic blue
        default: "bg-paper text-ink-0 shadow-none hover:bg-white",
        primary: "bg-signal text-signal-ink hover:brightness-110",
        destructive:
          "border border-clay/50 bg-transparent text-clay hover:bg-clay/10",
        outline:
          "border border-line-strong bg-transparent text-paper-dim hover:text-paper hover:border-fog",
        secondary: "bg-ink-2 text-paper-dim border border-line hover:text-paper hover:border-line-strong",
        ghost: "text-fog hover:text-paper hover:bg-ink-2",
        link: "text-signal underline-offset-4 hover:underline px-0",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-[13px]",
        lg: "h-10 rounded-md px-6",
        icon: "h-9 w-9 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
