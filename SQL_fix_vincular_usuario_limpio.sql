-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- FIX · panel_vincular_usuario comparaba el usuario CRUDO
--
-- Sintoma: validas y vinculas a un jugador desde el panel, se guarda bien, pero el jugador sigue
-- entrando al portal con la identidad con la que se registro la primera vez.
--
-- Causa: esta linea comparaba crudo
--     where pc_codigo = v_pc and usuario = v_user
-- mientras que TODO el resto de la funcion compara limpio (_wtk_usuario_limpio). Los usuarios
-- importados de Whaticket vienen con la oficina pegada ("26rodri(pr5)"), asi que esa busqueda no
-- encontraba la fila existente -> se insertaba una NUEVA -> quedaban DOS filas para la misma
-- persona -> landing_portal_resolver_vinculo podia resolver por la vieja.
--
-- Cambios respecto del original (solo dos, ambos en el select de r_exact):
--   1. usuario = v_user   ->   public._wtk_usuario_limpio(usuario) = v_user
--   2. se agrega un ORDER BY: hoy YA hay duplicados en la tabla, y un "limit 1" sin orden elige
--      una fila al azar. Se prefiere la que ya esta VINCULADA y, a igualdad, la mas vieja.
--
-- ANTES DE APLICAR — ver a cuantos jugadores les afecta hoy:
--   select pc_codigo, public._wtk_usuario_limpio(usuario) as usuario_limpio,
--          count(*) as filas, array_agg(usuario) as variantes, array_agg(estado_vinculo) as estados
--   from public.usuarios_portal_vinculos
--   group by 1,2 having count(*) > 1 order by filas desc;
--
-- Esto FRENA que aparezcan duplicados nuevos. Los que ya estan hay que limpiarlos aparte
-- (decidiendo cual fila sobrevive) — no lo hace este script.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.panel_vincular_usuario(p_secret text, p_pc_codigo text, p_usuario text, p_telefono text, p_forzar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pc text := upper(trim(coalesce(p_pc_codigo,'')));
  v_user text := lower(trim(coalesce(p_usuario,'')));
  v_tel text := regexp_replace(coalesce(p_telefono,''), '\D', '', 'g');
  r_tel public.usuarios_portal_vinculos;
  r_exact public.usuarios_portal_vinculos;
  v_target bigint;
begin
  if not public._panel_data_auth(p_secret) then raise exception 'no-auth'; end if;
  if v_user='' then return jsonb_build_object('ok',false,'mensaje','Falta el usuario'); end if;
  if v_pc='' then return jsonb_build_object('ok',false,'mensaje','Falta la oficina'); end if;
  v_user := public._wtk_usuario_limpio(v_user);
  if v_user='' then return jsonb_build_object('ok',false,'mensaje','Falta el usuario'); end if;
  if length(v_tel) > 10 then
    if left(v_tel,2)='54' then v_tel := substr(v_tel,3); end if;
    if left(v_tel,1)='9'  then v_tel := substr(v_tel,2); end if;
    if left(v_tel,1)='0'  then v_tel := substr(v_tel,2); end if;
  end if;
  if length(v_tel) > 10 then v_tel := right(v_tel,10); end if;
  if length(v_tel) < 6 then return jsonb_build_object('ok',false,'mensaje','Teléfono inválido'); end if;

  select * into r_tel   from public.usuarios_portal_vinculos where pc_codigo=v_pc and telefono_canon=v_tel limit 1;

  -- ↓↓↓ EL FIX: se compara LIMPIO (antes: usuario = v_user) y con orden determinista.
  select * into r_exact from public.usuarios_portal_vinculos
   where pc_codigo=v_pc and public._wtk_usuario_limpio(usuario)=v_user
   order by (estado_vinculo='VINCULADO') desc, id asc
   limit 1;

  if (r_tel.id is not null and r_tel.estado_vinculo='BLOQUEADO')
     or (r_exact.id is not null and r_exact.estado_vinculo='BLOQUEADO') then
    return jsonb_build_object('ok',false,'mensaje','Ese usuario/teléfono está BLOQUEADO. Desbloquealo antes de vincular.');
  end if;

  if r_tel.id is not null and public._wtk_usuario_limpio(r_tel.usuario) <> v_user and not p_forzar then
    return jsonb_build_object('ok',false,'conflicto_tel',true,'usuario_actual',r_tel.usuario,
      'mensaje','Ese teléfono ya está vinculado a otro usuario ('||r_tel.usuario||').');
  end if;

  if r_exact.id is not null then v_target := r_exact.id;
  elsif r_tel.id is not null then v_target := r_tel.id;
  else
    insert into public.usuarios_portal_vinculos(pc_codigo,usuario,telefono_canon,telefono_raw,estado_vinculo,fuente)
    values(v_pc,v_user,v_tel,p_telefono,'VINCULADO','OPERADOR_PANEL');
    return jsonb_build_object('ok',true,'mensaje','Usuario vinculado');
  end if;

  delete from public.usuarios_portal_vinculos
   where pc_codigo=v_pc and id <> v_target and estado_vinculo <> 'BLOQUEADO'
     and (telefono_canon=v_tel or public._wtk_usuario_limpio(usuario)=v_user);

  update public.usuarios_portal_vinculos
     set usuario=v_user, telefono_canon=v_tel, telefono_raw=p_telefono,
         estado_vinculo='VINCULADO', updated_at=now()
   where id=v_target;
  return jsonb_build_object('ok',true,'mensaje','Usuario vinculado');
end $function$;
