INFORMAZIONI PERSONALI
Nome:     Sebastiano Piccione
Ruolo:    Backend Engineer
Email:    piccionesebastiano40@gmail.com
Telefono: +39 388 819 9400
Location: Pisa, Italia

PROFILO PROFESSIONALE
Backend Engineer con esperienza end-to-end su sistemi e-commerce ad alto traffico e architetture orientate a performance e affidabilità. Gestione di picchi fino a 20.000 utenti concorrenti in produzione (Black Friday) per il cliente Pinalli, ownership end-to-end di un sistema CMS containerizzato (Strapi su GCP Cloud Run) e capacità dimostrata di guidare decisioni architetturali, anche in contesti di disaccordo con stakeholder tecnici e di business. Esperienza complementare in microservizi real-time, integrazione di API esterne (AI, scraping) e, occasionalmente, supporto frontend su dashboard interne.

ESPERIENZA LAVORATIVA

SpotView — Backend Engineer
Novembre 2024 – Presente

- Progettazione e gestione end-to-end del backend e-commerce per il cliente Pinalli (NestJS, PostgreSQL), con gestione di picchi fino a ~20.000 utenti concorrenti in eventi critici come il Black Friday.
- Riprogettato il sistema di gestione listini prezzi: da aggiornamento seriale (3–4 ore su ~40.000 prodotti) a modello precaricato con validità programmata e applicazione automatica, adottato su 3 e-commerce headless.
- Deciso e implementato, in alternativa alla proposta del team di usare Redis lato frontend, un sistema di cache HTML statica su bucket GCP con invalidazione per URL — scelta dettata dal fatto che le chiamate frontend non supportano invalidazione granulare per tag.
- Automatizzata l'invalidazione della cache, precedentemente gestita manualmente (~2 interventi al giorno tramite cancellazione diretta di file su bucket GCP), eliminando il rischio di errore umano e i tempi di intervento legati ai ticket.
- Owner end-to-end di Strapi in azienda: implementazione, sviluppo feature e gestione incidenti su container GCP Cloud Run, con monitoraggio basato su alert sul numero di istanze attive.
- Diagnosticato e risolto un incidente di instabilità su Strapi causato da una misconfigurazione del process manager (avvio in modalità fork invece di cluster), che saturava le connessioni al database generando un loop di ~200 container avviati e terminati. Risolto con hotfix immediato e successivo tuning dei parametri di startup/readiness su Cloud Run, stabilizzando il sistema a 30 container.
- Condotta un'analisi diretta con il CTO esterno del cliente sul sistema di retry/backoff per le chiamate API verso Shopify (riduzione dinamica di batch e concorrenza su risposte 429/timeout), motivando la scelta architetturale in termini di rischio e costo su processi critici come aggiornamento prezzi e stock.
- Integrazione con Azure Service Bus per la sincronizzazione bidirezionale con i sistemi esterni del cliente: ricezione di stock e anagrafica prodotti in ingresso, invio di messaggi d'ordine in uscita.
- Implementato sistema di gestione webhook (BullMQ) con retry automatico a backoff incrementale e alerting su canale dedicato al superamento della soglia di tentativi falliti.
- Ottimizzazione di query PostgreSQL su campi JSONB tramite indici GIN, per la riduzione della latenza su endpoint critici.
- Introduzione di monitoring e alerting con Grafana, GCP Monitoring e Sentry.

Stack: NestJS, TypeScript, PostgreSQL, GCP (Cloud Run, Cloud Storage), Azure Service Bus, BullMQ, Strapi, Grafana, Sentry


ISmartFrame — Software Engineer
Gennaio 2024 – Novembre 2024

- Sviluppati microservizi (Node.js/TypeScript) per l'automazione di controlli SEO post-scraping (verifica H1, hreflang e altri parametri tecnici) su una piattaforma SaaS enterprise, generando alert e report automatici — eliminando ~2 giorni/settimana di controllo manuale precedentemente svolto dal reparto SEO.
- [Frontend] Manutenzione e sviluppo di feature per la dashboard enterprise utilizzata dai clienti per la gestione degli alert SEO.

Stack: Node.js, TypeScript


Slum — Software Developer
Giugno 2021 – Novembre 2023

- Sviluppo backend monolitici (Node.js, NestJS, Express) e siti e-commerce (Next.js, Strapi, Medusa.js) per clienti dell'agenzia; deploy e gestione infrastruttura su AWS, Netlify e server Linux (Nginx, SSL, process manager).
- [Tally — piattaforma interna per landing page da template] Guidata la migrazione dei template alla v2.0: generificate le chiavi dato e scritto script di migrazione per i JSON esistenti (DynamoDB), con fallback a valori di default — garantendo a tutti gli utenti legacy l'accesso alle nuove feature senza perdita di dati.
- [Tally] Integrazione dell'API OpenAI per la generazione automatica di contenuti testuali basata sul template selezionato e sulla descrizione fornita dal cliente.
- [Tally] Integrazione di Magic Link per l'autenticazione utenti.
- [Tally — Frontend] Sviluppo della dashboard di gestione account e personalizzazione dei template.
- [Uboat — e-commerce cliente] Progettato un microservizio real-time (WebSocket, Node.js) per la gestione di aste su prodotti, con serializzazione delle offerte concorrenti tramite coda per evitare race condition — supportando fino a ~200 utenti simultanei.

Stack: Node.js, NestJS, Express, Next.js, Strapi, Medusa.js, DynamoDB, AWS, Netlify, Magic Link


PROGETTI PERSONALI

EasyDrink (oggi Steal Drink)
App di offerte su aperitivi/locali, oggi live in 20 locali a Pisa.

- Migrato il prodotto da due app separate (v1) a un'unica applicazione (v2): backend riscritto da zero con nuovi flussi per il redesign — modello dati, API di ricerca geolocalizzata dei locali per città, flusso di onboarding dei locali (profilo, offerte, gestione scorte), storage e cache delle immagini con invalidazione legata all'esaurimento reale delle scorte di un'offerta.

Stack: NestJS, TypeScript


COMPETENZE TECNICHE
Backend:                Node.js, NestJS, Express
Database:               PostgreSQL, DynamoDB
Cloud & Infrastruttura: GCP (Cloud Run, VM, Cloud Storage), AWS, Cloudflare, PM2, Nginx
Architetture:           sistemi ad alto traffico, caching multilivello, invalidazione cache, WebSocket real-time, elaborazione asincrona
Messaging & Async:      BullMQ, Azure Service Bus, GCP Pub/Sub, NestJS Task Scheduler
Testing:                unit test, integration test, E2E, load testing con k6
Monitoring:             Grafana, Sentry, GCP Monitoring
Integrazioni:           API OpenAI, Shopify API, Magic Link, provider di autenticazione esterni
Frontend (supporto):    React, Next.js, Flutter (supporto)

FORMAZIONE
Laurea Triennale in Informatica — Università di Pisa (non completata)

LINGUE
Italiano: madrelingua
Inglese: intermedio (lettura tecnica fluente)
