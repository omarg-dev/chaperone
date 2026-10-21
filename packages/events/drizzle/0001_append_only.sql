-- The event log is append-only: replay, the eval numbers and any dispute evidence all assume an
-- event, once written, never changes. Written by hand because drizzle-kit doesn't generate triggers.
CREATE TRIGGER `events_no_update` BEFORE UPDATE ON `events`
BEGIN
  SELECT RAISE(ABORT, 'events are append-only: updates are not allowed');
END;
--> statement-breakpoint
CREATE TRIGGER `events_no_delete` BEFORE DELETE ON `events`
BEGIN
  SELECT RAISE(ABORT, 'events are append-only: deletes are not allowed');
END;
