// try_final.js

const fs     = require("fs");
const path   = require("path");
const { config } = require("dotenv");
const { OpenAI } = require("openai");
config();

const argv  = process.argv.slice(2);
const DEBUG = process.env.DEBUG === "1" || argv.includes("--debug");
const MATCH_THRESHOLD = 85;

if (!process.env.OPEN_AI_KEY) {
  console.error("❌ Please set OPEN_AI_KEY in your .env");
  process.exit(1);
}

const openai      = new OpenAI({ apiKey: process.env.OPEN_AI_KEY });
const INPUT_FILE  = path.resolve(__dirname, "input.txt");
const OUTPUT_FILE = path.resolve(__dirname, "output.txt");

// Conclusion starters
const conclusionStarters = [
  "Қорытындылай келе,","Жалпы алғанда,","Ең соңында,",
  "Жалпы нәтижесінде,","Сөз соңында,","Сөйтіп,",
  "Соңғы талдау бойынша,","Қорыта айтқанда,",
  "Мұның нәтижесінде,","Осы тұжырымдарға сүйенсек,"
];

// 1) bootstrap input.txt if missing
if (!fs.existsSync(INPUT_FILE)) {
  const stub = [
    "<SAMPLE>",
    "<PROMPT> Paste your prompt here.",
    "<RESPONSE> Paste your response here.",
    "<DOMAIN> Cognitive Sciences",
    "<SOURCE> …"
  ].join("\n");
  fs.writeFileSync(INPUT_FILE, stub, "utf-8");
  console.log("input.txt created. Please edit & rerun.");
  process.exit(0);
}

// 2) Safe JSON parse for small snippets
// npm install json5   // <-- optional if you want to use JSON5
const JSON5 = require("json5");  // comment out if you stick with JSON.parse

function safeJsonParse(raw) {
  if (!raw) return null;

  // 1) rip out any markdown fences
  let t = raw
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();

  // 2) find the first { ... } block
  const m = t.match(/({[\s\S]*})/m);
  if (!m) return null;
  let jsonText = m[1];

  // 3) strip trailing commas before } or ]
  //    e.g. turns `{ "a":1, }` into `{ "a":1 }`
  jsonText = jsonText.replace(/,\s*([\]}])/g, "$1");

  // 4) parse it
  try {
    // return JSON.parse(jsonText);
    return JSON5.parse(jsonText);   // if you installed json5
  }
  catch (err) {
    console.error("🔴 JSON.parse failed on cleaned JSON:", err.message);
    console.error(jsonText);
    return null;
  }
}

// 3) OpenAI retry helper
async function openAiRequest(fn, maxRetries = 5) {
  for (let i = 0; i < maxRetries; i++) {
    try { return await fn(); }
    catch (err) {
      const code = err.code || err.status;
      if (code === 429 || code === "rate_limit_exceeded") {
        const wait = parseInt(err.headers?.["retry-after-ms"]) || 5000;
        console.warn(`⚠️ Rate limit—retrying in ${wait}ms…`);
        await new Promise(r => setTimeout(r, wait));
      } else if (code === "insufficient_quota") {
        console.error("❌ Quota exceeded.");
        return null;
      } else {
        console.error("❌ OpenAI error:", err.message || err);
        return null;
      }
    }
  }
  console.error("❌ Max retries reached.");
  return null;
}

// 4) Rewrite all questions in the prompt into polished academic statements
async function rewritePromptToStatements(text) {
  const system = `
You are a Kazakh academic rewrite assistant.
1) Turn every question in the text into a clear declarative statement (remove “?”).
2) While you rewrite, also:
   • weave in brief analysis/reflection
   • add relevant cultural/semantic insight
   • convert any residual list-style fragments into full sentences
   • clarify or expand any vague parts
   • preserve key cultural details
   • maintain a formal academic style
3) Keep the total length between 75–140 words.
Return ONLY the rewritten text, nothing else.
  `.trim();

  const res = await openAiRequest(() =>
    openai.chat.completions.create({
      model:       "gpt-4o-mini",
      temperature: 0,
      max_tokens:  1024,
      messages: [
        { role:"system",  content: system },
        { role:"user",    content: text   }
      ]
    })
  );

  return res?.choices[0].message.content.trim() ?? text;
}

// 5) Ensure final sentence is complete
async function ensureCompleteSentence(text) {
  const t = text.trim();
  if (/[.?!…]$/.test(t)) return text;
  const system = `
You are a Kazakh academic editor.
The following text ends mid-sentence.
Please complete ONLY the final sentence, preserving style & meaning.
Do not rewrite anything else.
  `.trim();
  const res = await openAiRequest(() =>
    openai.chat.completions.create({
      model:       "gpt-4o-mini",
      temperature: 0,
      max_tokens:  512,
      messages: [
        { role:"system", content: system },
        { role:"user",   content: text }
      ]
    })
  );
  if (!res) return text;
  const out = res.choices[0].message.content.trim();
  return out.startsWith(t) ? out : text + out.replace(t, "");
}

// 6) Generate a 3-sentence conclusion
async function generateConclusion(text, starter) {
  const system = `
You are a skilled Kazakh academic writer.
Append exactly three sentences as a new paragraph.
Begin the first sentence with "${starter}" (including the comma).
Do NOT modify the original text.
Return ONLY those three sentences.
  `.trim();
  const res = await openAiRequest(() =>
    openai.chat.completions.create({
      model:       "gpt-4o-mini",
      temperature: 0.7,
      max_tokens:  1024,
      messages: [
        { role:"system", content: system },
        { role:"user",   content: text }
      ]
    })
  );
  return res ? res.choices[0].message.content.trim() : "";
}

// 7) Generate a question that matches the response
async function generateQuestionFromResponse(prompt, response) {
  const system = `
You are a Kazakh academic question generator.
Based on the following response, write one clear question in Kazakh that this response would answer.
Return ONLY the question (including a question mark).
  `.trim();
  const res = await openAiRequest(() =>
    openai.chat.completions.create({
      model:       "gpt-4o-mini",
      temperature: 0.5,
      max_tokens:  256,
      messages: [
        { role:"system", content: system },
        { role:"user",   content: `PROMPT CONTEXT:\n${prompt}\n\nRESPONSE:\n${response}` }
      ]
    })
  );
  return res?.choices[0].message.content.trim() ?? "";
}

// 8) Check & correct grammar/spelling + semantic match
async function checkAndCorrect(prompt, response, extra = "") {
  if (DEBUG) {
    console.log("⏳ [checkAndCorrect]");
    console.log("PROMPT:\n", prompt);
    console.log("RESPONSE:\n", response);
  }
  const system = `
You are a Kazakh language expert.
1) Rate how well RESPONSE answers PROMPT (0–100).
2) Count grammar & spelling mistakes.
3) Correct those mistakes.
4) If RESPONSE does not match PROMPT, rewrite it.
${extra ? `5) Also address: ${extra}` : ""}
Return EXACTLY:
1) A JSON object with keys:
   percentageMatch, grammarErrors, spellingErrors
2) On a new line, the corrected text wrapped in:
   <RESPONSE>…</RESPONSE>
No extra text.
  `.trim();
  const res = await openAiRequest(() =>
    openai.chat.completions.create({
      model:       "gpt-4o-mini",
      temperature: 0,
      max_tokens:  2048,
      messages: [
        { role:"system", content: system },
        { role:"user",   content: `PROMPT:\n${prompt}\n\nRESPONSE:\n${response}` }
      ]
    })
  );
  if (!res) return null;
  const raw = res.choices[0].message.content.trim();
  if (DEBUG) console.log("✅ [checkAndCorrect] raw:\n", raw);
  const m = safeJsonParse(raw) || { percentageMatch:100, grammarErrors:0, spellingErrors:0 };
  const m2 = raw.match(/<RESPONSE>([\s\S]*?)<\/RESPONSE>/);
  const corrected = m2 ? m2[1].trim() : response;
  return { correctedPrompt: prompt, correctedResponse: corrected, ...m };
}

// 9) Validate grammar/spelling/structure
async function validateQuality(prompt, response) {
  if (DEBUG) console.log("⏳ [validateQuality]");
  const system = `…`;   // your existing system prompt
  const res = await openAiRequest(() =>
    openai.chat.completions.create({
      model:       "gpt-4o-mini",
      temperature: 0,
      max_tokens:  1024,
      messages: [
        { role:"system", content: system },
        { role:"user",   content: `PROMPT:\n${prompt}\n\nRESPONSE:\n${response}` }
      ]
    })
  );
  if (!res) {
    return { valid:true, issues:[] };  
  }

  const raw = res.choices[0].message.content.trim();
  if (DEBUG) console.log("✅ [validateQuality] raw:\n", raw);

  // attempt to parse
  const parsed = safeJsonParse(raw);
  if (!parsed) {
    console.warn("⚠️ Validator emitted unparseable JSON—assuming valid");
    return { valid:true, issues:[] };
  }

  return parsed;
}

// 10) Validate first paragraph semantic meaning
async function validateMeaning(prompt, response) {
  if (DEBUG) console.log("⏳ [validateMeaning]");
  const system = `
You are a Kazakh language validator with a focus on semantic correctness.
Check if the first paragraph of the RESPONSE directly and clearly answers the main question posed in the final sentence of the PROMPT.

Return EXACTLY:
{
  "valid": true|false,
  "message": "Explanation why the first paragraph answers/does not answer the main question",
  "context": "Exact text segment where the main question is addressed"
}
No extra text.
  `.trim();
  const res = await openAiRequest(() =>
    openai.chat.completions.create({
      model:       "gpt-4o-mini",
      temperature: 0,
      max_tokens:  1024,
      messages: [
        { role:"system", content: system },
        { role:"user",   content: `PROMPT:\n${prompt}\n\nRESPONSE:\n${response}` }
      ]
    })
  );
  if (!res) return { valid:false, message:"No validator response", context:"" };
  const raw = res.choices[0].message.content.trim();
  if (DEBUG) console.log("✅ [validateMeaning] raw:\n", raw);
  const parsed = safeJsonParse(raw) || { valid:false, message:"", context:"" };
  return parsed;
}

// 11) Attach detailed issues for next pass
function addDetailCorrections(issues, text) {
  if (!issues.length) return text;
  let out = text;
  issues.forEach(i => {
    out += `\n\n[${i.type}] ${i.message}\nContext: ${i.context}`;
  });
  return out;
}

// 12) Combined iterative correction + threshold + validation + meaning
async function iterativeImproveSample(prompt, response) {
  let p = prompt, r = response;
  for (let pass = 1; pass <= 5; pass++) {
    console.log(`🔄 Pass ${pass}`);
    const c = await checkAndCorrect(p, r);
    if (!c) break;
    p = c.correctedPrompt;
    r = c.correctedResponse;
    if (c.percentageMatch < MATCH_THRESHOLD) {
      console.warn(`⚠️ Match ${c.percentageMatch}% < ${MATCH_THRESHOLD}%—retry rewrite`);
      continue;
    }
    const v = await validateQuality(p, r);
    const m = await validateMeaning(p, r);
    if (v.valid && m.valid) return { success:true, prompt:p, response:r };
    if (!v.valid) { r = addDetailCorrections(v.issues, r); }
    if (!m.valid) { r += `\n\n[meaning] ${m.message}\nContext: ${m.context}`; }
  }
  return { success:false, prompt:p, response:r };
}

// 13) Sanitize text: remove #/*, collapse spaces, drop blank lines
function sanitizeSection(text) {
  return text
    .replace(/[#*]/g, "")
    .split("\n")
    .map(l => l.trim().replace(/\s+/g, " "))
    .filter(l => l !== "")
    .join("\n")
    .trim();
}

// 14) Classify response against your 10 issue‐categories 
async function categorizeIssues(prompt, response) {
  const system = `
You are an academic coach. I will give you a user's RESPONSE to a cultural/academic prompt plus a list of 10 issue‐categories.
Your job:
1) Identify which categories (by number and name) are present in the RESPONSE.
2) For each identified category, give a 1–2 sentence suggestion on how to improve.
Return EXACTLY a JSON array of objects:
[
  { "category": "Category 1: Missing Analysis and Reflection", "advice": "…" },
  …
]
Do NOT include any other text.
  `.trim();

  const user = `
Categories:
1. Missing Analysis and Reflection
2. No Semantic or Cultural Insight
3. List Style Instead of Structured Argument
4. Unclear or Incomplete Answers
5. Strong Cultural Insight (POSITIVE EXAMPLE)
6. Missing Modern Relevance
7. Partial Use of Prompt Context
8. Informal or Weak Academic Style
9. Surface-Level Answers
10. Style is Like a Dictionary

PROMPT:
${prompt}

RESPONSE:
${response}
  `.trim();

  const res = await openAiRequest(() =>
    openai.chat.completions.create({
      model:       "gpt-4o-mini",
      temperature: 0,
      max_tokens:  2048,
      messages: [
        { role:"system", content: system },
        { role:"user",   content: user   }
      ]
    })
  );
  if (!res) return [];
  try {
    return JSON.parse(res.choices[0].message.content.trim());
  } catch {
    return [];
  }
}

// 15) Auto-solve identified issues before final validation
async function autoSolveIssues(prompt, response, categoryFeedback) {
  const system = `
You are an academic writing assistant.
I will provide you the original PROMPT, the current RESPONSE, and a list of categorized issues with improvement advice. Ensure your final revised RESPONSE is at least 400 words.
Rewrite the RESPONSE so that it addresses each identified issue:
- Add missing analysis/reflection.
- Incorporate semantic/cultural insights.
- Transform list-style points into a structured argument.
- Clarify or expand vague sections.
- Preserve any strong cultural insights already present.
- Add modern relevance where missing.
- Ensure all parts of the prompt context are used.
- Use an academic style (symbolism, ritual, status hierarchy).
- Deepen surface-level answers with comparisons & contrasts.
- Change dictionary-like sentences into full explanatory paragraphs.
Ensure your final revised RESPONSE is at least 400 words.
Return ONLY the revised RESPONSE text, without extra commentary.
  `.trim();

  const user = `
PROMPT:
${prompt}

RESPONSE:
${response}

ISSUES:
${JSON.stringify(categoryFeedback, null, 2)}
  `.trim();

  const res = await openAiRequest(() =>
    openai.chat.completions.create({
      model:       "gpt-4o-mini",
      temperature: 0.7,
      max_tokens:  4096,
      messages: [
        { role:"system", content: system },
        { role:"user",   content: user   }
      ]
    })
  );
  return res?.choices[0].message.content.trim() ?? response;
}

// 16) MAIN PIPELINE
;(async () => {
  const start = Date.now();
  // read and immediately strip any END FAILED SAMPLE markers
  let raw   = fs.readFileSync(INPUT_FILE, "utf-8");
  raw = raw.replace(/^=== END FAILED SAMPLE ===\r?\n?/gm, "");
  const secs  = raw.split("<SAMPLE>").slice(1);

  const output = [], failed = [];

  console.log(`🚀 Processing ${secs.length} sample(s)…\n`);

  for (let i = 0; i < secs.length; i++) {
    console.log(`▶️ SAMPLE #${i+1}`);
    const sec = secs[i];

    let p = (sec.match(/<PROMPT>([\s\S]*?)<RESPONSE>/)     || [,""])[1].trim();
    let r = (sec.match(/<RESPONSE>([\s\S]*?)(<DOMAIN>|<SOURCE>|$)/) || [,""])[1].trim();
    const d = (sec.match(/<DOMAIN>([\s\S]*?)<SOURCE>/)     || [,"Cognitive Sciences"])[1].trim();
    const s = (sec.match(/<SOURCE>([\s\S]*)/)              || [,"…"])[1].trim();

    // 1) rewrite prompt questions → statements
    p = await rewritePromptToStatements(p);

    // 2) finish dangling sentences
    p = await ensureCompleteSentence(p);
    r = await ensureCompleteSentence(r);

    // 3) append inline conclusion
    const starter = conclusionStarters[i % conclusionStarters.length];
    console.log("  📝 Conclusion starter:", starter);
    const concl = await generateConclusion(r, starter);
    if (concl) {
      r = r.trim() + " " + concl.trim();
      r = await ensureCompleteSentence(r);
      console.log("  ✔️ Conclusion appended inline");
    }

    // 4) categorize issues & auto-solve before final validation
    console.log("  🛠️ Categorizing issues");
    const categoryFeedback = await categorizeIssues(p, r);
    if (categoryFeedback.length) {
      console.log("  🛠️ Auto-solving identified issues");
      r = await autoSolveIssues(p, r, categoryFeedback);
    } else {
      console.log("  ✅ No rubric issues detected");
    }

    // 5) iterative correction & final validation
    const { success, prompt: cp, response: cr } = await iterativeImproveSample(p, r);

    // 6) generate a question from the final response
    const question = await generateQuestionFromResponse(cp, cr);
    const cpWithQ = question ? cp.trim() + " " + question.trim() : cp;

    // 7) sanitize and output
    const cleanP = sanitizeSection(cpWithQ);
    const cleanR = sanitizeSection(cr);

    if (!success) {
      console.error("  ❌ Failed after max passes");
      failed.push(i+1);
      // note: we no longer append "=== END FAILED SAMPLE ==="
      output.push([
        `<SAMPLE>`,
        `<PROMPT> ${cleanP}`,
        `<RESPONSE> ${cleanR}`,
        `<DOMAIN> ${d}`,
        `<SOURCE> ${s}`
      ].join("\n"));
    } else {
      console.log("  🎉 Sample valid");
      output.push([
        `<SAMPLE>`,
        `<PROMPT> ${cleanP}`,
        `<RESPONSE> ${cleanR}`,
        `<DOMAIN> ${d}`,
        `<SOURCE> ${s}`
      ].join("\n"));
    }
    console.log("");
  }

  // write output + summary
  const elapsed = Date.now() - start;
  const h = Math.floor(elapsed/3600000),
        m = Math.floor((elapsed%3600000)/60000),
        s = Math.floor((elapsed%60000)/1000);

  const summary = [
    "",
    "=== Summary ===",
    `Total:     ${secs.length}`,
    `Succeeded: ${secs.length - failed.length}`,
    `Failed:    ${failed.length}` + (failed.length ? ` (sections ${failed.join(", ")})` : ""),
    `Time:      ${h}h ${m}m ${s}s`
  ].join("\n");

  fs.writeFileSync(OUTPUT_FILE, output.join("\n\n") + "\n" + summary + "\n", "utf-8");
  console.log(summary);
})();