-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- CRM · PERFIL DEL JUGADOR Y VÍNCULOS
-- Copia de lectura de lo que corre en Supabase (proyecto NODO · pjvvyvfcwjoocjqvdror).
--
--   panel_crm_perfil_v1        el motor del CRM: score, segmento (VIP/NUEVO/ACTIVO/TIBIO/FRIO),
--                              billetera y operador habitual, turno frecuente, neto carga-retiro.
--                              Todo calculado en la base sobre historial_ops, no en el panel.
--   panel_crm_vinculos*        lectura de usuarios_portal_vinculos (lista, búsqueda, conteo).
--   panel_crm_flags            push / app instalada por usuario.
--   panel_crm_agente_resumen   totales por usuario desde las operaciones del agente.
--   reconexion_clase_duplicado clasifica un par de alias: TIPEO / INCOMPLETO / PARECIDO / DISTINTO.
--                              Es lo que decide qué se puede unificar en lote sin mirarlo.
--
-- OJO: las panel_crm_* son envoltorios finos que validan con _panel_crm_auth y delegan en
-- funciones _panel_crm_*_raw. Esos helpers internos NO están en este archivo.
--
-- Generado con pg_get_functiondef el 2026-08-30. Verificado por md5 contra la base.
-- ═══════════════════════════════════════════════════════════════════════════════════════════


-- ══ panel_crm_agente_resumen(p_pc_codigos text[], p_secret text)
CREATE OR REPLACE FUNCTION public.panel_crm_agente_resumen(p_pc_codigos text[], p_secret text DEFAULT NULL::text)
 RETURNS TABLE(usuario text, cargas bigint, monto_cargas numeric, retiros bigint, monto_retiros numeric, ultima_op timestamp with time zone, ultima_carga timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public._panel_crm_auth('panel_crm_agente_resumen', p_secret) then
    raise exception 'NO_AUTORIZADO';
  end if;
  return query select * from public._panel_crm_agente_resumen_raw(p_pc_codigos);
end
$function$
;

-- ══ panel_crm_flags(p_pc_codigos text[], p_secret text)
CREATE OR REPLACE FUNCTION public.panel_crm_flags(p_pc_codigos text[], p_secret text DEFAULT NULL::text)
 RETURNS TABLE(usuario text, push boolean, app boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public._panel_crm_auth('panel_crm_flags', p_secret) then
    raise exception 'NO_AUTORIZADO';
  end if;
  return query select * from public._panel_crm_flags_raw(p_pc_codigos);
end
$function$
;

-- ══ panel_crm_perfil_v1(p_secret text, p_pc_codigo text, p_query text, p_usuario text, p_limit integer)
CREATE OR REPLACE FUNCTION public.panel_crm_perfil_v1(p_secret text, p_pc_codigo text, p_query text DEFAULT NULL::text, p_usuario text DEFAULT NULL::text, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pc  text := upper(trim(coalesce(p_pc_codigo,'')));
  v_q   text := lower(btrim(coalesce(p_query,'')));
  v_u   text := lower(btrim(coalesce(p_usuario,'')));
  v_lim int  := least(greatest(coalesce(p_limit,50),1),200);
  v_qd  text; v_out jsonb;
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;
  if v_pc = '' then return jsonb_build_object('ok',false,'error','FALTA_PC'); end if;
  if v_u = '' and length(v_q) < 3 then
    return jsonb_build_object('ok',false,'error','BUSQUEDA_CORTA'); end if;
  v_qd := regexp_replace(v_q,'\D','','g');

  with universo as (
    select distinct lower(btrim(usuario)) u from public.usuarios_portal_vinculos
     where upper(coalesce(pc_codigo,'')) = v_pc and coalesce(estado_vinculo,'') <> 'DUPLICADO'
    union
    select distinct lower(btrim(usuario)) u from public.historial_ops
     where upper(coalesce(pc_codigo,'')) = v_pc and coalesce(usuario,'') <> ''
  ),
  por_datos as (
    select distinct lower(btrim(usuario)) u from public.usuarios_portal_vinculos
     where upper(coalesce(pc_codigo,'')) = v_pc
       and ( lower(coalesce(titular,'')) like '%'||v_q||'%'
          or (v_qd <> '' and coalesce(telefono_canon,'') like '%'||v_qd||'%') )
  ),
  cand as (
    select u from universo
    where (v_u <> '' and u = v_u)
       or (v_u =  '' and (u like '%'||v_q||'%' or u in (select u from por_datos)))
    limit v_lim
  ),
  ops as (
    select lower(btrim(h.usuario)) u,
           count(*) total_ops,
           count(*) filter (where upper(coalesce(h.tipo,''))='CARGA')  cargas,
           count(*) filter (where upper(coalesce(h.tipo,''))='RETIRO') retiros,
           coalesce(sum(abs(h.monto)) filter (where upper(coalesce(h.tipo,''))='CARGA'),0)  monto_cargas,
           coalesce(sum(abs(h.monto)) filter (where upper(coalesce(h.tipo,''))='RETIRO'),0) monto_retiros,
           count(*) filter (where upper(coalesce(h.estado,''))
                            not in ('OK','ACREDITADA','PAGADA','COMPLETADA','APROBADA')) errores,
           max(h.created_at) ultima,
           max(h.created_at) filter (where upper(coalesce(h.tipo,''))='CARGA') ultima_carga,
           min(h.created_at) primera,
           count(*) filter (where upper(coalesce(h.origen,''))='PROMO_BONO') bonos,
           mode() within group (order by h.billetera_nombre) billetera,
           mode() within group (order by h.operador) operador,
           mode() within group (order by
             case when extract(hour from (h.created_at at time zone 'America/Argentina/Buenos_Aires')) between 6 and 13 then 'TM'
                  when extract(hour from (h.created_at at time zone 'America/Argentina/Buenos_Aires')) between 14 and 21 then 'TT'
                  else 'TN' end) turno,
           (array_agg(substring(h.notas from 'Titular:\s*([^·]+)')
              order by h.created_at desc) filter (where h.notas ~ 'Titular:\s*[^·]+'))[1] titular_nota,
           (array_agg(substring(h.notas from 'Destino:\s*([0-9]{18,})')
              order by h.created_at desc)
              filter (where upper(coalesce(h.tipo,''))='RETIRO' and h.notas ~ 'Destino:\s*[0-9]{18,}'))[1] cbu_nota
    from public.historial_ops h
    where lower(btrim(h.usuario)) in (select u from cand)
    group by 1
  ),
  vinc as (
    select lower(btrim(v.usuario)) u,
           (array_agg(v.telefono_canon order by (upper(coalesce(v.pc_codigo,''))=v_pc) desc, v.id desc)
             filter (where coalesce(v.telefono_canon,'') <> ''))[1] tel,
           (array_agg(v.titular order by (upper(coalesce(v.pc_codigo,''))=v_pc) desc, v.id desc)
             filter (where coalesce(v.titular,'') <> ''))[1] titular,
           bool_or(coalesce(v.app_instalada,false)) app,
           (array_agg(v.estado_vinculo order by (upper(coalesce(v.pc_codigo,''))=v_pc) desc, v.id desc))[1] vinculo,
           max(v.created_at) alta
    from public.usuarios_portal_vinculos v
    where lower(btrim(v.usuario)) in (select u from cand)
    group by 1
  ),
  desol as (
    select c.u, d.tel, d.titular
    from cand c
    left join lateral (
      select nullif(regexp_replace(coalesce(s.metadata->>'telefono',''),'\D','','g'),'') tel,
             nullif(btrim(coalesce(s.metadata->>'titular','')),'') titular
      from public.landing_solicitudes s
      where lower(s.usuario) = c.u
        and (coalesce(s.metadata->>'telefono','') <> '' or coalesce(s.metadata->>'titular','') <> '')
      order by s.created_at desc limit 1
    ) d on true
  ),
  push as (
    select distinct lower(btrim(ps.usuario)) u from public.push_subscriptions ps
    where coalesce(ps.activa,true) and lower(btrim(ps.usuario)) in (select u from cand)
  ),
  base as (
    select c.u, coalesce(o.total_ops,0) total_ops, coalesce(o.cargas,0) cargas,
           coalesce(o.retiros,0) retiros, coalesce(o.monto_cargas,0) monto_cargas,
           coalesce(o.monto_retiros,0) monto_retiros, coalesce(o.errores,0) errores,
           coalesce(o.bonos,0) bonos, o.ultima, o.ultima_carga, o.primera,
           o.billetera, o.operador, o.turno,
           coalesce(nullif(v.tel,''), ds.tel)                               tel,
           coalesce(nullif(v.titular,''), ds.titular, btrim(o.titular_nota)) titular,
           o.cbu_nota                                                        cbu,
           coalesce(v.app,false) app,
           coalesce(v.vinculo,'SIN VINCULO') vinculo, v.alta, (p.u is not null) push,
           case when coalesce(o.ultima_carga,o.ultima) is null then 9999
                else floor(extract(epoch from (now()-coalesce(o.ultima_carga,o.ultima)))/86400)::int end dias
    from cand c
    left join ops o on o.u = c.u
    left join vinc v on v.u = c.u
    left join desol ds on ds.u = c.u
    left join push p on p.u = c.u
  ),
  calc as (
    select b.*, (b.monto_cargas - b.monto_retiros) neto,
           greatest(0, round(
               least(b.cargas*8, 40) + least(b.monto_cargas/10000.0, 35)
             + (case when b.dias <= 3 then 15 when b.dias <= 7 then 10
                     when b.dias <= 30 then 4 else 0 end)
             + (case when (b.monto_cargas - b.monto_retiros) > 0 then 8 else 0 end)
             - least(b.errores*3, 10)))::int score
    from base b
  )
  select jsonb_agg(jsonb_build_object(
      'usuario', c.u, 'telefono', c.tel, 'titular', c.titular, 'cbu', c.cbu,
      'push', c.push, 'app', coalesce(c.app,false), 'vinculo', c.vinculo, 'alta', c.alta,
      'totalOps', c.total_ops, 'cargas', c.cargas, 'retiros', c.retiros,
      'montoCargas', c.monto_cargas, 'montoRetiros', c.monto_retiros, 'neto', c.neto,
      'errores', c.errores, 'bonos', c.bonos,
      'primeraOperacion', c.primera, 'ultimaOperacion', c.ultima, 'ultimaCarga', c.ultima_carga,
      'diasUltCarga', c.dias, 'score', c.score,
      'billeteraHabitual', coalesce(c.billetera,'-'),
      'operadorHabitual', coalesce(c.operador,'-'),
      'turnoFrecuente', coalesce(c.turno,'-'),
      'segmento', case
         when c.cargas >= 8 or c.monto_cargas >= 100000 or c.score >= 70 then 'VIP'
         when c.cargas <= 1 then 'NUEVO'
         when c.dias <= 7  then 'ACTIVO'
         when c.dias <= 30 then 'TIBIO'
         else 'FRIO' end
    ) order by c.score desc, c.ultima desc nulls last) into v_out
  from calc c;

  return jsonb_build_object('ok',true,'pc_codigo',v_pc,
                            'total',coalesce(jsonb_array_length(v_out),0),
                            'jugadores',coalesce(v_out,'[]'::jsonb));
end;
$function$
;

-- ══ panel_crm_vinculos(p_pc_codigos text[], p_secret text)
CREATE OR REPLACE FUNCTION public.panel_crm_vinculos(p_pc_codigos text[], p_secret text DEFAULT NULL::text)
 RETURNS TABLE(usuario text, telefono_canon text, titular text, estado_vinculo text, fuente text, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public._panel_crm_auth('panel_crm_vinculos', p_secret) then
    raise exception 'NO_AUTORIZADO';
  end if;
  return query select * from public._panel_crm_vinculos_raw(p_pc_codigos);
end
$function$
;

-- ══ panel_crm_vinculos_buscar(p_pc_codigos text[], p_query text, p_limit integer, p_secret text)
CREATE OR REPLACE FUNCTION public.panel_crm_vinculos_buscar(p_pc_codigos text[], p_query text, p_limit integer DEFAULT 50, p_secret text DEFAULT NULL::text)
 RETURNS TABLE(usuario text, telefono_canon text, titular text, estado_vinculo text, fuente text, updated_at timestamp with time zone, pc_codigo text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public._panel_crm_auth('panel_crm_vinculos_buscar', p_secret) then
    raise exception 'NO_AUTORIZADO';
  end if;
  return query select * from public._panel_crm_vinculos_buscar_raw(p_pc_codigos, p_query, least(coalesce(p_limit,50), 200));
end
$function$
;

-- ══ panel_crm_vinculos_count(p_pc_codigos text[], p_secret text)
CREATE OR REPLACE FUNCTION public.panel_crm_vinculos_count(p_pc_codigos text[], p_secret text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public._panel_crm_auth('panel_crm_vinculos_count', p_secret) then
    raise exception 'NO_AUTORIZADO';
  end if;
  return public._panel_crm_vinculos_count_raw(p_pc_codigos);
end
$function$
;

-- ══ reconexion_clase_duplicado(p_malo text, p_bueno text)
CREATE OR REPLACE FUNCTION public.reconexion_clase_duplicado(p_malo text, p_bueno text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when p_malo is null or p_bueno is null then null
    when levenshtein(p_malo, p_bueno) <= 2 then 'TIPEO'
    -- prefijo: pide 3 letras mínimo, con 1 o 2 engancharía cualquier cosa
    when least(length(p_malo), length(p_bueno)) >= 3
     and (p_bueno like p_malo || '%' or p_malo like p_bueno || '%') then 'INCOMPLETO'
    when length(p_malo) >= 4 and length(p_bueno) >= 4
     and left(p_malo,4) = left(p_bueno,4) then 'PARECIDO'
    else 'DISTINTO'
  end;
$function$
;
