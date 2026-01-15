export function buildRoadmapPrompt(goal) {
  return `
You are an expert software architect and career mentor.

Generate a VERY DETAILED, PRACTICAL, INDUSTRY-READY learning roadmap for:

"${goal}"

Rules:
- The roadmap must be for a COMPLETE BEGINNER to JOB-READY.
- Break it into 5 to 7 phases.
- Each phase should contain 6 to 12 VERY SPECIFIC topics.
- Topics should be REAL, PRACTICAL skills, not vague words.
- Go DEEP. Do not stay high level.
- Include tools, concepts, internals, and real-world skills.

Examples of good topics:
- "JWT Access vs Refresh Tokens"
- "Database Indexing and Query Optimization"
- "Express Middleware Internals"
- "Rate Limiting Strategies"
- "Docker Multi-stage Builds"
- "Caching with Redis"
- "Message Queues with RabbitMQ / Kafka"
- "CI/CD Pipelines"
- "System Design Basics"
- "Horizontal vs Vertical Scaling"

Bad topics (DO NOT USE):
- "Learn Backend"
- "APIs"
- "Databases"
- "Security"

Output STRICT JSON in this format:

{
  "title": "Roadmap Title",
  "phases": [
    {
      "id": "p1",
      "title": "Phase title",
      "items": [
        { "id": "i1", "label": "Very specific topic" },
        { "id": "i2", "label": "Very specific topic" }
      ]
    }
  ]
}

Do NOT include markdown.
Do NOT include explanation.
Do NOT include anything outside JSON.
`;
}
