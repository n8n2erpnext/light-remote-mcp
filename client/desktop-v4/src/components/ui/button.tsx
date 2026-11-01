import React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

const buttonVariants = cva('lr-button', {
  variants: {
    variant: {
      primary: 'lr-button-primary',
      secondary: 'lr-button-secondary',
      ghost: 'lr-button-ghost'
    },
    size: { default: 'lr-button-default', icon: 'lr-button-icon' }
  },
  defaultVariants: { variant: 'secondary', size: 'default' }
});

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({
  asChild = false, variant, size, className, type = 'button', ...props
}: ButtonProps) {
  const Component = asChild ? Slot : 'button';
  return <Component type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
