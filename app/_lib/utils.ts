

/**
 * Merge class names conditionally (lightweight clsx alternative)
 */
export function cn(...inputs: (string | undefined | null | false)[]): string {
  return inputs.filter(Boolean).join(" ");
}

/**
 * Format a date for display
 */
export function formatDate(date: Date | string): string {
  const d = new Date(date);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Format relative time (e.g. "2 minutes ago")
 */
export function timeAgo(date: Date | string): string {
  const now = new Date();
  const d = new Date(date);
  const seconds = Math.floor((now.getTime() - d.getTime()) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Campaign status display config
 */
export const campaignStatusConfig: Record<
  string,
  { label: string; emoji: string; color: string; bgColor: string }
> = {
  SCHEDULED: {
    label: "Scheduled",
    emoji: "⏳",
    color: "var(--color-status-scheduled)",
    bgColor: "var(--color-status-scheduled-bg)",
  },
  POLLING: {
    label: "Polling",
    emoji: "🔄",
    color: "var(--color-status-polling)",
    bgColor: "var(--color-status-polling-bg)",
  },
  SUCCESS: {
    label: "Success",
    emoji: "✅",
    color: "var(--color-status-success)",
    bgColor: "var(--color-status-success-bg)",
  },
  FAILED: {
    label: "Failed",
    emoji: "❌",
    color: "var(--color-status-failed)",
    bgColor: "var(--color-status-failed-bg)",
  },
  EXPIRED: {
    label: "Expired",
    emoji: "⏰",
    color: "var(--color-status-expired)",
    bgColor: "var(--color-status-expired-bg)",
  },
  CANCELLED: {
    label: "Cancelled",
    emoji: "🚫",
    color: "var(--color-status-cancelled)",
    bgColor: "var(--color-status-cancelled-bg)",
  },
};

/**
 * User status display config
 */
export const userStatusConfig: Record<
  string,
  { label: string; color: string; bgColor: string }
> = {
  PENDING: {
    label: "Pending",
    color: "var(--color-warning)",
    bgColor: "var(--color-warning-bg)",
  },
  APPROVED: {
    label: "Approved",
    color: "var(--color-success)",
    bgColor: "var(--color-success-bg)",
  },
  REJECTED: {
    label: "Rejected",
    color: "var(--color-danger)",
    bgColor: "var(--color-danger-bg)",
  },
};
