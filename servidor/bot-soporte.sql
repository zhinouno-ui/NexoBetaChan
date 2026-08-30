-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- BOT DE SOPORTE · copia de lo que corre en Supabase (proyecto NODO · pjvvyvfcwjoocjqvdror)
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- ESTE ARCHIVO ES UNA COPIA DE LECTURA. La fuente de verdad son las migraciones de Supabase
-- (soporte_*, trg_soporte_*, del 24-25/08). Está acá porque el bot no vive en el código de la
-- app y no había forma de leerlo sin entrar a la base — se lo buscó en git más de una vez.
--
-- Cómo funciona, de arriba hacia abajo:
--
--   trg_soporte_autorespuesta        BEFORE INSERT en landing_solicitudes, solo tipo='SOPORTE'.
--     └─ soporte_auto_mensaje_v1     decide QUÉ contestar. Función pura: no escribe nada.
--          ├─ _soporte_ya_dijo       freno anti-repetición (no repite un caso en 3 min).
--          ├─ _soporte_texto_rechazo arma el texto de un rechazo.
--          └─ soporte_motivo_publicable  filtra motivos internos que no se le muestran al cliente.
--
-- La respuesta se escribe en metadata.chat_thread de la MISMA fila, como un mensaje con
-- origen='OPERADOR', operador='NODO', auto=true. En metadata quedan además estas marcas:
--   auto_respondido_at   contestó de verdad
--   auto_caso            qué caso detectó (COMPROBANTE, ESTADO_CARGA, RECHAZO_RETIRO, …)
--   auto_espejo          NO contestó: solo anotó qué habría dicho (oficina fuera de v_reales)
--   auto_omitido         se calló por repetido
--
-- Dos frenos que importan:
--   · DERIVAR_HUMANO (angustia / adicción) devuelve caso SIN mensaje: no contesta un bot,
--     queda anotado para que lo tome una persona.
--   · Todo el trigger está dentro de un exception handler que devuelve NEW: un error del bot
--     NUNCA puede voltear el insert de la solicitud.
--
-- Funciones que acompañan pero no son del hilo de respuesta:
--   soporte_autorespuesta_v1        versión por lotes/cron (la instantánea es el trigger).
--   soporte_espejo_resumen          qué habría contestado, para auditar antes de activar.
--   soporte_vincular_automatico_v1  crea/completa vínculos usuario↔teléfono desde soporte.
--
-- Generado con pg_get_functiondef el 2026-08-30. Verificado por md5 contra la base.
-- ═══════════════════════════════════════════════════════════════════════════════════════════


-- ══ _soporte_texto_rechazo(p_tipo text, p_monto text, p_min integer, p_motivo text)
CREATE OR REPLACE FUNCTION public._soporte_texto_rechazo(p_tipo text, p_monto text, p_min integer, p_motivo text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case p_tipo when 'CARGA' then 'Tu carga' else 'Tu retiro' end
      || coalesce(' de ' || p_monto, '')
      || case p_tipo when 'CARGA' then ' fue rechazada' else ' fue rechazado' end
      || '. '
      || coalesce('Motivo: ' || public.soporte_motivo_publicable(p_motivo) || ' ',
                  'Escribinos por acá y lo revisamos con vos.');
$function$
;

-- ══ _soporte_ya_dijo(p_pc text, p_usuario_norm text, p_caso text, p_ventana interval)
CREATE OR REPLACE FUNCTION public._soporte_ya_dijo(p_pc text, p_usuario_norm text, p_caso text, p_ventana interval)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.landing_solicitudes s
    where s.tipo = 'SOPORTE'
      and s.pc_codigo = p_pc
      and nodo_norm_usuario_v21(s.usuario) = p_usuario_norm
      and s.metadata->>'auto_caso' = p_caso
      and s.created_at >= now() - p_ventana
  );
$function$
;

-- ══ soporte_auto_mensaje_v1(p_pc text, p_usuario text, p_texto text, p_cuando timestamp with time zone)
-- Decide qué contestar en soporte. Función pura: no escribe. Si no hay nada cierto que decir, no devuelve fila.
CREATE OR REPLACE FUNCTION public.soporte_auto_mensaje_v1(p_pc text, p_usuario text, p_texto text, p_cuando timestamp with time zone DEFAULT now())
 RETURNS TABLE(caso text, mensaje text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pc    text := upper(btrim(coalesce(p_pc,'')));
  v_u     text := nodo_norm_usuario_v21(p_usuario);
  v_texto text := btrim(coalesce(p_texto,''));
  v_norm  text := lower(unaccent(btrim(coalesce(p_texto,''))));
  v_saludo boolean; v_cierre boolean; v_reclamo boolean; v_prefiere text;
  v_comprobante boolean; v_aviso_pago boolean; v_quiere_cargar boolean;
  v_pide_usuario boolean; v_pide_validar boolean;
  o_tipo text; o_estado text; o_monto_r text; o_min int; o_motivo text;
  v_monto text; v_plata boolean; v_apertura text;
  v_derivar boolean; v_problema boolean; v_saldo boolean; v_demora boolean;
  v_limpio text := btrim(regexp_replace(lower(unaccent(btrim(coalesce(p_texto,'')))), '[^a-z0-9]+', ' ', 'g'));
begin
  if v_pc = '' or coalesce(v_u,'') = '' then return; end if;

  v_derivar := v_norm ~ 'adicc|ludopat|no puedo parar|me arruin|soy pobre|no tengo para (comer|comprar)'
              or v_norm ~ 'me quiero (matar|morir)|no doy mas|estoy desesperad|por favor te (lo )?pido';
  if v_derivar then
    caso := 'DERIVAR_HUMANO';   -- mensaje queda NULL a proposito: no se contesta solo
    return next; return;
  end if;

  v_comprobante := v_texto ~ 'Imagen adjunta';
  v_aviso_pago := v_norm ~ 'ya (te |le |se )?(carg|transfer|tranfer|pas|envi|deposit|mand)'
               or v_norm ~ '^(te |le )?(carg|transfer|tranfer|envi|mand|pas)[a-z]* (te |le )?[0-9$]'
               or v_norm ~ '^(enviado|transferido|cargado|listo el pago|pagado)$'
               or v_norm ~ 'no me figura|no se me acredit|hice la transferencia|ise la transferencia'
               or v_norm ~ '^(ya |ahi |recien )?(cargue|carge|transferi|tranferi|pague|deposite|envie|mande)\M'
               or v_norm ~ '(ya |recien )?(ise|hice) (una |la )?(transferencia|tranferencia|carga)'
               or v_norm ~ '^(la|lo) (envie|mande|pase)\M';
  v_quiere_cargar := not v_aviso_pago and (
                       v_norm ~ 'para cargar|quiero cargar|una recarga|quiero recargar'
                    or v_norm ~ 'pasame.*(cbu|alias|numero|num)|mandame.*(cbu|alias)'
                    or v_norm ~ '^(cbu|alias|cargar|carga|recarga)[\s!.?¿]*$'
                    or v_norm ~ 'donde (transfiero|deposito|mando)|a que (cuenta|cbu)' );

  -- Plantillas del portal: la persona YA dijo qué necesita y dejó sus datos.
  v_pide_usuario := v_norm ~ 'quiero registrarme|apodo\s*:|me haces un usuario|hacerme un usuario';
  v_pide_validar := v_norm ~ 'quiero validar mi acceso|validar mi acceso';

  v_saludo := v_norm ~ '^(hola+|buenas|buen dia|buenos dias|buenas tardes|buenas noches|hey|hi|holis)\M';
  v_cierre := v_limpio ~ '^((ok|oka|okey|okis|listo|lsito|dale|perfecto|barbaro|genial|joya|buenisimo|excelente|gracias|muchas|mil|de|una|bueno|buena|si|sisi|ahi|esta|estamos|ahora|ya|todo|bien|tal|cual|claro|clarito|obvio|listorti)( |$))+$';
  v_reclamo := v_norm ~ 'no me (pag|acredit|carg|lleg|entr|deposit)'
            or v_norm ~ 'demor|tarda|cuanto falta|todavia|aun no|hace rato|falta mucho|sigo esperando'
            or v_norm ~ 'rechaz'
            or v_norm ~ '(pedi|solicite|mande|hice) (un |el |la )?(retir|cobro)|acabo de pedir';
  v_prefiere := case
    when v_norm ~ 'retir|cobr|me pag|pagan|pagaron' then 'RETIRO'
    when v_norm ~ 'carg|acredit|deposit|ficha'      then 'CARGA'
    else null end;

  -- ── Comprobante o aviso de pago ────────────────────────────────────────────
  if v_comprobante or v_aviso_pago then
    v_apertura := case when v_comprobante then 'Recibimos tu comprobante. ' else '' end;
    select o.estado, coalesce(o.metadata->>'monto',''),
           floor(extract(epoch from (now()-o.created_at))/60)::int,
           coalesce(o.metadata->>'motivo', o.metadata->>'motivo_rechazo')
      into o_estado, o_monto_r, o_min, o_motivo
    from public.landing_solicitudes o
    where o.pc_codigo=v_pc and nodo_norm_usuario_v21(o.usuario)=v_u and o.tipo='CARGA'
      and (   (o.estado='PENDIENTE'  and o.created_at >= p_cuando - interval '3 hours')
           or (o.estado='ACREDITADA' and o.created_at >= p_cuando - interval '15 minutes')
           or (o.estado='RECHAZADA'  and o.created_at >= p_cuando - interval '30 minutes') )
    order by (o.estado='PENDIENTE') desc, o.created_at desc limit 1;

    v_monto := case when coalesce(o_monto_r,'') ~ '^[0-9]+(\.[0-9]+)?$'
                    then '$' || replace(to_char(round(o_monto_r::numeric),'FM999,999,999'),',','.') end;

    if o_estado = 'PENDIENTE' then
      caso := case when v_comprobante then 'COMPROBANTE' else 'AVISO_PAGO' end;
      mensaje := v_apertura || 'Vemos tu carga' || coalesce(' de '||v_monto,'')
               || ' registrada hace ' || o_min || ' minutos. Un operador la está verificando.';
    elsif o_estado = 'ACREDITADA' then
      caso := case when v_comprobante then 'COMPROBANTE_YA_ACREDITADA' else 'AVISO_PAGO_ACREDITADA' end;
      mensaje := v_apertura || 'Tu carga' || coalesce(' de '||v_monto,'')
               || ' ya fue acreditada hace ' || o_min || ' minutos. ¡Buena suerte!';
    elsif o_estado = 'RECHAZADA' then
      caso := case when v_comprobante then 'COMPROBANTE_RECHAZADA' else 'AVISO_PAGO_RECHAZADA' end;
      mensaje := v_apertura || _soporte_texto_rechazo('CARGA', v_monto, o_min, o_motivo);
    else
      caso := case when v_comprobante then 'COMPROBANTE_SIN_SOLICITUD' else 'AVISO_PAGO_SIN_SOLICITUD' end;
      mensaje := v_apertura
               || 'No vemos un pedido de carga reciente tuyo, así que todavía no está en la fila. '
               || 'Entrá a Cargar en el menú de abajo y poné el monto que transferiste — con eso ya te lo procesamos.';
    end if;
    return next; return;
  end if;

  -- ── Plantillas del portal: acuse concreto, NUNCA el saludo genérico ────────
  if v_pide_usuario then
    caso := 'PIDE_USUARIO';
    mensaje := 'Recibimos tu pedido. Un operador te va a crear el usuario y te escribe por acá.';
    return next; return;
  end if;
  if v_pide_validar then
    caso := 'PIDE_VALIDAR';
    mensaje := 'Recibimos tus datos. Un operador los verifica y te habilita el acceso desde acá.';
    return next; return;
  end if;

  if v_quiere_cargar then
    caso := 'QUIERE_CARGAR';
    mensaje := 'Para cargar, entrá a Cargar en el menú de abajo: ahí te aparecen los datos '
             || 'para transferir y el lugar para avisarnos el monto. Cuando lo hagas, '
             || 'mandá el comprobante por acá.';
    return next; return;
  end if;

  -- ── Estado / rechazo ───────────────────────────────────────────────────────
  v_plata := v_texto ~ '^[\?\.\!¿ ]+$' or v_reclamo or v_saludo;
  if v_plata then
    select o.tipo, o.estado, coalesce(o.metadata->>'monto',''),
           floor(extract(epoch from (now()-o.created_at))/60)::int,
           coalesce(o.metadata->>'motivo', o.metadata->>'motivo_rechazo')
      into o_tipo, o_estado, o_monto_r, o_min, o_motivo
    from public.landing_solicitudes o
    where o.pc_codigo=v_pc and nodo_norm_usuario_v21(o.usuario)=v_u
      and o.tipo in ('CARGA','RETIRO')
      and o.created_at <= p_cuando and o.created_at >= p_cuando - interval '2 hours'
      and ( ( o.estado='PENDIENTE' and case o.tipo
                when 'CARGA'  then now()-o.created_at between interval '2 minutes' and interval '30 minutes'
                when 'RETIRO' then now()-o.created_at between interval '3 minutes' and interval '60 minutes'
                else false end )
         or ( o.estado='RECHAZADA' and now()-o.created_at <= interval '2 hours' ) )
    order by (o.tipo = v_prefiere) desc nulls last, (o.estado='PENDIENTE') desc, o.created_at desc limit 1;

    if o_tipo is not null and v_prefiere is not null and o_tipo <> v_prefiere then o_tipo := null; end if;

    if o_tipo is not null then
      v_monto := case when coalesce(o_monto_r,'') ~ '^[0-9]+(\.[0-9]+)?$'
                      then '$' || replace(to_char(round(o_monto_r::numeric),'FM999,999,999'),',','.') end;
      if o_estado = 'PENDIENTE' then
        caso := 'ESTADO_' || o_tipo;
        mensaje := case o_tipo when 'CARGA' then 'Vemos tu carga' else 'Vemos tu retiro' end
                 || coalesce(' de '||v_monto,'')
                 || case o_tipo when 'CARGA' then ' registrada hace ' else ' registrado hace ' end
                 || o_min || ' minutos. Sigue en proceso, apenas se acredite te avisamos.';
      else
        caso := 'RECHAZO_' || o_tipo;
        mensaje := _soporte_texto_rechazo(o_tipo, v_monto, o_min, o_motivo);
      end if;
      return next; return;
    end if;
  end if;

  -- No puede operar. No intentamos resolverlo: avisamos que va alguien.
  v_problema := (v_limpio ~ 'no me deja|no puedo (entrar|cargar|retirar|acceder|ingresar|jugar)'
              or v_limpio ~ 'no (anda|funciona|abre|carga la|me abre)|se (me )?cerro|se (traba|cuelga)'
              or v_limpio ~ 'no se ve|no aparece nada|me (saca|echa) (de|del) ')
             and v_limpio !~ 'no me (lleg|acredit|pag|carg|deposit|figur|entr)';
  if v_problema then
    caso := 'PROBLEMA_TECNICO';
    mensaje := 'Vemos que estás teniendo un problema con la aplicación. Un operador te escribe por acá '
             || 'para ayudarte. Si podés, mandanos una captura de lo que te aparece.';
    return next; return;
  end if;

  v_saldo := v_norm ~ '(mi|el) saldo|cuanto (tengo|me queda)|ver.*saldo|no me figura el saldo';
  if v_saldo then
    caso := 'VER_SALDO';
    mensaje := 'El saldo lo ves dentro de la plataforma, en tu cuenta. Si no te figura lo que esperabas, '
             || 'contanos el monto y lo revisamos.';
    return next; return;
  end if;

  -- Pregunta por demoras y no encontramos ninguna solicitud suya: contestamos con los tiempos reales.
  v_demora := v_norm ~ 'cuanto (tarda|demora|falta)|cuanto tiempo|en cuanto se acredit|tardan mucho';
  if v_demora then
    caso := 'DEMORA';
    mensaje := 'Las cargas se acreditan en pocos minutos y los retiros normalmente dentro de la media hora. '
             || 'Si ya hiciste el pedido y pasó más de eso, avisanos y lo miramos.';
    return next; return;
  end if;

  -- Saludo generico SOLO si el mensaje es un hola pelado. Si ya trae la consulta,
  -- se contesta la consulta arriba y nunca se llega hasta aca.
  if v_norm ~ '^(hola+|buenas|buen dia|buenos dias|buenas tardes|buenas noches|hey|hi|holis|hol)[\s!.,¡¿?]*$'
     and not _soporte_ya_dijo(v_pc, v_u, 'SALUDO', interval '5 minutes') then
    caso := 'SALUDO';
    mensaje := 'Hola ' || btrim(coalesce(p_usuario,'')) || ', ¿en qué te podemos ayudar?';
    return next; return;
  end if;

  if v_cierre and not _soporte_ya_dijo(v_pc, v_u, 'CIERRE', interval '10 minutes') then
    caso := 'CIERRE';
    mensaje := '¡Gracias a vos! Cualquier cosa escribinos por acá.';
    return next; return;
  end if;

  return;
end;
$function$
;

-- ══ soporte_autorespuesta_v1(p_pc text, p_ventana interval, p_simulacro boolean)
-- Respuesta automática en el hilo de soporte. Solo contesta con datos reales; si no hay nada pendiente, calla. p_simulacro=true no escribe.
CREATE OR REPLACE FUNCTION public.soporte_autorespuesta_v1(p_pc text, p_ventana interval DEFAULT '02:00:00'::interval, p_simulacro boolean DEFAULT true)
 RETURNS TABLE(solicitud_id bigint, usuario text, caso text, mensaje text, escrito boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pc text := upper(btrim(coalesce(p_pc,'')));
  t record; op record;
  v_msg text; v_caso text; v_monto text;
  v_thread jsonb; v_ultimo jsonb;
begin
  if v_pc = '' then raise exception 'PC obligatoria'; end if;
  for t in
    select s.id, s.usuario, s.created_at, s.metadata,
           nodo_norm_usuario_v21(s.usuario) as u,
           btrim(coalesce(s.mensaje_inicial,'')) as texto
    from public.landing_solicitudes s
    where s.tipo='SOPORTE' and s.pc_codigo=v_pc
      and s.created_at >= now() - p_ventana
      and coalesce(btrim(s.usuario),'') <> ''
      and not (s.metadata ? 'auto_respondido_at')
    order by s.created_at
  loop
    v_thread := coalesce(t.metadata->'chat_thread','[]'::jsonb);
    v_ultimo := case when jsonb_array_length(v_thread) > 0
                     then v_thread -> (jsonb_array_length(v_thread)-1) end;
    if v_ultimo is not null
       and upper(coalesce(v_ultimo->>'origen', v_ultimo->>'tipo','')) = 'OPERADOR' then
      continue;
    end if;

    select o.tipo, coalesce(o.metadata->>'monto','') as monto,
           floor(extract(epoch from (now()-o.created_at))/60)::int as minutos
      into op
    from public.landing_solicitudes o
    where o.pc_codigo=v_pc and nodo_norm_usuario_v21(o.usuario)=t.u
      and o.tipo in ('CARGA','RETIRO') and o.estado='PENDIENTE'
      and o.created_at <= t.created_at
      and o.created_at >= t.created_at - interval '2 hours'
      and now() - o.created_at between interval '3 minutes' and interval '2 hours'
    order by o.created_at desc limit 1;

    v_monto := case when coalesce(op.monto,'') ~ '^[0-9]+(\.[0-9]+)?$'
                    then '$' || replace(to_char(round(op.monto::numeric),'FM999,999,999'), ',', '.')
                    else null end;
    v_msg := null; v_caso := null;

    if t.texto ~ 'Imagen adjunta' then
      v_caso := 'COMPROBANTE';
      v_msg  := 'Recibimos tu comprobante. Un operador lo está verificando.';
    elsif ( t.texto ~ '^[\?\.\!¿ ]+$'
            or lower(unaccent(t.texto)) ~ 'demor|tarda|cuanto falta|todavia|aun no|hace rato|falta mucho' )
          and op.tipo is not null then
      v_caso := 'ESTADO_' || op.tipo;
      v_msg  := 'Vemos tu ' || lower(op.tipo) || coalesce(' de ' || v_monto,'') ||
                ' registrado hace ' || op.minutos ||
                ' minutos. Sigue en proceso, apenas se acredite te avisamos.';
    end if;
    if v_msg is null then continue; end if;

    if not p_simulacro then
      update public.landing_solicitudes s
         set metadata = s.metadata
                        || jsonb_build_object('auto_respondido_at', now(), 'auto_caso', v_caso)
                        || jsonb_build_object('chat_thread', v_thread || jsonb_build_array(
                             jsonb_build_object(
                               'origen','OPERADOR',      -- lo que mira el portal
                               'tipo','OPERADOR',        -- lo que miran algunas rutas del panel
                               'operador','NODO', 'auto', true,
                               'usuario', t.usuario, 'mensaje', v_msg,
                               'fecha', to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                               'solicitud_id', t.id))),
             updated_at = now()
       where s.id = t.id;
    end if;

    solicitud_id := t.id; usuario := t.usuario; caso := v_caso;
    mensaje := v_msg; escrito := not p_simulacro;
    return next;
  end loop;
end; $function$
;

-- ══ soporte_espejo_resumen(p_desde interval)
-- Qué habría contestado el sistema en las oficinas en modo espejo. Solo lectura.
CREATE OR REPLACE FUNCTION public.soporte_espejo_resumen(p_desde interval DEFAULT '24:00:00'::interval)
 RETURNS TABLE(pc_codigo text, caso text, veces bigint, ejemplo_mensaje text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select s.pc_codigo,
         coalesce(s.metadata->'auto_espejo'->>'caso','(no contestaria)') as caso,
         count(*) as veces,
         min(s.metadata->'auto_espejo'->>'mensaje') as ejemplo_mensaje
  from public.landing_solicitudes s
  where s.tipo='SOPORTE'
    and s.metadata ? 'auto_espejo'
    and s.created_at >= now() - p_desde
  group by 1,2
  order by 1, 3 desc;
$function$
;

-- ══ soporte_motivo_publicable(p_motivo text)
-- Devuelve el motivo solo si parece redactado para el usuario. Ante la duda, null.
CREATE OR REPLACE FUNCTION public.soporte_motivo_publicable(p_motivo text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when m is null                                              then null
    when length(m) < 20                                         then null   -- "cargado", "OK"
    when m ~ '^[A-Z0-9_]+$'                                     then null   -- DATO_PROPIO, SOLO_NUMEROS
    when array_length(regexp_split_to_array(m, '\s+'), 1) < 4   then null   -- muy corto para ser una explicación
    when lower(unaccent(m)) ~ '(rechazada desde|ya fue cargad|usuario esta mal|dato propio|prueba|test|panel)'
                                                                then null   -- notas internas conocidas
    else m
  end
  from (select btrim(coalesce(p_motivo,'')) as m) t
  where btrim(coalesce(p_motivo,'')) <> '';
$function$
;

-- ══ soporte_vincular_automatico_v1(p_pc text, p_desde interval, p_simulacro boolean)
-- Crea el vínculo del que no está, completa el teléfono del que lo tiene en blanco, y manda a verificar al que cambió de número. Nunca pisa un dato existente. p_simulacro=true no escribe.
CREATE OR REPLACE FUNCTION public.soporte_vincular_automatico_v1(p_pc text, p_desde interval DEFAULT '24:00:00'::interval, p_simulacro boolean DEFAULT true)
 RETURNS TABLE(candidatos integer, creados integer, completados integer, ya_estaban integer, cambio_de_tel integer, sin_telefono integer, simulacro boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pc  text := upper(btrim(coalesce(p_pc,'')));
  v_cand int := 0; v_new int := 0; v_fill int := 0; v_ok int := 0; v_chg int := 0; v_notel int := 0;
  r record; v_id bigint; v_tel_base text; v_titular_base text;
begin
  if v_pc = '' then raise exception 'PC obligatoria'; end if;

  for r in
    select distinct on (u)
           s.usuario                                                                as usuario_raw,
           nodo_norm_usuario_v21(s.usuario)                                          as u,
           right(regexp_replace(coalesce(s.metadata->>'telefono',''),'\D','','g'),10) as tel,
           nullif(btrim(coalesce(s.metadata->>'titular','')),'')                      as titular,
           s.tipo                                                                     as vino_de
    from public.landing_solicitudes s
    where s.pc_codigo = v_pc
      and s.created_at >= now() - p_desde
      and coalesce(btrim(s.usuario),'') <> ''
      and coalesce(btrim(s.metadata->>'telefono'),'') <> ''
    order by u, s.created_at desc          -- la declaración más reciente
  loop
    v_cand := v_cand + 1;

    if length(r.tel) <> 10 then
      v_notel := v_notel + 1;
      continue;
    end if;

    select v.id,
           right(regexp_replace(coalesce(v.telefono_canon,''),'\D','','g'),10),
           nullif(btrim(coalesce(v.titular,'')),'')
      into v_id, v_tel_base, v_titular_base
    from public.usuarios_portal_vinculos v
    where v.pc_codigo = v_pc and nodo_norm_usuario_v21(v.usuario) = r.u
    limit 1;

    if v_id is not null then
      if length(coalesce(v_tel_base,'')) <> 10 then
        v_fill := v_fill + 1;
        if not p_simulacro then
          update public.usuarios_portal_vinculos
             set telefono_canon = r.tel,
                 telefono_raw   = coalesce(nullif(btrim(telefono_raw),''), r.tel),
                 titular        = coalesce(v_titular_base, r.titular),
                 fuente         = coalesce(nullif(btrim(fuente),''), 'SOPORTE_AUTO'),
                 updated_at     = now()
           where id = v_id;
        end if;
      elsif v_tel_base = r.tel then
        v_ok := v_ok + 1;
      else
        v_chg := v_chg + 1;
        if not p_simulacro then
          insert into public.vinculo_cambio_telefono
            (pc_codigo, usuario, telefono_base, telefono_nuevo, origen)
          values (v_pc, r.usuario_raw, v_tel_base, r.tel, coalesce(r.vino_de,'SOPORTE'))
          on conflict (pc_codigo, usuario, telefono_nuevo) do nothing;
        end if;
      end if;
      continue;
    end if;

    -- El telefono YA tiene vinculo: la persona escribio OTRO nombre (un typo, un apodo,
    -- su mail, su numero). Crear una fila nueva es exactamente lo que ensucio la base —
    -- quedaban 6 y 7 usuarios por telefono, todos PENDIENTE para siempre y ninguno resuelto.
    -- Ahora se anota el intento como evento y NO se crea vinculo: el operador ve en el CRM
    -- que esa persona probo con esos nombres, y valida el que ya tiene.
    if exists (select 1 from public.usuarios_portal_vinculos e
               where e.pc_codigo = v_pc and e.telefono_canon = r.tel) then
      -- El cron mira una ventana de 2 h y corre cada 15 min, asi que el MISMO intento se
      -- volvia a anotar 8 veces por hora. Se registra una sola vez por dia y por alias.
      if not p_simulacro and not exists (
        select 1 from public.usuarios_portal_eventos e
        where e.pc_codigo = v_pc and e.evento = 'ALIAS_INTENTADO'
          and e.telefono_nuevo = r.tel
          and e.nota = 'Escribio "' || r.usuario_raw || '" en el chat'
          and e.created_at > now() - interval '24 hours'
      ) then
        insert into public.usuarios_portal_eventos
          (pc_codigo, usuario, evento, telefono_nuevo, nota, origen)
        select v_pc, e.usuario, 'ALIAS_INTENTADO', r.tel,
               'Escribio "' || r.usuario_raw || '" en el chat', 'SOPORTE_AUTO'
        from public.usuarios_portal_vinculos e
        where e.pc_codigo = v_pc and e.telefono_canon = r.tel
        order by (e.estado_vinculo = 'VINCULADO') desc, e.created_at
        limit 1;
      end if;
      continue;
    end if;

    v_new := v_new + 1;
    if not p_simulacro then
      insert into public.usuarios_portal_vinculos
        (pc_codigo, usuario, telefono_canon, telefono_raw, estado_vinculo, fuente,
         titular, created_at, updated_at)
      values (v_pc, r.usuario_raw, r.tel, r.tel, 'PENDIENTE', 'SOPORTE_AUTO',
              r.titular, now(), now())
      on conflict do nothing;
    end if;
  end loop;

  return query select v_cand, v_new, v_fill, v_ok, v_chg, v_notel, p_simulacro;
end;
$function$
;

-- ══ trg_soporte_autorespuesta()
-- Respuesta automática instantánea en soporte. Solo P4. Blindado: un error nunca voltea la solicitud.
-- OJO: el comentario dice "Solo P4" y está DESACTUALIZADO — v_reales es P1..P7, contesta en todas.
CREATE OR REPLACE FUNCTION public.trg_soporte_autorespuesta()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_reales  text[] := array['P1','P2','P3','P4','P5','P6','P7'];   -- acá contesta de verdad
  v_pc      text;
  r         record;
  v_thread  jsonb;
  v_ya      boolean;
begin
  begin
    if new.tipo <> 'SOPORTE' then return new; end if;
    if coalesce(btrim(new.usuario),'') = '' then return new; end if;
    if new.metadata ? 'auto_respondido_at' then return new; end if;
    if new.metadata ? 'auto_espejo'        then return new; end if;

    v_pc := upper(coalesce(new.pc_codigo,''));
    if v_pc !~ '^P[0-9]+$' then return new; end if;

    select * into r
    from public.soporte_auto_mensaje_v1(
           new.pc_codigo, new.usuario, new.mensaje_inicial, coalesce(new.created_at, now()));

    -- ── ESPEJO: anota y no contesta ──────────────────────────────────────────
    if not (v_pc = any (v_reales)) then
      new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
        'auto_espejo', jsonb_build_object(
          'caso',        coalesce(r.caso, '(no contestaria)'),
          'mensaje',     r.mensaje,
          'evaluado_at', now()
        ));
      return new;
    end if;

    -- ── REAL ─────────────────────────────────────────────────────────────────
    -- Sin mensaje no se contesta, pero si hay un caso queda anotado. Asi DERIVAR_HUMANO
    -- (angustia / adiccion) deja rastro para que una persona lo tome, sin respuesta automatica.
    if r.mensaje is null then
      if r.caso is not null then
        new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object('auto_caso', r.caso);
      end if;
      return new;
    end if;

    -- NO_REPETIR: el freno anti-repeticion existia solo para SALUDO y CIERRE. Sin el, alguien
    -- que manda dos mensajes seguidos recibe la MISMA respuesta dos veces (se vio el 26/08:
    -- "No vemos un pedido de carga" a los 24 segundos, el rechazo a los 48). Ahora aplica a
    -- todos los casos: si ya se dijo ESE caso a ESA persona hace menos de 3 minutos, no se
    -- repite. Se anota igual el caso para no perder la traza.
    if public._soporte_ya_dijo(v_pc, nodo_norm_usuario_v21(new.usuario), r.caso, interval '3 minutes') then
      new.metadata := coalesce(new.metadata,'{}'::jsonb)
        || jsonb_build_object('auto_caso', r.caso, 'auto_omitido', 'repetido');
      return new;
    end if;

    v_thread := coalesce(new.metadata->'chat_thread', '[]'::jsonb);
    select exists(
      select 1 from jsonb_array_elements(v_thread) m
      where (m->>'solicitud_id') = new.id::text
        and upper(coalesce(m->>'origen','')) = 'USUARIO'
    ) into v_ya;

    if not v_ya then
      v_thread := v_thread || jsonb_build_array(jsonb_build_object(
        'origen','USUARIO', 'tipo','USUARIO',
        'usuario', new.usuario,
        'mensaje', coalesce(new.mensaje_inicial,''),
        'fecha',   to_char(coalesce(new.created_at, now()) at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'solicitud_id', new.id));
    end if;

    new.metadata := coalesce(new.metadata,'{}'::jsonb)
      || jsonb_build_object('auto_respondido_at', now(), 'auto_caso', r.caso)
      || jsonb_build_object('chat_thread', v_thread || jsonb_build_array(
           jsonb_build_object(
             'origen','OPERADOR', 'tipo','OPERADOR', 'operador','NODO', 'auto',true,
             'usuario', new.usuario, 'mensaje', r.mensaje,
             'fecha', to_char((coalesce(new.created_at, now()) + interval '1 second') at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
             'solicitud_id', new.id)));

    return new;
  exception when others then
    return new;   -- nunca voltear el insert por un problema nuestro
  end;
end;
$function$
;

-- El trigger en sí:
-- CREATE TRIGGER trg_soporte_autorespuesta BEFORE INSERT ON public.landing_solicitudes
--   FOR EACH ROW EXECUTE FUNCTION trg_soporte_autorespuesta();
