import { z } from "zod";

export const cardKind = z.enum(["mcq", "recall", "short_answer", "explanation", "code_completion", "debugging", "predict_output"]);
export const practiceMode = z.enum(["due", "folder", "weak", "random", "interview", "exam"]);
export const draftSchema = z.object({
  supported: z.boolean(), prompt: z.string().min(8).max(3000), answer: z.string().min(1).max(4000),
  options: z.array(z.string().min(1).max(2000)).max(6), quote: z.string().min(1).max(2400),
  explanation: z.string().min(1).max(3000), criteria: z.array(z.string().min(1).max(500)).min(1).max(8),
});
export const supportSchema = z.object({ supported: z.boolean(), atomic: z.boolean(), unambiguous: z.boolean() });
export const gradeSchema = z.object({
  verdict: z.enum(["correct", "partial", "incorrect", "uncertain"]),
  feedback: z.string().min(1).max(3000), criteriaMet: z.array(z.boolean()).max(8),
});
export const studyAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("generate"), folderId: z.guid(), noteId: z.uuid().optional(), query: z.string().max(2000).default(""), kind: cardKind, count: z.number().int().min(1).max(10).default(5), regenerateId: z.uuid().optional() }).strict(),
  z.object({ action: z.literal("start"), folderId: z.guid(), mode: practiceMode, count: z.number().int().min(1).max(30).default(10) }).strict(),
  z.object({ action: z.literal("reveal"), sessionId: z.uuid(), questionId: z.uuid() }).strict(),
  z.object({ action: z.literal("answer"), sessionId: z.uuid(), questionId: z.uuid(), answer: z.string().max(12000).default(""), rating: z.number().int().min(0).max(3).optional() }).strict(),
  z.object({ action: z.literal("correct"), sessionId: z.uuid(), questionId: z.uuid(), revision: z.number().int().positive(), rating: z.number().int().min(0).max(3), reason: z.string().trim().min(3).max(1000) }).strict(),
]);
export type StudyAction = z.infer<typeof studyAction>;
export interface ScheduleState { reviews: number; lapses: number; streak: number; intervalDays: number; lastRating: number }
export const ALGORITHM = "myai-calendar-v1";
// Conservative, transparent calendar scheduling. Not FSRS or a retention prediction.
export function schedule(previous: Partial<ScheduleState>, rating: number): ScheduleState {
  z.number().int().min(0).max(3).parse(rating);
  const reviews = previous.reviews ?? 0, interval = previous.intervalDays ?? 0, streak = previous.streak ?? 0;
  const days = rating === 0 ? 0 : rating === 1 ? Math.max(1, Math.floor(interval / 2))
    : rating === 3 ? Math.max(3, Math.round(interval * 3)) : streak === 0 ? 1 : streak === 1 ? 6 : Math.max(1, Math.round(interval * 2));
  return { reviews: reviews + 1, lapses: (previous.lapses ?? 0) + Number(rating === 0), streak: rating === 0 ? 0 : streak + 1, intervalDays: Math.min(365, days), lastRating: rating };
}
