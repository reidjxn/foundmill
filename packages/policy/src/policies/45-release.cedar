// Going live is the founder's one tap, in every mode (decision 2026-11-01): a merge to the default branch is the moment
// a change reaches the product, so it asks whatever the business mode says about other irreversible calls. The gateway
// still lets Team › Responsibilities hand the decision to an agent, which is the founder's own choice.
@id("release-asks-founder")
@outcome("ask")
@reason("You chose to be asked before anything goes live")
permit (principal is Agent, action == Action::"call", resource is Tool)
when { resource.connector == "github" && resource.name == "merge_pr" };

// A file the team made with a program (CLI-Anything) reaches the project only when the founder approves it, in every
// mode, so a made file never goes live on an agent's say-so (founder, 2026-11-19).
@id("cli-release-asks-founder")
@outcome("ask")
@reason("A file the team made reaches the project only when you approve it")
permit (principal is Agent, action == Action::"call", resource is Tool)
when { resource.name == "release_output" && (resource.connector == "cli_inkscape" || resource.connector == "cli_libreoffice" || resource.connector == "cli_ffmpeg" || resource.connector == "cli_gimp") };
