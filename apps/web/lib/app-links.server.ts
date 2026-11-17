/**
 * The universal-link files (WP-12 T8; docs/mobile/BACKEND_CHANGES.md §5): what iOS reads at
 * `/.well-known/apple-app-site-association` and Android at `/.well-known/assetlinks.json`, so a link to a project page,
 * a person page, a card, an invitation or a one-click answer opens the native app when it is installed.
 *
 * The ids are server values set at launch with the store links: `APP_LINKS_IOS_APP_ID` (`<Team ID>.com.foundmill.app`),
 * `APP_LINKS_ANDROID_PACKAGE` and `APP_LINKS_ANDROID_SHA256` (comma-separated fingerprints). Unset means the file does
 * not exist (404): nothing is promised before the app is.
 */
export interface AppLinks {
  iosAppId: string | null;
  android: { packageName: string; sha256: string[] } | null;
}

/** The paths the app opens. Never `/login` or `/auth/*`: signing in stays in the browser. */
export const APP_LINK_PATHS = ["/b/*", "/p/*", "/u/*", "/m/*", "/i/*", "/a/*"] as const;

const IOS_APP_ID = /^[A-Z0-9]{10}\.[A-Za-z0-9.-]+$/;
const ANDROID_PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
const SHA256 = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/i;

export function appLinks(env: Record<string, string | undefined>): AppLinks {
  const ios = env.APP_LINKS_IOS_APP_ID?.trim() ?? "";
  const pkg = env.APP_LINKS_ANDROID_PACKAGE?.trim() ?? "";
  const sha256 = (env.APP_LINKS_ANDROID_SHA256 ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return {
    iosAppId: IOS_APP_ID.test(ios) ? ios : null,
    android: ANDROID_PACKAGE.test(pkg) && sha256.length > 0 && sha256.every((s) => SHA256.test(s)) ? { packageName: pkg, sha256 } : null,
  };
}

/** The apple-app-site-association document, or null while the iOS app id is unset. */
export function appleAppSiteAssociation(links: AppLinks): object | null {
  if (!links.iosAppId) return null;
  return { applinks: { apps: [], details: [{ appID: links.iosAppId, paths: [...APP_LINK_PATHS] }] } };
}

/** The Digital Asset Links document, or null while the Android package or fingerprints are unset. */
export function assetLinks(links: AppLinks): object[] | null {
  if (!links.android) return null;
  return [{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: links.android.packageName, sha256_cert_fingerprints: links.android.sha256 } }];
}

/** The three server values, read from the process (request time, so they can be set without a build). */
export const appLinksFromProcess = (): AppLinks =>
  appLinks({ APP_LINKS_IOS_APP_ID: process.env.APP_LINKS_IOS_APP_ID, APP_LINKS_ANDROID_PACKAGE: process.env.APP_LINKS_ANDROID_PACKAGE, APP_LINKS_ANDROID_SHA256: process.env.APP_LINKS_ANDROID_SHA256 });
