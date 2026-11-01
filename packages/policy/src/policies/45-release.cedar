// Going live is the founder's one tap, in every mode (decision 2026-11-01): a merge to the default branch is the moment
// a change reaches the product, so it asks whatever the business mode says about other irreversible calls. The gateway
// still lets Team › Responsibilities hand the decision to an agent, which is the founder's own choice.
@id("release-asks-founder")
@outcome("ask")
@reason("You chose to be asked before anything goes live")
permit (principal is Agent, action == Action::"call", resource is Tool)
when { resource.connector == "github" && resource.name == "merge_pr" };
