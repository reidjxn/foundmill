/**
 * One JSON-LD block (WP-08 T7; audit s3 §3.1). "<" is escaped (`jsonLdText`), so text a founder wrote can never close
 * the script element. A data block does not execute; the site's CSP allows inline scripts already.
 */
import { jsonLdText } from "@foundmill/shared/page-structured-data";

export function JsonLd({ data }: { data: object }) {
  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(data) }} />
  );
}
