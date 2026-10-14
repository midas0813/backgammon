-- Rows written before the driver fix hold JSON text as a jsonb string scalar; turn them back into objects.
update matches set data = (data #>> '{}')::jsonb where jsonb_typeof(data) = 'string';
update deposit_intents set data = (data #>> '{}')::jsonb where jsonb_typeof(data) = 'string';
update withdrawals set data = (data #>> '{}')::jsonb where jsonb_typeof(data) = 'string';
update idempotency_keys set response = (response #>> '{}')::jsonb where jsonb_typeof(response) = 'string';
