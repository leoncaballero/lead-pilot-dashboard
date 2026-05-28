import { createServerFn } from "@tanstack/react-start";

/**
 * Visibility — Lead Allocation Fase 1
 *
 * Lee HubSpot directamente (sin pasar por Supabase) para responder a:
 * "¿Cuántos leads están realmente listos para impactar?"
 *
 * Calcula un funnel de 4 tiers:
 *   T0 = stage = 'Queue' (lo que dice HS sin más)
 *   T1 = T0 + tiene avatar asignado
 *   T2 = T1 + no tiene opt-outs (deliverable)
 *   T3 = T2 + actividad en últimos 90 días (engaged-eligible)
 *
 * + desglose por avatar al nivel T2
 * + inconsistencias detectadas en Queue
 *
 * Toda la lógica queda aquí — si en una iteración futura queremos
 * mover esto a una vista SQL en Supabase (cuando exista el mirror),
 * los conteos son trasladables 1:1.
 */

export type FunnelCounts = {
  t0_queue: number;
  t1_with_avatar: number;
  t2_deliverable: number;
  t3_engaged_90d: number;
  perAvatar: {
    mega: { t1: number; t2: number };
    genesis: { t1: number; t2: number };
    prosperitas: { t1: number; t2: number };
  };
  inconsistencies: {
    queue_without_avatar: number;
    queue_hs_optout: number;
    queue_cold_optout: number;
    queue_bounced: number;
  };
  computedAt: string;
};

const HS_BASE = "https://api.hubapi.com";

type HsFilter = {
  propertyName: string;
  operator: string;
  value?: string;
};

type HsFilterGroup = {
  filters: HsFilter[];
};

async function searchTotal(filterGroups: HsFilterGroup[]): Promise<number> {
  const key = process.env.HUBSPOT_API_KEY;
  if (!key) {
    throw new Error("HUBSPOT_API_KEY no configurado en Lovable Cloud secrets");
  }
  const res = await fetch(`${HS_BASE}/crm/v3/objects/contacts/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      filterGroups,
      limit: 1,
      properties: ["email"],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `HubSpot search failed ${res.status}: ${body.slice(0, 200)}`
    );
  }
  const json = (await res.json()) as { total?: number };
  return json.total ?? 0;
}

// Filtros reutilizables
const F_QUEUE: HsFilter = {
  propertyName: "gtm__lead_stage",
  operator: "EQ",
  value: "Queue",
};
const F_HAS_AVATAR: HsFilter = {
  propertyName: "gtm__avatar_segment",
  operator: "HAS_PROPERTY",
};
const F_NO_AVATAR: HsFilter = {
  propertyName: "gtm__avatar_segment",
  operator: "NOT_HAS_PROPERTY",
};
const F_NO_COLD_OPTOUT: HsFilter = {
  propertyName: "outbound__cold_email__optout",
  operator: "NEQ",
  value: "true",
};
const F_NO_HS_OPTOUT: HsFilter = {
  propertyName: "hs_email_optout",
  operator: "NEQ",
  value: "true",
};
const F_HS_OPTOUT: HsFilter = {
  propertyName: "hs_email_optout",
  operator: "EQ",
  value: "true",
};
const F_COLD_OPTOUT: HsFilter = {
  propertyName: "outbound__cold_email__optout",
  operator: "EQ",
  value: "true",
};
const F_BOUNCED: HsFilter = {
  propertyName: "hs_email_bounce",
  operator: "GT",
  value: "0",
};

function avatarFilter(value: "MEGA" | "Genesis" | "Prosperitas"): HsFilter {
  return {
    propertyName: "gtm__avatar_segment",
    operator: "EQ",
    value,
  };
}

export const getVisibilityFunnel = createServerFn({ method: "GET" }).handler(
  async (): Promise<FunnelCounts> => {
    const ninetyDaysAgoMs = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const recentActivityFilter: HsFilter = {
      propertyName: "notes_last_updated",
      operator: "GT",
      value: String(ninetyDaysAgoMs),
    };

    // 14 búsquedas en paralelo. HS EU permite ~250 req/10s, sobramos.
    const [
      t0_queue,
      t1_with_avatar,
      t2_deliverable,
      t3_engaged_90d,
      mega_t1,
      mega_t2,
      genesis_t1,
      genesis_t2,
      prosperitas_t1,
      prosperitas_t2,
      inc_no_avatar,
      inc_hs_optout,
      inc_cold_optout,
      inc_bounced,
    ] = await Promise.all([
      // Funnel principal
      searchTotal([{ filters: [F_QUEUE] }]),
      searchTotal([{ filters: [F_QUEUE, F_HAS_AVATAR] }]),
      searchTotal([
        { filters: [F_QUEUE, F_HAS_AVATAR, F_NO_COLD_OPTOUT, F_NO_HS_OPTOUT] },
      ]),
      searchTotal([
        {
          filters: [
            F_QUEUE,
            F_HAS_AVATAR,
            F_NO_COLD_OPTOUT,
            F_NO_HS_OPTOUT,
            recentActivityFilter,
          ],
        },
      ]),

      // Por avatar — T1 baseline
      searchTotal([{ filters: [F_QUEUE, avatarFilter("MEGA")] }]),
      // Por avatar — T2 deliverable
      searchTotal([
        {
          filters: [
            F_QUEUE,
            avatarFilter("MEGA"),
            F_NO_COLD_OPTOUT,
            F_NO_HS_OPTOUT,
          ],
        },
      ]),
      searchTotal([{ filters: [F_QUEUE, avatarFilter("Genesis")] }]),
      searchTotal([
        {
          filters: [
            F_QUEUE,
            avatarFilter("Genesis"),
            F_NO_COLD_OPTOUT,
            F_NO_HS_OPTOUT,
          ],
        },
      ]),
      searchTotal([{ filters: [F_QUEUE, avatarFilter("Prosperitas")] }]),
      searchTotal([
        {
          filters: [
            F_QUEUE,
            avatarFilter("Prosperitas"),
            F_NO_COLD_OPTOUT,
            F_NO_HS_OPTOUT,
          ],
        },
      ]),

      // Inconsistencias
      searchTotal([{ filters: [F_QUEUE, F_NO_AVATAR] }]),
      searchTotal([{ filters: [F_QUEUE, F_HS_OPTOUT] }]),
      searchTotal([{ filters: [F_QUEUE, F_COLD_OPTOUT] }]),
      searchTotal([{ filters: [F_QUEUE, F_BOUNCED] }]),
    ]);

    return {
      t0_queue,
      t1_with_avatar,
      t2_deliverable,
      t3_engaged_90d,
      perAvatar: {
        mega: { t1: mega_t1, t2: mega_t2 },
        genesis: { t1: genesis_t1, t2: genesis_t2 },
        prosperitas: { t1: prosperitas_t1, t2: prosperitas_t2 },
      },
      inconsistencies: {
        queue_without_avatar: inc_no_avatar,
        queue_hs_optout: inc_hs_optout,
        queue_cold_optout: inc_cold_optout,
        queue_bounced: inc_bounced,
      },
      computedAt: new Date().toISOString(),
    };
  }
);
