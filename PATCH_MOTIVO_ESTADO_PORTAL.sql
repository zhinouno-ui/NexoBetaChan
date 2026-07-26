-- ============================================================
-- PATCH: que la pantalla "Estado" del portal muestre el MOTIVO del rechazo.
--
-- Cadena actual (ya funciona hasta el paso 2):
--   1) Panel rechaza: actualizarSolicitudPortal(id,'RECHAZADA',{motivo})
--   2) panel_v15_5_actualizar_solicitud_portal guarda el motivo en
--      landing_solicitudes.metadata (mergea: el chat_thread sobrevive entre updates)
--   3) ✗ landing_estado_solicitud_segura devuelve mensaje='OK' fijo → el portal
--      nunca ve el motivo, aunque su UI YA lo mostraría (lee d.obs||d.observacion||
--      d.motivo||d.razon en la pantalla Estado).
--
-- El fix es SOLO el paso 3: agregar 'motivo' al JSON que devuelve la RPC.
-- Cero cambios en el portal (ya lee d.motivo) y cero en el panel (ya lo manda).
-- ============================================================

-- PASO A · Verificar que el motivo realmente está guardado en metadata
-- (si esto devuelve el texto del rechazo, el paso 2 está confirmado):
select id, estado, metadata->>'motivo' as motivo, updated_at
from landing_solicitudes
where estado = 'RECHAZADA'
order by id desc
limit 5;

-- PASO B · Traer la definición ACTUAL de la función (para editarla sin romper la firma):
select pg_get_functiondef(p.oid)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'landing_estado_solicitud_segura';

-- PASO C · En esa definición, donde arma el resultado (json_build_object / jsonb_build_object
-- o el SELECT final), agregar UNA línea al objeto devuelto:
--
--     'motivo', coalesce(s.metadata->>'motivo', '')
--
-- (usando el alias real de landing_solicitudes en esa función; suele ser s o ls).
-- Ejemplo de cómo queda el build del resultado:
--
--     return json_build_object(
--       'ok', true,
--       'estado', s.estado,
--       'tipo', s.tipo,
--       'mensaje', 'OK',
--       'motivo', coalesce(s.metadata->>'motivo', '')   -- ← línea nueva
--     );
--
-- Pegar la definición completa modificada con CREATE OR REPLACE FUNCTION
-- (misma firma exacta, mismo SECURITY DEFINER si lo tiene).

-- PASO D · Probar con una solicitud rechazada real:
-- select landing_estado_solicitud_segura(<args de una RECHAZADA>);
-- → el JSON debe traer "motivo":"<texto del rechazo>".

-- NOTA: el auto-rechazo por saldo también manda motivo por la misma vía
-- ('Sin fichas para retirar (saldo 0)' / 'Saldo insuficiente (…)'), así que
-- con este mismo patch el usuario ve también los motivos automáticos.
