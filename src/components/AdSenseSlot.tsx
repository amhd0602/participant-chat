'use client';

import { useEffect, useRef } from 'react';

type AdSenseSlotProps = {
  slotId?: string;
  className?: string;
};

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

export function AdSenseSlot({ slotId, className = '' }: AdSenseSlotProps) {
  const pushedRef = useRef(false);
  const clientId = process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID;
  const resolvedSlotId = slotId || process.env.NEXT_PUBLIC_ADSENSE_SLOT_ID;

  useEffect(() => {
    if (!clientId || !resolvedSlotId || pushedRef.current) return;
    try {
      window.adsbygoogle = window.adsbygoogle || [];
      window.adsbygoogle.push({});
      pushedRef.current = true;
    } catch {
      // 審査前やスクリプト未読み込み時は静かにスキップ
    }
  }, [clientId, resolvedSlotId]);

  if (!clientId || !resolvedSlotId) {
    return (
      <div
        aria-label="広告枠プレースホルダー"
        className={`mt-2.5 flex min-h-[44px] w-full shrink-0 items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50/80 px-3 py-1.5 text-[11px] text-gray-400 dark:border-neutral-800 dark:bg-neutral-900/50 dark:text-neutral-500 ${className}`}
      >
        Ad
      </div>
    );
  }

  return (
    <div className={`mt-2.5 w-full shrink-0 overflow-hidden ${className}`}>
      <ins
        className="adsbygoogle block"
        style={{ display: 'block' }}
        data-ad-client={clientId}
        data-ad-slot={resolvedSlotId}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  );
}
