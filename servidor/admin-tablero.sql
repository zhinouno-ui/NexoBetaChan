-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- ADMI · TABLEROS Y REPORTES  (parte 1 de 2)
-- Copia de lectura de lo que corre en Supabase (proyecto NODO · pjvvyvfcwjoocjqvdror).
--
-- Estas funciones son del **Admi** (admi-V23-COMPLETO-con-whaticket.html), no del panel
-- operativo. Todas entran por `p_session_token` y lo primero que hacen es llamar a
-- `admin_od_scope_effective`, que decide QUÉ OFICINA puede ver esa sesión:
--   · rol ADMIN o scope ALL/TODAS/GLOBAL → puede pedir cualquier oficina, o todas
--   · encargado → se le fuerza SU oficina, ignorando lo que pida
-- Un encargado sin oficina asignada no ve nada (ENCARGADO_SIN_OFICINA).
--
-- Las *_v2 son envoltorios: resuelven el alcance y delegan en la v1, agregando 'scope'
-- a la respuesta. Las v1 grandes están en admin-tablero-grandes.sql.
--
-- NO está acá: `admin_get_scope`, que es de donde sale la sesión.
--
-- `admin_od_rescate_v1` es la vista de control de la cola de rescate: cuánto hay en cola por
-- oficina, quién la trabaja y cuánta plata volvió, más una medición de CÓMO escriben los
-- operadores (largo, cortesía, minúscula) y qué porcentaje de respuestas quedó atribuido.
--
-- Generado con pg_get_functiondef el 2026-08-30 (admin_od_rescate_v1, el 2026-09-05).
-- Verificado por md5 contra la base.
-- ═══════════════════════════════════════════════════════════════════════════════════════════


-- ══ admin_od_billeteras_v1(p_session_token text, p_pc_codigo text)
CREATE OR REPLACE FUNCTION public.admin_od_billeteras_v1(p_session_token text, p_pc_codigo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_scope jsonb; v_pc text; v_res jsonb;
begin
  v_scope := public.admin_od_scope_effective(p_session_token, p_pc_codigo);
  if not coalesce((v_scope->>'ok')::boolean,false) then return v_scope; end if;
  v_pc := nullif(v_scope->>'pc_codigo_efectivo','');

  with b as (
    select upper(coalesce(pc_codigo,'-'))                      as pc,
           id, nombre_visible, titular, banco, alias,
           coalesce(saldo,0)::numeric                          as saldo,
           coalesce(saldo_inicial,0)::numeric                  as saldo_inicial,
           coalesce(activa,true)                               as activa,
           upper(coalesce(estado,''))                          as estado,
           coalesce(prioridad,0)                               as prioridad,
           (chunior_uid is not null and chunior_uid <> '')      as en_chunior,
           coalesce(mp_habilitado,false)                       as mp,
           updated_at
    from public.billeteras
    where (v_pc is null or upper(coalesce(pc_codigo,'')) = v_pc)
  )
  select jsonb_build_object(
    'ok', true, 'pc_codigo', v_pc,
    'totales', (select jsonb_build_object(
        'billeteras',   count(*),
        'activas',      count(*) filter (where activa),
        'saldo_total',  coalesce(sum(saldo) filter (where activa),0),
        'sin_chunior',  count(*) filter (where activa and not en_chunior),
        'con_mp',       count(*) filter (where activa and mp)
      ) from b),
    'por_oficina', coalesce((select jsonb_agg(x order by x->>'pc') from (
        select jsonb_build_object(
          'pc', b.pc,
          'billeteras',  count(*),
          'activas',     count(*) filter (where b.activa),
          'saldo',       coalesce(sum(b.saldo) filter (where b.activa),0),
          'sin_chunior', count(*) filter (where b.activa and not b.en_chunior)
        ) as x from b group by b.pc) t), '[]'::jsonb),
    'listado', coalesce((select jsonb_agg(y order by y->>'pc', (y->>'saldo')::numeric desc) from (
        select jsonb_build_object(
          'pc', b.pc, 'id', b.id, 'nombre', b.nombre_visible, 'titular', b.titular,
          'banco', b.banco, 'alias', b.alias, 'saldo', b.saldo,
          'saldo_inicial', b.saldo_inicial,
          'activa', b.activa, 'estado', b.estado, 'prioridad', b.prioridad,
          'en_chunior', b.en_chunior, 'mp', b.mp, 'actualizada', b.updated_at
        ) as y from b) t2), '[]'::jsonb)
  ) into v_res;
  return v_res;
end;
$function$
;

-- ══ admin_od_crecimiento_resumen_v2(p_session_token text, p_desde timestamp with time zone, p_hasta timestamp with time zone, p_pc_codigo text, p_usuario text, p_limit integer)
CREATE OR REPLACE FUNCTION public.admin_od_crecimiento_resumen_v2(p_session_token text, p_desde timestamp with time zone DEFAULT NULL::timestamp with time zone, p_hasta timestamp with time zone DEFAULT NULL::timestamp with time zone, p_pc_codigo text DEFAULT NULL::text, p_usuario text DEFAULT NULL::text, p_limit integer DEFAULT 80)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_scope jsonb;
  v_pc_efectivo text;
  v_res jsonb;
begin
  v_scope := public.admin_od_scope_effective(p_session_token, p_pc_codigo);

  if not coalesce((v_scope->>'ok')::boolean,false) then
    return v_scope;
  end if;

  v_pc_efectivo := nullif(v_scope->>'pc_codigo_efectivo','');

  v_res := public.admin_od_crecimiento_resumen(
    p_session_token,
    p_desde,
    p_hasta,
    v_pc_efectivo,
    p_usuario,
    p_limit
  );

  return v_res || jsonb_build_object('scope', v_scope);
end;
$function$
;

-- ══ admin_od_crm_buscar_v1(p_session_token text, p_query text, p_limit integer)
-- Busca una persona por usuario, teléfono o titular y la muestra en todas las oficinas. Solo lectura.
CREATE OR REPLACE FUNCTION public.admin_od_crm_buscar_v1(p_session_token text, p_query text, p_limit integer DEFAULT 40)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_scope jsonb; v_pc text; v_todas boolean;
  v_q text := btrim(coalesce(p_query,''));
  v_qn text; v_qtel text; v_out jsonb;
begin
  v_scope := public.admin_od_scope_effective(p_session_token, null);
  if not coalesce((v_scope->>'ok')::boolean,false) then
    return jsonb_build_object('ok', false, 'error', v_scope->>'error');
  end if;
  v_todas := coalesce((v_scope->>'puede_todas')::boolean,false);
  v_pc    := case when v_todas then null else nullif(v_scope->>'pc_codigo_efectivo','') end;

  if length(v_q) < 3 then
    return jsonb_build_object('ok', false, 'error', 'Escribí al menos 3 caracteres.');
  end if;

  v_qn   := nodo_norm_usuario_v21(v_q);
  v_qtel := right(regexp_replace(v_q, '\D', '', 'g'), 10);

  with encontrados as (
    -- Se busca en los vínculos, que es la tabla con los datos de la persona.
    select v.pc_codigo, v.usuario, v.telefono_canon, v.titular,
           v.estado_vinculo, v.fuente, v.cbu_retiro, v.cbu_titular, v.created_at
    from public.usuarios_portal_vinculos v
    where (v_pc is null or v.pc_codigo = v_pc)
      and (
            nodo_norm_usuario_v21(v.usuario) like v_qn || '%'
         or (length(v_qtel) = 10 and right(regexp_replace(coalesce(v.telefono_canon,''),'\D','','g'),10) = v_qtel)
         or (length(v_q) >= 4 and unaccent(lower(coalesce(v.titular,''))) like '%' || unaccent(lower(v_q)) || '%')
          )
    limit greatest(1, least(coalesce(p_limit,40), 200))
  ),
  ops as (
    select e.pc_codigo, e.usuario,
           count(*) filter (where s.tipo='CARGA'  and s.estado='ACREDITADA') as cargas,
           count(*) filter (where s.tipo='RETIRO' and s.estado='PAGADA')     as retiros,
           round(sum(s.monto) filter (where s.tipo='CARGA'  and s.estado='ACREDITADA')) as cargado,
           round(sum(s.monto) filter (where s.tipo='RETIRO' and s.estado='PAGADA'))     as retirado,
           max(s.created_at) as ultima_op
    from encontrados e
    left join public.landing_solicitudes s
           on s.pc_codigo = e.pc_codigo
          and nodo_norm_usuario_v21(s.usuario) = nodo_norm_usuario_v21(e.usuario)
    group by e.pc_codigo, e.usuario
  )
  select jsonb_build_object(
    'ok', true,
    'alcance', jsonb_build_object('pc', v_pc, 'todas', v_todas),
    'resultados', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.ultima_op desc nulls last) from (
        select e.pc_codigo, e.usuario, e.telefono_canon, e.titular,
               e.estado_vinculo, e.fuente, e.cbu_retiro, e.cbu_titular,
               e.created_at as vinculado_desde,
               coalesce(o.cargas,0) as cargas, coalesce(o.retiros,0) as retiros,
               coalesce(o.cargado,0) as cargado, coalesce(o.retirado,0) as retirado,
               o.ultima_op
        from encontrados e left join ops o
             on o.pc_codigo = e.pc_codigo and o.usuario = e.usuario
      ) x
    ), '[]'::jsonb)
  ) into v_out;

  return v_out;
end;
$function$
;

-- ══ admin_od_dashboard_resumen_v2(p_session_token text, p_desde timestamp with time zone, p_hasta timestamp with time zone, p_pc_codigo text, p_turno text, p_operador text)
CREATE OR REPLACE FUNCTION public.admin_od_dashboard_resumen_v2(p_session_token text, p_desde timestamp with time zone DEFAULT NULL::timestamp with time zone, p_hasta timestamp with time zone DEFAULT NULL::timestamp with time zone, p_pc_codigo text DEFAULT NULL::text, p_turno text DEFAULT NULL::text, p_operador text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_scope jsonb;
  v_pc_efectivo text;
  v_res jsonb;
begin
  v_scope := public.admin_od_scope_effective(p_session_token, p_pc_codigo);

  if not coalesce((v_scope->>'ok')::boolean,false) then
    return v_scope;
  end if;

  v_pc_efectivo := nullif(v_scope->>'pc_codigo_efectivo','');

  v_res := public.admin_od_dashboard_resumen(
    p_session_token,
    p_desde,
    p_hasta,
    v_pc_efectivo,
    p_turno,
    p_operador
  );

  return v_res || jsonb_build_object('scope', v_scope);
end;
$function$
;

-- ══ admin_od_embudo_usuarios_v1(p_session_token text, p_desde timestamp with time zone, p_hasta timestamp with time zone, p_pc_codigo text, p_limit integer)
CREATE OR REPLACE FUNCTION public.admin_od_embudo_usuarios_v1(p_session_token text, p_desde timestamp with time zone DEFAULT NULL::timestamp with time zone, p_hasta timestamp with time zone DEFAULT NULL::timestamp with time zone, p_pc_codigo text DEFAULT NULL::text, p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_scope jsonb; v_pc text;
  v_d timestamptz := coalesce(p_desde, '-infinity'::timestamptz);
  v_h timestamptz := coalesce(p_hasta, now());
  v_lim int := least(greatest(coalesce(p_limit,200),1), 1000);
  v_res jsonb;
begin
  v_scope := public.admin_od_scope_effective(p_session_token, p_pc_codigo);
  if not coalesce((v_scope->>'ok')::boolean,false) then return v_scope; end if;
  v_pc := nullif(v_scope->>'pc_codigo_efectivo','');

  with base as materialized (
    select lower(trim(s.usuario)) as usr, upper(coalesce(s.pc_codigo,'-')) as pc,
           s.id as sid, s.created_at as ts,
           upper(coalesce(s.tipo,'')) as tipo, upper(coalesce(s.estado,'')) as estado,
           nullif(s.metadata->>'telefono','') as telefono,
           nullif(s.metadata->>'chat_operador','') as chat_op,
           case when (s.metadata->>'chat_ultima_respuesta_at') is not null
                then extract(epoch from ((s.metadata->>'chat_ultima_respuesta_at')::timestamptz - s.created_at))/60.0 end as resp_min
    from public.landing_solicitudes s
    where coalesce(s.usuario,'') <> ''
      and s.created_at >= v_d and s.created_at <= v_h
      and (v_pc is null or upper(coalesce(s.pc_codigo,'')) = v_pc)
  ),
  hechas as materialized (
    select distinct b.sid from base b
    where exists (select 1 from public.historial_ops h where h.solicitud_id = b.sid)
  ),
  push as materialized (
    select distinct lower(trim(usuario)) as usr from public.push_subscriptions
    where coalesce(activa,true) = true and coalesce(usuario,'') <> ''
  ),
  app as materialized (
    select distinct lower(trim(usuario)) as usr from public.usuarios_portal_vinculos
    where coalesce(app_instalada,false) = true and coalesce(usuario,'') <> ''
  ),
  usr as (
    select b.usr, b.pc,
           count(*) as sols,
           bool_or(x.sid is not null) as completo,
           min(b.ts) as primera, max(b.ts) as ultima,
           max(b.telefono) as telefono,
           (array_agg(b.tipo    order by b.ts))[1] as primer_tipo,
           (array_agg(b.estado  order by b.ts))[1] as primer_estado,
           (array_agg(b.chat_op order by b.ts))[1] as operador,
           min(b.resp_min) as resp_min
    from base b left join hechas x on x.sid = b.sid
    group by b.usr, b.pc
  ),
  usr2 as (
    select u.*, (p.usr is not null) as tiene_push, (a.usr is not null) as tiene_app
    from usr u left join push p on p.usr = u.usr left join app a on a.usr = u.usr
  )
  select jsonb_build_object(
    'ok', true, 'desde', v_d, 'hasta', v_h, 'pc_codigo', v_pc,
    'totales', (select jsonb_build_object(
        'usuarios', count(*), 'completaron', count(*) filter (where completo),
        'perdidos', count(*) filter (where not completo),
        'un_solo_intento', count(*) filter (where not completo and sols = 1),
        'perdidos_con_push', count(*) filter (where not completo and tiene_push)) from usr2),
    'por_oficina', coalesce((select jsonb_agg(x order by x->>'pc') from (
        select jsonb_build_object(
          'pc', u.pc, 'usuarios', count(*),
          'completaron',     count(*) filter (where u.completo),
          'perdidos',        count(*) filter (where not u.completo),
          'pct_perdidos',    round(100.0*count(*) filter (where not u.completo)/nullif(count(*),0)),
          'un_solo_intento', count(*) filter (where not u.completo and u.sols = 1),
          'solo_soporte',    count(*) filter (where not u.completo and u.sols = 1 and u.primer_tipo='SOPORTE'),
          'solo_rechazo',    count(*) filter (where not u.completo and u.primer_estado like 'RECHAZ%'),
          'con_push',        count(*) filter (where not u.completo and u.tiene_push),
          'con_telefono',    count(*) filter (where not u.completo and coalesce(u.telefono,'') <> ''),
          'resp_chat_med',   round(percentile_cont(0.5) within group (
                               order by u.resp_min) filter (where not u.completo)::numeric,1)
        ) as x from usr2 u group by u.pc) t), '[]'::jsonb),
    'listado', coalesce((select jsonb_agg(y) from (
        select jsonb_build_object(
          'pc', p.pc, 'usuario', p.usr, 'telefono', p.telefono,
          'solicitudes', p.sols, 'tipo', p.primer_tipo, 'estado', p.primer_estado,
          'operador', p.operador, 'resp_min', round(p.resp_min::numeric,1),
          'push', p.tiene_push, 'app', p.tiene_app,
          'primera', p.primera, 'ultima', p.ultima,
          'dias', floor(extract(epoch from (now() - p.ultima))/86400)::int) as y
        from usr2 p where not p.completo order by p.ultima desc limit v_lim) t2), '[]'::jsonb)
  ) into v_res;
  return v_res;
end;
$function$
;

-- ══ admin_od_monitor_v1(p_session_token text)
CREATE OR REPLACE FUNCTION public.admin_od_monitor_v1(p_session_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_scope jsonb; v_pc text; v_todas boolean;
begin
  v_scope := public.admin_od_scope_effective(p_session_token, null);
  if not coalesce((v_scope->>'ok')::boolean,false) then
    return jsonb_build_object('ok', false, 'error', v_scope->>'error');
  end if;
  v_todas := coalesce((v_scope->>'puede_todas')::boolean,false);
  v_pc    := case when v_todas then null else nullif(v_scope->>'pc_codigo_efectivo','') end;

  return jsonb_build_object(
    'ok', true, 'generado', now(),

    'versiones', coalesce((select jsonb_agg(x order by x->>'pc', x->>'operador') from (
        select jsonb_build_object('pc',a.pc_codigo,'version',coalesce(a.version,'?'),
                 'operador',coalesce(a.operador,''),'oficina',coalesce(a.oficina_id,''),
                 'visto',a.last_seen, 'online',true) as x
        from panel_actividad a
        where a.last_seen > now() - interval '3 min'
          and (v_pc is null or a.pc_codigo = v_pc)) s), '[]'::jsonb),

    'blindaje', jsonb_build_object(
      'exigiendo', coalesce((select exigir from panel_blindaje where clave='crm_secret'), false),
      -- Se agrega primero y recien despues se arma el json: jsonb_agg(sum(...)) no es valido.
      'uso', coalesce((select jsonb_agg(jsonb_build_object('funcion',fn,'con_secreto',con,'sin_secreto',sin) order by fn)
             from (select funcion as fn,
                          coalesce(sum(veces) filter (where con_secreto),0) as con,
                          coalesce(sum(veces) filter (where not con_secreto),0) as sin
                   from panel_blindaje_uso where dia = current_date group by funcion) b), '[]'::jsonb),
      'ayer', coalesce((select sum(veces) filter (where not con_secreto)
             from panel_blindaje_uso where dia = current_date - 1), 0)),

    'enlaces', coalesce((select jsonb_agg(x order by x->>'pc') from (
        select jsonb_build_object('pc',l.pc_codigo,'creados',count(*),
                 'usados',count(*) filter (where l.usado_at is not null),
                 'sin_usar_vencidos',count(*) filter (where l.usado_at is null and l.expira_at <= now()),
                 'anulados',count(*) filter (where l.anulado_at is not null and l.usado_at is null),
                 'ultimo',max(l.creado_at)) as x
        from portal_acceso_links l
        where l.creado_at > now() - interval '7 days' and (v_pc is null or l.pc_codigo = v_pc)
        group by l.pc_codigo) s), '[]'::jsonb),

    'lineas', coalesce((select jsonb_agg(x order by x->>'pc', x->>'nombre') from (
        select jsonb_build_object('pc',w.pc_codigo,'nombre',w.nombre,'estado',w.estado,
                 'visto',w.visto_at,'cambio',w.cambio_at,
                 'frenado',(w.visto_at < now() - interval '30 min')) as x
        from whaticket_lineas w
        join (select pc_codigo, max(visto_at) as ultimo
                from whaticket_lineas group by pc_codigo) u
          on u.pc_codigo = w.pc_codigo
       where (v_pc is null or w.pc_codigo = v_pc)
         and w.visto_at >= u.ultimo - interval '5 minutes') s), '[]'::jsonb),

    'lineas_cambios', coalesce((select jsonb_agg(jsonb_build_object('pc',pc_codigo,'nombre',nombre,
             'antes',estado_antes,'ahora',estado_ahora,'cuando',cambio_at) order by cambio_at desc)
           from (select * from whaticket_lineas_historial
                 where cambio_at > now() - interval '7 days' and (v_pc is null or pc_codigo = v_pc)
                 order by cambio_at desc limit 20) h), '[]'::jsonb),

    'autorespuestas', coalesce((select jsonb_agg(jsonb_build_object(
             'pc', pc, 'chats', chats, 'contesto', contesto,
             'cobertura', case when chats > 0 then round(100.0*contesto/chats) else 0 end,
             'modo', case when contesto > 0 or espejo = 0 then 'contesta' else 'espejo' end) order by pc)
           from (select s.pc_codigo as pc,
                        count(*) as chats,
                        count(*) filter (where s.metadata ? 'auto_respondido_at') as contesto,
                        count(*) filter (where s.metadata ? 'auto_espejo') as espejo
                 from public.landing_solicitudes s
                 where s.tipo = 'SOPORTE' and s.created_at > now() - interval '24 hours'
                   and s.pc_codigo ~ '^P[0-9]+$'
                   and (v_pc is null or s.pc_codigo = v_pc)
                 group by s.pc_codigo) a), '[]'::jsonb),

    'vinculos', coalesce((select jsonb_agg(jsonb_build_object('fuente',fuente,'cantidad',c) order by c desc)
           from (select coalesce(fuente,'(sin fuente)') as fuente, count(*) as c
                 from usuarios_portal_vinculos
                 where updated_at > now() - interval '7 days' and (v_pc is null or pc_codigo = v_pc)
                 group by 1) f), '[]'::jsonb)
  );
end
$function$
;

-- ══ admin_od_movimientos_v1(p_session_token text, p_desde date, p_hasta date, p_pc_codigo text, p_tipo text, p_operador text, p_limit integer)
-- Movimientos manuales de plata (no carga/retiro) para el Admi, con señales de revisión. Solo lectura, respeta el alcance del encargado.
CREATE OR REPLACE FUNCTION public.admin_od_movimientos_v1(p_session_token text, p_desde date DEFAULT (CURRENT_DATE - 90), p_hasta date DEFAULT CURRENT_DATE, p_pc_codigo text DEFAULT NULL::text, p_tipo text DEFAULT NULL::text, p_operador text DEFAULT NULL::text, p_limit integer DEFAULT 300)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_scope jsonb;
  v_pc    text;
  v_todas boolean;
  v_out   jsonb;
begin
  v_scope := public.admin_od_scope_effective(p_session_token, p_pc_codigo);
  if not coalesce((v_scope->>'ok')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', v_scope->>'error');
  end if;
  v_pc    := nullif(v_scope->>'pc_codigo_efectivo', '');
  v_todas := coalesce((v_scope->>'puede_todas')::boolean, false);

  with base as (
    select h.id, h.created_at, h.pc_codigo, h.tipo, h.monto,
           h.billetera_id, h.billetera_nombre, h.operador, h.origen, h.estado,
           h.notas, h.chunior_movimiento_id
    from public.historial_ops h
    where h.tipo not in ('CARGA','RETIRO','CONSULTA','RESET_CLAVE')
      and h.created_at >= p_desde
      and h.created_at <  (p_hasta + 1)
      and (v_pc is null or h.pc_codigo = v_pc)          -- null solo si puede_todas
      and (p_tipo is null or h.tipo = upper(p_tipo))
      and (p_operador is null or lower(coalesce(h.operador,'')) = lower(p_operador))
  ),
  -- Referencia por tipo: qué es "normal" para un depósito sin reclamar no es lo mismo
  -- que para una recarga de fichas, así que la mediana se calcula por separado.
  ref as (
    select tipo, percentile_cont(0.5) within group (order by monto) as mediana
    from base where monto > 0 group by tipo
  ),
  marcado as (
    select b.*,
           r.mediana,
           (b.monto > 0 and r.mediana > 0 and b.monto > r.mediana * 5)          as monto_atipico,
           (
             -- "notas" arranca con un prefijo automático; lo que importa es si el
             -- operador agregó algo suyo después del " · ".
             coalesce(btrim(regexp_replace(coalesce(b.notas,''),
                       '^(Transferencia entre billeteras|Cambio de billetera|Dep[oó]sito sin reclamar|Propina)\s*', '')), '') = ''
             or length(btrim(regexp_replace(coalesce(b.notas,''), '·[^·]*$', ''))) < 5
           )                                                                     as sin_explicacion,
           (coalesce(b.billetera_nombre,'') ~* 'error')                          as toca_error
    from base b left join ref r on r.tipo = b.tipo
  )
  select jsonb_build_object(
    'ok', true,
    'alcance', jsonb_build_object('pc', v_pc, 'todas', v_todas),
    'resumen', (
      select coalesce(jsonb_agg(x order by x.movimientos desc), '[]'::jsonb) from (
        select tipo,
               count(*)                                    as movimientos,
               round(sum(monto))                           as monto,
               count(*) filter (where monto_atipico)       as atipicos,
               count(*) filter (where sin_explicacion)     as sin_nota,
               count(*) filter (where toca_error)          as con_error
        from marcado group by tipo
      ) x
    ),
    'movimientos', (
      select coalesce(jsonb_agg(to_jsonb(y) order by y.created_at desc), '[]'::jsonb) from (
        select id, created_at, pc_codigo, tipo, monto, billetera_nombre, operador,
               origen, estado, notas, chunior_movimiento_id,
               monto_atipico, sin_explicacion, toca_error,
               (monto_atipico or sin_explicacion or toca_error) as revisar
        from marcado
        order by created_at desc
        limit greatest(1, least(coalesce(p_limit,300), 1000))
      ) y
    )
  ) into v_out;

  return v_out;
end;
$function$
;

-- ══ admin_od_operacion_vivo_v2(p_session_token text, p_pc_codigo text, p_limit integer)
CREATE OR REPLACE FUNCTION public.admin_od_operacion_vivo_v2(p_session_token text, p_pc_codigo text DEFAULT NULL::text, p_limit integer DEFAULT 40)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_scope jsonb;
  v_pc_efectivo text;
  v_res jsonb;
begin
  v_scope := public.admin_od_scope_effective(p_session_token, p_pc_codigo);

  if not coalesce((v_scope->>'ok')::boolean,false) then
    return v_scope;
  end if;

  v_pc_efectivo := nullif(v_scope->>'pc_codigo_efectivo','');

  v_res := public.admin_od_operacion_vivo(
    p_session_token,
    v_pc_efectivo,
    p_limit
  );

  return v_res || jsonb_build_object('scope', v_scope);
end;
$function$
;

-- ══ admin_od_operadores_rendimiento_v1(p_session_token text, p_desde date, p_hasta date, p_pc_codigo text)
-- Rendimiento por operador: volumen, errores, tiempo de espera del usuario y respuesta en chat. Solo lectura, respeta el alcance.
CREATE OR REPLACE FUNCTION public.admin_od_operadores_rendimiento_v1(p_session_token text, p_desde date DEFAULT (CURRENT_DATE - 7), p_hasta date DEFAULT CURRENT_DATE, p_pc_codigo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_scope jsonb; v_pc text; v_todas boolean; v_out jsonb;
begin
  v_scope := public.admin_od_scope_effective(p_session_token, p_pc_codigo);
  if not coalesce((v_scope->>'ok')::boolean,false) then
    return jsonb_build_object('ok', false, 'error', v_scope->>'error');
  end if;
  v_pc    := nullif(v_scope->>'pc_codigo_efectivo','');
  v_todas := coalesce((v_scope->>'puede_todas')::boolean,false);

  with ops as (
    select h.operador, h.pc_codigo, h.tipo, h.monto, h.estado, h.created_at,
           -- minutos que esperó el usuario, cuando la operación vino del portal
           case when s.id is not null and s.updated_at > s.created_at
                then extract(epoch from (s.updated_at - s.created_at))/60 end as espera_min
    from public.historial_ops h
    left join public.landing_solicitudes s on s.id = h.solicitud_id
    where h.created_at >= p_desde
      and h.created_at <  (p_hasta + 1)
      and h.tipo in ('CARGA','RETIRO')
      and coalesce(btrim(h.operador),'') <> ''
      and (v_pc is null or h.pc_codigo = v_pc)
  ),
  -- Primera respuesta del operador en un chat de soporte
  chats as (
    select m->>'operador' as operador, s.pc_codigo,
           extract(epoch from (
             (m->>'fecha')::timestamptz - s.created_at))/60 as respuesta_min
    from public.landing_solicitudes s,
         lateral jsonb_array_elements(s.metadata->'chat_thread') m
    where s.tipo='SOPORTE'
      and s.created_at >= p_desde and s.created_at < (p_hasta + 1)
      and (v_pc is null or s.pc_codigo = v_pc)
      and upper(coalesce(m->>'origen','')) = 'OPERADOR'
      and coalesce(btrim(m->>'operador'),'') not in ('','NODO')   -- el bot no cuenta
  ),
  por_chat as (
    select operador, count(*) as chats_contestados,
           percentile_cont(0.5) within group (order by respuesta_min) as resp_mediana
    from chats where respuesta_min between 0 and 240 group by operador
  )
  select jsonb_build_object(
    'ok', true,
    'alcance', jsonb_build_object('pc', v_pc, 'todas', v_todas),
    'operadores', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.operaciones desc) from (
        select o.operador,
               string_agg(distinct o.pc_codigo, ', ' order by o.pc_codigo) as oficinas,
               count(*)                                     as operaciones,
               count(*) filter (where o.tipo='CARGA')        as cargas,
               count(*) filter (where o.tipo='RETIRO')       as retiros,
               round(sum(o.monto))                           as monto,
               count(*) filter (where o.estado='ERROR')      as errores,
               round(100.0*count(*) filter (where o.estado='ERROR')/count(*),1) as pct_error,
               count(o.espera_min)                           as con_tiempo,
               round(percentile_cont(0.5) within group (order by o.espera_min)::numeric,1) as espera_mediana_min,
               -- "Lenta" según el tipo: la carga debería salir en minutos; el retiro tolera más.
               count(*) filter (where (o.tipo='CARGA'  and o.espera_min > 10)
                                   or (o.tipo='RETIRO' and o.espera_min > 60)) as lentas,
               c.chats_contestados,
               round(c.resp_mediana::numeric,1)              as chat_respuesta_mediana_min
        from ops o
        left join por_chat c on c.operador = o.operador
        group by o.operador, c.chats_contestados, c.resp_mediana
      ) x
    ), '[]'::jsonb),
    'totales', (
      select jsonb_build_object(
        'operaciones', count(*),
        'operadores',  count(distinct operador),
        'sin_tiempo',  count(*) filter (where espera_min is null),
        'espera_mediana_min', round(percentile_cont(0.5) within group (order by espera_min)::numeric,1))
      from ops
    )
  ) into v_out;

  return v_out;
end;
$function$
;

-- ══ admin_od_reconexion_avance_v1(p_session_token text)
CREATE OR REPLACE FUNCTION public.admin_od_reconexion_avance_v1(p_session_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_sc jsonb; v_todas boolean; v_pc text; v_out jsonb;
begin
  v_sc := public.admin_od_scope_effective(p_session_token, null);
  if not coalesce((v_sc->>'ok')::boolean,false) then return v_sc; end if;
  v_todas := coalesce((v_sc->>'puede_todas')::boolean,false);
  v_pc    := nullif(upper(trim(coalesce(v_sc->>'pc_codigo_efectivo',''))),'');

  select jsonb_agg(x order by x->>'pc') into v_out from (
    select jsonb_build_object(
      'pc', pc_codigo,
      'tocados',    count(*),
      'contactados',count(*) filter (where estado='CONTACTADO'),
      'recuperados',count(*) filter (where estado='RECUPERADO'),
      'no_contesta',count(*) filter (where estado='NO_CONTESTA'),
      'descartados',count(*) filter (where estado='DESCARTADO'),
      -- cerrado = segundo intento sin respuesta, ya no vuelve a la cola
      'cerrados',   count(*) filter (where estado='NO_CONTESTA' and intentos >= 2),
      'vuelven',    count(*) filter (where reabrir_at is not null and reabrir_at > now()),
      'hoy',        count(*) filter (where (ultimo_intento_at at time zone 'America/Argentina/Buenos_Aires')::date
                                           = (now() at time zone 'America/Argentina/Buenos_Aires')::date),
      'ultimo',     max(ultimo_intento_at)
    ) x
    from public.reconexion_contactos
    where (v_todas or pc_codigo = v_pc)
    group by pc_codigo
  ) t;

  return jsonb_build_object('ok',true,'puede_todas',v_todas,
                            'pc_forzada', case when v_todas then null else v_pc end,
                            'oficinas', coalesce(v_out,'[]'::jsonb));
end;
$function$
;

-- ══ admin_od_reconexion_marcar(p_session_token text, p_pc_codigo text, p_usuario text, p_estado text, p_canal text, p_nota text)
CREATE OR REPLACE FUNCTION public.admin_od_reconexion_marcar(p_session_token text, p_pc_codigo text, p_usuario text, p_estado text DEFAULT 'CONTACTADO'::text, p_canal text DEFAULT NULL::text, p_nota text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_scope jsonb; v_pc text; v_pedido text; v_est text; v_quien text;
  v_prev record; v_int int; v_reabrir timestamptz; v_cerrado boolean := false;
begin
  v_scope := public.admin_od_scope_effective(p_session_token, p_pc_codigo);
  if not coalesce((v_scope->>'ok')::boolean,false) then return v_scope; end if;
  v_pedido := upper(trim(coalesce(p_pc_codigo,'')));
  v_pc     := coalesce(nullif(v_scope->>'pc_codigo_efectivo',''), nullif(v_pedido,''));
  v_quien  := coalesce(nullif(v_scope->>'usuario',''),'?');

  if v_pc is null or v_pc = '' then return jsonb_build_object('ok',false,'error','FALTA_OFICINA'); end if;
  if not coalesce((v_scope->>'puede_todas')::boolean,false) and v_pedido <> '' and v_pedido <> v_pc then
    return jsonb_build_object('ok',false,'error','FUERA_DE_ALCANCE'); end if;
  if coalesce(trim(p_usuario),'') = '' then return jsonb_build_object('ok',false,'error','FALTA_USUARIO'); end if;

  v_est := upper(trim(coalesce(p_estado,'CONTACTADO')));
  if v_est not in ('CONTACTADO','NO_CONTESTA','DESCARTADO','RECUPERADO') then
    return jsonb_build_object('ok',false,'error','ESTADO_INVALIDO'); end if;

  select * into v_prev from public.reconexion_contactos
   where pc_codigo = v_pc and usuario = lower(trim(p_usuario));

  v_int := coalesce(v_prev.intentos,0) + 1;

  -- Un NO_CONTESTA reabre a los 3 dias, pero solo la primera vez. Al segundo se cierra.
  if v_est = 'NO_CONTESTA' then
    if v_int >= 2 then v_reabrir := null; v_cerrado := true;
    else v_reabrir := now() + interval '3 days'; end if;
  else
    v_reabrir := null;   -- contactado/descartado/recuperado no reabren solos
  end if;

  insert into public.reconexion_contactos
    (pc_codigo, usuario, estado, canal, nota, operador, intentos, ultimo_intento_at, reabrir_at)
  values (v_pc, lower(trim(p_usuario)), v_est,
          nullif(upper(trim(coalesce(p_canal,''))),''), nullif(trim(coalesce(p_nota,'')),''),
          v_quien, v_int, now(), v_reabrir)
  on conflict (pc_codigo, usuario) do update
    set estado = excluded.estado,
        canal  = coalesce(excluded.canal, public.reconexion_contactos.canal),
        nota   = coalesce(excluded.nota,  public.reconexion_contactos.nota),
        operador = excluded.operador,
        intentos = excluded.intentos,
        ultimo_intento_at = excluded.ultimo_intento_at,
        reabrir_at = excluded.reabrir_at,
        updated_at = now();

  return jsonb_build_object('ok',true,'pc_codigo',v_pc,'usuario',lower(trim(p_usuario)),
    'estado',v_est,'intentos',v_int,'reabre',v_reabrir,'cerrado',v_cerrado,'operador',v_quien);
end;
$function$
;

-- ══ admin_od_rescate_v1(p_session_token text, p_dias integer)
CREATE OR REPLACE FUNCTION public.admin_od_rescate_v1(p_session_token text, p_dias integer DEFAULT 14)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sc jsonb; v_todas boolean; v_pc text; v_d int := greatest(coalesce(p_dias,14),1);
begin
  v_sc := public.admin_od_scope_effective(p_session_token, null);
  if not coalesce((v_sc->>'ok')::boolean,false) then
    return jsonb_build_object('ok', false, 'error', v_sc->>'error');
  end if;
  v_todas := coalesce((v_sc->>'puede_todas')::boolean,false);
  v_pc    := case when v_todas then null else nullif(v_sc->>'pc_codigo_efectivo','') end;

  return jsonb_build_object('ok', true, 'generado', now(), 'dias', v_d,

    'oficinas', coalesce((select jsonb_agg(x order by (x->>'en_cola')::int desc) from (
      with cola as (
        select c.pc_codigo pc, count(*) n, coalesce(sum(c.valor),0) valor
        from public.rescate_candidatos c
        left join public.reconexion_contactos m
               on upper(coalesce(m.pc_codigo,'')) = c.pc_codigo and lower(btrim(m.usuario)) = lower(c.usuario)
        where length(coalesce(c.telefono,'')) = 10
          and c.ultima is not null and c.ultima < now() - interval '60 days'
          and m.usuario is null
        group by 1
      ),
      trab as (
        select upper(coalesce(m.pc_codigo,'')) pc,
               count(*) filter (where m.updated_at > now() - make_interval(days => v_d)) trabajados,
               count(*) filter (where m.estado='CONTACTADO' and m.updated_at > now() - make_interval(days => v_d)) contactados,
               count(*) filter (where m.estado='CONTACTADO' and m.updated_at > now() - make_interval(days => v_d)
                                  and exists (select 1 from historial_ops h
                                              where upper(coalesce(h.pc_codigo,''))=upper(coalesce(m.pc_codigo,''))
                                                and nodo_norm_usuario_v21(h.usuario)=nodo_norm_usuario_v21(m.usuario)
                                                and upper(coalesce(h.tipo,''))='CARGA'
                                                and h.created_at > m.updated_at)) recuperados
        from reconexion_contactos m group by 1
      ),
      pcs as (select pc from cola union select pc from trab)
      select jsonb_build_object(
        'pc', p.pc, 'en_cola', coalesce(c.n,0), 'valor_en_cola', round(coalesce(c.valor,0)),
        'trabajados', coalesce(t.trabajados,0), 'contactados', coalesce(t.contactados,0),
        'recuperados', coalesce(t.recuperados,0),
        'pct_recuperado', case when coalesce(t.contactados,0)>0
                               then round(100.0*t.recuperados/t.contactados,1) else null end) as x
      from pcs p left join cola c on c.pc=p.pc left join trab t on t.pc=p.pc
      where p.pc ~ '^P[0-9]+$' and (v_pc is null or p.pc = v_pc)) s), '[]'::jsonb),

    'dedicacion', coalesce((select jsonb_agg(x order by (x->>'trabajados')::int desc) from (
      select jsonb_build_object(
        'operador', coalesce(nullif(btrim(m.operador),''),'(sin nombre)'),
        'pc', upper(coalesce(m.pc_codigo,'')),
        'trabajados', count(*),
        'contactados', count(*) filter (where m.estado='CONTACTADO'),
        'descartados', count(*) filter (where m.estado='DESCARTADO'),
        'dias_activos', count(distinct (m.updated_at at time zone 'America/Argentina/Buenos_Aires')::date),
        'hora_tipica', lpad((mode() within group (
            order by extract(hour from (m.updated_at at time zone 'America/Argentina/Buenos_Aires'))
          ))::int::text, 2, '0') || ' h') as x
      from reconexion_contactos m
      where m.updated_at > now() - make_interval(days => v_d)
        and (v_pc is null or upper(coalesce(m.pc_codigo,'')) = v_pc)
      group by coalesce(nullif(btrim(m.operador),''),'(sin nombre)'),
               upper(coalesce(m.pc_codigo,''))) s), '[]'::jsonb),

    'calidad', coalesce((select jsonb_agg(x order by (x->>'mensajes')::int desc) from (
      with msg as (
        select btrim(mm->>'operador') op, upper(coalesce(s.pc_codigo,'')) pc, btrim(mm->>'mensaje') txt
        from landing_solicitudes s,
             lateral jsonb_array_elements(coalesce(s.metadata->'chat_thread','[]'::jsonb)) mm
        where s.created_at > now() - make_interval(days => v_d)
          and upper(coalesce(mm->>'origen','')) = 'OPERADOR'
          and btrim(coalesce(mm->>'operador','')) not in ('','NODO','panel')
          and length(btrim(coalesce(mm->>'mensaje',''))) > 0
          and (v_pc is null or upper(coalesce(s.pc_codigo,'')) = v_pc)
      )
      select jsonb_build_object(
        'operador', op, 'pc', max(pc), 'mensajes', count(*),
        'largo_promedio',   round(avg(length(txt))),
        'pct_minuscula',    round(100.0*count(*) filter (where txt ~ '^[a-záéíóúñ]')/count(*)),
        'pct_sin_punto',    round(100.0*count(*) filter (where txt !~ '[.!?]$')/count(*)),
        'pct_muy_corto',    round(100.0*count(*) filter (where length(txt) < 25)/count(*)),
        'pct_sin_cortesia', round(100.0*count(*) filter (where txt !~* '(hola|buenas|gracias|por favor|saludos|aguard|disculp)')/count(*))
      ) as x
      from msg group by op having count(*) >= 5) s), '[]'::jsonb),

    'atribucion', (select jsonb_build_object(
        'humanos', count(*) filter (where btrim(coalesce(mm->>'operador','')) <> 'NODO'),
        'con_nombre', count(*) filter (where btrim(coalesce(mm->>'operador','')) not in ('','NODO','panel')),
        'automaticos', count(*) filter (where btrim(coalesce(mm->>'operador','')) = 'NODO'))
      from landing_solicitudes s,
           lateral jsonb_array_elements(coalesce(s.metadata->'chat_thread','[]'::jsonb)) mm
      where s.created_at > now() - make_interval(days => v_d)
        and upper(coalesce(mm->>'origen','')) = 'OPERADOR'
        and (v_pc is null or upper(coalesce(s.pc_codigo,'')) = v_pc))
  );
end $function$
;


-- ══ admin_od_scope_effective(p_session_token text, p_pc_codigo text)
CREATE OR REPLACE FUNCTION public.admin_od_scope_effective(p_session_token text, p_pc_codigo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s record;
  v_req text;
  v_eff text;
  v_puede_todas boolean;
begin
  select *
  into s
  from public.admin_get_scope(p_session_token)
  limit 1;

  if not coalesce(s.ok,false) then
    return jsonb_build_object(
      'ok', false,
      'error', 'SESSION_INVALIDA'
    );
  end if;

  v_req := nullif(upper(trim(coalesce(p_pc_codigo,''))), '');

  v_puede_todas :=
    coalesce(s.puede_todas,false)
    or upper(coalesce(s.rol,'')) = 'ADMIN'
    or upper(coalesce(s.scope,'')) in ('ALL','TODAS','GLOBAL','GENERAL');

  if v_puede_todas then
    v_eff := v_req;
  else
    v_eff := nullif(upper(trim(coalesce(s.pc_codigo,''))), '');
  end if;

  if not v_puede_todas and v_eff is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'ENCARGADO_SIN_OFICINA',
      'usuario', s.usuario,
      'rol', s.rol
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'usuario', s.usuario,
    'nombre', s.nombre,
    'rol', s.rol,
    'tipo', s.tipo,
    'pc_codigo_original', s.pc_codigo,
    'pc_codigo_solicitado', v_req,
    'pc_codigo_efectivo', v_eff,
    'puede_todas', v_puede_todas,
    'scope_forzado', case
      when v_puede_todas then false
      else true
    end
  );
end;
$function$
;

-- ══ admin_od_tablero_v1(p_session_token text, p_desde date, p_hasta date)
CREATE OR REPLACE FUNCTION public.admin_od_tablero_v1(p_session_token text, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sc jsonb; v_todas boolean; v_pc text;
  v_tz text := 'America/Argentina/Buenos_Aires';
  v_d timestamptz; v_h timestamptz; v_ofis jsonb;
begin
  v_sc := public.admin_od_scope_effective(p_session_token, null);
  if not coalesce((v_sc->>'ok')::boolean,false) then return v_sc; end if;
  v_todas := coalesce((v_sc->>'puede_todas')::boolean,false);
  v_pc    := nullif(upper(trim(coalesce(v_sc->>'pc_codigo_efectivo',''))),'');

  v_d := (coalesce(p_desde, (now() at time zone v_tz)::date))::timestamp at time zone v_tz;
  v_h := ((coalesce(p_hasta, (now() at time zone v_tz)::date) + 1))::timestamp at time zone v_tz;

  with ops as (
    select upper(coalesce(pc_codigo,'—')) pc, upper(coalesce(tipo,'')) tipo,
           upper(coalesce(origen,'')) origen, coalesce(monto,0) monto,
           lower(btrim(usuario)) u
    from public.historial_ops
    where created_at >= v_d and created_at < v_h
  ),
  agg as (
    select pc,
           count(*) filter (where tipo='CARGA')                      cargas,
           coalesce(sum(monto) filter (where tipo='CARGA'),0)        cargas_monto,
           count(*) filter (where tipo='RETIRO')                     retiros,
           coalesce(sum(monto) filter (where tipo='RETIRO'),0)       retiros_monto,
           count(*) filter (where tipo not in ('CARGA','RETIRO'))    otras,
           count(*)                                                  ops_total,
           count(*) filter (where origen='PROMO_BONO')               bonos,
           coalesce(sum(monto) filter (where origen='PROMO_BONO'),0) bonos_monto
    from ops group by pc
  ),
  cand as (select distinct u, pc from ops where tipo='CARGA'),
  nuevos as (
    select pc, count(*) nuevos_carga from cand c
    where not exists (select 1 from public.historial_ops h2
                      where lower(btrim(h2.usuario)) = c.u and h2.created_at < v_d
                        and upper(coalesce(h2.tipo,'')) = 'CARGA')
    group by pc
  ),
  vinc as (
    select upper(coalesce(pc_codigo,'—')) pc, count(*) nuevos_vinculo
    from public.usuarios_portal_vinculos
    where created_at >= v_d and created_at < v_h group by 1
  ),
  pend as (
    select upper(coalesce(pc_codigo,'—')) pc,
           count(*) filter (where upper(coalesce(tipo,''))='CARGA')   p_carga,
           count(*) filter (where upper(coalesce(tipo,''))='RETIRO')  p_retiro,
           count(*) filter (where upper(coalesce(tipo,''))='SOPORTE') p_soporte,
           count(*)                                                   p_total,
           round(max(extract(epoch from (now()-created_at))/60.0))::int p_min
    from public.landing_solicitudes
    where estado = 'PENDIENTE'
    group by 1
  ),
  act as (
    -- Una fila por puesto. Los datos visibles son los del panel que latio mas recien; el
    -- conteo mira SOLO lo que esta prendido ahora, para no arrastrar el historial de turnos.
    select upper(pc_codigo) pc,
           (array_agg(nullif(upper(trim(coalesce(oficina_id,''))),'') order by last_seen desc))[1] as oficina,
           (array_agg(operador order by last_seen desc))[1] as operador,
           (array_agg(version  order by last_seen desc))[1] as version,
           bool_or((now() - last_seen) < interval '3 minutes')          as online,
           min(round(extract(epoch from (now()-last_seen))/60.0))::int  as hace_min,
           count(*) filter (where (now() - last_seen) < interval '3 minutes') as paneles_online,
           ((count(distinct coalesce(version,''))
             filter (where (now() - last_seen) < interval '3 minutes')) > 1) as versiones_distintas
    from public.panel_actividad
    group by 1
  ),
  todas as (select pc from agg union select pc from vinc union select pc from act union select pc from pend)
  select jsonb_agg(jsonb_build_object(
           'pc',t.pc,'oficina',a.oficina,'operador',a.operador,
           'online',coalesce(a.online,false),'hace_min',a.hace_min,'version',a.version,
           'paneles_online',coalesce(a.paneles_online,0),
           'versiones_distintas',coalesce(a.versiones_distintas,false),
           'cargas',coalesce(g.cargas,0),'cargas_monto',coalesce(g.cargas_monto,0),
           'retiros',coalesce(g.retiros,0),'retiros_monto',coalesce(g.retiros_monto,0),
           'otras',coalesce(g.otras,0),'ops_total',coalesce(g.ops_total,0),
           'bonos',coalesce(g.bonos,0),'bonos_monto',coalesce(g.bonos_monto,0),
           'nuevos_carga',coalesce(n.nuevos_carga,0),'nuevos_vinculo',coalesce(v.nuevos_vinculo,0),
           'neto',coalesce(g.cargas_monto,0)-coalesce(g.retiros_monto,0),
           'pend_carga',coalesce(pd.p_carga,0),'pend_retiro',coalesce(pd.p_retiro,0),
           'pend_soporte',coalesce(pd.p_soporte,0),'pend_total',coalesce(pd.p_total,0),
           'pend_min',pd.p_min
         ) order by t.pc) into v_ofis
  from todas t
  left join agg g on g.pc=t.pc
  left join nuevos n on n.pc=t.pc
  left join vinc v on v.pc=t.pc
  left join act a on a.pc=t.pc
  left join pend pd on pd.pc=t.pc
  where t.pc <> '—'
    and (v_todas or t.pc = v_pc)
    and (coalesce(g.ops_total,0) > 0 or coalesce(v.nuevos_vinculo,0) > 0
         or coalesce(a.online,false) or coalesce(pd.p_total,0) > 0);

  return jsonb_build_object('ok',true,
    'desde',(v_d at time zone v_tz)::date, 'hasta',((v_h at time zone v_tz)::date - 1),
    'puede_todas',v_todas, 'pc_forzada', case when v_todas then null else v_pc end,
    'usuario',v_sc->>'usuario', 'rol',v_sc->>'rol',
    'oficinas', coalesce(v_ofis,'[]'::jsonb));
end;
$function$
;
