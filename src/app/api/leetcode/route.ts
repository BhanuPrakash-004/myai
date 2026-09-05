import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { writeKnowledge } from "@/lib/vault";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const pattern = searchParams.get("pattern");
    const db = getDb();

    let query = "SELECT * FROM leetcode_problems";
    const params: any[] = [];

    if (pattern) {
      query += " WHERE pattern LIKE ?";
      params.push(`%${pattern}%`);
    }

    query += " ORDER BY updated_at DESC";
    const problems = db.prepare(query).all(...params);

    // Also get all unique patterns for filtering
    const patterns = db
      .prepare("SELECT DISTINCT pattern FROM leetcode_problems ORDER BY pattern ASC")
      .all() as { pattern: string }[];

    return NextResponse.json({
      problems,
      patterns: patterns.map((p) => p.pattern),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      problemName,
      problemNumber,
      pattern,
      difficulty = "Medium",
      approach,
      keyInsight,
      code,
      mistakes,
    } = body;

    if (!problemName || !pattern) {
      return NextResponse.json({ error: "problemName and pattern are required" }, { status: 400 });
    }

    const cleanName = problemName.trim().replace(/[<>:"/\\|?*]/g, "");
    const filePath = `LeetCode/${cleanName.replace(/\s+/g, "-")}.md`;
    const now = new Date().toISOString();

    const markdown = `# ${problemNumber ? `${problemNumber}. ` : ""}${problemName}

## Pattern
- **Category**: ${pattern}
- **Difficulty**: ${difficulty}

## Approach
${approach || "Standard optimal approach"}

## Key Insight
${keyInsight || "Key algorithmic turning point"}

## Algorithm & Complexity
- Time Complexity: O(N)
- Space Complexity: O(1)

## Code
\`\`\`java
${code || "// Solution code snippet"}
\`\`\`

## Common Mistakes
${mistakes || "- Watch out for boundary edge conditions."}

## Personal Notes
Added via LeetCode manager.

## Related Problems
- Similar problems under ${pattern}
`;

    writeKnowledge(filePath, markdown);

    const db = getDb();
    const id = `lc_${Date.now()}`;

    db.prepare(`
      INSERT INTO leetcode_problems (
        id, problem_name, problem_number, pattern, difficulty, file_path, times_reviewed, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET
        pattern = excluded.pattern,
        difficulty = excluded.difficulty,
        updated_at = excluded.updated_at
    `).run(id, problemName, problemNumber || null, pattern, difficulty, filePath, now, now);

    // Also register in memories table
    db.prepare(`
      INSERT INTO memories (
        id, title, file_path, topic, subcategory, knowledge_type, importance, content_preview, query_count, quiz_correct_count, quiz_incorrect_count, forgetting_score, created_at, updated_at
      ) VALUES (?, ?, ?, 'LeetCode', ?, 'leetcode_approach', 4, ?, 0, 0, 0, 3.2, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET
        content_preview = excluded.content_preview,
        updated_at = excluded.updated_at
    `).run(
      `mem_${id}`,
      problemName,
      filePath,
      pattern,
      (approach || keyInsight || problemName).slice(0, 200),
      now,
      now
    );

    return NextResponse.json({ success: true, filePath });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
