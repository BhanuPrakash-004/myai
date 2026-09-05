import { getDb } from "../db";
import { readKnowledge } from "../vault";
import { getAIProvider } from "../ai";
import { recordInteraction } from "../memory/tracker";

export interface QuizQuestion {
  id: string;
  memoryId?: string;
  type: "mcq" | "short_answer" | "debugging" | "code_completion";
  topic: string;
  question: string;
  codeSnippet?: string;
  options?: string[]; // for MCQ
  correctAnswer: string;
  explanation: string;
}

export async function generateQuiz(topic?: string, count = 5): Promise<{ sessionId: string; questions: QuizQuestion[] }> {
  const db = getDb();
  let query = "SELECT * FROM memories";
  const params: any[] = [];

  if (topic && topic !== "All") {
    query += " WHERE topic LIKE ? OR subcategory LIKE ?";
    params.push(`%${topic}%`, `%${topic}%`);
  }

  query += " ORDER BY (forgetting_score * 1.5 + importance) DESC, RANDOM() LIMIT ?";
  params.push(count);

  const memories = db.prepare(query).all(...params) as any[];

  if (memories.length === 0) {
    // If vault is completely empty, generate standard starter questions
    return generateStarterQuiz(topic);
  }

  const ai = await getAIProvider();
  const questions: QuizQuestion[] = [];

  for (const mem of memories) {
    let noteContent = mem.content_preview || "";
    try {
      noteContent = readKnowledge(mem.file_path);
    } catch {
      // ignore
    }

    try {
      const prompt = `Based strictly on this personal developer knowledge note:
Title: ${mem.title}
Topic: ${mem.topic} / ${mem.subcategory}
Content:
${noteContent.slice(0, 1000)}

Generate 1 quiz question to test the user's recall of small critical details, mistakes, or syntax.
Return JSON matching:
{
  "type": "mcq",
  "question": "Question text",
  "options": ["Option A", "Option B", "Option C", "Option D"],
  "correctAnswer": "Option A",
  "explanation": "Why this is correct"
}`;

      const q = await ai.chatStructured<any>(
        [{ role: "user", content: prompt }],
        "JSON with type, question, options, correctAnswer, explanation"
      );

      if (q && q.question && q.correctAnswer) {
        questions.push({
          id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
          memoryId: mem.id,
          type: q.type || "mcq",
          topic: mem.topic,
          question: q.question,
          options: q.options || ["True", "False"],
          correctAnswer: q.correctAnswer,
          explanation: q.explanation || "Review your note in " + mem.file_path,
        });
      }
    } catch {
      // fallback question from note
      questions.push({
        id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        memoryId: mem.id,
        type: "mcq",
        topic: mem.topic,
        question: `In ${mem.title} (${mem.subcategory}), which key detail or common mistake is highlighted?`,
        options: [
          mem.content_preview?.slice(0, 70) || "Correct pattern",
          "Always recalculate size inside dynamic loops",
          "Synchronize without thread safety considerations",
          "Ignore boundary edge cases",
        ],
        correctAnswer: mem.content_preview?.slice(0, 70) || "Correct pattern",
        explanation: `Reflected from your notes in ${mem.file_path}`,
      });
    }
  }

  const sessionId = `quiz_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  db.prepare(`
    INSERT INTO quiz_sessions (id, topic, total_questions, score, details, created_at)
    VALUES (?, ?, ?, 0, ?, ?)
  `).run(sessionId, topic || "General", questions.length, JSON.stringify(questions), new Date().toISOString());

  return { sessionId, questions };
}

function generateStarterQuiz(topic?: string): { sessionId: string; questions: QuizQuestion[] } {
  const db = getDb();
  const sessionId = `quiz_${Date.now()}`;
  const questions: QuizQuestion[] = [
    {
      id: "q_start_1",
      type: "mcq",
      topic: "DSA",
      question: "In Breadth-First Search (BFS) level-order traversal, why must you capture q.size() before the loop?",
      options: [
        "Because queue size changes dynamically as neighbors are added",
        "It improves memory allocation in the JVM",
        "It prevents StackOverflowError",
        "Queue interface doesn't allow size() inside loops",
      ],
      correctAnswer: "Because queue size changes dynamically as neighbors are added",
      explanation: "If you call q.size() dynamically in the for loop header, you process newly added level nodes in the current level.",
    },
    {
      id: "q_start_2",
      type: "mcq",
      topic: "Java",
      question: "How do you correctly iterate over both keys and values of a Java Map?",
      options: [
        "for (Map.Entry<K,V> entry : map.entrySet())",
        "for (Entry e : map.entries())",
        "for (Pair p : map.items())",
        "for (Key k : map.keysWithValues())",
      ],
      correctAnswer: "for (Map.Entry<K,V> entry : map.entrySet())",
      explanation: "map.entrySet() returns a Set view of the mappings contained in this map.",
    },
  ];

  db.prepare(`
    INSERT INTO quiz_sessions (id, topic, total_questions, score, details, created_at)
    VALUES (?, ?, ?, 0, ?, ?)
  `).run(sessionId, topic || "Starter", questions.length, JSON.stringify(questions), new Date().toISOString());

  return { sessionId, questions };
}

export async function evaluateQuizAnswer(
  sessionId: string,
  question: QuizQuestion,
  userAnswer: string
): Promise<{ isCorrect: boolean; explanation: string }> {
  const db = getDb();
  const isCorrect =
    userAnswer.trim().toLowerCase() === question.correctAnswer.trim().toLowerCase() ||
    userAnswer.trim().toLowerCase().includes(question.correctAnswer.trim().toLowerCase());

  // Update memory interaction if memory linked
  if (question.memoryId) {
    recordInteraction(
      question.memoryId,
      isCorrect ? "quizzed_correct" : "quizzed_incorrect",
      `Quiz answer: ${userAnswer}`
    );
  }

  // Update session score
  if (isCorrect) {
    db.prepare("UPDATE quiz_sessions SET score = score + 1 WHERE id = ?").run(sessionId);
  }

  return {
    isCorrect,
    explanation: question.explanation || (isCorrect ? "Correct!" : `The right answer is: ${question.correctAnswer}`),
  };
}
