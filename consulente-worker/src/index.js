// Ponte tra l'app Budget e Claude. La chiave API resta qui (segreto di Cloudflare), mai nel browser.
// Risponde solo a chi ha fatto l'accesso Microsoft con l'indirizzo in ALLOWED_EMAIL.
import Anthropic from "@anthropic-ai/sdk";

const SYSTEM = `Sei il consulente di spesa personale di Elia. Rispondi in italiano, in modo diretto e pratico.
Ricevi i dati reali del suo file Excel dei costi: movimenti dell'anno, budget per categoria, analisi CFO, casa e abbonamenti.
- Basati solo sui dati: cita cifre, mesi e categorie precise. Se un dato manca, dillo invece di stimarlo.
- Per risparmiare proponi azioni concrete con l'effetto stimato in euro al mese o all'anno.
- Distingui spese fisse, necessarie e tagliabili. Non fare la predica sulle spese personali: segnala, quantifica, proponi.
- Niente consigli di investimento personalizzati (titoli, fondi, criptovalute): non sei un consulente finanziario abilitato.
- Risposte brevi: poche righe o un elenco puntato. Niente tabelle larghe: si legge sul telefono.`;

const MAX_MESSAGGI = 30;
const MAX_DATI = 400000; // caratteri
const verificati = new Map(); // token -> scadenza, per non chiamare Graph a ogni domanda

// ── Lettura di scontrini ed estratti conto (Sonnet 5.5, risposta JSON secondo uno schema) ──
const MODELLO_LETTURA = "claude-sonnet-5-5";
const PREZZO = { in: 2, out: 10 }; // $ per milione di token
const CAT_PRODOTTI = ["Alimentari", "Bevande", "Casa e pulizia", "Igiene e cura persona", "Farmacia", "Animali", "Abbigliamento", "Elettronica", "Altro"];
const MEZZI = ["CARTA DI CREDITO", "ADDEBITO CONTO", "BONIFICO", "ACCREDITO CONTO", "CARTA DI DEBITO", "CONTANTI", "ALTRO TRASFERIMENTO"];

const SYSTEM_SCONTRINO = `Leggi la foto di uno scontrino italiano e compila lo schema.
- data AAAA-MM-GG, ora HH:MM; stringa vuota se non si leggono.
- totale: il TOTALE COMPLESSIVO dello scontrino dopo gli sconti, cioè quanto valgono tutti gli articoli. pagato: la parte pagata con carta o contanti, senza buoni pasto o ticket; uguale al totale se non ci sono buoni.
- pagamento: contanti, carta (bancomat, POS, carta di credito, Apple Pay, Google Pay), altro o sconosciuto.
- Se ci sono più foto sono pezzi consecutivi dello stesso scontrino, dall'alto in basso, tagliati fra una riga e l'altra: leggili come un unico scontrino.
- Un articolo per ogni riga di prodotto. prezzo: quanto si è pagato per quella riga, quantità compresa e sconti dell'articolo già tolti (lo sconto va anche in sconto). Uno sconto su tutto lo scontrino è un articolo "Sconto" con prezzo negativo, categoria Altro.
- prodotto: nome chiaro in italiano, senza abbreviazioni, senza marca e senza formato ("SPAGH BAR N5 500G" -> prodotto "Spaghetti n.5", marca "Barilla", contenuto 0.5 kg). Se il prodotto è tra i PRODOTTI GIÀ USATI, riusa esattamente quel nome e quella sottocategoria.
- sottocategoria: breve e minuscola, riusando quelle già usate (per esempio pasta e riso, pane e sostituti, cereali e colazione, carne, pesce, salumi, formaggi, latte e yogurt, uova, frutta, verdura, surgelati, conserve e sughi, olio e condimenti, farina e zucchero, dolci e snack, caffè e tè, acqua, bibite e succhi, birra e vino, detersivi, carta e casa, igiene personale).
- quantita e unita: pezzi (pz), oppure kg o l per lo sfuso a peso ("0,850 kg x 2,49 €/kg" -> quantita 0.85, unita kg).
- contenuto: per i pezzi confezionati, peso o volume netto di un pezzo (500 g -> 0.5 con contenuto_unita kg; 1,5 l -> 1.5 con l). Solo se è scritto sullo scontrino, altrimenti 0 e "".
- categoria_spesa: la categoria del bilancio più adatta all'intero scontrino.
- Non inventare righe né prezzi. leggibile = false se non è uno scontrino o non si legge: in quel caso articoli vuoti.`;

const SYSTEM_ESTRATTO = `Leggi un estratto conto (conto corrente o carta) e restituisci tutti i movimenti, nell'ordine del documento.
- data: data dell'operazione in AAAA-MM-GG (non la valuta). Se nella descrizione di un pagamento con carta c'è la data dell'acquisto, usa quella.
- importo: negativo per le uscite, positivo per le entrate.
- descrizione: nome breve e leggibile della controparte o dell'operazione ("Esselunga Milano", "Bonifico da Mario Rossi", "Netflix"), senza codici.
- originale: il testo del movimento com'è scritto, al massimo 120 caratteri.
- mezzo: pagamento con carta o POS e prelievo -> CARTA DI DEBITO; addebito diretto (SDD, RID, utenze) -> ADDEBITO CONTO; bonifico in uscita -> BONIFICO; bonifico in entrata e stipendio -> ACCREDITO CONTO; giroconto -> ALTRO TRASFERIMENTO. Sull'estratto di una carta di credito: CARTA DI CREDITO.
- tipo: normale; saldo_carta per l'addebito mensile della carta di credito sul conto; giroconto per i trasferimenti tra conti della stessa persona; commissione per spese, bolli e interessi della banca.
- categoria: la categoria del bilancio più adatta, guardando gli ESEMPI delle voci già registrate.
- Escludi saldi, totali e righe che non sono movimenti. tipo_estratto: conto o carta. conto: banca e conto o carta, se scritti.`;

const SYSTEM_CATEGORIZZA = `Ricevi movimenti di un estratto conto, uno per riga e numerati, e per ognuno, nello stesso ordine, compili lo schema.
- descrizione: nome breve e leggibile della controparte o dell'operazione ("Conad Chiari", "Bonifico a Mario Rossi", "Netflix"), senza codici, numeri di carta o IBAN.
- mezzo, tipo e categoria con le stesse regole: carta o POS e prelievo -> CARTA DI DEBITO; addebito diretto (SDD, RID, utenze) -> ADDEBITO CONTO; bonifico in uscita -> BONIFICO; bonifico in entrata e stipendio -> ACCREDITO CONTO; giroconto -> ALTRO TRASFERIMENTO. tipo: normale, saldo_carta (addebito mensile della carta di credito), giroconto (tra conti della stessa persona), commissione (spese, bolli, interessi). La categoria della banca, se c'è, è solo un indizio: scegli fra le categorie del bilancio guardando gli ESEMPI delle voci già registrate.`;

const SYSTEM_UNIFORMA = `Ricevi le voci del bilancio di una persona, numerate: descrizione, categoria, quante volte compare, importo medio. Trova le voci che sono LA STESSA COSA scritta in modi diversi o messa in categorie diverse (la stessa pizzeria una volta in Svaghi e una in Ristoranti, "Fibra Planetel" e "Internet Planetel") e proponi per ogni gruppo una sola categoria e un solo nome.
- Raggruppa solo cose davvero uguali: stesso negozio, servizio, abbonamento o abitudine ricorrente. Due ristoranti diversi restano separati.
- categoria: la più adatta fra quelle dello schema, di solito la più usata nel gruppo. nome: breve, in maiuscolo come le voci, senza mese, data o numero di rata.
- motivo: una frase breve in italiano che spiega cosa cambia.
- Proponi solo gruppi di almeno due voci in cui cambia qualcosa (categorie diverse, o nomi diversi per la stessa cosa). Al massimo 40 gruppi, i più utili prima.`;

const SYSTEM_BOLLETTA = `Leggi una bolletta italiana di luce e/o gas (PDF o foto) e compila lo schema. Una bolletta può contenere entrambe le utenze: una voce in utenze per ciascuna.
- periodo_da e periodo_al: il periodo oggetto di fatturazione di quell'utenza (AAAA-MM-GG), non la data della bolletta.
- consumo: il consumo totale fatturato del periodo (Smc per il gas, kWh per la luce); stimato = true se il consumo fatturato è tutto stimato.
- totale: il totale di quell'utenza ("Totale bolletta" della sua sezione, oppure "Totale Gas" / "Totale Energia Elettrica").
- tasse: "Accise e Iva" oppure "Totale imposte e IVA" di quell'utenza.
- quota_consumi: la spesa per il consumo di quell'utenza: "Quota per Consumi" nei formati recenti, "Spesa per la materia gas" / "Spesa per la materia energia elettrica" nei formati vecchi.
- La stessa utenza divisa per voce, in euro, con il segno stampato (sconti e ricalcoli negativi):
  - vendita: la spesa per la vendita / materia energia o gas, sia della quota consumi sia della quota fissa ("di cui spesa per la vendita");
  - rete: "spesa per la rete e gli oneri generali di sistema" della quota consumi e della quota fissa, più la quota potenza della luce; nei formati vecchi "trasporto e gestione del contatore" più "oneri di sistema";
  - accise: "Totale imposte" (accisa, imposta erariale, addizionali regionali);
  - iva: "Totale IVA";
  - altre_partite: tutto il resto (sconti, arrotondamenti, ricalcoli, bonus, canone RAI, interessi).
  vendita + rete + accise + iva + altre_partite deve fare il totale dell'utenza: controlla la somma prima di rispondere.
- oneri_sistema: solo informativo, già compreso in rete: "Totale oneri generali di sistema" degli elementi di dettaglio, oppure "Spesa per oneri di sistema" nei formati vecchi; 0 se non c'è.
- quota_fissa: il totale della quota fissa dell'utenza (€); prezzo_vendita: il prezzo unitario della vendita sulla quota consumi (€/Smc o €/kWh, "di cui spesa per la vendita"), 0 se non c'è.
- indice: il valore dell'indice di mercato del periodo se è stampato (PSV in €/Smc per il gas, PUN in €/kWh per la luce; se ci sono più fasce, la media delle fasce); 0 se non c'è. indice_nome: PSV, PUN o "".
- fattura: numero, data_emissione e scadenza (AAAA-MM-GG), totale_da_pagare della bolletta intera, fornitore.
- Numeri come sono stampati, senza arrotondare. leggibile = false se non è una bolletta di luce o gas.`;

const oggetto = (props) => ({ type: "object", properties: props, required: Object.keys(props), additionalProperties: false });
const schemaScontrino = (cats) => oggetto({
  leggibile: { type: "boolean" },
  negozio: { type: "string" }, data: { type: "string" }, ora: { type: "string" },
  totale: { type: "number" }, pagato: { type: "number" },
  pagamento: { type: "string", enum: ["contanti", "carta", "altro", "sconosciuto"] },
  categoria_spesa: { type: "string", enum: cats },
  articoli: { type: "array", items: oggetto({
    testo: { type: "string" }, prodotto: { type: "string" }, marca: { type: "string" },
    categoria: { type: "string", enum: CAT_PRODOTTI }, sottocategoria: { type: "string" },
    quantita: { type: "number" }, unita: { type: "string", enum: ["pz", "kg", "l"] },
    contenuto: { type: "number" }, contenuto_unita: { type: "string", enum: ["kg", "l", ""] },
    prezzo: { type: "number" }, sconto: { type: "number" },
  }) },
});
const schemaEstratto = (cats) => oggetto({
  tipo_estratto: { type: "string", enum: ["conto", "carta"] },
  conto: { type: "string" },
  movimenti: { type: "array", items: oggetto({
    data: { type: "string" }, importo: { type: "number" },
    descrizione: { type: "string" }, originale: { type: "string" },
    mezzo: { type: "string", enum: MEZZI },
    tipo: { type: "string", enum: ["normale", "saldo_carta", "giroconto", "commissione"] },
    categoria: { type: "string", enum: cats },
  }) },
});
const schemaCategorizza = (cats) => oggetto({
  voci: { type: "array", items: oggetto({
    n: { type: "integer" }, descrizione: { type: "string" },
    mezzo: { type: "string", enum: MEZZI },
    tipo: { type: "string", enum: ["normale", "saldo_carta", "giroconto", "commissione"] },
    categoria: { type: "string", enum: cats },
  }) },
});
const schemaUniforma = (cats) => oggetto({
  gruppi: { type: "array", items: oggetto({
    voci: { type: "array", items: { type: "integer" } },
    categoria: { type: "string", enum: cats }, nome: { type: "string" }, motivo: { type: "string" },
  }) },
});
const schemaBolletta = () => oggetto({
  leggibile: { type: "boolean" }, fornitore: { type: "string" }, numero: { type: "string" },
  data_emissione: { type: "string" }, scadenza: { type: "string" }, totale_da_pagare: { type: "number" },
  utenze: { type: "array", items: oggetto({
    tipo: { type: "string", enum: ["gas", "luce"] }, periodo_da: { type: "string" }, periodo_al: { type: "string" },
    consumo: { type: "number" }, unita: { type: "string", enum: ["Smc", "kWh"] }, stimato: { type: "boolean" },
    totale: { type: "number" }, tasse: { type: "number" }, quota_consumi: { type: "number" },
    vendita: { type: "number" }, rete: { type: "number" }, accise: { type: "number" }, iva: { type: "number" }, altre_partite: { type: "number" },
    oneri_sistema: { type: "number" }, quota_fissa: { type: "number" }, prezzo_vendita: { type: "number" },
    indice: { type: "number" }, indice_nome: { type: "string", enum: ["PSV", "PUN", ""] },
  }) },
});
// le categorie del bilancio arrivano dall'app: solo testo breve, senza doppioni
const pulisciCategorie = (a) => [...new Set((Array.isArray(a) ? a : []).map(c => String(c).slice(0, 60).trim()).filter(Boolean))].slice(0, 80);
const elenco = (a, max) => (Array.isArray(a) ? a : []).map(x => String(x).slice(0, 200)).slice(0, max).join("\n");

class ErroreLettura extends Error {}
function messaggioErrore(e) {
  if (e instanceof ErroreLettura) return e.message;
  if (e instanceof Anthropic.AuthenticationError) return "Chiave API non valida: controlla il segreto ANTHROPIC_API_KEY su Cloudflare.";
  if (e instanceof Anthropic.RateLimitError) return "Troppe richieste o tetto di spesa raggiunto: riprova più tardi.";
  if (e instanceof Anthropic.BadRequestError) return "Richiesta rifiutata dall'API: " + e.message;
  if (e instanceof Anthropic.APIError) return `Errore dell'API (${e.status}): ${e.message}`;
  return "Errore del consulente.";
}

async function leggi(env, system, content, schema, effort, max_tokens) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const stream = client.messages.stream({
    model: MODELLO_LETTURA, max_tokens,
    output_config: { effort, format: { type: "json_schema", schema } },
    system, messages: [{ role: "user", content }],
  });
  const fin = await stream.finalMessage();
  const u = fin.usage;
  const costo = ((u.input_tokens + (u.cache_creation_input_tokens || 0) * 1.25 + (u.cache_read_input_tokens || 0) * 0.1) * PREZZO.in + u.output_tokens * PREZZO.out) / 1e6;
  console.log(`lettura: ${fin.stop_reason}, token in ${u.input_tokens} out ${u.output_tokens}, ${costo.toFixed(4)} $`);
  if (fin.stop_reason === "refusal") throw new ErroreLettura("Claude non ha voluto leggere questo file.");
  if (fin.stop_reason === "max_tokens") throw new ErroreLettura("File troppo lungo: dividilo in parti più piccole.");
  const testo = fin.content.filter(b => b.type === "text").map(b => b.text).join("");
  try { return { ...JSON.parse(testo), costo }; } catch { throw new ErroreLettura("Risposta non leggibile, riprova."); }
}

async function scontrino(body, env) {
  const tipi = ["image/jpeg", "image/png", "image/webp"];
  const foto = (Array.isArray(body.immagini) ? body.immagini : [body.immagine]).filter(x => typeof x === "string" && x).slice(0, 8);
  if (!tipi.includes(body.media_type) || !foto.length) throw new ErroreLettura("Manca la foto dello scontrino.");
  const cats = pulisciCategorie(body.categorie);
  if (!cats.length) throw new ErroreLettura("Mancano le categorie del bilancio.");
  const noti = `PRODOTTI GIÀ USATI (prodotto | marca | sottocategoria):\n${elenco(body.prodotti, 400) || "nessuno"}\n\nSOTTOCATEGORIE GIÀ USATE: ${elenco(body.sottocategorie, 100).replace(/\n/g, ", ") || "nessuna"}`;
  return leggi(env, SYSTEM_SCONTRINO, [
    ...foto.map(data => ({ type: "image", source: { type: "base64", media_type: body.media_type, data } })),
    { type: "text", text: (foto.length > 1 ? `Scontrino in ${foto.length} pezzi, dall'alto in basso.\n\n` : "") + noti },
  ], schemaScontrino(cats), "medium", 16000);
}

// bollette di luce e gas: PDF, foto (anche più pagine) o testo già estratto
async function bolletta(body, env) {
  let parti;
  if (body.tipo === "pdf" && typeof body.dati === "string" && body.dati) parti = [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: body.dati } }];
  else if (body.tipo === "immagini" && Array.isArray(body.dati)) parti = body.dati.filter(x => typeof x === "string" && x).slice(0, 12).map(data => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } }));
  else if (body.tipo === "testo" && typeof body.dati === "string" && body.dati.trim()) parti = [{ type: "text", text: "TESTO DELLA BOLLETTA:\n" + body.dati.slice(0, MAX_DATI) }];
  if (!parti || !parti.length) throw new ErroreLettura("Manca la bolletta.");
  if (body.tipo === "immagini" && parti.length > 1) parti.push({ type: "text", text: "Le foto sono pagine della stessa bolletta, in ordine." });
  return leggi(env, SYSTEM_BOLLETTA, parti, schemaBolletta(), "low", 8000);
}

// estratti in tabella: l'app legge le colonne da sola e manda qui solo i movimenti da aggiungere
async function categorizza(body, env) {
  const cats = pulisciCategorie(body.categorie);
  const voci = (Array.isArray(body.voci) ? body.voci : []).slice(0, 150).map((v, i) => `${i + 1}. ${String(v).slice(0, 300)}`);
  if (!cats.length || !voci.length) throw new ErroreLettura("Mancano i movimenti o le categorie.");
  return leggi(env, SYSTEM_CATEGORIZZA, [
    { type: "text", text: `MOVIMENTI (data | importo | testo della banca | categoria della banca):\n${voci.join("\n")}` },
    { type: "text", text: `ESEMPI dalle voci già registrate (descrizione | categoria):\n${elenco(body.esempi, 300) || "nessuno"}` },
  ], schemaCategorizza(cats), "low", 32000);
}

// voci scritte o categorizzate in modi diversi: l'app manda l'elenco delle voci distinte, Claude propone i gruppi
async function uniforma(body, env) {
  const cats = pulisciCategorie(body.categorie);
  const voci = (Array.isArray(body.voci) ? body.voci : []).slice(0, 1500).map((v, i) => `${i + 1}. ${String(v).slice(0, 200)}`);
  if (!cats.length || voci.length < 2) throw new ErroreLettura("Servono almeno due voci.");
  return leggi(env, SYSTEM_UNIFORMA, [
    { type: "text", text: `VOCI (descrizione | categoria | volte | importo medio):\n${voci.join("\n")}` },
  ], schemaUniforma(cats), "medium", 32000);
}

async function estratto(body, env) {
  const cats = pulisciCategorie(body.categorie);
  if (!cats.length) throw new ErroreLettura("Mancano le categorie del bilancio.");
  let file;
  if (body.tipo === "pdf" && typeof body.dati === "string" && body.dati) file = { type: "document", source: { type: "base64", media_type: "application/pdf", data: body.dati } };
  else if (body.tipo === "immagini" && Array.isArray(body.dati) && body.dati.some(x => typeof x === "string" && x)) {
    // screenshot dell'app della banca: possono sovrapporsi, i doppioni li toglie Claude
    file = [...body.dati.filter(x => typeof x === "string" && x).slice(0, 20).map(data => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } })),
      { type: "text", text: "Sono screenshot dell'estratto conto, in ordine. Se due screenshot si sovrappongono, un movimento ripetuto (stessa data, importo e descrizione nello stesso punto dell'elenco) va contato una volta sola." }];
  }
  else if (body.tipo === "testo" && typeof body.dati === "string" && body.dati.trim()) file = { type: "text", text: "ESTRATTO CONTO (testo del file):\n" + body.dati.slice(0, MAX_DATI) };
  else throw new ErroreLettura("Manca il file dell'estratto conto.");
  return leggi(env, SYSTEM_ESTRATTO, [
    ...(Array.isArray(file) ? file : [file]),
    { type: "text", text: `ESEMPI dalle voci già registrate (descrizione | categoria):\n${elenco(body.esempi, 300) || "nessuno"}` },
  ], schemaEstratto(cats), "low", 64000);
}

function cors(env, req) {
  const origin = req.headers.get("Origin") || "";
  const ok = origin === env.ALLOWED_ORIGIN || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : env.ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Vary": "Origin",
  };
}
const risposta = (testo, stato, h) => new Response(testo, { status: stato, headers: { ...h, "Content-Type": "text/plain; charset=utf-8" } });

async function autorizzato(req, env) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const scade = verificati.get(token);
  if (scade && scade > Date.now()) return true;
  const r = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", { headers: { Authorization: "Bearer " + token } });
  if (!r.ok) return false;
  const me = await r.json();
  const email = String(me.mail || me.userPrincipalName || "").toLowerCase();
  const ok = email !== "" && email === String(env.ALLOWED_EMAIL || "").toLowerCase();
  if (ok) verificati.set(token, Date.now() + 10 * 60 * 1000);
  return ok;
}

export default {
  async fetch(req, env) {
    const h = cors(env, req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    if (req.method !== "POST") return risposta("Usa POST", 405, h);
    if (!(await autorizzato(req, env))) return risposta("Accesso non autorizzato", 403, h);

    let body;
    try { body = await req.json(); } catch { return risposta("Richiesta non valida", 400, h); }

    const percorso = new URL(req.url).pathname;
    const lettori = { "/scontrino": scontrino, "/estratto": estratto, "/categorizza": categorizza, "/uniforma": uniforma, "/bolletta": bolletta };
    if (lettori[percorso]) {
      const json = (o, stato) => new Response(JSON.stringify(o), { status: stato, headers: { ...h, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
      try { return json(await lettori[percorso](body, env), 200); }
      catch (e) {
        console.error("errore lettura:", e && e.name, e && e.status, e && e.message);
        return json({ errore: messaggioErrore(e) }, e instanceof ErroreLettura ? 400 : 502);
      }
    }

    const dati = String(body.dati || "").slice(0, MAX_DATI);
    const messages = (Array.isArray(body.messages) ? body.messages : [])
      .filter(m => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .slice(-MAX_MESSAGGI)
      .map(m => ({ role: m.role, content: m.content.slice(0, 8000) }))
      // unisce i turni consecutivi dello stesso ruolo (es. domanda rimasta senza risposta) e parte sempre dall'utente
      .reduce((a, m) => { const u = a[a.length - 1]; if (u && u.role === m.role) u.content += "\n\n" + m.content; else if (a.length || m.role === "user") a.push(m); return a; }, []);
    if (!messages.length || messages[messages.length - 1].role !== "user") return risposta("Manca la domanda", 400, h);
    console.log(`domanda: ${messages.length} messaggi, dati ${dati.length} caratteri`);

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const stream = client.beta.messages.stream({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [
        { type: "text", text: SYSTEM },
        { type: "text", text: "DATI DEL FILE EXCEL\n" + dati, cache_control: { type: "ephemeral" } },
      ],
      messages,
    });

    const enc = new TextEncoder();
    const { readable, writable } = new TransformStream();
    const w = writable.getWriter();
    (async () => {
      try {
        for await (const ev of stream) {
          if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") await w.write(enc.encode(ev.delta.text));
        }
        const fin = await stream.finalMessage();
        console.log(`fine: ${fin.stop_reason}, token in ${fin.usage.input_tokens} cache ${fin.usage.cache_read_input_tokens || 0}/${fin.usage.cache_creation_input_tokens || 0}, out ${fin.usage.output_tokens}`);
        if (fin.stop_reason === "refusal") await w.write(enc.encode("\n\nNon posso rispondere a questa domanda."));
        else if (fin.stop_reason === "max_tokens") await w.write(enc.encode("\n\nLa risposta è stata interrotta perché troppo lunga."));
      } catch (e) {
        console.error("errore:", e && e.name, e && e.status, e && e.message);
        await w.write(enc.encode("\n\n" + messaggioErrore(e)));
      } finally {
        await w.close();
      }
    })();
    return new Response(readable, { headers: { ...h, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  },
};
