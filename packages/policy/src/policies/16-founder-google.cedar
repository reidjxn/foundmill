// The founder's own Gmail and Google Calendar (founder, Nov 19, 2026): agents read them for context and write drafts
// and events with no attendees, but mail sent from the founder's mailbox and invitations from the founder's calendar
// ask the founder first, in every mode and on vacation. Hard gates still forbid (deny beats ask).
@id("founder-google-send-asks")
@outcome("ask")
@reason("Mail from your own Gmail and invitations from your own calendar ask you first")
permit (principal is Agent, action == Action::"call", resource is Tool)
when {
  (resource.connector == "gmail" && resource.name == "send_message") ||
  (resource.connector == "google_calendar" && (resource.name == "create_event" || resource.name == "update_event" || resource.name == "delete_event"))
};
