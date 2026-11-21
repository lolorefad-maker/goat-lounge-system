-- The shop bills by the hour (owner's rule): the first hour counts as soon as one minute is played,
-- and every next hour counts once more than 20 minutes of it are played (1:05 → 1 h, 1:21 → 2 h).
-- Under one minute is free (started by mistake). Still editable later in Settings → Time billing.
UPDATE "branches"
SET "settings" = jsonb_set(
  "settings",
  '{billing}',
  COALESCE("settings" -> 'billing', '{}'::jsonb)
    || '{"graceMinutes": 1, "minimumMinutes": 60, "roundingMinutes": 60, "roundingMode": "up", "roundingThresholdMinutes": 20}'::jsonb,
  true
);
