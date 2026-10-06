import type { Rates } from "../tools";

export const ECB_FIXTURE_DATE = "2026-10-02";

export const ECB_FIXTURE_RATES: Rates = {
  date: ECB_FIXTURE_DATE,
  base: "EUR",
  rates: { USD: 1.0842, GBP: 0.8451, SEK: 11.213, NOK: 11.602, DKK: 7.4587, CHF: 0.9381, JPY: 162.91, PLN: 4.2715, CZK: 24.894, HUF: 395.72, CAD: 1.4886, AUD: 1.6381, NZD: 1.7772, SGD: 1.4312, HKD: 8.4632, INR: 91.185, BRL: 5.9342, ZAR: 19.471, KRW: 1489.3, MXN: 19.953, TRY: 45.316, CNY: 7.7391, ISK: 149.8, RON: 5.0893, BGN: 1.9558 },
  source: "fixture:eurofxref-daily.xml",
  label: "Estimate",
};

export const ECB_FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
<gesmes:subject>Reference rates</gesmes:subject>
<Cube><Cube time='${ECB_FIXTURE_DATE}'>
${Object.entries(ECB_FIXTURE_RATES.rates)
  .map(([c, r]) => `<Cube currency='${c}' rate='${r}'/>`)
  .join("\n")}
</Cube></Cube></gesmes:Envelope>`;
