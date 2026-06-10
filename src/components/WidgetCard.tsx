import type { ReactNode } from "react";
import { motion } from "framer-motion";

interface WidgetCardProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  delay?: number;
}

export function WidgetCard({ title, subtitle, actions, children, className = "", delay = 0 }: WidgetCardProps) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] }}
      className={`panel flex flex-col overflow-hidden ${className}`}
    >
      <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-2">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold tracking-wide text-primary truncate">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[11px] text-muted truncate">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </header>
      <div className="min-h-0 flex-1 px-3 pb-3">{children}</div>
    </motion.section>
  );
}
