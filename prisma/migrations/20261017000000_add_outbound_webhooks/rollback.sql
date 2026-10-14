-- Manual rollback for 20261017000000_add_outbound_webhooks. Not run automatically
-- (Prisma ignores this file). Removes only what the migration added.
-- Endpoints, queued events and delivery history are lost; export them first if you need them.
DROP TABLE IF EXISTS "WebhookDelivery";
DROP TABLE IF EXISTS "OutboxEvent";
DROP TABLE IF EXISTS "WebhookEndpoint";
DROP TYPE IF EXISTS "OutboundDeliveryStatus";
