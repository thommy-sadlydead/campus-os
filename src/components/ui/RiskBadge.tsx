import { RISK_LABEL, type RiskLevel } from "@/lib/risk-engine";

/** Each status as a pill: on track is black, getting behind outlined, at risk the red accent. */
export const RISK_TONE: Record<RiskLevel, string> = {
  "on-track": "bg-ink text-surface",
  "getting-behind": "border border-ink text-ink",
  "at-risk": "bg-accent text-white",
};

export function RiskBadge({ level }: { level: RiskLevel }) {
  return <span className={`badge ${RISK_TONE[level]}`}>{RISK_LABEL[level]}</span>;
}
