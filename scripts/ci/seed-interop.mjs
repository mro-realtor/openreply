// Seeds a disposable CI database with one workspace, one account and two tokens.
// Prints READ_TOKEN=... and DRAFT_TOKEN=... (random per run, valid for one hour).
import { createHash, randomBytes } from "node:crypto";
import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const mk = () => {
  const secret = `orp_${randomBytes(32).toString("base64url")}`;
  return { secret, hash: createHash("sha256").update(secret).digest("hex") };
};
const read = mk();
const draft = mk();

await client.query(`INSERT INTO "User"(id,email,"updatedAt") VALUES('ci-user','ci@example.test',now())`);
await client.query(`INSERT INTO "Workspace"(id,name,"ownerId","updatedAt") VALUES('ci-ws','ci','ci-user',now())`);
await client.query(`INSERT INTO "WorkspaceMember"(id,"workspaceId","userId",role) VALUES('ci-m','ci-ws','ci-user','OWNER')`);
await client.query(
  `INSERT INTO "InstagramAccount"(id,"workspaceId","instagramId",username,"accessToken","updatedAt") VALUES('ci-acct','ci-ws','ig-ci','interop.account','enc-ci-secret',now())`
);
for (const [id, name, scopes, t] of [
  ["ci-tok-read", "ci read", ["read"], read],
  ["ci-tok-draft", "ci draft", ["read", "drafts:write"], draft],
]) {
  await client.query(
    `INSERT INTO "ApiToken"(id,"workspaceId",name,"tokenPrefix","tokenHash",scopes,"expiresAt") VALUES($1,'ci-ws',$2,$3,$4,$5,now()+interval '1 hour')`,
    [id, name, t.secret.slice(0, 12), t.hash, scopes]
  );
}
// A real database session for the owner, so the OAuth consent step can be done
// over HTTP exactly as a signed-in browser would (Auth.js database sessions).
const sessionToken = randomBytes(24).toString("hex");
await client.query(
  `INSERT INTO "Session"(id,"sessionToken","userId",expires) VALUES('ci-session',$1,'ci-user',now()+interval '1 hour')`,
  [sessionToken]
);
await client.end();
console.log(`READ_TOKEN=${read.secret}`);
console.log(`DRAFT_TOKEN=${draft.secret}`);
console.log(`SESSION_TOKEN=${sessionToken}`);
