import { describe, expect, it } from "vitest";
import { createGmailConnector } from "../connectors/gmail";
import { GMAIL_COMPOSE_SCOPE, GMAIL_READ_SCOPE, GMAIL_SCOPES } from "../connectors/gmail/tools";
import { createGoogleCalendarConnector } from "../connectors/google_calendar";
import { GOOGLE_CALENDAR_SCOPES } from "../connectors/google_calendar/tools";
import { createGoogleDriveConnector } from "../connectors/google_drive";
import { GOOGLE_DRIVE_READ_SCOPE, GOOGLE_DRIVE_SCOPES } from "../connectors/google_drive/tools";

// The scopes submitted for Google's OAuth verification (Nov 23, 2026). Adding one here means a new submission:
// a restricted scope (gmail.compose, gmail.readonly, drive.readonly) also needs Google's yearly outside security assessment.
const G = "https://www.googleapis.com/auth/";
const SUBMITTED = { gmail: [`${G}gmail.send`], google_calendar: [`${G}calendar.events`, `${G}calendar.readonly`], google_drive: [`${G}drive.file`, `${G}documents`] };

describe("Google scopes match the verification submission", () => {
  it("declares exactly the submitted scopes by default", () => {
    expect(GMAIL_SCOPES).toEqual(SUBMITTED.gmail);
    expect(GOOGLE_CALENDAR_SCOPES).toEqual(SUBMITTED.google_calendar);
    expect(GOOGLE_DRIVE_SCOPES).toEqual(SUBMITTED.google_drive);
  });

  it("asks Google for exactly those on the consent screen", async () => {
    const start = { state: "abc.def", redirectUri: "https://app.example.com/integrations/oauth/callback" };
    const consent = async (c: ReturnType<typeof createGmailConnector>, input: object = {}) => new URL(String((await c.connect("b", { ...start, ...input })).config.authorizeUrl)).searchParams.get("scope")!.split(" ").filter((s) => s.startsWith(G));
    const secrets = { secrets: { googleClientId: "cid" } };
    expect(await consent(createGmailConnector(secrets))).toEqual(SUBMITTED.gmail);
    expect(await consent(createGoogleCalendarConnector(secrets))).toEqual(SUBMITTED.google_calendar);
    expect(await consent(createGoogleDriveConnector(secrets))).toEqual(SUBMITTED.google_drive);
    // The restricted read scopes come only from the founder's own opt-in, each on its own connector.
    expect(await consent(createGmailConnector(secrets), { readMail: true })).toEqual([...SUBMITTED.gmail, GMAIL_READ_SCOPE, GMAIL_COMPOSE_SCOPE]);
    expect(await consent(createGoogleDriveConnector(secrets), { readDrive: true })).toEqual([...SUBMITTED.google_drive, GOOGLE_DRIVE_READ_SCOPE]);
    expect(await consent(createGoogleDriveConnector(secrets), { readDrive: "yes" })).toEqual(SUBMITTED.google_drive);
  });
});
