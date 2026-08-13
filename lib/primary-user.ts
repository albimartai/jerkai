import { getSql } from "@/lib/db";

// Machine-to-machine pipes (ingest, Whoop sync) carry no session to scope by, so they
// resolve a configured email to a user_id at request/run time instead — never a hardcoded
// numeric id literal in source (NFR-71). Fails closed: an email that resolves to zero or
// more than one users row throws rather than guessing an owner, same discipline the
// user_id retrofit migration's precondition applies to its own ambiguous-owner case.
export async function resolvePrimaryUserId(): Promise<number> {
  const email = process.env.PRIMARY_USER_EMAIL;
  if (!email) {
    throw new Error("PRIMARY_USER_EMAIL is not set");
  }
  const sql = getSql();
  const rows = (await sql`select id from users where email = ${email}`) as { id: number }[];
  if (rows.length !== 1) {
    throw new Error(`PRIMARY_USER_EMAIL resolved to ${rows.length} users (expected exactly 1)`);
  }
  return rows[0].id;
}
