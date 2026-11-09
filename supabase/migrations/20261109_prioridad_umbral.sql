-- Umbral de presupuesto oficial de los focos de prioridad (valor inicial $100 MDP).
-- El valor efectivo se puede sobrescribir por radar con las variables
-- BIRMEX_MIN_AMOUNT_MXN, DIFEM_MIN_AMOUNT_MXN, JCEM_MIN_AMOUNT_MXN y SALUD_EDOMEX_MIN_AMOUNT_MXN.
UPDATE public.radars
SET config_json = (config_json - 'any_amount') || jsonb_build_object(
      'min_amount_mxn', 100000000,
      'amount_rule', 'greater_or_equal',
      'unconfirmed_amount', 'monto_por_verificar_sin_alerta'),
    updated_at = now()
WHERE key IN ('birmex_prioridad_20261108', 'edomex_difem_20261108',
              'edomex_jcem_20261108', 'edomex_salud_20261108');
