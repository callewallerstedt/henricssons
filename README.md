# Henricssons Båtkapell – Webbsida & Admin-API

Detta repo innehåller den publika webbsidan **henricssonsbatkapell.se** och ett Flask-API som gör det möjligt att uppdatera innehåll (båtmodeller, bilder, texter m.m.) direkt via ett administratörsgränssnitt.

> TL;DR
> 1. **En** Flask-tjänst på Render (`admin_api_flask.py`) servar både statiska sidor och API.
> 2. Innehåll som sparas via adminpanelen lagras i **Postgres** (`site_content`, `site_images` m.fl. tabeller) och överlever därför om-deploys. Filerna i repot fungerar som utgångsdata som DB-innehållet mergas ovanpå.
> 3. Render deployar automatiskt vid push till `main` (blueprint i `render.yaml`).

## Arkitektur

```mermaid
flowchart TD
    A[Besökare] -->|GET sidor/bilder| C(Flask: admin_api_flask.py)
    B[Admin-panel admin.html+admin.js] -->|POST/GET /api/*| C
    C -->|läser/skriver| D[(Postgres)]
    C -->|läser utgångsdata| E[JSON-filer + bilder i repot]
```

- Publika sidor: statiska HTML-filer i repo-roten, servade extensionslöst (`/om-oss` → `om-oss.html`).
- `/exempel/<slug>`, `/dynsatser/<slug>`, `/tillfalliga-produkter/<slug>`, `/search`, `/sitemap.xml` renderas server-side för SEO. Gamla URL:er från förra sajten 301:as via `LEGACY_EXAMPLE_REDIRECTS`.
- Den statiska catch-all-routen har en allowlist (`PUBLIC_STATIC_EXTENSIONS`) – källkod, dotfiler och interna JSON-filer servas inte.

## Datalagring

| Innehåll | Fil (utgångsdata) | Databas (vinner/mergas) |
|---|---|---|
| Båtdata | `boat_data.json` | `site_content['boat_data']` |
| Exempel/galleri | `examples_meta.json`, `henricssons_bilder/models_meta.json` | `site_content['examples_meta'/'models_meta']` |
| Sidtexter/banner | `page_texts.json` | `site_content['page_texts']` |
| Adminuppladdade bilder | disk (försvinner vid deploy) | `site_images` (fallback vid servering) |
| Formulärinskick + bilagor | – | `form_submissions`, `submission_attachments` |
| Tillfälliga produkter & varumärken | – | `temp_products`, `boat_brands` (+ bildtabeller) |

### Backup

Adminuppladdade bilder finns bara i databasen — diskkopian försvinner vid varje
deploy och de ligger inte i git. Kör `python backup_data.py` (läser
`DATABASE_URL`, skriver inget till databasen) före större innehållsändringar och
regelbundet. Backupen hamnar i `../henricssons-backups/backup-<tidsstämpel>/`
med varje tabell som JSON och varje bild som riktig fil, redo att laddas upp
igen. Ange en annan mapp med `python backup_data.py <sökväg>`.

## Admin-panelen

- Öppna `/admin` på sajten → lösenordsinloggning (`ADMIN_PANEL_PASSWORD`), sessionscookie.
- API-anrop kan även autentiseras med headern `X-Admin-Key: <ADMIN_API_KEY>`.
- Formulärinskick hanteras under fliken Inskick; mailnotiser + kundbekräftelser går via Mailgun.

### Agent Svar / Agent Test

Offertagenten använder OpenAI Responses API (`gpt-6.1-sol`, reasoning `high`).
Nya inskick granskas i bakgrunden och får en separat Agent Test-ruta i internmejlet.
Öppna ett inskick i admin och välj **Agent Svar** för att granska eller köra igen,
även på äldre ärenden. Panelen visar bedömning, källcitat, källoffertens datum,
kundsvaret och en PDF i Niclas importerade originalmall. Hela modalen har en
gemensam scroll; PDF-förhandsvisningen har ingen separat scroll.

När agenten arbetar visas aktuellt steg och en aktivitetslista från de verkliga
sökningarna, lästa källorna, granskningen och PDF-genereringen. Status och resultat
sparas på servern. Modalen och webbläsaren kan stängas utan att avbryta jobbet;
öppna samma inskick igen för att följa det. En tillfällig nätverksstörning i admin
stoppar inte jobbet, och statusen hämtas igen automatiskt. Visad tid är förfluten
tid, inte en uppskattning av när agenten blir klar.

**Feedback till agenten** sparas i `quote_agent_feedback` och läses vid varje
körning. Välj generell feedback eller feedback för den identifierade modellen.
Sparade minnen kan tas bort; deras ursprungliga utkast och källor finns kvar i
feedbackens granskningshistorik. **Spara och kör igen** skapar ett nytt förslag.

Agenten kan söka/läsa men har inget verktyg för att skicka kundmejl. Utkastknappen
laddar ned en `.eml` med `X-Unsent: 1` och eventuell offertbilaga, för öppning i
Niclas Outlook. Kontrollera stödet i hans faktiska Outlook-version före användning;
knappen skriver inte till en Microsoft 365-brevlådas Drafts-mapp via Graph.
Internnotiser och ordinarie mottagningsbekräftelser går fortsatt via Mailgun.

Priser, rabatter och frakt läses ur original-PDF:erna. Äldre källor är tillåtna
och markeras **kolla priset**. Agenten ska fråga vid oklar modell/variant och lämna
specialarbete till Niclas. Historiska villkor återanvänds aldrig som nya löften.
PDF:en är märkt UTKAST: ett skarpt offertnummer, aktuella villkor och giltighet
måste fastställas i affärssystemet. Prislistan och lagret är inte anslutna.

Importera den privata mejlhistoriken med:

```powershell
python import_quote_archive.py .agent-cache --base-url https://www.henricssonsbatkapell.se
```

Importen kräver adminnyckel och använder originalmejl med verifierad avsändare
`niclas@henricssonsbatkapell.se` samt deras hämtade bilagor. Den lägger arkivet,
den redigerade originalmallen och det kompletta Verdana-typsnittet i privata
databastabeller. `QUOTE_AGENT_FONT_FILE` kan ange Verdana-fil vid mallimport.
Kundmejl, bilagor och typsnitt ska inte publiceras som webbassets eller checkas in.
Codex Gmail-koppling ger inte servern löpande åtkomst till nya Bcc-mejl: uppdatera
arkivet med samma importerare tills serverns egen Gmail-anslutning är konfigurerad.

Kör `python -m unittest test_quote_agent` för isolerade kontroller utan utskick.

## Deploy på Render

En web service + Postgres, definierat i `render.yaml`. Auto-deploy vid push till `main`. Hälsokontroll: `/healthz`.

## Köra lokalt

```bash
pip install -r requirements.txt
python admin_api_flask.py   # lyssnar på http://localhost:25565
```

`.env` i repo-roten läses in automatiskt (utan att skriva över redan satta miljövariabler). Utan `DATABASE_URL` används lokal SQLite. Sätt tomma `MAILGUN_*` om du inte vill skicka riktiga mail vid test.

## Miljövariabler

| Namn | Beskrivning |
|---|---|
| `DATABASE_URL` | Postgres (sätts av Render), annars SQLite lokalt |
| `DATABASE_ANALYTICS_ENABLED` | `0` som standard; databasbaserad sidvisningsloggning hålls avstängd för att Neon ska kunna skala till noll |
| `ADMIN_PANEL_PASSWORD` | Lösenord för admin-inloggning |
| `ADMIN_API_KEY` | Nyckel för API-anrop (`X-Admin-Key`) |
| `MAILGUN_DOMAIN/API_KEY/FROM/TO` | Mailnotiser för formulär |
| `PUBLIC_BASE_URL` | Kanonisk bas-URL (`https://www.henricssonsbatkapell.se`) |
| `ALLOWED_ORIGINS` | CORS-origins |
| `OPENAI_API_KEY` m.fl. | AI-assistent i admin (valfritt) |
| `enable_chatbot` | `1` aktiverar publik chatt-widget (annars avstängd) |

## Vanliga fel & felsökning

| Problem | Kontrollera |
|---|---|
| Admin-ändringar syns inte | Render-loggar; DB-anslutning (`Database connected.` vid start) |
| Bilder 404:ar efter deploy | Uppladdade bilder ska servas ur `site_images` – kolla att uppladdningen gjordes efter att DB-fallbacken infördes |
| Mail kommer inte fram | `POST /api/mailgun_test` med admin-nyckel; kolla Mailgun-loggar |
