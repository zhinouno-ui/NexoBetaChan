// TEMPORAL — sonda para saber si Whaticket ya permite EDITAR contactos.
//
// En agosto/2026 no existia: PUT/PATCH/DELETE sobre /contacts daban 404, y por eso los
// 155 contactos mal creados en P3 hubo que sacarlos a mano. Si ahora existe, se podrian
// corregir en masa los ~3.000 nombres mal cargados en vez de uno por uno.
//
// SEGURIDAD: manda el MISMO nombre y numero que ya tiene el contacto, asi que aunque la
// edicion funcione no cambia nada. NO prueba DELETE a proposito: si funcionara, borraria
// un contacto real.
const B = "https://api.whaticket.com/api/v1";

Deno.serve(async () => {
  const T = (Deno.env.get("WHATICKET_TOKEN_P4") ?? "").trim();
  if (!T) return Response.json({ ok: false, error: "falta WHATICKET_TOKEN_P4" }, { status: 400 });

  const H = { Authorization: `Bearer ${T}`, Accept: "application/json" };

  // 1) Un contacto real, para probar sobre algo que existe
  const rl = await fetch(`${B}/contacts?pageNumber=1`, { headers: H });
  if (!rl.ok) return Response.json({ ok: false, paso: "listar", status: rl.status }, { status: 502 });
  const j = await rl.json();
  const c = (j.contacts ?? [])[0];
  if (!c) return Response.json({ ok: false, error: "la agenda vino vacia" }, { status: 502 });

  const id     = String(c.id ?? "");
  const nombre = String(c.name ?? "");
  const numero = String(c.number ?? "");

  // Mismo nombre y mismo numero: si la edicion anda, es un no-op
  const cuerpo = JSON.stringify({ name: nombre, number: numero });
  const HW = { ...H, "Content-Type": "application/json" };

  async function probar(metodo: string, url: string, body?: string) {
    try {
      const r = await fetch(url, { method: metodo, headers: HW, body });
      let txt = "";
      try { txt = (await r.text()).slice(0, 180); } catch { /* */ }
      return { metodo, status: r.status, respuesta: txt };
    } catch (e) {
      return { metodo, status: 0, respuesta: String(e).slice(0, 120) };
    }
  }

  const pruebas = [
    await probar("PUT",   `${B}/contacts/${id}`, cuerpo),
    await probar("PATCH", `${B}/contacts/${id}`, cuerpo),
    // Por las dudas Whaticket use otra ruta para editar
    await probar("PUT",   `${B}/contact/${id}`,  cuerpo),
  ];

  return Response.json({
    ok: true,
    probado_sobre: { id, nombre_actual: nombre, numero_ultimos: numero.slice(-4) },
    aviso: "se mando el mismo nombre y numero: aunque la edicion funcione, no cambia nada",
    pruebas,
    conclusion: pruebas.some((p) => p.status >= 200 && p.status < 300)
      ? "SE PUEDE EDITAR"
      : "NO se puede editar (sigue como en agosto)",
  });
});
