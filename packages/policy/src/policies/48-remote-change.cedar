// A listed remote MCP tool that can change, move or remove the founder's own records (a Notion page or database, a
// HubSpot record, email, post or page) asks the founder in every mode, automated and vacation included (security
// review, Nov 22, 2026): the vendors' own lists say these change what the founder's people and customers see, and their
// arguments cannot always show what is overwritten. The gateway denies arguments that would delete or change access
// before anyone is asked (`remoteHardGateCall`), and only an owner or admin answers these (`founderOnlyCall`).
@id("remote-change-asks-founder")
@outcome("ask")
@reason("This changes records in your own account, so you are asked first")
permit (principal is Agent, action == Action::"call", resource is Tool)
when {
  (resource.connector == "notion_mcp" && (resource.name == "notion_update_page" || resource.name == "notion_move_pages" || resource.name == "notion_update_database")) ||
  (resource.connector == "hubspot_mcp" && (resource.name == "manage_crm_objects" || resource.name == "manage_marketing_email" || resource.name == "manage_social_posts" || resource.name == "manage_blog_post" || resource.name == "manage_landing_page" || resource.name == "manage_website_page"))
};
