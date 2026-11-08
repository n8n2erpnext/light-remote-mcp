import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

export function Card({ className, children, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={cn('lr-card', className)} {...props}>{children}</section>;
}
export function CardHeading({ children, description, className }: {
  children: ReactNode;
  description?: string;
  className?: string;
}) {
  return <header className={cn('lr-card-heading', className)}>
    <h2>{children}</h2>
    {description ? <p>{description}</p> : null}
  </header>;
}
