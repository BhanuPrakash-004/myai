# Java Map Iteration

## Core Concept
Iterating efficiently over Java Maps without double lookups.

## Important Details

### Map.Entry
Use `map.entrySet()` when you need both keys and values simultaneously to avoid expensive repeated `map.get(k)` calls.

```java
for (Map.Entry<Integer, Integer> entry : map.entrySet()) {
    Integer key = entry.getKey();
    Integer val = entry.getValue();
}
```

## Common Mistakes
- Iterating over `map.keySet()` and calling `map.get(k)` inside the loop (O(1) average but causes unnecessary hash code computations).
- Assuming HashMap is thread-safe (use ConcurrentHashMap for multi-threaded access).

## Personal Memory
Remember Map.Entry<Integer,Integer> entry : map.entrySet() syntax.

## Related
- Collections
- HashMap
- Java Streams
