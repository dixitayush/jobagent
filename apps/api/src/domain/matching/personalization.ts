import { skillKey } from "../skills/taxonomy";

/**
 * PRD §31–32. Learns skill affinity from *aggregated* behaviour only. A single click never
 * changes ranking: signals must reach MIN_SIGNALS before any boost applies, and the boost
 * is bounded to ±3 score points.
 */
export const MIN_SIGNALS = 10;

const SIGNAL_WEIGHTS: Record<string, number> = {
  JOB_SAVED: 1,
  JOB_APPLIED: 2,
  FEEDBACK_GOOD: 1.5,
  JOB_CLICKED: 0.3,
  JOB_DISMISSED: -1,
  FEEDBACK_BAD: -1.5,
};

export interface InteractionSignal {
  type: string;
  skills: string[];
}

export interface SkillAffinity {
  signals: number;
  weights: Map<string, number>;
}

export function computeSkillAffinity(interactions: InteractionSignal[]): SkillAffinity {
  const weights = new Map<string, number>();
  let signals = 0;
  for (const i of interactions) {
    const w = SIGNAL_WEIGHTS[i.type];
    if (!w || !i.skills.length) continue;
    signals++;
    for (const s of i.skills) weights.set(skillKey(s), (weights.get(skillKey(s)) ?? 0) + w);
  }
  // Normalize by signal count so heavy users don't get outsized boosts.
  if (signals) for (const [k, v] of weights) weights.set(k, v / signals);
  return { signals, weights };
}

export function personalizationBoost(jobSkills: string[], affinity: SkillAffinity): number {
  if (affinity.signals < MIN_SIGNALS || !jobSkills.length) return 0;
  let sum = 0;
  for (const s of jobSkills) sum += affinity.weights.get(skillKey(s)) ?? 0;
  // Each fully-aligned skill contributes up to +1; clamp to ±3.
  return Math.max(-3, Math.min(3, sum * 1.5));
}
