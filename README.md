# 오픽 연습실

OPIc(영어 말하기 시험) 연습용 모바일 웹앱입니다. 친구 1명에게 링크로 주는 용도이고, GitHub Pages(main 브랜치 루트)로 배포합니다.

## 구조

- `index.html`에 CSS, 기본 데이터, 앱 로직이 들어 있습니다. 빌드 도구 없이 바닐라 JS로 동작합니다.
- `data-more.js`: 2분 모범 답안(`LONG`, 약 200단어)과 추가 문항(`MORE`). 기존 모범 답안은 짧은 답안 `s`(IM 목표)로 옮겨집니다. 새 문항은 각 주제 끝에 붙여서 문장 진도 id가 바뀌지 않게 합니다. 수정하면 `index.html`의 `data-more.js?v=` 숫자를 올려 주세요(캐시 갱신).
- 데이터
  - `UNIV`: 만능 표현 7그룹 (마지막 "길게 늘리기"는 data-more.js에서 추가)
  - `TOPICS`: 자기소개, 서베이 8주제 × 6문항(묘사·루틴·경험 + 묘사·비교·경험), 롤플레이 6, 돌발 8 — 총 63문항
  - 문항마다 `en`(질문), `ko`(번역), `k`(핵심 문장 `[en, ko]` 목록), `m`(모범 답안)
- 탭 3개
  - 따라 말하기: 예문 듣기, Web Speech API로 따라 말한 일치율 채점
  - 실전 모의: 질문 듣기, 2분 타이머, 받아쓰기, 힌트, 모범 답안 비교
  - 내 문장: 저장한 문장 연속 듣기
- 음성은 브라우저 `speechSynthesis`를 씁니다.
- AI 기능(선택): `worker/`의 Cloudflare Worker가 중계합니다. `index.html`의 `AI_URL_DEFAULT`가 비어 있거나 AI 코드가 없으면 모두 숨겨집니다.
  - 받아쓰기: Cloudflare Workers AI `whisper-large-v3-turbo` (무료 한도 하루 약 200분)
  - 채점·고쳐 쓰기·한국어 메모로 답안 만들기: OpenAI `gpt-6-luna`
  - 앱에서: 실전 모의 'AI 채점 받기', 주제 화면 '내 이야기로 2분 답안 만들기', 브라우저 받아쓰기가 안 되는 폰(iPhone 등)의 따라 말하기 채점
  - AI 코드는 '내 정보'에서 넣거나 링크 뒤에 `#code=코드`를 붙여 열면 저장됩니다.

## AI 서버 (worker/)

비밀값은 저장소에 넣지 않고 Cloudflare에만 저장합니다.

```
cd worker
npx wrangler login
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put APP_PASSCODE
npx wrangler deploy
```

- 로컬 테스트: `node worker/dev-mock.mjs` (실제 Worker 코드를 돌리고 AI·OpenAI만 가짜로 바꿈, 코드 `test-code`)
- 비용 상한: OpenAI는 선불 충전이라 자동 충전을 꺼 두면 충전한 금액 이상 나가지 않습니다. Workers AI는 무료 플랜에서 한도를 넘으면 그날은 멈출 뿐 과금되지 않습니다.

## 저장 데이터 (localStorage)

친구의 진도가 유지되도록 아래 키 이름은 바꾸지 않습니다.

`opic-done`, `opic-fav`, `opic-mock-set`, `opic-onboarded`, `opic-history`, `opic-me`(내 정보), `opic-frames`(뼈대 선택), `opic-review`(복습 일정), `opic-ai-code`(AI 코드), `opic-built`(AI로 만든 답안)

## 비공개 처리

GitHub Pages 무료 플랜은 public 저장소에서만 동작합니다. 그래서 다음 방식으로 주소를 아는 사람만 들어오게 했습니다.

- 저장소 이름에 무작위 문자를 붙여 주소를 추측하기 어렵게 함
- `noindex` 메타 태그와 `robots.txt`로 검색엔진 노출 차단

## 수정과 반영

`index.html`을 고친 뒤 main에 커밋하고 푸시하면 1~2분 뒤 반영됩니다. 친구 폰에서는 새로고침만 하면 됩니다.

## 다음 할 일

1. ~~내 정보 입력으로 예시 정보 자동 치환~~ (완료: 첫 화면 '내 정보', localStorage `opic-me`)
2. ~~유형별 답변 템플릿 훈련~~ (완료: 따라 말하기 ⑤ 묘사·루틴·경험 뼈대, `FRAMES` 데이터, localStorage `opic-frames`)
3. ~~틀렸거나 저장한 문장을 1일/3일/7일 뒤 다시 띄우는 복습~~ (완료: 내 문장 탭 복습, localStorage `opic-review`)
4. ~~내 녹음 다시 듣기(MediaRecorder)~~ (완료: 문장별 '녹음 비교', 실전 모의 비교 화면 '내 녹음과 비교'. 녹음은 메모리에만 있어 새로고침하면 사라짐)
