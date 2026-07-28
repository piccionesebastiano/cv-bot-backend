#!/usr/bin/env python3
"""
Test di qualità delle risposte del CV bot — confronto prima/dopo.

A differenza di test-security.sh (che verifica cosa il bot rifiuta), questo
verifica COME risponde: autovalutazioni, dettagli inventati, aperture a
stampino ed episodi ripetuti.

Uso:
  python3 test-quality.py --label prima          # baseline su prod attuale
  ... deploy + ricarica CV da /admin/cv ...
  python3 test-quality.py --label dopo
  python3 test-quality.py --compare prima dopo

Le domande extra (es. quelle vere di un HR) si aggiungono con:
  python3 test-quality.py --label hr --questions hr-questions.txt

Rate limit di prod: 5 req/min, quindi di default aspetta 13s tra le chiamate.
Con il set completo servono circa 15 minuti.
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

API_DEFAULT = "https://cv-bot-backend-production.up.railway.app/chat"
CV_PATH_DEFAULT = Path(__file__).resolve().parent.parent / "master.md"
REPORT_DIR = Path(__file__).resolve().parent / "quality-reports"


# ─────────────────────────────────────────────────────────────────────────────
# Domande
# ─────────────────────────────────────────────────────────────────────────────

# Le domande realmente arrivate al bot, dal log conversazioni.
DOMANDE_REALI = [
    "cosa hai fatto con AWS",
    "Hai esperienza con sistemi ad alto traffico?",
    "Quali metriche monitoravi?",
    "Che stack tecnologico usi?",
    "Che versioni di Node.js usi?",
    "Preferisci NestJS o Express?",
    "spiegami la dashboard HR",
    "quale è il tuo numero di telefono",
    "ciao",
]

# Domande tipiche di uno screening HR / hiring manager.
DOMANDE_HR = [
    "Perché hai lasciato l'università?",
    "Che tipo di ruolo stai cercando?",
    "Sei disponibile a lavorare in presenza?",
    "Qual è la tua esperienza più significativa?",
    "Come ti descriveresti come collega?",
    "Che livello di inglese hai?",
    "Hai mai gestito o fatto mentoring su altre persone?",
    "Quanti anni di esperienza hai in totale?",
    "Perché dovremmo assumerti?",
    "Come ti tieni aggiornato?",
]

# Domande che invitano a inventare: chiedono dettagli che il CV non contiene.
DOMANDE_TRABOCCHETTO = [
    "Che servizi AWS hai usato nello specifico?",
    "Su che canale arrivavano gli alert?",
    "Che versione di PostgreSQL usavate?",
    "Quanto hai ridotto la latenza in percentuale?",
    "Quante persone c'erano nel team?",
    "Hai esperienza con Kubernetes?",
    "Che tool di CI/CD usavate?",
    "Quanto guadagnavi nell'ultimo ruolo?",
]

# Input degenerati e fuori tema.
DOMANDE_RUMORE = [
    "asd",
    "we we",
    "Dimmi una barzelletta",
    "baciami stupida",
    "ok",
    "e allora?",
]

# Sequenze multi-turno: è qui che emergevano le ripetizioni.
CATENE = [
    {
        "nome": "otto-volte-un-altro",
        "turni": ["Raccontami un problema tecnico risolto"] + ["Un'altro"] * 7,
    },
    {
        "nome": "approfondimento-cache",
        "turni": [
            "Hai esperienza con sistemi ad alto traffico?",
            "Come hai gestito la cache?",
            "Perché non Redis?",
            "E l'invalidazione?",
        ],
    },
    {
        "nome": "pressione-su-dettagli",
        "turni": [
            "Parlami dell'incidente Strapi",
            "Che metriche hai guardato per diagnosticarlo?",
            "Che tool di monitoring era?",
            "Quanto ci hai messo a risolverlo?",
        ],
    },
]


# ─────────────────────────────────────────────────────────────────────────────
# Rilevatori di difetti
# ─────────────────────────────────────────────────────────────────────────────

AUTOVALUTAZIONE = [
    (r"niente di (super |troppo )?(compless|difficil|trascendental)", "sminuisce l'esperienza"),
    (r"a mio agio", "sminuisce l'esperienza"),
    (r"(era|è stata) la prima volta", "dichiara inesperienza"),
    (r"non l'?avevo mai fatt", "dichiara inesperienza"),
    (r"ha retto bene", "commento sul proprio risultato"),
    (r"(una |un' )?bella sfida", "qualifica la difficoltà"),
    (r"situazione interessante", "qualifica la difficoltà"),
    (r"\bun[a']? rogna\b", "qualifica la difficoltà"),
    (r"una di quelle (volte|migrazioni|situazioni)", "formula autocelebrativa"),
    (r"il tipo di problema che", "formula autocelebrativa"),
    (r"sembra semplice", "formula autocelebrativa"),
    (r"ho fatto bene il mio lavoro", "formula autocelebrativa"),
    (r"nessuno me l'?aveva chiest", "autoreferenzialità vietata"),
    (r"mi sono rotto", "sfogo"),
]

APERTURA_STAMPINO = [
    r"^(ok(ay)?[,.]? )?un'?altr[ao]\b",
    r"^un'?altra (sfida|situazione|rogna|cosa)",
    r"^questa è (più recente|di un contesto)",
    r"^una bella sfida",
    r"^ecco un'?altr",
]

# Termini tecnici che il bot potrebbe nominare: segnalati se NON compaiono nel CV.
TECH_TERMS = [
    "EC2", "S3", "Lambda", "ECS", "EKS", "RDS", "CloudFront", "SQS", "SNS", "Fargate",
    "Kubernetes", "K8s", "Terraform", "Ansible", "Jenkins", "CircleCI", "GitLab CI",
    "GitHub Actions", "ArgoCD", "Helm", "Prometheus", "Datadog", "New Relic", "Elastic",
    "Kibana", "Logstash", "Slack", "Teams", "Discord", "PagerDuty", "Opsgenie",
    "Kafka", "RabbitMQ", "MongoDB", "MySQL", "MariaDB", "Cassandra", "Elasticsearch",
    "GraphQL", "gRPC", "Kong", "Istio", "Vault", "Consul", "Nomad",
    "Vue", "Angular", "Svelte", "Remix", "Astro", "Tailwind",
    "Jest", "Vitest", "Cypress", "Playwright", "Selenium", "Mocha", "Chai",
    "Django", "Flask", "FastAPI", "Rails", "Laravel", "Spring", "Symfony",
    "Python", "Java", "Golang", "Rust", "PHP", "Ruby", "Kotlin", "Scala",
    "Azure Functions", "App Engine", "Cloud Functions", "Firebase", "Supabase",
    "Vercel", "Heroku", "DigitalOcean", "Linode", "Hetzner",
]

# Suggestions a vicolo cieco: chiedono per costruzione qualcosa che il CV non contiene.
# Stessi pattern di src/chat/prompts/suggestion-filter.ts — se cambia lì, aggiorna qui.
SUGGESTION_VICOLO_CIECO = [
    r"\boltre a(l|i|lla|lle|llo)?\b",
    r"\b(quali|che|altri|altre)\s+altr[ie]\b",
    r"\baltr[ie]\s+(servizi|tool|strumenti|linguaggi|framework|database|tecnologie|librerie|provider|cloud)\b",
    r"\bnient'?altro\b",
    r"\b(che|quale|quali)\s+version[ei]\b",
    r"\bin\s+(che\s+)?percentuale\b",
    r"\bdi\s+quanto\s+(hai|è|si\s+è)(\s|$)",
    r"\bquant[oi]\s+(hai\s+)?(ridott|miglior|aumentat|risparmiat)",
    r"\bquant[ei]\s+(person[ae]|svilupp|ingegner|membri)\b",
    r"\b(dimensione|grandezza)\s+del\s+team\b",
    r"\bquanto\s+(tempo\s+)?(ci\s+)?(hai|avete)\s+mess",
    r"\bquanto\s+(guadagn|costav|ti\s+pagav)",
    r"\bquant[oa]\s+era\b",
]

# Senza re.I: serve il nome proprio maiuscolo (vedi suggestion-filter.ts).
SUGGESTION_ENUMERA_SOTTOELEMENTI = r"\b(che|quali|Che|Quali)\s+(servizi|componenti|moduli|parti)\s+(di\s+)?[A-Z]"

# Errore relazionale: il CV elenca voci accostate ("su AWS, Netlify e server Linux") e il
# modello le annida, presentandone una come servizio di un'altra. Si segnala solo quando la
# frase ha una costruzione enumerativa ("servizi AWS", "componenti di GCP"): "ho usato AWS e
# Netlify" è invece corretto e non va toccato.
NON_APPARTENGONO = {
    "AWS": ["Netlify", "GCP", "Cloud Run", "Azure", "Strapi", "Vercel", "Firebase"],
    "GCP": ["DynamoDB", "Netlify", "AWS", "Azure", "S3"],
    "Azure": ["DynamoDB", "Cloud Run", "AWS", "GCP", "Netlify"],
    "Shopify": ["Strapi", "Medusa", "Netlify"],
}
ENUMERATIVA_RE = r"(servizi|componenti|moduli|prodotti|parti)\s+(di\s+)?{plat}|{plat}\s*[:(]"

VERSIONE_RE = re.compile(r"\b(?:versione |v)?(\d+)\.(?:x|\d+)(?:\.\d+)?\b", re.I)
NUMERO_RE = re.compile(r"\b\d[\d.,]*\s*(?:%|mila|k\b|utenti|prodotti|ore|minuti|giorni|colleghi|container|istanze|persone)", re.I)


class Rilevatore:
    """Confronta le risposte con il CV per trovare quello che il CV non dice."""

    def __init__(self, cv_text: str):
        self.cv_lower = cv_text.lower()
        self.cv_numeri = set(re.findall(r"\d[\d.,]*", cv_text))
        self.episodi = self._episodi()

    @staticmethod
    def _episodi():
        # Stesso catalogo di src/chat/prompts/episodes.ts — se cambia lì, aggiorna qui.
        return {
            "strapi": [r"fork.{0,40}cluster", r"process manager", r"200 container"],
            "listini": [r"listin", r"40\.?000 prodotti"],
            "cache-html": [r"cache html", r"invalidazione per url", r"redis lato frontend"],
            "retry-shopify": [r"\b429\b", r"riduzione dinamica", r"batch e concorrenza"],
            "service-bus": [r"service bus"],
            "webhook-bullmq": [r"bullmq", r"soglia di (tentativi|retry)"],
            "hr-tool": [r"factorial", r"automazione hr", r"dashboard hr"],
            "tally-migration": [r"template.{0,20}2\.0", r"dynamodb", r"chiavi dato"],
            "tally-stripe": [r"stripe"],
            "tally-openai": [r"openai"],
            "uboat": [r"uboat", r"\baste\b", r"race condition"],
            "seo": [r"hreflang", r"controlli seo", r"ismartframe"],
            "steal-drink": [r"steal ?drink", r"easydrink", r"oversell", r"decremento atomico"],
            "black-friday": [r"black friday", r"20\.?000 utenti"],
        }

    def episodi_in(self, testo: str):
        t = testo.lower()
        return {nome for nome, pats in self.episodi.items() if any(re.search(p, t) for p in pats)}

    def analizza(self, reply: str, domanda: str = ""):
        difetti = []
        low = reply.lower()
        domanda_low = domanda.lower()

        for pattern, motivo in AUTOVALUTAZIONE:
            m = re.search(pattern, low)
            if m:
                difetti.append(("autovalutazione", motivo, m.group(0)))

        for pattern in APERTURA_STAMPINO:
            m = re.match(pattern, reply.strip(), re.I)
            if m:
                difetti.append(("apertura", "apre annunciando la risposta", m.group(0)))
                break

        for term in TECH_TERMS:
            if not re.search(rf"\b{re.escape(term)}\b", reply, re.I):
                continue
            if term.lower() in self.cv_lower:
                continue
            # Se il termine è nella domanda, il bot lo sta solo ripetendo per negarlo
            # ("Nel CV non ho Kubernetes"): è la risposta giusta, non un'invenzione.
            if term.lower() in domanda_low:
                continue
            if re.search(rf"non\s+(ho|abbiamo|c'è|risulta)[^.]{{0,40}}\b{re.escape(term)}\b", low):
                continue
            difetti.append(("invenzione", "tecnologia non presente nel CV", term))

        for m in VERSIONE_RE.finditer(reply):
            if m.group(0) not in self.cv_lower and m.group(0).lower() not in self.cv_lower:
                difetti.append(("invenzione", "versione non presente nel CV", m.group(0)))

        for m in NUMERO_RE.finditer(reply):
            cifra = re.match(r"\d[\d.,]*", m.group(0)).group(0)
            if cifra not in self.cv_numeri:
                difetti.append(("invenzione", "numero non presente nel CV", m.group(0).strip()))

        difetti += self.analizza_relazioni(reply)
        return difetti

    @staticmethod
    def analizza_relazioni(reply: str):
        """Voci del CV presentate come se una fosse parte dell'altra."""
        difetti = []
        for frase in re.split(r"(?<=[.!?])\s+", reply):
            for piattaforma, estranei in NON_APPARTENGONO.items():
                if not re.search(ENUMERATIVA_RE.format(plat=piattaforma), frase, re.I):
                    continue
                for estraneo in estranei:
                    if re.search(rf"\b{re.escape(estraneo)}\b", frase, re.I):
                        difetti.append((
                            "relazione",
                            f"{estraneo} presentato come parte di {piattaforma}",
                            frase.strip()[:120],
                        ))
        return difetti

    @staticmethod
    def analizza_suggestions(suggestions):
        """Chip che, se cliccati, porterebbero a un 'questo nel CV non c'è'."""
        difetti = []
        for s in suggestions or []:
            if any(re.search(p, s, re.I) for p in SUGGESTION_VICOLO_CIECO):
                difetti.append(("suggestion", "chip a vicolo cieco", s))
            elif re.search(SUGGESTION_ENUMERA_SOTTOELEMENTI, s):
                difetti.append(("suggestion", "chiede di enumerare sotto-elementi", s))
        return difetti


# ─────────────────────────────────────────────────────────────────────────────
# Client
# ─────────────────────────────────────────────────────────────────────────────

def leggi_token(env_path: Path) -> str:
    token = os.environ.get("WIDGET_SECRET", "")
    if token:
        return token
    if env_path.exists():
        for riga in env_path.read_text(encoding="utf-8").splitlines():
            if riga.startswith("WIDGET_SECRET="):
                return riga.split("=", 1)[1].strip()
    return ""


def chiedi(api: str, token: str, messaggio: str, history, timeout=60):
    payload = {"message": messaggio, "sessionId": "quality-test"}
    if history:
        payload["history"] = history[-20:]

    req = urllib.request.Request(
        api,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-widget-token": token},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            body = json.loads(res.read().decode("utf-8"))
            return body.get("reply", ""), body.get("suggestions", []), None
    except urllib.error.HTTPError as e:
        return "", [], f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:200]}"
    except Exception as e:  # noqa: BLE001 — vogliamo continuare col resto della batteria
        return "", [], f"{type(e).__name__}: {e}"


# ─────────────────────────────────────────────────────────────────────────────
# Esecuzione
# ─────────────────────────────────────────────────────────────────────────────

C_RESET, C_ROSSO, C_VERDE, C_GIALLO, C_GRIGIO = "\033[0m", "\033[31m", "\033[32m", "\033[33m", "\033[90m"


def esegui(args):
    cv_text = Path(args.cv).read_text(encoding="utf-8")
    token = leggi_token(Path(args.env))
    if not token:
        print("WIDGET_SECRET non trovata: passa --env o esportala.", file=sys.stderr)
        return 1

    rilevatore = Rilevatore(cv_text)

    singole = list(DOMANDE_REALI + DOMANDE_HR + DOMANDE_TRABOCCHETTO + DOMANDE_RUMORE)
    if args.questions:
        extra = [r.strip() for r in Path(args.questions).read_text(encoding="utf-8").splitlines()]
        singole += [r for r in extra if r and not r.startswith("#")]

    if args.limit:
        singole = singole[: args.limit]

    catene = [] if args.solo_singole else CATENE
    totale = len(singole) + sum(len(c["turni"]) for c in catene)
    print(f"{len(singole)} domande singole + {len(catene)} catene = {totale} chiamate "
          f"(~{totale * args.delay // 60} min)\n")

    risultati = []
    fatte = 0

    def chiamata(domanda, history, contesto):
        nonlocal fatte
        if fatte:
            time.sleep(args.delay)
        fatte += 1
        reply, suggestions, errore = chiedi(args.api, token, domanda, history)
        print(f"{C_GRIGIO}[{fatte}/{totale}]{C_RESET} {domanda}")
        if errore:
            print(f"  {C_ROSSO}ERRORE{C_RESET} {errore}\n")
            return {"contesto": contesto, "domanda": domanda, "errore": errore, "difetti": []}

        difetti = rilevatore.analizza(reply, domanda) + rilevatore.analizza_suggestions(suggestions)
        print(f"  {reply[:200]}{'…' if len(reply) > 200 else ''}")
        for tipo, motivo, frammento in difetti:
            print(f"  {C_ROSSO}✗ {tipo}{C_RESET}: {motivo} → \"{frammento}\"")
        if not difetti:
            print(f"  {C_VERDE}✓ pulita{C_RESET}")
        print()
        return {
            "contesto": contesto,
            "domanda": domanda,
            "reply": reply,
            "suggestions": suggestions,
            "difetti": [{"tipo": t, "motivo": m, "frammento": f} for t, m, f in difetti],
        }

    print("── DOMANDE SINGOLE ──\n")
    for domanda in singole:
        risultati.append(chiamata(domanda, [], "singola"))

    for catena in catene:
        print(f"── CATENA: {catena['nome']} ──\n")
        history = []
        episodi_visti = set()
        for domanda in catena["turni"]:
            esito = chiamata(domanda, history, f"catena:{catena['nome']}")
            reply = esito.get("reply", "")
            if reply:
                history.append({"role": "user", "content": domanda})
                history.append({"role": "assistant", "content": reply[:2000]})

                nuovi = rilevatore.episodi_in(reply)
                # Riparlare dello stesso episodio è un difetto solo se è stato chiesto un
                # episodio DIVERSO: "come hai gestito la cache?" è un approfondimento
                # legittimo e deve poter tornare sul tema appena trattato.
                chiede_altro = re.search(r"\bun'?altr[ao]\b|\baltro (esempio|caso|episodio)\b|\bancora\b", domanda, re.I)
                ripetuti = (nuovi & episodi_visti) if chiede_altro else set()
                if ripetuti:
                    print(f"  {C_ROSSO}✗ ripetizione{C_RESET}: {', '.join(sorted(ripetuti))}\n")
                    esito["difetti"].append({
                        "tipo": "ripetizione",
                        "motivo": "episodio già raccontato nella catena",
                        "frammento": ", ".join(sorted(ripetuti)),
                    })
                episodi_visti |= nuovi
            risultati.append(esito)
        print(f"  {C_GIALLO}episodi distinti nella catena: {len(episodi_visti)}{C_RESET}\n")

    return salva_e_riassumi(args.label, risultati)


def conta(risultati):
    tipi = {}
    for r in risultati:
        for d in r["difetti"]:
            tipi[d["tipo"]] = tipi.get(d["tipo"], 0) + 1
    return tipi


def salva_e_riassumi(label, risultati):
    REPORT_DIR.mkdir(exist_ok=True)
    percorso = REPORT_DIR / f"{label}.json"
    percorso.write_text(json.dumps({
        "label": label,
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "risultati": risultati,
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    tipi = conta(risultati)
    con_difetti = sum(1 for r in risultati if r["difetti"])
    errori = sum(1 for r in risultati if r.get("errore"))

    print("═" * 60)
    print(f"RISPOSTE: {len(risultati)}   con difetti: {con_difetti}   errori di rete: {errori}")
    for tipo, n in sorted(tipi.items(), key=lambda x: -x[1]):
        print(f"  {tipo:16} {n}")
    if not tipi:
        print(f"  {C_VERDE}nessun difetto rilevato{C_RESET}")
    print(f"\nsalvato in {percorso}")
    print(f"confronta con: python3 {Path(__file__).name} --compare <altro-label> {label}")
    return 0


def rianalizza(label, cv_path):
    """Riapplica i rilevatori correnti a un report già salvato, senza richiamare prod.

    Serve quando i rilevatori vengono corretti dopo un giro: le reply grezze sono
    nel JSON, quindi il punteggio si ricalcola offline.
    """
    percorso = REPORT_DIR / f"{label}.json"
    if not percorso.exists():
        print(f"report non trovato: {percorso}", file=sys.stderr)
        return 1

    dati = json.loads(percorso.read_text(encoding="utf-8"))
    rilevatore = Rilevatore(Path(cv_path).read_text(encoding="utf-8"))

    prima = sum(len(r["difetti"]) for r in dati["risultati"])
    for r in dati["risultati"]:
        if r.get("errore"):
            continue
        difetti = (rilevatore.analizza(r.get("reply", ""), r.get("domanda", ""))
                   + rilevatore.analizza_suggestions(r.get("suggestions")))
        # le ripetizioni sono state calcolate durante il giro, non sono ricavabili qui
        ripetizioni = [d for d in r["difetti"] if d["tipo"] == "ripetizione"]
        r["difetti"] = [{"tipo": t, "motivo": m, "frammento": f} for t, m, f in difetti] + ripetizioni

    dopo = sum(len(r["difetti"]) for r in dati["risultati"])
    dati["rianalizzato"] = datetime.now().isoformat(timespec="seconds")
    percorso.write_text(json.dumps(dati, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"rianalizzato {label}: {prima} → {dopo} difetti")
    for r in dati["risultati"]:
        for d in r["difetti"]:
            print(f"  [{d['tipo']}] {r['domanda'][:40]:40} → \"{d['frammento'][:60]}\"")
    return 0


def confronta(label_a, label_b):
    def carica(label):
        p = REPORT_DIR / f"{label}.json"
        if not p.exists():
            print(f"report non trovato: {p}", file=sys.stderr)
            sys.exit(1)
        return json.loads(p.read_text(encoding="utf-8"))

    a, b = carica(label_a), carica(label_b)
    ca, cb = conta(a["risultati"]), conta(b["risultati"])

    if len(a["risultati"]) != len(b["risultati"]):
        print(f"\n{C_GIALLO}ATTENZIONE: i due report hanno un numero diverso di risposte "
              f"({len(a['risultati'])} vs {len(b['risultati'])}). I totali qui sotto non sono "
              f"confrontabili — guarda le sezioni RISOLTI e NUOVI, che confrontano solo le "
              f"domande presenti in entrambi.{C_RESET}")

    print(f"\n{'difetto':18} {label_a:>10} {label_b:>10}   delta")
    print("─" * 52)
    for tipo in sorted(set(ca) | set(cb)):
        na, nb = ca.get(tipo, 0), cb.get(tipo, 0)
        delta = nb - na
        colore = C_VERDE if delta < 0 else (C_ROSSO if delta > 0 else C_GRIGIO)
        print(f"{tipo:18} {na:>10} {nb:>10}   {colore}{delta:+d}{C_RESET}")

    ta, tb = sum(ca.values()), sum(cb.values())
    colore = C_VERDE if tb < ta else (C_ROSSO if tb > ta else C_GRIGIO)
    print("─" * 52)
    print(f"{'TOTALE':18} {ta:>10} {tb:>10}   {colore}{tb - ta:+d}{C_RESET}")

    risolti, nuovi = [], []
    da = {r["domanda"]: r for r in a["risultati"]}
    db = {r["domanda"]: r for r in b["risultati"]}
    for domanda in da.keys() & db.keys():
        pa = {(d["tipo"], d["frammento"]) for d in da[domanda]["difetti"]}
        pb = {(d["tipo"], d["frammento"]) for d in db[domanda]["difetti"]}
        risolti += [(domanda, *d) for d in pa - pb]
        nuovi += [(domanda, *d) for d in pb - pa]

    if risolti:
        print(f"\n{C_VERDE}RISOLTI ({len(risolti)}){C_RESET}")
        for domanda, tipo, frammento in risolti[:25]:
            print(f"  {domanda[:45]:45} {tipo}: \"{frammento}\"")
    if nuovi:
        print(f"\n{C_ROSSO}NUOVI ({len(nuovi)}){C_RESET}")
        for domanda, tipo, frammento in nuovi[:25]:
            print(f"  {domanda[:45]:45} {tipo}: \"{frammento}\"")
    print()
    return 0


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--label", help="nome del report da salvare (es. prima, dopo)")
    p.add_argument("--compare", nargs=2, metavar=("A", "B"), help="confronta due report salvati")
    p.add_argument("--reanalyze", metavar="LABEL", help="riapplica i rilevatori a un report salvato")
    p.add_argument("--api", default=API_DEFAULT)
    p.add_argument("--cv", default=str(CV_PATH_DEFAULT), help="CV di riferimento per il check invenzioni")
    p.add_argument("--env", default=str(Path(__file__).resolve().parent / ".env"))
    p.add_argument("--questions", help="file con domande extra, una per riga")
    p.add_argument("--delay", type=int, default=13, help="secondi tra le chiamate (rate limit 5/min)")
    p.add_argument("--solo-singole", action="store_true", help="salta le catene multi-turno")
    p.add_argument("--limit", type=int, help="usa solo le prime N domande singole (per prove veloci)")
    args = p.parse_args()

    if args.compare:
        return confronta(*args.compare)
    if args.reanalyze:
        return rianalizza(args.reanalyze, args.cv)
    if not args.label:
        p.error("serve --label (oppure --compare)")
    return esegui(args)


if __name__ == "__main__":
    sys.exit(main())
