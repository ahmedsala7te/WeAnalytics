import { PRODUCT_NAME, PRODUCT_TAGLINE } from "@/lib/brand";

type BrandLockupProps = {
  size?: "compact" | "standard";
  tagline?: string;
  className?: string;
};

export function BrandLockup({ size = "standard", tagline = PRODUCT_TAGLINE, className = "" }: BrandLockupProps) {
  const compact = size === "compact";
  return (
    <div className={`flex items-center ${compact ? "gap-2.5" : "gap-3"} ${className}`} aria-label={`${PRODUCT_NAME} — ${PRODUCT_TAGLINE}`}>
      <img
        src="/we-autonomous-oss-logo.png"
        alt=""
        className={`${compact ? "h-9 w-9" : "h-12 w-12"} shrink-0 rounded-full object-cover shadow-[0_0_22px_rgba(124,58,237,0.24)]`}
      />
      <div className="min-w-0">
        <div className={`${compact ? "text-[13px]" : "text-lg"} whitespace-nowrap font-extrabold tracking-[-0.035em] text-primary`}>
          <span className="text-violet-400">WE</span> Autonomous
          <span className={`${compact ? "ml-1 text-[7px]" : "ml-1.5 text-[9px]"} align-top font-black tracking-[0.08em] text-cyan-400`}>OSS</span>
        </div>
        <div className={`${compact ? "text-[8px] tracking-[0.12em]" : "text-[9px] tracking-[0.16em]"} -mt-0.5 truncate font-bold uppercase text-muted`}>
          {tagline}
        </div>
      </div>
    </div>
  );
}
