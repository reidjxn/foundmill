/**
 * What the client roles (`authenticated`, `anon`) may SELECT on the two LIVE tables with hidden columns (0058): the
 * Drizzle columns minus `CLIENT_HIDDEN_COLUMNS`. A direct query as a client role must name these, because `select()`
 * (every column) is refused; the api reads on the service connection and is not limited.
 */
import { getTableColumns } from "drizzle-orm";
import { messageThreads, posts } from "../../schema";

const { mutedIds: _mutedIds, ...threads } = getTableColumns(messageThreads);
const { screening: _screening, moderatedBy: _moderatedBy, moderationNote: _moderationNote, ...postColumnsRest } = getTableColumns(posts);

/** `message_threads` without `muted_ids`. */
export const threadColumns = threads;
/** `posts` without `screening`, `moderated_by` and `moderation_note`. */
export const postColumns = postColumnsRest;
