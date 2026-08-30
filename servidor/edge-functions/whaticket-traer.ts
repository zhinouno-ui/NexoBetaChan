// Trae los contactos de Whaticket a la tabla de paso whaticket_contactos_stage.
//
// NO escribe en tablas de producción. La zona de paso es un espejo crudo.
//
// ⚠ hasMore MIENTE. La primera versión cortaba cuando la API decía hasMore:false, y así
// se trajo 15.541 de los 49.566 contactos reales de P4 — el 31% — dando por completa una
// agenda que estaba a un tercio. Todo el análisis que salió de ahí quedó mal.
//
// Ahora la única señal de fin es una PÁGINA VACÍA, y se exige que vengan DOS seguidas
// para descartar un hueco puntual. hasMore se ignora salvo para informar.
//
// Body: { "desde": 1, "hasta": 40, "pc": "P4" }

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WTK_BASE = "https://api.whaticket.com/api/v1/contacts";

type Fila = {
  pc_codigo: string;
  wtk_id: string;
  nombre_raw: string | null;
  numero_raw: string | null;
  creado_wtk: string | null;
};

async function guardar(filas: Fila[]) {
  if (!filas.length) return 0;
  const r = await fetch(`${SB_URL}/rest/v1/whaticket_contactos_stage`, {
    method: "POST",
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(filas),
  });
  if (!r.ok) throw new Error(`guardar: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return filas.length;
}

Deno.serve(async (req) => {
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* sin body, van los default */ }

  const pc = String(body.pc ?? "P4").toUpperCase();
  const desde = Number(body.desde ?? 1);
  const hasta = Number(body.hasta ?? desde + 39);

  const token = (Deno.env.get(`WHATICKET_TOKEN_${pc}`) ?? "").trim();
  if (!token) {
    return Response.json({ ok: false, error: `Falta el secret WHATICKET_TOKEN_${pc}.` }, { status: 400 });
  }

  let vistos = 0, guardados = 0, pagina = desde;
  let vaciasSeguidas = 0;
  let dijoHasMore = true;

  try {
    for (pagina = desde; pagina <= hasta; pagina++) {
      const r = await fetch(`${WTK_BASE}?pageNumber=${pagina}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      if (!r.ok) {
        return Response.json({
          ok: false, error: `Whaticket devolvió ${r.status} en la página ${pagina}`,
          vistos, guardados, siguiente_pagina: pagina,
        }, { status: 502 });
      }
      const j = await r.json();
      const cs: Array<Record<string, unknown>> = j.contacts ?? [];
      dijoHasMore = !!j.hasMore;

      // FIN DE VERDAD: dos páginas vacías seguidas. hasMore no decide nada.
      if (cs.length === 0) {
        vaciasSeguidas++;
        if (vaciasSeguidas >= 2) { pagina++; break; }
        continue;
      }
      vaciasSeguidas = 0;
      vistos += cs.length;

      guardados += await guardar(cs.map((c) => ({
        pc_codigo: pc,
        wtk_id: String(c.id ?? ""),
        nombre_raw: (c.name ?? null) as string | null,
        numero_raw: (c.number ?? null) as string | null,
        creado_wtk: (c.createdAt ?? null) as string | null,
      })).filter((f) => f.wtk_id !== ""));

      await new Promise((res) => setTimeout(res, 120));   // sin apurarle el server a Whaticket
    }
  } catch (e) {
    return Response.json({
      ok: false, error: String(e).slice(0, 300), vistos, guardados, siguiente_pagina: pagina,
    }, { status: 500 });
  }

  const termino = vaciasSeguidas >= 2;
  return Response.json({
    ok: true,
    pc,
    paginas: `${desde}..${pagina - 1}`,
    vistos,
    guardados,
    termino_de_verdad: termino,
    siguiente_pagina: termino ? null : pagina,
    la_api_dijo_hasMore: dijoHasMore,
    nota: "El fin se detecta por páginas vacías, no por hasMore — esa bandera mintió y costó el 69% de la agenda.",
  });
});
