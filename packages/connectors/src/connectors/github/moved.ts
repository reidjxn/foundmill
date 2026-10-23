import { AppError } from "@foundmill/shared";
import { BRANCH_MOVED, branchMovedMessage, type BranchMovedDetails } from "./tools";

/**
 * `commit_files` refusing a branch whose head is not the one the caller's changes are based on (`expectedHeadSha`): a
 * tool error with code `branch_moved`, status 409 and `BranchMovedDetails` (the current head) as its details.
 */
export function branchMoved(branch: string, expectedHeadSha: string, currentHeadSha: string): AppError {
  const details: BranchMovedDetails = { branch, expectedHeadSha, currentHeadSha };
  return new AppError(BRANCH_MOVED, branchMovedMessage(branch, expectedHeadSha, currentHeadSha), 409, details);
}
