import { z } from 'zod';
import type { Bullet, Entry } from '../model/schema.js';

export const JobSpecSchema = z.object({
  title: z.string(),
  // Empty when the posting does not say. Recruiter postings often withhold the
  // client's name, and most postings name no recruiter at all.
  company: z.string(),
  recruiter: z.string(),
  /** The occupation, broader than the title: "Registered Nurse", not "Night Charge Nurse II". */
  occupation: z.string(),
  seniority: z.string(),
  hardRequirements: z.array(z.string()),
  niceToHaves: z.array(z.string()),
  keywords: z.array(z.string()),
  domain: z.string(),
});
export type JobSpec = z.infer<typeof JobSpecSchema>;

export const CoverageEntrySchema = z.object({
  requirement: z.string(),
  evidenceIds: z.array(z.string()),
  gap: z.boolean(),
});
export type CoverageEntry = z.infer<typeof CoverageEntrySchema>;

/**
 * The model's output contract. `add` creates a new bullet, which is only
 * reachable when a user-supplied fact justifies it — see `facts.ts`.
 */
export const SuggestionSchema = z.object({
  targetId: z.string(),
  kind: z.enum(['rewrite', 'reorder', 'promote', 'demote', 'drop', 'add']),
  before: z.string(),
  after: z.string(),
  sourceIds: z.array(z.string()).min(1),
  rationale: z.string(),
  jdRef: z.string(),
  confidence: z.number().min(0).max(1),
});

/**
 * `origin` is deliberately outside the zod schema: it is ours to set, not the
 * model's to claim. A `user` suggestion is text you typed, so it bypasses the
 * fabrication check — you are the authority on your own history.
 */
export interface Suggestion extends z.infer<typeof SuggestionSchema> {
  origin?: 'model' | 'user';
}

export const VerifyResultSchema = z.object({
  targetId: z.string(),
  approved: z.boolean(),
  reason: z.string(),
});
export type VerifyResult = z.infer<typeof VerifyResultSchema>;

export type ReviewAction = 'accept' | 'edit' | 'reject' | 'skip';

export interface Decision {
  suggestion: Suggestion;
  action: ReviewAction;
  editedText?: string;
}

/**
 * Structural content you add during the run that no suggestion can express:
 * a whole new entry, or a bullet in a section that has no entries (Skills).
 * Both may name a section that does not exist yet, in which case it is created.
 */
export type Addition =
  | { kind: 'entry'; section: string; entry: Entry }
  | { kind: 'bullet'; section: string; bullet: Bullet };
