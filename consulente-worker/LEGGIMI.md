# Ponte del consulente (Cloudflare Worker)

Tiene la chiave API di Anthropic e risponde solo al tuo account Microsoft. La chiave non va mai in chat, nel codice o su GitHub.

## Una volta sola

1. Crea un account gratuito su https://dash.cloudflare.com/sign-up
2. Su https://console.anthropic.com crea una chiave API e imposta il tetto di spesa mensile a 5 $ (Settings, Limits).
3. Apri un terminale in questa cartella (`consulente-worker`) e lancia, uno alla volta:

```
npm install
npx wrangler@4.156.0 login
npm run deploy
npx wrangler@4.156.0 secret put ANTHROPIC_API_KEY
npx wrangler@4.156.0 secret put ALLOWED_EMAIL
```

- `login` apre il browser: accedi a Cloudflare e autorizza.
- `deploy` stampa l'indirizzo del ponte, tipo `https://budget-consulente.<nome>.workers.dev`.
- Il primo `secret put` chiede la chiave: incollala lì (non si vede mentre scrivi).
- Il secondo chiede l'indirizzo email del tuo account Microsoft, quello con cui entri nell'app.

4. Nell'app: Analisi, Impostazioni, Indirizzo del ponte: incolla l'indirizzo del punto 3.

## Costi

Modello Claude Opus 5.5. Ogni domanda invia i movimenti dell'anno, il budget e i fogli di analisi (stima 15-20 mila token).
Stima: la prima domanda circa 10 centesimi; le successive entro 5 minuti riusano i dati in cache e costano circa 3-4 centesimi.
Con il tetto a 5 $ al mese il consulente si ferma da solo quando lo raggiunge.

## Cambiare chiave

Rilancia `npx wrangler@4.156.0 secret put ANTHROPIC_API_KEY` con la chiave nuova e cancella la vecchia dalla console Anthropic.
