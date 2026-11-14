'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/** Dismisses transient notifications 10 seconds after the message changes.
 * Error and success notices may be manually dismissed immediately.
 * Long-running progress indicators remain separate and are not auto-dismissed.
 */
export default function AutoDismissNotice({ message, onClose }: { message: string; onClose: () => void }) {
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => closeRef.current(), 10_000);
    return () => window.clearTimeout(timeout);
  }, [message]);
  if (!message) return null;
  return <div className="notice floating-top-notice" role="status" aria-live="polite">
    <span>{message}</span>
    <button type="button" aria-label="Close notification" title="Close" onClick={onClose}>
      <X size={17} />
    </button>
  </div>;
}
