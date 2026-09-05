# FlowDesk Brain Operational Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Existing Brain foundation ko ek real, end-to-end client-hunting system banana jo scoped social captures ko durable jobs ke through process kare, evidence-backed opportunities banaye, review karwaye, aur Agent ko cited action brief de.

**Architecture:** Brain utility process SQLite ka single writer aur recipe-state owner rahega. Electron main sirf authenticated WhatsApp/LinkedIn capability calls execute karega; normalized records utility process mein deterministic pipeline se sources, evidence, clusters aur opportunities mein convert honge. Renderer project/client scope select karega aur raw messages ke bajaye cited intelligence dekhega.

**Tech Stack:** Electron 41, React 18, TypeScript, Node 24 `node:sqlite`, FTS5, Zod, Vitest, existing WhatsApp/LinkedIn reverse-engineered read connectors.

**Spec:** `docs/brain-architecture.md`

## Global Constraints

- Reddit live capture, posting, DMs, karma automation aur protection bypass is batch ka hissa nahi.
- Public Reddit API use nahi hogi; Reddit ka implementation captured browser/network evidence ke baad separate plan mein hoga.
- Raw social content Markdown vault mein nahi jayega.
- External content trusted instruction ya accepted memory auto-create nahi karega.
- Cross-client aur cross-project retrieval hard scope isolation enforce karegi.
- Private capture ke liye scope + recipe + provider consent lazmi hai.
- Raw capture retention default 30 din aur per recipe configurable rahegi.
- Agent context default 1,200 estimated tokens aur hard maximum 2,000 rahega.
- Renderer ko raw SQL, arbitrary filesystem mutation ya arbitrary recipe execution access nahi milega.
- Existing uncommitted `electron/studio/render.ts`, `electron/studio/render.test.ts`, aur `docs/superpowers/FLOWDESK-TECHNICAL-SUMMARY.md` changes untouched rahengi.
- Har task test-first, focused commit, phir `npm run typecheck` ke saath close hoga.

---

## File map

### Create

- `electron/brain/capabilityProtocol.ts` — utility ↔ main connector request/response schemas.
- `electron/brain/jobRunner.ts` — leases, heartbeat, checkpoints, retries aur recipe execution loop.
- `electron/brain/intelligenceProcessor.ts` — deterministic feature extraction, clustering aur scoring.
- `electron/brain/recipeDefinitions.ts` — executable recipe definitions and step names.
- `electron/brain/scheduler.ts` — in-app monitor scheduling and due-job enqueueing.
- `src/components/brain/ScopePicker.tsx` — Global/Project/Client scope selection.
- `src/components/intelligence/OpportunityCard.tsx` — cited opportunity presentation and review actions.
- `src/components/intelligence/DecisionBrief.tsx` — compact multi-source recommendation view.
- `electron/brain/*.test.ts` and `src/components/**/*.test.tsx` — focused regression coverage.

### Modify

- `src/types/brain.ts` — opportunity, monitor, source and capability contracts.
- `electron/brain/database.ts` — schema v2 migrations and repositories.
- `electron/brain/protocol.ts` — narrow public requests for scopes, opportunities, monitors and briefs.
- `electron/brain/service.ts` — job runner, processor and scheduler ownership.
- `electron/brain/utility.ts` — bidirectional capability messages.
- `electron/brain/client.ts` — capability request routing and restart-safe correlation.
- `electron/brain/electronClient.ts` — authenticated connector gateway binding.
- `electron/main.ts` — remove inline social processing; provide connector capabilities and confirmations.
- `electron/agent/brainTools.ts` — real decision brief and opportunity review tools.
- `electron/preload.ts` and `src/types/electron.d.ts` — typed narrow renderer APIs.
- `src/pages/Brain.tsx` — scope-aware content and provenance drill-down.
- `src/pages/Intelligence.tsx` — live tabs for signals, opportunities, monitors and briefs.
- `src/lib/jarvisSettingsMigration.ts` — avoid clearing legitimate user-entered credentials.
- `docs/brain-architecture.md` — operational flow and recovery updates.

---

### Task 1: Runtime safety baseline aur credential migration correction

**Files:**
- Modify: `src/lib/jarvisSettingsMigration.ts`
- Modify: `src/lib/jarvisSettingsMigration.test.ts`
- Create: `electron/brain/runtimeSmoke.test.ts`
- Test: `electron/securityPrerequisites.test.ts`

**Interfaces:**
- Consumes: `migrateJarvisSettings(input)` and built `out/main/brainUtility.js`.
- Produces: safe one-time migration jo sirf known shipped defaults ke hashes clear kare aur genuine user credentials preserve kare.

- [ ] **Step 1: Legitimate credential preservation ka failing test likhein**

```ts
it('preserves credentials entered by the user', () => {
  const result = migrateJarvisSettings({
    jarvisSettings: {
      geminiApiKey: 'user-key',
      livekitUrl: 'wss://user.example',
      livekitApiKey: 'user-livekit-key',
      livekitApiSecret: 'user-livekit-secret',
    },
  })
  expect(result.settings.geminiApiKey).toBe('user-key')
  expect(result.settings.livekitApiSecret).toBe('user-livekit-secret')
})
```

- [ ] **Step 2: Focused test ko RED prove karein**

Run: `npx vitest run src/lib/jarvisSettingsMigration.test.ts`

Expected: user-entered values empty hone ki wajah se FAIL.

- [ ] **Step 3: Plaintext secret dobara source mein rakhe baghair hash allowlist implement karein**

```ts
function shouldClear(value: string | undefined, compromisedHashes: ReadonlySet<string>) {
  if (!value) return false
  return compromisedHashes.has(sha256(value))
}
```

Browser-compatible SHA-256 helper ko `src/lib/jarvisSettingsMigration.ts` mein deterministic pure implementation rakhein; known leaked values ke sirf hashes store hon. Har field tabhi clear ho jab us ka hash known shipped default se match kare.

- [ ] **Step 4: Utility packaged-entry smoke test likhein**

Test ko temporary userData directory ke saath `BrainService` start karna, `status.ready === true`, `fts5 === true`, shutdown aur SQLite reopen verify karna hai.

- [ ] **Step 5: Security aur type verification chalayein**

Run: `npx vitest run src/lib/jarvisSettingsMigration.test.ts electron/securityPrerequisites.test.ts electron/brain/runtimeSmoke.test.ts`

Run: `npm run typecheck`

Expected: tamam commands PASS.

- [ ] **Step 6: Focused commit karein**

```powershell
git add src/lib/jarvisSettingsMigration.ts src/lib/jarvisSettingsMigration.test.ts electron/securityPrerequisites.test.ts electron/brain/runtimeSmoke.test.ts
git commit -m "fix: harden Brain startup and credential migration"
```

---

### Task 2: Scope selection ko real project/client workflow se connect karna

**Files:**
- Modify: `src/types/brain.ts`
- Modify: `electron/brain/database.ts`
- Modify: `electron/brain/protocol.ts`
- Modify: `electron/brain/service.ts`
- Modify: `electron/preload.ts`
- Modify: `src/types/electron.d.ts`
- Create: `src/components/brain/ScopePicker.tsx`
- Create: `src/components/brain/ScopePicker.test.tsx`
- Modify: `src/pages/Brain.tsx`
- Modify: `src/pages/Intelligence.tsx`

**Interfaces:**
- Consumes: existing `BrainScope`, `ensureScope()` and FlowDesk `projectList()`.
- Produces: `brainListScopes(input?: { types?: BrainScopeType[] }): Promise<BrainScope[]>` aur reusable `<ScopePicker />`.

- [ ] **Step 1: Scope repository ka failing isolation test likhein**

```ts
it('lists only requested project and client scopes', () => {
  const project = brain.ensureScope({ type: 'project', externalRef: 'p1', name: 'Project' })
  brain.ensureScope({ type: 'session', externalRef: 's1', name: 'Session', parentId: project.id })
  expect(brain.listScopes(['project', 'client']).map(scope => scope.type)).toEqual(['project'])
})
```

- [ ] **Step 2: Test RED run karein**

Run: `npx vitest run electron/brain/database.test.ts`

Expected: `listScopes` missing hone par FAIL.

- [ ] **Step 3: Typed scope query implement karein**

```ts
listScopes(types?: BrainScopeType[]): BrainScope[]
```

Dynamic SQL values placeholders se bind hon; empty filter tamam scopes return kare. Protocol payload maximum five enum values accept kare.

- [ ] **Step 4: ScopePicker behavior test likhein**

Test verify kare ke selected scope change `onChange(scopeId)` call karta hai aur current type/name visible hota hai.

- [ ] **Step 5: Brain aur Intelligence pages mein persisted scope selection wire karein**

Selection key `flowdeskBrainActiveScopeId` ho. Missing/deleted selection par active FlowDesk project scope, warna Global fallback ho. Har query, capture, memory, graph aur job selected scope use kare.

- [ ] **Step 6: Focused verification aur commit karein**

Run: `npx vitest run electron/brain/database.test.ts src/components/brain/ScopePicker.test.tsx src/lib/brainUi.test.ts`

Run: `npm run typecheck`

```powershell
git add src/types/brain.ts electron/brain/database.ts electron/brain/protocol.ts electron/brain/service.ts electron/preload.ts src/types/electron.d.ts src/components/brain/ScopePicker.tsx src/components/brain/ScopePicker.test.tsx src/pages/Brain.tsx src/pages/Intelligence.tsx
git commit -m "feat: add project and client Brain scopes"
```

---

### Task 3: Utility-owned durable recipe runner aur typed connector gateway

**Files:**
- Create: `electron/brain/capabilityProtocol.ts`
- Create: `electron/brain/capabilityProtocol.test.ts`
- Create: `electron/brain/jobRunner.ts`
- Create: `electron/brain/jobRunner.test.ts`
- Create: `electron/brain/recipeDefinitions.ts`
- Modify: `electron/brain/utility.ts`
- Modify: `electron/brain/client.ts`
- Modify: `electron/brain/electronClient.ts`
- Modify: `electron/brain/service.ts`
- Modify: `electron/main.ts`

**Interfaces:**
- Consumes: `BrainDatabase.claimNextJob()`, `heartbeatJob()`, `saveCheckpoint()`, existing `waListChats`, `liFeed`, `liSearch`.
- Produces: `BrainCapabilityRequest`, `BrainCapabilityResult`, `BrainJobRunner.start()` aur restart-safe connector execution.

- [ ] **Step 1: Capability boundary rejection tests likhein**

```ts
expect(() => capabilityRequestSchema.parse({ id: '1', capability: 'shell', input: {} })).toThrow()
expect(capabilityRequestSchema.parse({
  id: '1', capability: 'linkedin.search',
  input: { query: 'hiring developer', limit: 50 },
}).capability).toBe('linkedin.search')
```

- [ ] **Step 2: Job runner crash/checkpoint failing tests likhein**

Tests verify karein:

- claimed step har 10 seconds heartbeat renew karta hai;
- same checkpoint dobara write idempotent hai;
- connector error 5s, 30s, 2m retry schedule use karta hai;
- login error `waiting_for_login` aur consent error `waiting_for_approval` banata hai;
- cancellation ke baad next step execute nahi hota;
- utility restart expired lease se resume karta hai.

- [ ] **Step 3: Tests ko RED prove karein**

Run: `npx vitest run electron/brain/capabilityProtocol.test.ts electron/brain/jobRunner.test.ts`

Expected: new modules missing hone par FAIL.

- [ ] **Step 4: Narrow bidirectional protocol implement karein**

```ts
type BrainCapabilityRequest =
  | { id: string; capability: 'whatsapp.list_unread'; input: { limit: number } }
  | { id: string; capability: 'linkedin.feed'; input: { limit: number; sort: 'RECENT' } }
  | { id: string; capability: 'linkedin.search'; input: { query: string; limit: number } }
```

Utility arbitrary capability names accept na kare. Main structured result ya typed `login_required | approval_required | transient | permanent` error return kare.

- [ ] **Step 5: Recipe definitions ko executable step handlers dein**

`whatsapp.unread_intelligence` aur `linkedin.opportunity_scan` ke steps `capture → normalize → classify → score → summarize` hon. Har step prior checkpoint consume kare aur compact checkpoint produce kare.

- [ ] **Step 6: Inline `brain:runSocialRecipe` execution remove karke enqueue-only karein**

Renderer call ko job ID foran return ho. Connector execution `BrainJobRunner` kare; main sirf capability gateway rahe. Raw records IPC response mein renderer tak na jayen.

- [ ] **Step 7: Verification aur commit karein**

Run: `npx vitest run electron/brain/capabilityProtocol.test.ts electron/brain/jobRunner.test.ts electron/brain/database.test.ts electron/brain/client.test.ts`

Run: `npm run typecheck`

```powershell
git add electron/brain/capabilityProtocol.ts electron/brain/capabilityProtocol.test.ts electron/brain/jobRunner.ts electron/brain/jobRunner.test.ts electron/brain/recipeDefinitions.ts electron/brain/utility.ts electron/brain/client.ts electron/brain/electronClient.ts electron/brain/service.ts electron/main.ts
git commit -m "feat: execute Brain recipes with durable workers"
```

---

### Task 4: Intelligence schema v2 aur evidence-backed opportunity repository

**Files:**
- Modify: `src/types/brain.ts`
- Modify: `electron/brain/database.ts`
- Modify: `electron/brain/database.test.ts`
- Modify: `electron/brain/protocol.ts`
- Modify: `electron/brain/service.ts`

**Interfaces:**
- Consumes: normalized `CaptureEnvelope`, existing `sources`, `claims`, `evidence`, `entities`.
- Produces: `BrainOpportunity`, `OpportunityEvidence`, `BrainMonitor`, schema version 2 and narrow list/review APIs.

- [ ] **Step 1: Public types define karein**

```ts
interface BrainOpportunity {
  id: string
  scopeId: string
  category: OpportunityCategory
  title: string
  summary: string
  score: number
  confidence: number
  freshness: string
  status: 'new' | 'reviewing' | 'qualified' | 'dismissed' | 'converted'
  evidenceCount: number
  createdAt: string
  updatedAt: string
}
```

- [ ] **Step 2: v1 → v2 migration failing tests likhein**

Tests empty DB, existing v1 DB aur half-created v2 tables cover karein. Expected tables: `opportunities`, `opportunity_evidence`, `monitors`, `source_metrics`; `PRAGMA user_version` exactly `2` ho.

- [ ] **Step 3: Transactional idempotent migration implement karein**

`opportunities` par `(scope_id, fingerprint)` unique ho. `opportunity_evidence` par `(opportunity_id, evidence_id)` unique ho. Score 0–100 aur confidence 0–1 repository boundary par clamp hon.

- [ ] **Step 4: Scope-safe repository tests aur implementation karein**

```ts
listOpportunities(input: { scopeId: string; status?: BrainOpportunity['status']; limit?: number }): BrainOpportunity[]
reviewOpportunity(input: { id: string; scopeId: string; decision: 'qualify' | 'dismiss' | 'convert' }): BrainOpportunity
getOpportunityEvidence(input: { id: string; scopeId: string }): OpportunityEvidence[]
```

Wrong scope same ID ke liye `not found` return kare; cross-client leakage kabhi na ho.

- [ ] **Step 5: IPC schemas aur service handlers add karein**

Renderer methods sirf list, evidence drill-down aur review expose karein. Create/update operations recipe processor ke liye internal rahen.

- [ ] **Step 6: Verification aur commit karein**

Run: `npx vitest run electron/brain/database.test.ts electron/brain/protocol.test.ts electron/brain/service.test.ts`

Run: `npm run typecheck`

```powershell
git add src/types/brain.ts electron/brain/database.ts electron/brain/database.test.ts electron/brain/protocol.ts electron/brain/service.ts
git commit -m "feat: persist evidence-backed opportunities"
```

---

### Task 5: Deterministic intelligence processor aur cross-source correlation

**Files:**
- Create: `electron/brain/intelligenceProcessor.ts`
- Create: `electron/brain/intelligenceProcessor.test.ts`
- Modify: `electron/brain/intelligence.ts`
- Modify: `electron/brain/artifactStore.ts`
- Modify: `electron/brain/jobRunner.ts`

**Interfaces:**
- Consumes: normalized records, scope ICP terms, source-relative metrics and repository methods from Task 4.
- Produces: deduplicated sources/evidence, opportunity clusters, scores, summaries and cited artifact manifest.

- [ ] **Step 1: Golden fixtures define karein**

Fixture set mein yeh cases hon:

- direct “looking for React developer” post;
- generic tech discussion jo lead nahi;
- same pain LinkedIn aur WhatsApp par paraphrased;
- old high-engagement post;
- spam/self-promotion risk;
- same display name with different unverifiable identities.

- [ ] **Step 2: Expected classifications ka failing test likhein**

```ts
expect(result.opportunities[0]).toMatchObject({ category: 'direct_lead', score: expect.any(Number) })
expect(result.opportunities[0].evidence).toHaveLength(2)
expect(result.entities.filter(entity => entity.name === 'Alex')).toHaveLength(2)
```

- [ ] **Step 3: Deterministic signal extraction implement karein**

Feature functions separately export hon:

```ts
extractBuyerIntent(text: string): number
extractPainSeverity(text: string): number
extractRisk(text: string): number
calculateRecency(observedAt: string | null, now: string): number
```

Keywords configuration recipe definition mein ho; raw text system instruction ke taur par execute na ho.

- [ ] **Step 4: Safe clustering aur cross-source support implement karein**

Exact canonical URL, verified handle, normalized domain aur deterministic topic tokens use hon. Fuzzy person identity merge prohibited rahe. Cross-source support sirf two distinct source platforms ke evidence par boost ho.

- [ ] **Step 5: Source-relative momentum implement karein**

Engagement har platform ke andar percentile mein normalize ho. WhatsApp unread count ko LinkedIn reactions se direct compare na karein.

- [ ] **Step 6: Processor ko recipe steps aur manifest se wire karein**

Manifest mein `records`, `deduplicated`, `opportunities`, `qualifiedCandidates`, `coverage`, `warnings`, `failures`, hashes aur citation handles hon; raw payload nahi.

- [ ] **Step 7: Verification aur commit karein**

Run: `npx vitest run electron/brain/intelligence.test.ts electron/brain/intelligenceProcessor.test.ts electron/brain/artifactStore.test.ts electron/brain/jobRunner.test.ts`

Run: `npm run typecheck`

```powershell
git add electron/brain/intelligence.ts electron/brain/intelligenceProcessor.ts electron/brain/intelligenceProcessor.test.ts electron/brain/artifactStore.ts electron/brain/jobRunner.ts
git commit -m "feat: derive cited client opportunities"
```

---

### Task 6: Review Inbox, Intelligence tabs aur real decision brief

**Files:**
- Create: `src/components/intelligence/OpportunityCard.tsx`
- Create: `src/components/intelligence/OpportunityCard.test.tsx`
- Create: `src/components/intelligence/DecisionBrief.tsx`
- Modify: `src/pages/Intelligence.tsx`
- Modify: `src/pages/Brain.tsx`
- Modify: `electron/agent/brainTools.ts`
- Modify: `electron/agent/brainTools.test.ts`
- Modify: `electron/brain/protocol.ts`
- Modify: `electron/brain/service.ts`
- Modify: `electron/preload.ts`
- Modify: `src/types/electron.d.ts`

**Interfaces:**
- Consumes: opportunity/evidence APIs and selected scope.
- Produces: usable Pain Points, Trends, Opportunities, Decision Briefs views and `buildDecisionBrief()`.

- [ ] **Step 1: Opportunity card behavior test likhein**

Test scope, category, score, confidence, freshness, evidence count, citations aur qualify/dismiss actions verify kare.

- [ ] **Step 2: Decision brief contract define karein**

```ts
interface BrainDecisionBrief {
  question: string
  recommendation: string
  supportingSignals: Array<{ text: string; citation: BrainCitation }>
  counterSignals: Array<{ text: string; citation: BrainCitation }>
  risks: string[]
  nextActions: string[]
  estimatedTokens: number
}
```

- [ ] **Step 3: Brief builder failing tests likhein**

Tests zero evidence, conflicting evidence, superseded claims, 1,200-token budget aur citation integrity cover karein.

- [ ] **Step 4: Deterministic brief builder implement karein**

Recommendation evidence ranking se nikle; unsupported sentence produce na ho. External text instructions ignore hon. Har support/counter-signal ke paas stored source reference ho.

- [ ] **Step 5: Agent tool ko real brief endpoint par wire karein**

`brain_build_decision_brief` ab generic search result return na kare; typed `buildDecisionBrief` service request call kare. `brain_review_opportunity` tool approval ke saath qualify/dismiss/convert action expose kare.

- [ ] **Step 6: Intelligence tabs ko live data dein**

- Pain Points: repetition aur severity descending clusters.
- Trends: source-relative momentum aur date window.
- Opportunities: new/reviewing/qualified filters.
- Decision Briefs: question input, cited answer aur next actions.
- Sources: last capture, record count, consent state aur errors.

- [ ] **Step 7: Verification aur commit karein**

Run: `npx vitest run src/components/intelligence/OpportunityCard.test.tsx electron/agent/brainTools.test.ts electron/brain/service.test.ts`

Run: `npm run typecheck`

```powershell
git add src/components/intelligence/OpportunityCard.tsx src/components/intelligence/OpportunityCard.test.tsx src/components/intelligence/DecisionBrief.tsx src/pages/Intelligence.tsx src/pages/Brain.tsx electron/agent/brainTools.ts electron/agent/brainTools.test.ts electron/brain/protocol.ts electron/brain/service.ts electron/preload.ts src/types/electron.d.ts
git commit -m "feat: add intelligence review and decision briefs"
```

---

### Task 7: Actionable-only monitors aur controlled Agent continuation

**Files:**
- Create: `electron/brain/scheduler.ts`
- Create: `electron/brain/scheduler.test.ts`
- Modify: `electron/brain/database.ts`
- Modify: `electron/brain/service.ts`
- Modify: `electron/brain/protocol.ts`
- Modify: `electron/preload.ts`
- Modify: `src/types/electron.d.ts`
- Modify: `src/pages/Intelligence.tsx`
- Modify: `electron/agent/continuations.ts`
- Modify: `electron/agent/continuations.test.ts`

**Interfaces:**
- Consumes: v2 `monitors`, durable recipe enqueue and continuation outbox.
- Produces: create/pause/resume/delete monitor APIs and exactly-once actionable Agent resumes.

- [ ] **Step 1: Scheduler clock tests likhein**

Fake timers se verify karein:

- due active monitor aik job enqueue karta hai;
- paused monitor kuch enqueue nahi karta;
- app start par missed intervals aik run mein coalesce hotay hain;
- same time window duplicate job nahi banata;
- FlowDesk process band hone par external service create nahi hoti.

- [ ] **Step 2: Tests RED run karein**

Run: `npx vitest run electron/brain/scheduler.test.ts`

Expected: scheduler missing hone par FAIL.

- [ ] **Step 3: Monitor model aur scheduler implement karein**

```ts
interface BrainMonitor {
  id: string
  scopeId: string
  recipeId: string
  intervalMinutes: number
  status: 'active' | 'paused'
  lastRunAt: string | null
  nextRunAt: string
}
```

Minimum interval 15 minutes ho. Scheduler 60-second tick use kare aur utility process ke saath stop ho.

- [ ] **Step 4: Actionability threshold enforce karein**

Continuation sirf tab queue ho jab at least aik new opportunity configured threshold meet kare. Default threshold `70`; unchanged opportunity fingerprints notification create na karein.

- [ ] **Step 5: Monitor UI implement karein**

UI recipe, scope, interval, minimum score, last run, next run, status, pause/resume aur delete confirmation dikhaye.

- [ ] **Step 6: Exactly-once continuation regression run karein**

Same session mein 10-second window ke multiple jobs aik compact Agent turn mein coalesce hon. Active manual Agent turn interrupt na ho.

- [ ] **Step 7: Verification aur commit karein**

Run: `npx vitest run electron/brain/scheduler.test.ts electron/agent/continuations.test.ts electron/brain/database.test.ts`

Run: `npm run typecheck`

```powershell
git add electron/brain/scheduler.ts electron/brain/scheduler.test.ts electron/brain/database.ts electron/brain/service.ts electron/brain/protocol.ts electron/preload.ts src/types/electron.d.ts src/pages/Intelligence.tsx electron/agent/continuations.ts electron/agent/continuations.test.ts
git commit -m "feat: add actionable intelligence monitors"
```

---

### Task 8: End-to-end acceptance, recovery aur operator documentation

**Files:**
- Create: `electron/brain/operationalAcceptance.test.ts`
- Modify: `electron/brain/backup.test.ts`
- Modify: `electron/brain/vault.test.ts`
- Modify: `docs/brain-architecture.md`
- Create: `docs/brain-operations.md`

**Interfaces:**
- Consumes: tamam prior task contracts.
- Produces: release gate proving capture se cited Agent action tak full loop.

- [ ] **Step 1: End-to-end acceptance test likhein**

Test fixture connector se records de, durable steps run kare, restart inject kare, opportunity persist kare, evidence resolve kare, decision brief banaye aur exactly one continuation consume kare.

- [ ] **Step 2: Privacy and isolation acceptance test likhein**

Do client scopes create karein. Client A source aur opportunity Client B search, brief, graph aur list response mein appear na hon. Raw message prompt pack aur backup archive mein na ho.

- [ ] **Step 3: Retention and deletion acceptance test likhein**

31-day raw capture purge file delete kare, dependent evidence ko stale mark kare, aur opportunity ko `reviewing` state mein le aaye; accepted memory ki locator/hash provenance rahe.

- [ ] **Step 4: Backup v2 tests extend karein**

Fresh profile restore scopes, opportunities, monitors aur curated vault preserve kare. Cookies, credentials, raw artifacts aur unsafe paths absent/rejected hon.

- [ ] **Step 5: Operations guide likhein**

Guide mein scope setup, consent, recipe run, monitor lifecycle, vault conflict, backup restore, degraded utility recovery aur data purge ke exact UI steps hon.

- [ ] **Step 6: Full release gate chalayein**

Run:

```powershell
npm run typecheck
npm test
npm run build
Test-Path out/main/brainUtility.js
git diff --check
```

Expected: typecheck/test/build PASS, utility path `True`, diff check clean.

- [ ] **Step 7: Main working copy par manual smoke karein**

FlowDesk launch karke yeh sequence verify karein:

1. Project scope select.
2. LinkedIn capture consent grant.
3. Job progress observe.
4. Cited opportunity qualify.
5. Agent se decision brief mangwana.
6. Temporary Agent mode mein durable Brain writes absent verify karna.
7. Backup export aur fresh temporary profile import.

- [ ] **Step 8: Final commit karein**

```powershell
git add electron/brain/operationalAcceptance.test.ts electron/brain/backup.test.ts electron/brain/vault.test.ts docs/brain-architecture.md docs/brain-operations.md
git commit -m "test: verify operational Brain intelligence loop"
```

---

## Release gate aur us ke baad Reddit

Is plan ke baad Reddit ke liye separate capture-first plan banega. Us ka start tab hoga jab:

- LinkedIn/WhatsApp se capture → opportunity → brief loop manual smoke pass kare;
- false-positive sample par opportunity precision acceptable ho;
- consent, retention aur identity non-merge tests green hon;
- durable job restart recovery packaged app mein prove ho.

Reddit phase ka pehla kaam live authenticated traffic capture aur fixtures hoga. Capture evidence ke baghair endpoints, schemas ya posting behavior guess nahi kiye jayenge.

## Self-review result

- Spec coverage: operational jobs, scope isolation, evidence, opportunities, monitoring, continuations, retention, backup aur UI covered hain.
- Intentionally deferred: live Reddit connector, automated posting/DMs, cloud sync, embeddings aur Windows service.
- Placeholder scan: execution ke liye undefined tasks ya open implementation blanks nahi rakhe gaye.
- Type consistency: `BrainOpportunity`, `BrainMonitor`, `BrainDecisionBrief`, capability names aur IPC method names har dependent task mein consistent hain.
