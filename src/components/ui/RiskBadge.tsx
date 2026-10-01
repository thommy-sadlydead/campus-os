import { RISK_LABEL, type RiskLevel } from "@/lib/risk-engine";

/** Background and text color for each status, shared by the badge and the dashboard card. */
export const RISK_TONE: Record<RiskLevel, string> = {
  "on-track": "bg-ok-soft text-ok",
  "getting-behind": "bg-warn-soft text-warn",
  "at-risk": "bg-danger-soft text-danger",
};

export function RiskBadge({ level }: { level: RiskLevel }) {
  return (
    <span className={`badge ${RISK_TONE[level]}`}>
      <span aria-hidden className="dot bg-current" />
      {RISK_LABEL[level]}
    </span>
  );
}
