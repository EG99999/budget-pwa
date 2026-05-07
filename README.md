# Budget PWA — Guida installazione

## Cosa ti serve
- Account Microsoft 365 con OneDrive (ce l'hai già)
- File COSTI_ANNUALI_2026.xlsx su OneDrive con la Tabella "TblTransazioni"
- Account GitHub gratuito per pubblicare l'app

---

## Passo 1 — Registra l'app su Azure (10 minuti)

1. Vai su https://portal.azure.com e accedi con il tuo account Microsoft
2. Nella barra di ricerca in alto scrivi **Registrazioni app** e cliccaci
3. Clicca **Nuova registrazione**
4. Compila così:
   - **Nome**: BudgetPWA
   - **Tipi di account supportati**: seleziona "Account Microsoft personali"
   - **URI di reindirizzamento**: scegli "Applicazione a pagina singola (SPA)" e scrivi:
     `https://TUO_USERNAME.github.io/budget-pwa/`
     (sostituisci TUO_USERNAME con il nome che userai su GitHub — lo decidi al Passo 2)
5. Clicca **Registra**
6. Nella pagina che si apre, copia il valore **ID applicazione (client)** — è un codice tipo `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`

Poi aggiungi i permessi:
7. Nel menu a sinistra clicca **Autorizzazioni API**
8. Clicca **Aggiungi un'autorizzazione** → **Microsoft Graph** → **Autorizzazioni delegate**
9. Cerca e aggiungi: `Files.ReadWrite` e `User.Read`
10. Clicca **Concedi consenso amministratore** se disponibile

---

## Passo 2 — Crea account GitHub e pubblica l'app (10 minuti)

1. Vai su https://github.com e crea un account gratuito (scegli un username)
2. Una volta dentro, clicca il **+** in alto a destra → **Nuovo repository**
3. **Nome repository**: `budget-pwa`
4. Lascia tutto il resto invariato e clicca **Crea repository**
5. Clicca **caricamento di un file esistente** (o "uploading an existing file")
6. Trascina i 3 file scaricati: `index.html`, `manifest.json`, `README.md`
7. Clicca **Commit modifiche**

Attiva la pubblicazione:
8. Vai su **Impostazioni** (Settings) del repository
9. Scorri fino a **Pages** nel menu a sinistra
10. In "Branch" seleziona **main** → clicca **Salva**
11. Dopo 1-2 minuti l'app sarà disponibile su:
    `https://TUO_USERNAME.github.io/budget-pwa/`

---

## Passo 3 — Inserisci il Client ID nel codice

1. Apri il file `index.html` con un editor di testo (anche il Blocco Note va bene)
2. Premi CTRL+F e cerca: `IL_TUO_CLIENT_ID_QUI`
3. Sostituisci quella stringa con il codice copiato al Passo 1
4. Salva il file e ricaricalo su GitHub (stesso procedimento del Passo 2, sovrascrive il file)

---

## Passo 4 — Prepara il file Excel

1. Apri COSTI_ANNUALI_2026.xlsm sul PC
2. Vai nel foglio **INSERIMENTO COSTI**
3. Clicca su una cella con dati → premi **CTRL+T** → spunta "Tabella con intestazioni" → OK
4. In alto a sinistra dove vedi "Tabella1", cambia il nome in **TblTransazioni**
   (tab "Struttura tabella" → campo "Nome tabella")
5. Salva una copia come **.xlsx** (File → Salva con nome → formato Excel)
6. Carica questo file `.xlsx` su OneDrive nella cartella che preferisci
   (es. Documenti → trascina il file dalla cartella al sito onedrive.com)

---

## Passo 5 — Installa l'app sul telefono Android

1. Apri **Chrome** sul telefono
2. Vai su `https://TUO_USERNAME.github.io/budget-pwa/`
3. Tocca il menu **⋮** in alto a destra → **Aggiungi alla schermata Home**
4. Dai un nome (es. "Budget") → **Aggiungi**
5. L'icona appare nella schermata home come un'app normale

---

## Passo 6 — Prima configurazione nell'app

Al primo avvio:
1. Tocca **Accedi con Microsoft** e inserisci le tue credenziali
2. Nella schermata di configurazione inserisci il percorso del file su OneDrive
   - Se lo hai messo in Documenti scrivi: `Documenti/COSTI_ANNUALI_2026.xlsx`
   - Se è nella cartella principale scrivi solo: `COSTI_ANNUALI_2026.xlsx`
3. Nome tabella: lascia **TblTransazioni**
4. Tocca **Conferma e continua**

Fatto — l'app è pronta.

---

## Problemi comuni

**"File non trovato"** durante la configurazione
→ Controlla che il percorso sia esatto e che il file sia su OneDrive (non solo sul PC)

**Pagina bianca dopo il login**
→ Verifica che il Client ID sia corretto e che il Redirect URI su Azure corrisponda esattamente all'URL dell'app

**"Accesso negato"**
→ Torna su Azure → Autorizzazioni API e assicurati di aver aggiunto Files.ReadWrite e User.Read
