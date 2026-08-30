// Verifica el token nuevo ANTES de escribir nada:
//   1. Qué permisos trae y de qué companyId es
//   2. Baja una muestra de la agenda y compara los teléfonos contra los usuarios de
//      cada oficina. La que dé alto porcentaje es la cuenta de verdad.
// Solo GET. No crea nada.
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
    return { companyId: j.companyId, scope: j.scope };
  } catch { return null; }
}

Deno.serve(async () => {
  const T = (Deno.env.get("WHATICKET_TOKEN_P4") ?? "").trim();
  const info = datosToken(T);

  // Muestra de la agenda: 5 páginas alcanzan para identificar la cuenta.
  const tels: string[] = [];
  let estadoLineas: unknown = null;
  for (let p = 1; p <= 5; p++) {
    const r = await fetch(`${B}/contacts?pageNumber=${p}`, {
      headers: { Authorization: `Bearer ${T}`, Accept: "application/json" },
    });
    if (!r.ok) { tels.push(`__error_${r.status}__`); break; }
    const j = await r.json();
    for (const c of (j.contacts ?? [])) {
      const t = String(c.number ?? "").replace(/\D/g, "").slice(-10);
      if (t.length === 10) tels.push(t);
    }
    await new Promise((s) => setTimeout(s, 150));
  }

  // De paso, ¿ahora sí anda read:whatsapps?
  try {
    const r = await fetch(`${B}/whatsapps`, {
      headers: { Authorization: `Bearer ${T}`, Accept: "application/json" },
    });
    if (r.ok) {
      const j = await r.json();
      const lista = Array.isArray(j) ? j : (j.whatsapps ?? j.data ?? []);
      const campos = new Set<string>();
      for (const x of lista) for (const k of Object.keys(x ?? {})) campos.add(k);
      const est: Record<string, number> = {};
      for (const k of [...campos].filter((c) => /status|state|connect/i.test(c))) {
        for (const x of lista) {
          const v = String((x as Record<string, unknown>)[k] ?? "?").slice(0, 24);
          est[`${k}=${v}`] = (est[`${k}=${v}`] ?? 0) + 1;
        }
      }
      estadoLineas = { lineas: lista.length, campos: [...campos].sort(), estados: est };
    } else {
      let e = ""; try { e = String((await r.json())?.error ?? ""); } catch { /* */ }
      estadoLineas = `${r.status} ${e}`;
    }
  } catch (e) { estadoLineas = String(e).slice(0, 60); }

  // ¿De qué oficina son esos teléfonos?
  let pertenece: unknown = "(no se pudo calcular)";
  try {
    const r = await fetch(`${SB}/rest/v1/rpc/whaticket_identificar_oficina`, {
      method: "POST",
      headers: { apikey: SK, Authorization: `Bearer ${SK}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_telefonos: tels }),
    });
    if (r.ok) pertenece = await r.json();
    else pertenece = `${r.status} ${(await r.text()).slice(0, 120)}`;
  } catch (e) { pertenece = String(e).slice(0, 80); }

  return Response.json({
    token: info,
    telefonos_de_muestra: tels.length,
    a_que_oficina_pertenece: pertenece,
    read_whatsapps: estadoLineas,
  });
});
