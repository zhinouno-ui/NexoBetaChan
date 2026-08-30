-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- ADMI · TABLEROS Y REPORTES  (parte 2 de 2 — las tres funciones grandes)
-- Copia de lectura de lo que corre en Supabase (proyecto NODO · pjvvyvfcwjoocjqvdror).
--
--   admin_od_dashboard_resumen    el tablero principal: KPIs, por oficina, por operador,
--                                 últimas operaciones y alertas operativas.
--   admin_od_crecimiento_resumen  bonos, usuarios nuevos, validaciones y retiros parciales.
--   admin_od_operacion_vivo       la foto en vivo del día: KPIs de los últimos 15/60 min,
--                                 errores, pendientes, chats, y OK sin anotar en Chunior.
--
-- OJO: estas tres NO usan admin_od_scope_effective — validan con `nodo_admin_session_ok`,
-- que solo dice si la sesión es válida, sin acotar la oficina. El control de alcance lo
-- ponen sus envoltorios *_v2 (en admin-tablero.sql), que resuelven el scope y les pasan la
-- oficina ya decidida. Llamarlas directo saltea ese control.
--
-- Referencian tablas que el panel operativo no usa: `solicitudes`, `chat_sesiones`,
-- `usuarios`, `landing_rutas_publicas`.
--
-- Generado con pg_get_functiondef el 2026-08-30. Verificado por md5 contra la base.
-- ═══════════════════════════════════════════════════════════════════════════════════════════


-- ══ admin_od_crecimiento_resumen(p_session_token text, p_desde timestamptz, p_hasta timestamptz, p_pc_codigo text, p_usuario text, p_limit integer)
CREATE OR REPLACE FUNCTION public.admin_od_crecimiento_resumen(p_session_token text, p_desde timestamp with time zone DEFAULT NULL::timestamp with time zone, p_hasta timestamp with time zone DEFAULT NULL::timestamp with time zone, p_pc_codigo text DEFAULT NULL::text, p_usuario text DEFAULT NULL::text, p_limit integer DEFAULT 80)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ok boolean;
  v_desde timestamptz;
  v_hasta timestamptz;
  v_pc text;
  v_usuario text;
  v_limit integer;

  v_kpis jsonb;
  v_bonos jsonb;
  v_bonos_por_pc jsonb;
  v_bonos_por_operador jsonb;
  v_usuarios_nuevos jsonb;
  v_validaciones jsonb;
  v_validaciones_por_pc jsonb;
  v_retiros_parciales jsonb;
  v_retiros_parciales_por_pc jsonb;
  v_alertas jsonb;
begin
  v_ok := public.nodo_admin_session_ok(p_session_token);

  if not coalesce(v_ok,false) then
    return jsonb_build_object(
      'ok', false,
      'error', 'SESSION_INVALIDA'
    );
  end if;

  v_desde := coalesce(
    p_desde,
    date_trunc('day', now() at time zone 'America/Argentina/Buenos_Aires')
      at time zone 'America/Argentina/Buenos_Aires'
  );

  v_hasta := coalesce(p_hasta, now());

  v_pc := nullif(upper(trim(coalesce(p_pc_codigo,''))), '');
  v_usuario := nullif(lower(trim(coalesce(p_usuario,''))), '');
  v_limit := least(greatest(coalesce(p_limit,80),20),300);


  /*
    KPIs generales.
  */
  with bonos as (
    select *
    from public.historial_ops h
    where h.created_at >= v_desde
      and h.created_at <= v_hasta
      and upper(coalesce(h.origen,'')) = 'PROMO_BONO'
      and (v_pc is null or upper(coalesce(h.pc_codigo,'')) = v_pc)
      and (v_usuario is null or lower(coalesce(h.usuario,'')) like '%' || v_usuario || '%')
  ),
  retiros_parciales as (
    select *
    from public.historial_ops h
    where h.created_at >= v_desde
      and h.created_at <= v_hasta
      and upper(coalesce(h.tipo,'')) = 'RETIRO'
      and (
        (
          h.monto_declarado is not null
          and h.monto_aprobado is not null
          and h.monto_declarado <> h.monto_aprobado
        )
      )
      and (v_pc is null or upper(coalesce(h.pc_codigo,'')) = v_pc)
      and (v_usuario is null or lower(coalesce(h.usuario,'')) like '%' || v_usuario || '%')
  ),
  usuarios_nuevos as (
    select *
    from public.usuarios u
    where u.created_at >= v_desde
      and u.created_at <= v_hasta
      and (v_pc is null or upper(coalesce(u.pc_codigo,'')) = v_pc)
  ),
  vinculos as (
    select *
    from public.usuarios_portal_vinculos v
    where (v_pc is null or upper(coalesce(v.pc_codigo,'')) = v_pc)
  )
  select jsonb_build_object(
    'usuarios_nuevos', (select count(*) from usuarios_nuevos),

    'vinculados', (
      select count(*)
      from vinculos
      where upper(coalesce(estado_vinculo,'')) = 'VINCULADO'
    ),

    'pendientes_validacion', (
      select count(*)
      from vinculos
      where upper(coalesce(estado_vinculo,'')) = 'PENDIENTE'
    ),

    'conflictos_validacion', (
      select count(*)
      from vinculos
      where upper(coalesce(estado_vinculo,'')) in (
        'CONFLICTO',
        'CONFLICTO_USUARIO',
        'CONFLICTO_TELEFONO',
        'BLOQUEADO'
      )
    ),

    'bonos_count', (
      select count(*)
      from bonos
      where upper(coalesce(estado,'')) in ('OK','PAGADA','COMPLETADO','ACREDITADA','APROBADA')
    ),

    'bonos_monto', (
      select coalesce(sum(monto),0)
      from bonos
      where upper(coalesce(estado,'')) in ('OK','PAGADA','COMPLETADO','ACREDITADA','APROBADA')
    ),

    'bonos_error', (
      select count(*)
      from bonos
      where upper(coalesce(estado,'')) in ('ERROR','FALLIDA','RECHAZADA','REVERTIDA','ANULADA')
    ),

    'retiros_parciales_count', (
      select count(*)
      from retiros_parciales
    ),

    'retiros_parciales_diferencia', (
      select coalesce(sum(abs(coalesce(monto_declarado,0) - coalesce(monto_aprobado,0))),0)
      from retiros_parciales
    )
  )
  into v_kpis;


  /*
    Últimos bonos.
  */
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'created_at', created_at,
      'pc_codigo', pc_codigo,
      'usuario', usuario,
      'monto', monto,
      'estado', estado,
      'operador', operador,
      'billetera_nombre', billetera_nombre,
      'chunior_movimiento_id', chunior_movimiento_id,
      'notas', notas
    )
    order by created_at desc
  ), '[]'::jsonb)
  into v_bonos
  from (
    select *
    from public.historial_ops h
    where h.created_at >= v_desde
      and h.created_at <= v_hasta
      and upper(coalesce(h.origen,'')) = 'PROMO_BONO'
      and (v_pc is null or upper(coalesce(h.pc_codigo,'')) = v_pc)
      and (v_usuario is null or lower(coalesce(h.usuario,'')) like '%' || v_usuario || '%')
    order by h.created_at desc
    limit v_limit
  ) b;


  /*
    Bonos por PC.
  */
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'pc_codigo', pc_codigo,
      'cantidad', cantidad,
      'monto', monto,
      'errores', errores
    )
    order by pc_codigo
  ), '[]'::jsonb)
  into v_bonos_por_pc
  from (
    select
      coalesce(pc_codigo,'SIN_PC') as pc_codigo,
      count(*) filter (
        where upper(coalesce(estado,'')) in ('OK','PAGADA','COMPLETADO','ACREDITADA','APROBADA')
      ) as cantidad,
      coalesce(sum(monto) filter (
        where upper(coalesce(estado,'')) in ('OK','PAGADA','COMPLETADO','ACREDITADA','APROBADA')
      ),0) as monto,
      count(*) filter (
        where upper(coalesce(estado,'')) in ('ERROR','FALLIDA','RECHAZADA','REVERTIDA','ANULADA')
      ) as errores
    from public.historial_ops
    where created_at >= v_desde
      and created_at <= v_hasta
      and upper(coalesce(origen,'')) = 'PROMO_BONO'
      and (v_pc is null or upper(coalesce(pc_codigo,'')) = v_pc)
    group by coalesce(pc_codigo,'SIN_PC')
  ) x;


  /*
    Bonos por operador.
  */
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'operador', operador,
      'cantidad', cantidad,
      'monto', monto,
      'errores', errores
    )
    order by cantidad desc
  ), '[]'::jsonb)
  into v_bonos_por_operador
  from (
    select
      coalesce(nullif(trim(operador),''),'SIN_OPERADOR') as operador,
      count(*) filter (
        where upper(coalesce(estado,'')) in ('OK','PAGADA','COMPLETADO','ACREDITADA','APROBADA')
      ) as cantidad,
      coalesce(sum(monto) filter (
        where upper(coalesce(estado,'')) in ('OK','PAGADA','COMPLETADO','ACREDITADA','APROBADA')
      ),0) as monto,
      count(*) filter (
        where upper(coalesce(estado,'')) in ('ERROR','FALLIDA','RECHAZADA','REVERTIDA','ANULADA')
      ) as errores
    from public.historial_ops
    where created_at >= v_desde
      and created_at <= v_hasta
      and upper(coalesce(origen,'')) = 'PROMO_BONO'
      and (v_pc is null or upper(coalesce(pc_codigo,'')) = v_pc)
    group by coalesce(nullif(trim(operador),''),'SIN_OPERADOR')
    order by cantidad desc
    limit 30
  ) x;


  /*
    Usuarios nuevos.
  */
  select coalesce(jsonb_agg(
    to_jsonb(u)
    order by u.created_at desc
  ), '[]'::jsonb)
  into v_usuarios_nuevos
  from (
    select *
    from public.usuarios u
    where u.created_at >= v_desde
      and u.created_at <= v_hasta
      and (v_pc is null or upper(coalesce(u.pc_codigo,'')) = v_pc)
    order by u.created_at desc
    limit v_limit
  ) u;


  /*
    Validaciones.
    CORREGIDO: no depende de usuario_normalizado / telefono_normalizado.
    Busca dentro del JSON completo de la fila.
  */
  select coalesce(jsonb_agg(
    to_jsonb(v)
    order by v.created_at desc nulls last
  ), '[]'::jsonb)
  into v_validaciones
  from (
    select *
    from public.usuarios_portal_vinculos v
    where (v_pc is null or upper(coalesce(v.pc_codigo,'')) = v_pc)
      and (
        v_usuario is null
        or lower(to_jsonb(v)::text) like '%' || v_usuario || '%'
      )
    order by v.created_at desc nulls last
    limit v_limit
  ) v;


  /*
    Validaciones por PC.
  */
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'pc_codigo', pc_codigo,
      'estado_vinculo', estado_vinculo,
      'cantidad', cantidad
    )
    order by pc_codigo, estado_vinculo
  ), '[]'::jsonb)
  into v_validaciones_por_pc
  from (
    select
      coalesce(pc_codigo,'SIN_PC') as pc_codigo,
      coalesce(estado_vinculo,'SIN_ESTADO') as estado_vinculo,
      count(*) as cantidad
    from public.usuarios_portal_vinculos
    where (v_pc is null or upper(coalesce(pc_codigo,'')) = v_pc)
    group by coalesce(pc_codigo,'SIN_PC'), coalesce(estado_vinculo,'SIN_ESTADO')
  ) x;


  /*
    Retiros parciales.
    Ahora lo hacemos más estricto:
    SOLO cuenta si monto_declarado y monto_aprobado existen y son distintos.
    Así no mete todos los retiros landing por tener texto 'declarado/aprobado' en notas.
  */
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'created_at', created_at,
      'pc_codigo', pc_codigo,
      'usuario', usuario,
      'monto', monto,
      'monto_declarado', monto_declarado,
      'monto_aprobado', monto_aprobado,
      'diferencia', monto_declarado - monto_aprobado,
      'estado', estado,
      'origen', origen,
      'operador', operador,
      'billetera_nombre', billetera_nombre,
      'chunior_movimiento_id', chunior_movimiento_id,
      'notas', notas
    )
    order by created_at desc
  ), '[]'::jsonb)
  into v_retiros_parciales
  from (
    select *
    from public.historial_ops h
    where h.created_at >= v_desde
      and h.created_at <= v_hasta
      and upper(coalesce(h.tipo,'')) = 'RETIRO'
      and h.monto_declarado is not null
      and h.monto_aprobado is not null
      and h.monto_declarado <> h.monto_aprobado
      and (v_pc is null or upper(coalesce(h.pc_codigo,'')) = v_pc)
      and (v_usuario is null or lower(coalesce(h.usuario,'')) like '%' || v_usuario || '%')
    order by h.created_at desc
    limit v_limit
  ) r;


  /*
    Retiros parciales por PC.
  */
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'pc_codigo', pc_codigo,
      'cantidad', cantidad,
      'diferencia_total', diferencia_total
    )
    order by pc_codigo
  ), '[]'::jsonb)
  into v_retiros_parciales_por_pc
  from (
    select
      coalesce(pc_codigo,'SIN_PC') as pc_codigo,
      count(*) as cantidad,
      coalesce(sum(monto_declarado - monto_aprobado),0) as diferencia_total
    from public.historial_ops h
    where h.created_at >= v_desde
      and h.created_at <= v_hasta
      and upper(coalesce(h.tipo,'')) = 'RETIRO'
      and h.monto_declarado is not null
      and h.monto_aprobado is not null
      and h.monto_declarado <> h.monto_aprobado
      and (v_pc is null or upper(coalesce(h.pc_codigo,'')) = v_pc)
    group by coalesce(pc_codigo,'SIN_PC')
  ) x;


  /*
    Alertas.
  */
  with alertas as (
    select
      'VALIDACION' as tipo,
      pc_codigo,
      'Usuarios pendientes de validación: ' || count(*)::text as mensaje,
      'MEDIA' as severidad
    from public.usuarios_portal_vinculos
    where upper(coalesce(estado_vinculo,'')) = 'PENDIENTE'
      and (v_pc is null or upper(coalesce(pc_codigo,'')) = v_pc)
    group by pc_codigo
    having count(*) >= 10

    union all

    select
      'BONOS' as tipo,
      pc_codigo,
      'Bonos con error/reversión: ' || count(*)::text as mensaje,
      'MEDIA' as severidad
    from public.historial_ops
    where created_at >= v_desde
      and created_at <= v_hasta
      and upper(coalesce(origen,'')) = 'PROMO_BONO'
      and upper(coalesce(estado,'')) in ('ERROR','FALLIDA','RECHAZADA','REVERTIDA','ANULADA')
      and (v_pc is null or upper(coalesce(pc_codigo,'')) = v_pc)
    group by pc_codigo
    having count(*) >= 1

    union all

    select
      'RETIROS_PARCIALES' as tipo,
      pc_codigo,
      'Retiros parciales detectados: ' || count(*)::text as mensaje,
      'ALTA' as severidad
    from public.historial_ops h
    where h.created_at >= v_desde
      and h.created_at <= v_hasta
      and upper(coalesce(h.tipo,'')) = 'RETIRO'
      and h.monto_declarado is not null
      and h.monto_aprobado is not null
      and h.monto_declarado <> h.monto_aprobado
      and (v_pc is null or upper(coalesce(h.pc_codigo,'')) = v_pc)
    group by pc_codigo
    having count(*) >= 1
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'tipo', tipo,
      'pc_codigo', pc_codigo,
      'mensaje', mensaje,
      'severidad', severidad
    )
  ), '[]'::jsonb)
  into v_alertas
  from alertas;


  return jsonb_build_object(
    'ok', true,
    'desde', v_desde,
    'hasta', v_hasta,
    'pc_codigo', v_pc,
    'usuario', v_usuario,
    'kpis', coalesce(v_kpis, '{}'::jsonb),
    'bonos', coalesce(v_bonos, '[]'::jsonb),
    'bonos_por_pc', coalesce(v_bonos_por_pc, '[]'::jsonb),
    'bonos_por_operador', coalesce(v_bonos_por_operador, '[]'::jsonb),
    'usuarios_nuevos', coalesce(v_usuarios_nuevos, '[]'::jsonb),
    'validaciones', coalesce(v_validaciones, '[]'::jsonb),
    'validaciones_por_pc', coalesce(v_validaciones_por_pc, '[]'::jsonb),
    'retiros_parciales', coalesce(v_retiros_parciales, '[]'::jsonb),
    'retiros_parciales_por_pc', coalesce(v_retiros_parciales_por_pc, '[]'::jsonb),
    'alertas', coalesce(v_alertas, '[]'::jsonb)
  );
end;
$function$
;

-- ══ admin_od_dashboard_resumen(p_session_token text, p_desde timestamptz, p_hasta timestamptz, p_pc_codigo text, p_turno text, p_operador text)
CREATE OR REPLACE FUNCTION public.admin_od_dashboard_resumen(p_session_token text, p_desde timestamp with time zone DEFAULT NULL::timestamp with time zone, p_hasta timestamp with time zone DEFAULT NULL::timestamp with time zone, p_pc_codigo text DEFAULT NULL::text, p_turno text DEFAULT NULL::text, p_operador text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ok boolean;
  v_desde timestamptz;
  v_hasta timestamptz;
  v_pc text;
  v_turno text;
  v_operador text;

  v_kpis jsonb;
  v_por_pc jsonb;
  v_por_operador jsonb;
  v_ultimas jsonb;
  v_alertas jsonb;
begin
  v_ok := public.nodo_admin_session_ok(p_session_token);

  if not coalesce(v_ok,false) then
    return jsonb_build_object(
      'ok', false,
      'error', 'SESSION_INVALIDA'
    );
  end if;

  v_desde := coalesce(
    p_desde,
    date_trunc('day', now() at time zone 'America/Argentina/Buenos_Aires')
      at time zone 'America/Argentina/Buenos_Aires'
  );

  v_hasta := coalesce(p_hasta, now());

  v_pc := nullif(upper(trim(coalesce(p_pc_codigo,''))), '');
  v_turno := nullif(upper(trim(coalesce(p_turno,''))), '');
  v_operador := nullif(trim(coalesce(p_operador,'')), '');

  /*
    Historial real:
    - OK / PAGADA / COMPLETADO / ACREDITADA / APROBADA cuentan como exitosas.
    - ERROR / REVERTIDA / ANULADA / RECHAZADA cuentan como problemas.
    - PROMO_BONO cuenta como bono otorgado.
  */

  with h_base as (
    select
      h.*,
      upper(coalesce(h.tipo,'')) as tipo_u,
      upper(coalesce(h.estado,'')) as estado_u,
      upper(coalesce(h.origen,'')) as origen_u,
      case
        when extract(hour from h.created_at at time zone 'America/Argentina/Buenos_Aires') >= 6
         and extract(hour from h.created_at at time zone 'America/Argentina/Buenos_Aires') < 14 then 'TM'
        when extract(hour from h.created_at at time zone 'America/Argentina/Buenos_Aires') >= 14
         and extract(hour from h.created_at at time zone 'America/Argentina/Buenos_Aires') < 22 then 'TT'
        else 'TN'
      end as turno_calc
    from public.historial_ops h
    where h.created_at >= v_desde
      and h.created_at <= v_hasta
      and (v_pc is null or upper(coalesce(h.pc_codigo,'')) = v_pc)
      and (v_operador is null or coalesce(h.operador,'') = v_operador)
  ),
  h_filtrada as (
    select *
    from h_base
    where v_turno is null or turno_calc = v_turno
  ),
  k as (
    select
      count(*) as operaciones_total,

      count(*) filter (
        where tipo_u = 'CARGA'
          and estado_u in ('OK','PAGADA','COMPLETADO','ACREDITADA','APROBADA')
      ) as cargas_count,

      coalesce(sum(monto) filter (
        where tipo_u = 'CARGA'
          and estado_u in ('OK','PAGADA','COMPLETADO','ACREDITADA','APROBADA')
      ),0) as cargas_monto,

      count(*) filter (
        where tipo_u = 'RETIRO'
          and estado_u in ('OK','PAGADA','COMPLETADO','ACREDITADA','APROBADA')
      ) as retiros_count,

      coalesce(sum(monto) filter (
        where tipo_u = 'RETIRO'
          and estado_u in ('OK','PAGADA','COMPLETADO','ACREDITADA','APROBADA')
      ),0) as retiros_monto,

      count(*) filter (
        where estado_u in ('ERROR','FALLIDA','RECHAZADA','REVERTIDA','ANULADA')
      ) as errores,

      count(*) filter (
        where origen_u = 'PROMO_BONO'
          and estado_u in ('OK','PAGADA','COMPLETADO','ACREDITADA','APROBADA')
      ) as bonos_count,

      coalesce(sum(monto) filter (
        where origen_u = 'PROMO_BONO'
          and estado_u in ('OK','PAGADA','COMPLETADO','ACREDITADA','APROBADA')
      ),0) as bonos_monto
    from h_filtrada
  ),
  s as (
    select
      count(*) filter (
        where upper(coalesce(estado,'')) in ('PENDIENTE','NUEVA','NUEVO','EN_REVISION','EN REVISIÓN')
      ) as pendientes_portal
    from public.solicitudes sol
    where (v_pc is null or upper(coalesce(sol.pc_codigo,'')) = v_pc)
  ),
  c as (
    select
      count(*) filter (
        where upper(coalesce(estado,'')) = 'ABIERTO'
          and coalesce(sin_leer,0) > 0
      ) as chats_sin_responder,
      count(*) filter (
        where upper(coalesce(estado,'')) = 'ABIERTO'
      ) as chats_abiertos
    from public.chat_sesiones cs
    where (v_pc is null or upper(coalesce(cs.pc_codigo,'')) = v_pc)
  ),
  u as (
    select
      count(*) as usuarios_nuevos
    from public.usuarios us
    where us.created_at >= v_desde
      and us.created_at <= v_hasta
      and (v_pc is null or upper(coalesce(us.pc_codigo,'')) = v_pc)
  )
  select jsonb_build_object(
    'operaciones_total', k.operaciones_total,
    'cargas_count', k.cargas_count,
    'cargas_monto', k.cargas_monto,
    'retiros_count', k.retiros_count,
    'retiros_monto', k.retiros_monto,
    'neto', k.cargas_monto - k.retiros_monto,
    'errores', k.errores,
    'pendientes_portal', coalesce(s.pendientes_portal,0),
    'chats_sin_responder', coalesce(c.chats_sin_responder,0),
    'chats_abiertos', coalesce(c.chats_abiertos,0),
    'usuarios_nuevos', coalesce(u.usuarios_nuevos,0),
    'bonos_count', k.bonos_count,
    'bonos_monto', k.bonos_monto
  )
  into v_kpis
  from k, s, c, u;


  /*
    Métricas por oficina / PC.
  */
  with oficinas as (
    select
      r.pc_codigo,
      r.nombre_publico,
      r.subdominio,
      r.host,
      r.whatsapp_numero,
      r.activo
    from public.landing_rutas_publicas r
    where r.activo = true
      and (v_pc is null or upper(r.pc_codigo) = v_pc)
  ),
  h as (
    select
      h.*,
      upper(coalesce(h.tipo,'')) as tipo_u,
      upper(coalesce(h.estado,'')) as estado_u,
      upper(coalesce(h.origen,'')) as origen_u,
      case
        when extract(hour from h.created_at at time zone 'America/Argentina/Buenos_Aires') >= 6
         and extract(hour from h.created_at at time zone 'America/Argentina/Buenos_Aires') < 14 then 'TM'
        when extract(hour from h.created_at at time zone 'America/Argentina/Buenos_Aires') >= 14
         and extract(hour from h.created_at at time zone 'America/Argentina/Buenos_Aires') < 22 then 'TT'
        else 'TN'
      end as turno_calc
    from public.historial_ops h
    where h.created_at >= v_desde
      and h.created_at <= v_hasta
      and (v_pc is null or upper(coalesce(h.pc_codigo,'')) = v_pc)
      and (v_operador is null or coalesce(h.operador,'') = v_operador)
  ),
  hf as (
    select *
    from h
    where v_turno is null or turno_calc = v_turno
  ),
  agg as (
    select
      pc_codigo,
      count(*) as total_ops,
      count(*) filter (
        where tipo_u = 'CARGA'
          and estado_u in ('OK','PAGADA','COMPLETADO','ACREDITADA','APROBADA')
      ) as cargas_count,
      coalesce(sum(monto) filter (
        where tipo_u = 'CARGA'
          and estado_u in ('OK','PAGADA','COMPLETADO','ACREDITADA','APROBADA')
      ),0) as cargas_monto,
      count(*) filter (
        where tipo_u = 'RETIRO'
          and estado_u in ('OK','PAGADA','COMPLETADO','ACREDITADA','APROBADA')
      ) as retiros_count,
      coalesce(sum(monto) filter (
        where tipo_u = 'RETIRO'
          and estado_u in ('OK','PAGADA','COMPLETADO','ACREDITADA','APROBADA')
      ),0) as retiros_monto,
      count(*) filter (
        where estado_u in ('ERROR','FALLIDA','RECHAZADA','REVERTIDA','ANULADA')
      ) as errores,
      max(created_at) as ultima_operacion
    from hf
    group by pc_codigo
  ),
  sol as (
    select
      pc_codigo,
      count(*) filter (
        where upper(coalesce(estado,'')) in ('PENDIENTE','NUEVA','NUEVO','EN_REVISION','EN REVISIÓN')
      ) as pendientes
    from public.solicitudes
    group by pc_codigo
  ),
  ch as (
    select
      pc_codigo,
      count(*) filter (
        where upper(coalesce(estado,'')) = 'ABIERTO'
          and coalesce(sin_leer,0) > 0
      ) as chats_sin_responder
    from public.chat_sesiones
    group by pc_codigo
  ),
  bil as (
    select
      pc_codigo,
      count(*) filter (where activa = true) as billeteras_activas,
      count(*) filter (where activa = true and seleccionada_manual = true) as billeteras_en_portal
    from public.billeteras
    group by pc_codigo
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'pc_codigo', o.pc_codigo,
      'nombre_publico', o.nombre_publico,
      'subdominio', o.subdominio,
      'host', o.host,
      'whatsapp_numero', o.whatsapp_numero,

      'total_ops', coalesce(a.total_ops,0),
      'cargas_count', coalesce(a.cargas_count,0),
      'cargas_monto', coalesce(a.cargas_monto,0),
      'retiros_count', coalesce(a.retiros_count,0),
      'retiros_monto', coalesce(a.retiros_monto,0),
      'neto', coalesce(a.cargas_monto,0) - coalesce(a.retiros_monto,0),
      'errores', coalesce(a.errores,0),
      'pendientes', coalesce(sol.pendientes,0),
      'chats_sin_responder', coalesce(ch.chats_sin_responder,0),
      'billeteras_activas', coalesce(bil.billeteras_activas,0),
      'billeteras_en_portal', coalesce(bil.billeteras_en_portal,0),
      'ultima_operacion', a.ultima_operacion,

      'estado_operativo',
        case
          when coalesce(bil.billeteras_en_portal,0) = 0 then 'SIN_BILLETERA_PORTAL'
          when coalesce(a.errores,0) >= 10 then 'ALERTA_ERRORES'
          when coalesce(sol.pendientes,0) >= 10 then 'ALERTA_PENDIENTES'
          when a.ultima_operacion is null then 'SIN_ACTIVIDAD'
          when a.ultima_operacion < now() - interval '60 minutes' then 'SIN_ACTIVIDAD_RECIENTE'
          else 'OK'
        end
    )
    order by o.pc_codigo
  ), '[]'::jsonb)
  into v_por_pc
  from oficinas o
  left join agg a on upper(a.pc_codigo) = upper(o.pc_codigo)
  left join sol on upper(sol.pc_codigo) = upper(o.pc_codigo)
  left join ch on upper(ch.pc_codigo) = upper(o.pc_codigo)
  left join bil on upper(bil.pc_codigo) = upper(o.pc_codigo);


  /*
    Ranking operadores.
  */
  with h as (
    select
      coalesce(nullif(trim(operador),''),'SIN_OPERADOR') as operador,
      upper(coalesce(tipo,'')) as tipo_u,
      upper(coalesce(estado,'')) as estado_u,
      monto
    from public.historial_ops
    where created_at >= v_desde
      and created_at <= v_hasta
      and (v_pc is null or upper(coalesce(pc_codigo,'')) = v_pc)
      and (v_operador is null or coalesce(operador,'') = v_operador)
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'operador', operador,
      'total_ops', total_ops,
      'cargas_count', cargas_count,
      'cargas_monto', cargas_monto,
      'retiros_count', retiros_count,
      'retiros_monto', retiros_monto,
      'errores', errores,
      'neto', cargas_monto - retiros_monto
    )
    order by total_ops desc
  ), '[]'::jsonb)
  into v_por_operador
  from (
    select
      operador,
      count(*) as total_ops,
      count(*) filter (
        where tipo_u = 'CARGA'
          and estado_u in ('OK','PAGADA','COMPLETADO','ACREDITADA','APROBADA')
      ) as cargas_count,
      coalesce(sum(monto) filter (
        where tipo_u = 'CARGA'
          and estado_u in ('OK','PAGADA','COMPLETADO','ACREDITADA','APROBADA')
      ),0) as cargas_monto,
      count(*) filter (
        where tipo_u = 'RETIRO'
          and estado_u in ('OK','PAGADA','COMPLETADO','ACREDITADA','APROBADA')
      ) as retiros_count,
      coalesce(sum(monto) filter (
        where tipo_u = 'RETIRO'
          and estado_u in ('OK','PAGADA','COMPLETADO','ACREDITADA','APROBADA')
      ),0) as retiros_monto,
      count(*) filter (
        where estado_u in ('ERROR','FALLIDA','RECHAZADA','REVERTIDA','ANULADA')
      ) as errores
    from h
    group by operador
    order by total_ops desc
    limit 12
  ) x;


  /*
    Últimas operaciones.
  */
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'created_at', created_at,
      'pc_codigo', pc_codigo,
      'usuario', usuario,
      'tipo', tipo,
      'monto', monto,
      'origen', origen,
      'estado', estado,
      'operador', operador,
      'billetera_nombre', billetera_nombre,
      'chunior_movimiento_id', chunior_movimiento_id
    )
    order by created_at desc
  ), '[]'::jsonb)
  into v_ultimas
  from (
    select *
    from public.historial_ops
    where created_at >= v_desde
      and created_at <= v_hasta
      and (v_pc is null or upper(coalesce(pc_codigo,'')) = v_pc)
      and (v_operador is null or coalesce(operador,'') = v_operador)
    order by created_at desc
    limit 20
  ) u;


  /*
    Alertas operativas.
  */
  with alertas as (
    select
      'BILLETERA' as tipo,
      b.pc_codigo,
      'Oficina sin billetera marcada EN PORTAL' as mensaje,
      'ALTA' as severidad
    from (
      select pc_codigo
      from public.landing_rutas_publicas
      where activo = true
    ) r
    left join (
      select pc_codigo, count(*) as n
      from public.billeteras
      where activa = true
        and seleccionada_manual = true
      group by pc_codigo
    ) b2 on upper(b2.pc_codigo) = upper(r.pc_codigo)
    join public.landing_rutas_publicas b on upper(b.pc_codigo) = upper(r.pc_codigo)
    where coalesce(b2.n,0) = 0
      and (v_pc is null or upper(r.pc_codigo) = v_pc)

    union all

    select
      'SOLICITUDES' as tipo,
      s.pc_codigo,
      'Muchas solicitudes pendientes: ' || count(*)::text as mensaje,
      'MEDIA' as severidad
    from public.solicitudes s
    where upper(coalesce(s.estado,'')) in ('PENDIENTE','NUEVA','NUEVO','EN_REVISION','EN REVISIÓN')
      and (v_pc is null or upper(coalesce(s.pc_codigo,'')) = v_pc)
    group by s.pc_codigo
    having count(*) >= 5

    union all

    select
      'ERRORES' as tipo,
      h.pc_codigo,
      'Errores/reversiones hoy: ' || count(*)::text as mensaje,
      'MEDIA' as severidad
    from public.historial_ops h
    where h.created_at >= v_desde
      and h.created_at <= v_hasta
      and upper(coalesce(h.estado,'')) in ('ERROR','FALLIDA','RECHAZADA','REVERTIDA','ANULADA')
      and (v_pc is null or upper(coalesce(h.pc_codigo,'')) = v_pc)
    group by h.pc_codigo
    having count(*) >= 5

    union all

    select
      'CHAT' as tipo,
      c.pc_codigo,
      'Chats sin responder: ' || count(*)::text as mensaje,
      'MEDIA' as severidad
    from public.chat_sesiones c
    where upper(coalesce(c.estado,'')) = 'ABIERTO'
      and coalesce(c.sin_leer,0) > 0
      and (v_pc is null or upper(coalesce(c.pc_codigo,'')) = v_pc)
    group by c.pc_codigo
    having count(*) >= 1
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'tipo', tipo,
      'pc_codigo', pc_codigo,
      'mensaje', mensaje,
      'severidad', severidad
    )
  ), '[]'::jsonb)
  into v_alertas
  from alertas;


  return jsonb_build_object(
    'ok', true,
    'desde', v_desde,
    'hasta', v_hasta,
    'filtros', jsonb_build_object(
      'pc_codigo', v_pc,
      'turno', v_turno,
      'operador', v_operador
    ),
    'kpis', coalesce(v_kpis, '{}'::jsonb),
    'por_pc', coalesce(v_por_pc, '[]'::jsonb),
    'por_operador', coalesce(v_por_operador, '[]'::jsonb),
    'ultimas', coalesce(v_ultimas, '[]'::jsonb),
    'alertas', coalesce(v_alertas, '[]'::jsonb)
  );
end;
$function$
;

-- ══ admin_od_operacion_vivo(p_session_token text, p_pc_codigo text, p_limit integer)
CREATE OR REPLACE FUNCTION public.admin_od_operacion_vivo(p_session_token text, p_pc_codigo text DEFAULT NULL::text, p_limit integer DEFAULT 40)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ok boolean;
  v_pc text;
  v_limit integer;
  v_desde_hoy timestamptz;

  v_kpis jsonb;
  v_operaciones jsonb;
  v_errores jsonb;
  v_solicitudes jsonb;
  v_chats jsonb;
  v_sin_chunior jsonb;
  v_por_origen jsonb;
  v_billeteras jsonb;
begin
  v_ok := public.nodo_admin_session_ok(p_session_token);

  if not coalesce(v_ok,false) then
    return jsonb_build_object(
      'ok', false,
      'error', 'SESSION_INVALIDA'
    );
  end if;

  v_pc := nullif(upper(trim(coalesce(p_pc_codigo,''))), '');
  v_limit := least(greatest(coalesce(p_limit,40),10),100);

  v_desde_hoy :=
    date_trunc('day', now() at time zone 'America/Argentina/Buenos_Aires')
      at time zone 'America/Argentina/Buenos_Aires';


  /*
    KPIs en vivo:
    - operaciones últimas 15 min
    - errores hoy
    - solicitudes pendientes
    - chats abiertos/sin leer
    - operaciones OK sin movimiento Chunior
  */
  with h as (
    select *
    from public.historial_ops
    where created_at >= v_desde_hoy
      and (v_pc is null or upper(coalesce(pc_codigo,'')) = v_pc)
  ),
  sol as (
    select *
    from public.solicitudes
    where (v_pc is null or upper(coalesce(pc_codigo,'')) = v_pc)
  ),
  ch as (
    select *
    from public.chat_sesiones
    where (v_pc is null or upper(coalesce(pc_codigo,'')) = v_pc)
  )
  select jsonb_build_object(
    'ops_ultimos_15m',
      (select count(*) from h where created_at >= now() - interval '15 minutes'),

    'ops_ultimos_60m',
      (select count(*) from h where created_at >= now() - interval '60 minutes'),

    'cargas_ultimos_60m',
      (select count(*) from h
       where created_at >= now() - interval '60 minutes'
         and upper(coalesce(tipo,'')) = 'CARGA'
         and upper(coalesce(estado,'')) in ('OK','PAGADA','COMPLETADO','ACREDITADA','APROBADA')),

    'retiros_ultimos_60m',
      (select count(*) from h
       where created_at >= now() - interval '60 minutes'
         and upper(coalesce(tipo,'')) = 'RETIRO'
         and upper(coalesce(estado,'')) in ('OK','PAGADA','COMPLETADO','ACREDITADA','APROBADA')),

    'errores_hoy',
      (select count(*) from h
       where upper(coalesce(estado,'')) in ('ERROR','FALLIDA','RECHAZADA','REVERTIDA','ANULADA')),

    'pendientes_portal',
      (select count(*) from sol
       where upper(coalesce(estado,'')) in ('PENDIENTE','NUEVA','NUEVO','EN_REVISION','EN REVISIÓN')),

    'chats_abiertos',
      (select count(*) from ch
       where upper(coalesce(estado,'')) = 'ABIERTO'),

    'chats_sin_responder',
      (select count(*) from ch
       where upper(coalesce(estado,'')) = 'ABIERTO'
         and coalesce(sin_leer,0) > 0),

    'ok_sin_chunior',
      (select count(*) from h
       where upper(coalesce(tipo,'')) in ('CARGA','RETIRO')
         and upper(coalesce(estado,'')) in ('OK','PAGADA','COMPLETADO','ACREDITADA','APROBADA')
         and nullif(trim(coalesce(chunior_movimiento_id,'')),'') is null)
  )
  into v_kpis;


  /*
    Últimas operaciones reales.
  */
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'created_at', created_at,
      'pc_codigo', pc_codigo,
      'usuario', usuario,
      'tipo', tipo,
      'monto', monto,
      'origen', origen,
      'estado', estado,
      'operador', operador,
      'billetera_id', billetera_id,
      'billetera_nombre', billetera_nombre,
      'saldo_pre', saldo_pre,
      'saldo_post', saldo_post,
      'chunior_movimiento_id', chunior_movimiento_id,
      'notas', notas
    )
    order by created_at desc
  ), '[]'::jsonb)
  into v_operaciones
  from (
    select *
    from public.historial_ops
    where created_at >= v_desde_hoy
      and (v_pc is null or upper(coalesce(pc_codigo,'')) = v_pc)
    order by created_at desc
    limit v_limit
  ) x;


  /*
    Errores / reversas recientes.
  */
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'created_at', created_at,
      'pc_codigo', pc_codigo,
      'usuario', usuario,
      'tipo', tipo,
      'monto', monto,
      'origen', origen,
      'estado', estado,
      'operador', operador,
      'billetera_nombre', billetera_nombre,
      'notas', notas
    )
    order by created_at desc
  ), '[]'::jsonb)
  into v_errores
  from (
    select *
    from public.historial_ops
    where created_at >= v_desde_hoy
      and upper(coalesce(estado,'')) in ('ERROR','FALLIDA','RECHAZADA','REVERTIDA','ANULADA')
      and (v_pc is null or upper(coalesce(pc_codigo,'')) = v_pc)
    order by created_at desc
    limit 30
  ) e;


  /*
    Solicitudes pendientes del portal.
  */
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'created_at', created_at,
      'pc_codigo', pc_codigo,
      'usuario', usuario,
      'tipo', tipo,
      'monto', monto,
      'estado', estado
    )
    order by created_at desc
  ), '[]'::jsonb)
  into v_solicitudes
  from (
    select
      id,
      created_at,
      pc_codigo,
      usuario,
      tipo,
      monto,
      estado
    from public.solicitudes
    where upper(coalesce(estado,'')) in ('PENDIENTE','NUEVA','NUEVO','EN_REVISION','EN REVISIÓN')
      and (v_pc is null or upper(coalesce(pc_codigo,'')) = v_pc)
    order by created_at desc
    limit 50
  ) s;


  /*
    Chats abiertos.
  */
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'chat_id', chat_id,
      'usuario', usuario,
      'telefono', telefono,
      'pc_codigo', pc_codigo,
      'estado', estado,
      'sin_leer', sin_leer,
      'created_at', created_at,
      'ultimo_mensaje', ultimo_mensaje,
      'solicitud_id', solicitud_id
    )
    order by ultimo_mensaje desc
  ), '[]'::jsonb)
  into v_chats
  from (
    select *
    from public.chat_sesiones
    where upper(coalesce(estado,'')) = 'ABIERTO'
      and (v_pc is null or upper(coalesce(pc_codigo,'')) = v_pc)
    order by ultimo_mensaje desc nulls last
    limit 50
  ) c;


  /*
    Operaciones OK sin Chunior ID.
    Esto sirve como alerta de control. No significa automáticamente error,
    pero sí requiere revisar si debería haber sido anotado.
  */
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'created_at', created_at,
      'pc_codigo', pc_codigo,
      'usuario', usuario,
      'tipo', tipo,
      'monto', monto,
      'origen', origen,
      'estado', estado,
      'operador', operador,
      'billetera_nombre', billetera_nombre,
      'notas', notas
    )
    order by created_at desc
  ), '[]'::jsonb)
  into v_sin_chunior
  from (
    select *
    from public.historial_ops
    where created_at >= v_desde_hoy
      and upper(coalesce(tipo,'')) in ('CARGA','RETIRO')
      and upper(coalesce(estado,'')) in ('OK','PAGADA','COMPLETADO','ACREDITADA','APROBADA')
      and nullif(trim(coalesce(chunior_movimiento_id,'')),'') is null
      and (v_pc is null or upper(coalesce(pc_codigo,'')) = v_pc)
    order by created_at desc
    limit 50
  ) sc;


  /*
    Resumen por origen.
  */
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'origen', origen,
      'cantidad', cantidad,
      'monto', monto,
      'cargas', cargas,
      'retiros', retiros,
      'errores', errores
    )
    order by cantidad desc
  ), '[]'::jsonb)
  into v_por_origen
  from (
    select
      coalesce(nullif(upper(trim(origen)),''),'SIN_ORIGEN') as origen,
      count(*) as cantidad,
      coalesce(sum(monto),0) as monto,
      count(*) filter (where upper(coalesce(tipo,'')) = 'CARGA') as cargas,
      count(*) filter (where upper(coalesce(tipo,'')) = 'RETIRO') as retiros,
      count(*) filter (where upper(coalesce(estado,'')) in ('ERROR','FALLIDA','RECHAZADA','REVERTIDA','ANULADA')) as errores
    from public.historial_ops
    where created_at >= v_desde_hoy
      and (v_pc is null or upper(coalesce(pc_codigo,'')) = v_pc)
    group by coalesce(nullif(upper(trim(origen)),''),'SIN_ORIGEN')
  ) po;


  /*
    Billeteras por oficina.
  */
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'pc_codigo', pc_codigo,
      'oficina_id', oficina_id,
      'nombre_visible', nombre_visible,
      'titular', titular,
      'alias', alias,
      'cbu', cbu,
      'banco', banco,
      'estado', estado,
      'activa', activa,
      'seleccionada_manual', seleccionada_manual,
      'saldo', saldo,
      'chunior_uid', chunior_uid
    )
    order by pc_codigo, seleccionada_manual desc, orden asc, nombre_visible asc
  ), '[]'::jsonb)
  into v_billeteras
  from (
    select *
    from public.billeteras
    where activa = true
      and (v_pc is null or upper(coalesce(pc_codigo,'')) = v_pc)
    order by pc_codigo, seleccionada_manual desc, orden asc, nombre_visible asc
    limit 200
  ) b;


  return jsonb_build_object(
    'ok', true,
    'pc_codigo', v_pc,
    'desde_hoy', v_desde_hoy,
    'generated_at', now(),
    'kpis', coalesce(v_kpis, '{}'::jsonb),
    'operaciones', coalesce(v_operaciones, '[]'::jsonb),
    'errores', coalesce(v_errores, '[]'::jsonb),
    'solicitudes_pendientes', coalesce(v_solicitudes, '[]'::jsonb),
    'chats_abiertos', coalesce(v_chats, '[]'::jsonb),
    'sin_chunior', coalesce(v_sin_chunior, '[]'::jsonb),
    'por_origen', coalesce(v_por_origen, '[]'::jsonb),
    'billeteras', coalesce(v_billeteras, '[]'::jsonb)
  );
end;
$function$
;
