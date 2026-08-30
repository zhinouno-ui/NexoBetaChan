// Webhook de Whaticket — FASE DE ESCUCHA.
//
// Registra lo que entra por WhatsApp y NO CONTESTA NADA. No manda mensajes, no toca
// tickets, no modifica vínculos. Lo único que escribe es la bitácora whaticket_eventos.
//
// Al recibir resuelve el teléfono contra nuestros datos, así medimos en vivo cuántas
// conversaciones podríamos atender sabiendo quién es el que escribe.
//
// URL a configurar en Whaticket (una por oficina):
//   https://<proyecto>.supabase.co/functions/v1/whaticket-webhook?pc=P4&k=<clave>
//
// Va sin JWT de Supabase porque Whaticket no lo sabe mandar; la puerta es la clave `k`,
// que se compara contra el secret WHATICKET_WEBHOOK_KEY.

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLAVE = (Deno.env.get("WHATICKET_WEBHOOK_KEY") ?? "").trim();

const soloDigitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const tel10 = (s: unknown) => soloDigitos(s).slice(-10);

async function sb(path: string, init: RequestInit) {
  return await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

async function resolver(pc: string, tel: string) {
  try {
    const r = await sb("rpc/whaticket_resolver_telefono", {
      method: "POST",
      body: JSON.stringify({ p_pc: pc, p_tel: tel }),
    });
    if (!r.ok) return { usuario: null, resuelto_por: null };
    const j = await r.json();
    const f = Array.isArray(j) ? j[0] : j;
    return { usuario: f?.usuario ?? null, resuelto_por: f?.resuelto_por ?? null };
  } catch {
    return { usuario: null, resuelto_por: null };
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Puerta. Si no hay clave configurada, no se acepta nada: mejor perder eventos que
  // dejar un endpoint abierto donde cualquiera pueda escribir en la base.
  if (!CLAVE || url.searchParams.get("k") !== CLAVE) {
    return new Response("no", { status: 401 });
  }

  const pc = (url.searchParams.get("pc") ?? "").toUpperCase();
  if (!/^P\d+$/.test(pc)) return new Response("pc?", { status: 400 });

  let p: Record<string, unknown> = {};
  try { p = await req.json(); } catch { /* cuerpo raro: igual lo dejamos pasar abajo */ }

  // Nombres de campo según la documentación de Whaticket, con alternativas por si
  // el fork usa otras. Lo que no reconozcamos queda igual en `payload`.
  const telefono = tel10(p.sender ?? p.number ?? p.telefone ?? "");
  const mensaje  = String(p.mensagem ?? p.message ?? p.body ?? "").slice(0, 4000);
  const fromMe   = p.fromMe === true || p.fromMe === "true";

  // Solo se resuelve lo que entra del cliente. Lo que mandó el operador no hace falta.
  const quien = (!fromMe && telefono.length === 10)
    ? await resolver(pc, telefono)
    : { usuario: null, resuelto_por: null };

  try {
    await sb("whaticket_eventos", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify([{
        pc_codigo: pc,
        accion: p.acao ?? p.action ?? null,
        ticket_id: p.chamadoId != null ? String(p.chamadoId) : null,
        queue_id: p.queueId != null ? String(p.queueId) : null,
        de_nosotros: fromMe,
        telefono: telefono || null,
        mensaje: mensaje || null,
        usuario: quien.usuario,
        resuelto_por: quien.resuelto_por,
        payload: p,
      }]),
    });
  } catch (_e) {
    // Que un fallo nuestro no le rompa el webhook a Whaticket: si devolvemos error
    // seguido, pueden desactivar la conexión. Preferimos perder un evento.
  }

  // Siempre 200 y sin cuerpo: no contestamos, no confirmamos nada, no devolvemos datos.
  return new Response(null, { status: 200 });
});
