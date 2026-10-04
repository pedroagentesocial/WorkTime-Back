-- CreateIndex
-- La limpieza de eventos viejos busca por fecha
CREATE INDEX "security_events_created_at_idx" ON "security_events"("created_at");
