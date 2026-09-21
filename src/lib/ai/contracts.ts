import { z } from "zod";
export const improvementSchema = z.object({
  title: z.string().min(1).max(200), body: z.string().min(1).max(1000000),
  changes: z.array(z.string().max(1000)).max(30), uncertainties: z.array(z.string().max(1000)).max(30),
}).strict();
export const graphExtractionSchema = z.object({
  concepts: z.array(z.object({ name: z.string().min(1).max(200), description: z.string().max(2000) }).strict()).max(100),
  relations: z.array(z.object({
    from: z.string().min(1).max(200), to: z.string().min(1).max(200),
    type: z.enum(["explains", "prerequisite_for", "related_to", "supports", "contradicts"]),
    quote: z.string().min(1).max(10000), startOffset: z.number().int().nonnegative(), endOffset: z.number().int().positive(),
  }).strict()).max(200),
}).strict();
export const quizQuestionSchema = z.object({
  type: z.literal("mcq"), question: z.string().min(1).max(2000),
  options: z.array(z.string().min(1).max(1000)).min(2).max(6),
  correctAnswer: z.string().min(1), explanation: z.string().max(4000),
}).strict().refine((q) => q.options.includes(q.correctAnswer) && new Set(q.options).size === q.options.length);
