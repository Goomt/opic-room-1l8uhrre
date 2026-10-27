// 로컬 테스트용: 실제 Worker 코드를 Node에서 돌리고, Cloudflare AI와 OpenAI만 가짜로 바꿈.
// 실행: node worker/dev-mock.mjs  →  http://127.0.0.1:8787 (사용 코드: test-code)
// 앱에서 쓰려면 브라우저 콘솔에서 localStorage.setItem("opic-ai-url",'"http://127.0.0.1:8787"') 후 #code=test-code 로 열기
import http from "node:http";
import worker from "./src/index.js";

const env = {
  APP_PASSCODE: "test-code", OPENAI_API_KEY: "sk-fake", LLM_MODEL: "gpt-6-luna",
  ALLOWED_ORIGINS: "http://localhost:8765,http://127.0.0.1:8765",
  AI: { run: async (model, input) => {
    let n = 0; const rd = input.audio.body.getReader(); for (;;) { const { done, value } = await rd.read(); if (done) break; n += value.length; }
    console.log("[mock AI]", model, input.audio.contentType, n + " bytes", "prompt:", input.initial_prompt || "-");
    return { text: input.initial_prompt ? "I live in a small apartment with my family. It is near the subway station and I like it because it is quiet." : "Hi, my name is Minsu Kim, and I am thirty two years old." };
  } }
};
globalThis.fetch = async (url, opt) => {
  const b = JSON.parse(opt.body), name = b.text.format.name;
  console.log("[mock OpenAI]", b.model, name, "effort:", b.reasoning.effort);
  await new Promise(r => setTimeout(r, 400));
  const out = name === "opic_feedback" ? {
    estimated_level: "IM2", summary_ko: "내용은 잘 전달됐지만 답변이 짧아요. 목표 IH까지는 길이와 연결어가 더 필요해요.",
    scores: { task: 70, fluency: 62, grammar: 66, vocabulary: 58, structure: 55 },
    strengths_ko: ["질문에 맞게 답했어요.", "발음이 또렷해요."],
    fixes: [{ original: "It is near the subway station", corrected: "It’s right next to the subway station", why_ko: "줄임말과 right next to가 더 자연스러워요." }],
    longer_tip_ko: "방 구조, 가장 좋아하는 공간, 예전 집과 비교를 하나씩 더 말해 보세요.",
    next_tip_ko: "‘Let me give you a specific example.’로 예시를 하나 붙여 보세요.",
    improved_en: "I live in a small apartment with my family. It’s right next to the subway station, so it’s really convenient. Let me give you a specific example of why I like it...",
    key_sentences: [{ en: "It’s right next to the subway station.", ko: "지하철역 바로 옆이에요." }, { en: "That’s why I like it so much.", ko: "그래서 정말 좋아해요." }]
  } : { answer_en: "Every weekend, I ride my bike along the Han River with my friends. After that, we usually eat fried chicken...", answer_ko: "주말마다 친구들과 한강에서 자전거를 타요...", key_sentences: [{ en: "Every weekend, I ride my bike along the Han River.", ko: "주말마다 한강에서 자전거를 타요." }] };
  return new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(out) }] }] }));
};

http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = ["GET", "HEAD", "OPTIONS"].includes(req.method) ? undefined : Buffer.concat(chunks);
  const r = await worker.fetch(new Request("http://127.0.0.1:8787" + req.url, { method: req.method, headers: req.headers, body, duplex: "half" }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
}).listen(8787, "127.0.0.1", () => console.log("mock AI server on http://127.0.0.1:8787"));
