import type { MembershipRole } from "@foundmill/shared";

/** "owner" → "Owner": roles are shown as words, never as stored values. */
export const ROLE_WORD: Record<MembershipRole, string> = { owner: "Owner", cofounder: "Cofounder", admin: "Admin", member: "Member", collaborator: "Collaborator", viewer: "Viewer", advisor: "Advisor" };
