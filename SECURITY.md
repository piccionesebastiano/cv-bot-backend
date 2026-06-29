# Security Analysis — CV Bot Backend

Data analisi: 2026-06-25

---

## 🔴 ALTA

### 1. Nessun timeout sulle chiamate fetch
**File:** `chat.service.ts`, `semantic-cache.service.ts`

Una risposta lenta o hanging da OpenRouter/embeddings blocca il thread per sempre ed esaurisce le connessioni disponibili.

**Fix:** `AbortController` con timeout di 15s sulle chiamate LLM, 10s sugli embedding.

---

### 2. Nessun limite esplicito sul body
**File:** `main.ts`

Express accetta fino a 100kb di default. Il DTO valida il campo `message` ma il parsing del JSON avviene prima della validazione — un payload enorme viene letto in memoria prima di essere rifiutato.

**Fix:** `express.json({ limit: '4kb' })` con body parser built-in disabilitato.

---

### 3. Nessuna difesa server-side al prompt injection
**File:** `chat.service.ts`

Nessun controllo su pattern tipo "ignora le istruzioni precedenti". Il system prompt gestisce il LLM ma non c'è difesa in profondità lato server.

**Fix:** Heuristic check su pattern di injection comuni prima di chiamare il modello. Risposta 400 con messaggio generico.

---

## 🟡 MEDIA

### 4. Rate limit troppo permissivo (10 req/min)
**File:** `.env`

Un loop automatico può fare 600 chiamate/ora, incluse 600 chiamate all'embedding API. Ogni coppia di chiamate (embedding + LLM) costa denaro.

**Fix:** Ridurre a 5 req/min per IP (`THROTTLE_LIMIT=5`).

---

### 5. ThrottlerGuard non funziona correttamente dietro proxy
**File:** `main.ts`

Dietro Nginx, Railway o Render tutti i request arrivano dall'IP del proxy — il rate limit colpisce tutti gli utenti contemporaneamente o non colpisce nessuno. Manca `trust proxy`.

**Fix:** `app.getHttpAdapter().getInstance().set('trust proxy', 1)` in produzione.

---

### 6. `console.log` invece di NestJS Logger nel bootstrap
**File:** `main.ts`

I log di avvio non hanno timestamp né livello — difficili da correlare con altri log in produzione.

**Fix:** Usare `new Logger('Bootstrap')`.

---

## 🟢 BASSA

### 7. IP assente nei log degli errori
**File:** `src/common/filters/http-exception.filter.ts`

Il filter loga `method + url + status` ma non l'IP del client — in caso di abuso o attacco è impossibile fare audit o bloccare manualmente.

**Fix:** Aggiungere `request.ip` al log.

---

### 8. `NODE_ENV=development` nel `.env`
**File:** `.env`

Se deployato in produzione senza aggiornare questa variabile, Helmet e altre librerie si comportano in modalità development (es. stack trace più verbosi, alcune protezioni disattivate).

**Fix:** Aggiungere note esplicita nel `.env.example` e verificare prima del deploy.

---

## Stato implementazioni

| # | Problema | Stato |
|---|----------|-------|
| 1 | Timeout fetch | ✅ Implementato |
| 2 | Body size limit | ✅ Implementato |
| 3 | Prompt injection heuristic | ✅ Implementato |
| 4 | Rate limit 5 req/min | ✅ Implementato |
| 5 | Trust proxy | ✅ Implementato |
| 6 | NestJS Logger nel bootstrap | ✅ Implementato |
| 7 | IP nei log errori | ✅ Implementato |
| 8 | NODE_ENV warning | ✅ Documentato |
