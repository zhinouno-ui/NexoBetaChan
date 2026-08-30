// Monitor de lineas de WhatsApp.
//
// Whaticket no avisa cuando una linea se cae (confirmado por su soporte): hay que
// preguntarle cada tanto. Y GET /api/v1/whatsapps exige read:whatsapps Y
// update:whatsapps, aunque solo lea — por eso el token va separado del de contactos,
// para poder revocarlo solo a el. Esta funcion NUNCA hace otra cosa que GET.
//
//   { "pc":"P4" }                  una sola oficina
//   { "pc":"P4", "solo_ver":true }  no guarda nada
//   { }                            TODAS las que tengan clave cargada
//
// PARA SUMAR UNA OFICINA no hay que tocar ni esto ni el cron: alcanza con cargar el
// secret WHATICKET_MONITOR_<PC> en Supabase. La lista sale de los propios secrets,
// asi que la oficina nueva entra sola en la siguiente corrida.
const B  = "https://api.whaticket.com/api/v1";
const SB = Deno.env.get("SUPABASE_URL")!;
const SK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PREFIJO = "WHATICKET_MONITOR_";

// Las oficinas configuradas son, literalmente, los secrets que existen.
function oficinasConClave(): string[] {
  try {
    return Object.keys(Deno.env.toObject())
      .filter((k) => k.startsWith(PREFIJO) && (Deno.env.get(k) ?? "").trim() !== "")
      .map((k) => k.slice(PREFIJO.length).toUpperCase())
      .filter(Boolean)
      .sort();
  } catch { return []; }
}

async function unaOficina(pc: string, soloVer: boolean) {
  const T = (Deno.env.get(`${PREFIJO}${pc}`) ?? "").trim();
  if (!T) return { pc, ok: false, sin_clave: true };

  let lista: Array<Record<string, unknown>>;
  try {
    const r = await fetch(`${B}/whatsapps`, {
      headers: { Authorization: `Bearer ${T}`, Accept: "application/json" },
    });
    if (!r.ok) {
      let e = ""; try { e = JSON.stringify(await r.json()).slice(0, 160); } catch { /* */ }
      return { pc, ok: false, status: r.status, error: e };
    }
    const j = await r.json();
    lista = Array.isArray(j) ? j : (j.whatsapps ?? j.data ?? []);
  } catch (e) {
    return { pc, ok: false, error: String(e).slice(0, 160) };
  }

  const limpias = lista.map((x) => ({
    id: String(x.id ?? ""),
    name: String(x.name ?? ""),
    status: String(x.status ?? "?"),
  })).filter((x) => x.id !== "");

  const caidas = limpias.filter((x) => x.status !== "CONNECTED");
  const base = {
    pc, ok: true,
    lineas: limpias.length,
    conectadas: limpias.length - caidas.length,
    caidas: caidas.map((c) => ({ nombre: c.name, estado: c.status })),
  };
  if (soloVer) return base;

  let registro: unknown = null;
  try {
    const r = await fetch(`${SB}/rest/v1/rpc/whaticket_lineas_registrar`, {
      method: "POST",
      headers: { apikey: SK, Authorization: `Bearer ${SK}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_pc: pc, p_lineas: limpias }),
    });
    registro = r.ok ? (await r.json())[0] : `error ${r.status}`;
  } catch (e) { registro = String(e).slice(0, 120); }

  return { ...base, registro };
}

Deno.serve(async (req) => {
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* */ }
  const soloVer = body.solo_ver === true;
  const pedida  = String(body.pc ?? "").trim().toUpperCase();

  // Una sola oficina: igual que antes, con error explicito si le falta la clave.
  if (pedida && pedida !== "TODAS") {
    const r = await unaOficina(pedida, soloVer) as Record<string, unknown>;
    if (r.sin_clave) {
      return Response.json({ ok: false, error: `Falta el secret ${PREFIJO}${pedida}` }, { status: 400 });
    }
    return Response.json(r, { status: r.ok ? 200 : 502 });
  }

  const lista = oficinasConClave();
  if (lista.length === 0) {
    return Response.json({ ok: false, error: `No hay ningun secret ${PREFIJO}<PC> cargado` }, { status: 400 });
  }

  const res: Array<Record<string, unknown>> = [];
  for (const pc of lista) {
    res.push(await unaOficina(pc, soloVer) as Record<string, unknown>);
    await new Promise((s) => setTimeout(s, 250));   // no golpear la API de Whaticket
  }

  return Response.json({
    ok: true,
    oficinas: lista,
    total_lineas: res.reduce((a, r) => a + (Number(r.lineas) || 0), 0),
    con_problemas: res.filter((r) => !r.ok || (Array.isArray(r.caidas) && r.caidas.length > 0)),
    detalle: res,
  });
});
