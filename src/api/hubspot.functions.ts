import { createServerFn } from "@tanstack/react-start";

/**
 * HubSpot CRM v3 integration: lee contexto del lead (datos del contacto +
 * empresa asociada + última reunión agendada + llamadas recientes Aircall).
 *
 * El SDR usa esto en Triage para decidir si tiene sentido avanzar con el lead
 * o no, y de qué forma. Ej: si el lead ya tiene una reunión agendada, mejor
 * no enviar el FU 4h. Si tiene llamada reciente con un comercial, contexto
 * para la respuesta.
 *
 * HUBSPOT_API_KEY debe estar como secret en Lovable Cloud (PAT de region EU1).
 */

export type HubSpotContact = {
  id: string;
  email?: string | null;
  firstname?: string | null;
  lastname?: string | null;
  phone?: string | null;
  website?: string | null;
  lifecyclestage?: string | null;
  hs_lead_status?: string | null;
  gtm__avatar_segment?: string | null;
  jobtitle?: string | null;
  company?: string | null;
  notes_last_contacted?: string | null;
  notes_last_updated?: string | null;
  hubspot_owner_id?: string | null;
};

export type HubSpotCompany = {
  id: string;
  name?: string | null;
  domain?: string | null;
  industry?: string | null;
  numberofemployees?: string | null;
  annualrevenue?: string | null;
  country?: string | null;
};

export type HubSpotMeeting = {
  id: string;
  hs_meeting_title?: string | null;
  hs_meeting_start_time?: string | null;
  hs_meeting_end_time?: string | null;
  hs_meeting_outcome?: string | null;
  hs_activity_type?: string | null;
  hs_createdate?: string | null;
};

export type HubSpotCall = {
  id: string;
  hs_call_title?: string | null;
  hs_timestamp?: string | null;
  hs_call_direction?: string | null;
  hs_call_duration?: string | null;
  hs_call_disposition?: string | null;
  hs_call_body?: string | null;
};

export type HubSpotLeadContext = {
  ok: boolean;
  contact: HubSpotContact | null;
  company: HubSpotCompany | null;
  lastMeeting: HubSpotMeeting | null;
  upcomingMeeting: HubSpotMeeting | null;
  recentCalls: HubSpotCall[];
  error?: string;
};

const HS_BASE = "https://connector-gateway.lovable.dev/hubspot";

const CONTACT_PROPS = [
  "email",
  "firstname",
  "lastname",
  "phone",
  "website",
  "lifecyclestage",
  "hs_lead_status",
  "gtm__avatar_segment",
  "jobtitle",
  "company",
  "notes_last_contacted",
  "notes_last_updated",
  "hubspot_owner_id",
];

const COMPANY_PROPS = [
  "name",
  "domain",
  "industry",
  "numberofemployees",
  "annualrevenue",
  "country",
];

const MEETING_PROPS = [
  "hs_meeting_title",
  "hs_meeting_start_time",
  "hs_meeting_end_time",
  "hs_meeting_outcome",
  "hs_activity_type",
  "hs_createdate",
];

const CALL_PROPS = [
  "hs_call_title",
  "hs_timestamp",
  "hs_call_direction",
  "hs_call_duration",
  "hs_call_disposition",
  "hs_call_body",
];

function getApiKey(): string | null {
  return process.env.HUBSPOT_API_KEY ?? null;
}

async function hsGet<T>(path: string): Promise<T> {
  const key = getApiKey();
  if (!key) throw new Error("HUBSPOT_API_KEY no configurado en Lovable Cloud secrets");
  const res = await fetch(`${HS_BASE}${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HubSpot ${res.status} ${path}: ${body.slice(0, 200)}`);
  }
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : ({} as T);
}

async function hsPost<T>(path: string, body: unknown): Promise<T> {
  const key = getApiKey();
  if (!key) throw new Error("HUBSPOT_API_KEY no configurado");
  const res = await fetch(`${HS_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`HubSpot ${res.status} ${path}: ${t.slice(0, 200)}`);
  }
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export const getHubSpotLeadContext = createServerFn({ method: "GET" })
  .inputValidator((data: { hubspot_contact_id: string | number }) => data)
  .handler(async ({ data }): Promise<HubSpotLeadContext> => {
    const contactId = String(data.hubspot_contact_id);
    if (!contactId || contactId === "null" || contactId === "undefined") {
      return {
        ok: false,
        contact: null,
        company: null,
        lastMeeting: null,
        upcomingMeeting: null,
        recentCalls: [],
        error: "hubspot_contact_id missing",
      };
    }

    try {
      // Contact + asociaciones (companies, meetings, calls). HubSpot v3 acepta
      // hasta 4 valores en el query param associations.
      const contactResp = await hsGet<{
        id: string;
        properties: Record<string, string>;
        associations?: {
          companies?: { results?: Array<{ id: string }> };
          meetings?: { results?: Array<{ id: string }> };
          calls?: { results?: Array<{ id: string }> };
        };
      }>(
        `/crm/v3/objects/contacts/${encodeURIComponent(contactId)}?properties=${CONTACT_PROPS.join(
          ","
        )}&associations=companies,meetings,calls`
      );

      const contact: HubSpotContact = {
        id: contactResp.id,
        ...Object.fromEntries(
          CONTACT_PROPS.map((p) => [p, contactResp.properties?.[p] ?? null])
        ),
      } as HubSpotContact;

      const companyId =
        contactResp.associations?.companies?.results?.[0]?.id ?? null;
      const meetingIds = (
        contactResp.associations?.meetings?.results ?? []
      ).map((r) => r.id);
      const callIds = (contactResp.associations?.calls?.results ?? []).map(
        (r) => r.id
      );

      // Batch-fetch en paralelo: company, meetings, calls.
      const [company, meetings, calls] = await Promise.all([
        companyId
          ? hsGet<{ id: string; properties: Record<string, string> }>(
              `/crm/v3/objects/companies/${encodeURIComponent(
                companyId
              )}?properties=${COMPANY_PROPS.join(",")}`
            )
              .then(
                (c) =>
                  ({
                    id: c.id,
                    ...Object.fromEntries(
                      COMPANY_PROPS.map((p) => [p, c.properties?.[p] ?? null])
                    ),
                  }) as HubSpotCompany
              )
              .catch(() => null)
          : Promise.resolve(null),
        meetingIds.length > 0
          ? hsPost<{
              results: Array<{ id: string; properties: Record<string, string> }>;
            }>(`/crm/v3/objects/meetings/batch/read`, {
              properties: MEETING_PROPS,
              inputs: meetingIds.slice(0, 20).map((id) => ({ id })),
            })
              .then((r) =>
                (r.results ?? []).map(
                  (m) =>
                    ({
                      id: m.id,
                      ...Object.fromEntries(
                        MEETING_PROPS.map((p) => [p, m.properties?.[p] ?? null])
                      ),
                    }) as HubSpotMeeting
                )
              )
              .catch(() => [])
          : Promise.resolve([]),
        callIds.length > 0
          ? hsPost<{
              results: Array<{ id: string; properties: Record<string, string> }>;
            }>(`/crm/v3/objects/calls/batch/read`, {
              properties: CALL_PROPS,
              inputs: callIds.slice(0, 20).map((id) => ({ id })),
            })
              .then((r) =>
                (r.results ?? []).map(
                  (c) =>
                    ({
                      id: c.id,
                      ...Object.fromEntries(
                        CALL_PROPS.map((p) => [p, c.properties?.[p] ?? null])
                      ),
                    }) as HubSpotCall
                )
              )
              .catch(() => [])
          : Promise.resolve([]),
      ]);

      // Separar reuniones en pasada vs futura usando hs_meeting_start_time.
      const now = Date.now();
      const meetingsSorted = (meetings as HubSpotMeeting[]).slice().sort((a, b) => {
        const ta = a.hs_meeting_start_time
          ? Date.parse(a.hs_meeting_start_time)
          : 0;
        const tb = b.hs_meeting_start_time
          ? Date.parse(b.hs_meeting_start_time)
          : 0;
        return tb - ta;
      });
      const upcomingMeeting =
        meetingsSorted
          .filter((m) => {
            const t = m.hs_meeting_start_time
              ? Date.parse(m.hs_meeting_start_time)
              : 0;
            return t > now;
          })
          .sort((a, b) => {
            const ta = a.hs_meeting_start_time
              ? Date.parse(a.hs_meeting_start_time)
              : 0;
            const tb = b.hs_meeting_start_time
              ? Date.parse(b.hs_meeting_start_time)
              : 0;
            return ta - tb;
          })[0] ?? null;
      const lastMeeting =
        meetingsSorted.find((m) => {
          const t = m.hs_meeting_start_time
            ? Date.parse(m.hs_meeting_start_time)
            : 0;
          return t > 0 && t <= now;
        }) ?? null;

      const callsSorted = (calls as HubSpotCall[])
        .slice()
        .sort((a, b) => {
          const ta = a.hs_timestamp ? Date.parse(a.hs_timestamp) : 0;
          const tb = b.hs_timestamp ? Date.parse(b.hs_timestamp) : 0;
          return tb - ta;
        })
        .slice(0, 5);

      return {
        ok: true,
        contact,
        company: company as HubSpotCompany | null,
        lastMeeting,
        upcomingMeeting,
        recentCalls: callsSorted,
      };
    } catch (err) {
      return {
        ok: false,
        contact: null,
        company: null,
        lastMeeting: null,
        upcomingMeeting: null,
        recentCalls: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
