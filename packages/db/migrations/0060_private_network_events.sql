-- 0060 — A founder's network messages are theirs alone (audit FU-S-2).
-- Since 0027 a connection request and every message from another founder were written into each LIVE business the
-- recipient runs: as a `connection.requested` / `message.received` event (the sender's id, a 280-character preview
-- of the message, the request note) and as a human message in that business's Inbox › Messages tab. Every member and
-- advisor of the business with Inbox access, and everyone subscribed to its `ev:` stream, could read the founder's
-- private network traffic. The recipient now reads it on Network (threads, requests: only the people in them), with
-- the badge and a content-free signal on their own `u:{userId}` channel; nothing about it is written to a business.
--
-- This removes what was already written, then holds the events table to it: no business-scoped event can be one of
-- these types again, whichever writer tries.
-- 1. The Inbox events that announced those notes ("Message from <founder>" is the subject).
delete from events e
 where e.type = 'inbox.item_created'
   and e.payload->>'inboxItemId' in (
     select i.id::text from inbox_items i
      where i.type = 'human_message'
        and exists (select 1 from events s where s.id = any(i.source_event_ids) and s.type in ('connection.requested', 'message.received')));
--> statement-breakpoint
-- 2. The notes themselves (read receipts, and decisions if any, go with them; plans and proposals keep their rows).
delete from inbox_items i
 where i.type = 'human_message'
   and exists (select 1 from events s where s.id = any(i.source_event_ids) and s.type in ('connection.requested', 'message.received'));
--> statement-breakpoint
-- 3. The events (their outbox rows cascade).
delete from events where type in ('connection.requested', 'message.received');
--> statement-breakpoint
alter table events add constraint events_not_person_addressed check (type not in ('connection.requested', 'message.received'));
