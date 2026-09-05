# BFS (Breadth-First Search)

## Core Concept
Level-order graph and tree traversal exploring neighbors level by level using a Queue (FIFO).

## Important Details

### Queue Size
Always capture `int size = q.size();` before processing the current level.

```java
int size = q.size();
for (int i = 0; i < size; i++) {
    TreeNode curr = q.poll();
    // process curr
    if (curr.left != null) q.offer(curr.left);
    if (curr.right != null) q.offer(curr.right);
}
```

## Common Mistakes
- **Dynamic `q.size()` inside loop header**: Calling `for (int i = 0; i < q.size(); i++)` is a major bug because the queue grows dynamically as you add child nodes, contaminating the level traversal.

## Personal Memory
I always forget that in BFS I need to take q.size() before the for loop.

## Related
- DFS
- Level Order Traversal
- Graph Traversal
