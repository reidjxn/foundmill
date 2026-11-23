// A listed remote MCP tool that mails or posts to outside people (a HubSpot marketing email or social post) asks the
// founder in every mode, automated and vacation included (security review, Nov 22, 2026): first contact with an outside
// person waits for the founder's decision. Changes to the founder's own records and pages (Notion pages and databases,
// HubSpot records, blog, landing and website pages) run with no approval in every mode (founder, Nov 23, 2026: "They
// should never have to approve individual steps"). The gateway denies arguments that would delete or change access
// before anything runs (`remoteHardGateCall`), and only an owner or admin answers an ask (`founderOnlyCall`).
@id("remote-change-asks-founder")
@outcome("ask")
@reason("This mails or posts to people outside the project, so you are asked first")
permit (principal is Agent, action == Action::"call", resource is Tool)
when {
  resource.connector == "hubspot_mcp" && (resource.name == "manage_marketing_email" || resource.name == "manage_social_posts")
};
