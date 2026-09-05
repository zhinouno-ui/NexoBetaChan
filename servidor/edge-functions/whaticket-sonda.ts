// Sonda de diagnostico. SOLO GET: no crea, no modifica, no manda mensajes.
//
// Sirve para dos cosas:
//   1. Verificar un token nuevo antes de usarlo (que permisos trae, de que companyId es,
//      y a que oficina pertenecen los telefonos de su agenda).
//   2. Averiguar QUE SE PUEDE LEER con ese token. Puntualmente si se pueden traer las
//      conversaciones: la idea de auditar como responden los operadores depende de eso.
//      Whaticket documenta webhooks ENTRANTES (n8n -> Whaticket) pero no salientes, asi
//      que si no se pueden leer los mensajes por API, no hay forma de verlos.
//
//   { "pc": "P5" }   por defecto P4
const B  = "https://api.whaticket.com/api/v1";
const SB = Deno.env.get("SUPABASE_URL")!;
const SK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function datosToken(jwt: string) {
  const p = jwt.split(".");
  if (p.length !== 3) return null;
  try {
    const b64 = p[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const j = JSON.parse(new TextDecoder().decode(
      Uint8Array.from(atob(pad), (c) => c.charCodeAt(0))));
    return { companyId: j.companyId, scope: j.scope, exp: j.exp };
  } catch { return null; }
}

// Prueba un endpoint y cuenta que devolvio, sin volcar datos de clientes.
async function probar(T: string, ruta: string) {
  try {
    const r = await fetch(`${B}${ruta}`, {
      headers: { Authorization: `Bearer ${T}`, Accept: "application/json" },
    });
    if (!r.ok) {
      let e = ""; try { e = String((await r.json())?.error ?? "").slice(0, 90); } catch { /* */ }
      return { ruta, status: r.status, error: e || null };
    }
    const j = await r.json();
    // La forma de la respuesta cambia segun el endpoint: array suelto, {tickets}, {data}...
    const lista = Array.isArray(j) ? j
      : (j.tickets ?? j.messages ?? j.contacts ?? j.whatsapps ?? j.data ?? null);
    const campos = Array.isArray(lista) && lista.length
      ? Object.keys(lista[0] ?? {}).sort() : Object.keys(j ?? {}).sort();
    return {
      ruta, status: 200,
      cuantos: Array.isArray(lista) ? lista.length : null,
      campos: campos.slice(0, 25),
    };
  } catch (e) { return { ruta, error: String(e).slice(0, 80) }; }
}

Deno.serve(async (req) => {
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* */ }
  const pc = String(body.pc ?? "P4").toUpperCase();

  const T = (Deno.env.get(`WHATICKET_TOKEN_${pc}`) ?? "").trim();
  if (!T) return Response.json({ ok: false, error: `Falta WHATICKET_TOKEN_${pc}` }, { status: 400 });

  // Lo que interesa saber: ¿se pueden LEER conversaciones? Si /tickets y /messages
  // contestan 200, se pueden traer por consulta y no hace falta ningun webhook.
  const rutas = [
    "/contacts?pageNumber=1",
    "/whatsapps",
    "/tickets",
    "/tickets?pageNumber=1",
    "/messages",
    "/queues",
    "/users",
  ];
  const endpoints = [];
  for (const r of rutas) {
    endpoints.push(await probar(T, r));
    await new Promise((s) => setTimeout(s, 150));
  }

  // De paso: ¿de que oficina es la agenda? (el candado de siempre)
  const tels: string[] = [];
  for (let p = 1; p <= 3; p++) {
    const r = await fetch(`${B}/contacts?pageNumber=${p}`, {
      headers: { Authorization: `Bearer ${T}`, Accept: "application/json" },
    });
    if (!r.ok) break;
    const j = await r.json();
    for (const c of (j.contacts ?? [])) {
      const t = String(c.number ?? "").replace(/\D/g, "").slice(-10);
      if (t.length === 10) tels.push(t);
    }
    await new Promise((s) => setTimeout(s, 150));
  }
  let pertenece: unknown = "(no se pudo calcular)";
  try {
    const r = await fetch(`${SB}/rest/v1/rpc/whaticket_identificar_oficina`, {
      method: "POST",
      headers: { apikey: SK, Authorization: `Bearer ${SK}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_telefonos: tels }),
    });
    if (r.ok) pertenece = await r.json();
  } catch (_e) { /* */ }

  return Response.json({
    pc,
    token: datosToken(T),
    a_que_oficina_pertenece: pertenece,
    endpoints,
  });
});
