-- The model spend ledger is append-only, like the event log: a day's cap is counted from it, so a
-- row, once written, never changes. A call is settled by a second row, never by editing the first.
CREATE TRIGGER `model_spend_no_update` BEFORE UPDATE ON `model_spend`
BEGIN
  SELECT RAISE(ABORT, 'model_spend is append-only: updates are not allowed');
END;
--> statement-breakpoint
CREATE TRIGGER `model_spend_no_delete` BEFORE DELETE ON `model_spend`
BEGIN
  SELECT RAISE(ABORT, 'model_spend is append-only: deletes are not allowed');
END;
