-- Live mailbox counts.
--
-- Every writer that can change what the sidebar shows — IMAP IDLE, the Gmail
-- delta sync, the rules processor, and the web's own server actions — ends up
-- writing mailbox_threads. Notifying from the table itself means none of them
-- has to remember to publish an event, and one that is added later is covered
-- for free.
--
-- The payload carries only ids. The SSE route matches owner_id against the
-- signed-in user before forwarding anything, so a notification is never
-- delivered to a browser that does not own the row.

CREATE OR REPLACE FUNCTION public.notify_mailbox_threads_change()
RETURNS trigger AS $$
DECLARE
  rec record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    rec := OLD;
  ELSE
    rec := NEW;
  END IF;

  PERFORM pg_notify(
    'kurrier_mailbox_threads',
    json_build_object(
      'ownerId', rec.owner_id,
      'mailboxId', rec.mailbox_id,
      'identityPublicId', rec.identity_public_id,
      'op', TG_OP
    )::text
  );

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_mailbox_threads_notify_write ON public.mailbox_threads;--> statement-breakpoint

CREATE TRIGGER trg_mailbox_threads_notify_write
AFTER INSERT OR DELETE ON public.mailbox_threads
FOR EACH ROW EXECUTE FUNCTION public.notify_mailbox_threads_change();--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_mailbox_threads_notify_update ON public.mailbox_threads;--> statement-breakpoint

-- Updates are noisy (every message upsert touches the row), so only the
-- columns the mail UI actually renders are worth waking a browser for.
CREATE TRIGGER trg_mailbox_threads_notify_update
AFTER UPDATE ON public.mailbox_threads
FOR EACH ROW
WHEN (
  OLD.unread_count IS DISTINCT FROM NEW.unread_count
  OR OLD.message_count IS DISTINCT FROM NEW.message_count
  OR OLD.starred IS DISTINCT FROM NEW.starred
  OR OLD.last_activity_at IS DISTINCT FROM NEW.last_activity_at
  OR OLD.snoozed_until IS DISTINCT FROM NEW.snoozed_until
)
EXECUTE FUNCTION public.notify_mailbox_threads_change();
