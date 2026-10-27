// 오픽 연습실 AI 중계 서버
// - POST /transcribe : 녹음 파일 → 영어 받아쓰기 (Cloudflare Workers AI Whisper, 무료 한도 안)
// - POST /feedback   : 답변 → 예상 등급·교정·더 길게 말하는 법·목표 등급 답안 (OpenAI gpt-6-luna)
// - POST /build      : 한국어 메모 → 내 이야기로 된 2분 영어 답안 (OpenAI gpt-6-luna)
// - GET  /ping       : 사용 코드 확인용
// 무료 플랜은 요청당 CPU 10ms라, 오디오는 변환 없이 스트림 그대로 넘기고 무거운 일은 전부 외부 API에 맡김.

const WHISPER = "@cf/openai/whisper-large-v3-turbo";
const MAX_AUDIO = 8 * 1024 * 1024; // 약 4~5분 분량
const LEVELS = ["NH", "IL", "IM1", "IM2", "IM3", "IH", "AL"];

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
    const cors = {
      "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0] || "",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Passcode",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    };
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (origin && !allowed.includes(origin)) return json({ error: "origin" }, 403);
    if (!env.APP_PASSCODE || req.headers.get("X-Passcode") !== env.APP_PASSCODE) return json({ error: "passcode" }, 401);

    const path = new URL(req.url).pathname;
    try {
      if (path === "/ping") return json({ ok: true });
      if (req.method !== "POST") return json({ error: "method" }, 405);
      if (path === "/transcribe") return json(await transcribe(req, env));
      const body = await req.json().catch(() => null);
      if (!body) return json({ error: "bad_json" }, 400);
      if (path === "/feedback") return json(await feedback(body, env));
      if (path === "/build") return json(await build(body, env));
      return json({ error: "not_found" }, 404);
    } catch (e) {
      const code = e && e.code || "server";
      return json({ error: code, detail: String(e && e.message || e).slice(0, 300) }, code === "too_large" || code === "bad_input" ? 400 : 502);
    }
  }
};

function fail(code, msg) { const e = new Error(msg || code); e.code = code; return e; }
const clip = (s, n) => String(s == null ? "" : s).slice(0, n);

// ---------- 받아쓰기 ----------
async function transcribe(req, env) {
  const len = +req.headers.get("Content-Length") || 0;
  if (len > MAX_AUDIO) throw fail("too_large");
  if (!req.body) throw fail("bad_input", "no audio");
  const type = (req.headers.get("Content-Type") || "audio/webm").split(";")[0];
  // initial_prompt로 문항을 주면 인식이 나아지지만, 따라 말하기 채점에서는 정답 쪽으로 끌려가므로 앱이 원할 때만 보냄
  const prompt = clip(new URL(req.url).searchParams.get("prompt"), 300);
  const out = await env.AI.run(WHISPER, {
    audio: { body: req.body, contentType: type },
    language: "en",
    vad_filter: true,
    condition_on_previous_text: false,
    ...(prompt ? { initial_prompt: prompt } : {})
  });
  return { text: (out && out.text || "").trim() };
}

// ---------- OpenAI 호출 (Responses API, JSON 스키마 고정) ----------
async function askLLM(env, system, user, name, schema, maxTokens) {
  if (!env.OPENAI_API_KEY) throw fail("no_key");
  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Authorization": "Bearer " + env.OPENAI_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.LLM_MODEL || "gpt-6-luna",
      reasoning: { effort: "low" }, // 생각 토큰도 출력 요금이라 낮게
      max_output_tokens: maxTokens,
      input: [{ role: "system", content: system }, { role: "user", content: user }],
      text: { format: { type: "json_schema", name, schema, strict: true } }
    })
  });
  if (r.status === 429) throw fail("rate_limited");
  if (!r.ok) throw fail("llm_" + r.status, (await r.text()).slice(0, 300));
  const data = await r.json();
  const msg = (data.output || []).find(o => o.type === "message");
  const text = msg && (msg.content || []).filter(c => c.type === "output_text").map(c => c.text).join("");
  if (!text) throw fail("llm_empty", data.status || "");
  return JSON.parse(text);
}

const S = (props) => ({ type: "object", properties: props, required: Object.keys(props), additionalProperties: false });
const str = { type: "string" }, num = { type: "number" }, strs = { type: "array", items: str };

const COACH = `You are an experienced ACTFL OPIc rater and a kind English speaking coach for Korean office workers preparing for a company promotion exam.
The learner's English is weak, so every Korean explanation must be short, simple, and encouraging (쉬운 한국어, 존댓말).
Real OPIc answers should last about 1.5 to 2 minutes (roughly 150 to 230 words) and use paragraph-length speech.`;

// ---------- 첨삭 ----------
async function feedback(b, env) {
  const answer = clip(b.answer, 4000).trim();
  if (answer.split(/\s+/).length < 5) throw fail("bad_input", "answer too short");
  const level = LEVELS.includes(b.level) ? b.level : "IH";
  const user = `Target level: ${level}
Question type: ${clip(b.type, 20)}
Question: ${clip(b.question, 600)}
Speaking time: ${Math.max(0, Math.round(+b.seconds || 0))} seconds (0 means typed)
Transcript (from speech recognition, so ignore punctuation and small recognition errors):
"""
${answer}
"""
Rate it as an OPIc rater would (task completion, paragraph-length discourse, fluency, grammar, vocabulary, time frames, length).
- fixes: up to 5 of the most useful corrections, quoting the learner's own words in "original".
- longer_tip_ko: concrete advice in Korean on what to ADD to reach 1.5 to 2 minutes (e.g. 예시, 이유, 과거와 비교, 느낀 점), naming 2 or 3 ideas that fit this question.
- improved_en: rewrite the learner's answer at the target level, about 180 to 220 words, keeping their own story and facts, using simple natural spoken English.
- key_sentences: 5 short sentences from improved_en worth memorizing, each with a Korean translation.`;
  const schema = S({
    estimated_level: { type: "string", enum: LEVELS },
    summary_ko: str,
    scores: S({ task: num, fluency: num, grammar: num, vocabulary: num, structure: num }),
    strengths_ko: strs,
    fixes: { type: "array", items: S({ original: str, corrected: str, why_ko: str }) },
    longer_tip_ko: str,
    next_tip_ko: str,
    improved_en: str,
    key_sentences: { type: "array", items: S({ en: str, ko: str }) }
  });
  return askLLM(env, COACH, user, "opic_feedback", schema, 2500);
}

// ---------- 한국어 메모로 답안 만들기 ----------
async function build(b, env) {
  const notes = clip(b.notes_ko, 1200).trim();
  if (!notes) throw fail("bad_input", "no notes");
  const level = LEVELS.includes(b.level) ? b.level : "IH";
  const me = b.me && typeof b.me === "object" ? b.me : {};
  const user = `Target level: ${level}
Question type: ${clip(b.type, 20)}
Question: ${clip(b.question, 600)}
About the learner (use only if it fits): name ${clip(me.nameEn, 60)}, age ${clip(me.age, 5)}, job ${clip(me.jobEn, 80)}, company ${clip(me.coEn, 120)}, lives in ${clip(me.townEn, 120)}.
The learner's own notes in Korean (their real story; keep these facts, you may add natural small details):
"""
${notes}
"""
Write a spoken OPIc answer in the learner's voice: about 190 to 220 words, simple natural English the learner can memorize, with an opening, three details, a feeling, and a closing.
Also give a Korean translation of the whole answer, and 5 key sentences from the answer with Korean translations.`;
  const schema = S({ answer_en: str, answer_ko: str, key_sentences: { type: "array", items: S({ en: str, ko: str }) } });
  return askLLM(env, COACH, user, "opic_answer", schema, 2500);
}
