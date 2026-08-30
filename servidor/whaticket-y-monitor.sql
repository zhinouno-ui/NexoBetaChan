-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- WHATICKET · MONITOR DE LÍNEAS · NORMALIZADORES
-- Copia de lectura de lo que corre en Supabase (proyecto NODO · pjvvyvfcwjoocjqvdror).
-- La fuente de verdad son las migraciones; esto está acá para poder leerlo sin entrar a la base.
--
--   whaticket_*        integración con el WhatsApp helpdesk: resolver quién escribe,
--                      qué contactos faltan agendar, y el estado de las líneas.
--   panel_lineas_estado    lo que el panel consulta para avisar si una línea se cayó.
--   panel_registrar_actividad  latido de cada panel (versión, operador, máquina).
--   nodo_norm_*        normalizadores compartidos. nodo_norm_usuario_v21 es el que usa el bot
--                      para comparar usuarios, así que cambiarlo afecta a todo.
--
-- Generado con pg_get_functiondef el 2026-08-30. Verificado por md5 contra la base.
-- ═══════════════════════════════════════════════════════════════════════════════════════════


-- ══ nodo_norm_pc(p_text text)
CREATE OR REPLACE FUNCTION public.nodo_norm_pc(p_text text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  v text;
  n text;
begin
  v := upper(trim(coalesce(p_text,'')));
  v := regexp_replace(v, '\s+', '', 'g');
  if v = '' or v = 'TODAS' or v = 'ALL' then
    return null;
  end if;

  -- PC4, PC-4, P4, OFI4, OFICINA4, 4 => P4
  n := regexp_replace(v, '\D', '', 'g');
  if n <> '' then
    return 'P' || n;
  end if;

  return v;
end;
$function$
;

-- ══ nodo_norm_telefono_v21(p_tel text)
CREATE OR REPLACE FUNCTION public.nodo_norm_telefono_v21(p_tel text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select nullif(regexp_replace(coalesce(p_tel,''), '[^0-9]', '', 'g'), '');
$function$
;

-- ══ nodo_norm_usuario(p_text text)
CREATE OR REPLACE FUNCTION public.nodo_norm_usuario(p_text text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select lower(regexp_replace(trim(coalesce(p_text, '')), '[^a-zA-Z0-9_\\.\\-]+', '', 'g'));
$function$
;

-- ══ nodo_norm_usuario_v21(p_usuario text)
CREATE OR REPLACE FUNCTION public.nodo_norm_usuario_v21(p_usuario text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select nullif(upper(regexp_replace(trim(coalesce(p_usuario,'')), '\s+', '', 'g')), '');
$function$
;

-- ══ nodo_normalizar_usuario(p_raw text)
CREATE OR REPLACE FUNCTION public.nodo_normalizar_usuario(p_raw text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare u text; best text;
begin
  u := lower(trim(coalesce(p_raw,'')));
  if u = '' then return ''; end if;
  -- acentos → ascii  (salteño → salteno)
  u := translate(u,'áàäâãéèëêíìïîóòöôõúùüûñç','aaaaaeeeeiiiiooooouuuunc');
  -- (texto entre parentesis) fuera; si quedo un "(" sin cerrar, cortar ahi
  u := regexp_replace(u,'\([^)]*\)',' ','g');
  u := regexp_replace(u,'\(.*$',' ');
  -- con "/" → mejor segmento, nunca un codigo de oficina
  if position('/' in u) > 0 then
    select x into best from unnest(string_to_array(u,'/')) x
     where x ~ '[a-z]' and x ~ '[0-9]'
       and x !~ '^[^a-z0-9]*(pc|p)[0-9]{1,2}[^a-z0-9]*$'
     order by length(x) desc limit 1;
    if best is null then
      select x into best from unnest(string_to_array(u,'/')) x
       where x ~ '[a-z]'
         and x !~ '^[^a-z0-9]*(pc|p)[0-9]{1,2}[^a-z0-9]*$'
       order by length(x) desc limit 1;
    end if;
    u := coalesce(best,u);
  end if;
  -- pelar bordes no alfanumericos
  u := regexp_replace(regexp_replace(u,'^[^a-z0-9]+',''),'[^a-z0-9]+$','');
  -- varias palabras → la que tenga letras+numeros
  if u ~ '\s' then
    select x into best from unnest(regexp_split_to_array(u,'\s+')) x
     where x ~ '[a-z]' and x ~ '[0-9]' order by length(x) desc limit 1;
    u := coalesce(best,'');
  end if;
  -- validaciones finales ('' = no usable)
  if u = ''                          then return ''; end if;
  if u ~ '^[0-9]+$'                  then return ''; end if;
  if u ~ '^(pc|p)[0-9]{1,2}$'        then return ''; end if;
  if length(u) < 3 or length(u) > 32 then return ''; end if;
  if u !~ '^[a-z0-9._-]+$'           then return ''; end if;
  return u;
end;
$function$
;

-- ══ panel_lineas_estado(p_secret text, p_pc_codigo text)
CREATE OR REPLACE FUNCTION public.panel_lineas_estado(p_secret text, p_pc_codigo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pc      text := upper(btrim(coalesce(p_pc_codigo,'')));
  v_total   integer;
  v_visto   timestamptz;
  v_caidas  jsonb;
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;
  if v_pc = '' then return jsonb_build_object('ok', false, 'mensaje', 'falta pc_codigo'); end if;

  select count(*), max(l.visto_at) into v_total, v_visto
  from public.whaticket_lineas l where l.pc_codigo = v_pc;

  if coalesce(v_total,0) = 0 then
    return jsonb_build_object('ok', true, 'pc', v_pc, 'sin_monitor', true);
  end if;

  select coalesce(jsonb_agg(x order by x->>'nombre'), '[]'::jsonb) into v_caidas
  from (
    select jsonb_build_object(
             'nombre',  l.nombre,
             'estado',  l.estado,
             -- 'qrcode' = la sesión se cerró y espera que escaneen el QR
             'motivo',  case when lower(l.estado) = 'qrcode' then 'esperando QR' else 'desconectada' end,
             'minutos', greatest(0, round(extract(epoch from (now() - l.cambio_at)) / 60))
           ) as x
    from public.whaticket_lineas l
    where l.pc_codigo = v_pc and upper(coalesce(l.estado,'')) <> 'CONNECTED'
  ) s;

  return jsonb_build_object(
    'ok', true, 'pc', v_pc,
    'total',        v_total,
    'conectadas',   v_total - jsonb_array_length(v_caidas),
    'caidas',       v_caidas,
    'ultimo_chequeo', v_visto,
    -- el monitor corre cada 10 min: más de 25 sin noticias es que dejó de correr
    'datos_viejos', (v_visto is null or v_visto < now() - interval '25 minutes')
  );
end $function$
;

-- ══ panel_registrar_actividad(p_secret text, p_pc_codigo text, p_oficina_id text, p_operador text, p_version text, p_instalacion text)
CREATE OR REPLACE FUNCTION public.panel_registrar_actividad(p_secret text, p_pc_codigo text, p_oficina_id text, p_operador text, p_version text DEFAULT ''::text, p_instalacion text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_pc text; v_canon text;
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;
  v_pc := upper(trim(coalesce(p_pc_codigo,'')));
  if v_pc = '' then return jsonb_build_object('ok',false); end if;

  -- El puesto de Chunior cambia de nombre cuando esta ocupado (SANCHEZPLATA -> SANCHEZPLATAENUSO)
  -- y el panel lo mandaba crudo: la misma oficina aparecia dos y tres veces, una "online" y las
  -- otras "apagadas". Se guarda el codigo canonico; el nombre real del puesto queda en oficina_id,
  -- asi no se pierde de que asiento vino.
  select r.pc_codigo into v_canon from public._panel_resolver_puesto_raw(v_pc, null) r limit 1;
  if v_canon is not null and v_canon <> '' then v_pc := upper(v_canon); end if;

  insert into public.panel_actividad(pc_codigo, oficina_id, operador, version, instalacion, last_seen)
  values(v_pc,
         upper(trim(coalesce(nullif(p_oficina_id,''), p_pc_codigo, ''))),
         nullif(trim(p_operador),''), nullif(p_version,''),
         btrim(coalesce(p_instalacion,'')), now())
  on conflict (pc_codigo, clave_maquina) do update set
    oficina_id = excluded.oficina_id,
    -- Con id de instalacion la fila es la maquina, asi que el operador se actualiza al que
    -- este sentado ahora. Cuando la clave ES el operador, esto no cambia nada.
    operador   = coalesce(excluded.operador, panel_actividad.operador),
    version    = coalesce(excluded.version, panel_actividad.version),
    last_seen  = now();
  return jsonb_build_object('ok', true, 'pc', v_pc);
end $function$
;

-- ══ whaticket_contactos_a_agendar(p_pc text, p_limit integer, p_incluir_compartidos boolean)
CREATE OR REPLACE FUNCTION public.whaticket_contactos_a_agendar(p_pc text, p_limit integer DEFAULT 500, p_incluir_compartidos boolean DEFAULT false)
 RETURNS TABLE(usuario text, telefono text, nombre_agenda text, ultima_op timestamp with time zone, compartido boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with agenda as (
    select distinct right(regexp_replace(coalesce(numero_raw,''),'\D','','g'),10) as tel
    from public.whaticket_contactos_stage where pc_codigo = upper(p_pc)
  ),
  ops as (
    select nodo_norm_usuario_v21(usuario) as u,
           max(created_at) as ultima,
           max(nullif(btrim(coalesce(metadata->>'titular','')),'')) as titular_op,
           coalesce(round(sum(monto) filter (where tipo='CARGA'  and estado='ACREDITADA')),0)
         + coalesce(round(sum(monto) filter (where tipo='RETIRO' and estado='PAGADA')),0) as plata
    from public.landing_solicitudes where pc_codigo = upper(p_pc) group by 1
  ),
  cand as (
    select v.usuario, nodo_norm_usuario_v21(v.usuario) as u,
           right(regexp_replace(coalesce(v.telefono_canon,''),'\D','','g'),10) as tel,
           nullif(btrim(coalesce(v.titular,'')),'')     as titular_v,
           nullif(btrim(coalesce(v.cbu_titular,'')),'') as titular_cbu
    from public.usuarios_portal_vinculos v
    where v.pc_codigo = upper(p_pc)
      and length(right(regexp_replace(coalesce(v.telefono_canon,''),'\D','','g'),10)) = 10
  ),
  sin_agenda as (select c.* from cand c left join agenda a on a.tel = c.tel where a.tel is null),
  con_ops as (
    select s.*, o.ultima, o.plata,
           coalesce(s.titular_v, o.titular_op, s.titular_cbu) as titular,
           count(*)                          over (partition by s.tel) as en_ese_tel,
           count(*) filter (where o.plata>0) over (partition by s.tel) as reales_en_ese_tel
    from sin_agenda s join ops o on o.u = s.u
  )
  select usuario,
         '549' || tel,
         usuario || case
           when titular is null then ''
           when nodo_norm_usuario_v21(titular) = u then ''
           else '//' || titular
         end,
         ultima,
         (en_ese_tel > 1)
  from con_ops
  where en_ese_tel = 1                                          -- teléfono propio
     or ( p_incluir_compartidos                                  -- o compartido con
          and en_ese_tel > 1                                     -- una sola cuenta real,
          and reales_en_ese_tel = 1                              -- y esta es esa
          and plata > 0 )
  order by ultima desc
  limit greatest(1, least(coalesce(p_limit,500), 2000));
$function$
;

-- ══ whaticket_identificar_oficina(p_telefonos text[])
CREATE OR REPLACE FUNCTION public.whaticket_identificar_oficina(p_telefonos text[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with muestra as (
    select distinct right(regexp_replace(t,'\D','','g'),10) as tel
    from unnest(coalesce(p_telefonos,'{}')) t
    where length(right(regexp_replace(t,'\D','','g'),10)) = 10
  ),
  por_ofi as (
    select v.pc_codigo,
           count(distinct m.tel) as coinciden
    from muestra m
    join public.usuarios_portal_vinculos v
      on right(regexp_replace(coalesce(v.telefono_canon,''),'\D','','g'),10) = m.tel
    group by v.pc_codigo
  )
  select jsonb_build_object(
    'telefonos_en_la_muestra', (select count(*) from muestra),
    'por_oficina', coalesce((
      select jsonb_agg(jsonb_build_object(
               'pc', pc_codigo,
               'coinciden', coinciden,
               'pct', round(100.0*coinciden/nullif((select count(*) from muestra),0),1))
             order by coinciden desc)
      from por_ofi), '[]'::jsonb),
    'veredicto', coalesce((select pc_codigo from por_ofi order by coinciden desc limit 1), '(indeterminado)')
  );
$function$
;

-- ══ whaticket_lineas_registrar(p_pc text, p_lineas jsonb)
CREATE OR REPLACE FUNCTION public.whaticket_lineas_registrar(p_pc text, p_lineas jsonb)
 RETURNS TABLE(lineas integer, cambios integer, caidas integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pc text := upper(btrim(coalesce(p_pc,'')));
  r jsonb; v_antes text;
  v_n int := 0; v_c int := 0; v_caidas int := 0;
begin
  if v_pc = '' then raise exception 'PC obligatoria'; end if;

  for r in select * from jsonb_array_elements(coalesce(p_lineas,'[]'::jsonb))
  loop
    v_n := v_n + 1;

    select estado into v_antes from public.whaticket_lineas
    where pc_codigo = v_pc and linea_id = r->>'id';

    if v_antes is distinct from (r->>'status') then
      v_c := v_c + 1;
      if coalesce(r->>'status','') <> 'CONNECTED' then v_caidas := v_caidas + 1; end if;

      insert into public.whaticket_lineas_historial
        (pc_codigo, linea_id, nombre, estado_antes, estado_ahora)
      values (v_pc, r->>'id', r->>'name', v_antes, r->>'status');
    end if;

    insert into public.whaticket_lineas (pc_codigo, linea_id, nombre, estado, visto_at, cambio_at)
    values (v_pc, r->>'id', r->>'name', r->>'status', now(), now())
    on conflict (pc_codigo, linea_id) do update
      set nombre    = excluded.nombre,
          estado    = excluded.estado,
          visto_at  = now(),
          -- cambio_at solo se mueve si el estado cambió
          cambio_at = case when public.whaticket_lineas.estado is distinct from excluded.estado
                           then now() else public.whaticket_lineas.cambio_at end;
  end loop;

  return query select v_n, v_c, v_caidas;
end;
$function$
;

-- ══ whaticket_resolver_telefono(p_pc text, p_tel text)
-- Teléfono → usuario, para saber quién escribe por WhatsApp. Solo lectura.
CREATE OR REPLACE FUNCTION public.whaticket_resolver_telefono(p_pc text, p_tel text)
 RETURNS TABLE(usuario text, resuelto_por text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with t as (select right(regexp_replace(coalesce(p_tel,''), '\D', '', 'g'), 10) as tel),
  por_vinculo as (
    select v.usuario, 'vinculo'::text as via, v.updated_at as cuando
    from usuarios_portal_vinculos v, t
    where v.pc_codigo = upper(p_pc)
      and right(regexp_replace(coalesce(v.telefono_canon,''), '\D', '', 'g'), 10) = t.tel
      and length(t.tel) = 10
    order by v.updated_at desc nulls last
    limit 1
  ),
  por_operacion as (
    select s.usuario, 'operacion'::text as via, max(s.created_at) as cuando
    from landing_solicitudes s, t
    where s.pc_codigo = upper(p_pc)
      and right(regexp_replace(coalesce(s.metadata->>'telefono',''), '\D', '', 'g'), 10) = t.tel
      and length(t.tel) = 10
      and s.usuario is not null and btrim(s.usuario) <> ''
    group by s.usuario
    order by max(s.created_at) desc
    limit 1
  )
  select usuario, via from por_vinculo
  union all
  select usuario, via from por_operacion
  where not exists (select 1 from por_vinculo)
  limit 1;
$function$
;
