// Agenda en Whaticket los contactos que le faltan a cada oficina.
//
// ⚠ CANDADO DE OFICINA — por qué existe:
// El 25/8 se cargó en el secret el token de P3 creyendo que era el de P4, y se crearon
// 155 contactos con usuarios de P4 dentro de la agenda de P3. La API no tiene endpoint
// para borrar, así que hubo que sacarlos a mano uno por uno.
//
// Antes de escribir NADA se baja una muestra de la agenda y se le pregunta a la base a
// qué oficina pertenecen esos teléfonos. Si no coincide con la pedida, se corta. El
// companyId del token no alcanza: hay que saber qué companyId es de qué oficina, y eso
// lo dicen los datos, no el token.
//
// ⚠ EL UMBRAL ES RELATIVO, NO ABSOLUTO (4/9):
// Exigir 40% de coincidencia asumía una oficina que vincula a casi todos sus usuarios,
// como P2/P3/P4. P5 no llega: la mitad de su gente no tiene vinculo, asi que la mayoria
// de su agenda no puede coincidir con nada nuestro — daba 21,7% siendo la cuenta correcta.
// Es circular: el candado necesita vinculos para validar y la oficina sin vinculos nunca
// valida. Lo que de verdad distingue una key cruzada no es el nivel sino QUIEN GANA: una
// key equivocada no da "la pedida con poco margen", da OTRA oficina primera. Ahora pasa si
// la pedida gana y ademas saca VENTAJA_MIN veces a la segunda, o llega al 40% de siempre.
// Se mantiene un piso para no validar con cuatro telefonos sueltos.
//
// ⚠ EL CANDADO VA ANTES QUE EL ESPEJO (4/9):
// Estaba al reves y el refresco escribia 300 contactos en whaticket_contactos_stage sin
// que nadie hubiera validado de quien era la cuenta. Con una key cruzada, el espejo de esa
// oficina quedaba lleno de contactos ajenos y entonces whaticket_contactos_a_agendar creia
// que esa gente ya estaba agendada y NO la agendaba nunca. Silencioso y dificil de ver.
// Cuesta 5 pedidos extra cuando no hay nada que hacer; barato al lado de eso.
//
// ⚠ UNA OFICINA POR CORRIDA — por qué (arreglado 27/8):
// El límite de Supabase es 150 s POR INVOCACIÓN. Cada oficina tarda hasta ~75 s
// (150 contactos x 350 ms de espera entre pedidos). Recorrerlas en serie dentro de la
// misma invocación funcionaba con UNA oficina y empezó a morir con 504 IDLE_TIMEOUT
// apenas se cargó la segunda key: 3 oficinas x 75 s = 240 s. El cron figuraba
// "succeeded" igual, porque net.http_post solo confirma que despachó el pedido, no que
// la función haya terminado — falso verde, y estuvo dos días sin sincronizar sin que
// se notara. Ahora cada corrida atiende UNA oficina, rotando por reloj.
//
// ⚠ REFRESCAR EL ESPEJO — por qué (arreglado 27/8):
// whaticket_contactos_a_agendar decide quien falta comparando contra
// whaticket_contactos_stage. Si el espejo no se refresca, todo lo que se agenda queda
// "pendiente" PARA SIEMPRE: P3 reintentaba los mismos 97 contactos en cada corrida y
// Whaticket respondia DUPLICATED en los 97, sin que el contador bajara nunca. La API
// devuelve los mas NUEVOS primero, asi que con las primeras paginas alcanza.
//
//   { "pc":"P4", "limite":50, "simulacro":true }   una oficina puntual
//   { }                                            la que toque por rotación (el cron)
//   { "pc":"TODAS" }                               todas, con presupuesto de tiempo
//
// Para sumar una oficina alcanza con cargar el secret WHATICKET_TOKEN_<PC>.
const B  = "https://api.whaticket.com/api/v1";
const SB = Deno.env.get("SUPABASE_URL")!;
const SK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PREFIJO = "WHATICKET_TOKEN_";
const UMBRAL = 40;        // % que valida por si solo, sin mirar a la segunda
const PISO = 8;           // % minimo: por debajo no se valida ni con ventaja
const VENTAJA_MIN = 3;    // cuantas veces tiene que sacarle a la segunda oficina
const TECHO_TANDA = 150;  // por oficina y corrida: 150 x 350ms ~ 75s, entra en los 150s
const ROTACION_MS = 30 * 60 * 1000;  // debe coincidir con la cadencia del cron
const PRESUPUESTO_MS = 110_000;      // margen bajo los 150s de la invocacion
const PAGINAS_REFRESCO = 3;          // 300 contactos mas nuevos: sobra entre corrida y corrida

async function rpc(nombre: string, cuerpo: unknown) {
  const r = await fetch(`${SB}/rest/v1/rpc/${nombre}`, {
    method: "POST",
    headers: { apikey: SK, Authorization: `Bearer ${SK}`, "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  if (!r.ok) throw new Error(`${nombre}: ${r.status} ${(await r.text()).slice(0, 160)}`);
  return await r.json();
}

function oficinasConToken(): string[] {
  try {
    return Object.keys(Deno.env.toObject())
      .filter((k) => k.startsWith(PREFIJO) && (Deno.env.get(k) ?? "").trim() !== "")
      .map((k) => k.slice(PREFIJO.length).toUpperCase())
      .filter((pc) => /^P[0-9]+$/.test(pc))
      .sort();
  } catch { return []; }
}

// Pone al dia el espejo de la agenda. Se delega en whaticket-traer para no duplicar su
// logica de paginado (esa funcion ya sabe que el flag hasMore de la API miente).
async function refrescarEspejo(pc: string) {
  try {
    const r = await fetch(`${SB}/functions/v1/whaticket-traer`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SK}`, "Content-Type": "application/json" },
      body: JSON.stringify({ pc, desde: 1, hasta: PAGINAS_REFRESCO }),
    });
    const j = await r.json().catch(() => ({} as Record<string, unknown>));
    if (!r.ok) return { ok: false, error: `traer: ${r.status}` };
    return { ok: true, vistos: Number(j.vistos ?? 0) };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 120) };
  }
}

async function unaOficina(pc: string, limite: number, simulacro: boolean, compartidos: boolean) {
  const T = (Deno.env.get(`${PREFIJO}${pc}`) ?? "").trim();
  if (!T) return { pc, ok: false, error: "sin token" };

  // ── 1) CANDADO: ¿de que oficina es esta cuenta? Va PRIMERO: hasta no confirmarlo no se
  //    toca nada, ni siquiera nuestro propio espejo.
  const tels: string[] = [];
  for (let p = 1; p <= 5; p++) {
    const r = await fetch(`${B}/contacts?pageNumber=${p}`, {
      headers: { Authorization: `Bearer ${T}`, Accept: "application/json" },
    });
    if (!r.ok) return { pc, ok: false, error: `No se pudo leer la agenda: ${r.status}` };
    const j = await r.json();
    for (const c of (j.contacts ?? [])) {
      const t = String(c.number ?? "").replace(/\D/g, "").slice(-10);
      if (t.length === 10) tels.push(t);
    }
    await new Promise((s) => setTimeout(s, 150));
  }

  let veredicto: Record<string, unknown>;
  try {
    veredicto = await rpc("whaticket_identificar_oficina", { p_telefonos: tels });
  } catch (e) {
    return { pc, ok: false, error: "No se pudo identificar la cuenta: " + String(e).slice(0, 140) };
  }

  const cual = String(veredicto.veredicto ?? "");
  const detalle = ((veredicto.por_oficina ?? []) as Array<Record<string, unknown>>)
    .slice().sort((a, b) => Number(b.pct ?? 0) - Number(a.pct ?? 0));
  const pct1 = Number(detalle[0]?.pct ?? 0);
  const pct2 = Number(detalle[1]?.pct ?? 0);
  const ventaja = pct2 > 0 ? pct1 / pct2 : Infinity;
  const pctPedida = Number(detalle.find((d) => d.pc === pc)?.pct ?? 0);

  const gana   = cual === pc;
  const seguro = pctPedida >= PISO && (pctPedida >= UMBRAL || ventaja >= VENTAJA_MIN);

  if (!gana || !seguro) {
    return {
      pc, ok: false,
      error: "LA CUENTA NO ES LA QUE PEDISTE — no se escribio nada",
      la_cuenta_parece_de: cual || "(indeterminado)",
      coincidencia: pctPedida + "%",
      segunda: detalle[1] ? `${detalle[1].pc} ${pct2}%` : "(ninguna)",
      ventaja: Number.isFinite(ventaja) ? ventaja.toFixed(1) + "x" : "sin competencia",
      motivo: !gana ? "gana otra oficina"
            : pctPedida < PISO ? `no llega al piso de ${PISO}%`
            : `ni ${UMBRAL}% ni ${VENTAJA_MIN}x sobre la segunda`,
    };
  }

  // ── 2) Espejo al dia. Recien ahora, con la cuenta ya confirmada: si no, una key cruzada
  //    llenaba el espejo de esta oficina con contactos ajenos y los suyos quedaban sin
  //    agendar para siempre, porque figuraban como "ya estaban".
  const espejo = await refrescarEspejo(pc);

  // ── 3) ¿Hay algo que hacer? Se le pregunta a NUESTRA base, que es gratis.
  let lista: Array<{ usuario: string; telefono: string; nombre_agenda: string; compartido: boolean }>;
  try {
    lista = await rpc("whaticket_contactos_a_agendar",
      { p_pc: pc, p_limit: limite, p_incluir_compartidos: compartidos });
  } catch (e) {
    return { pc, ok: false, espejo, error: String(e).slice(0, 180) };
  }

  const cuenta = `${cual} (${pctPedida}%${Number.isFinite(ventaja) ? ", " + ventaja.toFixed(1) + "x sobre la 2a" : ""})`;

  if (!Array.isArray(lista) || lista.length === 0) {
    return { pc, ok: true, espejo, cuenta_verificada: cuenta, cuantos: 0, creados: 0, nota: "nada para agendar" };
  }

  if (simulacro) {
    return {
      pc, ok: true, simulacro: true, espejo,
      cuenta_verificada: cuenta,
      cuantos: lista.length,
      ejemplos: lista.slice(0, 5).map((c) => c.nombre_agenda),
    };
  }

  // ── 4) Escritura ─────────────────────────────────────────────────────
  // Se corta sola si se acerca al limite de la invocacion: mejor agendar 90 y devolver un
  // resultado legible que morir en 504 y no saber que se escribio.
  const t0 = Date.now();
  let creados = 0, ya_estaban = 0, sin_intentar = 0;
  const fallidos: Array<{ usuario: string; motivo: string }> = [];

  for (const c of lista) {
    if (Date.now() - t0 > PRESUPUESTO_MS) { sin_intentar++; continue; }
    try {
      const r = await fetch(`${B}/contacts`, {
        method: "POST",
        headers: { Authorization: `Bearer ${T}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ name: c.nombre_agenda, number: c.telefono }),
      });
      if (r.status === 201 || r.ok) creados++;
      else {
        let err = "";
        try { err = String((await r.json())?.error ?? r.status); } catch { err = String(r.status); }
        if (err.includes("DUPLICATED")) ya_estaban++;
        else fallidos.push({ usuario: c.usuario, motivo: err.slice(0, 70) });
      }
    } catch (e) { fallidos.push({ usuario: c.usuario, motivo: String(e).slice(0, 70) }); }
    await new Promise((s) => setTimeout(s, 350));
  }

  return {
    pc, ok: true, espejo,
    cuenta_verificada: cuenta,
    intentados: lista.length - sin_intentar, creados, ya_estaban,
    fallidos: fallidos.length, detalle_fallidos: fallidos.slice(0, 5),
    ...(sin_intentar ? { sin_intentar, nota: "cortado por tiempo — siguen en la proxima corrida" } : {}),
  };
}

Deno.serve(async (req) => {
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* */ }

  const pedida      = String(body.pc ?? "").trim().toUpperCase();
  const simulacro   = body.simulacro === true;
  const compartidos = body.compartidos === true;
  const limite      = Math.max(1, Math.min(Number(body.limite ?? TECHO_TANDA), 500));

  // Una oficina puntual (el panel, el Admi, una prueba a mano).
  if (pedida && pedida !== "TODAS") {
    const r = await unaOficina(pedida, limite, simulacro, compartidos);
    return Response.json(r, { status: r.ok ? 200 : 409 });
  }

  const lista = oficinasConToken();
  if (lista.length === 0) {
    return Response.json({ ok: false, error: `No hay ningun secret ${PREFIJO}<PC> cargado` }, { status: 400 });
  }

  // TODAS explicito: en serie, pero cortando antes del limite. Devuelve que quedo sin
  // atender en vez de morir a mitad de camino sin decir nada.
  if (pedida === "TODAS") {
    const t0 = Date.now();
    const res: Array<Record<string, unknown>> = [];
    const pendientes: string[] = [];
    for (const pc of lista) {
      if (Date.now() - t0 > PRESUPUESTO_MS) { pendientes.push(pc); continue; }
      res.push(await unaOficina(pc, limite, simulacro, compartidos) as Record<string, unknown>);
    }
    return Response.json({
      ok: true, modo: "todas", oficinas: lista,
      creados_total: res.reduce((a, r) => a + (Number(r.creados) || 0), 0),
      con_error: res.filter((r) => !r.ok),
      ...(pendientes.length ? { pendientes, nota: "cortado por tiempo" } : {}),
      detalle: res,
    });
  }

  // Sin pc: modo del cron. Le toca UNA oficina, elegida por reloj — sin estado que
  // mantener y sin depender de que la corrida anterior haya terminado bien. Si se
  // suma una oficina el orden se corre una posicion y a lo sumo se repite un turno.
  const turno = Math.floor(Date.now() / ROTACION_MS) % lista.length;
  const pc = lista[turno];
  const r = await unaOficina(pc, limite, simulacro, compartidos);

  return Response.json({
    ok: true, modo: "rotacion", le_toco: pc, de: lista,
    proxima: lista[(turno + 1) % lista.length],
    resultado: r,
  });
});
