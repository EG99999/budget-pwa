# Budget PWA — Contesto progetto

## Cos'è
PWA (Progressive Web App) a singolo file `index.html` che legge il file Excel **COSTI ANNUALI 2026.xlsm** da OneDrive tramite Microsoft Graph API. Ospitata su GitHub Pages.

## URL e repository
- **App live:** https://eg99999.github.io/budget-pwa/
- **GitHub repo:** https://github.com/EG99999/budget-pwa.git
- **Clone locale (per push):** `C:\Users\IB motion\AppData\Local\Temp\budget-pwa-upload\`
- **File sorgente:** `C:\Users\IB motion\Desktop\Onedrive Elia\OneDrive\006-COSTI E SPESE\000 - COSTI ANNUALI\File per web app\index.html`

## Autenticazione Microsoft (MSAL)
- **Library:** `@azure/msal-browser@2.38.3` via CDN jsdelivr
  - URL: `https://cdn.jsdelivr.net/npm/@azure/msal-browser@2.38.3/lib/msal-browser.min.js`
  - ⚠️ NON usare `alcdn.msauth.net` — restituisce 404
- **CLIENT_ID:** `1bb6501e-437c-472e-b1cf-a1b2fc95c978`
- **Authority:** `https://login.microsoftonline.com/consumers` (account personali Microsoft)
- **redirectUri:** `https://eg99999.github.io/budget-pwa/`
- **Scopes:** `['Files.ReadWrite', 'User.Read']`
- **Cache:** `localStorage`

## File Excel su OneDrive
- **Percorso OneDrive (relativo alla root):** `006-COSTI E SPESE/000 - COSTI ANNUALI/COSTI ANNUALI 2026.xlsm`
  - ⚠️ Usare sempre slash `/` forward, MAI backslash o percorso Windows locale
- **Tabella transazioni:** `TblTransazioni`
- **File ID:** recuperato automaticamente via Graph API e salvato in `localStorage` come `budgetConfig`

## Struttura dati Excel

### TblTransazioni (foglio INSERIMENTO COSTI)
Colonne (0-indexed): `SENSO | TIPOLOGIA | VALORE | CADENZA | DESCRIZIONE | METODO | MEZZO | DATA | MESE`
- La colonna DATA contiene **serial date Excel** (numeri come 46024 = 2 gen 2026)
- Conversione: `new Date((serial - 25569) * 86400 * 1000)`
- ⚠️ NON trattare come millisecondi Unix

### BUDGET MASTER — range `B4:R32`
- Col 0: CATEGORIA
- Col 1–12: budget mensile (GEN–DIC)
- Col 13: TOT BUDGET annuale
- Col 14–16: altri campi
- Separatori di sezione: celle che contengono `──`
- Righe da skippare: `TOT...`, `SALDO`, `SAVING RATE %`

### PANNELLO CASA — range `A29:O36`
- Row 0: titolo sezione
- Row 1: header colonne
- Row 2–6: voci casa (Affitto, Utenze, ecc.)
- Row 7: TOTALE
- Col 0: nome voce
- Col 1–12: valori mensili (GEN–DIC)
- Col 13: TOT YTD
- Col 14: MEDIA mensile

### SPESE RICORRENTI — range `B4:I11`
- Row 0: header
- Row 1–4: 4 servizi (Zwift, iCloud, Iliad, Hachette)
- Colonne: SERVIZIO | CADENZA | IMPORTO € | CATEGORIA | FORNITORE | STATO | VALUT. | NOTE

### ANALISI CFO — range `B4:G51`
- Col 0: label/indicatore
- Col 1: valore
- Col 2: target
- Col 3: status (con emoji 🟢🔴🟡)
- Col 4: note
- Separatori: celle che iniziano con `▌`

## Tab dell'app (9 totali, nav orizzontale scrollabile)
| Tab | ID pagina | Funzione | Fonte dati |
|-----|-----------|----------|------------|
| Dash | pageDash | KPI mese + categorie | TblTransazioni |
| Aggiungi | pageAdd | Form inserimento transazione | TblTransazioni (POST) |
| Lista | pageLista | Lista transazioni filtrata per mese | TblTransazioni |
| Budget | pageBudget | Budget vs reale per mese | BUDGET MASTER + TblTransazioni |
| Annuale | pageAnnuale | Budget vs reale intero anno con barre | BUDGET MASTER + TblTransazioni |
| Cruscotto | pageCruscotto | KPI YTD, tabella 12 mesi, top categorie | TblTransazioni |
| CFO | pageCfo | Analisi finanziaria con indicatori e status | ANALISI CFO |
| Casa | pageCasa | Spese casa YTD e mese corrente | PANNELLO CASA |
| Servizi | pageServizi | Abbonamenti/servizi ricorrenti | SPESE RICORRENTI |

## Funzioni chiave

### parseDate(v)
Converte serial date Excel in stringa ISO `YYYY-MM-DD`.
```js
function parseDate(v) {
  if (!v && v !== 0) return null;
  if (typeof v === 'number') return new Date((v - 25569) * 86400 * 1000).toISOString().split('T')[0];
  if (typeof v === 'string') return v.split('T')[0];
  return null;
}
```

### sameYM(dateStr, y, m)
Confronta anno/mese senza creare oggetti Date (più robusto con stringhe ISO).
```js
function sameYM(dateStr, y, m) {
  if (!dateStr) return false;
  const parts = String(dateStr).split('-');
  return parseInt(parts[0]) === y && parseInt(parts[1]) - 1 === m;
}
```

### readRange(sheetName, address)
Legge un range da un foglio Excel via Graph API.
```js
async function readRange(sheetName, address) {
  const s = encodeURIComponent(sheetName);
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/items/${cfg.fileId}/workbook/worksheets('${s}')/range(address='${address}')`,
    { headers: { Authorization: 'Bearer ' + accessToken } }
  );
}
```

## Flusso di avvio
1. `window.load` → `msalInstance.initialize()` → abilita pulsante login
2. `handleRedirectPromise()` → se c'è token da redirect → `checkSetup()`
3. `checkSetup()` → se già configurato (`localStorage.budgetConfig`) → `startApp()`
4. Altrimenti prova auto-setup con `DEFAULT_PATH` → salva config → `startApp()`
5. Se file non trovato → mostra `setupScreen` manuale

## Come fare il deploy
```bash
# 1. Modifica index.html nella cartella OneDrive
# 2. Copia nel repo git e push
cp "[percorso OneDrive]/index.html" "C:/Users/IB motion/AppData/Local/Temp/budget-pwa-upload/index.html"
cd "C:/Users/IB motion/AppData/Local/Temp/budget-pwa-upload"
git add index.html
git commit -m "Descrizione modifica"
git push "https://EG99999:[TOKEN]@github.com/EG99999/budget-pwa.git" main
```
Il token GitHub va chiesto all'utente se scaduto (Personal Access Token con permesso `repo`).

## Errori noti e soluzioni
| Problema | Causa | Fix |
|----------|-------|-----|
| Pulsante login non funziona | CDN MSAL sbagliato (404) | Usare jsdelivr CDN |
| Date filtrate male (sempre vuoto) | Serial date Excel trattati come ms Unix | Usare `parseDate()` con offset 25569 |
| Percorso file non trovato | Percorso Windows locale invece di OneDrive-relativo | Usare `/` e percorso da root OneDrive |
| Servizi mostra dati extra | Range `B4:I15` troppo ampio | Limitare a `B4:I11` (solo 4 servizi) |

## Categorie transazioni disponibili
ACQUISTI ONLINE, ALTRI REDDITI, AVANZO, CASA, CIBO, CREDITO, DEBITO,
HOBBY/COLLEZIONISMO, INVESTIMENTI, LAVORO, MEDICALE, PRELIEVO CONTANTI,
PROGETTI, REGALI, RISTORANTI, SPORT, SPESA VARIA, STIPENDIO, SVAGHI,
TELEFONIA, TRASPORTI PRIVATI, TRASPORTI PUBBLICI, VENDITA, VIAGGI, VINCITA
