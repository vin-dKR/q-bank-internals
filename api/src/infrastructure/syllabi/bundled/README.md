# Bundled syllabus files

One file per exam, `<exam>.syllabus.json`, holding that exam's **subjects → chapters → topics**. A question's
topic is only ever chosen from its own exam's syllabus, so a NEET question can never be given a JEE topic.

These are the syllabi that **ship with the app**. Most exams should instead be uploaded from the **Exam
syllabus** screen (JSON or CSV), which stores them in Mongo and overrides the bundled file of the same exam —
no redeploy, and the deployed API's filesystem is read-only anyway. Bundle a file only when an exam should be
known to a fresh deployment with an empty database.

## Bundling an exam

1. Write `<exam>.syllabus.json` in the shape below.
2. Import it in [`../bundled.syllabi.ts`](../bundled.syllabi.ts) and add it to `BUNDLED_SYLLABI`.

Until an exam has a syllabus (bundled or uploaded), "Fix with AI · topic" reports its questions as blocked
rather than guessing.

```json
{
  "exam": "JEE",
  "title": "JEE Main 2026 — NCERT chapter-wise topics",
  "aliases": ["JEE Main", "JEE Mains"],
  "subjects": [
    {
      "subject": "Physics",
      "aliases": ["Physic"],
      "chapters": [
        {
          "chapter": "Kinetic Theory",
          "class": 11,
          "aliases": ["KTG & Thermodynamics", "KTG"],
          "topics": ["Equation of state of a perfect gas", "Kinetic theory of gases — assumptions"]
        }
      ]
    }
  ]
}
```

- **`aliases`** are the other names the bank stores for the same exam, subject or chapter. Matching already
  ignores case, punctuation and "&" vs "and", so only add a genuinely different name — the bank's chapters are
  coaching-style ("Modern Physics 1", "Unit & Dimension, Basic Maths and Vector").
- One alias may sit on **several** chapters. A bank chapter that spans two syllabus chapters (e.g.
  "KTG & Thermodynamics") then offers the topics of both, and the AI chooses within them.
- A chapter with no alias still works: when nothing matches, the AI first places the question in one of the
  subject's chapters, then picks a topic inside it.
- `class` is optional (`null` for a unit with no NCERT class, such as p-Block Elements).
- Chapter and topic ids are **not** in the file — they are generated from position (`C07`, `C07-T03`) when it
  loads, so topics can be reordered or reworded freely. Only the topic **text** is ever written to the bank.
