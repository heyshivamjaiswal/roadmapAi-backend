import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Groq from "groq-sdk";
import { buildRoadmapPrompt } from "./buildRoadmapPrompt.js";
import { db } from "./firebaseAdmin.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});


function extractJSONBlock(text) {
  if (typeof text !== "string") throw new Error("LLM output not string");

  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");

  if (first === -1 || last === -1 || last <= first) {
    throw new Error("No JSON block found");
  }

  let json = text.slice(first, last + 1);
  json = json.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
  return json.trim();
}

function preRepairJSON(raw) {
  let fixed = raw;

  fixed = fixed.replace(
    /"\s*\{\s*"id"\s*:\s*"([^"]+)"\s*,\s*"label"\s*:\s*"([^"]+)"\s*\}\s*"/g,
    (_, id, label) => `{"id":"${id}","label":"${label}"}`
  );

  fixed = fixed.replace(
    /\{\s*"([^"]+)"\s*,\s*"label"\s*:\s*"([^"]+)"\s*\}/g,
    (_, id, label) => `{"id":"${id}","label":"${label}"}`
  );

  return fixed;
}

function parseLLMOutput(text) {
  let raw = extractJSONBlock(text);
  raw = preRepairJSON(raw);
  return JSON.parse(raw);
}


function normalizeId(id, phaseId, index) {
  let clean = String(id)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .trim();

  if (!clean) clean = `${phaseId}_${index + 1}`;
  return clean;
}

function explodeBrokenItemObject(obj) {
  const items = [];

  if (!obj || typeof obj !== "object") return items;

  if (typeof obj.id === "string" && typeof obj.label === "string") {
    items.push({ id: obj.id, label: obj.label });
  }

  for (const [key, value] of Object.entries(obj)) {
    if (key === "id" || key === "label") continue;

    if (typeof key === "string" && typeof value === "string") {
      items.push({ id: key, label: value });
    }
  }

  return items;
}

function normalizeRoadmap(json) {
  if (!json || typeof json !== "object") throw new Error("Not object");
  if (!Array.isArray(json.phases)) throw new Error("No phases array");

  json.phases.forEach((phase, pIndex) => {
    if (!phase.id) phase.id = `p${pIndex + 1}`;
    if (!Array.isArray(phase.items)) phase.items = [];

    const newItems = [];

    phase.items.forEach((item) => {
      if (!item || typeof item !== "object") return;

      if (typeof item.id === "string" && typeof item.label === "string") {
        newItems.push({
          id: normalizeId(item.id, phase.id, newItems.length),
          label: item.label,
        });
        return;
      }

      const exploded = explodeBrokenItemObject(item);
      exploded.forEach((ex) => {
        newItems.push({
          id: normalizeId(ex.id, phase.id, newItems.length),
          label: ex.label,
        });
      });
    });

    phase.items = newItems;
  });

  if (!json.title || typeof json.title !== "string") {
    json.title = "Generated Roadmap";
  }

  if (!Array.isArray(json.edges)) json.edges = [];

  return json;
}


//Routes

app.get("/", (req, res) => {
  res.send("Roadmap backend is running 🚀");
});

//List all saved roadmaps
app.get("/api/roadmaps", async (req, res) => {
  try {
    const snap = await db
      .collection("roadmaps")
      .orderBy("createdAt", "desc")
      .get();

    const list = snap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    }));

    res.json(list);
  } catch (e) {
    res.status(500).json({ error: "FAILED_TO_LIST" });
  }
});

//Delete roadmap
app.delete("/api/roadmap/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await db.collection("roadmaps").doc(id).delete();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "FAILED_TO_DELETE" });
  }
});

//Generate or load roadmap
app.post("/api/roadmap", async (req, res) => {
  try {
    const { goal } = req.body;
    if (!goal) return res.status(400).json({ error: "Goal is required" });

    const goalKey = goal.toLowerCase().replace(/[^a-z0-9]+/g, "-");

    //1. CHECK CACHE FIRST
    const docRef = db.collection("roadmaps").doc(goalKey);
    const snap = await docRef.get();

    if (snap.exists) {
      return res.json(snap.data().data);
    }

    // CALL GROQ
    const prompt = buildRoadmapPrompt(goal);

    const completion = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [
        {
          role: "system",
          content:
            "You output ONLY valid JSON. No explanation. No markdown. No comments.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
    });

    const text = completion.choices[0].message.content;

    let json;
    try {
      json = parseLLMOutput(text);
      json = normalizeRoadmap(json);
    } catch (e) {
      console.error("JSON REPAIR FAILED");
      console.error("RAW OUTPUT:\n", text);
      console.error(e);

      return res.status(500).json({
        error: "BAD_LLM_JSON",
        message: "AI returned unrecoverable malformed data",
      });
    }

    //SAVE TO FIRESTORE CACHE
    await docRef.set({
      goal,
      createdAt: Date.now(),
      data: json,
    });

    return res.json(json);
  } catch (err) {
    console.error("Roadmap error:", err);

    if (
      err?.status === 429 ||
      err?.error?.error?.code === "rate_limit_exceeded"
    ) {
      return res.status(429).json({
        error: "RATE_LIMIT",
        message: "AI daily limit reached. Please wait and try again.",
      });
    }

    return res.status(500).json({
      error: "INTERNAL_ERROR",
      message: "Failed to generate roadmap",
    });
  }
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
});
