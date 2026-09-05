const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const vaultDir = path.resolve('vault');
const dataDir = path.resolve('data');

if (!fs.existsSync(vaultDir)) fs.mkdirSync(vaultDir, { recursive: true });
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'myai.db'));

// Ensure tables exist
db.exec(`
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    file_path TEXT NOT NULL UNIQUE,
    topic TEXT NOT NULL,
    subcategory TEXT NOT NULL,
    knowledge_type TEXT NOT NULL,
    importance INTEGER NOT NULL DEFAULT 3,
    content_preview TEXT,
    query_count INTEGER NOT NULL DEFAULT 0,
    quiz_correct_count INTEGER NOT NULL DEFAULT 0,
    quiz_incorrect_count INTEGER NOT NULL DEFAULT 0,
    forgetting_score REAL NOT NULL DEFAULT 0.0,
    last_accessed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    title, content, topic, subcategory, file_path, tokenize='porter unicode61'
  );

  CREATE TABLE IF NOT EXISTS leetcode_problems (
    id TEXT PRIMARY KEY,
    problem_name TEXT NOT NULL,
    problem_number INTEGER,
    pattern TEXT NOT NULL,
    difficulty TEXT NOT NULL DEFAULT 'Medium',
    file_path TEXT NOT NULL UNIQUE,
    times_reviewed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

const now = new Date().toISOString();

// 1. BFS note
const bfsPath = path.join(vaultDir, 'DSA', 'Graph');
fs.mkdirSync(bfsPath, { recursive: true });
const bfsContent = `# BFS (Breadth-First Search)

## Core Concept
Level-order graph and tree traversal exploring neighbors level by level using a Queue (FIFO).

## Important Details

### Queue Size
Always capture \`int size = q.size();\` before processing the current level.

\`\`\`java
int size = q.size();
for (int i = 0; i < size; i++) {
    TreeNode curr = q.poll();
    // process curr
    if (curr.left != null) q.offer(curr.left);
    if (curr.right != null) q.offer(curr.right);
}
\`\`\`

## Common Mistakes
- **Dynamic \`q.size()\` inside loop header**: Calling \`for (int i = 0; i < q.size(); i++)\` is a major bug because the queue grows dynamically as you add child nodes, contaminating the level traversal.

## Personal Memory
I always forget that in BFS I need to take q.size() before the for loop.

## Related
- DFS
- Level Order Traversal
- Graph Traversal
`;
fs.writeFileSync(path.join(bfsPath, 'BFS.md'), bfsContent, 'utf-8');

// 2. Map note
const javaPath = path.join(vaultDir, 'Java', 'Collections');
fs.mkdirSync(javaPath, { recursive: true });
const mapContent = `# Java Map Iteration

## Core Concept
Iterating efficiently over Java Maps without double lookups.

## Important Details

### Map.Entry
Use \`map.entrySet()\` when you need both keys and values simultaneously to avoid expensive repeated \`map.get(k)\` calls.

\`\`\`java
for (Map.Entry<Integer, Integer> entry : map.entrySet()) {
    Integer key = entry.getKey();
    Integer val = entry.getValue();
}
\`\`\`

## Common Mistakes
- Iterating over \`map.keySet()\` and calling \`map.get(k)\` inside the loop (O(1) average but causes unnecessary hash code computations).
- Assuming HashMap is thread-safe (use ConcurrentHashMap for multi-threaded access).

## Personal Memory
Remember Map.Entry<Integer,Integer> entry : map.entrySet() syntax.

## Related
- Collections
- HashMap
- Java Streams
`;
fs.writeFileSync(path.join(javaPath, 'Map.md'), mapContent, 'utf-8');

// 3. LeetCode 3Sum
const lcPath = path.join(vaultDir, 'LeetCode');
fs.mkdirSync(lcPath, { recursive: true });
const lcContent = `# 15. 3Sum

## Pattern
- **Category**: Two-Pointers
- **Difficulty**: Medium

## Approach
1. Sort the input array.
2. Iterate \`i\` from 0 to n - 1. If \`nums[i] > 0\`, break early.
3. Skip duplicate values for \`i\`: \`if (i > 0 && nums[i] == nums[i-1]) continue;\`
4. Use two pointers: \`left = i + 1\`, \`right = n - 1\` to find pairs summing to \`-nums[i]\`.

## Key Insight
Sorting allows efficient duplicate skipping and predictable two-pointer movement.

## Code
\`\`\`java
Arrays.sort(nums);
for (int i = 0; i < nums.length - 2; i++) {
    if (i > 0 && nums[i] == nums[i - 1]) continue;
    int l = i + 1, r = nums.length - 1;
    while (l < r) {
        int sum = nums[i] + nums[l] + nums[r];
        if (sum == 0) {
            res.add(Arrays.asList(nums[i], nums[l++], nums[r--]));
            while (l < r && nums[l] == nums[l - 1]) l++;
            while (l < r && nums[r] == nums[r + 1]) r--;
        } else if (sum < 0) l++;
        else r--;
    }
}
\`\`\`

## Common Mistakes
- Forgetting to skip duplicate elements for both the outer element and the two-pointer inner scan.
`;
fs.writeFileSync(path.join(lcPath, '3Sum.md'), lcContent, 'utf-8');

// Seed SQLite records
const insert = db.prepare(`
  INSERT OR REPLACE INTO memories (
    id, title, file_path, topic, subcategory, knowledge_type,
    importance, content_preview, query_count, quiz_correct_count,
    quiz_incorrect_count, forgetting_score, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

insert.run('mem_bfs', 'BFS', 'DSA/Graph/BFS.md', 'DSA', 'Graph/BFS', 'common_mistake', 5, 'Always capture q.size() before processing level', 4, 1, 3, 5.2, now, now);
insert.run('mem_map', 'Java Map Iteration', 'Java/Collections/Map.md', 'Java', 'Collections/Map', 'syntax', 4, 'Map.Entry<K,V> entry : map.entrySet()', 2, 2, 1, 3.8, now, now);
insert.run('mem_3sum', '15. 3Sum', 'LeetCode/3Sum.md', 'LeetCode', '3Sum', 'leetcode_approach', 4, 'Sort array, fix i, two pointers for two sum target', 1, 0, 0, 2.5, now, now);

// Seed LeetCode table
db.prepare(`
  INSERT OR REPLACE INTO leetcode_problems (
    id, problem_name, problem_number, pattern, difficulty, file_path, times_reviewed, created_at, updated_at
  ) VALUES ('lc_3sum', '3Sum', 15, 'Two-Pointers', 'Medium', 'LeetCode/3Sum.md', 1, ?, ?)
`).run(now, now);

// Seed FTS5
try {
  db.prepare('DELETE FROM memories_fts').run();
  const fts = db.prepare('INSERT INTO memories_fts (title, content, topic, subcategory, file_path) VALUES (?, ?, ?, ?, ?)');
  fts.run('BFS', bfsContent, 'DSA', 'Graph/BFS', 'DSA/Graph/BFS.md');
  fts.run('Java Map Iteration', mapContent, 'Java', 'Collections/Map', 'Java/Collections/Map.md');
  fts.run('15. 3Sum', lcContent, 'LeetCode', 'Two-Pointers', 'LeetCode/3Sum.md');
} catch (e) {
  console.log('FTS notice:', e.message);
}

console.log('Seeding completed successfully!');
