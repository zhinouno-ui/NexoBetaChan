-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- CRM · RECONEXIÓN · PREVALIDACIÓN
-- Copia de lectura de lo que corre en Supabase (proyecto NODO · pjvvyvfcwjoocjqvdror).
-- La fuente de verdad son las migraciones; esto está acá para poder leerlo sin entrar a la base.
--
--   panel_reconexion_cola          arma la cola de gente que pidió y nunca operó, por turno,
--                                  detectando duplicados por teléfono + distancia de Levenshtein.
--   panel_reconexion_marcar        marca el intento. Dos NO_CONTESTA y se cierra.
--   panel_reconexion_unificar      un alias mal escrito pasa a DUPLICADO del bueno.
--   panel_reconexion_limpiar_seguros  hace eso en lote, solo con los clasificados TIPEO/INCOMPLETO.
--   panel_dormidos                 clasifica NUNCA / DORMIDO / ENFRIANDO / ACTIVO por última op.
--   panel_prevalidar_usuario       antes de crear un usuario: ¿ese teléfono ya tiene cuenta acá,
--                                  ya cobró bonos, comparte CBU con otras? Devuelve un veredicto.
--   panel_usuarios_contacto        datos de contacto de una lista de usuarios, en una sola consulta.
--   panel_rescate_cola             la cola de rescate: cruza las 160 mil operaciones importadas de
--                                  Agentes contra NODO y ordena por lo que depositó cada uno.
--                                  Dos segmentos: RESCATE (>60 días sin cargar) e INTENTO
--                                  (pidió cargar y nunca completó una).
--   panel_rescate_tomar            reserva un contacto a nombre de un operador por 30 minutos,
--                                  para que dos de la misma oficina no le escriban al mismo.
--   rescate_refrescar              rearma rescate_candidatos. Lo dispara pg_cron cada 30 min.
--
-- Todas piden p_secret y validan con _panel_data_auth: el panel manda PANEL_DATA_SECRET.
-- La excepción es rescate_refrescar, que no la llama el panel sino el cron.
--
-- Generado con pg_get_functiondef el 2026-08-30 (las tres de rescate, el 2026-09-05).
-- Verificado por md5 contra la base.
-- ═══════════════════════════════════════════════════════════════════════════════════════════


-- ══ panel_dormidos(p_secret text, p_pc_codigo text, p_estado text, p_limit integer)
CREATE OR REPLACE FUNCTION public.panel_dormidos(p_secret text, p_pc_codigo text, p_estado text DEFAULT NULL::text, p_limit integer DEFAULT 300)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pc text := upper(trim(coalesce(p_pc_codigo,'')));
  v_est text := upper(trim(coalesce(p_estado,'')));
  v_lim int := least(greatest(coalesce(p_limit,300),1),400);
  v_res jsonb;
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;
  if v_pc = '' then return jsonb_build_object('ok',false,'error','FALTA_PC'); end if;
  if v_est = '' then v_est := 'DORMIDO'; end if;

  with v as (
    select lower(btrim(usuario)) u,
           max(telefono_canon) filter (where coalesce(telefono_canon,'') <> '') tel,
           max(titular) filter (where coalesce(titular,'') <> '') titular,
           bool_or(coalesce(app_instalada,false)) app,
           max(created_at) alta
    from public.usuarios_portal_vinculos
    where upper(coalesce(pc_codigo,'')) = v_pc
      and coalesce(estado_vinculo,'') <> 'DUPLICADO'
    group by 1
  ),
  o as (
    select lower(btrim(h.usuario)) u, count(*) n, max(h.created_at) ult,
           count(*) filter (where upper(coalesce(h.tipo,''))='CARGA') cargas,
           coalesce(sum(h.monto) filter (where upper(coalesce(h.tipo,''))='CARGA'),0) monto
    from public.historial_ops h
    where lower(btrim(h.usuario)) in (select u from v) group by 1
  ),
  push as (
    select distinct lower(btrim(ps.usuario)) u from public.push_subscriptions ps
    where coalesce(ps.activa,true) and lower(btrim(ps.usuario)) in (select u from v)
  ),
  marcados as (
    select lower(btrim(usuario)) u, estado from public.reconexion_contactos
    where upper(pc_codigo) = v_pc
  ),
  clasif as (
    select v.u, v.tel, v.titular, v.app, v.alta,
           coalesce(o.n,0) ops, coalesce(o.cargas,0) cargas, coalesce(o.monto,0) monto, o.ult,
           case when o.ult is null then null
                else floor(extract(epoch from (now()-o.ult))/86400)::int end dias,
           case when o.u is null                        then 'NUNCA'
                when o.ult < now() - interval '30 days' then 'DORMIDO'
                when o.ult < now() - interval '15 days' then 'ENFRIANDO'
                else 'ACTIVO' end estado,
           (p.u is not null) push, m.estado marca
    from v left join o on o.u = v.u
           left join push p on p.u = v.u
           left join marcados m on m.u = v.u
  ),
  filtrado as (select * from clasif where estado = v_est and marca is null)
  select jsonb_build_object(
    'ok', true, 'pc_codigo', v_pc, 'estado', v_est,
    'resumen', (select jsonb_build_object(
        'nunca',     count(*) filter (where estado='NUNCA' and marca is null),
        'dormido',   count(*) filter (where estado='DORMIDO' and marca is null),
        'enfriando', count(*) filter (where estado='ENFRIANDO' and marca is null),
        'activo',    count(*) filter (where estado='ACTIVO'),
        'ya_trabajados', count(*) filter (where marca is not null)) from clasif),
    'total', (select count(*) from filtrado),
    'lista', coalesce((select jsonb_agg(jsonb_build_object(
        'usuario',f.u,'telefono',f.tel,'titular',f.titular,'push',f.push,'app',f.app,
        'ops',f.ops,'cargas',f.cargas,'monto_cargas',f.monto,
        'ultima_op',f.ult,'dias',f.dias,'estado',f.estado,'alta',f.alta)
        order by f.monto desc, f.alta desc)
      from (select * from filtrado order by monto desc, alta desc limit v_lim) f),'[]'::jsonb)
  ) into v_res;
  return v_res;
end;
$function$
;

-- ══ panel_prevalidar_usuario(p_secret text, p_pc_codigo text, p_telefono text, p_usuario text)
CREATE OR REPLACE FUNCTION public.panel_prevalidar_usuario(p_secret text, p_pc_codigo text, p_telefono text DEFAULT NULL::text, p_usuario text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pc  text := upper(trim(coalesce(p_pc_codigo,'')));
  v_tel text := nullif(regexp_replace(coalesce(p_telefono,''), '\D', '', 'g'), '');
  v_usr text := lower(trim(coalesce(p_usuario,'')));
  v_tel8 text;
  v_res jsonb; v_motivos jsonb := '[]'::jsonb; v_ver text := 'LIBRE';
  v_aqui int := 0; v_otras int := 0; v_existe boolean := false; v_bonos int := 0; v_cbu int := 0;
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;
  if v_tel is null and v_usr = '' then
    return jsonb_build_object('ok',false,'error','FALTA_TELEFONO_O_USUARIO');
  end if;
  v_tel8 := case when v_tel is not null and length(v_tel) >= 8 then right(v_tel,8) end;

  with vin as (   -- todas las cuentas atadas a ese telefono (por los ultimos 8 digitos)
    select upper(coalesce(v.pc_codigo,'-')) pc, lower(trim(v.usuario)) usuario,
           v.estado_vinculo, v.created_at, v.titular, coalesce(v.app_instalada,false) app
    from public.usuarios_portal_vinculos v
    where v_tel8 is not null
      and right(regexp_replace(coalesce(nullif(v.telefono_canon,''),v.telefono_raw,''),'\D','','g'),8) = v_tel8
      and coalesce(v.usuario,'') <> ''
  ),
  actividad as (  -- que hizo cada una de esas cuentas
    select lower(trim(h.usuario)) usuario,
           count(*) filter (where upper(h.tipo)='CARGA' and coalesce(h.origen,'')<>'PROMO_BONO') cargas,
           count(*) filter (where upper(h.tipo)='RETIRO') retiros,
           count(*) filter (where h.origen='PROMO_BONO')  bonos,
           max(h.created_at) ultima
    from public.historial_ops h
    where upper(coalesce(h.estado,''))='OK'
      and lower(trim(h.usuario)) in (select usuario from vin)
    group by 1
  ),
  cbus as (       -- CBUs que usaron esas cuentas y con cuantas OTRAS cuentas los comparten
    select c.cbu, max(c.titular) titular, count(distinct c.usuario) cuentas,
           string_agg(distinct c.usuario, ' · ' order by c.usuario) usuarios
    from (
      select lower(regexp_replace(coalesce(nullif(s.metadata->>'cbu',''), s.metadata->>'destino',''),'[\s.\-]','','g')) cbu,
             lower(trim(s.usuario)) usuario, max(s.metadata->>'titular') titular
      from public.landing_solicitudes s
      where upper(coalesce(s.tipo,''))='RETIRO'
        and lower(regexp_replace(coalesce(nullif(s.metadata->>'cbu',''), s.metadata->>'destino',''),'[\s.\-]','','g')) in (
              select lower(regexp_replace(coalesce(nullif(s2.metadata->>'cbu',''), s2.metadata->>'destino',''),'[\s.\-]','','g'))
              from public.landing_solicitudes s2
              where lower(trim(s2.usuario)) in (select usuario from vin)
                and upper(coalesce(s2.tipo,''))='RETIRO'
                and length(lower(regexp_replace(coalesce(nullif(s2.metadata->>'cbu',''), s2.metadata->>'destino',''),'[\s.\-]','','g'))) >= 6)
      group by 1,2
    ) c
    group by c.cbu having count(distinct c.usuario) > 1
  )
  select jsonb_build_object(
    'cuentas', coalesce((select jsonb_agg(jsonb_build_object(
        'pc',v.pc,'usuario',v.usuario,'estado',v.estado_vinculo,'titular',v.titular,
        'app',v.app,'desde',v.created_at,
        'cargas',coalesce(a.cargas,0),'retiros',coalesce(a.retiros,0),
        'bonos',coalesce(a.bonos,0),'ultima',a.ultima,
        'misma_oficina',(v.pc = v_pc)
      ) order by (v.pc = v_pc) desc, a.ultima desc nulls last)
      from vin v left join actividad a on a.usuario = v.usuario),'[]'::jsonb),
    'cbus', coalesce((select jsonb_agg(jsonb_build_object(
        'cbu',c.cbu,'titular',c.titular,'cuentas',c.cuentas,'usuarios',c.usuarios)) from cbus c),'[]'::jsonb),
    'aqui',  (select count(*) from vin where pc = v_pc),
    'otras', (select count(*) from vin where pc <> v_pc),
    'bonos', (select coalesce(sum(a.bonos),0) from vin v join actividad a on a.usuario=v.usuario),
    'cbu_max', (select coalesce(max(c.cuentas),0) from cbus c)
  ) into v_res;

  v_aqui  := (v_res->>'aqui')::int;
  v_otras := (v_res->>'otras')::int;
  v_bonos := (v_res->>'bonos')::int;
  v_cbu   := (v_res->>'cbu_max')::int;

  -- ¿el alias que quiere existe ya?
  if v_usr <> '' then
    select exists(select 1 from public.usuarios_portal_vinculos where lower(trim(usuario)) = v_usr)
        or exists(select 1 from public.historial_ops where lower(trim(usuario)) = v_usr)
      into v_existe;
  end if;

  if v_existe then
    v_ver := 'YA_EXISTE';
    v_motivos := v_motivos || jsonb_build_array(jsonb_build_object('nivel','ALTO',
      'texto','El usuario "'||v_usr||'" ya existe. No lo crees de nuevo: buscalo y validalo.'));
  end if;
  if v_aqui > 0 then
    v_ver := 'YA_EXISTE';
    v_motivos := v_motivos || jsonb_build_array(jsonb_build_object('nivel','ALTO',
      'texto','Ese telefono ya tiene '||v_aqui||' usuario(s) en esta oficina. Validá el que tiene en vez de crear otro.'));
  end if;
  if v_bonos > 0 then
    if v_ver = 'LIBRE' then v_ver := 'REVISAR'; end if;
    v_motivos := v_motivos || jsonb_build_array(jsonb_build_object('nivel','ALTO',
      'texto','Ese telefono ya cobro '||v_bonos||' bono(s) de primer ingreso. Un usuario nuevo volveria a cobrarlo.'));
  end if;
  if v_cbu >= 3 then
    if v_ver = 'LIBRE' then v_ver := 'REVISAR'; end if;
    v_motivos := v_motivos || jsonb_build_array(jsonb_build_object('nivel','ALTO',
      'texto','Su CBU aparece en '||v_cbu||' cuentas distintas. Con 3 o mas no se explica por familia.'));
  elsif v_cbu = 2 then
    if v_ver = 'LIBRE' then v_ver := 'REVISAR'; end if;
    v_motivos := v_motivos || jsonb_build_array(jsonb_build_object('nivel','MEDIO',
      'texto','Su CBU lo comparte con otra cuenta. Puede ser familia — mirá antes de decidir.'));
  end if;
  if v_otras > 0 then
    v_motivos := v_motivos || jsonb_build_array(jsonb_build_object('nivel','INFO',
      'texto','Tiene '||v_otras||' usuario(s) en otras oficinas. Es normal: se juega en varias.'));
  end if;
  if v_ver = 'LIBRE' then
    v_motivos := jsonb_build_array(jsonb_build_object('nivel','OK',
      'texto','Sin antecedentes. Se puede crear.'));
  end if;

  return v_res || jsonb_build_object('ok',true,'pc_codigo',v_pc,'telefono',v_tel,
    'usuario_pedido',nullif(v_usr,''),'usuario_existe',v_existe,
    'veredicto',v_ver,'motivos',v_motivos);
end;
$function$
;

-- ══ panel_reconexion_cola(p_secret text, p_pc_codigo text, p_turno text, p_limit integer)
CREATE OR REPLACE FUNCTION public.panel_reconexion_cola(p_secret text, p_pc_codigo text, p_turno text DEFAULT NULL::text, p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pc text := upper(trim(coalesce(p_pc_codigo,'')));
  v_t  text := upper(trim(coalesce(p_turno,'')));
  v_lim int := least(greatest(coalesce(p_limit,200),1),500);
  v_res jsonb;
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;
  if v_pc = '' then return jsonb_build_object('ok',false,'error','FALTA_PC'); end if;

  with base as materialized (
    select lower(trim(s.usuario)) u, s.id sid, s.created_at ts,
           upper(coalesce(s.tipo,'')) tipo, upper(coalesce(s.estado,'')) estado,
           nullif(s.metadata->>'telefono','') tel,
           nullif(s.metadata->>'chat_operador','') chat_op
    from public.landing_solicitudes s
    where upper(coalesce(s.pc_codigo,'')) = v_pc and coalesce(s.usuario,'') <> ''
      and s.created_at >= now() - interval '90 days'
  ),
  hechas as materialized (
    select distinct b.sid from base b
    where exists (select 1 from public.historial_ops h where h.solicitud_id = b.sid)
  ),
  push as materialized (
    select distinct lower(trim(usuario)) u from public.push_subscriptions where coalesce(activa,true)
  ),
  u as (
    select b.u, count(*) sols, bool_or(x.sid is not null) ok, max(b.ts) ult, max(b.tel) tel,
           (array_agg(b.tipo order by b.ts))[1] t1,
           (array_agg(b.estado order by b.ts desc))[1] est,
           (array_agg(b.chat_op order by b.ts desc))[1] aten
    from base b left join hechas x on x.sid = b.sid group by b.u
  ),
  perdidos as (
    select u.*, (p.u is not null) tiene_push,
           extract(hour from (u.ult at time zone 'America/Argentina/Buenos_Aires'))::int h,
           regexp_replace(coalesce(u.tel,''),'\D','','g') telcanon
    from u left join push p on p.u = u.u
    where not u.ok
      and not exists (select 1 from public.historial_ops h where lower(btrim(h.usuario)) = u.u)
  ),
  condup as (
    select pe.*,
      (select lower(btrim(v.usuario)) from public.usuarios_portal_vinculos v
        where v.telefono_canon = pe.telcanon and lower(btrim(v.usuario)) <> pe.u
          and exists (select 1 from public.historial_ops h
                      where lower(btrim(h.usuario)) = lower(btrim(v.usuario)))
        order by levenshtein(lower(btrim(v.usuario)), pe.u) asc, length(v.usuario) desc
        limit 1) dup
      from perdidos pe where pe.telcanon <> ''
    union all
    select pe.*, null::text dup from perdidos pe where pe.telcanon = ''
  ),
  conturno as (
    select c.*, case when c.h >= 6 and c.h < 14 then 'TM'
                     when c.h >= 14 and c.h < 22 then 'TT' else 'TN' end turno,
           case when c.dup is not null then levenshtein(c.u, c.dup) end dist,
           public.reconexion_clase_duplicado(c.u, c.dup) clase
    from condup c
  ),
  marcado as (
    select lower(trim(r.usuario)) u, r.estado, r.intentos, r.nota,
           r.operador, r.ultimo_intento_at, r.reabrir_at
    from public.reconexion_contactos r where upper(r.pc_codigo) = v_pc
  ),
  cola as (
    select c.*, m.estado m_estado, coalesce(m.intentos,0) intentos,
           m.operador m_operador, m.ultimo_intento_at, m.reabrir_at, m.nota
    from conturno c left join marcado m on m.u = c.u
    where (v_t = '' or c.turno = v_t)
      and (m.u is null
           or (m.estado = 'NO_CONTESTA' and m.reabrir_at is not null and m.reabrir_at <= now()))
  )
  select jsonb_build_object(
    'ok', true, 'pc_codigo', v_pc, 'turno', nullif(v_t,''),
    'resumen', (select jsonb_build_object(
        'en_cola', count(*),
        'con_push', count(*) filter (where tiene_push),
        'con_telefono', count(*) filter (where coalesce(tel,'') <> ''),
        'reintentos', count(*) filter (where intentos > 0),
        'duplicados', count(*) filter (where dup is not null),
        -- los que se pueden limpiar sin que nadie los mire uno por uno
        'seguros', count(*) filter (where clase in ('TIPEO','INCOMPLETO')),
        'a_revisar', count(*) filter (where clase in ('PARECIDO','DISTINTO')),
        'vinculo_sin_validar', count(*) filter (where exists (
            select 1 from public.usuarios_portal_vinculos v
            where upper(v.pc_codigo)=v_pc and lower(btrim(v.usuario))=cola.u
              and v.estado_vinculo='PENDIENTE'))) from cola),
    'por_turno', coalesce((select jsonb_agg(jsonb_build_object('turno',t,'en_cola',n) order by t)
        from (select c.turno t, count(*) n from conturno c left join marcado m on m.u = c.u
              where m.u is null or (m.estado='NO_CONTESTA' and m.reabrir_at <= now())
              group by c.turno) q),'[]'::jsonb),
    'trabajado_hoy', (select coalesce(jsonb_agg(jsonb_build_object('estado',x.estado,'n',x.n)),'[]'::jsonb)
        from (select r.estado, count(*) n from public.reconexion_contactos r
              where upper(r.pc_codigo)=v_pc and r.ultimo_intento_at >= date_trunc('day', now() at time zone 'America/Argentina/Buenos_Aires')
              group by r.estado) x),
    'recuperados', (select count(*) from public.reconexion_contactos r
        where upper(r.pc_codigo)=v_pc
          and exists (select 1 from public.historial_ops h
                      where lower(trim(h.usuario)) = r.usuario and h.created_at > r.ultimo_intento_at)),
    'cola', coalesce((select jsonb_agg(jsonb_build_object(
        'usuario',c.u,'telefono',c.tel,'turno',c.turno,'hora',c.h,
        'tipo',c.t1,'estado_sol',c.est,'atendio',c.aten,
        'push',c.tiene_push,'canal',case when c.tiene_push then 'PUSH' else 'WHATSAPP' end,
        'solicitudes',c.sols,
        'dias', floor(extract(epoch from (now()-c.ult))/86400)::int,
        'intentos',c.intentos,'ultimo_intento',c.ultimo_intento_at,
        'marco',c.m_operador,'nota',c.nota,
        'duplicado_de',c.dup,'distancia',c.dist,'clase',c.clase,
        -- Estado del vinculo: PENDIENTE = escribio un usuario que nadie cotejo todavia.
        -- Es la gente que quedo a mitad de camino y hay que resolver contra el CRM.
        'vinculo_estado', (select v.estado_vinculo from public.usuarios_portal_vinculos v
                            where upper(v.pc_codigo)=v_pc and lower(btrim(v.usuario))=c.u limit 1)
      ) order by (c.dup is not null) desc, c.intentos asc, c.ult desc)
      from (select * from cola limit v_lim) c),'[]'::jsonb)
  ) into v_res;
  return v_res;
end;
$function$
;

-- ══ panel_reconexion_limpiar_seguros(p_secret text, p_pc_codigo text, p_operador text, p_simular boolean)
CREATE OR REPLACE FUNCTION public.panel_reconexion_limpiar_seguros(p_secret text, p_pc_codigo text, p_operador text DEFAULT NULL::text, p_simular boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pc text := upper(trim(coalesce(p_pc_codigo,'')));
  v_quien text := coalesce(nullif(trim(coalesce(p_operador,'')),''),'panel');
  v_n int := 0; v_lista jsonb;
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;
  if v_pc = '' then return jsonb_build_object('ok',false,'error','FALTA_PC'); end if;

  create temporary table if not exists _limpieza (malo text, bueno text, clase text) on commit drop;
  delete from _limpieza;

  insert into _limpieza(malo, bueno, clase)
  select o->>'usuario', o->>'duplicado_de', o->>'clase'
  from jsonb_array_elements(
         public.panel_reconexion_cola(p_secret, v_pc, null, 500) -> 'cola') o
  where o->>'duplicado_de' is not null
    and (o->>'clase') in ('TIPEO','INCOMPLETO');

  select count(*), coalesce(jsonb_agg(jsonb_build_object('de',malo,'a',bueno,'clase',clase)),'[]'::jsonb)
    into v_n, v_lista from _limpieza;

  if p_simular then
    return jsonb_build_object('ok',true,'simulado',true,'cantidad',v_n,'pares',v_lista);
  end if;

  update public.usuarios_portal_vinculos v
     set estado_vinculo='DUPLICADO', duplicado_de=l.bueno,
         verificado_por=v_quien, updated_at=now()
    from _limpieza l
   where upper(coalesce(v.pc_codigo,''))=v_pc and lower(btrim(v.usuario))=l.malo;

  insert into public.reconexion_contactos
    (pc_codigo, usuario, estado, canal, nota, operador, intentos, ultimo_intento_at, reabrir_at)
  select v_pc, l.malo, 'DESCARTADO', null, 'UNIFICADO CON '||l.bueno||' ('||l.clase||', en lote)',
         v_quien, 0, now(), null
  from _limpieza l
  on conflict (pc_codigo, usuario) do update
    set estado='DESCARTADO', nota=excluded.nota, operador=excluded.operador,
        ultimo_intento_at=now(), reabrir_at=null, updated_at=now();

  return jsonb_build_object('ok',true,'cantidad',v_n,'pares',v_lista);
end;
$function$
;

-- ══ panel_reconexion_marcar(p_secret text, p_pc_codigo text, p_usuario text, p_estado text, p_canal text, p_nota text, p_operador text)
CREATE OR REPLACE FUNCTION public.panel_reconexion_marcar(p_secret text, p_pc_codigo text, p_usuario text, p_estado text DEFAULT 'CONTACTADO'::text, p_canal text DEFAULT NULL::text, p_nota text DEFAULT NULL::text, p_operador text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pc text := upper(trim(coalesce(p_pc_codigo,'')));
  v_est text := upper(trim(coalesce(p_estado,'CONTACTADO')));
  v_quien text := coalesce(nullif(trim(coalesce(p_operador,'')),''),'panel');
  v_prev record; v_int int; v_reabrir timestamptz; v_cerrado boolean := false;
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;
  if v_pc = '' then return jsonb_build_object('ok',false,'error','FALTA_PC'); end if;
  if coalesce(trim(p_usuario),'') = '' then return jsonb_build_object('ok',false,'error','FALTA_USUARIO'); end if;
  if v_est not in ('CONTACTADO','NO_CONTESTA','DESCARTADO','RECUPERADO') then
    return jsonb_build_object('ok',false,'error','ESTADO_INVALIDO'); end if;

  select * into v_prev from public.reconexion_contactos
   where pc_codigo = v_pc and usuario = lower(trim(p_usuario));
  v_int := coalesce(v_prev.intentos,0) + 1;

  if v_est = 'NO_CONTESTA' then
    if v_int >= 2 then v_reabrir := null; v_cerrado := true;
    else v_reabrir := now() + interval '3 days'; end if;
  else v_reabrir := null; end if;

  insert into public.reconexion_contactos
    (pc_codigo, usuario, estado, canal, nota, operador, intentos, ultimo_intento_at, reabrir_at)
  values (v_pc, lower(trim(p_usuario)), v_est,
          nullif(upper(trim(coalesce(p_canal,''))),''), nullif(trim(coalesce(p_nota,'')),''),
          v_quien, v_int, now(), v_reabrir)
  on conflict (pc_codigo, usuario) do update
    set estado=excluded.estado,
        canal=coalesce(excluded.canal, public.reconexion_contactos.canal),
        nota=coalesce(excluded.nota, public.reconexion_contactos.nota),
        operador=excluded.operador, intentos=excluded.intentos,
        ultimo_intento_at=excluded.ultimo_intento_at, reabrir_at=excluded.reabrir_at,
        updated_at=now();

  return jsonb_build_object('ok',true,'usuario',lower(trim(p_usuario)),'estado',v_est,
    'intentos',v_int,'reabre',v_reabrir,'cerrado',v_cerrado);
end;
$function$
;

-- ══ panel_reconexion_unificar(p_secret text, p_pc_codigo text, p_usuario text, p_canonico text, p_operador text)
CREATE OR REPLACE FUNCTION public.panel_reconexion_unificar(p_secret text, p_pc_codigo text, p_usuario text, p_canonico text, p_operador text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pc text := upper(trim(coalesce(p_pc_codigo,'')));
  v_malo text := lower(btrim(coalesce(p_usuario,'')));
  v_bueno text := lower(btrim(coalesce(p_canonico,'')));
  v_quien text := coalesce(nullif(trim(coalesce(p_operador,'')),''),'panel');
  v_vinc int := 0;
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;
  if v_pc = '' or v_malo = '' or v_bueno = '' then
    return jsonb_build_object('ok',false,'error','FALTAN_DATOS'); end if;
  if v_malo = v_bueno then
    return jsonb_build_object('ok',false,'error','SON_EL_MISMO'); end if;

  -- El bueno tiene que existir y haber operado: si no, esto no es una unificación.
  if not exists (select 1 from public.historial_ops h where lower(btrim(h.usuario)) = v_bueno) then
    return jsonb_build_object('ok',false,'error','EL_CANONICO_NO_TIENE_OPERACIONES');
  end if;

  update public.usuarios_portal_vinculos
     set estado_vinculo = 'DUPLICADO',
         duplicado_de   = v_bueno,
         verificado_por = v_quien,
         updated_at     = now()
   where upper(coalesce(pc_codigo,'')) = v_pc
     and lower(btrim(usuario)) = v_malo;
  get diagnostics v_vinc = row_count;

  insert into public.reconexion_contactos
    (pc_codigo, usuario, estado, canal, nota, operador, intentos, ultimo_intento_at, reabrir_at)
  values (v_pc, v_malo, 'DESCARTADO', null, 'UNIFICADO CON '||v_bueno, v_quien, 0, now(), null)
  on conflict (pc_codigo, usuario) do update
    set estado='DESCARTADO', nota='UNIFICADO CON '||v_bueno, operador=v_quien,
        ultimo_intento_at=now(), reabrir_at=null, updated_at=now();

  return jsonb_build_object('ok',true,'usuario',v_malo,'canonico',v_bueno,'vinculos_marcados',v_vinc);
end;
$function$
;

-- ══ panel_rescate_cola(p_secret text, p_pc_codigo text, p_segmento text, p_dias integer, p_operador text, p_limit integer)
CREATE OR REPLACE FUNCTION public.panel_rescate_cola(p_secret text, p_pc_codigo text, p_segmento text DEFAULT 'RESCATE'::text, p_dias integer DEFAULT 60, p_operador text DEFAULT NULL::text, p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pc  text := upper(btrim(coalesce(p_pc_codigo,'')));
  v_seg text := upper(btrim(coalesce(p_segmento,'RESCATE')));
  v_d   int  := greatest(coalesce(p_dias,60), 7);
  v_lim int  := least(greatest(coalesce(p_limit,200),1),500);
  v_op  text := coalesce(nullif(btrim(coalesce(p_operador,'')),''),'panel');
  v_res jsonb;
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;
  if v_pc = '' then return jsonb_build_object('ok',false,'error','FALTA_PC'); end if;
  if v_seg not in ('RESCATE','INTENTO') then v_seg := 'RESCATE'; end if;

  with clasif as (
    select c.*, lower(c.usuario) as u_low,
           case when c.ultima is null then null
                else floor(extract(epoch from (now() - c.ultima))/86400)::int end as dias,
           case when not c.alguna_vez_cargo and c.intento_veces is not null then 'INTENTO'
                when c.ultima is not null and c.ultima < now() - make_interval(days => v_d) then 'RESCATE'
                else 'OTRO' end as segmento
    from public.rescate_candidatos c
    where c.pc_codigo = v_pc and length(coalesce(c.telefono,'')) = 10
  ),
  filtrado as (
    select c.*, r.operador as reservado_por
    from clasif c
    left join public.reconexion_contactos m
           on m.pc_codigo = v_pc and m.usuario = c.u_low
          and (m.estado <> 'NO_CONTESTA' or m.reabrir_at is null or m.reabrir_at > now())
    left join public.reconexion_reservas r
           on r.pc_codigo = v_pc and r.usuario = c.u_low
          and r.tomado_at > now() - interval '30 minutes'
    where c.segmento = v_seg and m.usuario is null
  )
  select jsonb_build_object(
    'ok', true, 'pc_codigo', v_pc, 'segmento', v_seg, 'dias', v_d,
    'total', (select count(*) from filtrado),
    'tomados_por_otros', (select count(*) from filtrado where reservado_por is not null and reservado_por <> v_op),
    'lista', coalesce((select jsonb_agg(jsonb_build_object(
        'usuario', f.usuario, 'telefono', f.telefono, 'titular', f.titular, 'app', f.app,
        'valor_historico', round(f.valor), 'ops', f.ops, 'cargas_en_nodo', f.cargas_nodo,
        'dias_sin_cargar', f.dias, 'ultima', f.ultima, 'segmento', f.segmento,
        'intento_veces', f.intento_veces, 'intento_ultimo', f.intento_ultimo,
        'monto_pedido', f.monto_pedido, 'fue_rechazada', f.fue_rechazada,
        'reservado_por', case when f.reservado_por = v_op then null else f.reservado_por end,
        'es_mio', (f.reservado_por = v_op))
        order by (case when v_seg='INTENTO' then extract(epoch from f.intento_ultimo) else f.valor end) desc nulls last)
      from (select * from filtrado
             order by (case when v_seg='INTENTO' then extract(epoch from intento_ultimo) else valor end) desc nulls last
             limit v_lim) f), '[]'::jsonb)
  ) into v_res;
  return v_res;
end $function$
;


-- ══ panel_rescate_tomar(p_secret text, p_pc_codigo text, p_usuario text, p_operador text)
CREATE OR REPLACE FUNCTION public.panel_rescate_tomar(p_secret text, p_pc_codigo text, p_usuario text, p_operador text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pc  text := upper(btrim(coalesce(p_pc_codigo,'')));
  v_u   text := lower(btrim(coalesce(p_usuario,'')));
  v_op  text := coalesce(nullif(btrim(coalesce(p_operador,'')),''),'panel');
  v_due text;
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;
  if v_pc = '' or v_u = '' then return jsonb_build_object('ok',false,'error','FALTAN_DATOS'); end if;

  insert into public.reconexion_reservas (pc_codigo, usuario, operador, tomado_at)
  values (v_pc, v_u, v_op, now())
  on conflict (pc_codigo, usuario) do update
     set operador = excluded.operador, tomado_at = now()
   where public.reconexion_reservas.operador = excluded.operador
      or public.reconexion_reservas.tomado_at < now() - interval '30 minutes';

  select operador into v_due from public.reconexion_reservas
   where pc_codigo = v_pc and usuario = v_u;

  if v_due is distinct from v_op then
    return jsonb_build_object('ok', false, 'error', 'YA_LO_TIENE_OTRO', 'operador', v_due);
  end if;
  return jsonb_build_object('ok', true, 'usuario', v_u, 'operador', v_op);
end $function$
;


-- ══ panel_usuarios_contacto(p_secret text, p_pc_codigo text, p_usuarios text[])
CREATE OR REPLACE FUNCTION public.panel_usuarios_contacto(p_secret text, p_pc_codigo text, p_usuarios text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pc text := upper(trim(coalesce(p_pc_codigo,'')));
  v_out jsonb;
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;
  if p_usuarios is null or array_length(p_usuarios,1) is null then
    return jsonb_build_object('ok',true,'usuarios','[]'::jsonb); end if;
  if array_length(p_usuarios,1) > 400 then
    return jsonb_build_object('ok',false,'error','DEMASIADOS'); end if;

  with pedidos as (
    select distinct lower(btrim(u)) u from unnest(p_usuarios) u where coalesce(btrim(u),'') <> ''
  ),
  vinc as (
    select p.u,
      (array_agg(v.telefono_canon order by (upper(coalesce(v.pc_codigo,''))=v_pc) desc, v.id desc)
        filter (where coalesce(v.telefono_canon,'') <> ''))[1] tel,
      (array_agg(upper(coalesce(v.pc_codigo,'')) order by (upper(coalesce(v.pc_codigo,''))=v_pc) desc, v.id desc)
        filter (where coalesce(v.telefono_canon,'') <> ''))[1] tel_pc,
      (array_agg(v.titular order by (upper(coalesce(v.pc_codigo,''))=v_pc) desc, v.id desc)
        filter (where coalesce(v.titular,'') <> ''))[1] titular,
      bool_or(coalesce(v.app_instalada,false)) app
    from pedidos p
    left join public.usuarios_portal_vinculos v on lower(btrim(v.usuario)) = p.u
    group by p.u
  ),
  delsol as (
    select v.u, s.tel from vinc v
    cross join lateral (
      select regexp_replace(s2.metadata->>'telefono','\D','','g') tel
      from public.landing_solicitudes s2
      where lower(s2.usuario) = v.u and coalesce(s2.metadata->>'telefono','') <> ''
      order by s2.created_at desc limit 1
    ) s
    where coalesce(v.tel,'') = ''
  ),
  pushu as (
    select distinct lower(btrim(ps.usuario)) u from public.push_subscriptions ps
    where coalesce(ps.activa,true) and lower(btrim(ps.usuario)) in (select u from pedidos)
  ),
  ops as (
    select lower(btrim(h.usuario)) u, count(*) n, max(h.created_at) ult,
           count(*) filter (where upper(coalesce(h.tipo,''))='CARGA') cargas,
           coalesce(sum(h.monto) filter (where upper(coalesce(h.tipo,''))='CARGA'),0) monto
    from public.historial_ops h
    where lower(btrim(h.usuario)) in (select u from pedidos)
    group by 1
  )
  select jsonb_agg(jsonb_build_object(
           'usuario', v.u,
           'telefono', nullif(coalesce(nullif(v.tel,''), d.tel),''),
           'de_oficina', case when v.tel_pc = v_pc then true when v.tel_pc is null then null else false end,
           'titular', v.titular,
           'app', coalesce(v.app,false),
           'push', (pu.u is not null),
           'ops', coalesce(o.n,0),
           'cargas', coalesce(o.cargas,0),
           'monto_cargas', coalesce(o.monto,0),
           'ultima_op', o.ult,
           'dias', case when o.ult is null then null
                        else floor(extract(epoch from (now()-o.ult))/86400)::int end
         ) order by v.u) into v_out
  from vinc v
  left join delsol d on d.u = v.u
  left join pushu  pu on pu.u = v.u
  left join ops    o  on o.u  = v.u;

  return jsonb_build_object('ok',true,'usuarios',coalesce(v_out,'[]'::jsonb));
end;
$function$
;


-- ══ rescate_refrescar()
CREATE OR REPLACE FUNCTION public.rescate_refrescar()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_n integer;
begin
  -- Se arma completo y recien al final se reemplaza, dentro de la misma transaccion: si algo
  -- falla a mitad, la tabla vieja queda intacta y las colas siguen andando con datos de hace
  -- media hora en vez de quedar vacias.
  create temp table _nuevo on commit drop as
  with vinc as (
    select upper(coalesce(v.pc_codigo,'')) pc, nodo_norm_usuario_v21(v.usuario) u,
           max(v.usuario) usuario_real,
           max(right(regexp_replace(coalesce(v.telefono_canon,''),'\D','','g'),10)) tel,
           max(nullif(btrim(coalesce(v.titular,'')),'')) titular,
           bool_or(coalesce(v.app_instalada,false)) app
    from public.usuarios_portal_vinculos v
    where coalesce(v.estado_vinculo,'') <> 'DUPLICADO'
    group by 1,2
  ),
  ag as (
    select upper(coalesce(a.pc_codigo,'')) pc, nodo_norm_usuario_v21(a.alias) u,
           count(*) ops, max(a.fecha) ultima,
           coalesce(sum(a.cantidad) filter (where a.cantidad > 0),0) dep
    from public.agente_operaciones_importadas a
    where coalesce(a.alias,'') <> '' and upper(coalesce(a.tipo,'')) = 'DEPOSITO DE UN JUGADOR'
    group by 1,2
  ),
  nodo as (
    select upper(coalesce(h.pc_codigo,'')) pc, nodo_norm_usuario_v21(h.usuario) u,
           count(*) filter (where upper(coalesce(h.tipo,''))='CARGA') cargas,
           max(h.created_at) filter (where upper(coalesce(h.tipo,''))='CARGA') ultima,
           coalesce(sum(h.monto) filter (where upper(coalesce(h.tipo,''))='CARGA'),0) monto
    from public.historial_ops h group by 1,2
  ),
  intentos as (
    select upper(coalesce(s.pc_codigo,'')) pc, nodo_norm_usuario_v21(s.usuario) u,
           count(*) veces, max(s.created_at) ultimo, max(s.monto) monto_pedido,
           bool_or(s.estado = 'RECHAZADA') rechazada
    from public.landing_solicitudes s
    where upper(coalesce(s.tipo,''))='CARGA' and coalesce(btrim(s.usuario),'') <> ''
    group by 1,2
  )
  select coalesce(v.pc, a.pc, i.pc)                    as pc_codigo,
         coalesce(v.u,  a.u,  i.u)                     as u,
         coalesce(v.usuario_real, a.u, i.u)            as usuario,
         v.tel, v.titular, v.app,
         round(coalesce(a.dep,0) + coalesce(n.monto,0), 2) as valor,
         (coalesce(a.ops,0) + coalesce(n.cargas,0))::int   as ops,
         nullif(greatest(coalesce(a.ultima,'-infinity'::timestamptz),
                         coalesce(n.ultima,'-infinity'::timestamptz)),
                '-infinity'::timestamptz)              as ultima,
         coalesce(n.cargas,0)::int                     as cargas_nodo,
         i.veces::int                                  as intento_veces,
         i.ultimo                                      as intento_ultimo,
         i.monto_pedido, i.rechazada                   as fue_rechazada,
         (coalesce(n.cargas,0) > 0)                    as alguna_vez_cargo
  from vinc v
  full join ag  a on a.pc = v.pc and a.u = v.u
  full join intentos i on i.pc = coalesce(v.pc,a.pc) and i.u = coalesce(v.u,a.u)
  left join nodo n on n.pc = coalesce(v.pc,a.pc,i.pc) and n.u = coalesce(v.u,a.u,i.u)
  where coalesce(v.pc, a.pc, i.pc) ~ '^P[0-9]+$'
    and coalesce(v.u, a.u, i.u) is not null;

  delete from public.rescate_candidatos;
  insert into public.rescate_candidatos
    (pc_codigo,u,usuario,telefono,titular,app,valor,ops,ultima,cargas_nodo,
     intento_veces,intento_ultimo,monto_pedido,fue_rechazada,alguna_vez_cargo)
  select pc_codigo,u,usuario,tel,titular,app,valor,ops,ultima,cargas_nodo,
         intento_veces,intento_ultimo,monto_pedido,fue_rechazada,alguna_vez_cargo
  from _nuevo;
  get diagnostics v_n = row_count;

  return jsonb_build_object('ok', true, 'candidatos', v_n, 'cuando', now());
end $function$
;
