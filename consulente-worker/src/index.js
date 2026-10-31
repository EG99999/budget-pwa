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
        let msg = "Errore del consulente.";
        if (e instanceof Anthropic.AuthenticationError) msg = "Chiave API non valida: controlla il segreto ANTHROPIC_API_KEY su Cloudflare.";
        else if (e instanceof Anthropic.RateLimitError) msg = "Troppe richieste o tetto di spesa raggiunto: riprova più tardi.";
        else if (e instanceof Anthropic.BadRequestError) msg = "Richiesta rifiutata dall'API: " + e.message;
        else if (e instanceof Anthropic.APIError) msg = `Errore dell'API (${e.status}): ${e.message}`;
        await w.write(enc.encode("\n\n" + msg));
      } finally {
        await w.close();
      }
    })();
    return new Response(readable, { headers: { ...h, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  },
};
