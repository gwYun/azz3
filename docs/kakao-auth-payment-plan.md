# 카카오 로그인 + 카카오페이(단건결제) 도입 플랜

작성일: 2026-07-29 · 대상 앱: `web/` (Next.js 14 App Router, Vercel)
상태: `/plan-eng-review` 완료 (아웃사이드 보이스 반영). 결정 로그는 문서 하단 참조.

## 1. 목표 & 범위

- **Phase 1 — 카카오 로그인 (← 첫 PR, 이번 구현 범위):** 카카오 OAuth 로그인/로그아웃 + 세션.
- **Phase 2 — 결제 스키마 (후속 PR):** `profiles` / `orders` / `payments` 테이블 + RLS.
- **Phase 3 — 카카오페이 단건결제 (후속 PR):** ready → approve 서버 플로우.

> **스코프 결정:** 첫 PR은 **Phase 1 로그인만**. 결제(2·3)는 사업자·가맹계약·서버 검증이 얽혀 배포 리스크가 커서 별도 PR로 분리. 로그인은 결제의 **전제 인프라**이지 그 자체로 유저 기능은 아님 — 이 점을 QA/노력 산정에서 솔직히 반영(§7).

## 2. 현재 상태 & 제약

- **인증·세션·DB 전무.** `web/package.json` 의존성은 `next`/`react`뿐. `web/.env.local`에 `VERCEL_OIDC_TOKEN`만.
- 대부분 **client component + localStorage**. i18n은 `web/lib/i18n-context.tsx`가 클라이언트에서 관리(SSR 기본값 `ko`).
- 루트 레이아웃 `web/app/layout.tsx`: 서버 컴포넌트가 `I18nProvider`(client) → `ToastProvider` → `Nav`/`Footer`.
- Nav(`web/components/Nav.tsx`)는 `"use client"` — 로그인 버튼 진입점.
- i18n 규칙(`web/lib/i18n.ts`, 939줄): 신규 키는 **`en`·`ko` 양쪽** 필수(TS 강제).
- **`/api/*` 라우팅 주의:** `next.config.js`가 dev에서 `/api/predict`를 Python 서버로 rewrite, `app/api/fx/route.ts`도 존재. 인증 로직이 이 핫패스에 끼지 않게 할 것.
- 모델 추론은 별도 Python serverless(`web/api/predict.py`). 이번 작업과 분리.
- 저장빌드는 `web/lib/storage.ts`가 localStorage 키 `azz3.builds.v1`에 보관(계정 동기화 없음 — §11 TODO).
- 테스트: vitest + happy-dom (예: `web/lib/matchup-sim.test.ts`). E2E(Playwright) 인프라 **없음**.

핵심: 이 앱은 "상태 없는 정적 플레이그라운드"다. **Phase 1이 서버 세션·인증을 도입하는 전환점**이고, 이후는 증분 작업.

## 3. 아키텍처 결정 — Supabase

Auth + Postgres + Kakao provider 통합. 결제까지 갈 때 로그인/사용자/주문·결제를 단일 소스에서 관리. 커스텀 OAuth를 굴리지 않고 공식 provider + `@supabase/ssr` 사용 **[Layer 1]**.

| 항목 | 선택 |
|---|---|
| 인증 | Supabase Auth (Kakao provider) |
| 세션 | `@supabase/ssr` — httpOnly 쿠키. **Phase 1은 클라이언트 세션만** 사용 |
| DB | Supabase Postgres + RLS (Phase 2부터) |
| 결제 | 카카오페이 단건결제 REST (open-api.kakaopay.com, SECRET_KEY 인증) — Phase 3 |

의존성: `@supabase/supabase-js`, `@supabase/ssr`.

**식별키 결정 (OV5):** 계정의 안정 식별자는 **카카오 provider sub(카카오 user id)**. 카카오 이메일은 비즈검수+동의가 있어야 오고 사용자가 거절 가능 → `auth.users.email`이 null일 수 있음. Phase 2 profiles/orders는 email이 아니라 provider sub로 키잉.

## 4. 로그인 데이터 흐름 (Phase 1)

```
사용자      AuthButton(클라)         카카오             Supabase            app/auth/callback/route.ts
  │  클릭       │                                                            
  │───────────>│ signInWithOAuth({provider:'kakao', redirectTo=origin})     
  │            │────────────────────────────────────> authorize             
  │            │                   [카카오 동의창]                            
  │            │                        │                                    
  │  [동의]     │                        │──> <proj>.supabase.co/auth/v1/callback
  │            │                        │        (code | error)             
  │            │<─────────────────────── redirect: /auth/callback?code=…  또는  ?error=…
  │                                                       │
  │                                       ┌───────────────┴─────────────────────────┐
  │                                       │ code 있음 → exchangeCodeForSession        │
  │                                       │            → 세션쿠키 set → redirect(next) │
  │                                       │ error 있음(취소) → redirect(/?auth=canceled)│
  │                                       │ 둘 다 없음 → redirect(/) 안전 폴백          │
  │                                       │ exchange 예외(만료/위조) → catch → 안내     │
  │                                       └──────────────────────────────────────────┘
  │  [로그인됨]  ← AuthButton이 onAuthStateChange 구독으로 하드리로드 없이 갱신
```

## 5. Phase 1 — 카카오 로그인 (이번 구현 범위)

### 사전 준비 (사용자)
- 카카오 Developers 앱: REST API 키 + Client Secret. Redirect URI = `https://<project>.supabase.co/auth/v1/callback` (Supabase 콜백 고정 — 카카오 쪽은 프리뷰 URL과 무관).
- **비즈앱 전환 필요 (제약, 실측 확인):** Supabase 호스티드 Kakao provider(GoTrue `NewKakaoProvider`)가 `account_email profile_image profile_nickname`을 **하드코딩으로 강제 요청**함 — 클라 `scopes`는 append만 되고 "Allow users without an email" 토글도 scope를 못 뺌. `account_email` 동의항목은 **비즈앱에서만** 설정 가능 → **비즈앱 전환(사업자 정보 입력)이 사실상 필수**. 어차피 카카오페이 가맹도 사업자 필수라 트랙 일치. 동의항목: 닉네임(필수/선택) + 프로필사진 + 카카오계정(이메일)은 **선택 동의**, Supabase는 "Allow users without an email" ON.
- Supabase 프로젝트 생성 → Authentication → Providers → **Kakao** 활성화 + 키 입력.
- **리다이렉트 허용목록 (1B + OV4):** Supabase Auth → URL Configuration → Site URL = 프로덕션 도메인. Additional Redirect URLs에 **팀 프리뷰 패턴만** 등록(예: `https://web-*-<team-slug>.vercel.app/**`) — 프리뷰 로그인 커버하되 `*.vercel.app` 전역 와일드카드는 금지(토큰 탈취 벡터).

### 구현 파일
- `web/lib/supabase/server.ts`, `web/lib/supabase/client.ts` — SSR/CSR 클라이언트 팩토리.
- `web/app/auth/callback/route.ts` — **3분기 처리 (CQ3):** `code` → `exchangeCodeForSession` → `next`로 redirect / `error`(취소) → `/?auth=canceled` + 토스트 / 둘 다 없음 → 안전 폴백. exchange는 try/catch로 감싸 만료·위조 code도 안내.
- `web/app/auth/signout/route.ts` — **POST 전용** (CSRF 방지). GET/기타 메서드는 405.
- `web/components/AuthButton.tsx` (client) — 세션을 **클라이언트에서** 읽어 공개 페이지 정적 생성 유지. 로그아웃 시 `signInWithOAuth({provider:'kakao'})`, 로그인 시 닉네임(user_metadata) + 로그아웃(form POST). **`onAuthStateChange` 구독**으로 콜백 후 자동 갱신. Nav 우측 `LangToggle` 옆 배치.
- `web/lib/i18n.ts` — `auth.login` / `auth.logout` / `auth.loginWithKakao` / `auth.canceled` 키를 **en·ko 양쪽** 추가.

### 이번 범위에서 **뺀** 것
- ❌ **`middleware.ts` (OV3):** Phase 1엔 서버측 세션 소비자(보호된 서버 라우트/서버 컴포넌트의 세션 read)가 없음. 브라우저 클라가 토큰 자동갱신. → 미들웨어는 소비자가 생기는 **Phase 2에 도입**. (유지 시 matcher가 `/api/*`+정적자산을 반드시 제외해야 하는데, 아예 안 만들면 그 리스크도 없음.)
- ❌ **`profiles` 테이블 + RLS (1A):** 로그인만이면 `auth.users`(카카오 id·닉네임·이메일)로 충분. profiles는 Phase 2에서 orders와 함께.
- ❌ **Secret key (`sb_secret_…`, = 구 `service_role`) (OV2):** Phase 1엔 소비자 없음(서버 write·admin 없음). RLS 우회 god-key라 조기 도입은 순수 공격면. **Phase 3 결제(금액검증·주문 write) 때 추가.**

### 환경변수 (Phase 1)
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (공개, `sb_publishable_…`) — Vercel env(preview/production)에도 등록. 코드는 legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY`도 폴백 허용(2026년 말 deprecated).
- (Secret key `sb_secret_…` = service_role 대체는 Phase 3에서.)

## 6. Phase 1 — 테스트 (타협 불가, 플랜 필수)

vitest 유닛으로 아래 경로 100% 커버. 파일 네이밍은 기존 컨벤션(`*.test.ts(x)`) 따름.

| 대상 | 테스트 | 종류 |
|---|---|---|
| callback route: `code` 유효 | 세션교환 호출 + `next` redirect (supabase client 모의) | 유닛 |
| callback route: `error`(취소) | `/?auth=canceled` redirect, exchange 미호출 | 유닛 |
| callback route: code·error 없음 | 안전 폴백 redirect | 유닛 |
| callback route: exchange 예외 | catch → 안내 redirect (크래시 없음) | 유닛 |
| signout route | POST 200 + signOut 호출 / GET·PUT → 405 | 유닛 |
| AuthButton | 로그아웃→'카카오 로그인' 렌더, click→`signInWithOAuth` 호출 | 유닛 |
| AuthButton | 로그인→닉네임+로그아웃 렌더 | 유닛 |
| AuthButton | i18n ko/en 라벨 스왑 | 유닛 |

## 7. Phase 1 — 수동 QA ship-gate (OV6, 명시적 게이트)

유닛테스트는 `searchParams` 분기(싼 경로)만 잡고, **진짜 실패모드는 전부 통합/설정**이라 유닛으로 못 잡는다. 아래를 **배포 전 필수 통과 게이트**로 둔다(애프터소트 아님):

- [ ] 실제 **프리뷰 배포**에서 카카오 로그인 1회 성공 (PKCE `code_verifier` 쿠키가 카카오→Supabase→앱 hop을 살아남는지 = 프리뷰 서브도메인 쿠키 도메인 검증).
- [ ] 카카오 동의창에서 **취소** → 친절 안내(크래시 없음).
- [ ] 프로덕션 도메인에서 로그인/로그아웃.
- [ ] 카카오 scope 승인 범위 확인(닉네임만 vs 이메일 — 비즈검수 여부).
- [ ] 로그인 후 새로고침/새 탭에서 세션 유지, `onAuthStateChange`로 버튼 즉시 갱신.

## 8. Phase 2 — 결제 스키마 (후속)

- `public.profiles` — `id (uuid FK auth.users)`, `kakao_sub`(provider sub, 식별키), `nickname`, `email(nullable)`, `created_at`. RLS: 본인만 read/update.
- `public.orders` — `id`, `user_id (FK)`, `item_code`, `amount`, `currency('KRW')`, `status`, `created_at`. RLS: 본인 read.
- `public.payments` — `id`, `order_id (FK)`, `provider('kakaopay')`, `kakao_tid`, `status`, `approved_amount`, `pg_token`, `raw_response(jsonb)`, `created_at/updated_at`. **RLS: 클라이언트 write 차단, service role만.**
- 이 시점에 **`middleware.ts` 도입**(서버측 세션 read 필요) + Supabase **Secret key**(`sb_secret_…`) 추가.
- 상태머신: `orders.status`/`payments.status` = `pending → ready → approved` · `failed` · `canceled`.

## 9. Phase 3 — 카카오페이 단건결제 (후속)

### 사전 준비 (사용자)
- 카카오페이 가맹 신청(사업자등록 보유 → 진행 가능) → **CID 발급**(테스트 CID `TC0ONETIME`로 선개발).
- `KAKAOPAY_SECRET_KEY` 발급.

### 플로우 (Next route handler, 서버)
1. `POST /api/pay/ready` — `orders` `pending` 생성 → `/online/v1/payment/ready`(partner_order_id, partner_user_id, item_name, quantity, total_amount, approval/fail/cancel URL) → `tid`를 `payments`에 저장(`ready`) → 결제창 URL 반환.
2. 사용자 결제 → `approval_url?pg_token=…` redirect.
3. `GET /api/pay/approve` — `pg_token` + 저장 `tid`로 `/online/v1/payment/approve` → **서버에서 승인·금액 검증**(orders 저장값과 대조) → `approved`, `raw_response` 보관.
4. `/api/pay/fail`, `/api/pay/cancel` — 상태 갱신 + 안내.

### 보안 (필수)
- 승인·금액 확정은 **오직 서버**. 클라이언트 값 신뢰 금지. `ready`의 `tid`↔approve order 매칭(위조 방지) + **멱등**(중복 approve 방지).
- 단건결제 approve는 동기(redirect→서버 approve)라 웹훅 불필요하나, redirect↔approve 사이 네트워크 실패로 `ready`에 멈춘 주문 대비 **조회/정합(reconcile) 경로** 필요.
- 시크릿(Supabase Secret key `sb_secret_…`, `KAKAOPAY_SECRET_KEY`)은 서버 라우트에서만.

## 10. NOT in scope (명시적 제외)

- **정기결제/구독(SID)** — 별도 계약·API. 단건 우선 결정. Phase 4로 분리.
- **`middleware.ts` (Phase 1)** — 서버측 세션 소비자 없어 Phase 2로.
- **`profiles` 테이블 (Phase 1)** — `auth.users`로 충분, Phase 2로.
- **`SUPABASE_SERVICE_ROLE_KEY` (Phase 1)** — 소비자 없어 Phase 3로.
- **Playwright E2E 인프라** — 신규 인프라. Phase 1은 유닛+수동QA, 결제(Phase 3) 때 도입(결제 플로우는 E2E 강력 권장).
- **저장빌드 계정 동기화** — 로그인에 실질 가치를 주는 기능이나 DB 스키마를 Phase 1로 당기게 됨. 별도 판단(§11 TODO).
- **환불 자동화 / 영수증 / 관리자 대시보드** — 후속.
- **다중 소셜 로그인** — 카카오만.

## 11. What already exists (재사용 / 재구축 점검)

- `auth.users` (Supabase 제공) — 카카오 id·닉네임·이메일 보관. → profiles를 Phase 1에 **재구축하지 않고** 재사용.
- `web/lib/storage.ts` (localStorage `azz3.builds.v1`) — 저장빌드. 계정 동기화 시 이 저장소를 서버로 승격(재구축 아님). **TODO 대상**(OV1).
- `web/lib/i18n.ts` — 이중언어 인프라. 인증 문자열은 여기에 추가(신규 i18n 시스템 만들지 않음).
- vitest + happy-dom — 기존 테스트 하네스 재사용(신규 러너 도입 없음).
- `web/lib/toast-context.tsx` — 취소/에러 안내 토스트에 재사용.

## 12. 실패 모드 (Phase 1 신규 코드패스)

| 코드패스 | 실패 시나리오 | 테스트 | 에러처리 | 사용자 체감 |
|---|---|---|---|---|
| callback: exchange | 만료/위조 code | 유닛(모의) | try/catch → 안내 redirect | 명확한 안내 |
| callback: error param | 사용자 취소 | 유닛 | 명시 분기 | "로그인 취소" 토스트 |
| callback: PKCE 쿠키 | 프리뷰 서브도메인서 code_verifier 유실 | ❌ 유닛 불가 | exchange 실패→안내 | 명확(무음 아님) → **수동QA 게이트로 커버** |
| AuthButton: signInWithOAuth | 네트워크 실패 | 유닛(모의) | try/catch + 토스트 | 재시도 안내 |
| signout | 세션 삭제 실패 | 유닛 | 에러 토스트 | 재시도 안내 |

→ **무음 실패 없음.** 가장 위험한 미자동화 경로(PKCE/쿠키)는 에러처리가 있고 가시적이라 critical gap은 아니며, §7 수동QA 게이트가 필수 통과 조건. **critical gaps: 0.**

## 13. 병렬화 전략

Phase 1은 대부분 단일 모듈(auth: `lib/supabase/`, `app/auth/`, `components/AuthButton`)을 건드리고 상호 의존적. **순차 구현, 병렬화 기회 없음.**

## 14. Implementation Tasks
이 리뷰 findings에서 도출. Claude Code/Codex로 실행, 체크박스로 진행.

- [ ] **T1 (P1, human: ~1h / CC: ~10min)** — infra — Supabase 프로젝트+Kakao provider 설정, env 2개 등록, 리다이렉트 허용목록 팀 프리뷰 패턴만
  - Surfaced by: 아키텍처 1B + OV4
  - Files: `web/.env.local`, Vercel env, Supabase 콘솔
  - Verify: 로컬 로그인 1회
- [ ] **T2 (P1, human: ~30min / CC: ~5min)** — auth — `lib/supabase/server.ts` + `client.ts` 팩토리
  - Files: `web/lib/supabase/`
  - Verify: 타입체크 통과
- [ ] **T3 (P1, human: ~2h / CC: ~15min)** — auth — `app/auth/callback/route.ts` code/error/폴백 3분기 + exchange try/catch
  - Surfaced by: 코드품질 3 (CQ3)
  - Files: `web/app/auth/callback/route.ts`
  - Verify: 유닛 3분기 + 예외 케이스
- [ ] **T4 (P1, human: ~20min / CC: ~5min)** — auth — `app/auth/signout/route.ts` POST 전용(405 가드)
  - Files: `web/app/auth/signout/route.ts`
  - Verify: POST 200 / GET 405 유닛
- [ ] **T5 (P1, human: ~2h / CC: ~15min)** — ui — `components/AuthButton.tsx` 클라 세션 read + `onAuthStateChange` + Nav 배치
  - Surfaced by: 성능 리뷰(정적 유지) + OV note
  - Files: `web/components/AuthButton.tsx`, `web/components/Nav.tsx`
  - Verify: 렌더/클릭/i18n 유닛 + 수동 갱신 확인
- [ ] **T6 (P1, human: ~20min / CC: ~5min)** — i18n — `auth.*` 키 en+ko
  - Files: `web/lib/i18n.ts`
  - Verify: 타입체크(양쪽 키 강제)
- [ ] **T7 (P1, human: ~3h / CC: ~20min)** — test — 콜백/signout/AuthButton 유닛 풀커버리지
  - Surfaced by: 테스트 리뷰(커버리지 0→100%)
  - Files: `web/app/auth/**/*.test.ts`, `web/components/AuthButton.test.tsx`
  - Verify: `yarn test`
- [ ] **T8 (P1, human: ~30min / CC: ~30min)** — qa — §7 수동 QA ship-gate 체크리스트 실행
  - Surfaced by: OV6
  - Verify: 프리뷰 실 로그인/취소/재기기 통과

## 15. 결정 로그

- [x] 스택: **Supabase** / 사업자등록: **보유** / 결제: **단건 우선**
- [x] Step0: 첫 PR = **Phase 1 로그인만**
- [x] 1A: `profiles` **Phase 2로 미룸** (auth.users만)
- [x] 1B+OV4: 프리뷰 리다이렉트 = **팀 프리뷰 패턴 와일드카드**(전역 `*.vercel.app` 금지)
- [x] CQ3: 콜백 **취소·에러·성공 3경로** 처리 / signout **POST**
- [x] T3: **유닛 풀커버리지 + 수동QA**, E2E는 결제 때
- [x] OV2: `SUPABASE_SERVICE_ROLE_KEY` **Phase 1에서 제거**
- [x] OV3: `middleware.ts` **Phase 1에서 제거**(Phase 2 도입)
- [x] OV5: 식별키 = **provider sub**(not email)
- [x] OV6: **수동 QA ship-gate** 명시
- [x] OV1: 저장빌드 동기화 = **TODO로 보류**(§16)
- [ ] (열림) 이메일 동의항목 필요 여부 → 비즈앱 검수 여부
- [ ] (열림) 로그인 후 리다이렉트 목적지 / 게이팅 대상 페이지

## 16. TODOS (별도 판단)

- **저장빌드 계정 동기화 (OV1, 보류):** 로그인이 게이팅할 첫 실기능. `web/lib/storage.ts`의 localStorage `azz3.builds.v1`를 계정 스코프 DB 테이블(+RLS)로 승격 → 기기 간 동기화. **왜:** 현재 Phase 1 로그인은 유저 체감 가치가 없음(인프라 토대). 이걸 붙이면 로그인이 도그푸딩 가능한 기능이 됨. **의존:** Phase 2 DB 도입과 함께 하면 자연스러움. **결정 필요:** Phase 1에 당길지 vs Phase 2와 묶을지.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open→folded | 4 리뷰 findings + 6 아웃사이드 보이스, 전부 결정 반영 |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **CROSS-MODEL:** 아웃사이드 보이스(Claude 서브에이전트)가 미들웨어 과설계(OV3)·service key 조기도입(OV2)·와일드카드 과대범위(OV4)를 지적, 모두 리뷰 결정에 반영. OV1(로그인 가치)은 TODO로 보류. Codex 미설치로 서브에이전트 대체.
- **VERDICT:** ENG CLEARED — Phase 1 구현 준비 완료. 요약: 12 findings 전부 결정 반영, critical gaps 0, 테스트 0→100% 계획, Phase 1에서 middleware·profiles·service-key 제거로 최소·안전 스코프 확정.

NO UNRESOLVED DECISIONS
